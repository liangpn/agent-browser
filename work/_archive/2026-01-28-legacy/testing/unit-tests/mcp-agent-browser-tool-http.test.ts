import { afterEach, describe, expect, it } from "vitest";

import { createServerForTest } from "../deploy/aio-agent-browser-minimal/mcp-agent-browser-tool.mjs";

import { execSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function createSseEventReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return async function readSseEventLines(timeoutMs = 5_000): Promise<string[]> {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        void reader.cancel("timeout");
      } catch {
      }
    }, timeoutMs);

    try {
      while (true) {
        let readResult;
        try {
          readResult = await reader.read();
        } catch (err) {
          if (timedOut) throw new Error("timed out waiting for SSE event");
          throw err;
        }
        const { value, done } = readResult;
        if (done) {
          if (timedOut) throw new Error("timed out waiting for SSE event");
          throw new Error("SSE stream ended unexpectedly");
        }
        buffer += decoder.decode(value, { stream: true });

        const idx = buffer.indexOf("\n\n");
        if (idx !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = raw.split("\n").map((l) => l.replace(/\r$/, ""));
          if (lines.some((l) => l.startsWith("event:"))) return lines;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

function parseSseMessageData(lines: string[]): unknown {
  const dataLines = lines
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice("data:".length).trim());
  return JSON.parse(dataLines.join("\n"));
}

function getSseEventName(lines: string[]): string | undefined {
  const eventLine = lines.find((l) => l.startsWith("event:"));
  if (!eventLine) return undefined;
  return eventLine.slice("event:".length).trim();
}

async function waitForJsonRpcMessage(
  readSseEventLines: (timeoutMs?: number) => Promise<string[]>,
  predicate: (payload: any) => boolean,
  timeoutMs = 5_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const lines = await readSseEventLines(remaining);
    if (getSseEventName(lines) !== "message") continue;
    const payload = parseSseMessageData(lines);
    if (predicate(payload)) return payload;
  }
  throw new Error("timed out waiting for matching JSON-RPC message");
}

async function expectNoJsonRpcMessage(
  readSseEventLines: (timeoutMs?: number) => Promise<string[]>,
  predicate: (payload: any) => boolean,
  timeoutMs = 250,
): Promise<void> {
  try {
    await waitForJsonRpcMessage(readSseEventLines, predicate, timeoutMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timed out waiting for")) return;
    throw err;
  }
  throw new Error("unexpectedly received matching JSON-RPC message");
}

async function postJsonRpc(baseUrl: string, sessionId: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/mcp/messages?sessionId=${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function connectSse(baseUrl: string, sessionId: string) {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/sse?sessionId=${sessionId}`, {
    headers: { Accept: "text/event-stream" },
    signal: controller.signal,
  });
  expect(res.ok).toBe(true);
  expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");

  const readSseEventLines = createSseEventReader(res.body!);
  // Drain the initial `ready` event to reduce race conditions in tests.
  const readyLines = await readSseEventLines();
  expect(getSseEventName(readyLines)).toBe("ready");

  return { controller, res, readSseEventLines };
}

async function createAgentBrowserStub(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-browser-stub-"));
  const binPath = path.join(dir, "agent-browser");
  const script = `#!/usr/bin/env node
const mode = process.env.AGENT_BROWSER_STUB_MODE || "echo";
if (mode === "sleep") {
  setTimeout(() => {}, 60_000);
} else {
  const payload = {
    argv: process.argv.slice(2),
    session: process.env.AGENT_BROWSER_SESSION,
  };
  process.stdout.write(JSON.stringify(payload));
}
`;
  await writeFile(binPath, script, "utf8");
  await chmod(binPath, 0o755);
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function canExecAgentBrowser(): boolean {
  try {
    execSync("command -v agent-browser", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function canConnectToCdp9222(): boolean {
  try {
    execSync(
      `node -e "require('net').connect({host:'127.0.0.1',port:9222}).on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"`,
      { stdio: "ignore", timeout: 750 },
    );
    return true;
  } catch {
    return false;
  }
}

describe("mcp-agent-browser-tool HTTP/SSE transport", () => {
  let close: undefined | (() => Promise<void>);
  let abortSseControllers: AbortController[] = [];
  let tempDirsToClean: Array<() => Promise<void>> = [];
  let originalPath: string | null | undefined;
  let originalStubMode: string | null | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
    for (const controller of abortSseControllers) controller.abort();
    abortSseControllers = [];
    for (const cleanup of tempDirsToClean) await cleanup();
    tempDirsToClean = [];

    if (originalPath !== undefined) {
      if (originalPath === null) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
    if (originalStubMode !== undefined) {
      if (originalStubMode === null) delete process.env.AGENT_BROWSER_STUB_MODE;
      else process.env.AGENT_BROWSER_STUB_MODE = originalStubMode;
    }
    originalPath = undefined;
    originalStubMode = undefined;
  });

  it("emits initialize response via SSE message event", async () => {
    const srv = await createServerForTest({ port: 0 });
    close = srv.close;

    const sessionId = "s1";
    const sseRes = await fetch(`${srv.baseUrl}/sse?sessionId=${sessionId}`, {
      headers: { Accept: "text/event-stream" },
    });

    expect(sseRes.ok).toBe(true);
    expect(sseRes.headers.get("content-type") ?? "").toContain("text/event-stream");

    const readSseEventLines = createSseEventReader(sseRes.body!);

    const postRes = await fetch(`${srv.baseUrl}/mcp/messages?sessionId=${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(postRes.status).toBe(202);

    // The server may emit heartbeats; read until we get the first `message` event.
    for (let i = 0; i < 10; i++) {
      const lines = await readSseEventLines();
      if (!lines.includes("event: message")) continue;
      const payload = parseSseMessageData(lines) as any;
      expect(payload.jsonrpc).toBe("2.0");
      expect(payload.id).toBe(1);
      expect(payload.result?.serverInfo?.name).toBeTruthy();
      return;
    }

    throw new Error("did not receive SSE message event");
  });

  it("returns tools/list via SSE message event", async () => {
    const srv = await createServerForTest({ port: 0 });
    close = srv.close;

    const sessionId = "s-tools-list";
    const sse = await connectSse(srv.baseUrl, sessionId);
    abortSseControllers.push(sse.controller);

    const postRes = await postJsonRpc(srv.baseUrl, sessionId, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(postRes.status).toBe(202);

    const payload = await waitForJsonRpcMessage(sse.readSseEventLines, (p) => p?.id === 2);
    expect(payload.jsonrpc).toBe("2.0");
    expect(payload.result?.tools?.length).toBeGreaterThan(0);
    expect(payload.result.tools[0]?.name).toBe("agent_browser");
    expect(payload.result.tools[0]?.inputSchema?.type).toBe("object");
  });

  it("returns 409 when posting tools/call without an SSE client", async () => {
    const srv = await createServerForTest({ port: 0 });
    close = srv.close;

    const sessionId = "s-no-sse";
    const postRes = await postJsonRpc(srv.baseUrl, sessionId, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "agent_browser",
        arguments: { session_id: "x", subcommand: "snapshot", args: [] },
      },
    });
    expect(postRes.status).toBe(409);

    const body = (await postRes.json()) as any;
    expect(String(body?.error ?? "")).toContain("no active SSE client");
  });

  it("isolates concurrent SSE clients across different sessionId values", async () => {
    const srv = await createServerForTest({ port: 0 });
    close = srv.close;

    const sse1 = await connectSse(srv.baseUrl, "s-iso-1");
    const sse2 = await connectSse(srv.baseUrl, "s-iso-2");
    abortSseControllers.push(sse1.controller, sse2.controller);

    const postRes = await postJsonRpc(srv.baseUrl, "s-iso-1", {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list",
      params: {},
    });
    expect(postRes.status).toBe(202);

    await waitForJsonRpcMessage(sse1.readSseEventLines, (p) => p?.id === 4);
    await expectNoJsonRpcMessage(sse2.readSseEventLines, (p) => p?.id === 4, 250);
  });

  it("replaces an existing SSE connection when reconnecting with the same sessionId", async () => {
    const srv = await createServerForTest({ port: 0 });
    close = srv.close;

    const sessionId = "s-replace";
    const sseOld = await connectSse(srv.baseUrl, sessionId);
    const sseNew = await connectSse(srv.baseUrl, sessionId);
    abortSseControllers.push(sseOld.controller, sseNew.controller);

    const postRes = await postJsonRpc(srv.baseUrl, sessionId, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/list",
      params: {},
    });
    expect(postRes.status).toBe(202);

    // The server stores only the latest connection for a given sessionId.
    await waitForJsonRpcMessage(sseNew.readSseEventLines, (p) => p?.id === 5);
  });

  it("streams tools/call results for an agent_browser flow (open → fill → click)", async () => {
    const stub = await createAgentBrowserStub();
    tempDirsToClean.push(stub.cleanup);
    originalPath = process.env.PATH ?? null;
    process.env.PATH = `${stub.dir}${path.delimiter}${process.env.PATH ?? ""}`;
    originalStubMode = process.env.AGENT_BROWSER_STUB_MODE ?? null;
    process.env.AGENT_BROWSER_STUB_MODE = "echo";

    const srv = await createServerForTest({ port: 0 });
    close = srv.close;

    const sessionId = "s-flow";
    const sse = await connectSse(srv.baseUrl, sessionId);
    abortSseControllers.push(sse.controller);

    const call = async (id: number, subcommand: string, args: string[]) => {
      const postRes = await postJsonRpc(srv.baseUrl, sessionId, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "agent_browser",
          arguments: { session_id: sessionId, subcommand, args, timeout: 2 },
        },
      });
      expect(postRes.status).toBe(202);
      const payload = await waitForJsonRpcMessage(sse.readSseEventLines, (p) => p?.id === id);
      expect(payload.result?.content?.[0]?.type).toBe("text");
      const resultObj = JSON.parse(payload.result.content[0].text) as any;
      expect(resultObj.exit_code).toBe(0);
      expect(resultObj.subcommand).toBe(subcommand);
      expect(resultObj.args).toEqual(args);
      return resultObj;
    };

    await call(10, "open", ["data:text/html,<html><body><input id='q'/><button id='b'>Go</button></body></html>"]);
    await call(11, "fill", ["#q", "hello"]);
    await call(12, "click", ["#b"]);
  });

  it("reports timeout with exit_code 124 for tools/call", async () => {
    const stub = await createAgentBrowserStub();
    tempDirsToClean.push(stub.cleanup);
    originalPath = process.env.PATH ?? null;
    process.env.PATH = `${stub.dir}${path.delimiter}${process.env.PATH ?? ""}`;
    originalStubMode = process.env.AGENT_BROWSER_STUB_MODE ?? null;
    process.env.AGENT_BROWSER_STUB_MODE = "sleep";

    const srv = await createServerForTest({ port: 0 });
    close = srv.close;

    const sessionId = "s-timeout";
    const sse = await connectSse(srv.baseUrl, sessionId);
    abortSseControllers.push(sse.controller);

    const postRes = await postJsonRpc(srv.baseUrl, sessionId, {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "agent_browser",
        arguments: { session_id: sessionId, subcommand: "snapshot", args: [], timeout: 1 },
      },
    });
    expect(postRes.status).toBe(202);

    const payload = await waitForJsonRpcMessage(sse.readSseEventLines, (p) => p?.id === 20, 10_000);
    const resultObj = JSON.parse(payload.result.content[0].text) as any;
    expect(resultObj.exit_code).toBe(124);
    expect(resultObj.status).toBe("failed");
  });
});

