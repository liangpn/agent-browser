# Minimal 镜像目标定义

## 核心目标

在 **保留可视化浏览器（VNC + UI Chromium）与鉴权（JWT）** 的前提下，实现：
1. **服务数**：容器内长期常驻服务压缩到 **8–9 个**
2. **工具面**：对外只暴露 **单一结构化 MCP tool**
3. **零命令注入**：不再接受任何 shell/命令字符串输入

## 技术实现

### 1. 服务精简策略

**禁用非必要服务**：
```dockerfile
RUN rm -f /opt/gem/supervisord/supervisord.mcp_server_browser.conf \
          /opt/gem/supervisord/supervisord.chrome_devtools_mcp.conf \
          /opt/gem/supervisord/supervisord.tinyproxy.conf
```

**保留服务清单**（8-9个）：
| 服务 | 说明 |
|------|------|
| Nginx | 网关 + JWT 鉴权 |
| python-server | FastAPI 核心服务 |
| UI Chromium | CDP 9222 |
| Xvfb | 虚拟显示 |
| x11vnc | VNC 服务 |
| websockify | WebSocket 转换 |
| MCP Hub | 聚合 MCP server |
| bash-mcp-server | 唯一的 stdio MCP server |
| supervisord | 进程管理 |

### 2. MCP 工具形态

**从字符串命令升级为结构化 schema**：

**旧形态（Slim）**：
```json
{
  "name": "sandbox_execute_bash",
  "arguments": {
    "cmd": "agent-browser open https://example.com"
  }
}
```

**新形态（Minimal）**：
```json
{
  "name": "agent_browser",
  "arguments": {
    "session_id": "u1",
    "subcommand": "open",
    "args": ["https://example.com"]
  }
}
```

**优势**：
- 从接口层面消灭命令注入语义
- 可做强类型校验
- 便于审计与策略匹配

### 3. 安全边界

**三层防护**：
1. **协议层**：Streamable HTTP，非任意 shell
2. **校验层**：子命令白名单 + 参数校验
3. **执行层**：`spawn()` 无 shell 模式

**禁止的子命令**：
- `eval` / `evaluate` - 可执行任意 JS
- `upload` / `download` - 涉及文件写入/外带
- `route` / `unroute` - 网络 mocking，可能用于 SSRF

## 资源目标

| 指标 | 目标值 | 当前值 | 状态 |
|------|--------|--------|------|
| 镜像大小 | ≤ 3GB | 8.74GB | ❌ 待优化 |
| 空闲内存 | ≤ 700MB | ~650MB | ✅ 已达成 |
| 常驻服务数 | 8-9 个 | 待验证 | ⏳ 待验证 |
| 对外工具数 | 1 个 | 1 个 | ✅ 已达成 |

## 交付物清单

- `Dockerfile` - 镜像构建配置
- `docker-compose.yml` - 本地测试环境
- `mcp-agent-browser-tool.mjs` - 结构化 MCP stdio server
- `mcp-hub.json` - 单一 agent_browser tool 配置
- `nginx-minimal.conf` - 仅允许 /mcp 和 /vnc
- `README.md` - 使用说明

## 验证标准

1. ✅ Docker 构建成功，容器 healthy
2. ✅ MCP `tools/list` 仅返回 `agent_browser` 工具
3. ✅ Smoke Test：`open → snapshot → click → close`
4. ✅ 零命令注入：非法 subcommand/args 被服务端拒绝
5. ✅ API 端点收敛：仅 `/mcp`、`/vnc` 可访问
