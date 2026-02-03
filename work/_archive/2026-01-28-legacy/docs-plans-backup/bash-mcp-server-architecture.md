# bash-mcp-server 架构设计

**创建日期**: 2026-01-27
**目标**: 基于 Vercel bash-tool 构建 MCP stdio server，仅暴露白名单控制的 bash 工具

---

## 1. 技术栈

- **MCP协议**: stdio transport（标准输入/输出JSON-RPC）
- **bash执行**: 复用 Vercel bash-tool 的 `createBashExecuteTool()`
- **沙箱**: 自定义 Sandbox 实现（无需 just-bash 依赖）

---

## 2. 模块结构

```
deploy/aio-agent-browser-minimal/
├── bash-mcp-server.mjs       # MCP stdio server 主入口
├── lib/
│   ├── sandbox.mjs            # 自定义 Sandbox 实现（spawn 无 shell 模式）
│   └── whitelist.mjs          # agent-browser 命令白名单校验
├── Dockerfile                 # 镜像构建
├── mcp-hub.json              # MCP Hub 配置
└── docker-compose.yml        # 本地测试环境
```

---

## 3. 核心实现

### 3.1 自定义 Sandbox (lib/sandbox.mjs)

**理由**: AIO环境无需 just-bash 额外依赖，直接用 Node.js spawn

```javascript
import { spawn } from 'node:child_process';

export class SimpleSandbox {
  async executeCommand(command, options = {}) {
    // 使用 spawn 无 shell 模式，防止注入
    const args = parseCommand(command); // 简单 split，不处理引号
    const proc = spawn(args[0], args.slice(1), {
      cwd: options.cwd || '/workspace',
      env: { ...process.env, ...options.env },
      shell: false, // 关键：禁用 shell
    });

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    const exitCode = await new Promise((resolve) => {
      proc.on('close', resolve);
    });

    return { stdout, stderr, exitCode };
  }

  async readFile(path) {
    const fs = await import('node:fs/promises');
    return fs.readFile(path, 'utf-8');
  }

  async writeFile(path, content) {
    const fs = await import('node:fs/promises');
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, content, 'utf-8');
  }

  async stop() {
    // No-op for simple sandbox
  }
}

// 简化的命令解析（不处理复杂引号）
function parseCommand(command) {
  return command.trim().split(/\s+/);
}
```

**限制**: 不支持管道/重定向/变量展开（符合安全目标）

### 3.2 白名单校验 (lib/whitelist.mjs)

```javascript
const ALLOWED_SUBCOMMANDS = [
  'open', 'snapshot', 'click', 'dblclick', 'fill', 'type',
  'press', 'wait', 'screenshot', 'pdf', 'close',
  'get-title', 'get-url', 'back', 'forward', 'reload'
];

const BLOCKED_SUBCOMMANDS = [
  'eval', 'evaluate', 'upload', 'download', 'route', 'unroute'
];

export function validateCommand(command) {
  // 1. 必须以 agent-browser 开头
  if (!command.match(/^agent-browser\b/)) {
    throw new Error('仅允许 agent-browser 命令');
  }

  // 2. 检查子命令
  const match = command.match(/^agent-browser\s+(\S+)/);
  if (match) {
    const subCmd = match[1];
    if (BLOCKED_SUBCOMMANDS.includes(subCmd)) {
      throw new Error(`禁止使用子命令: ${subCmd}`);
    }
    if (!ALLOWED_SUBCOMMANDS.includes(subCmd)) {
      throw new Error(`未知子命令: ${subCmd}`);
    }
  }

  // 3. 强制注入 --cdp 9222（如果缺失）
  if (!command.includes('--cdp')) {
    return command.replace(/^agent-browser/, 'agent-browser --cdp 9222');
  }

  return command;
}
```

### 3.3 MCP Server 主入口 (bash-mcp-server.mjs)

```javascript
#!/usr/bin/env node
import { SimpleSandbox } from './lib/sandbox.mjs';
import { validateCommand } from './lib/whitelist.mjs';

const sandbox = new SimpleSandbox();

// MCP stdio protocol handler
process.stdin.setEncoding('utf-8');
let buffer = '';

process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const request = JSON.parse(line);
      const response = await handleRequest(request);
      process.stdout.write(JSON.stringify(response) + '\n');
    } catch (err) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32700, message: err.message },
        id: null
      }) + '\n');
    }
  }
});

async function handleRequest(request) {
  const { method, params, id } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'bash-tool', version: '1.0.0' },
          capabilities: { tools: {} }
        },
        id
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        result: {
          tools: [{
            name: 'bash',
            description: 'Execute agent-browser commands',
            inputSchema: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'agent-browser command to execute' }
              },
              required: ['command']
            }
          }]
        },
        id
      };

    case 'tools/call':
      if (params.name !== 'bash') {
        throw new Error(`Unknown tool: ${params.name}`);
      }

      // 白名单校验 + 命令注入防护
      const sanitizedCommand = validateCommand(params.arguments.command);

      const result = await sandbox.executeCommand(sanitizedCommand, {
        cwd: '/workspace',
        env: { AGENT_BROWSER_SESSION: process.env.SESSION_ID || 'default' }
      });

      return {
        jsonrpc: '2.0',
        result: {
          content: [{
            type: 'text',
            text: result.exitCode === 0 ? result.stdout : result.stderr
          }],
          isError: result.exitCode !== 0
        },
        id
      };

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}
```

