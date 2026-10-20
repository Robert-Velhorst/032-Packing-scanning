import {describe,expect,it} from 'vitest';
import {parseScanResult} from './contract';
import {captureGuidanceNotes} from './capture-guidance';
import type {ScanRecord} from '../types';

const record={id:'11111111-1111-4111-8111-111111111111',target:'item',createdAt:'2026-10-20T12:00:00.000Z',platform:'ios',method:'arkit_scene_depth',completedPasses:3,modelStoredLocally:true,
  geometry:{format:'ply_point_cloud',units:'metres',coordinateFrame:'capture_local_right_handed',pointCount:384,envelope:{method:'oriented_surface_envelope_v1',basis:'principal_components',paddingMm:2.5}},
  quality:{depthFrames:6,viewCount:3,confidenceThreshold:1,confidenceKind:'arkit_high_category',pointLimitReached:false,voxelSizeMm:5}};
const value={record,dimensionsMm:{length:405,width:205,height:105},warnings:['The high-category flag is not a probability.']};

describe('iOS depth result boundary',()=>{
  it('retains native categorical-confidence and oriented-envelope provenance',()=>{
    const result=parseScanResult(value,'item');
    expect(result.record.method).toBe('arkit_scene_depth');
    expect(result.record.quality?.confidenceKind).toBe('arkit_high_category');
    expect(result.record.dimensionsEstimateMm).toEqual(value.dimensionsMm);
    expect(result.warnings).toEqual(value.warnings);
    expect(captureGuidanceNotes(result.record).join(' ')).toMatch(/not a calibrated probability/);
    expect(captureGuidanceNotes(result.record).join(' ')).toMatch(/6 depth frames and 3 separated camera viewpoints/);
  });
  it('refuses sensor/method reuse and contradictory native diagnostics',()=>{
    const invalid=[{...record,platform:'android'},{...record,id:'other'},{...record,geometry:undefined},{...record,quality:undefined},
      {...record,quality:{...record.quality,confidenceKind:undefined}}, {...record,quality:{...record.quality,confidenceKind:'probability'}},
      {...record,quality:{...record.quality,confidenceThreshold:.9}}, {...record,quality:{...record.quality,pointLimitReached:undefined}},
      {...record,quality:{...record.quality,pointLimitReached:true}}, {...record,quality:{...record.quality,depthFrames:5}},
      {...record,quality:{...record.quality,depthFrames:12001}}, {...record,quality:{...record.quality,viewCount:7}},
      {...record,completedPasses:2}, {...record,geometry:{...record.geometry,pointCount:299}},
      {...record,geometry:{...record.geometry,envelope:undefined}}, {...record,quality:{...record.quality,coverage:{method:'camera_depth_guidance_v1'}}},
      {...record,geometry:{...record.geometry,pointCount:60001}}];
    for(const bad of invalid)expect(()=>parseScanResult({...value,record:bad},'item')).toThrow();
    expect(()=>parseScanResult({...value,record:{...record,method:'guided_object_capture'}},'item')).toThrow();
    expect(()=>parseScanResult({...value,dimensionsMm:{length:10001,width:205,height:105}},'item')).toThrow(/dimensions/);
  });
  it('accepts a reached cap only at the declared native point limit',()=>{
    const capped={...record,geometry:{...record.geometry,pointCount:60000},quality:{...record.quality,pointLimitReached:true}};
    expect(parseScanResult({...value,record:capped},'item').record.quality?.pointLimitReached).toBe(true);
    expect(captureGuidanceNotes({...record,quality:{...record.quality,viewCount:undefined}} as unknown as ScanRecord)).toEqual([expect.stringMatching(/invalid/)]);
  });
});
