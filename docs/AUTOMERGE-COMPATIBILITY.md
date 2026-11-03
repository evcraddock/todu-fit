# Automerge dependency and compatibility review

Task: `task-fb123e46`. Reviewed 2026-11-03 against `main` at `a564d07a5fdb5233acf4d28efe297e07d5817c4c`.

## Decision

**Proceed with the shared-core extraction on the existing locked dependencies. An Automerge upgrade is not a prerequisite for the dish extraction.** Keep dependency upgrades and any data recovery separate from moving application code. The current Rust/JavaScript pair passed the limited interoperability probes below; no evidence found in this review requires a document migration merely because versions are behind upstream.

A separate maintenance update is warranted: consider Rust **0.7.4** and the web Repo **2.5.6** family first, with a deliberate JavaScript engine update and compatibility tests. Prefer completing that maintenance before the later sync-coordination extraction so reconnect changes and refactoring can be verified independently. This is a sequencing recommendation, not authorization to update dependencies in the extraction tasks. Do not make the larger Rust **0.12.0** API upgrade or Repo prereleases a gate for the initial core work.

This review changes no application code, dependency manifests, lockfiles, document formats, identities or services. It does not establish that upgraded versions work with all existing data.

## Installed and locked baseline

| Component | Declared requirement | Locked / locally resolved version | Upstream comparison on review date |
| --- | --- | --- | --- |
| Rust engine, both Core and CLI | `automerge = "0.7"` | **0.7.2**, one shared Cargo resolution | **0.7.4** is the newest published non-yanked 0.7 patch; **0.12.0** is the newest published stable crate [1]. |
| JavaScript engine | Transitive through Repo/hooks, `2.2.8 - 3` | `@automerge/automerge` **3.2.1** | npm `latest`: **3.5.0** [2]. This is a different release numbering scheme from the Rust crate, not evidence of incompatible document generations. |
| Repo, WebSocket/BroadcastChannel/IndexedDB adapters, React hooks and `@automerge/react` | Direct packages use `^2.5.1` | **2.5.1** throughout; transitive MessageChannel adapter is also **2.5.1** | Newest non-prerelease version found: **2.5.6**. npm `latest` is **2.6.0-alpha.3**, `next` is **2.6.0-alpha.5**, and `experimental` is **3.0.0-experimental.2** [3]. Do not equate the `latest` tag or GitHub's release flag with a non-prerelease version. |
| Development sync server | `ghcr.io/automerge/automerge-repo-sync-server:main` | Moving image tag, not a package lock | Its exact image digest/runtime versions and the deployed server were not audited. Do not infer them from the web lockfile. |

Evidence: [`Cargo.lock`](../Cargo.lock), both [Core](../todu-fit-core/Cargo.toml) and [CLI](../todu-fit-cli/Cargo.toml) manifests, [`web/package.json`](../web/package.json), [`web/package-lock.json`](../web/package-lock.json), [`compose.yaml`](../compose.yaml), `cargo tree --locked -i automerge`, and installed package manifests under `web/node_modules`. All listed local JavaScript installations match the lockfile.

`"0.7"` permits 0.7 patch updates, not 0.8–0.12. Both Rust manifests must remain aligned because Core and CLI exchange Automerge types directly. The Repo 2.5.6 adapters depend on the matching Repo version; update the family together rather than introducing competing Repo instances. Its engine range remains `2.2.8 - 3`, allowing a separately selected 3.x engine [4]. Ordinary semver ranges exclude prereleases; explicitly installing `@latest` can nevertheless select the alpha currently assigned that tag.

“Newest published” is not an upstream LTS/support guarantee. The cited release metadata does not establish a formal maintenance window for the older lines.

## Compatibility has several separate boundaries

### Binary documents and application schemas

Automerge's 3.0 announcement explicitly says it uses the same file format as Automerge 2 [5]. The website is already using the 3.x engine, and Rust 0.7 already contains the columnar-runtime rewrite [6]. Neither client needs a major-generation migration simply to begin sharing Rust application operations.

That historical file-format guarantee is not blanket certification of every future writer/older reader combination. For an actual upgrade, verify old snapshots, change histories and new writes against both the previous and candidate clients. Preserve document IDs, heads/history, references, and personal-versus-group boundaries; do not rebuild documents from materialized JSON as a substitute for compatibility testing.

The application adds its own schema conventions:

- [`MultiDocStorage`](../todu-fit-core/src/automerge/multi_storage.rs) stores raw snapshots as `<bs58check-id>.automerge`, with a separate `root_doc_id`. [`DocumentId`](../todu-fit-core/src/document_id.rs) uses the Repo-compatible UUID/base58check representation.
- [`Identity`](../todu-fit-core/src/identity.rs) supports identity/group data encoded as JSON in a scalar `data` field and structured Automerge data. [`RepoContext.tsx`](../web/src/repo/RepoContext.tsx) likewise accepts CLI JSON-string and web object representations. Preserve both and existing document references during extraction.
- [Core writers](../todu-fit-core/src/automerge/writer.rs) write entities under UUID keys with nested maps/lists and scalar strings/numbers. Browser IndexedDB storage is not the CLI's filesystem layout; compatible documents do not mean the two storage directories are interchangeable.

