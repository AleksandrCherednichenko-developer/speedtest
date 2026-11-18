import http from 'node:http';

// Локальный HTTP-сервер для тестов: интернет не нужен.
//   /file?size=N  — отдаёт N байт
//   /slow         — отвечает заголовками и не присылает тело
//   /missing      — 404
export async function startServer() {
  const server = http.createServer((req, res) => {
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');

    if (pathname === '/file') {
      const size = Number(searchParams.get('size') ?? 1000);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.alloc(size, 1));
    } else if (pathname === '/slow') {
      res.writeHead(200);
      res.write('x'); // тело начато, но не закончено
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
