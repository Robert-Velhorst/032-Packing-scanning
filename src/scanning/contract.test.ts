import { describe, expect, it } from 'vitest';
import { normalizeScanDimensions, parseScanResult } from './contract';
import { calibrateLongestEdge } from './calibration';

describe('scan result contract', () => {
  it('accepts an Android oriented surface envelope only with matching point-cloud provenance',()=>{
    const record={id:'scan-envelope',target:'item',createdAt:new Date().toISOString(),platform:'android',method:'arcore_depth',completedPasses:3,modelStoredLocally:true,
      geometry:{format:'ply_point_cloud',units:'metres',coordinateFrame:'capture_local_right_handed',pointCount:400,
        envelope:{method:'oriented_surface_envelope_v1',basis:'orientation_search',paddingMm:2.5}}};
    const value={record,dimensionsMm:{length:205,width:205,height:205},warnings:[]};
    expect(parseScanResult(value,'item').record.geometry?.envelope?.basis).toBe('orientation_search');
    for(const geometry of [{...record.geometry,format:'usdz'},{...record.geometry,coordinateFrame:'model_local_right_handed'},
      {...record.geometry,envelope:{...record.geometry.envelope,paddingMm:0}},
      {...record.geometry,envelope:{...record.geometry.envelope,basis:'unknown'}}]) {
      expect(()=>parseScanResult({...value,record:{...record,geometry}},'item')).toThrow('envelope');
    }
  });
  it('normalizes model axes to longest, middle, shortest dimensions', () => {
    expect(normalizeScanDimensions({ length: 120, width: 310, height: 78 })).toEqual({ length: 310, width: 120, height: 78 });
  });

  it('rejects missing or non-positive measurements', () => {
    expect(() => normalizeScanDimensions({ length: 12, width: 0, height: 4 })).toThrow('three positive dimensions');
  });

  it('rejects results for a different scan target', () => {
    expect(() => parseScanResult({
      record: { id: 'scan-1', target: 'item', createdAt: new Date().toISOString(), platform: 'ios', method: 'guided_object_capture', completedPasses: 1, modelStoredLocally: true },
      dimensionsMm: { length: 100, width: 50, height: 25 }, warnings: [],
    }, 'container_interior')).toThrow('incomplete capture details');
  });

  it('keeps the original scan estimate and calibrates the model from a measured longest edge', () => {
    const result = parseScanResult({
      record: { id: 'scan-2', target: 'item', createdAt: new Date().toISOString(), platform: 'ios', method: 'guided_object_capture', completedPasses: 2, modelStoredLocally: true },
      dimensionsMm: { length: 120, width: 80, height: 40 }, warnings: [],
    }, 'item');

    expect(result.record.dimensionsEstimateMm).toEqual({ length: 120, width: 80, height: 40 });
    expect(calibrateLongestEdge(result.record.dimensionsEstimateMm!, 300)).toEqual({
      dimensionsMm: { length: 300, width: 200, height: 100 },
      scaleFactor: 2.5,
    });
  });

  it('rejects invalid references and implausibly large corrections', () => {
    const estimate = { length: 100, width: 50, height: 20 };
    expect(() => calibrateLongestEdge(estimate, 0)).toThrow('between 1 and 10,000 mm');
    expect(() => calibrateLongestEdge(estimate, 500)).toThrow('differs too much');
  });

  it('preserves Android geometry provenance and rejects mismatched or malformed capture details', () => {
    const record = {
      id:'scan-android',target:'item',createdAt:new Date().toISOString(),platform:'android',method:'arcore_depth',completedPasses:4,modelStoredLocally:true,
      geometry:{format:'ply_point_cloud',units:'metres',coordinateFrame:'capture_local_right_handed',pointCount:1500},
      quality:{depthFrames:12,viewCount:4,confidenceThreshold:0.8,voxelSizeMm:5},
    };
    const result = parseScanResult({record,dimensionsMm:{length:100,width:60,height:30},warnings:['Check every side physically.']},'item');
    expect(result.record.geometry?.pointCount).toBe(1500);
    expect(result.record.quality?.viewCount).toBe(4);
    expect(result.warnings).toEqual(['Check every side physically.']);
    expect(()=>parseScanResult({record:{...record,platform:'ios'},dimensionsMm:result.dimensionsMm},'item')).toThrow('inconsistent');
    expect(()=>parseScanResult({record:{...record,geometry:{...record.geometry,pointCount:0}},dimensionsMm:result.dimensionsMm},'item')).toThrow('geometry');
    expect(()=>parseScanResult({record:{...record,quality:{...record.quality,confidenceThreshold:NaN}},dimensionsMm:result.dimensionsMm},'item')).toThrow('quality');
  });
});
