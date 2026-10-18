import { parseReconstructedSolid, type ReconstructedGeometry } from './reconstructed-solid';
import { Capacitor } from '@capacitor/core';
import type { ScanTarget } from './contract';
import { parseScanResult, type ScanCapabilities, type ScanResult } from './contract';
import type { ScanRecord } from '../types';
import { parseSavedGeometry, type SavedGeometryPreview } from './saved-geometry';
import { parseInteriorCavity, type InteriorReview, type ReconstructedInterior } from './interior-cavity';
import {parseScanRetentionReply,validScanRetentionDays,type ScanRetentionDays,type ScanRetentionReply} from '../scan-retention';
import { PackingScan } from './native-plugin';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Each mounted workspace keeps its own lease, including delayed callbacks after a switch. */
export function captureClient(lease?:string){
  let closed=false,capturing=false;
  const live=()=>{if(closed)throw new Error('The capture workspace is locked or has changed.');};
  const run=async<T>(job:()=>Promise<T>)=>{live();const result=await job();live();return result;};
  return {
    revoke:()=>{closed=true;},isCapturing:()=>capturing,
    touch:()=>run(()=>lease?PackingScan.touchStorage({lease}):Promise.resolve()),
    scanObject:async(target:ScanTarget,recognize=false)=>{live();const capabilities=await getScanCapabilities();live();if(!capabilities.supported)throw new Error(capabilities.reason??'Guided capture is unavailable.');capturing=true;try{return await run(()=>scanObject(target,lease,true,recognize&&target==='item'&&capabilities.recognitionSupported===true));}finally{capturing=false;}},
    deleteScanCapture:(id?:string)=>run(()=>deleteScanCapture(id,lease)),clearScanCaptures:()=>run(()=>clearScanCaptures(lease)),
    pruneExpiredScanSources:(days:ScanRetentionDays,afterId?:string):Promise<ScanRetentionReply>=>run(async()=>{
      if(!Capacitor.isNativePlatform()||Capacitor.getPlatform()!=='android'||!lease||!uuid.test(lease)||days==null||!validScanRetentionDays(days)||afterId!==undefined&&!uuid.test(afterId))throw Error('Raw scan cleanup requires a supported period and the original unlocked Android workspace.');
      if(capturing)throw Error('Finish the current scan before raw source cleanup.');
      return parseScanRetentionReply(await PackingScan.pruneExpiredSources({lease,days,...(afterId?{afterId}:{})}));
    }),
    readSavedGeometry:(record:ScanRecord)=>run(()=>readSavedGeometry(record,lease)),
    reconstructSavedCapture:(record:ScanRecord,source:SavedGeometryPreview)=>run(()=>reconstructSavedCapture(record,source,lease)),
    reconstructSavedInterior:(record:ScanRecord,source:SavedGeometryPreview,review:InteriorReview)=>run(()=>reconstructSavedInterior(record,source,review,lease)),
  };
}
export type CaptureClient=ReturnType<typeof captureClient>;

export async function getScanRetentionCapabilities():Promise<boolean>{
  if(!Capacitor.isNativePlatform()||Capacitor.getPlatform()!=='android'||!isScannerAvailable())return false;
  try{const value=await PackingScan.getRetentionCapabilities();if(value?.version!==1||typeof value.supported!=='boolean')throw Error('Invalid cleanup capability reply.');return value.supported;}
  catch(error){if((error as {code?:string})?.code==='UNIMPLEMENTED')return false;throw error;}
}

export function isScannerAvailable(): boolean {
  return Capacitor.isPluginAvailable('PackingScan');
}

export async function getScanCapabilities(): Promise<ScanCapabilities> {
  if (!isScannerAvailable()) return { supported: false, platform: 'web', reason: 'Guided 3D capture is not available on this device.' };
  return PackingScan.getCapabilities();
}

export async function scanObject(target: ScanTarget,lease?:string,checkedCapabilities=false,recognize=false): Promise<ScanResult> {
  if (!isScannerAvailable()) {
    throw new Error('Guided 3D capture is available only on supported mobile devices. You can enter or measure the dimensions here.');
  }
  if(!checkedCapabilities){
  const capabilities = await getScanCapabilities();
  if (!capabilities.supported) {
    throw new Error(capabilities.reason ?? 'Guided 3D capture is not supported on this device. You can enter or measure the dimensions here.');
  }
  }
  return parseScanResult(await PackingScan.scanObject({ target,...(lease?{lease}:{}),...(recognize&&target==='item'?{recognize:true}:{}) }), target);
}

export async function deleteScanCapture(id?: string,lease?:string): Promise<void> {
  if (id && isScannerAvailable()) await PackingScan.deleteCapture({ id,...(lease?{lease}:{}) });
}

export async function clearScanCaptures(lease?:string): Promise<void> {
  if (isScannerAvailable()) await PackingScan.clearCaptures(lease?{lease}:undefined);
}

export function canPreviewSavedGeometry(record: ScanRecord): boolean {
  return record.platform === 'android' && record.modelStoredLocally && Capacitor.getPlatform() === 'android' && isScannerAvailable();
}

export async function readSavedGeometry(record: ScanRecord,lease?:string): Promise<SavedGeometryPreview> {
  if (!canPreviewSavedGeometry(record)) throw new Error('The original saved geometry can be reviewed on its Android device. JSON backups contain scan details, but do not contain the original point cloud.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.id)) throw new Error('The saved scan identifier is invalid.');
  return parseSavedGeometry(await PackingScan.getCapturePreview({id:record.id,...(lease?{lease}:{})}),record);
}

export async function reconstructSavedCapture(record: ScanRecord, source: SavedGeometryPreview,lease?:string): Promise<ReconstructedGeometry> {
  if (!canPreviewSavedGeometry(record) || record.target !== 'item' || source.id !== record.id || source.target !== record.target) throw new Error('Reconstruction requires the original individual-object scan on its Android device.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.id)) throw new Error('The saved scan identifier is invalid.');
  return parseReconstructedSolid(await PackingScan.reconstructCapture({id:record.id,...(lease?{lease}:{})}),source);
}

export async function reconstructSavedInterior(record:ScanRecord,source:SavedGeometryPreview,review:InteriorReview,lease?:string):Promise<ReconstructedInterior> {
  if(!canPreviewSavedGeometry(record)||record.target!=='container_interior'||source.id!==record.id||source.target!==record.target)
    throw new Error('Interior reconstruction requires the original empty bag scan on its Android device.');
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.id))throw new Error('The saved scan identifier is invalid.');
  return parseInteriorCavity(await PackingScan.reconstructInterior({id:record.id,openingAxis:review.openingAxis,openingSign:review.openingSign,seedMm:review.seedMm,...(lease?{lease}:{})}),source,review);
}
