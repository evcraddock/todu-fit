//! Network work belongs to the owner; status is a read, explicit sync waits boundedly.
mod support;
use tempfile::TempDir;
#[test]
fn explicit_sync_reports_missing_configuration_and_identity() {
    let dir = TempDir::new().unwrap();
    std::fs::write(
        dir.path().join("config.yaml"),
        "sync:\n  auto_sync: false\n",
    )
    .unwrap();
    let output = support::run(dir.path(), &["sync"]);
    assert!(!output.status.success());
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("Sync server not configured"));
    std::fs::write(
        dir.path().join("config.yaml"),
        "sync:\n  server_url: ws://127.0.0.1:1\n  auto_sync: false\n",
    )
    .unwrap();
    let output = support::run(dir.path(), &["sync"]);
    assert!(!output.status.success());
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("Identity not initialized"));
}
#[test]
fn status_does_not_start_network_work() {
    let dir = TempDir::new().unwrap();
    std::fs::write(
        dir.path().join("config.yaml"),
        "sync:\n  server_url: ws://127.0.0.1:1\n  auto_sync: false\n",
    )
    .unwrap();
    let output = support::run(dir.path(), &["sync", "status"]);
    assert!(output.status.success());
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["sync"], "idle");
}
