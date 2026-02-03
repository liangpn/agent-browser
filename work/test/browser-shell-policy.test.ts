import { describe, it, expect } from 'vitest';
import {
  assertOpenUrlAllowedForTest,
  hostMatchesAllowlistForTest,
  isPrivateOrLocalIpForTest,
} from '../deploy/aio-agent-browser-minimal/browser-shell.mjs';

describe('browser-shell URL policy', () => {
  it('detects private/local IPs', () => {
    expect(isPrivateOrLocalIpForTest('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalIpForTest('10.0.0.1')).toBe(true);
    expect(isPrivateOrLocalIpForTest('192.168.1.1')).toBe(true);
    expect(isPrivateOrLocalIpForTest('169.254.1.1')).toBe(true);
    expect(isPrivateOrLocalIpForTest('::1')).toBe(true);
    expect(isPrivateOrLocalIpForTest('fd00::1')).toBe(true);
    expect(isPrivateOrLocalIpForTest('fe80::1')).toBe(true);

    expect(isPrivateOrLocalIpForTest('93.184.216.34')).toBe(false);
  });

  it('matches host allowlists (exact and suffix)', () => {
    expect(hostMatchesAllowlistForTest('example.com', { allow_hosts: ['example.com'] })).toBe(true);
    expect(hostMatchesAllowlistForTest('sub.example.com', { allow_hosts: ['example.com'] })).toBe(false);
    expect(hostMatchesAllowlistForTest('sub.example.com', { allow_host_suffixes: ['.example.com'] })).toBe(true);
    expect(hostMatchesAllowlistForTest('example.com', { allow_host_suffixes: ['.example.com'] })).toBe(false);
  });

  it('allows about:blank by default', async () => {
    const policy = { open: { allow_about_blank: true } };
    const out = await assertOpenUrlAllowedForTest('about:blank', policy, async () => []);
    expect(out).toBe('about:blank');
  });

  it('rejects non-http(s) schemes explicitly', async () => {
    const policy = { open: { allow_schemes: ['http', 'https'] } };
    await expect(assertOpenUrlAllowedForTest('file:///etc/passwd', policy, async () => [])).rejects.toThrow(
      'scheme not allowed'
    );
    await expect(assertOpenUrlAllowedForTest('data:text/plain,hi', policy, async () => [])).rejects.toThrow(
      'scheme not allowed'
    );
    await expect(assertOpenUrlAllowedForTest('chrome://version', policy, async () => [])).rejects.toThrow(
      'scheme not allowed'
    );
  });

  it('rejects localhost hostnames', async () => {
    const policy = { open: { allow_schemes: ['http', 'https'] } };
    await expect(assertOpenUrlAllowedForTest('http://localhost:8080', policy, async () => [])).rejects.toThrow(
      'localhost'
    );
  });

  it('rejects DNS that resolves to private IPs', async () => {
    const policy = { open: { allow_schemes: ['http', 'https'] } };
    const lookup = async () => [{ address: '127.0.0.1', family: 4 }];
    await expect(assertOpenUrlAllowedForTest('https://example.com', policy, lookup)).rejects.toThrow(
      'disallowed ip'
    );
  });

  it('requires hostname allowlist when configured', async () => {
    const policy = {
      open: {
        allow_schemes: ['http', 'https'],
        allow_hosts: ['example.com'],
      },
    };

    const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    await expect(assertOpenUrlAllowedForTest('https://not-example.com', policy, lookup)).rejects.toThrow(
      'not in allowlist'
    );
    await expect(assertOpenUrlAllowedForTest('https://example.com', policy, lookup)).resolves.toBe('https://example.com');
  });
});

