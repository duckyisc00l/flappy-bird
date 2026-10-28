// Offline cache for the Home Screen app. Bump VERSION when you upload a new index.html.
const VERSION = 'flappy-remix-v149';
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

// v147: notifications ("Sam beat your score", "Sam sent you a race")
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Flappy Bird', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Flappy Bird', { body: d.body || '', tag: d.tag, icon: './icon-192.png', badge: './icon-192.png', data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
