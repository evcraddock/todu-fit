use automerge::{transaction::Transactable, AutoCommit, ReadDoc, ROOT};
use chrono::{DateTime, NaiveDate, Utc};
use std::{
    fs,
    sync::atomic::{AtomicUsize, Ordering},
};
use tempfile::TempDir;
use todu_fit_core::{
    hydration::entries_in_date_range, shopping::week_start, Dish, DishRepository, HydrationError,
    HydrationRepository, HydrationSettings, HydrationSettingsUpdate, HydrationUnit, Identity,
    Ingredient, ManualItem, MealPlan, MealPlanRepository, MealType, MultiDocStorage,
    ShoppingRepository, WaterEntry,
};
use uuid::Uuid;

fn chicago() -> String {
    "America/Chicago".into()
}
fn at(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
}
fn day(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).unwrap()
}
struct Fixture {
    dir: TempDir,
    identity: Identity,
    cart: ShoppingRepository,
    water: HydrationRepository,
}
impl Fixture {
    fn new() -> Self {
        let dir = TempDir::new().unwrap();
        let identity = Identity::new(MultiDocStorage::new(dir.path().to_path_buf()));
        identity.initialize_new().unwrap();
        identity.create_group("Home").unwrap();
        let cart = ShoppingRepository::new(dir.path().to_path_buf());
        let water = HydrationRepository::with_timezone_provider(dir.path().to_path_buf(), chicago);
        Self {
            dir,
            identity,
            cart,
            water,
        }
    }
    fn ids(&self) -> (todu_fit_core::DocumentId, todu_fit_core::DocumentId) {
        let group = self.identity.list_groups().unwrap()[0].doc_id;
        (
            self.identity
                .load_group(&group)
                .unwrap()
                .shopping_carts_doc_id,
            self.identity.hydration_doc_id().unwrap(),
        )
    }
}

#[test]
fn cart_mutations_use_real_repository_and_no_ops_do_not_write() {
    let f = Fixture::new();
    let week = "2026-07-19";
    let (id, _) = f.ids();
    let storage = f.identity.storage();
    storage.delete(&id).unwrap();
    assert!(f.cart.get(week).unwrap().is_none());
    assert!(f.cart.get_or_create(week).unwrap().manual_items.is_empty());
    assert!(!storage.exists(&id));
    assert!(f
        .cart
        .add_manual_item(week, ManualItem::with_quantity("Soap", "3", "bars"))
        .unwrap());
    let original = storage.load(&id).unwrap();
    assert!(!f
        .cart
        .add_manual_item(week, ManualItem::new("SOAP"))
        .unwrap());
    assert_eq!(storage.load(&id).unwrap(), original);
    assert!(f.cart.set_checked(week, "SOAP", true).unwrap());
    let original = storage.load(&id).unwrap();
    assert!(!f.cart.set_checked(week, "soap", true).unwrap());
    assert_eq!(storage.load(&id).unwrap(), original);
    assert!(f.cart.set_checked(week, "SOAP", false).unwrap());
    let original = storage.load(&id).unwrap();
    assert!(!f.cart.set_checked(week, "Soap", false).unwrap());
    assert_eq!(storage.load(&id).unwrap(), original);
    assert_eq!(f.cart.clear_checked(week).unwrap(), 0);
    assert_eq!(storage.load(&id).unwrap(), original);
    f.cart.set_checked(week, "anything", true).unwrap();
    assert_eq!(f.cart.clear_checked(week).unwrap(), 1);
    assert!(!f.cart.remove_manual_item(week, "Missing").unwrap());
    assert!(f.cart.remove_manual_item(week, "SOAP").unwrap());
    assert!(f.cart.get(week).unwrap().unwrap().manual_items.is_empty());
}

#[test]
fn cart_lists_preserve_latest_first_order_and_manual_shapes() {
    let f = Fixture::new();
    for week in ["2026-07-12", "2026-07-19"] {
        f.cart.add_manual_item(week, ManualItem::new(week)).unwrap();
    }
    assert_eq!(
        f.cart
            .list()
            .unwrap()
            .iter()
            .map(|c| c.week.as_str())
            .collect::<Vec<_>>(),
        vec!["2026-07-19", "2026-07-12"]
    );
    let week = "2026-07-19";
    f.cart
        .add_manual_item(
            week,
            ManualItem {
                name: "Unit only".into(),
                quantity: None,
                unit: Some("bars".into()),
            },
        )
        .unwrap();
    let cart = f.cart.get(week).unwrap().unwrap();
    assert_eq!(
        cart.find_manual_item("UNIT ONLY").unwrap().unit.as_deref(),
        Some("bars")
    );
}

