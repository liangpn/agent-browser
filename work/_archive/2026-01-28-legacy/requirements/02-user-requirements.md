# 用户需求清单

## MVP 目标（已完成）

### 功能需求
1. **预装 agent-browser**
   - 容器内预装 agent-browser（Rust + Playwright）
   - 复用 AIO 自带可视化 Chromium（CDP 9222）
   - 通过 `--cdp 9222` 连接容器内 Chromium

2. **VNC 可视化**
   - 用户能通过浏览器打开 VNC
   - 实时观看 Agent 操作浏览器的过程
   - 正确路径：`http://localhost:8082/vnc/index.html?autoconnect=true`

3. **受控 MCP 工具**
   - 对外只暴露一个 MCP tool
   - 只能执行 `agent-browser` 白名单子命令
   - 强制 `--cdp 9222`，禁止 shell 元字符与命令替换

4. **统一入口**
   - Cursor/IDE、CLI、Postman 统一走 `/mcp` 调用
   - 支持完整操作闭环：`open` → `snapshot -i` → `click/fill/press/wait` → `snapshot` → `close`

### 安全需求
1. **零命令注入**
   - 不接受任何 shell/命令字符串输入
   - 仅允许结构化参数（`subcommand` + `args[]`）
   - 子命令白名单：open/snapshot/click/fill/type/press/wait/screenshot/close
   - 禁止：eval/evaluate/upload/download/route

2. **JWT 鉴权**
   - 生产环境启用 AIO JWT 鉴权
   - 设置 `JWT_PUBLIC_KEY`
   - API 请求使用 `Authorization: Bearer <jwt>`

3. **API 端点收敛**
   - 仅暴露 `/mcp`、`/v1/mcp`、`/vnc`
   - 阻断 `/v1/shell/exec` 等高风险接口

## Minimal 版本特定需求

### 资源控制
1. **服务数量**：常驻进程 ≤ 9 个
2. **镜像大小**：≤ 3GB（目标 ~2.75GB）
3. **空闲内存**：≤ 700MB（目标 ~650MB）

### 服务精简
**必须保留**：
- Nginx + auth-backend（JWT鉴权）
- python-server（`/v1/*`、`/mcp` 后端）
- UI Chromium（CDP 9222）
- VNC 桌面
- MCP Hub（仅聚合一个 server）

**必须移除**：
- mcp-server-browser
- chrome-devtools-mcp
- tinyproxy
- JupyterLab / code-server

## 当前交付状态

### 已实现
✅ 仅 1 个 MCP tool（bash）
✅ 仅 1 个 MCP server（bash_tool）
✅ VNC 可访问

### 待修复
❌ CDP 端口未监听（Chromium 未启动）
❌ Playwright 依赖未完整安装
❌ API 端点未完全收敛（FastAPI 仍暴露多余接口）

## 用户反馈要点

1. **MCP 协议**：使用 Streamable HTTP，不是 SSE
2. **VNC 路径**：正确路径是 `/vnc/index.html?autoconnect=true`
3. **CDP 连接**：容器内应有 CDP 9222 监听，而非宿主机
4. **镜像瘦身**：当前镜像 8.74GB，远超 3GB 目标
