use std::fs;

use automerge::{AutoCommit, ReadDoc, ROOT};
use tempfile::TempDir;
use todu_fit_core::{
    automerge::reader::ReaderError, context::GroupContextError, Dish, DishError, DishRepository,
    DishUpdate, DocumentId, Identity, Ingredient, MultiDocStorage, Nutrient,
};
use uuid::Uuid;

fn setup() -> (TempDir, Identity, DishRepository) {
    let dir = TempDir::new().unwrap();
    let identity = Identity::new(MultiDocStorage::new(dir.path().to_path_buf()));
    identity.initialize_new().unwrap();
    identity.create_group("Home").unwrap();
    let repo = DishRepository::new(dir.path().to_path_buf());
    (dir, identity, repo)
}

#[test]
fn create_and_get() {
    let (_dir, _identity, repo) = setup();
    let dish = Dish::new("Test Pasta", "chef");
    assert_eq!(repo.create(&dish).unwrap(), dish);
    assert_eq!(repo.get_by_id(dish.id).unwrap().unwrap(), dish);
    assert_eq!(repo.get_by_name("TEST PASTA").unwrap().unwrap(), dish);
    assert!(repo.get_by_id(Uuid::new_v4()).unwrap().is_none());
    assert!(repo.get_by_name("not present").unwrap().is_none());
}

#[test]
fn update() {
    let (_dir, _identity, repo) = setup();
    let mut dish = Dish::new("Original Name", "chef");
    repo.create(&dish).unwrap();
    dish.name = "Updated Name".into();
    assert_eq!(repo.update(&dish).unwrap(), dish);
    assert_eq!(repo.get_by_id(dish.id).unwrap().unwrap(), dish);
}

#[test]
fn delete() {
    let (_dir, _identity, repo) = setup();
    let dish = Dish::new("To Delete", "chef");
    repo.create(&dish).unwrap();
    repo.delete(dish.id).unwrap();
    assert!(repo.get_by_id(dish.id).unwrap().is_none());
    // Preserve the existing repository's no-op deletion and upsert semantics.
    repo.delete(dish.id).unwrap();
    repo.update(&dish).unwrap();
    assert_eq!(repo.get_by_id(dish.id).unwrap().unwrap(), dish);
}

#[test]
fn list() {
    let (_dir, _identity, repo) = setup();
    for name in ["Dish 1", "Dish 2", "Dish 3"] {
        repo.create(&Dish::new(name, "chef")).unwrap();
    }
    assert_eq!(repo.list().unwrap().len(), 3);
}

#[test]
fn search() {
    let (_dir, _identity, repo) = setup();
    for name in ["Chicken Pasta", "Beef Stew", "Chicken Soup"] {
        repo.create(&Dish::new(name, "chef")).unwrap();
    }
    assert_eq!(repo.search("chicken").unwrap().len(), 2);
}

#[test]
fn search_by_tag() {
    let (_dir, _identity, repo) = setup();
    repo.create(&Dish::new("Pasta", "chef")).unwrap();
    repo.create(&Dish::new("Beef Stew", "chef").with_tags(vec!["comfort".into()]))
        .unwrap();
    let found = repo.search("comfort").unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].name, "Beef Stew");
}

#[test]
fn search_by_ingredient() {
    let (_dir, _identity, repo) = setup();
    repo.create(&Dish::new("Pasta", "chef")).unwrap();
    repo.create(
        &Dish::new("Beef Stew", "chef").with_ingredients(vec![Ingredient::new("carrot", 2.0, "")]),
    )
    .unwrap();
    let found = repo.search("carrot").unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].name, "Beef Stew");
}

#[test]
fn search_is_case_insensitive() {
    let (_dir, _identity, repo) = setup();
    let dish =
        Dish::new("Café Pasta", "chef").with_ingredients(vec![Ingredient::new("Carrot", 2.0, "")]);
    repo.create(&dish).unwrap();
    assert_eq!(repo.search("CAFÉ").unwrap()[0].id, dish.id);
    assert_eq!(repo.search("CARROT").unwrap()[0].id, dish.id);
}