#[test]
fn derived_shopping_view_reuses_core_leftover_aggregation_and_ordering_rules() {
    let f = Fixture::new();
    let (id, _) = f.ids();
    f.identity
        .storage()
        .save(
            &id,
            include_bytes!("fixtures/shopping-before-core.automerge"),
        )
        .unwrap();
    let dishes = DishRepository::new(f.dir.path().to_path_buf());
    let plans = MealPlanRepository::new(f.dir.path().to_path_buf());
    let dish =
        Dish::new("Bowl", "chef").with_ingredients(vec![Ingredient::new("Salt", 2.0, "tsp")]);
    dishes.create(&dish).unwrap();
    for leftovers in [false, true] {
        plans
            .create(
                &MealPlan::new(day(2026, 7, 21), MealType::Dinner, "Dinner", "chef")
                    .with_dish_ids(vec![dish.id])
                    .with_uses_leftovers(leftovers),
            )
            .unwrap();
    }
    plans
        .create(
            &MealPlan::new(day(2026, 7, 21), MealType::Lunch, "Missing dish", "chef")
                .with_dish_ids(vec![Uuid::nil()]),
        )
        .unwrap();
    let bytes = f.identity.storage().load(&id).unwrap();
    let list = f
        .cart
        .list_for_week(day(2026, 7, 19), &plans, &dishes)
        .unwrap();
    assert_eq!(list.items.len(), 3);
    let salt = list.items.iter().find(|i| !i.is_manual).unwrap();
    assert_eq!(salt.quantity, 2.0);
    assert_eq!(salt.unit, "tsp");
    assert!(salt.checked);
    assert_eq!(list.items.last().unwrap().name, "Salt");
    assert_eq!(f.identity.storage().load(&id).unwrap(), bytes);
    // Preserve the existing ingredient-lookup policy; a failed dish read is skipped.
    let group = f
        .identity
        .load_group(&f.identity.list_groups().unwrap()[0].doc_id)
        .unwrap();
    f.identity
        .storage()
        .save(&group.dishes_doc_id, b"corrupt")
        .unwrap();
    assert!(f
        .cart
        .list_for_week(day(2026, 7, 19), &plans, &dishes)
        .unwrap()
        .items
        .iter()
        .all(|i| i.is_manual));
}

#[test]
fn hydration_entry_crud_validation_and_no_settings_read_are_preserved() {
    let f = Fixture::new();
    let (_, id) = f.ids();
    f.identity.storage().delete(&id).unwrap();
    assert!(f.water.list_entries().unwrap().is_empty());
    assert!(!f.identity.storage().exists(&id));
    let mut entry = WaterEntry::new(500, at("2026-07-25T05:00:00Z")).unwrap();
    assert_eq!(f.water.create_entry(&entry).unwrap(), entry);
    let original_time = entry.updated_at;
    entry.amount_ml = 750;
    assert_eq!(f.water.update_entry(&entry).unwrap(), entry);
    assert_eq!(
        f.water.get_by_id(entry.id).unwrap().unwrap().updated_at,
        original_time
    );
    let before = f.identity.storage().load(&id).unwrap();
    entry.amount_ml = 0;
    assert!(matches!(
        f.water.update_entry(&entry),
        Err(HydrationError::Validation(_))
    ));
    assert_eq!(f.identity.storage().load(&id).unwrap(), before);
    f.water.delete_entry(entry.id).unwrap();
    assert!(f.water.get_by_id(entry.id).unwrap().is_none());
    f.water.delete_entry(Uuid::nil()).unwrap();
}

