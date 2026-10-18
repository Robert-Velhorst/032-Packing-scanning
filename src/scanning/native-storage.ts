import { Capacitor } from '@capacitor/core';
import { PackingScan, type CaptureStorageState } from './native-plugin';

export type { CaptureStorageState } from './native-plugin';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function storageState(value:CaptureStorageState){if(value?.version!==1||!uuid.test(value.revision)||value.lease!==null&&!uuid.test(value.lease)||typeof value.protectedWorkspace!=='boolean'||value.protectedWorkspace&&value.lease===null)throw new Error('The capture storage reply is invalid. Reload before unlocking.');return value;}
export async function getCaptureStorageState():Promise<CaptureStorageState|undefined>{
  if(!Capacitor.isNativePlatform()||Capacitor.getPlatform()!=='android'||!Capacitor.isPluginAvailable('PackingScan'))return undefined;
  try{return storageState(await PackingScan.getStorageState());}catch(error){if((error as {code?:string})?.code==='UNIMPLEMENTED')return undefined;throw error;}
}
export async function selectGuestCaptureStorage(revision:string){return storageState(await PackingScan.selectGuestStorage({revision}));}
export async function openCaptureWorkspace(revision:string,workspaceId:string,accountId:string,raw:Uint8Array){
  const keyBytes=Array.from(raw);
  try{return storageState(await PackingScan.openWorkspaceStorage({revision,workspaceId,accountId,keyBytes}));}finally{keyBytes.fill(0);}
}
export async function lockCaptureStorage(revision:string){return storageState(await PackingScan.lockStorage({revision}));}
export function onCaptureWorkspaceLocked(listener:(event:{lease:string})=>void){return PackingScan.addListener('captureWorkspaceLocked',listener);}
