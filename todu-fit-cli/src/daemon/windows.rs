//! Named pipes use the creator's default security descriptor and reject remote clients.
//! Keep the selected store under the current user's private profile directory.
use super::*;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt},
    net::windows::named_pipe::{ClientOptions, ServerOptions},
};
fn pipe_path(path: &Path) -> Result<String, Error> {
    let path = fs::canonicalize(path)?;
    // UUID v5 is not enabled; derive a stable pipe name from the canonical path.
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(path.to_string_lossy().to_lowercase().as_bytes());
    Ok(format!(r"\\.\pipe\todu-fit-{:x}", hash))
}
pub fn serve(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    let result = serve_inner(config);
    result.map_err(|e| e.to_string().into())
}
fn serve_inner(config: Config) -> Result<(), Error> {
    let path = &config.data_dir.value;
    if path.exists() && !path.join("daemon.sqlite").exists() && fs::read_dir(path)?.next().is_some()
    {
        return Err(
            "Refusing to adopt a nonempty legacy/proof store; use a new private data_dir".into(),
        );
    }
    fs::create_dir_all(path)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path.join("daemon.lock"))?;
    lock.try_lock_exclusive()?;
    let store = Store::open(&path.join("daemon.sqlite"))?;
    store::clean_workspaces(path)?;
    let endpoint = pipe_path(path)?;
    let owner = Arc::new(Owner {
        store: Mutex::new(store),
        config,
        sync: Mutex::new("idle".into()),
    });
    if owner.config.sync.auto_sync {
        let background = owner.clone();
        std::thread::spawn(move || loop {
            start_sync(background.clone());
            std::thread::sleep(Duration::from_secs(30));
        });
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async move {
        let mut server = ServerOptions::new()
            .first_pipe_instance(true)
            .reject_remote_clients(true)
            .create(&endpoint)?;
        fs::write(
            owner.config.data_dir.value.join("daemon.endpoint"),
            &endpoint,
        )?;
        println!("Daemon endpoint: {endpoint}");
        let admission = Arc::new(tokio::sync::Semaphore::new(16));
        loop {
            server.connect().await?;
            let connected = server;
            server = ServerOptions::new()
                .reject_remote_clients(true)
                .create(&endpoint)?;
            let Ok(permit) = admission.clone().try_acquire_owned() else {
                drop(connected);
                continue;
            };
            let owner = owner.clone();
            tokio::spawn(async move {
                let _permit = permit;
                let mut connected = connected;
                let read = async {
                    let mut line = String::new();
                    tokio::io::BufReader::new((&mut connected).take(MAX_FRAME + 1))
                        .read_line(&mut line)
                        .await?;
                    if line.len() as u64 > MAX_FRAME || !line.ends_with('\n') {
                        return Err("INVALID_FRAME".into());
                    }
                    serde_json::from_str::<Request>(&line).map_err(|e| -> Error { e.into() })
                };
                let Ok(Ok(request)) = tokio::time::timeout(Duration::from_secs(5), read).await
                else {
                    return;
                };
                let id = request.id.clone();
                let result = tokio::task::spawn_blocking(move || -> Result<Response, Error> {
                    if request.version != 1 || uuid::Uuid::parse_str(&request.id).is_err() {
                        return Err("INVALID_REQUEST".into());
                    }
                    if matches!(request.operation, Operation::Sync) {
                        start_sync(owner.clone());
                        return Ok(Response {
                            id: request.id,
                            revision: owner.store.lock().unwrap().revision()?,
                            value: Some(json!({"sync":"running"})),
                            error: None,
                        });
                    }
                    owner.apply(&request)
                })
                .await;
                let response = match result {
                    Ok(Ok(response)) => response,
                    Ok(Err(e)) => Response {
                        id,
                        revision: 0,
                        value: None,
                        error: Some(e.to_string()),
                    },
                    Err(_) => return,
                };
                if let Ok(mut bytes) = serde_json::to_vec(&response) {
                    bytes.push(b'\n');
                    let _ =
                        tokio::time::timeout(Duration::from_secs(5), connected.write_all(&bytes))
                            .await;
                }
            });
        }
        #[allow(unreachable_code)]
        Ok::<(), Error>(())
    })
}
pub(super) fn exchange(request: &Request, config: &Config) -> Result<Response, Error> {
    let endpoint = pipe_path(&config.data_dir.value)?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async {
        tokio::time::timeout(Duration::from_secs(15), async {
            let mut pipe = loop {
                match ClientOptions::new().open(&endpoint) {
                    Ok(pipe) => break pipe,
                    Err(e) if e.raw_os_error() == Some(231) => {
                        tokio::time::sleep(Duration::from_millis(50)).await
                    }
                    Err(e) => return Err(e.into()),
                }
            };
            let mut bytes = serde_json::to_vec(request)?;
            bytes.push(b'\n');
            pipe.write_all(&bytes).await?;
            let mut line = String::new();
            tokio::io::BufReader::new(pipe.take(MAX_FRAME + 1))
                .read_line(&mut line)
                .await?;
            if line.len() as u64 > MAX_FRAME || !line.ends_with('\n') {
                return Err("Invalid or incomplete daemon response".into());
            }
            let response: Response = serde_json::from_str(&line)?;
            if response.error.is_none() && response.id != request.id {
                return Err("Mismatched response ID".into());
            }
            Ok::<Response, Error>(response)
        })
        .await
        .map_err(|e| -> Error { e.into() })?
    })
}
