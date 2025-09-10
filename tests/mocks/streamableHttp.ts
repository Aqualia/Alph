import http from 'http';

export async function startHttpMock(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    // Minimal MCP-like endpoint; accept GET/POST
    if (req.url?.startsWith('/mcp')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => new Promise<void>(resolve => server.close(() => resolve()))
  };
}