---

## 4. Dockerfile 设计

```dockerfile
FROM ghcr.io/agent-infra/sandbox:1.0.0.152

# 1. 禁用非必要服务
RUN rm -f /opt/gem/supervisord/supervisord.mcp_server_browser.conf \
          /opt/gem/supervisord/supervisord.chrome_devtools_mcp.conf \
          /opt/gem/supervisord/supervisord.tinyproxy.conf

# 2. 安装 agent-browser
WORKDIR /tmp/agent-browser-build
COPY bin/ ./bin/
COPY dist/ ./dist/
COPY package.json package-lock.json ./

RUN npm ci --production && \
    mkdir -p /opt/agent-browser && \
    cp -r bin dist node_modules /opt/agent-browser/ && \
    ln -s /opt/agent-browser/bin/agent-browser-linux-$(uname -m) /usr/local/bin/agent-browser

# 3. 安装 bash-mcp-server
COPY deploy/aio-agent-browser-minimal/bash-mcp-server.mjs /opt/agent-browser/
COPY deploy/aio-agent-browser-minimal/lib/ /opt/agent-browser/lib/

# 4. 覆盖 MCP Hub 配置
COPY deploy/aio-agent-browser-minimal/mcp-hub.json /opt/gem/templates/mcp-hub.json.template

# 5. 环境变量
ENV DISABLE_JUPYTER=true \
    MCP_HUB_WAIT_PORTS=""

WORKDIR /workspace
```

---

## 5. MCP Hub 配置 (mcp-hub.json)

```json
{
  "mcpServers": {
    "bash_tool": {
      "command": "node",
      "args": ["/opt/agent-browser/bash-mcp-server.mjs"],
      "env": {
        "SESSION_ID": "{{ SESSION_ID }}"
      }
    }
  }
}
```

---

## 6. 测试策略

### 单元测试 (test/bash-mcp-server.test.mjs)

```javascript
import { validateCommand } from '../deploy/aio-agent-browser-minimal/lib/whitelist.mjs';
import { test } from 'node:test';
import assert from 'node:assert';

test('允许合法的 agent-browser 命令', () => {
  const cmd = validateCommand('agent-browser open http://example.com');
  assert.match(cmd, /--cdp 9222/);
});

test('拒绝非 agent-browser 命令', () => {
  assert.throws(() => validateCommand('rm -rf /'), /仅允许 agent-browser/);
});

test('拒绝危险子命令', () => {
  assert.throws(() => validateCommand('agent-browser eval "alert(1)"'), /禁止使用子命令/);
});
```

### 集成测试 (docker smoke test)

```bash
# 1. 构建镜像
docker compose -f deploy/aio-agent-browser-minimal/docker-compose.yml build

# 2. 启动容器
docker compose up -d

# 3. 验证 MCP tools/list
curl -X POST http://localhost:8082/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# 预期输出：仅包含 1 个 bash 工具

# 4. 执行合法命令
curl -X POST http://localhost:8082/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"bash",
      "arguments":{"command":"agent-browser open http://example.com"}
    },
    "id":2
  }'

# 5. 验证拒绝非法命令
curl -X POST http://localhost:8082/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"bash",
      "arguments":{"command":"rm -rf /"}
    },
    "id":3
  }'
# 预期：返回 error，不执行命令
```

---

## 7. 安全边界

**已实现**：
- ✅ 命令白名单（仅 agent-browser）
- ✅ 子命令白名单（禁止 eval/upload 等）
- ✅ 无 shell 执行（spawn shell:false）
- ✅ 自动注入 --cdp 参数

**未实现（终态需补充）**：
- ⏸️ 会话隔离（需 agent-browser-gateway 分发）
- ⏸️ 资源配额（CPU/内存限制）
- ⏸️ Idle TTL 自动回收

---

## 8. 下一步

**Phase 5 (Implementation)**: 调用 codeagent skill（backend=codex）执行以下任务：
1. 创建 `deploy/aio-agent-browser-minimal/lib/sandbox.mjs`
2. 创建 `deploy/aio-agent-browser-minimal/lib/whitelist.mjs`
3. 创建 `deploy/aio-agent-browser-minimal/bash-mcp-server.mjs`
4. 创建 `deploy/aio-agent-browser-minimal/Dockerfile`
5. 创建 `deploy/aio-agent-browser-minimal/mcp-hub.json`
6. 更新 `deploy/aio-agent-browser-minimal/docker-compose.yml`
7. 创建单元测试 `test/bash-mcp-server.test.mjs`
