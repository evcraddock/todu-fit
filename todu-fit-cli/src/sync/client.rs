//! WebSocket sync client wrapper for the CLI.
//!
//! This module wraps the core sync client and provides identity-based
//! document synchronization.

use std::path::PathBuf;

use automerge::AutoCommit;

use todu_fit_core::{DocumentId, Identity, IdentityState, MultiDocStorage};

use crate::config::SyncConfig;

// Re-export core types
pub use todu_fit_core::sync::{SyncClient as CoreSyncClient, SyncError as CoreSyncError};

/// Errors that can occur during sync client operations.
#[derive(Debug)]
pub enum SyncClientError {
    /// Sync is not configured
    NotConfigured,
    /// Identity not initialized
    NotInitialized,
    /// No groups configured
    NoGroups,
    /// Core sync error
    SyncError(CoreSyncError),
    /// Storage error
    StorageError(String),
    /// Identity error
    IdentityError(String),
}

impl std::fmt::Display for SyncClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncClientError::NotConfigured => {
                write!(f, "Sync not configured. Add server_url to config.")
            }
            SyncClientError::NotInitialized => {
                write!(f, "Identity not initialized. Run 'fit init --new' first.")
            }
            SyncClientError::NoGroups => {
                write!(
                    f,
                    "No groups configured. Run 'fit group create <name>' first."
                )
            }
            SyncClientError::SyncError(e) => write!(f, "{}", e),
            SyncClientError::StorageError(e) => write!(f, "Storage error: {}", e),
            SyncClientError::IdentityError(e) => write!(f, "Identity error: {}", e),
        }
    }
}

impl std::error::Error for SyncClientError {}

impl From<CoreSyncError> for SyncClientError {
    fn from(e: CoreSyncError) -> Self {
        SyncClientError::SyncError(e)
    }
}

/// Result of syncing a single document.
#[derive(Debug, Clone)]
pub struct DocSyncResult {
    /// Human-readable name for the document
    pub name: String,
    /// Whether the document was updated
    pub updated: bool,
    /// Number of sync round-trips
    pub rounds: usize,
}

/// Result of a full sync operation.
#[derive(Debug)]
pub struct SyncResult {
    /// Results for each document synced
    pub documents: Vec<DocSyncResult>,
}

impl SyncResult {
    /// Returns true if any document was updated.
    pub fn any_updated(&self) -> bool {
        self.documents.iter().any(|r| r.updated)
    }
}

/// Sync client for the CLI that uses identity-based document discovery.
#[derive(Debug)]
pub struct SyncClient {
    core: CoreSyncClient,
    storage: MultiDocStorage,
}

impl SyncClient {
    /// Creates a new sync client from config.
    ///
    /// Returns an error if sync is not configured.
    pub fn from_config(config: &SyncConfig, data_dir: PathBuf) -> Result<Self, SyncClientError> {
        let server_url = config
            .server_url
            .clone()
            .ok_or(SyncClientError::NotConfigured)?;

        Ok(Self {
            core: CoreSyncClient::new(server_url),
            storage: MultiDocStorage::new(data_dir),
        })
    }

