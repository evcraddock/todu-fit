//! Local shopping cart repository that reads/writes Automerge documents.
//!
//! Network synchronization remains an explicit caller responsibility.
//!
//! This module provides a repository layer that uses the current group's
//! shopping carts document. Identity must be initialized first.

use std::path::PathBuf;

use crate::{
    aggregate_ingredients, collect_ingredients_from_mealplans, DishRepository, ManualItem,
    MealPlanRepository, ShoppingItem,
};
use automerge::AutoCommit;
use chrono::{Datelike, NaiveDate};

use crate::{write_shopping_cart, DocumentId, MultiDocStorage, ShoppingCart};

use crate::automerge::reader::{read_all_shopping_carts, read_shopping_cart_by_week, ReaderError};
use crate::context::{resolve_group_context, GroupContextError};

/// Error type for local shopping cart operations.
#[derive(Debug)]
pub enum ShoppingError {
    /// Reader error (parsing Automerge data).
    Reader(ReaderError),
    /// Shopping cart not found.
    NotFound(String),
    /// Item not found.
    ItemNotFound(String),
    /// Item is not a manual item (cannot remove).
    NotManualItem(String),
    /// Group context error.
    GroupContext(GroupContextError),
    /// Multi-storage error.
    MultiStorage(crate::MultiStorageError),
}

impl std::fmt::Display for ShoppingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ShoppingError::Reader(e) => write!(f, "Reader error: {}", e),
            ShoppingError::NotFound(week) => {
                write!(f, "Shopping cart not found for week: {}", week)
            }
            ShoppingError::ItemNotFound(name) => write!(f, "Item not found: {}", name),
            ShoppingError::NotManualItem(name) => {
                write!(
                    f,
                    "Cannot remove '{}': only manual items can be removed",
                    name
                )
            }
            ShoppingError::GroupContext(e) => write!(f, "{}", e),
            ShoppingError::MultiStorage(e) => write!(f, "Storage error: {}", e),
        }
    }
}

impl std::error::Error for ShoppingError {}

impl From<ReaderError> for ShoppingError {
    fn from(e: ReaderError) -> Self {
        ShoppingError::Reader(e)
    }
}

impl From<GroupContextError> for ShoppingError {
    fn from(e: GroupContextError) -> Self {
        ShoppingError::GroupContext(e)
    }
}

impl From<crate::MultiStorageError> for ShoppingError {
    fn from(e: crate::MultiStorageError) -> Self {
        ShoppingError::MultiStorage(e)
    }
}

/// Computed shopping view. Only `cart` is persisted; recipe ingredients are derived.
pub struct ShoppingList {
    pub cart: ShoppingCart,
    pub items: Vec<ShoppingItem>,
}

/// Local shopping cart repository.
///
/// All operations work directly with Automerge documents.
/// Uses the current group's shopping carts document.
pub struct ShoppingRepository {
    storage: MultiDocStorage,
    data_dir: PathBuf,
    group_override: Option<String>,
}

impl ShoppingRepository {
    /// Build the selected week's view using the existing Core collection/aggregation
    /// rules (including leftovers exclusion and first-unit behavior).
    pub fn list_for_week(
        &self,
        week: NaiveDate,
        plans: &MealPlanRepository,
        dishes: &DishRepository,
    ) -> Result<ShoppingList, Box<dyn std::error::Error>> {
        let end = week + chrono::Duration::days(6);
        let cart = self.get_or_create(&week.to_string())?;
        let plans = plans.list_range(week, end)?;
        // Preserve the previous CLI's behavior: unavailable/failed dish lookups
        // contribute no ingredients. Changing that error policy is separate work.
        let ingredients =
            collect_ingredients_from_mealplans(&plans, |id| dishes.get_by_id(id).ok().flatten());
        let aggregated = aggregate_ingredients(&ingredients);
        let mut items: Vec<_> = aggregated
            .iter()
            .map(|ingredient| {
                ShoppingItem::from_ingredient(ingredient, cart.is_checked(&ingredient.name))
            })
            .collect();
        for item in &cart.manual_items {
            items.push(ShoppingItem::from_manual(item, cart.is_checked(&item.name)));
        }
        items.sort_by(|a, b| {
            if a.checked != b.checked {
                a.checked.cmp(&b.checked)
            } else {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            }
        });
        Ok(ShoppingList { cart, items })
    }

