# AIO Sandbox + agent-browser 集成 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

## Status (Implemented)

L1 deliverables are implemented:
- `deploy/aio-agent-browser/Dockerfile`
- `deploy/aio-agent-browser/docker-compose.yml`
- `deploy/aio-agent-browser/README.md`

Notes:
- Smoke test verified: `open → snapshot → click`.
- The AIO base image is pinned to `ghcr.io/agent-infra/sandbox:1.0.0.152` (fixes the MCP shell tool bug that can throw `cannot access local variable 'working_dir'` when `cwd` is omitted).
- For an externally-exposed `/mcp` that contains only one restricted tool for running `agent-browser`, use `deploy/aio-agent-browser-slim/README.md`.

**Goal:** 基于 `ghcr.io/agent-infra/sandbox` 构建一个“开箱即用”的镜像，在单一容器内预装 `agent-browser`，并支持远程可视化观看（VNC）与多种调用入口（MCP/REST/CLI）。MVP 先实现“可安装、可运行、可通过命令驱动同一个可视化浏览器”，终态再实现“一个容器多用户多会话隔离 + 10 分钟 idle 自动回收”。

**Architecture:** MVP 阶段先把 `agent-browser` 作为容器内的命令行工具，通过 AIO 的 `/v1/shell/exec` 或 MCP 的 `terminal_execute` 执行，从而驱动容器内浏览器（通过 CDP 9222 连接 AIO 自带 Chromium）。终态阶段新增 `agent-browser-gateway` 作为会话控制面（Session Manager），为每个用户会话分配独立浏览器/可视化通道，并做 idle TTL 清理。

**Tech Stack:** Docker（multi-arch buildx）、AIO Sandbox（HTTP API + MCP Hub + VNC）、agent-browser（Rust CLI + Node daemon + Playwright-core）、（可选）Node 网关服务（REST+MCP）、JWT 鉴权与短时票据（AIO 内置）。

---

## 0. 需求边界（明确写进验收标准）

### MVP（优先）
- 自定义镜像 `aio-agent-browser`：在 AIO 基础上可直接运行 `agent-browser`。
- 远程可视化观看：通过 AIO 的 `http://<host>:<port>/vnc/index.html` 看到浏览器被操作。
- 命令驱动：可以通过 AIO 的 `/v1/shell/exec`（或 MCP `terminal_execute`）下发命令，驱动浏览器完成 `open/snapshot/click/fill/...` 的基本闭环。
- 支持多入口：
  - IDE：Cursor 等 MCP client 连接 `http(s)://<host>:<port>/mcp`，调用 `terminal_execute` 运行 `agent-browser ...`。
  - CLI：Claude Code/Codex/opencode 等通过 `curl` 调用 `/v1/shell/exec` 或 `/mcp`。
  - Postman：直接调 `/v1/shell/exec`（或 `/mcp`）。

### 终态（后续迭代）
- 一个容器多用户；每用户/会话隔离；10 分钟无操作自动注销并回收资源。
- 可视化隔离优先级：理想为“每会话独立 VNC”（方案 B），如果太复杂可退化为“每会话独立 streaming 画面”（方案 A）。

---

## 1. MVP 设计（推荐路径）

### 1.1 关键策略：让 agent-browser 控制“同一个可视化 Chromium”

在 AIO 容器内存在一个带 UI 的 Chromium（VNC 桌面中可见），并开放 CDP：
- AIO 文档给出 `BROWSER_REMOTE_DEBUGGING_PORT=9222`，以及 `/v1/browser/info` 返回 `cdp_url`。
- `agent-browser` 支持 `--cdp <port>`，内部使用 `playwright.chromium.connectOverCDP(http://localhost:<port>)`。

因此 MVP 的执行策略是：
1. 第一次命令带 `--cdp 9222`，让 agent-browser 的 daemon 连接到这个可视化 Chromium。
2. 后续命令在同一 `AGENT_BROWSER_SESSION` 下复用连接（无需每次都带 `--cdp`，但为了简单/稳妥可以每次都带）。

注意：MVP 阶段多个用户同时连同一个 `9222` 会互相影响（共享同一 UI）。这个问题在终态用“每会话独立 VNC/CDP”解决。

