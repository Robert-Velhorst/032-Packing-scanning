import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');

class MemoryCache {
  readonly entries = new Map<string, unknown>();

  async addAll(paths: string[]) {
    for (const path of paths) this.entries.set(`https://packing.test${path}`, { path });
  }

  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }

  async match(request: { url: string }) {
    return this.entries.get(request.url);
  }

  async put(request: { url: string }, response: unknown) {
    this.entries.set(request.url, response);
  }

  async delete(request: { url: string }) {
    return this.entries.delete(request.url);
  }
}

function workerHarness(initialCaches: Record<string, MemoryCache> = {}) {
  const listeners = new Map<string, (event: any) => void>();
  const cacheStore = new Map(Object.entries(initialCaches));
  const claim = vi.fn();
  const cacheApi = {
    keys: async () => [...cacheStore.keys()],
    open: async (name: string) => {
      let cache = cacheStore.get(name);
      if (!cache) { cache = new MemoryCache(); cacheStore.set(name, cache); }
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
    const { listeners, cacheStore, claim } = workerHarness({ 'packing-shell-v3': oldCache, 'packing-shell-v4': current, 'other-app-v1': new MemoryCache() });
    let activation: Promise<void> | undefined;
    listeners.get('activate')!({ waitUntil: (promise: Promise<void>) => { activation = promise; } });
    await activation;
    expect([...cacheStore.keys()].sort()).toEqual(['other-app-v1', 'packing-shell-v4']);
    expect((await current.keys()).map((request) => new URL(request.url).pathname)).toEqual(['/index.html', '/assets/app.js']);
    expect(claim).toHaveBeenCalledOnce();
  });
});
