//! Writers for serializing entities into Automerge documents.
//!
//! Re-exports from todu-fit-core.

// Re-export core writer functions
#[allow(unused_imports)]
pub use todu_fit_core::automerge::{
    delete_dish, delete_meallog, delete_mealplan, delete_water_entry, write_dish,
    write_hydration_settings, write_meallog, write_mealplan, write_water_entry,
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        Dish, HydrationSettings, HydrationUnit, Ingredient, MealLog, MealPlan, MealType, Nutrient,
        WaterEntry,
    };
    use automerge::{AutoCommit, ReadDoc, ROOT};
    use chrono::NaiveDate;

    #[test]
    fn test_write_dish_basic() {
        let mut doc = AutoCommit::new();
        let dish = Dish::new("Test Pasta", "chef");

        write_dish(&mut doc, &dish);

        // Verify dish exists
        let id_str = dish.id.to_string();
        assert!(doc.get(ROOT, &id_str).unwrap().is_some());
    }

    #[test]
    fn test_write_dish_with_ingredients() {
        let mut doc = AutoCommit::new();
        let dish = Dish::new("Pasta", "chef").with_ingredients(vec![
            Ingredient::new("pasta", 200.0, "g"),
            Ingredient::new("sauce", 1.0, "cup"),
        ]);

        write_dish(&mut doc, &dish);

        // Verify ingredients exist
        let id_str = dish.id.to_string();
        let (_, dish_obj) = doc.get(ROOT, &id_str).unwrap().unwrap();
        let (_, ingredients_obj) = doc.get(&dish_obj, "ingredients").unwrap().unwrap();
        assert_eq!(doc.length(&ingredients_obj), 2);
    }

    #[test]
    fn test_write_dish_with_nutrients() {
        let mut doc = AutoCommit::new();
        let dish = Dish::new("Healthy Meal", "chef").with_nutrients(vec![
            Nutrient::new("calories", 500.0, "kcal"),
            Nutrient::new("protein", 30.0, "g"),
        ]);

        write_dish(&mut doc, &dish);

        let id_str = dish.id.to_string();
        let (_, dish_obj) = doc.get(ROOT, &id_str).unwrap().unwrap();
        let (_, nutrients_obj) = doc.get(&dish_obj, "nutrients").unwrap().unwrap();
        assert_eq!(doc.length(&nutrients_obj), 2);
    }

    #[test]
    fn test_delete_dish() {
        let mut doc = AutoCommit::new();
        let dish = Dish::new("To Delete", "chef");
        let id = dish.id;

        write_dish(&mut doc, &dish);
        assert!(doc.get(ROOT, id.to_string()).unwrap().is_some());

        delete_dish(&mut doc, id);
        assert!(doc.get(ROOT, id.to_string()).unwrap().is_none());
    }

    #[test]
    fn test_write_mealplan() {
        let mut doc = AutoCommit::new();
        let date = NaiveDate::from_ymd_opt(2025, 1, 15).unwrap();
        let mealplan = MealPlan::new(date, MealType::Dinner, "Sunday Dinner", "chef");

        write_mealplan(&mut doc, &mealplan);

        let id_str = mealplan.id.to_string();
        assert!(doc.get(ROOT, &id_str).unwrap().is_some());
    }

    #[test]
    fn test_write_meallog() {
        let mut doc = AutoCommit::new();
        let date = NaiveDate::from_ymd_opt(2025, 1, 15).unwrap();
        let log = MealLog::new(date, MealType::Lunch, "chef");

        write_meallog(&mut doc, &log);

        let id_str = log.id.to_string();
        assert!(doc.get(ROOT, &id_str).unwrap().is_some());
    }

    #[test]
    fn test_write_water_entry_and_settings() {
        let mut doc = AutoCommit::new();
        let entry = WaterEntry::new(500, chrono::Utc::now()).unwrap();
        let settings = HydrationSettings::new(2000, HydrationUnit::Ml);

        write_water_entry(&mut doc, &entry);
        write_hydration_settings(&mut doc, &settings);

        assert!(doc.get(ROOT, entry.id.to_string()).unwrap().is_some());
        assert!(doc.get(ROOT, "settings").unwrap().is_some());

        delete_water_entry(&mut doc, entry.id);
        assert!(doc.get(ROOT, entry.id.to_string()).unwrap().is_none());
    }

    #[test]
    fn test_write_meallog_with_mealplan_id() {
        let mut doc = AutoCommit::new();
        let date = NaiveDate::from_ymd_opt(2025, 1, 15).unwrap();
        let mut log = MealLog::new(date, MealType::Lunch, "chef");
        let mealplan_id = uuid::Uuid::new_v4();
        log.mealplan_id = Some(mealplan_id);

        write_meallog(&mut doc, &log);

        let id_str = log.id.to_string();
        let (_, log_obj) = doc.get(ROOT, &id_str).unwrap().unwrap();
        let mealplan_value = doc.get(&log_obj, "mealplan_id").unwrap().unwrap().0;
        assert_eq!(
            mealplan_value.into_string().unwrap(),
            mealplan_id.to_string()
        );
    }
}
