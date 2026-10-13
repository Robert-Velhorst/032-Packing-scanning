import type { ScanRecord } from '../types.ts';

export interface ScanCoverage {
  method: 'camera_depth_guidance_v1';
  freshFrames: number;
  examinedPixels: number;
  confidentPixels: number;
  sideMask: number;
  elevatedViews: number;
  loweredViews: number;
}
const fields=['method','freshFrames','examinedPixels','confidentPixels','sideMask','elevatedViews','loweredViews'];
export function isScanCoverage(value: unknown): value is ScanCoverage {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as ScanCoverage;
  return Object.keys(v).length===fields.length&&Object.keys(v).every(k=>fields.includes(k))&&v.method==='camera_depth_guidance_v1'
    &&fields.slice(1).every(k=>Number.isSafeInteger(v[k as keyof ScanCoverage])&&(v[k as keyof ScanCoverage] as number)>=0)
    &&v.freshFrames>=1&&v.freshFrames<=100000&&v.examinedPixels>=v.freshFrames&&v.examinedPixels<=2147483647
    &&v.examinedPixels<=v.freshFrames*500000&&v.confidentPixels<=v.examinedPixels&&v.sideMask<=15
    &&v.elevatedViews<=100000&&v.loweredViews<=100000;
}
export function validScanCoverageRecord(value:unknown):boolean {
  if(!value||typeof value!=='object')return true;
  const record=value as ScanRecord,coverage=record.quality?.coverage;
  return coverage===undefined||(record.platform==='android'&&record.method==='arcore_depth'&&isScanCoverage(coverage)
    &&Number.isInteger(record.quality?.depthFrames)&&record.quality!.depthFrames>=1&&record.quality!.depthFrames<=coverage.freshFrames
    &&Number.isInteger(record.quality?.viewCount)&&record.quality!.viewCount>=1&&record.quality!.viewCount<=record.quality!.depthFrames
    &&[0,1,2,3].filter(n=>coverage.sideMask&(1<<n)).length<=record.quality!.viewCount
    &&coverage.elevatedViews+coverage.loweredViews<=record.quality!.viewCount);
}
export function captureGuidanceNotes(record:ScanRecord):string[] {
  const g=record.quality?.coverage;
  if(g===undefined)return [];
  if(!validScanCoverageRecord(record))return ['Capture diagnostics are invalid. Review the original source or measure manually.'];
  const sides=[0,1,2,3].filter(n=>g.sideMask&(1<<n)).length;
  const notes=[`${sides} of 4 camera-side sectors contributed retained depth points; ${g.elevatedViews} higher and ${g.loweredViews} lower separated viewpoints, relative to the starting camera frame. These counts do not establish captured object surfaces or complete coverage.`];
  notes.push(`${g.confidentPixels.toLocaleString()} of ${g.examinedPixels.toLocaleString()} sampled central image pixels supplied in-range depth at confidence ≥ 0.8 across ${g.freshFrames.toLocaleString()} fresh frames. This is a sampled-image diagnostic, not object accuracy.`);
  if(g.confidentPixels<g.examinedPixels*.10)notes.push('Sparse central depth: improve the light, move slowly or change the angle. Shiny, transparent or plain surfaces may require manual measurement.');
  if(record.target==='item'&&(sides<4||!g.elevatedViews||!g.loweredViews))notes.push('Rescan missing directions if safely reachable while keeping the object still. Hidden surfaces, including the underside, still need independent review.');
  if(record.target==='container_interior')notes.push('Inspect the empty interior from different directions and heights. Do not infer usable space or hidden pockets from these counts.');
  return notes;
}
