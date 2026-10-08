import {describe,it,expect} from 'vitest';
import {buildPlan} from './optimizer';
import {assessStackLoads} from './stack-load';
import {orderPackingSteps} from './packing-sequence';
import {boxesIntersect,geometryContactArea,geometryIntersects,geometryOrientations,geometrySupportArea,hasVerticalEntry,packingShapeError,placementBoxes,placementSurface,shapeDimensions,shapeKey,shapeVolume} from './packing-geometry';
import type {Container,LibraryItem,PackingShape,Placement,PlanItem,Trip} from './types';
const date='2026-10-01T00:00:00Z',evidence={source:'estimated' as const,confidence:.5,collectedAt:date};
function shape(portal=false):PackingShape {
 const grid={x:12,y:10,z:6},inside=(x:number,y:number,z:number)=>x>=0&&x<12&&y>=0&&y<10&&z>=0&&z<6&&(x<4||x>=8||(portal?z>=4:y<3));
 return customShape(grid,inside);
}
function customShape(grid:{x:number;y:number;z:number},mask:(x:number,y:number,z:number)=>boolean):PackingShape {
 const inside=(x:number,y:number,z:number)=>x>=0&&x<grid.x&&y>=0&&y<grid.y&&z>=0&&z<grid.z&&mask(x,y,z);
 const occupiedCells:number[]=[],dirs=[[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];let observed=0,faces=0;
 for(let z=0;z<grid.z;z++)for(let y=0;y<grid.y;y++)for(let x=0;x<grid.x;x++)if(inside(x,y,z)){occupiedCells.push(x+grid.x*(y+grid.y*z));const count=dirs.filter(d=>!inside(x+d[0],y+d[1],z+d[2])).length;faces+=count;if(count)observed++;}
 const dimensionsMm={length:grid.x*10,width:grid.y*10,height:grid.z*10};
 return {adoptedAt:date,sourceEnvelopeMm:dimensionsMm,fittedDimensionsMm:dimensionsMm,solid:{id:'00000000-0000-4000-8000-000000000001',target:'item',format:'voxel_solid_v1',units:'millimetres',sourceHash:'a'.repeat(64),sourcePointCount:3000,method:'observed_voxel_shell_fill_v1',resolutionMm:10,grid,dimensionsMm,occupiedCells,observedCellCount:observed,enclosedCellCount:occupiedCells.length-observed,surfaceFaceCount:faces,warnings:['Synthetic analytic shape.']}};
}
function item(id:string,dimensions={length:40,width:60,height:60},packingShape?:PackingShape):LibraryItem{return {id,name:id,category:'other',dimensions,dimensionEvidence:evidence,massGrams:id==='U'?100:10,flexibility:'rigid',fragile:false,keepUpright:true,packingShape,createdAt:date,updatedAt:date};}
const bag:Container={id:'bag',name:'bag',kind:'other',inside:{length:120,width:100,height:60},opening:{length:120,width:100},insideEvidence:evidence,travellerIds:[],createdAt:date};
function trip(items:LibraryItem[]):Trip{return {id:'trip',name:'trip',destination:'',packingOnly:true,sample:false,travellers:[{id:'person',name:'person'}],containerIds:['bag'],entries:items.map(i=>({id:i.id,itemId:i.id,travellerId:'person',quantity:1,priority:'required',required:true,accessPriority:1})),mode:'balanced',completedInstanceIds:[],unavailableInstanceIds:[],lockedPlacements:[],carrierRules:[],createdAt:date,updatedAt:date};}
function placement(id:string,patch:Partial<Placement>={}):Placement{return {instanceId:id+'#1',entryId:id,itemId:id,containerId:'bag',x:0,y:0,z:0,length:120,width:100,height:60,rotation:0,layer:1,...patch};}
describe('adopted occupied-cell planning',()=>{
 it('preserves every cell with disjoint exact cuboids and lower occupied volume',()=>{
  const s=shape(),p=placement('U'),boxes=placementBoxes(p,{packingShape:s});
  expect(boxes.reduce((v,b)=>v+b.length*b.width*b.height,0)).toBe(552000);expect(shapeVolume(s)).toBe(552000);
  expect(boxes.every((b,i)=>boxes.slice(i+1).every(other=>!boxesIntersect(b,other)))).toBe(true);
  expect(geometryIntersects(p,placement('small',{x:40,y:40,length:40,width:60}),new Map([['U#1',{packingShape:s}]]))).toBe(false);
 });
 it('uses 24 proper rotations, four upright rotations, and outward volume without mirroring',()=>{
  const s=shape(),i=item('U',s.fittedDimensionsMm,s),all=geometryOrientations({...i,keepUpright:false});expect(all).toHaveLength(24);expect(geometryOrientations(i)).toHaveLength(4);
  for(const o of all){const surface=placementSurface(placement('U',{...o}),i)!;let volume=0;const v=surface.verticesMm;
   for(let n=0;n<surface.triangles.length;n+=3){const [a,b,c]=surface.triangles.slice(n,n+3).map(index=>index*3);volume+=(v[a]*(v[b+1]*v[c+2]-v[b+2]*v[c+1])+v[a+1]*(v[b+2]*v[c]-v[b]*v[c+2])+v[a+2]*(v[b]*v[c+1]-v[b+1]*v[c]))/6;}
   expect(volume).toBeCloseTo(552000,5);expect(surface.verticesMm.every(Number.isFinite)).toBe(true);
  }
 });
 it('retains cell-rounding allowance under uniform scaling and rejects stale or distorted dimensions',()=>{
  const s=shape();s.sourceEnvelopeMm={length:118.4,width:98.4,height:58.4};s.fittedDimensionsMm={length:236.8,width:196.8,height:116.8};
  expect(packingShapeError(item('U',s.fittedDimensionsMm,s))).toBeUndefined();expect(shapeDimensions(s)).toEqual({length:240,width:200,height:120});expect(shapeVolume(s)).toBe(552000*8);
  expect(packingShapeError(item('U',{...s.fittedDimensionsMm,width:197},s))).toBeTruthy();
  const distorted=structuredClone(s);distorted.fittedDimensionsMm.width=197;expect(packingShapeError(item('U',distorted.fittedDimensionsMm,distorted))).toBeTruthy();
 });
 it('packs a rectangular item inside an open U recess in all four modes where bounding boxes alone cannot fit',()=>{
  const s=shape(),items=[item('U',s.fittedDimensionsMm,s),item('small')],t=trip(items),before=structuredClone(t);
  for(const mode of ['balanced','maximum_capacity','easy_access','fragile_protection'] as const){const plan=buildPlan(t,items,[bag],mode);expect(plan.placements).toHaveLength(2);expect(plan.excluded).toEqual([]);expect(plan.summaries[0].volumeUsedMm3).toBe(696000);
   const byId=new Map(plan.placements.map(p=>[p.instanceId,items.find(i=>i.id===p.itemId)!]));expect(geometryIntersects(plan.placements[0],plan.placements[1],byId)).toBe(false);
  }
  expect(buildPlan(t,items.map(i=>({...i,packingShape:undefined})),[bag]).placements).toHaveLength(1);expect(t).toEqual(before);
 });
 it('checks actual occupied cells against intrusions instead of excluding the entire envelope',()=>{
  const s=shape(),u=item('U',s.fittedDimensionsMm,s),restricted={...bag,unavailableSpaces:[{id:'void',name:'void',x:40,y:30,z:0,length:40,width:70,height:60,evidence}]};
  expect(buildPlan(trip([u]),[u],[restricted]).placements).toHaveLength(1);expect(buildPlan(trip([u]),[{...u,packingShape:undefined}],[restricted]).placements).toHaveLength(0);
 });
 it('does not invent support or upper stack load across an empty recess',()=>{
  const s=shape(),u={...item('U',s.fittedDimensionsMm,s),maxTopLoadGrams:0,topLoadEvidence:evidence},upper=placement('small',{x:40,y:40,z:60,length:40,width:60}),lower=placement('U');
  const records=new Map<string,PlanItem>([['U#1',{...u,instanceId:'U#1',itemId:'U',entryId:'U',travellerId:'person',volumeMm3:shapeVolume(s),priority:'required',required:true,accessPriority:1,upperMassGrams:100}],['small#1',{...item('small'),instanceId:'small#1',itemId:'small',entryId:'small',travellerId:'person',volumeMm3:144000,priority:'required',required:true,accessPriority:1,upperMassGrams:10}]]);
  expect(geometrySupportArea(upper,lower,records)).toBe(0);expect(assessStackLoads([lower,upper],records)[0].aboveInstanceIds).toEqual([]);
  const plan=buildPlan(trip([u,item('small')]),[u,item('small')],[bag]);expect(plan.placements).toHaveLength(2);expect(plan.stackLoads!.every(l=>l.status==='clear')).toBe(true);
 });
 it.each(['balanced','maximum_capacity','easy_access','fragile_protection'] as const)('rejects inaccessible entry and finds the feasible reverse insertion order in %s',mode=>{
  const s=shape(true),arch=item('U',s.fittedDimensionsMm,s),small=item('small',{length:40,width:100,height:30}),a=placement('U'),b=placement('small',{x:40,length:40,width:100,height:30}),records=new Map([['U#1',arch],['small#1',small]]);
  expect(geometryIntersects(a,b,records)).toBe(false);expect(hasVerticalEntry(b,[a],records,bag)).toBe(false);expect(hasVerticalEntry(a,[b],records,bag)).toBe(true);
  const plan=buildPlan(trip([arch,small]),[arch,small],[bag],mode);expect(plan.placements).toHaveLength(2);expect(orderPackingSteps(plan.placements,[bag])[0].itemId).toBe('small');
 });
 it.each((['balanced','maximum_capacity','easy_access','fragile_protection'] as const).flatMap(mode=>[2,3].map(quantity=>({mode,quantity}))))('finds $quantity dependent insertion pairs without mutating the trip in $mode',({mode,quantity})=>{
  const s=shape(true),arch=item('U',s.fittedDimensionsMm,s),small=item('small',{length:40,width:100,height:30}),items=[arch,small],t=trip(items);
  t.entries.forEach(entry=>entry.quantity=quantity);const wide={...bag,inside:{...bag.inside,length:120*quantity},opening:{length:120*quantity,width:100}},before=structuredClone(t);
  const plan=buildPlan(t,items,[wide],mode),again=buildPlan(t,items,[wide],mode);
  expect(plan.placements,JSON.stringify({placements:plan.placements,excluded:plan.excluded,warnings:plan.warnings})).toHaveLength(2*quantity);expect(plan.excluded).toEqual([]);expect(again.placements).toEqual(plan.placements);expect(t).toEqual(before);
  const records=new Map(plan.placements.map(p=>[p.instanceId,p.itemId==='U'?arch:small]));
  for(const [index,p] of plan.placements.entries()){
   expect(hasVerticalEntry(p,plan.placements.slice(0,index),records,wide)).toBe(true);
   expect(plan.placements.slice(0,index).some(other=>geometryIntersects(p,other,records))).toBe(false);
  }
 });
 it('can insert an optional inner item before a required enclosing shape',()=>{
  const s=shape(true),arch=item('U',s.fittedDimensionsMm,s),small=item('small',{length:40,width:100,height:30}),t=trip([arch,small]);
  t.entries[1].required=false;t.entries[1].priority='optional';
  const plan=buildPlan(t,[arch,small],[bag]);expect(plan.placements).toHaveLength(2);expect(plan.requiredExcludedCount).toBe(0);expect(plan.placements[0].itemId).toBe('small');
 });
 it('does not reorder packed roofs or evade fragile contact limits during retries',()=>{
  const s=shape(true),arch=item('U',s.fittedDimensionsMm,s),small=item('small',{length:40,width:100,height:30}),t=trip([arch,small]);
  t.lockedPlacements=[placement('U',{shapeKey:shapeKey(s),insertionOrder:1})];t.completedInstanceIds=['U#1'];const before=structuredClone(t);
  const locked=buildPlan(t,[arch,small],[bag]);expect(locked.placements).toHaveLength(1);expect(locked.placements[0].locked).toBe(true);expect(locked.excluded[0].itemId).toBe('small');expect(t).toEqual(before);
  const touching={...small,dimensions:{...small.dimensions,height:40},fragile:true};t.lockedPlacements=[];t.completedInstanceIds=[];
  const fragile=buildPlan(t,[arch,touching],[bag]);expect(fragile.placements).toHaveLength(1);expect(fragile.stackLoads!.some(load=>load.status==='conflict')).toBe(false);
 });
 it('does not reserve another traveller or assigned bag for a pending shape',()=>{
  const s=shape(true),arch=item('U',s.fittedDimensionsMm,s),small=item('small',{length:40,width:100,height:30}),t=trip([small,arch]);
  t.entries[0].containerId='bag';t.entries[1].containerId='other';t.entries[1].travellerId='other-person';t.containerIds.push('other');
  const second={...bag,id:'other',travellerIds:['other-person']},baseline=trip([small]);
  const mixed=buildPlan(t,[small,arch],[bag,second]),plain=buildPlan(baseline,[small],[bag]);
  expect(mixed.placements).toHaveLength(2);expect(mixed.placements.find(p=>p.itemId==='small')).toMatchObject(plain.placements[0]);expect(mixed.placements.find(p=>p.itemId==='U')!.containerId).toBe('other');
 });
 it('discloses the bounded retry limit for an overfilled irregular plan',()=>{
  const s=shape(true),arch=item('U',s.fittedDimensionsMm,s),small=item('small',{length:40,width:100,height:30}),t=trip([arch,small]);t.entries[0].quantity=5;
  const before=structuredClone(t),plan=buildPlan(t,[arch,small],[bag]);
  expect(plan.placements).toHaveLength(2);expect(plan.excluded).toHaveLength(4);expect(plan.warnings.join(' ')).toContain('24 attempts');expect(t).toEqual(before);
 });
 it('pauses changed locked geometry without editing saved packed records or reusing their space',()=>{
  const s=shape(),u=item('U',s.fittedDimensionsMm,s),items=[u,item('small')],t=trip(items);t.lockedPlacements=[placement('U')];t.completedInstanceIds=['U#1'];const before=structuredClone(t);
  expect(buildPlan(t,items,[bag]).placements).toHaveLength(0);expect(t).toEqual(before);
 });
 it('preserves older rectangular locks with equivalent equal-side rotation codes',()=>{
  const cube=item('old',{length:40,width:40,height:40}),t=trip([cube]);
  for(const rotation of [0,90]){t.lockedPlacements=[placement('old',{length:40,width:40,height:40,rotation})];const before=structuredClone(t);expect(buildPlan(t,[cube],[bag]).placements[0].rotation).toBe(rotation);expect(t).toEqual(before);}
  cube.keepUpright=false;t.lockedPlacements=[placement('old',{length:40,width:40,height:40,rotation:4})];expect(buildPlan(t,[cube],[bag]).placements[0].rotation).toBe(4);
 });
 it('pauses malformed saved locks without throwing or interpreting them as free space',()=>{
  const i=item('small'),t=trip([i]);
  for(const bad of [placement('old',{width:NaN}),null as unknown as Placement]){t.lockedPlacements=[bad];const before=structuredClone(t);const plan=buildPlan(t,[i],[bag]);expect(plan.placements).toEqual([]);expect(plan.warnings.join(' ')).toContain('malformed');expect(t).toEqual(before);}
 });
 it('counts contact at an interior underside even when both objects stand on the floor',()=>{
  const s=shape(true),arch=item('U',s.fittedDimensionsMm,s),fragile={...item('small',{length:40,width:100,height:40}),fragile:true},a=placement('U'),b=placement('small',{x:40,length:40,width:100,height:40});
  const records=new Map([['U#1',arch],['small#1',fragile]]);expect(geometryIntersects(a,b,records)).toBe(false);expect(geometryContactArea(a,b,records)).toBe(4000);
  const loads=assessStackLoads([a,b],new Map([...records].map(([id,i])=>[id,{...i,instanceId:id,itemId:i.id,entryId:i.id,travellerId:'person',volumeMm3:1,priority:'required' as const,required:true,accessPriority:1,upperMassGrams:i.massGrams}])));
  expect(loads.find(l=>l.instanceId==='small#1')!.status).toBe('conflict');expect(loads.find(l=>l.instanceId==='small#1')!.upperLoadGrams).toBe(100);
 });
 it('rejects mutual horizontal load paths in otherwise disjoint connected shapes',()=>{
  const aShape=customShape({x:12,y:10,z:6},(x,y,z)=>x<4||x>=8||y<3||(y>=8&&z>=4));
  const bShape=customShape({x:8,y:7,z:8},(x,y,z)=>x>=4&&(y<5||z<4)||x<4&&y<5&&z>=6);
  const a=item('A',aShape.fittedDimensionsMm,aShape),b=item('B',bShape.fittedDimensionsMm,bShape),pa=placement('A'),pb=placement('B',{y:30,length:80,width:70,height:80}),items=new Map([['A#1',a],['B#1',b]]);
  expect(geometryIntersects(pa,pb,items)).toBe(false);expect(geometryContactArea(pa,pb,items)).toBeGreaterThan(0);expect(geometryContactArea(pb,pa,items)).toBeGreaterThan(0);
  const records=new Map([...items].map(([id,i])=>[id,{...i,instanceId:id,itemId:i.id,entryId:i.id,travellerId:'person',volumeMm3:1,priority:'required' as const,required:true,accessPriority:1,upperMassGrams:i.massGrams}]));
  expect(assessStackLoads([pa,pb],records).every(l=>l.status==='conflict'&&l.reason?.includes('cyclic'))).toBe(true);
 });
});
