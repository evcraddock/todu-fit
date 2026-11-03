//! Device management commands.

use clap::{Args, Subcommand};

use todu_fit_core::{Identity, IdentityState, MultiDocStorage};

use crate::config::Config;

/// Manage device identity
#[derive(serde::Serialize, serde::Deserialize, Args)]
pub struct DeviceCommand {
    #[command(subcommand)]
    command: DeviceSubcommand,
}

#[derive(serde::Serialize, serde::Deserialize, Subcommand)]
enum DeviceSubcommand {
    /// Show identity document ID for sharing with other devices
    Show,
}

impl DeviceCommand {
    pub fn run(&self, config: &Config) -> Result<(), DeviceError> {
        match &self.command {
            DeviceSubcommand::Show => self.show(config),
        }
    }

    fn show(&self, config: &Config) -> Result<(), DeviceError> {
        let storage = MultiDocStorage::new(config.data_dir.value.clone());
        let identity = Identity::new(storage);

        match identity.state() {
            IdentityState::Uninitialized => {
                println!("No identity configured.");
                println!();
                println!("Run 'fit init --new' to create a new identity.");
                return Ok(());
            }
            IdentityState::PendingSync => {
                let root_id = identity.root_doc_id()?.unwrap();
                println!("Identity (pending sync)");
                println!("=======================");
                println!();
                println!("ID: {}", root_id.to_bs58check());
                println!();
                println!("Status: Waiting for sync to complete.");
                println!("Run 'fit sync' to fetch your data.");
                return Ok(());
            }
            IdentityState::Initialized => {
                // Continue to show full details
            }
        }

        let root_id = identity.root_doc_id()?.unwrap();
        let identity_doc = identity.load_identity()?;

        println!("Identity");
        println!("========");
        println!();
        println!("ID: {}", root_id.to_bs58check());
        println!();
        println!("To add another device, run on that device:");
        println!("  fit init --join {}", root_id.to_bs58check());
        println!();
        println!("Groups: {}", identity_doc.groups.len());
        for group in &identity_doc.groups {
            println!("  - {} ({})", group.name, group.doc_id.to_bs58check());
        }

        Ok(())
    }
}

/// Errors from device command
#[derive(Debug)]
pub enum DeviceError {
    IdentityError(todu_fit_core::IdentityError),
}

impl std::fmt::Display for DeviceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DeviceError::IdentityError(e) => write!(f, "{}", e),
        }
    }
}

impl std::error::Error for DeviceError {}

impl From<todu_fit_core::IdentityError> for DeviceError {
    fn from(e: todu_fit_core::IdentityError) -> Self {
        DeviceError::IdentityError(e)
    }
}
