// Minimal service worker. Its only job is to make HoneyDone installable as an
// app in Chrome. It deliberately does NOT cache responses, so a rebuild is
// always picked up fresh and the local AI/API calls are never intercepted.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // pass through to the network (default behavior)
});
