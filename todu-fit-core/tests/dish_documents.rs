use automerge::{transaction::Transactable, AutoCommit, ObjType, ReadDoc, ROOT};
use tempfile::TempDir;
use todu_fit_core::{
    automerge::reader::{read_all_dishes, read_dish_by_id},
    write_dish, Dish, DishRepository, Identity, Ingredient, MultiDocStorage,
};

#[test]
fn repository_reads_historical_snapshots_without_rewriting_them() {
    for bytes in [
        include_bytes!("fixtures/rust-0.7.2.automerge").as_slice(),
        include_bytes!("fixtures/js-3.2.1.automerge").as_slice(),
        include_bytes!("fixtures/rust-0.12.0.automerge").as_slice(),
        include_bytes!("fixtures/js-3.5.0.automerge").as_slice(),
    ] {
        let dir = TempDir::new().unwrap();
        let storage = MultiDocStorage::new(dir.path().to_path_buf());
        let identity = Identity::new(storage.clone());
        identity.initialize_new().unwrap();
        let group = identity.create_group("Home").unwrap();
        let doc_id = identity.load_group(&group).unwrap().dishes_doc_id;
        storage.save(&doc_id, bytes).unwrap();
        let mut original = AutoCommit::load(bytes).unwrap();
        let original_history: Vec<_> = original
            .get_changes(&[])
            .iter()
            .map(|change| change.hash())
            .collect();
        let repo = DishRepository::new(dir.path().to_path_buf());

        let dishes = repo.list().unwrap();
        assert_eq!(dishes.len(), 1);
        assert_eq!(dishes[0].name, "Café 🥗");
        assert_eq!(storage.load(&doc_id).unwrap().unwrap(), bytes);

        repo.add_ingredient(dishes[0].id, Ingredient::new("Salt", 0.5, "tsp"))
            .unwrap();
        let mut changed = AutoCommit::load(&storage.load(&doc_id).unwrap().unwrap()).unwrap();
        let history: Vec<_> = changed
            .get_changes(&[])
            .iter()
            .map(|change| change.hash())
            .collect();
        assert!(original_history.iter().all(|hash| history.contains(hash)));
        assert_eq!(identity.load_group(&group).unwrap().dishes_doc_id, doc_id);
        assert_eq!(
            repo.get_by_id(dishes[0].id)
                .unwrap()
                .unwrap()
                .ingredients
                .len(),
            2
        );
    }
}

#[test]
fn reader_preserves_numeric_scalar_string_and_collaborative_text_quantities() {
    let dish =
        Dish::new("Pasta", "chef").with_ingredients(vec![Ingredient::new("Salt", 1.0, "tsp")]);
    let mut doc = AutoCommit::new();
    write_dish(&mut doc, &dish);
    let (_, dish_obj) = doc.get(ROOT, dish.id.to_string()).unwrap().unwrap();
    let (_, ingredients) = doc.get(&dish_obj, "ingredients").unwrap().unwrap();
    let (_, ingredient) = doc.get(&ingredients, 0).unwrap().unwrap();

    doc.put(&ingredient, "quantity", 2_i64).unwrap();
    assert_eq!(
        read_dish_by_id(&doc, dish.id).unwrap().unwrap().ingredients[0].quantity,
        2.0
    );
    doc.put(&ingredient, "quantity", " 3.5 ").unwrap();
    assert_eq!(
        read_dish_by_id(&doc, dish.id).unwrap().unwrap().ingredients[0].quantity,
        3.5
    );
    let text = doc
        .put_object(&ingredient, "quantity", ObjType::Text)
        .unwrap();
    doc.splice_text(&text, 0, 0, " 4.5 ").unwrap();
    assert_eq!(
        read_dish_by_id(&doc, dish.id).unwrap().unwrap().ingredients[0].quantity,
        4.5
    );
}

#[test]
fn reader_skips_non_dish_keys_and_records_without_scalar_names() {
    let mut doc = AutoCommit::new();
    doc.put_object(ROOT, "metadata", ObjType::Map).unwrap();
    let dish = Dish::new("Pasta", "chef");
    doc.put_object(ROOT, dish.id.to_string(), ObjType::Map)
        .unwrap();
    assert!(read_all_dishes(&doc).unwrap().is_empty());
    write_dish(&mut doc, &dish);
    let (_, dish_obj) = doc.get(ROOT, dish.id.to_string()).unwrap().unwrap();
    let text = doc.put_object(&dish_obj, "name", ObjType::Text).unwrap();
    doc.splice_text(&text, 0, 0, "Collaborative name").unwrap();
    // Preserve the current scalar-only entity string contract rather than migrate it.
    assert!(read_all_dishes(&doc).unwrap().is_empty());
}
