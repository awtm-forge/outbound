// The service worker does three small things: it lets phones install awtm forge as a full-screen app, it shows a plain
// "you are offline" page when there is no connection, and it opens the right screen when an alert is tapped.
// It caches nothing else, so the app always loads fresh from the server and never shows stale data.
const CACHE = 'forge-offline-v1'; const OFFLINE = '/offline.html';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(OFFLINE, { cache: 'reload' })))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // files and API calls go straight to the network, untouched
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close(); const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).origin === self.location.origin);
    if (open) return open.focus().then((c) => (c && 'navigate' in c ? c.navigate(url) : undefined));
    return self.clients.openWindow(url);
  }));
});
