import {describe,it,expect} from 'vitest';
import {buildPlan} from './optimizer';
import {assessStackLoads} from './stack-load';
import {orderPackingSteps} from './packing-sequence';
import {boxesIntersect,contactPositions,createContactPositionScratch,geometryContactArea,geometryIntersects,geometryOrientations,geometrySupportArea,hasGeometrySupport,hasVerticalEntry,insertObstaclePrefixMaxRight,obstaclePrefixMaxRight,packingShapeError,placementBoxes,placementSurface,RectangularSupportIndex,shapeDimensions,shapeKey,shapeVolume,uniqueGeometryOrientations} from './packing-geometry';
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
 it('skips rotations that produce the exact same occupied boxes',()=>{
  const shaped=shape(),candidate=item('U',shaped.fittedDimensionsMm,shaped);candidate.keepUpright=false;
  const codes=[0,90,1,2,3,4,...Array.from({length:18},(_,index)=>106+index)],signature=(rotation:number)=>placementBoxes(placement('U',{rotation}),candidate)
   .map(box=>[box.x,box.y,box.z,box.length,box.width,box.height].join(',')).sort().join(';');
  const seen=new Set<string>(),expected:number[]=[];
  for(const code of codes){const key=signature(code);if(!seen.has(key)){seen.add(key);expected.push(code);}}
  const actual=uniqueGeometryOrientations(candidate,bag).map(orientation=>orientation.rotation);
  expect(geometryOrientations(candidate,bag)).toHaveLength(codes.length);
  expect(expected.length).toBeLessThan(codes.length);
  expect(actual).toEqual(expected);
 });
 it('preserves vertical-entry results when cached obstacles are sorted by x',()=>{
  const shaped=shape(),small=item('small'),arch=item('U',shaped.fittedDimensionsMm,shaped),items=new Map([[small.id+'#1',small],[arch.id+'#1',arch]]);
  const obstacles=[{x:75,y:0,z:10,length:10,width:100,height:20},{x:35,y:15,z:30,length:10,width:10,height:20}],sorted=[...obstacles].sort((a,b)=>a.x-b.x),prefix=obstaclePrefixMaxRight(sorted);
  for(const candidate of [placement('small',{x:30,y:10,z:0,length:40,width:40,height:20}),placement('U')]){
   const ordinary=hasVerticalEntry(candidate,[],items,bag,[],obstacles),indexed=hasVerticalEntry(candidate,[],items,bag,[],sorted,true,10),prefixIndexed=hasVerticalEntry(candidate,[],items,bag,[],sorted,true,undefined,prefix);
   expect(indexed).toBe(ordinary);expect(prefixIndexed).toBe(ordinary);
  }
 });
 it('checks a trial placement against cached entry obstacles without rebuilding the full list',()=>{
  const shaped=shape(),arch=item('U',shaped.fittedDimensionsMm,shaped),small=item('small'),items=new Map([[arch.id+'#1',arch],[small.id+'#1',small]]),blocker=placement('U'),blockerBoxes=placementBoxes(blocker,arch);
  const overhead=placement('small',{x:40,y:35,z:30,length:40,width:20,height:20}),overheadBoxes=placementBoxes(overhead,small);
  for(const [probe,obstacles] of [[placement('small',{x:40,y:10,z:0,length:40,width:20,height:20}),blockerBoxes],[placement('small',{x:40,y:35,z:0,length:40,width:20,height:20}),blockerBoxes],[placement('small',{x:40,y:35,z:0,length:40,width:20,height:20}),overheadBoxes]] as const){
   const placed=obstacles===overheadBoxes?overhead:blocker;
   const ordinary=hasVerticalEntry(probe,[placed],items,bag,[]);
   const indexed=hasVerticalEntry(probe,[],items,bag,[],[],true,undefined,[],obstacles);
   expect(indexed).toBe(ordinary);
  }
 });
 it('skips x-sorted entry obstacles beyond the maximum obstacle reach',()=>{
  const small=item('small'),items=new Map([[small.id+'#1',small]]),obstacles=[
   {x:0,y:0,z:10,length:20,width:100,height:30},
   {x:140,y:0,z:10,length:20,width:100,height:30},
   {x:220,y:0,z:10,length:20,width:100,height:30},
  ],sorted=[...obstacles].sort((a,b)=>a.x-b.x),prefix=obstaclePrefixMaxRight(sorted),candidate=placement('small',{x:150,y:10,z:0,length:40,width:40,height:20});
  expect(hasVerticalEntry(candidate,[],items,bag,[],sorted,true,undefined,prefix)).toBe(hasVerticalEntry(candidate,[],items,bag,[],obstacles));
  expect(hasVerticalEntry(candidate,[],items,bag,[],sorted,true,undefined,prefix)).toBe(false);
 });
 it('inserts new vertical-entry obstacles while keeping sorted bounds and prefix maxima exact',()=>{
  const existing=[{x:10,y:0,z:0,length:8,width:1,height:1},{x:20,y:0,z:0,length:4,width:1,height:1}],obstacles=[...existing],prefix=obstaclePrefixMaxRight(obstacles);
  const additions=[{x:5,y:0,z:0,length:30,width:1,height:1},{x:20,y:1,z:0,length:12,width:1,height:1},{x:10,y:2,z:0,length:3,width:1,height:1}];
  insertObstaclePrefixMaxRight(obstacles,prefix,additions.slice(0,1));insertObstaclePrefixMaxRight(obstacles,prefix,additions.slice(1));
  const expected=[...existing,...additions].sort((a,b)=>a.x-b.x);
  expect(obstacles).toEqual(expected);
  expect(prefix).toEqual(obstaclePrefixMaxRight(expected));
 });
 it('reuses precomputed obstacle boxes without changing shape contact candidates',()=>{
  const shaped=shape(),obstacle=placement('U'),shapeItem=item('U',shaped.fittedDimensionsMm,shaped),candidate=item('candidate',{length:40,width:30,height:20}),items=new Map<string,LibraryItem>([[obstacle.instanceId,shapeItem],[candidate.id+'#1',candidate]]),orientation=geometryOrientations(candidate,bag)[0];
  const full=contactPositions(bag,orientation,candidate,[obstacle],items),cached=contactPositions(bag,orientation,candidate,[],items,undefined,[],placementBoxes(obstacle,shapeItem));
  expect(cached).toEqual(full);
  const scratch=createContactPositionScratch(),reused=contactPositions(bag,orientation,candidate,[obstacle],items,undefined,undefined,undefined,20000,undefined,undefined,scratch);
  expect(reused).toEqual(full);
  const narrowRegion={x:0,y:0,z:0,length:90,width:70,height:50},reusedAgain=contactPositions(bag,orientation,candidate,[],items,narrowRegion,[],undefined,8,undefined,undefined,scratch);
  expect(reusedAgain).toEqual(contactPositions(bag,orientation,candidate,[],items,narrowRegion,[],undefined,8));
  const capped=contactPositions(bag,orientation,candidate,[obstacle],items,undefined,undefined,undefined,8);
  expect(full.positions.length).toBeGreaterThan(8);expect(capped.positions).toEqual(full.positions.slice(0,8));expect(capped.limited).toBe(true);
  const obstacleBoxes=placementBoxes(obstacle,shapeItem),clear=(position:{x:number;y:number;z:number})=>!geometryIntersects(placement('candidate',{...position,...orientation}),obstacle,items);
  const prefiltered=contactPositions(bag,orientation,candidate,[],items,undefined,[],obstacleBoxes,20000,obstacleBoxes);
  expect(prefiltered.positions).toEqual(full.positions.filter(clear));
  const prefilteredCapped=contactPositions(bag,orientation,candidate,[],items,undefined,[],obstacleBoxes,8,obstacleBoxes);
  expect(prefilteredCapped.positions).toEqual(full.positions.slice(0,8).filter(clear));expect(prefilteredCapped.limited).toBe(true);
  const sortedObstacles=[...obstacleBoxes].sort((a,b)=>a.x-b.x),prefix=obstaclePrefixMaxRight(sortedObstacles);
  const indexed=contactPositions(bag,orientation,candidate,[],items,undefined,[],obstacleBoxes,20000,sortedObstacles,prefix);
  expect(indexed).toEqual(prefiltered);
 });
 it('deduplicates clamped contact coordinates at a free-region edge',()=>{
  const candidate=item('candidate',{length:10,width:10,height:10}),orientation=geometryOrientations(candidate,bag)[0],region={x:0,y:0,z:0,length:100,width:100,height:100};
  const positions=contactPositions(bag,orientation,candidate,[],new Map(),region,[],[{x:9.995,y:20,z:0,length:1,width:10,height:10}]).positions;
  const keys=positions.map(({x,y,z})=>`${x},${y},${z}`);
  expect(keys.length).toBe(new Set(keys).size);
  expect(keys).toContain('0,0,0');
 });
 it('indexes rectangular support planes without losing epsilon or shaped support candidates',()=>{
  const shaped=shape(),support=placement('U',{height:60}),upper=placement('upper',{z:60.005,height:10}),decoys=Array.from({length:64},(_,index)=>placement(`decoy-${index}`,{z:10+index*.4,height:5,width:20}));
  const placed=[...decoys,support],items=new Map<string,LibraryItem>(placed.map(p=>[p.instanceId,item(p.itemId)]));items.set(support.instanceId,item('U',shaped.fittedDimensionsMm,shaped));
  const index=new RectangularSupportIndex(items,placed);
  expect(index.candidates(upper)).toContain(support);expect(index.candidates(upper)).not.toContain(decoys[0]);
  expect(hasGeometrySupport(upper,placed,items,.65)).toBe(true);expect(hasGeometrySupport(upper,placed,items,.65,undefined,0,index)).toBe(true);
   const addedShape=placement('added-shape',{height:60});items.set(addedShape.instanceId,item('added-shape',shaped.fittedDimensionsMm,shaped));index.add(addedShape);expect(index.candidates(upper)).toContain(addedShape);
  const nearPlane=placement('near-plane',{height:60.004}),adjacentPlane=placement('adjacent-plane',{height:59.997}),otherCompartment=placement('other-compartment',{height:60,compartmentId:'separate'}),otherBag=placement('other-bag',{height:60,containerId:'other'}),ordered=[nearPlane,otherCompartment,adjacentPlane,otherBag],orderedItems=new Map<string,LibraryItem>(ordered.map(p=>[p.instanceId,item(p.itemId)])),orderedIndex=new RectangularSupportIndex(orderedItems,ordered);
  expect(orderedIndex.candidates(upper)).toEqual([nearPlane,adjacentPlane]);expect(hasGeometrySupport(upper,ordered,orderedItems,.65,undefined,0,orderedIndex)).toBe(hasGeometrySupport(upper,ordered,orderedItems,.65));
  const shapedSupport=placement('shaped-support',{height:60}),shapedItems=new Map<string,LibraryItem>([[shapedSupport.instanceId,item('shaped-support',shaped.fittedDimensionsMm,shaped)]]),shapedIndex=new RectangularSupportIndex(shapedItems,[shapedSupport]);
  expect(shapedIndex.candidates(upper)).toContain(shapedSupport);expect(hasGeometrySupport(upper,[shapedSupport],shapedItems,.65,undefined,0,shapedIndex)).toBe(hasGeometrySupport(upper,[shapedSupport],shapedItems,.65));
  const shapedUpper=placement('shaped-upper',{z:60}),rectangularSupport=placement('rectangular-support',{height:60}),far=placement('far',{z:10,height:5}),upperItems=new Map<string,LibraryItem>([[shapedUpper.instanceId,item('shaped-upper',shaped.fittedDimensionsMm,shaped)],[rectangularSupport.instanceId,item('rectangular-support')],[far.instanceId,item('far')]]),upperPlacements=[far,rectangularSupport],upperIndex=new RectangularSupportIndex(upperItems,upperPlacements);
  expect(upperIndex.candidates(shapedUpper)).toEqual([rectangularSupport]);
  expect(hasGeometrySupport(shapedUpper,upperPlacements,upperItems,.65,undefined,0,upperIndex)).toBe(hasGeometrySupport(shapedUpper,upperPlacements,upperItems,.65));
 });
 it('retains cached support planes unaffected by a new placement',()=>{
  const lower=placement('lower',{height:60}),nearby=placement('nearby',{height:59.997}),farLower=placement('far-lower',{z:100,height:60}),farNearby=placement('far-nearby',{z:100,height:59.997}),upper=placement('upper',{z:60}),farUpper=placement('far-upper',{z:160});
  const placed=[lower,nearby,farLower,farNearby],items=new Map<string,LibraryItem>([...placed,upper,farUpper].map(p=>[p.instanceId,item(p.itemId)])),index=new RectangularSupportIndex(items,placed);
  const nearCandidates=index.candidates(upper),farCandidates=index.candidates(farUpper),added=placement('added',{height:60});items.set(added.instanceId,item(added.itemId));index.add(added);
  expect(index.candidates(upper)).not.toBe(nearCandidates);expect(index.candidates(upper)).toEqual([lower,nearby,added]);
  expect(index.candidates(farUpper)).toBe(farCandidates);
 });
 it('invalidates every affected plane when adding a shaped support',()=>{
  const stepped=shape(),shapedSupport=placement('shaped-support',{height:60}),nearby=placement('nearby',{height:59.997}),farLower=placement('far-lower',{z:100,height:60}),farNearby=placement('far-nearby',{z:100,height:59.997}),upper=placement('upper',{z:60}),farUpper=placement('far-upper',{z:160});
  const placed=[shapedSupport,nearby,farLower,farNearby],items=new Map<string,LibraryItem>([...placed,upper,farUpper].map(p=>[p.instanceId,item(p.itemId)]));
  items.set(shapedSupport.instanceId,item(shapedSupport.itemId,stepped.fittedDimensionsMm,stepped));
  const index=new RectangularSupportIndex(items,placed),nearCandidates=index.candidates(upper),farCandidates=index.candidates(farUpper),added=placement('added-shape',{height:60});
  items.set(added.instanceId,item(added.itemId,stepped.fittedDimensionsMm,stepped));index.add(added);
  expect(index.candidates(upper)).not.toBe(nearCandidates);expect(index.candidates(upper)).toContain(added);
  expect(index.candidates(farUpper)).toBe(farCandidates);
 });
 it('indexes stepped shape supports by their actual top-surface planes',()=>{
  const stepped=customShape({x:8,y:8,z:6},(x,_y,z)=>x>=4||z<3);
  const lower=placement('stepped',{length:80,width:80,height:60}),remote=placement('remote',{z:100,length:120,width:100,height:60});
  const lowUpper=placement('low-upper',{x:0,y:0,z:30,length:20,width:10,height:5}),highUpper=placement('high-upper',{x:40,y:0,z:60,length:20,width:10,height:5});
  const items=new Map<string,LibraryItem>([
   [lower.instanceId,item('stepped',stepped.fittedDimensionsMm,stepped)],
   [remote.instanceId,item('remote',shape().fittedDimensionsMm,shape())],
   [lowUpper.instanceId,item('low-upper',{length:20,width:10,height:5})],
   [highUpper.instanceId,item('high-upper',{length:20,width:10,height:5})],
  ]),index=new RectangularSupportIndex(items,[remote,lower]);
  expect(index.candidates(lowUpper)).toEqual([lower]);expect(index.candidates(highUpper)).toEqual([lower]);
  expect(hasGeometrySupport(lowUpper,[remote,lower],items,.65,undefined,0,index)).toBe(hasGeometrySupport(lowUpper,[remote,lower],items,.65));
  expect(hasGeometrySupport(highUpper,[remote,lower],items,.65,undefined,0,index)).toBe(hasGeometrySupport(highUpper,[remote,lower],items,.65));
 });
 it('computes shaped-on-rectangular support from the shaped bottom patches',()=>{
  const s=shape(),upper=placement('U',{z:20}),lower=placement('lower',{height:20}),shapedLower=placement('shaped-lower',{height:60}),items=new Map<string,LibraryItem>([[upper.instanceId,item('U',s.fittedDimensionsMm,s)],[lower.instanceId,item('lower',{length:120,width:100,height:20})],[shapedLower.instanceId,item('shaped-lower',s.fittedDimensionsMm,s)]]);
  expect(geometrySupportArea(upper,lower,items)).toBe(9200);
  expect(geometrySupportArea(upper,{...lower,length:40},items)).toBe(4000);
  expect(geometrySupportArea({...upper,z:20.02},lower,items)).toBe(0);
  expect(geometrySupportArea(placement('shaped-upper',{z:60}),shapedLower,items)).toBe(9200);
  expect(geometrySupportArea(placement('rect-upper',{z:60,length:40,width:100,height:10}),shapedLower,items)).toBe(4000);
 });
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
 it('keeps straight-entry failures from being replaced by later separation diagnostics',()=>{
  const s=shape(true),arch=item('U',s.fittedDimensionsMm,s),small=item('small',{length:40,width:100,height:30}),t=trip([arch,small]);
  const smallEntry=t.entries.find(entry=>entry.itemId==='small')!;smallEntry.required=false;smallEntry.priority='optional';
  t.separationRules=[{id:'rule',firstEntryId:'U',secondEntryId:'small',kind:'clearance',clearanceMm:1000}];
  const plan=buildPlan(t,[arch,small],[bag]);
  expect(plan.placements.map(placement=>placement.itemId)).toContain('U');
  expect(plan.excluded.find(excluded=>excluded.itemId==='small')?.reason).toContain('straight downward access');
 });
 it.each(['balanced','maximum_capacity','easy_access','fragile_protection'] as const)('rejects inaccessible entry and finds the feasible reverse insertion order in %s',mode=>{
  const s=shape(true),arch=item('U',s.fittedDimensionsMm,s),small=item('small',{length:40,width:100,height:30}),a=placement('U'),b=placement('small',{x:40,length:40,width:100,height:30}),records=new Map([['U#1',arch],['small#1',small]]);
   expect(geometryIntersects(a,b,records)).toBe(false);expect(hasVerticalEntry(b,[a],records,bag)).toBe(false);expect(hasVerticalEntry(b,[a],records,bag,[],placementBoxes(a,arch))).toBe(false);expect(hasVerticalEntry(a,[b],records,bag)).toBe(true);expect(hasVerticalEntry(a,[b],records,bag,[],placementBoxes(b,small))).toBe(true);
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
