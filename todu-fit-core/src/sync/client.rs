//! WebSocket sync client for automerge-repo-sync-server.
//!
//! Uses the automerge-repo WebSocket protocol with CBOR-encoded messages
//! to synchronize documents with the server. No authentication required.

use std::time::Duration;

use automerge::sync::{Message as SyncMessage, State as SyncState, SyncDoc};
use automerge::AutoCommit;
use futures::{SinkExt, StreamExt};
use tokio::time::timeout;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

use super::error::SyncError;
use super::protocol::{generate_peer_id, PeerMetadata, ProtocolMessage};
use crate::document_id::DocumentId;

/// Timeout for handshake completion.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// Allow slow peers to process a large document without mistaking silence for success.
const DOC_RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);
/// Bound the entire exchange, including peers which only send keepalive messages.
const DOC_SYNC_TIMEOUT: Duration = Duration::from_secs(180);
/// Short timeout for server health checks.
const CHECK_SERVER_TIMEOUT: Duration = Duration::from_secs(3);

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

/// A negotiated connection to the Automerge Repo sync server.
pub struct SyncConnection {
    sender: futures::stream::SplitSink<Socket, Message>,
    receiver: futures::stream::SplitStream<Socket>,
    peer_id: String,
    server_id: String,
}

impl SyncConnection {
    pub async fn ping(&mut self) -> Result<(), SyncError> {
        self.send_frame(Message::Ping(Vec::new().into())).await
    }

    pub async fn send(
        &mut self,
        document_id: &str,
        data: SyncMessage,
        request: bool,
    ) -> Result<(), SyncError> {
        let sender_id = self.peer_id.clone();
        let target_id = self.server_id.clone();
        let document_id = document_id.to_owned();
        let data = data.encode();
        let message = if request {
            ProtocolMessage::Request {
                sender_id,
                target_id,
                document_id,
                data,
            }
        } else {
            ProtocolMessage::Sync {
                sender_id,
                target_id,
                document_id,
                data,
            }
        };
        let bytes = message
            .encode()
            .map_err(|e| SyncError::CborError(e.to_string()))?;
        self.send_frame(Message::Binary(bytes.into())).await
    }

    async fn send_frame(&mut self, frame: Message) -> Result<(), SyncError> {
        timeout(HANDSHAKE_TIMEOUT, self.sender.send(frame))
            .await
            .map_err(|_| SyncError::WebSocketError("Send timed out".into()))?
            .map_err(|e| SyncError::WebSocketError(e.to_string()))
    }

    /// Read one frame. Returning after each frame keeps this safe to use in select!.
    pub async fn receive(&mut self) -> Result<Option<ProtocolMessage>, SyncError> {
        match self.receiver.next().await {
            Some(Ok(Message::Binary(bytes))) => {
                let message = ProtocolMessage::decode(&bytes)
                    .map_err(|e| SyncError::CborError(e.to_string()))?;
                match message {
                    ProtocolMessage::Sync {
                        ref sender_id,
                        ref target_id,
                        ..
                    }
                    | ProtocolMessage::Request {
                        ref sender_id,
                        ref target_id,
                        ..
                    }
                    | ProtocolMessage::DocUnavailable {
                        ref sender_id,
                        ref target_id,
                        ..
                    } if sender_id == &self.server_id && target_id == &self.peer_id => {
                        Ok(Some(message))
                    }
                    ProtocolMessage::Error { message } => Err(SyncError::ProtocolError(message)),
                    ProtocolMessage::Leave { sender_id } if sender_id == self.server_id => {
                        Err(SyncError::ConnectionError("Server left the session".into()))
                    }
                    _ => Ok(None),
                }
            }
            Some(Ok(Message::Close(_))) | None => {
                Err(SyncError::ConnectionError("Sync connection closed".into()))
            }
            Some(Ok(_)) => Ok(None),
            Some(Err(e)) => Err(SyncError::WebSocketError(e.to_string())),
        }
    }
}

