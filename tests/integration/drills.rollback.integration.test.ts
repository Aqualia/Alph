import * as fs from 'fs/promises';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TOML = require('@iarna/toml');
import * as path from 'path';
import { CodexProvider } from '../../src/agents/codex';
import { AgentConfig } from '../../src/agents/provider';

function tmpDir() {
  const base = path.resolve(__dirname, '../../tmp-e2e');
  return path.join(base, 'drill-' + Date.now());
}

describe('Rollback drill (Codex TOML)', () => {
  jest.setTimeout(20000);

  test('backup created and rollback restores prior content on validation failure', async () => {
    const dir = tmpDir();
    await fs.mkdir(path.join(dir, '.codex'), { recursive: true });
    const cfgPath = path.join(dir, '.codex', 'config.toml');
    const original = '# pre-existing\n[mcp_servers]\n';
    await fs.writeFile(cfgPath, original, 'utf-8');

    const provider = new CodexProvider();
    // Prepare a valid agent config (will write TOML)
    const agentConfig: AgentConfig = {
      mcpServerId: 'demo',
      transport: 'stdio',
      command: 'node',
      args: ['-v'],
      configDir: dir,
    };

    // Induce parse failure only during post-write validation by mocking TOML.parse
    const realParse = TOML.parse;
    const parseSpy = jest.spyOn(TOML, 'parse');
    parseSpy.mockImplementationOnce((s: string) => realParse(s)); // allow initial parse
    parseSpy.mockImplementationOnce((_s: string) => { throw new Error('forced-parse-failure'); }); // fail after write

    let threw = false;
    try {
      await provider.configure(agentConfig, true);
    } catch {
      threw = true;
    } finally {
      parseSpy.mockRestore();
    }
    expect(threw).toBe(true);

    // Verify rollback restored original content
    const now = await fs.readFile(cfgPath, 'utf-8');
    expect(now).toBe(original);
  });
});
