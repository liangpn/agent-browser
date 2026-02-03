import { spawn } from "node:child_process";
import process from "node:process";

const DEFAULT_CDP_PORT = 9222;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 30_000;

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

function truncate(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated: ${text.length - MAX_OUTPUT_CHARS} characters removed]`;
}

function assertSafeCmdString(cmd) {
  if (typeof cmd !== "string" || cmd.trim().length === 0) {
    throw new Error("cmd must be a non-empty string");
  }
  if (cmd.includes("\0")) {
    throw new Error("cmd contains NUL byte");
  }

  // This tool is not a general shell: reject common shell metacharacters early.
  // We still avoid the shell entirely (spawn argv), but rejecting these reduces
  // ambiguity and prevents accidental use as a general-purpose executor.
  const forbidden = /[;&|><\r\n]/;
  if (forbidden.test(cmd)) {
    throw new Error("cmd contains forbidden shell metacharacters");
  }
  if (cmd.includes("`") || cmd.includes("$(")) {
    throw new Error("cmd contains forbidden shell substitution");
  }
}

function tokenizeBashLike(cmd) {
  assertSafeCmdString(cmd);

  const tokens = [];
  let current = "";
  let i = 0;
  let quote = null; // "'" | '"' | null

  const pushCurrent = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };

  while (i < cmd.length) {
    const ch = cmd[i];

    if (quote === null) {
      if (ch === "'" || ch === '"') {
        quote = ch;
        i += 1;
        continue;
      }
      if (/\s/.test(ch)) {
        pushCurrent();
        i += 1;
        continue;
      }
      if (ch === "\\") {
        if (i + 1 >= cmd.length) {
          throw new Error("cmd ends with a trailing backslash");
        }
        current += cmd[i + 1];
        i += 2;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    // Inside quotes.
    if (ch === quote) {
      quote = null;
      i += 1;
      continue;
    }
    if (quote === '"' && ch === "\\") {
      if (i + 1 >= cmd.length) {
        throw new Error("cmd ends with a trailing backslash in quotes");
      }
      current += cmd[i + 1];
      i += 2;
      continue;
    }
    current += ch;
    i += 1;
  }

  if (quote !== null) {
    throw new Error("cmd has unterminated quotes");
  }
  pushCurrent();

  return tokens;
}

function parseEnvPrefix(tokens) {
  let session = null;
  const rest = [];

  for (const token of tokens) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(token);
    if (!m) {
      rest.push(token);
      continue;
    }
    const [, key, value] = m;
    if (key !== "AGENT_BROWSER_SESSION") {
      throw new Error(`disallowed env var: ${key}`);
    }
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(value)) {
      throw new Error("invalid AGENT_BROWSER_SESSION");
    }
    session = value;
  }

  return { session, tokens: rest };
}

function parseAgentBrowserCommand(tokens) {
  const { session, tokens: rest } = parseEnvPrefix(tokens);
  if (rest.length === 0) {
    throw new Error("missing command");
  }
  if (rest[0] !== "agent-browser") {
    throw new Error("cmd must start with agent-browser");
  }

  let idx = 1;
  let cdpPort = null;
  while (idx < rest.length) {
    const token = rest[idx];
    if (!token.startsWith("--")) break;
    if (token === "--json") {
      idx += 1;
      continue;
    }
    if (token === "--cdp") {
      if (idx + 1 >= rest.length) {
        throw new Error("--cdp requires a value");
      }
      const value = rest[idx + 1];
      if (!/^\d+$/.test(value)) {
        throw new Error("--cdp must be a number");
      }
      cdpPort = Number(value);
      idx += 2;
      continue;
    }
    throw new Error(`disallowed global flag: ${token}`);
  }

  if (cdpPort != null && cdpPort !== DEFAULT_CDP_PORT) {
    throw new Error(`cdp port must be ${DEFAULT_CDP_PORT}`);
  }

  if (idx >= rest.length) {
    throw new Error("missing subcommand");
  }
  const subcommand = rest[idx];
  if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`disallowed subcommand: ${subcommand}`);
  }
  const rawSubcommandArgs = rest.slice(idx + 1);

  // Keep subcommand arg parsing strict; reject flags after subcommand unless explicitly allowed.
  const subcommandArgs = [];
  if (subcommand === "snapshot") {
    for (const t of rawSubcommandArgs) {
      if (t === "--json") continue;
      if (t.startsWith("-") && t !== "-i") {
        throw new Error(`disallowed snapshot option: ${t}`);
      }
      subcommandArgs.push(t);
    }
  } else {
    for (const t of rawSubcommandArgs) {
      if (t === "--json") continue;
      if (t.startsWith("-")) {
        throw new Error(`disallowed option after subcommand: ${t}`);
      }
      subcommandArgs.push(t);
    }
  }

  return {
    session: session ?? "default",
    subcommand,
    rest: subcommandArgs,
  };
}

