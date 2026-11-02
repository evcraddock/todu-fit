# Shared Rust core with desktop and mobile apps

## Purpose and status

This proposal describes a direction for replacing the todu-fit website with installed desktop and mobile applications, while keeping one reusable Rust application engine. It follows the discussion associated with `task-b06292ca`.

The idea borrowed from Rott is **a portable core with separate application adapters**, not a requirement to use SwiftUI or any particular UI toolkit. Electron can provide the desktop UI while TypeScript calls the Rust core through an adapter.

This is an architectural proposal, not an implementation plan approved for execution. No bridge has been selected or validated, and no existing website, service or user data is changed by this document.

## Product direction

- Replace the browser website with installed desktop and mobile applications rather than maintain it as another long-term client.
- Support Windows as a desktop platform. Other desktop platforms and architectures remain to be agreed.
- Consider Electron with the existing React/TypeScript interface for desktop, backed by `todu-fit-core` rather than a second application engine in JavaScript.
- Use the same Rust core from mobile applications through appropriate adapters. Mobile operating systems and UI frameworks remain open decisions; SwiftUI is not required by this proposal.
- Keep the CLI as another consumer of the shared core.

The website can remain available temporarily during development and migration. Replacing the website does not mean removing the synchronization or other hosted services the installed apps still need.

## Proposed architecture

```text
Desktop app: Electron + React/TypeScript
  Presentation, windows, menus, navigation
                     |
           Typed Electron preload API
                     |
          Electron main-process adapter
                     |
          TypeScript-to-Rust bridge
                     |
                     v
               todu-fit-core <---------- CLI
                     ^
                     |
             Mobile platform adapter
                     |
        Mobile application and native services
        UI framework/platforms not yet selected

      Core-managed synchronization <----> Hosted sync service
```

The renderer does not receive unrestricted Node.js, filesystem or Rust-library access. Electron main owns the desktop bridge; a narrow preload API exposes application operations and events to the renderer.

Adapters are separate from the portable core. A Node binding, mobile binding generator, GUI framework or platform credential API must not become a requirement for ordinary Rust core consumers such as the CLI.

## Responsibilities

| Layer | Owns | Should not own |
| --- | --- | --- |
| `todu-fit-core` | Domain operations, validation, nutrition calculations, identity/group document operations, Automerge persistence, synchronization behavior and reusable application services. | React/Swift/UI types, Electron windows, bridge-generator annotations, platform credential stores or automatic discovery of an app's global state. |
| Desktop Rust/TypeScript adapter | Binding-friendly inputs/results/errors, asynchronous execution, event delivery, cancellation and resource lifetime translation. | A competing meal-planning model or another persistence/sync implementation. |
| Electron main and preload | App lifecycle, validated renderer requests, window/platform integration, secure credential access and coordination with the core session. | Arbitrary privileged APIs exposed to renderer content. |
| React renderer | Screens, forms, navigation, transient presentation state and displaying operation/sync results. | Its own authoritative Automerge repo, durable document store or duplicate domain rules. |
| Mobile adapter and app | Platform bindings, presentation, app/background lifecycle and platform-service integration. | Independent implementations of the core's domain and document behavior. |
| Hosted services | Cross-device synchronization and any separately retained account, authentication or public-feed services. | The only copy of local data needed to use an already initialized app offline. |

Platform-dependent facilities such as credentials, paths and application lifecycle should be supplied explicitly through adapter boundaries. Remote authorization remains enforced by the relevant server; sharing a local Rust core does not replace server-side access checks.

## What can be reused today

The existing repository provides useful foundations:

- [`todu-fit-core/src/lib.rs`](../todu-fit-core/src/lib.rs) exports domain/nutrition models, hydration calculations, identity/group types, Automerge storage/writers and sync APIs.
- [`todu-fit-cli/src/sync/`](../todu-fit-cli/src/sync/) contains additional application-facing repositories and orchestration that are not yet reusable through the core alone.
- [`web/src/`](../web/src/) contains React screens and presentation code that could be adapted for Electron.

The core is therefore a starting point, not already a complete application service suitable for every client. Some CLI-owned behavior would need extracting, and relevant TypeScript-only domain behavior—such as nutrition aggregation in `web/src/meals/mealPlanNutrition.ts`—would need migrating or reconciling with Rust. Reuse must preserve current behavior and existing document compatibility rather than copy implementations into a new adapter.

An illustrative layout is:

```text
todu-fit-core/       portable domain, storage, sync and application APIs
todu-fit-cli/        command parsing, output and core calls
adapters/desktop/   Rust exports and TypeScript binding contract
apps/desktop/       Electron main/preload and React presentation
adapters/mobile/    platform-specific bindings, once platforms are selected
apps/mobile/        mobile UI and platform lifecycle, layout to be decided
```

