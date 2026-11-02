# Electron feasibility and migration research

> Subsequent direction: [Shared Rust core with desktop and mobile apps](SHARED-CORE-APPS.md) records the proposal to replace the website, require Windows desktop support, and put the desktop application behind a Rust-core adapter. The recommendation below is the earlier frontend-reuse option, not an adopted implementation decision. Its security, authentication and distribution findings remain useful context.

Task: `task-b06292ca` — Research converting the web app to an Electron app.

Research date: 2026-11-02. Repository baseline: `796b6f1667156217e5683907d9075bb6fe88f4b7` (`main`). This is a research recommendation, not an implemented or runtime-validated desktop design. No application behavior, dependencies, or server configuration change with this document.

## Recommendation

An Electron client is feasible without rewriting the React UI or adopting the Rust core in JavaScript. Add a desktop client alongside the web client, sharing the React feature code and Automerge schemas. Bundle the renderer locally, retain the hosted Hono authentication/account/calendar services and the existing sync service, and initially retain IndexedDB for desktop document storage.

Do not treat `BrowserWindow.loadURL(hostedWebApp)` as the final conversion: it is a useful limited shell experiment, but does not provide a packaged UI that starts offline. Do not bundle the whole Hono server merely to reuse the frontend: that also brings a local account/session database, email infrastructure, native SQLite packaging, and a different authentication authority into the desktop lifecycle.

The main feasibility gates are desktop authentication, cold offline startup, and durable account-isolated storage—not meal-planning UI rendering. Validate these in a packaged proof of concept before committing to a full desktop release. Electron adds a Chromium/Node distribution, security-update obligations, signing, installers, and updater operations; binary size, memory use, startup time, and release effort remain unmeasured.

## What the repository actually does today

The implementation is React + Vite + Hono, not the Rust SSR/HTMX design described in parts of [ARCHITECTURE.md](ARCHITECTURE.md) and [WEB.md](WEB.md). Those documents are historical design context, not evidence of the current web runtime.

