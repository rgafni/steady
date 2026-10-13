/* App shell only. Never touches API traffic, never caches a URL with a query string or hash. */
var CACHE = 'steady-v4', SHELL = ['./', 'index.html', 'app.css', 'boot.js', 'config.js', 'content.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  if (req.mode === 'navigate') { e.respondWith(fetch(req).catch(function () { return caches.match('index.html'); })); return; }
  e.respondWith(fetch(req).then(function (r) { if (r.ok) { var c = r.clone(); caches.open(CACHE).then(function (x) { x.put(req, c); }); } return r; }).catch(function () { return caches.match(req); }));
});
