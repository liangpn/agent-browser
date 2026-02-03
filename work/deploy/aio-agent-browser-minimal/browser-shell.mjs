import { spawn } from "node:child_process";
import { promises as dns } from "node:dns";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const JSONRPC_VERSION = "2.0";
const SERVER_INFO = { name: "browser-shell", version: "0.1.0" };

const DEFAULT_CDP_PORT = 9222;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;

const MAX_ARGS_ITEMS = 128;
const MAX_ARG_CHARS = 8192;
const MAX_ARGV_ITEMS = MAX_ARGS_ITEMS + 1;

const POLICY_PATH_DEFAULT = "/etc/agent-browser/browser-shell.policy.json";

const ALLOWED_SUBCOMMANDS_P0 = new Set([
  "open",
  "snapshot",
  "click",
  "fill",
  "type",
  "press",
  "wait",
  "screenshot",
  "close",
]);

const FORBIDDEN_AGENT_BROWSER_GLOBAL_ARGS = new Set([
  "--cdp",
  "--json",
  "--session",
  "--headers",
  "--executable-path",
  "--extension",
  "--headed",
  "--debug",
  "--full",
  "-f",
]);

function truncate(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const removed = text.length - MAX_OUTPUT_CHARS;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated: ${removed} characters removed]`;
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

function assertSessionId(sessionId) {
  assertString(sessionId, "session_id");
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(sessionId)) {
    throw new Error("invalid session_id (allowed: [a-zA-Z0-9._-], max 64)");
  }
}

function assertSubcommand(subcommand) {
  assertString(subcommand, "subcommand");
  if (!ALLOWED_SUBCOMMANDS_P0.has(subcommand)) {
    throw new Error(`disallowed subcommand: ${subcommand}`);
  }
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

function normalizeArgs(args) {
  if (args == null) return [];
  if (!Array.isArray(args)) throw new Error("args must be an array");
  if (args.length > MAX_ARGS_ITEMS) throw new Error(`args too long (max ${MAX_ARGS_ITEMS} items)`);

  const normalized = args.map((v, idx) => coerceArgToString(v, `args[${idx}]`));

  for (const [idx, a] of normalized.entries()) {
    if (FORBIDDEN_AGENT_BROWSER_GLOBAL_ARGS.has(a)) {
      throw new Error(`args[${idx}] contains forbidden agent-browser global flag: ${a}`);
    }
    if (a.startsWith("--cdp=") || a.startsWith("--session=")) {
      throw new Error(`args[${idx}] contains forbidden agent-browser global flag: ${a}`);
    }
  }

  return normalized;
}

function normalizeTimeoutMs(timeoutSec) {
  if (timeoutSec == null) return DEFAULT_TIMEOUT_MS;
  const n = Number(timeoutSec);
  if (!Number.isFinite(n)) throw new Error("timeout_sec must be a finite number (seconds)");
  const ms = n * 1000;
  return Math.min(Math.max(1000, ms), MAX_TIMEOUT_MS);
}

function assertArgsBySubcommand(subcommand, args) {
  const assertArgsMin = (n) => {
    if (args.length < n) throw new Error(`${subcommand} requires at least ${n} args`);
  };

  const assertArgsMax = (n) => {
    if (args.length > n) throw new Error(`${subcommand} accepts at most ${n} args`);
  };

  switch (subcommand) {
    case "close":
      assertArgsMax(0);
      return;
    case "open":
      assertArgsMin(1);
      assertArgsMax(1);
      return;
    case "snapshot":
      // Allow snapshot flags like -i/--interactive/-c/--compact/-d/--depth/-s/--selector.
      // Validation is performed later.
      return;
    case "click":
      assertArgsMin(1);
      assertArgsMax(1);
      return;
    case "fill":
      assertArgsMin(2);
      return;
    case "type":
      assertArgsMin(2);
      return;
    case "press":
      assertArgsMin(1);
      assertArgsMax(1);
      return;
    case "wait":
      assertArgsMin(1);
      assertArgsMax(1);
      return;
    case "screenshot":
      assertArgsMax(1);
      return;
    default:
      throw new Error(`disallowed subcommand: ${subcommand}`);
  }
}

function normalizeSnapshotArgs(args) {
  const allowedFlags = new Set(["-i", "--interactive", "-c", "--compact", "-d", "--depth", "-s", "--selector"]);
  const requiresValue = new Set(["-d", "--depth", "-s", "--selector"]);

  const normalized = [];

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith("-")) {
      throw new Error(`snapshot args[${i}] must be an option (got: ${a})`);
    }
    if (!allowedFlags.has(a)) {
      throw new Error(`snapshot option not allowed: ${a}`);
    }
    normalized.push(a);
    if (requiresValue.has(a)) {
      const v = args[i + 1];
      if (v == null) throw new Error(`snapshot option ${a} requires a value`);
      if (v.startsWith("-")) throw new Error(`snapshot option ${a} requires a value, got option: ${v}`);
      normalized.push(v);
      i += 1;
    }
  }

  return normalized;
}

function isPrivateOrLocalIpv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const parts = m.slice(1).map((x) => Number(x));
  if (parts.some((n) => n < 0 || n > 255)) return false;

  const [a, b] = parts;

  // 127.0.0.0/8 loopback
  if (a === 127) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 link-local
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8 "this network"
  if (a === 0) return true;
  return false;
}

function isPrivateOrLocalIpv6(ip) {
  const v = ip.toLowerCase();
  if (v === "::1") return true;
  // ULA: fc00::/7
  if (v.startsWith("fc") || v.startsWith("fd")) return true;
  // link-local: fe80::/10
  if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true;
  // unspecified ::/128
  if (v === "::") return true;
  return false;
}

function looksLikeIpLiteral(hostname) {
  return isPrivateOrLocalIpv4(hostname) || isPrivateOrLocalIpv6(hostname) || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function normalizeOpenUrl(urlRaw) {
  assertString(urlRaw, "args[0]");
  const trimmed = urlRaw.trim();
  if (trimmed.length === 0) throw new Error("open requires a non-empty url");

  if (trimmed === "about:blank") return trimmed;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;

  // If the caller provided an explicit scheme (non-http), keep it so policy
  // validation can reject it with a clear error.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;

  // Match agent-browser behavior: default to https:// when scheme is missing.
  return `https://${trimmed}`;
}

