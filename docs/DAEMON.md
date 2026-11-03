# Shared local daemon

The CLI and Electron client use one explicitly started Rust owner: `fit daemon`.
Closing Electron leaves that process running. There is no automatic service installation,
startup, shutdown, migration, or fallback to direct client writes. No web login is used.

## Isolated setup

Use a **new, empty, private directory** and a separate configuration file:

```yaml
data_dir: /absolute/path/to/new-fit-daemon-store
created_by: your-name
sync:
  server_url: ws://your-existing-sync-server:8080
  auto_sync: false
```

Build with `cargo build -p todu-fit-cli`. In a terminal, run
`target/debug/fit -c /path/to/isolated-config.yaml daemon`.
On macOS/Linux, keep the absolute data path short enough for a Unix socket (about 100 bytes).
The directory has mode 0700; the owner holds an exclusive OS lock for its lifetime.
On Windows the transport is a named pipe, rejects remote connections, and uses the
creator's default security descriptor. Choose a private directory under your user profile;
Windows execution remains unverified until its CI/runtime checks pass.

In another terminal, use the same executable/configuration with existing commands.
For a disposable new identity, explicitly run `fit -c ... init --new`, followed by
`fit -c ... group create Test`. For an existing identity, explicitly run
`fit -c ... init --join <root-document-id>`, then `fit -c ... sync`.
Joining stores exactly the supplied root ID; it never creates a replacement identity.
Sync uses Core's identity → personal documents → groups → feature-document discovery.
Do not join real identities during implementation validation.

Electron accepts `FIT_DAEMON_ENDPOINT`, the contents of `<data_dir>/daemon.endpoint`.
On Unix this is `<data_dir>/daemon.sock`; on Windows it is the named pipe printed at startup.
The app never opens that directory's documents. Its bundled `resources/daemon/fit`
(`fit.exe` on Windows) can be started explicitly with the same configuration; an already
running compatible daemon can also serve it. The packaged client does not start a second owner.

The daemon reads configuration at startup. `fit config` still manages the client-side
configuration file locally. Restarting a user-managed daemon to apply configuration changes
is a user action. No implementation/test command controls the existing dev environment.

## Durability and recovery

