import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CarrierService } from './carrier-service.ts';
import { parseEasyjet } from './easyjet.ts';
import { fixture } from './test-fixtures.ts';

describe('carrier retrieval cache', () => {
  it('persists a retrieved copy, reuses it after restart, and preserves provenance when refresh fails', async () => {
    const path = join(await mkdtemp(join(tmpdir(),'packing-carrier-')), 'cache.json');
    let now = Date.parse('2026-09-23T12:00:00Z');
    const catalog = parseEasyjet(fixture(),new Date(now).toISOString());
    const retrieve = vi.fn().mockResolvedValueOnce(catalog).mockRejectedValue(new Error('offline'));
    const first = new CarrierService(path, retrieve, () => now);
    expect((await first.get()).meta.delivery).toBe('retrieved');
    expect(JSON.parse(await readFile(path,'utf8')).retrievedAt).toBe(catalog.retrievedAt);
    const restarted = new CarrierService(path, retrieve, () => now);
    expect((await restarted.get()).meta.delivery).toBe('cached');
    now += 8 * 86400000;
    const fallback = await restarted.get();
    expect(fallback.meta.delivery).toBe('fallback'); expect(fallback.data).toEqual(catalog);
    expect((await restarted.get()).meta.delivery).toBe('fallback');
    expect(retrieve).toHaveBeenCalledTimes(2);
  });
  it('coalesces concurrent retrievals and reuses a fresh copy', async () => {
    const path = join(await mkdtemp(join(tmpdir(),'packing-carrier-')), 'cache.json');
    const catalog = parseEasyjet(fixture(),new Date().toISOString());
    const retrieve = vi.fn().mockResolvedValue(catalog);
    const service = new CarrierService(path,retrieve);
    const results = await Promise.all([service.get(),service.get(),service.get()]);
    expect(results.every((result) => result.data.sourceHash === catalog.sourceHash)).toBe(true);
    expect((await service.get()).meta.delivery).toBe('cached');
    expect(retrieve).toHaveBeenCalledTimes(1);
  });
  it('does not use a corrupt cache or invent a successful fallback without a valid copy', async () => {
    const path = join(await mkdtemp(join(tmpdir(),'packing-carrier-')), 'cache.json');
    await writeFile(path,JSON.stringify({ retrievedAt:new Date().toISOString(),limits:{maxWeightGrams:15000} }));
    const retrieve = vi.fn().mockRejectedValue(new Error('blocked'));
    const service = new CarrierService(path,retrieve);
    await expect(service.get()).rejects.toThrow('No valid cached');
    await expect(service.get()).rejects.toThrow('Retry later');
    expect(retrieve).toHaveBeenCalledTimes(1);
  });
});
