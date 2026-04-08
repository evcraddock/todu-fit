//! Shopping cart for weekly grocery lists.
//!
//! Shopping carts aggregate ingredients from meal plans for a week
//! and allow manual items to be added. Items can be checked off
//! as they are purchased.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fmt;
use uuid::Uuid;

use super::{Dish, Ingredient, MealPlan};

/// A manual item added to the shopping cart (not from a recipe).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManualItem {
    /// Item name
    pub name: String,
    /// Optional quantity (as string to allow "2" or "a few")
    pub quantity: Option<String>,
    /// Optional unit (e.g., "rolls", "bags")
    pub unit: Option<String>,
}

impl ManualItem {
    /// Create a new manual item with just a name.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            quantity: None,
            unit: None,
        }
    }

    /// Create a manual item with quantity and unit.
    pub fn with_quantity(
        name: impl Into<String>,
        quantity: impl Into<String>,
        unit: impl Into<String>,
    ) -> Self {
        let qty = quantity.into();
        let u = unit.into();
        Self {
            name: name.into(),
            quantity: if qty.is_empty() { None } else { Some(qty) },
            unit: if u.is_empty() { None } else { Some(u) },
        }
    }
}

impl fmt::Display for ManualItem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (&self.quantity, &self.unit) {
            (Some(qty), Some(unit)) => write!(f, "{} {} {}", qty, unit, self.name),
            (Some(qty), None) => write!(f, "{} {}", qty, self.name),
            (None, Some(unit)) => write!(f, "{} ({})", self.name, unit),
            (None, None) => write!(f, "{}", self.name),
        }
    }
}

/// A shopping cart for a specific week.
///
/// The cart is keyed by the week's start date (Sunday).
/// It contains:
/// - Auto-generated ingredients from meal plans (computed, not stored)
/// - Manual items added by the user
/// - Set of checked (purchased) item names
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShoppingCart {
    /// Week start date as string (YYYY-MM-DD, always a Sunday)
    pub week: String,
    /// Names of items that have been checked off (case-normalized)
    pub checked: Vec<String>,
    /// Manual items added to the cart
    pub manual_items: Vec<ManualItem>,
}

impl ShoppingCart {
    /// Create a new empty shopping cart for a week.
    pub fn new(week: impl Into<String>) -> Self {
        Self {
            week: week.into(),
            checked: Vec::new(),
            manual_items: Vec::new(),
        }
    }

    /// Check if an item is checked (case-insensitive).
    pub fn is_checked(&self, name: &str) -> bool {
        let name_lower = name.to_lowercase();
        self.checked.iter().any(|c| c.to_lowercase() == name_lower)
    }

    /// Check an item (mark as purchased).
    pub fn check(&mut self, name: &str) {
        let name_lower = name.to_lowercase();
        if !self.is_checked(&name_lower) {
            self.checked.push(name_lower);
        }
    }

    /// Uncheck an item.
    pub fn uncheck(&mut self, name: &str) {
        let name_lower = name.to_lowercase();
        self.checked.retain(|c| c.to_lowercase() != name_lower);
    }

    /// Clear all checked items.
    pub fn clear_checked(&mut self) {
        self.checked.clear();
    }

    /// Add a manual item.
    pub fn add_manual_item(&mut self, item: ManualItem) {
        // Check for duplicates (case-insensitive)
        let name_lower = item.name.to_lowercase();
        if !self
            .manual_items
            .iter()
            .any(|i| i.name.to_lowercase() == name_lower)
        {
            self.manual_items.push(item);
        }
    }

    /// Remove a manual item by name (case-insensitive).
    /// Returns true if an item was removed.
    pub fn remove_manual_item(&mut self, name: &str) -> bool {
        let name_lower = name.to_lowercase();
        let len_before = self.manual_items.len();
        self.manual_items
            .retain(|i| i.name.to_lowercase() != name_lower);
        self.manual_items.len() != len_before
    }

    /// Find a manual item by name (case-insensitive).
    pub fn find_manual_item(&self, name: &str) -> Option<&ManualItem> {
        let name_lower = name.to_lowercase();
        self.manual_items
            .iter()
            .find(|i| i.name.to_lowercase() == name_lower)
    }
}

