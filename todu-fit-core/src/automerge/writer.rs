//! Writers for serializing entities into Automerge documents.
//!
//! These functions handle converting Rust structs into Automerge document structure.

use automerge::{transaction::Transactable, AutoCommit, ObjType, ROOT};
use uuid::Uuid;

use crate::models::{Dish, HydrationSettings, MealLog, MealPlan, ShoppingCart, WaterEntry};

/// Writes a dish to an Automerge document.
///
/// The dish is stored at root[dish.id.to_string()].
pub fn write_dish(doc: &mut AutoCommit, dish: &Dish) {
    let id_str = dish.id.to_string();

    // Create or overwrite the dish object
    let dish_id = doc
        .put_object(ROOT, &id_str, ObjType::Map)
        .expect("Failed to create dish object");

    doc.put(&dish_id, "name", dish.name.as_str()).unwrap();
    doc.put(&dish_id, "instructions", dish.instructions.as_str())
        .unwrap();
    doc.put(&dish_id, "created_by", dish.created_by.as_str())
        .unwrap();
    doc.put(
        &dish_id,
        "created_at",
        dish.created_at.to_rfc3339().as_str(),
    )
    .unwrap();
    doc.put(
        &dish_id,
        "updated_at",
        dish.updated_at.to_rfc3339().as_str(),
    )
    .unwrap();

    // Optional fields
    if let Some(prep_time) = dish.prep_time {
        doc.put(&dish_id, "prep_time", prep_time as i64).unwrap();
    }
    if let Some(cook_time) = dish.cook_time {
        doc.put(&dish_id, "cook_time", cook_time as i64).unwrap();
    }
    if let Some(servings) = dish.servings {
        doc.put(&dish_id, "servings", servings as i64).unwrap();
    }
    if let Some(ref url) = dish.image_url {
        doc.put(&dish_id, "image_url", url.as_str()).unwrap();
    }
    if let Some(ref url) = dish.source_url {
        doc.put(&dish_id, "source_url", url.as_str()).unwrap();
    }

    // Tags
    let tags_id = doc.put_object(&dish_id, "tags", ObjType::List).unwrap();
    for (i, tag) in dish.tags.iter().enumerate() {
        doc.insert(&tags_id, i, tag.as_str()).unwrap();
    }

    // Ingredients
    let ingredients_id = doc
        .put_object(&dish_id, "ingredients", ObjType::List)
        .unwrap();
    for (i, ingredient) in dish.ingredients.iter().enumerate() {
        let ing_id = doc.insert_object(&ingredients_id, i, ObjType::Map).unwrap();
        doc.put(&ing_id, "name", ingredient.name.as_str()).unwrap();
        doc.put(&ing_id, "quantity", ingredient.quantity).unwrap();
        doc.put(&ing_id, "unit", ingredient.unit.as_str()).unwrap();
    }

    // Nutrients
    if let Some(ref nutrients) = dish.nutrients {
        let nutrients_id = doc
            .put_object(&dish_id, "nutrients", ObjType::List)
            .unwrap();
        for (i, nutrient) in nutrients.iter().enumerate() {
            let nut_id = doc.insert_object(&nutrients_id, i, ObjType::Map).unwrap();
            doc.put(&nut_id, "name", nutrient.name.as_str()).unwrap();
            doc.put(&nut_id, "amount", nutrient.amount).unwrap();
            doc.put(&nut_id, "unit", nutrient.unit.as_str()).unwrap();
        }
    }
}

/// Deletes a dish from an Automerge document.
pub fn delete_dish(doc: &mut AutoCommit, id: Uuid) {
    let id_str = id.to_string();
    let _ = doc.delete(ROOT, &id_str);
}

