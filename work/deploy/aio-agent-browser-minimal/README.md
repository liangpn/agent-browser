# Minimal AIO + agent-browser

Derived image on top of `ghcr.io/agent-infra/sandbox:latest` that:

- Exposes only `/mcp`, VNC endpoints, and `/tickets` (everything else returns `403`)
- Exposes exactly one MCP tool: `browser-shell`
- Runs `agent-browser` inside the container against CDP `9222`

## References (upstream repos)

- Source repo list: `work/docs/references.md`
- AIO base image source: `https://github.com/agent-infra/sandbox`
- `browser-shell` safety model references Vercel bash-tool’s **hook** idea (onBefore/onAfter), but does not import it: `https://github.com/vercel-labs/bash-tool`

## What this image overrides in AIO (high level)

- MCP hub template: replaces `/opt/gem/mcp-hub.json.template` to only expose `browser-shell`
- Nginx templates/snippets:
  - Overrides `/opt/gem/nginx.legacy.conf` and `/opt/gem/nginx.srv.conf`
  - Adds `/opt/gem/nginx/zz_deny_all.conf` to force `403` for non-allowlisted routes
  - Removes some default route snippets under `/opt/gem/nginx/` to avoid accidental exposure

## Quick start

```bash
docker compose -f work/deploy/aio-agent-browser-minimal/docker-compose.yml up --build
```

If port `8080` is already in use on your host:

```bash
HOST_PORT=8082 docker compose -f work/deploy/aio-agent-browser-minimal/docker-compose.yml up --build
```

### Build vs run (when to use `--build`)

This Compose file declares both `build:` and `image:`:

- `image: aio-agent-browser-minimal:dev` (the tag to create/use locally)
- `build: ...` (how to build that image from this repo)

What it means in practice:

- First run (or after code changes): use `up --build` to (re)build the image and start the container.
- Subsequent runs (no code changes): omit `--build` to start quickly using the already-built image.
- `HOST_PORT` controls the host-side port (`HOST_PORT:8080`). The container always listens on `8080`.

Common commands:

```bash
# Build once (creates/updates aio-agent-browser-minimal:dev)
docker compose -f work/deploy/aio-agent-browser-minimal/docker-compose.yml build

# Start using the existing image (no rebuild)
HOST_PORT=8082 docker compose -f work/deploy/aio-agent-browser-minimal/docker-compose.yml up -d

# Follow logs
docker compose -f work/deploy/aio-agent-browser-minimal/docker-compose.yml logs -f

# Stop and remove container/network (keeps images)
docker compose -f work/deploy/aio-agent-browser-minimal/docker-compose.yml down
```

Then open:

- MCP Hub (streamable HTTP): `http://localhost:<HOST_PORT>/mcp` (default `8080`)
- VNC: `http://localhost:<HOST_PORT>/vnc/index.html?autoconnect=true` (default `8080`)

## MCP tool usage

This image exposes a single MCP tool: `browser-shell`.

### `/mcp` "Not Acceptable" note

`/mcp` is **MCP Streamable HTTP**. If you open it in a browser (or use a client that does not accept SSE),
you may see an error like:

`Not Acceptable: Client must accept text/event-stream`

Ensure your MCP client sends an `Accept` header that includes `text/event-stream` (and `application/json`).

`browser-shell` takes a structured arguments object (no shell command strings):

```json
{
  "session_id": "u1",
  "argv": ["open", "https://example.com"],
  "timeout_sec": 30
}
```

The tool response is returned as `content[0].text`, where `text` is a JSON dictionary string.
It includes `stdout` / `stderr` (possibly truncated). The server runs `agent-browser` in `--json` mode and normalizes its JSON output so `stdout` is **data-only JSON** (and errors are surfaced via `stderr` + non-zero `exit_code`).

### Minimal curl examples

```bash
BASE=http://localhost:8082

# tools/list
curl -sS -H 'Accept: application/json, text/event-stream' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  $BASE/mcp

# tools/call: open
curl -sS -H 'Accept: application/json, text/event-stream' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"browser-shell","arguments":{"session_id":"u1","argv":["open","https://example.com"]}}}' \
  $BASE/mcp
```

## URL policy configuration

Mount a policy file to `/etc/agent-browser/browser-shell.policy.json`:

```bash
docker run --rm -p 8080:8080 \
  -v "$PWD/browser-shell.policy.json:/etc/agent-browser/browser-shell.policy.json:ro" \
  aio-agent-browser-minimal:dev
```

The policy format and semantics are defined in `work/requirements.md`.

## User-runnable scripts

If pulling/building takes too long, run scripts locally and share the logs under `work/deploy/aio-agent-browser-minimal/_runs/`.

```bash
# Multi-arch build (linux/amd64 + linux/arm64)
bash work/deploy/aio-agent-browser-minimal/scripts/buildx.sh

# Smoke test (starts the container and checks endpoints)
bash work/deploy/aio-agent-browser-minimal/scripts/smoke.sh
```

If you run in a sandboxed environment that cannot write to `~/.docker/`, set a writable Docker config dir:

```bash
DOCKER_CONFIG_DIR=/tmp/docker-config bash work/deploy/aio-agent-browser-minimal/scripts/smoke.sh
```
