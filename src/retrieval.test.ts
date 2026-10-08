import { describe, it, expect } from 'vitest';
import { createInitialData } from './seed';
import { assessRetrieval, reviewRetrieval, retrievalReward } from './retrieval';
import { buildPlan } from './optimizer';
import { shapeKey } from './packing-geometry';
import { compartmentKey } from './compartments';
import type { Container, LibraryItem, PackingShape, PlanItem } from './types';

const date = '2026-10-01T00:00:00Z', evidence = { source: 'user_confirmed' as const, confidence: 1, collectedAt: date };
function fixture() {
  const app = createInitialData();
  const bag: Container = { ...app.containers[0], inside: { length: 100, width: 100, height: 100 }, opening: { length: 100, width: 100 }, massLimitGrams: 10000, tareGrams: 0 };
  const item: LibraryItem = { ...app.libraryItems[1], dimensions: { length: 20, width: 20, height: 20 }, massGrams: 100, massRangeGrams: undefined,
    maxTopLoadGrams: 10000, topLoadEvidence: evidence, fragile: false, keepUpright: true };
  const trip = { ...app.trips[0], mode: 'easy_access' as const, containerIds: [bag.id], entries: [
    { ...app.trips[0].entries[0], itemId: item.id, quantity: 3, required: true, accessPriority: 5 }], lockedPlacements: [], completedInstanceIds: [] };
  const ps = [0,1,2].map(i => ({ instanceId: `${trip.entries[0].id}#${i+1}`, itemId: item.id, entryId: trip.entries[0].id,
    containerId: bag.id, x: 0, y: 0, z: i*20, ...item.dimensions, rotation: 0, layer: i+1 }));
  return { bag, item, trip, ps, records: new Map(ps.map(p => [p.instanceId,item])) };
}
// Analytic occupied-cell fixtures exercise a real open recess and a roof.
function shape(roof: boolean): PackingShape {
  const grid = { x: 9, y: 9, z: 9 }, occupiedCells: number[] = [];
  const inside = (x: number,y: number,z: number) => x>=0&&x<9&&y>=0&&y<9&&z>=0&&z<9
    && (roof ? x<3 || x>=6 || z>=6 : x<3 || x>=6 || y<3 || y>=6 || z<3);
  let observed=0, faces=0;
  for(let z=0;z<9;z++)for(let y=0;y<9;y++)for(let x=0;x<9;x++)if(inside(x,y,z)){
    occupiedCells.push(x+9*(y+9*z));
    const count=[[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]].filter(d=>!inside(x+d[0],y+d[1],z+d[2])).length;
    faces+=count;if(count)observed++;
  }
  const dimensionsMm={length:90,width:90,height:90};
  return {adoptedAt:date,sourceEnvelopeMm:dimensionsMm,fittedDimensionsMm:dimensionsMm,solid:{id:'00000000-0000-4000-8000-000000000001',target:'item',format:'voxel_solid_v1',units:'millimetres',sourceHash:'a'.repeat(64),sourcePointCount:3000,method:'observed_voxel_shell_fill_v1',resolutionMm:10,grid,dimensionsMm,occupiedCells,observedCellCount:observed,enclosedCellCount:occupiedCells.length-observed,surfaceFaceCount:faces,warnings:['Synthetic analytic shape.']}};
}

