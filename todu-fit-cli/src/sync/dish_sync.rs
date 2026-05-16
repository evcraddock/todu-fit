//! Sync-aware dish repository that reads/writes Automerge documents.
//!
//! This module provides a repository layer that uses the current group's
//! dishes document. Identity must be initialized first.

use std::path::PathBuf;

use automerge::AutoCommit;
use uuid::Uuid;

use todu_fit_core::{DocumentId, MultiDocStorage};

use crate::models::{Dish, Ingredient};
use crate::sync::group_context::{resolve_group_context, GroupContextError};
use crate::sync::reader::{
    filter_dishes_by_tag, find_dish_by_name, read_all_dishes, read_dish_by_id, search_dishes,
    ReaderError,
};
use crate::sync::writer;

/// Error type for sync dish operations.
#[derive(Debug)]
pub enum SyncDishError {
    /// Reader error (parsing Automerge data).
    Reader(ReaderError),
    /// Dish not found.
    NotFound(String),
    /// Group context error.
    GroupContext(GroupContextError),
    /// Multi-storage error.
    MultiStorage(todu_fit_core::MultiStorageError),
}

impl std::fmt::Display for SyncDishError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncDishError::Reader(e) => write!(f, "Reader error: {}", e),
            SyncDishError::NotFound(id) => write!(f, "Dish not found: {}", id),
            SyncDishError::GroupContext(e) => write!(f, "{}", e),
            SyncDishError::MultiStorage(e) => write!(f, "Storage error: {}", e),
        }
    }
}

impl std::error::Error for SyncDishError {}

impl From<ReaderError> for SyncDishError {
    fn from(e: ReaderError) -> Self {
        SyncDishError::Reader(e)
    }
}

impl From<GroupContextError> for SyncDishError {
    fn from(e: GroupContextError) -> Self {
        SyncDishError::GroupContext(e)
    }
}

impl From<todu_fit_core::MultiStorageError> for SyncDishError {
    fn from(e: todu_fit_core::MultiStorageError) -> Self {
        SyncDishError::MultiStorage(e)
    }
}

/// Sync-aware dish repository.
///
/// All operations work directly with Automerge documents.
/// Uses the current group's dishes document.
pub struct SyncDishRepository {
    storage: MultiDocStorage,
    data_dir: PathBuf,
    group_override: Option<String>,
}

