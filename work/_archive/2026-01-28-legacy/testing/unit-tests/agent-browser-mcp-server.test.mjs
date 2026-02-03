import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAndValidateAgentBrowserBashCmd,
  buildAgentBrowserSpawn,
} from "../deploy/aio-agent-browser-slim/agent-browser-mcp-server.mjs";

test("accepts a basic agent-browser command", () => {
  const parsed = parseAndValidateAgentBrowserBashCmd(
    'AGENT_BROWSER_SESSION=u1 agent-browser --cdp 9222 open https://www.baidu.com --json',
  );
  assert.equal(parsed.session, "u1");
  assert.equal(parsed.subcommand, "open");
  assert.equal(parsed.rest[0], "https://www.baidu.com");
});

test("injects --cdp 9222 and --json when missing", () => {
  const parsed = parseAndValidateAgentBrowserBashCmd(
    "AGENT_BROWSER_SESSION=u1 agent-browser open https://www.baidu.com",
  );
  const spawn = buildAgentBrowserSpawn(parsed);
  assert.deepEqual(spawn.argv.slice(0, 3), ["--cdp", "9222", "open"]);
  assert.ok(spawn.argv.includes("--json"));
});

test("rejects non-agent-browser commands", () => {
  assert.throws(
    () => parseAndValidateAgentBrowserBashCmd("echo hi"),
    /must start with agent-browser/i,
  );
});

test("rejects shell metacharacters", () => {
  assert.throws(
    () =>
      parseAndValidateAgentBrowserBashCmd(
        "agent-browser open https://www.baidu.com; rm -rf /",
      ),
    /metachar/i,
  );
});

test("rejects disallowed env vars", () => {
  assert.throws(
    () =>
      parseAndValidateAgentBrowserBashCmd(
        "FOO=bar agent-browser open https://www.baidu.com",
      ),
    /env/i,
  );
});

test("rejects disallowed subcommands", () => {
  assert.throws(
    () =>
      parseAndValidateAgentBrowserBashCmd(
        "agent-browser console",
      ),
    /subcommand/i,
  );
});

test("rejects --cdp values other than 9222", () => {
  assert.throws(
    () =>
      parseAndValidateAgentBrowserBashCmd(
        "agent-browser --cdp 9333 open https://www.baidu.com --json",
      ),
    /cdp/i,
  );
});

