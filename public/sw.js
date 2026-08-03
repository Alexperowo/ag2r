const CACHE_NAME = 'ag2r-static-v6';
const urlsToCache = [
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
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isStaticAsset =
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/ag2r-icon.png' ||
    url.pathname === '/ag2r-icon-192.png';
  if (!isStaticAsset) return;
  
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse?.ok && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => cachedResponse || new Response('Offline', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }));

      return cachedResponse || fetchPromise;
    })
  );
});