export function parseAndValidateAgentBrowserBashCmd(cmd) {
  const tokens = tokenizeBashLike(cmd);
  return parseAgentBrowserCommand(tokens);
}

export function buildAgentBrowserSpawn(parsed) {
  return {
    command: "agent-browser",
    argv: ["--cdp", String(DEFAULT_CDP_PORT), parsed.subcommand, ...parsed.rest, "--json"],
    env: {
      ...process.env,
      AGENT_BROWSER_SESSION: parsed.session,
    },
  };
}

async function executeAgentBrowser(cmd, { timeoutMs } = {}) {
  const parsed = parseAndValidateAgentBrowserBashCmd(cmd);
  const spawnSpec = buildAgentBrowserSpawn(parsed);

  const child = spawn(spawnSpec.command, spawnSpec.argv, {
    env: spawnSpec.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutChunks = [];
  const stderrChunks = [];

  child.stdout.on("data", (d) => stdoutChunks.push(d));
  child.stderr.on("data", (d) => stderrChunks.push(d));

  const ms = Math.min(
    Math.max(1_000, Number(timeoutMs ?? DEFAULT_TIMEOUT_MS)),
    120_000,
  );

  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve(124);
    }, ms);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });

  const stdout = truncate(Buffer.concat(stdoutChunks).toString("utf8"));
  const stderr = truncate(Buffer.concat(stderrChunks).toString("utf8"));

  return {
    command: cmd,
    exit_code: exitCode,
    stdout,
    stderr,
    status: exitCode === 0 ? "completed" : "failed",
    output: [stdout, stderr].filter(Boolean).join(""),
  };
}

function writeJsonRpc(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function getToolDefinition() {
  return {
    name: "sandbox_execute_bash",
    description:
      "Restricted bash executor: only allows running agent-browser (whitelisted subcommands) via spawn, no shell.",
    inputSchema: {
      type: "object",
      properties: {
        cmd: { type: "string", description: "Must start with agent-browser" },
        timeout: {
          type: "number",
          description: "Timeout seconds (max 120)",
        },
        cwd: { type: "string", description: "Ignored (not supported)" },
        new_session: { type: "boolean", description: "Ignored (not supported)" },
      },
      required: ["cmd"],
    },
  };
}

async function handleJsonRpc(request) {
  const { id, method, params } = request ?? {};
  if (!method) return;

  try {
    if (method === "initialize") {
      const protocolVersion = params?.protocolVersion ?? "2024-11-05";
      writeJsonRpc(
        jsonRpcResult(id, {
          protocolVersion,
          serverInfo: { name: "agent-browser-slim", version: "0.1.0" },
          capabilities: { tools: { listChanged: false } },
        }),
      );
      return;
    }

    if (method === "tools/list") {
      writeJsonRpc(jsonRpcResult(id, { tools: [getToolDefinition()] }));
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const args = params?.arguments ?? {};
      if (toolName !== "sandbox_execute_bash") {
        writeJsonRpc(jsonRpcError(id, -32601, `unknown tool: ${toolName}`));
        return;
      }
      const cmd = args?.cmd ?? args?.command;
      const timeoutSec = args?.timeout ?? args?.timeoutSec;
      const result = await executeAgentBrowser(cmd, {
        timeoutMs: timeoutSec != null ? Number(timeoutSec) * 1000 : undefined,
      });
      writeJsonRpc(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
        }),
      );
      return;
    }

    // Ignore notifications and unknown methods.
    if (id !== undefined) {
      writeJsonRpc(jsonRpcError(id, -32601, `unknown method: ${method}`));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (id !== undefined) {
      writeJsonRpc(jsonRpcError(id, -32000, msg));
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

// Exported only for local tests.
export function consumeStdioLinesForTest(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("buffer must be a Buffer");
  }
  return consumeStdioLines(buffer);
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
