# Contributing

This document defines how to work in `todu-fit`.

## Required workflow

1. Work only within the requested task scope.
2. Read relevant files before editing.
3. Make the smallest change that satisfies the task.
4. Follow [CODE_STANDARDS.md](CODE_STANDARDS.md).
5. Do not add manual line breaks in markdown paragraphs.
6. If blocked or requirements are ambiguous, stop and report `BLOCKED` with the reason.
7. Summarize changed files and verification results clearly.

## Project context

`todu-fit` is a monorepo with:

- `todu-fit-core/` - shared Rust models and sync logic
- `todu-fit-cli/` - Rust CLI
- `web/` - React frontend with Hono server code

Contributions should match the conventions already present in the part of the repo being changed.

## Branches and commits

Start from the latest `main` branch and create a task branch:

```bash
git checkout main && git pull
git checkout -b feat/{task-id}-short-description
```

Branch prefixes:

- `feat/` - new features
- `fix/` - bug fixes
- `docs/` - documentation only
- `chore/` - maintenance

Commit format:

```text
<type>: <short description>

Task: #<task-id>
```

## Verification (required)

Run the relevant checks for the area you changed.

### Rust changes

Use these for `todu-fit-core/` and `todu-fit-cli/` work:

```bash
make lint
make test-cli
```

### Web changes

Use these for `web/` frontend or server work:

```bash
make web-lint
```

If the change affects production build behavior, also run:

```bash
make web-build
```

### Manual/integration checks

If a change affects sync or cross-client behavior, use the appropriate walkthrough in `integration-tests/` and summarize what was verified.

## Dev environment rule

Do not start, stop, or restart the dev server as part of normal contribution work unless the user explicitly asks.

Use:

```bash
make status
```

to inspect the current state.

## Review and integration

- Push branches to GitHub.
- Use pull requests for review and integration whenever possible.
- Wait for explicit human merge approval.
- Never auto-merge.

## When stuck

After 3 failed attempts at the same problem:

1. Stop.
2. Document what was tried and why it failed.
3. Propose alternatives or ask for guidance.