### 1.2 MVP 的推荐调用方式（3 种入口统一）

**入口 A：直接调用 AIO Shell API（推荐做 MVP）**
- 外部系统/IDE/Postman 调用 `POST /v1/shell/exec`。
- `command` 里执行 `AGENT_BROWSER_SESSION=<session_id> agent-browser --cdp 9222 <subcommand> ... --json`。

**入口 B：通过 AIO MCP Hub 调用 terminal 工具**
- MCP client 连接 `/mcp`，执行 `tools/call` 调用 `terminal_execute`，参数里包含同样的 `command`。

**入口 C：CLI wrapper（可选）**
- 在宿主机提供一个轻量脚本 `aio-agent-browser`，把 `agent-browser` 命令翻译成对 AIO 的 `/v1/shell/exec` 调用。
- 这只影响易用性，不影响容器内实现。

---

## 2. MVP 交付物（repo 内新增目录）

> 目标：让任何人只需要 Docker，就能启动一个包含 agent-browser 的 AIO 实例。

### 2.1 目录结构（建议）

- Create: `deploy/aio-agent-browser/Dockerfile`
- Create: `deploy/aio-agent-browser/docker-compose.yml`
- Create: `deploy/aio-agent-browser/README.md`

### 2.2 Dockerfile 设计要点

建议用 multi-stage 构建，避免依赖 npm 上游发布质量（同时避免 postinstall 下载二进制的不确定性）：

1) Node 构建 stage：构建 `dist/` 并产出 `node_modules`（生产依赖即可）
- Run: `pnpm install --frozen-lockfile`
- Run: `pnpm build`

2) Rust 构建 stage：产出 Linux `agent-browser` CLI 二进制
- Run: `cargo zigbuild --release --target x86_64-unknown-linux-gnu`
- Run: `cargo zigbuild --release --target aarch64-unknown-linux-gnu`

3) 运行 stage：`FROM ghcr.io/agent-infra/sandbox:<pinned>`
- Copy 产物到 `/opt/agent-browser/{bin,dist,node_modules,package.json}`（或直接复制完整工作目录）
- `ln -sf /opt/agent-browser/bin/agent-browser /usr/local/bin/agent-browser`

关键点：Rust CLI 启动 Node daemon 时会从二进制相对路径寻找 `../dist/daemon.js`，所以推荐把二进制放在 `/opt/agent-browser/bin`、把 `dist` 放在 `/opt/agent-browser/dist`。

### 2.3 docker-compose（远程部署建议）

从 `external/agent-infra_sandbox/docker-compose.yaml` 出发，保留这些关键点：
- `security_opt: seccomp:unconfined`（AIO 要求）
- `shm_size: 2gb`（浏览器稳定性）
- 端口映射：`${HOST_PORT:-8080}:8080`
- 鉴权：生产环境建议设置 `JWT_PUBLIC_KEY`（AIO 文档有完整流程）

---

## 3. MVP 验收脚本（Smoke Test）

### 3.1 启动

Run（示例）：
- `docker compose -f deploy/aio-agent-browser/docker-compose.yml up -d`
- 打开 VNC：`http://localhost:8080/vnc/index.html?autoconnect=true`

### 3.2 通过 /v1/shell/exec 下发 agent-browser 命令

**步骤 1：open**
- Request: `POST http://localhost:8080/v1/shell/exec`
- Body:
  - `command`: `AGENT_BROWSER_SESSION=u1 agent-browser --cdp 9222 open https://example.com --json`

期望：
- VNC 中浏览器导航到 example.com
- 返回 JSON `success=true`

**步骤 2：snapshot**
- `command`: `AGENT_BROWSER_SESSION=u1 agent-browser snapshot -i --json`

期望：
- 返回 `snapshot` 文本 + `refs`（例如 `e1/e2/...`）

**步骤 3：click/fill**
- `command`: `AGENT_BROWSER_SESSION=u1 agent-browser click @e2 --json`
- `command`: `AGENT_BROWSER_SESSION=u1 agent-browser fill @e3 "hello" --json`

期望：
- VNC 可看到相应 UI 行为发生