function getDefaultPolicy() {
  return {
    open: {
      allow_schemes: ["http", "https"],
      allow_about_blank: true,
      allow_hosts: undefined,
      allow_host_suffixes: undefined,
    },
  };
}

function loadPolicyFromFile(path = POLICY_PATH_DEFAULT) {
  if (!existsSync(path)) return getDefaultPolicy();
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  assertPlainObject(parsed, "policy");
  return parsed;
}

function hostMatchesAllowlist(hostname, openPolicy) {
  const allowHosts = openPolicy?.allow_hosts;
  const allowSuffixes = openPolicy?.allow_host_suffixes;

  const hasAllowlist =
    (Array.isArray(allowHosts) && allowHosts.length > 0) ||
    (Array.isArray(allowSuffixes) && allowSuffixes.length > 0);

  if (!hasAllowlist) return true;

  const host = hostname.toLowerCase();

  if (Array.isArray(allowHosts)) {
    for (const h of allowHosts) {
      if (typeof h !== "string") continue;
      if (h.toLowerCase() === host) return true;
    }
  }

  if (Array.isArray(allowSuffixes)) {
    for (const s of allowSuffixes) {
      if (typeof s !== "string") continue;
      const suffix = s.toLowerCase();
      if (!suffix.startsWith(".")) continue;
      if (host.endsWith(suffix)) return true;
    }
  }

  return false;
}

