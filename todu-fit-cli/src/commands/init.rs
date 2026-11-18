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

    /// Optional group to create with a new identity
    #[arg(long, requires = "new")]
    #[serde(default)]
    group: Option<String>,

    /// Sync server for setup (defaults to configured server)
    #[arg(long, value_name = "URL")]
    #[serde(default)]
    server: Option<String>,
}

impl InitCommand {
    pub fn run_daemon(&self, config: &Config) -> Result<(), Box<dyn std::error::Error>> {
        use todu_fit_protocol::{Operation as Op, Value as V};
        let call =
            |op, id| crate::daemon::application_request(config, op, id).map_err(|e| e.to_string());
        let id = match std::env::var("FIT_REQUEST_ID") {
            Ok(id) => uuid::Uuid::parse_str(&id)?,
            Err(_) => uuid::Uuid::new_v4(),
        };
        if self.force {
            return Err("Shared setup never replaces an existing identity. Select a separate empty data_dir to start fresh; --force is not supported.".into());
        }
        let V::Setup(mut state) = call(Op::SetupStatus, uuid::Uuid::new_v4())? else {
            return Err("Invalid setup response".into());
        };
        if state.state != "ready" && state.state != "running" {
            if !self.new && self.join.is_none() {
                if state.state == "failed" {
                    return Err(format!(
                        "{}. Retry fit init with --new or --join and the intended options.",
                        state.message
                    )
                    .into());
                }
                println!("Choose setup: fit init --new [--group <NAME>] or fit init --join <PERSONAL_SYNC_CODE> [--server <URL>]");
                return Ok(());
            }
            let server = self
                .server
                .as_ref()
                .or(config.sync.server_url.as_ref())
                .map(|s| s.trim().to_owned())
                .filter(|s| !s.is_empty());
            if self.join.is_some() && server.is_none() {
                return Err(
                    "Joining existing data requires --server <URL> or a configured sync server."
                        .into(),
                );
            }
            let result = call(
                Op::SetupStart {
                    root_id: self.join.as_ref().map(|s| s.trim().to_owned()),
                    server_url: server,
                    group_name: self.group.as_ref().map(|s| s.trim().to_owned()),
                    group_id: None,
                    auto_sync: Some(config.sync.auto_sync),
                },
                id,
            )
            .map_err(|e| format!("{e}. Retry the same setup with FIT_REQUEST_ID={id}"))?;
            let V::Setup(started) = result else {
                return Err("Invalid setup response".into());
            };
            state = started;
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(315);
        let mut previous = String::new();
        while state.state == "running" {
            let progress = format!(
                "{} ({} documents downloaded)",
                state.message, state.completed_documents
            );
            if progress != previous {
                eprintln!("{progress}");
                previous = progress;
            }
            if std::time::Instant::now() >= deadline {
                return Err("Setup is still running. Run fit init to check its progress; existing data was not replaced.".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
            let V::Setup(next) = call(Op::SetupStatus, uuid::Uuid::new_v4())? else {
                return Err("Invalid setup response".into());
            };
            state = next;
        }
        if state.state != "ready" {
            return Err(state.message.into());
        }
        let V::Identity(identity) = call(Op::IdentityGet, uuid::Uuid::new_v4())? else {
            return Err("Invalid identity response".into());
        };
        if let Some(expected) = &self.join {
            if identity.root_id.as_deref() != Some(expected.trim()) {
                return Err(
                    "This store already has a different identity. Existing data was not replaced."
                        .into(),
                );
            }
        }
        println!("Identity ready.");
        println!(
            "Personal sync code: {}",
            identity.root_id.as_deref().ok_or("Missing identity")?
        );
        if identity.groups.is_empty() {
            println!("Create a group with: fit group create <NAME>");
        }
        Ok(())
    }
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
