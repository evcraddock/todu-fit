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

pub mod auto_sync;
pub mod client;
pub mod dish_sync;
pub mod group_context;
pub mod hydration_sync;
pub mod meallog_sync;
pub mod mealplan_sync;
pub mod reader;
#[cfg(test)]
pub mod schema;
pub mod shopping_sync;
pub mod writer;

pub use auto_sync::try_auto_sync;
pub use client::{SyncClient, SyncClientError};
pub use dish_sync::SyncDishRepository;
#[allow(unused_imports)]
pub use hydration_sync::SyncHydrationRepository;
pub use meallog_sync::SyncMealLogRepository;
pub use mealplan_sync::SyncMealPlanRepository;
pub use shopping_sync::SyncShoppingRepository;
