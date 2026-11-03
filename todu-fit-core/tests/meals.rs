use std::fs;

use automerge::{transaction::Transactable, AutoCommit, ReadDoc, ROOT};
use chrono::NaiveDate;
use tempfile::TempDir;
use todu_fit_core::{
    automerge::reader::{read_all_meallogs, read_all_mealplans, ReaderError},
    context::GroupContextError,
    meal_logs::{calculate_meal_nutrients, hydrate_referenced_dishes},
    Dish, DishError, DishRepository, Identity, Ingredient, MealLog, MealLogDraft, MealLogError,
    MealLogRepository, MealPlan, MealPlanDraft, MealPlanError, MealPlanRepository, MealPlanUpdate,
    MealType, MultiDocStorage, Nutrient,
};
use uuid::Uuid;

fn day(n: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 11, n).unwrap()
}

struct Fixture {
    dir: TempDir,
    identity: Identity,
    plans: MealPlanRepository,
    logs: MealLogRepository,
    dishes: DishRepository,
    dish: Dish,
}
impl Fixture {
    fn new() -> Self {
        let dir = TempDir::new().unwrap();
        let identity = Identity::new(MultiDocStorage::new(dir.path().to_path_buf()));
        identity.initialize_new().unwrap();
        identity.create_group("Home").unwrap();
        let dishes = DishRepository::new(dir.path().to_path_buf());
        let plans = MealPlanRepository::new(dir.path().to_path_buf());
        let logs = MealLogRepository::new(dir.path().to_path_buf());
        let fixture_plans =
            AutoCommit::load(include_bytes!("fixtures/mealplans-before-core.automerge")).unwrap();
        let mut dish = Dish::new("Pasta", "chef")
            .with_ingredients(vec![Ingredient::new("Pasta", 2.5, "cups")])
            .with_nutrients(vec![Nutrient::new("calories", 600.0, "kcal")]);
        dish.id = read_all_mealplans(&fixture_plans).unwrap()[0].dish_ids[0];
        dishes.create(&dish).unwrap();
        Self {
            dir,
            identity,
            plans,
            logs,
            dishes,
            dish,
        }
    }
    fn draft(&self) -> MealPlanDraft {
        MealPlanDraft {
            date: day(1),
            meal_type: MealType::Dinner,
            title: None,
            cook: None,
            dish_references: vec![self.dish.name.clone(), self.dish.id.to_string()],
            uses_leftovers: true,
            created_by: "chef".into(),
        }
    }
    fn ids(&self) -> (todu_fit_core::DocumentId, todu_fit_core::DocumentId) {
        let group = self.identity.list_groups().unwrap()[0].doc_id;
        (
            self.identity.load_group(&group).unwrap().mealplans_doc_id,
            self.identity.meallogs_doc_id().unwrap(),
        )
    }
}

#[test]
fn plan_crud_and_inclusive_date_type_queries_use_the_production_repository() {
    let f = Fixture::new();
    for (n, t) in [
        (1, MealType::Breakfast),
        (1, MealType::Dinner),
        (3, MealType::Lunch),
    ] {
        f.plans
            .create(&MealPlan::new(day(n), t, "Plan", "chef"))
            .unwrap();
    }
    assert_eq!(f.plans.list().unwrap().len(), 3);
    assert_eq!(f.plans.get_by_date(day(1)).unwrap().len(), 2);
    assert_eq!(f.plans.list_range(day(1), day(3)).unwrap().len(), 3);
    assert!(f.plans.list_range(day(3), day(1)).unwrap().is_empty());
    let mut plan = f
        .plans
        .get_by_date_and_type(day(1), MealType::Dinner)
        .unwrap()
        .unwrap();
    assert_eq!(
        f.plans
            .list_range_filtered(day(1), day(3), Some(MealType::Dinner))
            .unwrap()
            .len(),
        1
    );
    plan.title = "Changed".into();
    assert_eq!(f.plans.update(&plan).unwrap().title, "Changed");
    f.plans.delete(plan.id).unwrap();
    assert!(f.plans.get_by_id(plan.id).unwrap().is_none());
    f.plans.delete(plan.id).unwrap();
    // Existing update remains an upsert; do not add validation during extraction.
    f.plans.update(&plan).unwrap();
    assert!(f.plans.get_by_id(plan.id).unwrap().is_some());
}

