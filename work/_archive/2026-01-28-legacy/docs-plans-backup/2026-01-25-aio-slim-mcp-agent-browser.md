# AIO Sandbox 瘦身规划：仅保留受控 bash tool（agent-browser）

## 1. 背景与结论

现状：`agent-infra/sandbox`（AIO Sandbox）是一个“All-in-One”镜像，默认集成了：
- 可视化桌面（Xvnc + Openbox + noVNC/WebSocket proxy）
- Chromium（CDP 9222）
- Shell/File/Code execute 等 API
- MCP Hub（`/mcp` 聚合多个 MCP server）
- VS Code Server、Jupyter、Browser MCP Server（Playwright DOM 级）等

我们已验证：在 AIO 内预装 `agent-browser`（Rust + Playwright），并通过 `--cdp 9222` 连接同一个可视化 Chromium，即可完成稳定的 browser automation 闭环。

因此本阶段目标是把 AIO “收敛为一个工具”：对外 **只暴露一个 MCP tool**，且该 tool **只能执行 `agent-browser` 的白名单子命令**。其它浏览器工具（AIO 原生 `browser_*` / `sandbox_browser_*`）以及通用 Shell/File/Code 工具均不作为对外能力。

## 2. 当前 AIO（运行态）盘点（用于瘦身定位）

以当前集成镜像运行态为例（容器内观测）：

### 2.1 MCP Hub 当前聚合的 servers

`/opt/gem/mcp-hub.json` 中当前包含（至少）：
- `sandbox`：`http://127.0.0.1:8091/mcp`（提供 `sandbox_execute_bash`、文件/代码执行等一组工具）
- `browser`：`http://127.0.0.1:8100/mcp`（`mcp-server-browser`，Playwright DOM 级工具：`browser_navigate/click/...`）
- `chrome_devtools`：`chrome-devtools-mcp`（stdio 模式，连接 `http://127.0.0.1:9222`，hidden）

结论：如果我们希望对外只暴露一个工具，需要同时做到：
- MCP Hub 层：把聚合 server 收敛为 1 个（只包含“受控 bash tool server”）
- 进程层：停止/移除 `mcp-server-browser` 与 `chrome-devtools-mcp` 这类冗余常驻进程

### 2.2 常驻进程与端口（粗分组）

常驻且必须（为满足“可视化 + Chromium + /mcp”）：
- `browser`（Chromium + CDP 9222）
- Xvnc/Openbox/WebSocket proxy（VNC 可视化）
- Nginx（入口 8080）
- MCP Hub（对外 `/mcp`）

常驻且可关闭（不影响 agent-browser + MCP）：
- `code-server`（8200）
- `jupyter-lab`（8888）
- `mcp-server-browser`（8100）
- `chrome-devtools-mcp`（hidden，但仍常驻）

备注：现镜像支持 `DISABLE_JUPYTER`、`DISABLE_CODE_SERVER`（仅关闭进程，无法减少镜像体积）。

## 3. 目标形态（Slim Profile）

### 3.1 对外能力（唯一 MCP tool）

只暴露一个 MCP tool：
- `sandbox_execute_bash`：执行受控的 `agent-browser` 命令（白名单子命令 + 白名单 flags + 参数校验）

说明：为复用大量 MCP client 的既有调用习惯（很多 client 已内置/示例化 `sandbox_execute_bash`），Slim 方案沿用该 tool 名称，但实现为“只允许 agent-browser”的受控执行器（并非任意 bash）。

不对外暴露：
- AIO 默认 `sandbox` MCP server 的通用能力（任意命令执行、文件/代码执行等）
- `file_*`、`sandbox_file_operations`
- `sandbox_execute_code`
- AIO 自带 `browser_*`（Playwright DOM 工具）
- `sandbox_browser_*`（坐标/键鼠注入工具）

### 3.2 运行时组成（最小集合）

保留：
- Chromium（可视化）+ CDP
- VNC 可视化链路
- MCP Hub（保持 `/mcp` 入口不变，方便 Cursor 等 client）
- `agent-browser`（Rust CLI + Node daemon + Playwright）
- 新增：`agent-browser-mcp-server`（提供唯一 tool，并做安全校验）

禁用：
- `mcp-server-browser`
- `chrome-devtools-mcp`
- `code-server`、`jupyter`

## 4. L0（优先落地）：在现有 AIO 基础镜像上做“配置/编排瘦身”

L0 的定位：不重做 AIO 基础镜像构建链路；通过派生镜像覆盖配置文件与 supervisord 进程编排，做到：
- 对外仅暴露一个 MCP tool
- 运行时不拉起冗余进程
- 保持 VNC+Chromium 稳定可用

