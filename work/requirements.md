# Minimal AIO + agent-browser：需求大纲（冻结版）

**最后确认日期**：2026-01-31  
**状态**：冻结（后续变更必须更新本文件，并在 `work/backlog.md` 记录变更原因与影响）

## 0. 目标（一句话）

基于 AIO Sandbox（`ghcr.io/agent-infra/sandbox:latest`）构建派生镜像，对外通过 AIO 自带 **Streamable HTTP `/mcp`** 仅暴露一个受控工具 `browser-shell`，该工具只能驱动容器内可视化 Chromium（CDP `9222`）执行 `agent-browser` 的白名单子命令，并具备明确的结构化入参/出参以降低命令注入风险。

---

## 1. 交付物

### 1.1 镜像

- 产出一个派生镜像（下称“Minimal 镜像”）
- 基础镜像：`ghcr.io/agent-infra/sandbox:latest`
- 目标平台：**linux/amd64 + linux/arm64**（multi-arch）
- 相关外部仓库清单：`work/docs/references.md`

### 1.2 agent-browser（运行时内置）

Minimal 镜像内必须包含并可运行：
- `agent-browser`（Linux amd64/arm64 对应的原生二进制）
- `dist/`（Node 侧运行时代码）
- `node_modules/`（运行时依赖，至少包含 `playwright-core`）

说明：
- 不要求在镜像内包含 Rust toolchain（仅运行已编译二进制即可）
- Node.js 运行时由基础镜像提供（不在派生镜像内额外安装/固定版本）
- **不安装额外的 Playwright 下载版 Chromium**；Chromium 由 AIO 自带 UI Chromium 提供

### 1.3 Agent 使用说明（Skills）

Minimal 镜像需要提供一份“面向 Agent”的工具使用说明（用于告诉 Agent 如何调用 `browser-shell`、如何解析回包、以及常见错误/约束）：

- `work/skills/browser-shell/SKILL.md`

---

## 2. 对外 HTTP 暴露（最小面）

对外只允许以下路径（其余统一 `403`）：
- `/mcp`（AIO MCP Hub：streamable HTTP，客户端唯一入口）
- `/vnc`（noVNC + websockify，浏览器观看 UI）
- `/tickets`（用于 JWT 场景下换取 VNC 访问所需 ticket）

说明：
- 目标是“对外不可达”，不强求在镜像内部彻底移除所有其它端点实现
- `JWT_PUBLIC_KEY` 等鉴权链路由 AIO 原生机制承担
- 不要求对外提供 stdio；`browser-shell` 在 AIO 内部的挂载/调用机制不做约束（沿用 AIO 现有机制即可）
- `/mcp` 为 MCP Streamable HTTP：手动用浏览器打开可能会看到 `Not Acceptable`（需要客户端 Accept `text/event-stream`），属于预期现象

---

## 3. MCP 工具面（唯一工具）

### 3.1 工具名称

- Tool name：`browser-shell`
- 对外 `tools/list` 必须只返回该工具（无其它内置 tool）

### 3.2 入参：结构化 Schema（禁止字符串命令）

`browser-shell` 的 `arguments` 必须是结构化对象：

```json
{
  "session_id": "u1",
  "argv": ["open", "https://example.com"],
  "timeout_sec": 30
}
```

约束：
- `session_id`：`[a-zA-Z0-9._-]{1,64}`
  - 该值必须被映射为底层 `agent-browser --session <session_id>`（用于区分 daemon/socket/pid，避免会话串扰）
- `argv`：数组（扁平、贴近 CLI）
  - `argv[0]`：白名单子命令（见 3.4）
  - `argv[1...]`：子命令参数；每个元素必须是 string/number/boolean（服务端转 string）；限制最大元素数与单项长度
  - `argv` 中禁止出现任何 `agent-browser` 全局危险参数（例如 `--cdp` / `--json` / `--session` 等），这些由服务端强制注入且不可覆盖
- `timeout_sec`：可选；上限 120；默认 30

### 3.3 出参：结构化字典（禁止仅返回裸文本）

`tools/call` 成功时返回 `content[0].text`（文本）但其内容必须是 JSON 字典字符串，结构包含：

```json
{
  "session_id": "u1",
  "exit_code": 0,
  "stdout": "{...}",
  "stderr": ""
}
```

约束：
- 回包 **不回显** 请求参数（不返回 `subcommand/args/argv`），避免冗余与误用
- `stdout/stderr` 必须截断（防止超大输出）
- `stdout` 为 **data-only JSON**（`browser-shell` 会把 `agent-browser --json` 的 `{success,data,error}` 结构归一化为仅输出 `data`）
  - 成功：`exit_code = 0`，`stdout` 为 `JSON.stringify(data) + "\n"`（当 `data` 为空时可能为 `null\n`）
  - 失败：`exit_code != 0`（若上游退出码为 0 但 `success=false`，则强制置为 1），错误信息写入 `stderr`；`stdout` 为空或为少量 data

