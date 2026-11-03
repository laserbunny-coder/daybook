// Keeps the app opening instantly and working offline. Data requests to
// Supabase and Google always go to the network.
const VERSION = 'daybook-v116';
const SHELL = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'js/app.js', 'js/store.js', 'js/calendar.js', 'js/ai.js', 'js/tree.js', 'js/util.js', 'js/roadmap.js', 'js/repeat.js', 'js/track.js', 'js/stats.js', 'js/took.js', 'js/habits.js', 'js/areaday.js', 'js/daystrip.js', 'js/blocks.js', 'js/notes.js', 'js/alerts.js', 'js/voice.js', 'js/vendor/supabase.js', 'icons/icon-192.png'];

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
  e.respondWith((own ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request)).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});

// Phone alerts (js/alerts.js): the server pushes a title, a line and where tapping goes.
// Urgent so Android delivers it at once; Do Not Disturb lets it through when Daybook is an allowed app.
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Daybook', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png',
    vibrate: [180, 80, 180], data: { url: d.url || './' },
  }));
});
// Tapping one: a Claude thread or Inkwell opens in its own tab; Daybook's own links bring Daybook up on Notes or Needs you.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope);
  const own = url.href.startsWith(self.registration.scope);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = own && ws.find(c => c.url.startsWith(self.registration.scope));
    if (w) { w.postMessage({ open: url.search }); return w.focus(); }
    return self.clients.openWindow(url.href);
  }));
});
