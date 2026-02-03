import test from "node:test";
import assert from "node:assert/strict";

import { consumeStdioLinesForTest } from "../deploy/aio-agent-browser-slim/agent-browser-mcp-server.mjs";

test("parses stdio messages delimited by \\n", () => {
  const json = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const input = Buffer.from(`${json}\n`, "utf8");
  const { messages, rest } = consumeStdioLinesForTest(input);
  assert.deepEqual(messages, [json]);
  assert.equal(rest.length, 0);
});

test("parses stdio messages delimited by \\r\\n", () => {
  const json = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const input = Buffer.from(`${json}\r\n`, "utf8");
  const { messages, rest } = consumeStdioLinesForTest(input);
  assert.deepEqual(messages, [json]);
  assert.equal(rest.length, 0);
});