    /// Add a manual item if its case-insensitive name is not already present.
    /// A duplicate returns false without writing.
    pub fn add_manual_item(&self, week: &str, item: ManualItem) -> Result<bool, ShoppingError> {
        let mut cart = self.get_or_create(week)?;
        if cart.find_manual_item(&item.name).is_some() {
            return Ok(false);
        }
        cart.add_manual_item(item);
        self.save(&cart)?;
        Ok(true)
    }

    /// Remove only manual items. A missing name returns false without writing.
    pub fn remove_manual_item(&self, week: &str, name: &str) -> Result<bool, ShoppingError> {
        let mut cart = self.get_or_create(week)?;
        if !cart.remove_manual_item(name) {
            return Ok(false);
        }
        self.save(&cart)?;
        Ok(true)
    }

    /// Return whether the checked state changed; no-op requests do not write.
    pub fn set_checked(
        &self,
        week: &str,
        name: &str,
        checked: bool,
    ) -> Result<bool, ShoppingError> {
        let mut cart = self.get_or_create(week)?;
        if cart.is_checked(name) == checked {
            return Ok(false);
        }
        if checked {
            cart.check(name);
        } else {
            cart.uncheck(name);
        }
        self.save(&cart)?;
        Ok(true)
    }

    /// Clear checked names and return the original count, without writing if empty.
    pub fn clear_checked(&self, week: &str) -> Result<usize, ShoppingError> {
        let mut cart = self.get_or_create(week)?;
        let count = cart.checked.len();
        if count > 0 {
            cart.clear_checked();
            self.save(&cart)?;
        }
        Ok(count)
    }

    /// Creates a new local shopping cart repository.
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

    /// Resolves the shopping carts document ID from the current group context.
    fn resolve_doc_id(&self) -> Result<DocumentId, ShoppingError> {
        let ctx = resolve_group_context(&self.data_dir, self.group_override.as_deref())?;
        Ok(ctx.shopping_carts_doc_id)
    }

    /// Loads the shopping carts Automerge document, or creates a new empty one.
    fn load_or_create_doc(&self) -> Result<(AutoCommit, DocumentId), ShoppingError> {
        let doc_id = self.resolve_doc_id()?;
        let doc = match self.storage.load(&doc_id)? {
            Some(bytes) => AutoCommit::load(&bytes)
                .map_err(|e| ShoppingError::Reader(ReaderError::AutomergeError(e.to_string())))?,
            None => AutoCommit::new(),
        };
        Ok((doc, doc_id))
    }

    /// Saves the document to storage.
    fn save_doc(&self, doc: &mut AutoCommit, doc_id: &DocumentId) -> Result<(), ShoppingError> {
        let bytes = doc.save();
        self.storage.save(doc_id, &bytes)?;
        Ok(())
    }

    /// Gets a shopping cart for a specific week.
    /// Returns an empty cart if none exists.
    pub fn get_or_create(&self, week: &str) -> Result<ShoppingCart, ShoppingError> {
        let (doc, _) = self.load_or_create_doc()?;
        match read_shopping_cart_by_week(&doc, week)? {
            Some(cart) => Ok(cart),
            None => Ok(ShoppingCart::new(week)),
        }
    }

    /// Gets a shopping cart for a specific week.
    pub fn get(&self, week: &str) -> Result<Option<ShoppingCart>, ShoppingError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_shopping_cart_by_week(&doc, week)?)
    }

    /// Lists all shopping carts (sorted newest first).
    pub fn list(&self) -> Result<Vec<ShoppingCart>, ShoppingError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_all_shopping_carts(&doc)?)
    }

    /// Saves a shopping cart.
    pub fn save(&self, cart: &ShoppingCart) -> Result<(), ShoppingError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;
        write_shopping_cart(&mut doc, cart);
        self.save_doc(&mut doc, &doc_id)?;
        Ok(())
    }
}

/// Sunday starting the week that contains the supplied calendar date.
pub fn week_start(date: NaiveDate) -> NaiveDate {
    let days_since_sunday = date.weekday().num_days_from_sunday();
    date - chrono::Duration::days(days_since_sunday as i64)
}
