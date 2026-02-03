# P0-2: 镜像大小超标

**优先级**: P0 (阻塞生产部署)
**状态**: 待优化
**发现日期**: 2026-01-27

## 问题描述

当前镜像大小 8.74GB，远超 3GB 目标。

## 现象

```bash
docker images | grep aio-agent-browser-minimal
# 输出：
# aio-agent-browser-minimal    dev    0f49972a689b   22 hours ago    8.74GB
```

## 目标对比

| 指标 | 目标值 | 当前值 | 差距 |
|------|--------|--------|------|
| 镜像大小 | ≤ 3GB | 8.74GB | +5.74GB |
| 空闲内存 | ≤ 700MB | ~650MB | ✅ 已达标 |

## 根因分析

1. **Playwright 浏览器二进制**: Chromium 约 100-150MB
2. **Node.js 依赖**: node_modules 可能包含大量开发依赖
3. **AIO 基础镜像**: 本身较大，包含完整桌面环境
4. **未清理缓存**: 构建过程中可能残留缓存文件

## 优化方案

### 1. 多阶段构建
```dockerfile
# 构建阶段
FROM ghcr.io/agent-infra/sandbox:1.0.0.152 AS builder
# ... 安装依赖 ...

# 运行阶段
FROM ghcr.io/agent-infra/sandbox:1.0.0.152
# ... 仅复制必要文件 ...
```

### 2. 清理不必要文件
```dockerfile
RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    rm -rf /opt/agent-browser/node_modules/.cache
```

### 3. 检查基础镜像
- AIO 基础镜像本身较大
- 考虑使用更小的基础镜像（如果可能）

## 验证标准

- [ ] `docker images` 显示镜像大小 ≤ 3GB
- [ ] 容器仍能正常启动和运行
- [ ] 所有功能测试通过

## 参考数据

设计文档中提到 Minimal 版本已达成：
- 镜像约 `~2.75GB`
- 空闲内存约 `~650MB`

需要核查实际构建参数与文档差异。
