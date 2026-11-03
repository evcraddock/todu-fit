# Automerge upgrade and compatibility

Task: `task-fb123e46`. Upgrade date: 2026-11-03. The user requested an actual upgrade to the latest stable versions before shared-core extraction; this supersedes the initial review-only recommendation.

## Implemented versions

| Dependency | Previous lock | Upgraded lock |
| --- | --- | --- |
| Rust `automerge`, both Core and CLI | 0.7.2 | **0.12.0** |
| JS `@automerge/automerge` | 3.2.1 | **3.5.0** |
| Repo, React wrapper/hooks and network/storage adapter family | 2.5.1 | **2.5.6** |

These are the newest non-prerelease releases found on the upgrade date, not an LTS/support promise. npm's Repo `latest` tag currently points to **2.6.0-alpha.3**, while `next` and `experimental` contain newer prereleases. Those were deliberately not selected. The stable Rust crate itself depends on `hexane` 1.0.0-alpha.5; that upstream transitive dependency is present in the Cargo lockfile.

Both Rust manifests now require `automerge = "0.12"` and declare Rust **1.90** as the minimum, matching upstream. Deprecated Automerge scalar `to_bool`, `to_i64` and `to_f64` calls were changed to their behavior-equivalent `as_*` replacements. The web declares the engine directly at `^3.5.0` instead of relying only on Repo's broad transitive range. All Repo adapters resolve to the same 2.5.6 instance, sharing the 3.5.0 engine. Both lockfiles are updated without a general dependency refresh.

The development server image in [`compose.yaml`](../compose.yaml) remains the existing moving `:main` tag. This upgrade does not update or restart the deployed sync server, introduce new application features, change schemas, or migrate user data.

## Compatibility safeguards

- Preserve the UUID/base58check document IDs, identity/group references, personal/shared boundaries, heads and change history. Do not recreate documents from their materialized JSON.
- Preserve scalar strings: web `ImmutableString` values correspond to Rust scalar strings, while ordinary JS strings represent collaborative text. Existing application readers/writers and their formats remain unchanged.
- Keep engine binary sync separate from the Repo CBOR/WebSocket envelope. The CLI still advertises Repo protocol `"1"`; this is not the engine's V1/V2 message negotiation.
- Automerge 3's announced file-format continuity is not a guarantee that every malformed old history remains loadable. Rust 0.11+ rejects rich-text mark ends preceding their starts. No automatic `rescue`, history rewrite, or destructive fallback was added. Retain backups and handle any such failure explicitly.

## Verification

Committed regression coverage:

- [Four synthetic binary fixtures](../todu-fit-core/tests/fixtures/README.md), written by the actual pre-upgrade Rust 0.7.2 / JS 3.2.1 engines and the upgraded Rust 0.12.0 / JS 3.5.0 engines. They contain scalar strings, nested ingredients, numeric quantities, tags and Unicode collaborative text.
- [Five Rust compatibility tests](../todu-fit-core/tests/automerge_compatibility.rs): old/new snapshots load, edit and save without losing heads/history; encoded sync messages converge after concurrent edits and sync-state reset.
- [Four JS compatibility tests](../web/src/repo/automergeCompatibility.test.ts): the same old/new snapshots retain field types, values, heads and history through load/save/edit.
- [Isolated CLI↔JS Repo integration check](../integration-tests/automerge-compatibility.mjs): builds a disposable identity and group, syncs dishes/nutrients from the actual CLI through Repo's WebSocket/CBOR adapter, sends JS updates and a nested JS-created dish back to the CLI, then verifies a CLI update after reconnect. It binds a random loopback port, removes only its own temporary data and never controls the managed dev environment. CI runs this check and the web unit tests.

Local checks passed:

```bash
make lint
make test-cli
cargo clippy --all-targets --all-features -- -D warnings
make web-lint
make web-test
make web-build
cargo build --locked -p todu-fit-cli
node integration-tests/automerge-compatibility.mjs
```

Rust: 241 existing unit tests plus five new compatibility tests passed; one existing test remains ignored. Web: 41 tests passed. The frontend and server production builds passed, with warnings about outdated Browserslist data, mixed static/dynamic UUID imports and large chunks; no warning was suppressed.

Additional disposable probes exchanged raw sync messages between the upgraded Rust and JS engines and verified content/heads preservation and convergence after state reset. These are supplemental evidence, not a substitute for the committed Repo-envelope integration check.

No private existing documents, deployed server, iOS app or desktop bridge were tested. The managed environment was unavailable through `make status`, so the manual browser walkthroughs were not run and no dev services were started, stopped or restarted. Tests cover synthetic data and an isolated in-memory Repo, not browser IndexedDB lifecycle, every historical document or production deployment. Back up existing stores before rollout; old-client rollback safety is not guaranteed for arbitrary future features/newly written data.

## Sources checked for target selection and upgrade risks

- [Rust versions and minimum toolchains](https://crates.io/api/v1/crates/automerge), [Rust 0.12.0 changelog](https://github.com/automerge/automerge/blob/rust/automerge-0.12.0/rust/CHANGELOG.md).
- [JS engine latest metadata](https://registry.npmjs.org/@automerge/automerge/latest), [JS 3.5.0 changelog](https://github.com/automerge/automerge/blob/js/automerge-3.5.0/javascript/CHANGELOG.md).
- [Repo release channels](https://registry.npmjs.org/-/package/@automerge%2fautomerge-repo/dist-tags), [Repo 2.5.6 release notes](https://github.com/automerge/automerge-repo/releases/tag/v2.5.6), [stable package manifest](https://registry.npmjs.org/@automerge/automerge-repo/2.5.6).
- [Automerge 3 file-format continuity](https://automerge.org/blog/automerge-3/), [JavaScript string/text migration guide](https://automerge.org/docs/guides/migrating-from-automerge-2-to-automerge-3/).
