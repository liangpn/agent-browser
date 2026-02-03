ARG AIO_BASE_IMAGE=ghcr.io/agent-infra/sandbox:1.0.0.152

FROM node:22-slim AS node_build

WORKDIR /repo
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY bin ./bin

RUN corepack enable
RUN pnpm install --frozen-lockfile
RUN pnpm build

RUN rm -rf node_modules && pnpm install --prod --ignore-scripts

FROM rust:1.86 AS rust_build

WORKDIR /repo
COPY cli ./cli

RUN cargo build --release --manifest-path cli/Cargo.toml

FROM ${AIO_BASE_IMAGE} AS runtime

ENV MCP_HUB_WAIT_PORTS=8091

RUN mkdir -p /opt/agent-browser/bin /opt/agent-browser/dist /opt/agent-browser/node_modules

COPY --from=node_build /repo/dist /opt/agent-browser/dist
COPY --from=node_build /repo/node_modules /opt/agent-browser/node_modules
COPY --from=node_build /repo/package.json /opt/agent-browser/package.json
COPY --from=rust_build /repo/cli/target/release/agent-browser /opt/agent-browser/bin/agent-browser

RUN ln -sf /opt/agent-browser/bin/agent-browser /usr/local/bin/agent-browser

# Slim MCP: only expose a restricted bash tool that can run agent-browser commands.
RUN mkdir -p /opt/agent-browser-mcp-server
COPY deploy/aio-agent-browser-slim/agent-browser-mcp-server.mjs /opt/agent-browser-mcp-server/server.mjs
# AIO entrypoint regenerates /opt/gem/mcp-hub.json from /opt/gem/mcp-hub.json.template.
COPY deploy/aio-agent-browser-slim/mcp-hub.json /opt/gem/mcp-hub.json.template

# Disable built-in browser MCP server and chrome devtools MCP (removed from mcp-hub.json).
# Note: AIO has both `/opt/gem/supervisord/supervisord.mcp.conf` (included by supervisord)
# and `/opt/gem/supervisord.mcp.conf` (copied by entrypoint.sh when MCP is enabled).
RUN printf '; disabled by aio-agent-browser-slim\\n' > /opt/gem/supervisord/supervisord.mcp.conf \
  && printf '; disabled by aio-agent-browser-slim\\n' > /opt/gem/supervisord.mcp.conf

# Base image sets MCP_HUB_CONFIG but mcp-hub-wait.sh hardcodes the config path in the exec line.
# Patch it to honor MCP_HUB_CONFIG (default: /opt/gem/mcp-hub.json) so advanced overrides work.
RUN sed -i 's|exec /usr/bin/mcp-hub --port $DEFAULT_PORT --stateless --config /opt/gem/mcp-hub.json|exec /usr/bin/mcp-hub --port $DEFAULT_PORT --stateless --config \"$DEFAULT_CONFIG\"|' /opt/gem/mcp-hub-wait.sh
