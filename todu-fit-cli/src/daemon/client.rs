//! CLI lifecycle and application protocol access; no Electron dependency.
use super::*;
use std::process::{Command, Stdio};
use std::time::Instant;
use todu_fit_protocol as api;

pub fn application_request(
    config: &Config,
    operation: api::Operation,
    id: uuid::Uuid,
) -> Result<api::Value, Error> {
    request_with_timeout(config, operation, id, Duration::from_secs(15))
}
fn request_with_timeout(
    config: &Config,
    operation: api::Operation,
    id: uuid::Uuid,
    timeout: Duration,
) -> Result<api::Value, Error> {
    let request = api::Request {
        version: api::VERSION,
        id,
        operation,
    };
    let response: api::Response = serde_json::from_value(super::exchange_value(
        &serde_json::to_value(request)?,
        config,
        timeout,
    )?)?;
    if response.version != api::VERSION || response.id != id {
        return Err("Incompatible daemon response".into());
    }
    match response.outcome {
        api::Outcome::Ok { value } => Ok(*value),
        api::Outcome::Error { error } => Err(error.into()),
    }
}
fn probe(config: &Config) -> Result<(), Error> {
    match request_with_timeout(
        config,
        api::Operation::SetupStatus,
        uuid::Uuid::new_v4(),
        Duration::from_millis(500),
    )? {
        api::Value::Setup(_) => Ok(()),
        _ => Err("Daemon does not support shared setup".into()),
    }
}
pub fn ensure_running(config: &Config) -> Result<(), Error> {
    if probe(config).is_ok() {
        return Ok(());
    }
    let path = std::path::absolute(&config.data_dir.value)?;
    if path.exists()
        && !path.join("daemon.sqlite").exists()
        && fs::read_dir(&path)?
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .any(|e| e.file_name() != "daemon.lock")
    {
        return Err("This data_dir contains legacy CLI data. It was not modified. Select the desktop's daemon data_dir, or an empty directory and run fit init --join <PERSONAL_SYNC_CODE>. Unsynced legacy changes require a separate migration.".into());
    }
    let parent = path.parent().ok_or("Data directory has no parent")?;
    fs::create_dir_all(parent)?;
    let log_path = path.with_extension("daemon-startup.log");
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let log = options.open(&log_path)?;
    let mut child = Command::new(std::env::current_exe()?);
    if let Some(file) = &config.config_file {
        child.arg("-c").arg(std::path::absolute(file)?);
    }
    child
        .arg("daemon")
        .env("FIT_DATA_DIR", &path)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: setsid is async-signal-safe and does not access Rust state after fork.
        unsafe {
            child.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        child.creation_flags(0x00000008 | 0x00000200); // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    }
    let mut child = child.spawn()?;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if probe(config).is_ok() {
            // Reap a losing starter or the detached owner when this CLI stays alive.
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            return Ok(());
        }
        let _ = child.try_wait()?;
        if Instant::now() >= deadline {
            return Err(format!("Daemon did not become ready within 15 seconds. Check {}. Existing data was not replaced.", log_path.display()).into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}
