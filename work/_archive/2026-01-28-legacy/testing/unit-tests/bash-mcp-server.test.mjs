import { validateCommand } from '../deploy/aio-agent-browser-minimal/lib/whitelist.mjs';
import test from 'node:test';
import assert from 'node:assert';

test('允许合法的 agent-browser 命令', () => {
  const cmd = validateCommand('agent-browser open http://example.com');
  assert.match(cmd, /--cdp 9222/);
});

test('拒绝非 agent-browser 命令', () => {
  assert.throws(() => validateCommand('rm -rf /'), /仅允许 agent-browser/);
});

test('拒绝危险子命令', () => {
  assert.throws(
    () => validateCommand('agent-browser eval "alert(1)"'),
    /禁止使用子命令/,
  );
});
