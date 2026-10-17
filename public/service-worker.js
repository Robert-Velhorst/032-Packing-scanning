const CACHE = 'packing-shell-v6';
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
      let pendingBundles = [...new Set(bundles.filter((path) => path.endsWith('.js')))];
      const inspectedBundles = new Set();
      const moduleAsset = /["'](\/?(?:assets|three\/assets)\/[A-Za-z0-9._-]+\.js)["']/g;
      while (pendingBundles.length) {
        const currentBundles = [...new Set(pendingBundles.map((bundle) => new URL(bundle, self.location.origin).pathname))]
          .filter((bundle) => !inspectedBundles.has(bundle));
        pendingBundles = [];
        for (const bundle of currentBundles) inspectedBundles.add(bundle);
        const scripts = await Promise.all(currentBundles.map(async (bundle) => {
          const script = await cache.match(new URL(bundle, self.location.origin).href);
          return script ? script.text() : '';
        }));
        const dependencies = new Set();
        for (const source of scripts) {
          for (const match of source.matchAll(moduleAsset)) {
            const dependency = new URL(`/${match[1].replace(/^\/+/, '')}`, self.location.origin).pathname;
            if (!inspectedBundles.has(dependency)) dependencies.add(dependency);
          }
        }
        pendingBundles = [...dependencies];
        if (pendingBundles.length) await cache.addAll(pendingBundles);
      }
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
