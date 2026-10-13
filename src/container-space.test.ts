import { describe,expect,it } from 'vitest';
import { boxesOverlap,containerSpaceError,fitsUsableContainer,usableContainerVolume } from './container-space';
import { buildPlan } from './optimizer';
import { createInitialData } from './seed';
import type { Container,UnavailableSpace,LibraryItem,OptimizationMode } from './types';

const evidence={source:'measured' as const,confidence:1,collectedAt:new Date(0).toISOString()};
const modes:OptimizationMode[]=['balanced','maximum_capacity','easy_access','fragile_protection'];
function area(overrides:Partial<UnavailableSpace>={}):UnavailableSpace{return {id:'wheel',name:'Wheel housing',x:0,y:0,z:0,length:50,width:100,height:60,evidence,...overrides};}
function fixture(){const data=structuredClone(createInitialData()),trip=data.trips[0],bag=data.containers[0];bag.inside={length:200,width:200,height:200};bag.opening={length:200,width:200};bag.massLimitGrams=undefined;bag.tareGrams=0;const item:LibraryItem={...data.libraryItems[0],id:'reference',dimensions:{length:80,width:80,height:80},massGrams:100,fragile:false,keepUpright:true};trip.entries=[{id:'entry',itemId:item.id,travellerId:trip.travellers[0].id,quantity:1,priority:'required',required:true,accessPriority:3}];trip.lockedPlacements=[];trip.completedInstanceIds=[];return {trip,bag,item};}

describe('recorded usable container space',()=>{
  it('subtracts overlapping areas once, clipped beneath lid clearance',()=>{
    const {bag}=fixture();bag.inside={length:100,width:100,height:100};bag.lidClearanceMm=20;bag.lidClearanceEvidence=evidence;
    bag.unavailableSpaces=[area(),area({id:'frame',x:25,z:40})];
    // 800,000 below the lid minus 300,000 and 200,000, plus 50,000 overlap.
    expect(usableContainerVolume(bag)).toBe(350000);
    expect(containerSpaceError(bag)).toBeUndefined();
  });
  it('accepts touching boundaries but rejects a real overlap or entering lid clearance',()=>{
    const {bag}=fixture();bag.unavailableSpaces=[area({height:200})];bag.lidClearanceMm=10;bag.lidClearanceEvidence=evidence;
    expect(fitsUsableContainer({x:50,y:0,z:0,length:50,width:100,height:190},bag)).toBe(true);
    expect(fitsUsableContainer({x:49,y:0,z:0,length:50,width:100,height:190},bag)).toBe(false);
    expect(fitsUsableContainer({x:50,y:0,z:0,length:50,width:100,height:191},bag)).toBe(false);
  });
  it('rejects invalid boundaries, evidence, duplicate IDs, excessive areas and malformed data',()=>{
    const {bag}=fixture();
    const changes:Partial<Container>[]=[{lidClearanceMm:-1},{lidClearanceMm:201,lidClearanceEvidence:evidence},{lidClearanceMm:20},
      {unavailableSpaces:[area({x:-1})]},{unavailableSpaces:[area({height:Infinity})]},
      {unavailableSpaces:[area({x:180})]},{unavailableSpaces:[area(),area()]},
      {unavailableSpaces:Array.from({length:17},(_,i)=>area({id:String(i)}))},
      {unavailableSpaces:[area({evidence:{...evidence,confidence:NaN}})]},
      {unavailableSpaces:'invalid' as unknown as UnavailableSpace[]}];
    for(const change of changes){const value={...bag,...change};expect(containerSpaceError(value)).toBeTruthy();expect(usableContainerVolume(value)).toBe(0);}
  });
});

