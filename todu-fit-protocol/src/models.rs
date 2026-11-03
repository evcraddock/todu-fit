//! Stable wire data, deliberately independent of the Core model implementation.
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Dish {
    pub id: Uuid,
    pub name: String,
    pub ingredients: Vec<Ingredient>,
    pub instructions: String,
    pub nutrients: Option<Vec<Nutrient>>,
    pub prep_time: Option<i32>, // minutes
    pub cook_time: Option<i32>, // minutes
    pub servings: Option<i32>,
    pub tags: Vec<String>,
    pub image_url: Option<String>,
    pub source_url: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Ingredient {
    pub name: String,
    pub quantity: f64,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Nutrient {
    pub name: String,
    pub amount: f64,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MealPlan {
    pub id: Uuid,
    pub date: NaiveDate,
    pub meal_type: MealType,
    pub title: String,
    pub cook: String,
    /// References to dishes by UUID (resolved at display time)
    pub dish_ids: Vec<Uuid>,
    /// When true, this meal is using leftovers and should not contribute
    /// fresh dish ingredients to shared shopping-list generation.
    #[serde(default)]
    pub uses_leftovers: bool,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MealLog {
    pub id: Uuid,
    pub date: NaiveDate,
    pub meal_type: MealType,
    pub mealplan_id: Option<Uuid>,
    /// Dish snapshots - full copies of dishes as they were when logged.
    /// These are not references; modifying the original dish won't affect logs.
    pub dishes: Vec<Dish>,
    /// Actual servings eaten for each dish snapshot, keyed by dish ID.
    /// Missing entries are one full serving for backwards compatibility.
    #[serde(default)]
    pub dish_portions: HashMap<Uuid, f64>,
    pub notes: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WaterEntry {
    pub id: Uuid,
    pub consumed_at: DateTime<Utc>,
    pub amount_ml: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HydrationSettings {
    pub daily_goal_ml: i32,
    pub preferred_unit: HydrationUnit,
    pub quick_add_presets_ml: Vec<i32>,
    pub timezone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManualItem {
    /// Item name
    pub name: String,
    /// Optional quantity (as string to allow "2" or "a few")
    pub quantity: Option<String>,
    /// Optional unit (e.g., "rolls", "bags")
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ShoppingCart {
    /// Week start date as string (YYYY-MM-DD, always a Sunday)
    pub week: String,
    /// Names of items that have been checked off (case-normalized)
    pub checked: Vec<String>,
    /// Manual items added to the cart
    pub manual_items: Vec<ManualItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ShoppingItem {
    /// Item name
    pub name: String,
    /// Quantity (may be aggregated from multiple recipes)
    pub quantity: f64,
    /// Unit
    pub unit: String,
    /// Whether this item has been checked off
    pub checked: bool,
    /// Whether this is a manual item (vs auto-generated from recipes)
    pub is_manual: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MealType {
    Breakfast,
    Lunch,
    Dinner,
    Snack,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HydrationUnit {
    Ml,
    Oz,
}
