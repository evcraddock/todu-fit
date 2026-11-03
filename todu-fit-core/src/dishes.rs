//! Local dish application operations backed by Automerge documents.
//!
//! Network synchronization remains an explicit caller responsibility.
//!
//! This module provides a repository layer that uses the current group's
//! dishes document. Identity must be initialized first.

use std::path::PathBuf;

use automerge::AutoCommit;
use uuid::Uuid;

use crate::{DocumentId, MultiDocStorage};

use crate::automerge as writer;
use crate::automerge::reader::{
    filter_dishes_by_tag, find_dish_by_name, read_all_dishes, read_dish_by_id, search_dishes,
    ReaderError,
};
use crate::context::{resolve_group_context, GroupContextError};
use crate::models::{Dish, Ingredient, Nutrient};

/// Error type for local dish operations.
#[derive(Debug)]
pub enum DishError {
    /// Reader error (parsing Automerge data).
    Reader(ReaderError),
    /// Dish not found.
    NotFound(String),
    /// Group context error.
    GroupContext(GroupContextError),
    /// Multi-storage error.
    MultiStorage(crate::MultiStorageError),
}

impl std::fmt::Display for DishError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DishError::Reader(e) => write!(f, "Reader error: {}", e),
            DishError::NotFound(id) => write!(f, "Dish not found: {}", id),
            DishError::GroupContext(e) => write!(f, "{}", e),
            DishError::MultiStorage(e) => write!(f, "Storage error: {}", e),
        }
    }
}

impl std::error::Error for DishError {}

impl From<ReaderError> for DishError {
    fn from(e: ReaderError) -> Self {
        DishError::Reader(e)
    }
}

impl From<GroupContextError> for DishError {
    fn from(e: GroupContextError) -> Self {
        DishError::GroupContext(e)
    }
}

impl From<crate::MultiStorageError> for DishError {
    fn from(e: crate::MultiStorageError) -> Self {
        DishError::MultiStorage(e)
    }
}

/// Field changes for an existing dish; absent fields retain their current values.
///
/// Tags are added without case-insensitive duplicates, then removed case-insensitively.
/// Supplying nutrients replaces the existing list. IDs and timestamps are unchanged.
#[derive(Debug, Default)]
pub struct DishUpdate {
    pub name: Option<String>,
    pub instructions: Option<String>,
    pub prep_time: Option<i32>,
    pub cook_time: Option<i32>,
    pub servings: Option<i32>,
    pub image_url: Option<String>,
    pub source_url: Option<String>,
    pub add_tags: Vec<String>,
    pub remove_tags: Vec<String>,
    pub nutrients: Option<Vec<Nutrient>>,
}

impl DishUpdate {
    /// Apply field changes in place, preserving existing update and tag semantics.
    pub fn apply_to(&self, dish: &mut Dish) {
        if let Some(name) = &self.name {
            dish.name = name.clone();
        }
        if let Some(instructions) = &self.instructions {
            dish.instructions = instructions.clone();
        }
        if let Some(prep_time) = self.prep_time {
            dish.prep_time = Some(prep_time);
        }
        if let Some(cook_time) = self.cook_time {
            dish.cook_time = Some(cook_time);
        }
        if let Some(servings) = self.servings {
            dish.servings = Some(servings);
        }
        if let Some(image_url) = &self.image_url {
            dish.image_url = Some(image_url.clone());
        }
        if let Some(source_url) = &self.source_url {
            dish.source_url = Some(source_url.clone());
        }
        for tag in &self.add_tags {
            if !dish
                .tags
                .iter()
                .any(|t| t.to_lowercase() == tag.to_lowercase())
            {
                dish.tags.push(tag.clone());
            }
        }
        for tag in &self.remove_tags {
            let tag_lower = tag.to_lowercase();
            dish.tags.retain(|t| t.to_lowercase() != tag_lower);
        }
        if let Some(nutrients) = &self.nutrients {
            dish.nutrients = Some(nutrients.clone());
        }
    }
}

/// Local dish repository.
///
/// All operations work directly with the selected group's Automerge document.
/// The caller supplies a data root; parsing configuration, rendering results and
/// deciding when to synchronize belong to the application adapter.
///
/// ```no_run
/// use std::path::PathBuf;
/// use todu_fit_core::{Dish, DishRepository};
///
/// # fn main() -> Result<(), Box<dyn std::error::Error>> {
/// let repository = DishRepository::with_group(PathBuf::from("/app/data"), "Home");
/// let created = repository.create(&Dish::new("Pasta", "chef"))?;
/// assert!(repository.get_by_id(created.id)?.is_some());
/// # Ok(())
/// # }
/// ```
pub struct DishRepository {
    storage: MultiDocStorage,
    data_dir: PathBuf,
    group_override: Option<String>,
}

