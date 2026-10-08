import {openDB,type DBSchema,type IDBPDatabase} from 'idb';
import type {AppData} from './types';
import {isPackingBackup} from './backup';

export const PROTECTED_DATABASE='packing-scanning-protected';
const ITERATIONS=600_000;
const encode=new TextEncoder(),decode=new TextDecoder();
export interface SealedRecord {iv:Uint8Array<ArrayBuffer>; ciphertext:ArrayBuffer;}
export interface WorkspaceDescriptor {id:string;accountId:string;label:string;createdAt:string;revision:number;salt:Uint8Array<ArrayBuffer>;wrappedKey:SealedRecord;}
export interface WorkspaceAttachment {captureLease:string;close:()=>void;clearCaptures:()=>Promise<void>;}
export type AttachWorkspace=(descriptor:WorkspaceDescriptor,raw:Uint8Array<ArrayBuffer>)=>Promise<WorkspaceAttachment>;
interface ProtectedDB extends DBSchema {workspaces:{key:string;value:WorkspaceDescriptor};records:{key:string;value:SealedRecord};}
let pending:Promise<IDBPDatabase<ProtectedDB>>|undefined;
function database(){return pending??=openDB<ProtectedDB>(PROTECTED_DATABASE,1,{upgrade(db){db.createObjectStore('workspaces');db.createObjectStore('records');}});}
const aad=(scope:string,record:string)=>encode.encode(`packing-scanning-device-v1:${scope}:${record}`);
const range=(id:string)=>IDBKeyRange.bound(`${id}:`,`${id}:\uffff`);
function checkPassphrase(value:string){if(value.length<15||value.length>128)throw new Error('Use a device passphrase of 15–128 characters.');}
async function wrappingKey(passphrase:string,salt:Uint8Array<ArrayBuffer>){
  checkPassphrase(passphrase);
  const bytes=encode.encode(passphrase);
  try {const material=await crypto.subtle.importKey('raw',bytes,'PBKDF2',false,['deriveKey']);return await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}finally{bytes.fill(0);}
}
async function importKey(raw:Uint8Array<ArrayBuffer>){return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function sealBytes(key:CryptoKey,scope:string,record:string,bytes:ArrayBuffer):Promise<SealedRecord>{const iv=crypto.getRandomValues(new Uint8Array(12));return {iv,ciphertext:await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(scope,record),tagLength:128},key,bytes)};}
export async function openBytes(key:CryptoKey,scope:string,record:string,value:SealedRecord):Promise<ArrayBuffer>{return crypto.subtle.decrypt({name:'AES-GCM',iv:value.iv,additionalData:aad(scope,record),tagLength:128},key,value.ciphertext);}
async function photoBytes(id:string,blob:Blob,createdAt:string):Promise<ArrayBuffer>{
  const header=encode.encode(JSON.stringify({id,createdAt,type:blob.type})),body=new Uint8Array(await blob.arrayBuffer()),bytes=new Uint8Array(4+header.length+body.length);
  new DataView(bytes.buffer).setUint32(0,header.length);bytes.set(header,4);bytes.set(body,4+header.length);return bytes.buffer;
}
function decodedPhoto(buffer:ArrayBuffer){
  if(buffer.byteLength<4)throw new Error('The encrypted photo is invalid.');const size=new DataView(buffer).getUint32(0);
  if(size>4096||size>buffer.byteLength-4)throw new Error('The encrypted photo is invalid.');
  const header=JSON.parse(decode.decode(new Uint8Array(buffer,4,size))) as {id:string;createdAt:string;type:string};
  if(typeof header.id!=='string'||typeof header.createdAt!=='string'||typeof header.type!=='string')throw new Error('The encrypted photo is invalid.');
  return {id:header.id,createdAt:header.createdAt,blob:new Blob([buffer.slice(4+size)],{type:header.type})};
}
export async function listWorkspaces():Promise<WorkspaceDescriptor[]>{return (await database()).getAll('workspaces');}
export function emptyWorkspace(data:AppData):AppData{return {...structuredClone(data),trips:[],libraryItems:[],containers:[],activeTripId:''};}
export function workspaceCopy(data:AppData):AppData{const copy=structuredClone(data);for(const item of copy.libraryItems)delete item.scan;for(const bag of copy.containers)delete bag.scan;return copy;}

