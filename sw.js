// Offline cache for the Home Screen app. Bump VERSION when you upload a new index.html.
const VERSION = 'flappy-remix-v146';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first (so a new version shows up when you are online), the saved copy when you are offline.
self.addEventListener('fetch', (e) => {
  // After you sign in, the game "sends" the login form here so Safari offers to save the password.
  // It's answered right here on your device: the password never goes anywhere.
  if (e.request.method === 'POST' && new URL(e.request.url).pathname.endsWith('/pw-saved.html')) { e.respondWith(new Response('<!doctype html><title>ok</title>', { headers: { 'content-type': 'text/html' } })); return; }
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r && r.ok && new URL(e.request.url).origin === location.origin) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((m) => m || caches.match('./index.html')))
  );
});
