// Service worker for the Aqba Dashboard PWA (#49).
// Strategy: stale-while-revalidate for same-origin static GETs so the app
// shell opens instantly and works offline. API calls and cross-origin
// requests are deliberately never cached (auth-sensitive / dynamic).
const CACHE = 'aqba-v2'; // v2: редизайн «аврора» — сбрасывает кэш старой темы
const CORE = [
  'index.html',
  'shared.js',
  'shared.css',
  'vendor_chart.umd.min.js',
  'manifest.webmanifest',
  'icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave Google Fonts etc. alone
  if (url.pathname.startsWith('/api/')) return;      // never cache API / auth
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
