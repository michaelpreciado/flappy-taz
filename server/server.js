// Local development server for Flattenhund
// Game server: SQLite via node:sqlite (JSON-file fallback), zero dependencies.
//
// Serves the static game files AND a small JSON API that js/local-db.js talks to:
//   GET    /api/health          - availability check
//   GET    /api/leaderboard     - top scores (?limit=10)
//   POST   /api/scores          - save a score (keeps the player's highest)
//   POST   /api/sessions        - create a game session
//   PATCH  /api/sessions/:id    - finish a game session
//
// Usage: node server/server.js   (or: npm start)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { openStore } = require('./store');

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
const MAX_SCORE = 100000; // sanity cap: anything above is a tampered request

// ---------------------------------------------------------------------------
// Storage (SQLite when available, JSON file otherwise - see server/store.js)
// ---------------------------------------------------------------------------

const { store, isNew } = openStore(DATA_DIR);
if (isNew) console.log('New database created and seeded with test data');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10_000) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function isValidScore(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_SCORE;
}

// Strip control characters and collapse whitespace; names are max 10 chars.
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Tiny per-IP limiter for write endpoints: 40 writes per minute.
const hits = new Map();
function rateLimited(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start > 60_000) {
    hits.set(key, { start: now, n: 1 });
    return false;
  }
  entry.n += 1;
  return entry.n > 40;
}
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [k, v] of hits) if (v.start < cutoff) hits.delete(k);
}, 60_000).unref();

// ---------------------------------------------------------------------------
// API routes (consumed by js/local-db.js)
// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, backend: store.backend });
  }

  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 10, 1), 100);
    return sendJson(res, 200, store.topScores(limit));
  }

  if (req.method === 'POST' && rateLimited(req)) {
    return sendJson(res, 429, { error: 'Too many requests, slow down' });
  }

  // One row per player name; only replaced when the new score is higher.
  if (req.method === 'POST' && pathname === '/api/scores') {
    const body = await readJsonBody(req);
    const name = cleanText(body.name, 10);
    const character = cleanText(body.character, 50) || null;
    if (!name || !isValidScore(body.score)) {
      return sendJson(res, 400, {
        error: `name (string) and score (integer 0-${MAX_SCORE}) are required`,
      });
    }
    const r = store.saveScore(name, body.score, character);
    return sendJson(res, r.created ? 201 : 200, {
      saved: r.saved, updated: r.updated, previousScore: r.previousScore,
    });
  }

  if (req.method === 'POST' && pathname === '/api/sessions') {
    const body = await readJsonBody(req);
    const session = store.createSession(cleanText(body.character, 50) || null, !!body.isNightMode);
    return sendJson(res, 201, session);
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/(\d+)$/);
  if (req.method === 'PATCH' && sessionMatch) {
    const body = await readJsonBody(req);
    const ok = store.endSession(
      Number(sessionMatch[1]),
      isValidScore(body.score) ? body.score : 0,
      isValidScore(body.boostUsedCount) ? body.boostUsedCount : 0
    );
    return ok ? sendJson(res, 200, { updated: true }) : sendJson(res, 404, { error: 'Session not found' });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// ---------------------------------------------------------------------------
// Static file serving (replaces `python3 -m http.server`)
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Only the game itself is public: never the database, server code or manifests.
const PUBLIC_TOP_LEVEL = new Set(['assets', 'css', 'js']);
const PUBLIC_ROOT_FILES = new Set([
  'index.html', 'style.css', 'manifest.json', 'sw.js', 'robots.txt',
]);

function isPublicPath(rel) {
  const parts = rel.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..')) return false;
  return parts.length === 1 ? PUBLIC_ROOT_FILES.has(rel) : PUBLIC_TOP_LEVEL.has(parts[0]);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT_DIR, rel);
  if (!filePath.startsWith(ROOT_DIR + path.sep) || !isPublicPath(path.relative(ROOT_DIR, filePath).split(path.sep).join('/'))) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const immutable = rel.startsWith('assets/');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      // Code revalidates on every load so a deploy is never stale; art/fonts are cached.
      'Cache-Control': immutable ? 'public, max-age=86400' : 'no-cache',
      ...(rel === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, decodeURIComponent(url.pathname));
    } else {
      sendJson(res, 405, { error: 'Method not allowed' });
    }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : (error instanceof URIError ? 400 : 500);
    if (status === 500) console.error('Request error:', error);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Internal error' : error.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=${PORT + 1} npm start`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Flattenhund running at http://localhost:${PORT}`);
  console.log(`Storage: ${store.backend} (${store.location})`);
});

function shutdown() {
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
