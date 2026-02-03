# Minimal AIO + agent-browser：Backlog（以此为准）

**最后更新**：2026-01-31  
**对应需求**：`work/requirements.md`

## 状态约定

- `todo`：未开始
- `doing`：进行中
- `blocked`：阻塞（需先解决前置条件）
- `done`：已完成

---

## P0（必须）

### P0-0 需求冻结与目录清理
- 状态：done
- 交付：`work/requirements.md`、`work/backlog.md`、work 目录归档与 README 更新

### P0-1 明确 Minimal 的“唯一 MCP tool”收敛方式
- 状态：done
- 目标：对外 `/mcp` 的 `tools/list` 只出现 `browser-shell`
- 工作项：
  - 覆盖 AIO 的 `mcp-hub.json.template`（只保留一个 stdio server）
- 完成标准：
  - 文档化配置位置、覆盖方式、以及最终 mcp-hub 配置样例（只包含 `browser-shell`）

### P0-2 定义 `browser-shell` 的 JSON Schema（最终版）
- 状态：done
- 目标：固定工具入参/出参，杜绝 cmd 字符串入口
- 工作项：
  - `arguments` schema：`session_id` / `argv[]` / `timeout_sec`（其中 `argv[0]` 为子命令）
  - `subcommand` allowlist（P0 集合）与 denylist（高风险）
  - 输出字典字段最小集合（`session_id/exit_code/stdout/stderr`）与截断规则（不回显 `subcommand/args/argv`）
- 完成标准：
  - schema 文档在 `work/requirements.md` 中保持一致
  - 明确列出每个 subcommand 的 args 最小/最大约束

### P0-3 设计并实现“Vercel bash-tool 风格 hooks”的执行器（无 shell）
- 状态：done
- 目标：保留 `onBefore/onAfter` 拦截模型，但执行层必须是 `spawn(argv, { shell:false })`
- 工作项：
  - onBefore：参数校验、拒绝 `--cdp/--json` 覆盖、强制注入 `--cdp 9222 --json`
  - onBefore：`open` URL 白名单校验（配置驱动；默认拒绝本机/私网等高风险地址；allowlist 仅按域名/子域名维度）
  - 执行：只允许运行 `agent-browser`，且 argv 完全由结构化参数拼装
  - onAfter：输出截断、结构化回包、（可选）脱敏
- 完成标准：
  - 不存在任何 `cmd` 拼接为 shell 命令字符串再执行的路径
  - 对非法参数返回明确错误消息（可直接用于用户排障）

### P0-4 Minimal 镜像内置 agent-browser 运行时（不额外安装浏览器）
- 状态：done
- 目标：镜像内 `agent-browser` 可运行，且通过 `--cdp 9222` 驱动 AIO UI Chromium
- 工作项：
  - 明确镜像内安装布局（例如 `/opt/agent-browser/{bin,dist,node_modules}` + `/usr/local/bin/agent-browser`）
  - 保证 `node_modules` 为运行时依赖（避免 dev 依赖膨胀）
  - 确认不触发 Playwright 下载 Chromium（避免体积暴涨）
- 完成标准：
  - 文档化“需要拷贝的文件清单”
  - 说明为何不需要 Rust toolchain

### P0-5 Multi-arch 交付策略（linux/amd64 + linux/arm64）
- 状态：done（交付构建脚本与命令清单；不在本阶段实际发布）
- 目标：同一镜像 tag 支持两种架构
- 工作项：
  - `agent-browser` 二进制准备：`linux-x64` + `linux-arm64`
  - Docker buildx 产出 manifest（或等价发布流程）
- 完成标准：
  - 明确“产物命名规范”和“构建/发布命令清单”（只写清单，不在本阶段执行）

### P0-6 HTTP 路径白名单策略（/mcp /vnc /tickets）
- 状态：done
- 目标：对外最小面：只放行 `/mcp`、`/vnc`、`/tickets`，其余 403
- 工作项：
  - 明确 AIO 推荐的 Nginx 扩展/覆盖方式（避免破坏 auth 链路）
  - 给出最终的路由策略配置样例
- 完成标准：
  - 文档化“放行清单 + 403 清单”与配置落点