export class ProtectedSession {
  private key:CryptoKey|undefined;
  private revision:number;
  private queue:Promise<unknown>=Promise.resolve();
  constructor(readonly descriptor:WorkspaceDescriptor,key:CryptoKey,readonly attachment?:WorkspaceAttachment){this.key=key;this.revision=descriptor.revision;}
  close(){const opened=!!this.key;this.key=undefined;if(opened)this.attachment?.close();}
  private live(){if(!this.key)throw new Error('This protected workspace is locked. Unlock it before continuing.');return this.key;}
  private async mutate<T>(prepare:(key:CryptoKey)=>Promise<{write?:[string,SealedRecord][];remove?:string[];clear?:boolean;descriptor?:WorkspaceDescriptor;result:T}>):Promise<T>{
    this.live();
    const job=this.queue.then(async()=>{
      const key=this.live(),change=await prepare(key);this.live();
      const db=await database();this.live();const tx=db.transaction(['workspaces','records'],'readwrite');
      // Observe completion even when an individual request rejects before the final await.
      const done=tx.done;void done.catch(()=>undefined);
      try {
        const current=await tx.objectStore('workspaces').get(this.descriptor.id);
        if(!this.key||!current||current.revision!==this.revision)throw new Error(!this.key?'This protected workspace is locked.':'This workspace changed in another tab. Lock and unlock it to review the saved version.');
        if(change.clear)for(const id of await tx.objectStore('records').getAllKeys(range(current.id)))await tx.objectStore('records').delete(id);
        for(const id of change.remove??[])await tx.objectStore('records').delete(`${current.id}:${id}`);
        for(const [id,value] of change.write??[])await tx.objectStore('records').put(value,`${current.id}:${id}`);
        if(!this.key)throw new Error('This protected workspace is locked.');
        const next={...(change.descriptor??current),revision:current.revision+1};await tx.objectStore('workspaces').put(next,current.id);await done;
        this.revision=next.revision;Object.assign(this.descriptor,next);return change.result;
      } catch(error) {
        try{tx.abort();}catch{ /* A rejected or completed transaction is already terminal. */ }
        await done.catch(()=>undefined);throw error;
      }
    });this.queue=job.catch(()=>undefined);return job;
  }
  async load():Promise<AppData>{
    const key=this.live(),record=await (await database()).get('records',`${this.descriptor.id}:state`);this.live();
    if(!record)throw new Error('The protected packing records are missing. Your guest packs are unchanged.');
    let app:unknown;try{app=JSON.parse(decode.decode(await openBytes(key,this.descriptor.id,'state',record)));}catch{throw new Error('These protected records could not be decrypted. They have not been replaced.');}
    this.live();if(!isPackingBackup({format:'packing-scanning-backup',app,photos:[]}))throw new Error('This protected packing data version is unsupported. It has not been replaced.');
    return app as AppData;
  }
  async save(data:AppData){if(!isPackingBackup({format:'packing-scanning-backup',app:data,photos:[]}))throw new Error('Review invalid packing records before saving this protected workspace.');const bytes=encode.encode(JSON.stringify(data));return this.mutate(async key=>({write:[['state',await sealBytes(key,this.descriptor.id,'state',bytes.buffer)]],result:undefined}));}
  savePhoto(id:string,blob:Blob,createdAt=new Date().toISOString()){return this.mutate(async key=>({write:[[`photo:${id}`,await sealBytes(key,this.descriptor.id,`photo:${id}`,await photoBytes(id,blob,createdAt))]],result:undefined}));}
  async photos():Promise<{id:string;blob:Blob;createdAt:string}[]>{
    const key=this.live(),db=await database(),keys=await db.getAllKeys('records',range(this.descriptor.id));this.live();const result=[];
    for(const id of keys.filter(id=>id.startsWith(`${this.descriptor.id}:photo:`))){const name=id.slice(this.descriptor.id.length+1),record=await db.get('records',id);if(!record)continue;
      const photo=decodedPhoto(await openBytes(key,this.descriptor.id,name,record));this.live();if(name!==`photo:${photo.id}`)throw new Error('The encrypted photo reference is invalid.');result.push(photo);
    }return result;
  }
  async photo(id:string){const key=this.live(),name=`photo:${id}`,record=await (await database()).get('records',`${this.descriptor.id}:${name}`);this.live();if(!record)return undefined;const photo=decodedPhoto(await openBytes(key,this.descriptor.id,name,record));this.live();if(photo.id!==id)throw new Error('The encrypted photo reference is invalid.');return photo.blob;}
  deletePhoto(id:string){return this.mutate(async()=>({remove:[`photo:${id}`],result:undefined}));}
  async removePhotos(keep:(photo:{id:string;createdAt:string})=>boolean){const photos=await this.photos(),remove=photos.filter(photo=>!keep(photo)).map(photo=>`photo:${photo.id}`);return this.mutate(async()=>({remove,result:remove.length}));}
  clear(){return this.mutate(async key=>({clear:true,write:[['state',await sealBytes(key,this.descriptor.id,'state',encode.encode(JSON.stringify(emptyWorkspace(await this.load()))).buffer)]],result:undefined}));}
  async changePassphrase(current:string,next:string){
    checkPassphrase(next);const raw=await unlockRaw(this.descriptor,current);
    try{const salt=crypto.getRandomValues(new Uint8Array(16)),wrappedKey=await sealBytes(await wrappingKey(next,salt),this.descriptor.id,`key:${this.descriptor.accountId}`,raw.buffer);await this.mutate(async()=>({descriptor:{...this.descriptor,salt,wrappedKey},result:undefined}));}finally{raw.fill(0);}
  }
  async remove(passphrase:string){
    const raw=await unlockRaw(this.descriptor,passphrase);raw.fill(0);await this.queue;this.live();
    if(this.attachment){const latest=await (await database()).get('workspaces',this.descriptor.id);this.live();if(latest?.revision!==this.revision)throw new Error('This workspace changed. Lock and unlock it before removal.');try{await this.attachment.clearCaptures();}catch{throw new Error('Original scan cleanup was not completed. Some original files may already have been removed; packing records have not been deleted. Unlock and review before trying again.');}}
    try{this.live();
    const db=await database(),tx=db.transaction(['workspaces','records'],'readwrite'),current=await tx.objectStore('workspaces').get(this.descriptor.id);
    if(!this.key||current?.revision!==this.revision){tx.abort();await tx.done.catch(()=>undefined);throw new Error(this.attachment?'Original scans were cleared, but packing records changed before removal. Lock and unlock to review them.':'This workspace changed. Lock and unlock it before removal.');}
    for(const id of await tx.objectStore('records').getAllKeys(range(this.descriptor.id)))await tx.objectStore('records').delete(id);
    await tx.objectStore('workspaces').delete(this.descriptor.id);await tx.done;this.close();
    }catch(error){if(this.attachment)throw new Error('Original scans were cleared, but packing record removal was not confirmed. Lock and unlock to review the remaining workspace.');throw error;}
  }
}
async function unlockRaw(descriptor:WorkspaceDescriptor,passphrase:string):Promise<Uint8Array<ArrayBuffer>>{
  try{const raw=new Uint8Array(await openBytes(await wrappingKey(passphrase,descriptor.salt),descriptor.id,`key:${descriptor.accountId}`,descriptor.wrappedKey));if(raw.length!==32)throw new Error();return raw;}catch{throw new Error('The device passphrase is incorrect, or the encrypted workspace cannot be opened.');}
}
export async function unlockWorkspace(id:string,passphrase:string,attach?:AttachWorkspace):Promise<ProtectedSession>{
  const descriptor=await (await database()).get('workspaces',id);if(!descriptor)throw new Error('This protected workspace no longer exists.');
  const raw=await unlockRaw(descriptor,passphrase);let session:ProtectedSession|undefined;
  try{const key=await importKey(raw);session=new ProtectedSession(descriptor,key);await session.load();if(attach){const attachment=await attach(descriptor,raw);session.close();session=new ProtectedSession(descriptor,key,attachment);}return session;}catch(error){session?.close();throw error;}finally{raw.fill(0);}
}
export async function createWorkspace(accountId:string,label:string,passphrase:string,data:AppData,photos:{id:string;blob:Blob;createdAt:string}[]=[],attach?:AttachWorkspace):Promise<ProtectedSession>{
  checkPassphrase(passphrase);if(!accountId||!label.trim()||label.length>70)throw new Error('A signed-in account and a device label are required.');
  if(!isPackingBackup({format:'packing-scanning-backup',app:data,photos:[]}))throw new Error('Review invalid local records before creating a protected workspace.');
  const db=await database();const existing=await db.getAll('workspaces');if(existing.some(w=>w.accountId===accountId))throw new Error('This account already has a protected workspace here. Unlock it instead.');if(existing.length>=20)throw new Error('This device already has twenty protected workspaces.');
  const id=crypto.randomUUID(),salt=crypto.getRandomValues(new Uint8Array(16)),raw=crypto.getRandomValues(new Uint8Array(32));
  try{
    const key=await importKey(raw),wrappedKey=await sealBytes(await wrappingKey(passphrase,salt),id,`key:${accountId}`,raw.buffer);
    const descriptor:WorkspaceDescriptor={id,accountId,label:label.trim(),createdAt:new Date().toISOString(),revision:1,salt,wrappedKey};
    const records:[string,SealedRecord][]=[['state',await sealBytes(key,id,'state',encode.encode(JSON.stringify(workspaceCopy(data))).buffer)]];
    for(const photo of photos)records.push([`photo:${photo.id}`,await sealBytes(key,id,`photo:${photo.id}`,await photoBytes(photo.id,photo.blob,photo.createdAt))]);
    const tx=db.transaction(['workspaces','records'],'readwrite'),latest=await tx.objectStore('workspaces').getAll();
    if(latest.some(w=>w.accountId===accountId)||latest.length>=20){tx.abort();await tx.done.catch(()=>undefined);throw new Error('The workspace list changed. Reload it before creating another.');}
    await tx.objectStore('workspaces').add(descriptor,id);for(const [name,value] of records)await tx.objectStore('records').add(value,`${id}:${name}`);await tx.done;return new ProtectedSession(descriptor,key,attach?await attach(descriptor,raw):undefined);
  }finally{raw.fill(0);}
}
