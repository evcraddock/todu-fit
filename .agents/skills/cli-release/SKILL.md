---
name: cli-release
description: Create a new CLI release tag based on conventional commits. Use when user says "cli release", "release cli", "release the cli", "new cli version", or similar.
---

# CLI Release

Create a new CLI release tag (`cli-v*`) based on conventional commits since the last release.

**Note:** This is for CLI releases only. Web releases use `web-v*` tags and are handled separately.

## Instructions

1. **Verify on main branch with no unpushed commits**:
   - First, verify you're on main branch: `git branch --show-current`
   - If NOT on main, **STOP** and inform the user: "Releases must be created from the main branch. Please switch to main first."
   - Fetch the latest from origin: `git fetch origin main`
   - Check for unpushed commits: `git log origin/main..HEAD --oneline`
   - If there are any unpushed commits, **STOP** and inform the user:
     - "There are unpushed commits on the main branch. Please push or create a feature branch and submit a pull request before creating a release."
     - List the unpushed commits so they can see what needs to be addressed
     - Do NOT proceed with the release

2. **Get the current CLI release tag**:
   - Run `git tag --list 'cli-v*' --sort=-v:refname | head -1` to get the latest CLI tag
   - If no CLI tags exist, assume starting from cli-v0.0.0

3. **Get changes to CLI/core since the last tag**:
   - Run `git log <latest-tag>..HEAD --oneline -- todu-fit-cli/ todu-fit-core/` to see commits affecting CLI or core
   - If there are no commits affecting todu-fit-cli/ or todu-fit-core/ since the last tag, inform the user and stop

4. **Analyze commits to determine version bump**:
   Using semantic versioning (MAJOR.MINOR.PATCH):

   - **MAJOR** (breaking change): Look for commits with:
     - BREAKING CHANGE: in the message
     - An exclamation mark after the type, like feat!: or fix!:

   - **MINOR** (new feature): Look for commits with:
     - feat: prefix (new features)

   - **PATCH** (bug fix): Look for commits with:
     - fix: prefix (bug fixes)
     - perf: prefix (performance improvements)

   Other commit types (docs:, style:, refactor:, test:, chore:, ci:, build:) do not trigger a version bump on their own, but if mixed with feat: or fix: commits, the highest applicable bump wins.

   Priority: MAJOR > MINOR > PATCH

5. **Calculate the new version**:
   - Parse the current version, for example cli-v1.2.3 becomes major=1, minor=2, patch=3
   - Apply the appropriate bump:
     - MAJOR: increment major, reset minor and patch to 0
     - MINOR: increment minor, reset patch to 0
     - PATCH: increment patch only

6. **Update Cargo.toml version**:
   - Before creating the tag, update the version in Cargo.toml to match
   - Commit the version bump: `git commit -am "chore(cli): bump version to <new-version>"`

7. **Present findings to the user**:
   Show:
   - Current version
   - Summary of changes (grouped by type)
   - Recommended new version and why
   - Ask if they want to proceed with the suggested version, a different bump level, or cancel

   Options should be:
   - The recommended version, such as cli-v1.2.0 - Minor release (Recommended)
   - Alternative versions if applicable, such as cli-v2.0.0 - Major release or cli-v1.1.1 - Patch release
   - Cancel - Do not create a release

8. **Create the tag** (if user approves):
   - Create an annotated tag: `git tag -a <new-version> -m "Release <new-version>"`
   - Ask if the user wants to push the tag to origin

9. **Push the changes** (if requested):
   - Run `git push origin main` to push the version bump commit
   - Run `git push origin <new-version>` to push the tag
   - Confirm success to the user
   - Note: Pushing the tag will trigger the release workflow

## Important Notes

- NEVER force push or use `--force` flags
- Always use annotated tags (`-a` flag) for releases
- The tag message should be "Release {version}" where {version} is the new version number
- If anything goes wrong, explain the error and do not proceed
- The Cargo.toml version should match the git tag (without the 'cli-v' prefix, e.g., tag cli-v1.2.0 → Cargo.toml "1.2.0")
- Only commits affecting `todu-fit-cli/` or `todu-fit-core/` are considered for the changelog and version bump
