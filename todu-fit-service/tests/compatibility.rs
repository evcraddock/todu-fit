//! Synthetic historical snapshots only. No network, production stores, or new schemas.
use automerge::{AutoCommit, ReadDoc, ROOT};
use serde_json::{json, Value};
use todu_fit_core::{Identity, MultiDocStorage};
use todu_fit_protocol::{Outcome, Request};
use todu_fit_service::{
    store::{clean_workspaces, collect, materialize, Store},
    transact, Context,
};
fn request(store: &mut Store, root: &std::path::Path, operation: Value) -> Value {
    let r = Request {
        version: 2,
        id: uuid::Uuid::new_v4(),
        operation: serde_json::from_value(operation).unwrap(),
    };
    match transact(store, root, &Context::default(), &r).outcome {
        Outcome::Ok { value } => serde_json::to_value(value).unwrap()["data"].clone(),
        Outcome::Error { error } => panic!("{error:?}"),
    }
}
#[test]
fn historical_dish_formats_keep_ids_encodings_and_history_through_api_edits() {
    for bytes in [
        include_bytes!("../../todu-fit-core/tests/fixtures/rust-0.7.2.automerge").as_slice(),
        include_bytes!("../../todu-fit-core/tests/fixtures/js-3.2.1.automerge").as_slice(),
        include_bytes!("../../todu-fit-core/tests/fixtures/rust-0.12.0.automerge").as_slice(),
        include_bytes!("../../todu-fit-core/tests/fixtures/js-3.5.0.automerge").as_slice(),
    ] {
        let source = tempfile::tempdir().unwrap();
        let files = MultiDocStorage::new(source.path().into());
        let identity = Identity::new(files.clone());
        let root_id = identity.initialize_new().unwrap();
        let group_id = identity.create_group("Home").unwrap();
        let group = identity.load_group(&group_id).unwrap();
        files.save(&group.dishes_doc_id, bytes).unwrap();
        let root = tempfile::tempdir().unwrap();
        clean_workspaces(root.path()).unwrap();
        let mut store = Store::open(&root.path().join("db")).unwrap();
        let original = collect(source.path()).unwrap();
        store.commit(&original, None).unwrap();
        let dishes = request(&mut store, root.path(), json!({"type":"dishes_list"}));
        assert_eq!(dishes[0]["name"], "Café 🥗");
        assert_eq!(store.snapshot().unwrap(), original);
        request(
            &mut store,
            root.path(),
            json!({"type":"dish_add_ingredient","identifier":dishes[0]["id"],"ingredient":{"name":"Salt","quantity":0.5,"unit":"tsp"}}),
        );
        let changed = store.snapshot().unwrap();
        assert_eq!(
            original.keys().collect::<Vec<_>>(),
            changed.keys().collect::<Vec<_>>()
        );
        for key in [
            "root_doc_id".into(),
            format!("{}.automerge", root_id.to_bs58check()),
            format!("{}.automerge", group_id.to_bs58check()),
        ] {
            assert_eq!(original[&key], changed[&key]);
        }
        let mut old = AutoCommit::load(bytes).unwrap();
        let mut new = AutoCommit::load(
            &changed[&format!("{}.automerge", group.dishes_doc_id.to_bs58check())],
        )
        .unwrap();
        let history: Vec<_> = new.get_changes(&[]).iter().map(|c| c.hash()).collect();
        assert!(old
            .get_changes(&[])
            .iter()
            .all(|c| history.contains(&c.hash())));
        let id = dishes[0]["id"].as_str().unwrap();
        let (_, obj) = new.get(ROOT, id).unwrap().unwrap();
        assert!(new.get(&obj, "name").unwrap().unwrap().0.as_str().is_some());
        assert_eq!(
            new.get(ROOT, "_text").unwrap().unwrap().0,
            old.get(ROOT, "_text").unwrap().unwrap().0
        );
    }
}
#[test]
fn existing_meal_shopping_and_hydration_documents_are_read_without_migration() {
    let source = tempfile::tempdir().unwrap();
    let files = MultiDocStorage::new(source.path().into());
    let identity = Identity::new(files.clone());
    identity.initialize_new().unwrap();
    let group_id = identity.create_group("Home").unwrap();
    let group = identity.load_group(&group_id).unwrap();
    for (id, bytes) in [
        (
            group.mealplans_doc_id,
            include_bytes!("../../todu-fit-core/tests/fixtures/mealplans-before-core.automerge")
                .as_slice(),
        ),
        (
            identity.meallogs_doc_id().unwrap(),
            include_bytes!(
                "../../todu-fit-core/tests/fixtures/meallogs-mixed-before-core.automerge"
            )
            .as_slice(),
        ),
        (
            group.shopping_carts_doc_id,
            include_bytes!("../../todu-fit-core/tests/fixtures/shopping-before-core.automerge")
                .as_slice(),
        ),
        (
            identity.hydration_doc_id().unwrap(),
            include_bytes!("../../todu-fit-core/tests/fixtures/hydration-before-core.automerge")
                .as_slice(),
        ),
    ] {
        files.save(&id, bytes).unwrap();
    }
    // Resolve historical UUID references exactly as the existing CLI does.
    let original_plans =
        AutoCommit::load(&files.load(&group.mealplans_doc_id).unwrap().unwrap()).unwrap();
    let ref_id = todu_fit_core::automerge::reader::read_all_mealplans(&original_plans).unwrap()[0]
        .dish_ids[0];
    let mut dish = todu_fit_core::Dish::new("Pasta", "fixture").with_nutrients(vec![
        todu_fit_core::Nutrient::new("calories", 600.0, "kcal"),
    ]);
    dish.id = ref_id;
    todu_fit_core::DishRepository::new(source.path().into())
        .create(&dish)
        .unwrap();
    let root = tempfile::tempdir().unwrap();
    clean_workspaces(root.path()).unwrap();
    let mut store = Store::open(&root.path().join("db")).unwrap();
    let before = collect(source.path()).unwrap();
    store.commit(&before, None).unwrap();
    let plans = request(
        &mut store,
        root.path(),
        json!({"type":"plans_list","from":"2026-11-01","to":"2026-11-04"}),
    );
    assert!(!plans.as_array().unwrap().is_empty());
    let logs = request(
        &mut store,
        root.path(),
        json!({"type":"meals_history","from":"2026-11-01","to":"2026-11-04"}),
    );
    let reference = logs
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["log"]["id"].as_str().unwrap().ends_with("0040"))
        .unwrap();
    assert_eq!(reference["nutrients"]["calories"], 300.0);
    let embedded = logs
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["log"]["id"].as_str().unwrap().ends_with("0041"))
        .unwrap();
    assert_eq!(embedded["nutrients"]["calories"], 1200.0);
    let shopping = request(
        &mut store,
        root.path(),
        json!({"type":"shopping_list","week":"2026-07-21"}),
    );
    assert_eq!(shopping["cart"]["week"], "2026-07-19");
    assert_eq!(shopping["cart"]["manual_items"][0]["quantity"], "2");
    let water = request(
        &mut store,
        root.path(),
        json!({"type":"water_history","from":"2026-07-25","to":"2026-07-25"}),
    );
    assert_eq!(water["days"][0]["total_ml"], 750);
    assert_eq!(before, store.snapshot().unwrap());
    // Ordinary edits use the same IDs and retain original Automerge histories.
    request(
        &mut store,
        root.path(),
        json!({"type":"plan_update","id":plans[0]["id"],"fields":{"uses_leftovers":true}}),
    );
    request(
        &mut store,
        root.path(),
        json!({"type":"shopping_set_checked","week":"2026-07-21","name":"Soap","checked":true}),
    );
    request(
        &mut store,
        root.path(),
        json!({"type":"water_settings_update","fields":{"goal":1500.0,"unit":"ml"}}),
    );
    let after = store.snapshot().unwrap();
    assert_eq!(
        before.keys().collect::<Vec<_>>(),
        after.keys().collect::<Vec<_>>()
    );
    for (key, bytes) in &before {
        if key.ends_with(".automerge") {
            let mut old = AutoCommit::load(bytes).unwrap();
            let mut new = AutoCommit::load(&after[key]).unwrap();
            let hashes: Vec<_> = new.get_changes(&[]).iter().map(|c| c.hash()).collect();
            assert!(old
                .get_changes(&[])
                .iter()
                .all(|c| hashes.contains(&c.hash())));
        }
    }
    let workspace = materialize(&after, root.path()).unwrap();
    assert_eq!(
        Identity::new(MultiDocStorage::new(workspace.path().into()))
            .root_doc_id()
            .unwrap(),
        identity.root_doc_id().unwrap()
    );
}