describe('planner with unavailable bag regions',()=>{
  it('keeps equivalent overlapping records and their order from changing placements or capacity',()=>{
    const {trip,bag,item}=fixture();item.dimensions={length:30,width:30,height:30};trip.entries[0].quantity=5;
    const first=area({length:50,width:50,height:200}),second=area({id:'frame',x:20,y:20,length:70,width:50,height:200});
    bag.unavailableSpaces=[first,second];const baseline=buildPlan(trip,[item],[bag]);
    bag.unavailableSpaces=[second,first,{...first,id:'same-region'}];const changed=buildPlan(trip,[item],[bag]);
    expect(baseline.placements.length).toBe(5);expect(changed.placements).toEqual(baseline.placements);expect(changed.summaries[0].volumeCapacityMm3).toBe(baseline.summaries[0].volumeCapacityMm3);
  });
  it('keeps every new placement outside intrusions and beneath the lid in all modes',()=>{
    const {trip,bag,item}=fixture();trip.entries[0].quantity=6;item.dimensions={length:40,width:40,height:40};
    bag.unavailableSpaces=[area({length:65,width:200,height:200}),area({id:'frame',x:60,length:10,width:200,height:180})];bag.lidClearanceMm=25;bag.lidClearanceEvidence=evidence;
    for(const mode of modes){const first=buildPlan(trip,[item],[bag],mode);expect(first.placements.length).toBeGreaterThan(0);expect(first.placements).toEqual(buildPlan(trip,[item],[bag],mode).placements);for(const placement of first.placements){expect(fitsUsableContainer(placement,bag)).toBe(true);for(const blocked of bag.unavailableSpaces)expect(boxesOverlap(placement,blocked)).toBe(false);}}
  });
  it('excludes a required item that fits the empty box but not either usable region',()=>{
    const {trip,bag,item}=fixture();bag.inside={length:200,width:100,height:100};bag.opening={length:200,width:100};
    expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(1);
    bag.unavailableSpaces=[area({x:60,length:80,width:100,height:100})];
    for(const mode of modes){const plan=buildPlan(trip,[item],[bag],mode);expect(plan.placements).toHaveLength(0);expect(plan.requiredExcludedCount).toBe(1);expect(plan.excluded[0].reason).toContain('unavailable areas');expect(plan.summaries[0].volumeCapacityMm3).toBe(1200000);}
  });
  it('keeps a conflicting confirmed lock unchanged in storage and calls for an explicit unlock',()=>{
    const {trip,bag,item}=fixture();const initial=buildPlan(trip,[item],[bag]).placements[0];trip.lockedPlacements=[initial];trip.completedInstanceIds=[initial.instanceId];
    bag.unavailableSpaces=[area({x:initial.x,y:initial.y,z:initial.z,length:initial.length,width:initial.width,height:initial.height})];
    const before=JSON.stringify(trip);const plan=buildPlan(trip,[item],[bag]);expect(plan.placements).toHaveLength(0);expect(plan.excluded[0].reason).toContain('undo packed or unlock');expect(JSON.stringify(trip)).toBe(before);
  });
  it('preserves an unaffected lock while recomputing usable capacity',()=>{
    const {trip,bag,item}=fixture();item.dimensions={length:40,width:40,height:40};const saved={instanceId:'entry#1',entryId:'entry',itemId:item.id,containerId:bag.id,x:150,y:0,z:0,length:40,width:40,height:40,layer:1,rotation:0};trip.lockedPlacements=[saved];bag.unavailableSpaces=[area()];
    for(const mode of modes)expect(buildPlan(trip,[item],[bag],mode).placements).toEqual([{...saved,locked:true}]);
  });
  it('rejects an item entering reserved lid height and permits a completely unavailable bag',()=>{
    const {trip,bag,item}=fixture();item.dimensions={length:180,width:180,height:180};expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(1);bag.lidClearanceMm=25;bag.lidClearanceEvidence=evidence;expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(0);
    bag.lidClearanceMm=200;const plan=buildPlan(trip,[item],[bag]);expect(plan.placements).toHaveLength(0);expect(plan.summaries[0].volumeCapacityMm3).toBe(0);
  });
  it('does not infer that an intrusion top can support another item',()=>{
    const {trip,bag,item}=fixture();bag.inside={length:100,width:100,height:100};bag.opening={length:100,width:100};item.dimensions={length:100,width:100,height:50};bag.unavailableSpaces=[area({length:100,width:100,height:50})];
    expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(0);
  });
  it('fails closed on malformed stored areas without discarding other eligible bags',()=>{
    const {trip,bag,item}=fixture();const second={...bag,id:'second',unavailableSpaces:undefined};trip.containerIds.push(second.id);bag.unavailableSpaces='bad' as unknown as UnavailableSpace[];
    const plan=buildPlan(trip,[item],[bag,second]);expect(plan.placements).toHaveLength(1);expect(plan.placements[0].containerId).toBe(second.id);expect(plan.warnings.some(w=>w.includes('records need correction'))).toBe(true);expect(plan.summaries[0].volumeCapacityMm3).toBe(0);
  });
});
