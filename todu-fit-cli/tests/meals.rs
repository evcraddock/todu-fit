use chrono::NaiveDate;
use std::{
    io::Write,
    process::{Command, Output, Stdio},
};
use tempfile::TempDir;
use todu_fit_core::{
    automerge::reader::read_all_mealplans, Dish, DishRepository, Identity, MealLog,
    MealLogRepository, MealPlan, MealPlanRepository, MealType, MultiDocStorage, Nutrient,
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
    plan: MealPlan,
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
        let old = automerge::AutoCommit::load(include_bytes!(
            "../../todu-fit-core/tests/fixtures/mealplans-before-core.automerge"
        ))
        .unwrap();
        let mut dish = Dish::new("Pasta", "chef")
            .with_nutrients(vec![Nutrient::new("calories", 600.0, "kcal")]);
        dish.id = read_all_mealplans(&old).unwrap()[0].dish_ids[0];
        dishes.create(&dish).unwrap();
        let mut plan = MealPlan::new(day(1), MealType::Dinner, "Dinner Plan", "chef")
            .with_dish_ids(vec![dish.id]);
        plan.id = Uuid::parse_str("00000000-0000-4000-8000-000000000010").unwrap();
        plans.create(&plan).unwrap();
        std::fs::write(
            dir.path().join("config.yaml"),
            "created_by: cli-fixture\nsync:\n  auto_sync: false\n",
        )
        .unwrap();
        Self {
            dir,
            identity,
            plans,
            logs,
            plan,
            dish,
        }
    }
    fn run(&self, args: &[&str], input: &str) -> Output {
        let mut child = Command::new(env!("CARGO_BIN_EXE_fit"))
            .arg("-c")
            .arg(self.dir.path().join("config.yaml"))
            .args(args)
            .env("FIT_DATA_DIR", self.dir.path())
            .env_remove("FIT_SYNC_URL")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
        child.wait_with_output().unwrap()
    }
    fn success(&self, args: &[&str]) -> String {
        let out = self.run(args, "");
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(out.stderr.is_empty());
        String::from_utf8(out.stdout).unwrap()
    }
}

#[test]
fn plan_queries_and_creation_preserve_flags_defaults_and_output() {
    let f = Fixture::new();
    let shown: MealPlan = serde_json::from_str(&f.success(&[
        "mealplan",
        "show",
        "2026-11-01",
        "--type",
        "dinner",
        "-f",
        "json",
    ]))
    .unwrap();
    assert_eq!(shown.id, f.plan.id);
    assert_eq!(
        f.success(&[
            "mealplan",
            "list",
            "--from",
            "2026-11-01",
            "--to",
            "2026-11-01",
            "--type",
            "lunch"
        ]),
        "No meal plans found\n"
    );
    let output = f.success(&[
        "mealplan",
        "create",
        "--date",
        "2026-11-02",
        "--type",
        "lunch",
        "--dish",
        "PASTA",
        "--dish",
        &f.dish.id.to_string(),
        "--leftovers",
    ]);
    assert!(output.starts_with("Created meal plan:\nLunch on 2026-11-02\n"));
    let created = f.plans.get_by_date(day(2)).unwrap().pop().unwrap();
    assert_eq!(created.cook, "cli-fixture");
    assert_eq!(created.created_by, "cli-fixture");
    assert_eq!(created.dish_ids, vec![f.dish.id, f.dish.id]);
    assert!(created.uses_leftovers);
}

#[test]
fn plan_updates_membership_and_confirmation_preserve_existing_behavior() {
    let f = Fixture::new();
    let id = f.plan.id.to_string();
    let output = f.success(&[
        "mealplan",
        "update",
        &id,
        "--date",
        "2026-11-02",
        "--type",
        "lunch",
        "--title",
        "Updated",
        "--cook",
        "Guest",
        "--leftovers",
    ]);
    assert!(output.starts_with("Updated meal plan:\nUpdated\n"));
    let changed = f.plans.get_by_id(f.plan.id).unwrap().unwrap();
    assert_eq!(changed.updated_at, f.plan.updated_at);
    assert_eq!(changed.created_at, f.plan.created_at);
    assert_eq!(changed.cook, "Guest");
    assert!(changed.uses_leftovers);
    assert_eq!(
        f.success(&["mealplan", "remove-dish", &id, "PASTA"]),
        "Removed 'Pasta' from 'Updated'\n"
    );
    assert_eq!(
        f.success(&["mealplan", "add-dish", &id, "PASTA"]),
        "Added 'Pasta' to 'Updated'\n"
    );
    let cancel = f.run(&["mealplan", "delete", &id], "n\n");
    assert!(cancel.status.success());
    assert_eq!(
        String::from_utf8(cancel.stdout).unwrap(),
        "Delete meal plan 'Updated' (lunch 2026-11-02)? [y/N] Deletion cancelled.\n"
    );
    assert!(f.plans.get_by_id(f.plan.id).unwrap().is_some());
    assert_eq!(
        f.success(&["mealplan", "delete", &id, "--force"]),
        "Deleted meal plan: Updated\n"
    );
    assert!(f.plans.get_by_id(f.plan.id).unwrap().is_none());
}

