import { buildSupergatewayArgs, redactForLogs, ProxyOpts } from '../../../src/utils/proxy';

describe('buildSupergatewayArgs', () => {
  test('maps http transport to --streamableHttp', () => {
    const opts: ProxyOpts = {
      remoteUrl: 'https://mcp.example.com/mcp',
      transport: 'http',
    };
    expect(buildSupergatewayArgs(opts)).toEqual([
      '--streamableHttp', 'https://mcp.example.com/mcp'
    ]);
  });

  test('maps sse transport to --sse', () => {
    const opts: ProxyOpts = {
      remoteUrl: 'https://mcp.example.com/sse',
      transport: 'sse',
    };
    expect(buildSupergatewayArgs(opts)).toEqual([
      '--sse', 'https://mcp.example.com/sse'
    ]);
  });

  test('includes bearer via --oauth2Bearer', () => {
    const opts: ProxyOpts = {
      remoteUrl: 'https://mcp.example.com/mcp',
      transport: 'http',
      bearer: 'TEST_TOKEN_123',
    };
    expect(buildSupergatewayArgs(opts)).toEqual([
      '--streamableHttp', 'https://mcp.example.com/mcp',
      '--oauth2Bearer', 'TEST_TOKEN_123'
    ]);
  });

  test('appends repeated --header entries preserving order', () => {
    const opts: ProxyOpts = {
      remoteUrl: 'https://mcp.example.com/mcp',
      transport: 'http',
      headers: [
        { key: 'X-Org', value: 'aqualia' },
        { key: 'X-Env', value: 'dev' },
      ],
    };
    expect(buildSupergatewayArgs(opts)).toEqual([
      '--streamableHttp', 'https://mcp.example.com/mcp',
      '--header', 'X-Org: aqualia',
      '--header', 'X-Env: dev',
    ]);
  });

  test('ignores empty header keys', () => {
    const opts: ProxyOpts = {
      remoteUrl: 'https://mcp.example.com/mcp',
      transport: 'http',
      headers: [
        { key: '', value: 'x' },
        { key: 'X-Ok', value: 'y' },
      ],
    };
    expect(buildSupergatewayArgs(opts)).toEqual([
      '--streamableHttp', 'https://mcp.example.com/mcp',
      '--header', 'X-Ok: y',
    ]);
  });

  test('throws on invalid URL', () => {
    const opts: ProxyOpts = {
      remoteUrl: 'not-a-url',
      transport: 'http',
    } as any;
    expect(() => buildSupergatewayArgs(opts)).toThrow(/Invalid remoteUrl/);
  });

  test('throws on unsupported transport', () => {
    const opts = {
      remoteUrl: 'https://ok',
      transport: 'ws',
    } as any;
    expect(() => buildSupergatewayArgs(opts)).toThrow(/Unsupported transport/);
  });
});

describe('redactForLogs', () => {
  test('redacts bearer in argv arrays', () => {
    const argv = ['--streamableHttp', 'https://x', '--oauth2Bearer', 'TEST_TOKEN_123'];
    expect(redactForLogs(argv)).toEqual(['--streamableHttp', 'https://x', '--oauth2Bearer', '<redacted:bearer>']);
  });

  test('redacts Authorization header values in strings', () => {
    const s = 'Authorization: Bearer ABC123';
    expect(redactForLogs(s)).toBe('Authorization: <redacted:authorization>');
  });

  test('redacts known sensitive header keys in strings', () => {
    const s = 'X-Api-Key: SECRET\nX-Auth-Token: OTHER';
    const red = redactForLogs(s);
    expect(red).toContain('X-Api-Key: <redacted:x-api-key>');
    expect(red).toContain('X-Auth-Token: <redacted:x-auth-token>');
  });

  test('redacts nested object values for sensitive keys', () => {
    const obj = {
      headers: {
        Authorization: 'Bearer ABC',
        'X-Api-Key': 'XYZ',
        'X-Org': 'demo',
      },
      args: ['--oauth2Bearer', 'TEST_TOKEN_123']
    };
    const red: any = redactForLogs(obj);
    expect(red.headers.Authorization).toBe('Bearer <redacted:authorization>');
    expect(red.headers['X-Api-Key']).toBe('<redacted:x-api-key>');
    // Non-sensitive key preserved (but scanning for embedded secrets should have no effect)
    expect(red.headers['X-Org']).toBe('demo');
  });

  test('handles non-string inputs gracefully', () => {
    expect(redactForLogs(42 as any)).toBe(42);
    expect(redactForLogs(null as any)).toBeNull();
    expect(redactForLogs(undefined as any)).toBeUndefined();
  });
});

