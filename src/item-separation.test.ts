import { describe,expect,it } from 'vitest';
import { createInitialData } from './seed';
import { buildPlan } from './optimizer';
import { boxDistanceSquared, entryHasSeparation, placementSeparationError, reviewSeparation, separationConflict, separationRuleError } from './item-separation';
import { isPackingBackup } from './backup';
import { isSharedPackingRecords, openSharedPack, sharedPackingRecords } from './shared-packs';
import { separatePackingCopy } from './packing-forms';
import { packingItemForPlacement } from './packing-forms';
import { shapeKey } from './packing-geometry';
import type { LibraryItem, OptimizationMode, PackingShape, Placement, SeparationRule } from './types';

const stamp='2026-10-01T00:00:00Z',evidence={source:'user_confirmed' as const,confidence:1,collectedAt:stamp};
const modes:OptimizationMode[]=['balanced','maximum_capacity','easy_access','fragile_protection'];
function fixture(kind:SeparationRule['kind']='different_bags'){
  const app=structuredClone(createInitialData()),trip=app.trips[0];
  app.libraryItems=app.libraryItems.slice(0,2).map((item,i)=>({...item,id:'item'+i,name:'Synthetic kit '+i,dimensions:{length:20,width:20,height:20},dimensionEvidence:evidence,massGrams:100,massRangeGrams:undefined,massEvidence:evidence,fragile:false,keepUpright:true,flexibility:'foldable',maxTopLoadGrams:10000,topLoadEvidence:evidence}));
  app.containers=[{...app.containers[0],inside:{length:140,width:100,height:60},opening:{length:140,width:100},insideEvidence:evidence,openingEvidence:evidence,tareGrams:0,tareEvidence:evidence,massLimitGrams:10000,massLimitEvidence:evidence}];
  trip.entries=[0,1].map(i=>({...trip.entries[0],id:'entry'+i,itemId:'item'+i,quantity:2,required:true}));trip.lockedPlacements=[];trip.completedInstanceIds=[];trip.unavailableInstanceIds=[];trip.rejectedPlacements=[];trip.sample=false;
  trip.containerIds=app.containers.map(b=>b.id);trip.separationRules=[{id:'rule',firstEntryId:'entry0',secondEntryId:'entry1',kind,...(kind==='clearance'?{clearanceMm:10}:{})}];
  const plan=(mode:OptimizationMode='balanced')=>buildPlan(trip,app.libraryItems,app.containers,mode);
  return {app,trip,plan};
}
function records(positions:Placement[],library:LibraryItem[]){return new Map(positions.flatMap(p=>{const item=packingItemForPlacement(library.find(i=>i.id===p.itemId),p);return item?[[p.instanceId,item] as const]:[];}));}
// A thick open cup has validated occupied-cell topology and an accessible recess.
function cup():PackingShape{
  const grid={x:9,y:9,z:9},occupiedCells:number[]=[],inside=(x:number,y:number,z:number)=>x>=0&&x<9&&y>=0&&y<9&&z>=0&&z<9&&(x<3||x>=6||y<3||y>=6||z<3);let observed=0,faces=0;
  for(let z=0;z<9;z++)for(let y=0;y<9;y++)for(let x=0;x<9;x++)if(inside(x,y,z)){occupiedCells.push(x+9*(y+9*z));const count=[[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]].filter(d=>!inside(x+d[0],y+d[1],z+d[2])).length;faces+=count;if(count)observed++;}
  const dimensionsMm={length:90,width:90,height:90};return {adoptedAt:stamp,sourceEnvelopeMm:dimensionsMm,fittedDimensionsMm:dimensionsMm,solid:{id:'00000000-0000-4000-8000-000000000001',target:'item',format:'voxel_solid_v1',units:'millimetres',sourceHash:'a'.repeat(64),sourcePointCount:3000,method:'observed_voxel_shell_fill_v1',resolutionMm:10,grid,dimensionsMm,occupiedCells,observedCellCount:observed,enclosedCellCount:occupiedCells.length-observed,surfaceFaceCount:faces,warnings:['Synthetic analytic shape.']}};
}