### Scalar strings versus collaborative text

JavaScript Automerge 3 represents ordinary strings as collaborative text; `ImmutableString` represents a scalar string. The old JavaScript `Text` class was removed, but Rust's `ObjType::Text` still exists [7]. These are API/type distinctions, not a reason to rewrite all stored strings.

The web [dish](../web/src/dishes/useDishes.ts), [meal-plan](../web/src/meals/useMealPlans.ts), [food-log](../web/src/meals/useMealLogs.ts), and [shopping](../web/src/meals/useShoppingCart.ts) hooks intentionally wrap scalar strings with `ImmutableString` for the Rust readers. The [CLI reader](../todu-fit-cli/src/sync/reader.rs) reads ordinary entity strings as scalars; ingredient quantities additionally accept numbers, scalar strings and text objects. Identity parsing has its own compatibility handling. Preserve these distinctions rather than normalizing every field to plain JavaScript strings or claiming every reader accepts both forms.

### Engine sync versus Repo networking

The [Rust sync client](../todu-fit-core/src/sync/client.rs) implements Repo's CBOR/WebSocket envelope itself, using [protocol messages](../todu-fit-core/src/sync/protocol.rs) such as `join`, `peer`, `request` and `sync`. It advertises Repo protocol version `"1"`. Inside the envelope, Automerge's binary sync messages and per-peer sync state are a separate protocol; the locked Rust engine supports engine message versions V1 and V2. **Repo protocol `"1"` does not mean the engine is limited to V1 sync.**

The web uses `BrowserWebSocketClientAdapter` with Repo and IndexedDB. Successful binary document loading or raw engine-message exchange alone does not prove WebSocket negotiation, server persistence, reconnect behavior, authentication or browser UI convergence. Those need separate end-to-end checks when upgrading or extracting sync coordination.

## Relevant newer releases and upgrade risks

| Candidate | Relevant changes | Consequence for todu-fit |
| --- | --- | --- |
| Rust 0.7.3 / 0.7.4 | 0.7.3 fixes fallback to slower V1 sync after peer sync-state loss; 0.7.4 fixes malformed rich-text patches [6]. | A small maintenance step is justified, especially because CLI connections create fresh sync state. The release note describes a performance problem, not proof that current application data is corrupt. Both patches retain the locked crate's Rust 1.89 minimum [1]. |
| JS 3.2.2 through 3.5.0 | 3.2.2 has the corresponding sync-state-loss fix. 3.5.0 includes large-list patch handling, list insertion/reconstruction and rich-text fixes, author metadata, and stricter `__proto__` assignment validation [8]. | Review an explicit 3.x target separately. Test nested ingredients/nutrients, large histories, Unicode text and imported objects. Do not infer that an upstream bug affects this app without a reproducer, or that new author metadata must replace existing `created_by` fields. |
| Repo family 2.5.6 | Fixes reconnect peer-ID handling, async throttling races and persistence of `repo.create({})`; also fixes import cycles introduced in 2.5.2 [9]. | Worth a coordinated stable-family update: the web initializes empty documents with `createDoc(repo, {})`. Avoid stopping at an intermediate version with known import cycles. These fixes do not require changing the application schema. |
| Repo 2.6 alpha / 3.0 experimental | Prerelease channels contain broader lifecycle/API work. The published `2.6.0-alpha.3` manifest requires Node `>=22.13` [10]. | Do not select accidentally. This repo's web CI uses Node 20, so adopting that alpha also requires a deliberate runtime/CI decision. No prerelease was installed or validated. |
| Rust 0.8–0.12 | Changes include `Transactable::splice` input types, sync-message capability/flag fields, fallible patch-log transaction methods, `Change::message`, new author/error fields and deprecated `Value::to_*` accessors. Rust 0.11 raises the minimum to 1.90 [6]. | This is an API/toolchain upgrade, not a patch bump. Existing readers use `to_i64`, `to_f64` and `to_bool`; their deprecation matters under warnings-as-errors checks. Keep the upgrade out of the extraction diff and test old/new clients before rollout. |

A specific data caveat in Rust 0.11 is stricter validation: documents containing rich-text mark ends before their starts are rejected; `Automerge::rescue` can recover current values [6]. Thus “same file format” does not mean every previously accepted malformed history will still load. If encountered, stop, retain backups and design explicit recovery; never silently rescue/rewrite user documents. No such malformed user data was inspected or identified here.

## Verification performed and limits

The current locked Rust 0.7.2 and JS 3.2.1 engines were exercised with disposable fixtures outside the repository, without installing candidate versions or touching user stores:

1. Create a dish with the actual Core `write_dish` function, scalar strings, nested ingredients, a floating-point quantity and tags; add a collaborative text field containing Unicode. Save in Rust, load in JavaScript, and compare heads and field types/values: **passed**.
2. Edit a tag and quantity in JavaScript, save, load/save in Rust, then reload in JavaScript. Compare heads and materialized content: **passed**.
3. Make independent Rust/JS edits, exchange raw `generate_sync_message` / `generateSyncMessage` and receive-message bytes, and assert equal heads/content after quiescence: **passed**, three loop rounds.
4. Reset both per-peer sync states and repeat exchange: **passed**, two loop rounds. This is not a benchmark and does not disprove the documented large-history performance bug.