#[test]
fn plan_dish_membership_preserves_duplicate_missing_and_timestamp_semantics() {
    let f = Fixture::new();
    let plan = MealPlan::new(day(1), MealType::Dinner, "Plan", "chef");
    f.plans.create(&plan).unwrap();
    f.plans.add_dish(plan.id, f.dish.id).unwrap();
    assert_eq!(
        f.plans.get_by_id(plan.id).unwrap().unwrap().updated_at,
        plan.updated_at
    );
    assert!(matches!(
        f.plans.add_dish(plan.id, f.dish.id),
        Err(MealPlanError::DishAlreadyInPlan(_))
    ));
    f.plans.remove_dish(plan.id, f.dish.id).unwrap();
    assert!(matches!(
        f.plans.remove_dish(plan.id, f.dish.id),
        Err(MealPlanError::DishNotInPlan(_))
    ));
    assert!(matches!(
        f.plans.add_dish(Uuid::nil(), f.dish.id),
        Err(MealPlanError::NotFound(_))
    ));
    assert!(matches!(
        f.plans.remove_dish(Uuid::nil(), f.dish.id),
        Err(MealPlanError::NotFound(_))
    ));
}

#[test]
fn plan_creation_defaults_and_reference_order_are_shared_without_deduplication() {
    let f = Fixture::new();
    let mut draft = f.draft();
    let plan = f.plans.create_with_dishes(&draft, &f.dishes).unwrap();
    assert_eq!(plan.title, "Dinner on 2026-11-01");
    assert_eq!(plan.cook, "chef");
    assert!(plan.uses_leftovers);
    assert_eq!(plan.dish_ids, vec![f.dish.id, f.dish.id]);
    draft.title = Some("".into());
    draft.cook = Some("Guest".into());
    draft.dish_references.clear();
    assert_eq!(
        f.plans.create_with_dishes(&draft, &f.dishes).unwrap().title,
        ""
    );
    let before = f.identity.storage().load(&f.ids().0).unwrap();
    draft.dish_references = vec!["Missing".into()];
    assert_eq!(
        f.plans
            .create_with_dishes(&draft, &f.dishes)
            .unwrap_err()
            .to_string(),
        "Dish not found: Missing"
    );
    assert_eq!(f.identity.storage().load(&f.ids().0).unwrap(), before);
}

#[test]
fn plan_field_updates_preserve_ids_and_creation_update_timestamps() {
    let f = Fixture::new();
    let mut plan = f.plans.create_with_dishes(&f.draft(), &f.dishes).unwrap();
    let original = serde_json::to_value(&plan).unwrap();
    MealPlanUpdate::default().apply_to(&mut plan);
    assert_eq!(serde_json::to_value(&plan).unwrap(), original);
    MealPlanUpdate {
        date: Some(day(2)),
        meal_type: Some(MealType::Lunch),
        title: Some("Lunch".into()),
        cook: Some("Guest".into()),
        uses_leftovers: Some(false),
    }
    .apply_to(&mut plan);
    let changed = f.plans.update(&plan).unwrap();
    assert_eq!(changed.date, day(2));
    assert_eq!(changed.meal_type, MealType::Lunch);
    assert_eq!(changed.title, "Lunch");
    assert_eq!(changed.cook, "Guest");
    assert!(!changed.uses_leftovers);
    let changed = serde_json::to_value(&changed).unwrap();
    for field in ["id", "created_at", "updated_at", "created_by", "dish_ids"] {
        assert_eq!(changed[field], original[field]);
    }
}

