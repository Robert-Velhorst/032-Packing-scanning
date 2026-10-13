import {Capacitor,registerPlugin} from '@capacitor/core';
import {isItemEditorDraft,type ItemEditorDraft} from './item-photo-draft';
import {photoDataUrlBlob} from './storage';
export interface ItemPhotoSelection {ticket:string;target:string;selected:boolean;notice:string;}
interface PhotoPlugin {
  pickItemPhoto(options:{lease:string;source:'camera'|'library';draftJson:string}):Promise<ItemPhotoSelection>;
  readItemPhoto(options:{lease:string;ticket:string}):Promise<{draftJson:string;dataUrl?:string}>;
  discardItemPhoto(options:{ticket:string}):Promise<void>;
}
const Photo=registerPlugin<PhotoPlugin>('PackingPhoto');
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export function nativeItemPhotosAvailable(){return Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android'&&Capacitor.isPluginAvailable('PackingPhoto');}
function requireLease(lease?:string):asserts lease is string {if(!nativeItemPhotosAvailable()||!lease||!uuid.test(lease))throw new Error('Unlock native photo storage before continuing.');}
export async function pickNativeItemPhoto(draft:ItemEditorDraft,source:'camera'|'library',lease?:string){
  requireLease(lease);if(!isItemEditorDraft(draft))throw new Error('The item draft cannot be prepared for a photo.');
  const reply=await Photo.pickItemPhoto({lease,source,draftJson:JSON.stringify(draft)});
  if(!reply||!uuid.test(reply.ticket)||!(reply.target==='guest'||uuid.test(reply.target))||typeof reply.selected!=='boolean'||typeof reply.notice!=='string')throw new Error('The native photo selection was not confirmed.');
  return reply;
}
export async function readNativeItemPhoto(selection:ItemPhotoSelection,lease?:string){
  requireLease(lease);const result=await Photo.readItemPhoto({lease,ticket:selection.ticket});
  if(typeof result?.draftJson!=='string')throw new Error('The item draft could not be opened.');
  const draft:unknown=JSON.parse(result.draftJson);if(!isItemEditorDraft(draft))throw new Error('This photo draft is unsupported. Saved packing records have not changed.');
  let photo:Blob|undefined;if(result.dataUrl!==undefined){if(!result.dataUrl.startsWith('data:image/jpeg;base64,')||result.dataUrl.length>18_000_000)throw new Error('The prepared reference photo is invalid.');photo=photoDataUrlBlob(result.dataUrl);if(photo.size>12*1024*1024)throw new Error('The prepared reference photo is over 12 MB.');}
  return {draft,photo};
}
export function discardNativeItemPhoto(selection:ItemPhotoSelection){return Photo.discardItemPhoto({ticket:selection.ticket});}