The temporary Rust probe was compiled with `rustc` against the exact artifacts from `cargo build -p todu-fit-core --locked --message-format=json`; a Node probe loaded the installed engine through `web/package.json` module resolution. Commands and probe sources are retained for this local review at `/tmp/todu-fit-automerge-review.bUg0Q5/` (`probe.rs`, `probe.cjs`; rerun with `node /tmp/todu-fit-automerge-review.bUg0Q5/probe.cjs` from the repository). These are temporary research artifacts, not a committed regression suite or a portable test command.

`make lint`, `make test-cli` and `make web-lint` passed; the Rust suite reported 241 passing unit tests and one ignored test. The commit hook also passed formatting, build, clippy and tests. Whitespace checks and all 27 local Markdown links across this review and the shared-core proposal passed. These existing unit tests do not substitute for cross-client integration tests. `make status` could not connect to the Overmind socket; the managed environment was not available through that check. The manual browser/server walkthroughs were **not run**, and no services were started, stopped or restarted. No private existing documents, upgraded engines, browser IndexedDB restart cycle, deployed server, iOS client or desktop bridge were tested.

## Gates for a separate maintenance update

1. Record exact old/candidate engine, Repo/adapter and server image versions; back up stores and retain original snapshots without changing IDs. Recheck registries at implementation time instead of copying today's moving tags.
2. Keep Rust manifests aligned and the Repo adapter family coherent. Inspect the lockfile diff and toolchain/Node requirements; avoid unintended alpha versions and unrelated package updates.
3. Run `make lint`, `make test-cli`, `make web-lint` and `make web-build`. Add durable old/new-client fixtures, including scalar/`ImmutableString` distinctions, identity/group references, text, quantities, concurrent edits and long histories. Exercise candidate-written data with old clients before claiming rollback safety.
4. With the user-managed environment running and CLI/web sharing a disposable identity, run [dish](../integration-tests/DISH-SYNC.md), [meal-plan](../integration-tests/MEALPLAN-SYNC.md), [food-log](../integration-tests/MEALLOG-SYNC.md) and [shopping](../integration-tests/SHOPPING-SYNC.md) walkthroughs. Add hydration coverage for settings/entries and personal-data isolation, plus browser offline/reopen and reconnect/sync-state-loss tests.
5. Verify the Repo WebSocket envelope against the actual server, not only raw engine messages. Treat any schema change, strict-load failure or recovery need as separate work with explicit approval.

Once this review is accepted, the next extraction is `task-0103a3ef` (shared dish operations). `task-db55972a` and `task-ed608731` follow that pattern; `task-bc6a3c30` (sync coordination) follows all feature extractions. An upgrade remains a separate deliverable.

## Sources

Official sources consulted 2026-11-03. Registry endpoints and branch-independent version URLs distinguish observed publication state from compatibility guarantees.

1. [crates.io Automerge versions, yanked status and Rust minimums](https://crates.io/api/v1/crates/automerge).
2. [npm JavaScript Automerge latest metadata](https://registry.npmjs.org/@automerge/automerge/latest).
3. [npm Repo dist-tags](https://registry.npmjs.org/-/package/@automerge%2fautomerge-repo/dist-tags) and [Repo releases](https://github.com/automerge/automerge-repo/releases).
4. [Repo 2.5.6 manifest](https://registry.npmjs.org/@automerge/automerge-repo/2.5.6), [WebSocket adapter 2.5.6](https://registry.npmjs.org/@automerge/automerge-repo-network-websocket/2.5.6), [IndexedDB adapter 2.5.6](https://registry.npmjs.org/@automerge/automerge-repo-storage-indexeddb/2.5.6), and [React wrapper 2.5.6](https://registry.npmjs.org/@automerge/react/2.5.6).
5. [Automerge 3.0 announcement: unchanged Automerge 2 file format](https://automerge.org/blog/automerge-3/).
6. [Rust changelog pinned to 0.12.0, including intervening releases](https://github.com/automerge/automerge/blob/rust/automerge-0.12.0/rust/CHANGELOG.md) and [0.7.4 changelog](https://github.com/automerge/automerge/blob/rust/automerge%400.7.4/rust/CHANGELOG.md).
7. [JavaScript Automerge 2→3 migration guide](https://automerge.org/docs/guides/migrating-from-automerge-2-to-automerge-3/).
8. [JS 3.2.2 release notes](https://github.com/automerge/automerge/releases/tag/js/automerge-3.2.2) and [JS 3.5.0 changelog](https://github.com/automerge/automerge/blob/js/automerge-3.5.0/javascript/CHANGELOG.md).
9. [Repo 2.5.6 release notes](https://github.com/automerge/automerge-repo/releases/tag/v2.5.6).
10. [Published Repo 2.6.0-alpha.3 manifest](https://registry.npmjs.org/@automerge/automerge-repo/2.6.0-alpha.3).
