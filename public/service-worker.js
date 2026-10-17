const CACHE = 'packing-shell-v5';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

function isOfflineAsset(pathname) {
  return SHELL.includes(pathname)
    || pathname === '/three/three-view.html'
    || /^\/(?:assets|three\/assets)\/[A-Za-z0-9._-]+\.(?:js|css|woff2?|svg|png|webp|avif|wasm)$/.test(pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    const index = await cache.match('/index.html');
    if (index) {
      const html = await index.text();
      const bundles = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))(?:\?[^"']*)?["']/g)]
        .map((match) => match[1]);
      await cache.addAll([...new Set(bundles)]);
      const moduleBundles = new Set();
      const moduleAsset = /["'](\/?(?:assets|three\/assets)\/[A-Za-z0-9._-]+\.js)["']/g;
      for (const bundle of new Set(bundles.filter((path) => path.endsWith('.js')))) {
        const script = await cache.match(new URL(bundle, self.location.origin).href);
        if (!script) continue;
        const source = await script.text();
        for (const match of source.matchAll(moduleAsset)) {
          moduleBundles.add(new URL(`/${match[1].replace(/^\/+/, '')}`, self.location.origin).pathname);
        }
      }
      if (moduleBundles.size) await cache.addAll([...moduleBundles]);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('packing-shell-') && key !== CACHE).map((key) => caches.delete(key)));
    const cache = await caches.open(CACHE);
    const requests = await cache.keys();
    await Promise.all(requests.filter((request) => !isOfflineAsset(new URL(request.url).pathname)).map((request) => cache.delete(request)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // API freshness is managed explicitly in saved app data.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      const cacheKey = url.pathname === '/three/three-view.html' ? request : '/index.html';
      caches.open(CACHE).then((cache) => cache.put(cacheKey, copy));
      return response;
    }).catch(() => caches.match(request).then((cached) => cached ?? (url.pathname === '/' ? caches.match('/index.html') : undefined))));
    return;
  }

  if (!isOfflineAsset(url.pathname)) return;

  event.respondWith(caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  }));
});
