use chrono::{Local, NaiveDate};
use clap::{Args, Subcommand, ValueEnum};
use std::io::{self, Write};
use uuid::Uuid;

use crate::config::Config;
use crate::models::{MealPlan, MealType};
use crate::sync::{SyncDishRepository, SyncMealPlanRepository};
use todu_fit_core::{MealPlanDraft, MealPlanUpdate};

#[derive(serde::Serialize, serde::Deserialize, Clone, ValueEnum, Default)]
pub enum OutputFormat {
    #[default]
    Text,
    Json,
}

#[derive(serde::Serialize, serde::Deserialize, Args)]
pub struct MealPlanCommand {
    #[command(subcommand)]
    pub command: MealPlanSubcommand,
}

#[derive(serde::Serialize, serde::Deserialize, Subcommand)]
pub enum MealPlanSubcommand {
    /// Create a new meal plan
    Create {
        /// Date (YYYY-MM-DD)
        #[arg(long, short)]
        date: String,

        /// Meal type (breakfast, lunch, dinner, snack)
        #[arg(long = "type", short = 't', value_name = "TYPE")]
        meal_type: String,

        /// Title (defaults to "<MealType> on <date>")
        #[arg(long)]
        title: Option<String>,

        /// Cook name
        #[arg(long)]
        cook: Option<String>,

        /// Add dish by ID or name (can be repeated)
        #[arg(long = "dish", value_name = "DISH")]
        dishes: Vec<String>,

        /// Mark this meal plan as using leftovers, so it won't add ingredients to shopping lists
        #[arg(long)]
        leftovers: bool,
    },

    /// List meal plans
    List {
        /// Output format
        #[arg(long, short, value_enum, default_value = "text")]
        format: OutputFormat,

        /// Start date (YYYY-MM-DD), defaults to today
        #[arg(long)]
        from: Option<String>,

        /// End date (YYYY-MM-DD), defaults to 7 days from start
        #[arg(long)]
        to: Option<String>,

        /// Filter by meal type
        #[arg(long = "type", short = 't', value_name = "TYPE")]
        meal_type: Option<String>,
    },

    /// Show meal plan details
    Show {
        /// Meal plan ID (UUID) or date (YYYY-MM-DD)
        identifier: String,

        /// Output format
        #[arg(long, short, value_enum, default_value = "text")]
        format: OutputFormat,

        /// Meal type (required if date has multiple plans)
        #[arg(long = "type", short = 't', value_name = "TYPE")]
        meal_type: Option<String>,
    },

    /// Update a meal plan
    Update {
        /// Meal plan ID (UUID)
        id: String,

        /// New date (YYYY-MM-DD)
        #[arg(long)]
        date: Option<String>,

        /// New meal type
        #[arg(long = "type", short = 't', value_name = "TYPE")]
        meal_type: Option<String>,

        /// New title
        #[arg(long)]
        title: Option<String>,

        /// New cook
        #[arg(long)]
        cook: Option<String>,

        /// Mark this meal plan as using leftovers
        #[arg(long, conflicts_with = "no_leftovers")]
        leftovers: bool,

        /// Mark this meal plan as not using leftovers
        #[arg(long, conflicts_with = "leftovers")]
        no_leftovers: bool,
    },

    /// Delete a meal plan
    Delete {
        /// Meal plan ID (UUID)
        id: String,

        /// Skip confirmation prompt
        #[arg(long, short)]
        force: bool,
    },

    /// Add a dish to a meal plan
    AddDish {
        /// Meal plan ID (UUID)
        plan_id: String,

        /// Dish ID (UUID) or name
        dish: String,
    },

    /// Remove a dish from a meal plan
    RemoveDish {
        /// Meal plan ID (UUID)
        plan_id: String,

        /// Dish ID (UUID) or name
        dish: String,
    },
}

