//! Sync module for automerge-repo-sync-server.
//!
//! This module provides the WebSocket sync client that uses the Automerge
//! sync protocol to synchronize documents with the server.
//!
//! ## Protocol
//!
//! The client uses the automerge-repo WebSocket protocol:
//! 1. Connect to sync server (no authentication)
//! 2. Send `join` message with peer ID
//! 3. Receive `peer` message with server's peer ID
//! 4. For each document, send `request` then `sync` messages
//! 5. Messages are CBOR-encoded

mod client;
mod coordinator;
mod error;
mod protocol;

pub use client::{check_server, SyncClient, SyncConnection, SyncResult};
pub use coordinator::{DocSyncResult, SyncAllResult, SyncCoordinator, SyncCoordinatorError};
pub use error::SyncError;
pub use protocol::{generate_peer_id, ProtocolMessage};
