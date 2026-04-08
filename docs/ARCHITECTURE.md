# Todufit Architecture

## Overview

Todufit is a local-first meal planning and nutrition tracking system with cross-device sync. This document describes the architecture for supporting multiple client types: CLI, Web, and iOS.

## Table of Contents

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | This file - system overview, repo structure |
| [AUTH.md](./AUTH.md) | Authentication (magic links, passkeys, sessions) |
| [WEB.md](./WEB.md) | Web application - `todufit-web` repo |
| [IOS.md](./IOS.md) | iOS app - `todufit-ios` repo |
| [SYNC-SERVER.md](./SYNC-SERVER.md) | Sync server changes - `todu-sync` repo |
| [DATA-MODEL.md](./DATA-MODEL.md) | Entity schemas, Automerge structure |
| [WATER-TRACKING.md](./WATER-TRACKING.md) | Private water-tracking product and architecture design |

## Design Principles

1. **Local-first** - All clients work offline; sync is additive
2. **Single auth authority** - Sync server owns users, credentials, and API keys
3. **Automerge everywhere** - CRDT-based sync across all platforms
4. **Platform-appropriate UX** - Each client uses native patterns for auth and storage

## System Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                            Sync Server                                  │
│                    (Rust: axum + automerge-rs)                         │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │
│  │      Auth       │  │      Sync       │  │       Storage           │ │
│  │                 │  │                 │  │                         │ │
│  │ - Magic links   │  │ - WebSocket     │  │ - Users                 │ │
│  │ - Passkeys      │  │ - Automerge     │  │ - API keys              │ │
│  │ - API keys      │  │   protocol      │  │ - Passkey credentials   │ │
│  └─────────────────┘  └─────────────────┘  │ - Automerge docs        │ │
│                                            └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
              ▲                    ▲                    ▲
              │                    │                    │
         API key in           API key in           API key in
         config file          session store         Keychain
              │                    │                    │
    ┌─────────┴─────────┐ ┌───────┴───────┐ ┌─────────┴─────────┐
    │                   │ │               │ │                   │
    │       CLI         │ │     Web       │ │       iOS         │
    │                   │ │               │ │                   │
    │ Rust binary       │ │ Rust server   │ │ Swift app         │
    │ automerge-rs      │ │ SSR + HTMX    │ │ automerge-swift   │
    │ SQLite queries    │ │ automerge-rs  │ │ SwiftUI           │
    │ clap commands     │ │ SQLite        │ │                   │
    │                   │ │               │ │                   │
    └───────────────────┘ └───────────────┘ └───────────────────┘
```

## Document Structure

Three Automerge documents per user/group:

| Document | File | Contents |
|----------|------|----------|
| Dishes | `dishes.automerge` | Map of UUID → Dish |
| Meal Plans | `mealplans.automerge` | Map of UUID → MealPlan |
| Meal Logs | `meallogs.automerge` | Map of UUID → MealLog |

See [DATA-MODEL.md](./DATA-MODEL.md) for entity schemas.

## Client Comparison

| Aspect | CLI | Web | iOS |
|--------|-----|-----|-----|
| Language | Rust | Rust (server) | Swift |
| Automerge | automerge-rs | automerge-rs | automerge-swift |
| Local storage | SQLite + files | SQLite + files | CoreData or SQLite |
| Auth storage | Config file | Session cookie | Keychain |
| Auth methods | Magic link | Magic link + Passkey | Magic link + Passkey |
| Offline support | Full | Full | Full |
| Sync trigger | Manual or auto | Auto + SSE push | Auto + background |

## Repository Structure

```
evcraddock/
├── todufit/              # CLI + shared core library (this repo)
│   ├── todufit-core/     # Shared: models, automerge, sync logic
│   └── todufit-cli/      # CLI binary
├── todufit-web/          # Web application (separate repo)
├── todufit-ios/          # iOS app (separate repo)
└── todu-sync/            # Sync server (existing separate repo)
```

### Why This Structure

| Repo | Language | Rationale |
|------|----------|-----------|
| `todufit` | Rust | Core library lives with CLI (reference implementation) |
| `todufit-web` | Rust | Separate deployment, imports core via git dependency |
| `todufit-ios` | Swift | Different language, naturally separate |
| `todu-sync` | Rust | Server-side, different deployment lifecycle |

### Sharing Rust Code

`todufit-web` imports the shared library:

```toml
# todufit-web/Cargo.toml
[dependencies]
todufit-core = { git = "https://github.com/evcraddock/todufit" }
```

iOS doesn't share Rust code directly—it implements the same Automerge document schema in Swift using `automerge-swift`.

## Implementation Phases

### Phase 1: Sync Server Updates
- Add `POST /auth/verify` endpoint
- Add passkey support (webauthn-rs)
- Add CORS and apple-app-site-association
- All changes additive (CLI continues to work)

### Phase 2: Web Application
- Extract todufit-core library from CLI
- Build todufit-web with axum + askama + HTMX
- Implement session management
- Deploy to k3s

### Phase 3: Mobile Web
- Make web UI responsive
- Add PWA manifest
- Test "Add to Home Screen" experience

### Phase 4: Native iOS
- SwiftUI app with automerge-swift
- Passkey and magic link auth
- Background sync
- App Store submission

## Tech Stack Summary

| Component | Technology |
|-----------|------------|
| Sync Server | Rust, axum, automerge-rs, SQLite, webauthn-rs |
| CLI | Rust, clap, automerge-rs, SQLite |
| Web | Rust, axum, askama, HTMX, Alpine.js |
| iOS | Swift, SwiftUI, automerge-swift, Keychain |
| Styling | Tailwind CSS or simple custom CSS |
| Deployment | Docker, k3s (Kubernetes) |
