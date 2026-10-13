import type { SharedPackingRecords } from './shared-packs.ts';

export interface SharedPackBaseline {
  method: 'shared_pack_baseline_v1';
  revision: number;
  tripId: string;
  hashes: Record<string,string>;
}
export type SharedUnitKind='identity'|'name'|'context'|'mode'|'traveller'|'entry'|'item'|'bag'|'carrier'|'separation'|'progress';
export interface SharedUnit { key:string;kind:SharedUnitKind;id:string;value:unknown;hashValue:unknown; }
const kinds:SharedUnitKind[]=['identity','name','context','mode','traveller','entry','item','bag','carrier','separation','progress'];
export function canonicalSharedValue(value:unknown):string {
  const ordered=(v:unknown):unknown=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>(v as Record<string,unknown>)[k]!==undefined).map(k=>[k,ordered((v as Record<string,unknown>)[k])])):v;
  return JSON.stringify(ordered(value))??'undefined';
}
export function sharedUnits(records:SharedPackingRecords):Map<string,SharedUnit> {
  const units=new Map<string,SharedUnit>();
  const add=(kind:SharedUnitKind,id:string,value:unknown,hashValue=value)=>{const key=JSON.stringify([kind,id]);units.set(key,{key,kind,id,value,hashValue});};
  const t=records.trip;
  add('identity','pack',{id:t.id,createdAt:t.createdAt});add('name','pack',t.name);add('mode','pack',t.mode);
  add('context','pack',{destination:t.destination,startDate:t.startDate,endDate:t.endDate,packingOnly:t.packingOnly,activities:t.activities,laundryAvailable:t.laundryAvailable,weather:t.weather});
  for(const person of t.travellers)add('traveller',person.id,person);
  for(const entry of t.entries)add('entry',entry.id,entry);
  for(const item of records.libraryItems){const {updatedAt:ignored,...semantic}=item;void ignored;add('item',item.id,item,semantic);}
  for(const bag of records.containers)add('bag',bag.id,bag);
  for(const rule of t.carrierRules)add('carrier',rule.id,rule);
  for(const rule of t.separationRules??[])add('separation',rule.id,rule);
  for(const entry of t.entries)for(let n=1;n<=entry.quantity;n++){
    const id=`${entry.id}#${n}`;
    add('progress',id,{completed:t.completedInstanceIds.includes(id),unavailable:t.unavailableInstanceIds.includes(id),locked:t.lockedPlacements.find(p=>p.instanceId===id),rejected:t.rejectedPlacements?.find(p=>p.instanceId===id)});
  }
  return units;
}
export async function hashSharedValue(value:unknown):Promise<string> {
  if(!globalThis.crypto?.subtle)throw Error('This installation cannot prepare a private comparison baseline. Open a separate copy instead.');
  const bytes=new TextEncoder().encode(canonicalSharedValue(value));
  try{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
  finally{bytes.fill(0);}
}
export async function createSharedPackBaseline(records:SharedPackingRecords,revision:number):Promise<SharedPackBaseline> {
  if(!Number.isSafeInteger(revision)||revision<1)throw Error('Invalid shared pack version.');
  const units=[...sharedUnits(records).values()];if(units.length>10000)throw Error('This pack is too large for combined-copy review. Open a separate copy instead.');
  const hashes:Record<string,string>={};
  for(let start=0;start<units.length;start+=50)for(const [key,hash] of await Promise.all(units.slice(start,start+50).map(async u=>[u.key,await hashSharedValue(u.hashValue)] as const)))hashes[key]=hash;
  return {method:'shared_pack_baseline_v1',revision,tripId:records.trip.id,hashes};
}
export function isSharedPackBaseline(value:unknown):value is SharedPackBaseline {
  try{
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const b=value as SharedPackBaseline;
    if(Object.keys(b).sort().join(',')!=='hashes,method,revision,tripId'||b.method!=='shared_pack_baseline_v1'||!Number.isSafeInteger(b.revision)||b.revision<1||typeof b.tripId!=='string'||!b.tripId||b.tripId.length>160||!b.hashes||typeof b.hashes!=='object'||Array.isArray(b.hashes))return false;
    const entries=Object.entries(b.hashes);if(entries.length<4||entries.length>10000)return false;
    if(!['identity','name','context','mode'].every(k=>Object.hasOwn(b.hashes,JSON.stringify([k,'pack']))))return false;
    return entries.every(([key,hash])=>{if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))return false;const tuple=JSON.parse(key);return Array.isArray(tuple)&&tuple.length===2&&kinds.includes(tuple[0])&&typeof tuple[1]==='string'&&tuple[1].length>0&&tuple[1].length<=184&&JSON.stringify(tuple)===key&&(!['identity','name','context','mode'].includes(tuple[0])||tuple[1]==='pack');});
  }catch{return false;}
}
export function validSharedPackLink(value:unknown):boolean {
  if(value===undefined)return true;
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const l=value as {householdId:string;packId:string;revision:number;idPrefix:string;baseline?:SharedPackBaseline};
  return Object.keys(l).every(k=>['householdId','packId','revision','idPrefix','baseline'].includes(k))
    &&[l.householdId,l.packId].every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(id))
    &&Number.isSafeInteger(l.revision)&&l.revision>=1&&typeof l.idPrefix==='string'&&l.idPrefix.startsWith('shared-')&&l.idPrefix.endsWith(':')&&l.idPrefix.length<=200
    &&(l.baseline===undefined||isSharedPackBaseline(l.baseline)&&l.baseline.revision===l.revision);
}
