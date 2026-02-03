# Minimal AIO + agent-browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Build a derived image on `ghcr.io/agent-infra/sandbox:latest` that exposes only AIO `/mcp` (streamable HTTP), VNC, and `/tickets`, and exposes exactly one MCP tool named `browser-shell` that safely drives `agent-browser` against CDP `9222`.

**Architecture:** Keep AIO as the HTTP surface and process supervisor. Override AIO’s Nginx routing templates to hard-deny all routes except MCP/VNC/tickets, and override AIO’s `mcp-hub.json.template` so MCP Hub only aggregates a single stdio MCP server we ship (`browser-shell`). `browser-shell` spawns `agent-browser` with a strict allowlist and configuration-driven URL policy.

**Tech Stack:** Node.js (MCP stdio server, `child_process.spawn`), existing `agent-browser` Rust+Node runtime, Docker multi-stage builds, AIO Nginx/supervisord conventions.

---

### Task 1: Add deployment skeleton for the Minimal image

**Files:**
- Create: `work/deploy/aio-agent-browser-minimal/README.md`
- Create: `work/deploy/aio-agent-browser-minimal/Dockerfile`
- Create: `work/deploy/aio-agent-browser-minimal/docker-compose.yml`

**Steps:**
1. Create `work/deploy/aio-agent-browser-minimal/` directory structure and minimal README that explains how to run the image.
2. Add `docker-compose.yml` that runs the derived image with AIO-required env defaults and ports (8080→8080), and sets `DISABLE_JUPYTER=true` and `DISABLE_CODE_SERVER=true`.
3. Add placeholders in Dockerfile for the items in Task 2–4.

**Verification:**
- Run: `docker compose -f work/deploy/aio-agent-browser-minimal/docker-compose.yml config`
- Expected: Valid compose config (no errors).

---

### Task 2: Configure MCP Hub to expose only `browser-shell`

**Files:**
- Create: `work/deploy/aio-agent-browser-minimal/mcp-hub.json.template`
- Modify: `work/deploy/aio-agent-browser-minimal/Dockerfile`
- (Optional) Modify: `work/deploy/aio-agent-browser-minimal/docker-compose.yml` (for wait settings)

**Steps:**
1. Create `mcp-hub.json.template` containing exactly one `mcpServers` entry pointing to our stdio server script path (Node + `.mjs`).
2. In Dockerfile, `COPY` the template to `/opt/gem/mcp-hub.json.template` (AIO startup regenerates `/opt/gem/mcp-hub.json` and removes the template).
3. Ensure MCP Hub startup does not hang on removed services:
   - Add `MCP_HUB_WAIT_PORTS=9222` and `FASTAPI_WAIT_SKIP=1` via an override to the AIO supervisord config for MCP Hub (see Task 3), OR keep python-server/mcp-server-browser enabled and leave defaults.

**Verification:**
- (Later integration) `tools/list` should only show `browser-shell`.

---

### Task 3: Restrict external HTTP surface to `/mcp`, VNC, and `/tickets` (403 for everything else)

**Files:**
- Create: `work/deploy/aio-agent-browser-minimal/nginx.deny_all.conf`
- Create: `work/deploy/aio-agent-browser-minimal/nginx.legacy.conf`
- Create: `work/deploy/aio-agent-browser-minimal/nginx.srv.conf`
- Modify: `work/deploy/aio-agent-browser-minimal/Dockerfile`

**Steps:**
1. Add `nginx.deny_all.conf` with:
   - `location / { return 403; }`
2. Override `/opt/gem/nginx.legacy.conf` to block CDP debug endpoints (`/json`, `/devtools/`) with `403`.
3. Override `/opt/gem/nginx.srv.conf` to keep only `/tickets` (remove `/actions`, `/screenshot`, `/cdp`, `/v1/ping` from external routing).
4. Remove AIO’s default route snippets that expose other HTTP surfaces by deleting these files in Dockerfile (if present):
   - `/opt/gem/nginx/nginx.python_srv.conf` (blocks `/v1/*` including `/v1/mcp`)
   - `/opt/gem/nginx/nginx.code_server.conf`
   - `/opt/gem/nginx/nginx.jupyter_lab.conf`
   - `/opt/gem/nginx/nginx.ui_terminal.conf`
   - `/opt/gem/nginx/nginx.aio_index.conf`
5. Copy `nginx.deny_all.conf` to `/opt/gem/nginx/zz_deny_all.conf` so it loads last.

**Verification (image-level, later):**
- Run container, then:
  - `curl -i http://localhost:8080/mcp` → not 403
  - `curl -i http://localhost:8080/vnc/` → not 403
  - `curl -i http://localhost:8080/tickets` → not 403 (may require auth depending on JWT)
  - `curl -i http://localhost:8080/v1/docs` → `403`

---

### Task 4: Implement the `browser-shell` MCP stdio server

