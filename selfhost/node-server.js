/**
 * Node.js адаптер для production-сборки TanStack Start (Worker bundle).
 * Запускает SSR + server routes на обычном Node без Cloudflare.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Максимальный размер тела запроса: 5 МБ картинки в base64 ≈ 6,7 МБ + запас. */
const MAX_BODY = 12 * 1024 * 1024;

const __dirname = dirname(fileURLToPath(import.meta.url));

const DIST_CANDIDATES = [
  join(__dirname, '../dist'),
  join(__dirname, 'dist'),
  join(process.cwd(), 'dist'),
];

const ENTRY = ['server/index.mjs', 'server/index.js'];
let DIST_DIR, ENTRY_FILE;
for (const dir of DIST_CANDIDATES) {
  for (const e of ENTRY) {
    if (existsSync(join(dir, e))) { DIST_DIR = dir; ENTRY_FILE = e; break; }
  }
  if (DIST_DIR) break;
}
if (!DIST_DIR) {
  console.error('Cannot find production build (server/index.mjs)');
  console.error('Checked:', DIST_CANDIDATES);
  process.exit(1);
}

const PUBLIC_DIR = join(DIST_DIR, 'client');

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.webp': 'image/webp', '.avif': 'image/avif', '.map': 'application/json',
};
const mime = (p) => MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream';

const { default: worker } = await import(pathToFileURL(join(DIST_DIR, ENTRY_FILE)).href);

const server = createServer(async (req, res) => {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const filePath = join(PUBLIC_DIR, urlPath);

  if (!urlPath.includes('..') && !urlPath.endsWith('/') && existsSync(filePath)) {
    try {
      res.writeHead(200, {
        'Content-Type': mime(urlPath),
        'Cache-Control': urlPath.startsWith('/_build/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      });
      res.end(readFileSync(filePath));
      return;
    } catch (e) { console.error('static:', e); }
  }

  const method = (req.method || 'GET').toUpperCase();
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = chunks.length ? Buffer.concat(chunks) : undefined;
  }

  const headers = Object.fromEntries(
    Object.entries(req.headers)
      .filter(([k]) => k !== 'transfer-encoding')
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])
  );

  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method, headers, ...(body && { body }),
  });

  try {
    const response = await worker.fetch(request, {}, { waitUntil() {}, passThroughOnException() {} });
    const respHeaders = [];
    response.headers.forEach((v, k) => respHeaders.push([k, v]));
    res.writeHead(response.status, response.statusText, respHeaders);
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
    }
    res.end();
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`CRM running on http://0.0.0.0:${PORT}`));