#[test]
fn log_crud_date_queries_and_portions_retain_existing_writer_behavior() {
    let f = Fixture::new();
    let mut log = MealLog::new(day(1), MealType::Dinner, "chef")
        .with_notes("Original")
        .with_dishes(vec![f.dish.clone()])
        .with_dish_portion(f.dish.id, 0.5);
    let created = f.logs.create(&log).unwrap();
    assert_eq!(created.dishes[0].id, f.dish.id);
    assert_eq!(created.portion_for(f.dish.id), 0.5);
    // The existing writer omits snapshot nutrients. That separate known fix is out of scope.
    assert!(created.dishes[0].nutrients.is_none());
    f.logs
        .create(&MealLog::new(day(3), MealType::Lunch, "chef"))
        .unwrap();
    assert_eq!(f.logs.list_range(day(1), day(3)).unwrap().len(), 2);
    assert_eq!(f.logs.list_range(day(1), day(1)).unwrap().len(), 1);
    log.notes = Some("Updated".into());
    assert_eq!(
        f.logs.update(&log).unwrap().notes.as_deref(),
        Some("Updated")
    );
    f.logs.delete(log.id).unwrap();
    assert!(f.logs.get_by_id(log.id).unwrap().is_none());
    f.logs.delete(log.id).unwrap();
    f.logs.update(&log).unwrap();
    assert!(f.logs.get_by_id(log.id).unwrap().is_some());
}

#[test]
fn planned_logging_skips_missing_dishes_and_preserves_snapshot_names() {
    let f = Fixture::new();
    let plan = MealPlan::new(day(1), MealType::Dinner, "Plan", "chef")
        .with_dish_ids(vec![Uuid::nil(), f.dish.id]);
    let log = f
        .logs
        .log_from_plan(&plan, &f.dishes, "logger", Some("Note"))
        .unwrap();
    assert_eq!(log.mealplan_id, Some(plan.id));
    assert_eq!(log.created_by, "logger");
    assert_eq!(log.notes.as_deref(), Some("Note"));
    assert_eq!(log.dishes.len(), 1);
    let mut changed = f.dish.clone();
    changed.name = "Current name".into();
    f.dishes.update(&changed).unwrap();
    let mut logs = f.logs.list().unwrap();
    hydrate_referenced_dishes(&mut logs, &f.dishes).unwrap();
    assert_eq!(logs[0].dishes[0].name, "Pasta");
}

#[test]
fn unplanned_logging_resolves_names_and_uuids_and_propagates_original_errors() {
    let f = Fixture::new();
    let mut draft = MealLogDraft {
        date: day(2),
        meal_type: MealType::Lunch,
        dish_references: vec!["PASTA".into(), f.dish.id.to_string()],
        created_by: "logger".into(),
        notes: None,
    };
    let log = f.logs.log_unplanned(&draft, &f.dishes).unwrap();
    assert_eq!(
        log.dishes.iter().map(|d| d.id).collect::<Vec<_>>(),
        vec![f.dish.id, f.dish.id]
    );
    assert!(log.mealplan_id.is_none());
    draft.dish_references = vec!["Missing".into()];
    assert_eq!(
        f.logs
            .log_unplanned(&draft, &f.dishes)
            .unwrap_err()
            .to_string(),
        "Dish not found: Missing"
    );
    assert_eq!(f.logs.list().unwrap().len(), 1);
    fs::write(f.dir.path().join("current_group"), "Missing").unwrap();
    draft.dish_references = vec!["Pasta".into()];
    assert!(f
        .logs
        .log_unplanned(&draft, &f.dishes)
        .unwrap_err()
        .downcast_ref::<DishError>()
        .is_some());
}