/// Writes a meal plan to an Automerge document.
///
/// The meal plan is stored at root[mealplan.id.to_string()].
/// Dishes are stored as a list of UUIDs (references to be resolved at display time).
pub fn write_mealplan(doc: &mut AutoCommit, mealplan: &MealPlan) {
    let id_str = mealplan.id.to_string();

    let plan_id = doc
        .put_object(ROOT, &id_str, ObjType::Map)
        .expect("Failed to create mealplan object");

    doc.put(&plan_id, "date", mealplan.date.to_string().as_str())
        .unwrap();
    doc.put(
        &plan_id,
        "meal_type",
        mealplan.meal_type.to_string().as_str(),
    )
    .unwrap();
    doc.put(&plan_id, "title", mealplan.title.as_str()).unwrap();
    doc.put(&plan_id, "cook", mealplan.cook.as_str()).unwrap();
    doc.put(&plan_id, "uses_leftovers", mealplan.uses_leftovers)
        .unwrap();
    doc.put(&plan_id, "created_by", mealplan.created_by.as_str())
        .unwrap();
    doc.put(
        &plan_id,
        "created_at",
        mealplan.created_at.to_rfc3339().as_str(),
    )
    .unwrap();
    doc.put(
        &plan_id,
        "updated_at",
        mealplan.updated_at.to_rfc3339().as_str(),
    )
    .unwrap();

    // Dish IDs as list of UUIDs (references, resolved at display time)
    let dish_ids_obj = doc.put_object(&plan_id, "dish_ids", ObjType::List).unwrap();
    for (i, dish_id) in mealplan.dish_ids.iter().enumerate() {
        doc.insert(&dish_ids_obj, i, dish_id.to_string().as_str())
            .unwrap();
    }
}

/// Deletes a meal plan from an Automerge document.
pub fn delete_mealplan(doc: &mut AutoCommit, id: Uuid) {
    let id_str = id.to_string();
    let _ = doc.delete(ROOT, &id_str);
}

/// Writes a meal log to an Automerge document.
///
/// The meal log is stored at root[meallog.id.to_string()].
/// Dishes are stored as full snapshots (embedded data, not references) for historical accuracy.
pub fn write_meallog(doc: &mut AutoCommit, meallog: &MealLog) {
    let id_str = meallog.id.to_string();

    let log_id = doc
        .put_object(ROOT, &id_str, ObjType::Map)
        .expect("Failed to create meallog object");

    doc.put(&log_id, "date", meallog.date.to_string().as_str())
        .unwrap();
    doc.put(&log_id, "meal_type", meallog.meal_type.to_string().as_str())
        .unwrap();
    doc.put(&log_id, "created_by", meallog.created_by.as_str())
        .unwrap();
    doc.put(
        &log_id,
        "created_at",
        meallog.created_at.to_rfc3339().as_str(),
    )
    .unwrap();

    if let Some(ref plan_id) = meallog.mealplan_id {
        doc.put(&log_id, "mealplan_id", plan_id.to_string().as_str())
            .unwrap();
    }

    if let Some(ref notes) = meallog.notes {
        doc.put(&log_id, "notes", notes.as_str()).unwrap();
    }

    // Dish snapshots (full embedded data for historical accuracy)
    let dishes_list = doc.put_object(&log_id, "dishes", ObjType::List).unwrap();
    for (i, dish) in meallog.dishes.iter().enumerate() {
        let dish_obj = doc.insert_object(&dishes_list, i, ObjType::Map).unwrap();

        doc.put(&dish_obj, "id", dish.id.to_string().as_str())
            .unwrap();
        doc.put(&dish_obj, "name", dish.name.as_str()).unwrap();
        doc.put(&dish_obj, "instructions", dish.instructions.as_str())
            .unwrap();
        doc.put(&dish_obj, "created_by", dish.created_by.as_str())
            .unwrap();

        // Tags
        let tags_id = doc.put_object(&dish_obj, "tags", ObjType::List).unwrap();
        for (j, tag) in dish.tags.iter().enumerate() {
            doc.insert(&tags_id, j, tag.as_str()).unwrap();
        }

        // Ingredients
        let ingredients_id = doc
            .put_object(&dish_obj, "ingredients", ObjType::List)
            .unwrap();
        for (j, ingredient) in dish.ingredients.iter().enumerate() {
            let ing_id = doc.insert_object(&ingredients_id, j, ObjType::Map).unwrap();
            doc.put(&ing_id, "name", ingredient.name.as_str()).unwrap();
            doc.put(&ing_id, "quantity", ingredient.quantity).unwrap();
            doc.put(&ing_id, "unit", ingredient.unit.as_str()).unwrap();
        }

        // Optional fields
        if let Some(prep_time) = dish.prep_time {
            doc.put(&dish_obj, "prep_time", prep_time as i64).unwrap();
        }
        if let Some(cook_time) = dish.cook_time {
            doc.put(&dish_obj, "cook_time", cook_time as i64).unwrap();
        }
        if let Some(servings) = dish.servings {
            doc.put(&dish_obj, "servings", servings as i64).unwrap();
        }
    }

    if !meallog.dish_portions.is_empty() {
        let portions_id = doc
            .put_object(&log_id, "dish_portions", ObjType::Map)
            .unwrap();
        for (dish_id, portion) in &meallog.dish_portions {
            doc.put(&portions_id, dish_id.to_string(), *portion)
                .unwrap();
        }
    }
}

