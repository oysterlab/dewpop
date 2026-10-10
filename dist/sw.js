// Offline support for the installed app. Network first (so updates always show up right away),
// falling back to the cached copy when there is no connection. Play logs (/api) are never cached.
const CACHE = 'dewpop-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'engine-grid.js', 'engine.js', 'levels.js', 'liquid-gl.js', 'predict-worker.js',
  'manifest.webmanifest', 'assets/bg.jpg', 'assets/logo.png', 'assets/icon.png', 'assets/icon-192.png', 'assets/pearl.png',
  'assets/pebble0.png', 'assets/pebble1.png', 'assets/pebble2.png', 'assets/pebble3.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && u.origin === location.origin) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
