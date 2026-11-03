# Desktop native dish proof

Minimal React → sandboxed preload → Electron main → Node worker → napi-rs → Rust Core application. This is a local proof, not a released replacement for the web app.

## Build and run the proof

Requires Rust stable, Node 24, npm, and the platform's native linker/toolchain. On Windows use the MSVC Rust target and Visual Studio C++ build tools (provided on GitHub's hosted Windows runner).

From this directory:

```sh
npm ci
npm run package
npm test
npm run test:packaged
```

Packaging builds a release native addon for the host architecture, type-checks and bundles React, then produces an unsigned application directory. The addon is copied outside ASAR to `resources/native/core.node`; the worker loads that absolute packaged path. No system Rust installation is needed to run the resulting app.

On Apple Silicon the app is at `out/mac-arm64/Todu Fit Proof.app`; on Intel macOS it is under `out/mac/`; Windows uses `out/win-unpacked/Todu Fit Proof.exe`. A different executable can be tested with the absolute `TODU_PACKAGED_EXECUTABLE` environment variable. Cross-compiling is not supported by the build script: build on the target OS/architecture.

The packaged test launches the real executable twice with one new temporary user-data folder. It creates a dish using the React form, checks its persisted ID after quitting/reopening, checks renderer privileges and invalid IPC input, and writes screenshots plus platform/version evidence to `test-results/`. Temporary test data is removed afterward. Tests neither start development servers nor contact sync services.

A manual launch uses the proof application's separate Electron user-data folder, with Core files under `core-proof/`. To use a different isolated folder set `TODU_FIT_PROOF_DATA` to an absolute path. Never point this proof at an existing nutrition store. It does not migrate or join existing identities.

## Ownership and contract

- `adapters/desktop` is a separate binding crate. Core has no napi-rs, Electron or React dependency; default Cargo members remain Core and CLI.
- The main process owns one worker and one session for its lifetime. The worker performs all Core filesystem/document work serially, away from the main and renderer event loops. The native constructor and methods are intentionally synchronous and must only be used on that worker in the app.
- Session opens an explicit path, acquires an OS file lock for competing desktop sessions, initializes an empty store using Core identity/group operations, and calls Core's existing `DishRepository`. Existing malformed/nonempty uninitialized stores fail closed. The lock is advisory among desktop adapters; the CLI does not honor it, so sharing a live data directory with the CLI is unsupported.
- Renderer API consists only of `listDishes()` and `createDish(name)`, returning a discriminated result with a dish summary or safe error. Main verifies the requesting web contents, top-level frame and local URL, validates inputs, and maps errors. Rust also validates binding input. No renderer-supplied path, arbitrary IPC channel, filesystem API, or addon is exposed.
- Each accepted write resolves only after Core persistence returns. Before quit, main rejects new operations and queues close after accepted operations; close releases the session and file lock. A worker failure rejects outstanding calls. There is no cancellation API: accepted writes drain even if the window closes. Forced process termination/power loss is outside this proof's durability claim.
- The renderer receives the committed dish through the operation result and refreshes from Core on launch. This one-window local flow has no background change-event or sync subscription contract.

## Validation and limits

`tests/native.cjs` checks native reopen, validation, competing session rejection, closed-session errors, refusal to overwrite unrelated data, and concurrent worker writes followed immediately by shutdown.

`.github/workflows/desktop-proof.yml` builds/packages and runs the same tests on GitHub-hosted macOS and Windows. Windows is explicitly nonblocking for this milestone. A configured job is not proof of runtime compatibility: Windows remains unverified until an actual run passes. Manual Windows installation is deferred.

Packages are unsigned/unnotarized application directories, not installers. Signing, distribution, updates, other CPU architectures, authentication, synchronization, remaining screens, Swift bindings and data migration are outside this milestone. The local packaged test establishes only the tested host's OS/architecture; it does not establish Gatekeeper behavior on another Mac.

### Local evidence (November 3, 2026)

- macOS arm64: packaged executable test passed using Electron 45.2.2, Node 24.22.2 and N-API 10 (addon targets N-API 8).
- Three native/worker tests passed. Core's 237 tests (including one documentation test), adapter Clippy with warnings denied, Rust formatting and React TypeScript checking passed.
- Screenshots `test-results/created.png` and `test-results/reopened.png` and machine-readable `test-results/packaged.json` are generated local artifacts, not committed fixtures.
- Windows automation is added but has not run; Windows is unverified. Intel macOS is also unverified.
- `npm audit --omit=dev` reports zero production advisories. The full audit reports 15 moderate development-tool dependency findings under electron-builder; the suggested automatic fix downgrades the builder to an old major and was not applied. Resolve/reassess build-tool advisories before release.