/// Deletes a meal log from an Automerge document.
pub fn delete_meallog(doc: &mut AutoCommit, id: Uuid) {
    let id_str = id.to_string();
    let _ = doc.delete(ROOT, &id_str);
}

/// Writes a water entry to an Automerge document.
pub fn write_water_entry(doc: &mut AutoCommit, entry: &WaterEntry) {
    let id_str = entry.id.to_string();

    let entry_id = doc
        .put_object(ROOT, &id_str, ObjType::Map)
        .expect("Failed to create water entry object");

    doc.put(
        &entry_id,
        "consumed_at",
        entry.consumed_at.to_rfc3339().as_str(),
    )
    .unwrap();
    doc.put(&entry_id, "amount_ml", entry.amount_ml as i64)
        .unwrap();
    doc.put(
        &entry_id,
        "created_at",
        entry.created_at.to_rfc3339().as_str(),
    )
    .unwrap();
    doc.put(
        &entry_id,
        "updated_at",
        entry.updated_at.to_rfc3339().as_str(),
    )
    .unwrap();
}

/// Writes hydration settings to an Automerge document.
pub fn write_hydration_settings(doc: &mut AutoCommit, settings: &HydrationSettings) {
    let settings_id = doc
        .put_object(ROOT, "settings", ObjType::Map)
        .expect("Failed to create hydration settings object");

    doc.put(&settings_id, "daily_goal_ml", settings.daily_goal_ml as i64)
        .unwrap();
    doc.put(
        &settings_id,
        "preferred_unit",
        match settings.preferred_unit {
            crate::models::HydrationUnit::Ml => "ml",
            crate::models::HydrationUnit::Oz => "oz",
        },
    )
    .unwrap();
    doc.put(&settings_id, "timezone", settings.timezone.as_str())
        .unwrap();

    let presets_id = doc
        .put_object(&settings_id, "quick_add_presets_ml", ObjType::List)
        .unwrap();
    for (i, preset) in settings.quick_add_presets_ml.iter().enumerate() {
        doc.insert(&presets_id, i, *preset as i64).unwrap();
    }
}

/// Deletes a water entry from an Automerge document.
pub fn delete_water_entry(doc: &mut AutoCommit, id: Uuid) {
    let id_str = id.to_string();
    let _ = doc.delete(ROOT, &id_str);
}

/// Writes a shopping cart to an Automerge document.
///
/// The shopping cart is stored at root[week_date_string].
/// Each week has its own entry keyed by the Sunday date (YYYY-MM-DD).
pub fn write_shopping_cart(doc: &mut AutoCommit, cart: &ShoppingCart) {
    let week_key = &cart.week;

    let cart_id = doc
        .put_object(ROOT, week_key, ObjType::Map)
        .expect("Failed to create shopping cart object");

    // Write checked items list
    let checked_id = doc.put_object(&cart_id, "checked", ObjType::List).unwrap();
    for (i, item_name) in cart.checked.iter().enumerate() {
        doc.insert(&checked_id, i, item_name.as_str()).unwrap();
    }

    // Write manual items list
    let manual_items_id = doc
        .put_object(&cart_id, "manual_items", ObjType::List)
        .unwrap();
    for (i, item) in cart.manual_items.iter().enumerate() {
        let item_id = doc
            .insert_object(&manual_items_id, i, ObjType::Map)
            .unwrap();
        doc.put(&item_id, "name", item.name.as_str()).unwrap();
        if let Some(ref qty) = item.quantity {
            doc.put(&item_id, "quantity", qty.as_str()).unwrap();
        }
        if let Some(ref unit) = item.unit {
            doc.put(&item_id, "unit", unit.as_str()).unwrap();
        }
    }
}

