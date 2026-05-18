const CACHE = 'wifferalls-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/scripts.js',
  '/stylesheet.css',
  '/jspdf.umd.min.js',
  '/manifest.json',
  '/icon.svg',
  '/favicon.ico',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
