#[macro_use]
mod output;
mod daemon;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

mod commands;
mod config;
mod models;
mod sync;

use commands::{
    meal::MealRepos, ConfigCommand, DeviceCommand, DishCommand, GroupCommand, InitCommand,
    MealCommand, MealPlanCommand, ShoppingCommand, SyncCommand, WaterCommand,
};
use config::Config;
use sync::{
    SyncDishRepository, SyncHydrationRepository, SyncMealLogRepository, SyncMealPlanRepository,
    SyncShoppingRepository,
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

#[derive(serde::Serialize, serde::Deserialize, Subcommand)]
enum Commands {
    /// Run the shared local owner (explicit startup; no store adoption)
    Daemon,
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

    if matches!(cli.command, Some(Commands::Daemon)) {
        return daemon::serve(config);
    }
    if matches!(cli.command, Some(Commands::Config(_)) | None) {
        return execute_command(&cli.command, &config, cli_config_path);
    }
    daemon::call_cli(cli.command.unwrap(), &config)
}

fn execute_command(
    command: &Option<Commands>,
    config: &Config,
    cli_config_path: Option<PathBuf>,
) -> Result<(), Box<dyn std::error::Error>> {
    let Some(command) = command else {
        println!("Use --help to see available commands");
        return Ok(());
    };
    if let Commands::Config(cmd) = command {
        return cmd.run(config, cli_config_path);
    }
    execute_command_ref(command, config)
}

fn execute_command_ref(
    command: &Commands,
    config: &Config,
) -> Result<(), Box<dyn std::error::Error>> {
    let cli_config_path = config.config_file.clone();
    match command {
        Commands::Daemon => return Err("Nested daemon request denied".into()),
        Commands::Init(cmd) => {
            cmd.run(config)?;
        }
        Commands::Device(cmd) => {
            cmd.run(config)?;
        }
        Commands::Group(cmd) => {
            cmd.run(config)?;
        }
        Commands::Dish(cmd) => {
            let repo = SyncDishRepository::new(config.data_dir.value.clone());
            cmd.run(&repo, config)?;
        }
        Commands::Meal(cmd) => {
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
        Commands::Mealplan(cmd) => {
            let data_dir = config.data_dir.value.clone();
            let mealplan_repo = SyncMealPlanRepository::new(data_dir.clone());
            let dish_repo = SyncDishRepository::new(data_dir);
            cmd.run(&mealplan_repo, &dish_repo, config)?;
        }
        Commands::Shopping(cmd) => {
            let data_dir = config.data_dir.value.clone();
            let shopping_repo = SyncShoppingRepository::new(data_dir.clone());
            let mealplan_repo = SyncMealPlanRepository::new(data_dir.clone());
            let dish_repo = SyncDishRepository::new(data_dir);
            cmd.run(&shopping_repo, &mealplan_repo, &dish_repo, config)?;
        }
        Commands::Water(cmd) => {
            let repo = SyncHydrationRepository::with_timezone_provider(
                config.data_dir.value.clone(),
                commands::detected_system_timezone,
            );
            cmd.run(&repo)?;
        }
        Commands::Config(cmd) => {
            cmd.run(config, cli_config_path)?;
        }
        Commands::Sync(cmd) => {
            cmd.run(config)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_init_honors_explicit_new_path_without_daemon() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new-config.yaml");
        let cli =
            Cli::try_parse_from(["fit", "-c", path.to_str().unwrap(), "config", "init"]).unwrap();
        let config = Config::load(cli.config.clone()).unwrap();
        execute_command(&cli.command, &config, cli.config).unwrap();
        assert!(std::fs::read_to_string(path)
            .unwrap()
            .contains("created_by:"));
    }
}
