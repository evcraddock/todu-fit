//! Group context resolution for multi-group document access.
//!
//! This module provides helpers to resolve document IDs based on:
//! - The current group setting
//! - The user's identity document
//! - Group documents

use std::fs;
use std::path::{Path, PathBuf};

use todu_fit_core::{DocumentId, Identity, IdentityState, MultiDocStorage};

/// Errors that can occur when resolving group context.
#[derive(Debug)]
pub enum GroupContextError {
    /// Identity not initialized
    NotInitialized,
    /// Identity pending sync
    PendingSync,
    /// No groups configured
    NoGroups,
    /// Group not found
    GroupNotFound(String),
    /// Group document not synced
    GroupNotSynced(String),
    /// Identity error
    IdentityError(todu_fit_core::IdentityError),
}

impl std::fmt::Display for GroupContextError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GroupContextError::NotInitialized => {
                write!(f, "Identity not initialized. Run 'fit init --new' first.")
            }
            GroupContextError::PendingSync => {
                write!(f, "Identity pending sync. Run 'fit sync' first.")
            }
            GroupContextError::NoGroups => {
                write!(
                    f,
                    "No groups configured. Run 'fit group create <name>' first."
                )
            }
            GroupContextError::GroupNotFound(name) => {
                write!(f, "Group '{}' not found.", name)
            }
            GroupContextError::GroupNotSynced(name) => {
                write!(f, "Group '{}' not synced yet. Run 'fit sync' first.", name)
            }
            GroupContextError::IdentityError(e) => write!(f, "{}", e),
        }
    }
}

impl std::error::Error for GroupContextError {}

impl From<todu_fit_core::IdentityError> for GroupContextError {
    fn from(e: todu_fit_core::IdentityError) -> Self {
        GroupContextError::IdentityError(e)
    }
}

/// Resolved group context containing document IDs for the current group.
#[derive(Debug, Clone)]
pub struct GroupContext {
    /// Dishes document ID
    pub dishes_doc_id: DocumentId,
    /// Meal plans document ID
    pub mealplans_doc_id: DocumentId,
    /// Shopping carts document ID
    pub shopping_carts_doc_id: DocumentId,
}

/// Resolved user context containing personal document IDs.
#[derive(Debug, Clone)]
pub struct UserContext {
    /// Personal meal logs document ID
    pub meallogs_doc_id: DocumentId,
    /// Personal hydration document ID
    #[allow(dead_code)]
    pub hydration_doc_id: DocumentId,
}

/// Resolve the current group context.
///
/// Uses the current group setting (from data_dir/current_group)
/// or falls back to the first group if none is set.
///
/// Returns document IDs for the group's dishes and meal plans.
pub fn resolve_group_context(
    data_dir: &Path,
    group_override: Option<&str>,
) -> Result<GroupContext, GroupContextError> {
    let storage = MultiDocStorage::new(data_dir.to_path_buf());
    let identity = Identity::new(storage);

    // Check identity state
    match identity.state() {
        IdentityState::Uninitialized => return Err(GroupContextError::NotInitialized),
        IdentityState::PendingSync => return Err(GroupContextError::PendingSync),
        IdentityState::Initialized => {}
    }

    // Get groups
    let groups = identity.list_groups()?;
    if groups.is_empty() {
        return Err(GroupContextError::NoGroups);
    }

    // Find the target group
    let target_name = group_override
        .map(|s| s.to_string())
        .or_else(|| load_current_group(data_dir))
        .unwrap_or_else(|| groups[0].name.clone());

    let group_ref = groups
        .iter()
        .find(|g| g.name.eq_ignore_ascii_case(&target_name))
        .ok_or_else(|| GroupContextError::GroupNotFound(target_name.clone()))?;

    // Load the group document to get dish/mealplan doc IDs
    let group_doc = identity
        .load_group(&group_ref.doc_id)
        .map_err(|_| GroupContextError::GroupNotSynced(group_ref.name.clone()))?;

    Ok(GroupContext {
        dishes_doc_id: group_doc.dishes_doc_id,
        mealplans_doc_id: group_doc.mealplans_doc_id,
        shopping_carts_doc_id: group_doc.shopping_carts_doc_id,
    })
}

/// Resolve the user context for personal documents.
///
/// Returns document IDs for the user's personal meal logs and hydration data.
pub fn resolve_user_context(data_dir: &Path) -> Result<UserContext, GroupContextError> {
    let storage = MultiDocStorage::new(data_dir.to_path_buf());
    let identity = Identity::new(storage);

    // Check identity state
    match identity.state() {
        IdentityState::Uninitialized => return Err(GroupContextError::NotInitialized),
        IdentityState::PendingSync => return Err(GroupContextError::PendingSync),
        IdentityState::Initialized => {}
    }

    let identity_doc = identity.load_identity()?;

    Ok(UserContext {
        meallogs_doc_id: identity_doc.meallogs_doc_id,
        hydration_doc_id: identity_doc.hydration_doc_id,
    })
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
