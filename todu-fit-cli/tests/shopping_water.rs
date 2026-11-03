mod support;
use automerge::AutoCommit;
use chrono::NaiveDate;
use std::process::Output;
use tempfile::TempDir;
use todu_fit_core::{
    Dish, DishRepository, HydrationRepository, HydrationSettings, HydrationUnit, Identity,
    Ingredient, MealPlan, MealPlanRepository, MealType, MultiDocStorage, ShoppingRepository,
};

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
        let group_id = identity.create_group("Home").unwrap();
        let group = identity.load_group(&group_id).unwrap();
        identity
            .storage()
            .save(
                &group.shopping_carts_doc_id,
                include_bytes!("../../todu-fit-core/tests/fixtures/shopping-before-core.automerge"),
            )
            .unwrap();
        identity
            .storage()
            .save(
                &identity.hydration_doc_id().unwrap(),
                include_bytes!(
                    "../../todu-fit-core/tests/fixtures/hydration-before-core.automerge"
                ),
            )
            .unwrap();
        let dish =
            Dish::new("Bowl", "chef").with_ingredients(vec![Ingredient::new("Salt", 2.0, "tsp")]);
        DishRepository::new(dir.path().to_path_buf())
            .create(&dish)
            .unwrap();
        let plans = MealPlanRepository::new(dir.path().to_path_buf());
        for leftovers in [false, true] {
            plans
                .create(
                    &MealPlan::new(
                        NaiveDate::from_ymd_opt(2026, 7, 21).unwrap(),
                        MealType::Dinner,
                        "Plan",
                        "chef",
                    )
                    .with_dish_ids(vec![dish.id])
                    .with_uses_leftovers(leftovers),
                )
                .unwrap();
        }
        std::fs::write(
            dir.path().join("config.yaml"),
            "sync:\n  auto_sync: false\n",
        )
        .unwrap();
        let cart = ShoppingRepository::new(dir.path().to_path_buf());
        let water = HydrationRepository::new(dir.path().to_path_buf());
        Self {
            dir,
            identity,
            cart,
            water,
        }
    }
    fn run(&self, args: &[&str]) -> Output {
        support::run(self.dir.path(), args)
    }
    fn success(&self, args: &[&str]) -> String {
        let output = self.run(args);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.stderr.is_empty());
        String::from_utf8(output.stdout).unwrap()
    }
    fn json(&self, args: &[&str]) -> serde_json::Value {
        serde_json::from_str(&self.success(args)).unwrap()
    }
}

#[test]
fn shopping_view_preserves_sunday_week_aggregation_leftovers_and_output_shapes() {
    let f = Fixture::new();
    let json = f.json(&["shopping", "list", "--week", "2026-07-21", "-f", "json"]);
    assert_eq!(json["week"], "2026-07-19");
    assert_eq!(json["items"].as_array().unwrap().len(), 1);
    assert_eq!(json["items"][0]["name"], "Salt");
    assert_eq!(json["items"][0]["quantity"], 2.0);
    assert_eq!(json["items"][0]["checked"], true);
    assert_eq!(json["manual_items"][0]["quantity"], "2");
    assert_eq!(json["manual_items"][1]["unit"], "bars");
    let text = f.success(&["shopping", "list", "--week", "2026-07-21"]);
    assert!(text.starts_with("Shopping Cart - Week of Jul 19, 2026\n"));
    assert!(text.contains("1 of 3 items checked"));
}

