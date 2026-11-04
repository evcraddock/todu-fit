# Daemon application API

Protocol version 2 exposes structured application operations independently of the CLI's
parser, terminal output, and Core types. The existing version 1 CLI and desktop dish bridge
remain supported by the same owner. The CLI still uses that compatibility bridge and still
links Core; this change supplies its future replacement API, not a completed client migration.
The executable remains `fit daemon`. Automatic client startup is separate work.

## Package boundaries

- `todu-fit-protocol` owns request, response, input, and result DTOs. It depends on serde,
  chrono, and uuid, without a dependency on Core, CLI, storage, or transport.
- `todu-fit-service` adapts those DTOs to Core repositories and owns snapshot staging,
  SQLite transactions, retry receipts, and recovery helpers. Domain rules remain in Core.
- The daemon host owns exclusive process ownership, IPC, configuration, and sync scheduling.
  Both Unix sockets and Windows named pipes dispatch through the same version router.

An embedded host can use `transact` with its own `Store`, private staging root, `Context`,
and exclusive owner lock. It must clean abandoned workspaces after acquiring ownership.
`execute` alone is a staging dispatcher, not a durable save boundary. No iOS bindings or
mobile lifecycle integration are implemented here.

## Wire contract

Use one newline-terminated UTF-8 JSON request and response per connection:

```json
{"version":2,"id":"0fda275e-0687-4581-92fd-7af6c2f7c267","operation":{"type":"dish_create","name":"Apple","fields":{"add_tags":["snack"]}}}
```

Responses contain `version`, the request `id`, a durable `revision`, and `outcome`.
A successful outcome is `{"status":"ok","value":{"type":"dish","data":{...}}}`.
An error outcome is `{"status":"error","error":{"code":"not_found",
"message":"Dish not found: Apple","retryable":false}}`.
The authoritative field definitions are in `todu-fit-protocol/src/lib.rs` and `models.rs`.
Unknown request/operation/update fields are rejected. CLI enums and terminal format options
are not part of this protocol. Unknown versions receive `unsupported_version`; malformed
v2 requests receive `invalid_input`. Invalid/missing request IDs use the nil UUID in errors.
Frames that cannot be parsed as JSON have no identifiable version and use the transport's
legacy error envelope. Existing version 1 envelopes retain their existing shape.

Typed codes are `invalid_input`, `unsupported_version`, `not_initialized`, `pending_sync`,
`not_found`, `conflict`, `storage`, `unavailable`, and `internal`; `ambiguous` is reserved.
Messages are for display, not machine branching. Storage and availability errors are marked
retryable. Clients can retry pending synchronization after observing sync completion.

## CLI inventory and application mapping

This table includes the current CLI's application functionality. Terminal formatting,
confirmation prompts, relative-date shortcuts, and local configuration file creation remain
client adapter responsibilities. Dates on the wire are explicit ISO dates, timestamps are
UTC RFC3339, IDs are UUIDs except Automerge document IDs (base58check).

| CLI capability | Version 2 operations and results |
| --- | --- |
| `init` status, `init --new`, `init --join`, explicit `--force` replacement | `identity_get`, `identity_create`, `identity_join`; identity state, root ID and groups. Replacement requires `replace: true`. |
| `device show` | `identity_get`; root ID and initialization/pending-sync state. |
| `group list/show/create/join/switch/leave` | `groups_list`, `group_get`, `group_create`, `group_join`, `group_select`, `group_leave`; group names, selected group, document IDs when available. |
| `config show` | `config_get`; daemon's effective creator, sync URL, auto-sync and default timezone. |
| `config init` | Local client file generation; intentionally no daemon operation accepting arbitrary file paths. |
| `dish create/update` | `dish_create`, `dish_update`; name, instructions, times, servings, image/source URL, nutrients, tag additions/removals. Returns the saved dish. |
| `dish list/search/show/delete` | `dishes_list` with optional tag/query, `dish_get`, `dish_delete`; full typed dishes. Names or UUIDs use Core resolution. |
| `dish add-ingredient/remove-ingredient` | `dish_add_ingredient`, `dish_remove_ingredient`; structured ingredient fields and updated dish. Missing ingredient removal returns `not_found`. |
| `mealplan create/list/show/update/delete` | `plan_create`, `plans_list`, `plan_get`, `plan_update`, `plan_delete`; dates/types, title, cook, dish references, leftovers. Detail includes resolved dishes. |
| `mealplan add-dish/remove-dish` | `plan_add_dish`, `plan_remove_dish`; Core membership validation and updated plan detail. |
| `meal log` planned or unplanned | `meal_log_plan`, `meal_log_unplanned`; notes, date/type, dish resolution, snapshots and portions preserved by Core. |
| `meal history/delete` | `meals_history`, `meal_delete`; typed logs and Core-calculated per-meal nutrients. Clients may sum these by date for the CLI's daily-total presentation. |
| `shopping list/add/remove/check/uncheck/clear-checked` | `shopping_list`, `shopping_add`, `shopping_remove`, `shopping_set_checked`, `shopping_clear_checked`; derived items/cart or changed/count result. |
| `water add/today/recent/history/delete` | `water_add`, `water_today`, `water_recent`, `water_history`, `water_delete`; entries, configured timezone day totals/progress, streak, seven-day average. |
| `water settings/set` | `water_settings_get`, `water_settings_update`; goal, input/display unit, timezone, presets. |
| `sync`, `sync status` | `sync_start`, `status`; structured idle/running/failed state. |
| Client change detection | `changes` with `after` revision; durable revision and changed flag, plus independent sync state. |
| `daemon`, help/version/completions | Host/client lifecycle and presentation, not application mutations. |

