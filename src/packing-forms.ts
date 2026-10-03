import { separationRuleError, MAX_SEPARATION_RULES } from './separation-rule-records.ts';
import type { LibraryItem, PackingForm, Placement, Trip } from './types.ts';
import { topLoadError } from './stack-load.ts';

const dimensions=['length','width','height'] as const;
const date=(value:unknown)=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
const text=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
export function packingFormsForSelection(item:Pick<LibraryItem,'packingForms'>):PackingForm[]{
  return Array.isArray(item.packingForms)?item.packingForms.filter(form=>form&&text(form.id,80)&&text(form.name,70)):[];
}
/** No preset invents a compression ratio or changes mass, fragility or upright care. */
export function packingFormsError(item:Pick<LibraryItem,'flexibility'|'packingForms'>):string|undefined {
  const forms=item.packingForms;if(forms===undefined)return;
  if(!Array.isArray(forms)||forms.length>8)return 'Keep at most eight recorded packing forms for an item.';
  if(forms.length&&item.flexibility==='rigid')return 'Rigid items cannot use folded, rolled or compressed forms. Keep their original geometry or correct the flexibility record.';
  if(forms.length&&!['slightly_deformable','foldable','rollable','compressible','freeform'].includes(item.flexibility))return 'Choose the item’s actual flexibility before recording a packing form.';
  const ids=new Set<string>();
  for(const form of forms){
    if(!form||!text(form.id,80)||ids.has(form.id)||!text(form.name,70)||!['folded','rolled','compressed'].includes(form.kind)
      ||!text(form.preparation,300)||!date(form.reviewedAt))return 'Name each distinct packing form, describe its preparation and confirm it can be reproduced without damage.';
    ids.add(form.id);
    if(!form.dimensions||dimensions.some(axis=>!Number.isFinite(form.dimensions[axis])||form.dimensions[axis]<=0||form.dimensions[axis]>10000))return 'Enter three positive packing-form dimensions up to 10,000 mm.';
    const evidence=form.dimensionEvidence;
    if(!evidence||!['measured','known','user_confirmed'].includes(evidence.source)||!date(evidence.collectedAt)
      ||!Number.isFinite(evidence.confidence)||evidence.confidence<0||evidence.confidence>1
      ||(evidence.note!==undefined&&(typeof evidence.note!=='string'||evidence.note.length>1000)))return 'Use measured, known or traveller-confirmed dimensions for a reproducible packing form; automatic compression estimates are not accepted.';
    if(form.topLoadEvidence&&!date(form.topLoadEvidence.collectedAt))return 'Record a valid packing-form stacking review date.';
    const loadError=topLoadError({...form,fragile:false});if(loadError)return 'Packing form '+form.name+': '+loadError;
    if(packingFormKey(form).length>1400)return 'Shorten this packing form’s preparation or identity before saving.';
  }
}

/** An exact bounded identity, including preparation, rather than a collision-prone hash. */
export function packingFormKey(form:PackingForm):string {
  const evidence=form.dimensionEvidence,load=form.topLoadEvidence;
  return JSON.stringify([form.id,form.kind,form.dimensions.length,form.dimensions.width,form.dimensions.height,form.preparation,form.reviewedAt,
    evidence.source,evidence.confidence,evidence.collectedAt,form.maxTopLoadGrams??null,load?[load.source,load.confidence,load.collectedAt]:null]);
}

/** The source capture remains unchanged; this form uses a fully occupied box. */
export function packingItem(item:LibraryItem,formId?:string):LibraryItem {
  const error=packingFormsError(item);if(error)throw Error(error);
  if(formId===undefined)return item;
  if(!text(formId,80))throw Error('Choose a valid recorded packing form.');
  const form=item.packingForms?.find(form=>form.id===formId);
  if(!form)throw Error('The selected packing form is missing. Choose an existing form or the original item before replanning.');
  return {...item,dimensions:form.dimensions,dimensionEvidence:form.dimensionEvidence,packingShape:undefined,
    maxTopLoadGrams:form.maxTopLoadGrams,topLoadEvidence:form.topLoadEvidence};
}