#[test]
fn configured_timezone_queries_recent_order_and_core_aggregates_are_reused() {
    let f = Fixture::new();
    let (_, id) = f.ids();
    f.identity
        .storage()
        .save(
            &id,
            include_bytes!("fixtures/hydration-before-core.automerge"),
        )
        .unwrap();
    let bytes = f.identity.storage().load(&id).unwrap();
    let date = day(2026, 7, 25);
    assert_eq!(f.water.list_entries_for_date(date).unwrap().len(), 2);
    assert_eq!(f.water.daily_total_ml(date).unwrap(), 750);
    assert_eq!(f.water.goal_progress(date).unwrap(), 0.75);
    assert_eq!(
        f.water.average_daily_ml(day(2026, 7, 26), 2).unwrap(),
        750.0
    );
    assert_eq!(f.water.streak_days(day(2026, 7, 26)).unwrap(), 0);
    let recent = f.water.recent_entries(2).unwrap();
    assert_eq!(
        recent.iter().map(|e| e.amount_ml).collect::<Vec<_>>(),
        vec![750, 500]
    );
    assert!(f.water.recent_entries(0).unwrap().is_empty());
    assert_eq!(f.identity.storage().load(&id).unwrap(), bytes);
    let mut settings = f.water.get_settings().unwrap();
    settings.daily_goal_ml = 500;
    f.water.save_settings(&settings).unwrap();
    assert_eq!(f.water.streak_days(day(2026, 7, 26)).unwrap(), 2);
}

static PROVIDER_CALLS: AtomicUsize = AtomicUsize::new(0);
fn counted_timezone() -> String {
    PROVIDER_CALLS.fetch_add(1, Ordering::SeqCst);
    chicago()
}
fn never_called() -> String {
    panic!("persisted timezone must not invoke the provider")
}

#[test]
fn legacy_timezone_initialization_is_lazy_writes_once_and_preserves_history_ids_entries() {
    let f = Fixture::new();
    let (_, id) = f.ids();
    let root = f.identity.root_doc_id().unwrap().unwrap();
    let root_bytes = f.identity.storage().load(&root).unwrap();
    let bytes = include_bytes!("fixtures/hydration-legacy-before-core.automerge");
    f.identity.storage().save(&id, bytes).unwrap();
    PROVIDER_CALLS.store(0, Ordering::SeqCst);
    let water =
        HydrationRepository::with_timezone_provider(f.dir.path().to_path_buf(), counted_timezone);
    let entries = water.list_entries().unwrap();
    assert_eq!(PROVIDER_CALLS.load(Ordering::SeqCst), 0);
    assert_eq!(f.identity.storage().load(&id).unwrap().unwrap(), bytes);
    let settings = water.get_settings().unwrap();
    assert_eq!(settings.timezone, "America/Chicago");
    assert_eq!(settings.daily_goal_ml, 1000);
    assert_eq!(settings.quick_add_presets_ml, vec![250, 500]);
    assert_eq!(PROVIDER_CALLS.load(Ordering::SeqCst), 1);
    let initialized = f.identity.storage().load(&id).unwrap().unwrap();
    water.get_settings().unwrap();
    assert_eq!(PROVIDER_CALLS.load(Ordering::SeqCst), 1);
    assert_eq!(
        f.identity.storage().load(&id).unwrap().unwrap(),
        initialized
    );
    assert_eq!(water.list_entries().unwrap(), entries);
    assert_eq!(f.identity.hydration_doc_id().unwrap(), id);
    assert_eq!(f.identity.storage().load(&root).unwrap(), root_bytes);
    let mut old = AutoCommit::load(bytes).unwrap();
    let mut changed = AutoCommit::load(&initialized).unwrap();
    let history: Vec<_> = changed.get_changes(&[]).iter().map(|c| c.hash()).collect();
    assert!(old
        .get_changes(&[])
        .iter()
        .all(|c| history.contains(&c.hash())));
    HydrationRepository::with_timezone_provider(f.dir.path().to_path_buf(), never_called)
        .get_settings()
        .unwrap();
}

#[test]
fn portable_repository_defaults_to_utc_without_discovering_platform_state() {
    let dir = TempDir::new().unwrap();
    let identity = Identity::new(MultiDocStorage::new(dir.path().to_path_buf()));
    identity.initialize_new().unwrap();
    let repo = HydrationRepository::new(dir.path().to_path_buf());
    assert_eq!(repo.get_settings().unwrap().timezone, "UTC");
}

