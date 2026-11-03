#![cfg(unix)]
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
struct Fixture {
    _dir: tempfile::TempDir,
    config: PathBuf,
    socket: PathBuf,
    child: Option<Child>,
}
impl Fixture {
    fn new() -> Self {
        // macOS Unix socket paths are limited to 104 bytes.
        let dir = tempfile::Builder::new()
            .prefix("fit-")
            .tempdir_in("/tmp")
            .unwrap();
        let config = dir.path().join("config.yaml");
        let data = dir.path().join("store");
        fs::write(
            &config,
            format!(
                "data_dir: {}\nsync:\n  server_url: ws://127.0.0.1:1\n  auto_sync: false\n",
                data.display()
            ),
        )
        .unwrap();
        let mut f = Self {
            config,
            socket: data.join("daemon.sock"),
            _dir: dir,
            child: None,
        };
        f.start();
        f
    }
    fn start(&mut self) {
        self.child = Some(
            Command::new(env!("CARGO_BIN_EXE_fit"))
                .args(["-c", self.config.to_str().unwrap(), "daemon"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::inherit())
                .spawn()
                .unwrap(),
        );
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if UnixStream::connect(&self.socket).is_ok() {
                break;
            }
            assert!(Instant::now() < deadline, "daemon startup timed out");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    fn kill(&mut self) {
        if let Some(mut child) = self.child.take() {
            child.kill().unwrap();
            child.wait().unwrap();
        }
    }
    fn cli(&self, args: &[&str], id: Option<&str>) -> String {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_fit"));
        cmd.args(["-c", self.config.to_str().unwrap()]).args(args);
        if let Some(id) = id {
            cmd.env("FIT_REQUEST_ID", id);
        }
        let out = cmd.output().unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap()
    }
    fn rpc(&self, operation: Value, id: &str) -> Value {
        let mut socket = UnixStream::connect(&self.socket).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        writeln!(
            socket,
            "{}",
            json!({"version":1,"id":id,"operation":operation})
        )
        .unwrap();
        let mut line = String::new();
        BufReader::new(socket).read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap()
    }
    fn request(&self, operation: Value) -> Value {
        self.rpc(operation, &uuid::Uuid::new_v4().to_string())
    }
    fn init(&self) {
        self.cli(&["init", "--new"], None);
        self.cli(&["group", "create", "Disposable"], None);
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.kill();
    }
}
#[test]
fn acknowledged_multi_document_writes_survive_sigkill_and_retry() {
    let mut f = Fixture::new();
    let init_id = uuid::Uuid::new_v4().to_string();
    let output = f.cli(&["init", "--new"], Some(&init_id));
    f.kill();
    f.start();
    assert_eq!(f.cli(&["init", "--new"], Some(&init_id)), output);
    let group_id = uuid::Uuid::new_v4().to_string();
    let group = f.cli(&["group", "create", "Disposable"], Some(&group_id));
    f.kill();
    f.start();
    assert_eq!(
        f.cli(&["group", "create", "Disposable"], Some(&group_id)),
        group
    );
    let id = uuid::Uuid::new_v4().to_string();
    let op = json!({"type":"create_dish","name":"Acknowledged"});
    let saved = f.rpc(op.clone(), &id);
    assert!(saved["error"].is_null(), "{saved}");
    f.kill();
    f.start();
    assert_eq!(f.rpc(op, &id), saved);
    let list = f.request(json!({"type":"list_dishes"}));
    assert_eq!(list["value"].as_array().unwrap().len(), 1);
    assert_eq!(list["value"][0]["id"], saved["value"]["id"]);
    assert!(
        f.rpc(json!({"type":"create_dish","name":"Different"}), &id)["error"]
            .as_str()
            .unwrap()
            .contains("RETRY_CONFLICT")
    );
}
#[test]
fn disconnected_sync_does_not_block_local_save_and_reports_failure() {
    let f = Fixture::new();
    f.init();
    f.request(json!({"type":"sync"}));
    let started = Instant::now();
    let saved = f.request(json!({"type":"create_dish","name":"Offline"}));
    assert!(saved["error"].is_null(), "{saved}");
    assert!(started.elapsed() < Duration::from_secs(2));
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let status = f.request(json!({"type":"status"}));
        if status["value"]["sync"]
            .as_str()
            .unwrap()
            .starts_with("failed:")
        {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(f.cli(&["dish", "list"], None).contains("Offline"));
}
#[test]
fn lost_response_retry_is_exactly_once_and_second_owner_is_rejected() {
    let f = Fixture::new();
    f.init();
    let id = uuid::Uuid::new_v4().to_string();
    let op = json!({"type":"create_dish","name":"Lost response"});
    let mut socket = UnixStream::connect(&f.socket).unwrap();
    writeln!(socket, "{}", json!({"version":1,"id":id,"operation":op})).unwrap();
    drop(socket);
    let retried = f.rpc(op, &id);
    assert!(retried["error"].is_null(), "{retried}");
    let list = f.request(json!({"type":"list_dishes"}));
    assert_eq!(list["value"].as_array().unwrap().len(), 1);
    let second = Command::new(env!("CARGO_BIN_EXE_fit"))
        .args(["-c", f.config.to_str().unwrap(), "daemon"])
        .output()
        .unwrap();
    assert!(!second.status.success());
}
#[test]
fn existing_store_is_never_adopted_or_changed() {
    let dir = tempfile::tempdir().unwrap();
    let legacy = dir.path().join("legacy");
    fs::create_dir(&legacy).unwrap();
    fs::write(legacy.join("root_doc_id"), "preserve-me").unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_fit"))
        .env("FIT_DATA_DIR", &legacy)
        .arg("daemon")
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert_eq!(
        fs::read_to_string(legacy.join("root_doc_id")).unwrap(),
        "preserve-me"
    );
    assert_eq!(fs::read_dir(legacy).unwrap().count(), 1);
}
