# Minimal Image P0 Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** For the minimal image, only expose `/mcp` and `/vnc`, ensure Playwright Chromium is installed for `agent-browser`, and verify the Chromium supervisord config exists at build time.

**Architecture:** Override Nginx site config to proxy only MCP and VNC traffic and return `403` for everything else. Extend the minimal Dockerfile with a post-install Playwright/daemon install step and a non-fatal build-time check for the Chromium supervisord config file.

**Tech Stack:** Docker, Nginx, Node.js, Playwright, AIO Sandbox base image.

---

### Task 1: Lock down exposed HTTP paths

**Files:**
- Create: `deploy/aio-agent-browser-minimal/nginx-minimal.conf`
- Modify: `deploy/aio-agent-browser-minimal/Dockerfile`

**Step 1: Create the minimal Nginx config**

Create `deploy/aio-agent-browser-minimal/nginx-minimal.conf` with:
- Proxy only `/(mcp|v1/mcp)` to `http://localhost:8000`
- Proxy `/vnc` to `http://localhost:6080`
- Return `403` for all other paths

**Step 2: Copy Nginx config in Docker build**

Add to `deploy/aio-agent-browser-minimal/Dockerfile`:
```dockerfile
# 覆盖 Nginx 配置，仅允许 /mcp 和 /vnc 路径
COPY deploy/aio-agent-browser-minimal/nginx-minimal.conf /etc/nginx/sites-available/default
```

**Step 3: (Optional) Build sanity check**

Run:
```bash
docker build -f deploy/aio-agent-browser-minimal/Dockerfile .
```
Expected: Build succeeds; Nginx config is included in final image.

---

### Task 2: Install agent-browser runtime browser dependencies

**Files:**
- Modify: `deploy/aio-agent-browser-minimal/Dockerfile`

**Step 1: Add Playwright install after `ln -sf agent-browser`**

Add:
```dockerfile
# 安装 Playwright Chromium 浏览器
RUN cd /opt/agent-browser && \
    node dist/daemon.js install --with-deps || \
    (npx playwright install chromium && npx playwright install-deps chromium)
```

**Step 2: (Optional) Smoke check inside container**

After running the container, validate Playwright can find Chromium:
```bash
docker exec -it <container> ls -la /root/.cache/ms-playwright || true
```
Expected: Chromium directory present.

---

### Task 3: Verify Chromium supervisord config exists

**Files:**
- Modify: `deploy/aio-agent-browser-minimal/Dockerfile`

**Step 1: Add build-time verification**

Add:
```dockerfile
# 验证 Chromium supervisord 配置存在
RUN test -f /opt/gem/supervisord/supervisord.ui_chromium.conf || \
    echo "WARNING: Chromium supervisord config missing!"
```

**Step 2: (Optional) Runtime verification**

Inside the container:
```bash
supervisorctl status || true
```
Expected: A Chromium-related service exists and is running.

