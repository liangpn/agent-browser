import { describe, it, expect } from 'vitest';
import { onAfterToolCall } from '../deploy/aio-agent-browser-minimal/browser-shell.mjs';

describe('browser-shell output shaping', () => {
  it('flattens agent-browser --json output to data-only stdout (no inner success/data/error)', () => {
    const ctx = { sessionId: 's1', subcommand: 'open', args: ['https://example.com'], timeoutMs: 1000 };
    const execResult = {
      exit_code: 0,
      stdout_raw: '{"success":true,"data":{"title":"Example"},"error":null}\n',
      stderr_raw: '',
      status: 'completed',
    };

    const out = onAfterToolCall(ctx as any, execResult as any);
    expect(out).toEqual({
      session_id: 's1',
      exit_code: 0,
      stdout: '{"title":"Example"}\n',
      stderr: '',
    });

    expect(Object.keys(out).sort()).toEqual(['exit_code', 'session_id', 'stderr', 'stdout'].sort());
    expect(out).not.toHaveProperty('success');
    expect(out).not.toHaveProperty('data');
    expect(out).not.toHaveProperty('error');
    expect(out).not.toHaveProperty('status');
    expect(out).not.toHaveProperty('subcommand');
    expect(out).not.toHaveProperty('args');

    expect(out.stdout).not.toContain('"success"');
    expect(out.stdout).not.toContain('"error"');
  });

  it('moves agent-browser error to stderr and forces non-zero exit_code when needed', () => {
    const ctx = { sessionId: 's1', subcommand: 'click', args: ['@e1'], timeoutMs: 1000 };
    const execResult = {
      exit_code: 0,
      stdout_raw: '{"success":false,"data":null,"error":"boom"}\n',
      stderr_raw: '',
      status: 'failed',
    };

    const out = onAfterToolCall(ctx as any, execResult as any);
    expect(out).toMatchObject({
      session_id: 's1',
      exit_code: 1,
      stdout: '',
      stderr: expect.stringContaining('boom'),
    });
    expect(out).not.toHaveProperty('subcommand');
    expect(out).not.toHaveProperty('args');
  });

  it('does not require stdout to be JSON', () => {
    const ctx = { sessionId: 's1', subcommand: 'click', args: ['@e1'], timeoutMs: 1000 };
    const execResult = {
      exit_code: 0,
      stdout_raw: 'not-json\n',
      stderr_raw: '',
      status: 'completed',
    };

    const out = onAfterToolCall(ctx as any, execResult as any);
    expect(out).toMatchObject({
      session_id: 's1',
      exit_code: 0,
      stdout: 'not-json\n',
      stderr: '',
    });
    expect(out).not.toHaveProperty('subcommand');
    expect(out).not.toHaveProperty('args');
  });
});
