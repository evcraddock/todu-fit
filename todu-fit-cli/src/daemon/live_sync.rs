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
    // A pending CLI join must finish its initial download before the root
    // becomes visible as ready to application clients.
    if setup::auto_sync(owner) && setup::status(owner)?.state == "ready" {
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
                owner.sync.lock().unwrap().automatic = None;
                owner.sync_changed.notified().await;
                continue;
            }
            Err(error) => Err(error),
        };
        if let Err(error) = result {
            owner.report_live_sync(Some(error.to_string()));
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
    let mut unavailable = HashSet::new();
    refresh(
        owner,
        &mut connection,
        &snapshot,
        &mut states,
        &mut unavailable,
    )
    .await?;
    report_availability(owner, &unavailable);
    let mut last_received = tokio::time::Instant::now();
    let mut heartbeat = tokio::time::interval_at(last_received + HEARTBEAT, HEARTBEAT);
    loop {
        tokio::select! {
            _ = owner.sync_changed.notified() => {
                let snapshot = owner.store.lock().unwrap().snapshot()?;
                if snapshot.get("root_doc_id") != Some(&root) || server(owner)?.as_deref() != Some(url) {
                    return Ok(());
                }
                refresh(owner, &mut connection, &snapshot, &mut states, &mut unavailable).await?;
                report_availability(owner, &unavailable);
            }
            result = connection.receive() => {
                last_received = tokio::time::Instant::now();
                match result? {
                    Some(ProtocolMessage::Request { document_id, data, .. }
                        | ProtocolMessage::Sync { document_id, data, .. }) => {
                        let Some(state) = states.get_mut(&document_id) else { continue };
                        let (response, changed) = match apply(owner, &root, &document_id, state, &data)? {
                            Applied::Document(response, changed) => (response, changed),
                            Applied::Obsolete => return Ok(()),
                            Applied::Unavailable => {
                                unavailable.insert(document_id);
                                report_availability(owner, &unavailable);
                                continue;
                            }
                        };
                        if let Some(message) = response {
                            connection.send(&document_id, message, false).await?;
                        }
                        if changed {
                            unavailable.remove(&document_id);
                            owner.sync_changed.notify_one();
                        }
                        report_availability(owner, &unavailable);
                    }
                    Some(ProtocolMessage::DocUnavailable { document_id, .. }) if states.contains_key(&document_id) => {
                        // Keep listening. A peer may publish this referenced document later.
                        let name = format!("{document_id}.automerge");
                        if !owner.store.lock().unwrap().contains(&name)? {
                            unavailable.insert(document_id);
                            report_availability(owner, &unavailable);
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
    unavailable: &mut HashSet<String>,
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
    unavailable.retain(|id| ids.contains(id));
    for id in ids {
        if unavailable.contains(&id) {
            if !snapshot.contains_key(&format!("{id}.automerge")) {
                continue;
            }
            unavailable.remove(&id);
            states.remove(&id);
        }
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

fn report_availability(owner: &Owner, unavailable: &HashSet<String>) {
    let error = unavailable.iter().min().map(|id| {
        format!(
            "Sync server does not have document {id} ({} unavailable)",
            unavailable.len()
        )
    });
    owner.report_live_sync(error);
}

fn load(snapshot: &Snapshot, id: &str) -> Result<AutoCommit, Error> {
    let name = format!("{id}.automerge");
    match snapshot.get(&name) {
        Some(bytes) => Ok(AutoCommit::load(bytes)?),
        None => Ok(AutoCommit::new()),
    }
}

enum Applied {
    Document(Option<Message>, bool),
    Obsolete,
    Unavailable,
}

fn apply(
    owner: &Owner,
    root: &[u8],
    id: &str,
    state: &mut State,
    bytes: &[u8],
) -> Result<Applied, Error> {
    let setup = owner.setup.lock().unwrap();
    if setup
        .as_ref()
        .is_some_and(|(_, status)| status.state == "running")
    {
        return Ok(Applied::Obsolete);
    }
    let mut store = owner.store.lock().unwrap();
    let mut snapshot = store.snapshot()?;
    if snapshot.get("root_doc_id").map(Vec::as_slice) != Some(root) {
        return Ok(Applied::Obsolete);
    }
    let name = format!("{id}.automerge");
    let mut doc = load(&snapshot, id)?;
    let message = Message::decode(bytes)?;
    let empty_peer = message.heads.is_empty();
    // An out-of-order chunk can add queued changes without changing heads.
    let before = (!message.changes.is_empty()).then(|| doc.save());
    let mut next_state = state.clone();
    if let Err(error) = doc.sync().receive_sync_message(&mut next_state, message) {
        // Older Repo servers can send an unreadable empty sync response before
        // doc-unavailable for a reference that has never been initialized.
        if empty_peer && !snapshot.contains_key(&name) {
            return Ok(Applied::Unavailable);
        }
        return Err(error.into());
    }
    let mut changed = false;
    if let Some(before) = before {
        let after = doc.save();
        if after != before {
            snapshot.insert(name, after);
            store.commit(&snapshot, None)?;
            changed = true;
        }
    }
    *state = next_state;
    let response = doc.sync().generate_sync_message(state);
    Ok(Applied::Document(response, changed))
}
