use chrono::{Local, NaiveDate};
use clap::{Args, Subcommand, ValueEnum};
use std::collections::HashMap;
use std::io::{self, Write};
use uuid::Uuid;

use crate::config::Config;
use crate::models::{MealLog, MealType};
use crate::sync::{SyncDishRepository, SyncMealLogRepository, SyncMealPlanRepository};

#[derive(Clone, ValueEnum, Default)]
pub enum OutputFormat {
    #[default]
    Text,
    Json,
}

/// Repositories needed for meal commands
pub struct MealRepos<'a> {
    pub meallog: &'a SyncMealLogRepository,
    pub mealplan: &'a SyncMealPlanRepository,
    pub dish: &'a SyncDishRepository,
}

#[derive(Args)]
pub struct MealCommand {
    #[command(subcommand)]
    pub command: MealSubcommand,
}

#[derive(Subcommand)]
pub enum MealSubcommand {
    /// Log a meal (from plan or unplanned)
    Log {
        /// Meal plan ID (UUID) - if provided, copies from plan
        mealplan_id: Option<String>,

        /// Date (YYYY-MM-DD) - required for unplanned meals
        #[arg(long, short)]
        date: Option<String>,

        /// Meal type (breakfast, lunch, dinner, snack) - required for unplanned meals
        #[arg(long = "type", short = 't', value_name = "TYPE")]
        meal_type: Option<String>,

        /// Add dish by ID or name (can be repeated) - for unplanned meals
        #[arg(long = "dish", value_name = "DISH")]
        dishes: Vec<String>,

        /// Add notes to the log
        #[arg(long)]
        notes: Option<String>,
    },

    /// View meal history
    History {
        /// Output format
        #[arg(long, short, value_enum, default_value = "text")]
        format: OutputFormat,

        /// Start date (YYYY-MM-DD), defaults to 7 days ago
        #[arg(long)]
        from: Option<String>,

        /// End date (YYYY-MM-DD), defaults to today
        #[arg(long)]
        to: Option<String>,
    },

    /// Delete a meal log
    Delete {
        /// Meal log ID (UUID)
        id: String,

        /// Skip confirmation prompt
        #[arg(long, short = 'y')]
        yes: bool,
    },
}

impl MealCommand {
    pub fn run(
        &self,
        repos: MealRepos<'_>,
        config: &Config,
    ) -> Result<(), Box<dyn std::error::Error>> {
        match &self.command {
            MealSubcommand::Log {
                mealplan_id,
                date,
                meal_type,
                dishes,
                notes,
            } => {
                // Determine if this is a planned or unplanned meal
                if let Some(plan_id) = mealplan_id {
                    // Logging from a plan
                    self.log_from_plan(plan_id, notes, &repos, config)
                } else {
                    // Unplanned meal - require date and type
                    self.log_unplanned(date, meal_type, dishes, notes, &repos, config)
                }
            }
            MealSubcommand::History { format, from, to } => {
                self.show_history(format, from, to, &repos)
            }
            MealSubcommand::Delete { id, yes } => self.delete_log(id, *yes, &repos),
        }
    }

    fn log_from_plan(
        &self,
        mealplan_id: &str,
        notes: &Option<String>,
        repos: &MealRepos<'_>,
        config: &Config,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Parse mealplan UUID
        let plan_uuid = Uuid::parse_str(mealplan_id)
            .map_err(|_| format!("Invalid mealplan UUID: {}", mealplan_id))?;

        // Get the meal plan
        let plan = repos
            .mealplan
            .get_by_id(plan_uuid)?
            .ok_or_else(|| format!("Meal plan not found: {}", mealplan_id))?;

        // Load dishes for the plan (snapshots for the log)
        let mut plan_dishes = Vec::new();
        for dish_id in &plan.dish_ids {
            if let Some(dish) = repos.dish.get_by_id(*dish_id)? {
                plan_dishes.push(dish);
            }
        }

        // Create meal log from plan with dish snapshots
        let mut log = MealLog::new(plan.date, plan.meal_type, &config.created_by.value)
            .with_mealplan_id(plan.id)
            .with_dishes(plan_dishes);

        if let Some(n) = notes {
            log = log.with_notes(n);
        }

        let created = repos.meallog.create(&log)?;

        println!("Logged meal from plan '{}':", plan.title);
        println!();
        print_log_details(&created);

        Ok(())
    }

    fn log_unplanned(
        &self,
        date: &Option<String>,
        meal_type: &Option<String>,
        dishes: &[String],
        notes: &Option<String>,
        repos: &MealRepos<'_>,
        config: &Config,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Validate required fields
        let date_str = date
            .as_ref()
            .ok_or("--date is required for unplanned meals")?;
        let meal_type_str = meal_type
            .as_ref()
            .ok_or("--type is required for unplanned meals")?;

        // Parse date
        let parsed_date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|_| format!("Invalid date format '{}'. Use YYYY-MM-DD.", date_str))?;