| Area | Observed implementation | Desktop implication |
| --- | --- | --- |
| Frontend | [`web/package.json`](../web/package.json) uses React 19, React Router 7, Vite 7 and Automerge Repo 2.x; [`web/src/App.tsx`](../web/src/App.tsx) uses `BrowserRouter`. | Reuse dishes, meals, food log, water, shopping, settings, Tailwind, and theme code. Routing and platform services need desktop-specific seams. |
| Local documents | [`RepoContext.tsx`](../web/src/repo/RepoContext.tsx) creates a renderer-side `Repo` with `IndexedDBStorageAdapter` and `BrowserWebSocketClientAdapter`. Identity/group documents point to personal meal logs/hydration and shared dishes/plans/carts. | Electron Chromium can retain this storage model. Preserve document IDs, schema compatibility, and personal/shared boundaries. |
| Sync | `getSyncUrl()` uses build-time `VITE_SYNC_URL`, otherwise `ws://localhost:8080`. [`web/Dockerfile`](../web/Dockerfile) explicitly describes direct browser-to-sync connections. [`compose.yaml`](../compose.yaml) runs the Automerge Repo sync server. | Supply a production WSS endpoint; do not assume Hono proxies `/sync`. There is no credential passed into the browser adapter here; hosted Hono login is not evidence of sync access control. |
| Web auth | [`auth/api.ts`](../web/src/auth/api.ts) calls relative `/auth` routes with cookies. [`session.ts`](../web/server/lib/session.ts) creates 30-day HTTP-only, SameSite=Lax cookies, Secure in production. | `app://` is not the hosted HTTPS origin. Changing only an API base URL is insufficient for cookie behavior, CORS, and session ownership. |
| Offline bootstrap | [`AuthContext.tsx`](../web/src/auth/AuthContext.tsx) calls `/auth/me` on mount and treats errors as unauthenticated; [`ProtectedRoute.tsx`](../web/src/auth/ProtectedRoute.tsx) redirects unauthenticated users; repo initialization requires auth state. | Existing IndexedDB persistence does **not** guarantee a cold offline launch can reach cached data. Cached profile/identity bootstrap and explicit network-error states are necessary. |
| Login and invitations | [`auth.ts`](../web/server/routes/auth.ts) consumes magic links, sets a cookie, and redirects to `PUBLIC_URL`; invitation acceptance is also a hosted route. Pending onboarding/group state is stored in renderer localStorage. | Email links normally open the system browser, whose session is separate from Electron. Desktop return and invitation handoff need intentional design. |
| Passkeys | [`passkey.ts`](../web/server/routes/passkey.ts) validates the configured `RP_ID` and `PUBLIC_URL` origin; renderer components call `navigator.credentials`. | Existing hosted passkeys cannot simply be asserted from a new custom origin. Prefer hosted browser authentication for the first desktop version. |
| Server responsibilities | [`server.ts`](../web/server.ts) serves auth, passkeys, calendar APIs, built assets and SPA fallback. [`server/db/index.ts`](../web/server/db/index.ts) opens `better-sqlite3`, applies migrations, and uses working-directory-relative paths. | Keep account/session/allowlist/calendar-token data hosted. The server is not currently a library that can be safely imported into Electron main unchanged. |
| Calendar subscriptions | [`calendar.ts`](../web/server/routes/calendar.ts) serves token-authenticated ICS feeds; [`server/lib/automerge.ts`](../web/server/lib/automerge.ts) reads synchronized documents server-side. | Keep the public feed reachable when the desktop computer is asleep or the app is closed. A local-only replacement would break that property. |
| External content | [`Markdown.tsx`](../web/src/components/Markdown.tsx) and [`CalendarSubscription.tsx`](../web/src/calendar/CalendarSubscription.tsx) render external links; onboarding/calendar UI uses clipboard APIs. | Desktop must constrain new windows, navigation, external URL dispatch, and permissions, including user-authored Markdown links. |

## Delivery options

| Option | Reuse and benefits | Costs and limitations | Assessment |
| --- | --- | --- | --- |
| Hosted web app in an Electron window | Smallest shell; same web origin and most existing API paths. | UI still needs the network to load reliably; browser/email session handoff remains unresolved; remote content must receive no native privileges. | Optional time-boxed experiment, not an offline desktop architecture. |
| Bundled React renderer + hosted services | High UI/schema reuse; locally installed UI; no local auth server; preserves public calendar feeds. | Requires desktop auth transport, offline profile bootstrap, stable origin/storage, routing, packaging and updates. | **Recommended direction.** |
| Bundled React + embedded Hono/SQLite | Can reuse server handlers after refactoring and offer local HTTP routing. | Local users/sessions are not hosted users/sessions; SMTP secrets must not ship; public calendar feeds still need hosting; localhost listener hardening, native-module rebuilds, migrations, paths, shutdown and ports add work. | Reject for the first version unless a separate self-hosted account service is an explicit requirement. |
| Move Automerge into main/utility process or use the Rust CLI/core as a sidecar | Could later centralize persistent sync and provide filesystem-oriented storage. | Requires a typed document/IPC API, lifecycle management and potentially per-platform native binaries; replacing renderer hooks is a larger migration. | Defer until background sync, storage operations, or measurements justify it. |

If the actual goal is only an installed shortcut, reassess whether browser installation/PWA improvements suffice before funding Electron. A Rust-oriented shell such as Tauri is a separate alternative investigation, not a prerequisite or part of this task; this research does not benchmark competing runtimes.

## Proposed desktop boundaries

