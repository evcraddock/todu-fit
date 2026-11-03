//! Terminal policy stays in the CLI while coordination lives in Core.
use std::process::{Command, Output};
use tempfile::TempDir;

fn run(dir: &TempDir, config: &str, args: &[&str]) -> Output {
    let path = dir.path().join("config.yaml");
    std::fs::write(&path, config).unwrap();
    Command::new(env!("CARGO_BIN_EXE_fit"))
        .arg("-c")
        .arg(path)
        .args(args)
        .env("FIT_DATA_DIR", dir.path())
        .env_remove("FIT_SYNC_URL")
        .output()
        .unwrap()
}

#[test]
fn explicit_sync_preserves_configuration_and_initialization_guidance() {
    let dir = TempDir::new().unwrap();
    let output = run(&dir, "sync:\n  auto_sync: false\n", &["sync"]);
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert_eq!(
        String::from_utf8(output.stderr).unwrap(),
        "Error: Sync not configured. Add server_url to config.\n"
    );
    let output = run(
        &dir,
        "sync:\n  server_url: 'ws://unused'\n  auto_sync: false\n",
        &["sync"],
    );
    assert!(!output.status.success());
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        "Syncing with server...\n\n"
    );
    assert_eq!(
        String::from_utf8(output.stderr).unwrap(),
        "Error: Identity not initialized. Run 'fit init --new' first.\n"
    );
}

#[test]
fn status_reports_uninitialized_identity_without_failing_command() {
    let dir = TempDir::new().unwrap();
    let output = run(
        &dir,
        "sync:\n  server_url: 'ws://unused'\n  auto_sync: true\n",
        &["sync", "status"],
    );
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    assert_eq!(String::from_utf8(output.stdout).unwrap(), "Sync Configuration\n==================\n\nServer:    ws://unused\nAuto-sync: enabled\n\nServer status: ✗ error: Identity not initialized. Run 'fit init --new' first.\n");
}

#[test]
fn auto_sync_reports_network_failure_but_keeps_reads_available_offline() {
    let dir = TempDir::new().unwrap();
    let identity =
        todu_fit_core::Identity::new(todu_fit_core::MultiDocStorage::new(dir.path().into()));
    identity.initialize_new().unwrap();
    identity.create_group("Home").unwrap();
    let disabled = run(
        &dir,
        "sync:\n  server_url: 'ws://127.0.0.1:0'\n  auto_sync: false\n",
        &["dish", "list"],
    );
    assert!(disabled.status.success());
    assert!(disabled.stderr.is_empty());
    let enabled = run(
        &dir,
        "sync:\n  server_url: 'ws://127.0.0.1:0'\n  auto_sync: true\n",
        &["dish", "list"],
    );
    assert!(enabled.status.success());
    assert_eq!(enabled.stdout, disabled.stdout);
    assert!(String::from_utf8(enabled.stderr)
        .unwrap()
        .starts_with("Auto-sync: "));
}
