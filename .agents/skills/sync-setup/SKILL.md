---
name: sync-setup
description: Set up CLI and web app to share the same Automerge identity for sync testing. Use when needing to test sync between CLI and web, or when user says "sync setup", "connect CLI to web", "share identity", or similar.
---

# Sync Setup

Sets up the CLI (`fit`) and web app to share the same Automerge identity, enabling data sync between them via the sync server.

**All commands assume you're in the project root directory.**

---

## Step 0: Verify environment is running

```bash
make status
```

This shows process status for vite, hono, sync.

If not running, start the dev environment with `make dev` or test environment with `make test-env`.

**Set the config file** for subsequent commands:
```bash
# For dev environment
CLI_CONFIG=config.dev.yaml

# For test environment
CLI_CONFIG=config.test.yaml
```

---

## Step 1: Get CLI root_doc_id

Get CLI identity (initializes if needed):

```bash
CLI_ROOT_DOC_ID=$(./target/release/fit -c $CLI_CONFIG device show 2>/dev/null | grep -E "^ID:" | awk '{print $2}')
if [ -z "$CLI_ROOT_DOC_ID" ]; then
  ./target/release/fit -c $CLI_CONFIG init --new
  CLI_ROOT_DOC_ID=$(./target/release/fit -c $CLI_CONFIG device show | grep -E "^ID:" | awk '{print $2}')
fi
echo $CLI_ROOT_DOC_ID
```

Create a group if none exists (required for dishes/meals):

```bash
GROUP_COUNT=$(./target/release/fit -c $CLI_CONFIG device show 2>/dev/null | grep "Groups:" | awk '{print $2}')
if [ "$GROUP_COUNT" = "0" ]; then
  ./target/release/fit -c $CLI_CONFIG group create "Default"
fi
```

---

## Step 2: Login to web app

Use the **web-login skill** to authenticate at http://localhost:5173

---

## Step 3: Detect web state

After login, check which screen appears:

```bash
browser-eval.js 'document.querySelector("h2")?.textContent || ""'
```

- Contains "Set Up Your Identity" → Go to **Step 4A**
- Otherwise (app nav visible) → Go to **Step 4B**

---

## Step 4A: Join via IdentitySetup (new web user)

Click the "Enter an identity ID from another device" button.

Wait 1 second, then fill the identity ID using **react-form-fill skill** with:
- Selector: `#root-doc-id`
- Value: `$CLI_ROOT_DOC_ID` from Step 1

Click "Join Identity":

```bash
browser-eval.js '(() => {
  const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Join Identity") && !b.disabled);
  if (btn) { btn.click(); return "clicked"; }
  return "not found or disabled";
})()'
```

Wait 2 seconds, take screenshot to verify. Go to **Step 5**.

---

## Step 4B: Change via Settings (existing web user)

Navigate to settings:

```bash
browser-nav.js http://localhost:5173/settings
```

Wait 1 second. Check current Root Doc ID:

```bash
browser-eval.js '(() => {
  const text = document.body.innerText;
  const match = text.match(/Root Doc ID[\s\S]*?(\S{20,})/);
  return match ? match[1] : "(not found)";
})()'
```

### If matches CLI_ROOT_DOC_ID
Already synced! Go to **Step 5**.

### If different
Click "Change" next to Root Doc ID:

```bash
browser-eval.js '(() => {
  const btn = Array.from(document.querySelectorAll("button")).find(b =>
    b.textContent.includes("Change") &&
    b.closest("div")?.innerText.includes("Root Doc ID")
  );
  if (btn) { btn.click(); return "clicked"; }
  return "not found";
})()'
```

Wait 1 second, then fill the identity ID using **react-form-fill skill** with:
- Selector: `#new-root-doc-id`
- Value: `CLI_ROOT_DOC_ID` from Step 1

Click "Confirm Change":

```bash
browser-eval.js '(() => {
  const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Confirm Change") && !b.disabled);
  if (btn) { btn.click(); return "clicked"; }
  return "not found or disabled";
})()'
```

Wait 3 seconds (page reloads). Take screenshot to verify.

---

## Step 5: Verify sync

Create a test dish via CLI:

```bash
./target/release/fit -c $CLI_CONFIG dish create 'Sync Test Dish'
./target/release/fit -c $CLI_CONFIG sync
```

Navigate to dishes page:

```bash
browser-nav.js http://localhost:5173/dishes
```

Wait 2 seconds, then verify:

```bash
browser-eval.js 'document.body.innerText.includes("Sync Test Dish") ? "SUCCESS" : "FAILED"'
```

### Cleanup

```bash
echo "y" | ./target/release/fit -c $CLI_CONFIG dish delete 'Sync Test Dish'
./target/release/fit -c $CLI_CONFIG sync
```

---

## Troubleshooting

### Sync not working

1. Check sync server:
   ```bash
   curl -s http://localhost:8080 || echo "Sync server not responding"
   ```

2. Force CLI sync:
   ```bash
   ./target/release/fit -c $CLI_CONFIG sync
   ```

3. Refresh web app and check browser console for errors

### Need to start fresh

Ask user to stop services first, then:

```bash
# For dev environment
make reset

# For test environment
make test-reset
```

Then ask user to restart services.

---

## Quick Reference

| Action | Command |
|--------|---------|
| Start dev env | `make dev` |
| Start test env | `make test-env` |
| Check status | `make status` |
| Get CLI identity | `./target/release/fit -c $CLI_CONFIG device show` |
| Init CLI | `./target/release/fit -c $CLI_CONFIG init --new` |
| Create group | `./target/release/fit -c $CLI_CONFIG group create 'Name'` |
| List groups | `./target/release/fit -c $CLI_CONFIG group list` |
| Sync CLI | `./target/release/fit -c $CLI_CONFIG sync` |
| List dishes | `./target/release/fit -c $CLI_CONFIG dish list` |
| Create dish | `./target/release/fit -c $CLI_CONFIG dish create 'Name'` |
| Delete dish | `echo "y" \| ./target/release/fit -c $CLI_CONFIG dish delete 'Name'` |
