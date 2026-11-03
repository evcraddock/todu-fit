# Todu Fit

Local-first meal planning and nutrition tracking with cross-device sync.

## Features

- **Dishes** - Create and manage recipes with ingredients and nutritional info
- **Meal Plans** - Plan meals by date and type (breakfast, lunch, dinner, snack)
- **Meal Logging** - Track what you ate with nutrition totals
- **Shopping Lists** - Auto-generated from meal plans with check-off tracking
- **Groups** - Share dishes and meal plans with family or household
- **Offline-first** - Works without internet, syncs when connected
- **Cross-device** - CLI and web app share the same data

## Components

| Component | Description |
|-----------|-------------|
| **todu-fit-cli** | Command-line interface (`fit` binary) |
| **todu-fit-web** | React web application |
| **todu-fit-core** | Shared Rust library (models, sync) |
| **[todu-sync](https://github.com/evcraddock/todu-sync)** | Automerge sync server (separate repo) |

## How It Works

```
┌─────────────┐     ┌─────────────┐
│   fit CLI   │     │   Web App   │
│  (Rust)     │     │  (React)    │
└──────┬──────┘     └──────┬──────┘
       │                   │
       │  Automerge CRDT   │
       │                   │
       └─────────┬─────────┘
                 │ WebSocket
                 ▼
          ┌─────────────┐
          │  todu-sync  │
          │   server    │
          └─────────────┘
```

- **Automerge** CRDTs store all data locally
- Changes sync via WebSocket when online
- Works offline - edits merge automatically when reconnected
- CLI and web share the same identity to see the same data

## CLI Installation

### Quick Install (Linux x86_64 / macOS Apple Silicon)

```bash
curl -fsSL https://raw.githubusercontent.com/evcraddock/todu-fit/main/install.sh | bash
```

### Download Binary

Pre-built binaries on the [releases page](https://github.com/evcraddock/todu-fit/releases):
- Linux x86_64
- macOS aarch64 (Apple Silicon)
- Windows x86_64

### Build from Source

```bash
git clone https://github.com/evcraddock/todu-fit.git
cd todu-fit
cargo install --path todu-fit-cli
```

## CLI Quick Start

```bash
# Initialize identity
fit init --new

# Create a group (required for dishes)
fit group create "Home"

# Create a dish
fit dish create "Grilled Salmon" \
  --servings 2 \
  --nutrients '{"calories": 450, "protein": 40, "carbs": 5, "fat": 28}'

# Plan a meal
fit mealplan create --date 2025-01-15 --type dinner --dish "Grilled Salmon"

# Log what you ate
fit meal log <plan-id>

# View history with nutrition totals
fit meal history

# Sync to server
fit sync
```

## CLI Commands

```bash
fit init [--new|--join <id>]     # Initialize identity
fit group create|list|switch     # Manage groups
fit dish create|list|show|update|delete
fit mealplan create|list|show|update|delete
fit meal log|history
fit shopping list|add|check
fit sync                         # Sync with server
fit config show                  # Show configuration
```

Run `fit <command> --help` for details.

## Configuration

Config file location:
- Linux: `~/.config/fit/config.yaml`
- macOS: `~/Library/Application Support/fit/config.yaml`
- Windows: `%APPDATA%\fit\config.yaml`

```yaml
data_dir: ~/.local/share/fit    # Where Automerge data is stored
created_by: your-name

sync:
  server_url: "wss://your-sync-server.com"
  auto_sync: true               # Sync after every write
```

## Web App

The web app provides the same features with a browser UI. See [web/README.md](web/README.md) for details.

To connect CLI and web:
1. Initialize CLI: `fit init --new && fit group create "Home"`
2. Get identity: `fit device show` (copy the ID)
3. In web app Settings → Sync Settings → enter the ID

Both will now share the same data.

## Development

### Prerequisites

- **Rust** (latest stable) - CLI
- **Node.js** (v20+) - Web app
- **Docker** - Sync server
- **Overmind** - Process manager ([install](https://github.com/DarthSim/overmind#installation))
- **tmux** - Required by Overmind

### Services

Development runs three services via Overmind:

| Service | Port | Description |
|---------|------|-------------|
| **vite** | 5173 | React dev server with HMR |
| **hono** | 3000 | Auth API server |
| **sync** | 8080 | Automerge sync server (Docker) |

### Quick Start

```bash
# Install web dependencies
make web-install

# Start all services (runs in background)
make dev

# Check status
make status

# View web app
open http://localhost:5173

# Stop services
make stop
```

### Environments

| Environment | Command | Data | Purpose |
|-------------|---------|------|---------|
| **dev** | `make dev` | `data/dev/` | Persistent development data |
| **test** | `make test` | `data/test/` | Clean slate (wiped on start) |

### Viewing Logs

Services run in tmux panes:

```bash
make logs           # Stream all logs (Ctrl+C to stop)
make connect-hono   # Attach to hono pane
make connect-vite   # Attach to vite pane
make connect-sync   # Attach to sync pane
```

In tmux: scroll with `Ctrl+b [`, exit scroll with `q`, detach with `Ctrl+b d`.

### CLI Development

```bash
make build                    # Build release binary
make fit ARGS="dish list"     # Run CLI command
make fit-config               # Show CLI config
cargo run -p todu-fit-cli -- -c config.dev.yaml dish list  # Or via cargo
```

### All Commands

```bash
make help    # Show all available commands
```

See [AGENTS.md](AGENTS.md) for detailed development workflows.

## License

MIT
