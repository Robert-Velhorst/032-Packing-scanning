import {describe,it,expect} from 'vitest';
import {adoptInterior,confirmInteriorSupport,interiorGeometry,interiorKey,interiorTravelUp,packingInteriorError} from './packing-interior';
import {voxelSurface} from './scanning/reconstructed-solid';
import type {InteriorCavity} from './scanning/interior-cavity';
import {containerSpaceError,usableContainerVolume,fitsUsableContainer} from './container-space';
import {fitsGeometrySpace,geometryOrientations,hasVerticalEntry,orientationForRotation} from './packing-geometry';
import {createInitialData} from './seed';
import {buildPlan} from './optimizer';
import {uprightInstruction} from './upright';
import type {Container,Placement} from './types';
const at='2026-10-01T01:00:00.000Z';

function cavity(axis:0|1|2=2,sign:1|-1=1,blocked=(x:number,y:number,z:number)=>x>=4&&x<=5&&y>=4&&y<=5&&z>=1&&z<=3):InteriorCavity{
 const dims=[12,10,8],freeCells:number[]=[],observedCells:number[]=[];
 for(let z=0;z<8;z++)for(let y=0;y<10;y++)for(let x=0;x<12;x++){
  const xyz=[x,y,z],cell=x+12*(y+10*z),free=xyz.every((v,i)=>i===axis?(sign===1?v>0:v<dims[i]-1):v>0&&v<dims[i]-1)&&!blocked(x,y,z);
  (free?freeCells:observedCells).push(cell);
 }
 const grid={x:12,y:10,z:8},surface=voxelSurface({grid,resolutionMm:10,occupiedCells:freeCells});
 return {id:'00000000-0000-0000-0000-000000000001',target:'container_interior',format:'voxel_cavity_v1',units:'millimetres',sourceHash:'a'.repeat(64),sourcePointCount:8640,method:'seeded_observed_interior_v1',grid,
  boundsMm:{length:120,width:100,height:80},cellSizeMm:{length:10,width:10,height:10},seedMm:{x:85,y:55,z:45},opening:{axis,sign,planeMm:sign===1?[120,100,80][axis]:0,cells:freeCells.filter(cell=>[cell%12,Math.floor(cell/12)%10,Math.floor(cell/120)][axis]===(sign===1?dims[axis]-1:0))},
  freeCells,observedCells,wallCellCount:observedCells.length,surfaceFaceCount:surface.faceCount,estimatedVolumeMm3:surface.volumeMm3,warnings:['Synthetic open bag; physical fit unverified.']};
}
function fixture(dto=cavity()){
 const data=createInitialData(),bag=data.containers[0],item=data.libraryItems[0],trip=data.trips[0];
 const model=adoptInterior(dto,{axis:dto.opening.axis,sign:dto.opening.sign},1,at);
 bag.packingInterior=model;bag.inside={...interiorGeometry(model).dimensions};bag.opening={length:bag.inside.length,width:bag.inside.width};delete bag.unavailableSpaces;delete bag.lidClearanceMm;delete bag.lidClearanceEvidence;
 item.dimensions={length:40,width:40,height:30};item.keepUpright=true;item.fragile=false;delete item.packingShape;delete item.scan;delete item.maxTopLoadGrams;delete item.topLoadEvidence;item.massGrams=100;
 trip.containerIds=[bag.id];trip.entries=[trip.entries[0]];trip.entries[0].itemId=item.id;trip.entries[0].quantity=1;trip.lockedPlacements=[];trip.completedInstanceIds=[];trip.unavailableInstanceIds=[];trip.rejectedPlacements=[];trip.mode='balanced';
 return {bag,item,trip,model};
}
const pose=(bag:Container,x=0,y=0,z=0):Placement=>({instanceId:'e#1',entryId:'e',itemId:'i',containerId:bag.id,x,y,z,length:20,width:20,height:10,rotation:0,layer:1});
describe('adopted bag cavity',()=>{
 it('rebases without removing free cells and excludes exact intrusion volume',()=>{
  const {bag,model}=fixture(),geometry=interiorGeometry(model);
  expect(bag.inside).toEqual({length:100,width:80,height:70});expect(geometry.sourceOffsetMm).toEqual({x:10,y:10,z:10});expect(geometry.freeCells).toHaveLength(548);
  expect(geometry.blockedBoxes).toEqual([{x:30,y:30,z:0,length:20,width:20,height:30}]);expect(usableContainerVolume(bag)).toBe(548000);
  expect(packingInteriorError(bag)).toBeUndefined();expect(fitsUsableContainer({...pose(bag),x:30,y:30},bag)).toBe(false);expect(fitsGeometrySpace(pose(bag),bag)).toBe(true);
 });
 it('all six entry ends become the top using proper frames with the same cell volume',()=>{
  for(const axis of [0,1,2] as const)for(const sign of [-1,1] as const){
   const {model}=fixture(cavity(axis,sign,()=>false)),geometry=interiorGeometry(model);
   expect(interiorTravelUp(model)).toEqual({axis:2,sign:1});expect(geometry.surface.volumeMm3).toBe(model.cavity.estimatedVolumeMm3);
   expect(geometry.blockedBoxes).toEqual([]);expect(geometry.dimensions.height).toBe(([12,10,8][axis]-1)*10);
  }
 });
 it('keeps overlapping recorded regions and lid clearance out of cavity volume once',()=>{
  const {bag}=fixture(),evidence={source:'user_confirmed' as const,confidence:1,collectedAt:at};
  bag.unavailableSpaces=[{id:'1',name:'reserved',x:0,y:0,z:0,length:20,width:20,height:20,evidence},{id:'2',name:'overlap',x:10,y:0,z:0,length:20,width:20,height:20,evidence}];
  bag.lidClearanceMm=10;bag.lidClearanceEvidence=evidence;
  expect(usableContainerVolume(bag)).toBe(548000-12000-80000);
 });
 it('all modes avoid intrusions and do not use their tops as structural support',()=>{
  const {bag,item,trip}=fixture();
  for(const mode of ['balanced','maximum_capacity','easy_access','fragile_protection'] as const){
   const plan=buildPlan(trip,[item],[bag],mode);expect(plan.placements).toHaveLength(1);expect(fitsGeometrySpace(plan.placements[0],bag,item)).toBe(true);expect(plan.placements[0].interiorKey).toBe(interiorKey(bag.packingInterior));expect(plan.warnings.join(' ')).toContain('adopted estimated interior');
  }
  item.dimensions={length:100,width:80,height:10};
  expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(0);
 });
 it('rejects a free position beneath a cavity roof when straight-down entry crosses it',()=>{
  const {bag}=fixture(cavity(2,1,(x,_y,z)=>x>=4&&x<=6&&z===5)),placement={...pose(bag),x:30,y:20};
  expect(fitsGeometrySpace(placement,bag)).toBe(true);expect(hasVerticalEntry(placement,[],new Map(),bag)).toBe(false);expect(hasVerticalEntry({...placement,x:0},[],new Map(),bag)).toBe(true);
 });
 it('preserves locks and completion but pauses changes to scale source or handling',()=>{
  const {bag,item,trip,model}=fixture();const plan=buildPlan(trip,[item],[bag]);trip.lockedPlacements=[plan.placements[0]];trip.completedInstanceIds=[plan.placements[0].instanceId];const before=structuredClone(trip);
  expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(1);
  bag.packingInterior={...model,scale:2};bag.inside={...interiorGeometry(bag.packingInterior).dimensions};
  expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(0);expect(trip).toEqual(before);
  bag.packingInterior=undefined;expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(0);expect(trip).toEqual(before);
 });
 it('uses the separately reviewed travel top for upright orientations and printed care text',()=>{
  const {bag,item,trip,model}=fixture(cavity(2,1,()=>false));
  bag.packingInterior=confirmInteriorSupport({...model,travelUp:{axis:0,sign:1}},at);item.dimensions={length:40,width:30,height:90};
  const orientations=geometryOrientations(item,bag);expect(orientations.length).toBeGreaterThan(0);expect(orientations.every(o=>o.length===90)).toBe(true);
  for(const o of orientations)expect(orientationForRotation(item,o.rotation,bag)).toEqual(o);
  expect(orientationForRotation(item,0,bag)).toBeUndefined();expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(1);expect(uprightInstruction(item,bag)).toContain("bag's right end");
 });
 it('retains uniform scale and provenance in backups and rejects invalid persisted models without throwing',()=>{
  const {bag,item,trip,model}=fixture();const copy=JSON.parse(JSON.stringify(bag));expect(containerSpaceError(copy)).toBeUndefined();expect(interiorKey(copy.packingInterior)).toBe(interiorKey(model));
  copy.packingInterior=confirmInteriorSupport({...model,scale:2},at);copy.inside=interiorGeometry(copy.packingInterior).dimensions;expect(usableContainerVolume(copy)).toBe(548000*8);expect(copy.packingInterior.cavity).toEqual(model.cavity);
  for(const patch of [{scale:NaN},{travelUp:{axis:3,sign:1}},{evidence:{source:'measured',confidence:1,collectedAt:at}},{adoptedAt:2026}]){
   const broken={...bag,packingInterior:{...model,...patch}} as Container;expect(containerSpaceError(broken)).toBeTruthy();expect(buildPlan(trip,[item],[broken]).placements).toHaveLength(0);
   const packed=buildPlan(trip,[item],[bag]);trip.lockedPlacements=packed.placements;expect(()=>buildPlan(trip,[item],[broken])).not.toThrow();trip.lockedPlacements=[];
  }
 });
});
