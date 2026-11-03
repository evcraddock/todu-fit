use std::fs;

use tempfile::TempDir;
use todu_fit_core::{
    context::{resolve_group_context, resolve_user_context, GroupContextError},
    Identity, MultiDocStorage,
};

#[test]
fn resolves_first_persisted_and_override_groups_without_writing_selection() {
    let dir = TempDir::new().unwrap();
    let identity = Identity::new(MultiDocStorage::new(dir.path().to_path_buf()));
    identity.initialize_new().unwrap();
    let first_id = identity.create_group("Home").unwrap();
    let second_id = identity.create_group("Work").unwrap();
    let first = identity.load_group(&first_id).unwrap();
    let second = identity.load_group(&second_id).unwrap();

    assert_eq!(
        resolve_group_context(dir.path(), None)
            .unwrap()
            .dishes_doc_id,
        first.dishes_doc_id
    );
    assert!(!dir.path().join("current_group").exists());
    fs::write(dir.path().join("current_group"), "  wOrK\n").unwrap();
    let context = resolve_group_context(dir.path(), None).unwrap();
    assert_eq!(context.dishes_doc_id, second.dishes_doc_id);
    assert_eq!(context.mealplans_doc_id, second.mealplans_doc_id);
    assert_eq!(context.shopping_carts_doc_id, second.shopping_carts_doc_id);
    assert_eq!(
        resolve_group_context(dir.path(), Some("HOME"))
            .unwrap()
            .dishes_doc_id,
        first.dishes_doc_id
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("current_group")).unwrap(),
        "  wOrK\n"
    );
    fs::write(dir.path().join("current_group"), " \n").unwrap();
    assert_eq!(
        resolve_group_context(dir.path(), None)
            .unwrap()
            .dishes_doc_id,
        first.dishes_doc_id
    );
}

#[test]
fn preserves_missing_and_unsynced_group_errors() {
    let dir = TempDir::new().unwrap();
    let identity = Identity::new(MultiDocStorage::new(dir.path().to_path_buf()));
    identity.initialize_new().unwrap();
    let group_id = identity.create_group("Home").unwrap();
    let error = resolve_group_context(dir.path(), Some("Missing")).unwrap_err();
    assert!(matches!(error, GroupContextError::GroupNotFound(_)));
    assert_eq!(error.to_string(), "Group 'Missing' not found.");
    fs::write(dir.path().join("current_group"), "Missing").unwrap();
    assert!(matches!(
        resolve_group_context(dir.path(), None),
        Err(GroupContextError::GroupNotFound(_))
    ));
    identity.storage().delete(&group_id).unwrap();
    assert_eq!(
        resolve_group_context(dir.path(), Some("Home"))
            .unwrap_err()
            .to_string(),
        "Group 'Home' not synced yet. Run 'fit sync' first."
    );
}

#[test]
fn personal_document_references_remain_independent_of_group_selection() {
    let dir = TempDir::new().unwrap();
    let identity = Identity::new(MultiDocStorage::new(dir.path().to_path_buf()));
    let root = identity.initialize_new().unwrap();
    let original = identity.storage().load(&root).unwrap();
    let user = resolve_user_context(dir.path()).unwrap();
    assert_eq!(user.meallogs_doc_id, identity.meallogs_doc_id().unwrap());
    assert_eq!(user.hydration_doc_id, identity.hydration_doc_id().unwrap());
    assert_eq!(identity.storage().load(&root).unwrap(), original);
}