```text
Electron main process
  window/protocol lifecycle, validated IPC, auth broker, updates, external links
       | narrow typed preload API (no Node access in renderer)
Bundled React renderer at a stable app://todu-fit origin
  existing UI/hooks + Automerge Repo + account-specific IndexedDB
       | direct WSS using the existing Automerge protocol
Hosted sync service

Electron main auth broker -- HTTPS --> hosted Hono account/auth/calendar APIs
System browser ---------- HTTPS --> hosted login/passkeys/invitation pages
System browser -- one-time desktop callback --> Electron main
Calendar clients -------- HTTPS --> hosted token-authenticated ICS feed
```

A future `desktop/` package could own main/preload, packaging and a desktop entry point while consuming the existing frontend source. Keep desktop production dependencies separate from `web/` server dependencies: merely importing renderer code should not package `better-sqlite3`, SMTP libraries, or server migrations. Preserve the existing web build/deployment path. Extract platform interfaces only where needed (auth transport, navigation, configuration, clipboard/external links); do not rewrite all feature hooks or create a second set of nutrition models.

### Origin, routing and WASM

Use a stable custom scheme/host such as `app://todu-fit`, registered as standard and secure before app readiness with the privileges needed for fetch. Electron documents that non-standard schemes disable web storage by default; handlers also belong to a particular Electron session [1]. Register the handler on each actual account session, not only on the default session.

Serve only bundled files below an allowlisted asset root, reject path traversal and unexpected hosts/methods, set correct MIME types including WASM, and provide an SPA fallback only for application routes. Keep `BrowserRouter` if packaged deep routes/reloads work with that fallback; otherwise use a desktop `HashRouter` entry point. Replace hard-coded `window.location.href = '/login'` platform navigation as needed, rather than assuming file URLs behave like a web server.

The existing Vite WASM and top-level-await plugins in [`vite.config.ts`](../web/vite.config.ts) must survive the desktop renderer build. Test a real packaged build loading Automerge WASM under the intended CSP, not just Vite development mode. Determine whether the selected runtime/build needs `wasm-unsafe-eval`; do not enable unrestricted `unsafe-eval` to make it run. Validate emitted asset paths for the selected origin/routing strategy; Forge's documented Vite template defaults target `file://`, so its defaults are not automatically the proposed custom-protocol design [2].

### Authentication is an explicit server/client project

The recommended first version authenticates in the system browser against the existing hosted origin. This preserves the existing passkey relying party and keeps Electron-specific authenticator support out of the first release. The current `/auth/verify` flow alone cannot complete desktop login: it creates a session in the browser, not in Electron.

A proposed flow (new endpoints and protocol, **not implemented today**) is:

1. Desktop main creates a high-entropy state and a verifier/challenge bound to one pending login, then opens a fixed hosted desktop-login URL in the browser. Only supported, fixed callback destinations are accepted by the server.
2. Hosted login uses existing magic-link/passkey verification, then issues a short-lived, single-use authorization code bound to the desktop challenge, authenticated user, callback and pending login. A registered callback such as `todufit://auth/callback` carries only the code/state, never a reusable session credential.
3. Main validates scheme/host/path/state and redeems the code over HTTPS with the verifier. The hosted exchange creates a separate revocable desktop session. Code interception by another protocol handler must not permit redemption without the verifier. Enforce expiry, one-time use, rate limits, and replay rejection server-side.
4. Main owns the desktop credential and makes typed, fixed-destination calls to the hosted APIs. For minimal reuse of existing Hono cookie middleware, use a main-owned HTTPS cookie jar/session client populated by the exchange; persist credentials with OS-backed protection. Do not copy the system browser's cookies or return session cookies to renderer JavaScript. The exact HTTP client, cookie persistence and exchange contract must be selected and tested in the spike.
5. Renderer auth/calendar adapters call narrow preload methods instead of cross-origin cookie fetches. Include the direct `/auth/identity` and `/auth/settings/current-group` fetches inside `RepoContext.tsx` in this migration: they bypass `auth/api.ts` today and are required for identity creation and invitation/group selection. Main attaches credentials, validates arguments and sender, and returns only sanitized application data. There is no generic arbitrary-URL authenticated fetch IPC. Hosted web clients retain their existing cookie-based API transport.