`plan_get` accepts a UUID or date. A date returns all matches; adding a meal type preserves
Core's existing first-match selection. The result always uses `plan_matches`, even for a UUID.
Plans retain Core-generated default titles and leftover handling. Shopping dates normalize
to Sunday, derived ingredients exclude leftover plans, and manual quantities remain strings.
A mutation's `changed`/`count` result lets adapters preserve existing no-op/error messages.
Optional update fields retain Core's existing update semantics; null means omitted, not a new
field-clearing convention. Empty nutrients retain Core's canonical representation.

Hydration uses Core unit conversion and settings validation. `water_add` without `at` uses
host UTC now; `water_today` uses the saved hydration timezone. Recent entries are bounded to
10,000 and history to 3,661 inclusive days. Dates whose week or seven-day average would exceed
chrono's representable range return `invalid_input`. Amounts, goals, presets, and ingredient
quantities must be positive and finite. Transport frames/results are bounded to 8 MiB.

## Durability, retries, and changes

`transact` stages an existing snapshot, calls Core, and commits documents, revision, and the
successful mutation response in one SQLite transaction. Failures discard staging. Responses
are size-checked before commit. Every successful v2 mutation records a receipt, including a
no-op: retrying a previously absent-item removal cannot remove an item added later. Retain
the same UUID and operation on uncertain transport failure. Reusing an ID with a different
operation returns `conflict`. Stored responses include their original revision.

Version 2 receipt keys are namespaced from version 1. Do not retry a logical mutation through
a different protocol version. Receipts survive identity replacement and are not pruned.
Read operations have no receipts, although Core's lazy default-document creation can cause a
read to commit state. Revision increments also include successful no-op mutation receipts;
it is a coarse invalidation token, not a count of domain edits.

`changes` is polling, not a push stream or per-entity event log. When `changed` is true, refetch
relevant application data. Sync-state transitions can occur without a revision change, so
inspect the returned sync state on every poll. `sync_start` schedules/coalesces independent
network work; its acknowledgement is not remote durability. A locally committed save does
not wait for sync. See [daemon ownership and durability](DAEMON.md) for transport limits,
concurrent sync merging, process recovery, and adoption restrictions.

## Existing documents and verification

No new Automerge document type, ID scheme, field layout, or migration is introduced.
The SQLite transaction container remains unchanged. API DTO conversion is separate from
Core's existing Automerge serialization. Ordinary requested edits update existing documents.
There is no production importer, store adoption, or identity replacement during validation.

`cargo test` includes protocol strictness, all application operation families, historical
Rust/JavaScript document fixtures, replay including no-ops, SQL failure rollback, process-death
recovery, and existing CLI behavior through IPC. Compatibility tests verify byte-identical
reads and preserved IDs, history, and field encodings after scoped edits. `npm test` in
`apps/desktop` exercises both protocol versions against isolated test-owned processes on
Unix sockets or Windows pipes; use `FIT_TEST_BINARY` to select a freshly built debug binary.
Windows runtime results require the Windows CI runner. The optional manual JavaScript sync
server compatibility script remains outside automatic CI and release gates.