#[test]
fn mixed_web_references_snapshots_and_portions_keep_history_semantics() {
    let f = Fixture::new();
    let (plan_id, log_id) = f.ids();
    let storage = f.identity.storage();
    let bytes = include_bytes!("fixtures/meallogs-mixed-before-core.automerge");
    storage.save(&log_id, bytes).unwrap();
    let mut logs = f.logs.list().unwrap();
    assert_eq!(logs.len(), 4);
    hydrate_referenced_dishes(&mut logs, &f.dishes).unwrap();
    let reference = logs
        .iter()
        .find(|l| l.id.to_string().ends_with("0040"))
        .unwrap();
    assert_eq!(reference.dishes[0].name, "Pasta");
    assert_eq!(
        calculate_meal_nutrients(reference).get("calories"),
        Some(&300.0)
    );
    let snapshot = logs
        .iter()
        .find(|l| l.id.to_string().ends_with("0041"))
        .unwrap();
    assert_eq!(snapshot.dishes[0].name, "Snapshot Pasta");
    assert_eq!(
        calculate_meal_nutrients(snapshot).get("calories"),
        Some(&1200.0)
    );
    assert_eq!(storage.load(&log_id).unwrap().unwrap(), bytes);
    assert_eq!(
        f.identity
            .load_group(&f.identity.list_groups().unwrap()[0].doc_id)
            .unwrap()
            .mealplans_doc_id,
        plan_id
    );
}

#[test]
fn prior_cli_documents_load_without_rewrite_and_retain_change_history_on_edit() {
    let f = Fixture::new();
    let (plan_id, log_id) = f.ids();
    let storage = f.identity.storage();
    let plan_bytes = include_bytes!("fixtures/mealplans-before-core.automerge");
    let log_bytes = include_bytes!("fixtures/meallogs-before-core.automerge");
    storage.save(&plan_id, plan_bytes).unwrap();
    storage.save(&log_id, log_bytes).unwrap();
    let mut plans = f.plans.list().unwrap();
    let mut logs = f.logs.list().unwrap();
    assert_eq!(plans.len(), 1);
    assert_eq!(logs.len(), 2);
    assert_eq!(storage.load(&plan_id).unwrap().unwrap(), plan_bytes);
    assert_eq!(storage.load(&log_id).unwrap().unwrap(), log_bytes);
    for (doc_id, bytes) in [
        (plan_id, plan_bytes.as_slice()),
        (log_id, log_bytes.as_slice()),
    ] {
        let mut old = AutoCommit::load(bytes).unwrap();
        let history: Vec<_> = old.get_changes(&[]).iter().map(|c| c.hash()).collect();
        if doc_id == plan_id {
            plans[0].title = "Edited".into();
            f.plans.update(&plans[0]).unwrap();
        } else {
            logs[0].notes = Some("Edited".into());
            f.logs.update(&logs[0]).unwrap();
        }
        let mut updated = AutoCommit::load(&storage.load(&doc_id).unwrap().unwrap()).unwrap();
        let changes: Vec<_> = updated.get_changes(&[]).iter().map(|c| c.hash()).collect();
        assert!(history.iter().all(|hash| changes.contains(hash)));
    }
}

#[test]
fn writes_preserve_selected_group_and_personal_document_boundaries() {
    let f = Fixture::new();
    let other_id = f.identity.create_group("Other").unwrap();
    let other = f.identity.load_group(&other_id).unwrap();
    let root = f.identity.root_doc_id().unwrap().unwrap();
    let home_id = f.identity.list_groups().unwrap()[0].doc_id;
    let home = f.identity.load_group(&home_id).unwrap();
    let protected = [
        root,
        home_id,
        other_id,
        home.dishes_doc_id,
        home.shopping_carts_doc_id,
        other.mealplans_doc_id,
        other.dishes_doc_id,
        f.identity.hydration_doc_id().unwrap(),
    ];
    let before: Vec<_> = protected
        .iter()
        .map(|id| f.identity.storage().load(id).unwrap())
        .collect();
    let plan = f.plans.create_with_dishes(&f.draft(), &f.dishes).unwrap();
    f.logs
        .log_from_plan(&plan, &f.dishes, "chef", None)
        .unwrap();
    let log_count = f.logs.list().unwrap().len();
    fs::write(f.dir.path().join("current_group"), "Other").unwrap();
    assert!(f.plans.list().unwrap().is_empty());
    assert_eq!(f.logs.list().unwrap().len(), log_count);
    let override_repo = MealPlanRepository::with_group(f.dir.path().to_path_buf(), "HOME");
    assert_eq!(
        override_repo.get_by_id(plan.id).unwrap().unwrap().id,
        plan.id
    );
    assert_eq!(
        before,
        protected
            .iter()
            .map(|id| f.identity.storage().load(id).unwrap())
            .collect::<Vec<_>>()
    );
}

