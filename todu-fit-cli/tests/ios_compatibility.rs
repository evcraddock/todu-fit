mod support;
use tempfile::TempDir;
use todu_fit_core::{
    HydrationRepository, Identity, MealLogRepository, MealPlanRepository, MultiDocStorage,
};
use uuid::Uuid;
#[test]
fn cli_and_daemon_read_edit_and_delete_ios_documents() {
    let dir = TempDir::new().unwrap();
    let storage = MultiDocStorage::new(dir.path().to_path_buf());
    let identity = Identity::new(storage.clone());
    identity.initialize_new().unwrap();
    let group_id = identity.create_group("iOS fixture").unwrap();
    let group = identity.load_group(&group_id).unwrap();
    for (id, name) in [
        (group.dishes_doc_id, "dishes"),
        (group.mealplans_doc_id, "plans"),
        (identity.meallogs_doc_id().unwrap(), "logs"),
        (identity.hydration_doc_id().unwrap(), "water"),
    ] {
        storage
            .save(
                &id,
                &std::fs::read(format!(
                    "{}/../todu-fit-core/tests/fixtures/ios-0.7.2-{name}.automerge",
                    env!("CARGO_MANIFEST_DIR")
                ))
                .unwrap(),
            )
            .unwrap();
    }
    std::fs::write(
        dir.path().join("config.yaml"),
        format!(
            "data_dir: {}\nsync:\n  auto_sync: false\n",
            dir.path().display()
        ),
    )
    .unwrap();
    let run = |args: &[&str]| {
        let out = support::run(dir.path(), args);
        assert!(
            out.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap()
    };
    let plan = "AA000000-0000-4000-8000-000000000002";
    let log = "AA000000-0000-4000-8000-000000000003";
    let water = "AA000000-0000-4000-8000-000000000004";
    assert!(run(&["mealplan", "show", plan]).contains("iOS fixture dinner"));
    run(&["mealplan", "update", plan, "--title", "CLI edited dinner"]);
    assert_eq!(
        MealPlanRepository::new(dir.path().to_path_buf())
            .get_by_id(Uuid::parse_str(plan).unwrap())
            .unwrap()
            .unwrap()
            .title,
        "CLI edited dinner"
    );
    assert!(run(&[
        "meal",
        "history",
        "--from",
        "2026-11-06",
        "--to",
        "2026-11-06",
        "--format",
        "json"
    ])
    .contains("iOS fixture soup"));
    assert!(run(&["water", "recent", "--format", "json"]).contains("250"));
    run(&["mealplan", "delete", plan, "--force"]);
    run(&["meal", "delete", log, "--yes"]);
    run(&["water", "delete", water]);
    assert!(MealPlanRepository::new(dir.path().to_path_buf())
        .list()
        .unwrap()
        .is_empty());
    assert!(MealLogRepository::new(dir.path().to_path_buf())
        .get_by_id(Uuid::parse_str(log).unwrap())
        .unwrap()
        .is_none());
    assert!(HydrationRepository::new(dir.path().to_path_buf())
        .get_by_id(Uuid::parse_str(water).unwrap())
        .unwrap()
        .is_none());
}
