# MCP HTTP/SSE Transport Test Coverage Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add complete Vitest coverage for MCP HTTP/SSE transport: `tools/list`, boundary cases (no SSE client, timeout, concurrency isolation), plus an optional end-to-end `tools/call` flow guarded by environment checks.

**Architecture:** Extend `test/mcp-agent-browser-tool-http.test.ts` to reuse existing SSE helpers (`createSseEventReader`, `parseSseMessageData`) and validate server behavior via real `fetch()` calls against `createServerForTest()` (random port). Keep browser-dependent tests behind `describe.skipIf(...)`.

**Tech Stack:** Vitest, Node.js `fetch`, SSE (`text/event-stream`), JSON-RPC 2.0.

---

### Task 1: Add `tools/list` SSE test

**Files:**
- Modify: `test/mcp-agent-browser-tool-http.test.ts`

**Step 1: Write the failing test**

- Add a new test case:
  - Connect `GET /sse?sessionId=s1`
  - `POST /mcp/messages?sessionId=s1` with `{ method: "tools/list" }`
  - Read `event: message` SSE payload and assert `result.tools` contains `agent_browser`

**Step 2: Run test to verify it fails**

Run: `pnpm test test/mcp-agent-browser-tool-http.test.ts -t tools/list`

Expected: FAIL (until test logic is correct).

**Step 3: Adjust test to pass**

- Ensure the reader skips `ready`/`ping` events and only parses `message`.

**Step 4: Re-run test**

Run: `pnpm test test/mcp-agent-browser-tool-http.test.ts -t tools/list`

Expected: PASS.

---

### Task 2: Add boundary case tests (no SSE client, concurrency isolation, same-session replacement)

**Files:**
- Modify: `test/mcp-agent-browser-tool-http.test.ts`

**Step 1: Write failing tests**

- Add tests:
  - No SSE client: `POST /mcp/messages` returns `409`
  - Different `sessionId` isolation: `s1` request only appears on `s1` stream (and not `s2`)
  - Same `sessionId` replacement: second `GET /sse` for same session replaces the first; `POST` response appears on new stream

**Step 2: Run tests to verify they fail**

Run: `pnpm test test/mcp-agent-browser-tool-http.test.ts -t \"no active SSE\"`

Expected: FAIL (until assertions and timing are correct).

**Step 3: Make tests robust**

- Add helpers:
  - `waitForSseMessageWithId(...)` to read until matching JSON-RPC `id`
  - `expectNoSseMessageWithId(...)` with short timeout for negative assertions

**Step 4: Re-run file**

Run: `pnpm test test/mcp-agent-browser-tool-http.test.ts`

Expected: PASS.

---

### Task 3: Add optional E2E browser flow (`tools/call`) with environment detection

**Files:**
- Modify: `test/mcp-agent-browser-tool-http.test.ts`

**Step 1: Add environment detection helper**

- Detect `agent-browser` availability (e.g., `command -v agent-browser`)
- Detect CDP port `9222` availability (e.g., `GET http://127.0.0.1:9222/json/version`)

**Step 2: Write E2E test behind `describe.skipIf`**

- Workflow:
  - Connect SSE for `sessionId=s1`
  - `POST initialize`
  - `POST tools/call` for `open`, `fill`, `click` (or `snapshot` if required by CLI flow)
  - Assert each response is a JSON-RPC `result` with a `content[0].text` JSON string containing `exit_code`

**Step 3: Run and confirm skip behavior**

Run: `pnpm test test/mcp-agent-browser-tool-http.test.ts`

Expected: PASS locally; E2E suite shows as skipped when environment is missing.

---

### Task 4: Full verification

**Step 1: Run full test suite**

Run: `pnpm test`

Expected: PASS.

