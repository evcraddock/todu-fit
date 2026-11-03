//! SQLite is authoritative. Core's file storage is an operation-scoped workspace.
//! All changed documents, metadata, revision and retry result commit atomically.
use super::{Error, Response};
use rusqlite::{params, Connection, OptionalExtension};
use std::{collections::BTreeMap, fs, path::Path};
pub type Snapshot = BTreeMap<String, Vec<u8>>;
pub struct Store {
    pub db: Connection,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self, Error> {
        let db = Connection::open(path)?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON;
            CREATE TABLE IF NOT EXISTS documents(name TEXT PRIMARY KEY, bytes BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, request TEXT NOT NULL, response TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
            INSERT OR IGNORE INTO state VALUES(1,0);")?;
        Ok(Self { db })
    }
    pub fn snapshot(&self) -> Result<Snapshot, Error> {
        let mut stmt = self.db.prepare("SELECT name,bytes FROM documents")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }
    pub fn revision(&self) -> Result<u64, Error> {
        Ok(self
            .db
            .query_row("SELECT revision FROM state WHERE id=1", [], |r| r.get(0))?)
    }
    pub fn receipt(&self, id: &str, request: &str) -> Result<Option<Response>, Error> {
        let saved: Option<(String, String)> = self
            .db
            .query_row(
                "SELECT request,response FROM receipts WHERE id=?",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        match saved {
            Some((old, response)) if old == request => Ok(Some(serde_json::from_str(&response)?)),
            Some(_) => Err("RETRY_CONFLICT: request ID already used with another payload".into()),
            None => Ok(None),
        }
    }
    pub fn commit(
        &mut self,
        snapshot: &Snapshot,
        receipt: Option<(&str, &str, &Response)>,
    ) -> Result<(), Error> {
        let tx = self.db.transaction()?;
        tx.execute("DELETE FROM documents", [])?;
        for (name, bytes) in snapshot {
            tx.execute("INSERT INTO documents VALUES(?,?)", params![name, bytes])?;
        }
        tx.execute("UPDATE state SET revision=revision+1 WHERE id=1", [])?;
        if let Some((id, request, response)) = receipt {
            tx.execute(
                "INSERT INTO receipts VALUES(?,?,?)",
                params![id, request, serde_json::to_string(response)?],
            )?;
        }
        #[cfg(test)]
        if std::env::var_os("FIT_TEST_CRASH_BEFORE_COMMIT").is_some() {
            std::process::exit(73);
        }
        tx.commit()?;
        Ok(())
    }
}
/// Only daemon-owned, uncommitted scratch data is discarded after owner lock acquisition.
pub fn clean_workspaces(root: &Path) -> Result<(), Error> {
    let work = root.join("work");
    if work.exists() {
        fs::remove_dir_all(&work)?;
    }
    fs::create_dir(&work)?;
    Ok(())
}
pub fn materialize(snapshot: &Snapshot, root: &Path) -> Result<tempfile::TempDir, Error> {
    let dir = tempfile::tempdir_in(root.join("work"))?;
    for (name, bytes) in snapshot {
        fs::write(dir.path().join(name), bytes)?;
    }
    Ok(dir)
}
pub fn collect(path: &Path) -> Result<Snapshot, Error> {
    let mut snapshot = Snapshot::new();
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Invalid store filename")?;
        if name == "root_doc_id" || name == "current_group" || name.ends_with(".automerge") {
            snapshot.insert(name, fs::read(entry.path())?);
        } else {
            return Err("Unexpected file in operation workspace".into());
        }
    }
    Ok(snapshot)
}
/// Merge the network snapshot into the latest local state, never overwrite local edits.
pub fn merge(current: &mut Snapshot, remote: Snapshot) -> Result<(), Error> {
    for (name, bytes) in remote {
        if !name.ends_with(".automerge") {
            continue;
        }
        let mut other = automerge::AutoCommit::load(&bytes)?;
        if let Some(local) = current.get(&name) {
            let mut doc = automerge::AutoCommit::load(local)?;
            doc.merge(&mut other)?;
            current.insert(name, doc.save());
        } else {
            current.insert(name, bytes);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_commit_keeps_every_document_and_receipt_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(&dir.path().join("store.sqlite")).unwrap();
        let before = Snapshot::from([("one".into(), vec![1]), ("two".into(), vec![2])]);
        store.commit(&before, None).unwrap();
        // Simulate a storage failure after DELETE and first INSERT, midway through a multi-doc commit.
        store.db.execute_batch("CREATE TRIGGER fail BEFORE INSERT ON documents WHEN NEW.name='two' BEGIN SELECT RAISE(ABORT,'injected write failure'); END;").unwrap();
        let after = Snapshot::from([("one".into(), vec![3]), ("two".into(), vec![4])]);
        let response = Response {
            id: "retry".into(),
            revision: 2,
            value: None,
            error: None,
        };
        assert!(store
            .commit(&after, Some(("retry", "payload", &response)))
            .is_err());
        assert_eq!(store.snapshot().unwrap(), before);
        assert_eq!(store.revision().unwrap(), 1);
        assert!(store.receipt("retry", "payload").unwrap().is_none());
        drop(store);
        let store = Store::open(&dir.path().join("store.sqlite")).unwrap();
        assert_eq!(store.snapshot().unwrap(), before);
    }
    #[test]
    fn receipt_and_documents_reopen_together_and_reject_changed_retry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.sqlite");
        let mut store = Store::open(&path).unwrap();
        let response = Response {
            id: "request".into(),
            revision: 1,
            value: Some(serde_json::json!({"id":"stable"})),
            error: None,
        };
        let snapshot = Snapshot::from([("one".into(), vec![1]), ("two".into(), vec![2])]);
        store
            .commit(&snapshot, Some(("request", "payload", &response)))
            .unwrap();
        drop(store);
        let store = Store::open(&path).unwrap();
        assert_eq!(store.snapshot().unwrap(), snapshot);
        assert_eq!(
            store.receipt("request", "payload").unwrap().unwrap().value,
            response.value
        );
        assert!(store.receipt("request", "different").is_err());
    }
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    #[test]
    fn interrupted_commit_child() {
        let Some(path) = std::env::var_os("FIT_TEST_CRASH_STORE") else {
            return;
        };
        let mut store = Store::open(Path::new(&path)).unwrap();
        let snapshot = Snapshot::from([("one".into(), vec![9]), ("two".into(), vec![9])]);
        let response = Response {
            id: "interrupted".into(),
            revision: 2,
            value: None,
            error: None,
        };
        store
            .commit(&snapshot, Some(("interrupted", "request", &response)))
            .unwrap();
        panic!("test failpoint did not terminate the process");
    }
    #[test]
    fn process_death_during_multidocument_commit_rolls_back_documents_and_receipt() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.sqlite");
        let mut store = Store::open(&path).unwrap();
        let before = Snapshot::from([("one".into(), vec![1]), ("two".into(), vec![2])]);
        store.commit(&before, None).unwrap();
        drop(store);
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "daemon::store::recovery_tests::interrupted_commit_child",
            ])
            .env("FIT_TEST_CRASH_STORE", &path)
            .env("FIT_TEST_CRASH_BEFORE_COMMIT", "1")
            .output()
            .unwrap();
        assert_eq!(result.status.code(), Some(73));
        let store = Store::open(&path).unwrap();
        assert_eq!(store.snapshot().unwrap(), before);
        assert_eq!(store.revision().unwrap(), 1);
        assert!(store.receipt("interrupted", "request").unwrap().is_none());
    }
    #[test]
    fn sync_merge_preserves_edits_committed_after_network_snapshot() {
        use automerge::{transaction::Transactable, ReadDoc, ROOT};
        let mut base = automerge::AutoCommit::new();
        base.put(ROOT, "base", 1).unwrap();
        let bytes = base.save();
        let mut local = automerge::AutoCommit::load(&bytes).unwrap();
        let mut remote = automerge::AutoCommit::load(&bytes).unwrap();
        local.put(ROOT, "local", 2).unwrap();
        remote.put(ROOT, "remote", 3).unwrap();
        let mut current = Snapshot::from([("doc.automerge".into(), local.save())]);
        merge(
            &mut current,
            Snapshot::from([("doc.automerge".into(), remote.save())]),
        )
        .unwrap();
        let merged = automerge::AutoCommit::load(&current["doc.automerge"]).unwrap();
        assert!(merged.get(ROOT, "local").unwrap().is_some());
        assert!(merged.get(ROOT, "remote").unwrap().is_some());
    }
}
