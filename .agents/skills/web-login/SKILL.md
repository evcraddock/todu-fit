---
name: web-login
description: Login to the local web app using magic link authentication. Use when needing to authenticate with the web app at localhost:5173.
---

# Web Login

Login to the todu-fit-web app using magic link authentication.

## Prerequisites

- Dev server running (`make status` to check)
- Browser open via browser-tools skill

## Steps

1. **Get login URL and email** - Use overmind-logs skill to capture hono output. Look for the "DEV LOGIN" banner which shows both the login URL and allowed email. Use `tail` to get the most recent if there are multiple:
   ```bash
   TMUX_SOCK=$(ls -t /tmp/tmux-$(id -u)/overmind-todu-fit-* 2>/dev/null | head -1) && tmux -L "$(basename $TMUX_SOCK)" capture-pane -t todu-fit:hono -p -S -200 | grep -A3 "DEV LOGIN" | tail -4
   ```

2. **Navigate to login page** - Use the URL from step 1
   ```bash
   browser-nav.js URL_FROM_LOGS
   ```

3. **Check if already logged in** - take screenshot, look for "Logout" in nav. If present, done.

4. **Fill email** - Use react-form-fill skill with selector `input[type=email]` and the email from step 1.

5. **Click Send Magic Link**
   ```bash
   browser-eval.js 'Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Magic Link")).click()'
   ```

6. **Get magic link** - Capture with extra lines since tokens wrap. Use `tail` to get the most recent if there are multiple:
   ```bash
   TMUX_SOCK=$(ls -t /tmp/tmux-$(id -u)/overmind-todu-fit-* 2>/dev/null | head -1) && tmux -L "$(basename $TMUX_SOCK)" capture-pane -t todu-fit:hono -p -S -100 | grep -A5 "MAGIC LINK EMAIL" | tail -6
   ```
   The token continues on the line after "Magic Link:" - concatenate both parts (remove the newline).

7. **Navigate to magic link**
   ```bash
   browser-nav.js "MAGIC_LINK_URL_FROM_LOGS"
   ```

8. **Verify login** - take screenshot, should see app nav (Meals, Dishes, Settings, Logout)
