//! Sync module for offline-first data synchronization using Automerge CRDTs.
//!
//! This module provides the foundation for syncing data across devices using
//! Automerge, a CRDT library that enables automatic conflict resolution.
//!
//! # Document Structure
//!
//! Each entity type has its own Automerge document:
//! - `dishes`: Map of dish_id (UUID string) -> Dish object
//! - `mealplans`: Map of mealplan_id (UUID string) -> MealPlan object
//! - `meallogs`: Map of meallog_id (UUID string) -> MealLog object
//!
//! # Usage
//!
//! ```ignore
//! use crate::sync::{DishesDoc, MealPlansDoc, MealLogsDoc};
//!
//! // Create empty documents
//! let dishes = DishesDoc::new();
//! let mealplans = MealPlansDoc::new();
//! let meallogs = MealLogsDoc::new();
//! ```

pub mod client;
#[cfg(test)]
pub mod schema;
pub mod writer;

pub use client::{SyncClient, SyncClientError};
pub use todu_fit_core::DishRepository as SyncDishRepository;
pub use todu_fit_core::{
    HydrationRepository as SyncHydrationRepository, ShoppingRepository as SyncShoppingRepository,
};
pub use todu_fit_core::{
    MealLogRepository as SyncMealLogRepository, MealPlanRepository as SyncMealPlanRepository,
};
