//! Identity management for multi-user support.
//!
//! This module provides the `Identity` struct which manages:
//! - Identity lifecycle (uninitialized → initialized)
//! - Creating and joining identities
//! - Creating and joining groups
//!
//! # Identity States
//!
//! 1. **Uninitialized** - No root_doc_id file exists
//! 2. **Initialized** - Has root_doc_id and identity document on disk
//! 3. **PendingSync** - Has root_doc_id but no local identity document (joined but not synced)
//!
//! # Storage Layout
//!
//! ```text
//! ~/.local/share/fit/
//! ├── root_doc_id                    # text file with identity doc ID
//! ├── <identity-id>.automerge        # IdentityDocument
//! ├── <meallogs-id>.automerge        # personal meal logs
//! ├── <hydration-id>.automerge       # personal hydration data
//! ├── <group-id>.automerge           # GroupDocument
//! ├── <dishes-id>.automerge          # group's dishes
//! └── <mealplans-id>.automerge       # group's meal plans
//! ```

use automerge::transaction::Transactable;
use automerge::{AutoCommit, ReadDoc};

use crate::automerge::{MultiDocStorage, MultiStorageError};
use crate::document_id::DocumentId;
use crate::documents::{GroupDocument, GroupRef, IdentityDocument};

/// Identity state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityState {
    /// No identity has been set up (no root_doc_id file)
    Uninitialized,
    /// Identity is set up and document exists locally
    Initialized,
    /// Identity ID is set but document hasn't been synced yet
    PendingSync,
}

/// Identity manager for multi-user support.
///
/// Manages identity lifecycle, groups, and document references.
#[derive(Debug)]
pub struct Identity {
    storage: MultiDocStorage,
}

impl Identity {
    /// Create a new identity manager with the given storage.
    pub fn new(storage: MultiDocStorage) -> Self {
        Self { storage }
    }

    /// Get the current identity state.
    pub fn state(&self) -> IdentityState {
        match self.storage.load_root_id() {
            Ok(Some(root_id)) => {
                if self.storage.exists(&root_id) {
                    IdentityState::Initialized
                } else {
                    IdentityState::PendingSync
                }
            }
            Ok(None) => IdentityState::Uninitialized,
            Err(_) => IdentityState::Uninitialized,
        }
    }

    /// Check if identity is initialized.
    pub fn is_initialized(&self) -> bool {
        self.state() == IdentityState::Initialized
    }

    /// Check if identity is pending sync.
    pub fn is_pending_sync(&self) -> bool {
        self.state() == IdentityState::PendingSync
    }

    /// Get the root document ID if set.
    pub fn root_doc_id(&self) -> Result<Option<DocumentId>, IdentityError> {
        self.storage
            .load_root_id()
            .map_err(IdentityError::StorageError)
    }

    /// Initialize a new identity.
    ///
    /// Creates:
    /// 1. A new identity document with generated personal document IDs
    /// 2. Empty meallogs and hydration documents
    /// 3. Saves the root_doc_id file
    ///
    /// Returns an error if already initialized.
    pub fn initialize_new(&self) -> Result<DocumentId, IdentityError> {
        if self.state() != IdentityState::Uninitialized {
            return Err(IdentityError::AlreadyInitialized);
        }

        // Create identity document
        let identity_doc = IdentityDocument::new();
        let identity_doc_id = DocumentId::new();

        // Save identity document as Automerge
        let identity_bytes = self.serialize_identity_document(&identity_doc)?;
        self.storage
            .save(&identity_doc_id, &identity_bytes)
            .map_err(IdentityError::StorageError)?;

        // Create empty personal documents
        self.create_empty_personal_doc(&identity_doc.meallogs_doc_id)?;
        self.create_empty_personal_doc(&identity_doc.hydration_doc_id)?;

        // Save root document ID
        self.storage
            .save_root_id(&identity_doc_id)
            .map_err(IdentityError::StorageError)?;

        Ok(identity_doc_id)
    }

    /// Join an existing identity by document ID.
    ///
    /// Sets the root_doc_id but does not fetch the document (that happens on sync).
    /// After calling this, state will be `PendingSync`.
    ///
    /// Returns an error if already initialized.
    pub fn initialize_join(&self, identity_doc_id: DocumentId) -> Result<(), IdentityError> {
        if self.state() != IdentityState::Uninitialized {
            return Err(IdentityError::AlreadyInitialized);
        }

        // Just save the root document ID
        // The actual document will be fetched during sync
        self.storage
            .save_root_id(&identity_doc_id)
            .map_err(IdentityError::StorageError)?;

        Ok(())
    }

