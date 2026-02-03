# 项目背景与目标

## 项目愿景

实现「自然语言驱动浏览器」的基础设施：把可视化浏览器环境、受控的命令执行、以及可被多种 Agent/客户端调用的工具接口统一封装为一个可部署的整体。

## 核心组件

### AIO Sandbox
- 提供容器化的浏览器桌面（VNC）
- 提供 MCP/鉴权等能力
- 基础镜像：`ghcr.io/agent-infra/sandbox:1.0.0.152`

### agent-browser
- 提供稳定的浏览器自动化执行器
- 支持 snapshot refs、click/fill/press/wait 等操作
- 技术栈：Rust + Playwright + Node.js

## 集成目标

构建 **AIO Sandbox + agent-browser** 集成镜像，实现：
1. 容器内预装 agent-browser，复用 AIO 自带可视化 Chromium（CDP 9222）
2. 远程部署后，用户能通过 VNC 观看「自然语言/Agent 操作浏览器」的过程
3. 对外只暴露受控的 MCP 工具，实现零命令注入

## 版本演进

### Full（完整版）
- 保留 AIO 所有原生能力
- 包含完整的工具面（约33个 tools）
- 适用于：探索/对照/回退场景

### Slim（瘦身版）
- 对外工具面最小化
- 仅暴露 1 个受控 tool
- 保留 VNC 可视化与调试便利性
- **当前已交付**

### Minimal（极简版）
- 服务数压缩至 8-9 个
- 镜像体积优化至 ~2.75GB
- 空闲内存约 ~650MB
- 实现零命令注入（结构化 schema）
- **生产环境推荐版本**

## 关键约束

### 网络前提
- AIO 所在网络必须能访问业务系统
- 如业务系统在内网，需部署到同一网络或通过 VPN/专线打通

### 可视化与多用户冲突（MVP限制）
MVP 采用单一 VNC/单一 Chromium：
- 多用户同时使用会互相影响（同屏、同浏览器）
- MVP 只适合验证链路与产品形态
- 终态需要实现会话级隔离

## 相关仓库

- AIO Sandbox 基础镜像：`ghcr.io/agent-infra/sandbox`
- agent-browser 源码：本地 `bin/`、`dist/`、`node_modules/`
- Vercel bash-tool 参考：`external/vercel-labs_bash-tool/`