export function packingItemForPlacement(item:LibraryItem|undefined,placement:Placement):LibraryItem|undefined {
  if(!item)return;
  try{
    const resolved=packingItem(item,placement.packingFormId);
    if(placement.packingFormId!==undefined){const form=item.packingForms!.find(form=>form.id===placement.packingFormId)!;if(placement.packingFormKey!==packingFormKey(form))return;}
    else if(placement.packingFormKey!==undefined)return;
    return resolved;
  }catch{return;}
}

export function packingFormInstruction(form?:PackingForm):string {
  return form?'Prepare '+form.name+' ('+form.kind+'): '+form.preparation+' Check it stays within '+form.dimensions.length+' × '+form.dimensions.width+' × '+form.dimensions.height+' mm without damage or forcing the bag closed. This is the recorded packed envelope; the original scan is unchanged.':'';
}

/** Split only the last untouched instance so every earlier saved instance keeps its ID. */
export function canSeparatePackingCopy(trip:Trip,entryId:string):boolean {
  const entry=trip.entries.find(entry=>entry.id===entryId);if(!entry||!Number.isInteger(entry.quantity)||entry.quantity<2)return false;
  const id=entryId+'#'+entry.quantity;
  return !trip.completedInstanceIds.includes(id)&&!trip.unavailableInstanceIds.includes(id)
    &&!trip.lockedPlacements.some(p=>p?.instanceId===id)&&!(trip.rejectedPlacements??[]).some(p=>p?.instanceId===id);
}
export function separatePackingCopy(trip:Trip,entryId:string,newEntryId:string):Trip {
  if(!canSeparatePackingCopy(trip,entryId))return trip;
  if(!text(newEntryId,80)||trip.entries.some(entry=>entry.id===newEntryId))throw Error('Use a distinct pack-entry ID.');
  const issue=separationRuleError(trip);if(issue)throw Error(issue);
  const linked=(trip.separationRules??[]).filter(rule=>rule.firstEntryId===entryId||rule.secondEntryId===entryId);
  if((trip.separationRules?.length??0)+linked.length>MAX_SEPARATION_RULES)throw Error('Simplify separation rules before splitting another copy.');
  const ids=new Set((trip.separationRules??[]).map(rule=>rule.id));
  const inherited=linked.map((rule,index)=>{let id=newEntryId+':separation:'+index;while(ids.has(id))id+='x';ids.add(id);return {...rule,id,firstEntryId:rule.firstEntryId===entryId?newEntryId:rule.firstEntryId,secondEntryId:rule.secondEntryId===entryId?newEntryId:rule.secondEntryId};});
  const entry=trip.entries.find(entry=>entry.id===entryId)!;
  return {...trip,...(trip.separationRules?{separationRules:[...trip.separationRules,...inherited]}:{}),entries:[...trip.entries.map(old=>old.id===entryId?{...old,quantity:old.quantity-1}:old),{...entry,id:newEntryId,quantity:1}],
    ...(trip.packingCursor===entryId+'#'+entry.quantity?{packingCursor:newEntryId+'#1'}:{})};
}
/** A single deliberate quantity change cannot erase any recorded physical state. */
export function changePackingQuantity(trip:Trip,entryId:string,quantity:number):Trip {
  const entry=trip.entries.find(entry=>entry.id===entryId);
  if(!entry||!Number.isInteger(quantity)||quantity<1||Math.abs(quantity-entry.quantity)!==1
    ||quantity>entry.quantity&&quantity>99||quantity<entry.quantity&&!canSeparatePackingCopy(trip,entryId))return trip;
  return {...trip,entries:trip.entries.map(old=>old.id===entryId?{...old,quantity}:old),
    ...(quantity<entry.quantity&&trip.packingCursor===entryId+'#'+entry.quantity?{packingCursor:undefined}:{})};
}
