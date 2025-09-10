import http from 'http';

export async function startSseMock(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/sse')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write(`: ping\n\n`);
      res.write(`event: message\n`);
      res.write(`data: hello\n\n`);
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/sse`,
    close: async () => new Promise<void>(resolve => server.close(() => resolve()))
  };
}

