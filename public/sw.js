// Sawbuck service worker.
// Two jobs: make the app installable, and show a branded offline page when the
// phone has no signal. It only answers page navigations, and only when the
// network fails. API calls, AI calls and assets always go straight to the
// network, so a rebuild is picked up fresh and nothing is ever served stale.
const CACHE = "sawbuck-shell-v4";
const OFFLINE = "/offline.html";
const PRECACHE = [OFFLINE, "/sawbuck-lockup.png?v=2"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.mode !== "navigate") {
    // The offline page's own files (the logo) come from the cache when the
    // network is gone. Every other request goes straight to the network.
    const url = new URL(req.url);
    if (url.origin === self.location.origin && PRECACHE.includes(url.pathname + url.search)) {
      event.respondWith(fetch(req).catch(() => caches.match(req).then((res) => res || Response.error())));
    }
    return;
  }
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((res) => res || Response.error())));
});
