import { spawn } from "node:child_process";
import * as http from "node:http";
import process from "node:process";
import { URL } from "node:url";

const JSONRPC_VERSION = "2.0";
const SERVER_INFO = { name: "agent-browser-minimal", version: "0.1.0" };

const JSONRPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR: -32000,
};

const DEFAULT_CDP_PORT = 9222;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 30_000;
const MAX_ARGS_ITEMS = 256;
const MAX_ARG_CHARS = 16_384;
const MAX_HTTP_BODY_BYTES = 1_000_000;
const SSE_HEARTBEAT_MS = 30_000;
const DEFAULT_SERVER_PORT = 8079;

const ALLOWED_SUBCOMMANDS = new Set([
  "open",
  "snapshot",
  "click",
  "dblclick",
  "type",
  "fill",
  "press",
  "hover",
  "focus",
  "check",
  "uncheck",
  "select",
  "wait",
  "screenshot",
  "close",
]);

const SUBCOMMAND_DOCS = {
  open: "Navigate to a URL.",
  snapshot: "Return interactable element refs. Snapshot options are passed through as args.",
  click: "Click an element ref (for example: @e1).",
  dblclick: "Double-click an element ref.",
  type: "Type text into an element ref.",
  fill: "Fill an element ref with text.",
  press: "Press a key on an element ref or page.",
  hover: "Hover an element ref.",
  focus: "Focus an element ref.",
  check: "Check a checkbox element ref.",
  uncheck: "Uncheck a checkbox element ref.",
  select: "Select option(s) in a select element ref.",
  wait: "Wait for a condition or a duration.",
  screenshot: "Capture a screenshot (args passed through).",
  close: "Close the session/page.",
};

const TOOL_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["session_id", "subcommand", "args"],
  properties: {
    session_id: { type: "string", minLength: 1, maxLength: 64 },
    sessionId: { type: "string", minLength: 1, maxLength: 64 },
    subcommand: { type: "string", enum: Array.from(ALLOWED_SUBCOMMANDS) },
    args: {
      type: "array",
      items: { type: ["string", "number", "boolean"] },
      maxItems: MAX_ARGS_ITEMS,
    },
    timeout: { type: "number", description: "Timeout seconds (max 120, default 30)" },
    timeoutSec: { type: "number", description: "Alias for timeout (seconds)" },
  },
  allOf: [
    {
      if: { properties: { subcommand: { const: "open" } }, required: ["subcommand"] },
      then: { properties: { args: { minItems: 1 } } },
    },
    {
      if: { properties: { subcommand: { enum: ["click", "dblclick", "hover", "focus", "check", "uncheck"] } }, required: ["subcommand"] },
      then: { properties: { args: { minItems: 1 } } },
    },
    {
      if: { properties: { subcommand: { enum: ["type", "fill"] } }, required: ["subcommand"] },
      then: { properties: { args: { minItems: 2 } } },
    },
    {
      if: { properties: { subcommand: { const: "press" } }, required: ["subcommand"] },
      then: { properties: { args: { minItems: 1, maxItems: 2 } } },
    },
    {
      if: { properties: { subcommand: { const: "select" } }, required: ["subcommand"] },
      then: { properties: { args: { minItems: 2 } } },
    },
    {
      if: { properties: { subcommand: { const: "wait" } }, required: ["subcommand"] },
      then: { properties: { args: { minItems: 1 } } },
    },
    {
      if: { properties: { subcommand: { const: "close" } }, required: ["subcommand"] },
      then: { properties: { args: { maxItems: 0 } } },
    },
  ],
};

