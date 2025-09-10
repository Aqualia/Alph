import { startHttpMock } from '../mocks/streamableHttp';
import { startSseMock } from '../mocks/sse';
import { runAlphCliSuccess, spawnAlphCli } from '../_utils/spawn';

describe('alph proxy health integration', () => {
  jest.setTimeout(20000);

  test('health succeeds for Streamable HTTP mock', async () => {
    const mock = await startHttpMock();
    try {
      const res = await runAlphCliSuccess(['proxy', 'health', '--remote-url', mock.url, '--transport', 'http']);
      expect(res.stdout).toContain('health probe');
    } finally {
      await mock.close();
    }
  });

  test('health succeeds for SSE mock', async () => {
    const mock = await startSseMock();
    try {
      const res = await runAlphCliSuccess(['proxy', 'health', '--remote-url', mock.url, '--transport', 'sse']);
      expect(res.stdout).toContain('health probe');
    } finally {
      await mock.close();
    }
  });

  test('health fails for unreachable URL', async () => {
    const res = await spawnAlphCli(['proxy', 'health', '--remote-url', 'http://127.0.0.1:1/missing', '--transport', 'http']);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain('health error');
  });
});