These paths illustrate boundaries, not a committed repository reorganization. Existing code can move incrementally when an implementation plan is approved.

## A TypeScript-to-Rust bridge

The desktop bridge should expose application operations, not raw Automerge objects or unrestricted filesystem primitives. For example, a renderer could request a dish list, save a meal log or record a water entry, then receive typed results and change notifications. Naming and exact API shapes still need design.

Two implementation approaches are candidates:

1. **Native Node addon:** an adapter, potentially using napi-rs, makes Rust-backed functions available to Electron main. This requires proving that the selected binding/toolchain and packaged binaries work with the supported Electron versions, operating systems and architectures.
2. **Rust sidecar:** Electron main starts a separate Rust process and communicates over a bounded, typed process protocol. This requires process discovery/startup, request/event framing, cancellation, crash handling and clean shutdown. A sidecar does not require exposing a localhost HTTP server.

Neither approach is selected here. Prefer the smallest approach that demonstrates the required operations, lifecycle guarantees and Windows packaging. TypeScript interfaces alone do not validate messages at runtime; validate renderer IPC and binding inputs at their respective trust boundaries.

Bridge acceptance should include:

- File/network work does not block the renderer or Electron's main event loop.
- A core session has explicit ownership of storage and sync resources; adapters do not accidentally create competing sessions for the same data root.
- Structured errors, document-change notifications and sync state reach the UI without leaking credentials or private data into diagnostics.
- Cancellation semantics distinguish unfinished work from an operation that already committed successfully.
- Closing a window, quitting the app, switching identities and shutting down a sidecar release resources predictably and preserve pending local writes.
- Installed Windows packages can load/start the Rust component, not merely compile it during development.

## How this differs from wrapping the website

The current web application creates its own JavaScript Automerge repo backed by IndexedDB. Under this proposal, the desktop app would instead use Rust-managed document storage and synchronization through the bridge. React hooks would become clients of that application API.

This is a larger change than bundling the website into an Electron window, but it avoids maintaining separate Rust and TypeScript implementations of the application engine. The renderer may cache presentation data; the core remains authoritative for durable state and domain operations.

The initial [Electron research](ELECTRON-RESEARCH.md) recommended preserving the browser engine to maximize frontend reuse. This proposal changes that objective: prioritize shared application behavior across the CLI, desktop and mobile apps, while reusing React presentation where practical.

## Hosted services and authentication

Retiring the website removes the browser UI as a supported product; it does not automatically remove every Hono endpoint or the sync server.

Before implementation, decide:

- How devices authenticate and receive/revoke credentials, and how those credentials authorize synchronization.
- Whether any hosted login/account-management pages remain as support surfaces rather than a full web application.
- Whether existing calendar subscription feeds remain a supported feature. Publicly reachable feeds cannot depend on the desktop app staying open.
- Which existing Hono services are retained, replaced or retired, and in what order.

Apps should store credentials using their platform's protected storage through explicit interfaces. Offline access to existing local documents must not depend on a successful `/auth/me` request at every launch. Remote session expiry/revocation, local cached access and destructive account removal need separate, documented policies.

## Migration and delivery principles

1. Inventory current Rust and TypeScript behavior and define the shared core API around real use cases.
2. Prove one vertical desktop slice—such as list/save a dish—through React, Electron IPC, the Rust adapter and durable storage. Include Windows packaging and offline reopen in the proof.
3. Move reusable CLI orchestration into the core without changing CLI behavior or the Automerge schema unnecessarily.
4. Expand desktop features and mobile adapters incrementally, with interoperability and lifecycle checks appropriate to each client.
5. Migrate existing identities and data, verify parity, then retire the website through an explicit deployment decision.

Preserve existing identity/group/document IDs and personal-versus-shared boundaries. Browser IndexedDB is not automatically the Rust app's storage: existing unsynced browser edits must reach the sync service or be recovered through an explicit export/import path before retirement. Never silently create replacement identities or delete old stores. Test convergence among old and new clients during the transition.

## Open decisions

- Mobile platforms: Android, iOS or both, and which comes first.
- Desktop platforms beyond Windows, CPU architectures and supported OS versions.
- Native addon versus sidecar and the concrete bridge tooling.
- Core API, event contract, execution model and platform-service injection boundaries.
- Authentication, hosted-service footprint and calendar subscription requirements.
- Offline cached-access policy, local-data protection, backups and account-removal behavior.
- Installer signing, updates, CI coverage and release ownership for each supported platform.

## Summary

The proposal is **one Rust application engine, multiple thin adapters, and independently chosen desktop/mobile interfaces**. Electron remains a plausible desktop choice, including Windows; it would become a client of `todu-fit-core`, not an installed copy of the current website's JavaScript engine. Rott provides the architectural pattern, not a requirement to use its UI framework or copy its product-specific implementation.
