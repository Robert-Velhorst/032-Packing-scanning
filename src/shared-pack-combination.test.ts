import {describe,expect,it} from 'vitest';
import {createInitialData} from './seed';
import {createSharedPackBaseline,isSharedPackBaseline,validSharedPackLink} from './shared-pack-baseline';
import {combineReviewedSharedRecords,combinationStillCurrent,recordSharedPublication,reviewSharedCombination,type SharedChoice,type SharedCombinationReview} from './shared-pack-combination';
import {isSharedPackingRecords,openSharedPack,sharedPackingRecords,type SharedPackSnapshot} from './shared-packs';
import {isPackingBackup} from './backup';
import {buildPlan} from './optimizer';
import {setPackingItemComplete} from './packing-progress';

async function fixture(packed=false){
  const privateData=structuredClone(createInitialData());
  if(packed){const t=privateData.trips[0],p=buildPlan(t,privateData.libraryItems,privateData.containers).placements[0];privateData.trips[0]=setPackingItemComplete(t,p.instanceId,true,p);}
  const records=sharedPackingRecords(privateData,privateData.activeTripId),snapshot:SharedPackSnapshot={id:'server-pack',householdId:'family',revision:1,name:records.trip.name,updatedAt:records.trip.updatedAt,updatedBy:'owner',records};
  const base=await createSharedPackBaseline(records,1),data=openSharedPack(privateData,snapshot,'offline-copy',base);
  const remote=structuredClone(snapshot);remote.revision=2;remote.updatedBy='member';
  return {data,privateData,snapshot,base,remote,tripId:data.activeTripId};
}
const resolveLocal=(review:SharedCombinationReview):Record<string,SharedChoice>=>Object.fromEntries(review.changes.filter(c=>c.requiresReview).map(c=>[c.key,'local']));

