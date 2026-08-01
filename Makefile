# todu-fit Monorepo
# Requires: overmind, tmux, cargo, node, docker

.PHONY: help build test-cli lint clean \
        dev test stop restart status logs \
        connect-vite connect-hono connect-sync \
        web-install web-build web-lint web-test \
        fit fit-init fit-sync fit-config fit-dishes fit-dish-create \
        reset test-reset

SOCKET := ./.overmind.sock

# Auto-detect environment from running hono
define get_cli_config
$(shell TMUX_SOCK=$$(ls -t /tmp/tmux-$$(id -u)/overmind-todu-fit-* 2>/dev/null | head -1); \
	if [ -n "$$TMUX_SOCK" ]; then \
		ENV=$$(tmux -L "$$(basename $$TMUX_SOCK)" capture-pane -t todu-fit:hono -p -S -50 2>/dev/null | grep -m1 "TODU_ENV" | sed 's/.*TODU_ENV=//'); \
		if [ "$$ENV" = "test" ]; then echo "config.test.yaml"; else echo "config.dev.yaml"; fi; \
	else \
		echo "config.dev.yaml"; \
	fi)
endef

CLI_CONFIG = $(get_cli_config)

# =============================================================================
# Help
# =============================================================================

help: ## Show this help
	@echo "todu-fit Development"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Development:"
	@echo "  dev             Start dev environment (persistent data)"
	@echo "  test            Start test environment (clean slate)"
	@echo "  stop            Stop all services"
	@echo "  restart         Restart dev environment"
	@echo "  status          Show service status"
	@echo "  logs            Stream all logs"
	@echo ""
	@echo "Connect:"
	@echo "  connect-vite    Attach to vite terminal (Ctrl+b d to detach)"
	@echo "  connect-hono    Attach to hono terminal"
	@echo "  connect-sync    Attach to sync terminal"
	@echo ""
	@echo "Build:"
	@echo "  build           Build CLI (cargo)"
	@echo "  test-cli        Run CLI unit tests (cargo test)"
	@echo "  lint            Lint CLI (clippy + fmt)"
	@echo "  web-install     Install web dependencies"
	@echo "  web-build       Build web for production"
	@echo "  web-lint        Lint web (tsc)"
	@echo "  web-test        Run web unit tests"
	@echo "  clean           Clean all build artifacts"
	@echo ""
	@echo "CLI (auto-detects dev/test env):"
	@echo "  fit ARGS=...    Run fit CLI command"
	@echo "  fit-init        Initialize CLI identity"
	@echo "  fit-sync        Sync CLI to local server"
	@echo "  fit-config      Show CLI config"
	@echo "  fit-dishes      List dishes"
	@echo "  fit-dish-create NAME=...  Create a dish"
	@echo ""
	@echo "Data:"
	@echo "  reset           Reset dev data (caution!)"
	@echo "  test-reset      Reset test data"

# =============================================================================
# Development Environment (overmind)
# =============================================================================

dev: ## Start dev environment (persistent data)
	@mkdir -p data/dev/sync data/dev/cli
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env from .env.example"; fi
	ENV_FILE=$(CURDIR)/.env overmind start -s $(SOCKET) -D
	@echo "Dev started: http://localhost:5173"

test: test-reset ## Start test environment (clean slate)
	@mkdir -p data/test/sync data/test/cli
	ENV_FILE=$(CURDIR)/.env.test overmind start -s $(SOCKET) -D
	@echo "Test started: http://localhost:5173"

stop: ## Stop all services
	@if [ -S $(SOCKET) ]; then overmind quit -s $(SOCKET) || true; fi
	@docker compose down 2>/dev/null || true

restart: stop dev ## Restart dev environment

status: ## Show service status
	@if [ -S $(SOCKET) ]; then \
		TMUX_SOCK=$$(ls -t /tmp/tmux-$$(id -u)/overmind-todu-fit-* 2>/dev/null | head -1); \
		if [ -n "$$TMUX_SOCK" ]; then \
			tmux -L "$$(basename $$TMUX_SOCK)" capture-pane -t todu-fit:hono -p -S -50 2>/dev/null | grep -m1 "TODU_ENV" || true; \
			echo ""; \
		fi; \
		overmind ps -s $(SOCKET); \
	else \
		echo "Not running"; \
	fi

logs: ## Stream all logs
	overmind echo -s $(SOCKET)

# =============================================================================
# Connect to Service Terminals
# =============================================================================

connect-vite: ## Connect to vite terminal
	overmind connect vite -s $(SOCKET)

connect-hono: ## Connect to hono terminal
	overmind connect hono -s $(SOCKET)

connect-sync: ## Connect to sync terminal
	overmind connect sync -s $(SOCKET)

# =============================================================================
# CLI Build
# =============================================================================

build: ## Build CLI
	@echo "🔨 Building CLI..."
	@cargo build --release -p todu-fit-cli
	@echo "✅ Build complete!"

test-cli: ## Run CLI unit tests
	@echo "🧪 Running CLI tests..."
	@cargo test
	@echo "✅ Tests complete!"

lint: ## Lint CLI
	@echo "🔍 Running linters..."
	@cargo fmt --check
	@cargo clippy --all-targets --all-features -- -D warnings
	@echo "✅ Linting complete!"

# =============================================================================
# Web Build
# =============================================================================

web-install: ## Install web dependencies
	cd web && npm install

web-build: ## Build web for production
	cd web && npm run build && npm run build:server

web-lint: ## Lint web
	cd web && npm run lint

web-test: ## Run web unit tests
	cd web && npm test

# =============================================================================
# CLI Commands (auto-detects dev/test environment)
# =============================================================================

fit: ## Run fit CLI command (ARGS="...")
	./target/release/fit -c $(CLI_CONFIG) $(ARGS)

fit-init: ## Initialize CLI identity
	./target/release/fit -c $(CLI_CONFIG) init

fit-sync: ## Sync CLI to local server
	./target/release/fit -c $(CLI_CONFIG) sync

fit-config: ## Show CLI config
	./target/release/fit -c $(CLI_CONFIG) config show

fit-dishes: ## List dishes
	./target/release/fit -c $(CLI_CONFIG) dish list

fit-dish-create: ## Create a dish (NAME="...")
	./target/release/fit -c $(CLI_CONFIG) dish create "$(NAME)"

# =============================================================================
# Cleanup
# =============================================================================

clean: ## Clean all build artifacts
	@echo "🧹 Cleaning..."
	@cargo clean
	@rm -rf web/dist web/dist-server web/node_modules
	@echo "✅ Clean complete!"

reset: ## Reset dev data (caution!)
	@rm -rf data/dev/cli data/dev/todu-fit.sqlite*
	@docker run --rm -v $(CURDIR)/data/dev/sync:/data alpine sh -c "rm -rf /data/*" 2>/dev/null || true
	@echo "Dev data reset"

test-reset: ## Reset test data
	@rm -rf data/test/cli data/test/todu-fit.sqlite*
	@docker run --rm -v $(CURDIR)/data/test/sync:/data alpine sh -c "rm -rf /data/*" 2>/dev/null || true
	@echo "Test data reset"