备注：如遇到 “daemon already running / session 冲突”，优先执行 `AGENT_BROWSER_SESSION=u1 agent-browser close --json` 后重试。

---

## 4. 安全与权限（MVP 也要写清楚）

### 4.1 强制开启鉴权（推荐）

AIO 支持 JWT 鉴权（`JWT_PUBLIC_KEY`）。开启后：
- API（含 `/v1/shell/exec`、`/mcp`）走 `Authorization: Bearer <jwt>`
- VNC 这类无法带 header 的入口用 `ticket`（短时票据）方式访问

### 4.2 MVP 的最小安全基线

即使是 MVP，也建议先做到：
- 不把 `8080` 直接暴露公网（或至少用反向代理 + IP allowlist + WAF）。
- 对调用方做鉴权与审计（请求日志带 user/session）。
- 明确禁止把 AIO 的“终端工具”直接授予不可信用户（否则可运行任意命令）。

---

## 5. 终态方案（一个容器，多用户，多会话隔离，Idle TTL）

> 这部分先写设计与实现路径，不要求在 MVP 完成。

### 5.1 需要新增的控制面：agent-browser-gateway

建议实现一个网关服务（容器内常驻）：
- REST:
  - `POST /sessions` 创建会话（返回 `session_id`、`expires_at`、`view_url`）
  - `POST /sessions/{id}/commands` 执行动作（内部调用 agent-browser）
  - `DELETE /sessions/{id}` 释放资源
- MCP:
  - 暴露 `agent_browser_*` 工具（隐藏内部命令细节）
- Idle TTL:
  - 每次 tool 调用刷新 `last_active_at`
  - 定时清理 `now - last_active_at > 600s`

### 5.2 可视化隔离（方案 B：每会话独立 VNC，后续实现）

每个 session 分配：
- 独立 DISPLAY（例如 `:10`、`:11`…）
- 独立 Chromium 进程（带 UI），独立 `--remote-debugging-port=<port>`
- 独立 x11vnc/noVNC/websockify 端口
- 网关负责把 `view_url` 路由到对应会话（HTTP + WebSocket）

网关负责回收：
- kill Chromium/x11vnc/websockify 进程
- 释放端口与临时目录

### 5.3 备选（方案 A：每会话独立 streaming）

如果“每会话 VNC”过重，可以先用 agent-browser 的 screencast（WebSocket streaming）提供可视化观看：
- 每会话启动 agent-browser daemon 并开启 `AGENT_BROWSER_STREAM_PORT=<dynamic>`
- 由网关反代每个会话的 stream WebSocket

---

## 6. 实施计划（按阶段拆分）

### Phase 0: MVP 镜像可构建

**Files:**
- Create: `deploy/aio-agent-browser/Dockerfile`
- Create: `deploy/aio-agent-browser/docker-compose.yml`
- Create: `deploy/aio-agent-browser/README.md`

**Step 1: 选定并固定 AIO 基础镜像版本**
- 决策：使用 `ghcr.io/agent-infra/sandbox:<version>` 而非 `latest`

**Step 2: 写 Dockerfile（multi-stage）**
- 目标：镜像内 `agent-browser --help` 可用

**Step 3: 本地 build 并启动**
- Run: `docker build -f deploy/aio-agent-browser/Dockerfile -t aio-agent-browser:dev .`
- Run: `docker run --rm -it -p 8080:8080 aio-agent-browser:dev`

**Step 4: 执行 Smoke Test**
- 按第 3 节操作验证

### Phase 1: 对外“tool 化”（可被 Cursor/Postman/CLI 统一调用）

**Step 1: 定义统一的 commands API（REST）**
- 目标：Postman 不需要拼 shell 命令

**Step 2: 增加 MCP server（agent_browser_* tools）**
- 目标：Cursor 等直接以工具方式调用

### Phase 2: 多用户多会话隔离 + Idle TTL（终态）

**Step 1: 引入 session manager（网关）与 TTL 清理**
- 目标：10 分钟无操作自动释放

**Step 2: 实现方案 B（每会话独立 VNC/CDP）**
- 目标：用户互不干扰且可视化观看
