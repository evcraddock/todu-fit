//! Group management commands.

use clap::{Args, Subcommand};
use std::fs;
use std::path::{Path, PathBuf};

use todu_fit_core::{DocumentId, Identity, IdentityState, MultiDocStorage};

use crate::config::Config;

/// Manage groups for shared dishes and meal plans
#[derive(serde::Serialize, serde::Deserialize, Args)]
pub struct GroupCommand {
    #[command(subcommand)]
    pub command: GroupSubcommand,
}

#[derive(serde::Serialize, serde::Deserialize, Subcommand)]
pub enum GroupSubcommand {
    /// Create a new group
    Create {
        /// Name of the group
        name: String,
    },
    /// Join an existing group by document ID
    Join {
        /// Group document ID
        id: String,
        /// Display name for the group
        #[arg(long)]
        name: Option<String>,
    },
    /// List all groups
    List,
    /// Switch to a different group
    Switch {
        /// Name of the group to switch to
        name: String,
    },
    /// Show current group details
    Show,
    /// Leave a group
    Leave {
        /// Name of the group to leave
        name: String,
        /// Skip confirmation prompt
        #[arg(long, short)]
        force: bool,
    },
}

impl GroupCommand {
    pub fn run(&self, config: &Config) -> Result<(), GroupError> {
        let data_dir = &config.data_dir.value;
        let storage = MultiDocStorage::new(data_dir.clone());
        let identity = Identity::new(storage);

        // Most group commands require initialized identity
        if identity.state() == IdentityState::Uninitialized {
            println!("No identity configured.");
            println!();
            println!("Run 'fit init --new' to create a new identity first.");
            return Ok(());
        }

        if identity.state() == IdentityState::PendingSync {
            println!("Identity is pending sync.");
            println!();
            println!("Run 'fit sync' to fetch your data first.");
            return Ok(());
        }

        match &self.command {
            GroupSubcommand::Create { name } => self.create(&identity, data_dir, name),
            GroupSubcommand::Join { id, name } => {
                self.join(&identity, data_dir, id, name.as_deref())
            }
            GroupSubcommand::List => self.list(&identity, data_dir),
            GroupSubcommand::Switch { name } => self.switch(data_dir, name),
            GroupSubcommand::Show => self.show(&identity, data_dir),
            GroupSubcommand::Leave { name, force } => self.leave(&identity, data_dir, name, *force),
        }
    }

    fn create(&self, identity: &Identity, data_dir: &Path, name: &str) -> Result<(), GroupError> {
        let group_id = identity.create_group(name)?;

        println!("✓ Group '{}' created successfully!", name);
        println!();
        println!("Group ID: {}", group_id.to_bs58check());
        println!();
        println!("To invite others to this group:");
        println!(
            "  fit group join {} --name \"{}\"",
            group_id.to_bs58check(),
            name
        );

        // Auto-switch to the new group if it's the first one
        let groups = identity.list_groups()?;
        if groups.len() == 1 {
            save_current_group(data_dir, name)?;
            println!();
            println!("This is your first group, so it's now your current group.");
        }

        Ok(())
    }

    fn join(
        &self,
        identity: &Identity,
        data_dir: &Path,
        id: &str,
        name: Option<&str>,
    ) -> Result<(), GroupError> {
        let doc_id = DocumentId::from_bs58check(id)
            .map_err(|e| GroupError::InvalidDocId(id.to_string(), e.to_string()))?;

        // Use provided name or a default
        let group_name = name.unwrap_or("Shared Group");

        identity.join_group(doc_id, group_name)?;

        println!("✓ Joined group '{}' successfully!", group_name);
        println!();
        println!("Group ID: {}", id);
        println!();
        println!("Run 'fit sync' to fetch the group's dishes and meal plans.");

        // Auto-switch to the new group if it's the first one
        let groups = identity.list_groups()?;
        if groups.len() == 1 {
            save_current_group(data_dir, group_name)?;
            println!();
            println!("This is your first group, so it's now your current group.");
        }

        Ok(())
    }

    fn list(&self, identity: &Identity, data_dir: &Path) -> Result<(), GroupError> {
        let groups = identity.list_groups()?;
        let current = load_current_group(data_dir);

        if groups.is_empty() {
            println!("No groups.");
            println!();
            println!("Create one with: fit group create <name>");
            return Ok(());
        }

        println!("Groups");
        println!("======");
        println!();

        for group in &groups {
            let marker = if current.as_deref() == Some(&group.name) {
                "* "
            } else {
                "  "
            };
            println!("{}{}", marker, group.name);
            println!("    ID: {}", group.doc_id.to_bs58check());
        }

        println!();
        println!("* = current group");

        Ok(())
    }

