const CACHE_PREFIX = "birdieworld-mobile-beta-";
const CACHE_NAME = `${CACHE_PREFIX}v0.1-immersive-estate-v035-shell-v1`;
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/birdieworld-icon.svg",
  "/icons/birdieworld-apple-touch-icon.png",
  "/icons/birdieworld-icon-192.png",
  "/icons/birdieworld-icon-512.png",
  "/icons/birdieworld-icon-maskable-512.png"
];
const BUILD_ASSET_MANIFEST = "__BIRDIEWORLD_BUILD_ASSETS__";
const BUILD_ASSETS = Array.isArray(BUILD_ASSET_MANIFEST)
  ? BUILD_ASSET_MANIFEST
  : [];

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const requests = [...APP_SHELL, ...BUILD_ASSETS].map(
    (path) => new Request(path, { cache: "reload" })
  );
  await cache.addAll(requests);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreVary: true })) ||
      (await cache.match("/", { ignoreVary: true }));
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (["script", "style", "image", "font", "manifest"].includes(request.destination)) {
    event.respondWith(cacheFirst(request));
  }
});
