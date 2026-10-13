import {describe,expect,it} from 'vitest';
import {createInitialData} from './seed';
import {isSharedPackingRecords,openSharedPack,sharedPackingRecords,type SharedPackSnapshot} from './shared-packs';
import {buildPlan} from './optimizer';
import {isPackingBackup} from './backup';
describe('selected household packing records',()=>{
  it('shares only referenced records and preserves private source records and preferences',()=>{
    const data=structuredClone(createInitialData());data.libraryItems[0].photoId='private-photo';data.libraryItems[0].scan={id:'private-scan',target:'item',createdAt:new Date().toISOString(),platform:'android',method:'arcore_depth',completedPasses:1,modelStoredLocally:true};
    data.libraryItems.push({...data.libraryItems[0],id:'unused-private-kit',name:'Unshared private medicine'});data.trips.push({...structuredClone(data.trips[0]),id:'private-trip',name:'Unshared travel'});
    const before=structuredClone(data),records=sharedPackingRecords(data,data.activeTripId);
    expect(data).toEqual(before);expect(records.libraryItems.some(item=>item.id==='unused-private-kit')).toBe(false);expect(JSON.stringify(records)).not.toContain('Unshared');expect(JSON.stringify(records)).not.toContain('private-photo');expect(JSON.stringify(records)).not.toContain('private-scan');expect(records).not.toHaveProperty('settings');expect(isSharedPackingRecords(records)).toBe(true);
  });
  it('opens independent offline copies and round-trips IDs, confirmed geometry and handling evidence',()=>{
    const data=structuredClone(createInitialData()),trip=data.trips[0],plan=buildPlan(trip,data.libraryItems,data.containers),placement=plan.placements[0];trip.lockedPlacements=[{...placement,locked:true}];trip.completedInstanceIds=[placement.instanceId];trip.packingCursor=placement.instanceId;
    const records=sharedPackingRecords(data,trip.id),snapshot:SharedPackSnapshot={id:'server-pack',householdId:'household',name:trip.name,revision:1,updatedAt:trip.updatedAt,updatedBy:'owner',records};
    const first=openSharedPack(data,snapshot,'copy-one'),second=openSharedPack(first,{...snapshot,revision:2},'copy-two');
    expect(second.trips).toHaveLength(data.trips.length+2);expect(second.trips.slice(1)).toEqual(first.trips);expect(first.trips[1]).toEqual(data.trips[0]);expect(sharedPackingRecords(first,first.activeTripId)).toEqual({...records,trip:{...records.trip,sample:false}});
    expect(buildPlan(first.trips[0],first.libraryItems,first.containers).placements[0]).toMatchObject({x:placement.x,y:placement.y,z:placement.z,locked:true});
    const restored=JSON.parse(JSON.stringify({format:'packing-scanning-backup',app:second,photos:[]}));
    expect(isPackingBackup(restored)).toBe(true);expect(restored.app.trips[0].sharedPack).toEqual(second.trips[0].sharedPack);
    expect(sharedPackingRecords(restored.app,restored.app.activeTripId)).toEqual(sharedPackingRecords(second,second.activeTripId));
    expect(buildPlan(restored.app.trips[0],restored.app.libraryItems,restored.app.containers).placements[0]).toMatchObject({x:placement.x,y:placement.y,z:placement.z,locked:true});
    expect(()=>openSharedPack(first,snapshot,'copy-one')).toThrow(/fresh local copy/);
  });
  it('rejects malformed references, duplicate IDs, invalid quantities, unknown private fields and progress',()=>{
    const records=sharedPackingRecords(createInitialData(),'sample-trip');
    for(const mutate of [(r:typeof records)=>{r.trip.entries[0].itemId='missing';},(r:typeof records)=>{r.trip.entries[0].travellerId='missing';},(r:typeof records)=>{r.trip.entries[0].quantity=0;},(r:typeof records)=>{r.trip.completedInstanceIds=['orphan#1'];},(r:typeof records)=>{r.libraryItems.push(r.libraryItems[0]);},(r:typeof records)=>{r.libraryItems[0].photoId='private';},(r:typeof records)=>{(r.trip as unknown as Record<string,unknown>).secret='not a shared field';},(r:typeof records)=>{r.trip.entries=[null as never];},(r:typeof records)=>{r.trip.activities={} as never;},(r:typeof records)=>{(r.libraryItems[0].dimensions as unknown as Record<string,unknown>).sourceImage='private';}]){const draft=structuredClone(records);mutate(draft);expect(isSharedPackingRecords(draft)).toBe(false);}
  });
});
