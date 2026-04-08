//! Shopping cart CLI commands.
//!
//! Manage weekly shopping carts with items from meal plans and manual additions.

use chrono::{Datelike, Local, NaiveDate};
use clap::{Args, Subcommand, ValueEnum};

use crate::config::Config;
use crate::sync::{SyncDishRepository, SyncMealPlanRepository, SyncShoppingRepository};
use todu_fit_core::{
    aggregate_ingredients, collect_ingredients_from_mealplans, Ingredient, ManualItem, ShoppingItem,
};

#[derive(Clone, ValueEnum, Default)]
pub enum OutputFormat {
    #[default]
    Table,
    Json,
}

#[derive(Args)]
pub struct ShoppingCommand {
    #[command(subcommand)]
    pub command: ShoppingSubcommand,
}

#[derive(Subcommand)]
pub enum ShoppingSubcommand {
    /// List shopping cart items for a week
    List {
        /// Week date (YYYY-MM-DD), defaults to current week
        #[arg(long, short)]
        week: Option<String>,

        /// Output format
        #[arg(long, short, value_enum, default_value = "table")]
        format: OutputFormat,
    },

    /// Add a manual item to the shopping cart
    Add {
        /// Item name
        name: String,

        /// Quantity (optional)
        #[arg(long, short)]
        qty: Option<String>,

        /// Unit (optional, e.g., "rolls", "bags")
        #[arg(long, short)]
        unit: Option<String>,

        /// Week date (YYYY-MM-DD), defaults to current week
        #[arg(long, short)]
        week: Option<String>,
    },

    /// Remove a manual item from the shopping cart
    Remove {
        /// Item name
        name: String,

        /// Week date (YYYY-MM-DD), defaults to current week
        #[arg(long, short)]
        week: Option<String>,
    },

    /// Mark an item as checked (purchased)
    Check {
        /// Item name
        name: String,

        /// Week date (YYYY-MM-DD), defaults to current week
        #[arg(long, short)]
        week: Option<String>,
    },

    /// Uncheck a previously checked item
    Uncheck {
        /// Item name
        name: String,

        /// Week date (YYYY-MM-DD), defaults to current week
        #[arg(long, short)]
        week: Option<String>,
    },

    /// Uncheck all checked items
    ClearChecked {
        /// Week date (YYYY-MM-DD), defaults to current week
        #[arg(long, short)]
        week: Option<String>,
    },
}

