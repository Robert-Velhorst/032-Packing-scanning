import { openDB, type IDBPDatabase } from 'idb';
import { createInitialData } from './seed';
import type { AppData } from './types';
import { isCarrierCatalog } from './carrier-catalog';
import type {ProtectedSession} from './protected-storage';

const DATABASE_NAME = 'packing-scanning-local';
const DATABASE_VERSION = 1;
const STATE_KEY = 'app-state';

interface PhotoRecord {
  id: string;
  blob: Blob;
  createdAt: string;
}

interface PackingDatabase {
  state: { key: string; value: AppData };
  photos: { key: string; value: PhotoRecord };
}

let databasePromise: Promise<IDBPDatabase<PackingDatabase>> | undefined;

function database() {
  if (!databasePromise) {
    databasePromise = openDB<PackingDatabase>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(db) {
        db.createObjectStore('state');
        db.createObjectStore('photos', { keyPath: 'id' });
      },
    });
  }
  return databasePromise;
}

export async function loadAppData(): Promise<AppData> {
  const db = await database();
  const stored = await db.get('state', STATE_KEY);
  if (!stored) {
    const initial = createInitialData();
    await db.put('state', initial, STATE_KEY);
    return initial;
  }
  if (stored.schemaVersion !== 1) throw new Error('This saved packing data version is not supported. Export it before updating the app.');
  if (stored.carrierCatalog && !isCarrierCatalog(stored.carrierCatalog)) {
    const { carrierCatalog: invalidCatalog, ...rest } = stored;
    void invalidCatalog;
    return rest;
  }
  return stored;
}

export async function saveAppData(data: AppData): Promise<void> {
  const db = await database();
  await db.put('state', data, STATE_KEY);
}

export async function savePhoto(id: string, blob: Blob): Promise<void> {
  const db = await database();
  await db.put('photos', { id, blob, createdAt: new Date().toISOString() });
}

export async function getPhoto(id: string): Promise<Blob | undefined> {
  const db = await database();
  return (await db.get('photos', id))?.blob;
}

export async function deletePhoto(id: string): Promise<void> {
  const db = await database();
  await db.delete('photos', id);
}

export async function removeUnreferencedPhotos(referencedIds: Set<string>): Promise<number> {
  const db = await database();
  const tx = db.transaction('photos', 'readwrite');
  let removed = 0;
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (!referencedIds.has(cursor.value.id)) {
      await cursor.delete();
      removed += 1;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return removed;
}

export async function prunePhotos(olderThanDays: number): Promise<number> {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const db = await database();
  const tx = db.transaction('photos', 'readwrite');
  let removed = 0;
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (Date.parse(cursor.value.createdAt) < cutoff) {
      await cursor.delete();
      removed += 1;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return removed;
}

export async function exportPhotos(): Promise<Array<{ id: string; dataUrl: string; createdAt: string }>> {
  const db = await database();
  const records = await db.getAll('photos');
  return Promise.all(records.map(async (record) => ({
    id: record.id,
    createdAt: record.createdAt,
    dataUrl: await blobToDataUrl(record.blob),
  })));
}

export async function importPhoto(id: string, dataUrl: string, createdAt?: string): Promise<void> {
  const blob = photoDataUrlBlob(dataUrl);
  const db = await database();
  await db.put('photos', { id, blob, createdAt: createdAt ?? new Date().toISOString() });
}

export function photoDataUrlBlob(dataUrl:string):Blob {
  const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]*)$/i.exec(dataUrl);
  if(!match||dataUrl.length>18_000_000)throw new Error('This saved photo data is unsupported.');
  const binary=atob(match[2]),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:match[1]});
}

export async function clearLocalData(): Promise<void> {
  const db = await database();
  const tx = db.transaction(['state', 'photos'], 'readwrite');
  await Promise.all([tx.objectStore('state').clear(), tx.objectStore('photos').clear()]);
  await tx.done;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read a saved photo.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

/** Bind each mounted app to one store; in-flight work never follows a workspace switch. */
export function workspaceStorage(session?:ProtectedSession) {
  if(!session)return {loadAppData,saveAppData,savePhoto,getPhoto,deletePhoto,removeUnreferencedPhotos,prunePhotos,exportPhotos,importPhoto,clearLocalData,photoRecords:async()=>{const db=await database();return db.getAll('photos') as Promise<PhotoRecord[]>;}};
  return {
    loadAppData:()=>session.load(),saveAppData:(data:AppData)=>session.save(data),
    savePhoto:(id:string,blob:Blob)=>session.savePhoto(id,blob),getPhoto:(id:string)=>session.photo(id),deletePhoto:(id:string)=>session.deletePhoto(id),
    removeUnreferencedPhotos:(ids:Set<string>)=>session.removePhotos(photo=>ids.has(photo.id)),
    prunePhotos:(days:number)=>session.removePhotos(photo=>Date.parse(photo.createdAt)>=Date.now()-days*86400000),
    exportPhotos:async()=>Promise.all((await session.photos()).map(async photo=>({id:photo.id,createdAt:photo.createdAt,dataUrl:await blobToDataUrl(photo.blob)}))),
    importPhoto:async(id:string,dataUrl:string,createdAt?:string)=>{await session.savePhoto(id,photoDataUrlBlob(dataUrl),createdAt);},
    photoRecords:()=>session.photos(),
    clearLocalData:()=>session.clear(),
  };
}