### 4.1 派生镜像需要做的事情（文件级）

1) 覆盖 MCP Hub 配置
- 覆盖容器内 `/opt/gem/mcp-hub.json.template`：只保留一个 `mcpServers.agent_browser`（或同名）
- 从配置中移除 `sandbox`、`browser`、`chrome_devtools`

2) 覆盖 supervisord 进程编排
- 禁用或移除：
  - `/opt/gem/supervisord/supervisord.mcp.conf`（其中包含 `mcp-server-browser`）
  - `chrome-devtools-mcp` 相关启动项（可能在其它 conf 内）
- 保留并新增：
  - 启动 `agent-browser-mcp-server`（stdio 模式，无需监听端口）
  - 启动 `mcp-hub`（从新的 mcp-hub.json 聚合我们的 server）

3) 默认关闭 code-server 与 jupyter
- 在 compose 里默认：
  - `DISABLE_JUPYTER=true`
  - `DISABLE_CODE_SERVER=true`

### 4.2 MCP Hub 的推荐连接形态

保持对外入口不变：
- Cursor / 任意 MCP client 仍然只需要配置 `http(s)://<host>:<port>/mcp`
- MCP Hub 内部转发到 `agent-browser-mcp-server`

## 5. L0 安全设计：vercel bash-tool hooks 思路（强制）

你要求 L0 就引入 “vercel bash tool（hooks 拦截危险命令）” 的能力，建议采用其核心思想：
- `onBeforeBashCall`：执行前审计/改写/拒绝
- `onAfterBashCall`：执行后做输出裁剪/脱敏/审计

我们不直接暴露“任意 bash”，而是将其变成“受控 agent-browser 执行器”：

### 5.1 输入设计（推荐结构化，避免注入）

不要让客户端传入任意 `cmd` 字符串再交给 shell。推荐输入 schema：
- `session`：字符串（必填）
- `cdpPort`：默认 9222（可选，但建议固定）
- `subcommand`：枚举（白名单）
- `args`：字符串数组（可选）
- `timeoutSec`：默认 30（可选）

服务端用 `spawn("agent-browser", argv, { env })` 直接执行，完全避免 `; | && $(...)` 类 shell 注入。

### 5.2 白名单策略（强约束）

仅允许这些子命令（建议先覆盖最常用闭环，后续再扩）：
- `open`
- `snapshot`
- `click` / `dblclick`
- `type` / `fill` / `press`
- `hover` / `focus`
- `check` / `uncheck` / `select`
- `wait`
- `screenshot`（如启用，限制输出路径只能在 `/tmp`）
- `close`

仅允许这些全局 flags（示例）：
- `--cdp <port>`：强制为 `9222`
- `--json`：强制打开（避免混杂输出）
- 其它可能需要的 flags（如 `--debug`）需评估后逐个放行

强制环境变量：
- `AGENT_BROWSER_SESSION=<session>`

### 5.3 hook 逻辑（对齐 vercel 思路）

在 “onBefore” 阶段做：
- 白名单校验（子命令/flags/参数类型/参数范围）
- 强制补齐（自动注入 `--cdp 9222 --json`）
- 资源约束（timeout 上限、并发上限、session id 格式）
- 审计记录（user/session/timestamp/argv）

在 “onAfter” 阶段做：
- 截断 stdout/stderr（例如 30KB）
- 脱敏（如命令参数包含 token）
- 结构化返回（只返回 `exit_code/stdout/stderr`）

## 6. 瘦身收益评估（务实口径）

### 6.1 L0 的收益（主要是运行时资源与攻击面）

通过禁用 code-server/jupyter/mcp-server-browser/chrome-devtools-mcp：
- 容器常驻进程减少（CPU/RSS/FD/端口占用下降）
- MCP 对外能力收敛，安全面显著变小

但注意：L0 并不显著减少镜像体积（因为组件仍然在镜像里，只是不启动）。

### 6.2 L1（后续）才是“真正变小”的镜像体积优化

要显著减小镜像体积，需要从构建层面移除：
- code-server 发行包与其依赖
- jupyter 与 python 包集合
- mcp-server-browser/chrome-devtools-mcp 依赖树

这要求能拿到 AIO 镜像的完整 Docker 构建链路并改造（如果 upstream 不提供 Dockerfile，需要反向工程或维护自有构建流水线）。

## 7. 实施里程碑（建议）

