//! Test-only fixture import/export. Never invoked by the installed application.
//! Keeps historic Core fixture assertions while exercising commands through IPC.
use rusqlite::{params, Connection};
use std::{
    fs,
    path::Path,
    process::{Command, Output, Stdio},
    time::{Duration, Instant},
};
pub fn run(fixture: &Path, args: &[&str]) -> Output {
    let root = tempfile::Builder::new()
        .prefix("fit-test-")
        .tempdir_in("/tmp")
        .unwrap_or_else(|_| tempfile::tempdir().unwrap());
    let store = root.path().join("store");
    fs::create_dir(&store).unwrap();
    let db = Connection::open(store.join("daemon.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE documents(name TEXT PRIMARY KEY,bytes BLOB NOT NULL)")
        .unwrap();
    let selected = |name: &str| {
        name == "root_doc_id" || name == "current_group" || name.ends_with(".automerge")
    };
    for entry in fs::read_dir(fixture).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().into_string().unwrap();
        if selected(&name) {
            db.execute(
                "INSERT INTO documents VALUES(?,?)",
                params![name, fs::read(entry.path()).unwrap()],
            )
            .unwrap();
        }
    }
    drop(db);
    let config = fixture.join("config.yaml");
    let mut daemon = Command::new(env!("CARGO_BIN_EXE_fit"))
        .args(["-c", config.to_str().unwrap(), "daemon"])
        .env("FIT_DATA_DIR", &store)
        .env_remove("FIT_SYNC_URL")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    struct Stop(std::process::Child);
    impl Drop for Stop {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while !store.join("daemon.endpoint").exists() {
        assert!(daemon.try_wait().unwrap().is_none(), "daemon exited");
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    let guard = Stop(daemon);
    let output = Command::new(env!("CARGO_BIN_EXE_fit"))
        .args(["-c", config.to_str().unwrap()])
        .args(args)
        .env("FIT_DATA_DIR", &store)
        .env_remove("FIT_SYNC_URL")
        .output()
        .unwrap();
    drop(guard);
    let db = Connection::open(store.join("daemon.sqlite")).unwrap();
    for entry in fs::read_dir(fixture).unwrap() {
        let entry = entry.unwrap();
        if selected(&entry.file_name().to_string_lossy()) {
            fs::remove_file(entry.path()).unwrap();
        }
    }
    let mut stmt = db.prepare("SELECT name,bytes FROM documents").unwrap();
    for row in stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })
        .unwrap()
    {
        let (name, bytes) = row.unwrap();
        fs::write(fixture.join(name), bytes).unwrap();
    }
    output
}