    /// Load the identity document.
    ///
    /// Returns an error if not initialized or document not found.
    pub fn load_identity(&self) -> Result<IdentityDocument, IdentityError> {
        let root_id = self
            .storage
            .load_root_id()
            .map_err(IdentityError::StorageError)?
            .ok_or(IdentityError::NotInitialized)?;

        let bytes = self
            .storage
            .load(&root_id)
            .map_err(IdentityError::StorageError)?
            .ok_or(IdentityError::DocumentNotFound(root_id))?;

        self.deserialize_identity_document(&bytes)
    }

    /// Save the identity document.
    pub fn save_identity(&self, doc: &IdentityDocument) -> Result<(), IdentityError> {
        let root_id = self
            .storage
            .load_root_id()
            .map_err(IdentityError::StorageError)?
            .ok_or(IdentityError::NotInitialized)?;

        let bytes = self.serialize_identity_document(doc)?;
        self.storage
            .save(&root_id, &bytes)
            .map_err(IdentityError::StorageError)?;

        Ok(())
    }

    // ==================== Group Operations ====================

    /// Create a new group.
    ///
    /// Creates:
    /// 1. A new group document with generated dishes_doc_id and mealplans_doc_id
    /// 2. Empty dishes and mealplans documents
    /// 3. Adds group reference to identity document
    ///
    /// Returns the group document ID.
    pub fn create_group(&self, name: impl Into<String>) -> Result<DocumentId, IdentityError> {
        let name = name.into();

        if self.state() != IdentityState::Initialized {
            return Err(IdentityError::NotInitialized);
        }

        // Create group document
        let group_doc = GroupDocument::new(&name);
        let group_doc_id = DocumentId::new();

        // Save group document
        let group_bytes = self.serialize_group_document(&group_doc)?;
        self.storage
            .save(&group_doc_id, &group_bytes)
            .map_err(IdentityError::StorageError)?;

        // Create empty dishes document
        // We put and delete a key to ensure at least one change is recorded,
        // otherwise useDocument returns null for truly empty docs
        let mut dishes_doc = AutoCommit::new();
        dishes_doc
            .put(automerge::ROOT, "_", true)
            .map_err(|e| IdentityError::AutomergeError(e.to_string()))?;
        dishes_doc.delete(automerge::ROOT, "_").ok();
        let dishes_bytes = dishes_doc.save();
        self.storage
            .save(&group_doc.dishes_doc_id, &dishes_bytes)
            .map_err(IdentityError::StorageError)?;

        // Create empty mealplans document
        // We put and delete a key to ensure at least one change is recorded,
        // otherwise useDocument returns null for truly empty docs
        let mut mealplans_doc = AutoCommit::new();
        mealplans_doc
            .put(automerge::ROOT, "_", true)
            .map_err(|e| IdentityError::AutomergeError(e.to_string()))?;
        mealplans_doc.delete(automerge::ROOT, "_").ok();
        let mealplans_bytes = mealplans_doc.save();
        self.storage
            .save(&group_doc.mealplans_doc_id, &mealplans_bytes)
            .map_err(IdentityError::StorageError)?;

        // Add group reference to identity
        let mut identity = self.load_identity()?;
        identity.add_group(GroupRef::new(&name, group_doc_id));
        self.save_identity(&identity)?;

        Ok(group_doc_id)
    }

    /// Join an existing group by document ID.
    ///
    /// Adds the group reference to the identity document.
    /// The group document and its referenced documents will be fetched during sync.
    pub fn join_group(
        &self,
        group_doc_id: DocumentId,
        name: impl Into<String>,
    ) -> Result<(), IdentityError> {
        if self.state() != IdentityState::Initialized {
            return Err(IdentityError::NotInitialized);
        }

        let mut identity = self.load_identity()?;

        // Check if already in group
        if identity.has_group(&group_doc_id) {
            return Err(IdentityError::AlreadyInGroup(group_doc_id));
        }

        identity.add_group(GroupRef::new(name, group_doc_id));
        self.save_identity(&identity)?;

        Ok(())
    }

