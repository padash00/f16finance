/* Orda operator PWA — минимальный SW для installability (Chrome). Scope задаётся при register(). */
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {})
