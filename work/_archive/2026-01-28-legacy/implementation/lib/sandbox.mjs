import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

export class SimpleSandbox {
  async executeCommand(command, options = {}) {
    const args = parseCommand(command);
    const proc = spawn(args[0], args.slice(1), {
      cwd: options.cwd || '/workspace',
      env: { ...process.env, ...options.env },
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));

    const exitCode = await new Promise((resolve) => {
      proc.on('close', resolve);
      proc.on('error', () => resolve(1));
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

function parseCommand(command) {
  return command.trim().split(/\s+/);
}