    /// Leave a group.
    ///
    /// Removes the group reference from the identity document.
    /// Does not delete the local group documents.
    pub fn leave_group(&self, group_doc_id: &DocumentId) -> Result<(), IdentityError> {
        if self.state() != IdentityState::Initialized {
            return Err(IdentityError::NotInitialized);
        }

        let mut identity = self.load_identity()?;
        identity.remove_group(group_doc_id);
        self.save_identity(&identity)?;

        Ok(())
    }

    /// List all groups.
    pub fn list_groups(&self) -> Result<Vec<GroupRef>, IdentityError> {
        if self.state() != IdentityState::Initialized {
            return Ok(Vec::new());
        }

        let identity = self.load_identity()?;
        Ok(identity.groups)
    }

    /// Load a group document.
    pub fn load_group(&self, group_doc_id: &DocumentId) -> Result<GroupDocument, IdentityError> {
        let bytes = self
            .storage
            .load(group_doc_id)
            .map_err(IdentityError::StorageError)?
            .ok_or(IdentityError::DocumentNotFound(*group_doc_id))?;

        self.deserialize_group_document(&bytes)
    }

    /// Get the meallogs document ID for the current identity.
    pub fn meallogs_doc_id(&self) -> Result<DocumentId, IdentityError> {
        let identity = self.load_identity()?;
        Ok(identity.meallogs_doc_id)
    }

    /// Get the hydration document ID for the current identity.
    pub fn hydration_doc_id(&self) -> Result<DocumentId, IdentityError> {
        let identity = self.load_identity()?;
        Ok(identity.hydration_doc_id)
    }

    /// Get a reference to the storage.
    pub fn storage(&self) -> &MultiDocStorage {
        &self.storage
    }

    // ==================== Internal Helpers ====================

    fn create_empty_personal_doc(&self, doc_id: &DocumentId) -> Result<(), IdentityError> {
        let mut doc = AutoCommit::new();
        doc.put(automerge::ROOT, "_", true)
            .map_err(|e| IdentityError::AutomergeError(e.to_string()))?;
        doc.delete(automerge::ROOT, "_").ok();
        let bytes = doc.save();
        self.storage
            .save(doc_id, &bytes)
            .map_err(IdentityError::StorageError)?;
        Ok(())
    }

    fn serialize_identity_document(
        &self,
        doc: &IdentityDocument,
    ) -> Result<Vec<u8>, IdentityError> {
        // For now, store as JSON in an Automerge document
        // In the future, we could use Automerge's native CRDT features
        let json = serde_json::to_string(doc).map_err(IdentityError::SerializationError)?;

        let mut am_doc = AutoCommit::new();
        am_doc
            .put(automerge::ROOT, "data", json)
            .map_err(|e| IdentityError::AutomergeError(e.to_string()))?;

        Ok(am_doc.save())
    }

    fn deserialize_identity_document(
        &self,
        bytes: &[u8],
    ) -> Result<IdentityDocument, IdentityError> {
        let am_doc =
            AutoCommit::load(bytes).map_err(|e| IdentityError::AutomergeError(e.to_string()))?;

        let json: String = am_doc
            .get(automerge::ROOT, "data")
            .map_err(|e| IdentityError::AutomergeError(e.to_string()))?
            .and_then(|(val, _)| val.into_string().ok())
            .ok_or_else(|| IdentityError::AutomergeError("Missing data field".to_string()))?;

        serde_json::from_str(&json).map_err(IdentityError::SerializationError)
    }

    fn serialize_group_document(&self, doc: &GroupDocument) -> Result<Vec<u8>, IdentityError> {
        let json = serde_json::to_string(doc).map_err(IdentityError::SerializationError)?;

        let mut am_doc = AutoCommit::new();
        am_doc
            .put(automerge::ROOT, "data", json)
            .map_err(|e| IdentityError::AutomergeError(e.to_string()))?;

        Ok(am_doc.save())
    }

    fn deserialize_group_document(&self, bytes: &[u8]) -> Result<GroupDocument, IdentityError> {
        let am_doc =
            AutoCommit::load(bytes).map_err(|e| IdentityError::AutomergeError(e.to_string()))?;

        let json: String = am_doc
            .get(automerge::ROOT, "data")
            .map_err(|e| IdentityError::AutomergeError(e.to_string()))?
            .and_then(|(val, _)| val.into_string().ok())
            .ok_or_else(|| IdentityError::AutomergeError("Missing data field".to_string()))?;

        serde_json::from_str(&json).map_err(IdentityError::SerializationError)
    }
}