#[test]
fn missing_documents_are_not_created_on_read_and_corruption_is_not_overwritten() {
    let f = Fixture::new();
    let (plan_id, log_id) = f.ids();
    let storage = f.identity.storage();
    storage.delete(&plan_id).unwrap();
    storage.delete(&log_id).unwrap();
    assert!(f.plans.list().unwrap().is_empty());
    assert!(f.logs.list().unwrap().is_empty());
    assert!(!storage.exists(&plan_id));
    assert!(!storage.exists(&log_id));
    storage.save(&plan_id, b"corrupt").unwrap();
    storage.save(&log_id, b"corrupt").unwrap();
    assert!(matches!(
        f.plans
            .create(&MealPlan::new(day(1), MealType::Dinner, "Plan", "chef")),
        Err(MealPlanError::Reader(ReaderError::AutomergeError(_)))
    ));
    assert!(matches!(
        f.logs
            .create(&MealLog::new(day(1), MealType::Dinner, "chef")),
        Err(MealLogError::Reader(ReaderError::AutomergeError(_)))
    ));
    assert_eq!(storage.load(&plan_id).unwrap().unwrap(), b"corrupt");
    assert_eq!(storage.load(&log_id).unwrap().unwrap(), b"corrupt");
}

#[test]
fn private_logs_need_an_identity_but_not_a_selected_group() {
    let dir = TempDir::new().unwrap();
    let plans = MealPlanRepository::new(dir.path().to_path_buf());
    let logs = MealLogRepository::new(dir.path().to_path_buf());
    assert_eq!(
        plans.list().unwrap_err().to_string(),
        "Identity not initialized. Run 'fit init --new' first."
    );
    assert_eq!(
        logs.list().unwrap_err().to_string(),
        "Identity not initialized. Run 'fit init --new' first."
    );
    let identity = Identity::new(MultiDocStorage::new(dir.path().to_path_buf()));
    identity
        .initialize_join(todu_fit_core::DocumentId::new())
        .unwrap();
    assert_eq!(
        logs.list().unwrap_err().to_string(),
        "Identity pending sync. Run 'fit sync' first."
    );
    fs::remove_file(dir.path().join("root_doc_id")).unwrap();
    identity.initialize_new().unwrap();
    assert!(matches!(
        plans.list(),
        Err(MealPlanError::GroupContext(GroupContextError::NoGroups))
    ));
    logs.create(&MealLog::new(day(1), MealType::Dinner, "chef"))
        .unwrap();
    assert_eq!(logs.list().unwrap().len(), 1);
}

#[test]
fn malformed_log_and_plan_records_keep_reader_errors() {
    let mut doc = AutoCommit::new();
    let id = Uuid::new_v4();
    doc.put(ROOT, id.to_string(), "not a map").unwrap();
    assert!(matches!(
        read_all_meallogs(&doc),
        Err(ReaderError::MalformedData(_))
    ));
    let plan = MealPlan::new(day(1), MealType::Dinner, "Plan", "chef");
    let mut doc = AutoCommit::new();
    todu_fit_core::write_mealplan(&mut doc, &plan);
    let (_, object) = doc.get(ROOT, plan.id.to_string()).unwrap().unwrap();
    doc.put(&object, "date", "invalid").unwrap();
    assert!(matches!(
        read_all_mealplans(&doc),
        Err(ReaderError::ParseError(_))
    ));
}
