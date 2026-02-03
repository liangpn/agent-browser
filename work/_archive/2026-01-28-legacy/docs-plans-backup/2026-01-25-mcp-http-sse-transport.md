# MCP HTTP/SSE Transport Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `deploy/aio-agent-browser-minimal/mcp-agent-browser-tool.mjs` MCP stdio JSON-RPC server with a streamable HTTP transport (POST + SSE).

**Architecture:** Run a standalone Node.js HTTP server (no dependencies) that accepts JSON-RPC 2.0 requests via `POST /mcp/messages` and emits JSON-RPC responses on a per-session SSE stream at `GET /sse`. Maintain a `Map(sessionId → ServerResponse)` for SSE connections.

**Tech Stack:** Node.js `http` module, SSE (`text/event-stream`), JSON-RPC 2.0, Vitest for tests.

---

### Task 1: Add failing HTTP/SSE tests

**Files:**
- Create: `test/mcp-agent-browser-tool-http.test.ts`
- Modify: `deploy/aio-agent-browser-minimal/mcp-agent-browser-tool.mjs` (add test exports only if needed)

**Step 1: Write the failing test**

Create `test/mcp-agent-browser-tool-http.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createServerForTest } from "../deploy/aio-agent-browser-minimal/mcp-agent-browser-tool.mjs";

async function readFirstSseEvent(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("SSE stream ended before first event");
    buf += decoder.decode(value, { stream: true });
    const idx = buf.indexOf("\n\n");
    if (idx !== -1) return buf.slice(0, idx);
  }
}

describe("mcp-agent-browser-tool HTTP/SSE transport", () => {
  let close: undefined | (() => Promise<void>);

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("emits initialize response via SSE", async () => {
    const srv = await createServerForTest({ port: 0 });
    close = srv.close;

    const sessionId = "s1";
    const sseRes = await fetch(`${srv.baseUrl}/sse?sessionId=${sessionId}`, {
      headers: { Accept: "text/event-stream" },
    });
    expect(sseRes.ok).toBe(true);

    const postRes = await fetch(`${srv.baseUrl}/mcp/messages?sessionId=${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(postRes.status).toBe(202);

    const evt = await readFirstSseEvent(sseRes.body!);
    expect(evt).toContain("event: message");
    expect(evt).toContain('"jsonrpc":"2.0"');
    expect(evt).toContain('"id":1');
    expect(evt).toContain('"result"');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test test/mcp-agent-browser-tool-http.test.ts`

Expected: FAIL (module export missing, or HTTP server not implemented yet).

---

### Task 2: Implement HTTP/SSE MCP server (minimal to pass tests)

**Files:**
- Modify: `deploy/aio-agent-browser-minimal/mcp-agent-browser-tool.mjs`

**Step 1: Implement minimal HTTP server**

- Replace stdio parsing (`startStdioServer`, `consumeStdioLines`) with:
  - `startHttpServer()` / `createHttpServer()` using `node:http`
  - `GET /sse` registers sessionId, sets SSE headers, sends heartbeats
  - `POST /mcp/messages` parses JSON body and calls JSON-RPC handler
- Update response writing:
  - `writeJsonRpc(message)` becomes `sendJsonRpc({ sessionId, message })` which emits SSE:
    - `event: message\ndata: ${JSON.stringify(message)}\n\n`

**Step 2: Run test to verify it passes**

Run: `pnpm test test/mcp-agent-browser-tool-http.test.ts`

Expected: PASS

---

### Task 3: Config + docs migration

**Files:**
- Modify: `deploy/aio-agent-browser-minimal/docker-compose.yml`
- Modify: `deploy/aio-agent-browser-minimal/mcp-hub.json`
- Modify: `deploy/aio-agent-browser-minimal/README.md`

**Step 1: Update docker-compose**

- Add `ports: - "8079:8079"`
- Add env `MCP_AGENT_BROWSER_PORT=8079`
- Remove `MCP_HUB_WAIT_PORTS`

**Step 2: Disable MCP Hub config**

Set `deploy/aio-agent-browser-minimal/mcp-hub.json` to:

```json
{ "mcpServers": {} }
```

**Step 3: Update README with curl + SSE flow**

- Provide two-terminal workflow:
  - Terminal A: `curl -N http://localhost:8079/sse?sessionId=s1`
  - Terminal B: `curl -X POST http://localhost:8079/mcp/messages?sessionId=s1 -d '{...}'`

**Step 4: Run targeted doc smoke test**

- Confirm `initialize` and `tools/list` responses appear on SSE stream.

---

### Task 4: Full verification

**Step 1: Run full test suite**

Run: `pnpm test`

Expected: PASS

**Step 2: Validate docker build**

Run: `docker build -f deploy/aio-agent-browser-minimal/Dockerfile -t aio-agent-browser-minimal:test .`

Expected: Build succeeds.
