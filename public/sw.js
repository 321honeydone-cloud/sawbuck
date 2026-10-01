// Sawbuck service worker.
// Two jobs: make the app installable, and show a branded offline page when the
// phone has no signal. It only answers page navigations, and only when the
// network fails. API calls, AI calls and assets always go straight to the
// network, so a rebuild is picked up fresh and nothing is ever served stale.
const CACHE = "sawbuck-shell-v3";
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
  if (req.method !== "GET" || req.mode !== "navigate") return; // everything else: plain network
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((res) => res || Response.error())));
});