/// A shopping item for display (combines ingredient and checked status).
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Collect ingredients from meal plans using a dish resolver.
///
/// Meal plans marked as using leftovers do not contribute ingredients.
pub fn collect_ingredients_from_mealplans<F>(
    plans: &[MealPlan],
    mut resolve_dish: F,
) -> Vec<Ingredient>
where
    F: FnMut(Uuid) -> Option<Dish>,
{
    let mut all_ingredients = Vec::new();

    for plan in plans {
        if plan.uses_leftovers {
            continue;
        }

        for dish_id in &plan.dish_ids {
            if let Some(dish) = resolve_dish(*dish_id) {
                all_ingredients.extend(dish.ingredients);
            }
        }
    }

    all_ingredients
}

/// Aggregate ingredients by name (case-insensitive), combining quantities where units match.
///
/// If the same ingredient name appears with different units, the first unit encountered is kept.
pub fn aggregate_ingredients(ingredients: &[Ingredient]) -> Vec<Ingredient> {
    let mut grouped: HashMap<(String, String), f64> = HashMap::new();

    for ing in ingredients {
        let key = (ing.name.to_lowercase(), ing.unit.to_lowercase());
        *grouped.entry(key).or_insert(0.0) += ing.quantity;
    }

    let mut result: Vec<Ingredient> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for ing in ingredients {
        let key = ing.name.to_lowercase();
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key.clone());

        let unit_key = ing.unit.to_lowercase();
        if let Some(&qty) = grouped.get(&(key, unit_key)) {
            result.push(Ingredient::new(&ing.name, qty, &ing.unit));
        }
    }

    result
}

impl ShoppingItem {
    /// Create a shopping item from an ingredient.
    pub fn from_ingredient(ingredient: &Ingredient, checked: bool) -> Self {
        Self {
            name: ingredient.name.clone(),
            quantity: ingredient.quantity,
            unit: ingredient.unit.clone(),
            checked,
            is_manual: false,
        }
    }

    /// Create a shopping item from a manual item.
    pub fn from_manual(item: &ManualItem, checked: bool) -> Self {
        Self {
            name: item.name.clone(),
            quantity: item
                .quantity
                .as_ref()
                .and_then(|q| q.parse::<f64>().ok())
                .unwrap_or(1.0),
            unit: item.unit.clone().unwrap_or_default(),
            checked,
            is_manual: true,
        }
    }
}

