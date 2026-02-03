FROM ghcr.io/agent-infra/sandbox:1.0.0.152

RUN rm -f /opt/gem/supervisord/supervisord.mcp_server_browser.conf \
          /opt/gem/supervisord/supervisord.chrome_devtools_mcp.conf \
          /opt/gem/supervisord/supervisord.tinyproxy.conf

# 覆盖 Nginx 配置，仅允许 /mcp 和 /vnc 路径
COPY deploy/aio-agent-browser-minimal/nginx-minimal.conf /etc/nginx/sites-available/default

WORKDIR /tmp/agent-browser-build
COPY bin/ ./bin/
COPY dist/ ./dist/
COPY node_modules/ ./node_modules/
COPY package.json ./

RUN mkdir -p /opt/agent-browser \
  && cp -r bin dist node_modules package.json /opt/agent-browser/ \
  && ln -sf /opt/agent-browser/bin/agent-browser /usr/local/bin/agent-browser

# 安装 Playwright Chromium 浏览器
RUN cd /opt/agent-browser && \
    node dist/daemon.js install --with-deps || \
    (npx playwright install chromium && npx playwright install-deps chromium)

# 验证 Chromium supervisord 配置存在
RUN test -f /opt/gem/supervisord/supervisord.ui_chromium.conf || \
    echo "WARNING: Chromium supervisord config missing!"

COPY deploy/aio-agent-browser-minimal/bash-mcp-server.mjs /opt/agent-browser/
COPY deploy/aio-agent-browser-minimal/lib/ /opt/agent-browser/lib/

RUN mkdir -p /opt/gem/templates
COPY deploy/aio-agent-browser-minimal/mcp-hub.json /opt/gem/templates/mcp-hub.json.template
COPY deploy/aio-agent-browser-minimal/mcp-hub.json /opt/gem/mcp-hub.json.template

ENV DISABLE_JUPYTER=true \
    MCP_HUB_WAIT_PORTS=""

WORKDIR /workspace