describe('reviewed household combination',()=>{
  it('combines independent edits without copying private items, photos, scans or baseline hashes into uploads',async()=>{
    const f=await fixture();f.data.trips[0].name='Offline local title';f.remote.records.trip.destination='Synthetic Berlin';
    f.data.libraryItems.find(i=>i.id.startsWith('shared-'))!.photoId='local-only-photo';
    const original=structuredClone(f.data),review=await reviewSharedCombination(f.data,f.tripId,f.remote),records=combineReviewedSharedRecords(review,{});
    expect(records.trip.name).toBe('Offline local title');expect(records.trip.destination).toBe('Synthetic Berlin');expect(review.changes.every(c=>!c.requiresReview)).toBe(true);
    expect(JSON.stringify(records)).not.toContain('local-only-photo');expect(records.trip).not.toHaveProperty('sharedPack');
    const opened=openSharedPack(f.data,{...f.remote,records},'combined',review.remoteBaseline,review);
    expect(opened.trips.slice(1)).toEqual(original.trips);expect(opened.libraryItems.slice(records.libraryItems.length)).toEqual(original.libraryItems);
    expect(opened.trips[0].sharedPack!.revision).toBe(2);expect(opened.trips[0].sharedPack!.baseline).toEqual(review.remoteBaseline);expect(f.data).toEqual(original);
  });
  it('requires a choice when both sides edit the same atomic item and preserves evidence with the chosen geometry',async()=>{
    const f=await fixture(),local=f.data.libraryItems.find(i=>i.id.startsWith('shared-'))!;local.name='Local laptop name';
    f.remote.records.libraryItems[0].dimensions.length+=5;
    const review=await reviewSharedCombination(f.data,f.tripId,f.remote),change=review.changes.find(c=>c.kind==='item')!;
    expect(change.conflict).toBe(true);expect(change.requiresReview).toBe(true);expect(()=>combineReviewedSharedRecords(review,{})).toThrow(/Choose/);
    const result=combineReviewedSharedRecords(review,{[change.key]:'shared'});expect(result.libraryItems[0]).toEqual(f.remote.records.libraryItems[0]);
  });
  it('does not turn different timestamps or object-key order into semantic conflicts',async()=>{
    const f=await fixture(),item=f.data.libraryItems.find(i=>i.id.startsWith('shared-'))!;
    item.updatedAt='2026-10-01T19:00:00Z';f.remote.records.libraryItems[0].updatedAt='2026-10-01T20:00:00Z';
    f.remote.records.trip={...Object.fromEntries(Object.entries(f.remote.records.trip).reverse())} as typeof f.remote.records.trip;
    expect((await reviewSharedCombination(f.data,f.tripId,f.remote)).changes).toHaveLength(0);
  });
  it('preserves every local packed position and refuses a remote relocation or removal',async()=>{
    const f=await fixture(true),original=sharedPackingRecords(f.data,f.tripId).trip.lockedPlacements[0];
    f.remote.records.trip.lockedPlacements[0].x+=1;
    const review=await reviewSharedCombination(f.data,f.tripId,f.remote),row=review.changes.find(c=>c.protectedPosition)!;
    expect(row.requiresReview).toBe(true);expect(()=>combineReviewedSharedRecords(review,{[row.key]:'shared'})).toThrow(/saved local packed position/);
    const records=combineReviewedSharedRecords(review,resolveLocal(review));expect(records.trip.lockedPlacements[0]).toEqual(original);
    f.remote.records.trip.lockedPlacements=[];f.remote.records.trip.completedInstanceIds=[];
    const removal=await reviewSharedCombination(f.data,f.tripId,f.remote);expect(combineReviewedSharedRecords(removal,resolveLocal(removal)).trip.lockedPlacements[0]).toEqual(original);
  });
  it('protects a newly packed local position even when the peer has not changed it',async()=>{
    const f=await fixture(),t=f.data.trips[0],p=buildPlan(t,f.data.libraryItems,f.data.containers).placements[0];f.data.trips[0]=setPackingItemComplete(t,p.instanceId,true,p);
    const review=await reviewSharedCombination(f.data,f.tripId,f.remote),row=review.changes.find(c=>c.protectedPosition)!;
    expect(row).toBeDefined();expect(()=>combineReviewedSharedRecords(review,{[row.key]:'shared'})).toThrow(/saved local packed position/);
    expect(combineReviewedSharedRecords(review,resolveLocal(review)).trip.completedInstanceIds).toContain(sharedPackingRecords(f.data,f.tripId).trip.completedInstanceIds[0]);
  });
  it('requires explicit review before deleting required belongings and holds invalid related choices',async()=>{
    const f=await fixture(),entry=f.remote.records.trip.entries.find(e=>e.required||e.priority==='required')!;
    f.remote.records.trip.entries=f.remote.records.trip.entries.filter(e=>e.id!==entry.id);
    const ids=new Set(f.remote.records.trip.entries.map(e=>e.itemId));f.remote.records.libraryItems=f.remote.records.libraryItems.filter(i=>ids.has(i.id));
    expect(isSharedPackingRecords(f.remote.records)).toBe(true);
    const review=await reviewSharedCombination(f.data,f.tripId,f.remote),required=review.changes.find(c=>c.kind==='entry'&&(c.local as {id?:string})?.id===entry.id)!;
    expect(required.safetyChange).toBe(true);expect(()=>combineReviewedSharedRecords(review,{})).toThrow(/Choose/);
    const local=resolveLocal(review);expect(combineReviewedSharedRecords(review,local).trip.entries.some(e=>e.id===entry.id)).toBe(true);
    for(const c of review.changes.filter(c=>c.kind==='item'))local[c.key]='shared';
    expect(()=>combineReviewedSharedRecords(review,local)).toThrow(/missing or conflicting/);
  });
  it('requires explicit review of relaxed fragility, upright, stacking and bag limits',async()=>{
    const f=await fixture(),local=f.data.libraryItems.find(i=>i.id.startsWith('shared-'))!;local.keepUpright=true;local.maxTopLoadGrams=10;
    local.topLoadEvidence={source:'user_confirmed',confidence:1,collectedAt:'2026-10-01T12:00:00Z'};
    f.remote.records.libraryItems[0].fragile=false;f.remote.records.libraryItems[0].maxTopLoadGrams=100;
    f.remote.records.libraryItems[0].topLoadEvidence={...local.topLoadEvidence};
    f.remote.records.containers[0].massLimitGrams=50000;
    const review=await reviewSharedCombination(f.data,f.tripId,f.remote);expect(review.changes.filter(c=>c.kind==='item'||c.kind==='bag').every(c=>c.requiresReview)).toBe(true);
  });
  it('supports independent additions from both copies with valid remapped references',async()=>{
    const f=await fixture(),t=f.data.trips[0],base=t.entries[0];
    t.entries.push({...base,id:'local-entry',required:false,priority:'optional'});
    f.remote.records.trip.entries.push({...f.remote.records.trip.entries[0],id:'remote-entry',required:false,priority:'optional'});
    const review=await reviewSharedCombination(f.data,f.tripId,f.remote),records=combineReviewedSharedRecords(review,resolveLocal(review));
    expect(records.trip.entries.map(e=>e.id)).toEqual(expect.arrayContaining(['local-entry','remote-entry']));expect(isSharedPackingRecords(records)).toBe(true);
    const opened=openSharedPack(f.data,{...f.remote,records},'additions',review.remoteBaseline);expect(isSharedPackingRecords(sharedPackingRecords(opened,opened.activeTripId))).toBe(true);
  });
  it('retains locked coordinates and required entries through all packing approaches and backup restore',async()=>{
    const f=await fixture(true),review=await reviewSharedCombination(f.data,f.tripId,f.remote),records=combineReviewedSharedRecords(review,resolveLocal(review));
    const opened=openSharedPack(f.data,{...f.remote,records},'restored-combination',review.remoteBaseline),restored=JSON.parse(JSON.stringify({format:'packing-scanning-backup',app:opened,photos:[]}));
    expect(isPackingBackup(restored)).toBe(true);const trip=restored.app.trips[0],locked=trip.lockedPlacements[0];
    for(const mode of ['maximum_capacity','easy_access','balanced','fragile_protection'] as const){
      const plan=buildPlan({...trip,mode},restored.app.libraryItems,restored.app.containers),p=plan.placements.find(p=>p.instanceId===locked.instanceId)!;
      expect(p).toMatchObject({x:locked.x,y:locked.y,z:locked.z,length:locked.length,width:locked.width,height:locked.height});
      expect(plan.requiredExcludedCount).toBe(0);
    }
    expect(sharedPackingRecords(restored.app,trip.id).trip.entries.filter(e=>e.required)).toEqual(records.trip.entries.filter(e=>e.required));
  });
  it('rejects stale local reviews, different packs, identity changes and non-newer versions',async()=>{
    const f=await fixture(),review=await reviewSharedCombination(f.data,f.tripId,f.remote);expect(combinationStillCurrent(f.data,review)).toBe(true);
    f.data.trips[0].name='Changed after review';expect(combinationStillCurrent(f.data,review)).toBe(false);
    expect(openSharedPack(f.data,f.remote,'stale',review.remoteBaseline,review)).toBe(f.data);
    const invalid=structuredClone(f.data);invalid.trips[0].entries[0].itemId='missing-item';expect(combinationStillCurrent(invalid,review)).toBe(false);expect(openSharedPack(invalid,f.remote,'invalid-stale',review.remoteBaseline,review)).toBe(invalid);
    for(const remote of [{...f.remote,id:'different'},{...f.remote,householdId:'different'},{...f.remote,revision:1},{...f.remote,records:{...f.remote.records,trip:{...f.remote.records.trip,id:'changed-identity'}}}])await expect(reviewSharedCombination(f.data,f.tripId,remote)).rejects.toThrow(/newer version/);
  });
  it('retains edits made during publication and records exactly the acknowledged baseline',async()=>{
    const f=await fixture(),submitted=sharedPackingRecords(f.data,f.tripId),ack={...f.remote,records:submitted},baseline=await createSharedPackBaseline(submitted,2);
    f.data.trips[0].name='Later offline edit';const updated=recordSharedPublication(f.data,f.tripId,ack,baseline);
    expect(updated.trips[0].name).toBe('Later offline edit');expect(updated.trips[0].sharedPack?.baseline).toEqual(baseline);
    const newer={...f.remote,revision:3};const review=await reviewSharedCombination(updated,updated.activeTripId,newer);expect(combineReviewedSharedRecords(review,resolveLocal(review)).trip.name).toBe('Later offline edit');
    updated.trips[0].sharedPack!.revision=4;expect(recordSharedPublication(updated,f.tripId,ack,baseline).trips[0].sharedPack?.revision).toBe(4);
  });
  it('validates local backup baselines and keeps older copies available without inventing history',async()=>{
    const f=await fixture(),backup={format:'packing-scanning-backup',app:f.data,photos:[]};expect(isPackingBackup(JSON.parse(JSON.stringify(backup)))).toBe(true);
    f.data.trips[0].sharedPack!.baseline!.revision=2;expect(isPackingBackup(backup)).toBe(false);
    delete f.data.trips[0].sharedPack!.baseline;expect(isPackingBackup(backup)).toBe(true);await expect(reviewSharedCombination(f.data,f.tripId,f.remote)).rejects.toThrow(/older local copy/);
  });
  it('rejects malformed hashes, unknown baseline fields and invalid resolutions',async()=>{
    const f=await fixture();expect(isSharedPackBaseline(f.base)).toBe(true);expect(validSharedPackLink(f.data.trips[0].sharedPack)).toBe(true);
    for(const b of [{...f.base,method:'other'},{...f.base,private:'secret'},{...f.base,hashes:{...f.base.hashes,bad:'0'.repeat(64)}},{...f.base,hashes:{...f.base.hashes,[JSON.stringify(['name','pack'])]:'not-sha256'}}])expect(isSharedPackBaseline(b)).toBe(false);
    const review=await reviewSharedCombination(f.data,f.tripId,f.remote);expect(()=>combineReviewedSharedRecords(review,{unknown:'local'})).toThrow(/comparison changed/);
  });
});
