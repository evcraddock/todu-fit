//! First-run work is staged and committed only after a complete initial download.
use super::*;
use todu_fit_core::{DocumentId, Identity, IdentityState};
use todu_fit_protocol as api;

pub(super) type Activity = Option<(api::Request, api::SetupStatus)>;
const SETTINGS: &str = "setup.json";

pub(super) fn auto_sync(owner: &Owner) -> bool {
    let Ok(store) = owner.store.lock() else {
        return false;
    };
    if !store.contains("root_doc_id").unwrap_or(false) {
        return false;
    }
    match store.document(SETTINGS) {
        Ok(Some(bytes)) => serde_json::from_slice::<Value>(&bytes)
            .ok()
            .is_some_and(|v| v.get("server_url").is_some_and(Value::is_string)),
        Ok(None) => owner.config.sync.auto_sync,
        Err(_) => false,
    }
}

pub(super) fn server_url(owner: &Owner) -> Result<Option<String>, Error> {
    let store = owner.store.lock().map_err(|_| "Owner unavailable")?;
    if let Some(bytes) = store.document(SETTINGS)? {
        let settings: Value = serde_json::from_slice(&bytes)?;
        return Ok(settings
            .get("server_url")
            .and_then(Value::as_str)
            .map(str::to_owned));
    }
    Ok(owner.config.sync.server_url.clone())
}

pub(super) fn status(owner: &Owner) -> Result<api::SetupStatus, Error> {
    let activity = owner.setup.lock().map_err(|_| "Owner unavailable")?.clone();
    if let Some((_, state)) = &activity {
        if state.state == "running" {
            return Ok(state.clone());
        }
    }
    let store = owner.store.lock().map_err(|_| "Owner unavailable")?;
    let ready = if let Some(root) = store.document("root_doc_id")? {
        let root = std::str::from_utf8(&root)?.trim();
        DocumentId::from_bs58check(root)?;
        store.contains(&format!("{root}.automerge"))?
    } else {
        false
    };
    drop(store);
    if let Some((_, state)) = activity {
        if (!ready && state.state == "failed") || (ready && state.state == "ready") {
            return Ok(state);
        }
    }
    Ok(api::SetupStatus {
        state: if ready { "ready" } else { "required" }.into(),
        message: if ready {
            "Ready"
        } else {
            "Choose how to set up Fit"
        }
        .into(),
        completed_documents: 0,
    })
}

pub(super) fn start(owner: &Arc<Owner>, request: &api::Request) -> Result<api::SetupStatus, Error> {
    let api::Operation::SetupStart {
        root_id,
        server_url,
        group_name,
    } = &request.operation
    else {
        return Err("Expected setup_start".into());
    };
    if let Some(url) = server_url {
        let parsed = reqwest::Url::parse(url)?;
        if !matches!(parsed.scheme(), "ws" | "wss") || parsed.host_str().is_none() {
            return Err("Sync server must be a ws:// or wss:// address".into());
        }
    }
    if let Some(root) = root_id {
        DocumentId::from_bs58check(root)?;
        if server_url.is_none() {
            return Err("Existing data requires a sync server address".into());
        }
    } else if group_name
        .as_ref()
        .is_none_or(|n| n.trim().is_empty() || n.len() > 512)
    {
        return Err("Enter a group name (1–512 bytes)".into());
    }
    let mut activity = owner.setup.lock().map_err(|_| "Owner unavailable")?;
    let payload = serde_json::to_string(&request.operation)?;
    let key = format!("setup:{}", request.id);
    let store = owner.store.lock().map_err(|_| "Owner unavailable")?;
    if let Some(saved) = store.receipt(&key, &payload)? {
        return Ok(serde_json::from_value(saved)?);
    }
    if let Some((running, state)) = &*activity {
        if state.state == "running" {
            if running.id == request.id && serde_json::to_string(&running.operation)? == payload {
                return Ok(state.clone());
            }
            return Err("Setup is already running; wait for it to finish".into());
        }
    }
    let before = store.snapshot()?;
    drop(store);
    let workspace = materialize(&before, &owner.config.data_dir.value)?;
    let identity = Identity::new(MultiDocStorage::new(workspace.path().to_owned()));
    if identity.state() == IdentityState::Initialized {
        return Err(
            "This daemon already has an identity; existing data will not be replaced".into(),
        );
    }
    let initial = api::SetupStatus {
        state: "running".into(),
        message: "Preparing your data…".into(),
        completed_documents: 0,
    };
    *activity = Some((request.clone(), initial.clone()));
    let owner = owner.clone();
    let request = request.clone();
    std::thread::spawn(move || {
        let result = (|| -> Result<usize, Error> {
            let api::Operation::SetupStart {
                root_id,
                server_url,
                group_name,
            } = &request.operation
            else {
                unreachable!()
            };
            let mut completed = 0;
            if let Some(root) = root_id {
                let root = DocumentId::from_bs58check(root)?;
                match identity.root_doc_id()? {
                    Some(existing) if existing != root => {
                        return Err(
                            "A different identity is pending; finish that setup first".into()
                        )
                    }
                    Some(_) => {}
                    None => identity.initialize_join(root)?,
                }
                let progress_owner = owner.clone();
                let mut coordinator = SyncCoordinator::new(
                    server_url.as_deref().ok_or("Server required")?,
                    MultiDocStorage::new(workspace.path().to_owned()),
                )
                .initial_download(move |name, count| {
                    if let Ok(mut activity) = progress_owner.setup.lock() {
                        if let Some((_, state)) = activity.as_mut() {
                            state.message = format!("Downloading {name}");
                            state.completed_documents = count;
                        }
                    }
                });
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()?;
                let downloaded = runtime
                    .block_on(async {
                        tokio::time::timeout(Duration::from_secs(300), coordinator.sync_all()).await
                    })
                    .map_err(|_| {
                        "Initial download timed out. Check the server and retry setup."
                    })??;
                completed = downloaded.documents.len();
                identity.load_identity()?;
            } else {
                identity.initialize_new()?;
                identity.create_group(group_name.as_deref().ok_or("Group required")?.trim())?;
            }
            fs::write(
                workspace.path().join(SETTINGS),
                serde_json::to_vec(&json!({"server_url": server_url}))?,
            )?;
            let after = collect(workspace.path())?;
            let ready = api::SetupStatus {
                state: "ready".into(),
                message: "Ready".into(),
                completed_documents: completed,
            };
            let mut store = owner.store.lock().map_err(|_| "Owner unavailable")?;
            if store.snapshot()? != before {
                return Err(
                    "Data changed during setup. Retry without replacing the existing identity."
                        .into(),
                );
            }
            store.commit(
                &after,
                Some((&key, &payload, &serde_json::to_value(&ready)?)),
            )?;
            Ok(completed)
        })();
        if let Ok(mut activity) = owner.setup.lock() {
            if let Some((_, state)) = activity.as_mut() {
                match result {
                    Ok(count) => {
                        state.state = "ready".into();
                        state.message = "Ready".into();
                        state.completed_documents = count;
                    }
                    Err(error) => {
                        state.state = "failed".into();
                        state.message = format!("Setup incomplete: {error}");
                    }
                }
            }
        }
    });
    Ok(initial)
}