impl ShoppingCommand {
    pub fn run(
        &self,
        shopping_repo: &SyncShoppingRepository,
        mealplan_repo: &SyncMealPlanRepository,
        dish_repo: &SyncDishRepository,
        _config: &Config,
    ) -> Result<(), Box<dyn std::error::Error>> {
        match &self.command {
            ShoppingSubcommand::List { week, format } => {
                let week_start = parse_week_or_current(week.as_deref())?;
                let week_str = week_start.to_string();
                let week_end = week_start + chrono::Duration::days(6);

                // Get shopping cart (checked items and manual items)
                let cart = shopping_repo.get_or_create(&week_str)?;

                // Get ingredients from meal plans for this week
                let ingredients =
                    collect_ingredients_for_week(mealplan_repo, dish_repo, week_start, week_end)?;

                // Aggregate and deduplicate ingredients
                let aggregated = aggregate_ingredients(&ingredients);

                // Build shopping items with checked status
                let mut items: Vec<ShoppingItem> = aggregated
                    .iter()
                    .map(|ing| ShoppingItem::from_ingredient(ing, cart.is_checked(&ing.name)))
                    .collect();

                // Add manual items
                for manual in &cart.manual_items {
                    items.push(ShoppingItem::from_manual(
                        manual,
                        cart.is_checked(&manual.name),
                    ));
                }

                // Sort: unchecked first, then alphabetical
                items.sort_by(|a, b| {
                    if a.checked != b.checked {
                        a.checked.cmp(&b.checked) // unchecked (false) comes first
                    } else {
                        a.name.to_lowercase().cmp(&b.name.to_lowercase())
                    }
                });

                match format {
                    OutputFormat::Json => {
                        let output = serde_json::json!({
                            "week": week_str,
                            "items": items.iter()
                                .filter(|i| !i.is_manual)
                                .map(|i| serde_json::json!({
                                    "name": i.name,
                                    "quantity": i.quantity,
                                    "unit": i.unit,
                                    "checked": i.checked,
                                }))
                                .collect::<Vec<_>>(),
                            "manual_items": cart.manual_items,
                            "checked": cart.checked,
                        });
                        println!("{}", serde_json::to_string_pretty(&output)?);
                    }
                    OutputFormat::Table => {
                        println!(
                            "Shopping Cart - Week of {}",
                            format_week_display(&week_start)
                        );
                        println!("{}", "=".repeat(44));

                        let regular_items: Vec<_> = items.iter().filter(|i| !i.is_manual).collect();
                        let manual_items: Vec<_> = items.iter().filter(|i| i.is_manual).collect();

                        if regular_items.is_empty() && manual_items.is_empty() {
                            println!("No items in cart.");
                            println!("\nNo meal plans found for this week.");
                        } else {
                            // Display regular (from recipes) items
                            for item in &regular_items {
                                let check = if item.checked { "[x]" } else { "[ ]" };
                                if item.unit.is_empty() {
                                    println!(
                                        "{} {:<25} {}",
                                        check,
                                        item.name,
                                        format_quantity(item.quantity)
                                    );
                                } else {
                                    println!(
                                        "{} {:<25} {} {}",
                                        check,
                                        item.name,
                                        format_quantity(item.quantity),
                                        item.unit
                                    );
                                }
                            }

                            // Separator and manual items
                            if !manual_items.is_empty() {
                                println!("{}", "-".repeat(44));
                                println!("Manual items:");
                                for item in &manual_items {
                                    let check = if item.checked { "[x]" } else { "[ ]" };
                                    if item.unit.is_empty() {
                                        println!(
                                            "{} {:<25} {}",
                                            check,
                                            item.name,
                                            format_quantity(item.quantity)
                                        );
                                    } else {
                                        println!(
                                            "{} {:<25} {} {}",
                                            check,
                                            item.name,
                                            format_quantity(item.quantity),
                                            item.unit
                                        );
                                    }
                                }
                            }

                            // Summary
                            let checked_count = items.iter().filter(|i| i.checked).count();
                            let total = items.len();
                            println!("{}", "-".repeat(44));
                            println!("{} of {} items checked", checked_count, total);
                        }
                    }
                }
                Ok(())
            }

            ShoppingSubcommand::Add {
                name,
                qty,
                unit,
                week,
            } => {
                let week_start = parse_week_or_current(week.as_deref())?;
                let week_str = week_start.to_string();

                if name.trim().is_empty() {
                    return Err("Item name cannot be empty".into());
                }

                let mut cart = shopping_repo.get_or_create(&week_str)?;

                // Check for existing item
                if cart.find_manual_item(name).is_some() {
                    println!("Warning: '{}' already exists in the cart, skipping", name);
                    return Ok(());
                }

                let item = match (qty, unit) {
                    (Some(q), Some(u)) => ManualItem::with_quantity(name, q, u),
                    (Some(q), None) => ManualItem::with_quantity(name, q, ""),
                    (None, Some(u)) => ManualItem {
                        name: name.clone(),
                        quantity: None,
                        unit: Some(u.clone()),
                    },
                    (None, None) => ManualItem::new(name),
                };

                cart.add_manual_item(item);
                shopping_repo.save(&cart)?;

                println!(
                    "Added '{}' to shopping cart for week of {}",
                    name,
                    format_week_display(&week_start)
                );
                Ok(())
            }

            ShoppingSubcommand::Remove { name, week } => {
                let week_start = parse_week_or_current(week.as_deref())?;
                let week_str = week_start.to_string();

                let mut cart = shopping_repo.get_or_create(&week_str)?;

                if cart.remove_manual_item(name) {
                    shopping_repo.save(&cart)?;
                    println!("Removed '{}' from shopping cart", name);
                } else {
                    return Err(format!(
                        "Cannot remove '{}': item not found or is not a manual item (only manual items can be removed)",
                        name
                    ).into());
                }
                Ok(())
            }

            ShoppingSubcommand::Check { name, week } => {
                let week_start = parse_week_or_current(week.as_deref())?;
                let week_str = week_start.to_string();

                let mut cart = shopping_repo.get_or_create(&week_str)?;

                if cart.is_checked(name) {
                    println!("'{}' is already checked", name);
                } else {
                    cart.check(name);
                    shopping_repo.save(&cart)?;
                    println!("Checked '{}' ✓", name);
                }
                Ok(())
            }

            ShoppingSubcommand::Uncheck { name, week } => {
                let week_start = parse_week_or_current(week.as_deref())?;
                let week_str = week_start.to_string();

                let mut cart = shopping_repo.get_or_create(&week_str)?;

                if !cart.is_checked(name) {
                    println!("'{}' is not checked", name);
                } else {
                    cart.uncheck(name);
                    shopping_repo.save(&cart)?;
                    println!("Unchecked '{}'", name);
                }
                Ok(())
            }

            ShoppingSubcommand::ClearChecked { week } => {
                let week_start = parse_week_or_current(week.as_deref())?;
                let week_str = week_start.to_string();

                let mut cart = shopping_repo.get_or_create(&week_str)?;

                let count = cart.checked.len();
                if count == 0 {
                    println!("No checked items to clear");
                } else {
                    cart.clear_checked();
                    shopping_repo.save(&cart)?;
                    println!("Cleared {} checked items", count);
                }
                Ok(())
            }
        }
    }
}