### P0-7 最小使用文档（面向用户/客户端）
- 状态：done
- 目标：让 Cursor/CLI/Postman 能按同一套调用方式使用
- 工作项：
  - `/mcp` 的 `tools/list` 与 `tools/call` 示例（包含 `browser-shell` `argv` 入参）
  - VNC 访问与 ticket 交换流程说明
  - `open` URL 白名单配置文件的挂载/示例
- 完成标准：
  - 一页 README 即可完成“启动 → 连接 MCP → 看到 VNC → 跑通闭环”的指引

### P0-8 真实环境验收（不模拟）
- 状态：done
- 目标：在真实容器中验证需求的验收标准（见 `work/requirements.md`）
- 工作项：
  - 已完成：VNC 可访问（`/vnc/index.html?autoconnect=true`）
  - 已完成：HTTP 端点最小面（`/mcp`、`/vnc`、`/tickets` 可达；其余如 `/v1/docs` 为 `403`）
  - 已完成：`tools/list` 仅返回 `browser-shell`
  - 已完成：真实客户端调用记录已归档：`work/validation/cherrystudio-use.md`

### P0-9 `browser-shell` 回包结构优化（减少嵌套/二次解析）
- 状态：done
- 目标：减少重复字段；回包仅保留 `session_id/exit_code/stdout/stderr`，调用方解析 `stdout` 的 JSON
- 说明：
  - `browser-shell` 不在顶层提供 `success/data/error/status`
  - 回包不回显 `subcommand/args/argv`
  - 同时将 `agent-browser --json` 的 stdout 从 `{success,data,error}` 归一化为 **data-only JSON**（错误信息写入 `stderr`）
- 完成标准：
  - 输出 schema 在 `work/requirements.md` 明确
  - 更新 `work/skills/browser-shell/SKILL.md`（说明如何解析 stdout）

### P0-10 提供 `browser-shell` 的 Agent 使用指南（Skills）
- 状态：done
- 目标：提供一份“面向 Agent”的 tool 使用说明（包含入参约束、允许的子命令、推荐调用流程、常见错误）
- 交付：`work/skills/browser-shell/SKILL.md`

### P0-11 记录 Cherry Studio / MCP 客户端的接入注意事项
- 状态：done
- 目标：把真实客户端的踩坑点与调用样例固化，便于后续回归
- 交付：
  - `work/validation/cherrystudio-use.md`
  - `work/deploy/aio-agent-browser-minimal/README.md`（补充 `/mcp` Accept header 说明与 curl 样例）

### P0-12 `browser-shell` 入参设计：更贴近 agent-browser 原生命令
- 状态：done
- 目标：减少“subcommand/args 重复与易用性误用”（例如把 `snapshot` 写进 `args`）
- 选型：
  - 仅支持 `argv`（不兼容 `subcommand/args`）
- 变更原因与影响：
  - 原因：更贴近 `agent-browser` 原生命令输入形态（更扁平），并消除“subcommand/args 重复填写”的误用空间
  - 影响：对外 **入参 breaking change**；所有客户端/Skills 示例必须改为 `argv` 形态
- 完成标准：
  - 选型写入 `work/requirements.md` 并更新 `work/skills/browser-shell/SKILL.md`

### P0-13 `browser-shell` Skills：对齐 agent-browser README（含 `--help` 思路）
- 状态：done
- 目标：让 Agent 不用“猜”命令用法；同时明确哪些命令被 allowlist 限制
- 工作项：
  - 参考 `README.md` 与 `skills/agent-browser/SKILL.md`，补齐工具用法与示例
  - 说明 `snapshot -i` 等常用参数
  - 明确 `--help` 的使用策略（仅文档说明 vs 提供安全的 tool help 模式）

---

## P1（重要但可后置）

### P1-1 子命令扩展（在不扩大风险面的前提下）
- 状态：todo
- 内容：`dblclick/hover/focus/check/uncheck/select` 等（见 `work/requirements.md`）

### P1-2 错误码与可观测性
- 状态：todo
- 内容：统一错误码、输出脱敏、调用审计日志（user/session/subcommand/exit_code/latency）

---

## 风险与约束（持续更新）

- 使用 `ghcr.io/agent-infra/sandbox:latest`：上游变更可能导致不可复现；需要在故障时快速回退到可用版本（仅作为风险记录，不改变当前需求）
