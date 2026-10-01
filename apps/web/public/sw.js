// Minimal service worker: it makes the web app installable as a PWA, but it deliberately
// does not intercept requests. Rakazo is a live app (chats, streaming, computer screens),
// so serving stale copies from a cache would do more harm than good.
//
// The previous version answered every GET request through this worker and never filled its
// cache. Activating this version also deletes any cache an older worker left behind.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});