describe('finished-pack retrieval', () => {
  it('reports transitive prerequisites once and does not call a support safe to remove', () => {
    const {bag,ps,records}=fixture(), snapshot=JSON.stringify(ps), checks=assessRetrieval(ps,[bag],records);
    expect(checks.map(c=>c.status)).toEqual(['rearrange','rearrange','clear']);
    expect(checks[0].beforeInstanceIds).toEqual([ps[1].instanceId,ps[2].instanceId]);
    expect(checks[0].supportingInstanceIds).toEqual([ps[1].instanceId]);
    expect(JSON.stringify(ps)).toBe(snapshot);
  });
  it('treats touching side footprints and other bags as independent', () => {
    const {bag,ps,records}=fixture();ps[1].x=20;ps[2].containerId='other';
    expect(assessRetrieval(ps,[bag,{...bag,id:'other'}],records).map(c=>c.status)).toEqual(['clear','clear','clear']);
  });
  it('detects fixed intrusions above a target and above a prerequisite', () => {
    const {bag,ps,records}=fixture();bag.unavailableSpaces=[{id:'roof',name:'Fixed roof',x:0,y:0,z:80,length:20,width:20,height:10,evidence}];
    expect(assessRetrieval(ps,[bag],records).map(c=>c.status)).toEqual(['blocked','blocked','blocked']);
  });
  it('does not count fixed space beside the withdrawal path', () => {
    const {bag,ps,records}=fixture();bag.unavailableSpaces=[{id:'side',name:'Side',x:20,y:0,z:0,length:20,width:20,height:100,evidence}];
    expect(assessRetrieval(ps,[bag],records)[2].status).toBe('clear');
  });
  it.each([false,true])('uses occupied cells for an open recess or roof (%s)', roof => {
    const {bag,item,ps}=fixture(), outer={...item,dimensions:{length:90,width:90,height:90},packingShape:shape(roof)}, inner={...item,dimensions:{length:10,width:10,height:10}};
    const a={...ps[0],...outer.dimensions,shapeKey:shapeKey(outer.packingShape)},b={...ps[1],x:30,y:30,z:roof?0:30,...inner.dimensions};
    const checks=assessRetrieval([a,b],[bag],new Map([[a.instanceId,outer],[b.instanceId,inner]]));
    expect(checks[1].status).toBe(roof?'rearrange':'clear');
    expect(checks[1].beforeInstanceIds).toEqual(roof?[a.instanceId]:[]);
    expect(checks[0].status).toBe(roof?'clear':'rearrange');
  });
  it('keeps independently reviewed compartment access separate', () => {
    const {bag,ps,records}=fixture();
    bag.compartments=[0,1].map(i=>({id:'c'+i,name:'Area '+i,x:i*50,y:0,z:0,length:50,width:100,height:100,opening:{length:50,width:100},evidence,supportEvidence:evidence}));
    const positions=ps.slice(0,2).map((p,i)=>({...p,x:i*50,z:0,compartmentId:'c'+i,compartmentKey:compartmentKey(bag.compartments![i])}));
    expect(assessRetrieval(positions,[bag],records).map(c=>c.status)).toEqual(['clear','clear']);
    positions[0].compartmentKey='changed';expect(assessRetrieval(positions,[bag],records).every(c=>c.status==='unknown')).toBe(true);
  });
  it('rejects overlapping, duplicated, stale and missing geometry without a clear result', () => {
    const {bag,ps,records}=fixture();
    for(const positions of [[ps[0],ps[0]], [{...ps[0],length:21}], [{...ps[0],rotation:999}], [{...ps[0],shapeKey:'stale'}], [ps[0],{...ps[1],z:10}]])
      expect(assessRetrieval(positions,[bag],records).every(c=>c.status==='unknown')).toBe(true);
    expect(assessRetrieval(ps,[],records).every(c=>c.status==='unknown')).toBe(true);
    expect(assessRetrieval(ps,[bag,bag],records).every(c=>c.status==='unknown')).toBe(true);
    expect(assessRetrieval(ps,[bag],new Map()).every(c=>c.status==='unknown')).toBe(true);
  });
  it('does not accept invalid or smaller openings', () => {
    const {bag,ps,records}=fixture();
    for(const length of [NaN,0,10])expect(assessRetrieval(ps,[{...bag,opening:{length,width:100}}],records).every(c=>c.status==='unknown')).toBe(true);
  });
  it('invalidates candidate retrieval when saved physical positions are unresolved or duplicated', () => {
    const {bag,item,trip,ps}=fixture(), plan=buildPlan(trip,[item],[bag]);
    trip.lockedPlacements=[{...ps[0],locked:true}] as never;
    let review=reviewRetrieval(trip,[item],[bag],plan);
    expect(review.unresolvedPackedCount).toBe(1);expect(review.checks.every(c=>c.status==='unknown')).toBe(true);
    const locked=buildPlan(trip,[item],[bag]);expect(reviewRetrieval(trip,[item],[bag],locked).unresolvedPackedCount).toBe(0);
    trip.lockedPlacements=[...trip.lockedPlacements,...trip.lockedPlacements] as never;
    review=reviewRetrieval(trip,[item],[bag],locked);expect(review.unresolvedPackedCount).toBe(2);expect(review.checks.every(c=>c.status==='unknown')).toBe(true);
  });
  it('resolves exact preparations and rejects changed form records', () => {
    const {bag,item,trip}=fixture();
    item.packingForms=[{id:'folded',name:'Folded',kind:'folded',reviewedAt:date,preparation:'Fold and check.',dimensions:{length:10,width:10,height:10},dimensionEvidence:evidence,maxTopLoadGrams:10000,topLoadEvidence:evidence}];
    trip.entries[0].packingFormId='folded';const plan=buildPlan(trip,[item],[bag]);expect(plan.placements).toHaveLength(3);
    expect(reviewRetrieval(trip,[item],[bag],plan).checks.every(c=>c.status!=='unknown')).toBe(true);
    item.packingForms[0].preparation='Changed';expect(reviewRetrieval(trip,[item],[bag],plan).checks.every(c=>c.status==='unknown')).toBe(true);
  });
  it('ranks actual priority withdrawal cost rather than identical item height', () => {
    const {bag,item,ps}=fixture(), records=ps.map((p,i)=>({...item,instanceId:p.instanceId,entryId:p.entryId,itemId:p.itemId,travellerId:'you',name:'Item',volumeMm3:8000,priority:'required',required:true,accessPriority:i===0?5:1})) as PlanItem[];
    const blocked=retrievalReward(ps,[bag],records), clear=retrievalReward(ps.map((p,i)=>({...p,x:i*20})),[bag],records);
    expect(clear).toBe(700);expect(blocked).toBeLessThan(clear);
  });
  it('builds deterministic easy-access plans while preserving saved locks and required exclusions', () => {
    const {bag,item,trip}=fixture(), before=JSON.stringify(trip), a=buildPlan(trip,[item],[bag]),b=buildPlan(trip,[item],[bag]);
    expect(a.placements).toEqual(b.placements);expect(a.requiredExcludedCount).toBe(0);expect(a.placements).toHaveLength(3);expect(JSON.stringify(trip)).toBe(before);
    trip.lockedPlacements=[{...a.placements[0],locked:true}] as never;
    expect(buildPlan(trip,[item],[bag]).placements.find(p=>p.instanceId===a.placements[0].instanceId)).toMatchObject({...a.placements[0],locked:true});
    expect(buildPlan(trip,[item],[{...bag,massLimitGrams:50}]).requiredExcludedCount).toBe(3);
  });
});
