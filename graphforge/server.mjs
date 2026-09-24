// GraphForge local server — static UI + graph API + SSE live mirror.
// Zero dependencies: node server.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGraphMd, serializeGraphMd, sanitizeModel, contentHash } from './lib/graphmd.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, 'public');
const GRAPHS = path.join(__dirname, 'graphs');
const BASE_PORT = parseInt(process.env.PORT || '4310', 10);

fs.mkdirSync(GRAPHS, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const sseClients = new Set();
const knownHashes = new Map(); // graph name -> last seen content hash

function listGraphs() {
  // Dotfiles (.seed-*, .trash) are internal — never exposed as graphs.
  return fs.readdirSync(GRAPHS)
    .filter(f => f.endsWith('.md') && !f.startsWith('.'))
    .map(f => {
      const name = f.slice(0, -3);
      const hash = contentHash(fs.readFileSync(path.join(GRAPHS, f), 'utf8'));
      knownHashes.set(name, hash);
      return { name, hash };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readGraph(name) {
  const md = fs.readFileSync(path.join(GRAPHS, name + '.md'), 'utf8');
  const hash = contentHash(md);
  knownHashes.set(name, hash);
  return { model: parseGraphMd(md, name), hash };
}

function writeGraph(name, model) {
  const md = serializeGraphMd(model);
  fs.writeFileSync(path.join(GRAPHS, name + '.md'), md, 'utf8');
  const hash = contentHash(md);
  knownHashes.set(name, hash);
  return { md, hash };
}

function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch { sseClients.delete(res); }
  }
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    sseClients.add(res);
    const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 25000);
    req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
    return;
  }

  if (p === '/api/graphs' && req.method === 'GET') {
    sendJson(res, 200, { graphs: listGraphs() });
    return;
  }

  // Raw markdown of a graph — the .md file exactly as it is on disk.
  if (p === '/api/graph.md') {
    const name = u.searchParams.get('name') || '';
    if (!NAME_RE.test(name)) { sendJson(res, 400, { error: 'invalid graph name' }); return; }
    try {
      const md = fs.readFileSync(path.join(GRAPHS, name + '.md'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(md);
    } catch { sendJson(res, 404, { error: 'graph not found' }); }
    return;
  }

  if (p === '/api/graph') {
    const name = u.searchParams.get('name') || '';
    if (!NAME_RE.test(name)) { sendJson(res, 400, { error: 'invalid graph name' }); return; }
    if (req.method === 'GET') {
      try { sendJson(res, 200, readGraph(name)); }
      catch { sendJson(res, 404, { error: 'graph not found' }); }
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      let overflow = false;
      req.on('data', c => {
        body += c;
        if (body.length > 2_000_000) { overflow = true; req.destroy(); }
      });
      req.on('end', () => {
        if (overflow) return;
        try {
          const input = JSON.parse(body || '{}');
          const model = sanitizeModel(input, name);
          const { hash } = writeGraph(name, model);
          broadcast({ name, hash });
          sendJson(res, 200, { ok: true, hash });
        } catch (e) {
          sendJson(res, 400, { error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.method === 'DELETE') {
      const file = path.join(GRAPHS, name + '.md');
      if (!fs.existsSync(file)) { sendJson(res, 404, { error: 'graph not found' }); return; }
      // Soft-delete: moved to graphs/.trash/ so mistakes stay recoverable.
      const trash = path.join(GRAPHS, '.trash');
      fs.mkdirSync(trash, { recursive: true });
      fs.renameSync(file, path.join(trash, `${name}-${Date.now()}.md`));
      knownHashes.delete(name);
      broadcast({ name, deleted: name });
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET') { serveStatic(res, p); return; }
  res.writeHead(405); res.end();
});

// Watch the graphs folder: external edits to .md files are pushed to browsers.
let watchTimer = null;
try {
  fs.watch(GRAPHS, { persistent: false }, () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      let current;
      try { current = listGraphs(); } catch { return; }
      for (const { name, hash } of current) {
        if (knownHashes.get(name) !== hash) {
          knownHashes.set(name, hash);
          broadcast({ name, hash });
        }
      }
    }, 150);
  });
} catch (e) {
  console.error('watch failed:', e.message);
}

function listen(port, attempts) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && attempts > 0) listen(port + 1, attempts - 1);
    else { console.error('port error:', err.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`GraphForge  ->  http://localhost:${port}`);
    console.log(`graphs dir  ->  ${GRAPHS}`);
  });
}
listen(BASE_PORT, 10);
