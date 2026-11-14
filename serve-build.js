const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, 'frontend', 'build');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const types = {
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.img': 'application/octet-stream',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
};

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('Production build not found. Run BUILD-TAREEQ-Windows.bat first.');
  process.exit(1);
}

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  let filename = path.resolve(root, `.${pathname}`);
  if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  if (fs.existsSync(filename) && fs.statSync(filename).isDirectory()) {
    filename = path.join(filename, 'index.html');
  }
  if (!fs.existsSync(filename) && !path.extname(pathname)) {
    filename = path.join(root, 'index.html');
  }
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }

  const stat = fs.statSync(filename);
  response.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Content-Length': stat.size,
    'Content-Type': types[path.extname(filename).toLowerCase()] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  fs.createReadStream(filename).pipe(response);
});

server.listen(port, host, () => {
  console.log(`TAREEQ production build: http://${host}:${port}`);
  console.log('Press Ctrl+C to stop.');
});
