//! Shared local owner. Transport is versioned, bounded newline-delimited JSON.
//! CLI adapters execute against disposable workspaces; only this owner commits.
mod setup;
mod store;
#[cfg(windows)]
mod windows;
use crate::{config::Config, Commands};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
#[cfg(unix)]
use std::{
    io::{Read, Write},
    sync::atomic::{AtomicUsize, Ordering},
};
use store::{collect, materialize, Store};
use todu_fit_core::{sync::SyncCoordinator, Dish, DishRepository, MultiDocStorage};
#[cfg(windows)]
use windows::exchange;
#[cfg(windows)]
pub use windows::serve;
pub type Error = Box<dyn std::error::Error + Send + Sync>;
const MAX_FRAME: u64 = 8 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    pub id: String,
    pub operation: Operation,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Operation {
    Cli {
        command: Commands,
    },
    ListDishes,
    CreateDish {
        name: String,
    },
    Status,
    Sync,
    /// Revision-based change notifications, resumable across connections/restarts.
    Changes {
        after: u64,
    },
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Response {
    pub id: String,
    pub revision: u64,
    pub value: Option<Value>,
    pub error: Option<String>,
}
struct Owner {
    store: Mutex<Store>,
    config: Config,
    sync: Mutex<String>,
    setup: Mutex<setup::Activity>,
}
impl Owner {
    fn apply(&self, request: &Request) -> Result<Response, Error> {
        if request.version != 1 || uuid::Uuid::parse_str(&request.id).is_err() {
            return Err("INVALID_REQUEST: protocol version 1 and UUID request ID required".into());
        }
        let encoded = serde_json::to_string(&request.operation)?;
        let mut store = self
            .store
            .lock()
            .map_err(|_| "Owner poisoned; restart required")?;
        if let Some(response) = store.receipt(&request.id, &encoded)? {
            return Ok(serde_json::from_value(response)?);
        }
        let mut response = Response {
            id: request.id.clone(),
            revision: store.revision()?,
            value: None,
            error: None,
        };
        match &request.operation {
            Operation::Status | Operation::Changes { .. } => {
                response.value = Some(
                    json!({"sync": *self.sync.lock().unwrap(), "revision": response.revision, "changed": matches!(request.operation, Operation::Changes { after } if after < response.revision)}),
                );
                return Ok(response);
            }
            Operation::Sync => {
                return Err("Sync scheduling handled outside local transactions".into())
            }
            _ => {}
        }
        let before = store.snapshot()?;
        let workspace = materialize(&before, &self.config.data_dir.value)?;
        let mut config = self.config.clone();
        config.data_dir.value = workspace.path().to_owned();
        config.sync.auto_sync = false;
        let result: Result<Value, Error> = match &request.operation {
            Operation::Cli { command } => {
                if matches!(
                    command,
                    Commands::Daemon | Commands::Config(_) | Commands::Sync(_)
                ) {
                    return Err(
                        "INVALID_REQUEST: operation not permitted in CLI transaction".into(),
                    );
                }
                // Existing terminal formatting stays in the CLI adapter, domain logic stays in Core.
                let (result, output) =
                    crate::output::capture(|| crate::execute_command_ref(command, &config))?;
                result
                    .map(|_| json!({"stdout": output}))
                    .map_err(|e| e.to_string().into())
            }
            Operation::ListDishes => DishRepository::new(config.data_dir.value.clone())
                .list()
                .map(|items| {
                    json!(items
                        .iter()
                        .map(|d| json!({"id": d.id, "name": d.name}))
                        .collect::<Vec<_>>())
                })
                .map_err(|e| e.to_string().into()),
            Operation::CreateDish { name } => {
                let name = name.trim();
                if name.is_empty() || name.len() > 512 {
                    return Err("INVALID_INPUT: dish name must be 1–512 bytes".into());
                }
                DishRepository::new(config.data_dir.value.clone())
                    .create(&Dish::new(name, "desktop"))
                    .map(|d| json!({"id":d.id,"name":d.name}))
                    .map_err(|e| e.to_string().into())
            }
            _ => unreachable!(),
        };
        response.value = Some(result?);
        if serde_json::to_vec(&response)?.len() as u64 >= MAX_FRAME {
            return Err("Response exceeds 8 MiB; operation was not committed".into());
        }
        let after = collect(workspace.path())?;
        // Persist even unchanged requests: retries return the original output and IDs.
        if after == before {
            return Ok(response);
        }
        response.revision += 1;
        store.commit(
            &after,
            Some((&request.id, &encoded, &serde_json::to_value(&response)?)),
        )?;
        Ok(response)
    }
}
fn start_sync(owner: Arc<Owner>) {
    if setup::status(&owner).is_ok_and(|s| s.state == "running") {
        return;
    }
    let mut status = owner.sync.lock().unwrap();
    if *status == "running" {
        return;
    }
    *status = "running".into();
    drop(status);
    std::thread::spawn(move || {
        let result = (|| -> Result<(), Error> {
            let url = setup::server_url(&owner)?.ok_or("Sync server not configured")?;
            let snapshot = owner.store.lock().unwrap().snapshot()?;
            let workspace = materialize(&snapshot, &owner.config.data_dir.value)?;
            let mut coordinator =
                SyncCoordinator::new(url, MultiDocStorage::new(workspace.path().to_owned()));
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?;
            runtime.block_on(async {
                tokio::time::timeout(Duration::from_secs(30), coordinator.sync_all()).await
            })??;
            let remote = collect(workspace.path())?;
            let mut store = owner.store.lock().unwrap();
            let mut current = store.snapshot()?;
            if current.get("root_doc_id") != snapshot.get("root_doc_id") {
                return Err("Identity changed during sync; discarded obsolete result".into());
            }
            store::merge(&mut current, remote)?;
            store.commit(&current, None)?;
            Ok(())
        })();
        *owner.sync.lock().unwrap() = match result {
            Ok(()) => "idle".into(),
            Err(e) => format!("failed: {e}"),
        };
    });
}
#[cfg(unix)]
fn endpoint(path: &Path) -> std::path::PathBuf {
    path.join("daemon.sock")
}
#[cfg(unix)]
pub fn serve(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    use std::os::unix::{fs::PermissionsExt, net::UnixListener};
    let path = &config.data_dir.value;
    if path.exists() && !path.join("daemon.sqlite").exists() && fs::read_dir(path)?.next().is_some()
    {
        return Err("Refusing to adopt a nonempty legacy/proof store. Select a new empty data_dir; see docs/DAEMON.md".into());
    }
    fs::create_dir_all(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path.join("daemon.lock"))?;
    lock.try_lock_exclusive()
        .map_err(|_| "Daemon already owns this store")?;
    let store = Store::open(&path.join("daemon.sqlite")).map_err(|e| e.to_string())?;
    fs::write(path.join("daemon.pid"), std::process::id().to_string())?;
    store::clean_workspaces(path).map_err(|e| e.to_string())?;
    let socket = endpoint(path);
    if socket.exists() {
        fs::remove_file(&socket)?;
    }
    let listener = UnixListener::bind(&socket)?;
    fs::write(
        path.join("daemon.endpoint"),
        socket.to_string_lossy().as_bytes(),
    )?;
    let owner = Arc::new(Owner {
        store: Mutex::new(store),
        config,
        sync: Mutex::new("idle".into()),
        setup: Mutex::new(None),
    });
    {
        let background = owner.clone();
        std::thread::spawn(move || loop {
            if setup::auto_sync(&background) {
                start_sync(background.clone());
            }
            std::thread::sleep(Duration::from_secs(30));
        });
    }
    let active = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming() {
        let mut stream = stream?;
        if active.fetch_add(1, Ordering::SeqCst) >= 16 {
            active.fetch_sub(1, Ordering::SeqCst);
            continue;
        }
        let owner = owner.clone();
        let active = active.clone();
        std::thread::spawn(move || {
            struct Count(Arc<AtomicUsize>);
            impl Drop for Count {
                fn drop(&mut self) {
                    self.0.fetch_sub(1, Ordering::SeqCst);
                }
            }
            let _count = Count(active);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
            let result = (|| -> Result<Value, Error> {
                let line = read_frame(&mut stream, Duration::from_secs(5))?;
                handle_frame(&owner, &line)
            })();
            let response = result.unwrap_or_else(
                |e| json!({"id":"", "revision":0, "value":null, "error":e.to_string()}),
            );
            if let Ok(mut bytes) = serde_json::to_vec(&response) {
                bytes.push(b'\n');
                let _ = stream.write_all(&bytes);
            }
        });
    }
    Ok(())
}
pub fn call_cli(command: Commands, config: &Config) -> Result<(), Box<dyn std::error::Error>> {
    let wait_sync = matches!(&command, Commands::Sync(cmd) if !cmd.is_status());
    let operation = match command {
        Commands::Sync(cmd) if cmd.is_status() => Operation::Status,
        Commands::Sync(_) => Operation::Sync,
        command => Operation::Cli { command },
    };
    let id = std::env::var("FIT_REQUEST_ID").unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());
    let request = Request {
        version: 1,
        id: id.clone(),
        operation,
    };
    let mut response = exchange(&request, config).map_err(|e| format!("Daemon request failed: {e}. If the outcome is unknown, retry the same command with FIT_REQUEST_ID={id}"))?;
    if let Some(error) = response.error {
        return Err(error.into());
    }
    if wait_sync {
        let deadline = std::time::Instant::now() + Duration::from_secs(35);
        loop {
            let status = Request {
                version: 1,
                id: uuid::Uuid::new_v4().to_string(),
                operation: Operation::Status,
            };
            response = exchange(&status, config).map_err(|e| e.to_string())?;
            if let Some(error) = response.error {
                return Err(error.into());
            }
            let state = response
                .value
                .as_ref()
                .and_then(|v| v.get("sync"))
                .and_then(Value::as_str)
                .ok_or("Invalid sync status")?;
            if state.starts_with("failed:") {
                return Err(state.to_string().into());
            }
            if state != "running" {
                println!("Sync complete.");
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                return Err("Sync still running; inspect fit sync status".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    if let Some(value) = response.value {
        if let Some(output) = value.get("stdout").and_then(Value::as_str) {
            print!("{output}");
        } else {
            println!("{value}");
        }
    }
    Ok(())
}
#[cfg(unix)]
fn exchange(request: &Request, config: &Config) -> Result<Response, Error> {
    use std::os::unix::net::UnixStream;
    let mut stream = UnixStream::connect(endpoint(&config.data_dir.value)).map_err(|e| format!("Daemon unavailable ({e}). Start fit -c <config> daemon with the same new data_dir. No direct-storage fallback"))?;
    stream.set_read_timeout(Some(Duration::from_secs(15)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let mut bytes = serde_json::to_vec(request)?;
    bytes.push(b'\n');
    stream.write_all(&bytes)?;
    let line = read_frame(&mut stream, Duration::from_secs(15))?;
    let response: Response = serde_json::from_str(&line)?;
    if response.error.is_none() && response.id != request.id {
        return Err("Mismatched response ID".into());
    }
    Ok(response)
}

#[cfg(unix)]
fn read_frame(
    stream: &mut std::os::unix::net::UnixStream,
    timeout: Duration,
) -> Result<String, Error> {
    let deadline = std::time::Instant::now() + timeout;
    let mut bytes = Vec::new();
    loop {
        let remaining = deadline
            .checked_duration_since(std::time::Instant::now())
            .ok_or("Frame deadline exceeded")?;
        stream.set_read_timeout(Some(remaining))?;
        let mut chunk = [0u8; 8192];
        let count = stream.read(&mut chunk)?;
        if count == 0 {
            return Err("Incomplete frame".into());
        }
        bytes.extend_from_slice(&chunk[..count]);
        if bytes.len() as u64 > MAX_FRAME {
            return Err("Frame exceeds 8 MiB".into());
        }
        if let Some(end) = bytes.iter().position(|b| *b == b'\n') {
            bytes.truncate(end + 1);
            return Ok(String::from_utf8(bytes)?);
        }
    }
}

/// The legacy bridge remains a compatibility adapter. New clients send protocol-v2
/// application requests directly, independent of the CLI command enum.
fn handle_frame(owner: &Arc<Owner>, line: &str) -> Result<Value, Error> {
    use todu_fit_protocol as api;
    let raw: Value = serde_json::from_str(line)?;
    if raw.get("version").and_then(Value::as_u64) == Some(1) {
        let request: Request = serde_json::from_value(raw)?;
        if request.version != 1 || uuid::Uuid::parse_str(&request.id).is_err() {
            return Err("INVALID_REQUEST".into());
        }
        let response = if matches!(request.operation, Operation::Sync) {
            start_sync(owner.clone());
            Response {
                id: request.id,
                revision: owner
                    .store
                    .lock()
                    .map_err(|_| "Owner unavailable")?
                    .revision()?,
                value: Some(json!({"sync":"running"})),
                error: None,
            }
        } else {
            owner.apply(&request)?
        };
        return Ok(serde_json::to_value(response)?);
    }
    let id = raw
        .get("id")
        .and_then(Value::as_str)
        .and_then(|s| uuid::Uuid::parse_str(s).ok())
        .unwrap_or_default();
    let rejected = |code, message| api::Response {
        version: api::VERSION,
        id,
        revision: 0,
        outcome: api::Outcome::Error {
            error: todu_fit_service::error(code, message),
        },
    };
    if raw.get("version").and_then(Value::as_u64) != Some(u64::from(api::VERSION)) {
        return Ok(serde_json::to_value(rejected(
            api::ErrorCode::UnsupportedVersion,
            "Expected application protocol version 2".into(),
        ))?);
    }
    let request: api::Request = match serde_json::from_value(raw) {
        Ok(request) => request,
        Err(e) => {
            return Ok(serde_json::to_value(rejected(
                api::ErrorCode::InvalidInput,
                e.to_string(),
            ))?)
        }
    };
    let response = (|| -> Result<api::Response, Error> {
 let response = match &request.operation {
        api::Operation::SetupStatus | api::Operation::SetupStart { .. } => {
            let state = if matches!(request.operation, api::Operation::SetupStatus) { setup::status(owner)? } else { setup::start(owner, &request)? };
            api::Response { version: api::VERSION, id, revision: owner.store.lock().map_err(|_| "Owner unavailable")?.revision()?, outcome: api::Outcome::Ok { value: Box::new(api::Value::Setup(state)) } }
        }
        api::Operation::ConfigGet => {
            let value = api::Value::Configuration(api::Configuration {
                created_by: owner.config.created_by.value.clone(),
                sync_server_url: setup::server_url(owner)?,
                auto_sync: setup::auto_sync(owner),
                default_timezone: crate::commands::detected_system_timezone(),
            });
            api::Response {
                version: api::VERSION,
                id,
                revision: owner
                    .store
                    .lock()
                    .map_err(|_| "Owner unavailable")?
                    .revision()?,
                outcome: api::Outcome::Ok { value: Box::new(value) },
            }
        }
        api::Operation::SyncStart | api::Operation::Status | api::Operation::Changes { .. } => {
            if matches!(request.operation, api::Operation::SyncStart) {
                start_sync(owner.clone());
            }
            let revision = owner
                .store
                .lock()
                .map_err(|_| "Owner unavailable")?
                .revision()?;
            let state = owner.sync.lock().map_err(|_| "Owner unavailable")?.clone();
            let sync = match state.as_str() {
                "idle" => api::SyncState::Idle,
                "running" => api::SyncState::Running,
                _ => api::SyncState::Failed {
                    message: state.strip_prefix("failed: ").unwrap_or(&state).into(),
                },
            };
            let value = api::Value::Status(api::Status {
                revision,
                sync,
                changed: matches!(request.operation,api::Operation::Changes{after} if after<revision),
            });
            api::Response {
                version: api::VERSION,
                id,
                revision,
                outcome: api::Outcome::Ok { value: Box::new(value) },
            }
        }
        _ => {
            let mut store = owner.store.lock().map_err(|_| "Owner unavailable")?;
            let context = todu_fit_service::Context {
                created_by: owner.config.created_by.value.clone(),
                default_timezone: crate::commands::detected_system_timezone,
            };
            todu_fit_service::transact(&mut store, &owner.config.data_dir.value, &context, &request)
        }
    };
 Ok(response)
 })().unwrap_or_else(|e| rejected(api::ErrorCode::Unavailable,e.to_string()));
    Ok(serde_json::to_value(response)?)
}
