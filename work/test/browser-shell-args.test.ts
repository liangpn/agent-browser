import { describe, it, expect } from 'vitest';
import {
  assertArgsBySubcommandForTest,
  normalizeArgsForTest,
  normalizeSnapshotArgsForTest,
  parseAndValidateToolCallParamsForTest,
} from '../deploy/aio-agent-browser-minimal/browser-shell.mjs';

describe('browser-shell argument validation', () => {
  it('rejects forbidden global flags in args', () => {
    expect(() => normalizeArgsForTest(['--cdp', '1234'])).toThrow(/forbidden/);
    expect(() => normalizeArgsForTest(['--json'])).toThrow(/forbidden/);
    expect(() => normalizeArgsForTest(['--session', 'x'])).toThrow(/forbidden/);
    expect(() => normalizeArgsForTest(['--executable-path', '/bin/chrome'])).toThrow(/forbidden/);
  });

  it('enforces per-subcommand arg counts (P0)', () => {
    expect(() => assertArgsBySubcommandForTest('open', [])).toThrow();
    expect(() => assertArgsBySubcommandForTest('open', ['a', 'b'])).toThrow();

    expect(() => assertArgsBySubcommandForTest('click', [])).toThrow();
    expect(() => assertArgsBySubcommandForTest('click', ['@e1', 'x'])).toThrow();

    expect(() => assertArgsBySubcommandForTest('press', [])).toThrow();
    expect(() => assertArgsBySubcommandForTest('press', ['Enter', 'x'])).toThrow();

    expect(() => assertArgsBySubcommandForTest('close', ['x'])).toThrow();
  });

  it('validates snapshot args allowlist', () => {
    expect(normalizeSnapshotArgsForTest(['-i'])).toEqual(['-i']);
    expect(normalizeSnapshotArgsForTest(['--interactive', '-d', '3'])).toEqual(['--interactive', '-d', '3']);
    expect(() => normalizeSnapshotArgsForTest(['-x'])).toThrow(/not allowed/);
    expect(() => normalizeSnapshotArgsForTest(['-d'])).toThrow(/requires a value/);
  });

  it('parses tools/call params (argv-only) and rejects invalid session/command', () => {
    const policy = { open: { allow_schemes: ['http', 'https'] } };
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }];

    const ctx = parseAndValidateToolCallParamsForTest(
      {
        name: 'browser-shell',
        arguments: { session_id: 's1', argv: ['open', 'https://example.com'] },
      },
      policy,
      lookup
    );
    expect(ctx).toMatchObject({ sessionId: 's1', subcommand: 'open', args: ['https://example.com'] });

    expect(() =>
      parseAndValidateToolCallParamsForTest(
        {
          name: 'browser-shell',
          arguments: { session_id: 'bad session', argv: ['open', 'https://example.com'] },
        },
        policy,
        lookup
      )
    ).toThrow(/invalid session_id/);

    expect(() =>
      parseAndValidateToolCallParamsForTest(
        {
          name: 'browser-shell',
          arguments: { session_id: 's1', argv: ['eval', '1+1'] },
        },
        policy,
        lookup
      )
    ).toThrow(/disallowed subcommand/);
  });

  it('rejects legacy subcommand/args shape', () => {
    const policy = { open: { allow_schemes: ['http', 'https'] } };
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }];

    expect(() =>
      parseAndValidateToolCallParamsForTest(
        {
          name: 'browser-shell',
          arguments: { session_id: 's1', subcommand: 'open', args: ['https://example.com'] },
        },
        policy,
        lookup
      )
    ).toThrow(/argv/);
  });
});
