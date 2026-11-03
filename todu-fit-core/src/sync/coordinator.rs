//! Identity-aware sync coordination shared by application adapters.
//!
//! Documents are discovered after syncing their parent metadata. Successful
//! exchanges are persisted individually; a later failure does not roll them back.
//! Scheduling, configuration, runtime ownership and reporting belong to callers.

use super::{SyncClient, SyncError};
use crate::{DocumentId, Identity, IdentityState, MultiDocStorage};
use automerge::AutoCommit;

/// Errors that can occur during identity-aware coordination.
#[derive(Debug)]
pub enum SyncCoordinatorError {
    /// Identity not initialized
    NotInitialized,
    /// No groups configured
    NoGroups,
    /// Core sync error
    SyncError(SyncError),
    /// Storage error
    StorageError(String),
    /// Identity error
    IdentityError(String),
}

impl std::fmt::Display for SyncCoordinatorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncCoordinatorError::NotInitialized => {
                write!(f, "Identity not initialized.")
            }
            SyncCoordinatorError::NoGroups => {
                write!(f, "No groups configured.")
            }
            SyncCoordinatorError::SyncError(e) => write!(f, "{}", e),
            SyncCoordinatorError::StorageError(e) => write!(f, "Storage error: {}", e),
            SyncCoordinatorError::IdentityError(e) => write!(f, "Identity error: {}", e),
        }
    }
}

impl std::error::Error for SyncCoordinatorError {}

impl From<SyncError> for SyncCoordinatorError {
    fn from(e: SyncError) -> Self {
        SyncCoordinatorError::SyncError(e)
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
pub struct SyncAllResult {
    /// Results for each document synced
    pub documents: Vec<DocSyncResult>,
}

impl SyncAllResult {
    /// Returns true if any document was updated.
    pub fn any_updated(&self) -> bool {
        self.documents.iter().any(|r| r.updated)
    }
}

/// Coordinates identity-based document discovery, synchronization and persistence.
#[derive(Debug)]
pub struct SyncCoordinator {
    core: SyncClient,
    storage: MultiDocStorage,
}

impl SyncCoordinator {
    /// Creates a coordinator with explicit server and storage supplied by the caller.
    /// Does not load application configuration or create an async runtime.
    pub fn new(server_url: impl Into<String>, storage: MultiDocStorage) -> Self {
        Self {
            core: SyncClient::new(server_url),
            storage,
        }
    }

    /// Syncs all documents based on identity.
    ///
    /// This syncs:
    /// - The identity document itself
    /// - The personal meallogs and hydration documents
    /// - Each group document followed by its dishes, mealplans and shopping carts
    ///
    /// Stops on the first exchange/storage error, keeping earlier successful saves.
    /// Unreadable group metadata is skipped, preserving the existing sync policy.
    pub async fn sync_all(&mut self) -> Result<SyncAllResult, SyncCoordinatorError> {
        let identity = Identity::new(self.storage.clone());

        // Check identity state and remember if we're waiting to pull from server
        let is_pending_sync = match identity.state() {
            IdentityState::Uninitialized => return Err(SyncCoordinatorError::NotInitialized),
            IdentityState::PendingSync => true,
            IdentityState::Initialized => false,
        };

        let mut results = Vec::new();

        // 1. Sync identity document
        let identity_doc_id = identity
            .root_doc_id()
            .map_err(|e| SyncCoordinatorError::IdentityError(e.to_string()))?
            .ok_or(SyncCoordinatorError::NotInitialized)?;

        results.push(self.sync_document(&identity_doc_id, "identity").await?);

        // If we were in PendingSync state (joined but waiting to pull from server),
        // verify the identity document now has content
        if is_pending_sync {
            const MIN_VALID_DOC_SIZE: usize = 50;
            if let Some(bytes) = self
                .storage
                .load(&identity_doc_id)
                .map_err(|e| SyncCoordinatorError::StorageError(e.to_string()))?
            {
                if bytes.len() < MIN_VALID_DOC_SIZE {
                    return Err(SyncCoordinatorError::IdentityError(
                        "Identity document is empty after sync. \
                         The original device may not have synced yet."
                            .to_string(),
                    ));
                }
            } else {
                return Err(SyncCoordinatorError::IdentityError(
                    "Identity document not found after sync.".to_string(),
                ));
            }
        }

        // Reload identity after sync (it may have been updated)
        let identity = Identity::new(self.storage.clone());

        // 2. Get identity document for personal document IDs
        let identity_doc = identity
            .load_identity()
            .map_err(|e| SyncCoordinatorError::IdentityError(e.to_string()))?;

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
            .map_err(|e| SyncCoordinatorError::IdentityError(e.to_string()))?;

        if groups.is_empty() {
            return Err(SyncCoordinatorError::NoGroups);
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

        Ok(SyncAllResult { documents: results })
    }

    /// Syncs a single document by ID.
    async fn sync_document(
        &mut self,
        doc_id: &DocumentId,
        name: &str,
    ) -> Result<DocSyncResult, SyncCoordinatorError> {
        // Load or create local document
        let mut doc = self
            .storage
            .load(doc_id)
            .map_err(|e| SyncCoordinatorError::StorageError(e.to_string()))?
            .map(|bytes| {
                AutoCommit::load(&bytes)
                    .map_err(|e| SyncCoordinatorError::StorageError(e.to_string()))
            })
            .transpose()?
            .unwrap_or_else(AutoCommit::new);

        // Sync with server
        let result = self.core.sync_document(doc_id, &mut doc).await?;

        // Save updated document
        let bytes = doc.save();
        self.storage
            .save(doc_id, &bytes)
            .map_err(|e| SyncCoordinatorError::StorageError(e.to_string()))?;

        Ok(DocSyncResult {
            name: name.to_string(),
            updated: result.updated,
            rounds: result.rounds,
        })
    }

    /// Returns the server URL.
    pub fn server_url(&self) -> &str {
        self.core.server_url()
    }
}