`daemon.sqlite` is authoritative, containing Automerge byte streams, `root_doc_id`,
`current_group`, a revision, and request receipts. SQLite runs in WAL mode with
`synchronous=FULL` and `fullfsync=ON`. SQLite commits documents, revision, and the
successful request's response in one transaction before the daemon writes a success frame.
This relies on the filesystem/device honoring SQLite's sync requests; process-death tests
are not claims of hardware power-cut testing. See SQLite's
[atomic commit documentation](https://www.sqlite.org/atomiccommit.html) and
[synchronous pragma](https://www.sqlite.org/pragma.html#pragma_synchronous).

Core's existing file-based repositories operate in a private temporary workspace under
`work/`, populated from a committed snapshot. This is disposable transaction staging,
not an authoritative cache. Failure discards the workspace. A process death before commit
leaves the old state; a process death after commit leaves the new state and its receipt.
After acquiring the owner lock on restart, the daemon removes abandoned workspaces.
Clients cannot supply workspace paths or access a document-write RPC.

Local operations serialize under the owner lock. This retains Core behavior without
reimplementing dish, meal, shopping, or hydration rules. The initial implementation exports
and reads a full snapshot per operation, trading performance for a simple atomic boundary.
Large-store incremental transactions are future optimization work, not a reason to bypass
this commit boundary. Scratch space requires approximately another copy of the store per
active local/sync operation.

Request IDs are UUIDs. Repeating a committed mutation with the same ID and payload returns
its saved response (including generated domain IDs), even after restart. Reusing that ID
with a different payload fails. Receipts are not pruned in this version. Read-only/no-change
requests do not allocate receipts. Errors before commit are retryable; clients must retain
the same ID if the response is lost. CLI timeout/transport errors print an explicit
`FIT_REQUEST_ID=<id>` retry hint. The desktop retains an uncertain create's ID for a retry
of the same name during its session. After losing the whole desktop session, inspect the
list before initiating a new create; persistent client-side retry intents are not yet provided.

A daemon reset through `init --new --force` changes only the transactional documents;
receipts remain so delayed retries cannot repeat a prior committed operation. A sync started
for a different root ID is discarded at merge time. Existing legacy clients must never be
pointed at a daemon store; the new CLI has no direct-storage fallback.

## Sync is separate from saving

Network exchange runs against a committed snapshot on a separate thread, with a 30-second
whole-cycle timeout. Local operations do not wait for the network. On successful exchange,
the owner merges Automerge documents into the *latest* local state and durably commits them,
preserving concurrent local changes. Failed cycles discard their uncommitted staging; local
saves already acknowledged remain intact. Retrying sync is safe even if the remote accepted
some changes before failure.

`fit sync` schedules/coalesces a cycle and waits boundedly for completion, returning an error
on failure. `fit sync status` reports the last state without triggering a connection.
`auto_sync: true` schedules a cycle every 30 seconds, including at daemon startup.
This replaces the old before-read/after-write CLI auto-sync policy. Offline reads and writes
remain local; sync failure appears in status and the desktop. There is no promise that a
successful local save has already reached the remote server.

## Protocol and compatibility

Version 1 uses newline-delimited UTF-8 JSON, one request/response per connection:

```json
{"version":1,"id":"0fda275e-0687-4581-92fd-7af6c2f7c267","operation":{"type":"create_dish","name":"Apple"}}
```

Response fields are `id`, `revision`, `value`, and `error` (null on success). Operations are
`cli` (the serde-typed CLI command), `list_dishes`, `create_dish`, `sync`, `status`, and
`changes` with an `after` revision. Change notifications are resumable polling: compare the
revision and refetch affected presentation data when `changed` is true. They coalesce changes
and do not expose document contents. Electron polls every two seconds. Revision changes
are committed with the documents; sync-state changes are visible independently through status.

Limits: 8 MiB frames, 4 MiB captured CLI output, 16 admitted connections, five-second
server read/write timeouts, and 15-second client request deadlines. A client timeout cannot
cancel an operation that may already have committed; use its request ID to resolve uncertainty.
Oversized output rejects the operation before commit. Do not expose this local transport
on a network port. Windows has no TCP fallback.

Most command arguments, validation, output, and domain behavior remain unchanged. Differences:

- A running daemon and explicitly chosen new store are required.
- Destructive commands require the existing `--force`/`--yes` option. The daemon never reads stdin.
- Sync scheduling/status/output follow the policy above.
- Configuration and host timezone defaults used during domain execution belong to the daemon.
- The renderer no longer loads napi-rs or initializes an identity automatically.

The previous native adapter/worker and their tests remain as historical isolated proof code;
normal desktop startup and packaging use the daemon. Existing proof data is untouched.

## Safe adoption plan — not implemented or authorized here

1. Inventory the existing CLI/proof/browser identities, group references, and unsynced edits.
   Record root IDs and retain the original stores. Never use `init --new` as repair.
2. With explicit user approval, quiesce all old writers and take a verified backup. An import
   tool must read an immutable source snapshot and validate every referenced local document.
3. Import into a separate daemon database in one transaction, preserving every document ID,
   Automerge history, selected group and root ID; compare counts/content and reopen offline.
4. Reconcile any intentionally missing remote documents through the configured server;
   validate bidirectional convergence and unsynced edits on disposable copies first.
5. Switch clients only after verification and approval. Keep the source backup and a documented
   rollback path; never have old and new clients write the same physical directory.

There is deliberately no production importer in this change. The server refuses legacy/proof
folders rather than silently copying, moving, deleting or replacing them.

## Validation

`cargo test -p todu-fit-cli` covers request replay, response loss, acknowledged-write survival
across SIGKILL, process exit during an uncommitted multidocument transaction, injected SQL
write failure, concurrent-merge preservation, offline saves, and owner exclusion. Existing
CLI feature fixtures now run through IPC with test-only database import/export.
`node integration-tests/automerge-compatibility.mjs` is an optional manual check against a
disposable JavaScript Repo server. It is not an automatic CI job or delivery gate. `npm test` and `npm run test:packaged` in `apps/desktop` test shared CLI/desktop access.
All fixtures use temporary stores and test-owned processes. Windows runtime checks must run
on Windows; successful macOS testing does not establish Windows readiness.
