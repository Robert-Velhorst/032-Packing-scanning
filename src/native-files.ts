import {Capacitor,registerPlugin} from '@capacitor/core';

export const MAX_BACKUP_BYTES=80*1024*1024;
export interface BackupSelection {ticket:string;target:string;}
interface FilesPlugin {
  pickBackup(options:{lease:string}):Promise<{selected:boolean;ticket?:string;target?:string}>;
  saveBackup(options:{lease:string;text:string}):Promise<{saved:boolean}>;
  readBackup(options:{lease:string;ticket:string}):Promise<{text:string}>;
  discardBackup(options:{ticket:string}):Promise<void>;
}
const Files=registerPlugin<FilesPlugin>('PackingFiles');
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export function nativeBackupFilesAvailable(){return Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android'&&Capacitor.isPluginAvailable('PackingFiles');}
function requireLease(lease?:string):asserts lease is string {if(!nativeBackupFilesAvailable()||!lease||!uuid.test(lease))throw new Error('Unlock native backup storage before continuing.');}
export async function pickNativeBackup(lease?:string):Promise<BackupSelection|undefined>{
  requireLease(lease);const result=await Files.pickBackup({lease});
  if(result.selected===false)return;
  if(result.selected!==true||!result.ticket||!uuid.test(result.ticket)||!result.target||(result.target!=='guest'&&!uuid.test(result.target)))throw new Error('The file provider returned an invalid backup selection. Choose the file again.');
  return {ticket:result.ticket,target:result.target};
}
export async function saveNativeBackup(text:string,lease?:string){
  requireLease(lease);if(new Blob([text]).size>MAX_BACKUP_BYTES)throw new Error('This backup is over 80 MB. Remove unneeded photos before exporting.');
  const result=await Files.saveBackup({lease,text});if(typeof result.saved!=='boolean')throw new Error('File saving was not confirmed. Check the selected destination.');return result.saved;
}
export async function readNativeBackup(selection:BackupSelection,lease?:string){
  requireLease(lease);const result=await Files.readBackup({lease,ticket:selection.ticket});
  if(typeof result.text!=='string'||new Blob([result.text]).size>MAX_BACKUP_BYTES)throw new Error('This selected backup cannot be opened. Choose a file under 80 MB.');
  return new File([result.text],'packing-scanning-backup.json',{type:'application/json'});
}
export function discardNativeBackup(selection:BackupSelection){return Files.discardBackup({ticket:selection.ticket});}
