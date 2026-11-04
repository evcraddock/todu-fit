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

Packaging builds the CLI/daemon for the host architecture, checks/bundles React, and puts `fit` (`fit.exe` on Windows) outside ASAR in `resources/daemon/`. No native Node addon is loaded by the app. Packages remain unsigned application directories.

For manual use, explicitly start the bundled daemon or a compatible locally built `fit daemon` with a separate config selecting a new empty private data directory. Set `FIT_DAEMON_ENDPOINT` to the contents of that directory's `daemon.endpoint`, then launch the app. Initialization is explicit through `fit init --new` or `fit init --join <ID>`. Do not connect real user data while validating this work. Automatic daemon startup, installer/distribution, and adoption/migration of existing data are separate tasks.

`npm test` uses temporary daemons for cross-client visibility, protocol compatibility and replay-safe application requests. `npm run test:packaged` exercises real Electron screens for dishes/ingredients/nutrients, plans, portioned food logs, shopping, water/settings, route switching, renderer isolation and quit/reopen persistence. It verifies CLI visibility and changes while Electron is closed. Fixtures clean up only their own processes and data and never control managed dev services or the existing preview. Evidence is written to `test-results/`.

Default packaged paths are `out/mac-arm64/Todu Fit Proof.app` (Apple Silicon), `out/mac/` (Intel), and `out/win-unpacked/Todu Fit Proof.exe`. `TODU_PACKAGED_EXECUTABLE` can select another executable. `TODU_FIT_PROOF_DATA` overrides Electron userData only; it does not select a Core document store. Old `core-proof/` data is untouched.

The preload exposes only `request(operation, requestId?)`. Main validates sender/frame/URL, allowlisted application operation types, request size and IDs. The daemon strictly validates the full operation schema. No renderer filesystem access, arbitrary IPC, raw CLI execution, identity replacement or configuration-path operations are exposed. Errors, sync state and revision polling remain visible.

The old native addon/worker and v1 dish bridge remain historical proof code, with their separate tests. Their prior success does not establish current application behavior. Windows named-pipe/packaging CI remains a target; local macOS results do not prove Windows or Intel macOS compatibility.
