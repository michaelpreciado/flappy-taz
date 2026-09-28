// Service worker for Flattenhund.
//
// Strategy
//  - Precache only the small app shell (code, CSS, font, downscaled sprites).
//  - HTML / JS / CSS / manifest: network-first, falling back to cache, so a
//    deploy is never hidden behind a stale copy.
//  - Images and fonts: cache-first (they are versioned by CACHE_NAME).
//  - /api/* (leaderboard) and cross-origin requests are never touched.

const CACHE_NAME = 'flattenhund-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/css/dark-mode.css',
  '/css/preciado-glass.css',
  '/manifest.json',
  '/assets/images/icon.svg',
  '/assets/images/taz.png',
  '/assets/images/chloe.png',
  '/assets/images/mario.png',
  '/assets/fonts/PressStart2P-Regular.woff2',
  '/js/local-db.js',
  '/js/sounds.js',
  '/js/8bit-music.js',
  '/js/drawing-functions.js',
  '/js/mobile-optimization.js',
  '/js/game.js',
  '/js/dark-mode.js',
  '/js/leaderboard.js',
  '/js/background-effects.js',
  '/js/fx.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Individual adds so one missing file cannot abort the whole precache
      .then((cache) => Promise.all(APP_SHELL.map((u) => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function put(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  const isCode = req.mode === 'navigate' || /\.(?:html|js|css|json)$/.test(url.pathname) || url.pathname === '/';

  if (isCode) {
    event.respondWith(
      fetch(req)
        .then((res) => put(req, res))
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res)))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
