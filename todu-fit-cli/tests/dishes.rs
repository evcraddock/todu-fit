mod support;
use std::process::Output;

use chrono::{TimeZone, Utc};
use tempfile::TempDir;
use todu_fit_core::{Dish, DishRepository, Identity, Ingredient, MultiDocStorage, Nutrient};
use uuid::Uuid;

struct Fixture {
    dir: TempDir,
    repo: DishRepository,
    dish: Dish,
}

impl Fixture {
    fn new() -> Self {
        let dir = TempDir::new().unwrap();
        let identity = Identity::new(MultiDocStorage::new(dir.path().to_path_buf()));
        identity.initialize_new().unwrap();
        identity.create_group("Home").unwrap();
        let repo = DishRepository::new(dir.path().to_path_buf());
        let mut dish = Dish::new("Test Pasta", "chef")
            .with_tags(vec!["Quick".into(), "italian".into()])
            .with_ingredients(vec![Ingredient::new("Tomato", 2.0, "cups")])
            .with_nutrients(vec![Nutrient::new("calories", 200.0, "kcal")]);
        dish.id = Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap();
        dish.created_at = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        dish.updated_at = dish.created_at;
        repo.create(&dish).unwrap();
        std::fs::write(
            dir.path().join("config.yaml"),
            "created_by: cli-fixture\nsync:\n  auto_sync: false\n",
        )
        .unwrap();
        Self { dir, repo, dish }
    }

    fn run(&self, args: &[&str], _input: &str) -> Output {
        support::run(self.dir.path(), args)
    }
    fn success(&self, args: &[&str]) -> String {
        let output = self.run(args, "");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.stderr.is_empty());
        String::from_utf8(output.stdout).unwrap()
    }
}

#[test]
fn listing_search_filter_and_lookup_preserve_output() {
    let fixture = Fixture::new();
    let json = fixture.success(&["dish", "list", "--format", "json"]);
    assert_eq!(
        serde_json::from_str::<Vec<Dish>>(&json).unwrap(),
        vec![fixture.dish.clone()]
    );
    assert_eq!(
        fixture.success(&["dish", "list", "--tag", "QUICK", "--format", "json"]),
        json
    );
    assert_eq!(
        fixture.success(&["dish", "search", "  TOMATO  ", "-f", "json"]),
        json
    );
    assert_eq!(
        fixture.success(&["dish", "list", "--tag", "missing"]),
        "No dishes found\n"
    );
    let shown = fixture.success(&["dish", "show", "TEST PASTA", "-f", "json"]);
    assert_eq!(serde_json::from_str::<Dish>(&shown).unwrap(), fixture.dish);
    let table = format!(
        "{:<36}  {:<30}  TAGS\n{}\n{:<36}  {:<30}  Quick, italian\n\nTotal: 1 dish(es)\n",
        "ID",
        "NAME",
        "-".repeat(80),
        fixture.dish.id,
        "Test Pasta"
    );
    assert_eq!(fixture.success(&["dish", "list"]), table);
}

