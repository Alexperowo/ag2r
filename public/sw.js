const CACHE_NAME = 'ag2r-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/ag2r-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') return;
  // Ignore API/WebSocket endpoints
  if (event.request.url.includes('/snapshot') || event.request.url.includes('/speak') || event.request.url.includes('/api/')) return;
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cache hit or fetch network
        return response || fetch(event.request);
      })
  );
});
