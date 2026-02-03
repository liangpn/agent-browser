ARG AIO_BASE_IMAGE=ghcr.io/agent-infra/sandbox:latest

FROM node:22-slim AS node_build
WORKDIR /repo

COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN corepack enable
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN rm -rf node_modules && pnpm install --prod --ignore-scripts

FROM rust:1.86 AS rust_build
WORKDIR /repo
COPY cli ./cli
RUN cargo build --release --manifest-path cli/Cargo.toml

FROM ${AIO_BASE_IMAGE} AS runtime

# agent-browser runtime (no Rust toolchain in final image)
RUN mkdir -p /opt/agent-browser/bin /opt/agent-browser/dist /opt/agent-browser/node_modules
COPY --from=node_build /repo/dist /opt/agent-browser/dist
COPY --from=node_build /repo/node_modules /opt/agent-browser/node_modules
COPY --from=node_build /repo/package.json /opt/agent-browser/package.json
COPY --from=rust_build /repo/cli/target/release/agent-browser /opt/agent-browser/bin/agent-browser
RUN chmod +x /opt/agent-browser/bin/agent-browser \
  && ln -sf /opt/agent-browser/bin/agent-browser /usr/local/bin/agent-browser

# MCP Hub: expose only browser-shell.
RUN mkdir -p /opt/agent-browser-mcp /etc/agent-browser
COPY work/deploy/aio-agent-browser-minimal/browser-shell.mjs /opt/agent-browser-mcp/browser-shell.mjs
COPY work/deploy/aio-agent-browser-minimal/browser-shell.policy.example.json /etc/agent-browser/browser-shell.policy.example.json
COPY work/deploy/aio-agent-browser-minimal/mcp-hub.json.template /opt/gem/mcp-hub.json.template

# Keep python-server healthy even though the MCP hub config no longer contains the default "sandbox" server.
COPY work/deploy/aio-agent-browser-minimal/supervisord.python_srv.conf /opt/gem/supervisord/supervisord.python_srv.conf

# Nginx hardening: only allow MCP, VNC, and /tickets externally.
# AIO entrypoint generates /opt/gem/nginx/{legacy.conf,srv.conf,vnc.conf} from
# templates at /opt/gem/nginx.{legacy,srv,vnc}.conf and includes /opt/gem/nginx/*.conf.
COPY work/deploy/aio-agent-browser-minimal/nginx.legacy.conf /opt/gem/nginx.legacy.conf
COPY work/deploy/aio-agent-browser-minimal/nginx.srv.conf /opt/gem/nginx.srv.conf
COPY work/deploy/aio-agent-browser-minimal/nginx.deny_all.conf /opt/gem/nginx/zz_deny_all.conf

# Remove default route snippets we don't want exposed.
RUN rm -f \
    /opt/gem/nginx/nginx.python_srv.conf \
    /opt/gem/nginx/nginx.code_server.conf \
    /opt/gem/nginx/nginx.jupyter_lab.conf \
    /opt/gem/nginx/nginx.ui_terminal.conf \
    /opt/gem/nginx/nginx.aio_index.conf
