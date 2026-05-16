use clap::{Args, Subcommand, ValueEnum};
use std::collections::HashMap;
use std::io::{self, Write};
use uuid::Uuid;

use crate::config::Config;
use crate::models::{Dish, Ingredient, Nutrient};
use crate::sync::SyncDishRepository;

#[derive(Clone, ValueEnum, Default)]
pub enum OutputFormat {
    #[default]
    Text,
    Json,
}

#[derive(Args)]
pub struct DishCommand {
    #[command(subcommand)]
    pub command: DishSubcommand,
}

#[derive(Subcommand)]
pub enum DishSubcommand {
    /// Create a new dish
    Create {
        /// Name of the dish
        name: String,

        /// Cooking instructions
        #[arg(long)]
        instructions: Option<String>,

        /// Prep time in minutes
        #[arg(long)]
        prep_time: Option<i32>,

        /// Cook time in minutes
        #[arg(long)]
        cook_time: Option<i32>,

        /// Number of servings
        #[arg(long)]
        servings: Option<i32>,

        /// Tags (can be repeated)
        #[arg(long = "tag", value_name = "TAG")]
        tags: Vec<String>,

        /// Image URL
        #[arg(long)]
        image_url: Option<String>,

        /// Recipe source URL
        #[arg(long)]
        source_url: Option<String>,

        /// Nutrients as JSON: '{"calories": 650, "protein": 25, "carbs": 80, "fat": 28}'
        /// Units: kcal for calories, grams for all others
        #[arg(long, value_name = "JSON")]
        nutrients: Option<String>,
    },

    /// List all dishes
    List {
        /// Output format
        #[arg(long, short, value_enum, default_value = "text")]
        format: OutputFormat,

        /// Filter by tag
        #[arg(long = "tag", value_name = "TAG")]
        tag: Option<String>,
    },

    /// Search dishes by name, tag, or ingredient
    Search {
        /// Search query
        query: String,

        /// Output format
        #[arg(long, short, value_enum, default_value = "text")]
        format: OutputFormat,
    },

    /// Show a dish's details
    Show {
        /// Dish ID (UUID) or name
        identifier: String,

        /// Output format
        #[arg(long, short, value_enum, default_value = "text")]
        format: OutputFormat,
    },

    /// Update an existing dish
    Update {
        /// Dish ID (UUID) or name
        identifier: String,

        /// New name
        #[arg(long)]
        name: Option<String>,

        /// New instructions
        #[arg(long)]
        instructions: Option<String>,

        /// Prep time in minutes
        #[arg(long)]
        prep_time: Option<i32>,

        /// Cook time in minutes
        #[arg(long)]
        cook_time: Option<i32>,

        /// Number of servings
        #[arg(long)]
        servings: Option<i32>,

        /// Add a tag (can be repeated)
        #[arg(long = "add-tag", value_name = "TAG")]
        add_tags: Vec<String>,

        /// Remove a tag (can be repeated)
        #[arg(long = "remove-tag", value_name = "TAG")]
        remove_tags: Vec<String>,

        /// Image URL
        #[arg(long)]
        image_url: Option<String>,

        /// Source URL
        #[arg(long)]
        source_url: Option<String>,

        /// Nutrients as JSON: '{"calories": 650, "protein": 25, "carbs": 80, "fat": 28}'
        /// Units: kcal for calories, grams for all others. Replaces existing nutrients.
        #[arg(long, value_name = "JSON")]
        nutrients: Option<String>,
    },

    /// Delete a dish
    Delete {
        /// Dish ID (UUID) or name
        identifier: String,

        /// Skip confirmation prompt
        #[arg(long, short)]
        force: bool,
    },

    /// Add an ingredient to a dish
    AddIngredient {
        /// Dish ID (UUID) or name
        identifier: String,

        /// Ingredient name
        #[arg(long)]
        name: String,

        /// Quantity (amount)
        #[arg(long)]
        quantity: f64,

        /// Unit of measurement
        #[arg(long)]
        unit: String,
    },

    /// Remove an ingredient from a dish
    RemoveIngredient {
        /// Dish ID (UUID) or name
        identifier: String,

        /// Ingredient name to remove
        #[arg(long)]
        name: String,
    },
}

/// Parse nutrients from JSON string like '{"calories": 650, "protein": 25}'
/// Returns Vec<Nutrient> with appropriate units (kcal for calories, g for others)
fn parse_nutrients(json: &str) -> Result<Vec<Nutrient>, Box<dyn std::error::Error>> {
    let map: HashMap<String, f64> = serde_json::from_str(json)
        .map_err(|e| format!("Invalid nutrients JSON: {}. Expected format: '{{\"calories\": 650, \"protein\": 25, \"carbs\": 80, \"fat\": 28}}'", e))?;

    let nutrients = map
        .into_iter()
        .map(|(name, amount)| {
            let unit = if name.to_lowercase() == "calories" {
                "kcal"
            } else {
                "g"
            };
            Nutrient::new(name, amount, unit)
        })
        .collect();

    Ok(nutrients)
}

