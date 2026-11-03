use clap::{Args, Subcommand, ValueEnum};
use std::fs;
use std::io::Write;

use crate::config::Config;

#[derive(serde::Serialize, serde::Deserialize, Clone, ValueEnum, Default)]
pub enum OutputFormat {
    #[default]
    Text,
    Json,
}

#[derive(serde::Serialize, serde::Deserialize, Args)]
pub struct ConfigCommand {
    #[command(subcommand)]
    pub command: ConfigSubcommand,
}

#[derive(serde::Serialize, serde::Deserialize, Subcommand)]
pub enum ConfigSubcommand {
    /// Show current configuration values
    Show {
        /// Output format
        #[arg(long, short, value_enum, default_value = "text")]
        format: OutputFormat,
    },

    /// Initialize configuration file
    Init,
}

impl ConfigCommand {
    pub fn run(
        &self,
        config: &Config,
        cli_config_path: Option<std::path::PathBuf>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        match &self.command {
            ConfigSubcommand::Show { format } => {
                match format {
                    OutputFormat::Json => {
                        println!("{}", serde_json::to_string_pretty(config)?);
                    }
                    OutputFormat::Text => {
                        println!("Configuration");
                        println!("=============\n");

                        if let Some(path) = &config.config_file {
                            println!("Config file: {}", path.display());
                        } else {
                            println!(
                                "Config file: {} (not found)",
                                Config::default_config_path().display()
                            );
                        }
                        println!();

                        println!("data_dir: {}", config.data_dir.value.display());
                        println!("  source: {}", config.data_dir.source);
                        println!();

                        println!("created_by: {}", config.created_by.value);
                        println!("  source: {}", config.created_by.source);
                        println!();

                        println!("sync:");
                        if let Some(url) = &config.sync.server_url {
                            println!("  server_url: {}", url);
                        } else {
                            println!("  server_url: (not configured)");
                        }
                        println!("  auto_sync: {}", config.sync.auto_sync);
                    }
                }
                Ok(())
            }

            ConfigSubcommand::Init => {
                // Use CLI path if provided, otherwise use loaded config path or default
                let config_path = cli_config_path
                    .or_else(|| config.config_file.clone())
                    .unwrap_or_else(Config::default_config_path);

                // Check if config already exists
                if config_path.exists() {
                    println!("Config file already exists: {}", config_path.display());
                    println!("Use 'fit config show' to view current configuration.");
                    return Ok(());
                }

                // Create parent directory
                if let Some(parent) = config_path.parent() {
                    fs::create_dir_all(parent)?;
                }

                // Write config
                let config_content = format!(
                    r#"# fit configuration

# Default user name for new dishes
created_by: {}

# Sync configuration (uncomment and fill in to enable)
# sync:
#   server_url: wss://sync.example.com
#   auto_sync: false
"#,
                    config.created_by.value
                );

                let mut file = fs::File::create(&config_path)?;
                file.write_all(config_content.as_bytes())?;

                println!("Created config file: {}", config_path.display());
                println!("\nConfiguration:");
                println!("  created_by: {}", config.created_by.value);
                Ok(())
            }
        }
    }
}
