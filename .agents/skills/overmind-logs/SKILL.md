---
name: overmind-logs
description: Access service logs from overmind-managed tmux panes. Use when you need to read hono logs for magic links, check vite errors, or inspect sync server output.
---

# Overmind Logs

Overmind runs each service in a tmux pane with a custom socket. To capture logs programmatically:

## Find the Active Socket

```bash
TMUX_SOCK=$(ls -t /tmp/tmux-$(id -u)/overmind-todu-fit-* 2>/dev/null | head -1)
```

## Capture Pane Output

```bash
# Last 50 lines from hono
tmux -L "$(basename $TMUX_SOCK)" capture-pane -t todu-fit:hono -p -S -50

# Last 100 lines from vite
tmux -L "$(basename $TMUX_SOCK)" capture-pane -t todu-fit:vite -p -S -100

# Last 50 lines from sync
tmux -L "$(basename $TMUX_SOCK)" capture-pane -t todu-fit:sync -p -S -50
```

## Common Searches

### Magic Link (for login)

```bash
TMUX_SOCK=$(ls -t /tmp/tmux-$(id -u)/overmind-todu-fit-* 2>/dev/null | head -1)
tmux -L "$(basename $TMUX_SOCK)" capture-pane -t todu-fit:hono -p -S -100 | grep -A1 "Magic Link:"
```

**Note:** Magic link tokens may wrap across lines. Capture more context and concatenate if needed:

```bash
tmux -L "$(basename $TMUX_SOCK)" capture-pane -t todu-fit:hono -p -S -100 | grep -A2 "MAGIC LINK EMAIL"
```

### Auth Errors

```bash
tmux -L "$(basename $TMUX_SOCK)" capture-pane -t todu-fit:hono -p -S -100 | grep -i "error\|denied\|not allowed"
```

### Vite Build Errors

```bash
tmux -L "$(basename $TMUX_SOCK)" capture-pane -t todu-fit:vite -p -S -100 | grep -i "error\|failed"
```

## One-Liner Template

```bash
TMUX_SOCK=$(ls -t /tmp/tmux-$(id -u)/overmind-todu-fit-* 2>/dev/null | head -1) && tmux -L "$(basename $TMUX_SOCK)" capture-pane -t todu-fit:SERVICE -p -S -LINES
```

Replace `SERVICE` with `hono`, `vite`, or `sync`. Replace `LINES` with number of lines to capture.

## Interactive Access

For scrolling through full history:

```bash
make connect-hono   # Ctrl+b [ to scroll, q to exit, Ctrl+b d to detach
make connect-vite
make connect-sync
```