#[test]
fn planned_and_unplanned_logging_keep_metadata_snapshots_and_history_formats() {
    let f = Fixture::new();
    let output = f.success(&["meal", "log", &f.plan.id.to_string(), "--notes", "Planned"]);
    assert!(output.starts_with("Logged meal from plan 'Dinner Plan':\n"));
    let output = f.success(&[
        "meal",
        "log",
        "--date",
        "2026-11-02",
        "--type",
        "snack",
        "--dish",
        "PASTA",
        "--notes",
        "Unplanned",
    ]);
    assert!(output.starts_with("Logged unplanned meal:\n"));
    let logs: Vec<MealLog> = serde_json::from_str(&f.success(&[
        "meal",
        "history",
        "--from",
        "2026-11-01",
        "--to",
        "2026-11-02",
        "-f",
        "json",
    ]))
    .unwrap();
    assert_eq!(logs.len(), 2);
    for log in &logs {
        assert_eq!(log.created_by, "cli-fixture");
        assert_eq!(log.dishes[0].id, f.dish.id);
        assert_eq!(log.dishes[0].name, "Pasta");
        assert_eq!(log.dishes[0].nutrients, f.dish.nutrients);
    }
    assert!(logs
        .iter()
        .any(|l| l.mealplan_id == Some(f.plan.id) && l.notes.as_deref() == Some("Planned")));
    assert!(logs
        .iter()
        .any(|l| l.mealplan_id.is_none() && l.notes.as_deref() == Some("Unplanned")));
    assert_eq!(
        f.success(&[
            "meal",
            "history",
            "--from",
            "2027-01-01",
            "--to",
            "2027-01-02"
        ]),
        "No meal history found for 2027-01-01 to 2027-01-02\n"
    );
}

#[test]
fn logging_by_name_and_id_preserves_every_dish_nutrient_in_history() {
    let f = Fixture::new();
    for (name, nutrients) in [
        (
            "Nutrient meal",
            r#"{"calories":250,"protein":12.5,"carbs":30,"fat":8}"#,
        ),
        (
            "Side dish",
            r#"{"calories":100,"protein":2.5,"carbs":10,"fat":4}"#,
        ),
    ] {
        f.success(&["dish", "create", name, "--nutrients", nutrients]);
    }
    let canonical: Vec<Dish> =
        serde_json::from_str(&f.success(&["dish", "list", "--format", "json"])).unwrap();
    let dishes: Vec<_> = canonical.iter().filter(|d| d.name != "Pasta").collect();
    assert_eq!(dishes.len(), 2);
    for by_id in [false, true] {
        let references: Vec<_> = dishes
            .iter()
            .map(|dish| {
                if by_id {
                    dish.id.to_string()
                } else {
                    dish.name.clone()
                }
            })
            .collect();
        f.success(&[
            "meal",
            "log",
            "--date",
            "2026-11-02",
            "--type",
            "lunch",
            "--dish",
            &references[0],
            "--dish",
            &references[1],
        ]);
    }
    let logs: Vec<MealLog> = serde_json::from_str(&f.success(&[
        "meal",
        "history",
        "--from",
        "2026-11-02",
        "--to",
        "2026-11-02",
        "--format",
        "json",
    ]))
    .unwrap();
    assert_eq!(logs.len(), 2);
    for log in logs {
        assert_eq!(log.dishes.len(), 2);
        for (snapshot, canonical) in log.dishes.iter().zip(&dishes) {
            assert_eq!(snapshot.id, canonical.id);
            assert!(canonical.nutrients.is_some());
            assert_eq!(snapshot.nutrients, canonical.nutrients);
        }
    }
    let text = f.success(&[
        "meal",
        "history",
        "--from",
        "2026-11-02",
        "--to",
        "2026-11-02",
    ]);
    assert!(text.contains("Calories: 350 | Protein: 15g | Carbs: 40g | Fat: 12g"));
    assert!(text.contains("Daily Total: Calories: 700 | Protein: 30g | Carbs: 80g | Fat: 24g"));
}

