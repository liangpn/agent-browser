# AIO Sandbox Slim + agent-browser (Only One MCP Tool)

This is a slim profile for AIO Sandbox:
- Keep VNC + Chromium (CDP 9222) for visual inspection.
- Keep `/mcp`, but expose **only one tool**: `sandbox_execute_bash`.
- The tool is **restricted**: it can only run `agent-browser` with an allowlist of subcommands and safe parsing (no shell).

## Run

From repo root:

```bash
docker compose -f deploy/aio-agent-browser-slim/docker-compose.yml up -d --build
```

Open VNC:

```text
http://localhost:8081/vnc/index.html?autoconnect=true
```

## Use From MCP (Cursor, etc.)

Point your MCP client to:

```text
http://<host>:8081/mcp
```

You should only see one tool: `sandbox_execute_bash`.

## Quick Verify (curl)

`/mcp` requires the client to accept both `application/json` and `text/event-stream`:

```bash
curl -sS -N "http://localhost:8081/mcp" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Then drive the built-in AIO UI (guaranteed reachable inside the container):

```bash
curl -sS -N "http://localhost:8081/mcp" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sandbox_execute_bash","arguments":{"cmd":"AGENT_BROWSER_SESSION=u1 agent-browser open http://127.0.0.1:8080/"}}}'
```

## Drive Browser (agent-browser via restricted bash tool)

Call `sandbox_execute_bash` with:

```text
cmd = AGENT_BROWSER_SESSION=u1 agent-browser --cdp 9222 open https://example.com --json
```

Then:

```text
cmd = AGENT_BROWSER_SESSION=u1 agent-browser --cdp 9222 snapshot -i --json
cmd = AGENT_BROWSER_SESSION=u1 agent-browser --cdp 9222 click @e1 --json
cmd = AGENT_BROWSER_SESSION=u1 agent-browser --cdp 9222 close --json
```

## Restrictions

- Only `agent-browser` is allowed (other commands are rejected).
- CDP port is forced to `9222`.
- Allowed subcommands: `open`, `snapshot`, `click`, `dblclick`, `type`, `fill`, `press`, `hover`, `focus`, `check`, `uncheck`, `select`, `wait`, `screenshot`, `close`.
- Shell metacharacters (`; | & > <`, newlines, command substitution) are rejected.