#[test]
fn creation_and_field_updates_retain_flags_and_existing_semantics() {
    let fixture = Fixture::new();
    let created = fixture.success(&[
        "dish",
        "create",
        "  New Dish  ",
        "--instructions",
        "Mix",
        "--prep-time",
        "5",
        "--cook-time",
        "10",
        "--servings",
        "2",
        "--tag",
        "new",
        "--nutrients",
        "{\"protein\":10}",
    ]);
    assert!(created.starts_with("Created dish:\nNew Dish\n"));
    let dish = fixture.repo.get_by_name("New Dish").unwrap().unwrap();
    assert_eq!(dish.created_by, "cli-fixture");
    assert_eq!(dish.instructions, "Mix");
    assert_eq!(
        (dish.prep_time, dish.cook_time, dish.servings),
        (Some(5), Some(10), Some(2))
    );
    assert_eq!(
        dish.nutrients.unwrap(),
        vec![Nutrient::new("protein", 10.0, "g")]
    );

    let output = fixture.success(&[
        "dish",
        "update",
        "test pasta",
        "--name",
        "Renamed",
        "--instructions",
        "Serve",
        "--prep-time",
        "1",
        "--cook-time",
        "2",
        "--servings",
        "3",
        "--add-tag",
        "quick",
        "--add-tag",
        "new",
        "--remove-tag",
        "ITALIAN",
        "--image-url",
        "https://example.com/image",
        "--source-url",
        "https://example.com/source",
        "--nutrients",
        "{\"protein\":20}",
    ]);
    assert!(output.starts_with("Updated dish:\nRenamed\n"));
    let updated = fixture.repo.get_by_id(fixture.dish.id).unwrap().unwrap();
    assert_eq!(updated.tags, vec!["Quick", "new"]);
    assert_eq!(
        updated.nutrients.unwrap(),
        vec![Nutrient::new("protein", 20.0, "g")]
    );
    assert_eq!(updated.created_at, fixture.dish.created_at);
    assert_eq!(updated.updated_at, fixture.dish.updated_at);
    assert_eq!(updated.instructions, "Serve");
    assert_eq!(
        (updated.prep_time, updated.cook_time, updated.servings),
        (Some(1), Some(2), Some(3))
    );
    assert_eq!(
        updated.image_url.as_deref(),
        Some("https://example.com/image")
    );
    assert_eq!(
        updated.source_url.as_deref(),
        Some("https://example.com/source")
    );
}

#[test]
fn ingredient_commands_and_deletion_confirmation_stay_in_the_cli() {
    let fixture = Fixture::new();
    assert_eq!(
        fixture.success(&[
            "dish",
            "add-ingredient",
            "Test Pasta",
            "--name",
            "Salt",
            "--quantity",
            "0.5",
            "--unit",
            "tsp"
        ]),
        "Added ingredient to 'Test Pasta':\n  0.5 tsp Salt\n"
    );
    assert_eq!(
        fixture.success(&["dish", "remove-ingredient", "Test Pasta", "--name", "SALT"]),
        "Removed ingredient 'SALT' from 'Test Pasta'\n"
    );
    let cancelled = fixture.run(&["dish", "delete", "Test Pasta"], "n\n");
    assert!(!cancelled.status.success());
    assert!(String::from_utf8(cancelled.stderr)
        .unwrap()
        .contains("Confirmation required"));
    assert!(fixture.repo.get_by_id(fixture.dish.id).unwrap().is_some());
    assert_eq!(
        fixture.success(&["dish", "delete", "Test Pasta", "--force"]),
        "Deleted dish: Test Pasta\n"
    );
    assert!(fixture.repo.get_by_id(fixture.dish.id).unwrap().is_none());
}

#[test]
fn command_validation_and_error_precedence_remain_unchanged() {
    let fixture = Fixture::new();
    for (args, message) in [
        (vec!["dish", "create", " "], "Dish name cannot be empty"),
        (vec!["dish", "search", " "], "Search query cannot be empty"),
        (
            vec!["dish", "update", "Test Pasta"],
            "Nothing to update. Provide at least one option.",
        ),
        (
            vec!["dish", "update", "Missing", "--nutrients", "invalid"],
            "Dish not found: Missing",
        ),
        (
            vec![
                "dish",
                "add-ingredient",
                "Missing",
                "--name",
                "Salt",
                "--quantity",
                "0",
                "--unit",
                "tsp",
            ],
            "Quantity must be a positive number",
        ),
        (
            vec![
                "dish",
                "remove-ingredient",
                "Test Pasta",
                "--name",
                "Missing",
            ],
            "Ingredient not found: Missing",
        ),
    ] {
        let output = fixture.run(&args, "");
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8(output.stderr).unwrap().contains(message));
    }
    let output = fixture.run(
        &[
            "dish",
            "update",
            "Test Pasta",
            "--name",
            "Never Saved",
            "--nutrients",
            "invalid",
        ],
        "",
    );
    assert!(!output.status.success());
    assert_eq!(
        fixture.repo.get_by_id(fixture.dish.id).unwrap().unwrap(),
        fixture.dish
    );
}