#[test]
fn referenced_dish_history_and_portioned_nutrition_use_the_shared_core() {
    let f = Fixture::new();
    let id = f.identity.meallogs_doc_id().unwrap();
    f.identity
        .storage()
        .save(
            &id,
            include_bytes!(
                "../../todu-fit-core/tests/fixtures/meallogs-mixed-before-core.automerge"
            ),
        )
        .unwrap();
    let history = f.success(&[
        "meal",
        "history",
        "--from",
        "2026-11-03",
        "--to",
        "2026-11-03",
    ]);
    assert!(history.contains("Calories: 300"));
    assert!(history.contains("Calories: 1200"));
    assert!(history.contains("Daily Total: Calories: 1500"));
    let logs: Vec<MealLog> = serde_json::from_str(&f.success(&[
        "meal",
        "history",
        "--from",
        "2026-11-03",
        "--to",
        "2026-11-03",
        "-f",
        "json",
    ]))
    .unwrap();
    assert_eq!(logs.len(), 2);
    assert!(logs.iter().any(|l| l.dishes[0].name == "Pasta"));
    assert!(logs.iter().any(|l| l.dishes[0].name == "Snapshot Pasta"));
}

#[test]
fn log_deletion_confirmation_and_private_group_independence_remain_in_the_cli() {
    let f = Fixture::new();
    let log = f
        .logs
        .create(&MealLog::new(day(1), MealType::Dinner, "chef"))
        .unwrap();
    let id = log.id.to_string();
    let cancel = f.run(&["meal", "delete", &id], "n\n");
    assert!(cancel.status.success());
    assert_eq!(
        String::from_utf8(cancel.stdout).unwrap(),
        "Delete meal log '2026-11-01 dinner unplanned'? [y/N] Deletion cancelled.\n"
    );
    assert_eq!(
        f.success(&["meal", "delete", &id, "--yes"]),
        "Deleted meal log: 2026-11-01 dinner unplanned\n"
    );
    assert!(f.logs.get_by_id(log.id).unwrap().is_none());
    std::fs::write(f.dir.path().join("current_group"), "Missing").unwrap();
    f.success(&["meal", "log", "--date", "2026-11-02", "--type", "lunch"]);
    assert_eq!(f.logs.list().unwrap().len(), 1);
}

#[test]
fn command_validation_and_lookup_error_precedence_remain_unchanged() {
    let f = Fixture::new();
    let id = f.plan.id.to_string();
    let absent = Uuid::nil().to_string();
    for (args, message) in [
        (
            vec!["mealplan", "create", "--date", "bad", "--type", "bad"],
            "Invalid date format 'bad'. Use YYYY-MM-DD.",
        ),
        (
            vec!["mealplan", "update", &id],
            "Nothing to update. Provide at least one option.",
        ),
        (
            vec!["mealplan", "update", &absent, "--date", "bad"],
            "Meal plan not found:",
        ),
        (
            vec!["mealplan", "show", "bad"],
            "Invalid identifier 'bad'. Use UUID or date (YYYY-MM-DD).",
        ),
        (
            vec!["meal", "log"],
            "--date is required for unplanned meals",
        ),
        (
            vec!["meal", "log", "--date", "bad"],
            "--type is required for unplanned meals",
        ),
        (vec!["meal", "log", "bad"], "Invalid mealplan UUID: bad"),
        (
            vec![
                "meal",
                "log",
                "--date",
                "2026-11-02",
                "--type",
                "lunch",
                "--dish",
                "Missing",
            ],
            "Dish not found: Missing",
        ),
        (vec!["meal", "delete", "bad"], "Invalid meal log UUID: bad"),
    ] {
        let out = f.run(&args, "");
        assert!(!out.status.success());
        assert!(out.stdout.is_empty());
        assert!(String::from_utf8(out.stderr).unwrap().contains(message));
    }
    let original = f.plans.get_by_id(f.plan.id).unwrap().unwrap();
    let out = f.run(
        &[
            "mealplan",
            "update",
            &id,
            "--date",
            "2026-11-02",
            "--type",
            "bad",
        ],
        "",
    );
    assert!(!out.status.success());
    let unchanged = f.plans.get_by_id(f.plan.id).unwrap().unwrap();
    assert_eq!(
        serde_json::to_value(original).unwrap(),
        serde_json::to_value(unchanged).unwrap()
    );
}