/// Deletes a shopping cart for a specific week from an Automerge document.
pub fn delete_shopping_cart(doc: &mut AutoCommit, week: &str) {
    let _ = doc.delete(ROOT, week);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{HydrationSettings, HydrationUnit, Ingredient, MealType, Nutrient};
    use automerge::ReadDoc;
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
        let mealplan = MealPlan::new(date, MealType::Dinner, "Sunday Dinner", "chef")
            .with_uses_leftovers(true);

        write_mealplan(&mut doc, &mealplan);

        let id_str = mealplan.id.to_string();
        assert!(doc.get(ROOT, &id_str).unwrap().is_some());

        let (_, plan_obj) = doc.get(ROOT, &id_str).unwrap().unwrap();
        let (uses_leftovers, _) = doc.get(&plan_obj, "uses_leftovers").unwrap().unwrap();
        assert_eq!(uses_leftovers.to_bool(), Some(true));
    }

    #[test]
    fn test_write_meallog() {
        let mut doc = AutoCommit::new();
        let date = NaiveDate::from_ymd_opt(2025, 1, 15).unwrap();
        let meallog = MealLog::new(date, MealType::Lunch, "chef").with_notes("Delicious!");

        write_meallog(&mut doc, &meallog);

        let id_str = meallog.id.to_string();
        assert!(doc.get(ROOT, &id_str).unwrap().is_some());
    }

    #[test]
    fn test_write_meallog_with_mealplan_id() {
        let mut doc = AutoCommit::new();
        let date = NaiveDate::from_ymd_opt(2025, 1, 15).unwrap();
        let mealplan_id = Uuid::new_v4();
        let meallog = MealLog::new(date, MealType::Lunch, "chef").with_mealplan_id(mealplan_id);

        write_meallog(&mut doc, &meallog);

        let id_str = meallog.id.to_string();
        let (_, log_obj) = doc.get(ROOT, &id_str).unwrap().unwrap();
        let (val, _) = doc.get(&log_obj, "mealplan_id").unwrap().unwrap();
        assert_eq!(val.into_string().unwrap(), mealplan_id.to_string());
    }

    #[test]
    fn test_write_water_entry_and_settings() {
        let mut doc = AutoCommit::new();
        let consumed_at = chrono::DateTime::parse_from_rfc3339("2026-04-08T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let entry = WaterEntry::new(500, consumed_at).unwrap();
        let settings = HydrationSettings::new(2000, HydrationUnit::Ml);

        write_water_entry(&mut doc, &entry);
        write_hydration_settings(&mut doc, &settings);

        let (_, entry_obj) = doc.get(ROOT, entry.id.to_string()).unwrap().unwrap();
        let (amount, _) = doc.get(&entry_obj, "amount_ml").unwrap().unwrap();
        assert_eq!(amount.to_i64(), Some(500));

        let (_, settings_obj) = doc.get(ROOT, "settings").unwrap().unwrap();
        let (goal, _) = doc.get(&settings_obj, "daily_goal_ml").unwrap().unwrap();
        assert_eq!(goal.to_i64(), Some(2000));
    }

    #[test]
    fn test_delete_water_entry() {
        let mut doc = AutoCommit::new();
        let entry = WaterEntry::new(500, chrono::Utc::now()).unwrap();

        write_water_entry(&mut doc, &entry);
        assert!(doc.get(ROOT, entry.id.to_string()).unwrap().is_some());

        delete_water_entry(&mut doc, entry.id);
        assert!(doc.get(ROOT, entry.id.to_string()).unwrap().is_none());
    }

    #[test]
    fn test_write_shopping_cart() {
        use crate::models::ManualItem;

        let mut doc = AutoCommit::new();
        let mut cart = ShoppingCart::new("2026-01-11");
        cart.check("eggs");
        cart.check("milk");
        cart.add_manual_item(ManualItem::with_quantity("Paper towels", "2", "rolls"));

        write_shopping_cart(&mut doc, &cart);

        // Verify cart exists
        assert!(doc.get(ROOT, "2026-01-11").unwrap().is_some());

        let (_, cart_obj) = doc.get(ROOT, "2026-01-11").unwrap().unwrap();

        // Verify checked items
        let (_, checked_obj) = doc.get(&cart_obj, "checked").unwrap().unwrap();
        assert_eq!(doc.length(&checked_obj), 2);

        // Verify manual items
        let (_, manual_obj) = doc.get(&cart_obj, "manual_items").unwrap().unwrap();
        assert_eq!(doc.length(&manual_obj), 1);
    }

    #[test]
    fn test_delete_shopping_cart() {
        let mut doc = AutoCommit::new();
        let cart = ShoppingCart::new("2026-01-11");

        write_shopping_cart(&mut doc, &cart);
        assert!(doc.get(ROOT, "2026-01-11").unwrap().is_some());

        delete_shopping_cart(&mut doc, "2026-01-11");
        assert!(doc.get(ROOT, "2026-01-11").unwrap().is_none());
    }
}
