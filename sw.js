// Keeps the app opening instantly and working offline. Data requests to
// Supabase and Google always go to the network.
const VERSION = 'daybook-v1';
const SHELL = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'js/app.js', 'js/store.js', 'js/calendar.js', 'js/ai.js', 'js/tree.js', 'js/util.js', 'js/vendor/supabase.js', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const own = url.origin === location.origin;
  const fonts = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
  if (!own && !fonts) return;
  // Network first so updates show up right away; the cache covers offline.
  // no-cache makes the browser check with the server instead of reusing its
  // own short-lived copy, which kept old versions around for ten minutes.
  e.respondWith(fetch(own ? new Request(e.request, { cache: 'no-cache' }) : e.request).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
