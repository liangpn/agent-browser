# 验收记录（真实运行日志）

本目录用于存放“真实运行/真实客户端”的调用记录与截图，作为：

- 需求验收的证据
- 调试与回归的输入材料

当前收录：

- Cherry Studio 调用记录（旧格式）：`work/validation/cherrystudio-use.md`
- Cherry Studio 调用记录（中间格式，stdout 内含 `{success,data,error}`）：`work/validation/cherrystudio-use1.md`
- Cherry Studio 调用记录（argv-only 入参）：`work/validation/cherrystudio-use2.md`
- Cherry Studio 调用记录（关注响应体冗余问题）：`work/validation/cherrystudio-use-new.md`
- curl 调用记录（argv-only 入参）：`work/validation/mcp-argv-curl.md`
- 单元测试记录：`work/validation/unit-tests.md`

说明：
- 上述两份 Cherry Studio 记录的 MCP 入参仍是历史版本（`subcommand/args`）。当前 `browser-shell` 已切换为 `argv` 入参（见 `work/requirements.md` 与 `work/skills/browser-shell/SKILL.md`）。
- `browser-shell` 回包字段已去冗余：仅保留 `session_id/exit_code/stdout/stderr`，且 `stdout` 为 **data-only JSON**（从 `agent-browser --json` 的 `{success,data,error}` 归一化而来）；旧记录里可能仍能看到 `{success,data,error}` 或 `subcommand/args`。
- Cherry Studio 导出格式会额外包一层 `{ params, response }`；其中 `response.content[]` 是 MCP 标准结构；我们可控的是 `response.content[0].text` 里的 JSON 字典。
