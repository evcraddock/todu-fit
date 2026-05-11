---
name: web-release
description: Create a new web release tag based on conventional commits. Use when user says "web release", "release web", "release the web", "new web version", "deploy web", or similar.
---

# Web Release

Create a new web release tag (`web-v*`) based on conventional commits affecting `web/` since the last release.

**Note:** This is for web releases only. CLI releases use `cli-v*` tags and the `cli-release` skill.

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

2. **Get the current web release tag**:
   - Run `git tag --list 'web-v*' --sort=-v:refname | head -1` to get the latest web tag
   - If no web tags exist, assume starting from web-v0.0.0

3. **Get changes to `web/` since the last tag**:
   - Run `git log <latest-tag>..HEAD --oneline -- web/` to see commits affecting web/
   - If there are no commits affecting web/ since the last tag, inform the user and stop

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

   If no version-bumping commits are found (only chore:, docs:, etc.), default to PATCH.

5. **Calculate the new version**:
   - Parse the current version, for example web-v1.2.3 becomes major=1, minor=2, patch=3
   - Apply the appropriate bump:
     - MAJOR: increment major, reset minor and patch to 0
     - MINOR: increment minor, reset patch to 0
     - PATCH: increment patch only

6. **Update web/package.json version**:
   - Before creating the tag, update the "version" field in web/package.json to match (without the 'web-v' prefix)
   - Commit the version bump: `git commit -am "chore(web): bump version to <new-version>"`

7. **Present findings to the user**:
   Show:
   - Current version
   - Summary of changes (grouped by type)
   - Recommended new version and why
   - Ask if they want to proceed with the suggested version, a different bump level, or cancel

   Options should be:
   - The recommended version, such as web-v1.2.0 - Minor release (Recommended)
   - Alternative versions if applicable, such as web-v2.0.0 - Major release or web-v1.1.1 - Patch release
   - Cancel - Do not create a release

8. **Create the tag** (if user approves):
   - Create an annotated tag: `git tag -a <new-version> -m "Release <new-version>"`
   - Ask if the user wants to push the tag to origin

9. **Push the changes** (if requested):
   - Run `git push origin main` to push the version bump commit
   - Run `git push origin <new-version>` to push the tag
   - Confirm success to the user
   - Note: Pushing the tag will trigger the web-deploy workflow, which builds and pushes the Docker image to DockerHub

## Important Notes

- NEVER force push or use `--force` flags
- Always use annotated tags (`-a` flag) for releases
- The tag message should be "Release {version}" where {version} is the new version number (e.g., "Release web-v1.2.0")
- If anything goes wrong, explain the error and do not proceed
- The web/package.json version should match the git tag (without the 'web-v' prefix, e.g., tag web-v1.2.0 → package.json "1.2.0")
- Only commits affecting `web/` are considered for the changelog and version bump
