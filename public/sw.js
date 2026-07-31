const CACHE_NAME = 'ag2r-cache-v4';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/ag2r-icon.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') return;
  // Ignore API/WebSocket endpoints
  if (event.request.url.includes('/snapshot') || event.request.url.includes('/speak') || event.request.url.includes('/api/')) return;
  
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        // Cache the updated response in the background. Allow 'cors' and 'opaque' (status 0) for Google Fonts
        if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0) && (networkResponse.type === 'basic' || networkResponse.type === 'cors' || networkResponse.type === 'opaque')) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => {
        // Network failed, silently rely on cache if available
      });

      // Return the cached response immediately if available, otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});