The URI scheme is only a handoff mechanism, not authentication. Handle both cold and running-app callbacks; macOS uses `open-url` and Windows/Linux require command-line/`second-instance` handling. Validate installed packages because protocol registration differs from development execution [3]. Invitations need the same reviewed handoff, including restoring the selected identity/group and not treating query-string group IDs as proof of access.

This adds hosted API work; the recommendation is not a claim that conversion can be accomplished with frontend packaging alone. Preserve existing web login behavior and ensure desktop logout revokes the desktop session independently of the browser session.

For the first desktop version, route passkey registration from settings to an allowlisted hosted HTTPS settings page, reauthenticating in the browser if needed, and refresh desktop passkey metadata through the broker afterward. Do not leave the existing `PasskeyRegister` component calling `navigator.credentials.create()` from the custom desktop origin; if hosted settings handoff is not ready, disable that action with an explanation until supported. Browser-based login does not by itself solve desktop registration.

Direct Electron passkeys are a later option, not assumed impossible: support depends on Electron version, OS, authenticator and signing. Current Electron documentation describes macOS configuration, associated-domain/AASA and entitlement requirements for platform passkeys [4]. Secure custom-scheme registration alone does not establish a WebAuthn relying-party association. If direct passkeys are pursued, validate actual signed packages and the server's expected origin; do not disable origin/RP verification or add arbitrary origins.

### Local data, offline access and migration

Keep the renderer IndexedDB adapter initially; Automerge provides both IndexedDB and Node filesystem adapters, but switching adapters is not necessary just to use Electron [5]. Choose a stable application ID, user-data location, scheme/host and persistent session partitions (`persist:` sessions persist storage [6]). Account-specific partitions must be selected by main from validated local account records, not arbitrary renderer-supplied paths. Stop/dispose the old repo/network connections before switching accounts, logging out or closing a window.

On an online login, cache the minimum validated profile/identity/current-group metadata needed to reopen local documents. On a subsequent offline start, distinguish transport failure from an explicit expired/revoked session response. A local offline profile is a local-data-access decision, not authorization for server calls; never trust cached admin flags to grant hosted actions. Disable online-only login, invites, account administration and calendar-token mutations with clear offline states. Define how revoked/expired remote sessions affect reconnect and cached access before release; require reauthentication for server operations and do not silently discard unsynced local edits.

Logout/account removal must specify whether local documents remain available or are removed, with a clear warning before deleting unsynced data. At minimum, prevent another account from seeing the previous account's IndexedDB or cached profile. OS credential protection does **not** encrypt all Automerge health/nutrition data; document local-at-rest privacy, OS account/disk-encryption assumptions, and shared-machine behavior.

A system browser's IndexedDB/localStorage is not automatically available to Electron. Initial migration should sign in to the same hosted account, retain the existing root identity/group document IDs and sync into the new desktop store. Existing browser-only unsynced edits must sync successfully before migration; if that is impossible, a deliberate export/import recovery mechanism is needed. Do not copy live browser profile directories or generate replacement identities for existing users. Verify dishes, plans, logs, water and carts, including CLI-written document formats, without changing the CRDT schema.

Before promising durability, test offline edit → normal quit → relaunch and abrupt termination/recovery, update retention, account isolation, and reconnect/conflict convergence. A later move to main-owned filesystem storage would need an explicit migration/export strategy and a document API, not just replacing an import.

### Sync and server availability

Retain the same Automerge protocol and production WSS service, with desktop-specific non-secret endpoint configuration instead of an accidental localhost fallback. Exercise network loss, sleep/wake, reconnect, missing documents and account switches. Renderer-owned sync only runs while the window/app remains alive; background sync after closing the window is not included in the initial proposal.