impl DishRepository {
    /// Creates a dish repository using the persisted current group or first group.
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            storage: MultiDocStorage::new(data_dir.clone()),
            data_dir,
            group_override: None,
        }
    }

    /// Creates a new repository with a specific group override.
    pub fn with_group(data_dir: PathBuf, group_name: &str) -> Self {
        Self {
            storage: MultiDocStorage::new(data_dir.clone()),
            data_dir,
            group_override: Some(group_name.to_string()),
        }
    }

    /// Resolves the dishes document ID from the current group context.
    fn resolve_doc_id(&self) -> Result<DocumentId, DishError> {
        let ctx = resolve_group_context(&self.data_dir, self.group_override.as_deref())?;
        Ok(ctx.dishes_doc_id)
    }

    /// Loads the dishes Automerge document, or creates a new empty one.
    fn load_or_create_doc(&self) -> Result<(AutoCommit, DocumentId), DishError> {
        let doc_id = self.resolve_doc_id()?;
        let doc = match self.storage.load(&doc_id)? {
            Some(bytes) => AutoCommit::load(&bytes)
                .map_err(|e| DishError::Reader(ReaderError::AutomergeError(e.to_string())))?,
            None => AutoCommit::new(),
        };
        Ok((doc, doc_id))
    }

    /// Saves the document to storage.
    fn save_doc(&self, doc: &mut AutoCommit, doc_id: &DocumentId) -> Result<(), DishError> {
        let bytes = doc.save();
        self.storage.save(doc_id, &bytes)?;
        Ok(())
    }

    /// Creates a new dish.
    pub fn create(&self, dish: &Dish) -> Result<Dish, DishError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;

        // Write to Automerge
        writer::write_dish(&mut doc, dish);

        // Save
        self.save_doc(&mut doc, &doc_id)?;

        // Return the dish (read back to confirm)
        self.get_by_id(dish.id)?
            .ok_or_else(|| DishError::NotFound(dish.id.to_string()))
    }

    /// Updates an existing dish.
    pub fn update(&self, dish: &Dish) -> Result<Dish, DishError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;

        // Write updated dish to Automerge (overwrites existing)
        writer::write_dish(&mut doc, dish);

        // Save
        self.save_doc(&mut doc, &doc_id)?;

        // Return the updated dish
        self.get_by_id(dish.id)?
            .ok_or_else(|| DishError::NotFound(dish.id.to_string()))
    }

    /// Deletes a dish by ID.
    pub fn delete(&self, id: Uuid) -> Result<(), DishError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;

        // Delete from Automerge
        writer::delete_dish(&mut doc, id);

        // Save
        self.save_doc(&mut doc, &doc_id)?;

        Ok(())
    }

    /// Gets a dish by ID.
    pub fn get_by_id(&self, id: Uuid) -> Result<Option<Dish>, DishError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_dish_by_id(&doc, id)?)
    }

    /// Gets a dish by name (case-insensitive).
    pub fn get_by_name(&self, name: &str) -> Result<Option<Dish>, DishError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(find_dish_by_name(&doc, name)?)
    }

    /// Lists all dishes.
    pub fn list(&self) -> Result<Vec<Dish>, DishError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_all_dishes(&doc)?)
    }

    /// Adds an ingredient to a dish.
    pub fn add_ingredient(&self, dish_id: Uuid, ingredient: Ingredient) -> Result<(), DishError> {
        // Get current dish
        let mut dish = self
            .get_by_id(dish_id)?
            .ok_or_else(|| DishError::NotFound(dish_id.to_string()))?;

        // Add ingredient
        dish.ingredients.push(ingredient);

        // Update
        self.update(&dish)?;

        Ok(())
    }

    /// Removes an ingredient from a dish by name.
    pub fn remove_ingredient(&self, dish_id: Uuid, ingredient_name: &str) -> Result<(), DishError> {
        // Get current dish
        let mut dish = self
            .get_by_id(dish_id)?
            .ok_or_else(|| DishError::NotFound(dish_id.to_string()))?;

        // Remove ingredient (case-insensitive)
        let name_lower = ingredient_name.to_lowercase();
        dish.ingredients
            .retain(|i| i.name.to_lowercase() != name_lower);

        // Update
        self.update(&dish)?;

        Ok(())
    }

    /// Searches dishes by name, tags, or ingredient names (partial, case-insensitive).
    pub fn search(&self, query: &str) -> Result<Vec<Dish>, DishError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(search_dishes(&doc, query)?)
    }

    /// Filters dishes by tag.
    pub fn filter_by_tag(&self, tag: &str) -> Result<Vec<Dish>, DishError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(filter_dishes_by_tag(&doc, tag)?)
    }
}
