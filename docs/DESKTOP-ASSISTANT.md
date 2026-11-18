# Desktop assistant foundation

The desktop integrates pinned Pi 1.5.2 libraries: `pi-durable` owns conversation persistence, submissions, retries and recovery; `pi-ai` owns built-in providers, model catalogs, authentication and OAuth refresh. Fit supplies desktop lifecycle, narrow IPC, settings, and encrypted credential storage. It does not implement a second agent scheduler or provider authentication layer.

## Settings and authentication

Settings → AI lists Pi's built-in providers and their advertised authentication methods. The desktop renders Pi's text, secret, selection and manual-code prompts, browser links and device codes. Sign-in links open only on user action. Sign out removes the stored provider credential; environment/system credentials may still apply according to Pi's normal resolution rules. Model selection is disabled until the selected provider has authentication configured. Lists use Pi’s `getAvailable` and credential-specific provider filters; saving a default or creating a conversation validates the model against the same list. Sign-in and Refresh models invoke Pi’s provider catalog refresh. Providers that do not expose account-level entitlement discovery remain limited to Pi’s authenticated catalog and filters; the app does not claim to verify permissions beyond that. Selecting a default model saves it immediately and affects new conversations; existing conversations retain their own model selection.

Credentials are stored using Electron `safeStorage` in `assistant/credentials.enc` under the desktop user-data directory. The main process encrypts them; Pi's worker serializes credential read/modify/write operations, including OAuth refresh. Plaintext credentials are never returned by the renderer-facing API, written to conversation storage, or logged. If protected system storage is unavailable (including Linux `basic_text`), saving credentials is refused. Pi's ambient environment/system authentication can still be used. The development profile has its own assistant storage and does not reuse another Pi installation's credentials.

## Runtime and persistence

One Electron utility process owns the Pi harness, using Pi's SQLite adapter at `assistant/conversations.sqlite`. SQLite uses FULL synchronous mode and fullfsync where supported. The desktop's single-instance lock prevents a second owner of that profile. Nutrition data and synchronization remain with the Rust daemon; the assistant does not open its database.

Closing the app closes the harness and its storage. Interrupted work remains persisted and resumes when the app opens again. A model request interrupted before completion may be retried by Pi. Work does not continue while the desktop is closed. Runtime failure is reported through assistant IPC and does not disable the normal nutrition screens; reopening the app recovers saved work.

## Integration surface

`window.fit.assistant(operation)` is a sandboxed IPC facade. The main process checks the sending window, frame and origin. The utility process validates the operation, provider and model. Responses use `{ ok: true, value }` or `{ ok: false, error }`.

- `settings`, `settings_save { model: { provider, modelId } }`
- `models { provider }`, `models_refresh { provider }`, `auth_status { provider }`
- `login_start { provider, method }`, `login_status`, `login_answer { id, promptId, answer }`, `login_cancel`, `login_open_link { url }`, `logout { provider }`
- `conversation_create { model? }`, `conversation_list { cursor? }`
- `conversation_get { id }` returns the latest 100 entries and Pi's progress documents; `conversation_entries { id, cursor? }` pages older history.
- `conversation_send { id, content, requestId }` returns the durable submission ID. Callers retain the same request ID and input when retrying an uncertain admission.
- `conversation_cancel { id }` explicitly cancels that conversation's work.

Conversation and submission IDs are Pi's numeric IDs. Multiple conversations share one registry, while Pi stores their independent state. The runtime accepts an injected registry for future Fit tools. This foundation deliberately installs no shell, filesystem, recipe-search or nutrition-write tools. The dish-assistant chat and draft UI is task-90b3a56c; daemon tools are task-985ec56b.

## Verification

`npm test --prefix apps/desktop` includes isolated Pi tests using the built-in faux provider, without paid model calls: conversation separation, durable replay, orderly and abrupt process recovery, provider-neutral authentication prompts, credential serialization, storage failure, and encrypted persistence. Packaged smoke checks exercise the utility process and provider catalog, save a default model and conversation, reopen the application, and verify both remain available on all supported desktop platforms. Live provider login still requires the user's account and interaction.

Chord's optional React peer is overridden to the app's existing React 19.3.1 patch version. Only Chord's Node context and SQLite APIs are used; its React adapters are not imported into the renderer.
