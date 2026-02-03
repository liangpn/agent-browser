---
name: browser-shell
description: Use the MCP tool `browser-shell` to run an allowlisted subset of `agent-browser` commands against the in-container Chromium (CDP 9222).
---

# Browser Automation with browser-shell

## When to use

Use `browser-shell` when you need to call a single MCP tool to drive `agent-browser`.

## Quick start

Call the MCP tool named `browser-shell` with arguments:

```json
{ "session_id": "u1", "argv": ["open", "https://example.com"], "timeout_sec": 30 }
```

```json
{ "session_id": "u1", "argv": ["snapshot", "-i"], "timeout_sec": 30 }
```

```json
{ "session_id": "u1", "argv": ["click", "@e1"], "timeout_sec": 30 }
```

```json
{ "session_id": "u1", "argv": ["close"], "timeout_sec": 30 }
```

## Input

- `session_id`: `[a-zA-Z0-9._-]{1,64}`
- `argv`: array (CLI-like)
  - `argv[0]`: subcommand (allowlist only)
  - `argv[1...]`: subcommand args (number/boolean are coerced to strings)
- `timeout_sec`: optional (default 30, max 120)
- Do not include `--cdp`, `--json`, `--session` anywhere in `argv` (forbidden)

## Output

`tools/call` returns `content[0].text` where `text` is a JSON dictionary string. Parse it as JSON, then:

- The dictionary keys are: `session_id`, `exit_code`, `stdout`, `stderr`
- Use `stdout` / `stderr` for the underlying `agent-browser` output (may be truncated)
- When `stdout` is JSON, it is already the **data-only** JSON payload. Parse `stdout` once to get the result.
- Errors are surfaced via `stderr` and a non-zero `exit_code`.
- Use `exit_code` to detect success/timeout quickly (`0` success, `124` timeout)

## Commands (allowed, P0)

Each command is passed via `argv`.

- `open <url>` → `["open", "https://example.com"]`
- `snapshot` → `["snapshot"]` or `["snapshot", "-i"]`
- `click <sel|@ref>` → `["click", "@e1"]`
- `fill <sel|@ref> <text>` → `["fill", "@e2", "text"]`
- `type <sel|@ref> <text>` → `["type", "@e2", "text"]`
- `press <key>` → `["press", "Enter"]`
- `wait <sel|@ref|ms>` → `["wait", "@e1"]` or `["wait", "2000"]`
- `screenshot [path]` → `["screenshot"]` or `["screenshot", "page.png"]`
- `close` → `["close"]`

### snapshot options

`snapshot` only allows these options:

- `-i` / `--interactive`
- `-c` / `--compact`
- `-d` / `--depth <n>`
- `-s` / `--selector <css>`

## Core workflow

1. `open` a URL
2. `snapshot -i` to get refs (`@e1`, `@e2`, ...)
3. Use refs to `click` / `fill` / `type`
4. Re-run `snapshot -i` after navigation or major DOM changes
5. `close` at the end
