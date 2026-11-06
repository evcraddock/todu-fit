use ::automerge::{AutoCommit, ReadDoc, ROOT};
use todu_fit_core::automerge::{reader::*, *};
use uuid::Uuid;
const DISH: &str = "AA000000-0000-4000-8000-000000000001";
const PLAN: &str = "AA000000-0000-4000-8000-000000000002";
const LOG: &str = "AA000000-0000-4000-8000-000000000003";
const WATER: &str = "AA000000-0000-4000-8000-000000000004";
fn fixture(name: &str) -> AutoCommit {
    AutoCommit::load(
        &std::fs::read(format!(
            "{}/tests/fixtures/ios-0.7.2-{name}.automerge",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap(),
    )
    .unwrap()
}
fn export(name: &str, doc: &mut AutoCommit) {
    if let Ok(dir) = std::env::var("FIT_IOS_FIXTURE_OUTPUT") {
        std::fs::write(
            std::path::Path::new(&dir).join(format!("{name}.core.automerge")),
            doc.save(),
        )
        .unwrap();
    }
}
#[test]
fn ios_plans_preserve_keys_and_dish_references() {
    let mut doc = fixture("plans");
    let mut plan = read_mealplan_by_id(&doc, Uuid::parse_str(PLAN).unwrap())
        .unwrap()
        .expect("iOS uppercase plan");
    assert!(plan.uses_leftovers);
    assert_eq!(plan.dish_ids[0], Uuid::parse_str(DISH).unwrap());
    plan.title = "Core edited dinner".into();
    write_mealplan(&mut doc, &plan);
    assert_eq!(doc.keys(ROOT).collect::<Vec<_>>(), vec![PLAN]);
    let (_, obj) = doc.get(ROOT, PLAN).unwrap().unwrap();
    assert_eq!(
        read_string_list(&doc, &obj, "dish_ids").unwrap(),
        vec![DISH]
    );
    export("plans", &mut doc);
    delete_mealplan(&mut doc, plan.id);
    assert!(read_all_mealplans(&doc).unwrap().is_empty());
}
#[test]
fn ios_log_preserves_snapshot_metadata_portions_and_references() {
    let mut doc = fixture("logs");
    let mut log = read_meallog_by_id(&doc, Uuid::parse_str(LOG).unwrap())
        .unwrap()
        .expect("iOS uppercase log");
    assert_eq!(log.portion_for(log.dishes[0].id), 0.5);
    assert_eq!(
        log.dishes[0].source_url.as_deref(),
        Some("https://example.com/recipe")
    );
    assert_eq!(
        log.dishes[0].image_url.as_deref(),
        Some("https://example.com/image.png")
    );
    assert_eq!(log.dishes[0].created_at.timestamp(), 1793966400);
    log.notes = Some("Core edited log".into());
    write_meallog(&mut doc, &log);
    assert_eq!(doc.keys(ROOT).collect::<Vec<_>>(), vec![LOG]);
    let (_, obj) = doc.get(ROOT, LOG).unwrap().unwrap();
    assert_eq!(
        get_string(&doc, &obj, "mealplan_id").unwrap().as_deref(),
        Some(PLAN)
    );
    let (_, portions) = doc.get(&obj, "dish_portions").unwrap().unwrap();
    assert_eq!(doc.keys(&portions).collect::<Vec<_>>(), vec![DISH]);
    export("logs", &mut doc);
    delete_meallog(&mut doc, log.id);
    assert!(read_all_meallogs(&doc).unwrap().is_empty());
}
#[test]
fn ios_water_updates_and_deletes_without_duplicate_keys() {
    let mut doc = fixture("water");
    let mut entry = read_water_entry_by_id(&doc, Uuid::parse_str(WATER).unwrap())
        .unwrap()
        .expect("iOS uppercase water entry");
    entry.amount_ml = 500;
    write_water_entry(&mut doc, &entry);
    assert_eq!(read_all_water_entries(&doc).unwrap().len(), 1);
    assert_eq!(
        read_hydration_settings(&doc)
            .unwrap()
            .unwrap()
            .daily_goal_ml,
        2000
    );
    let mut settings = read_hydration_settings(&doc).unwrap().unwrap();
    settings.timezone = "America/Chicago".into();
    write_hydration_settings(&mut doc, &settings);
    export("water", &mut doc);
    delete_water_entry(&mut doc, entry.id);
    assert!(read_all_water_entries(&doc).unwrap().is_empty());
}
#[test]
fn ios_shopping_preserves_checks_and_manual_items() {
    let mut doc = fixture("shopping");
    let mut cart = read_shopping_cart_by_week(&doc, "2026-11-01")
        .unwrap()
        .unwrap();
    assert!(cart.checked.contains(&"lentils".to_string()));
    cart.manual_items[0].quantity = Some("2".into());
    write_shopping_cart(&mut doc, &cart);
    export("shopping", &mut doc);
    let after = read_shopping_cart_by_week(&doc, "2026-11-01")
        .unwrap()
        .unwrap();
    assert_eq!(after.manual_items, cart.manual_items);
    assert_eq!(after.checked, cart.checked);
}

#[test]
fn new_core_records_reference_original_ios_keys() {
    use todu_fit_core::{
        DishRepository, Identity, MealLog, MealLogRepository, MealPlan, MealPlanRepository,
        MealType, MultiDocStorage,
    };
    let dir = tempfile::tempdir().unwrap();
    let storage = MultiDocStorage::new(dir.path().to_path_buf());
    let identity = Identity::new(storage.clone());
    identity.initialize_new().unwrap();
    let group_id = identity.create_group("Fixture").unwrap();
    let group = identity.load_group(&group_id).unwrap();
    storage
        .save(&group.dishes_doc_id, &fixture("dishes").save())
        .unwrap();
    storage
        .save(&group.mealplans_doc_id, &fixture("plans").save())
        .unwrap();
    let dish = DishRepository::new(dir.path().to_path_buf())
        .get_by_id(Uuid::parse_str(DISH).unwrap())
        .unwrap()
        .unwrap();
    let date = chrono::NaiveDate::from_ymd_opt(2026, 11, 6).unwrap();
    let mut plan = MealPlan::new(date, MealType::Dinner, "New plan", "core");
    plan.dish_ids = vec![dish.id];
    MealPlanRepository::new(dir.path().to_path_buf())
        .create(&plan)
        .unwrap();
    let doc = AutoCommit::load(&storage.load(&group.mealplans_doc_id).unwrap().unwrap()).unwrap();
    let (_, obj) = doc.get(ROOT, plan.id.to_string()).unwrap().unwrap();
    assert_eq!(
        read_string_list(&doc, &obj, "dish_ids").unwrap(),
        vec![DISH]
    );
    let log = MealLog::new(date, MealType::Dinner, "core")
        .with_mealplan_id(Uuid::parse_str(PLAN).unwrap())
        .with_dishes(vec![dish.clone()])
        .with_dish_portion(dish.id, 0.5);
    MealLogRepository::new(dir.path().to_path_buf())
        .create(&log)
        .unwrap();
    let doc = AutoCommit::load(
        &storage
            .load(&identity.meallogs_doc_id().unwrap())
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    let (_, obj) = doc.get(ROOT, log.id.to_string()).unwrap().unwrap();
    assert_eq!(
        get_string(&doc, &obj, "mealplan_id").unwrap().as_deref(),
        Some(PLAN)
    );
    let (_, portions) = doc.get(&obj, "dish_portions").unwrap().unwrap();
    assert_eq!(doc.keys(&portions).collect::<Vec<_>>(), vec![DISH]);
}

#[test]
fn core_reads_ios_reedits_after_core_roundtrip() {
    let plans = fixture("plans-return");
    let plan = read_mealplan_by_id(&plans, Uuid::parse_str(PLAN).unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(plan.title, "iOS re-edited dinner");
    assert_eq!(plan.dish_ids, vec![Uuid::parse_str(DISH).unwrap()]);
    let logs = fixture("logs-return");
    let log = read_meallog_by_id(&logs, Uuid::parse_str(LOG).unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(log.notes.as_deref(), Some("iOS re-edited log"));
    assert_eq!(log.mealplan_id, Some(Uuid::parse_str(PLAN).unwrap()));
    assert_eq!(log.portion_for(log.dishes[0].id), 0.5);
    assert_eq!(
        log.dishes[0].source_url.as_deref(),
        Some("https://example.com/recipe")
    );
    assert_eq!(log.dishes[0].created_at.timestamp(), 1793966400);
    let water = fixture("water-return");
    assert_eq!(
        read_water_entry_by_id(&water, Uuid::parse_str(WATER).unwrap())
            .unwrap()
            .unwrap()
            .amount_ml,
        750
    );
    assert_eq!(
        read_hydration_settings(&water).unwrap().unwrap().timezone,
        "America/Chicago"
    );
}
