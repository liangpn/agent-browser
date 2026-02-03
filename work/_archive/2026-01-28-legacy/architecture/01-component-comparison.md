# Full / Slim / Minimal 组件对比表

## 对比概览

| 组件/服务 | Full（原始/基线） | Slim（当前交付） | Minimal（设计方案） | 备注 |
|---|---:|---:|---:|---|
| Nginx 网关（含 `auth-backend`） | ✓ | ✓ | ✓ | 生产建议始终保留（JWT） |
| `python-server`（`/v1/*`、`/mcp` 后端等） | ✓ | ✓ | ✓ | AIO 核心 API 服务 |
| UI Chromium（CDP `9222`） | ✓ | ✓ | ✓ | 供 VNC 可视化 + agent-browser 连接 |
| VNC 桌面 | ✓ | ✓ | ✓ | Full/Slim 通常为 `Xvnc + openbox + websocat`；Minimal 可切到更小 VNC 栈 |
| MCP Hub（聚合 tools） | ✓ | ✓（仅聚合一个 server） | ✓（仅聚合一个 server） | Full 可能聚合出大量 tools（约 33 个） |
| `mcp-server-browser`（浏览器 MCP server） | ✓ | ✗ | ✗ | Slim/Minimal 默认禁用，避免扩大 tool 面 |
| `chrome-devtools-mcp`（隐藏 MCP server） | ✓（hidden） | ✗ | ✗ | Minimal 直接不打包/不配置 |
| `gem-server`（基线里的 web/gateway/鉴权相关服务） | ✓ | ✓ | ✗ | Minimal 若移除，需确保 JWT 鉴权链路仍可用 |
| `tinyproxy`（出站代理） | 条件 | 条件 | ✗ | 仅在 `PROXY_SERVER` 配置时启用；Minimal 默认不支持 |
| JupyterLab / code-server | 条件 | ✗（默认关闭） | ✗ | 非浏览器自动化核心能力 |
| 对外 MCP tool 形态 | 多工具、含通用 shell | 单工具：`sandbox_execute_bash(cmd)` | 单工具：`agent_browser(subcommand,args[])` | Minimal 从接口层面消灭字符串命令入口 |

## 服务数量对比

| 版本 | 常驻服务数 | 镜像大小 | 空闲内存 |
|------|-----------|---------|---------|
| Full | ~15-20 | ~5GB+ | ~1GB+ |
| Slim | ~10-12 | ~4GB | ~800MB |
| Minimal | 8-9 | ~2.75GB | ~650MB |

## 安全边界对比

### Full
- 对外暴露约 33 个 tools
- 包含通用 shell 执行能力
- 风险面最大
- 适用于：探索/对照/回退

### Slim
- 对外仅暴露 1 个 tool
- 受控 bash tool（字符串命令）
- 需要严格的 cmd 解析和白名单
- 适用于：单用户验证链路

### Minimal
- 对外仅暴露 1 个 tool
- 结构化参数（无字符串命令）
- 零命令注入风险
- 适用于：生产环境

## 选择指南

| 场景 | 推荐版本 | 理由 |
|---|---|---|
| Demo/验证链路（单用户） | Slim | `/mcp` 只有一个受控工具，排障成本低 |
| 内网环境、研发联调、需要更多内置工具 | Full | 方便对照/回退；但风险面大 |
| 生产前压测/容量评估/安全评审 | Minimal | 资源更可控、零命令注入、常驻服务更少 |

## 演进路径

1. **Full → Slim**: 先把对外工具面收敛到单一受控 tool（降低风险面），并保留可视化与排障能力。

2. **Slim → Minimal**: 把 `cmd` 字符串入口替换为 `agent_browser` 结构化 schema，同时进一步关停非必要服务。
