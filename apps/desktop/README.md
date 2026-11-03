# Desktop shared-daemon client

React → sandboxed preload → Electron main → local IPC → Rust daemon → Core.
The desktop and CLI share one durable owner; closing the desktop does not stop it.
See [the architecture](../../docs/SHARED-CORE-APPS.md) and [daemon guide](../../docs/DAEMON.md).

## Build and validate

Requires Rust stable, Node 24 and the platform toolchain. Run:

```sh
npm ci
npm run package
npm test
npm run test:packaged
```

Packaging builds the CLI/daemon for the host architecture, type-checks/bundles React,
and puts `fit` (`fit.exe` on Windows) outside ASAR in `resources/daemon/`.
No native Node addon is loaded by the app. Packages remain unsigned application directories.

For manual use, explicitly start the bundled daemon or a compatible locally built `fit daemon`
with a separate config selecting a new empty private data directory. Set `FIT_DAEMON_ENDPOINT`
to the contents of that directory's `daemon.endpoint`, then launch the app. Initialization
is explicit through `fit init --new` or `fit init --join <ID>`; there is no automatic identity.
Do not connect real user data while validating this work.

`npm test` starts only its own temporary daemon and checks bidirectional CLI/desktop visibility
and CLI operation after desktop disconnect. `npm run test:packaged` launches the actual
packaged Electron executable against a temporary daemon, creates through React, verifies CLI
visibility, creates another dish with Electron closed, then reopens and verifies both dishes.
Screenshots/evidence are written to `test-results/`. The fixtures clean up their own processes
and data; they never control managed dev services or the existing preview app.

Default packaged paths are `out/mac-arm64/Todu Fit Proof.app` (Apple Silicon), `out/mac/`
(Intel), and `out/win-unpacked/Todu Fit Proof.exe`. `TODU_PACKAGED_EXECUTABLE` can select
another test executable. `TODU_FIT_PROOF_DATA` overrides Electron userData only; it no longer
selects a Core document store. Old `core-proof/` data, including saved proof dishes, is untouched.

The narrow preload exposes `listDishes`, `createDish`, and `status`. Main checks sender/frame/
URL and input shape. The renderer has no Node/filesystem/native access. Revision polling
refreshes externally changed dishes, while save failures and sync state remain visible.
An uncertain save can be retried with its same request ID during the current client session.

The old native addon and worker remain as historical proof code. To test those separately,
use `npm run build:native` and `npm run test:native-proof`. They must not be pointed at a daemon
store or any existing user data. Their prior success does not establish daemon durability.

Windows named-pipe/packaging CI is configured but remains unverified until actually run.
The remaining feature screens, signing/distribution, service installation and data migration
are separate work. No existing installed CLI or running preview is replaced by these commands.
