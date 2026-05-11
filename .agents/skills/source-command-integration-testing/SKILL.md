---
name: "source-command-integration-testing"
description: "Run integration tests from integration-tests/*.md files"
---

# source-command-integration-testing

Use this skill when the user asks to run the migrated source command `integration-testing`.

## Command Template

# Integration Testing

Run integration tests in the `integration-tests/` folder.

## Environment Configuration

Both environments use the same ports:

| Component | URL |
|-----------|-----|
| Web (Vite) | http://localhost:5173 |
| API (Hono) | http://localhost:3000 |
| Sync Server | ws://localhost:8080 |

The difference is data isolation:
- **dev**: Uses `data/sync`, `data/web`, `data/cli` (persistent)
- **test**: Uses `data/test/sync`, `data/test/cli`, etc. (wiped before each run)

## Setup

1. Stop any running services:
   ```bash
   make stop
   ```

2. Start the appropriate environment:
   ```bash
   # For test (recommended - starts with clean data)
   make test-env
   
   # For dev (uses existing data)
   make dev
   ```

3. Wait for all services to be ready:
   ```bash
   make status
   ```

4. Set the CLI config:
   ```bash
   # For test environment
   CLI_CONFIG=config.test.yaml
   
   # For dev environment
   CLI_CONFIG=config.dev.yaml
   ```

5. Build the CLI:
   ```bash
   cargo build --release -p todu-fit-cli
   ```

6. Run the **sync-setup** skill to connect CLI and web to the same identity.

## Running Tests

1. If `file` is "all", find all `.md` files in `integration-tests/`. Otherwise, use only `integration-tests/{file}`.

2. For each test file:
   - Read the file contents
   - Follow the instructions exactly as written
   - Record the result as PASS or FAIL for each test section
   - Do not investigate or fix failures - just record the result

3. After completing all tests, provide a summary table:

| Test File | Test Section | Result |
|-----------|--------------|--------|
| DISH-SYNC.md | CLI → Web Create | PASS/FAIL |
| ... | ... | ... |

## Teardown

After all tests complete (pass or fail):
```bash
make stop
```

## Important

- Run tests one file at a time, completing all sections before moving to the next file
- Use the browser-tools skill if you need to interact with the web UI
- Wait the specified time (usually 10 seconds) between actions
- Report exactly what you observed - do not guess or assume results
- Always run teardown, even if tests fail
