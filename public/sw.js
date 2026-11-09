/**
 * CosmoRide Service Worker — App Shell Caching
 * Caches the application shell for offline access.
 * No background sync in v1.
 */

const CACHE_NAME = "cosmoride-v1";
const SHELL_URLS = ["/", "/login"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Network-first strategy for API calls and auth
  if (
    event.request.url.includes("/api/") ||
    event.request.url.includes("/auth/") ||
    event.request.method !== "GET"
  ) {
    return;
  }

  // Cache-first for app shell, network-first for everything else
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).catch(() => caches.match("/"));
    })
  );
});