/// Errors that can occur during identity operations.
#[derive(Debug)]
pub enum IdentityError {
    /// Storage error.
    StorageError(MultiStorageError),
    /// Identity is already initialized.
    AlreadyInitialized,
    /// Identity is not initialized.
    NotInitialized,
    /// Document not found.
    DocumentNotFound(DocumentId),
    /// Already a member of this group.
    AlreadyInGroup(DocumentId),
    /// Serialization error.
    SerializationError(serde_json::Error),
    /// Automerge error.
    AutomergeError(String),
}

impl std::fmt::Display for IdentityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IdentityError::StorageError(e) => write!(f, "Storage error: {}", e),
            IdentityError::AlreadyInitialized => write!(f, "Identity is already initialized"),
            IdentityError::NotInitialized => write!(f, "Identity is not initialized"),
            IdentityError::DocumentNotFound(id) => {
                write!(f, "Document not found: {}", id.to_bs58check())
            }
            IdentityError::AlreadyInGroup(id) => {
                write!(f, "Already a member of group: {}", id.to_bs58check())
            }
            IdentityError::SerializationError(e) => write!(f, "Serialization error: {}", e),
            IdentityError::AutomergeError(e) => write!(f, "Automerge error: {}", e),
        }
    }
}

impl std::error::Error for IdentityError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            IdentityError::StorageError(e) => Some(e),
            IdentityError::SerializationError(e) => Some(e),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_identity() -> (Identity, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let storage = MultiDocStorage::new(temp_dir.path().to_path_buf());
        let identity = Identity::new(storage);
        (identity, temp_dir)
    }

    // ==================== State Tests ====================

    #[test]
    fn test_initial_state_uninitialized() {
        let (identity, _temp) = test_identity();
        assert_eq!(identity.state(), IdentityState::Uninitialized);
        assert!(!identity.is_initialized());
        assert!(!identity.is_pending_sync());
    }

    #[test]
    fn test_state_after_initialize_new() {
        let (identity, _temp) = test_identity();
        identity.initialize_new().unwrap();

        assert_eq!(identity.state(), IdentityState::Initialized);
        assert!(identity.is_initialized());
        assert!(!identity.is_pending_sync());
    }

    #[test]
    fn test_state_after_initialize_join() {
        let (identity, _temp) = test_identity();
        let doc_id = DocumentId::new();
        identity.initialize_join(doc_id).unwrap();

        assert_eq!(identity.state(), IdentityState::PendingSync);
        assert!(!identity.is_initialized());
        assert!(identity.is_pending_sync());
    }

    // ==================== Initialize Tests ====================

    #[test]
    fn test_initialize_new() {
        let (identity, _temp) = test_identity();

        let root_id = identity.initialize_new().unwrap();

        // Should have root_doc_id
        assert!(identity.storage.has_root_id());
        let loaded_root = identity.root_doc_id().unwrap().unwrap();
        assert_eq!(loaded_root, root_id);

        // Should have identity document
        assert!(identity.storage.exists(&root_id));

        // Should be able to load identity
        let identity_doc = identity.load_identity().unwrap();
        assert!(identity_doc.groups.is_empty());

        // Should have meallogs and hydration documents
        assert!(identity.storage.exists(&identity_doc.meallogs_doc_id));
        assert!(identity.storage.exists(&identity_doc.hydration_doc_id));
    }

    #[test]
    fn test_initialize_new_twice_fails() {
        let (identity, _temp) = test_identity();

        identity.initialize_new().unwrap();
        let result = identity.initialize_new();

        assert!(matches!(result, Err(IdentityError::AlreadyInitialized)));
    }

    #[test]
    fn test_initialize_join() {
        let (identity, _temp) = test_identity();
        let doc_id = DocumentId::new();

        identity.initialize_join(doc_id).unwrap();

        // Should have root_doc_id
        let loaded_root = identity.root_doc_id().unwrap().unwrap();
        assert_eq!(loaded_root, doc_id);

        // Should NOT have identity document (pending sync)
        assert!(!identity.storage.exists(&doc_id));
    }

    #[test]
    fn test_initialize_join_twice_fails() {
        let (identity, _temp) = test_identity();
        let doc_id = DocumentId::new();

        identity.initialize_join(doc_id).unwrap();
        let result = identity.initialize_join(DocumentId::new());

        assert!(matches!(result, Err(IdentityError::AlreadyInitialized)));
    }

    // ==================== Group Tests ====================

    #[test]
    fn test_create_group() {
        let (identity, _temp) = test_identity();
        identity.initialize_new().unwrap();

        let group_id = identity.create_group("Family").unwrap();

        // Should have group document
        assert!(identity.storage.exists(&group_id));

        // Group should be in identity
        let groups = identity.list_groups().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].name, "Family");
        assert_eq!(groups[0].doc_id, group_id);

        // Should be able to load group
        let group_doc = identity.load_group(&group_id).unwrap();
        assert_eq!(group_doc.name, "Family");

        // Should have dishes and mealplans documents
        assert!(identity.storage.exists(&group_doc.dishes_doc_id));
        assert!(identity.storage.exists(&group_doc.mealplans_doc_id));
    }

    #[test]
    fn test_create_group_not_initialized() {
        let (identity, _temp) = test_identity();

        let result = identity.create_group("Family");
        assert!(matches!(result, Err(IdentityError::NotInitialized)));
    }

    #[test]
    fn test_create_multiple_groups() {
        let (identity, _temp) = test_identity();
        identity.initialize_new().unwrap();

        identity.create_group("Family").unwrap();
        identity.create_group("Work").unwrap();

        let groups = identity.list_groups().unwrap();
        assert_eq!(groups.len(), 2);

        let names: Vec<_> = groups.iter().map(|g| g.name.as_str()).collect();
        assert!(names.contains(&"Family"));
        assert!(names.contains(&"Work"));
    }

    #[test]
    fn test_join_group() {
        let (identity, _temp) = test_identity();
        identity.initialize_new().unwrap();

        let group_doc_id = DocumentId::new();
        identity.join_group(group_doc_id, "Shared Group").unwrap();

        let groups = identity.list_groups().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].name, "Shared Group");
        assert_eq!(groups[0].doc_id, group_doc_id);
    }

    #[test]
    fn test_join_group_twice_fails() {
        let (identity, _temp) = test_identity();
        identity.initialize_new().unwrap();

        let group_doc_id = DocumentId::new();
        identity.join_group(group_doc_id, "Group").unwrap();

        let result = identity.join_group(group_doc_id, "Group Again");
        assert!(matches!(result, Err(IdentityError::AlreadyInGroup(_))));
    }

    #[test]
    fn test_leave_group() {
        let (identity, _temp) = test_identity();
        identity.initialize_new().unwrap();

        let group_id = identity.create_group("Family").unwrap();
        assert_eq!(identity.list_groups().unwrap().len(), 1);

        identity.leave_group(&group_id).unwrap();
        assert!(identity.list_groups().unwrap().is_empty());

        // Note: group document is still on disk (not deleted)
        assert!(identity.storage.exists(&group_id));
    }

    // ==================== Personal Document Tests ====================

    #[test]
    fn test_meallogs_doc_id() {
        let (identity, _temp) = test_identity();
        identity.initialize_new().unwrap();

        let meallogs_id = identity.meallogs_doc_id().unwrap();

        // Should exist
        assert!(identity.storage.exists(&meallogs_id));

        // Should match identity document
        let identity_doc = identity.load_identity().unwrap();
        assert_eq!(meallogs_id, identity_doc.meallogs_doc_id);
    }

    // ==================== Serialization Tests ====================

    #[test]
    fn test_hydration_doc_id() {
        let (identity, _temp) = test_identity();
        identity.initialize_new().unwrap();

        let hydration_id = identity.hydration_doc_id().unwrap();

        assert!(identity.storage.exists(&hydration_id));

        let identity_doc = identity.load_identity().unwrap();
        assert_eq!(hydration_id, identity_doc.hydration_doc_id);
    }

    #[test]
    fn test_identity_document_roundtrip() {
        let (identity, _temp) = test_identity();
        identity.initialize_new().unwrap();

        // Add some groups
        identity.create_group("Family").unwrap();
        identity.create_group("Work").unwrap();

        // Reload identity
        let loaded = identity.load_identity().unwrap();
        assert_eq!(loaded.groups.len(), 2);
        assert_eq!(
            loaded.schema_version,
            IdentityDocument::CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn test_group_document_roundtrip() {
        let (identity, _temp) = test_identity();
        identity.initialize_new().unwrap();

        let group_id = identity.create_group("Test Group").unwrap();

        // Load group
        let group = identity.load_group(&group_id).unwrap();
        assert_eq!(group.name, "Test Group");
        assert_eq!(group.schema_version, GroupDocument::CURRENT_SCHEMA_VERSION);
    }
}
