import { describe, expect, it } from 'vitest';
import { parseSavedGeometry, type SavedGeometryPreview } from './saved-geometry';

const id='12345678-1234-1234-1234-123456789abc';
const dimensions={length:105,width:65,height:35};
const source={id,target:'item' as const,dimensionsEstimateMm:dimensions};
function fixture():SavedGeometryPreview {
  return {id,target:'item',format:'point_cloud_preview',units:'millimetres',sourceHash:'a'.repeat(64),pointCount:4,samplePointCount:4,
    pointsMm:[2.5,2.5,2.5,.8,102.5,2.5,2.5,.9,2.5,62.5,2.5,.9,2.5,2.5,32.5,1],
    envelope:{method:'oriented_surface_envelope_v1',basis:'principal_components',paddingMm:2.5,dimensionsMm:dimensions}};
}
describe('saved surface preview boundary',()=>{
  it('keeps original source dimensions and points for calibrated or manually edited records',()=>{
    const value=fixture(),before=JSON.stringify(value);
    expect(parseSavedGeometry(value,{...source,dimensionsEstimateMm:{...dimensions}})).toEqual(value);
    expect(JSON.stringify(value)).toBe(before);
  });
  it('rejects another capture, another target, altered source dimensions and invalid provenance',()=>{
    expect(()=>parseSavedGeometry(fixture(),{...source,dimensionsEstimateMm:{...dimensions,length:NaN}})).toThrow('inconsistent source');
    for(const change of [{id:'different'},{target:'container_interior'},{sourceHash:'../private/path'},{units:'metres'},
      {envelope:{...fixture().envelope,dimensionsMm:{...dimensions,length:200}}},
      {envelope:{...fixture().envelope,basis:'capture_aligned_legacy'}},
      {envelope:{...fixture().envelope,paddingMm:0}}]) {
      expect(()=>parseSavedGeometry({...fixture(),...change},source)).toThrow('inconsistent source');
    }
  });
  it('rejects truncated, excessive, non-finite or out-of-bounds points and weak confidence',()=>{
    const variants:unknown[]=[{...fixture(),pointCount:60001},{...fixture(),samplePointCount:8001},{...fixture(),pointCount:3},
      {...fixture(),pointsMm:[1,2,3,.9]}, {...fixture(),samplePointCount:5}];
    for(const [index,value] of [[0,-1],[1,66],[2,Infinity],[3,.79],[3,1.01],[7,NaN]]) {
      const modified=fixture();modified.pointsMm[index]=value;variants.push(modified);
    }
    for(const value of variants)expect(()=>parseSavedGeometry(value,source)).toThrow('inconsistent source');
  });
  it('keeps an older camera-aligned envelope without adding a new margin',()=>{
    const value=fixture();value.envelope={method:'capture_aligned_legacy',basis:'capture_aligned_legacy',paddingMm:0,dimensionsMm:dimensions};
    expect(parseSavedGeometry(value,source).envelope.paddingMm).toBe(0);
    expect(()=>parseSavedGeometry({...value,envelope:{...value.envelope,paddingMm:2.5}},source)).toThrow('inconsistent source');
  });
});
