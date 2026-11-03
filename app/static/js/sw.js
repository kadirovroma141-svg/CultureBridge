/* CultureBridge AI — service worker (served at /sw.js, scope "/").
   Pages and GET API data: network first, saved copy when offline.
   /static files: cache first (keyed by ?v=<commit>, so each deploy fetches fresh). Bump VERSION to drop old caches. */
const VERSION = "cb-v1";
const CORE = [
  "/", "/learn", "/atlas", "/radar", "/greetings",
  "/static/css/styles.css", "/static/css/pages.css",
  "/static/js/app.js",
  "/static/img/icon.svg", "/static/img/apple-touch-icon.png",
];
// Never cache: admin, login state, anything that writes
const BYPASS = /^\/(admin|api\/admin|api\/auth)(\/|$)/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Offline — CultureBridge AI</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#070a15;color:#e2e8f0;font-family:system-ui,sans-serif;text-align:center;padding:24px">
<div><div style="font-size:3rem">📡</div><h1 style="font-size:1.4rem">You are offline</h1>
<p style="color:#94a3b8;max-width:320px">This page has not been opened before, so there is no saved copy. Pages you have visited still work offline.</p>
<p><a href="/" style="color:#8b6cff">Open the home page</a></p></div></body></html>`;

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === "navigate") return new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  // Exact match first: ?v=<commit> changes on every deploy, so a new release is a miss and comes from the network
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    // Google Fonts arrive as opaque (no-cors) responses: status unknown, but still worth keeping
    if (res.ok || res.type === "opaque") cache.put(req, res.clone());
    return res;
  } catch (err) {
    // offline: an older version of the same file is better than nothing
    const old = await cache.match(req, { ignoreSearch: true });
    if (old) return old;
    throw err;
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(cacheFirst(req));
    return;
  }
  if (BYPASS.test(url.pathname) || url.pathname === "/sw.js") return;
  if (url.pathname.startsWith("/static/")) e.respondWith(cacheFirst(req));
  else e.respondWith(networkFirst(req));
});
