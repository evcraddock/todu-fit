use clap::{Parser, Subcommand};
use std::path::PathBuf;

mod commands;
mod config;
mod models;
mod sync;

use commands::{
    meal::MealRepos, ConfigCommand, DeviceCommand, DishCommand, DishSubcommand, GroupCommand,
    GroupSubcommand, InitCommand, MealCommand, MealPlanCommand, MealPlanSubcommand, MealSubcommand,
    ShoppingCommand, ShoppingSubcommand, SyncCommand, WaterCommand, WaterSubcommand,
};
use config::Config;
use sync::{
    try_auto_sync, SyncDishRepository, SyncHydrationRepository, SyncMealLogRepository,
    SyncMealPlanRepository, SyncShoppingRepository,
};

#[derive(Parser)]
#[command(name = "fit")]
#[command(version)]
#[command(about = "A fitness tracking CLI application", long_about = None)]
struct Cli {
    /// Path to config file
    #[arg(long, short, global = true)]
    config: Option<PathBuf>,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize identity (new or join existing)
    Init(InitCommand),

    /// Show device identity for sharing
    Device(DeviceCommand),

    /// Manage groups for shared dishes and meal plans
    Group(GroupCommand),

    /// Manage dishes (recipes)
    Dish(DishCommand),

    /// Log and track meals
    Meal(MealCommand),

    /// Manage meal plans
    Mealplan(MealPlanCommand),

    /// Manage shopping carts
    Shopping(ShoppingCommand),

    /// Track private water intake
    Water(WaterCommand),

    /// Manage configuration
    Config(ConfigCommand),

    /// Sync with remote server
    Sync(SyncCommand),
}

fn main() {
    if let Err(e) = run() {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    // Save config path for init command
    let cli_config_path = cli.config.clone();

    // Load configuration
    let config = Config::load(cli.config)?;

    // Auto-sync BEFORE read commands
    if is_read_command(&cli.command) {
        try_auto_sync(&config);
    }

    // Execute the command
    let result = execute_command(&cli.command, &config, cli_config_path);

    // Auto-sync AFTER commands that write or may migrate settings (only if command succeeded)
    if result.is_ok() && is_write_command(&cli.command) {
        try_auto_sync(&config);
    }

    result
}

fn execute_command(
    command: &Option<Commands>,
    config: &Config,
    cli_config_path: Option<PathBuf>,
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        Some(Commands::Init(cmd)) => {
            cmd.run(config)?;
        }
        Some(Commands::Device(cmd)) => {
            cmd.run(config)?;
        }
        Some(Commands::Group(cmd)) => {
            cmd.run(config)?;
        }
        Some(Commands::Dish(cmd)) => {
            let repo = SyncDishRepository::new(config.data_dir.value.clone());
            cmd.run(&repo, config)?;
        }
        Some(Commands::Meal(cmd)) => {
            let data_dir = config.data_dir.value.clone();
            let meallog_repo = SyncMealLogRepository::new(data_dir.clone());
            let mealplan_repo = SyncMealPlanRepository::new(data_dir.clone());
            let dish_repo = SyncDishRepository::new(data_dir);
            let repos = MealRepos {
                meallog: &meallog_repo,
                mealplan: &mealplan_repo,
                dish: &dish_repo,
            };
            cmd.run(repos, config)?;
        }
        Some(Commands::Mealplan(cmd)) => {
            let data_dir = config.data_dir.value.clone();
            let mealplan_repo = SyncMealPlanRepository::new(data_dir.clone());
            let dish_repo = SyncDishRepository::new(data_dir);
            cmd.run(&mealplan_repo, &dish_repo, config)?;
        }
        Some(Commands::Shopping(cmd)) => {
            let data_dir = config.data_dir.value.clone();
            let shopping_repo = SyncShoppingRepository::new(data_dir.clone());
            let mealplan_repo = SyncMealPlanRepository::new(data_dir.clone());
            let dish_repo = SyncDishRepository::new(data_dir);
            cmd.run(&shopping_repo, &mealplan_repo, &dish_repo, config)?;
        }
        Some(Commands::Water(cmd)) => {
            let repo = SyncHydrationRepository::new(config.data_dir.value.clone());
            cmd.run(&repo)?;
        }
        Some(Commands::Config(cmd)) => {
            cmd.run(config, cli_config_path)?;
        }
        Some(Commands::Sync(cmd)) => {
            cmd.run(config)?;
        }
        None => {
            println!("Use --help to see available commands");
        }
    }

    Ok(())
}

/// Returns true if the command is a read operation that should sync before execution.
fn is_read_command(cmd: &Option<Commands>) -> bool {
    matches!(
        cmd,
        Some(Commands::Dish(d)) if matches!(d.command,
            DishSubcommand::List { .. } | DishSubcommand::Show { .. })
    ) || matches!(
        cmd,
        Some(Commands::Meal(m)) if matches!(m.command,
            MealSubcommand::History { .. })
    ) || matches!(
        cmd,
        Some(Commands::Mealplan(mp)) if matches!(mp.command,
            MealPlanSubcommand::List { .. } | MealPlanSubcommand::Show { .. })
    ) || matches!(
        cmd,
        Some(Commands::Group(g)) if matches!(g.command,
            GroupSubcommand::List | GroupSubcommand::Show)
    ) || matches!(
        cmd,
        Some(Commands::Shopping(s)) if matches!(s.command,
            ShoppingSubcommand::List { .. })
    ) || matches!(
        cmd,
        Some(Commands::Water(w)) if matches!(w.command,
            WaterSubcommand::Today { .. }
            | WaterSubcommand::Recent { .. }
            | WaterSubcommand::History { .. }
            | WaterSubcommand::Settings { .. })
    )
}

/// Returns true if the command is a write operation that should sync after execution.
fn is_write_command(cmd: &Option<Commands>) -> bool {
    matches!(
        cmd,
        Some(Commands::Dish(d)) if matches!(d.command,
            DishSubcommand::Create { .. }
            | DishSubcommand::Update { .. }
            | DishSubcommand::Delete { .. }
            | DishSubcommand::AddIngredient { .. }
            | DishSubcommand::RemoveIngredient { .. })
    ) || matches!(
        cmd,
        Some(Commands::Meal(m)) if matches!(m.command,
            MealSubcommand::Log { .. })
    ) || matches!(
        cmd,
        Some(Commands::Mealplan(mp)) if matches!(mp.command,
            MealPlanSubcommand::Create { .. }
            | MealPlanSubcommand::Update { .. }
            | MealPlanSubcommand::Delete { .. })
    ) || matches!(
        cmd,
        Some(Commands::Group(g)) if matches!(g.command,
            GroupSubcommand::Create { .. }
            | GroupSubcommand::Join { .. }
            | GroupSubcommand::Leave { .. })
    ) || matches!(
        cmd,
        Some(Commands::Shopping(s)) if matches!(s.command,
            ShoppingSubcommand::Add { .. }
            | ShoppingSubcommand::Remove { .. }
            | ShoppingSubcommand::Check { .. }
            | ShoppingSubcommand::Uncheck { .. }
            | ShoppingSubcommand::ClearChecked { .. })
    ) || matches!(
        cmd,
        Some(Commands::Water(w)) if matches!(w.command,
            WaterSubcommand::Add { .. }
            | WaterSubcommand::Today { .. }
            | WaterSubcommand::Recent { .. }
            | WaterSubcommand::History { .. }
            | WaterSubcommand::Settings { .. }
            | WaterSubcommand::Set { .. }
            | WaterSubcommand::Delete { .. })
    )
}
