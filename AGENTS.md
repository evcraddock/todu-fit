# todu-fit development guide

The CLI and Electron desktop use the Rust daemon and shared Core for offline storage and sync. See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for branch, review and verification requirements and [apps/desktop/README.md](apps/desktop/README.md) for desktop development.

## Managed environment

**Never start, stop or restart the dev server.** The user controls its lifecycle. Use `make status` to inspect it. The only managed service is the Automerge sync server at `ws://localhost:8080`. Use `make logs` or `make connect-sync` for logs.

## CLI

Build the CLI with `make build`. Use `make fit-config` to check the configuration and `make fit ARGS="dish list"` to run the release binary. The Makefile selects `config.test.yaml` while the managed test environment is running; otherwise it defaults to `config.dev.yaml`. Override explicitly with `CLI_CONFIG=config.test.yaml`. Dev and test data are isolated under `data/dev/` and `data/test/`. Do not reset data as part of normal development.

## Verification

- `make lint` and `make test-cli`: Rust formatting, linting and tests.
- `npm ci --prefix integration-tests && npm test --prefix integration-tests`: JS document compatibility fixtures (Node 24).
- For an isolated CLI↔JavaScript sync check, see [Automerge compatibility](docs/AUTOMERGE-COMPATIBILITY.md). For the local iOS workflows see [iOS and Rust Core compatibility](integration-tests/IOS-CORE-COMPATIBILITY.md).
