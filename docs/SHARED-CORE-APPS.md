# Shared Rust Core and installed applications

## Selected architecture

The selected direction is Electron/React on macOS and Windows, with reusable application
behavior in Rust Core. The CLI and desktop use **one local Rust daemon owning persistence
and network sync**, rather than opening independent Core stores or sharing a writable folder.
The daemon remains usable with no desktop window open. This supersedes the per-client
napi-rs ownership model from the initial Electron proof (`task-b06292ca`). Implementation
belongs to `task-8a47646c`; it is not a release or a real-data migration.

```text
CLI parsing/output ─────────────┐
                               ├── typed local IPC ── Rust daemon ── Rust Core
Electron + React               │                          │               │
  sandboxed preload → main ────┘                          │          domain rules
                                                          │          Automerge sync
                                                durable local store       │
                                                                          ↕
                                                                   hosted sync server
```

The initial implementation hosts the daemon as `fit daemon` so the existing CLI adapters
can be reused without duplicating domain operations. Unix sockets serve macOS/Linux;
Windows has a named-pipe implementation awaiting runtime verification. The service lifecycle
is explicit foreground startup, independent of Electron. No installer/service registration
or user-daemon restart is part of this work.

See [DAEMON.md](DAEMON.md) for protocol, durability, failure/retry semantics, configuration,
validation, compatibility changes, and the safe adoption plan.

## Responsibilities

| Component | Owns |
| --- | --- |
| `todu-fit-core` | Models, validation, nutrition, dishes, meal plans/logs, shopping, hydration, identity/group operations and Automerge sync coordination |
| Rust daemon | Exclusive local ownership, transactional persistence, request replay, local transport, bounded connections and independent sync scheduling |
| CLI adapter | Argument parsing, validation, output formatting, client errors and configuration commands |
| Electron main/preload | Validated renderer IPC, daemon connection, platform/window lifecycle |
| React | Presentation and transient view state; refreshes on committed revision changes |
| Hosted sync service | Cross-device synchronization, not the only durable copy |

Core has no Electron, Node binding or UI dependency. Repositories execute in disposable
transaction workspaces under the daemon; document bytes and successful mutation receipts
commit atomically in SQLite before success reaches either client. A network failure cannot
invalidate a successful local save. A network exchange does not hold the local-operation lock.

## Existing reusable work

Core already shares dish CRUD/ingredients, meal-plan/log operations, referenced-dish hydration
and nutrients, shopping aggregation/cart updates, water/settings calculations, identity/group
handling, and `SyncCoordinator`. The daemon calls these implementations. Existing React
screens can be adapted incrementally; the current desktop slice remains list/create dishes.
Remaining desktop screens are separate work.

The old napi-rs adapter and dedicated worker remain available as historical isolated proof
code. They are not used by normal desktop startup. Their previous packaged macOS arm64
success establishes only that earlier proof; current daemon evidence is recorded separately.
The proof user's existing documents are preserved and are not adopted automatically.

## Identity, sync and adoption

There is no web login requirement. Supply the existing sync server address in daemon
configuration and explicitly join the desired root document ID. Core follows its group and
feature-document references. A fresh identity requires an explicit `init --new`; missing or
unavailable remote data never triggers replacement identity creation.

Local saving and network synchronization are separate states. The hosted sync service remains
needed even if the website is eventually retired. Existing unsynced browser edits must be
reconciled before browser retirement. Preserve root/group/document IDs and personal/shared
boundaries throughout any future adoption. Real-data import, deployment and old-client
cutover require a separately approved, verified migration.

## Later work and boundaries

Swift/SwiftUI and a separate Rust adapter remain the intended iOS direction; iOS lifecycle,
background sync and binding selection are outside this daemon task. Android is outside scope.
Agent integrations, Pi extensions and remote daemon access are deferred. No public HTTP or
remote-control interface is introduced.

Signing, updates, supported OS/CPU matrices, service installation, remaining feature screens,
large-store optimizations and persistent desktop retry intents remain separate decisions.
The current change must be validated and reviewed before any release or adoption of user data.