impl MealPlanCommand {
    pub fn run(
        &self,
        mealplan_repo: &SyncMealPlanRepository,
        dish_repo: &SyncDishRepository,
        config: &Config,
    ) -> Result<(), Box<dyn std::error::Error>> {
        match &self.command {
            MealPlanSubcommand::Create {
                date,
                meal_type,
                title,
                cook,
                dishes,
                leftovers,
            } => {
                // Parse date
                let date = NaiveDate::parse_from_str(date, "%Y-%m-%d")
                    .map_err(|_| format!("Invalid date format '{}'. Use YYYY-MM-DD.", date))?;

                // Parse meal type
                let meal_type: MealType = meal_type.parse().map_err(|e: String| e)?;

                let draft = MealPlanDraft {
                    date,
                    meal_type,
                    title: title.clone(),
                    cook: cook.clone(),
                    dish_references: dishes.clone(),
                    uses_leftovers: *leftovers,
                    created_by: config.created_by.value.clone(),
                };
                let created = mealplan_repo.create_with_dishes(&draft, dish_repo)?;
                println!("Created meal plan:");
                println!("{}", created);
                Ok(())
            }

            MealPlanSubcommand::List {
                format,
                from,
                to,
                meal_type,
            } => {
                // Parse date range
                let today = Local::now().date_naive();
                let from_date = match from {
                    Some(d) => NaiveDate::parse_from_str(d, "%Y-%m-%d")
                        .map_err(|_| format!("Invalid date format '{}'. Use YYYY-MM-DD.", d))?,
                    None => today,
                };
                let to_date = match to {
                    Some(d) => NaiveDate::parse_from_str(d, "%Y-%m-%d")
                        .map_err(|_| format!("Invalid date format '{}'. Use YYYY-MM-DD.", d))?,
                    None => from_date + chrono::Duration::days(7),
                };

                // Parse meal type filter
                let meal_type_filter: Option<MealType> = match meal_type {
                    Some(mt) => Some(mt.parse().map_err(|e: String| e)?),
                    None => None,
                };

                // Fetch meal plans
                let plans =
                    mealplan_repo.list_range_filtered(from_date, to_date, meal_type_filter)?;

                if plans.is_empty() {
                    println!("No meal plans found");
                    return Ok(());
                }

                match format {
                    OutputFormat::Json => {
                        println!("{}", serde_json::to_string_pretty(&plans)?);
                    }
                    OutputFormat::Text => {
                        let mut current_date: Option<NaiveDate> = None;
                        for plan in &plans {
                            if current_date != Some(plan.date) {
                                if current_date.is_some() {
                                    println!();
                                }
                                println!("{}", plan.date);
                                println!("{}", "-".repeat(10));
                                current_date = Some(plan.date);
                            }
                            let dish_count = plan.dish_ids.len();
                            let dishes_str = if dish_count == 0 {
                                "no dishes".to_string()
                            } else if dish_count == 1 {
                                "1 dish".to_string()
                            } else {
                                format!("{} dishes", dish_count)
                            };
                            let leftovers_str = if plan.uses_leftovers {
                                ", leftovers"
                            } else {
                                ""
                            };
                            println!(
                                "  {:10} {} ({}{})",
                                plan.meal_type, plan.title, dishes_str, leftovers_str
                            );
                        }
                        println!("\nTotal: {} meal plan(s)", plans.len());
                    }
                }
                Ok(())
            }

            MealPlanSubcommand::Show {
                identifier,
                format,
                meal_type,
            } => {
                // Try to parse as UUID first
                let plans: Vec<MealPlan> = if let Ok(uuid) = Uuid::parse_str(identifier) {
                    match mealplan_repo.get_by_id(uuid)? {
                        Some(plan) => vec![plan],
                        None => vec![],
                    }
                } else if let Ok(date) = NaiveDate::parse_from_str(identifier, "%Y-%m-%d") {
                    if let Some(mt) = meal_type {
                        let meal_type_filter: MealType = mt.parse().map_err(|e: String| e)?;
                        match mealplan_repo.get_by_date_and_type(date, meal_type_filter)? {
                            Some(plan) => vec![plan],
                            None => {
                                return Err(
                                    format!("No {} meal plan found for date {}", mt, date).into()
                                )
                            }
                        }
                    } else {
                        mealplan_repo.get_by_date(date)?
                    }
                } else {
                    return Err(format!(
                        "Invalid identifier '{}'. Use UUID or date (YYYY-MM-DD).",
                        identifier
                    )
                    .into());
                };

                if plans.is_empty() {
                    return Err(format!("Meal plan not found: {}", identifier).into());
                }

                match format {
                    OutputFormat::Json => {
                        if plans.len() == 1 {
                            println!("{}", serde_json::to_string_pretty(&plans[0])?);
                        } else {
                            println!("{}", serde_json::to_string_pretty(&plans)?);
                        }
                    }
                    OutputFormat::Text => {
                        for (i, plan) in plans.iter().enumerate() {
                            if i > 0 {
                                println!("\n{}\n", "=".repeat(40));
                            }
                            println!("{}", plan);

                            // Show dish details (load from repository)
                            if !plan.dish_ids.is_empty() {
                                for dish_id in &plan.dish_ids {
                                    if let Some(dish) = dish_repo.get_by_id(*dish_id)? {
                                        println!("\n  {}", dish.name);
                                        println!("  {}", "-".repeat(dish.name.len()));
                                        if !dish.ingredients.is_empty() {
                                            println!("  Ingredients:");
                                            for ing in &dish.ingredients {
                                                println!("    - {}", ing);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Ok(())
            }

            MealPlanSubcommand::Update {
                id,
                date,
                meal_type,
                title,
                cook,
                leftovers,
                no_leftovers,
            } => {
                // Check if any updates provided
                let has_updates = date.is_some()
                    || meal_type.is_some()
                    || title.is_some()
                    || cook.is_some()
                    || *leftovers
                    || *no_leftovers;

                if !has_updates {
                    return Err("Nothing to update. Provide at least one option.".into());
                }

                // Parse UUID
                let uuid = Uuid::parse_str(id).map_err(|_| format!("Invalid UUID: {}", id))?;

                // Get existing plan
                let mut plan = mealplan_repo
                    .get_by_id(uuid)?
                    .ok_or_else(|| format!("Meal plan not found: {}", id))?;

                let updates = MealPlanUpdate {
                    date: date
                        .as_ref()
                        .map(|d| {
                            NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| {
                                format!("Invalid date format '{}'. Use YYYY-MM-DD.", d)
                            })
                        })
                        .transpose()?,
                    meal_type: meal_type
                        .as_deref()
                        .map(str::parse::<MealType>)
                        .transpose()?,
                    title: title.clone(),
                    cook: cook.clone(),
                    uses_leftovers: if *no_leftovers {
                        Some(false)
                    } else if *leftovers {
                        Some(true)
                    } else {
                        None
                    },
                };
                updates.apply_to(&mut plan);

                let updated = mealplan_repo.update(&plan)?;
                println!("Updated meal plan:");
                println!("{}", updated);
                Ok(())
            }

            MealPlanSubcommand::Delete { id, force } => {
                // Parse UUID
                let uuid = Uuid::parse_str(id).map_err(|_| format!("Invalid UUID: {}", id))?;

                // Get existing plan
                let plan = mealplan_repo
                    .get_by_id(uuid)?
                    .ok_or_else(|| format!("Meal plan not found: {}", id))?;

                // Confirm unless --force
                if !force {
                    print!(
                        "Delete meal plan '{}' ({} {})? [y/N] ",
                        plan.title, plan.meal_type, plan.date
                    );
                    io::stdout().flush()?;

                    let mut input = String::new();
                    crate::output::read_confirmation(&mut input)?;

                    if !input.trim().eq_ignore_ascii_case("y") {
                        println!("Deletion cancelled.");
                        return Ok(());
                    }
                }

                mealplan_repo.delete(uuid)?;
                println!("Deleted meal plan: {}", plan.title);
                Ok(())
            }

            MealPlanSubcommand::AddDish { plan_id, dish } => {
                // Parse plan UUID
                let plan_uuid = Uuid::parse_str(plan_id)
                    .map_err(|_| format!("Invalid plan UUID: {}", plan_id))?;

                // Get plan (for title in success message)
                let plan = mealplan_repo
                    .get_by_id(plan_uuid)?
                    .ok_or_else(|| format!("Meal plan not found: {}", plan_id))?;

                // Resolve dish
                let resolved_dish = if let Ok(uuid) = Uuid::parse_str(dish) {
                    dish_repo.get_by_id(uuid)?
                } else {
                    dish_repo.get_by_name(dish)?
                };

                let resolved_dish =
                    resolved_dish.ok_or_else(|| format!("Dish not found: {}", dish))?;

                mealplan_repo.add_dish(plan_uuid, resolved_dish.id)?;
                println!("Added '{}' to '{}'", resolved_dish.name, plan.title);
                Ok(())
            }

            MealPlanSubcommand::RemoveDish { plan_id, dish } => {
                // Parse plan UUID
                let plan_uuid = Uuid::parse_str(plan_id)
                    .map_err(|_| format!("Invalid plan UUID: {}", plan_id))?;

                // Get plan (for title in success message)
                let plan = mealplan_repo
                    .get_by_id(plan_uuid)?
                    .ok_or_else(|| format!("Meal plan not found: {}", plan_id))?;

                // Resolve dish
                let resolved_dish = if let Ok(uuid) = Uuid::parse_str(dish) {
                    dish_repo.get_by_id(uuid)?
                } else {
                    dish_repo.get_by_name(dish)?
                };

                let resolved_dish =
                    resolved_dish.ok_or_else(|| format!("Dish not found: {}", dish))?;

                mealplan_repo.remove_dish(plan_uuid, resolved_dish.id)?;
                println!("Removed '{}' from '{}'", resolved_dish.name, plan.title);
                Ok(())
            }
        }
    }
}
