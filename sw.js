// Service worker for Flattenhund.
//
// Versioning: bump CACHE_VERSION whenever the precache list or a cache-first
// asset (art, fonts, icons) changes. Old caches are deleted on activate.
//
// Strategy
//  - Install: precache the app shell atomically (bypassing the HTTP cache). If
//    any file fails, the install fails and the previous worker keeps running.
//  - Navigations + code (HTML/JS/CSS/JSON): network-first with a revalidating
//    fetch, falling back to the cache when offline.
//  - Images and fonts: cache-first.
//  - /api/* and cross-origin requests are never touched, so the leaderboard
//    is always live (js/local-db.js handles its own offline fallback).
//  - Paths are resolved against the worker scope, so it also works under a
//    sub-path such as https://user.github.io/flappy-taz/.

const CACHE_VERSION = 'v4';
const CACHE_PREFIX = 'flattenhund-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

const APP_SHELL = [
  './',
  'index.html',
  'style.css',
  'css/dark-mode.css',
  'css/preciado-glass.css',
  'manifest.json',
  'assets/images/icon.svg',
  'assets/images/icon-192.png',
  'assets/images/taz.png',
  'assets/images/chloe.png',
  'assets/fonts/PressStart2P-Regular.woff2',
  'js/local-db.js',
  'js/audio.js',
  'js/drawing-functions.js',
  'js/background-effects.js',
  'js/mobile-optimization.js',
  'js/game.js',
  'js/dark-mode.js',
  'js/leaderboard.js',
  'js/fx.js'
];

const scoped = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        APP_SHELL.map((p) => cache.add(new Request(scoped(p), { cache: 'reload' })))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

function store(request, response) {
  if (response && response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  const isCode = req.mode === 'navigate' || /\.(?:html|js|css|json)$/.test(url.pathname) || url.pathname.endsWith('/');

  if (isCode) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => store(req, res))
        .catch(() => caches.match(req).then((hit) => hit || caches.match(scoped('index.html'))))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => store(req, res)))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
