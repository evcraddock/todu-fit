//! CLI configuration and error-reporting adapter for the Core sync coordinator.

use std::path::PathBuf;

use todu_fit_core::sync::{SyncAllResult, SyncCoordinator, SyncCoordinatorError};
use todu_fit_core::MultiDocStorage;

use crate::config::SyncConfig;

use todu_fit_core::sync::SyncError as CoreSyncError;

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

impl From<SyncCoordinatorError> for SyncClientError {
    fn from(error: SyncCoordinatorError) -> Self {
        match error {
            SyncCoordinatorError::NotInitialized => Self::NotInitialized,
            SyncCoordinatorError::NoGroups => Self::NoGroups,
            SyncCoordinatorError::SyncError(error) => Self::SyncError(error),
            SyncCoordinatorError::StorageError(error) => Self::StorageError(error),
            SyncCoordinatorError::IdentityError(error) => Self::IdentityError(error),
        }
    }
}

/// Sync client for the CLI that uses identity-based document discovery.
#[derive(Debug)]
pub struct SyncClient {
    coordinator: SyncCoordinator,
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
            coordinator: SyncCoordinator::new(server_url, MultiDocStorage::new(data_dir)),
        })
    }

    /// Delegate discovery, ordering and persistence to the shared coordinator.
    pub async fn sync_all(&mut self) -> Result<SyncAllResult, SyncClientError> {
        self.coordinator.sync_all().await.map_err(Into::into)
    }

    /// Returns the server URL.
    #[cfg(test)]
    pub fn server_url(&self) -> &str {
        self.coordinator.server_url()
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