    fn switch(&self, data_dir: &Path, name: &str) -> Result<(), GroupError> {
        let storage = MultiDocStorage::new(data_dir.to_path_buf());
        let identity = Identity::new(storage);

        // Verify group exists
        let groups = identity.list_groups()?;
        let group = groups.iter().find(|g| g.name.eq_ignore_ascii_case(name));

        match group {
            Some(g) => {
                save_current_group(data_dir, &g.name)?;
                println!("Switched to group '{}'", g.name);
            }
            None => {
                println!("Group '{}' not found.", name);
                println!();
                println!("Available groups:");
                for g in &groups {
                    println!("  - {}", g.name);
                }
            }
        }

        Ok(())
    }

    fn show(&self, identity: &Identity, data_dir: &Path) -> Result<(), GroupError> {
        let current_name = load_current_group(data_dir);

        let groups = identity.list_groups()?;

        if groups.is_empty() {
            println!("No groups configured.");
            println!();
            println!("Create one with: fit group create <name>");
            return Ok(());
        }

        let current_group = match &current_name {
            Some(name) => groups.iter().find(|g| &g.name == name),
            None => groups.first(),
        };

        match current_group {
            Some(group_ref) => {
                // Try to load the full group document
                match identity.load_group(&group_ref.doc_id) {
                    Ok(group_doc) => {
                        println!("Current Group: {}", group_doc.name);
                        println!("=============={}=", "=".repeat(group_doc.name.len()));
                        println!();
                        println!("ID:         {}", group_ref.doc_id.to_bs58check());
                        println!("Dishes ID:  {}", group_doc.dishes_doc_id.to_bs58check());
                        println!("Plans ID:   {}", group_doc.mealplans_doc_id.to_bs58check());
                        println!();
                        println!("To invite others:");
                        println!(
                            "  fit group join {} --name \"{}\"",
                            group_ref.doc_id.to_bs58check(),
                            group_doc.name
                        );
                    }
                    Err(_) => {
                        // Group document not synced yet
                        println!("Current Group: {}", group_ref.name);
                        println!("=============={}=", "=".repeat(group_ref.name.len()));
                        println!();
                        println!("ID: {}", group_ref.doc_id.to_bs58check());
                        println!();
                        println!("Status: Pending sync");
                        println!("Run 'fit sync' to fetch group data.");
                    }
                }
            }
            None => {
                println!("No current group set.");
                println!();
                println!("Switch to a group with: fit group switch <name>");
            }
        }

        Ok(())
    }

    fn leave(
        &self,
        identity: &Identity,
        data_dir: &Path,
        name: &str,
        force: bool,
    ) -> Result<(), GroupError> {
        let groups = identity.list_groups()?;
        let group = groups.iter().find(|g| g.name.eq_ignore_ascii_case(name));

        match group {
            Some(g) => {
                if !force {
                    use std::io::{self, Write};
                    print!(
                        "Leave group '{}'? This won't delete the group. [y/N] ",
                        g.name
                    );
                    io::stdout().flush()?;

                    let mut input = String::new();
                    crate::output::read_confirmation(&mut input)?;

                    if !input.trim().eq_ignore_ascii_case("y") {
                        println!("Cancelled.");
                        return Ok(());
                    }
                }

                identity.leave_group(&g.doc_id)?;
                println!("Left group '{}'", g.name);

                // Clear current group if it was the one we left
                if let Some(current) = load_current_group(data_dir) {
                    if current.eq_ignore_ascii_case(name) {
                        clear_current_group(data_dir)?;
                    }
                }
            }
            None => {
                println!("Group '{}' not found.", name);
            }
        }

        Ok(())
    }
}

// ==================== Current Group Persistence ====================

fn current_group_path(data_dir: &Path) -> PathBuf {
    data_dir.join("current_group")
}

fn load_current_group(data_dir: &Path) -> Option<String> {
    fs::read_to_string(current_group_path(data_dir))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn save_current_group(data_dir: &Path, name: &str) -> Result<(), GroupError> {
    let path = current_group_path(data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, name)?;
    Ok(())
}

fn clear_current_group(data_dir: &Path) -> Result<(), GroupError> {
    let path = current_group_path(data_dir);
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Errors from group command
#[derive(Debug)]
pub enum GroupError {
    IdentityError(todu_fit_core::IdentityError),
    InvalidDocId(String, String),
    IoError(std::io::Error),
}

impl std::fmt::Display for GroupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GroupError::IdentityError(e) => write!(f, "{}", e),
            GroupError::InvalidDocId(id, e) => write!(f, "Invalid document ID '{}': {}", id, e),
            GroupError::IoError(e) => write!(f, "I/O error: {}", e),
        }
    }
}

impl std::error::Error for GroupError {}

impl From<todu_fit_core::IdentityError> for GroupError {
    fn from(e: todu_fit_core::IdentityError) -> Self {
        GroupError::IdentityError(e)
    }
}

impl From<std::io::Error> for GroupError {
    fn from(e: std::io::Error) -> Self {
        GroupError::IoError(e)
    }
}
