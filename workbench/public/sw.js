/* Wisner Workbench service worker.
 * Strategy: app shell + static assets cache-first; pages network-first with a cached fallback;
 * API requests are never cached (data must always come from the server). */
const VERSION = "wb-v1";
const SHELL = ["/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cache data
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.open(VERSION).then(async (c) => (await c.match(req)) || fetch(req).then((res) => { c.put(req, res.clone()); return res; })));
    return;
  }
  if (req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => { caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; })
        .catch(async () => (await caches.match(req)) || (await caches.match("/offline")) || new Response("Offline", { status: 503 })),
    );
  }
});
