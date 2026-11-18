# Desktop assistant foundation

The desktop integrates pinned Pi 1.5.2 libraries: `pi-durable` owns conversation persistence, submissions, retries and recovery; `pi-ai` owns built-in providers, model catalogs, authentication and OAuth refresh. Fit supplies desktop lifecycle, narrow IPC, settings, and encrypted credential storage. It does not implement a second agent scheduler or provider authentication layer.

## Settings and authentication

Settings → AI lists connected providers separately from the Add provider form. Users choose Account or API key first, then a compatible Pi provider. API-key selection opens Pi's secret prompt inline. Browser sign-in opens its provider link automatically after the user starts sign-in; OpenAI Codex defaults to browser authentication, with device-code and manual redirect options available. Switching flows cancels the previous attempt. The desktop renders Pi's text, secret and selection prompts, browser links and device codes. Sign out removes the stored provider credential; environment/system credentials may still apply according to Pi's normal resolution rules. One default-model selector combines available models from connected providers, grouped by provider. The saved selection contains both provider and model identifiers. The selected model name appears at the far right of the status bar only when a default exists. Lists use Pi’s `getAvailable` and credential-specific provider filters; saving a default or creating a conversation validates the model against the same list. Sign-in and Refresh models invoke Pi’s provider catalog refresh. Providers that do not expose account-level entitlement discovery remain limited to Pi’s authenticated catalog and filters; the app does not claim to verify permissions beyond that. Selecting a default model saves it immediately and affects new conversations; existing conversations retain their own model selection.

Credentials are encrypted with AES-GCM in the shared assistant profile. A random encryption key is held by the operating system credential store through `@napi-rs/keyring`: macOS Keychain, Windows Credential Manager, or Linux Secret Service. The worker owns credential reads, updates and OAuth refresh. Plaintext credentials are never returned by the renderer-facing API or logged. If protected system storage is unavailable, saving credentials is refused; Pi's ambient environment/system authentication can still be used.

## Runtime and persistence

A standalone Node service in `apps/assistant` owns the Pi harness and `conversations.sqlite`. Electron and the Rust CLI start it on demand and connect to the same profile. Closing either client leaves admitted AI work running. There is no startup-at-login registration. After a worker crash or explicit stop, the next client starts it and Pi resumes persisted work. A model request interrupted before completion may be retried by Pi.

The default profile is `<Fit data_dir>/assistant`. `FIT_ASSISTANT_DIR` overrides it for either client. Desktop development and packaged tests using `TODU_FIT_PROOF_DATA` instead use `<desktop profile>/shared-assistant`; point the CLI at that directory to share development state. Nutrition data and synchronization remain with the Rust daemon; the assistant does not open its database.

An exclusive SQLite process lock prevents two workers from owning one profile and releases on process death. This separate lock contains no application data. Clients use bounded newline-delimited JSON on loopback TCP with a random authentication token stored in the private profile's `worker.endpoint`. The endpoint file contains a credential and must not be shared or logged. This is a local same-user service, not a remotely accessible API.

Desktop and CLI distributions include Node and the worker dependencies. The launcher copies the versioned bundle into the profile before starting it, allowing the worker to survive an application update or AppImage unmount. A different worker version requires the Restart AI worker action in Settings → AI, or an explicit `fit ai worker stop` before restarting with the new client; it does not silently interrupt running work. `FIT_ASSISTANT_BUNDLE` or the CLI's `--worker-bundle` selects a bundle for development.

## Existing desktop data

On first use, the worker copies the legacy desktop assistant settings, catalog and conversation database into the shared profile. The database uses SQLite's online backup API, and source files remain intact. An interrupted copy resumes from staged migration state. Existing shared data is never silently combined with another legacy store.

Legacy credentials are encrypted with Electron `safeStorage`. If those credentials exist, the worker waits for the desktop to decrypt and import them into the new OS-backed vault. CLI commands explain that the desktop must be opened once. The default CLI profile detects the standard desktop profile and requires the updated desktop to perform the migration first, preventing a snapshot of a still-running legacy worker. `FIT_ASSISTANT_LEGACY_DIR` supplies an alternative profile to detect. Custom CLI data directories do not automatically adopt production desktop data.

## CLI

The Rust CLI connects directly to the worker; these commands do not start the nutrition daemon:

```sh
fit ai worker start
fit ai worker status
fit ai providers
fit ai models openai
fit ai model openai MODEL_ID
fit ai task start "Your prompt"
fit ai task list
fit ai task status CONVERSATION_ID
fit ai task entries CONVERSATION_ID
fit ai task cancel CONVERSATION_ID
fit ai worker stop
```

`task start` accepts `--conversation` and `--request-id` for continuing a conversation and safely retrying uncertain admission. Commands return JSON. Provider sign-in remains available through desktop Settings → AI; the CLI uses the same stored credentials and model. Worker status and stop do not start a stopped worker.

## Integration surface

`window.fit.assistant(operation)` is a sandboxed IPC facade. The main process checks the sending window, frame and origin. The shared worker validates the operation, provider and model. Responses use `{ ok: true, value }` or `{ ok: false, error }`.

- `settings`, `settings_save { model: { provider, modelId } }`
- `models { provider }`, `models_refresh { provider }`, `auth_status { provider }`
- `login_start { provider, method, flow? }`, `login_status`, `login_answer { id, promptId, answer }`, `login_cancel`, `login_open_link { url }`, `logout { provider }`
- `conversation_create { model? }`, `conversation_list { cursor? }`
- `conversation_get { id }` returns the latest 100 entries and Pi's progress documents; `conversation_entries { id, cursor? }` pages older history.
- `conversation_send { id, content, requestId }` returns the durable submission ID. Callers retain the same request ID and input when retrying an uncertain admission.
- `conversation_cancel { id }` explicitly cancels that conversation's work.

Conversation and submission IDs are Pi's numeric IDs. Multiple conversations share one registry, while Pi stores their independent state. The runtime accepts an injected registry for future Fit tools. This foundation deliberately installs no shell, filesystem, recipe-search or nutrition-write tools. The dish-assistant chat and draft UI is task-90b3a56c; daemon tools are task-985ec56b.

## Verification

`npm test --prefix apps/assistant` runs isolated Pi and worker tests with faux providers, without paid model calls. They cover conversation separation, durable replay, orderly and abrupt recovery, client exit, process ownership, authenticated IPC, encrypted persistence and migration. After `npm run build --prefix apps/desktop`, desktop tests also exercise the Rust CLI against the bundled Node service. Local packaged smoke checks save a default model and conversation, close and reopen Electron, and verify the same worker and state remain available. CI builds installers and runs automated worker/CLI tests, but does not install or launch the packaged desktop apps. Live provider login requires the user's account and interaction.