#[test]
fn shopping_mutations_keep_existing_messages_and_no_op_persistence() {
    let f = Fixture::new();
    let group = f
        .identity
        .load_group(&f.identity.list_groups().unwrap()[0].doc_id)
        .unwrap();
    let before = f
        .identity
        .storage()
        .load(&group.shopping_carts_doc_id)
        .unwrap();
    assert_eq!(
        f.success(&["shopping", "add", "PAPER TOWELS", "--week", "2026-07-21"]),
        "Warning: 'PAPER TOWELS' already exists in the cart, skipping\n"
    );
    assert_eq!(
        f.identity
            .storage()
            .load(&group.shopping_carts_doc_id)
            .unwrap(),
        before
    );
    assert_eq!(
        f.success(&["shopping", "check", "salt", "--week", "2026-07-21"]),
        "'salt' is already checked\n"
    );
    assert_eq!(
        f.identity
            .storage()
            .load(&group.shopping_carts_doc_id)
            .unwrap(),
        before
    );
    assert_eq!(
        f.success(&["shopping", "uncheck", "SALT", "--week", "2026-07-21"]),
        "Unchecked 'SALT'\n"
    );
    assert_eq!(
        f.success(&["shopping", "clear-checked", "--week", "2026-07-21"]),
        "No checked items to clear\n"
    );
    assert_eq!(
        f.success(&["shopping", "check", "Soap", "--week", "2026-07-21"]),
        "Checked 'Soap' ✓\n"
    );
    assert_eq!(
        f.success(&["shopping", "clear-checked", "--week", "2026-07-21"]),
        "Cleared 1 checked items\n"
    );
    f.success(&[
        "shopping",
        "add",
        "New",
        "--qty",
        "a few",
        "--unit",
        "bags",
        "--week",
        "2026-07-21",
    ]);
    assert_eq!(
        f.cart
            .get_or_create("2026-07-19")
            .unwrap()
            .find_manual_item("New")
            .unwrap()
            .quantity
            .as_deref(),
        Some("a few")
    );
    assert_eq!(
        f.success(&["shopping", "remove", "NEW", "--week", "2026-07-21"]),
        "Removed 'NEW' from shopping cart\n"
    );
}

#[test]
fn water_queries_preserve_timezone_boundaries_recent_limits_and_json_metadata() {
    let f = Fixture::new();
    let id = f.identity.hydration_doc_id().unwrap();
    let before = f.identity.storage().load(&id).unwrap();
    let history = f.json(&[
        "water",
        "history",
        "--from",
        "2026-07-25",
        "--to",
        "2026-07-26",
        "-f",
        "json",
    ]);
    assert_eq!(history["timezone"], "America/Chicago");
    assert_eq!(history["entries"].as_array().unwrap().len(), 3);
    assert_eq!(history["days"][0]["total_ml"], 750);
    assert_eq!(history["days"][1]["total_ml"], 750);
    assert_eq!(history["days"][0]["goal_progress"], 0.75);
    assert_eq!(
        f.success(&["water", "recent", "--limit", "0", "-f", "json"]),
        "No water entries found\n"
    );
    let recent = f.json(&["water", "recent", "--limit", "2", "-f", "json"]);
    assert_eq!(recent[0]["amount_ml"], 750);
    assert_eq!(recent[1]["amount_ml"], 500);
    let today = f.json(&["water", "today", "-f", "json"]);
    assert_eq!(today["timezone"], "America/Chicago");
    assert_eq!(today["goal_ml"], 1000);
    assert_eq!(f.identity.storage().load(&id).unwrap(), before);
}

#[test]
fn water_settings_updates_reuse_units_rounding_normalization_and_original_error_order() {
    let f = Fixture::new();
    let output = f.success(&[
        "water",
        "set",
        "--goal",
        "16",
        "--unit",
        "oz",
        "--display-unit",
        "ml",
        "--presets",
        "16,8,16",
        "--timezone",
        "UTC",
    ]);
    assert!(output.starts_with("Updated water settings:\n"));
    let settings = f.water.get_settings().unwrap();
    assert_eq!(settings.daily_goal_ml, 473);
    assert_eq!(settings.quick_add_presets_ml, vec![237, 473]);
    assert_eq!(settings.preferred_unit, HydrationUnit::Ml);
    assert_eq!(settings.timezone, "UTC");
    let id = f.identity.hydration_doc_id().unwrap();
    let before = f.identity.storage().load(&id).unwrap();
    let output = f.run(&["water", "set", "--goal", "0", "--timezone", "Invalid/Zone"]);
    assert!(!output.status.success());
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("Invalid IANA timezone: Invalid/Zone"));
    assert_eq!(f.identity.storage().load(&id).unwrap(), before);
}