        // Parse meal type
        let parsed_meal_type: MealType = meal_type_str.parse().map_err(|e: String| e)?;

        // Resolve dishes
        let mut resolved_dishes = Vec::new();
        for dish_ref in dishes {
            let dish = if let Ok(uuid) = Uuid::parse_str(dish_ref) {
                repos.dish.get_by_id(uuid)?
            } else {
                repos.dish.get_by_name(dish_ref)?
            };

            match dish {
                Some(d) => resolved_dishes.push(d),
                None => return Err(format!("Dish not found: {}", dish_ref).into()),
            }
        }

        // Create meal log
        let mut log = MealLog::new(parsed_date, parsed_meal_type, &config.created_by.value)
            .with_dishes(resolved_dishes);

        if let Some(n) = notes {
            log = log.with_notes(n);
        }

        let created = repos.meallog.create(&log)?;

        println!("Logged unplanned meal:");
        println!();
        print_log_details(&created);

        Ok(())
    }

    fn show_history(
        &self,
        format: &OutputFormat,
        from: &Option<String>,
        to: &Option<String>,
        repos: &MealRepos<'_>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Parse date range
        let today = Local::now().date_naive();
        let to_date = match to {
            Some(d) => NaiveDate::parse_from_str(d, "%Y-%m-%d")
                .map_err(|_| format!("Invalid date format '{}'. Use YYYY-MM-DD.", d))?,
            None => today,
        };
        let from_date = match from {
            Some(d) => NaiveDate::parse_from_str(d, "%Y-%m-%d")
                .map_err(|_| format!("Invalid date format '{}'. Use YYYY-MM-DD.", d))?,
            None => to_date - chrono::Duration::days(7),
        };

        // Fetch meal logs
        let mut logs = repos.meallog.list_range(from_date, to_date)?;
        hydrate_referenced_dishes(&mut logs, repos)?;

        if logs.is_empty() {
            println!("No meal history found for {} to {}", from_date, to_date);
            return Ok(());
        }

        match format {
            OutputFormat::Json => {
                println!("{}", serde_json::to_string_pretty(&logs)?);
            }
            OutputFormat::Text => {
                let mut current_date: Option<NaiveDate> = None;
                let mut daily_nutrients: HashMap<String, f64> = HashMap::new();

                for log in &logs {
                    // Print date header and daily totals when date changes
                    if current_date != Some(log.date) {
                        // Print previous day's totals if we have them
                        if current_date.is_some() && !daily_nutrients.is_empty() {
                            print_daily_totals(&daily_nutrients);
                            daily_nutrients.clear();
                        }
                        if current_date.is_some() {
                            println!();
                        }
                        println!("{}", log.date);
                        println!("{}", "-".repeat(60));
                        current_date = Some(log.date);
                    }

                    // Determine if planned or unplanned
                    let plan_indicator = if log.mealplan_id.is_some() {
                        "(planned)"
                    } else {
                        "(unplanned)"
                    };

                    // Build dish summary
                    let dishes_str = if log.dishes.is_empty() {
                        String::new()
                    } else {
                        let names: Vec<&str> = log.dishes.iter().map(|d| d.name.as_str()).collect();
                        format!(": {}", names.join(", "))
                    };

                    println!("  {:10} {}{}", log.meal_type, plan_indicator, dishes_str);

                    // Calculate and display meal nutrients
                    let meal_nutrients = calculate_meal_nutrients(log);
                    if !meal_nutrients.is_empty() {
                        println!("             {}", format_nutrients(&meal_nutrients));
                        // Add to daily totals
                        for (name, amount) in &meal_nutrients {
                            *daily_nutrients.entry(name.clone()).or_insert(0.0) += amount;
                        }
                    }

                    if let Some(notes) = &log.notes {
                        println!("             Notes: {}", notes);
                    }
                }

                // Print final day's totals
                if !daily_nutrients.is_empty() {
                    print_daily_totals(&daily_nutrients);
                }

                println!("\nTotal: {} meal(s)", logs.len());
            }
        }

        Ok(())
    }

    fn delete_log(
        &self,
        id: &str,
        skip_confirm: bool,
        repos: &MealRepos<'_>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Parse UUID
        let log_uuid = Uuid::parse_str(id).map_err(|_| format!("Invalid meal log UUID: {}", id))?;

        // Find the meal log
        let log = repos
            .meallog
            .get_by_id(log_uuid)?
            .ok_or_else(|| format!("Meal log not found: {}", id))?;

        // Build description for confirmation
        let dishes_str = if log.dishes.is_empty() {
            String::new()
        } else {
            let names: Vec<&str> = log.dishes.iter().map(|d| d.name.as_str()).collect();
            format!(" ({})", names.join(", "))
        };
        let log_desc = format!(
            "{} {} {}{}",
            log.date,
            log.meal_type,
            if log.mealplan_id.is_some() {
                "planned"
            } else {
                "unplanned"
            },
            dishes_str
        );

        // Confirm deletion unless -y is used
        if !skip_confirm {
            print!("Delete meal log '{}'? [y/N] ", log_desc);
            io::stdout().flush()?;

            let mut input = String::new();
            io::stdin().read_line(&mut input)?;

            if !input.trim().eq_ignore_ascii_case("y") {
                println!("Deletion cancelled.");
                return Ok(());
            }
        }

        repos.meallog.delete(log_uuid)?;
        println!("Deleted meal log: {}", log_desc);
        Ok(())
    }
}

