//! Initialize identity for multi-user support.

use std::fs;
use std::io::{self, Write};
use std::path::Path;

use clap::Args;

use todu_fit_core::{DocumentId, Identity, IdentityState, MultiDocStorage};

use crate::config::Config;

/// Initialize a new identity or join an existing one
#[derive(serde::Serialize, serde::Deserialize, Args)]
pub struct InitCommand {
    /// Create a new identity
    #[arg(long, conflicts_with = "join")]
    new: bool,

    /// Join an existing identity by document ID
    #[arg(long, conflicts_with = "new", value_name = "DOC_ID")]
    join: Option<String>,

    /// Force reset - delete existing data and start fresh
    #[arg(long, short)]
    force: bool,
}

impl InitCommand {
    pub fn run(&self, config: &Config) -> Result<(), InitError> {
        let data_dir = &config.data_dir.value;
        let storage = MultiDocStorage::new(data_dir.clone());
        let identity = Identity::new(storage);

        match identity.state() {
            IdentityState::Initialized | IdentityState::PendingSync => {
                if self.new || self.join.is_some() {
                    // User wants to init but identity exists - offer to reset
                    if self.force || self.confirm_reset()? {
                        self.wipe_data(data_dir)?;
                        // Recreate identity after wipe
                        let storage = MultiDocStorage::new(data_dir.clone());
                        let identity = Identity::new(storage);
                        return self.do_init(&identity);
                    } else {
                        println!("Cancelled.");
                        return Ok(());
                    }
                } else {
                    // Just show status
                    return self.show_status(&identity);
                }
            }
            IdentityState::Uninitialized => {
                // Continue with initialization
            }
        }

        self.do_init(&identity)
    }

    fn show_status(&self, identity: &Identity) -> Result<(), InitError> {
        match identity.state() {
            IdentityState::Initialized => {
                let root_id = identity.root_doc_id()?.unwrap();
                println!("Identity already initialized.");
                println!();
                println!("Identity ID: {}", root_id.to_bs58check());
                println!();
                println!("To share this identity with another device, use:");
                println!("  fit device show");
                println!();
                println!("To start fresh, run:");
                println!("  fit init --new --force");
            }
            IdentityState::PendingSync => {
                let root_id = identity.root_doc_id()?.unwrap();
                println!("Identity is pending sync.");
                println!();
                println!("Identity ID: {}", root_id.to_bs58check());
                println!();
                println!("Run 'fit sync' to complete the join.");
            }
            IdentityState::Uninitialized => {}
        }
        Ok(())
    }

    fn confirm_reset(&self) -> Result<bool, InitError> {
        println!("Identity already exists.");
        println!();
        print!("Delete all data and start fresh? [y/N] ");
        io::stdout().flush()?;

        let mut input = String::new();
        crate::output::read_confirmation(&mut input)?;

        Ok(input.trim().eq_ignore_ascii_case("y"))
    }

    fn wipe_data(&self, data_dir: &Path) -> Result<(), InitError> {
        if data_dir.exists() {
            fs::remove_dir_all(data_dir)?;
            println!("✓ Deleted existing data");
        }
        Ok(())
    }

    fn do_init(&self, identity: &Identity) -> Result<(), InitError> {
        if self.new {
            self.create_new(identity)
        } else if let Some(doc_id_str) = &self.join {
            self.join_existing(identity, doc_id_str)
        } else {
            println!("Initialize your identity:");
            println!();
            println!("  fit init --new         Create a new identity");
            println!("  fit init --join <ID>   Join an existing identity");
            println!();
            println!("If you're setting up a new account, use --new.");
            println!("If you're adding a device to an existing account, get the");
            println!("identity ID from your other device with 'fit device show'.");
            Ok(())
        }
    }

    fn create_new(&self, identity: &Identity) -> Result<(), InitError> {
        let root_id = identity.initialize_new()?;

        println!("✓ Identity created successfully!");
        println!();
        println!("Identity ID: {}", root_id.to_bs58check());
        println!();
        println!("Next steps:");
        println!("  1. Create a group:  fit group create <name>");
        println!("  2. Add dishes:      fit dish create <name>");
        println!("  3. Plan meals:      fit mealplan create --date YYYY-MM-DD --type dinner");
        println!();
        println!(
            "To add another device, run 'fit init --join {}' on that device.",
            root_id.to_bs58check()
        );

        Ok(())
    }

    fn join_existing(&self, identity: &Identity, doc_id_str: &str) -> Result<(), InitError> {
        let doc_id = DocumentId::from_bs58check(doc_id_str)
            .map_err(|e| InitError::InvalidDocId(doc_id_str.to_string(), e.to_string()))?;

        identity.initialize_join(doc_id)?;

        println!("✓ Identity joined successfully!");
        println!();
        println!("Identity ID: {}", doc_id.to_bs58check());
        println!();
        println!("Status: Pending sync");
        println!();
        println!("Next step: Run 'fit sync' to fetch your data from the sync server.");

        Ok(())
    }
}

/// Errors from init command
#[derive(Debug)]
pub enum InitError {
    IdentityError(todu_fit_core::IdentityError),
    InvalidDocId(String, String),
    IoError(std::io::Error),
}

impl std::fmt::Display for InitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InitError::IdentityError(e) => write!(f, "{}", e),
            InitError::InvalidDocId(id, e) => write!(f, "Invalid document ID '{}': {}", id, e),
            InitError::IoError(e) => write!(f, "I/O error: {}", e),
        }
    }
}

impl std::error::Error for InitError {}

impl From<todu_fit_core::IdentityError> for InitError {
    fn from(e: todu_fit_core::IdentityError) -> Self {
        InitError::IdentityError(e)
    }
}

impl From<std::io::Error> for InitError {
    fn from(e: std::io::Error) -> Self {
        InitError::IoError(e)
    }
}