#[test]
fn water_add_and_delete_preserve_units_timestamp_display_and_no_confirmation() {
    let f = Fixture::new();
    let output = f.success(&[
        "water",
        "add",
        "16",
        "--unit",
        "oz",
        "--at",
        "2026-07-25T05:00:00Z",
    ]);
    assert!(output.contains("Amount: 473 mL"));
    assert!(output.contains("Time: 2026-07-25 00:00 -05:00"));
    let entries = f.water.list_entries().unwrap();
    let added = entries.iter().find(|e| e.amount_ml == 473).unwrap();
    assert_eq!(
        f.success(&["water", "delete", &added.id.to_string()]),
        format!("Deleted water entry {}\n", added.id)
    );
    assert!(f.water.get_by_id(added.id).unwrap().is_none());
}

#[test]
fn legacy_settings_initialize_using_cli_platform_provider_once_without_replacing_entries() {
    let f = Fixture::new();
    let root = f.identity.root_doc_id().unwrap().unwrap();
    let root_bytes = f.identity.storage().load(&root).unwrap();
    let id = f.identity.hydration_doc_id().unwrap();
    f.identity
        .storage()
        .save(
            &id,
            include_bytes!(
                "../../todu-fit-core/tests/fixtures/hydration-legacy-before-core.automerge"
            ),
        )
        .unwrap();
    let entries = f.water.list_entries().unwrap();
    let settings: HydrationSettings =
        serde_json::from_str(&f.success(&["water", "settings", "-f", "json"])).unwrap();
    assert!(settings.timezone.parse::<chrono_tz::Tz>().is_ok());
    assert_eq!(settings.daily_goal_ml, 1000);
    assert_eq!(settings.quick_add_presets_ml, vec![250, 500]);
    let initialized = f.identity.storage().load(&id).unwrap().unwrap();
    assert!(AutoCommit::load(&initialized).is_ok());
    f.success(&["water", "settings", "-f", "json"]);
    assert_eq!(
        f.identity.storage().load(&id).unwrap().unwrap(),
        initialized
    );
    assert_eq!(f.water.list_entries().unwrap(), entries);
    assert_eq!(f.identity.storage().load(&root).unwrap(), root_bytes);
}

#[test]
fn validation_and_group_personal_isolation_remain_unchanged() {
    let f = Fixture::new();
    for (args, message) in [
        (
            vec!["shopping", "list", "--week", "bad"],
            "Invalid date format 'bad'. Use YYYY-MM-DD.",
        ),
        (
            vec!["shopping", "add", " ", "--week", "2026-07-21"],
            "Item name cannot be empty",
        ),
        (
            vec!["shopping", "remove", "Salt", "--week", "2026-07-21"],
            "item not found or is not a manual item",
        ),
        (
            vec![
                "water",
                "history",
                "--from",
                "2026-07-26",
                "--to",
                "2026-07-25",
            ],
            "--from must be on or before --to",
        ),
        (
            vec!["water", "add", "0", "--at", "bad"],
            "Invalid timestamp 'bad'. Use RFC3339.",
        ),
        (
            vec!["water", "delete", "bad"],
            "Invalid water entry UUID: bad",
        ),
    ] {
        let output = f.run(&args);
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8(output.stderr).unwrap().contains(message));
    }
    std::fs::write(f.dir.path().join("current_group"), "Missing").unwrap();
    assert!(!f
        .run(&["shopping", "list", "--week", "2026-07-21"])
        .status
        .success());
    assert_eq!(
        f.json(&["water", "recent", "-f", "json"])
            .as_array()
            .unwrap()
            .len(),
        3
    );
}