#[test]
fn filter_by_tag() {
    let (_dir, _identity, repo) = setup();
    repo.create(&Dish::new("Dish 1", "chef").with_tags(vec!["keto".into(), "quick".into()]))
        .unwrap();
    repo.create(&Dish::new("Dish 2", "chef").with_tags(vec!["vegetarian".into()]))
        .unwrap();
    repo.create(&Dish::new("Dish 3", "chef").with_tags(vec!["keto".into()]))
        .unwrap();
    assert_eq!(repo.filter_by_tag("KETO").unwrap().len(), 2);
    assert!(repo.filter_by_tag("ket").unwrap().is_empty());
}

#[test]
fn add_ingredient() {
    let (_dir, _identity, repo) = setup();
    let dish = Dish::new("Test Dish", "chef");
    repo.create(&dish).unwrap();
    let ingredient = Ingredient::new("Salt", 1.0, "tsp");
    repo.add_ingredient(dish.id, ingredient.clone()).unwrap();
    assert_eq!(
        repo.get_by_id(dish.id).unwrap().unwrap().ingredients,
        vec![ingredient]
    );
    assert!(matches!(
        repo.add_ingredient(Uuid::nil(), Ingredient::new("Salt", 1.0, "tsp")),
        Err(DishError::NotFound(_))
    ));
}

#[test]
fn remove_ingredient() {
    let (_dir, _identity, repo) = setup();
    let pepper = Ingredient::new("Pepper", 0.5, "tsp");
    let dish = Dish::new("Test Dish", "chef")
        .with_ingredients(vec![Ingredient::new("Salt", 1.0, "tsp"), pepper.clone()]);
    repo.create(&dish).unwrap();
    repo.remove_ingredient(dish.id, "SALT").unwrap();
    assert_eq!(
        repo.get_by_id(dish.id).unwrap().unwrap().ingredients,
        vec![pepper]
    );
    assert!(matches!(
        repo.remove_ingredient(Uuid::nil(), "Salt"),
        Err(DishError::NotFound(_))
    ));
}

#[test]
fn field_updates_preserve_identifiers_timestamps_and_existing_tag_rules() {
    let (_dir, _identity, repo) = setup();
    let mut dish = Dish::new("Original", "chef")
        .with_tags(vec!["Quick".into(), "REMOVE".into()])
        .with_nutrients(vec![Nutrient::new("Calories", 100.0, "kcal")]);
    let original = dish.clone();
    let updates = DishUpdate {
        name: Some("Updated".into()),
        instructions: Some("Cook".into()),
        prep_time: Some(5),
        cook_time: Some(10),
        servings: Some(2),
        image_url: Some("https://example.com/image".into()),
        source_url: Some("https://example.com/recipe".into()),
        add_tags: vec!["quick".into(), "new".into(), "NEW".into(), "remove".into()],
        remove_tags: vec!["remove".into()],
        nutrients: Some(vec![Nutrient::new("Protein", 20.0, "g")]),
    };
    updates.apply_to(&mut dish);
    assert_eq!(dish.id, original.id);
    assert_eq!(dish.created_at, original.created_at);
    assert_eq!(dish.updated_at, original.updated_at);
    assert_eq!(dish.created_by, original.created_by);
    assert_eq!(dish.name, "Updated");
    assert_eq!(dish.instructions, "Cook");
    assert_eq!(
        (dish.prep_time, dish.cook_time, dish.servings),
        (Some(5), Some(10), Some(2))
    );
    assert_eq!(dish.image_url, updates.image_url);
    assert_eq!(dish.source_url, updates.source_url);
    assert_eq!(dish.tags, vec!["Quick", "new"]);
    assert_eq!(dish.nutrients, updates.nutrients);
    assert_eq!(repo.update(&dish).unwrap(), dish);
    let before_empty_update = dish.clone();
    DishUpdate::default().apply_to(&mut dish);
    assert_eq!(dish, before_empty_update);
}

