import { renderMcpServer } from '../../../src/renderers/mcp';

describe('Protocol-aware rendering snapshots', () => {
  const hdr = { Authorization: 'Bearer ${TOKEN}' };
  const env = { FOO: 'bar' };

  test('Cursor STDIO', () => {
    expect(
      renderMcpServer({ agent: 'cursor', serverId: 'github', transport: 'stdio', command: 'npx', args: ['-y','@mcp/github'], env })
    ).toMatchSnapshot();
  });

  test('Cursor SSE', () => {
    expect(
      renderMcpServer({ agent: 'cursor', serverId: 'linear', transport: 'sse', url: 'https://mcp.linear.app/sse', headers: hdr })
    ).toMatchSnapshot();
  });

  test('Cursor HTTP', () => {
    expect(
      renderMcpServer({ agent: 'cursor', serverId: 'notion', transport: 'http', url: 'https://mcp.notion.com/mcp', headers: hdr })
    ).toMatchSnapshot();
  });

  test('Gemini STDIO', () => {
    expect(
      renderMcpServer({ agent: 'gemini', serverId: 'github', transport: 'stdio', command: 'github-mcp', args: [], env, timeout: 5000 })
    ).toMatchSnapshot();
  });

  test('Gemini SSE', () => {
    expect(
      renderMcpServer({ agent: 'gemini', serverId: 'linear', transport: 'sse', url: 'https://mcp.linear.app/sse', headers: hdr, env })
    ).toMatchSnapshot();
  });

  test('Gemini HTTP', () => {
    expect(
      renderMcpServer({ agent: 'gemini', serverId: 'notion', transport: 'http', url: 'https://mcp.notion.com/mcp', headers: hdr })
    ).toMatchSnapshot();
  });

  test('Claude STDIO', () => {
    expect(
      renderMcpServer({ agent: 'claude', serverId: 'local', transport: 'stdio', command: 'claude', args: ['mcp','serve'], env })
    ).toMatchSnapshot();
  });

  test('Claude SSE', () => {
    expect(
      renderMcpServer({ agent: 'claude', serverId: 'linear', transport: 'sse', url: 'https://mcp.linear.app/sse', headers: hdr })
    ).toMatchSnapshot();
  });

  test('Claude HTTP', () => {
    expect(
      renderMcpServer({ agent: 'claude', serverId: 'notion', transport: 'http', url: 'https://mcp.notion.com/mcp', headers: hdr })
    ).toMatchSnapshot();
  });

  // Windsurf
  test('Windsurf STDIO', () => {
    expect(
      renderMcpServer({ agent: 'windsurf', serverId: 'local', transport: 'stdio', command: 'npx', args: ['-y','@mcp/local'], env })
    ).toMatchSnapshot();
  });
  test('Windsurf HTTP', () => {
    expect(
      renderMcpServer({ agent: 'windsurf', serverId: 'remote', transport: 'http', url: 'https://api.example.com/mcp', headers: hdr })
    ).toMatchSnapshot();
  });

  // Warp
  test('Warp STDIO', () => {
    expect(
      renderMcpServer({ agent: 'warp', serverId: 'local', transport: 'stdio', command: 'npx', args: ['-y','@mcp/local'], env })
    ).toMatchSnapshot();
  });
  test('Warp HTTP', () => {
    expect(
      renderMcpServer({ agent: 'warp', serverId: 'remote', transport: 'http', url: 'https://api.example.com/mcp', headers: hdr })
    ).toMatchSnapshot();
  });
});

