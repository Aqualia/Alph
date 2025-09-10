import { runAlphCliSuccess } from '../_utils/spawn';
import { startHttpMock } from '../mocks/streamableHttp';

describe('proxy version pinning', () => {
  jest.setTimeout(15000);

  test('default pin 3.4.0 in health preview', async () => {
    const mock = await startHttpMock();
    try {
      const res = await runAlphCliSuccess(['proxy', 'health', '--remote-url', mock.url, '--transport', 'http']);
      expect(res.stdout).toContain('supergateway@3.4.0');
    } finally { await mock.close(); }
  });

  test('override via --proxy-version', async () => {
    const mock = await startHttpMock();
    try {
      const res = await runAlphCliSuccess(['proxy', 'health', '--remote-url', mock.url, '--transport', 'http', '--proxy-version', '3.2.0']);
      expect(res.stdout).toContain('supergateway@3.2.0');
    } finally { await mock.close(); }
  });
});
