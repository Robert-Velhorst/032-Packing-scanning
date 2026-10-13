import {describe,it,expect} from 'vitest';
import {captureGuidanceNotes,isScanCoverage,validScanCoverageRecord} from './capture-guidance';
import {parseScanResult} from './contract';
import type {ScanRecord} from '../types';
import {isPackingBackup} from '../backup';
import {createInitialData} from '../seed';

const coverage={method:'camera_depth_guidance_v1' as const,freshFrames:10,examinedPixels:1000,confidentPixels:20,sideMask:1,elevatedViews:0,loweredViews:0};
const record:ScanRecord={id:'quality-fixture',target:'item',platform:'android',method:'arcore_depth',createdAt:'2026-10-01T12:00:00Z',completedPasses:3,modelStoredLocally:true,quality:{depthFrames:6,viewCount:3,confidenceThreshold:.8,voxelSizeMm:5,coverage}};
describe('observed capture diagnostics',()=>{
  it('keeps pixel statistics distinct from accuracy and identifies missing directions',()=>{
    expect(isScanCoverage(coverage)).toBe(true);const notes=captureGuidanceNotes(record).join(' ');
    expect(notes).toContain('1 of 4');expect(notes).toContain('not object accuracy');expect(notes).toContain('Sparse central depth');expect(notes).toContain('keeping the object still');
  });
  it.each([{...coverage,confidentPixels:1001},{...coverage,freshFrames:0},{...coverage,sideMask:16},{...coverage,examinedPixels:NaN},{...coverage,elevatedViews:.5},{...coverage,extra:'payload'}])('rejects malformed or contradictory counts %j',bad=>expect(isScanCoverage(bad)).toBe(false));
  it('rejects forged platform and inconsistent separated-view counts at the bridge',()=>{
    const result={record,dimensionsMm:{length:100,width:60,height:20},warnings:[]};
    expect(parseScanResult(result,'item').record.quality?.coverage).toEqual(coverage);
    expect(validScanCoverageRecord({...record,platform:'ios'})).toBe(false);
    expect(validScanCoverageRecord({...record,quality:{...record.quality!,depthFrames:11}})).toBe(false);
    expect(validScanCoverageRecord({...record,quality:{...record.quality!,coverage:{...coverage,sideMask:15}}})).toBe(false);
    expect(()=>parseScanResult({...result,record:{...record,quality:{...record.quality,coverage:{...coverage,elevatedViews:4}}}},'item')).toThrow('diagnostics');
  });
  it('supports older scans and does not direct bag scans behind their walls',()=>{
    expect(captureGuidanceNotes({...record,quality:undefined})).toEqual([]);
    const notes=captureGuidanceNotes({...record,target:'container_interior'}).join(' ');expect(notes).toContain('empty interior');expect(notes).not.toContain('Rescan missing directions');
    expect(captureGuidanceNotes({...record,quality:{...record.quality!,coverage:{...coverage,sideMask:17}}})).toEqual(['Capture diagnostics are invalid. Review the original source or measure manually.']);
  });
  it('retains validated metadata in local backups and rejects invalid copies',()=>{
    const app=createInitialData();app.libraryItems[0].scan=structuredClone(record);
    const backup={format:'packing-scanning-backup',app,photos:[]};expect(isPackingBackup(backup)).toBe(true);
    app.libraryItems[0].scan!.quality!.coverage!.confidentPixels=99999;expect(isPackingBackup(backup)).toBe(false);
    delete app.libraryItems[0].scan;app.containers[0].scan={...record,target:'container_interior',quality:{...record.quality!,coverage:{...coverage,sideMask:42}}};expect(isPackingBackup(backup)).toBe(false);
  });
});
