# External References（外部仓库清单）

本项目在 `external/` 下保留了一些“本地 clone 的外部仓库”用于阅读/对照；它们 **不作为本仓库交付的一部分**（避免把外部仓库内容 vendoring 进来）。

如需复现或对照，请自行 clone 对应仓库到下列路径；对应 URL 如下。

---

## agent-infra/sandbox（AIO Sandbox）

- Repo: `https://github.com/agent-infra/sandbox`
- Local path: `external/agent-infra_sandbox/`
- Image used: `ghcr.io/agent-infra/sandbox:latest`
- This work references/assumes (key integration points):
  - MCP Hub template path: `/opt/gem/mcp-hub.json.template`
  - Nginx template override:
    - Templates: `/opt/gem/nginx.legacy.conf`, `/opt/gem/nginx.srv.conf`, `/opt/gem/nginx.vnc.conf`
    - Includes: `/opt/gem/nginx/*.conf` (this work adds `zz_deny_all.conf` and removes several default snippets)
  - Supervisord config override (to keep python-server healthy): `/opt/gem/supervisord/supervisord.python_srv.conf`
  - AIO capability boundary exposed externally by Nginx: `/mcp` (Streamable HTTP / SSE), `/vnc`, `/tickets`

## agent-sandbox/agent-sandbox

- Repo: `https://github.com/agent-sandbox/agent-sandbox`
- Local path: `external/agent-sandbox_agent-sandbox/`
- Purpose: 作为相关 sandbox 组件与运行方式的参考（本轮未直接复用代码文件）

## vercel-labs/bash-tool

- Repo: `https://github.com/vercel-labs/bash-tool`
- Local path: `external/vercel-labs_bash-tool/`
- Purpose (referenced design): `onBefore/onAfter` hooks、白名单/安全默认值的设计目标
- Note: 本项目的 `browser-shell` **不直接引入** `@vercel/bash-tool`；执行层使用 `spawn(argv, { shell:false })`

## vercel-labs/just-bash

- Repo: `https://github.com/vercel-labs/just-bash`
- Local path: `external/vercel-labs_just-bash/`
- Purpose: 作为 bash-tool 的相关依赖背景参考（本轮未直接使用）

## agent-browser（Upstream / Fork）

- Upstream: `https://github.com/vercel-labs/agent-browser`
- Fork: `https://github.com/liangpn/agent-browser`
