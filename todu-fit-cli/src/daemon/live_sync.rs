//! One Automerge Repo connection per daemon, driven by commits and peer messages.
use super::store::Snapshot;
use super::*;
use automerge::{
    sync::{Message, State, SyncDoc},
    AutoCommit,
};
use std::collections::{HashMap, HashSet};
use todu_fit_core::{
    sync::{ProtocolMessage, SyncClient, SyncConnection},
    DocumentId, Identity,
};

const RETRY_DELAY: Duration = Duration::from_secs(2);
const HEARTBEAT: Duration = Duration::from_secs(15);

pub(super) fn start(owner: Arc<Owner>) -> std::io::Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    std::thread::spawn(move || runtime.block_on(run(owner)));
    Ok(())
}

fn server(owner: &Owner) -> Result<Option<String>, Error> {
    if setup::auto_sync(owner) {
        setup::server_url(owner)
    } else {
        Ok(None)
    }
}

async fn run(owner: Arc<Owner>) {
    loop {
        let result = match server(&owner) {
            Ok(Some(url)) => session(&owner, &url).await,
            Ok(None) => {
                *owner.live_error.lock().unwrap() = None;
                owner.sync_changed.notified().await;
                continue;
            }
            Err(error) => Err(error),
        };
        *owner.live_error.lock().unwrap() = result.err().map(|error| error.to_string());
        if owner.live_error.lock().unwrap().is_some() {
            tokio::time::sleep(RETRY_DELAY).await;
        }
    }
}

async fn session(owner: &Owner, url: &str) -> Result<(), Error> {
    let snapshot = owner.store.lock().unwrap().snapshot()?;
    let root = snapshot
        .get("root_doc_id")
        .ok_or("No sync identity")?
        .clone();
    let mut connection = SyncClient::new(url).connect().await?;
    let mut states = HashMap::new();
    refresh(owner, &mut connection, &snapshot, &mut states).await?;
    *owner.live_error.lock().unwrap() = None;
    let mut last_received = tokio::time::Instant::now();
    let mut heartbeat = tokio::time::interval_at(last_received + HEARTBEAT, HEARTBEAT);
    loop {
        tokio::select! {
            _ = owner.sync_changed.notified() => {
                let snapshot = owner.store.lock().unwrap().snapshot()?;
                if snapshot.get("root_doc_id") != Some(&root) || server(owner)?.as_deref() != Some(url) {
                    return Ok(());
                }
                refresh(owner, &mut connection, &snapshot, &mut states).await?;
            }
            result = connection.receive() => {
                last_received = tokio::time::Instant::now();
                match result? {
                    Some(ProtocolMessage::Request { document_id, data, .. }
                        | ProtocolMessage::Sync { document_id, data, .. }) => {
                        let Some(state) = states.get_mut(&document_id) else { continue };
                        let Some((mut doc, changed)) = apply(owner, &root, &document_id, state, &data)? else {
                            return Ok(());
                        };
                        if let Some(message) = doc.sync().generate_sync_message(state) {
                            connection.send(&document_id, message, false).await?;
                        }
                        if changed {
                            owner.sync_changed.notify_one();
                        }
                    }
                    Some(ProtocolMessage::DocUnavailable { document_id, .. }) if states.contains_key(&document_id) => {
                        // Keep listening. A peer may publish this referenced document later.
                        let name = format!("{document_id}.automerge");
                        if !owner.store.lock().unwrap().contains(&name)? {
                            *owner.live_error.lock().unwrap() =
                                Some(format!("Sync server does not have document {document_id}"));
                        }
                    }
                    _ => {}
                }
            }
            _ = heartbeat.tick() => {
                if last_received.elapsed() >= HEARTBEAT * 3 {
                    return Err("Sync connection stopped responding".into());
                }
                connection.ping().await?;
            }
        }
    }
}

async fn refresh(
    owner: &Owner,
    connection: &mut SyncConnection,
    snapshot: &Snapshot,
    states: &mut HashMap<String, State>,
) -> Result<(), Error> {
    // Discover only documents reachable from the current identity. Old group
    // files can remain in storage after leaving a group or changing identity.
    let workspace = materialize(snapshot, &owner.config.data_dir.value)?;
    let identity = Identity::new(MultiDocStorage::new(workspace.path().to_owned()));
    let root = identity.root_doc_id()?.ok_or("No sync identity")?;
    let mut ids = HashSet::from([root]);
    if let Ok(doc) = identity.load_identity() {
        ids.extend([doc.meallogs_doc_id, doc.hydration_doc_id]);
        for group in doc.groups {
            ids.insert(group.doc_id);
            if let Ok(doc) = identity.load_group(&group.doc_id) {
                ids.extend([
                    doc.dishes_doc_id,
                    doc.mealplans_doc_id,
                    doc.shopping_carts_doc_id,
                ]);
            }
        }
    }
    let ids: HashSet<_> = ids
        .into_iter()
        .map(|id: DocumentId| id.to_bs58check())
        .collect();
    states.retain(|id, _| ids.contains(id));
    for id in ids {
        let mut doc = load(snapshot, &id)?;
        let request = !states.contains_key(&id);
        let state = states.entry(id.clone()).or_default();
        let message = doc.sync().generate_sync_message(state);
        if let Some(message) = message {
            connection.send(&id, message, request).await?;
        }
    }
    Ok(())
}

fn load(snapshot: &Snapshot, id: &str) -> Result<AutoCommit, Error> {
    let name = format!("{id}.automerge");
    match snapshot.get(&name) {
        Some(bytes) => Ok(AutoCommit::load(bytes)?),
        None => Ok(AutoCommit::new()),
    }
}

fn apply(
    owner: &Owner,
    root: &[u8],
    id: &str,
    state: &mut State,
    bytes: &[u8],
) -> Result<Option<(AutoCommit, bool)>, Error> {
    let mut store = owner.store.lock().unwrap();
    let mut snapshot = store.snapshot()?;
    if snapshot.get("root_doc_id").map(Vec::as_slice) != Some(root) {
        return Ok(None);
    }
    let mut doc = load(&snapshot, id)?;
    let before = doc.get_heads();
    doc.sync()
        .receive_sync_message(state, Message::decode(bytes)?)?;
    let changed = doc.get_heads() != before;
    if changed {
        snapshot.insert(format!("{id}.automerge"), doc.save());
        store.commit(&snapshot, None)?;
        *owner.live_error.lock().unwrap() = None;
    }
    Ok(Some((doc, changed)))
}
