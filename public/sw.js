// Network-first; falls back to the last good copy when offline.
const C = 'tt-v6';
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || /^\/api\/(route|departures|geocode|debug|lan)/.test(u.pathname)) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(C).then((x) => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('./') : Response.error()))));
});