#[test]
fn only_selected_dishes_document_changes_and_ids_survive_reopen() {
    let (dir, identity, repo) = setup();
    let root_id = identity.root_doc_id().unwrap().unwrap();
    let home = identity.list_groups().unwrap()[0].clone();
    let home_doc = identity.load_group(&home.doc_id).unwrap();
    let other_id = identity.create_group("Other").unwrap();
    let other = identity.load_group(&other_id).unwrap();
    let storage = identity.storage();
    let protected_ids = [
        root_id,
        home.doc_id,
        other_id,
        home_doc.mealplans_doc_id,
        home_doc.shopping_carts_doc_id,
        other.dishes_doc_id,
        identity.meallogs_doc_id().unwrap(),
        identity.hydration_doc_id().unwrap(),
    ];
    let before: Vec<_> = protected_ids
        .iter()
        .map(|id| storage.load(id).unwrap())
        .collect();
    let dish = Dish::new("Home Dish", "chef");
    repo.create(&dish).unwrap();
    repo.add_ingredient(dish.id, Ingredient::new("Salt", 1.0, "tsp"))
        .unwrap();
    let after: Vec<_> = protected_ids
        .iter()
        .map(|id| storage.load(id).unwrap())
        .collect();
    assert_eq!(before, after);
    assert_eq!(identity.root_doc_id().unwrap(), Some(root_id));
    let reopened = DishRepository::with_group(dir.path().to_path_buf(), "HOME");
    assert_eq!(
        reopened
            .get_by_id(dish.id)
            .unwrap()
            .unwrap()
            .ingredients
            .len(),
        1
    );
    let bytes = storage.load(&home_doc.dishes_doc_id).unwrap().unwrap();
    let doc = AutoCommit::load(&bytes).unwrap();
    assert!(doc.get(ROOT, dish.id.to_string()).unwrap().is_some());
    repo.delete(dish.id).unwrap();
    assert_eq!(
        identity.load_group(&home.doc_id).unwrap().dishes_doc_id,
        home_doc.dishes_doc_id
    );
    assert_eq!(
        before,
        protected_ids
            .iter()
            .map(|id| storage.load(id).unwrap())
            .collect::<Vec<_>>()
    );
}

#[test]
fn missing_dishes_document_is_created_only_on_write_and_corruption_is_not_overwritten() {
    let (_dir, identity, repo) = setup();
    let group = identity.list_groups().unwrap()[0].clone();
    let doc_id = identity.load_group(&group.doc_id).unwrap().dishes_doc_id;
    identity.storage().delete(&doc_id).unwrap();
    assert!(repo.list().unwrap().is_empty());
    assert!(!identity.storage().exists(&doc_id));
    repo.create(&Dish::new("First", "chef")).unwrap();
    assert!(identity.storage().exists(&doc_id));
    identity
        .storage()
        .save(&doc_id, b"not an Automerge document")
        .unwrap();
    assert!(matches!(
        repo.create(&Dish::new("Never Written", "chef")),
        Err(DishError::Reader(ReaderError::AutomergeError(_)))
    ));
    assert_eq!(
        identity.storage().load(&doc_id).unwrap().unwrap(),
        b"not an Automerge document"
    );
}

#[test]
fn group_selection_errors_keep_the_existing_cli_messages() {
    let dir = TempDir::new().unwrap();
    let repo = DishRepository::new(dir.path().to_path_buf());
    let error = repo.list().unwrap_err();
    assert!(matches!(
        error,
        DishError::GroupContext(GroupContextError::NotInitialized)
    ));
    assert_eq!(
        error.to_string(),
        "Identity not initialized. Run 'fit init --new' first."
    );
    let identity = Identity::new(MultiDocStorage::new(dir.path().to_path_buf()));
    identity.initialize_join(DocumentId::new()).unwrap();
    assert_eq!(
        repo.list().unwrap_err().to_string(),
        "Identity pending sync. Run 'fit sync' first."
    );
    fs::remove_file(dir.path().join("root_doc_id")).unwrap();
    identity.initialize_new().unwrap();
    assert_eq!(
        repo.list().unwrap_err().to_string(),
        "No groups configured. Run 'fit group create <name>' first."
    );
}
