import type {AppData,LibraryItem,Container,Trip,Placement,PackEntry,Traveller,CarrierRule,SeparationRule} from './types.ts';
import {isSharedPackSnapshot,isSharedPackingRecords,sharedPackingRecords,type SharedPackSnapshot,type SharedPackingRecords} from './shared-packs.ts';
import {canonicalSharedValue,createSharedPackBaseline,hashSharedValue,isSharedPackBaseline,sharedUnits,type SharedPackBaseline,type SharedUnit,type SharedUnitKind} from './shared-pack-baseline.ts';

export type SharedChoice='local'|'shared';
export interface SharedCombinationChange {key:string;kind:SharedUnitKind;label:string;local?:unknown;shared?:unknown;conflict:boolean;protectedPosition:boolean;requiresReview:boolean;safetyChange:boolean;defaultChoice:SharedChoice;changedFields:string[];}
export interface SharedCombinationReview {
  tripId:string;
  localCanonical:string;
  linkCanonical:string;
  remote:SharedPackSnapshot;
  remoteBaseline:SharedPackBaseline;
  local:SharedPackingRecords;
  changes:SharedCombinationChange[];
}
const labelFor=(unit:SharedUnit|undefined,local:SharedPackingRecords,remote:SharedPackingRecords):string=>{
  if(!unit)return 'Removed record';const v=unit.value as {name?:string;itemId?:string;travellerId?:string};
  const names={identity:'Pack identity',name:'Pack name',context:'Trip details and saved weather',mode:'Packing approach',traveller:'Traveller',entry:'Checklist entry',item:'Item measurements, handling and geometry',bag:'Bag measurements, limits and geometry',carrier:'Carrier rule',separation:'Keep-apart rule',progress:'Packing progress'};
  let suffix=v?.name;
  if(unit.kind==='entry')suffix=[...local.libraryItems,...remote.libraryItems].find(i=>i.id===v.itemId)?.name;
  if(unit.kind==='progress'){const entryId=unit.id.slice(0,unit.id.lastIndexOf('#')),entry=[...local.trip.entries,...remote.trip.entries].find(e=>e.id===entryId);suffix=entry&&[...local.libraryItems,...remote.libraryItems].find(i=>i.id===entry.itemId)?.name;suffix=(suffix??'Item')+' · copy '+unit.id.slice(unit.id.lastIndexOf('#')+1);}
  return names[unit.kind]+(suffix?' · '+suffix:'');
};
function needsConstraintReview(l:SharedUnit|undefined,r:SharedUnit|undefined,records:SharedPackingRecords):boolean {
  if(!l)return false;
  if(l.kind==='entry'){const e=l.value as PackEntry;return e.required||e.priority==='required'||!!e.containerId||!!e.compartmentId;}
  if(l.kind==='separation'||l.kind==='carrier')return true;
  if(l.kind==='item'){
    const a=l.value as LibraryItem,b=r?.value as LibraryItem|undefined;
    return !b||a.fragile&&!b.fragile||a.keepUpright&&!b.keepUpright||a.maxTopLoadGrams!==undefined&&(b.maxTopLoadGrams===undefined||b.maxTopLoadGrams>a.maxTopLoadGrams)
      ||records.trip.lockedPlacements.some(p=>p.itemId===l.id);
  }
  if(l.kind==='bag'){
    const a=l.value as Container,b=r?.value as Container|undefined;
    return !b||a.massLimitGrams!==undefined&&(b.massLimitGrams===undefined||b.massLimitGrams>a.massLimitGrams)
      ||(a.lidClearanceMm??0)>(b.lidClearanceMm??0)||!!a.unavailableSpaces?.length&&canonicalSharedValue(a.unavailableSpaces)!==canonicalSharedValue(b.unavailableSpaces)
      ||!!a.compartments?.length&&canonicalSharedValue(a.compartments)!==canonicalSharedValue(b.compartments)
      ||records.trip.lockedPlacements.some(p=>p.containerId===l.id);
  }
  return false;
}
export async function reviewSharedCombination(data:AppData,tripId:string,remote:SharedPackSnapshot):Promise<SharedCombinationReview> {
  const source=data.trips.find(t=>t.id===tripId),link=source?.sharedPack;
  if(!link||!isSharedPackBaseline(link.baseline)||link.baseline.revision!==link.revision)throw Error('This older local copy has no comparison baseline. Open the current shared version as a separate copy; earlier work remains available.');
  if(!isSharedPackSnapshot(remote)||remote.id!==link.packId||remote.householdId!==link.householdId||remote.revision<=link.revision||remote.records.trip.id!==link.baseline.tripId)throw Error('Choose a newer version of this same shared pack. Local records are unchanged.');
  const local=sharedPackingRecords(data,tripId);if(local.trip.id!==link.baseline.tripId)throw Error('The local pack identity changed. Open a separate copy instead.');
  const localUnits=sharedUnits(local),remoteUnits=sharedUnits(remote.records),remoteBaseline=await createSharedPackBaseline(remote.records,remote.revision);
  const keys=new Set([...Object.keys(link.baseline.hashes),...localUnits.keys(),...remoteUnits.keys()]),changes:SharedCombinationChange[]=[];
  const units=[...localUnits.values()],localHashes:Record<string,string>={};
  for(let n=0;n<units.length;n+=50)for(const [key,hash] of await Promise.all(units.slice(n,n+50).map(async u=>[u.key,await hashSharedValue(u.hashValue)] as const)))localHashes[key]=hash;
  for(const key of keys){
    const l=localUnits.get(key),r=remoteUnits.get(key),base=link.baseline.hashes[key],lh=localHashes[key],rh=remoteBaseline.hashes[key];
    if(lh===rh)continue;
    const localChanged=lh!==base,sharedChanged=rh!==base;
    const protectedPosition=l?.kind==='progress'&&!!(l.value as {locked?:Placement}).locked;
    const safetyChange=sharedChanged&&needsConstraintReview(l,r,local);
    const kind=(l??r)?.kind??(JSON.parse(key)[0] as SharedUnitKind);
    const lv=l?.hashValue as Record<string,unknown>|undefined,rv=r?.hashValue as Record<string,unknown>|undefined;
    const changedFields=lv&&rv&&typeof lv==='object'&&typeof rv==='object'?Array.from(new Set([...Object.keys(lv),...Object.keys(rv)])).filter(field=>canonicalSharedValue(lv[field])!==canonicalSharedValue(rv[field])):[];
    const conflict=localChanged&&sharedChanged;
    changes.push({key,kind,label:labelFor(l??r,local,remote.records),local:l?.value,shared:r?.value,conflict,protectedPosition:!!protectedPosition,safetyChange,requiresReview:conflict||!!protectedPosition||safetyChange,defaultChoice:localChanged?'local':'shared',changedFields});
  }
  return {tripId,localCanonical:canonicalSharedValue(local),linkCanonical:canonicalSharedValue(link),remote:structuredClone(remote),remoteBaseline,local,changes};
}
export function combinationStillCurrent(data:AppData,review:SharedCombinationReview):boolean {
  try{const trip=data.trips.find(t=>t.id===review.tripId);return !!trip&&canonicalSharedValue(trip.sharedPack)===review.linkCanonical&&canonicalSharedValue(sharedPackingRecords(data,review.tripId))===review.localCanonical;}catch{return false;}
}
/** Acknowledgement retains edits made while the publication request was in flight. */
export function recordSharedPublication(data:AppData,tripId:string,snapshot:SharedPackSnapshot,baseline:SharedPackBaseline):AppData {
  if(!isSharedPackSnapshot(snapshot)||!isSharedPackBaseline(baseline)||baseline.revision!==snapshot.revision||baseline.tripId!==snapshot.records.trip.id)throw Error('The published shared version could not be confirmed. Reload the household before retrying.');
  return {...data,trips:data.trips.map(trip=>{const link=trip.sharedPack;return trip.id===tripId&&link&&link.packId===snapshot.id&&link.householdId===snapshot.householdId&&link.revision<snapshot.revision
    ?{...trip,sharedPack:{...link,revision:snapshot.revision,baseline:structuredClone(baseline)}}:trip;})};
}
export function combineReviewedSharedRecords(review:SharedCombinationReview,choices:Record<string,SharedChoice>):SharedPackingRecords {
  if(Object.keys(choices).some(key=>!review.changes.some(c=>c.key===key)))throw Error('The comparison changed. Review it again.');
  const selected=sharedUnits(review.local),incoming=sharedUnits(review.remote.records);
  for(const change of review.changes){
    const choice=choices[change.key]??(change.requiresReview?undefined:change.defaultChoice);
    if(!choice||!['local','shared'].includes(choice))throw Error('Choose how to handle every conflict, required-item or constraint change.');
    if(change.protectedPosition&&choice!=='local')throw Error('Keep the saved local packed position. Unlock or correct that physical placement in the earlier copy before combining a different position.');
    const unit=choice==='local'?selected.get(change.key):incoming.get(change.key);
    if(unit)selected.set(change.key,unit);else selected.delete(change.key);
  }
  const values=<T>(kind:SharedUnitKind)=>[...selected.values()].filter(u=>u.kind===kind).map(u=>structuredClone(u.value) as T);
  const pack=<T>(kind:SharedUnitKind)=>selected.get(JSON.stringify([kind,'pack']))?.value as T;
  const identity=pack<{id:string;createdAt:string}>('identity'),context=pack<Pick<Trip,'destination'|'startDate'|'endDate'|'packingOnly'|'activities'|'laundryAvailable'|'weather'>>('context');
  if(!identity||!context||!pack('name')||!pack('mode'))throw Error('The combined copy must retain its pack identity, name, trip settings and approach.');
  const entries=values<PackEntry>('entry'),progress=values<{completed:boolean;unavailable:boolean;locked?:Placement;rejected?:Placement}>('progress'),containers=values<Container>('bag');
  const instanceIds=new Set(entries.flatMap(e=>Array.from({length:e.quantity},(_,i)=>`${e.id}#${i+1}`)));
  // Preserve the local instruction selection where it still refers to a selected item.
  const trip:Trip={...structuredClone(context),...identity,name:pack<string>('name'),mode:pack<Trip['mode']>('mode'),sample:false,
    travellers:values<Traveller>('traveller'),containerIds:containers.map(b=>b.id),entries,
    completedInstanceIds:[...selected.values()].filter(u=>u.kind==='progress'&&(u.value as {completed:boolean}).completed).map(u=>u.id),
    unavailableInstanceIds:[...selected.values()].filter(u=>u.kind==='progress'&&(u.value as {unavailable:boolean}).unavailable).map(u=>u.id),
    lockedPlacements:progress.flatMap(p=>p.locked?[p.locked]:[]),rejectedPlacements:progress.flatMap(p=>p.rejected?[p.rejected]:[]),
    ...(review.local.trip.packingCursor&&instanceIds.has(review.local.trip.packingCursor)?{packingCursor:review.local.trip.packingCursor}:{}),
    carrierRules:values<CarrierRule>('carrier'),separationRules:values<SeparationRule>('separation'),
    updatedAt:new Date(Math.max(Date.parse(review.local.trip.updatedAt),Date.parse(review.remote.records.trip.updatedAt))).toISOString()};
  const referenced=new Set(entries.map(e=>e.itemId)),records:SharedPackingRecords={format:'packing-scanning-shared-pack',trip,containers,libraryItems:values<LibraryItem>('item').filter(i=>referenced.has(i.id))};
  if(!isSharedPackingRecords(records))throw Error('These choices leave missing or conflicting item, traveller, bag or packed-position references. Keep the related local records or review different choices; earlier copies remain unchanged.');
  if(new TextEncoder().encode(JSON.stringify({records,consent:true,revision:review.remote.revision})).length>8*1024*1024)throw Error('The combined records exceed the shared-pack size limit. Choose smaller records or keep separate copies.');
  return records;
}
