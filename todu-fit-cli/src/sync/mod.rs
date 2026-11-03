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
pub mod group_context;
pub mod hydration_sync;
pub mod reader;
#[cfg(test)]
pub mod schema;
pub mod shopping_sync;
pub mod writer;

pub use auto_sync::try_auto_sync;
pub use client::{SyncClient, SyncClientError};
#[allow(unused_imports)]
pub use hydration_sync::SyncHydrationRepository;
pub use shopping_sync::SyncShoppingRepository;
pub use todu_fit_core::DishRepository as SyncDishRepository;
pub use todu_fit_core::{
    MealLogRepository as SyncMealLogRepository, MealPlanRepository as SyncMealPlanRepository,
};
