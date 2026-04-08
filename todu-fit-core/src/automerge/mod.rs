//! Automerge document handling for Todu Fit.
//!
//! This module provides the foundation for syncing data across devices using
//! Automerge, a CRDT library that enables automatic conflict resolution.
//!
//! # Document Storage
//!
//! Documents are stored by their DocumentId in the data directory:
//! - `<doc_id>.automerge`: Automerge document binary
//! - `root_doc_id`: Text file with identity document ID
//!
//! # Legacy Document Types
//!
//! For backward compatibility, DocType is still available:
//! - `dishes.automerge`: Map of dish_id (UUID string) -> Dish object
//! - `mealplans.automerge`: Map of mealplan_id (UUID string) -> MealPlan object
//! - `meallogs.automerge`: Map of meallog_id (UUID string) -> MealLog object

mod doc_type;
mod multi_storage;
mod storage;
mod writer;

pub use doc_type::DocType;
pub use multi_storage::{MultiDocStorage, MultiStorageError};
pub use storage::{DocumentStorage, StorageError};
pub use writer::{
    delete_dish, delete_meallog, delete_mealplan, delete_shopping_cart, delete_water_entry,
    write_dish, write_hydration_settings, write_meallog, write_mealplan, write_shopping_cart,
    write_water_entry,
};
