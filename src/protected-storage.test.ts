import {describe,expect,it} from 'vitest';
import {openBytes,sealBytes,ProtectedSession,workspaceCopy,type WorkspaceDescriptor} from './protected-storage';
import {createInitialData} from './seed';
import {photoDataUrlBlob} from './storage';

describe('device workspace cryptographic boundary',()=>{
  it('authenticates workspace and record identity, rejects changed ciphertext and uses fresh nonces',async()=>{
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),bytes=new TextEncoder().encode('private medication and travel dates').buffer;
    const first=await sealBytes(key,'owner-a','state',bytes),second=await sealBytes(key,'owner-a','state',bytes);
    expect([...first.iv]).not.toEqual([...second.iv]);expect([...new Uint8Array(first.ciphertext)]).not.toEqual([...new Uint8Array(second.ciphertext)]);expect([...new Uint8Array(await openBytes(key,'owner-a','state',first))]).toEqual([...new Uint8Array(bytes)]);
    await expect(openBytes(key,'owner-b','state',first)).rejects.toThrow();await expect(openBytes(key,'owner-a','photo:1',first)).rejects.toThrow();
    const changed=structuredClone(first);new Uint8Array(changed.ciphertext)[0]^=1;await expect(openBytes(key,'owner-a','state',changed)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('raw',key)).rejects.toThrow();
  });
  it('refuses every closed-session record operation before any database access',async()=>{
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const descriptor={id:'local-a',accountId:'account-a',label:'Account A',revision:1} as WorkspaceDescriptor,session=new ProtectedSession(descriptor,key);session.close();
    await expect(session.load()).rejects.toThrow(/locked/);await expect(session.save(createInitialData())).rejects.toThrow(/locked/);await expect(session.photos()).rejects.toThrow(/locked/);await expect(session.deletePhoto('1')).rejects.toThrow(/locked/);await expect(session.clear()).rejects.toThrow(/locked/);
  });
  it('keeps original guest source records intact while removing native references from an encrypted copy',()=>{
    const guest=structuredClone(createInitialData());guest.libraryItems[0].photoId='reference-photo';guest.libraryItems[0].scan={id:'private-native',target:'item',createdAt:new Date().toISOString(),platform:'android',method:'arcore_depth',completedPasses:1,modelStoredLocally:true};
    const before=structuredClone(guest),copy=workspaceCopy(guest);expect(guest).toEqual(before);expect(copy.libraryItems[0].scan).toBeUndefined();expect(copy.libraryItems[0].photoId).toBe('reference-photo');expect(copy.trips).toEqual(guest.trips);
  });
  it('decodes permitted backup photos locally without a network request and rejects unsupported data URLs',async()=>{
    const blob=photoDataUrlBlob('data:image/png;base64,AQcJCw0=');expect(blob.type).toBe('image/png');expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1,7,9,11,13]);
    for(const value of ['https://example.com/private-photo.png','data:text/html;base64,AQcJ','data:image/svg+xml;base64,AQcJ','data:image/png;base64,%%%'])expect(()=>photoDataUrlBlob(value)).toThrow();
  });
});
