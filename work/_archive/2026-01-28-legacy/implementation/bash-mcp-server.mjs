#!/usr/bin/env node
import { SimpleSandbox } from './lib/sandbox.mjs';
import { validateCommand } from './lib/whitelist.mjs';

const sandbox = new SimpleSandbox();

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
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: err.message },
          id: null,
        }) + '\n',
      );
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
          capabilities: { tools: {} },
        },
        id,
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        result: {
          tools: [
            {
              name: 'bash',
              description: 'Execute agent-browser commands',
              inputSchema: {
                type: 'object',
                properties: {
                  command: {
                    type: 'string',
                    description: 'agent-browser command to execute',
                  },
                },
                required: ['command'],
              },
            },
          ],
        },
        id,
      };

    case 'tools/call':
      if (params.name !== 'bash') {
        throw new Error(`Unknown tool: ${params.name}`);
      }

      const sanitizedCommand = validateCommand(params.arguments.command);
      const result = await sandbox.executeCommand(sanitizedCommand, {
        cwd: '/workspace',
        env: { AGENT_BROWSER_SESSION: process.env.SESSION_ID || 'default' },
      });

      return {
        jsonrpc: '2.0',
        result: {
          content: [
            {
              type: 'text',
              text: result.exitCode === 0 ? result.stdout : result.stderr,
            },
          ],
          isError: result.exitCode !== 0,
        },
        id,
      };

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}