async function assertOpenUrlAllowed(urlRaw, policy, lookupImpl = dns.lookup) {
  const normalized = normalizeOpenUrl(urlRaw);
  if (normalized === "about:blank") {
    if (policy?.open?.allow_about_blank === false) {
      throw new Error("about:blank is not allowed by policy");
    }
    return normalized;
  }

  const u = new URL(normalized);
  const scheme = u.protocol.replace(":", "").toLowerCase();

  const allowedSchemes = Array.isArray(policy?.open?.allow_schemes) ? policy.open.allow_schemes : ["http", "https"];
  if (!allowedSchemes.includes(scheme)) {
    throw new Error(`scheme not allowed: ${u.protocol}`);
  }

  // Explicitly block dangerous/non-http(s) schemes even if misconfigured.
  const denySchemes = new Set(["file", "data", "chrome", "devtools"]);
  if (denySchemes.has(scheme)) {
    throw new Error(`scheme not allowed: ${u.protocol}`);
  }

  const hostname = u.hostname;
  if (!hostname) throw new Error("missing hostname");

  if (hostname.toLowerCase() === "localhost") {
    throw new Error("hostname not allowed: localhost");
  }

  if (!hostMatchesAllowlist(hostname, policy?.open ?? {})) {
    throw new Error(`hostname not in allowlist: ${hostname}`);
  }

  // If the hostname is an IP literal, validate it directly.
  if (looksLikeIpLiteral(hostname)) {
    if (isPrivateOrLocalIpv4(hostname) || isPrivateOrLocalIpv6(hostname)) {
      throw new Error(`ip not allowed: ${hostname}`);
    }
    return normalized;
  }

  // Resolve DNS and block local/private results.
  let addrs;
  try {
    addrs = await lookupImpl(hostname, { all: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`dns lookup failed for ${hostname}: ${msg}`);
  }

  for (const a of addrs) {
    const ip = a.address;
    if (isPrivateOrLocalIpv4(ip) || isPrivateOrLocalIpv6(ip)) {
      throw new Error(`hostname resolves to disallowed ip: ${hostname} -> ${ip}`);
    }
  }

  return normalized;
}

function buildAgentBrowserSpawn({ sessionId, subcommand, args }) {
  return {
    command: "agent-browser",
    argv: [
      "--session",
      sessionId,
      "--cdp",
      String(DEFAULT_CDP_PORT),
      "--json",
      subcommand,
      ...args,
    ],
    env: { ...process.env },
  };
}

async function executeAgentBrowser({ sessionId, subcommand, args, timeoutMs }) {
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
        // ignore
      }
      resolve(124);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });

  const stdoutRaw = Buffer.concat(stdoutChunks).toString("utf8");
  const stderrRaw = Buffer.concat(stderrChunks).toString("utf8");

  const status = exitCode === 124 ? "timeout" : exitCode === 0 ? "completed" : "failed";

  return { exit_code: exitCode, stdout_raw: stdoutRaw, stderr_raw: stderrRaw, status };
}

function getToolDefinition() {
  return {
    name: "browser-shell",
    description:
      "Run a strict allowlist of agent-browser subcommands (CDP port fixed to 9222, no shell).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["session_id", "argv"],
      properties: {
        session_id: { type: "string", minLength: 1, maxLength: 64 },
        argv: {
          type: "array",
          items: { type: ["string", "number", "boolean"] },
          minItems: 1,
          maxItems: MAX_ARGV_ITEMS,
        },
        timeout_sec: {
          type: "number",
          description: "Timeout seconds (max 120, default 30)",
        },
      },
    },
  };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