impl SyncDishRepository {
    /// Creates a new sync dish repository.
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            storage: MultiDocStorage::new(data_dir.clone()),
            data_dir,
            group_override: None,
        }
    }

    /// Creates a new repository with a specific group override.
    #[allow(dead_code)]
    pub fn with_group(data_dir: PathBuf, group_name: &str) -> Self {
        Self {
            storage: MultiDocStorage::new(data_dir.clone()),
            data_dir,
            group_override: Some(group_name.to_string()),
        }
    }

    /// Resolves the dishes document ID from the current group context.
    fn resolve_doc_id(&self) -> Result<DocumentId, SyncDishError> {
        let ctx = resolve_group_context(&self.data_dir, self.group_override.as_deref())?;
        Ok(ctx.dishes_doc_id)
    }

    /// Loads the dishes Automerge document, or creates a new empty one.
    fn load_or_create_doc(&self) -> Result<(AutoCommit, DocumentId), SyncDishError> {
        let doc_id = self.resolve_doc_id()?;
        let doc = match self.storage.load(&doc_id)? {
            Some(bytes) => AutoCommit::load(&bytes)
                .map_err(|e| SyncDishError::Reader(ReaderError::AutomergeError(e.to_string())))?,
            None => AutoCommit::new(),
        };
        Ok((doc, doc_id))
    }

    /// Saves the document to storage.
    fn save_doc(&self, doc: &mut AutoCommit, doc_id: &DocumentId) -> Result<(), SyncDishError> {
        let bytes = doc.save();
        self.storage.save(doc_id, &bytes)?;
        Ok(())
    }

    /// Creates a new dish.
    pub fn create(&self, dish: &Dish) -> Result<Dish, SyncDishError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;

        // Write to Automerge
        writer::write_dish(&mut doc, dish);

        // Save
        self.save_doc(&mut doc, &doc_id)?;

        // Return the dish (read back to confirm)
        self.get_by_id(dish.id)?
            .ok_or_else(|| SyncDishError::NotFound(dish.id.to_string()))
    }

    /// Updates an existing dish.
    pub fn update(&self, dish: &Dish) -> Result<Dish, SyncDishError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;

        // Write updated dish to Automerge (overwrites existing)
        writer::write_dish(&mut doc, dish);

        // Save
        self.save_doc(&mut doc, &doc_id)?;

        // Return the updated dish
        self.get_by_id(dish.id)?
            .ok_or_else(|| SyncDishError::NotFound(dish.id.to_string()))
    }

    /// Deletes a dish by ID.
    pub fn delete(&self, id: Uuid) -> Result<(), SyncDishError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;

        // Delete from Automerge
        writer::delete_dish(&mut doc, id);

        // Save
        self.save_doc(&mut doc, &doc_id)?;

        Ok(())
    }

    /// Gets a dish by ID.
    pub fn get_by_id(&self, id: Uuid) -> Result<Option<Dish>, SyncDishError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_dish_by_id(&doc, id)?)
    }

    /// Gets a dish by name (case-insensitive).
    pub fn get_by_name(&self, name: &str) -> Result<Option<Dish>, SyncDishError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(find_dish_by_name(&doc, name)?)
    }

    /// Lists all dishes.
    pub fn list(&self) -> Result<Vec<Dish>, SyncDishError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_all_dishes(&doc)?)
    }

    /// Adds an ingredient to a dish.
    pub fn add_ingredient(
        &self,
        dish_id: Uuid,
        ingredient: Ingredient,
    ) -> Result<(), SyncDishError> {
        // Get current dish
        let mut dish = self
            .get_by_id(dish_id)?
            .ok_or_else(|| SyncDishError::NotFound(dish_id.to_string()))?;

        // Add ingredient
        dish.ingredients.push(ingredient);

        // Update
        self.update(&dish)?;

        Ok(())
    }

    /// Removes an ingredient from a dish by name.
    pub fn remove_ingredient(
        &self,
        dish_id: Uuid,
        ingredient_name: &str,
    ) -> Result<(), SyncDishError> {
        // Get current dish
        let mut dish = self
            .get_by_id(dish_id)?
            .ok_or_else(|| SyncDishError::NotFound(dish_id.to_string()))?;

        // Remove ingredient (case-insensitive)
        let name_lower = ingredient_name.to_lowercase();
        dish.ingredients
            .retain(|i| i.name.to_lowercase() != name_lower);

        // Update
        self.update(&dish)?;

        Ok(())
    }

    /// Searches dishes by name, tags, or ingredient names (partial, case-insensitive).
    pub fn search(&self, query: &str) -> Result<Vec<Dish>, SyncDishError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(search_dishes(&doc, query)?)
    }

    /// Filters dishes by tag.
    #[allow(dead_code)]
    pub fn filter_by_tag(&self, tag: &str) -> Result<Vec<Dish>, SyncDishError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(filter_dishes_by_tag(&doc, tag)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::writer;
    use automerge::AutoCommit;
    use tempfile::TempDir;

    /// Test helper that bypasses identity/group requirements.
    /// Works directly with a document and storage.
    struct TestDishRepo {
        storage: MultiDocStorage,
        doc_id: DocumentId,
    }

    impl TestDishRepo {
        fn new(temp_dir: &TempDir) -> Self {
            let storage = MultiDocStorage::new(temp_dir.path().to_path_buf());
            let doc_id = DocumentId::new();
            Self { storage, doc_id }
        }

        fn load_or_create_doc(&self) -> AutoCommit {
            match self.storage.load(&self.doc_id).unwrap() {
                Some(bytes) => AutoCommit::load(&bytes).unwrap(),
                None => AutoCommit::new(),
            }
        }

        fn save_doc(&self, doc: &mut AutoCommit) {
            let bytes = doc.save();
            self.storage.save(&self.doc_id, &bytes).unwrap();
        }

        fn create(&self, dish: &Dish) -> Dish {
            let mut doc = self.load_or_create_doc();
            writer::write_dish(&mut doc, dish);
            self.save_doc(&mut doc);
            self.get_by_id(dish.id).unwrap()
        }

        fn update(&self, dish: &Dish) -> Dish {
            let mut doc = self.load_or_create_doc();
            writer::write_dish(&mut doc, dish);
            self.save_doc(&mut doc);
            self.get_by_id(dish.id).unwrap()
        }

        fn delete(&self, id: Uuid) {
            let mut doc = self.load_or_create_doc();
            writer::delete_dish(&mut doc, id);
            self.save_doc(&mut doc);
        }

        fn get_by_id(&self, id: Uuid) -> Option<Dish> {
            let doc = self.load_or_create_doc();
            read_dish_by_id(&doc, id).unwrap()
        }

        fn get_by_name(&self, name: &str) -> Option<Dish> {
            let doc = self.load_or_create_doc();
            find_dish_by_name(&doc, name).unwrap()
        }

        fn list(&self) -> Vec<Dish> {
            let doc = self.load_or_create_doc();
            read_all_dishes(&doc).unwrap()
        }

        fn search(&self, query: &str) -> Vec<Dish> {
            let doc = self.load_or_create_doc();
            search_dishes(&doc, query).unwrap()
        }

        fn filter_by_tag(&self, tag: &str) -> Vec<Dish> {
            let doc = self.load_or_create_doc();
            filter_dishes_by_tag(&doc, tag).unwrap()
        }

        fn add_ingredient(&self, dish_id: Uuid, ingredient: Ingredient) {
            let mut dish = self.get_by_id(dish_id).unwrap();
            dish.ingredients.push(ingredient);
            self.update(&dish);
        }

        fn remove_ingredient(&self, dish_id: Uuid, ingredient_name: &str) {
            let mut dish = self.get_by_id(dish_id).unwrap();
            let name_lower = ingredient_name.to_lowercase();
            dish.ingredients
                .retain(|i| i.name.to_lowercase() != name_lower);
            self.update(&dish);
        }
    }

    #[test]
    fn test_create_and_get() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestDishRepo::new(&temp_dir);

        let dish = Dish::new("Test Pasta", "chef");
        let created = repo.create(&dish);

        assert_eq!(created.name, "Test Pasta");
        assert_eq!(created.created_by, "chef");

        // Get by ID
        let fetched = repo.get_by_id(dish.id).unwrap();
        assert_eq!(fetched.name, "Test Pasta");

        // Get by name
        let fetched = repo.get_by_name("test pasta").unwrap();
        assert_eq!(fetched.id, dish.id);
    }

    #[test]
    fn test_update() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestDishRepo::new(&temp_dir);

        let mut dish = Dish::new("Original Name", "chef");
        repo.create(&dish);

        dish.name = "Updated Name".to_string();
        let updated = repo.update(&dish);

        assert_eq!(updated.name, "Updated Name");

        // Verify the update persisted
        let fetched = repo.get_by_id(dish.id).unwrap();
        assert_eq!(fetched.name, "Updated Name");
    }

    #[test]
    fn test_delete() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestDishRepo::new(&temp_dir);

        let dish = Dish::new("To Delete", "chef");
        repo.create(&dish);

        // Verify it exists
        assert!(repo.get_by_id(dish.id).is_some());

        // Delete
        repo.delete(dish.id);

        // Verify it's gone
        assert!(repo.get_by_id(dish.id).is_none());
    }

    #[test]
    fn test_list() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestDishRepo::new(&temp_dir);

        repo.create(&Dish::new("Dish 1", "chef"));
        repo.create(&Dish::new("Dish 2", "chef"));
        repo.create(&Dish::new("Dish 3", "chef"));

        let dishes = repo.list();
        assert_eq!(dishes.len(), 3);
    }

    #[test]
    fn test_search() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestDishRepo::new(&temp_dir);

        repo.create(&Dish::new("Chicken Pasta", "chef"));
        repo.create(&Dish::new("Beef Stew", "chef"));
        repo.create(&Dish::new("Chicken Soup", "chef"));

        let results = repo.search("chicken");
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_search_by_tag() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestDishRepo::new(&temp_dir);

        repo.create(&Dish::new("Chicken Pasta", "chef"));
        repo.create(&Dish::new("Beef Stew", "chef").with_tags(vec!["comfort".into()]));

        let results = repo.search("comfort");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Beef Stew");
    }

    #[test]
    fn test_search_by_ingredient() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestDishRepo::new(&temp_dir);

        repo.create(&Dish::new("Chicken Pasta", "chef"));
        repo.create(
            &Dish::new("Beef Stew", "chef")
                .with_ingredients(vec![Ingredient::new("carrot", 2.0, "")]),
        );

        let results = repo.search("carrot");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Beef Stew");
    }

    #[test]
    fn test_search_is_case_insensitive() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestDishRepo::new(&temp_dir);

        repo.create(&Dish::new("Chicken Pasta", "chef"));
        repo.create(
            &Dish::new("Beef Stew", "chef")
                .with_ingredients(vec![Ingredient::new("carrot", 2.0, "")]),
        );

        let results = repo.search("CARROT");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Beef Stew");
    }

    #[test]
    fn test_filter_by_tag() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestDishRepo::new(&temp_dir);

        let mut dish1 = Dish::new("Dish 1", "chef");
        dish1.tags = vec!["keto".to_string(), "quick".to_string()];
        repo.create(&dish1);

        let mut dish2 = Dish::new("Dish 2", "chef");
        dish2.tags = vec!["vegetarian".to_string()];
        repo.create(&dish2);

        let mut dish3 = Dish::new("Dish 3", "chef");
        dish3.tags = vec!["keto".to_string()];
        repo.create(&dish3);

        let results = repo.filter_by_tag("keto");
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_add_ingredient() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestDishRepo::new(&temp_dir);

        let dish = Dish::new("Test Dish", "chef");
        repo.create(&dish);

        let ingredient = Ingredient::new("Salt", 1.0, "tsp");
        repo.add_ingredient(dish.id, ingredient);

        let fetched = repo.get_by_id(dish.id).unwrap();
        assert_eq!(fetched.ingredients.len(), 1);
        assert_eq!(fetched.ingredients[0].name, "Salt");
    }

    #[test]
    fn test_remove_ingredient() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestDishRepo::new(&temp_dir);

        let mut dish = Dish::new("Test Dish", "chef");
        dish.ingredients = vec![
            Ingredient::new("Salt", 1.0, "tsp"),
            Ingredient::new("Pepper", 0.5, "tsp"),
        ];
        repo.create(&dish);

        repo.remove_ingredient(dish.id, "salt");

        let fetched = repo.get_by_id(dish.id).unwrap();
        assert_eq!(fetched.ingredients.len(), 1);
        assert_eq!(fetched.ingredients[0].name, "Pepper");
    }
}