#[test]
fn settings_updates_preserve_numeric_unit_rounding_and_preset_normalization_order() {
    let mut settings = HydrationSettings::new(1000, HydrationUnit::Oz);
    settings.timezone = "UTC".into();
    let original = settings.clone();
    HydrationSettingsUpdate::default().apply_to(&mut settings);
    assert_eq!(settings, original);
    HydrationSettingsUpdate {
        goal: Some(16.0),
        unit: None,
        display_unit: Some(HydrationUnit::Ml),
        timezone: Some("America/Chicago".into()),
        presets: vec![8.0, 16.0, 8.0],
    }
    .apply_to(&mut settings);
    assert_eq!(settings.daily_goal_ml, todu_fit_core::ml_from_oz(16.0));
    assert_eq!(
        settings.quick_add_presets_ml,
        vec![
            todu_fit_core::ml_from_oz(8.0),
            todu_fit_core::ml_from_oz(16.0)
        ]
    );
    assert_eq!(settings.preferred_unit, HydrationUnit::Ml);
    assert_eq!(settings.timezone, "America/Chicago");
    HydrationSettingsUpdate {
        goal: Some(1000.6),
        unit: Some(HydrationUnit::Ml),
        ..Default::default()
    }
    .apply_to(&mut settings);
    assert_eq!(settings.daily_goal_ml, 1001);
    let f = Fixture::new();
    assert_eq!(f.water.save_settings(&settings).unwrap(), settings);
}

#[test]
fn date_range_filter_preserves_inclusive_dst_calendar_boundaries() {
    let entries = [
        "2026-03-08T05:59:00Z",
        "2026-03-08T06:00:00Z",
        "2026-03-09T04:59:00Z",
        "2026-03-09T05:00:00Z",
    ]
    .iter()
    .map(|s| WaterEntry::new(250, at(s)).unwrap())
    .collect::<Vec<_>>();
    let date = day(2026, 3, 8);
    let selected = entries_in_date_range(&entries, date, date, chrono_tz::America::Chicago);
    assert_eq!(selected.len(), 2);
    assert_eq!(selected[0].consumed_at, entries[1].consumed_at);
    assert_eq!(selected[1].consumed_at, entries[2].consumed_at);
}

#[test]
fn valid_pre_extraction_documents_read_without_rewrite_and_edits_preserve_history() {
    let f = Fixture::new();
    let (cart_id, water_id) = f.ids();
    let storage = f.identity.storage();
    let cart_bytes = include_bytes!("fixtures/shopping-before-core.automerge");
    let water_bytes = include_bytes!("fixtures/hydration-before-core.automerge");
    storage.save(&cart_id, cart_bytes).unwrap();
    storage.save(&water_id, water_bytes).unwrap();
    assert_eq!(
        f.cart
            .get_or_create("2026-07-19")
            .unwrap()
            .manual_items
            .len(),
        2
    );
    assert_eq!(f.water.get_settings().unwrap().timezone, "America/Chicago");
    assert_eq!(storage.load(&cart_id).unwrap().unwrap(), cart_bytes);
    assert_eq!(storage.load(&water_id).unwrap().unwrap(), water_bytes);
    for (id, bytes) in [
        (cart_id, cart_bytes.as_slice()),
        (water_id, water_bytes.as_slice()),
    ] {
        let mut old = AutoCommit::load(bytes).unwrap();
        let old_history: Vec<_> = old.get_changes(&[]).iter().map(|c| c.hash()).collect();
        if id == cart_id {
            f.cart
                .add_manual_item("2026-07-19", ManualItem::new("New"))
                .unwrap();
        } else {
            f.water
                .create_entry(&WaterEntry::new(100, at("2026-07-27T05:00:00Z")).unwrap())
                .unwrap();
        }
        let mut updated = AutoCommit::load(&storage.load(&id).unwrap().unwrap()).unwrap();
        let history: Vec<_> = updated.get_changes(&[]).iter().map(|c| c.hash()).collect();
        assert!(old_history.iter().all(|hash| history.contains(hash)));
    }
}

