# todu-fit Monorepo
# Requires: overmind, tmux, cargo, node, docker

.PHONY: help build test-cli lint clean \
        dev test stop restart status logs \
        connect-sync \
        fit fit-init fit-sync fit-config fit-dishes fit-dish-create \
        reset test-reset

SOCKET := ./.overmind.sock

# Record the mode only after a successful start; ignore it when Overmind is offline.
TEST_MODE := data/.test-environment
CLI_CONFIG ?= $(if $(shell test -f $(TEST_MODE) && overmind ps -s $(SOCKET) >/dev/null 2>&1 && echo test),config.test.yaml,config.dev.yaml)

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
	@echo "  connect-sync    Attach to sync terminal"
	@echo ""
	@echo "Build:"
	@echo "  build           Build CLI (cargo)"
	@echo "  test-cli        Run CLI unit tests (cargo test)"
	@echo "  lint            Lint CLI (clippy + fmt)"
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
	@rm -f $(TEST_MODE)
	@echo "Dev sync started: ws://localhost:8080"

test: test-reset ## Start test environment (clean slate)
	@mkdir -p data/test/sync data/test/cli
	ENV_FILE=$(CURDIR)/.env.test overmind start -s $(SOCKET) -D
	@touch $(TEST_MODE)
	@echo "Test sync started: ws://localhost:8080"

stop: ## Stop all services
	@if [ -S $(SOCKET) ]; then overmind quit -s $(SOCKET) || true; fi
	@docker compose down 2>/dev/null || true

restart: stop dev ## Restart dev environment

status: ## Show service status
	@if [ -S $(SOCKET) ]; then \
		overmind ps -s $(SOCKET); \
	else \
		echo "Not running"; \
	fi

logs: ## Stream all logs
	overmind echo -s $(SOCKET)

# =============================================================================
# Connect to Service Terminals
# =============================================================================

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
	@rm -rf integration-tests/node_modules
	@echo "✅ Clean complete!"

reset: ## Reset dev data (caution!)
	@rm -rf data/dev/cli
	@docker run --rm -v $(CURDIR)/data/dev/sync:/data alpine sh -c "rm -rf /data/*" 2>/dev/null || true
	@echo "Dev data reset"

test-reset: ## Reset test data
	@rm -rf data/test/cli
	@docker run --rm -v $(CURDIR)/data/test/sync:/data alpine sh -c "rm -rf /data/*" 2>/dev/null || true
	@echo "Test data reset"
