# P0-1: CDP 端口未监听

**优先级**: P0 (阻塞功能)
**状态**: 待修复
**发现日期**: 2026-01-27

## 问题描述

容器内 Chromium 的 CDP 端口 9222 未监听，导致 agent-browser 无法连接。

## 现象

```bash
# 容器内执行
AGENT_BROWSER_SESSION=u1 agent-browser --cdp 9222 open https://example.com --json
# 错误：
{"success":false,"error":"Failed to connect via CDP on 192.168.31.13:9222. Make sure the app is running with --remote-debugging-port=9222"}
```

## 根因分析

1. **Chromium 未启动**: AIO Sandbox 的 Chromium 需要通过 supervisord 启动
2. **可能原因**:
   - Dockerfile 删除 supervisord 配置时误删了 Chromium 启动配置
   - 环境变量 `DISABLE_JUPYTER=true` 影响了其他服务
   - MCP Hub 配置覆盖导致问题

## 排查步骤

```bash
# 1. 检查 supervisord 服务状态
docker exec <container> supervisorctl status
# 预期：应有 chromium/ui_chromium 服务运行

# 2. 检查端口监听
docker exec <container> netstat -tlnp | grep 9222
# 预期：应显示 127.0.0.1:9222 监听

# 3. 检查环境变量
docker exec <container> env | grep BROWSER
# 预期：BROWSER_REMOTE_DEBUGGING_PORT=9222
```

## 修复方案

### 方案1: 验证 supervisord 配置存在
在 Dockerfile 中添加：
```dockerfile
RUN test -f /opt/gem/supervisord/supervisord.ui_chromium.conf || \
    echo "WARNING: Chromium supervisord config missing!"
```

### 方案2: 手动启动 Chromium
如果配置被误删，需要恢复或重新创建 supervisord 配置。

## 验证标准

- [ ] `docker exec <container> netstat -tlnp | grep 9222` 显示端口监听
- [ ] `agent-browser open https://example.com` 成功执行

## 相关文件

- `deploy/aio-agent-browser-minimal/Dockerfile`
- `/opt/gem/supervisord/supervisord.ui_chromium.conf` (容器内)
