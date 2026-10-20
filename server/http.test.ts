import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createAppServer } from './http.ts';
import { CarrierService } from './carrier-service.ts';
import { parseEasyjet } from './easyjet.ts';
import { fixture } from './test-fixtures.ts';

async function start(retrieve = vi.fn().mockResolvedValue(parseEasyjet(fixture(),new Date().toISOString())), checkReady?: () => void | Promise<void>) {
  const root=await mkdtemp(join(tmpdir(),'packing-server-')), dist=join(root,'dist');
  await mkdir(dist); await writeFile(join(dist,'index.html'),'<title>Packing Scanning</title>');
  await writeFile(join(root,'private.txt'),'never serve this');
  const server=createAppServer({dist,carrierService:new CarrierService(join(root,'cache.json'),retrieve),allowedOrigins:['https://localhost'],checkReady});
  await new Promise<void>((resolve) => server.listen(0,'127.0.0.1',resolve));
  return { dist, url:`http://127.0.0.1:${(server.address() as AddressInfo).port}`, close:async() => {await new Promise<void>((resolve) => {server.closeAllConnections();server.close(() => resolve());});await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});} };
}
describe('public carrier HTTP endpoint', () => {
  it('checks local readiness without contacting providers and keeps failures private', async () => {
    const retrieve = vi.fn(), ready = vi.fn();
    const app = await start(retrieve, ready);
    try {
      const response = await fetch(`${app.url}/health/ready`);
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({ status: 'ok' });
      expect(ready).toHaveBeenCalledTimes(1);
      ready.mockImplementation(() => { throw new Error('private database path'); });
      const unavailable = await fetch(`${app.url}/health/ready`);
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({ status: 'unavailable' });
      expect((await fetch(`${app.url}/health/live`)).status).toBe(200);
      expect((await fetch(`${app.url}/health/live`, { method: 'HEAD' })).status).toBe(200);
      expect((await fetch(`${app.url}/health/ready?detail=true`)).status).toBe(400);
      expect((await fetch(`${app.url}/health/ready`, { method: 'POST' })).status).toBe(405);
      expect(retrieve).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('refuses readiness when the app build is missing or empty', async () => {
    const ready = vi.fn(), app = await start(undefined, ready);
    try {
      await writeFile(join(app.dist, 'index.html'), '');
      expect((await fetch(`${app.url}/health/ready`)).status).toBe(503);
      await rm(join(app.dist, 'index.html'));
      expect((await fetch(`${app.url}/health/ready`)).status).toBe(503);
      expect((await fetch(`${app.url}/health/live`)).status).toBe(200);
      expect(ready).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('caches hashed static assets within a bounded server cache', async () => {
    const app=await start(),directory=join(app.dist,'assets'),path=join(directory,'app-Abcdef12.js');
    try {
      await mkdir(directory);await writeFile(path,'const value = 1;');
      const first=await fetch(`${app.url}/assets/app-Abcdef12.js`);
      expect(first.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expect(await first.text()).toBe('const value = 1;');
      await writeFile(path,'const value = 2;');
      const second=await fetch(`${app.url}/assets/app-Abcdef12.js`);
      expect(await second.text()).toBe('const value = 1;');
    } finally {await app.close();}
  });
  it('compresses hashed assets with the best accepted encoding and honors opt-out', async () => {
    const app=await start(),directory=join(app.dist,'assets'),path=join(directory,'app-Abcdef12.js'),source='const phrase = "packing";\n'.repeat(5000);
    try {
      await mkdir(directory);await writeFile(path,source);
      const brotli=await fetch(`${app.url}/assets/app-Abcdef12.js`,{headers:{'Accept-Encoding':'br, gzip'}});
      expect(brotli.headers.get('Content-Encoding')).toBe('br');
      expect(brotli.headers.get('Vary')).toBe('Accept-Encoding');
      expect(Number(brotli.headers.get('Content-Length'))).toBeLessThan(Buffer.byteLength(source));
      expect(await brotli.text()).toBe(source);
      const gzipResponse=await fetch(`${app.url}/assets/app-Abcdef12.js`,{headers:{'Accept-Encoding':'gzip'}});
      expect(gzipResponse.headers.get('Content-Encoding')).toBe('gzip');
      expect(await gzipResponse.text()).toBe(source);
      const identity=await fetch(`${app.url}/assets/app-Abcdef12.js`,{headers:{'Accept-Encoding':'br;q=0, gzip;q=0'}});
      expect(identity.headers.get('Content-Encoding')).toBeNull();
      expect(Number(identity.headers.get('Content-Length'))).toBe(Buffer.byteLength(source));
      expect(await identity.text()).toBe(source);
    } finally {await app.close();}
  });
  it('serves the real protocol, explicit native origins and no-store freshness', async () => {
    const app=await start();
    try {
      const response=await fetch(`${app.url}/api/v1/carrier-rules/easyjet`,{headers:{Origin:'https://localhost'}});
      expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://localhost');
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
      expect((await response.json()).data.allowances).toHaveLength(3);
      const other=await fetch(`${app.url}/api/v1/carrier-rules/easyjet`,{headers:{Origin:'https://other.test'}});
      expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull();
    } finally {await app.close();}
  });
  it('rejects caller URLs, unsupported providers and mutations before fetching', async () => {
    const retrieve=vi.fn(); const app=await start(retrieve);
    try {
      expect((await fetch(`${app.url}/api/v1/carrier-rules/easyjet?url=http://127.0.0.1`)).status).toBe(400);
      expect((await fetch(`${app.url}/api/v1/carrier-rules/unknown`)).status).toBe(404);
      expect((await fetch(`${app.url}/api/v1/carrier-rules/easyjet`,{method:'POST',body:'personal data'})).status).toBe(405);
      expect(retrieve).not.toHaveBeenCalled();
    } finally {await app.close();}
  });
  it('uses 503 without a valid source and does not expose internal error details', async () => {
    const app=await start(vi.fn().mockRejectedValue(new Error('secret internal path')));
    try {
      const response=await fetch(`${app.url}/api/v1/carrier-rules/easyjet`);
      expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret internal path');
    } finally {await app.close();}
  });
  it('serves static output without permitting path traversal and bounds repeated API calls', async () => {
    const app=await start();
    try {
      expect(await (await fetch(app.url)).text()).toContain('Packing Scanning');
      expect((await fetch(`${app.url}/%2e%2e%5cprivate.txt`)).status).toBe(404);
      expect((await fetch(`${app.url}/server/index.ts`)).status).toBe(404);
      for(let count=0;count<120;count++) expect((await fetch(`${app.url}/api/v1/carrier-rules/easyjet`)).status).toBe(200);
      const limited=await fetch(`${app.url}/api/v1/carrier-rules/easyjet`);
      expect(limited.status).toBe(429);expect(limited.headers.get('Retry-After')).toBe('60');
    } finally {await app.close();}
  });
});
