# Minimal AIO + agent-browser 镜像 - 工作目录

**创建日期**: 2026-01-28
**项目状态**: 进行中 - Docker 构建阶段
**原始文档**: WORK_LOG_MINIMAL_IMAGE.md（已归档）

---

## 目录结构

```
work/
├── README.md                          # 本文件
│
├── requirements/                      # 需求文档（从 AIO_AGENT_BROWSER_DESIGN.md 拆分）
│   ├── 01-background.md              # 项目背景、核心组件、版本演进
│   ├── 02-user-requirements.md       # 用户需求清单、当前交付状态
│   ├── 03-minimal-goals.md           # Minimal 版本目标定义、资源目标
│   └── 04-original-requirements.md   # 原始需求文档归档
│
├── architecture/                      # 架构设计
│   ├── 01-component-comparison.md    # Full/Slim/Minimal 组件对比表
│   └── 02-mcp-server-design.md       # MCP Server 详细设计（原 bash-mcp-server-architecture.md）
│
├── implementation/                    # 实施产出（从 deploy/ 迁移）
│   ├── README.md                     # 实施文件说明（来自 aio-agent-browser-minimal/README.md）
│   ├── Dockerfile                    # 镜像构建配置（已更新：Nginx + Playwright）
│   ├── docker-compose.yml            # 本地测试环境
│   ├── nginx-minimal.conf            # Nginx 配置（仅允许 /mcp 和 /vnc）
│   ├── bash-mcp-server.mjs           # MCP stdio server 主入口
│   ├── mcp-agent-browser-tool.mjs    # 结构化 MCP tool（替代方案）
│   ├── mcp-hub.json                  # MCP Hub 配置（单一 tool）
│   └── lib/                          # 核心库
│       ├── sandbox.mjs               # SimpleSandbox 实现
│       └── whitelist.mjs             # 命令白名单校验
│
├── testing/                          # 测试文件（从 test/ 迁移）
│   └── unit-tests/                   # 单元测试
│       ├── agent-browser-mcp-server.test.mjs
│       ├── agent-browser-mcp-stdio.test.mjs
│       ├── bash-mcp-server.test.mjs  # ✅ 3/3 通过
│       ├── mcp-agent-browser-tool-http.test.ts
│       └── serverless.test.ts
│
├── docs-plans-backup/                # 文档备份（从 docs/plans/ 迁移）
│   ├── 2026-01-24-aio-agent-browser-integration.md
│   ├── 2026-01-25-aio-slim-mcp-agent-browser.md
│   ├── 2026-01-25-mcp-http-sse-transport.md
│   ├── 2026-01-26-mcp-http-sse-transport-tests.md
│   ├── 2026-01-27-minimal-image-p0-fixes.md
│   ├── bash-mcp-server-architecture.md
│   └── minimal-image-requirements.md
│
├── issues/                           # 问题追踪
│   └── open/                         # 待修复问题
│       ├── P0-1-cdp-port-not-listening.md    # CDP 9222 未监听
│       └── P0-2-image-size-exceeded.md       # 镜像 8.74GB 超标
│
└── logs/                             # 工作日志
    └── progress.md                   # 总体进度追踪
```

---

## 文件迁移清单

### 已迁移的文件

| 原始路径 | 迁移后路径 | 状态 |
|---------|-----------|------|
| `AIO_AGENT_BROWSER_DESIGN.md` | `work/requirements/` (拆分为 01-04) | ✅ 已拆分 |
| `WORK_LOG_MINIMAL_IMAGE.md` | `work/logs/progress.md` | ✅ 已归档 |
| `docs/plans/*.md` | `work/docs-plans-backup/` | ✅ 已备份 |
| `test/*.test.mjs` | `work/testing/unit-tests/` | ✅ 已迁移 |
| `test/*.test.ts` | `work/testing/unit-tests/` | ✅ 已迁移 |
| `deploy/aio-agent-browser-minimal/*` | `work/implementation/` | ✅ 已迁移 |
| `deploy/aio-agent-browser-slim/` | `work/implementation/` | ⏳ 可选 |
| `deploy/aio-agent-browser/` | `work/implementation/` | ⏳ 可选 |

---

## 当前状态

### 已完成
- ✅ 工作目录结构创建
- ✅ 需求文档拆分（4个文件）
- ✅ 架构文档迁移（2个文件）
- ✅ 实施文件迁移（全部核心文件）
- ✅ 测试文件迁移（5个测试文件）
- ✅ 文档备份迁移（7个计划文档）
- ✅ 问题追踪文档创建（2个 P0 问题）

### 进行中
- 🔄 Docker 镜像构建（步骤 10/17，Playwright 安装）

### 待验证
- ⏳ CDP 端口 9222 监听
- ⏳ API 端点收敛（仅 /mcp 和 /vnc 可访问）
- ⏳ 镜像大小是否达标（目标 ≤3GB，当前 8.74GB）

---

## 关键发现

### 用户反馈要点
1. **MCP 协议**：应使用 Streamable HTTP，不是 SSE
2. **VNC 路径**：正确路径为 `/vnc/index.html?autoconnect=true`
3. **CDP 连接**：应在容器内监听 9222，而非宿主机
4. **镜像大小**：当前 8.74GB 远超 3GB 目标

### 核心问题
- ❌ **P0-1**: CDP 端口未监听（Chromium 未启动）
- ❌ **P0-2**: 镜像大小超标（8.74GB > 3GB）
- ⚠️ **P1-1**: API 端点未完全收敛（FastAPI 仍暴露多余接口，已通过 Nginx 拦截）

---

## 下一步行动

1. **等待 Docker 构建完成**（约 2-5 分钟）
2. **启动容器验证**
3. **功能测试**：
   - CDP 端口监听检查
   - MCP 接口工具数量验证
   - API 端点 403 验证
   - Smoke Test: open → snapshot → click → close
4. **问题修复**（如验证失败）

---

## 快速参考

### 构建镜像
```bash
cd work/implementation
docker compose build --no-cache
docker compose up -d
```

### 验证命令
```bash
# 检查 CDP 端口
docker exec <container> netstat -tlnp | grep 9222

# 验证 MCP 工具列表
curl -X GET 'http://localhost:8082/v1/mcp/servers'

# 验证 API 端点收敛
curl -I http://localhost:8082/v1/shell/exec  # 应返回 403
```

### VNC 访问
```
http://localhost:8082/vnc/index.html?autoconnect=true
```
