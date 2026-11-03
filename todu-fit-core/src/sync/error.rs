//! Sync error types.

/// Errors that can occur during sync client operations.
#[derive(Debug)]
pub enum SyncError {
    /// Sync is not configured
    NotConfigured,
    /// Failed to connect to server
    ConnectionError(String),
    /// WebSocket error
    WebSocketError(String),
    /// Sync protocol error
    ProtocolError(String),
    /// Storage error
    StorageError(String),
    /// Handshake failed
    HandshakeError(String),
    /// Document unavailable on server
    DocumentUnavailable(String),
    /// CBOR encoding/decoding error
    CborError(String),
    /// Handshake timeout
    HandshakeTimeout,
    /// Peer did not acknowledge document convergence before the deadline.
    DocumentSyncTimeout(String),
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncError::NotConfigured => write!(f, "Sync not configured. Add server_url to config."),
            SyncError::ConnectionError(e) => write!(f, "Connection error: {}", e),
            SyncError::WebSocketError(e) => write!(f, "WebSocket error: {}", e),
            SyncError::ProtocolError(e) => write!(f, "Sync protocol error: {}", e),
            SyncError::StorageError(e) => write!(f, "Storage error: {}", e),
            SyncError::HandshakeError(e) => write!(f, "Handshake failed: {}", e),
            SyncError::DocumentUnavailable(doc_id) => {
                write!(
                    f,
                    "Document not found on server: {}. If joining an existing identity, \
                     sync from the original device first.",
                    doc_id
                )
            }
            SyncError::CborError(e) => write!(f, "CBOR error: {}", e),
            SyncError::HandshakeTimeout => write!(f, "Handshake timed out"),
            SyncError::DocumentSyncTimeout(doc_id) => {
                write!(f, "Document sync timed out before completion: {}", doc_id)
            }
        }
    }
}

impl std::error::Error for SyncError {}