/// Result of a sync operation for a single document.
#[derive(Debug, Clone)]
pub struct SyncResult {
    /// Document ID that was synced
    pub doc_id: DocumentId,
    /// Whether the document was updated
    pub updated: bool,
    /// Number of sync round-trips
    pub rounds: usize,
}

/// Check if a sync server is reachable.
///
/// Attempts to connect to the server and perform a handshake.
/// Returns `true` if successful, `false` otherwise.
/// Uses a short timeout (3 seconds) to fail fast.
pub async fn check_server(url: &str) -> bool {
    // Build WebSocket URL
    let ws_url = if url.starts_with("http://") {
        url.replace("http://", "ws://")
    } else if url.starts_with("https://") {
        url.replace("https://", "wss://")
    } else if !url.starts_with("ws://") && !url.starts_with("wss://") {
        format!("ws://{}", url)
    } else {
        url.to_string()
    };

    // Attempt connection with timeout
    let result = timeout(CHECK_SERVER_TIMEOUT, async {
        // Connect to WebSocket
        let (ws_stream, _) = match connect_async(&ws_url).await {
            Ok(r) => r,
            Err(_) => return false,
        };
        let (mut sender, mut receiver) = ws_stream.split();

        // Generate peer ID and send join message
        let peer_id = generate_peer_id();
        let join_msg = ProtocolMessage::Join {
            sender_id: peer_id.clone(),
            supported_protocol_versions: vec!["1".to_string()],
            peer_metadata: PeerMetadata {
                storage_id: None,
                is_ephemeral: true,
            },
        };

        let encoded = match join_msg.encode() {
            Ok(e) => e,
            Err(_) => return false,
        };
        if sender.send(Message::Binary(encoded.into())).await.is_err() {
            return false;
        }

        // Wait for peer response
        while let Some(msg_result) = receiver.next().await {
            match msg_result {
                Ok(Message::Binary(data)) => {
                    if let Ok(ProtocolMessage::Peer { target_id, .. }) =
                        ProtocolMessage::decode(&data)
                    {
                        if target_id == peer_id {
                            // Send leave message
                            let leave_msg = ProtocolMessage::Leave {
                                sender_id: peer_id.clone(),
                            };
                            if let Ok(encoded) = leave_msg.encode() {
                                let _ = sender.send(Message::Binary(encoded.into())).await;
                            }
                            let _ = sender.send(Message::Close(None)).await;
                            return true;
                        }
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(_) => return false,
                _ => {}
            }
        }
        false
    })
    .await;

    matches!(result, Ok(true))
}

/// Sync client for connecting to automerge-repo-sync-server.
///
/// This client uses the automerge-repo WebSocket protocol:
/// 1. Opens WebSocket connection (no authentication)
/// 2. Performs handshake (join/peer messages)
/// 3. Syncs documents by DocumentId
#[derive(Debug)]
pub struct SyncClient {
    server_url: String,
}

impl SyncClient {
    /// Creates a new sync client.
    pub fn new(server_url: impl Into<String>) -> Self {
        Self {
            server_url: server_url.into(),
        }
    }

    /// Returns the server URL.
    pub fn server_url(&self) -> &str {
        &self.server_url
    }

    pub async fn connect(&self) -> Result<SyncConnection, SyncError> {
        let (socket, _) = timeout(HANDSHAKE_TIMEOUT, connect_async(self.build_ws_url()))
            .await
            .map_err(|_| SyncError::HandshakeTimeout)?
            .map_err(|e| SyncError::ConnectionError(e.to_string()))?;
        let (mut sender, mut receiver) = socket.split();
        let peer_id = generate_peer_id();
        let server_id = self
            .perform_handshake(&mut sender, &mut receiver, &peer_id)
            .await?;
        Ok(SyncConnection {
            sender,
            receiver,
            peer_id,
            server_id,
        })
    }

    /// Syncs multiple documents with the server over a single connection.
    ///
    /// This is the primary sync method. It:
    /// 1. Opens WebSocket connection
    /// 2. Performs handshake
    /// 3. Syncs each document
    /// 4. Closes connection
    ///
    /// Documents are passed as (DocumentId, AutoCommit) pairs. The AutoCommit
    /// documents are modified in place with synced changes.
    pub async fn sync_documents(
        &self,
        docs: &mut [(DocumentId, AutoCommit)],
    ) -> Result<Vec<SyncResult>, SyncError> {
        if docs.is_empty() {
            return Ok(Vec::new());
        }

        // Connect to WebSocket
        let ws_url = self.build_ws_url();
        let (ws_stream, _) = connect_async(&ws_url)
            .await
            .map_err(|e| SyncError::ConnectionError(e.to_string()))?;

        let (mut sender, mut receiver) = ws_stream.split();

        // Generate peer ID for this connection
        let peer_id = generate_peer_id();

        // Perform handshake
        let server_peer_id = self
            .perform_handshake(&mut sender, &mut receiver, &peer_id)
            .await?;

        // Sync each document
        let mut results = Vec::new();

        for (doc_id, doc) in docs.iter_mut() {
            let result = self
                .sync_document_over_connection(
                    &mut sender,
                    &mut receiver,
                    doc_id,
                    &peer_id,
                    &server_peer_id,
                    doc,
                )
                .await?;

            results.push(result);
        }

        // Send Leave message before closing
        let leave_msg = ProtocolMessage::Leave {
            sender_id: peer_id.clone(),
        };
        if let Ok(encoded) = leave_msg.encode() {
            let _ = sender.send(Message::Binary(encoded.into())).await;
        }

        // Close WebSocket gracefully
        let _ = sender.send(Message::Close(None)).await;

        Ok(results)
    }

    /// Syncs a single document with the server.
    ///
    /// This is a convenience method that opens a connection for a single document.
    /// For efficiency when syncing multiple documents, use `sync_documents`.
    pub async fn sync_document(
        &self,
        doc_id: &DocumentId,
        doc: &mut AutoCommit,
    ) -> Result<SyncResult, SyncError> {
        // Connect to WebSocket
        let ws_url = self.build_ws_url();
        let (ws_stream, _) = connect_async(&ws_url)
            .await
            .map_err(|e| SyncError::ConnectionError(e.to_string()))?;

        let (mut sender, mut receiver) = ws_stream.split();

        // Generate peer ID for this connection
        let peer_id = generate_peer_id();

        // Perform handshake
        let server_peer_id = self
            .perform_handshake(&mut sender, &mut receiver, &peer_id)
            .await?;

        // Sync the document
        let result = self
            .sync_document_over_connection(
                &mut sender,
                &mut receiver,
                doc_id,
                &peer_id,
                &server_peer_id,
                doc,
            )
            .await?;

        // Send Leave message before closing
        let leave_msg = ProtocolMessage::Leave {
            sender_id: peer_id.clone(),
        };
        if let Ok(encoded) = leave_msg.encode() {
            let _ = sender.send(Message::Binary(encoded.into())).await;
        }

        // Close WebSocket gracefully
        let _ = sender.send(Message::Close(None)).await;

        Ok(result)
    }

    /// Performs the handshake with the server.
    ///
    /// Sends a `join` message and waits for a `peer` response.
    async fn perform_handshake<S, R>(
        &self,
        sender: &mut S,
        receiver: &mut R,
        peer_id: &str,
    ) -> Result<String, SyncError>
    where
        S: SinkExt<Message> + Unpin,
        S::Error: std::fmt::Display,
        R: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
    {
        // Send join message
        let join_msg = ProtocolMessage::Join {
            sender_id: peer_id.to_string(),
            supported_protocol_versions: vec!["1".to_string()],
            peer_metadata: PeerMetadata {
                storage_id: None,
                is_ephemeral: false,
            },
        };

        let encoded = join_msg
            .encode()
            .map_err(|e| SyncError::CborError(e.to_string()))?;

        sender
            .send(Message::Binary(encoded.into()))
            .await
            .map_err(|e| SyncError::WebSocketError(e.to_string()))?;

        // Wait for peer response with timeout
        let peer_response = timeout(HANDSHAKE_TIMEOUT, async {
            while let Some(msg_result) = receiver.next().await {
                match msg_result {
                    Ok(Message::Binary(data)) => {
                        let msg = ProtocolMessage::decode(&data)
                            .map_err(|e| SyncError::CborError(e.to_string()))?;

                        match msg {
                            ProtocolMessage::Peer {
                                sender_id,
                                target_id,
                                selected_protocol_version: _,
                            } => {
                                if target_id != peer_id {
                                    return Err(SyncError::HandshakeError(
                                        "Peer response target_id mismatch".to_string(),
                                    ));
                                }
                                return Ok(sender_id);
                            }
                            ProtocolMessage::Error { message } => {
                                return Err(SyncError::HandshakeError(message));
                            }
                            _ => {
                                return Err(SyncError::HandshakeError(format!(
                                    "Unexpected message during handshake: {:?}",
                                    msg
                                )));
                            }
                        }
                    }
                    Ok(Message::Ping(data)) => {
                        // Ping during handshake - ignore
                        let _ = data;
                    }
                    Ok(Message::Close(_)) => {
                        return Err(SyncError::HandshakeError(
                            "Server closed connection during handshake".to_string(),
                        ));
                    }
                    Ok(_) => {
                        // Ignore other message types
                    }
                    Err(e) => {
                        return Err(SyncError::WebSocketError(e.to_string()));
                    }
                }
            }
            Err(SyncError::HandshakeError(
                "Connection closed before handshake completed".to_string(),
            ))
        })
        .await;

        match peer_response {
            Ok(result) => result,
            Err(_) => Err(SyncError::HandshakeTimeout),
        }
    }

    /// Syncs a single document over an established connection.
    async fn sync_document_over_connection<S, R>(
        &self,
        sender: &mut S,
        receiver: &mut R,
        doc_id: &DocumentId,
        peer_id: &str,
        server_peer_id: &str,
        doc: &mut AutoCommit,
    ) -> Result<SyncResult, SyncError>
    where
        S: SinkExt<Message> + Unpin,
        S::Error: std::fmt::Display,
        R: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
    {
        let initial_heads = doc.get_heads().to_vec();

        // Use automerge URL format for document ID
        // Use bs58check format without the automerge: prefix
        let doc_id_str = doc_id.to_bs58check();

        // Initialize sync state
        let mut sync_state = SyncState::new();
        let mut rounds = 0;

        // Generate initial sync message - always send Request even if no sync data
        let sync_data = doc
            .sync()
            .generate_sync_message(&mut sync_state)
            .map(|m| m.encode())
            .unwrap_or_default();

        // Target the server specifically
        let protocol_msg = ProtocolMessage::Request {
            sender_id: peer_id.to_string(),
            target_id: server_peer_id.to_string(),
            document_id: doc_id_str.clone(),
            data: sync_data.clone(),
        };

        let encoded = protocol_msg
            .encode()
            .map_err(|e| SyncError::CborError(e.to_string()))?;

        sender
            .send(Message::Binary(encoded.into()))
            .await
            .map_err(|e| SyncError::WebSocketError(e.to_string()))?;

        rounds += 1;

        // Silence is not an acknowledgement. Only matching peer heads prove convergence.
        let deadline = tokio::time::Instant::now() + DOC_SYNC_TIMEOUT;
        loop {
            let response_deadline =
                deadline.min(tokio::time::Instant::now() + DOC_RESPONSE_TIMEOUT);
            match tokio::time::timeout_at(response_deadline, receiver.next()).await {
                Ok(Some(Ok(Message::Binary(data)))) => {
                    let msg = match ProtocolMessage::decode(&data) {
                        Ok(m) => m,
                        Err(e) => {
                            return Err(SyncError::CborError(e.to_string()));
                        }
                    };

                    match msg {
                        ProtocolMessage::Sync {
                            document_id,
                            data,
                            sender_id: _,
                            target_id: _,
                        }
                        | ProtocolMessage::Request {
                            sender_id: _,
                            target_id: _,
                            document_id,
                            data,
                        } => {
                            if document_id != doc_id_str {
                                // Message for a different document - skip
                                continue;
                            }

                            // Decode and apply server's sync message
                            let sync_msg = SyncMessage::decode(&data)
                                .map_err(|e| SyncError::ProtocolError(e.to_string()))?;

                            doc.sync()
                                .receive_sync_message(&mut sync_state, sync_msg)
                                .map_err(|e| SyncError::ProtocolError(e.to_string()))?;

                            // Generate response if needed
                            if let Some(response) =
                                doc.sync().generate_sync_message(&mut sync_state)
                            {
                                let protocol_msg = ProtocolMessage::Sync {
                                    document_id: doc_id_str.clone(),
                                    sender_id: peer_id.to_string(),
                                    target_id: server_peer_id.to_string(),
                                    data: response.encode(),
                                };

                                let encoded = protocol_msg
                                    .encode()
                                    .map_err(|e| SyncError::CborError(e.to_string()))?;

                                sender
                                    .send(Message::Binary(encoded.into()))
                                    .await
                                    .map_err(|e| SyncError::WebSocketError(e.to_string()))?;

                                rounds += 1;
                            }

                            if sync_state.their_heads.as_ref() == Some(&doc.get_heads())
                                && sync_state.their_need.as_ref().is_some_and(Vec::is_empty)
                            {
                                break;
                            }
                        }
                        ProtocolMessage::DocUnavailable { document_id, .. } => {
                            return Err(SyncError::DocumentUnavailable(document_id));
                        }
                        ProtocolMessage::Error { message } => {
                            return Err(SyncError::ProtocolError(message));
                        }
                        _ => {
                            // Ignore other message types
                        }
                    }
                }
                Ok(Some(Ok(Message::Close(_)))) => {
                    return Err(SyncError::ProtocolError(
                        "Server closed connection before document sync completed".to_string(),
                    ));
                }
                Ok(Some(Ok(Message::Ping(data)))) => {
                    sender
                        .send(Message::Pong(data))
                        .await
                        .map_err(|e| SyncError::WebSocketError(e.to_string()))?;
                }
                Ok(Some(Ok(_))) => {
                    // Ignore other message types
                }
                Ok(Some(Err(e))) => {
                    return Err(SyncError::WebSocketError(e.to_string()));
                }
                Ok(None) => {
                    return Err(SyncError::ProtocolError(
                        "Connection ended before document sync completed".to_string(),
                    ));
                }
                Err(_) => return Err(SyncError::DocumentSyncTimeout(doc_id_str.clone())),
            }
        }

        // Check if document was updated
        let final_heads = doc.get_heads().to_vec();
        let updated = initial_heads != final_heads;

        Ok(SyncResult {
            doc_id: *doc_id,
            updated,
            rounds,
        })
    }

    /// Builds the WebSocket URL for the sync endpoint.
    fn build_ws_url(&self) -> String {
        // Convert http(s) to ws(s) if needed
        let base_url = if self.server_url.starts_with("http://") {
            self.server_url.replace("http://", "ws://")
        } else if self.server_url.starts_with("https://") {
            self.server_url.replace("https://", "wss://")
        } else if !self.server_url.starts_with("ws://") && !self.server_url.starts_with("wss://") {
            format!("ws://{}", self.server_url)
        } else {
            self.server_url.clone()
        };

        base_url
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn silent_server_is_an_error_not_up_to_date() {
        let mut doc = AutoCommit::new();
        let result = SyncClient::new("unused")
            .sync_document_over_connection(
                &mut futures::sink::drain(),
                &mut futures::stream::pending(),
                &DocumentId::new(),
                "client",
                "server",
                &mut doc,
            )
            .await;
        assert!(matches!(result, Err(SyncError::DocumentSyncTimeout(_))));
    }

    #[tokio::test(start_paused = true)]
    async fn a_reply_after_the_old_idle_window_is_processed() {
        let id = DocumentId::new();
        let mut remote = AutoCommit::new();
        let data = remote
            .sync()
            .generate_sync_message(&mut SyncState::new())
            .unwrap()
            .encode();
        let reply = ProtocolMessage::Sync {
            document_id: id.to_bs58check(),
            sender_id: "server".into(),
            target_id: "client".into(),
            data,
        }
        .encode()
        .unwrap();
        let mut receiver = Box::pin(
            futures::stream::once(async {
                tokio::time::sleep(Duration::from_secs(3)).await;
                Ok(Message::Binary(reply.into()))
            })
            .chain(futures::stream::pending()),
        );
        let start = tokio::time::Instant::now();
        let result = SyncClient::new("unused")
            .sync_document_over_connection(
                &mut futures::sink::drain(),
                &mut receiver,
                &id,
                "client",
                "server",
                &mut AutoCommit::new(),
            )
            .await
            .unwrap();
        assert!(tokio::time::Instant::now() - start >= Duration::from_secs(3));
        assert!(!result.updated);
    }

    #[tokio::test(start_paused = true)]
    async fn keepalives_do_not_extend_the_overall_deadline() {
        let mut receiver = Box::pin(futures::stream::unfold((), |_| async {
            tokio::time::sleep(Duration::from_secs(1)).await;
            Some((Ok(Message::Ping(Vec::new().into())), ()))
        }));
        let start = tokio::time::Instant::now();
        let result = SyncClient::new("unused")
            .sync_document_over_connection(
                &mut futures::sink::drain(),
                &mut receiver,
                &DocumentId::new(),
                "client",
                "server",
                &mut AutoCommit::new(),
            )
            .await;
        assert!(matches!(result, Err(SyncError::DocumentSyncTimeout(_))));
        assert!(tokio::time::Instant::now() - start >= DOC_SYNC_TIMEOUT);
    }

    #[tokio::test]
    async fn closing_before_acknowledgement_is_an_error() {
        for message in [Some(Ok(Message::Close(None))), None] {
            let mut receiver = futures::stream::iter(message);
            let result = SyncClient::new("unused")
                .sync_document_over_connection(
                    &mut futures::sink::drain(),
                    &mut receiver,
                    &DocumentId::new(),
                    "client",
                    "server",
                    &mut AutoCommit::new(),
                )
                .await;
            assert!(matches!(result, Err(SyncError::ProtocolError(_))));
        }
    }

    #[test]
    fn test_build_ws_url() {
        let client = SyncClient::new("ws://localhost:8080");
        assert_eq!(client.build_ws_url(), "ws://localhost:8080");

        let client = SyncClient::new("http://localhost:8080");
        assert_eq!(client.build_ws_url(), "ws://localhost:8080");

        let client = SyncClient::new("https://sync.example.com");
        assert_eq!(client.build_ws_url(), "wss://sync.example.com");

        let client = SyncClient::new("localhost:8080");
        assert_eq!(client.build_ws_url(), "ws://localhost:8080");
    }

    #[test]
    fn test_client_accessors() {
        let client = SyncClient::new("ws://localhost:8080");
        assert_eq!(client.server_url(), "ws://localhost:8080");
    }
}