/// Parse a week date or return the current week's Sunday.
fn parse_week_or_current(week_str: Option<&str>) -> Result<NaiveDate, Box<dyn std::error::Error>> {
    match week_str {
        Some(s) => {
            let date = NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .map_err(|_| format!("Invalid date format '{}'. Use YYYY-MM-DD.", s))?;
            Ok(get_week_start(date))
        }
        None => Ok(get_week_start(Local::now().date_naive())),
    }
}

/// Get the Sunday that starts the week containing the given date.
fn get_week_start(date: NaiveDate) -> NaiveDate {
    let days_since_sunday = date.weekday().num_days_from_sunday();
    date - chrono::Duration::days(days_since_sunday as i64)
}

/// Format the week start date for display (e.g., "Jan 11, 2026").
fn format_week_display(date: &NaiveDate) -> String {
    date.format("%b %d, %Y").to_string()
}

/// Format a quantity, removing unnecessary decimal places.
fn format_quantity(qty: f64) -> String {
    if qty.fract() == 0.0 {
        format!("{}", qty as i64)
    } else {
        format!("{:.1}", qty)
    }
}

/// Collect all ingredients from meal plans for a week.
fn collect_ingredients_for_week(
    mealplan_repo: &SyncMealPlanRepository,
    dish_repo: &SyncDishRepository,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<Ingredient>, Box<dyn std::error::Error>> {
    let plans = mealplan_repo.list_range(from, to)?;

    Ok(collect_ingredients_from_mealplans(&plans, |dish_id| {
        dish_repo.get_by_id(dish_id).ok().flatten()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_week_start_from_sunday() {
        let sunday = NaiveDate::from_ymd_opt(2026, 1, 11).unwrap();
        assert_eq!(get_week_start(sunday), sunday);
    }

    #[test]
    fn test_get_week_start_from_wednesday() {
        let wednesday = NaiveDate::from_ymd_opt(2026, 1, 14).unwrap();
        let sunday = NaiveDate::from_ymd_opt(2026, 1, 11).unwrap();
        assert_eq!(get_week_start(wednesday), sunday);
    }

    #[test]
    fn test_get_week_start_from_saturday() {
        let saturday = NaiveDate::from_ymd_opt(2026, 1, 17).unwrap();
        let sunday = NaiveDate::from_ymd_opt(2026, 1, 11).unwrap();
        assert_eq!(get_week_start(saturday), sunday);
    }

    #[test]
    fn test_aggregate_ingredients_different_units() {
        let ingredients = vec![
            Ingredient::new("chicken", 1.0, "lb"),
            Ingredient::new("rice", 500.0, "g"),
        ];

        let aggregated = aggregate_ingredients(&ingredients);
        // Different ingredients should both appear
        assert_eq!(aggregated.len(), 2);
    }

    #[test]
    fn test_aggregate_ingredients_same_name_different_units() {
        // When the same ingredient has different units, we keep only the first one
        // (limitation: could be improved to convert units in the future)
        let ingredients = vec![
            Ingredient::new("chicken", 1.0, "lb"),
            Ingredient::new("chicken", 500.0, "g"),
        ];

        let aggregated = aggregate_ingredients(&ingredients);
        // Only first unit is kept (current behavior)
        assert_eq!(aggregated.len(), 1);
        assert_eq!(aggregated[0].unit, "lb");
    }

    #[test]
    fn test_format_quantity_whole() {
        assert_eq!(format_quantity(2.0), "2");
        assert_eq!(format_quantity(12.0), "12");
    }

    #[test]
    fn test_format_quantity_decimal() {
        assert_eq!(format_quantity(1.5), "1.5");
        assert_eq!(format_quantity(2.25), "2.2"); // rounds to 1 decimal (truncation)
    }

    #[test]
    fn test_parse_week_or_current_valid() {
        let result = parse_week_or_current(Some("2026-01-14")).unwrap();
        // Should return the Sunday of that week
        assert_eq!(result, NaiveDate::from_ymd_opt(2026, 1, 11).unwrap());
    }

    #[test]
    fn test_parse_week_or_current_invalid() {
        let result = parse_week_or_current(Some("invalid"));
        assert!(result.is_err());
    }
}
