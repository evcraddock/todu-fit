//! Thin client for the shared Node assistant. Nutrition storage remains daemon-owned.
use crate::config::Config;
use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
type Error = Box<dyn std::error::Error>;

#[derive(Args, Serialize, Deserialize)]
pub struct AiCommand {
    /// Worker bundle directory (normally installed beside fit)
    #[arg(long, global = true)]
    worker_bundle: Option<PathBuf>,
    #[command(subcommand)]
    command: Action,
}
#[derive(Subcommand, Serialize, Deserialize)]
enum Action {
    /// Inspect or control the background worker
    Worker {
        #[command(subcommand)]
        command: Worker,
    },
    /// List providers and current model configuration
    Providers,
    /// List available models for a connected provider
    Models { provider: String },
    /// Select the default model for new tasks
    Model { provider: String, model: String },
    /// Submit, inspect, or cancel durable AI work
    Task {
        #[command(subcommand)]
        command: Task,
    },
}
#[derive(Subcommand, Serialize, Deserialize)]
enum Worker {
    Start,
    Status,
    Stop,
}
#[derive(Subcommand, Serialize, Deserialize)]
enum Task {
    /// Submit work; returns immediately with conversation and submission IDs
    Start {
        prompt: String,
        #[arg(long)]
        conversation: Option<u64>,
        /// Reuse this ID when retrying an uncertain submission to the same conversation
        #[arg(long)]
        request_id: Option<String>,
    },
    List,
    Status {
        id: u64,
    },
    Entries {
        id: u64,
        #[arg(long)]
        cursor: Option<String>,
    },
    Cancel {
        id: u64,
    },
}
#[derive(Deserialize)]
struct Endpoint {
    protocol: u32,
    port: u16,
    token: String,
}
fn directory(config: &Config) -> PathBuf {
    std::env::var_os("FIT_ASSISTANT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| config.data_dir.value.join("assistant"))
}
fn request(directory: &Path, operation: Value) -> Result<Value, Error> {
    let endpoint: Endpoint = serde_json::from_slice(&fs::read(directory.join("worker.endpoint"))?)?;
    if endpoint.protocol != 1
        || endpoint.port == 0
        || endpoint.token.len() != 64
        || !endpoint.token.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid assistant endpoint".into());
    }
    let address = SocketAddr::from(([127, 0, 0, 1], endpoint.port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))?;
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let id = uuid::Uuid::new_v4().to_string();
    let mut bytes = serde_json::to_vec(
        &json!({"protocol":1,"id":id,"token":endpoint.token,"operation":operation}),
    )?;
    if bytes.len() > 180_000 {
        return Err("Assistant request too large".into());
    }
    bytes.push(b'\n');
    stream.write_all(&bytes)?;
    let mut line = String::new();
    BufReader::new(stream.take(8 * 1024 * 1024 + 1)).read_line(&mut line)?;
    if line.len() > 8 * 1024 * 1024 || !line.ends_with('\n') {
        return Err("Invalid assistant response".into());
    }
    let response: Value = serde_json::from_str(&line)?;
    if response["protocol"] != 1 || response["id"] != id {
        return Err("Incompatible assistant response".into());
    }
    if let Some(error) = response["error"].as_str() {
        return Err(error.to_owned().into());
    }
    Ok(response["value"].clone())
}
impl AiCommand {
    fn bundle(&self) -> Result<PathBuf, Error> {
        if let Some(value) = self
            .worker_bundle
            .clone()
            .or_else(|| std::env::var_os("FIT_ASSISTANT_BUNDLE").map(PathBuf::from))
        {
            return Ok(value);
        }
        let executable = std::env::current_exe()?;
        let parent = executable.parent().ok_or("Cannot find CLI directory")?;
        let mut paths = vec![
            parent.join("assistant-worker"),
            parent.join("../assistant-worker"),
        ];
        if cfg!(debug_assertions) {
            paths.push(
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../apps/desktop/assistant-worker"),
            );
        }
        paths.into_iter().find(|p| p.join("bundle.json").is_file()).ok_or_else(|| "Assistant runtime is not installed. Install the full CLI bundle or use --worker-bundle /path/to/assistant-worker.".into())
    }
    fn ensure(&self, directory: &Path) -> Result<(), Error> {
        // Always let the bundled launcher check version compatibility and ownership.
        let bundle = self.bundle()?;
        let node = bundle.join(if cfg!(windows) { "node.exe" } else { "node" });
        let mut launch = Command::new(node);
        launch.arg(bundle.join("src/launcher.mjs")).arg(directory);
        let legacy = std::env::var_os("FIT_ASSISTANT_LEGACY_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                (directory == Config::default_data_dir().join("assistant"))
                    .then(|| dirs::config_dir().map(|root| root.join("todu-fit-desktop/assistant")))
                    .flatten()
            });
        if legacy.is_some_and(|path| path.join("installation.json").is_file())
            && !directory.join("migration.json").is_file()
        {
            return Err("Open the updated desktop app once to migrate existing AI data before using the CLI.".into());
        }
        let result = launch.env_remove("ELECTRON_RUN_AS_NODE").output()?;
        if !result.status.success() {
            return Err(String::from_utf8_lossy(&result.stderr)
                .trim()
                .to_owned()
                .into());
        }
        Ok(())
    }
    pub fn run(&self, config: &Config) -> Result<(), Error> {
        let directory = directory(config);
        let output = match &self.command {
            Action::Worker {
                command: Worker::Status,
            } => request(&directory, json!({"type":"worker_status"}))?,
            Action::Worker {
                command: Worker::Stop,
            } => request(&directory, json!({"type":"worker_stop"}))?,
            command => {
                self.ensure(&directory)?;
                match command {
                    Action::Worker {
                        command: Worker::Start,
                    } => request(&directory, json!({"type":"worker_status"}))?,
                    Action::Providers => request(&directory, json!({"type":"settings"}))?,
                    Action::Models { provider } => {
                        request(&directory, json!({"type":"models","provider":provider}))?
                    }
                    Action::Model { provider, model } => request(
                        &directory,
                        json!({"type":"settings_save","model":{"provider":provider,"modelId":model}}),
                    )?,
                    Action::Task { command } => {
                        match command {
                            Task::Start {
                                prompt,
                                conversation,
                                request_id,
                            } => {
                                let id = match conversation {
                                    Some(id) => *id,
                                    None => {
                                        request(&directory, json!({"type":"conversation_create"}))?
                                            ["id"]
                                            .as_u64()
                                            .ok_or("Invalid conversation ID")?
                                    }
                                };
                                let retry = request_id
                                    .clone()
                                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                                let result = request(
                                    &directory,
                                    json!({"type":"conversation_send","id":id,"content":prompt,"requestId":retry}),
                                );
                                match result {
                                Ok(submission) => json!({"conversation":id,"requestId":retry,"submission":submission}),
                                Err(error) => return Err(format!("{error}; retry with --conversation {id} --request-id {retry}").into()),
                            }
                            }
                            Task::List => request(&directory, json!({"type":"conversation_list"}))?,
                            Task::Status { id } => {
                                request(&directory, json!({"type":"conversation_get","id":id}))?
                            }
                            Task::Entries { id, cursor } => request(
                                &directory,
                                json!({"type":"conversation_entries","id":id,"cursor":cursor}),
                            )?,
                            Task::Cancel { id } => {
                                request(&directory, json!({"type":"conversation_cancel","id":id}))?
                            }
                        }
                    }
                    _ => unreachable!("status and stop handled above"),
                }
            }
        };
        println!("{}", serde_json::to_string_pretty(&output)?);
        Ok(())
    }
}
