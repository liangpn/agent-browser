# Minimal AIO + agent-browser 镜像需求文档

**创建日期**: 2026-01-27
**状态**: 实施基准
**优先级**: P0（生产推荐配置）

---

## 1. 目标

构建生产级 AIO Sandbox + agent-browser 集成镜像，实现：
- **零命令注入**：仅暴露受控bash tool，通过hook拦截危险命令
- **最小攻击面**：禁用非必要服务（mcp-server-browser、chrome-devtools-mcp等）
- **可视化验证**：保留VNC+Chromium供演示/调试
- **资源可控**：常驻进程≤9个，镜像≤3GB

---

## 2. 核心设计

### 2.1 MCP工具架构（基于Vercel bash-tool）

**唯一对外工具**：`bash` (MCP tool)
- **实现方式**：使用 `external/vercel-labs_bash-tool` 的 `createBashTool()`
- **Hook拦截机制**：
  ```typescript
  onBeforeBashCall: ({ command }) => {
    // 白名单：仅允许 agent-browser 及必要辅助命令
    if (!command.match(/^(agent-browser|env|printenv)\b/)) {
      throw new Error("仅允许 agent-browser 相关命令");
    }

    // 子命令白名单
    const match = command.match(/^agent-browser\s+(\S+)/);
    if (match && !ALLOWED_SUBCOMMANDS.includes(match[1])) {
      throw new Error(`禁止使用子命令: ${match[1]}`);
    }

    // 强制注入 --cdp 9222（如果缺失）
    if (!command.includes('--cdp')) {
      return { command: command.replace(/^agent-browser/, 'agent-browser --cdp 9222') };
    }
    return { command };
  }
  ```

**允许的子命令**：
```
open, snapshot, click, dblclick, fill, type, press, wait,
screenshot, pdf, close, get-title, get-url, back, forward, reload
```

**禁止的子命令**（高风险）：
```
eval, evaluate, upload, download, route, unroute
```

### 2.2 组件保留/移除清单

| 组件 | 状态 | 理由 |
|------|------|------|
| Nginx + auth-backend | ✓ 保留 | JWT鉴权链路 |
| python-server (/v1/*, /mcp) | ✓ 保留 | AIO核心API服务 |
| UI Chromium (CDP 9222) | ✓ 保留 | agent-browser连接目标 |
| VNC (Xvfb + x11vnc + websockify) | ✓ 保留 | 可视化验证 |
| MCP Hub | ✓ 保留 | 聚合MCP server（仅1个） |
| **mcp-server-browser** | ✗ 移除 | 扩大工具面 |
| **chrome-devtools-mcp** | ✗ 移除 | 隐藏工具 |
| **gem-server** | ? 待验证 | 需确认JWT依赖 |
| **tinyproxy** | ✗ 移除 | 非核心 |
| **JupyterLab / code-server** | ✗ 移除 | 非必要 |

### 2.3 agent-browser集成

**安装方式**：从本地 `bin/` 目录复制预编译二进制
```dockerfile
COPY bin/agent-browser-linux-* /opt/agent-browser/bin/
COPY dist/ /opt/agent-browser/dist/
COPY node_modules/ /opt/agent-browser/node_modules/
RUN ln -s /opt/agent-browser/bin/agent-browser-linux-$(uname -m) /usr/local/bin/agent-browser
```

**环境变量**：
- `BROWSER_REMOTE_DEBUGGING_PORT=9222` - AIO已有
- `AGENT_BROWSER_SESSION` - 由MCP server按sessionId动态设置

---

## 3. 交付物

### 3.1 Dockerfile

**路径**: `deploy/aio-agent-browser-minimal/Dockerfile`

**关键步骤**：
1. 基于 `ghcr.io/agent-infra/sandbox:1.0.0.152`
2. 删除禁用服务的supervisord配置文件
3. 覆盖 `mcp-hub.json.template`（仅聚合bash-tool server）
4. 安装agent-browser + 依赖
5. 复制 `bash-mcp-server.mjs`

### 3.2 bash-mcp-server.mjs

**路径**: `deploy/aio-agent-browser-minimal/bash-mcp-server.mjs`

**核心逻辑**：
- 基于 `@vercel/bash-tool` 构建stdio MCP server
- 实现 `tools/list` 和 `tools/call`
- 在 `onBeforeBashCall` hook内做白名单校验
- 无需自己实现命令执行（复用Vercel bash-tool的Sandbox接口）

### 3.3 mcp-hub.json

**路径**: `deploy/aio-agent-browser-minimal/mcp-hub.json`

**配置**：仅聚合一个stdio server
```json
{
  "mcpServers": {
    "bash_tool": {
      "command": "node",
      "args": ["/opt/agent-browser/bash-mcp-server.mjs"],
      "env": {}
    }
  }
}
```

### 3.4 docker-compose.yml

**端口**: `8082:8080`
**环境变量**：
```yaml
BROWSER_REMOTE_DEBUGGING_PORT: 9222
MCP_HUB_WAIT_PORTS: ""  # 移除8100（已禁用mcp-server-browser）
DISABLE_JUPYTER: "true"
```

---

## 4. 验证标准

### 构建阶段
- ✅ `docker build` 成功
- ✅ 镜像大小 ≤ 3GB
- ✅ 容器启动healthy

### 运行时
- ✅ `docker exec <container> supervisorctl status` 显示常驻服务 ≤ 9个
- ✅ `curl http://localhost:8082/mcp -d '{"method":"tools/list"}'` 仅返回 `bash` 工具
- ✅ VNC可访问 `http://localhost:8082/vnc`

### 功能验证
- ✅ Smoke test: `agent-browser open http://example.com` 成功
- ✅ 白名单生效: `rm -rf /` 等命令被拒绝
- ✅ 自动注入CDP: 执行 `agent-browser open URL` 自动添加 `--cdp 9222`

---

## 5. 实施顺序

1. **Phase 4 (Architecture)**: 设计 bash-mcp-server.mjs 详细实现
2. **Phase 5 (Implementation)**: 调用 codeagent skill 执行编辑
3. **Phase 6 (Review)**: Docker构建 + 功能测试
4. **Phase 7 (Summary)**: 输出完成承诺

---

## 6. 风险与限制

**已知风险**：
- Vercel bash-tool需要 `just-bash` 依赖（或自定义Sandbox实现）
- gem-server移除可能影响JWT（需实际验证）

**MVP限制**（终态需额外开发）：
- 单VNC/单Chromium，无会话隔离
- 无idle TTL自动回收
- 无多租户资源隔离
