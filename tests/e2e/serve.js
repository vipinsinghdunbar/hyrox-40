/* Dependency-free static dev server for local development and Playwright e2e.
   Serves the app shell exactly like the static host does: repo root, index.html
   fallback for extensionless paths, 404 for missing files with an extension.
   Run: npm run dev   (PORT env var overrides the default 3000) */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const port = Number(process.env.PORT || 3000);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
    let file = path.normalize(path.join(root, pathname));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      // SPA fallback only for extensionless routes; real missing assets stay 404.
      const hasExtension = path.extname(pathname) !== '';
      if (hasExtension) { res.writeHead(404); res.end('Not found'); return; }
      file = path.join(root, 'index.html');
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500); res.end('Server error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`HYROX 40 dev server → http://localhost:${port}`);
});
