// Excalimade service worker: offline app shell, immutable asset + font caching. Never touches /api or /ws.
const VERSION = "v1";
const SHELL = `excalimade-shell-${VERSION}`;
const ASSETS = `excalimade-assets-${VERSION}`;
const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/fonts/Excalifont-Latin.woff2",
  "/fonts/Excalifont-LatinExt.woff2",
  "/fonts/Virgil-Regular.woff2",
  "/fonts/Nunito-Regular.woff2",
  "/fonts/ComicShanns-Regular.woff2",
  "/fonts/CascadiaCode-Regular.woff2",
  "/fonts/LilitaOne-Regular.woff2",
];
const MAX_ASSET_ENTRIES = 120;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      // add individually so one missing file doesn't abort the install
      Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => undefined))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("excalimade-") && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") {
    const cache = await caches.open(ASSETS);
    await cache.put(request, res.clone());
    trim(ASSETS, MAX_ASSET_ENTRIES);
  }
  return res;
}

async function networkFirstNavigation(request) {
  try {
    const res = await fetch(request);
    if (res.ok && res.type === "basic") {
      const cache = await caches.open(SHELL);
      await cache.put("/index.html", res.clone());
    }
    return res;
  } catch {
    return (await caches.match("/index.html")) || (await caches.match("/")) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then(async (res) => {
      if (res.ok && res.type === "basic") await (await caches.open(SHELL)).put(request, res.clone());
      return res;
    })
    .catch(() => cached || Response.error());
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/ws" || url.pathname.startsWith("/ws/")) return;
  if (request.mode === "navigate") return event.respondWith(networkFirstNavigation(request));
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/")) return event.respondWith(cacheFirst(request));
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/favicon.svg")
    return event.respondWith(staleWhileRevalidate(request));
});
