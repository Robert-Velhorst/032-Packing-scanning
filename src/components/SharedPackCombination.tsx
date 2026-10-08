import {useEffect,useMemo,useRef,useState} from 'react';
import {accountRequest,AccountRequestError} from '../account-client';
import {isSharedPackSnapshot,type SharedPackSnapshot,type SharedCopyWitness} from '../shared-packs';
import {validSharedPackLink,type SharedPackBaseline} from '../shared-pack-baseline';
import {reviewSharedCombination,combineReviewedSharedRecords,combinationStillCurrent,type SharedCombinationReview,type SharedCombinationChange,type SharedChoice} from '../shared-pack-combination';
import type {AppData} from '../types';
import {useDeviceWorkspace} from './DeviceWorkspace';

function describe(value:unknown):string {
  if(value===undefined)return 'Record removed.';
  if(typeof value==='string')return value.replaceAll('_',' ');
  const v=value as Record<string,unknown>,parts:string[]=[];
  if(typeof v.name==='string')parts.push(v.name);
  if(typeof v.destination==='string'){if(v.packingOnly)parts.push('Packing only');parts.push(v.destination||'No destination');}
  if(v.createdAt&&!v.name)parts.push('Created '+String(v.createdAt));
  if(v.startDate||v.endDate)parts.push([v.startDate,v.endDate].filter(Boolean).join(' to '));
  if(Array.isArray(v.activities)&&v.activities.length)parts.push('Activities: '+v.activities.map(a=>String(a).replaceAll('_',' ')).join(', '));
  if(typeof v.laundryAvailable==='boolean')parts.push(v.laundryAvailable?'Laundry available':'Laundry unavailable');
  if(v.weather){const weather=v.weather as {destination?:string;forecast?:{provider:string;retrievedAt:string;days:unknown[]}};parts.push('Saved weather for '+(weather.destination||'the recorded place'));if(weather.forecast)parts.push(`${weather.forecast.provider} · ${weather.forecast.days.length} forecast days · retrieved ${weather.forecast.retrievedAt}`);}
  if(v.dimensions||v.inside){const d=(v.dimensions??v.inside) as {length:number;width:number;height:number};parts.push([d.length,d.width,d.height].map(n=>Number(n.toFixed(2))).join(' × ')+' mm');}
  if(v.massGrams!==undefined)parts.push(String(v.massGrams)+' g');
  if(typeof v.quantity==='number')parts.push(`${v.quantity} copies · ${v.required||v.priority==='required'?'required':String(v.priority)}`);
  if(v.containerId)parts.push('Assigned to a bag');if(v.compartmentId)parts.push('Assigned to a compartment');
  if(v.fragile)parts.push('Fragile');if(v.keepUpright)parts.push('Keep upright');
  if(v.maxTopLoadGrams!==undefined)parts.push(`Recorded stacking limit ${v.maxTopLoadGrams} g`);
  if(v.massLimitGrams!==undefined)parts.push(`Bag limit ${v.massLimitGrams} g`);
  if(v.lidClearanceMm!==undefined)parts.push(`Lid clearance ${v.lidClearanceMm} mm`);
  for(const key of ['compartments','unavailableSpaces','packingForms'])if(Array.isArray(v[key]))parts.push(`${key==='unavailableSpaces'?'Unavailable areas':key==='packingForms'?'Preparation forms':'Compartments'}: ${(v[key] as {name:string}[]).map(r=>r.name).join(', ')||'none'}`);
  if(v.packingShape)parts.push('Adopted occupied geometry recorded');if(v.packingInterior)parts.push('Adopted bag cavity recorded');
  if(v.carrier)parts.push(String(v.carrier));if(v.fare)parts.push(String(v.fare));if(v.kind&&v.firstEntryId)parts.push(String(v.kind).replaceAll('_',' '));
  if(v.clearanceMm!==undefined)parts.push(`Keep-apart clearance ${v.clearanceMm} mm`);
  if(v.limits){const limits=v.limits as {maxBagCount?:number;maxWeightGrams?:number;maxOuterLinearSumMm?:number;maxOuterDimensionsMm?:{length:number;width:number;height:number}};if(limits.maxBagCount!==undefined)parts.push(`${limits.maxBagCount} bags allowed`);if(limits.maxWeightGrams!==undefined)parts.push(`Carrier weight limit ${limits.maxWeightGrams} g`);if(limits.maxOuterLinearSumMm!==undefined)parts.push(`Outer size sum ${limits.maxOuterLinearSumMm} mm`);if(limits.maxOuterDimensionsMm)parts.push('Outer limit '+Object.values(limits.maxOuterDimensionsMm).join(' × ')+' mm');}
  if(Object.hasOwn(v,'completed')){
    parts.push(v.unavailable?'Unavailable':v.completed?'Marked packed':'Not marked packed');
    if(v.locked){const p=v.locked as {x:number;y:number;z:number;length:number;width:number;height:number;rotation:number};parts.push(`Saved position ${p.x}, ${p.y}, ${p.z} mm · ${p.length} × ${p.width} × ${p.height} mm · rotation ${p.rotation}`);}
    if(v.rejected)parts.push('Recorded failed placement');
  }
  return parts.join(' · ')||'Recorded values and evidence.';
}
const fieldNames:Record<string,string>={itemId:'item reference',travellerId:'traveller',containerId:'bag assignment',compartmentId:'compartment assignment',dimensionEvidence:'size evidence',insideEvidence:'inside-size evidence',massEvidence:'weight evidence',massGrams:'weight',massRangeGrams:'weight range',keepUpright:'upright handling',keepUprightEvidence:'upright evidence',packingShape:'adopted item geometry',packingInterior:'adopted interior geometry',packingForms:'preparation forms',maxTopLoadGrams:'stacking limit',topLoadEvidence:'stacking evidence',massLimitGrams:'bag weight limit',locked:'saved position',rejected:'failed placement',unavailableSpaces:'unavailable space',lidClearanceMm:'lid clearance',startDate:'start date',endDate:'end date'};
function fieldText(change:SharedCombinationChange){return change.changedFields.map(f=>fieldNames[f]??f.replace(/([A-Z])/g,' $1').toLowerCase()).join(', ');}

