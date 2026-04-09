//! Identity document for personal data.
//!
//! The identity document is personal to each user and contains:
//! - Reference to their personal meal logs document
//! - Reference to their personal hydration document
//! - List of groups they belong to

use serde::{Deserialize, Serialize};

use crate::document_id::DocumentId;

use super::GroupRef;

/// Personal identity document.
///
/// Each user has one identity document that references their personal
/// meal logs, personal hydration data, and the groups they belong to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityDocument {
    /// Schema version for migration support
    pub schema_version: u32,

    /// Reference to the user's personal meal logs document
    pub meallogs_doc_id: DocumentId,

    /// Reference to the user's personal hydration document
    #[serde(default)]
    pub hydration_doc_id: DocumentId,

    /// Groups this user belongs to
    pub groups: Vec<GroupRef>,
}

impl IdentityDocument {
    /// Current schema version
    pub const CURRENT_SCHEMA_VERSION: u32 = 2;

    /// Create a new identity document with a new meal logs document ID.
    pub fn new() -> Self {
        Self {
            schema_version: Self::CURRENT_SCHEMA_VERSION,
            meallogs_doc_id: DocumentId::new(),
            hydration_doc_id: DocumentId::new(),
            groups: Vec::new(),
        }
    }

    /// Create an identity document with specific IDs.
    pub fn with_meallogs_doc_id(meallogs_doc_id: DocumentId) -> Self {
        Self {
            schema_version: Self::CURRENT_SCHEMA_VERSION,
            meallogs_doc_id,
            hydration_doc_id: DocumentId::new(),
            groups: Vec::new(),
        }
    }

    /// Add a group reference.
    pub fn add_group(&mut self, group: GroupRef) {
        // Don't add duplicates
        if !self.groups.iter().any(|g| g.doc_id == group.doc_id) {
            self.groups.push(group);
        }
    }

    /// Remove a group by document ID.
    pub fn remove_group(&mut self, doc_id: &DocumentId) {
        self.groups.retain(|g| &g.doc_id != doc_id);
    }

    /// Get a group reference by name.
    pub fn get_group_by_name(&self, name: &str) -> Option<&GroupRef> {
        self.groups.iter().find(|g| g.name == name)
    }

    /// Check if user belongs to a group.
    pub fn has_group(&self, doc_id: &DocumentId) -> bool {
        self.groups.iter().any(|g| &g.doc_id == doc_id)
    }
}

impl Default for IdentityDocument {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_identity() {
        let identity = IdentityDocument::new();
        assert_eq!(
            identity.schema_version,
            IdentityDocument::CURRENT_SCHEMA_VERSION
        );
        assert!(identity.groups.is_empty());
        assert_ne!(identity.meallogs_doc_id, identity.hydration_doc_id);
    }

    #[test]
    fn test_add_group() {
        let mut identity = IdentityDocument::new();
        let group_doc_id = DocumentId::new();
        let group = GroupRef::new("Family", group_doc_id);

        identity.add_group(group.clone());
        assert_eq!(identity.groups.len(), 1);
        assert_eq!(identity.groups[0].name, "Family");

        // Adding same group again should not duplicate
        identity.add_group(group);
        assert_eq!(identity.groups.len(), 1);
    }

    #[test]
    fn test_remove_group() {
        let mut identity = IdentityDocument::new();
        let group_doc_id = DocumentId::new();
        let group = GroupRef::new("Family", group_doc_id);

        identity.add_group(group);
        assert_eq!(identity.groups.len(), 1);

        identity.remove_group(&group_doc_id);
        assert!(identity.groups.is_empty());
    }

    #[test]
    fn test_get_group_by_name() {
        let mut identity = IdentityDocument::new();
        let group = GroupRef::new("Family", DocumentId::new());
        identity.add_group(group);

        assert!(identity.get_group_by_name("Family").is_some());
        assert!(identity.get_group_by_name("Work").is_none());
    }

    #[test]
    fn test_has_group() {
        let mut identity = IdentityDocument::new();
        let group_doc_id = DocumentId::new();
        let group = GroupRef::new("Family", group_doc_id);
        identity.add_group(group);

        assert!(identity.has_group(&group_doc_id));
        assert!(!identity.has_group(&DocumentId::new()));
    }

    #[test]
    fn test_serialization() {
        let mut identity = IdentityDocument::new();
        identity.add_group(GroupRef::new("Family", DocumentId::new()));

        let json = serde_json::to_string(&identity).unwrap();
        let parsed: IdentityDocument = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.schema_version, identity.schema_version);
        assert_eq!(parsed.meallogs_doc_id, identity.meallogs_doc_id);
        assert_eq!(parsed.hydration_doc_id, identity.hydration_doc_id);
        assert_eq!(parsed.groups.len(), 1);
        assert_eq!(parsed.groups[0].name, "Family");
    }

    #[test]
    fn test_deserialization_defaults_hydration_doc_id() {
        let json = format!(
            r#"{{"schema_version":1,"meallogs_doc_id":"{}","groups":[]}}"#,
            DocumentId::new()
        );

        let parsed: IdentityDocument = serde_json::from_str(&json).unwrap();
        assert_ne!(parsed.meallogs_doc_id, parsed.hydration_doc_id);
    }
}
