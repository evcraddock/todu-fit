# Code Standards

These standards apply across the `todu-fit` monorepo. Prefer existing project patterns over introducing new ones.

## General principles

- Make incremental, scoped changes.
- Prefer simple, obvious solutions.
- Match surrounding code style and naming.
- Reuse existing utilities and patterns before adding new abstractions.
- Do not bypass failing checks.
- Do not silently swallow errors.

## Rust standards

Applies to `todu-fit-core/` and `todu-fit-cli/`.

### Formatting

Use `rustfmt` via:

```bash
make lint
```

or directly:

```bash
cargo fmt --check
```

### Linting

Use `clippy` with warnings treated as errors:

```bash
cargo clippy --all-targets --all-features -- -D warnings
```

### Error handling

- Prefer returning `Result` for fallible operations.
- Avoid `.unwrap()` and `.expect()` in production code.
- Include context in error paths where it helps debugging.
- Fail fast with clear error messages.

Example:

```rust
let contents = std::fs::read_to_string(path)
    .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
```

### Testing

- Add or update tests for behavior changes when practical.
- Keep unit tests close to the code they validate.
- Use integration tests when behavior crosses crate or binary boundaries.

Run:

```bash
make test-cli
```

### Imports and organization

- Keep imports grouped and tidy.
- Prefer small functions with clear responsibilities.
- Keep modules focused on one area of behavior.

## TypeScript / React / Hono standards

Applies to `web/`.

### Type safety

- Prefer explicit types when inference is unclear.
- Avoid `any` unless there is a strong reason and it is documented.
- Keep API and state shapes consistent with existing app types.

### React

- Prefer small components with clear responsibilities.
- Keep state as local as practical.
- Follow existing patterns for hooks, routing, and data access.
- Avoid introducing new state-management patterns without strong justification.

### Server code

- Keep Hono handlers focused and composable.
- Validate inputs at boundaries.
- Return clear, contextual errors.
- Reuse existing helpers for auth, database access, and sync behavior where available.

### Verification

Run:

```bash
make web-lint
```

For build-impacting changes, also run:

```bash
make web-build
```

## Documentation standards

- Keep docs concise and task-focused.
- Do not add manual line breaks inside markdown paragraphs.
- Update docs when behavior, commands, or workflows change.
- Use concrete commands and file paths where possible.

## Monorepo standards

- Use the existing Makefile commands instead of inventing parallel workflows.
- Do not control the dev server lifecycle unless explicitly asked.
- Respect the separation between shared Rust code, CLI code, and web code.
- If a feature is platform-specific, keep the platform-specific logic at the edge and avoid leaking it into shared models unless intentional.

## Before finishing work

At minimum, ensure:

- changed code is formatted
- relevant checks pass
- changed docs are accurate
- the final summary lists files changed and verification performed