决策记录（2026-01-30）：
- 回包 **仅保留** `session_id/exit_code/stdout/stderr`，移除顶层 `success/data/error/status`，避免重复字段；
- 同时将 `agent-browser --json` 的 stdout 做 **data-only 归一化**：调用方只需解析 `stdout` 一次即可得到结构化结果（无需再处理 `{success,data,error}`）。

决策记录（2026-01-31）：
- 回包不再携带 `subcommand/args`（调用方已在入参中提供 `argv`，无需回显）。

层次说明（避免把外层封装误认为是 tool 输出）：
- MCP 标准：响应为 `{ content: [{ type, text }, ...] }`（`content` 为数组是为了支持多段/多模态内容）
- browser-shell tool 输出：`content[0].text` 中的 JSON 字典（本节定义的 schema）
- Cherry Studio 导出：可能额外包一层 `{ params, response }`（属于客户端记录格式）

### 3.4 允许的子命令（allowlist）

P0 必须支持（最小闭环）：
- `open`
- `snapshot`（需支持 `-i` 透传）
- `click`
- `fill`
- `type`
- `press`
- `wait`
- `screenshot`
- `close`

P1 可选支持（若实现成本低且不扩大风险面）：
- `dblclick`
- `hover`
- `focus`
- `check`
- `uncheck`
- `select`

明确禁止（denylist，哪怕上游 agent-browser 支持也不开放）：
- `eval` / `evaluate`
- `upload` / `download`
- `route` / `unroute`

---

## 4. 执行与安全边界

### 4.1 复用 AIO UI Chromium（CDP 9222）

强制规则：
- 仅允许连接容器内 `localhost:9222`
- 对 `agent-browser` 调用必须强制注入：`--cdp 9222`
- 用户输入不得以任何形式覆盖 `--cdp`（包含 `--cdp` 与 `--cdp=...`）

### 4.2 禁止命令注入语义

强制规则：
- 对外不接受任何“shell 命令字符串”
- 执行层必须使用 `spawn(argv, { shell: false })`（或等价方式），禁止通过 shell 解释
- 禁止管道/重定向/命令替换语义（因为根本不存在 cmd 字符串入口）

### 4.3 Vercel bash-tool 的使用方式（约束）

采用 **Vercel bash-tool 的 hook 拦截模型** 作为设计约束（onBefore/onAfter 思路），用于：
- onBefore：参数校验、白名单、强制注入 `--cdp 9222`、强制 `--json`
- onAfter：结构化回包、stdout/stderr 截断、脱敏（如出现 token 类字段）

说明：
- 不强制直接引入 `@vercel/bash-tool` 作为执行引擎（因为其默认执行模型包含 shell 语义字符串拼接）；但必须保留其“可插拔 hook + 安全默认值”的设计目标

### 4.4 `open` URL 白名单（配置驱动）

强制规则：
- `open` 仅允许打开 `http(s)://`（可选允许 `about:blank`）；禁止 `file://`、`data:`、`chrome://`、`devtools://` 等 scheme
- 默认禁止访问本机/私网/链路本地等地址（例如 `localhost`、`127.0.0.1`、`::1`、RFC1918/ULA/link-local 段）
- 必须支持“仅允许特定网站”的 allowlist（配置文件提供），用于将可访问范围收敛到明确域名集合
- 该白名单/规则必须通过“配置文件”提供；未提供配置文件时使用上述安全默认值

配置文件建议：
- 格式：JSON
- 默认路径：`/etc/agent-browser/browser-shell.policy.json`（可后续通过 env 覆盖，但不是本轮必须）

配置示例（最小）：

```json
{
  "open": {
    "allow_schemes": ["http", "https"],
    "allow_about_blank": true,
    "allow_hosts": ["example.com"],
    "allow_host_suffixes": [".example.com"]
  }
}
```

语义约定：
- allowlist 仅按“域名/子域名”维度生效（`allow_hosts` 与 `allow_host_suffixes`）
- 若配置中存在任一 allowlist 字段，则 `open` 必须命中 allowlist 才允许
- 即便命中 allowlist，仍需校验禁止 scheme 与（默认）私网/本机地址限制（包含 DNS 解析后的 IP 校验；禁止解析到本机/私网/链路本地地址）

---

## 5. 非目标（本轮不做）

- 多租户/多会话可视化隔离（单 VNC/单 UI Chromium 的共享限制接受）
- 彻底移除 AIO 内部所有 `/v1/*` 路由实现（只要求对外 403）
- 增加新的对外端口/新增自建 SSE 服务器（只用 AIO 的 `/mcp`）
- 代理/出站网络策略增强（除非与安全评审强相关）

---

## 6. 验收标准（只定义，不在本阶段执行）

### 6.1 工具面
- `tools/list` 仅返回一个工具：`browser-shell`

### 6.2 功能闭环
- 通过 `browser-shell` 可完成：`open → snapshot -i → click/fill/press/wait → close`
- VNC 中能观察到页面动作变化

### 6.3 安全与约束
- 任何非白名单 `argv[0]` 必须被拒绝
- 任何尝试在 `argv` 中传入 `--cdp` / `--json` / `--session` 等必须被拒绝（或被安全重写为“不可覆盖”）
- 输出必须为结构化 JSON 字典（并截断 stdout/stderr）