fn hydrate_referenced_dishes(
    logs: &mut [MealLog],
    repos: &MealRepos<'_>,
) -> Result<(), Box<dyn std::error::Error>> {
    for log in logs {
        for dish in &mut log.dishes {
            if is_dish_reference_placeholder(dish) {
                if let Some(resolved) = repos.dish.get_by_id(dish.id)? {
                    *dish = resolved;
                }
            }
        }
    }

    Ok(())
}

fn is_dish_reference_placeholder(dish: &crate::models::Dish) -> bool {
    dish.name == format!("Dish {}", dish.id)
        && dish.ingredients.is_empty()
        && dish.instructions.is_empty()
        && dish.nutrients.is_none()
        && dish.created_by.is_empty()
}

/// Calculate total nutrients for a meal by summing all dish nutrients
fn calculate_meal_nutrients(log: &MealLog) -> HashMap<String, f64> {
    let mut totals: HashMap<String, f64> = HashMap::new();

    for dish in &log.dishes {
        let portion = log.portion_for(dish.id);
        if let Some(nutrients) = &dish.nutrients {
            for nutrient in nutrients {
                *totals.entry(nutrient.name.clone()).or_insert(0.0) += nutrient.amount * portion;
            }
        }
    }

    totals
}

/// Format nutrients for display: "Calories: 650 | Protein: 25g | Carbs: 80g | Fat: 28g"
fn format_nutrients(nutrients: &HashMap<String, f64>) -> String {
    // Order: calories first, then protein, carbs, fat, then others
    let order = ["calories", "protein", "carbs", "fat"];
    let mut parts: Vec<String> = Vec::new();

    for key in order {
        if let Some(amount) = nutrients.get(key) {
            let unit = if key == "calories" { "" } else { "g" };
            parts.push(format!("{}: {:.0}{}", capitalize(key), amount, unit));
        }
    }

    // Add any other nutrients not in the standard order
    for (name, amount) in nutrients {
        if !order.contains(&name.as_str()) {
            parts.push(format!("{}: {:.0}g", capitalize(name), amount));
        }
    }

    parts.join(" | ")
}

/// Print daily nutrient totals
fn print_daily_totals(nutrients: &HashMap<String, f64>) {
    println!("  {}", "-".repeat(56));
    println!("  Daily Total: {}", format_nutrients(nutrients));
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

fn print_log_details(log: &MealLog) {
    println!("  Date: {}", log.date);
    println!("  Meal: {}", log.meal_type);
    if !log.dishes.is_empty() {
        println!("  Dishes:");
        for dish in &log.dishes {
            println!(
                "    - {} ({} serving{})",
                dish.name,
                log.portion_for(dish.id),
                if log.portion_for(dish.id) == 1.0 {
                    ""
                } else {
                    "s"
                }
            );
        }
    }
    if let Some(n) = &log.notes {
        println!("  Notes: {}", n);
    }
    println!();
    println!("Log ID: {}", log.id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Dish, Nutrient};

    #[test]
    fn mixed_planned_and_unplanned_history_includes_portioned_nutrients() {
        let date = NaiveDate::from_ymd_opt(2026, 8, 10).unwrap();
        let planned_dish = Dish::new("Planned chicken", "test").with_nutrients(vec![
            Nutrient::new("calories", 600.0, "kcal"),
            Nutrient::new("protein", 40.0, "g"),
        ]);
        let planned_dish_id = planned_dish.id;
        let planned = MealLog::new(date, MealType::Lunch, "test")
            .with_mealplan_id(Uuid::new_v4())
            .with_dishes(vec![planned_dish])
            .with_dish_portion(planned_dish_id, 0.5);

        let unplanned_dish = Dish::new("Unplanned shake", "test").with_nutrients(vec![
            Nutrient::new("calories", 200.0, "kcal"),
            Nutrient::new("protein", 20.0, "g"),
        ]);
        let unplanned =
            MealLog::new(date, MealType::Snack, "test").with_dishes(vec![unplanned_dish]);
        let logs = vec![planned, unplanned];

        let json = serde_json::to_value(&logs).unwrap();
        assert_eq!(json[0]["dishes"][0]["nutrients"][0]["amount"], 600.0);

        let mut daily_totals = HashMap::new();
        for log in &logs {
            for (name, amount) in calculate_meal_nutrients(log) {
                *daily_totals.entry(name).or_insert(0.0) += amount;
            }
        }

        assert_eq!(daily_totals.get("calories"), Some(&500.0));
        assert_eq!(daily_totals.get("protein"), Some(&40.0));
    }
}