export function SharedPackCombination({data,tripId,onOpen,onExpired}:{data:AppData;tripId:string;onOpen:(snapshot:SharedPackSnapshot,baseline?:SharedPackBaseline,witness?:SharedCopyWitness)=>void;onExpired:()=>void}) {
  const device=useDeviceWorkspace(),trip=data.trips.find(t=>t.id===tripId),link=trip?.sharedPack;
  const [review,setReview]=useState<SharedCombinationReview>(),[choices,setChoices]=useState<Record<string,SharedChoice>>({}),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [offset,setOffset]=useState(0),[onlyReview,setOnlyReview]=useState(false);
  const latest=useRef(data),alive=useRef(true),generation=useRef(0);latest.current=data;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  useEffect(()=>{generation.current++;setReview(undefined);setChoices({});setBusy(false);setNotice('');setOffset(0);},[data,tripId]);
  const combined=useMemo(()=>{if(!review)return {};try{return {records:combineReviewedSharedRecords(review,choices)};}catch(error){return {error:error instanceof Error?error.message:'Review the selected records.'};}},[review,choices]);
  const changes=review?.changes.filter(c=>!onlyReview||c.requiresReview)??[],visible=changes.slice(offset,offset+20);
  const missing=review?.changes.filter(c=>c.requiresReview&&!choices[c.key]).length??0;
  async function load(){
    if(!link||busy)return;const start=data,token=++generation.current;setBusy(true);setNotice('');setReview(undefined);
    try{
      device.checkActive();
      const remote=await accountRequest<SharedPackSnapshot>(`/households/${link.householdId}/packs/${link.packId}`);
      if(!isSharedPackSnapshot(remote))throw Error('This shared version is unsupported. Earlier copies are unchanged.');
      const next=await reviewSharedCombination(start,tripId,remote);
      device.checkActive();if(!alive.current||token!==generation.current||latest.current!==start)return;
      setReview(next);setChoices({});setOffset(0);setOnlyReview(false);setNotice('Newer shared records loaded for review. Nothing has been published or replaced.');
    }catch(error){if(alive.current&&token===generation.current){if(error instanceof AccountRequestError&&error.code==='sign_in_required')onExpired();setNotice(error instanceof Error?error.message:'Shared comparison failed. Earlier copies remain available.');}}
    finally{if(alive.current&&token===generation.current)setBusy(false);}
  }
  if(!link)return null;
  return <section className="shared-combination" aria-label="Combine shared changes"><h4>Combine a newer shared version</h4>
    <p>Compare this local copy with the version it was opened from. Independent changes can be combined; conflicts and required-item or constraint changes need a choice. Opening a combined copy keeps earlier copies. Publishing is a separate consented action.</p>
    <p>Only items referenced by the combined checklist enter the new copy; other items stay in earlier copies. Review the resulting plan before publishing.</p>
    {!link.baseline&&<p>This older copy has no comparison baseline. Open the current shared version separately. A successful publication of this copy also prepares a baseline for future comparisons.</p>}
    <button type="button" className="button button-secondary" disabled={busy||!link.baseline||!validSharedPackLink(link)} onClick={()=>void load()}>{busy?'Comparing records…':'Review newer shared version'}</button>
    {review&&<><p><strong>Local version {link.revision} → shared version {review.remote.revision}.</strong> {review.changes.length} changed records; {missing} explicit choices still needed. Measurements and shared progress remain recorded estimates or member reports.</p>
      <label className="account-check"><input type="checkbox" checked={onlyReview} onChange={e=>{setOnlyReview(e.target.checked);setOffset(0);}}/><span>Show only changes needing an explicit choice</span></label>
      <ul className="shared-change-list">{visible.map((change,n)=><li key={change.key} className="shared-change"><strong>{change.label}</strong>
        {change.conflict&&<p>Both copies changed this record.</p>}{change.safetyChange&&<p>Review this incoming required-item or packing-constraint change explicitly.</p>}
        {change.protectedPosition&&<p>Keep this saved local packed position. To accept a different physical position, first unlock or correct it in the earlier local copy and compare again.</p>}
        {change.changedFields.length>0&&<p className="shared-change-fields">Differences: {fieldText(change)}.</p>}
        <div className="shared-change-values"><p><strong>This local copy:</strong> {describe(change.local)}</p><p><strong>Newer shared version:</strong> {describe(change.shared)}</p></div>
        <label className="field"><span>Record to use</span><select aria-label={`Choice for ${change.label} · change ${offset+n+1}`} value={choices[change.key]??(change.requiresReview?'':change.defaultChoice)} onChange={e=>setChoices(current=>{const next={...current};if(e.target.value)next[change.key]=e.target.value as SharedChoice;else delete next[change.key];return next;})}>
          {change.requiresReview&&<option value="">Choose explicitly</option>}<option value="local">Keep this local record</option>{!change.protectedPosition&&<option value="shared">Use the newer shared record</option>}
        </select></label>
      </li>)}</ul>
      {!changes.length&&<p>No changed records in this view.</p>}
      {changes.length>20&&<div className="account-actions"><button type="button" className="button button-secondary" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous changes</button><span>{offset+1}–{Math.min(offset+20,changes.length)} of {changes.length}</span><button type="button" className="button button-secondary" disabled={offset+20>=changes.length} onClick={()=>setOffset(offset+20)}>Next changes</button></div>}
      {combined.error&&<p className="form-error" role="status">{combined.error}</p>}
      <div className="account-actions"><button type="button" className="button button-primary" disabled={busy||!combined.records||missing>0} onClick={()=>{
        try{device.checkActive();if(!combinationStillCurrent(latest.current,review))throw Error('Local records changed after this comparison. Review the newer shared version again.');
          const records=combineReviewedSharedRecords(review,choices),snapshot={...review.remote,name:records.trip.name,records};
          onOpen(snapshot,review.remoteBaseline,{tripId:review.tripId,localCanonical:review.localCanonical,linkCanonical:review.linkCanonical});setReview(undefined);setNotice('Combined copy opened. Earlier copies remain available; publication still needs consent.');
        }catch(error){setNotice(error instanceof Error?error.message:'The combined copy could not be opened. Earlier copies remain.');}
      }}>Open combined local copy</button><button type="button" className="button button-secondary" onClick={()=>{setReview(undefined);setChoices({});setNotice('Comparison dismissed. Earlier copies and server records are unchanged.');}}>Dismiss comparison</button></div>
    </>}
    {notice&&<p className="account-notice" role="status">{notice}</p>}
  </section>;
}
