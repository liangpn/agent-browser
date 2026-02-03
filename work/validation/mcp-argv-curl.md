---
date: 2026-01-30
source: curl + docker-compose
base_url: http://localhost:8092
notes:
  - Input uses argv-only schema
  - This run predates stdout normalization; current `browser-shell` returns data-only JSON in `stdout` (no `{success,data,error}` wrapper)
  - Compose up logs saved to /tmp/mcp-argv-compose-up.log
---

## tools/list

```json
{"result":{"tools":[{"name":"browser-shell","description":"Run a strict allowlist of agent-browser subcommands (CDP port fixed to 9222, no shell).","inputSchema":{"type":"object","properties":{"session_id":{"type":"string","minLength":1,"maxLength":64},"argv":{"type":"array","items":{"type":["string","number","boolean"]},"minItems":1,"maxItems":129},"timeout_sec":{"type":"number","description":"Timeout seconds (max 120, default 30)"}},"required":["session_id","argv"],"additionalProperties":false}}]},"jsonrpc":"2.0","id":1}
```

## tools/call: open https://example.com

```json
{"result":{"content":[{"type":"text","text":"{\"session_id\":\"v1\",\"subcommand\":\"open\",\"args\":[\"https://example.com\"],\"exit_code\":0,\"stdout\":\"{\\"success\\":true,\\"data\\":{\\"title\\":\\"Example Domain\\",\\"url\\":\\"https://example.com/\\"},\\"error\\":null}\n\",\"stderr\":\"\"}"}]},"jsonrpc":"2.0","id":2}
```

## tools/call: snapshot -i

```json
{"result":{"content":[{"type":"text","text":"{\"session_id\":\"v1\",\"subcommand\":\"snapshot\",\"args\":[\"-i\"],\"exit_code\":0,\"stdout\":\"{\\"success\\":true,\\"data\\":{\\"refs\\":{\\"e1\\":{\\"name\\":\\"Learn more\\",\\"role\\":\\"link\\"}},\\"snapshot\\":\\"- link \\\\"Learn more\\\\" [ref=e1]\\"},\\"error\\":null}\n\",\"stderr\":\"\"}"}]},"jsonrpc":"2.0","id":3}
```

## tools/call: close

```json
{"result":{"content":[{"type":"text","text":"{\"session_id\":\"v1\",\"subcommand\":\"close\",\"args\":[],\"exit_code\":0,\"stdout\":\"{\\"success\\":true,\\"data\\":{\\"closed\\":true},\\"error\\":null}\n\",\"stderr\":\"\"}"}]},"jsonrpc":"2.0","id":4}
```
