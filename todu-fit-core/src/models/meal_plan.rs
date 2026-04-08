use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

use super::meal_type::MealType;

/// A meal plan represents a planned meal for a specific date.
///
/// Meal plans reference dishes by ID (live lookup) rather than embedding
/// the full dish data. This allows dishes to be updated without changing
/// the meal plan, and keeps the data model normalized.
#[derive(Debug, Clone, Serialize, Deserialize)]
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

impl MealPlan {
    pub fn new(
        date: NaiveDate,
        meal_type: MealType,
        title: impl Into<String>,
        created_by: impl Into<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            date,
            meal_type,
            title: title.into(),
            cook: "Unknown".to_string(),
            dish_ids: Vec::new(),
            uses_leftovers: false,
            created_by: created_by.into(),
            created_at: now,
            updated_at: now,
        }
    }

    pub fn with_cook(mut self, cook: impl Into<String>) -> Self {
        self.cook = cook.into();
        self
    }

    /// Set the dish IDs for this meal plan.
    pub fn with_dish_ids(mut self, dish_ids: Vec<Uuid>) -> Self {
        self.dish_ids = dish_ids;
        self
    }

    /// Mark whether this meal plan uses leftovers.
    pub fn with_uses_leftovers(mut self, uses_leftovers: bool) -> Self {
        self.uses_leftovers = uses_leftovers;
        self
    }

    /// Add a dish to this meal plan by ID.
    pub fn add_dish(&mut self, dish_id: Uuid) {
        if !self.dish_ids.contains(&dish_id) {
            self.dish_ids.push(dish_id);
            self.updated_at = Utc::now();
        }
    }

    /// Remove a dish from this meal plan by ID.
    pub fn remove_dish(&mut self, dish_id: &Uuid) -> bool {
        let len_before = self.dish_ids.len();
        self.dish_ids.retain(|id| id != dish_id);
        if self.dish_ids.len() != len_before {
            self.updated_at = Utc::now();
            true
        } else {
            false
        }
    }
}

impl fmt::Display for MealPlan {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "{}", self.title)?;
        writeln!(f, "{}", "=".repeat(self.title.len()))?;
        writeln!(f, "Date: {}", self.date)?;
        writeln!(f, "Meal: {}", self.meal_type)?;
        writeln!(f, "Cook: {}", self.cook)?;
        if self.uses_leftovers {
            writeln!(f, "Uses leftovers: yes")?;
        }

        if !self.dish_ids.is_empty() {
            writeln!(f, "\nDishes: {} dish(es)", self.dish_ids.len())?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_meal_plan_new() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let plan = MealPlan::new(date, MealType::Dinner, "New Year Dinner", "user1");

        assert_eq!(plan.date, date);
        assert_eq!(plan.meal_type, MealType::Dinner);
        assert_eq!(plan.title, "New Year Dinner");
        assert_eq!(plan.cook, "Unknown");
        assert!(plan.dish_ids.is_empty());
    }

    #[test]
    fn test_meal_plan_with_cook() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let plan = MealPlan::new(date, MealType::Lunch, "Lunch", "user1").with_cook("Chef Bob");

        assert_eq!(plan.cook, "Chef Bob");
    }

    #[test]
    fn test_meal_plan_with_dish_ids() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let dish_id = Uuid::new_v4();
        let plan =
            MealPlan::new(date, MealType::Dinner, "Dinner", "user1").with_dish_ids(vec![dish_id]);

        assert_eq!(plan.dish_ids.len(), 1);
        assert_eq!(plan.dish_ids[0], dish_id);
    }

    #[test]
    fn test_meal_plan_with_uses_leftovers() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let plan =
            MealPlan::new(date, MealType::Dinner, "Dinner", "user1").with_uses_leftovers(true);

        assert!(plan.uses_leftovers);
    }

    #[test]
    fn test_meal_plan_add_dish() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let mut plan = MealPlan::new(date, MealType::Dinner, "Dinner", "user1");
        let dish_id = Uuid::new_v4();

        plan.add_dish(dish_id);
        assert_eq!(plan.dish_ids.len(), 1);

        // Adding same dish again should not duplicate
        plan.add_dish(dish_id);
        assert_eq!(plan.dish_ids.len(), 1);
    }

    #[test]
    fn test_meal_plan_remove_dish() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let dish_id = Uuid::new_v4();
        let mut plan =
            MealPlan::new(date, MealType::Dinner, "Dinner", "user1").with_dish_ids(vec![dish_id]);

        assert!(plan.remove_dish(&dish_id));
        assert!(plan.dish_ids.is_empty());

        // Removing again should return false
        assert!(!plan.remove_dish(&dish_id));
    }

    #[test]
    fn test_meal_plan_display() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let plan = MealPlan::new(date, MealType::Breakfast, "Morning Meal", "user1")
            .with_uses_leftovers(true);

        let output = format!("{}", plan);
        assert!(output.contains("Morning Meal"));
        assert!(output.contains("2025-01-01"));
        assert!(output.contains("breakfast"));
        assert!(output.contains("Uses leftovers: yes"));
    }

    #[test]
    fn test_meal_plan_json_roundtrip() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let dish_id = Uuid::new_v4();
        let plan = MealPlan::new(date, MealType::Dinner, "Test Dinner", "user1")
            .with_dish_ids(vec![dish_id])
            .with_uses_leftovers(true);

        let json = serde_json::to_string(&plan).unwrap();
        let parsed: MealPlan = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.title, plan.title);
        assert_eq!(parsed.meal_type, plan.meal_type);
        assert_eq!(parsed.date, plan.date);
        assert_eq!(parsed.dish_ids, plan.dish_ids);
        assert_eq!(parsed.uses_leftovers, plan.uses_leftovers);
    }

    #[test]
    fn test_meal_plan_json_defaults_uses_leftovers_to_false() {
        let json = r#"{
            "id":"550e8400-e29b-41d4-a716-446655440000",
            "date":"2025-01-01",
            "meal_type":"dinner",
            "title":"Dinner",
            "cook":"Chef",
            "dish_ids":[],
            "created_by":"user1",
            "created_at":"2025-01-01T00:00:00Z",
            "updated_at":"2025-01-01T00:00:00Z"
        }"#;

        let parsed: MealPlan = serde_json::from_str(json).unwrap();
        assert!(!parsed.uses_leftovers);
    }
}
