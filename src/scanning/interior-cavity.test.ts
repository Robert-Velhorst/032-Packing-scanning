import {describe,it,expect} from 'vitest';
import {parseInteriorCavity,type InteriorCavity,type InteriorReview} from './interior-cavity.ts';
import {voxelSurface,parseReconstructedSolid} from './reconstructed-solid.ts';
import type {SavedGeometryPreview} from './saved-geometry.ts';

function fixture(){
 const source:SavedGeometryPreview={id:'00000000-0000-0000-0000-000000000001',target:'container_interior',format:'point_cloud_preview',units:'millimetres',sourceHash:'a'.repeat(64),pointCount:8640,samplePointCount:1,pointsMm:[5,5,5,.95],envelope:{method:'oriented_surface_envelope_v1',basis:'capture_aligned',paddingMm:2.5,dimensionsMm:{length:120,width:100,height:80}}};
 const review:InteriorReview={openingAxis:2,openingSign:1,seedMm:{x:85,y:55,z:45}},freeCells:number[]=[];
 for(let z=1;z<8;z++)for(let y=1;y<9;y++)for(let x=1;x<11;x++)freeCells.push(x+12*(y+10*z));
 const grid={x:12,y:10,z:8},surface=voxelSurface({grid,resolutionMm:10,occupiedCells:freeCells});
 const cells=new Set(freeCells),observedCells=Array.from({length:960},(_,i)=>i).filter(cell=>!cells.has(cell));
 const cavity:InteriorCavity={id:source.id,target:'container_interior',format:'voxel_cavity_v1',units:'millimetres',sourceHash:source.sourceHash,sourcePointCount:source.pointCount,method:'seeded_observed_interior_v1',grid,boundsMm:{...source.envelope.dimensionsMm},cellSizeMm:{length:10,width:10,height:10},seedMm:{...review.seedMm},opening:{axis:2,sign:1,planeMm:80,cells:freeCells.filter(c=>Math.floor(c/120)===7)},freeCells,observedCells,wallCellCount:400,surfaceFaceCount:surface.faceCount,estimatedVolumeMm3:560000,warnings:['Synthetic contract fixture; physical interior remains unverified.']};
 return {source,review,cavity};
}
describe('seeded interior contract',()=>{
 it('validates one reachable component and exposes a free-space surface without changing source data',()=>{
  const {source,review,cavity}=fixture(),before=structuredClone({source,review,cavity}),result=parseInteriorCavity(cavity,source,review);
  expect(result.surface.faceCount).toBe(412);expect(result.surface.volumeMm3).toBe(560000);expect(result.cavity.opening.cells).toHaveLength(80);expect({source,review,cavity}).toEqual(before);
  expect(()=>parseReconstructedSolid(cavity,source)).toThrow();
 });
 it('keeps anisotropic cell vertices inside exact nonintegral bounds',()=>{
  const {source,review,cavity}=fixture();source.envelope.dimensionsMm={length:117,width:93,height:77};cavity.boundsMm={...source.envelope.dimensionsMm};cavity.cellSizeMm={length:117/12,width:93/10,height:77/8};cavity.opening.planeMm=77;cavity.estimatedVolumeMm3=560*(117/12)*(93/10)*(77/8);
  const {surface}=parseInteriorCavity(cavity,source,review);expect(surface.volumeMm3).toBe(cavity.estimatedVolumeMm3);
  expect(Math.max(...surface.verticesMm.filter((_,i)=>i%3===2))).toBe(77);expect(surface.verticesMm.every((n,i)=>n>=0&&n<=[117,93,77][i%3])).toBe(true);
 });
 it('rejects stale source IDs hashes counts and item sources',()=>{
  for(const patch of [{id:'another-source'},{sourceHash:'b'.repeat(64)},{sourcePointCount:300},{target:'item'},{format:'voxel_solid_v1'}]){
   const {source,review,cavity}=fixture();expect(()=>parseInteriorCavity({...cavity,...patch},source,review)).toThrow();
  }
  const {source,review,cavity}=fixture();expect(()=>parseInteriorCavity(cavity,{...source,target:'item'},review)).toThrow();
 });
 it('rejects changed seed opening end or plane',()=>{
  const {source,review,cavity}=fixture();
  for(const patch of [{axis:0},{sign:-1},{planeMm:90},{cells:[]}])expect(()=>parseInteriorCavity({...cavity,opening:{...cavity.opening,...patch}},source,review)).toThrow();
  expect(()=>parseInteriorCavity({...cavity,seedMm:{x:25,y:55,z:45}},source,review)).toThrow();
  expect(()=>parseInteriorCavity(cavity,source,{...review,seedMm:{x:0,y:55,z:45}})).toThrow();
  expect(()=>parseInteriorCavity(cavity,source,{...review,openingSign:0} as unknown as InteriorReview)).toThrow();
 });
 it('rejects a seed outside the returned empty component',()=>{
  const {source,review,cavity}=fixture();review.seedMm={x:5,y:55,z:45};cavity.seedMm={...review.seedMm};expect(()=>parseInteriorCavity(cavity,source,review)).toThrow();
 });
 it('rejects duplicate unordered out-of-range and disconnected free cells',()=>{
  const {source,review,cavity}=fixture();
  for(const cells of [[...cavity.freeCells,cavity.freeCells[0]],[...cavity.freeCells].reverse(),[...cavity.freeCells,960],cavity.freeCells.filter(cell=>cell%12!==6)])expect(()=>parseInteriorCavity({...cavity,freeCells:cells},source,review)).toThrow();
 });
 it('rejects free cells reaching any unreviewed boundary',()=>{
  const {source,review,cavity}=fixture();const cells=[...cavity.freeCells,0+12*(5+10*4)].sort((a,b)=>a-b);
  expect(()=>parseInteriorCavity({...cavity,freeCells:cells,wallCellCount:399},source,review)).toThrow();
 });
 it('requires the exact opening cells topology volume grid and fitted spacing',()=>{
  const {source,review,cavity}=fixture();
  for(const patch of [{opening:{...cavity.opening,cells:cavity.opening.cells.slice(1)}},{surfaceFaceCount:410},{estimatedVolumeMm3:1},{cellSizeMm:{length:11,width:10,height:10}},{grid:{x:11,y:10,z:8}},{boundsMm:{length:121,width:100,height:80}},{wallCellCount:500},{warnings:['x'.repeat(601)]}])expect(()=>parseInteriorCavity({...cavity,...patch},source,review)).toThrow();
 });
 it('rejects malformed envelopes rather than allocating an unbounded lattice',()=>{
  const {source,review,cavity}=fixture();for(const length of [NaN,Infinity,0,10001])expect(()=>parseInteriorCavity(cavity,{...source,envelope:{...source.envelope,dimensionsMm:{length,width:100,height:80}}},review)).toThrow();
 });
 it('checks observed-cell identity against the source preview and rejects overlaps or fake wall masks',()=>{
  const {source,review,cavity}=fixture();
  for(const observedCells of [[...cavity.observedCells,cavity.observedCells[0]],[...cavity.observedCells].reverse(),cavity.observedCells.filter(cell=>cell!==0)])expect(()=>parseInteriorCavity({...cavity,observedCells,wallCellCount:observedCells.length},source,review)).toThrow();
  expect(()=>parseInteriorCavity(cavity,{...source,pointsMm:[85,55,45,.95]},review)).toThrow();
 });
 it('rejects a closed-looking subset of the seeded component even when its topology and volume match',()=>{
  const {source,review,cavity}=fixture();cavity.freeCells=cavity.freeCells.filter(cell=>cell%12>2);cavity.opening.cells=cavity.opening.cells.filter(cell=>cell%12>2);
  const surface=voxelSurface({grid:cavity.grid,resolutionMm:10,occupiedCells:cavity.freeCells});cavity.surfaceFaceCount=surface.faceCount;cavity.estimatedVolumeMm3=surface.volumeMm3;
  expect(()=>parseInteriorCavity(cavity,source,review)).toThrow();
 });
});
