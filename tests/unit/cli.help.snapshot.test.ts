import { runAlphCliSuccess } from '../_utils/spawn';

describe('CLI help snapshots', () => {
  jest.setTimeout(20000);

  const cli = async (...args: string[]) => runAlphCliSuccess(args);

  test('alph --help includes proxy flags', async () => {
    const res = await cli('--help');
    expect(res.stdout).toContain('proxy');
  });

  test('alph proxy run --help mentions version pin', async () => {
    const res = await cli('proxy', 'run', '--help');
    expect(res.stdout).toContain('--proxy-version');
    expect(res.stdout).toMatch(/Supergateway version/i);
  });

  test('alph setup --help shows proxy options', async () => {
    const res = await cli('setup', '--help');
    expect(res.stdout).toContain('--proxy-remote-url');
    expect(res.stdout).toContain('--proxy-transport');
  });
});
