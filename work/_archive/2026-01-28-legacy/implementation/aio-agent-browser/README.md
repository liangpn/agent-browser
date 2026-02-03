# AIO Sandbox + agent-browser

This deploys a custom AIO Sandbox image with `agent-browser` preinstalled inside the container, so you can:
- Watch browser actions via AIO VNC (`/vnc/index.html`)
- Drive the same visible Chromium via `agent-browser --cdp 9222 ...` executed inside AIO (`/v1/shell/exec` or MCP)

## Quick Start

From repo root:

```bash
docker compose -f deploy/aio-agent-browser/docker-compose.yml up -d --build
```

Open VNC:

```text
http://localhost:8080/vnc/index.html?autoconnect=true
```

## Smoke Test (open → snapshot → click)

All commands are executed inside the container via AIO Shell API (`POST /v1/shell/exec`).

### 1) open

```bash
curl -sS -X POST "http://localhost:8080/v1/shell/exec" \
  -H "Content-Type: application/json" \
  -d '{"command":"AGENT_BROWSER_SESSION=u1 agent-browser --cdp 9222 open https://example.com --json"}'
```

### 2) snapshot (get clickable refs)

```bash
curl -sS -X POST "http://localhost:8080/v1/shell/exec" \
  -H "Content-Type: application/json" \
  -d '{"command":"AGENT_BROWSER_SESSION=u1 agent-browser --cdp 9222 snapshot -i --json"}'
```

Find a ref like `@e2` in the returned output, then click it.

### 3) click

```bash
curl -sS -X POST "http://localhost:8080/v1/shell/exec" \
  -H "Content-Type: application/json" \
  -d '{"command":"AGENT_BROWSER_SESSION=u1 agent-browser --cdp 9222 click @e2 --json"}'
```

If you need to reset the session:

```bash
curl -sS -X POST "http://localhost:8080/v1/shell/exec" \
  -H "Content-Type: application/json" \
  -d '{"command":"AGENT_BROWSER_SESSION=u1 agent-browser --cdp 9222 close --json"}'
```

## Use From MCP Clients (Cursor, etc.)

Connect your MCP client to:

```text
http://<host>:<port>/mcp
```

Then call the terminal tool (tool name depends on your MCP client) to execute:

```text
AGENT_BROWSER_SESSION=u1 agent-browser --cdp 9222 open https://example.com --json
```

### Tool exposure note

This "full" profile keeps the AIO base image's default MCP Hub configuration.
That means `/mcp` exposes the full built-in tool surface (for example, sandbox + browser tools; typically ~33 tools).

If you want `/mcp` to expose only a single restricted tool for running `agent-browser`, use:
- `deploy/aio-agent-browser-slim/README.md`

## Troubleshooting

### MCP error: cannot access local variable 'working_dir'

If you see an error like `cannot access local variable 'working_dir'` when calling the built-in MCP shell tool without a `cwd`, your AIO base image is too old.

This deployment defaults to `ghcr.io/agent-infra/sandbox:1.0.0.152` (or newer), which contains the fix.

### Daemon path / layout

`agent-browser` searches for `daemon.js` in this order:
- `<exe_dir>/daemon.js`
- `<exe_dir>/../dist/daemon.js`
- `dist/daemon.js` (relative to CWD)

This image installs:
- `/opt/agent-browser/bin/agent-browser`
- `/opt/agent-browser/dist/daemon.js` (so `../dist/daemon.js` resolves correctly)

### CDP connection / remote debugging

- Ensure `BROWSER_REMOTE_DEBUGGING_PORT=9222` (set in `deploy/aio-agent-browser/docker-compose.yml`).
- You can verify AIO reports CDP info via:

```bash
curl -sS "http://localhost:8080/v1/browser/info"
```

## Notes and Safety

- For remote deployment, enable AIO auth (`JWT_PUBLIC_KEY`) and avoid exposing `:8080` directly to the public Internet.
- This MVP drives a single visible desktop/browser in the container; multi-user visual isolation is a later phase.
