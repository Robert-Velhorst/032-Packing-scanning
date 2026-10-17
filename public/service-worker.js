const CACHE = 'packing-shell-v6';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/three/three-view.html'];

function isOfflineAsset(pathname) {
  return SHELL.includes(pathname)
    || pathname === '/three/three-view.html'
    || /^\/(?:assets|three\/assets)\/[A-Za-z0-9._-]+\.(?:js|css|woff2?|svg|png|webp|avif|wasm)$/.test(pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    const documents = await Promise.all(['/index.html', '/three/three-view.html']
      .map((path) => cache.match(path)));
    if (documents.some(Boolean)) {
      const documentPaths = ['/index.html', '/three/three-view.html'];
      const bundles = new Map();
      for (let index = 0; index < documents.length; index += 1) {
        const document = documents[index];
        if (!document) continue;
        const basePath = new URL(documentPaths[index], self.location.origin).pathname.replace(/[^/]*$/, '');
        const html = await document.text();
        for (const match of html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))(?:\?[^"']*)?["']/g)) {
          const bundle = new URL(match[1], self.location.origin).pathname;
          bundles.set(bundle, basePath);
        }
      }
      await cache.addAll([...bundles.keys()]);
      let pendingBundles = [...bundles.keys()].filter((path) => path.endsWith('.js'));
      const inspectedBundles = new Set();
      const bundleBases = new Map(bundles);
      const knownAssets = new Set(bundles.keys());
      const moduleAsset = /["']((?:\/?(?:assets|three\/assets)\/[A-Za-z0-9._-]+|\.{1,2}\/[A-Za-z0-9._-]+)\.(?:js|css))["']/g;
      while (pendingBundles.length) {
        const currentBundles = [...new Set(pendingBundles.map((bundle) => new URL(bundle, self.location.origin).pathname))]
          .filter((bundle) => !inspectedBundles.has(bundle));
        pendingBundles = [];
        for (const bundle of currentBundles) inspectedBundles.add(bundle);
        const scripts = await Promise.all(currentBundles.map(async (bundle) => {
          const script = await cache.match(new URL(bundle, self.location.origin).href);
          return { bundle, source: script ? await script.text() : '' };
        }));
        const dependencies = new Set();
        for (const script of scripts) {
          const basePath = bundleBases.get(script.bundle) ?? (script.bundle.startsWith('/three/') ? '/three/' : '/');
          for (const match of script.source.matchAll(moduleAsset)) {
            const reference = match[1];
            const dependency = reference.startsWith('/') || reference.startsWith('./') || reference.startsWith('../')
              ? new URL(reference, new URL(script.bundle, self.location.origin)).pathname
              : new URL(`${basePath}${reference}`, self.location.origin).pathname;
            if (!knownAssets.has(dependency)) {
              knownAssets.add(dependency);
              dependencies.add(dependency);
              if (dependency.endsWith('.js')) bundleBases.set(dependency, basePath);
            }
          }
        }
        pendingBundles = [...dependencies].filter((path) => path.endsWith('.js'));
        if (dependencies.size) await cache.addAll([...dependencies]);
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
