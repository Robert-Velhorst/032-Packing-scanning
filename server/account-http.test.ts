import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { createAppServer } from './http.ts';
import { AccountStore } from './accounts.ts';
import { AccountApi } from './account-http.ts';
import { CarrierService } from './carrier-service.ts';
import { accountMetadataBackup } from '../src/backup.ts';
import { createInitialData } from '../src/seed.ts';
import { sharedPackingRecords,openSharedPack,type SharedPackSnapshot } from '../src/shared-packs.ts';
import {createSharedPackBaseline} from '../src/shared-pack-baseline.ts';
import {reviewSharedCombination,combineReviewedSharedRecords,recordSharedPublication,type SharedChoice} from '../src/shared-pack-combination.ts';
import {setPackingItemComplete} from '../src/packing-progress.ts';

async function start(enabled = true, origin?: string, registrations = true) {
  const root = await mkdtemp(join(tmpdir(), 'packing-account-http-')), dist = join(root, 'dist'); await mkdir(dist); await writeFile(join(dist, 'index.html'), '<title>Packing Scanning</title>');
  const options: Parameters<typeof createAppServer>[0] = { dist, carrierService: new CarrierService(join(root, 'carrier.json')) };
  const server = createAppServer(options); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, store = enabled ? new AccountStore(join(root, 'account.sqlite'), Buffer.alloc(32, 9)) : undefined;
  if (store) options.accountApi = new AccountApi(store, origin ?? url, registrations);
  return { url, origin: origin ?? url, store, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => { store?.close(); resolve(); }); }) };
}
function rawRequest(url: string, method: string, headers: Record<string, string>, body?: string): Promise<{ status: number; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => { const request = httpRequest(url, { method, headers }, response => { response.resume(); response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers })); }); request.on('error', reject); request.end(body); });
}
const credentials = { username: 'http-qa-user', name: 'Synthetic HTTP traveller', password: 'synthetic http passphrase 032' };
describe('account HTTP boundary', () => {
  it('publishes a reviewed combined copy with exact revisions while preserving offline packing and private records',async()=>{
    const app=await start();try{
      const root=`${app.url}/api/v1/account`,common={Origin:app.origin,'Content-Type':'application/json'};
      async function register(username:string){const response=await fetch(`${root}/registrations`,{method:'POST',headers:common,body:JSON.stringify({...credentials,username})});expect(response.status).toBe(201);const auth=(await response.json()).data;return {headers:{...common,Cookie:response.headers.get('set-cookie')!.split(';')[0],'X-Packing-CSRF':auth.csrf},profile:auth.profile};}
      const owner=await register('combination-owner'),member=await register('combination-member');
      async function call(path:string,auth:typeof owner,method='GET',body?:unknown){return fetch(root+path,{method,headers:auth.headers,...(body===undefined?{}:{body:JSON.stringify(body)})});}
      const house=(await(await call('/households',owner,'POST',{name:'Synthetic combined-copy family'})).json()).data;
      const invite=(await(await call(`/households/${house.id}/invitations`,owner,'POST',{username:member.profile.username})).json()).data;
      expect((await call('/households/memberships',member,'POST',{code:invite.code,consent:true})).status).toBe(201);
      const privateData=structuredClone(createInitialData());privateData.libraryItems.push({...structuredClone(privateData.libraryItems[0]),id:'unshared-private-item',name:'Private fixture never uploaded'});
      privateData.libraryItems[0].photoId='private-fixture-photo';
      const records=sharedPackingRecords(privateData,privateData.activeTripId),pack=(await(await call(`/households/${house.id}/packs`,owner,'POST',{records,consent:true})).json()).data;
      const path=`/households/${house.id}/packs/${pack.id}`,v1=(await(await call(path,owner)).json()).data as SharedPackSnapshot;
      const local=openSharedPack(privateData,v1,'http-offline',await createSharedPackBaseline(v1.records,1));
      local.trips[0].name='Offline family title';const entry=local.trips[0].entries[0],item=local.libraryItems.find(i=>i.id===entry.itemId)!;
      const p={instanceId:entry.id+'#1',entryId:entry.id,itemId:entry.itemId,containerId:local.trips[0].containerIds[0],x:0,y:0,z:0,...item.dimensions,layer:1,rotation:0};local.trips[0]=setPackingItemComplete(local.trips[0],p.instanceId,true,p);
      const earlier=structuredClone(local),remoteRecords=structuredClone(v1.records);remoteRecords.trip.destination='Synthetic shared destination';remoteRecords.libraryItems[0].fragile=false;
      expect((await call(path,member,'PUT',{records:remoteRecords,consent:true,revision:1})).status).toBe(200);
      const v2=(await(await call(path,owner)).json()).data as SharedPackSnapshot,review=await reviewSharedCombination(local,local.activeTripId,v2);
      expect(review.changes.some(c=>c.safetyChange)).toBe(true);expect(()=>combineReviewedSharedRecords(review,{})).toThrow(/Choose/);
      const choices:Record<string,SharedChoice>=Object.fromEntries(review.changes.filter(c=>c.requiresReview).map(c=>[c.key,'local'])),combined=combineReviewedSharedRecords(review,choices);
      const opened=openSharedPack(local,{...v2,name:combined.trip.name,records:combined},'http-combined',review.remoteBaseline,review);
      expect(opened.trips.slice(1)).toEqual(earlier.trips);expect(opened.trips[0].sharedPack?.revision).toBe(2);
      const submitted=sharedPackingRecords(opened,opened.activeTripId);expect(submitted.trip.name).toBe('Offline family title');expect(submitted.trip.destination).toBe('Synthetic shared destination');expect(submitted.trip.lockedPlacements).toHaveLength(1);expect(submitted.libraryItems[0].fragile).toBe(true);
      expect(JSON.stringify(submitted)).not.toMatch(/private-fixture-photo|Private fixture never uploaded|shared_pack_baseline_v1/);
      expect((await call(path,owner,'PUT',{records:submitted,revision:2})).status).toBe(422);
      expect((await call(path,owner,'PUT',{records:submitted,consent:true,revision:1})).status).toBe(409);
      const acknowledged=await call(path,owner,'PUT',{records:submitted,consent:true,revision:2});expect(acknowledged.status).toBe(200);const summary=(await acknowledged.json()).data;
      opened.trips[0].name='Later edit during publication';const saved=recordSharedPublication(opened,opened.activeTripId,{...summary,records:submitted},await createSharedPackBaseline(submitted,3));expect(saved.trips[0].name).toBe('Later edit during publication');
      const shared=(await(await call(path,member)).json()).data;expect(shared.revision).toBe(3);expect(shared.records).toEqual(submitted);expect((await(await call('/vault',member)).json()).data.hasBackup).toBe(false);
      expect((await call(path,member,'PUT',{records:submitted,consent:true,revision:3})).status).toBe(200);expect((await call(path,owner,'PUT',{records:submitted,consent:true,revision:3})).status).toBe(409);
      expect((await call(`/households/${house.id}/members/${member.profile.id}`,owner,'DELETE')).status).toBe(204);expect((await call(path,member)).status).toBe(404);expect((await call(path,member,'PUT',{records:submitted,consent:true,revision:4})).status).toBe(404);
      expect(local).toEqual(earlier);expect(saved.trips[0].lockedPlacements).toEqual(opened.trips[0].lockedPlacements);
    }finally{await app.close();}
  },20000);
  it('enforces real household membership, addressed invitations, consent, revisions and owner authority',async()=>{
    const app=await start();try{
      const root=`${app.url}/api/v1/account`,common={Origin:app.origin,'Content-Type':'application/json'};
      async function register(username:string){const response=await fetch(`${root}/registrations`,{method:'POST',headers:common,body:JSON.stringify({...credentials,username})}),auth=(await response.json()).data;expect(response.status).toBe(201);return {...common,Cookie:response.headers.get('set-cookie')!.split(';')[0],'X-Packing-CSRF':auth.csrf};}
      const a=await register('http-house-owner'),b=await register('http-house-member'),c=await register('http-house-outsider');
      async function call(path:string,headers:typeof a,method='GET',body?:unknown){return fetch(root+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});}
      const created=await call('/households',a,'POST',{name:'HTTP private household'});expect(created.status).toBe(201);const house=(await created.json()).data;expect(created.headers.get('Location')).toContain(house.id);
      expect((await call(`/households/${house.id}`,c)).status).toBe(404);expect((await call('/households',a,'PUT',{name:'invalid method'})).status).toBe(405);
      const invite=(await(await call(`/households/${house.id}/invitations`,a,'POST',{username:'http-house-member'})).json()).data;
      expect((await call('/households/memberships',c,'POST',{code:invite.code,consent:true})).status).toBe(404);expect((await call('/households/memberships',b,'POST',{code:invite.code})).status).toBe(422);expect((await call('/households/memberships',b,'POST',{code:invite.code,consent:true})).status).toBe(201);
      expect((await call(`/households/${house.id}/invitations`,b,'POST',{username:'http-house-outsider'})).status).toBe(403);
      const records=sharedPackingRecords(createInitialData(),'sample-trip');expect((await call(`/households/${house.id}/packs`,a,'POST',{records})).status).toBe(422);
      expect((await call(`/households/${house.id}/packs`,{...a,'X-Packing-CSRF':'0'.repeat(64)},'POST',{records,consent:true})).status).toBe(403);
      const pack=(await(await call(`/households/${house.id}/packs`,a,'POST',{records,consent:true})).json()).data;expect((await call(`/households/${house.id}/packs/${pack.id}`,c)).status).toBe(404);
      expect((await(await call(`/households/${house.id}/packs/${pack.id}`,b)).json()).data.records).toEqual(records);
      expect((await call(`/households/${house.id}/packs/${pack.id}`,b,'PUT',{records,consent:true,revision:1})).status).toBe(200);expect((await call(`/households/${house.id}/packs/${pack.id}`,a,'PUT',{records,consent:true,revision:1})).status).toBe(409);
      expect((await call(`/households/${house.id}/ownership`,a,'POST',{userId:(await(await call('/session',b)).json()).data.profile.id,password:credentials.password,confirm:true})).status).toBe(200);
      expect((await call(`/households/${house.id}`,a,'DELETE',{password:credentials.password,confirm:true})).status).toBe(403);expect((await call('',b,'DELETE',{password:credentials.password,confirm:true})).status).toBe(409);
      const ownerId=(await(await call('/session',a)).json()).data.profile.id;expect((await call(`/households/${house.id}/members/${ownerId}`,a,'DELETE')).status).toBe(204);expect((await call(`/households/${house.id}`,a)).status).toBe(404);
      expect((await call(`/households/${house.id}`,b,'DELETE',{password:credentials.password,confirm:true})).status).toBe(204);expect((await(await call('/households',b)).json()).data).toEqual([]);
    }finally{await app.close();}
  },20000);
  it('keeps guest mode available with accounts disabled and blocks remote plaintext configuration', async () => {
    const app = await start(false); try {
      expect((await (await fetch(`${app.url}/api/v1/account/session`)).json()).data.available).toBe(false);
      expect((await fetch(`${app.url}/api/v1/account/sessions`, { method: 'POST' })).status).toBe(503);
      const store = new AccountStore(':memory:', Buffer.alloc(32)); try { expect(() => new AccountApi(store, 'http://public.example')).toThrow(/HTTPS/); } finally { store.close(); }
    } finally { await app.close(); }
  });
  it('runs real registration, private save/download/export and logout with consent, host, origin and CSRF checks', async () => {
    const app = await start(); try {
      const endpoint = `${app.url}/api/v1/account`, headers = { Origin: app.origin, 'Content-Type': 'application/json' };
      expect((await fetch(`${endpoint}/registrations`, { method: 'POST', headers: { ...headers, Origin: 'https://other.test' }, body: JSON.stringify(credentials) })).status).toBe(403);
      expect((await fetch(`${endpoint}/registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) })).status).toBe(403);
      const registered = await fetch(`${endpoint}/registrations`, { method: 'POST', headers, body: JSON.stringify(credentials) }); expect(registered.status).toBe(201);
      const cookie = registered.headers.get('set-cookie')!, auth = (await registered.json()).data;
      expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict'); expect(cookie).toContain('Path=/api/v1/account');
      expect(auth).not.toHaveProperty('token'); const authenticated = { ...headers, Cookie: cookie.split(';')[0], 'X-Packing-CSRF': auth.csrf };
      const sessionResponse = await fetch(`${endpoint}/session`, { headers: { Cookie: authenticated.Cookie } });
      expect(sessionResponse.headers.get('Cache-Control')).toBe('no-store'); expect(sessionResponse.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect((await sessionResponse.json()).data.profile.username).toBe(credentials.username);
      const backup = accountMetadataBackup(createInitialData()), body = JSON.stringify({ revision: 0, consent: true, backup });
      expect((await fetch(`${endpoint}/vault`, { method: 'PUT', headers: { ...authenticated, 'X-Packing-CSRF': '0'.repeat(64) }, body })).status).toBe(403);
      expect((await fetch(`${endpoint}/vault`, { method: 'PUT', headers: authenticated, body: JSON.stringify({ revision: 0, backup }) })).status).toBe(422);
      expect((await fetch(`${endpoint}/vault`, { method: 'PUT', headers: authenticated, body })).status).toBe(200);
      expect((await fetch(`${endpoint}/vault`, { method: 'PUT', headers: authenticated, body })).status).toBe(409);
      const summary = (await (await fetch(`${endpoint}/vault`, { headers: authenticated })).json()).data;
      expect(summary).toMatchObject({ revision: 1, hasBackup: true }); expect(summary).not.toHaveProperty('backup');
      expect((await (await fetch(`${endpoint}/vault/backup`, { headers: authenticated })).json()).data.backup).toEqual(backup);
      expect((await rawRequest(`${endpoint}/vault/backup`, 'GET', { Host: 'other.test', Cookie: authenticated.Cookie })).status).toBe(403);
      expect((await fetch(`${endpoint}/vault/backup?user=another`, { headers: authenticated })).status).toBe(400);
      expect((await fetch(`${endpoint}/vault/backup`)).status).toBe(401);
      expect((await (await fetch(`${endpoint}/export`, { headers: authenticated })).json()).data.format).toBe('packing-account-export');
      const logout = await fetch(`${endpoint}/session`, { method: 'DELETE', headers: authenticated }); expect(logout.status).toBe(204); expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
      expect((await fetch(`${endpoint}/vault`, { headers: authenticated })).status).toBe(401);
    } finally { await app.close(); }
  }, 15000);
  it('bounds bodies, rejects non-JSON input and gates registration', async () => {
    const app = await start(); try {
      const endpoint = `${app.url}/api/v1/account/registrations`;
      expect((await fetch(endpoint)).status).toBe(405);
      expect((await fetch(endpoint, { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'text/plain' }, body: 'not-json' })).status).toBe(415);
      expect((await fetch(endpoint, { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400);
      expect((await fetch(endpoint, { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json' }, body: ' '.repeat(17000) })).status).toBe(413);
    } finally { await app.close(); }
    const closed = await start(true, undefined, false); try { expect((await fetch(`${closed.url}/api/v1/account/registrations`, { method: 'POST', headers: { Origin: closed.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) })).status).toBe(403); } finally { await closed.close(); }
  }, 15000);
  it('sets the production Secure host-only cookie and prevents authenticated cross-origin reads', async () => {
    const app = await start(true, 'https://packing.example'); try {
      const endpoint = `${app.url}/api/v1/account`, headers = { Origin: app.origin, Host: 'packing.example', 'Content-Type': 'application/json' };
      const response = await rawRequest(`${endpoint}/registrations`, 'POST', headers, JSON.stringify(credentials)); expect(response.status).toBe(201);
      const cookie = response.headers['set-cookie']![0]; expect(cookie).toContain('__Host-packing_session='); expect(cookie).toContain('; Secure'); expect(cookie).toContain('Path=/;'); expect(cookie).not.toContain('Domain=');
      expect((await rawRequest(`${endpoint}/session`, 'GET', { Host: 'packing.example', Origin: 'https://other.test', Cookie: cookie.split(';')[0] })).status).toBe(403);
    } finally { await app.close(); }
  }, 15000);
});
