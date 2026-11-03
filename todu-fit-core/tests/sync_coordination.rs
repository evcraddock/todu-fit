//! Exercises the public coordinator with a disposable protocol peer and real storage.
use automerge::sync::{Message as SyncMessage, State, SyncDoc};
use automerge::AutoCommit;
use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use tempfile::TempDir;
use todu_fit_core::sync::{ProtocolMessage, SyncCoordinator, SyncCoordinatorError};
use todu_fit_core::{DocumentId, Identity, IdentityState, MultiDocStorage};
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};

async fn peer(
    mut documents: HashMap<String, AutoCommit>,
    expected: Vec<DocumentId>,
) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        for expected_id in expected {
            let (socket, _) = listener.accept().await.unwrap();
            let mut ws = accept_async(socket).await.unwrap();
            let mut state = State::new();
            while let Some(Ok(Message::Binary(bytes))) = ws.next().await {
                let response = match ProtocolMessage::decode(&bytes).unwrap() {
                    ProtocolMessage::Join { sender_id, .. } => Some(ProtocolMessage::Peer {
                        sender_id: "test-peer".into(),
                        target_id: sender_id,
                        selected_protocol_version: "1".into(),
                    }),
                    ProtocolMessage::Request {
                        document_id,
                        sender_id,
                        data,
                        ..
                    }
                    | ProtocolMessage::Sync {
                        document_id,
                        sender_id,
                        data,
                        ..
                    } => {
                        assert_eq!(document_id, expected_id.to_bs58check());
                        let doc = documents.entry(document_id.clone()).or_default();
                        doc.sync()
                            .receive_sync_message(&mut state, SyncMessage::decode(&data).unwrap())
                            .unwrap();
                        doc.sync().generate_sync_message(&mut state).map(|message| {
                            ProtocolMessage::Sync {
                                document_id,
                                sender_id: "test-peer".into(),
                                target_id: sender_id,
                                data: message.encode(),
                            }
                        })
                    }
                    ProtocolMessage::Leave { .. } => break,
                    message => panic!("unexpected message: {message:?}"),
                };
                if let Some(response) = response {
                    ws.send(Message::Binary(response.encode().unwrap().into()))
                        .await
                        .unwrap();
                }
            }
        }
    });
    (url, task)
}

#[tokio::test]
async fn joined_identity_discovers_personal_and_all_group_documents_in_order() {
    let source = TempDir::new().unwrap();
    let storage = MultiDocStorage::new(source.path().into());
    let identity = Identity::new(storage.clone());
    let root = identity.initialize_new().unwrap();
    let first = identity.create_group("Home").unwrap();
    let second = identity.create_group("Shared").unwrap();
    let personal = identity.load_identity().unwrap();
    let mut ids = vec![root, personal.meallogs_doc_id, personal.hydration_doc_id];
    let mut names = vec!["identity", "meallogs", "hydration"];
    for (id, group_names) in [
        (
            first,
            [
                "group:Home",
                "Home:dishes",
                "Home:mealplans",
                "Home:shopping",
            ],
        ),
        (
            second,
            [
                "group:Shared",
                "Shared:dishes",
                "Shared:mealplans",
                "Shared:shopping",
            ],
        ),
    ] {
        let group = identity.load_group(&id).unwrap();
        ids.extend([
            id,
            group.dishes_doc_id,
            group.mealplans_doc_id,
            group.shopping_carts_doc_id,
        ]);
        names.extend(group_names);
    }
    let documents = ids
        .iter()
        .map(|id| {
            let doc = storage
                .load(id)
                .unwrap()
                .map(|bytes| AutoCommit::load(&bytes).unwrap())
                .unwrap_or_default();
            (id.to_bs58check(), doc)
        })
        .collect();
    let (url, server) = peer(documents, ids.clone()).await;
    let target = TempDir::new().unwrap();
    let target_storage = MultiDocStorage::new(target.path().into());
    let joined = Identity::new(target_storage.clone());
    joined.initialize_join(root).unwrap();
    let result = SyncCoordinator::new(url, target_storage.clone())
        .sync_all()
        .await
        .unwrap();
    server.await.unwrap();
    assert_eq!(
        result
            .documents
            .iter()
            .map(|doc| doc.name.as_str())
            .collect::<Vec<_>>(),
        names
    );
    assert!(result.any_updated());
    assert_eq!(joined.state(), IdentityState::Initialized);
    assert_eq!(joined.root_doc_id().unwrap(), Some(root));
    assert_eq!(joined.list_groups().unwrap().len(), 2);
    for id in ids {
        assert!(target_storage.load(&id).unwrap().is_some());
    }
}

#[tokio::test]
async fn no_groups_is_reported_after_personal_documents_are_persisted() {
    let dir = TempDir::new().unwrap();
    let storage = MultiDocStorage::new(dir.path().into());
    let identity = Identity::new(storage.clone());
    let root = identity.initialize_new().unwrap();
    let personal = identity.load_identity().unwrap();
    let ids = vec![root, personal.meallogs_doc_id, personal.hydration_doc_id];
    let (url, server) = peer(HashMap::new(), ids.clone()).await;
    let result = SyncCoordinator::new(url, storage.clone()).sync_all().await;
    assert!(matches!(result, Err(SyncCoordinatorError::NoGroups)));
    server.await.unwrap();
    for id in ids {
        assert!(storage.load(&id).unwrap().is_some());
    }
}

#[tokio::test]
async fn uninitialized_and_corrupt_stores_fail_without_replacing_data() {
    let dir = TempDir::new().unwrap();
    let storage = MultiDocStorage::new(dir.path().into());
    let mut coordinator = SyncCoordinator::new("ws://unused", storage.clone());
    assert!(matches!(
        coordinator.sync_all().await,
        Err(SyncCoordinatorError::NotInitialized)
    ));
    let root = Identity::new(storage.clone()).initialize_new().unwrap();
    storage.save(&root, b"invalid Automerge").unwrap();
    assert!(matches!(
        coordinator.sync_all().await,
        Err(SyncCoordinatorError::StorageError(_))
    ));
    assert_eq!(storage.load(&root).unwrap().unwrap(), b"invalid Automerge");
}

#[tokio::test]
async fn joined_empty_identity_is_rejected_after_exchange() {
    let dir = TempDir::new().unwrap();
    let storage = MultiDocStorage::new(dir.path().into());
    let root = DocumentId::new();
    Identity::new(storage.clone())
        .initialize_join(root)
        .unwrap();
    let (url, server) = peer(HashMap::new(), vec![root]).await;
    let result = SyncCoordinator::new(url, storage.clone()).sync_all().await;
    server.await.unwrap();
    assert!(
        matches!(result, Err(SyncCoordinatorError::IdentityError(message)) if message.contains("Identity document is empty after sync"))
    );
    // Preserve the previous coordinator's save-before-validation behavior.
    assert!(storage.load(&root).unwrap().is_some());
}

#[tokio::test]
async fn failed_exchange_preserves_local_identity() {
    let dir = TempDir::new().unwrap();
    let storage = MultiDocStorage::new(dir.path().into());
    let root = Identity::new(storage.clone()).initialize_new().unwrap();
    let before = storage.load(&root).unwrap();
    let result = SyncCoordinator::new("ws://127.0.0.1:0", storage.clone())
        .sync_all()
        .await;
    assert!(matches!(result, Err(SyncCoordinatorError::SyncError(_))));
    assert_eq!(storage.load(&root).unwrap(), before);
}
