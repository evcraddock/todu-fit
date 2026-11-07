# Desktop application

React → sandboxed preload → Electron main → local IPC → Rust daemon → Core. The desktop and CLI share one durable owner; closing the desktop does not stop the daemon. See [architecture](../../docs/SHARED-CORE-APPS.md) and [daemon API](../../docs/DAEMON-API.md).

## Screens

- Dishes: name/tag filtering, detail, Markdown instructions, creation/editing, ingredients, nutrients, times, servings, tags, source URL, and confirmed deletion.
- Meal plans: weekly/day views, nutrition totals, dish selection, date/type/title/cook editing, leftovers and confirmed deletion.
- Food log: weekly history, planned or unplanned meals, notes-only entries, per-dish portions, snapshot-preserving edits, daily nutrients and confirmed deletion.
- Shopping: weekly ingredients from Core, manual items with descriptive quantities, editing/removal, checked-state filtering and clearing.
- Water: today's total and goal, quick-add/custom amounts, timezone-aware history, streak/average, and confirmed entry deletion.
- Settings: current identity and daemon configuration, sync, group creation/join/selection/leave, and water goal/unit/timezone/presets.

Forms wait for committed daemon responses, retain inputs on failure, and display errors. Active views refresh after saves and daemon revision changes. Form-level request IDs allow retrying the same uncertain mutation while the editor remains mounted; changing the payload or opening a different editor creates a separate logical request. This is not a durable client-side outbox: after closing an editor/app on an uncertain response, inspect the saved state before recreating the action. Group changes discard editor state rather than reuse it for another group.

The presentation adapts the web forms and dish selector and reuses its Markdown renderer. It does not load the browser Automerge repo, IndexedDB, web login, passkeys, invitations, or hosted calendar subscriptions. Nutrition summaries preserve units and keep unlike units separate. Rust owns persisted data, shopping derivation, hydration calculations, and log snapshots.

## Build and validate

Requires Rust stable, Node 24 and the platform toolchain. From this directory:

```sh
npm ci
npm run package
npm test
npm run test:packaged
```

CI builds the installers, runs the daemon/API tests, and exercises the packaged UI from each extracted or installed app.

Packaging builds the CLI/daemon for the host architecture, checks/bundles React, and puts `fit` (`fit.exe` on Windows) outside ASAR in `resources/daemon/`. No native Node addon is loaded by the app. Use `npm run package:installer` to build an installable artifact in `out/`. Build on the target OS and architecture so the bundled daemon matches the app.

| Platform | Artifact | How to install |
| --- | --- | --- |
| Linux | AppImage | Mark it executable with `chmod +x`, then launch it. If FUSE is unavailable, launch with `--appimage-extract-and-run`. |
| Windows | NSIS setup executable | Run the setup executable and launch Fit from the Start menu. |
| macOS | DMG | Open the disk image and drag the app to Applications. |

The **Desktop build checks** GitHub Actions workflow builds the host-architecture installers and uploads them as run artifacts. These are unsigned preview builds. macOS Gatekeeper and Windows SmartScreen may block or warn on launch. The first launch starts the bundled daemon and offers **Use existing data** to download a synced identity into the daemon store.

If your Fit configuration points at a legacy CLI store, launch the preview with `FIT_DATA_DIR` set to a separate, empty directory. The daemon refuses to open a nonempty legacy store. Keep using the same override on later launches to reopen the downloaded copy. In setup, enter your existing root document ID and sync server address.

On Windows, close Fit and end the bundled `fit.exe` process before upgrading, reinstalling, or uninstalling. In Task Manager, check that the process's executable is under `resources\daemon` in the Fit installation folder. The daemon stays running when the window closes, and Windows can lock its executable while it runs.

On launch, Electron reads the effective configuration using its bundled `fit config show --format json`, connects to a compatible owner, or starts the bundled daemon detached. The daemon's exclusive store lock arbitrates simultaneous launches. Startup has a bounded readiness wait and records failures in `daemon-startup.log` under Electron userData. Closing the desktop leaves the daemon running. `FIT_CONFIG=/absolute/path/config.yaml` selects a development configuration; configuration-relative storage paths are resolved before launch. `FIT_DAEMON_ENDPOINT` remains a connect-only override for existing owners and tests. CLI commands retain their existing explicit-daemon behavior.

An unconfigured daemon presents first-run setup. Start fresh creates an identity, group, and all empty feature documents atomically. Connecting to existing data requires a server address and root document ID; the daemon stages the root and all referenced documents, reports discovery/download progress, and commits only when the complete initial download succeeds. Failed joins retain the previous state and allow retry; they never create a replacement identity. Closing the window during setup leaves the daemon working, and reopening shows its progress. If the daemon itself stops before completion, uncommitted work is discarded and setup can be retried. Setup's chosen server is persisted with the documents; a blank server for fresh setup means local-only use. Setup never replaces an initialized identity.

Use a separate private development/test store when validating this work. No automatic adoption or migration of existing legacy storage is implemented. Start-at-login registration and signed public distribution remain separate work.

`npm test` also checks simultaneous automatic launches, setup retries, failed joins, bounded startup failures, and reconnect persistence. Set `FIT_SETUP_TEST_SYNC_URL` to an isolated sync server to include full existing-root download and fresh empty-store interoperability checks. `npm run test:packaged` also launches the built app without an existing daemon and completes setup through the actual UI.

`npm test` uses temporary daemons for cross-client visibility, protocol compatibility and replay-safe application requests. `npm run test:packaged` exercises real Electron screens for dishes/ingredients/nutrients, plans, portioned food logs, shopping, water/settings, route switching, renderer isolation and quit/reopen persistence. It verifies CLI visibility and changes while Electron is closed. Fixtures clean up only their own processes and data and never control managed dev services or the existing preview. Evidence is written to `test-results/`.

Default packaged paths are `out/mac-arm64/Todu Fit Proof.app` (Apple Silicon), `out/mac/` (Intel), and `out/win-unpacked/Todu Fit Proof.exe`. `TODU_PACKAGED_EXECUTABLE` can select another executable. `TODU_FIT_PROOF_DATA` overrides Electron userData only; it does not select a Core document store. Old `core-proof/` data is untouched.

The preload exposes only `request(operation, requestId?)`. Main validates sender/frame/URL, allowlisted application operation types, request size and IDs. The daemon strictly validates the full operation schema. No renderer filesystem access, arbitrary IPC, raw CLI execution, identity replacement or configuration-path operations are exposed. Errors, sync state and revision polling remain visible.

The old native addon/worker and v1 dish bridge remain historical proof code, with their separate tests.
