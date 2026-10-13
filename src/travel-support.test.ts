import {describe,it,expect} from 'vitest';
import {adoptInterior,confirmInteriorSupport,interiorGeometry,interiorKey,interiorSupportError,packingInteriorError} from './packing-interior';
import {gravityBox,geometryContactArea,geometrySupportArea,hasGeometrySupport,hasPackingAndTravelSupport} from './packing-geometry';
import {voxelSurface} from './scanning/reconstructed-solid';
import type {InteriorCavity} from './scanning/interior-cavity';
import {assessStackLoads} from './stack-load';
import {createInitialData} from './seed';
import {buildPlan} from './optimizer';
import type {LibraryItem,PackingShape,Placement,PlanItem} from './types';
const at='2026-10-01T01:00:00Z',evidence={source:'user_confirmed' as const,confidence:1,collectedAt:at};
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
function customShape(grid:{x:number;y:number;z:number},mask:(x:number,y:number,z:number)=>boolean):PackingShape {
 const inside=(x:number,y:number,z:number)=>x>=0&&x<grid.x&&y>=0&&y<grid.y&&z>=0&&z<grid.z&&mask(x,y,z);
 const occupiedCells:number[]=[],dirs=[[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];let observed=0,faces=0;
 for(let z=0;z<grid.z;z++)for(let y=0;y<grid.y;y++)for(let x=0;x<grid.x;x++)if(inside(x,y,z)){occupiedCells.push(x+grid.x*(y+grid.y*z));const count=dirs.filter(d=>!inside(x+d[0],y+d[1],z+d[2])).length;faces+=count;if(count)observed++;}
 const dimensionsMm={length:grid.x*10,width:grid.y*10,height:grid.z*10};
 return {adoptedAt:at,sourceEnvelopeMm:dimensionsMm,fittedDimensionsMm:dimensionsMm,solid:{id:'00000000-0000-4000-8000-000000000001',target:'item',format:'voxel_solid_v1',units:'millimetres',sourceHash:'a'.repeat(64),sourcePointCount:3000,method:'observed_voxel_shell_fill_v1',resolutionMm:10,grid,dimensionsMm,occupiedCells,observedCellCount:observed,enclosedCellCount:occupiedCells.length-observed,surfaceFaceCount:faces,warnings:['Synthetic analytic shape.']}};
}

const p=(id:string,patch:Partial<Placement>={}):Placement=>({instanceId:id+'#1',itemId:id,entryId:id,containerId:'bag',x:0,y:0,z:0,length:20,width:30,height:40,rotation:0,layer:1,...patch});
function item(id:string,patch:Partial<LibraryItem>={}):LibraryItem{return {id,name:id,category:'other',dimensions:{length:20,width:30,height:40},dimensionEvidence:evidence,massGrams:100,flexibility:'rigid',fragile:false,keepUpright:false,createdAt:at,updatedAt:at,...patch};}
function records(items:LibraryItem[]):Map<string,PlanItem>{return new Map(items.map(i=>[i.id+'#1',{...i,instanceId:i.id+'#1',itemId:i.id,entryId:i.id,travellerId:'person',volumeMm3:1,upperMassGrams:i.massGrams,priority:'required',required:true,accessPriority:1}]))}
function bag(up:{axis:0|1|2;sign:1|-1}={axis:0,sign:1}){const b=structuredClone(createInitialData().containers[0]);b.id='bag';b.packingInterior=adoptInterior(cavity(2,1,()=>false),up,1,at);b.inside=interiorGeometry(b.packingInterior).dimensions;b.opening={length:b.inside.length,width:b.inside.width};delete b.unavailableSpaces;delete b.lidClearanceMm;delete b.lidClearanceEvidence;return b;}
describe('packing and travel gravity',()=>{
 it('retains exact face area, direction and volume for all six signed axes',()=>{
  const a=p('a'),sides=[20,30,40],coords=['x','y','z'] as const;
  for(const axis of [0,1,2])for(const sign of [-1,1]){
   const b=p('b',{[coords[axis]]:sides[axis]}),up={axis,sign},upper=sign===1?b:a,lower=sign===1?a:b;
   expect(geometryContactArea(upper,lower,new Map(),up)).toBe(24000/sides[axis]);
   expect(geometrySupportArea(upper,lower,new Map(),up)).toBe(24000/sides[axis]);
   expect(geometryContactArea(lower,upper,new Map(),up)).toBe(0);
   expect(geometryContactArea(upper,{...lower,containerId:'elsewhere'},new Map(),up)).toBe(0);
   const moved={...upper,[coords[axis]]:upper[coords[axis]]+sign};
   expect(geometryContactArea(moved,lower,new Map(),up)).toBe(0);
   const rotated=gravityBox({...a,x:7,y:11,z:13},up);expect(rotated.length*rotated.width*rotated.height).toBe(24000);
  }
 });
 it('uses the opposite closed wall for negative travel gravity and never an intrusion top',()=>{
  const b=bag({axis:0,sign:-1}),base=p('base',{x:80,z:0});
  expect(hasPackingAndTravelSupport(base,[],new Map(),1,b)).toBe(true);
  expect(hasPackingAndTravelSupport({...base,x:79},[],new Map(),1,b)).toBe(false);
  b.unavailableSpaces=[{id:'intrusion',name:'intrusion',x:70,y:0,z:0,length:10,width:30,height:40,evidence}];
  expect(hasPackingAndTravelSupport({...base,x:50},[],new Map(),1,b)).toBe(false);
  expect(hasGeometrySupport({...base,z:1},[],new Map(),1)).toBe(false);
 });
 it('uses each reviewed compartment floor and closed travel wall in all side directions',()=>{
  for(const axis of [0,1] as const)for(const sign of [-1,1] as const){const b=bag({axis,sign});b.packingInterior=confirmInteriorSupport(b.packingInterior!,at);b.compartments=[{id:'raised',name:'Raised pocket',x:20,y:10,z:10,length:50,width:50,height:40,opening:{length:50,width:50},evidence,supportEvidence:evidence}];
   const base=p('base',{x:20,y:10,z:10,compartmentId:'raised'}),coordinate=axis===0?'x':'y',end=axis===0?70:60,size=axis===0?base.length:base.width;
   if(sign===-1)base[coordinate]=end-size;
   expect(hasPackingAndTravelSupport(base,[],new Map(),1,b)).toBe(true);
   expect(hasPackingAndTravelSupport({...base,[coordinate]:base[coordinate]+sign},[],new Map(),1,b)).toBe(false);
   expect(hasPackingAndTravelSupport({...base,z:11},[],new Map(),1,b)).toBe(false);
  }
 });
 it('requires actual travel support even when an item rests on the packing floor',()=>{
  const b=bag(),lower=p('lower'),upper=p('upper',{x:20});
  expect(hasPackingAndTravelSupport(upper,[],new Map(),1,b)).toBe(false);
  expect(hasPackingAndTravelSupport(upper,[lower],new Map(),1,b)).toBe(true);
  expect(hasPackingAndTravelSupport(upper,[{...lower,width:20}],new Map(),1,b)).toBe(false);
  expect(hasPackingAndTravelSupport(upper,[{...lower,width:20}],new Map(),.65,b)).toBe(true);
 });
 it('requires review for legacy side-up records while retaining the legacy opening-up floor assumption',()=>{
  const b=bag();b.packingInterior={...b.packingInterior!,supportReview:undefined};
  expect(packingInteriorError(b)).toBeUndefined();expect(interiorSupportError(b.packingInterior)).toContain('Review');
  expect(hasPackingAndTravelSupport(p('a'),[],new Map(),1,b)).toBe(false);
  const key=interiorKey(b.packingInterior);b.packingInterior=confirmInteriorSupport(b.packingInterior,at);
  expect(interiorKey(b.packingInterior)).toBe(key);expect(hasPackingAndTravelSupport(p('a'),[],new Map(),1,b)).toBe(true);
  const upright=bag({axis:2,sign:1});upright.packingInterior={...upright.packingInterior!,supportReview:undefined};expect(interiorSupportError(upright.packingInterior)).toBeUndefined();
 });
 it('never confirms the virtual opening cap as a load-bearing lid',()=>{
  const model={...bag().packingInterior!,travelUp:{axis:2 as const,sign:-1 as const},supportReview:undefined};
  expect(interiorSupportError(model)).toContain('not an observed supporting lid');expect(()=>confirmInteriorSupport(model,at)).toThrow('not an observed supporting lid');
 });
 it('binds support review to exact source scale and travel end, preserving the original model',()=>{
  const b=bag(),original=structuredClone(b);
  for(const patch of [{scale:2},{travelUp:{axis:1 as const,sign:1 as const}},{cavity:{...b.packingInterior!.cavity,sourceHash:'b'.repeat(64)}}]){
   const model={...b.packingInterior!,...patch},changed={...b,packingInterior:model,inside:interiorGeometry(model).dimensions};expect(packingInteriorError(changed)).toBeDefined();
   const reviewed=confirmInteriorSupport({...model,supportReview:undefined},at);expect(packingInteriorError({...changed,packingInterior:reviewed})).toBeUndefined();
  }
  expect(b).toEqual(original);
 });
 it('keeps load graphs separate between packing and travel snapshots',()=>{
  const b=bag(),placements=[p('a'),p('b',{x:20}),p('c',{x:20,z:40})],map=records([item('a'),item('b'),item('c',{massGrams:250})]);
  const checks=assessStackLoads(placements,map,[b]);
  expect(checks.filter(c=>!c.orientation).map(c=>c.upperLoadGrams)).toEqual([0,250,0]);
  expect(checks.filter(c=>c.orientation==='travel').map(c=>c.upperLoadGrams)).toEqual([100,0,0]);
  expect(checks.find(c=>c.instanceId==='a#1'&&c.orientation==='travel')!.aboveInstanceIds).toEqual(['b#1']);
 });
 it('counts full transitively supported travel weight and rejects limits, unknown weights and fragile supporters',()=>{
  const placements=[p('a'),p('b',{x:20}),p('c',{x:40})],b=bag();
  for(const patch of [{maxTopLoadGrams:199,topLoadEvidence:evidence},{fragile:true}]){
   const checks=assessStackLoads(placements,records([item('a',patch),item('b'),item('c')]),[b]);
   expect(checks.find(c=>c.instanceId==='a#1'&&c.orientation==='travel')).toMatchObject({upperLoadGrams:200,status:'conflict',aboveInstanceIds:['b#1','c#1']});
   expect(checks.find(c=>c.instanceId==='a#1'&&!c.orientation)!.status).toBe('clear');
  }
  const map=records([item('a',{maxTopLoadGrams:200,topLoadEvidence:evidence}),item('b'),item('c')]);
  expect(assessStackLoads(placements,map,[b]).find(c=>c.instanceId==='a#1'&&c.orientation==='travel')!.status).toBe('within_recorded_limit');
  map.get('c#1')!.upperMassGrams=undefined;expect(assessStackLoads(placements,map,[b]).find(c=>c.instanceId==='a#1'&&c.orientation==='travel')).toMatchObject({status:'conflict',unknownMassCount:1});
 });
 it('does not invent support across an occupied-shape recess; includes actual interior contacts',()=>{
  const s=customShape({x:6,y:6,z:6},(x,y)=>y<2||y>=4||x>=4),arch=item('arch',{dimensions:s.fittedDimensionsMm,packingShape:s}),a=p('arch',{length:60,width:60,height:60}),small=p('small',{x:20,y:20,length:20,width:20,height:60}),map=records([arch,item('small')]);
  expect(geometryContactArea(a,small,map,{axis:0,sign:1})).toBe(1200);
  expect(geometrySupportArea(a,small,map,{axis:0,sign:1})).toBe(0);
  expect(geometryContactArea({...small,x:0,length:40},a,map,{axis:0,sign:1})).toBe(0);
  expect(geometryContactArea(small,a,map,{axis:0,sign:-1})).toBe(1200);
 });
 it('pauses unsupported or overloaded saved travel positions in every mode without moving raw packed records',()=>{
  const b=bag(),data=createInitialData(),trip=data.trips[0],items=[item('a',{dimensions:{length:20,width:30,height:40},fragile:true}),item('b')];
  trip.containerIds=['bag'];trip.entries=items.map(i=>({id:i.id,itemId:i.id,travellerId:trip.travellers[0].id,quantity:1,priority:'required',required:true,accessPriority:1}));
  trip.lockedPlacements=[p('a',{interiorKey:interiorKey(b.packingInterior)}),p('b',{x:20,interiorKey:interiorKey(b.packingInterior)})];trip.completedInstanceIds=['a#1','b#1'];const before=structuredClone(trip);
  for(const mode of ['balanced','maximum_capacity','easy_access','fragile_protection'] as const){expect(buildPlan(trip,items,[b],mode).placements).toHaveLength(0);expect(trip).toEqual(before);}
  items[0].fragile=false;expect(buildPlan(trip,items,[b]).placements).toHaveLength(2);
  trip.lockedPlacements=[p('a',{x:1,interiorKey:interiorKey(b.packingInterior)})];trip.completedInstanceIds=['a#1'];const unsupported=structuredClone(trip);
  expect(buildPlan(trip,items,[b]).placements).toHaveLength(0);expect(trip).toEqual(unsupported);
 });
 it('rejects cyclic exposed-face load paths under both signs of travel gravity',()=>{
  const aShape=customShape({x:6,y:10,z:12},(x,y,z)=>z<4||z>=8||y<3||(y>=8&&x>=4));
  const bShape=customShape({x:8,y:7,z:8},(x,y,z)=>z>=4&&(y<5||x<4)||z<4&&y<5&&x>=6);
  const a=p('a',{length:60,width:100,height:120}),b=p('b',{y:30,length:80,width:70,height:80});
  const map=records([item('a',{dimensions:aShape.fittedDimensionsMm,packingShape:aShape}),item('b',{dimensions:bShape.fittedDimensionsMm,packingShape:bShape})]);
  for(const sign of [-1,1] as const){
   expect(geometryContactArea(a,b,map,{axis:0,sign})).toBeGreaterThan(0);expect(geometryContactArea(b,a,map,{axis:0,sign})).toBeGreaterThan(0);
   expect(assessStackLoads([a,b],map,[bag({axis:0,sign})]).filter(c=>c.orientation==='travel').every(c=>c.status==='conflict'&&c.reason?.includes('cyclic'))).toBe(true);
  }
 });
});
