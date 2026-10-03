import {describe,it,expect} from 'vitest';
import {confirmedUpright,uprightFaces,uprightInstruction,uprightRecordError} from './upright';
import {geometryOrientations,orientationForRotation,packingShapeError,placementSurface,shapeKey,shapeVolume} from './packing-geometry';
import {buildPlan} from './optimizer';
import type {Container,LibraryItem,PackingShape,Placement,Trip} from './types';
const at='2026-10-01T00:00:00Z',evidence={source:'estimated' as const,confidence:.5,collectedAt:at};
function fixture(){
 const dimensions={length:60,width:50,height:40},grid={x:6,y:5,z:4};
 const shape:PackingShape={sourceEnvelopeMm:dimensions,fittedDimensionsMm:dimensions,adoptedAt:at,solid:{id:'00000000-0000-4000-8000-000000000001',target:'item',format:'voxel_solid_v1',units:'millimetres',sourceHash:'a'.repeat(64),sourcePointCount:400,method:'observed_voxel_shell_fill_v1',resolutionMm:10,grid,dimensionsMm:dimensions,occupiedCells:Array.from({length:120},(_,i)=>i),observedCellCount:96,enclosedCellCount:24,surfaceFaceCount:148,warnings:['Analytic fixture.']}};
 const item:LibraryItem={id:'item',name:'fixture',category:'other',dimensions,dimensionEvidence:evidence,massGrams:10,keepUpright:true,packingShape:shape,fragile:false,flexibility:'rigid',createdAt:at,updatedAt:at};
 const bag:Container={id:'bag',name:'bag',kind:'other',inside:{length:70,width:70,height:70},opening:{length:70,width:70},insideEvidence:evidence,travellerIds:[],createdAt:at};
 const trip:Trip={id:'trip',name:'trip',destination:'',packingOnly:true,sample:false,travellers:[{id:'person',name:'person'}],containerIds:['bag'],entries:[{id:'entry',itemId:'item',travellerId:'person',quantity:1,priority:'required',required:true,accessPriority:1}],mode:'balanced',completedInstanceIds:[],unavailableInstanceIds:[],lockedPlacements:[],carrierRules:[],createdAt:at,updatedAt:at};
 return {shape,item,bag,trip};
}
function pose(orientation:ReturnType<typeof geometryOrientations>[number]):Placement{return {instanceId:'entry#1',itemId:'item',entryId:'entry',containerId:'bag',x:0,y:0,z:0,...orientation,layer:1};}
describe('reviewed upright direction',()=>{
 it.each(uprightFaces)('keeps source end $letter upward in exactly four proper rotations',face=>{
  const {shape,item}=fixture(),original=structuredClone(shape),base=placementSurface(pose({length:60,width:50,height:40,rotation:0}),item)!;
  const axis=['length','width','height'].indexOf(face.axis),sourceFace=face.sign>0?shape.fittedDimensionsMm[face.axis]:0;
  shape.upright=confirmedUpright(shape,face,at);const rotations=geometryOrientations(item);expect(rotations).toHaveLength(4);
  for(const rotation of rotations){expect(orientationForRotation(item,rotation.rotation)).toEqual(rotation);const surface=placementSurface(pose(rotation),item)!;
   for(let i=0;i<base.verticesMm.length;i+=3)if(Math.abs(base.verticesMm[i+axis]-sourceFace)<1e-6)expect(surface.verticesMm[i+2]).toBeCloseTo(rotation.height,8);
   expect(surface.volumeMm3).toBe(120000);
  }
  expect(shape.solid).toEqual(original.solid);expect(shape.fittedDimensionsMm).toEqual(original.fittedDimensionsMm);
  expect(geometryOrientations({...item,keepUpright:false})).toHaveLength(24);
 });
 it('fits a side-captured object only after its real length end is confirmed upward',()=>{
  const {shape,item,bag,trip}=fixture();bag.inside={length:50,width:40,height:60};bag.opening={length:50,width:40};
  expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(0);
  shape.upright=confirmedUpright(shape,uprightFaces[0],at);const plan=buildPlan(trip,[item],[bag]);expect(plan.placements).toHaveLength(1);expect(plan.placements[0].height).toBe(60);expect(uprightInstruction(item)).toContain('face A');
 });
 it('retains legacy height-axis plans with a visible unreviewed-direction warning',()=>{
  const {item,bag,trip}=fixture(),plan=buildPlan(trip,[item],[bag]);expect(plan.placements).toHaveLength(1);expect(plan.warnings.join(' ')).toContain('no reviewed top direction');expect(uprightInstruction(item)).toContain('not been reviewed');
 });
 it('rejects stale source identity and malformed directions rather than silently selecting a default',()=>{
  const {shape,item}=fixture();shape.upright=confirmedUpright(shape,uprightFaces[4],at);
  for(const change of [{axis:'other'},{sign:0},{sourceHash:'b'.repeat(64)},{captureId:'another-source'},{evidence:{source:'measured',confidence:1,collectedAt:at}},{evidence:{source:'user_confirmed',confidence:NaN,collectedAt:at}},{evidence:{source:'user_confirmed',confidence:1,collectedAt:2026}}]){
   const broken={...shape,upright:{...shape.upright,...change}} as PackingShape;expect(uprightRecordError(broken)).toBeTruthy();expect(packingShapeError({...item,packingShape:broken})).toContain('upright direction');
  }
 });
 it('preserves valid packed poses when the same top is confirmed, and pauses incompatible changed tops without changing records',()=>{
  const {shape,item,bag,trip}=fixture(),placement=buildPlan(trip,[item],[bag]).placements[0];trip.lockedPlacements=[placement];trip.completedInstanceIds=[placement.instanceId];const before=structuredClone(trip),key=shapeKey(shape);
  shape.upright=confirmedUpright(shape,uprightFaces[4],at);expect(shapeKey(shape)).toBe(key);expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(1);
  shape.upright=confirmedUpright(shape,uprightFaces[5],at);expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(0);expect(trip).toEqual(before);
 });
 it('retains the direction through uniform calibration, backup serialization and disabled upright handling',()=>{
  const {shape,item}=fixture();shape.upright=confirmedUpright(shape,uprightFaces[3],at);const calibrated=structuredClone(shape);
  calibrated.fittedDimensionsMm={length:120,width:100,height:80};const updated={...item,dimensions:calibrated.fittedDimensionsMm,packingShape:calibrated};
  expect(packingShapeError(updated)).toBeUndefined();expect(calibrated.upright).toEqual(shape.upright);expect(shapeVolume(calibrated)).toBe(960000);
  expect(JSON.parse(JSON.stringify(calibrated)).upright).toEqual(shape.upright);expect(uprightInstruction({...updated,keepUpright:false})).toBe('');
 });
});