Review actual deployed sync authorization separately before production rollout. In this repository, the browser adapter receives only a URL, and the compose service is a generic sync server; we have not inspected production server policy. Do not infer document access control from successful Hono login or from knowledge of a root document ID. If authenticated sync or origin restrictions are required, confirm that the deployed service accepts the desktop origin and chosen credential transport without weakening access controls.

Keep Hono online for account settings and hosted ICS generation. Existing calendar subscription URLs must remain hosted, stable and revocable, not refer to the desktop origin or localhost. The server can remain operational independently of whether the web UI continues to be offered.

## Security and release obligations

Follow Electron's security checklist [7], with these project-specific acceptance conditions:

- Explicit `nodeIntegration: false`, `contextIsolation: true`, renderer sandboxing and `webSecurity: true`; no insecure-content exceptions or production certificate-error bypasses.
- Expose a small typed API through preload. Validate IPC sender/frame/origin and payload schemas in main; never expose raw `ipcRenderer`, filesystem primitives, shell commands or generic network proxies.
- Deny unexpected navigation/new windows and permissions. Allow only reviewed HTTPS external URLs; add `webcal:` only if needed with validated hosted calendar destinations. Parse URLs rather than checking string prefixes. User-authored Markdown must never open `file:`, `javascript:` or arbitrary OS protocols via `shell.openExternal`.
- Restrict CSP to bundled scripts/styles and the chosen HTTPS/WSS endpoints, with the narrow WASM allowance established by testing. Disable unexpected downloads/webviews, and inspect Electron fuses appropriate to the selected packaging setup.
- Store desktop session material in main with OS-backed `safeStorage` or an equivalent reviewed credential store. Verify protection availability; on Linux, do not silently persist secrets using a fallback such as `basic_text`. Credential encryption protects secrets, not the renderer's IndexedDB documents [8].
- Keep email/SMTP, signing and publishing credentials out of bundles, renderer environment variables and logs. Redact login codes, cookies and calendar feed tokens in diagnostics.
- Assign an owner and turnaround expectation for Electron/Chromium and dependency security updates; desktop users do not receive runtime fixes merely because the hosted web app was deployed.

Use Electron Forge for a packaging spike, with the existing Vite renderer build and separate main/preload builds. Its Vite plugin is currently documented as experimental with potential breaking changes in minor releases, so pin compatible versions and decide explicitly whether to use the plugin or feed independently built assets to Forge [2]. Select the supported Electron release at implementation time; this research does not lock a runtime version.

Start with one agreed OS/architecture, then expand only to platforms the project will test and maintain. For example, macOS Apple silicon can be a pilot if that matches user needs; macOS Intel, Windows and Linux are additional deliverables, not automatic consequences of cross-platform APIs. Add desktop-specific CI packaging/smoke jobs without replacing existing Rust/web checks. No Electron workflow exists in the current [CI configuration](../.github/workflows/ci.yml).

For distribution, plan macOS signing/notarization and Windows signing; these need external accounts/credentials and validated release infrastructure [9]. Keep signing identity and app identifiers stable across updates. If native modules are later included (for example embedded `better-sqlite3`), rebuild for Electron's ABI and each target architecture; ordinary Node builds are not sufficient [10]. Avoid shipping those modules in the recommended renderer-only client.

Select installers and an update mechanism together. Electron's built-in `autoUpdater` supports macOS/Windows and requires a signed app on macOS; it does not provide built-in Linux auto-updating [11]. Establish trusted HTTPS release metadata/artifacts, signing verification, release channels and user-visible restart timing. On Linux, choose a package-manager or explicitly researched alternative update path. Test an installed N → N+1 update preserving the profile and pending Automerge writes, plus recovery when download/install fails. Do not promise data rollback merely because an older app binary can be reinstalled; storage/schema compatibility must be checked.

## Phased implementation proposal and exit gates

These are proposed follow-up work packages, not tasks created by this research. Relative effort is qualitative, not a calendar estimate.