impl fmt::Display for ShoppingItem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let check = if self.checked { "[x]" } else { "[ ]" };
        if self.unit.is_empty() {
            write!(f, "{} {:<20} {}", check, self.name, self.quantity)
        } else {
            write!(
                f,
                "{} {:<20} {} {}",
                check, self.name, self.quantity, self.unit
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::MealType;
    use chrono::NaiveDate;

    #[test]
    fn test_manual_item_new() {
        let item = ManualItem::new("Paper towels");
        assert_eq!(item.name, "Paper towels");
        assert!(item.quantity.is_none());
        assert!(item.unit.is_none());
    }

    #[test]
    fn test_manual_item_with_quantity() {
        let item = ManualItem::with_quantity("Paper towels", "2", "rolls");
        assert_eq!(item.name, "Paper towels");
        assert_eq!(item.quantity, Some("2".to_string()));
        assert_eq!(item.unit, Some("rolls".to_string()));
    }

    #[test]
    fn test_manual_item_display() {
        let item = ManualItem::with_quantity("Paper towels", "2", "rolls");
        assert_eq!(format!("{}", item), "2 rolls Paper towels");

        let item2 = ManualItem::new("Soap");
        assert_eq!(format!("{}", item2), "Soap");
    }

    #[test]
    fn test_shopping_cart_new() {
        let cart = ShoppingCart::new("2026-01-11");
        assert_eq!(cart.week, "2026-01-11");
        assert!(cart.checked.is_empty());
        assert!(cart.manual_items.is_empty());
    }

    #[test]
    fn test_shopping_cart_check_uncheck() {
        let mut cart = ShoppingCart::new("2026-01-11");

        assert!(!cart.is_checked("eggs"));

        cart.check("Eggs"); // Mixed case
        assert!(cart.is_checked("eggs")); // Case-insensitive check
        assert!(cart.is_checked("EGGS"));

        cart.uncheck("EGGS"); // Different case
        assert!(!cart.is_checked("eggs"));
    }

    #[test]
    fn test_shopping_cart_clear_checked() {
        let mut cart = ShoppingCart::new("2026-01-11");
        cart.check("eggs");
        cart.check("milk");
        assert_eq!(cart.checked.len(), 2);

        cart.clear_checked();
        assert!(cart.checked.is_empty());
    }

    #[test]
    fn test_shopping_cart_manual_items() {
        let mut cart = ShoppingCart::new("2026-01-11");

        cart.add_manual_item(ManualItem::new("Paper towels"));
        assert_eq!(cart.manual_items.len(), 1);

        // Duplicate should not be added
        cart.add_manual_item(ManualItem::new("paper towels"));
        assert_eq!(cart.manual_items.len(), 1);

        assert!(cart.find_manual_item("PAPER TOWELS").is_some());

        assert!(cart.remove_manual_item("Paper Towels"));
        assert!(cart.manual_items.is_empty());
    }

    #[test]
    fn test_shopping_cart_json_roundtrip() {
        let mut cart = ShoppingCart::new("2026-01-11");
        cart.check("eggs");
        cart.add_manual_item(ManualItem::with_quantity("Paper towels", "2", "rolls"));

        let json = serde_json::to_string(&cart).unwrap();
        let parsed: ShoppingCart = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.week, cart.week);
        assert_eq!(parsed.checked, cart.checked);
        assert_eq!(parsed.manual_items.len(), 1);
    }

    #[test]
    fn test_collect_ingredients_from_mealplans_skips_leftovers() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let included_dish_id = Uuid::new_v4();
        let skipped_dish_id = Uuid::new_v4();

        let included_plan = MealPlan::new(date, MealType::Dinner, "Fresh Dinner", "user1")
            .with_dish_ids(vec![included_dish_id]);
        let leftover_plan = MealPlan::new(date, MealType::Lunch, "Leftovers", "user1")
            .with_dish_ids(vec![skipped_dish_id])
            .with_uses_leftovers(true);

        let ingredients =
            collect_ingredients_from_mealplans(&[included_plan, leftover_plan], |dish_id| {
                if dish_id == included_dish_id {
                    Some(
                        Dish::new("Soup", "chef")
                            .with_ingredients(vec![Ingredient::new("carrots", 2.0, "cups")]),
                    )
                } else if dish_id == skipped_dish_id {
                    Some(
                        Dish::new("Chili", "chef")
                            .with_ingredients(vec![Ingredient::new("beans", 1.0, "can")]),
                    )
                } else {
                    None
                }
            });

        assert_eq!(ingredients.len(), 1);
        assert_eq!(ingredients[0].name, "carrots");
    }

    #[test]
    fn test_aggregate_ingredients_same_unit() {
        let ingredients = vec![
            Ingredient::new("eggs", 6.0, ""),
            Ingredient::new("Eggs", 6.0, ""),
        ];

        let aggregated = aggregate_ingredients(&ingredients);
        assert_eq!(aggregated.len(), 1);
        assert_eq!(aggregated[0].quantity, 12.0);
    }

    #[test]
    fn test_aggregate_ingredients_same_name_different_units_keeps_first_unit() {
        let ingredients = vec![
            Ingredient::new("chicken", 1.0, "lb"),
            Ingredient::new("chicken", 500.0, "g"),
        ];

        let aggregated = aggregate_ingredients(&ingredients);
        assert_eq!(aggregated.len(), 1);
        assert_eq!(aggregated[0].unit, "lb");
    }

    #[test]
    fn test_shopping_item_from_ingredient() {
        let ingredient = Ingredient::new("chicken", 2.0, "lbs");
        let item = ShoppingItem::from_ingredient(&ingredient, false);

        assert_eq!(item.name, "chicken");
        assert_eq!(item.quantity, 2.0);
        assert_eq!(item.unit, "lbs");
        assert!(!item.checked);
        assert!(!item.is_manual);
    }

    #[test]
    fn test_shopping_item_from_manual() {
        let manual = ManualItem::with_quantity("Soap", "3", "bars");
        let item = ShoppingItem::from_manual(&manual, true);

        assert_eq!(item.name, "Soap");
        assert_eq!(item.quantity, 3.0);
        assert_eq!(item.unit, "bars");
        assert!(item.checked);
        assert!(item.is_manual);
    }
}