function writeJsonLine(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function parseAndValidateToolCallParams(params, policy, lookupImpl) {
  const toolName = params?.name;
  if (toolName !== "browser-shell") {
    throw new Error(`unknown tool: ${toolName}`);
  }

  const a = params?.arguments ?? {};
  assertPlainObject(a, "arguments");

  const sessionId = a.session_id;
  const rawArgv = a.argv;
  const timeoutSec = a.timeout_sec;

  assertSessionId(sessionId);

  if (!Array.isArray(rawArgv)) throw new Error("argv must be an array");
  if (rawArgv.length < 1) throw new Error("argv must have at least 1 item");
  if (rawArgv.length > MAX_ARGV_ITEMS) throw new Error(`argv too long (max ${MAX_ARGV_ITEMS} items)`);

  const subcommand = rawArgv[0];
  assertString(subcommand, "argv[0]");
  assertSubcommand(subcommand);

  const normalizedArgs = normalizeArgs(rawArgv.slice(1));
  assertArgsBySubcommand(subcommand, normalizedArgs);

  const timeoutMs = normalizeTimeoutMs(timeoutSec);

  return {
    sessionId,
    subcommand,
    args: normalizedArgs,
    timeoutMs,
    policy,
    lookupImpl,
  };
}

export async function onBeforeToolCall(ctx) {
  const { sessionId, subcommand, args, timeoutMs, policy, lookupImpl } = ctx;

  if (subcommand === "snapshot") {
    return { ...ctx, args: normalizeSnapshotArgs(args) };
  }

  if (subcommand === "open") {
    const normalizedUrl = await assertOpenUrlAllowed(args[0], policy, lookupImpl);
    return { ...ctx, args: [normalizedUrl] };
  }

  return { sessionId, subcommand, args, timeoutMs };
}

export function onAfterToolCall(ctx, execResult) {
  const stdoutRaw = execResult?.stdout_raw ?? execResult?.stdout ?? "";
  const stderrRaw = execResult?.stderr_raw ?? execResult?.stderr ?? "";

  let stdoutOut = String(stdoutRaw);
  let stderrOut = String(stderrRaw);
  let exitCodeOut = execResult.exit_code;

  try {
    const parsed = JSON.parse(stdoutOut.trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.success === "boolean") {
      const success = parsed.success;
      const data = Object.prototype.hasOwnProperty.call(parsed, "data") ? parsed.data : undefined;
      const error = Object.prototype.hasOwnProperty.call(parsed, "error") ? parsed.error : undefined;

      if (success) {
        stdoutOut = `${JSON.stringify(data ?? null)}\n`;
      } else {
        // Surface error via stderr and ensure non-zero exit_code.
        const msg = typeof error === "string" && error.length > 0 ? error : "Unknown error";
        stderrOut = stderrOut.length > 0 ? `${msg}\n${stderrOut}` : `${msg}\n`;
        if (exitCodeOut === 0) exitCodeOut = 1;
        stdoutOut = data == null ? "" : `${JSON.stringify(data)}\n`;
      }
    }
  } catch {
    // If stdout isn't JSON, keep it as-is.
  }

  return {
    session_id: ctx.sessionId,
    exit_code: exitCodeOut,
    stdout: truncate(stdoutOut),
    stderr: truncate(stderrOut),
  };
}

export async function handleToolCall(params, { policyPath = POLICY_PATH_DEFAULT, lookupImpl = dns.lookup } = {}) {
  const policy = loadPolicyFromFile(policyPath);
  const preCtx = parseAndValidateToolCallParams(params, policy, lookupImpl);
  const ctx = await onBeforeToolCall(preCtx);
  const execResult = await executeAgentBrowser({
    sessionId: ctx.sessionId,
    subcommand: ctx.subcommand,
    args: ctx.args,
    timeoutMs: ctx.timeoutMs,
  });
  return onAfterToolCall(ctx, execResult);
}

async function handleJsonRpc(request) {
  const { id, method, params } = request ?? {};
  if (!method) return;

  try {
    if (method === "initialize") {
      const protocolVersion = params?.protocolVersion ?? "2024-11-05";
      writeJsonLine(
        jsonRpcResult(id, {
          protocolVersion,
          serverInfo: SERVER_INFO,
          capabilities: { tools: { listChanged: false } },
        }),
      );
      return;
    }

    if (method === "tools/list") {
      writeJsonLine(jsonRpcResult(id, { tools: [getToolDefinition()] }));
      return;
    }

    if (method === "tools/call") {
      const result = await handleToolCall(params);
      writeJsonLine(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
        }),
      );
      return;
    }

    if (id !== undefined) {
      writeJsonLine(jsonRpcError(id, -32601, `unknown method: ${method}`));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (id !== undefined) {
      writeJsonLine(jsonRpcError(id, -32000, msg));
    }
  }
}

function consumeStdioLines(buffer) {
  const messages = [];
  let rest = buffer;

  while (true) {
    const newlineIdx = rest.indexOf("\n");
    if (newlineIdx === -1) break;

    const line = rest.slice(0, newlineIdx).toString("utf8").replace(/\r$/, "");
    rest = rest.slice(newlineIdx + 1);
    if (line.length === 0) continue;
    messages.push(line);
  }

  return { messages, rest };
}

export function consumeStdioLinesForTest(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("buffer must be a Buffer");
  }
  return consumeStdioLines(buffer);
}

export function isPrivateOrLocalIpForTest(ip) {
  return isPrivateOrLocalIpv4(ip) || isPrivateOrLocalIpv6(ip);
}

export function hostMatchesAllowlistForTest(hostname, openPolicy) {
  return hostMatchesAllowlist(hostname, openPolicy);
}

export async function assertOpenUrlAllowedForTest(urlRaw, policy, lookupImpl) {
  return assertOpenUrlAllowed(urlRaw, policy, lookupImpl);
}

export function normalizeArgsForTest(args) {
  return normalizeArgs(args);
}

export function assertArgsBySubcommandForTest(subcommand, args) {
  return assertArgsBySubcommand(subcommand, args);
}

export function normalizeSnapshotArgsForTest(args) {
  return normalizeSnapshotArgs(args);
}

export function parseAndValidateToolCallParamsForTest(params, policy, lookupImpl) {
  return parseAndValidateToolCallParams(params, policy, lookupImpl);
}

function startStdioServer() {
  let buffer = Buffer.alloc(0);

  process.stdin.on("data", async (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const consumed = consumeStdioLines(buffer);
    buffer = consumed.rest;

    for (const body of consumed.messages) {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await handleJsonRpc(msg);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startStdioServer();
}
