import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');

class MemoryCache {
  readonly entries = new Map<string, unknown>();

  constructor(private readonly sources: Record<string, string> = {}) {}

  async addAll(paths: string[]) {
    for (const path of paths) this.entries.set(new URL(path, 'https://packing.test').href, {
      path,
      text: async () => this.sources[new URL(path, 'https://packing.test').pathname] ?? '',
    });
  }

  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }

  async match(request: string | URL | { url: string }) {
    const url = typeof request === 'string' ? new URL(request, 'https://packing.test').href
      : 'href' in request ? request.href : request.url;
    return this.entries.get(url);
  }

  async put(request: { url: string }, response: unknown) {
    this.entries.set(request.url, response);
  }

  async delete(request: { url: string }) {
    return this.entries.delete(request.url);
  }
}

function workerHarness(initialCaches: Record<string, MemoryCache> = {}, sources: Record<string, string> = {}) {
  const listeners = new Map<string, (event: any) => void>();
  const cacheStore = new Map(Object.entries(initialCaches));
  const claim = vi.fn();
  const cacheApi = {
    keys: async () => [...cacheStore.keys()],
    open: async (name: string) => {
      let cache = cacheStore.get(name);
      if (!cache) { cache = new MemoryCache(sources); cacheStore.set(name, cache); }
      return cache;
    },
    delete: async (name: string) => cacheStore.delete(name),
    match: async (request: { url: string }) => {
      for (const cache of cacheStore.values()) {
        const response = await cache.match(request);
        if (response) return response;
      }
      return undefined;
    },
  };
  runInNewContext(source, {
    URL,
    caches: cacheApi,
    fetch: async () => ({ ok: true, type: 'basic', clone() { return this; } }),
    self: {
      addEventListener: (name: string, listener: (event: any) => void) => listeners.set(name, listener),
      clients: { claim },
      location: { origin: 'https://packing.test' },
      skipWaiting: vi.fn(),
    },
  });
  return { listeners, cacheStore, claim };
}

describe('offline app cache', () => {
  it('pre-caches the deferred workspace and its transitive modules for offline unlock', async () => {
    const mainScript = '/assets/index-shell.js';
    const sources = {
      '/index.html': `<script type="module" src="${mainScript}"></script>`,
      '/three/three-view.html': '<script type="module" src="/three/assets/three-view.js"></script><link rel="stylesheet" href="/three/assets/three-view.css">',
      [mainScript]: 'const dependencies=["assets/PackingApp-core.js","assets/native-storage.js"];',
      '/assets/PackingApp-core.js': 'import "assets/workspace-route.js";',
      '/assets/workspace-route.js': 'import("assets/shape-planner.js");',
      '/assets/shape-planner.js': 'export const ready = true;',
      '/three/assets/three-view.js': 'import("three/assets/three-scene.js");',
      '/three/assets/three-scene.js': 'import "three/assets/three-core.js";',
      '/three/assets/three-core.js': 'export const ready = true;',
      '/three/assets/three-view.css': '.scene { display: block; }',
    };
    const { listeners, cacheStore } = workerHarness({}, sources);
    let installation: Promise<void> | undefined;
    listeners.get('install')!({ waitUntil: (promise: Promise<void>) => { installation = promise; } });
    await installation;
    const cachedPaths = (await cacheStore.get('packing-shell-v6')!.keys()).map((request) => new URL(request.url).pathname);
    expect(cachedPaths).toContain('/assets/PackingApp-core.js');
    expect(cachedPaths).toContain('/assets/workspace-route.js');
    expect(cachedPaths).toContain('/assets/shape-planner.js');
    expect(cachedPaths).toContain('/assets/native-storage.js');
    expect(cachedPaths).toContain('/three/assets/three-view.js');
    expect(cachedPaths).toContain('/three/assets/three-scene.js');
    expect(cachedPaths).toContain('/three/assets/three-core.js');
    expect(cachedPaths).toContain('/three/assets/three-view.css');
    let cachedModule: Promise<{ path: string }> | undefined;
    listeners.get('fetch')!({ request: { method: 'GET', url: 'https://packing.test/assets/PackingApp-core.js', mode: 'cors' }, respondWith: (promise: Promise<{ path: string }>) => { cachedModule = promise; } });
    await expect(cachedModule).resolves.toHaveProperty('path', '/assets/PackingApp-core.js');
    let cachedRoute: Promise<{ path: string }> | undefined;
    listeners.get('fetch')!({ request: { method: 'GET', url: 'https://packing.test/assets/shape-planner.js', mode: 'cors' }, respondWith: (promise: Promise<{ path: string }>) => { cachedRoute = promise; } });
    await expect(cachedRoute).resolves.toHaveProperty('path', '/assets/shape-planner.js');
    let cached3dModule: Promise<{ path: string }> | undefined;
    listeners.get('fetch')!({ request: { method: 'GET', url: 'https://packing.test/three/assets/three-core.js', mode: 'cors' }, respondWith: (promise: Promise<{ path: string }>) => { cached3dModule = promise; } });
    await expect(cached3dModule).resolves.toHaveProperty('path', '/three/assets/three-core.js');
  });

  it('ignores unrelated same-origin GET requests instead of caching them', () => {
    const { listeners } = workerHarness();
    const respondWith = vi.fn();
    listeners.get('fetch')!({ request: { method: 'GET', url: 'https://packing.test/large-export.json', mode: 'cors' }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });

  it('clears obsolete app caches and non-app entries on activation', async () => {
    const oldCache = new MemoryCache();
    const current = new MemoryCache();
    await oldCache.addAll(['/assets/old.js']);
    await current.addAll(['/index.html', '/assets/app.js', '/private-export.json']);
    const { listeners, cacheStore, claim } = workerHarness({ 'packing-shell-v5': oldCache, 'packing-shell-v6': current, 'other-app-v1': new MemoryCache() });
    let activation: Promise<void> | undefined;
    listeners.get('activate')!({ waitUntil: (promise: Promise<void>) => { activation = promise; } });
    await activation;
    expect([...cacheStore.keys()].sort()).toEqual(['other-app-v1', 'packing-shell-v6']);
    expect((await current.keys()).map((request) => new URL(request.url).pathname)).toEqual(['/index.html', '/assets/app.js']);
    expect(claim).toHaveBeenCalledOnce();
  });
});