#[test]
fn group_and_personal_boundaries_and_ids_remain_unchanged() {
    let f = Fixture::new();
    let other_id = f.identity.create_group("Work").unwrap();
    let other = f.identity.load_group(&other_id).unwrap();
    let home_id = f.identity.list_groups().unwrap()[0].doc_id;
    let home = f.identity.load_group(&home_id).unwrap();
    let root = f.identity.root_doc_id().unwrap().unwrap();
    let ids = [
        root,
        home_id,
        other_id,
        home.dishes_doc_id,
        home.mealplans_doc_id,
        other.shopping_carts_doc_id,
        f.identity.meallogs_doc_id().unwrap(),
    ];
    let before: Vec<_> = ids
        .iter()
        .map(|id| f.identity.storage().load(id).unwrap())
        .collect();
    let hyd_id = f.identity.hydration_doc_id().unwrap();
    f.cart
        .add_manual_item("2026-07-19", ManualItem::new("Home only"))
        .unwrap();
    f.water
        .create_entry(&WaterEntry::new(250, at("2026-07-25T05:00:00Z")).unwrap())
        .unwrap();
    f.water.get_settings().unwrap();
    fs::write(f.dir.path().join("current_group"), "Work").unwrap();
    assert!(f
        .cart
        .get_or_create("2026-07-19")
        .unwrap()
        .manual_items
        .is_empty());
    assert_eq!(
        ShoppingRepository::with_group(f.dir.path().to_path_buf(), "HOME")
            .get_or_create("2026-07-19")
            .unwrap()
            .manual_items
            .len(),
        1
    );
    assert_eq!(f.water.list_entries().unwrap().len(), 1);
    assert_eq!(f.identity.hydration_doc_id().unwrap(), hyd_id);
    assert_eq!(
        before,
        ids.iter()
            .map(|id| f.identity.storage().load(id).unwrap())
            .collect::<Vec<_>>()
    );
    fs::write(f.dir.path().join("current_group"), "Missing").unwrap();
    assert!(f.cart.get_or_create("2026-07-19").is_err());
    assert_eq!(f.water.list_entries().unwrap().len(), 1);
}

#[test]
fn corruption_and_validation_failures_do_not_overwrite_stored_documents() {
    let f = Fixture::new();
    let (cart_id, water_id) = f.ids();
    let storage = f.identity.storage();
    storage.save(&cart_id, b"corrupt").unwrap();
    storage.save(&water_id, b"corrupt").unwrap();
    assert!(f
        .cart
        .add_manual_item("2026-07-19", ManualItem::new("Not saved"))
        .is_err());
    assert!(f.water.get_settings().is_err());
    assert!(f
        .water
        .create_entry(&WaterEntry::new(250, at("2026-07-25T05:00:00Z")).unwrap())
        .is_err());
    assert_eq!(storage.load(&cart_id).unwrap().unwrap(), b"corrupt");
    assert_eq!(storage.load(&water_id).unwrap().unwrap(), b"corrupt");
    let dir = TempDir::new().unwrap();
    let repo = HydrationRepository::new(dir.path().to_path_buf());
    let invalid = HydrationSettings {
        daily_goal_ml: 0,
        ..Default::default()
    };
    assert!(matches!(
        repo.save_settings(&invalid),
        Err(HydrationError::Validation(_))
    ));
    let mut entry = WaterEntry::new(250, Utc::now()).unwrap();
    entry.amount_ml = 0;
    assert!(matches!(
        repo.create_entry(&entry),
        Err(HydrationError::Validation(_))
    ));
}

#[test]
fn persisted_invalid_timezone_is_not_silently_replaced() {
    let f = Fixture::new();
    let (_, id) = f.ids();
    let mut doc =
        AutoCommit::load(include_bytes!("fixtures/hydration-before-core.automerge")).unwrap();
    let (_, settings) = doc.get(ROOT, "settings").unwrap().unwrap();
    doc.put(&settings, "timezone", "Invalid/Zone").unwrap();
    let bytes = doc.save();
    f.identity.storage().save(&id, &bytes).unwrap();
    let repo =
        HydrationRepository::with_timezone_provider(f.dir.path().to_path_buf(), never_called);
    assert_eq!(repo.get_settings().unwrap().timezone, "Invalid/Zone");
    assert!(matches!(
        repo.daily_total_ml(day(2026, 7, 25)),
        Err(HydrationError::Validation(_))
    ));
    assert_eq!(f.identity.storage().load(&id).unwrap().unwrap(), bytes);
}

#[test]
fn week_start_matches_the_existing_sunday_calendar_rule() {
    for (d, expected) in [(19, 19), (22, 19), (25, 19), (26, 26)] {
        assert_eq!(week_start(day(2026, 7, d)), day(2026, 7, expected));
    }
}
