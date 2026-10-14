import { useEffect, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { carrierReviewDate, carrierReviewTimestamp, secureCarrierSourceUrl } from '../carrier-rules';
import { measurementFromInput } from '../measurement-input';
import type { CarrierLimits, CarrierRule, Container, UnitSystem } from '../types';
interface CaptureModalProps { title:string; eyebrow:string; onClose:()=>void; children:ReactNode; busy?:boolean; }
type CaptureModal = ComponentType<CaptureModalProps>;
interface CarrierRuleCaptureHelpers {
  lengthInput:(value:number|undefined,unit:UnitSystem)=>string;
  massInput:(value:number|undefined,unit:UnitSystem)=>string;
  dimLabel:(unit:UnitSystem)=>string;
}

export function CarrierRuleCapture({ initial, bags, unit, onClose, onSave, helpers, Modal }: { initial?:CarrierRule; bags:Container[]; unit:UnitSystem; onClose:()=>void; onSave:(rule:Omit<CarrierRule,'id'>)=>void; helpers:CarrierRuleCaptureHelpers; Modal:CaptureModal }) {
  const { lengthInput, massInput, dimLabel } = helpers;
  const today = carrierReviewDate();
  const initialDate = initial?.retrievedAt && Number.isFinite(Date.parse(initial.retrievedAt)) ? carrierReviewDate(initial.retrievedAt) : today;
  const [carrier,setCarrier]=useState(initial?.carrier ?? '');
  const [route,setRoute]=useState(initial?.route ?? '');
  const [fare,setFare]=useState(initial?.fare ?? '');
  const [sourceUrl,setSourceUrl]=useState(initial?.sourceUrl ?? '');
  const [reviewedAt,setReviewedAt]=useState(initialDate);
  const [staleAfterDays,setStaleAfterDays]=useState(String(initial?.staleAfterDays ?? 7));
  const [applicableBagIds,setApplicableBagIds]=useState<string[]>(initial?.applicableBagIds ?? []);
  const [notes,setNotes]=useState(initial?.notes ?? '');
  const [maxLength,setMaxLength]=useState(lengthInput(initial?.limits?.maxOuterDimensionsMm?.length,unit));
  const [maxWidth,setMaxWidth]=useState(lengthInput(initial?.limits?.maxOuterDimensionsMm?.width,unit));
  const [maxHeight,setMaxHeight]=useState(lengthInput(initial?.limits?.maxOuterDimensionsMm?.height,unit));
  const [maxLinearSum,setMaxLinearSum]=useState(lengthInput(initial?.limits?.maxOuterLinearSumMm,unit));
  const [maxWeight,setMaxWeight]=useState(massInput(initial?.limits?.maxWeightGrams,unit));
  const [maxBagCount,setMaxBagCount]=useState(initial?.limits?.maxBagCount?.toString() ?? '');
  const [weightScope,setWeightScope]=useState<NonNullable<CarrierLimits['weightScope']>>(initial?.limits?.weightScope ?? 'per_bag');
  const [checkedForBooking,setCheckedForBooking]=useState(initial?.status === 'verified');
  useEffect(() => {
    if (initial && (carrier !== initial.carrier || route !== initial.route || fare !== initial.fare || sourceUrl !== initial.sourceUrl
      || notes !== initial.notes || maxLength !== lengthInput(initial.limits?.maxOuterDimensionsMm?.length,unit)
      || maxWidth !== lengthInput(initial.limits?.maxOuterDimensionsMm?.width,unit)
      || maxHeight !== lengthInput(initial.limits?.maxOuterDimensionsMm?.height,unit)
      || maxLinearSum !== lengthInput(initial.limits?.maxOuterLinearSumMm,unit)
      || maxWeight !== massInput(initial.limits?.maxWeightGrams,unit)
      || maxBagCount !== (initial.limits?.maxBagCount?.toString() ?? '')
      || weightScope !== (initial.limits?.weightScope ?? 'per_bag')
      || applicableBagIds.join('|') !== initial.applicableBagIds.join('|'))) setCheckedForBooking(false);
  }, [initial,unit,carrier,route,fare,sourceUrl,notes,maxLength,maxWidth,maxHeight,maxLinearSum,maxWeight,maxBagCount,weightScope,applicableBagIds]);
  const [error,setError]=useState('');
  const submit=(event:FormEvent)=>{
    event.preventDefault();
    const normalizedSource=secureCarrierSourceUrl(sourceUrl);
    if(!normalizedSource){setError('Enter a credential-free HTTPS link to the airline or booking source.');return;}
    const refreshDays=Number(staleAfterDays);
    if(!carrier.trim()){setError('Enter the airline or carrier name.');return;}
    if(!notes.trim()){setError('Add the allowance or source note you want to keep with this trip.');return;}
    let retrievedAt:string;
    try { retrievedAt=carrierReviewTimestamp(reviewedAt,initial?.retrievedAt); }
    catch(reviewError){setError(reviewError instanceof Error?reviewError.message:'Enter the date you last checked the source.');return;}
    if(!Number.isInteger(refreshDays)||refreshDays<1||refreshDays>365){setError('Choose a refresh window from 1 to 365 days.');return;}
    const validBagIds=new Set(bags.map((bag)=>bag.id));
    const bagIds=applicableBagIds.filter((id)=>validBagIds.has(id));
    const axisValues=[maxLength,maxWidth,maxHeight];
    const hasAxisValues=axisValues.some((value)=>value.trim()!=='');
    if(hasAxisValues&&axisValues.some((value)=>!Number.isFinite(Number(value))||Number(value)<=0)){setError(`Enter all three maximum outside dimensions in ${dimLabel(unit)}.`);return;}
    if(maxLinearSum&&(!Number.isFinite(Number(maxLinearSum))||Number(maxLinearSum)<=0)){setError(`Enter a positive combined-dimension limit in ${dimLabel(unit)}.`);return;}
    if(maxWeight&&(!Number.isFinite(Number(maxWeight))||Number(maxWeight)<=0)){setError(`Enter a positive weight limit in ${unit==='metric'?'grams':'ounces'}.`);return;}
    const hasCount=maxBagCount.trim()!=='';
    if(hasCount&&(!Number.isInteger(Number(maxBagCount))||Number(maxBagCount)<0||Number(maxBagCount)>100)){setError('Enter a whole number of bags from 0 to 100, or leave it blank when not recorded.');return;}
    const hasNumericLimits=hasAxisValues||!!maxLinearSum||!!maxWeight||hasCount;
    if(hasNumericLimits&&bagIds.length===0){setError('Choose at least one bag for these numeric limits.');return;}
    const limits:CarrierLimits|undefined=hasNumericLimits?{
      ...(hasAxisValues?{maxOuterDimensionsMm:{length:measurementFromInput(maxLength,unit==='metric'?1:25.4,initial?.limits?.maxOuterDimensionsMm?.length),width:measurementFromInput(maxWidth,unit==='metric'?1:25.4,initial?.limits?.maxOuterDimensionsMm?.width),height:measurementFromInput(maxHeight,unit==='metric'?1:25.4,initial?.limits?.maxOuterDimensionsMm?.height)}}:{}),
      ...(maxLinearSum?{maxOuterLinearSumMm:measurementFromInput(maxLinearSum,unit==='metric'?1:25.4,initial?.limits?.maxOuterLinearSumMm)}:{}),
      ...(maxWeight?{maxWeightGrams:measurementFromInput(maxWeight,unit==='metric'?1:28.3495,initial?.limits?.maxWeightGrams),weightScope}:{}),
      ...(hasCount?{maxBagCount:Number(maxBagCount)}:{}),
    }:undefined;
    onSave({carrier:carrier.trim(),route:route.trim()||'Not specified',fare:fare.trim()||'Not specified',sourceUrl:normalizedSource,retrievedAt,staleAfterDays:refreshDays,applicableBagIds:bagIds,notes:notes.trim(),status:checkedForBooking?'verified':'manual',...(limits?{limits}:{}),...(initial?.retrieval?{retrieval:initial.retrieval}:{})});
  };
  return <Modal title={initial?.retrieval?'Review retrieved allowance':initial?'Edit carrier source':'Save a carrier source'} eyebrow="TRIP SOURCE" onClose={onClose}><form className="simple-modal-form carrier-rule-form" onSubmit={submit}>
    <label className="field"><span>Airline or carrier</span><input autoFocus value={carrier} onChange={(event)=>setCarrier(event.target.value)} maxLength={80} placeholder="e.g. KLM"/></label>
    <div className="date-fields"><label className="field"><span>Route or itinerary <em>optional</em></span><input value={route} onChange={(event)=>setRoute(event.target.value)} maxLength={120} placeholder="e.g. AMS–LIS, including connections"/></label><label className="field"><span>Fare or cabin <em>optional</em></span><input value={fare} onChange={(event)=>setFare(event.target.value)} maxLength={100} placeholder="e.g. Economy Light"/></label></div>
    <label className="field"><span>Official source link</span><input type="url" value={sourceUrl} onChange={(event)=>setSourceUrl(event.target.value)} maxLength={500} placeholder="https://airline.example/baggage"/></label>
    <label className="field"><span>Allowance notes</span><textarea value={notes} onChange={(event)=>setNotes(event.target.value)} maxLength={1500} rows={4} placeholder="Record the allowance shown for this booking, including dimensions, weight and number of bags."/></label>
    <section className="carrier-limits-form" aria-label="Numeric baggage limits"><div className="field-heading"><span>Optional numeric limits</span></div><p>Copy only values shown by the source you checked. Enter them in your chosen units: {dimLabel(unit)} and {unit==='metric'?'g':'oz'}. A source listing 55 cm means 550 mm.</p>
      <label className="field"><span>Maximum number of selected bags <em>optional</em></span><input aria-label="Maximum number of bags" type="number" min="0" max="100" step="1" inputMode="numeric" value={maxBagCount} onChange={(event)=>setMaxBagCount(event.target.value)}/><small>This count applies to the bags selected in this record, including empty bags. For a per-passenger allowance, select that passenger's bags and save separate records for other passengers. Counts are not pooled across records.</small></label>
      <div className="field-block"><div className="field-heading"><span>Maximum outside size per bag · {dimLabel(unit)}</span></div><div className="dimension-fields">{([['length','Length',maxLength,setMaxLength],['width','Width',maxWidth,setMaxWidth],['height','Height',maxHeight,setMaxHeight]] as const).map(([axis,label,value,setter])=><label className="field" key={axis}><span>{label}</span><input aria-label={`Maximum outside ${label}`} type="number" min="0.1" step="any" inputMode="decimal" value={value} onChange={(event)=>setter(event.target.value)}/></label>)}</div></div>
      <label className="field"><span>Maximum combined outside dimensions per bag · {dimLabel(unit)} <em>optional</em></span><input aria-label="Maximum combined outside dimensions" type="number" min="0.1" step="any" inputMode="decimal" value={maxLinearSum} onChange={(event)=>setMaxLinearSum(event.target.value)}/></label>
      <div className="date-fields"><label className="field"><span>Weight limit · {unit==='metric'?'grams':'ounces'} <em>optional</em></span><input aria-label="Carrier weight limit" type="number" min="0.1" step="any" inputMode="decimal" value={maxWeight} onChange={(event)=>setMaxWeight(event.target.value)}/></label><label className="field"><span>Weight limit applies to</span><select value={weightScope} onChange={(event)=>setWeightScope(event.target.value as NonNullable<CarrierLimits['weightScope']>)}><option value="per_bag">Each selected bag</option><option value="combined">Selected bags together</option></select></label></div>
      <small>Outside measurements are checked separately from interior packing space. Measure each outside side including handles and wheels if the source counts them.</small>
    </section>
    <div className="date-fields"><label className="field"><span>{initial?.retrieval?'Last checked by you':'Last checked'}</span><input type="date" value={reviewedAt} onChange={(event)=>setReviewedAt(event.target.value)}/></label><label className="field"><span>Recheck after · days</span><input type="number" min="1" max="365" step="1" value={staleAfterDays} onChange={(event)=>setStaleAfterDays(event.target.value)}/></label></div>
    <div className="traveller-fields"><div className="field-heading"><span>Which bags does this source apply to?</span></div>{bags.length ? bags.map((bag)=><label className="check-row" key={bag.id}><input type="checkbox" checked={applicableBagIds.includes(bag.id)} onChange={(event)=>setApplicableBagIds((current)=>event.target.checked?[...current,bag.id]:current.filter((id)=>id!==bag.id))}/><span>{bag.name}</span></label>) : <small>Add a bag to this pack to attach the source to it.</small>}</div>
    <label className="check-row carrier-verified-check"><input type="checkbox" checked={checkedForBooking} onChange={(event)=>setCheckedForBooking(event.target.checked)}/><span>I checked the allowance for this exact booking, fare and operating airline.</span></label>
    <div className="capture-disclosure">{initial?.retrieval?<><strong>Retrieved source with editable limits.</strong> The original page was retrieved {new Date(initial.retrieval.catalog.retrievedAt).toLocaleString()}. Your edits are saved as a manual override and never change that timestamp. Select the bags for one passenger and this allowance; an excess count will be flagged. Check the booking and passenger allowance yourself. This app does not retrieve your booking or guarantee carriage.</>:<><strong>Manual source record.</strong> The app does not fetch this manually entered source or your booking. Comparisons check only the numeric values and bag measurements you entered; they cannot confirm booking applicability or carrier acceptance.</>}</div>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Save source</button></div>
  </form></Modal>;
}
