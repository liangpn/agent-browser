# 当前进度（Checkpoint）

**更新时间**：2026-01-31  
**范围**：Minimal AIO + agent-browser（对外仅暴露 `/mcp` + `browser-shell`）

## 现状

- 需求已冻结：`work/requirements.md`
- Backlog：P0 全部 `done`；P1 有 2 项 `todo`：`work/backlog.md`

## 已交付（本轮闭环）

- Minimal AIO 集成产物与启动说明：`work/deploy/aio-agent-browser-minimal/`
- MCP 对外入口：`/mcp`（Streamable HTTP / SSE），`tools/list` 只返回 `browser-shell`
- `browser-shell` 入参：`{ session_id, argv[], timeout_sec? }`（argv-only）
- `browser-shell` 出参：仅 `session_id/exit_code/stdout/stderr`；`stdout` 为 **data-only JSON**（错误写入 `stderr` 且 `exit_code != 0`）
- `open` URL 策略：配置驱动（默认拒绝 localhost/私网等），见 `work/requirements.md`
- Agent 使用说明：`work/skills/browser-shell/SKILL.md`
- 真实验收记录与日志：`work/validation/`
- browser-shell 单测：`work/test/`（日志：`work/validation/npm-test-browser-shell.log`）

## 快速验证（下次继续用）

- 启动：
  - `HOST_PORT=8082 docker compose -f work/deploy/aio-agent-browser-minimal/docker-compose.yml up --build`
  - 若不需要 rebuild：去掉 `--build` 或先 `docker compose ... build` 后再 `up -d`
- VNC：`http://localhost:8082/vnc/index.html?autoconnect=true`
- MCP：`http://localhost:8082/mcp`（需要客户端 `Accept: text/event-stream`）
- 工具调用示例与注意事项：`work/deploy/aio-agent-browser-minimal/README.md`

## 待办（未开始 / 可后置）

- P1-1：扩展 allowlist 子命令（`dblclick/hover/focus/check/uncheck/select` 等）
- P1-2：错误码与可观测性（统一错误码、输出脱敏、调用审计日志等）

## 已知注意事项

- `/mcp` 用浏览器直接打开可能看到 `Not Acceptable`，属于预期（SSE Accept header）。
- 基础镜像使用 `ghcr.io/agent-infra/sandbox:latest`：上游变更存在不可复现风险（可考虑后续 pin digest）。