fn print_dish_table(dishes: &[Dish]) {
    println!("{:<36}  {:<30}  TAGS", "ID", "NAME");
    println!("{}", "-".repeat(80));
    for dish in dishes {
        let tags = dish.tags.join(", ");
        let name = if dish.name.len() > 30 {
            format!("{}...", &dish.name[..27])
        } else {
            dish.name.clone()
        };
        println!("{:<36}  {:<30}  {}", dish.id, name, tags);
    }
    println!("\nTotal: {} dish(es)", dishes.len());
}

impl DishCommand {
    pub fn run(
        &self,
        repo: &SyncDishRepository,
        config: &Config,
    ) -> Result<(), Box<dyn std::error::Error>> {
        match &self.command {
            DishSubcommand::Create {
                name,
                instructions,
                prep_time,
                cook_time,
                servings,
                tags,
                image_url,
                source_url,
                nutrients,
            } => {
                if name.trim().is_empty() {
                    return Err("Dish name cannot be empty".into());
                }

                let mut dish = Dish::new(name.trim(), &config.created_by.value);

                if let Some(instructions) = instructions {
                    dish = dish.with_instructions(instructions);
                }
                if let Some(prep_time) = prep_time {
                    dish = dish.with_prep_time(*prep_time);
                }
                if let Some(cook_time) = cook_time {
                    dish = dish.with_cook_time(*cook_time);
                }
                if let Some(servings) = servings {
                    dish = dish.with_servings(*servings);
                }
                if !tags.is_empty() {
                    dish = dish.with_tags(tags.clone());
                }
                if image_url.is_some() {
                    dish.image_url = image_url.clone();
                }
                if source_url.is_some() {
                    dish.source_url = source_url.clone();
                }
                if let Some(nutrients_json) = nutrients {
                    let parsed = parse_nutrients(nutrients_json)?;
                    dish = dish.with_nutrients(parsed);
                }

                let created = repo.create(&dish)?;
                println!("Created dish:");
                println!("{}", created);
                Ok(())
            }

            DishSubcommand::List { format, tag } => {
                let dishes = repo.list()?;

                // Filter by tag if specified
                let dishes: Vec<_> = if let Some(tag) = tag {
                    let tag_lower = tag.to_lowercase();
                    dishes
                        .into_iter()
                        .filter(|d| d.tags.iter().any(|t| t.to_lowercase() == tag_lower))
                        .collect()
                } else {
                    dishes
                };

                if dishes.is_empty() {
                    println!("No dishes found");
                    return Ok(());
                }

                match format {
                    OutputFormat::Json => {
                        println!("{}", serde_json::to_string_pretty(&dishes)?);
                    }
                    OutputFormat::Text => {
                        print_dish_table(&dishes);
                    }
                }
                Ok(())
            }

            DishSubcommand::Search { query, format } => {
                if query.trim().is_empty() {
                    return Err("Search query cannot be empty".into());
                }

                let dishes = repo.search(query.trim())?;

                if dishes.is_empty() {
                    println!("No dishes found");
                    return Ok(());
                }

                match format {
                    OutputFormat::Json => {
                        println!("{}", serde_json::to_string_pretty(&dishes)?);
                    }
                    OutputFormat::Text => {
                        print_dish_table(&dishes);
                    }
                }
                Ok(())
            }

            DishSubcommand::Show { identifier, format } => {
                // Try to parse as UUID first, then fall back to name lookup
                let dish = if let Ok(uuid) = Uuid::parse_str(identifier) {
                    repo.get_by_id(uuid)?
                } else {
                    repo.get_by_name(identifier)?
                };

                match dish {
                    Some(dish) => {
                        match format {
                            OutputFormat::Json => {
                                println!("{}", serde_json::to_string_pretty(&dish)?);
                            }
                            OutputFormat::Text => {
                                println!("{}", dish);
                            }
                        }
                        Ok(())
                    }
                    None => Err(format!("Dish not found: {}", identifier).into()),
                }
            }

            DishSubcommand::Update {
                identifier,
                name,
                instructions,
                prep_time,
                cook_time,
                servings,
                add_tags,
                remove_tags,
                image_url,
                source_url,
                nutrients,
            } => {
                // Check if any updates were provided
                let has_updates = name.is_some()
                    || instructions.is_some()
                    || prep_time.is_some()
                    || cook_time.is_some()
                    || servings.is_some()
                    || !add_tags.is_empty()
                    || !remove_tags.is_empty()
                    || image_url.is_some()
                    || source_url.is_some()
                    || nutrients.is_some();

                if !has_updates {
                    return Err("Nothing to update. Provide at least one option.".into());
                }

                // Find the dish
                let dish = if let Ok(uuid) = Uuid::parse_str(identifier) {
                    repo.get_by_id(uuid)?
                } else {
                    repo.get_by_name(identifier)?
                };

                let mut dish = match dish {
                    Some(d) => d,
                    None => return Err(format!("Dish not found: {}", identifier).into()),
                };

                // Apply updates
                if let Some(new_name) = name {
                    dish.name = new_name.clone();
                }
                if let Some(new_instructions) = instructions {
                    dish.instructions = new_instructions.clone();
                }
                if let Some(new_prep_time) = prep_time {
                    dish.prep_time = Some(*new_prep_time);
                }
                if let Some(new_cook_time) = cook_time {
                    dish.cook_time = Some(*new_cook_time);
                }
                if let Some(new_servings) = servings {
                    dish.servings = Some(*new_servings);
                }
                if let Some(new_image_url) = image_url {
                    dish.image_url = Some(new_image_url.clone());
                }
                if let Some(new_source_url) = source_url {
                    dish.source_url = Some(new_source_url.clone());
                }

                // Handle tag additions
                for tag in add_tags {
                    if !dish
                        .tags
                        .iter()
                        .any(|t| t.to_lowercase() == tag.to_lowercase())
                    {
                        dish.tags.push(tag.clone());
                    }
                }

                // Handle tag removals
                for tag in remove_tags {
                    let tag_lower = tag.to_lowercase();
                    dish.tags.retain(|t| t.to_lowercase() != tag_lower);
                }

                // Handle nutrients (replaces existing)
                if let Some(nutrients_json) = nutrients {
                    let parsed = parse_nutrients(nutrients_json)?;
                    dish.nutrients = Some(parsed);
                }

                let updated = repo.update(&dish)?;
                println!("Updated dish:");
                println!("{}", updated);
                Ok(())
            }

            DishSubcommand::Delete { identifier, force } => {
                // Find the dish
                let dish = if let Ok(uuid) = Uuid::parse_str(identifier) {
                    repo.get_by_id(uuid)?
                } else {
                    repo.get_by_name(identifier)?
                };

                let dish = match dish {
                    Some(d) => d,
                    None => return Err(format!("Dish not found: {}", identifier).into()),
                };

                // Confirm deletion unless --force is used
                if !force {
                    print!("Delete dish '{}'? [y/N] ", dish.name);
                    io::stdout().flush()?;

                    let mut input = String::new();
                    io::stdin().read_line(&mut input)?;

                    if !input.trim().eq_ignore_ascii_case("y") {
                        println!("Deletion cancelled.");
                        return Ok(());
                    }
                }

                repo.delete(dish.id)?;
                println!("Deleted dish: {}", dish.name);
                Ok(())
            }

            DishSubcommand::AddIngredient {
                identifier,
                name,
                quantity,
                unit,
            } => {
                // Validate quantity
                if *quantity <= 0.0 {
                    return Err("Quantity must be a positive number".into());
                }

                // Find the dish
                let dish = if let Ok(uuid) = Uuid::parse_str(identifier) {
                    repo.get_by_id(uuid)?
                } else {
                    repo.get_by_name(identifier)?
                };

                let dish = match dish {
                    Some(d) => d,
                    None => return Err(format!("Dish not found: {}", identifier).into()),
                };

                let ingredient = Ingredient::new(name, *quantity, unit);
                println!("Added ingredient to '{}':", dish.name);
                println!("  {}", ingredient);
                repo.add_ingredient(dish.id, ingredient)?;
                Ok(())
            }

            DishSubcommand::RemoveIngredient { identifier, name } => {
                // Find the dish
                let dish = if let Ok(uuid) = Uuid::parse_str(identifier) {
                    repo.get_by_id(uuid)?
                } else {
                    repo.get_by_name(identifier)?
                };

                let dish = match dish {
                    Some(d) => d,
                    None => return Err(format!("Dish not found: {}", identifier).into()),
                };

                // Check if ingredient exists
                let has_ingredient = dish
                    .ingredients
                    .iter()
                    .any(|i| i.name.to_lowercase() == name.to_lowercase());

                if !has_ingredient {
                    return Err(format!("Ingredient not found: {}", name).into());
                }

                repo.remove_ingredient(dish.id, name)?;
                println!("Removed ingredient '{}' from '{}'", name, dish.name);
                Ok(())
            }
        }
    }
}