function truncate(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated: ${text.length - MAX_OUTPUT_CHARS} characters removed]`;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function assertString(value, name) {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  if (value.includes("\0")) throw new Error(`${name} contains NUL byte`);
  if (/[\r\n]/.test(value)) throw new Error(`${name} contains newline characters`);
}

function coerceArgToString(value, name) {
  if (typeof value === "string") {
    assertString(value, name);
    if (value.length > MAX_ARG_CHARS) throw new Error(`${name} too long (max ${MAX_ARG_CHARS} chars)`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  throw new Error(`${name} must be a string, number, or boolean`);
}

function assertSessionId(sessionId) {
  assertString(sessionId, "session_id");
  if (sessionId.trim().length === 0) throw new Error("session_id must be non-empty");
  if (sessionId.length > 64) throw new Error("session_id too long (max 64)");
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(sessionId)) {
    throw new Error("invalid session_id (allowed: [a-zA-Z0-9._-], max 64)");
  }
}

function assertSubcommand(subcommand) {
  assertString(subcommand, "subcommand");
  if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`disallowed subcommand: ${subcommand}`);
  }
}

function normalizeArgs(args) {
  if (args == null) return [];
  if (!Array.isArray(args)) throw new Error("args must be an array");
  if (args.length > MAX_ARGS_ITEMS) throw new Error(`args too long (max ${MAX_ARGS_ITEMS} items)`);

  const normalized = args.map((v, idx) => coerceArgToString(v, `args[${idx}]`));

  for (const [idx, a] of normalized.entries()) {
    if (a === "--cdp" || a.startsWith("--cdp=")) {
      throw new Error(`args[${idx}] cannot set --cdp (port is fixed to ${DEFAULT_CDP_PORT})`);
    }
    if (a === "--json") {
      throw new Error(`args[${idx}] cannot set --json (server appends it automatically)`);
    }
  }

  return normalized;
}

function normalizeTimeoutMs(timeout) {
  if (timeout == null) return DEFAULT_TIMEOUT_MS;
  const n = Number(timeout);
  if (!Number.isFinite(n)) throw new Error("timeout must be a finite number (seconds)");
  const ms = n * 1000;
  return Math.min(Math.max(1_000, ms), 120_000);
}

function assertArgsBySubcommand(subcommand, args) {
  const doc = SUBCOMMAND_DOCS[subcommand] ?? "";

  const assertNonEmptyArg = (idx) => {
    const v = args[idx];
    if (typeof v !== "string" || v.trim().length === 0) {
      throw new Error(`${subcommand} requires args[${idx}] to be non-empty. ${doc}`);
    }
  };

  const assertArgsMin = (n) => {
    if (args.length < n) throw new Error(`${subcommand} requires at least ${n} args. ${doc}`);
  };

  const assertArgsMax = (n) => {
    if (args.length > n) throw new Error(`${subcommand} accepts at most ${n} args. ${doc}`);
  };

  const assertElementRefLike = (idx) => {
    assertNonEmptyArg(idx);
    const v = args[idx];
    if (v.startsWith("@") && !/^@[a-zA-Z0-9._:-]{1,64}$/.test(v)) {
      throw new Error(`${subcommand} args[${idx}] looks like a ref but is invalid. ${doc}`);
    }
  };

  switch (subcommand) {
    case "close":
      assertArgsMax(0);
      return;
    case "open":
      assertArgsMin(1);
      assertNonEmptyArg(0);
      return;
    case "snapshot":
      return;
    case "click":
    case "dblclick":
    case "hover":
    case "focus":
    case "check":
    case "uncheck":
      assertArgsMin(1);
      assertElementRefLike(0);
      return;
    case "type":
    case "fill":
      assertArgsMin(2);
      assertElementRefLike(0);
      assertNonEmptyArg(1);
      return;
    case "press":
      assertArgsMin(1);
      assertArgsMax(2);
      assertNonEmptyArg(0);
      if (args.length === 2) {
        assertElementRefLike(0);
        assertNonEmptyArg(1);
      }
      return;
    case "select":
      assertArgsMin(2);
      assertElementRefLike(0);
      assertNonEmptyArg(1);
      return;
    case "wait":
      assertArgsMin(1);
      assertNonEmptyArg(0);
      return;
    case "screenshot":
      return;
    default:
      throw new Error(`disallowed subcommand: ${subcommand}`);
  }
}

function buildAgentBrowserSpawn({ sessionId, subcommand, args }) {
  return {
    command: "agent-browser",
    argv: ["--cdp", String(DEFAULT_CDP_PORT), subcommand, ...args, "--json"],
    env: {
      ...process.env,
      AGENT_BROWSER_SESSION: sessionId,
    },
  };
}

async function executeAgentBrowserStructured({ sessionId, subcommand, args, timeoutMs }) {
  const spawnSpec = buildAgentBrowserSpawn({ sessionId, subcommand, args });

  const child = spawn(spawnSpec.command, spawnSpec.argv, {
    env: spawnSpec.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  const stdoutChunks = [];
  const stderrChunks = [];

  child.stdout.on("data", (d) => stdoutChunks.push(d));
  child.stderr.on("data", (d) => stderrChunks.push(d));

  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
      }
      resolve(124);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });

  const stdout = truncate(Buffer.concat(stdoutChunks).toString("utf8"));
  const stderr = truncate(Buffer.concat(stderrChunks).toString("utf8"));

  return {
    session_id: sessionId,
    subcommand,
    args,
    exit_code: exitCode,
    stdout,
    stderr,
    status: exitCode === 0 ? "completed" : "failed",
    output: [stdout, stderr].filter(Boolean).join(""),
  };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

function getToolDefinition() {
  return {
    name: "agent_browser",
    description:
      "Run agent-browser with a strict subcommand allowlist and structured args (no shell, no cmd string).",
    inputSchema: TOOL_INPUT_SCHEMA,
  };
}

function assertJsonRpcRequest(request) {
  assertPlainObject(request, "request");
  if (request.jsonrpc !== JSONRPC_VERSION) {
    throw new Error(`jsonrpc must be "${JSONRPC_VERSION}"`);
  }
  if (typeof request.method !== "string" || request.method.length === 0) {
    throw new Error("method must be a non-empty string");
  }
}

function parseAndValidateToolCallParams(params) {
  const toolName = params?.name;
  if (toolName !== "agent_browser") {
    throw new Error(`unknown tool: ${toolName}`);
  }

  const a = params?.arguments ?? {};
  assertPlainObject(a, "arguments");

  const sessionId = a.session_id ?? a.sessionId;
  const subcommand = a.subcommand;
  const args = a.args ?? [];
  const timeout = a.timeout ?? a.timeoutSec;

  assertSessionId(sessionId);
  assertSubcommand(subcommand);
  const normalizedArgs = normalizeArgs(args);
  assertArgsBySubcommand(subcommand, normalizedArgs);
  const timeoutMs = normalizeTimeoutMs(timeout);

  return { sessionId, subcommand, args: normalizedArgs, timeoutMs };
}

async function handleJsonRpc(request, write) {
  const { id, method, params } = request ?? {};
  if (!method) return;
  if (typeof write !== "function") {
    throw new Error("write must be a function");
  }

  try {
    assertJsonRpcRequest(request);

    if (method === "initialize") {
      const protocolVersion = params?.protocolVersion ?? "2024-11-05";
      write(
        jsonRpcResult(id, {
          protocolVersion,
          serverInfo: SERVER_INFO,
          capabilities: { tools: { listChanged: false } },
        }),
      );
      return;
    }

    if (method === "tools/list") {
      write(jsonRpcResult(id, { tools: [getToolDefinition()] }));
      return;
    }

    if (method === "tools/call") {
      const { sessionId, subcommand, args, timeoutMs } =
        parseAndValidateToolCallParams(params);
      const result = await executeAgentBrowserStructured({ sessionId, subcommand, args, timeoutMs });
      write(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
        }),
      );
      return;
    }

    if (id !== undefined) {
      write(jsonRpcError(id, -32601, `unknown method: ${method}`));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (id !== undefined) {
      write(jsonRpcError(id, JSONRPC_ERRORS.SERVER_ERROR, msg));
    }
  }
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, mcp-session-id, x-session-id, x-mcp-session-id",
  );
}

function writeSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeJsonRpc(res, message) {
  writeSseEvent(res, "message", message);
}

function getSessionIdFromRequest(req, url) {
  const q =
    url.searchParams.get("sessionId") ??
    url.searchParams.get("session_id") ??
    url.searchParams.get("session");
  const h =
    req.headers["mcp-session-id"] ??
    req.headers["x-mcp-session-id"] ??
    req.headers["x-session-id"];
  const sessionId = (Array.isArray(h) ? h[0] : h) ?? q;
  if (sessionId == null) return null;
  assertSessionId(sessionId);
  return sessionId;
}

async function readRequestBodyJson(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_HTTP_BODY_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body);
}

function createHttpServer({ port, host } = {}) {
  const clients = new Map();

  const server = http.createServer(async (req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/sse") {
      let sessionId;
      try {
        sessionId = getSessionIdFromRequest(req, url);
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        return;
      }

      if (!sessionId) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "missing sessionId" }));
        return;
      }

      const existing = clients.get(sessionId);
      if (existing) {
        try {
          existing.end();
        } catch {
        }
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      clients.set(sessionId, res);

      writeSseEvent(res, "ready", { sessionId });

      const heartbeat = setInterval(() => {
        try {
          writeSseEvent(res, "ping", {});
        } catch {
        }
      }, SSE_HEARTBEAT_MS);

      const cleanup = () => {
        clearInterval(heartbeat);
        if (clients.get(sessionId) === res) {
          clients.delete(sessionId);
        }
      };

      req.on("close", cleanup);
      res.on("close", cleanup);
      return;
    }

    if (req.method === "POST" && url.pathname === "/mcp/messages") {
      let sessionId;
      try {
        sessionId = getSessionIdFromRequest(req, url);
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        return;
      }

      if (!sessionId) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "missing sessionId" }));
        return;
      }

      const client = clients.get(sessionId);
      if (!client) {
        res.statusCode = 409;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "no active SSE client for sessionId" }));
        return;
      }

      let request;
      try {
        request = await readRequestBodyJson(req);
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        return;
      }

      const write = (message) => {
        writeJsonRpc(client, message);
      };

      await handleJsonRpc(request, write);

      res.statusCode = 202;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "not found" }));
  });

  async function listen() {
    const listenPort = port ?? Number(process.env.MCP_AGENT_BROWSER_PORT ?? process.env.PORT ?? DEFAULT_SERVER_PORT);
    const listenHost = host ?? "0.0.0.0";
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(listenPort, listenHost, () => {
        server.off("error", reject);
        resolve();
      });
    });
  }

  async function close() {
    for (const [, r] of clients) {
      try {
        r.end();
      } catch {
      }
    }
    clients.clear();
    await new Promise((resolve) => server.close(resolve));
  }

  return { server, listen, close };
}

export async function createServerForTest({ port } = {}) {
  const { server, listen, close } = createHttpServer({ port, host: "127.0.0.1" });
  await listen();
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("unexpected server address");
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return { baseUrl, close };
}

async function startHttpServer() {
  const { server, listen } = createHttpServer();
  await listen();
  const addr = server.address();
  if (addr && typeof addr !== "string") {
    // eslint-disable-next-line no-console
    console.error(`agent-browser MCP HTTP/SSE server listening on ${addr.address}:${addr.port}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startHttpServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