const E2E_ENABLED = canExecAgentBrowser() && canConnectToCdp9222();

describe.skipIf(!E2E_ENABLED)("mcp-agent-browser-tool HTTP/SSE transport (E2E)", () => {
  let close: undefined | (() => Promise<void>);
  let abortSseControllers: AbortController[] = [];

  afterEach(async () => {
    await close?.();
    close = undefined;
    for (const controller of abortSseControllers) controller.abort();
    abortSseControllers = [];
  });

  it("runs an end-to-end open → snapshot → fill → click flow", async () => {
    const srv = await createServerForTest({ port: 0 });
    close = srv.close;

    const sessionId = `s-e2e-${Date.now()}`;
    const sse = await connectSse(srv.baseUrl, sessionId);
    abortSseControllers.push(sse.controller);

    const call = async (id: number, subcommand: string, args: string[]) => {
      const postRes = await postJsonRpc(srv.baseUrl, sessionId, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "agent_browser",
          arguments: { session_id: sessionId, subcommand, args, timeout: 30 },
        },
      });
      expect(postRes.status).toBe(202);
      const payload = await waitForJsonRpcMessage(sse.readSseEventLines, (p) => p?.id === id, 60_000);
      const resultObj = JSON.parse(payload.result.content[0].text) as any;
      expect(resultObj.exit_code).toBe(0);
      expect(resultObj.subcommand).toBe(subcommand);
      return resultObj;
    };

    await call(101, "open", ["data:text/html,<html><body><input id='q'/><button id='b'>Go</button></body></html>"]);
    await call(102, "snapshot", []);
    await call(103, "fill", ["#q", "hello"]);
    await call(104, "click", ["#b"]);
  });
});
