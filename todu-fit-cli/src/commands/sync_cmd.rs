//! Sync CLI commands for synchronizing with the server.

use clap::{Args, Subcommand};

use crate::config::Config;
use crate::sync::{SyncClient, SyncClientError};

/// Sync with remote server
#[derive(serde::Serialize, serde::Deserialize, Debug, Args)]
pub struct SyncCommand {
    #[command(subcommand)]
    command: Option<SyncSubcommand>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Subcommand)]
enum SyncSubcommand {
    /// Show sync configuration and server status
    Status,
}

impl SyncCommand {
    pub fn is_status(&self) -> bool {
        self.command.is_some()
    }
    pub fn run(&self, config: &Config) -> Result<(), SyncCommandError> {
        // Use tokio runtime for async operations
        let rt = tokio::runtime::Runtime::new()
            .map_err(|e| SyncCommandError::RuntimeError(e.to_string()))?;

        match &self.command {
            None => rt.block_on(self.sync(config)),
            Some(SyncSubcommand::Status) => rt.block_on(self.status(config)),
        }
    }

    async fn sync(&self, config: &Config) -> Result<(), SyncCommandError> {
        let mut client = SyncClient::from_config(&config.sync, config.data_dir.value.clone())?;

        println!("Syncing with server...");
        println!();

        let result = client.sync_all().await?;

        for doc_result in &result.documents {
            let status = if doc_result.updated {
                "✓ updated"
            } else {
                "✓ up to date"
            };
            println!(
                "  {} {} ({} round{})",
                status,
                doc_result.name,
                doc_result.rounds,
                if doc_result.rounds == 1 { "" } else { "s" }
            );
        }

        println!();
        if result.any_updated() {
            println!("Sync complete.");
        } else {
            println!("Already up to date.");
        }

        Ok(())
    }

    async fn status(&self, config: &Config) -> Result<(), SyncCommandError> {
        println!("Sync Configuration");
        println!("==================");
        println!();

        if !config.sync.is_configured() {
            println!("Status: Not configured");
            println!();
            println!("To enable sync, add to your config file:");
            println!();
            println!("  sync:");
            println!("    server_url: \"ws://localhost:3030\"");
            println!();
            println!("Or set environment variable:");
            println!("  FIT_SYNC_URL");
            return Ok(());
        }

        let server_url = config.sync.server_url.as_ref().unwrap();

        println!("Server:    {}", server_url);
        println!(
            "Auto-sync: {}",
            if config.sync.auto_sync {
                "enabled"
            } else {
                "disabled"
            }
        );
        println!();

        // Try to connect to check server status
        print!("Server status: ");

        let mut client = SyncClient::from_config(&config.sync, config.data_dir.value.clone())?;
        match client.sync_all().await {
            Ok(_) => println!("✓ connected"),
            Err(SyncClientError::SyncError(_)) => println!("✗ unreachable"),
            Err(e) => println!("✗ error: {}", e),
        }

        Ok(())
    }
}

/// Errors from sync commands
#[derive(Debug)]
pub enum SyncCommandError {
    SyncError(SyncClientError),
    RuntimeError(String),
}

impl std::fmt::Display for SyncCommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncCommandError::SyncError(e) => write!(f, "{}", e),
            SyncCommandError::RuntimeError(e) => write!(f, "Runtime error: {}", e),
        }
    }
}

impl std::error::Error for SyncCommandError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            SyncCommandError::SyncError(e) => Some(e),
            SyncCommandError::RuntimeError(_) => None,
        }
    }
}

impl From<SyncClientError> for SyncCommandError {
    fn from(e: SyncClientError) -> Self {
        SyncCommandError::SyncError(e)
    }
}
