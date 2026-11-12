/**
 * CosmoRide Service Worker — Intentionally Unregistered (Online-Only Security Policy)
 *
 * Notice: CosmoRide does NOT register this service worker in src/app/layout.tsx or any client
 * entry point because seat reservations, live occupancy counts, QR boarding verification,
 * Stage 2-7 operational controls, and role/session revocation require authoritative live
 * Supabase connectivity and must never queue or approve offline state transitions.
 *
 * Retained solely as a static placeholder asset without client registration.
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

