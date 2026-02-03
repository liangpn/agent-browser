# AIO Sandbox Minimal + agent-browser (Single Structured MCP Tool)

This is a minimal profile for AIO Sandbox:
- Keep VNC + Chromium (CDP 9222) for visual inspection.
- Keep `/mcp`, but expose only one tool: `agent_browser`.
- The tool is structured (no `cmd` string) and runs `agent-browser` via `spawn(..., { shell: false })`.

Notes / decisions:
- Path blocking is not handled in this profile (recommend blocking sensitive `/v1/*` routes at the reverse-proxy layer in production).
- `gem-server` is intentionally kept to avoid breaking JWT-based auth chain in the base image.
- URL access is allowed (no outbound proxy by default). `tinyproxy` is disabled.

## Run

From repo root:

```bash
docker compose -f deploy/aio-agent-browser-minimal/docker-compose.yml up -d --build
```

Open VNC:

```text
http://localhost:8082/vnc/index.html?autoconnect=true
```

## Smoke Test (tools/list → open → snapshot → click → close)

This profile exposes the MCP server directly over streamable HTTP:
- `GET /sse` for the SSE stream
- `POST /mcp/messages` for JSON-RPC requests

The transport-level `sessionId` associates `POST` requests with a specific SSE connection.
The tool-level `session_id` is the agent-browser session identifier used inside the container.

### 1) Terminal A: Connect SSE stream

```bash
curl -sS -N "http://localhost:8079/sse?sessionId=s1" \
  -H "Accept: text/event-stream"
```

You should see an initial `ready` event, then periodic `ping` events.

### 2) Terminal B: Send JSON-RPC requests (responses arrive on Terminal A)

Verify only one tool exists:

```bash
curl -sS "http://localhost:8079/mcp/messages?sessionId=s1" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Drive the built-in AIO UI (always reachable inside the container):

```bash
curl -sS "http://localhost:8079/mcp/messages?sessionId=s1" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"agent_browser","arguments":{"session_id":"u1","subcommand":"open","args":["http://127.0.0.1:8080/"]}}}'

curl -sS "http://localhost:8079/mcp/messages?sessionId=s1" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"agent_browser","arguments":{"session_id":"u1","subcommand":"snapshot","args":["-i"]}}}'

curl -sS "http://localhost:8079/mcp/messages?sessionId=s1" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"agent_browser","arguments":{"session_id":"u1","subcommand":"click","args":["@e1"]}}}'

curl -sS "http://localhost:8079/mcp/messages?sessionId=s1" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"agent_browser","arguments":{"session_id":"u1","subcommand":"close","args":[]}}}'
```

## Security Notes

- This profile removes string-based shell execution from the exposed MCP surface: there is no `cmd` parameter and no shell.
- The server enforces a subcommand allowlist and uses `spawn()` with `shell: false`.
- Stdout/stderr are truncated to ~30KB to avoid unbounded output flooding.
- This profile does not attempt to harden all AIO HTTP endpoints; restrict or block sensitive routes (for example `/v1/shell/exec`) at the reverse proxy in production.