### Milestone A（本周）：L0 跑通
- 新增 `agent-browser-mcp-server`（唯一 tool，白名单 + hooks）
- 派生镜像覆盖 `/opt/gem/mcp-hub.json.template` 与 supervisord 配置，关闭冗余 MCP servers
- compose 默认禁用 code-server/jupyter
- 验收：
  - MCP `tools/list` 只能看到一个 `sandbox_execute_bash`
  - 通过 Cursor 调用该 tool 完成：open → snapshot → click → close
  - 尝试执行非白名单命令应被拒绝（返回明确错误）

### Milestone B：L1 镜像体积优化（可选）
- 取得或自建 AIO 构建链路
- 彻底移除不需要的发行物与依赖

## 8. 需要进一步确认的唯一点（不影响 L0 开工）

`sandbox_execute_bash` 的 tool 形态（建议二选一）：
- 方案 1（推荐）：结构化参数（subcommand + args），服务端 `spawn` 执行
- 方案 2：接受字符串 `command`，但必须做严格 tokenizer + deny meta characters，并且同样使用 `spawn` 而非 shell

---

## 9. L0 落地清单（工程任务拆分）

> 这一节是“可直接开工”的实现清单，尽量避免依赖 AIO 内部不可控组件源码。

### 9.1 新增一个 MCP Server：`agent-browser-mcp-server`

**职责**：对外暴露唯一 tool `sandbox_execute_bash`，内部运行 `agent-browser`。

**已落地实现（与 mcp-hub 直连兼容）**：
- 语言：Node.js（单文件 ESM，便于随镜像分发）
- 协议：MCP stdio（JSON-RPC，每行一条 JSON，以 `\\n` 分隔；对齐 `@modelcontextprotocol/sdk`）
- 执行方式：`spawn("agent-browser", argv, { shell: false })`，禁止 shell

**对外入参（MVP 兼容形态）**：
- `cmd`（string，必填）：命令字符串，但会被严格 tokenizer + 白名单校验
- `timeout`（number，选填）：秒数，上限 120

**执行前（onBefore）已实现**：
- 命令必须为 `agent-browser`（拒绝任意其它二进制）
- 只允许 `AGENT_BROWSER_SESSION=<id>` 这个 env 前缀
- 子命令白名单（open/snapshot/click/fill/type/press/hover/focus/check/uncheck/select/wait/screenshot/close）
- 强制补齐：`--cdp 9222 --json`
- 拒绝 shell 元字符与命令替换（`; | & > <`、换行、`` ` ``、`$(` 等）

**执行后（onAfter）已实现**：
- stdout/stderr 截断（默认 30KB）
- 返回结构化结果（exit_code/stdout/stderr/status）

### 9.2 派生镜像：覆盖 AIO MCP Hub 配置并禁用冗余 MCP 进程

在 `deploy/` 下新增一个 “slim” 变体目录（建议）：
- `deploy/aio-agent-browser-slim/Dockerfile`
- `deploy/aio-agent-browser-slim/docker-compose.yml`
- `deploy/aio-agent-browser-slim/README.md`

**Dockerfile（关键动作）**：
1) 继承 AIO 基础镜像（与当前 MVP 一致）
2) 复制 agent-browser（已完成的方式复用即可）
3) 复制 `agent-browser-mcp-server` 到容器（例如 `/opt/agent-browser-mcp-server`）
4) 覆盖 `/opt/gem/mcp-hub.json.template`，只保留一个 stdio server，例如：
   - `agent_browser`：`{ \"type\": \"stdio\", \"command\": \"node\", \"args\": [\"/opt/agent-browser-mcp-server/server.mjs\"] }`
5) 覆盖/移除 supervisord 配置，确保不再启动：
   - `mcp-server-browser`
   - `chrome-devtools-mcp`
6) 不需要新增常驻进程：`mcp-hub` 会按配置按需 spawn stdio server

**docker-compose（关键动作）**：
- 默认 `DISABLE_JUPYTER=true`
- 默认 `DISABLE_CODE_SERVER=true`
- 保持 VNC/Chromium 必须环境变量不变（DISPLAY、BROWSER_REMOTE_DEBUGGING_PORT=9222 等）
- Slim profile 需要设置：`MCP_HUB_WAIT_PORTS=8091`（避免 mcp-hub-wait 默认等待 8100 导致启动阻塞）

### 9.3 验收用例（L0 必备）

1) `tools/list` 只能看到 1 个 tool：`sandbox_execute_bash`
2) 调用用例：
   - `open http://127.0.0.1:8080/`（优先用容器内自带页面，避免外网不可达）
   - `snapshot -i`
   - `click @e3`（以 AIO 首页按钮为例）
   - `close`
3) 反例必须失败（安全）：
   - 传入 `subcommand="bash"` 或 `args` 含 `;`、`&&`、`|` 等
   - 传入任意非白名单子命令
   - 传入写文件路径不在 `/tmp`