    /// Syncs all documents based on identity.
    ///
    /// This syncs:
    /// - The identity document itself
    /// - All group documents
    /// - All dishes and mealplans documents for each group
    /// - The personal meallogs document
    /// - The personal hydration document
    pub async fn sync_all(&mut self) -> Result<SyncResult, SyncClientError> {
        let identity = Identity::new(self.storage.clone());

        // Check identity state and remember if we're waiting to pull from server
        let is_pending_sync = match identity.state() {
            IdentityState::Uninitialized => return Err(SyncClientError::NotInitialized),
            IdentityState::PendingSync => true,
            IdentityState::Initialized => false,
        };

        let mut results = Vec::new();

        // 1. Sync identity document
        let identity_doc_id = identity
            .root_doc_id()
            .map_err(|e| SyncClientError::IdentityError(e.to_string()))?
            .ok_or(SyncClientError::NotInitialized)?;

        results.push(self.sync_document(&identity_doc_id, "identity").await?);

        // If we were in PendingSync state (joined but waiting to pull from server),
        // verify the identity document now has content
        if is_pending_sync {
            const MIN_VALID_DOC_SIZE: usize = 50;
            if let Some(bytes) = self
                .storage
                .load(&identity_doc_id)
                .map_err(|e| SyncClientError::StorageError(e.to_string()))?
            {
                if bytes.len() < MIN_VALID_DOC_SIZE {
                    return Err(SyncClientError::IdentityError(
                        "Identity document is empty after sync. \
                         The original device may not have synced yet."
                            .to_string(),
                    ));
                }
            } else {
                return Err(SyncClientError::IdentityError(
                    "Identity document not found after sync.".to_string(),
                ));
            }
        }

        // Reload identity after sync (it may have been updated)
        let identity = Identity::new(self.storage.clone());

        // 2. Get identity document for personal document IDs
        let identity_doc = identity
            .load_identity()
            .map_err(|e| SyncClientError::IdentityError(e.to_string()))?;

        // 3. Sync personal documents
        results.push(
            self.sync_document(&identity_doc.meallogs_doc_id, "meallogs")
                .await?,
        );
        results.push(
            self.sync_document(&identity_doc.hydration_doc_id, "hydration")
                .await?,
        );

        // 4. Sync each group and its documents
        let groups = identity
            .list_groups()
            .map_err(|e| SyncClientError::IdentityError(e.to_string()))?;

        if groups.is_empty() {
            return Err(SyncClientError::NoGroups);
        }

        for group_ref in groups {
            // Sync group document
            let group_name = format!("group:{}", group_ref.name);
            results.push(self.sync_document(&group_ref.doc_id, &group_name).await?);

            // Load group to get dishes/mealplans doc IDs
            match identity.load_group(&group_ref.doc_id) {
                Ok(group_doc) => {
                    // Sync dishes
                    let dishes_name = format!("{}:dishes", group_ref.name);
                    results.push(
                        self.sync_document(&group_doc.dishes_doc_id, &dishes_name)
                            .await?,
                    );

                    // Sync mealplans
                    let mealplans_name = format!("{}:mealplans", group_ref.name);
                    results.push(
                        self.sync_document(&group_doc.mealplans_doc_id, &mealplans_name)
                            .await?,
                    );

                    // Sync shopping carts
                    let shopping_name = format!("{}:shopping", group_ref.name);
                    results.push(
                        self.sync_document(&group_doc.shopping_carts_doc_id, &shopping_name)
                            .await?,
                    );
                }
                Err(_) => {
                    // Group document not synced yet, will get it next time
                }
            }
        }

        Ok(SyncResult { documents: results })
    }

    /// Syncs a single document by ID.
    async fn sync_document(
        &mut self,
        doc_id: &DocumentId,
        name: &str,
    ) -> Result<DocSyncResult, SyncClientError> {
        // Load or create local document
        let mut doc = self
            .storage
            .load(doc_id)
            .map_err(|e| SyncClientError::StorageError(e.to_string()))?
            .map(|bytes| {
                AutoCommit::load(&bytes).map_err(|e| SyncClientError::StorageError(e.to_string()))
            })
            .transpose()?
            .unwrap_or_else(AutoCommit::new);

        // Sync with server
        let result = self.core.sync_document(doc_id, &mut doc).await?;

        // Save updated document
        let bytes = doc.save();
        self.storage
            .save(doc_id, &bytes)
            .map_err(|e| SyncClientError::StorageError(e.to_string()))?;

        Ok(DocSyncResult {
            name: name.to_string(),
            updated: result.updated,
            rounds: result.rounds,
        })
    }

    /// Returns the server URL.
    #[cfg(test)]
    pub fn server_url(&self) -> &str {
        self.core.server_url()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_sync_client_from_config() {
        let temp_dir = TempDir::new().unwrap();
        let config = SyncConfig {
            server_url: Some("wss://sync.example.com".to_string()),
            auto_sync: false,
        };
        let client = SyncClient::from_config(&config, temp_dir.path().to_path_buf()).unwrap();
        assert_eq!(client.server_url(), "wss://sync.example.com");
    }

    #[test]
    fn test_sync_client_not_configured() {
        let temp_dir = TempDir::new().unwrap();
        let config = SyncConfig {
            server_url: None,
            auto_sync: false,
        };
        let result = SyncClient::from_config(&config, temp_dir.path().to_path_buf());
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            SyncClientError::NotConfigured
        ));
    }
}