**Files:**
- Create: `work/deploy/aio-agent-browser-minimal/browser-shell.mjs`
- Create: `work/deploy/aio-agent-browser-minimal/browser-shell.policy.example.json`
- Modify: `work/deploy/aio-agent-browser-minimal/Dockerfile`
- Test: `work/test/browser-shell-policy.test.ts`
- Test: `work/test/browser-shell-args.test.ts`

**Step 1: Write failing tests (policy + args validation)**

Create tests for:
- Reject `argv` that attempts to set `--cdp` / `--json` / `--session`
- Enforce `session_id` regex and mapping to `agent-browser --session`
- Allowlist subcommands (P0) and denylist (`eval`, `upload`, `route`, etc.)
- `open` URL policy:
  - Only `http/https` (and optional `about:blank`)
  - Deny `localhost`, `127.0.0.1`, `::1`, RFC1918, link-local, ULA after DNS resolve
  - If allowlist hosts/suffixes is present, require match

Run: `pnpm test`
Expected: FAIL (new modules not implemented yet).

**Step 2: Implement minimal modules and make tests pass**

In `browser-shell.mjs`:
1. Implement a small “hooks” runner:
   - `onBefore(request) -> normalized request`
   - `onAfter(request, execResult) -> toolResult`
2. Define the MCP tool:
   - Tool name: `browser-shell`
   - Input schema: `session_id`, `argv`, `timeout_sec`
  - Output: single text content whose text is a JSON dictionary string containing `session_id/exit_code/stdout/stderr` (with truncation)
3. Execution:
   - Build argv: `agent-browser --session <session_id> --cdp 9222 --json <argv...>`
   - Use `spawn(argv, { shell: false })`
   - Enforce timeout (default 30s, max 120s)
4. Policy:
   - Read `/etc/agent-browser/browser-shell.policy.json` if present; otherwise use safe defaults.
   - Only domain/subdomain allowlist (no URL prefix rules).
   - Deny private/local IPs even after DNS resolution.

**Step 3: Wire into the image**

Dockerfile:
- Copy `browser-shell.mjs` to a stable path (e.g. `/opt/agent-browser-mcp/browser-shell.mjs`).
- Copy `browser-shell.policy.example.json` to `/etc/agent-browser/browser-shell.policy.example.json`.
- Ensure `node` can execute the `.mjs` script (base image is Node 22).

**Verification:**
- Local: `pnpm test`
- Later (container): call MCP `tools/list` and `tools/call` against `/mcp`.

---

### Task 5: Package agent-browser runtime into the Minimal image

**Files:**
- Modify: `work/deploy/aio-agent-browser-minimal/Dockerfile`

**Steps:**
1. Add a Node build stage that runs:
   - `pnpm install --frozen-lockfile`
   - `pnpm build`
   - `pnpm install --prod --ignore-scripts` (for runtime `node_modules`)
2. Add a Rust build stage that builds `cli/Cargo.toml` release binary for the target platform.
3. In runtime stage (AIO base):
   - Copy `dist/` and runtime `node_modules/` into `/opt/agent-browser/{dist,node_modules}`
   - Copy `agent-browser` binary into `/opt/agent-browser/bin/agent-browser`
   - Symlink `/usr/local/bin/agent-browser` → that binary

**Verification (local, non-Docker):**
- `node dist/daemon.js --help` (sanity)

**Verification (container, later):**
- `agent-browser --help` inside container should work.

---

### Task 6: Multi-arch build and developer workflow (user-runnable build)

**Files:**
- Create: `work/deploy/aio-agent-browser-minimal/scripts/buildx.sh`
- Create: `work/deploy/aio-agent-browser-minimal/scripts/smoke.sh`
- Modify: `work/deploy/aio-agent-browser-minimal/README.md`

**Steps:**
1. Add `buildx.sh` that builds multi-arch (`linux/amd64,linux/arm64`) and prints the final image digest.
2. Add `smoke.sh` that runs the container and performs basic HTTP checks (`/mcp`, `/vnc/`, `/tickets`, and a blocked endpoint like `/v1/docs`).
3. Document: if pulls/build are slow, user can run these scripts locally and share logs from `work/deploy/aio-agent-browser-minimal/_runs/`.

**Verification:**
- Run: `bash work/deploy/aio-agent-browser-minimal/scripts/buildx.sh` (optional, can be user-run)
- Run: `bash work/deploy/aio-agent-browser-minimal/scripts/smoke.sh` (optional, can be user-run)

---

### Task 7: Update backlog and usage docs

**Files:**
- Modify: `work/backlog.md`
- Modify: `work/deploy/aio-agent-browser-minimal/README.md`

**Steps:**
1. Mark P0 items as `doing/done` as implementation progresses.
2. Add minimal usage examples:
   - MCP `tools/list`
   - MCP `tools/call` for `browser-shell`
   - How to mount `/etc/agent-browser/browser-shell.policy.json`
