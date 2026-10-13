import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isCarrierCatalog, type CarrierCatalog, type CarrierCatalogResponse } from '../src/carrier-catalog.ts';
import { retrieveEasyjet } from './easyjet.ts';

export class CarrierService {
  private cache?: CarrierCatalog;
  private initialized = false;
  private pending?: Promise<CarrierCatalogResponse>;
  private lastAttempt = 0;
  private lastFailure = false;
  private cachePath: string;
  private retrieve: typeof retrieveEasyjet;
  private now: () => number;
  constructor(cachePath: string, retrieve = retrieveEasyjet, now = () => Date.now()) {
    this.cachePath = cachePath; this.retrieve = retrieve; this.now = now;
  }

  async get(): Promise<CarrierCatalogResponse> {
    if (this.pending) return this.pending;
    const request = this.load();
    this.pending = request;
    try { return await request; } finally { this.pending = undefined; }
  }
  private async load(): Promise<CarrierCatalogResponse> {
    if (!this.initialized) {
      this.initialized = true;
      try {
        const saved = JSON.parse(await readFile(this.cachePath, 'utf8'));
        if (isCarrierCatalog(saved, this.now())) this.cache = saved;
      } catch { /* Missing or invalid cache cannot establish carrier rules. */ }
    }
    if (this.cache && !isCarrierCatalog(this.cache, this.now())) this.cache = undefined;
    // Coalescing + one-hour freshness avoids scraping on each traveller request.
    if (this.cache && !this.lastFailure && this.now() - Date.parse(this.cache.retrievedAt) < 3600000) return { data: this.cache, meta: { delivery: 'cached' } };
    if (this.lastFailure && this.now() - this.lastAttempt < 60000) {
      if (this.cache) return this.fallback();
      throw new Error('Carrier source unavailable. Retry later.');
    }
    this.lastAttempt = this.now();
    try {
      const next = await this.retrieve();
      if (!isCarrierCatalog(next, this.now())) throw new Error('Invalid carrier response.');
      // A failed disk write is not a failed retrieval; local clients still save this valid copy.
      try {
        await mkdir(dirname(this.cachePath), { recursive: true });
        const temporary = `${this.cachePath}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
        await rename(temporary, this.cachePath);
      } catch { /* No personal records are stored server-side. */ }
      this.cache = next; this.lastFailure = false;
      return { data: next, meta: { delivery: 'retrieved' } };
    } catch {
      this.lastFailure = true;
      if (this.cache) return this.fallback();
      throw new Error('Carrier source unavailable. No valid cached copy exists.');
    }
  }
  private fallback(): CarrierCatalogResponse {
    return { data: this.cache!, meta: { delivery: 'fallback', warning: 'Official source refresh failed. This is the previous retrieved copy; its retrieval date has not changed. Recheck your booking before travel.' } };
  }
}