describe('hard item separation',()=>{
  it.each(modes)('separates every copy between bags in %s',mode=>{
    const f=fixture();f.app.containers.push({...f.app.containers[0],id:'second-bag'});f.trip.containerIds=f.app.containers.map(b=>b.id);
    const plan=f.plan(mode);expect(plan.placements).toHaveLength(4);expect(plan.requiredExcludedCount).toBe(0);
    const r=records(plan.placements,f.app.libraryItems);for(const p of plan.placements)expect(placementSeparationError(p,plan.placements,f.trip.separationRules!,r)).toBeUndefined();
    expect(reviewSeparation(f.trip,f.app.libraryItems,f.app.containers,plan).checks[0].status).toBe('within_model');
  });
  it('retains conflicting required inputs and respects fixed assignments',()=>{
    const f=fixture();f.trip.entries.forEach(e=>e.containerId=f.app.containers[0].id);
    const p=f.plan();expect(p.requiredExcludedCount).toBe(2);expect(p.excluded.every(e=>e.required&&e.reason.includes('separation'))).toBe(true);
    expect(reviewSeparation(f.trip,f.app.libraryItems,f.app.containers,p).checks[0].status).toBe('incomplete');
  });
  it('keeps reviewed compartments distinct and refuses to invent a missing one',()=>{
    const f=fixture('different_compartments'),bag=f.app.containers[0];
    const first=f.plan();expect(first.requiredExcludedCount).toBe(2);
    bag.compartments=[0,1].map(i=>({id:'area'+i,name:'Area '+i,x:i*70,y:0,z:0,length:70,width:100,height:60,opening:{length:70,width:100},evidence,supportEvidence:evidence}));
    for(const mode of modes){const p=f.plan(mode);expect(p.placements).toHaveLength(4);expect(reviewSeparation(f.trip,f.app.libraryItems,f.app.containers,p).checks[0].status).toBe('within_model');}
    f.trip.entries.forEach(e=>e.compartmentId='area0');f.trip.entries.forEach(e=>e.containerId=bag.id);expect(f.plan().requiredExcludedCount).toBe(2);
  });
  it('finds clearance-boundary candidates while respecting support, locks and quantity',()=>{
    const f=fixture('clearance'),bag=f.app.containers[0],template=f.plan().placements.find(p=>p.entryId==='entry0')!;
    bag.inside={length:160,width:20,height:20};bag.opening={length:160,width:20};f.trip.entries[1].quantity=1;
    const saved={...template,x:40,y:0,z:0,locked:true},second={...saved,instanceId:'entry0#2',x:100};
    bag.unavailableSpaces=[{id:'left',name:'Left intrusion',x:0,y:0,z:0,length:40,width:20,height:20,evidence},{id:'right',name:'Right intrusion',x:120,y:0,z:0,length:40,width:20,height:20,evidence}];
    f.trip.lockedPlacements=[saved,second];f.trip.completedInstanceIds=[saved.instanceId,second.instanceId];const before=JSON.stringify(f.trip);
    for(const mode of modes){const p=f.plan(mode);expect(p.placements).toHaveLength(3);expect(p.placements.find(q=>q.instanceId===saved.instanceId)).toMatchObject(saved);
      expect(p.placements.some(q=>q.entryId==='entry1'&&q.x===70)).toBe(true);for(const q of p.placements.filter(q=>q.entryId==='entry1')){expect(boxDistanceSquared(saved,q)).toBeGreaterThanOrEqual(99.8);expect(boxDistanceSquared(second,q)).toBeGreaterThanOrEqual(99.8);}}
    expect(JSON.stringify(f.trip)).toBe(before);
  });
  it.each(modes)('pauses conflicting packed contents without moving raw locks in %s',mode=>{
    const f=fixture();delete f.trip.separationRules;const p=f.plan();f.trip.lockedPlacements=p.placements.map(q=>({...q,locked:true}));f.trip.completedInstanceIds=p.placements.map(q=>q.instanceId);
    f.trip.separationRules=[{id:'rule',firstEntryId:'entry0',secondEntryId:'entry1',kind:'different_bags'}];const before=JSON.stringify(f.trip);const paused=f.plan(mode);
    expect(paused.placements).toHaveLength(0);expect(paused.requiredExcludedCount).toBe(4);expect(paused.excluded.every(e=>e.reason.includes('separation'))).toBe(true);
    expect(reviewSeparation(f.trip,f.app.libraryItems,f.app.containers,paused).checks[0].status).toBe('conflict');expect(JSON.stringify(f.trip)).toBe(before);
    delete f.trip.separationRules;expect(f.plan(mode).placements).toHaveLength(4);
  });
  it('measures occupied-cell gaps rather than surrounding envelopes',()=>{
    const f=fixture('clearance'),a=f.app.libraryItems[0],b=f.app.libraryItems[1];a.packingShape=cup();a.dimensions={length:90,width:90,height:90};b.dimensions={length:10,width:10,height:10};
    const left:Placement={instanceId:'a#1',entryId:'entry0',itemId:a.id,containerId:'bag',x:0,y:0,z:0,...a.dimensions,rotation:0,layer:1,shapeKey:shapeKey(a.packingShape)};
    const right:Placement={...left,instanceId:'b#1',entryId:'entry1',itemId:b.id,x:40,y:40,z:40,...b.dimensions,shapeKey:undefined};
    const r=new Map([[left.instanceId,a],[right.instanceId,b]]),rule=f.trip.separationRules![0];
    expect(separationConflict(rule,left,right,r)).toBeUndefined();expect(separationConflict({...rule,clearanceMm:11},left,right,r)).toContain('gap');
    expect(separationConflict(rule,left,right,new Map())).toContain('missing');
    expect(boxDistanceSquared(left,right)).toBe(0);
  });
  it('rejects malformed, duplicated, ambiguous and orphan rules at planner/import gates',()=>{
    const f=fixture(),valid=f.trip.separationRules![0];
    const invalid=[null,{...valid,firstEntryId:'absent'},{...valid,secondEntryId:'entry0'},{...valid,kind:'automatic'}, {...valid,clearanceMm:10},...[-1,0,NaN,Infinity,10001].map(n=>({...valid,kind:'clearance',clearanceMm:n})),{...valid,hidden:'private'}];
    for(const value of invalid){f.trip.separationRules=[value] as SeparationRule[];expect(separationRuleError(f.trip)).toBeTruthy();expect(f.plan().placements).toHaveLength(0);expect(isPackingBackup({format:'packing-scanning-backup',app:f.app,photos:[]})).toBe(false);}
    f.trip.separationRules=[valid,{...valid,id:'another',firstEntryId:valid.secondEntryId,secondEntryId:valid.firstEntryId}];expect(separationRuleError(f.trip)).toContain('one separation');
    f.trip.separationRules=[valid];f.trip.entries.push({...f.trip.entries[0]});expect(separationRuleError(f.trip)).toContain('ambiguous');
  });
  it('retains rules in strict backups and remaps identities through separate shared working copies',()=>{
    const f=fixture();expect(isPackingBackup({format:'packing-scanning-backup',app:f.app,photos:[]})).toBe(true);
    const records=sharedPackingRecords(f.app,f.trip.id);expect(records.trip.separationRules).toEqual(f.trip.separationRules);expect(isSharedPackingRecords(records)).toBe(true);
    const opened=openSharedPack(f.app,{id:'pack',householdId:'home',revision:1,name:'Synthetic',updatedAt:stamp,updatedBy:'user',records},'copy');
    const copy=opened.trips[0];expect(copy.separationRules![0].firstEntryId).toBe('shared-copy:entry0');expect(copy.separationRules![0].id).toBe('shared-copy:rule');
    expect(sharedPackingRecords(opened,copy.id).trip.separationRules).toEqual(f.trip.separationRules);expect(f.trip.separationRules![0].id).toBe('rule');
  });
  it('inherits all related rules when an untouched copy is split for another packing form',()=>{
    const f=fixture(),before=JSON.stringify(f.trip),copy=separatePackingCopy(f.trip,'entry0','separate');
    expect(copy.entries).toHaveLength(3);expect(copy.separationRules).toHaveLength(2);expect(copy.separationRules![1]).toMatchObject({firstEntryId:'separate',secondEntryId:'entry1',kind:'different_bags'});
    expect(entryHasSeparation(copy,'separate')).toBe(true);expect(separationRuleError(copy)).toBeUndefined();expect(JSON.stringify(f.trip)).toBe(before);
  });
  it('never shows a complete gap result for stale physical geometry or missing copies',()=>{
    const f=fixture('clearance'),p=f.plan();f.trip.lockedPlacements=p.placements.map(q=>({...q,locked:true}));f.app.libraryItems[0].dimensions.length+=1;
    expect(reviewSeparation(f.trip,f.app.libraryItems,f.app.containers,p).checks[0].status).toBe('incomplete');
    f.trip.unavailableInstanceIds=[p.placements[0].instanceId];expect(reviewSeparation(f.trip,f.app.libraryItems,f.app.containers,f.plan()).checks[0].status).not.toBe('within_model');
  });
  it('accepts absent legacy rules and explicit removal without inventing a restriction',()=>{
    const f=fixture();delete f.trip.separationRules;expect(separationRuleError(f.trip)).toBeUndefined();expect(f.plan().placements).toHaveLength(4);
    f.trip.separationRules=[];expect(f.plan().placements).toHaveLength(4);expect(isPackingBackup({format:'packing-scanning-backup',app:f.app,photos:[]})).toBe(true);
  });
});
