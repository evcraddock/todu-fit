//! Todu Fit Core Library
//!
//! Shared types and logic for Todu Fit applications.

pub mod automerge;
pub mod context;
pub mod dishes;
pub mod document_id;
pub mod documents;
pub mod hydration;
pub mod identity;
pub mod meal_logs;
pub mod meal_plans;
pub mod models;
pub mod shopping;
pub mod sync;

pub use automerge::{
    delete_dish, delete_meallog, delete_mealplan, delete_shopping_cart, delete_water_entry,
    write_dish, write_hydration_settings, write_meallog, write_mealplan, write_shopping_cart,
    write_water_entry, DocType, DocumentStorage, MultiDocStorage, MultiStorageError, StorageError,
};
pub use dishes::{DishError, DishRepository, DishUpdate};
pub use document_id::{DocumentId, DocumentIdError};
pub use documents::{GroupDocument, GroupRef, IdentityDocument};
pub use hydration::{HydrationError, HydrationRepository, HydrationSettingsUpdate};
pub use identity::{Identity, IdentityError, IdentityState};
pub use meal_logs::{MealLogDraft, MealLogError, MealLogRepository};
pub use meal_plans::{MealPlanDraft, MealPlanError, MealPlanRepository, MealPlanUpdate};
pub use models::{
    aggregate_ingredients, average_daily_ml, average_daily_ml_in_timezone,
    collect_ingredients_from_mealplans, daily_total_ml, daily_total_ml_in_timezone,
    default_quick_add_presets_ml, entries_for_date, entries_for_date_in_timezone, goal_progress,
    goal_progress_in_timezone, ml_from_oz, oz_from_ml, streak_days, streak_days_in_timezone, Dish,
    HydrationSettings, HydrationUnit, Ingredient, ManualItem, MealLog, MealPlan, MealType,
    Nutrient, ShoppingCart, ShoppingItem, WaterEntry,
};
pub use shopping::{ShoppingError, ShoppingList, ShoppingRepository};
pub use sync::{check_server, SyncClient, SyncError, SyncResult};

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        assert!(!version().is_empty());
    }
}
