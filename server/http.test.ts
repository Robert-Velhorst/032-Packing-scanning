import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createAppServer } from './http.ts';
import { CarrierService } from './carrier-service.ts';
import { parseEasyjet } from './easyjet.ts';
import { fixture } from './test-fixtures.ts';

async function start(retrieve = vi.fn().mockResolvedValue(parseEasyjet(fixture(),new Date().toISOString()))) {
  const root=await mkdtemp(join(tmpdir(),'packing-server-')), dist=join(root,'dist');
  await mkdir(dist); await writeFile(join(dist,'index.html'),'<title>Packing Scanning</title>');
  await writeFile(join(root,'private.txt'),'never serve this');
  const server=createAppServer({dist,carrierService:new CarrierService(join(root,'cache.json'),retrieve),allowedOrigins:['https://localhost']});
  await new Promise<void>((resolve) => server.listen(0,'127.0.0.1',resolve));
  return { url:`http://127.0.0.1:${(server.address() as AddressInfo).port}`, close:() => new Promise<void>((resolve) => {server.closeAllConnections();server.close(() => resolve());}) };
}
describe('public carrier HTTP endpoint', () => {
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
