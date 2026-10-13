import { describe,expect,it } from 'vitest';
import { parseReconstructedSolid,voxelSurface,type ReconstructedSolid } from './reconstructed-solid';
import type { SavedGeometryPreview } from './saved-geometry';

const hash='a'.repeat(64),id='00000000-0000-4000-8000-000000000001';
function fixture(shape=(x:number,y:number,z:number)=>x>=0&&x<6&&y>=0&&y<6&&z>=0&&z<6,grid={x:6,y:6,z:6}) {
  const cells:number[]=[],dirs=[[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];let observed=0,faces=0;
  for(let z=0;z<grid.z;z++)for(let y=0;y<grid.y;y++)for(let x=0;x<grid.x;x++)if(shape(x,y,z)){
    cells.push(x+grid.x*(y+grid.y*z));const exposed=dirs.filter(d=>!shape(x+d[0],y+d[1],z+d[2])).length;
    if(exposed)observed++;faces+=exposed;
  }
  const dimensionsMm={length:grid.x*10,width:grid.y*10,height:grid.z*10};
  const source:SavedGeometryPreview={id,target:'item',format:'point_cloud_preview',units:'millimetres',sourceHash:hash,pointCount:3000,samplePointCount:1,pointsMm:[5,5,5,.9],envelope:{method:'oriented_surface_envelope_v1',basis:'capture_aligned',paddingMm:2.5,dimensionsMm}};
  const solid:ReconstructedSolid={id,target:'item',format:'voxel_solid_v1',units:'millimetres',sourceHash:hash,sourcePointCount:3000,method:'observed_voxel_shell_fill_v1',resolutionMm:10,grid,dimensionsMm,occupiedCells:cells,observedCellCount:observed,enclosedCellCount:cells.length-observed,surfaceFaceCount:faces,warnings:['Synthetic contract fixture; not physical capture']};
  return {source,solid};
}
describe('reconstructed solid boundary',()=>{
  it('builds a closed outward surface with exact analytic volume and no internal faces',()=>{
    const {source,solid}=fixture(),before=structuredClone(solid),result=parseReconstructedSolid(solid,source);
    expect(result.surface.faceCount).toBe(216);expect(result.surface.triangles.length).toBe(216*6);expect(result.surface.volumeMm3).toBe(216000);expect(solid).toEqual(before);
    expect(result.surface.verticesMm.every(v=>v>=0&&v<=60)).toBe(true);
  });
  it('preserves a U concavity and its volume instead of emitting its rectangular envelope',()=>{
    const shape=(x:number,y:number,z:number)=>x>=0&&x<12&&y>=0&&y<10&&z>=0&&z<6&&(x<4||x>=8||y<3);
    const {source,solid}=fixture(shape,{x:12,y:10,z:6}),result=parseReconstructedSolid(solid,source);
    expect(result.surface.volumeMm3).toBe(552000);expect(solid.occupiedCells.includes(5+12*(5+10*3))).toBe(false);
    expect(result.surface.volumeMm3).toBeLessThan(120*100*60);
  });
  it('binds the reconstruction to exact source identity, target, hash, point count and envelope',()=>{
    const {source,solid}=fixture();
    for(const patch of [{id:'other'},{target:'container_interior'},{sourceHash:'b'.repeat(64)},{sourcePointCount:2999},{units:'metres'},{method:'unknown'}])expect(()=>parseReconstructedSolid({...solid,...patch},source)).toThrow();
    expect(()=>parseReconstructedSolid(solid,{...source,target:'container_interior'})).toThrow();
    expect(()=>parseReconstructedSolid(solid,{...source,envelope:{...source.envelope,dimensionsMm:{...source.envelope.dimensionsMm,length:61}}})).toThrow();
  });
  it('rejects malformed grid, duplicate/unsorted/out-of-range cells, volume counts and reports',()=>{
    const {source,solid}=fixture();
    for(const patch of [{grid:{x:47,y:6,z:6}},{resolutionMm:NaN},{enclosedCellCount:0},{surfaceFaceCount:1},{observedCellCount:1},{occupiedCells:[...solid.occupiedCells,99999]},{occupiedCells:[1,0,...solid.occupiedCells.slice(2)]},{occupiedCells:[0,0,...solid.occupiedCells.slice(2)]},{dimensionsMm:{length:61,width:60,height:60}}])expect(()=>parseReconstructedSolid({...solid,...patch},source)).toThrow();
  });
  it('independently rejects disconnected occupied components even if each surface is closed',()=>{
    const grid={x:15,y:6,z:6},shape=(x:number,y:number,z:number)=>y>=0&&y<6&&z>=0&&z<6&&((x>=0&&x<6)||(x>=9&&x<15));
    const {solid,source}=fixture(shape,grid);expect(()=>parseReconstructedSolid(solid,source)).toThrow();
  });
  it('rejects edge-only non-manifold contact in an otherwise face-connected component',()=>{
    // Missing diagonal columns touch along an edge while their surrounding solid stays connected.
    const grid={x:6,y:6,z:6},shape=(x:number,y:number,z:number)=>x>=0&&x<6&&y>=0&&y<6&&z>=0&&z<6&&!((x===2&&y===2)||(x===3&&y===3));
    const {solid}=fixture(shape,grid);expect(()=>voxelSurface(solid)).toThrow();
  });
  it('keeps every occupied cell and rejects resource bounds instead of truncating data',()=>{
    const {solid}=fixture();expect(()=>voxelSurface({...solid,grid:{x:1000,y:1000,z:1000}})).toThrow();
    expect(()=>voxelSurface({...solid,occupiedCells:[]})).toThrow();
    expect(voxelSurface(solid)).toEqual(voxelSurface(structuredClone(solid)));
  });
});