| Phase | Scope | Required evidence before advancing |
| --- | --- | --- |
| 0 — Product and threat-model decisions (small) | Confirm supported OS/architectures, whether web remains, offline cached-access/logout policy, sync authorization expectations and who owns releases/signing. | Recorded decisions; no assumption that Electron removes hosting costs or provides encrypted document storage. |
| 1 — Packaged shell/storage spike (small–medium) | Add desktop main/preload/build boundaries; serve shared UI/WASM from a stable custom origin with restrictive permissions/CSP. Use disposable fixtures, not production health data. | Installed build renders dishes/meals/water, handles route reloads/assets, retains fixture IndexedDB across quit/relaunch, starts its bundled UI without network, and cannot navigate to privileged external content. Measure package size, idle memory and startup time. |
| 2 — Desktop auth and offline bootstrap (largest uncertainty) | Implement hosted browser handoff/exchange, main-owned session client, typed auth/calendar adapters, account partitions and cached profile startup. | Real hosted magic-link/passkey login returns to installed desktop on cold/warm launches; passkey registration uses hosted settings or is clearly disabled; repo-side identity creation/invitation/group selection uses the broker; rejected callback/replay tests pass; offline relaunch reaches cached data; logout/revocation/account switching follow the recorded policy and preserve unsynced edits appropriately. Existing web login remains functional. |
| 3 — Data continuity and sync (medium) | Reuse existing identity/group IDs and renderer repo; verify endpoint configuration, reconnect behavior and existing-client interoperability. | Online/offline edits converge in desktop ↔ web ↔ CLI for dishes, plans, logs, water and carts; private hydration/logs stay personal; group switching, invitations, missing documents and sleep/wake are tested; hosted ICS stays reachable with desktop closed. |
| 4 — Distribution and hardening (medium, repeated per platform) | Signing, installers, update feed, desktop CI/smoke coverage, diagnostics/privacy documentation and security checklist. | Clean-machine install, native protocol callbacks, signed update retention and failure recovery pass for every advertised OS/architecture. Release owner and maintenance process are established. |

Proceed beyond the spike only if authentication and storage work in **packaged** builds, offline launch does not depend on `/auth/me`, existing identities/data remain intact, and operational costs are acceptable. Reconsider a simpler hosted wrapper or browser-installation approach if local-first desktop behavior is not actually required.

## Evidence and limits

Repository conclusions above come from the linked implementation at the recorded baseline. External platform claims come from the official sources below, consulted 2026-11-02. These are moving `latest` documents; recheck against the pinned runtime/tool versions when implementing.

No Electron prototype was built, no desktop login/IPC/storage/update behavior was exercised, no production sync server configuration was audited, and no size/performance measurements were taken. The current dev services were not started, stopped or restarted. This document establishes feasibility and a validation plan, not proof that the conversion already works or a committed delivery estimate.

### Official references

1. [Electron protocol registration, scheme privileges and session scope](https://www.electronjs.org/docs/latest/api/protocol).
2. [Electron Forge Vite plugin, experimental status, renderer paths and native modules](https://www.electronforge.io/config/plugins/vite).
3. [Electron deep links and packaged-platform handling](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app).
4. [Electron app API: configureWebAuthn and macOS platform authenticator requirements](https://www.electronjs.org/docs/latest/api/app#appconfigurewebauthnoptions-macos).
5. [Automerge Repo storage adapters](https://automerge.org/docs/reference/repositories/storage/).
6. [Electron session API and persistent partitions](https://www.electronjs.org/docs/latest/api/session).
7. [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security).
8. [Electron safeStorage and platform-specific protection limits](https://www.electronjs.org/docs/latest/api/safe-storage).
9. [Electron code signing and notarization](https://www.electronjs.org/docs/latest/tutorial/code-signing).
10. [Electron native Node modules and ABI rebuilds](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules).
11. [Electron autoUpdater platform support and requirements](https://www.electronjs.org/docs/latest/api/auto-updater).
