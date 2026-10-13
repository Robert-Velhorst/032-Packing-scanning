import { measurementFromInput,measurementInput } from '../measurement-input';
import type { Evidence,Flexibility,PackingForm,UnitSystem } from '../types';

const axes=['length','width','height'] as const;
const names={folded:'Folded',rolled:'Rolled',compressed:'Compressed'};
export function PackingFormFields({forms,flexibility,unit,onChange}:{forms:PackingForm[];flexibility:Flexibility;unit:UnitSystem;onChange:(forms:PackingForm[])=>void}) {
  const lengthScale=unit==='metric'?1:25.4,massScale=unit==='metric'?1:28.3495;
  const evidence=(source:Evidence['source']):Evidence=>({source,confidence:1,collectedAt:new Date().toISOString()});
  function change(id:string,patch:Partial<PackingForm>){onChange(forms.map(form=>form.id===id?{...form,...patch,reviewedAt:''}:form));}
  function add(kind:PackingForm['kind']){const now=new Date().toISOString();onChange([...forms,{id:crypto.randomUUID(),name:names[kind]+' form',kind,dimensions:{length:0,width:0,height:0},dimensionEvidence:{source:'measured',confidence:1,collectedAt:now},preparation:'',reviewedAt:'',maxTopLoadGrams:0,topLoadEvidence:{source:'user_confirmed',confidence:1,collectedAt:now}}]);}
  return <section className="packing-form-fields" aria-label="Reusable packing forms"><h3>Reusable packing forms</h3><p>Measure the item after folding, rolling or compressing it. Each form keeps its own preparation, full rectangular envelope and stacking limit. Choose a form separately in each pack. The original dimensions and scan stay saved; no automatic compression ratio or weight reduction is assumed.</p>
    {flexibility==='rigid'&&<p className="scan-geometry-caution">Rigid items use their original geometry. Change flexibility only if this item can actually be prepared differently without damage.</p>}
    <div className="packing-form-presets">{(['folded','rolled','compressed'] as const).map(kind=><button key={kind} type="button" className="button button-secondary" disabled={flexibility==='rigid'||forms.length>=8} onClick={()=>add(kind)}>Add {kind} form</button>)}</div>
    {forms.map((form,index)=><fieldset key={form.id} className="packing-form-fieldset"><legend>Packing form {index+1}</legend>
      <div className="packing-form-name"><label className="field"><span>Form name {index+1}</span><input value={form.name} maxLength={70} onChange={event=>change(form.id,{name:event.target.value})}/></label><button type="button" className="button button-secondary" onClick={()=>onChange(forms.filter(other=>other.id!==form.id))} aria-label={`Remove packing form ${index+1}`}>Remove form</button></div>
      <label className="field"><span>Preparation method {index+1}</span><select aria-label={`Preparation method ${index+1}`} value={form.kind} onChange={event=>change(form.id,{kind:event.target.value as PackingForm['kind']})}>{Object.entries(names).map(([kind,name])=><option key={kind} value={kind}>{name}</option>)}</select></label>
      <div className="dimension-fields">{axes.map(axis=><label className="field" key={axis}><span>Form {index+1} {axis} ({unit==='metric'?'mm':'in'})</span><input type="number" min="0" step="any" value={form.dimensions[axis]===0?'':measurementInput(form.dimensions[axis],lengthScale)} onChange={event=>{
        const next=measurementFromInput(event.target.value,lengthScale,form.dimensions[axis]);if(next!==form.dimensions[axis])change(form.id,{dimensions:{...form.dimensions,[axis]:next},dimensionEvidence:evidence(form.dimensionEvidence.source)});
      }}/></label>)}</div>
      <small>If this item must stay upright, measure height towards its real top in this prepared form. Include protrusions and anything that holds the form. Record added wrapping or compression-bag weight in the item’s weight; the form itself does not subtract mass.</small>
      <label className="field"><span>Form dimension source {index+1}</span><select aria-label={`Form dimension source ${index+1}`} value={form.dimensionEvidence.source} onChange={event=>change(form.id,{dimensionEvidence:evidence(event.target.value as Evidence['source'])})}><option value="measured">Measured by you</option><option value="known">Known prepared-product dimensions</option><option value="user_confirmed">Confirmed by you</option></select></label>
      <label className="field"><span>How to prepare form {index+1}</span><textarea aria-label={`How to prepare form ${index+1}`} value={form.preparation} maxLength={300} rows={3} placeholder="Describe how to reproduce this form without forcing or damaging the item." onChange={event=>change(form.id,{preparation:event.target.value})}/></label>
      <label className="field"><span>Form {index+1} weight allowed above ({unit==='metric'?'g':'oz'})</span><input type="number" min="0" step="any" value={measurementInput(form.maxTopLoadGrams,massScale)} onChange={event=>{
        const limit=event.target.value.trim()===''?undefined:measurementFromInput(event.target.value,massScale,form.maxTopLoadGrams);
        if(limit!==form.maxTopLoadGrams)change(form.id,{maxTopLoadGrams:limit,topLoadEvidence:limit===undefined?undefined:evidence(form.topLoadEvidence?.source??'user_confirmed')});
      }}/></label>
      {form.maxTopLoadGrams!==undefined&&<label className="field"><span>Form stacking-limit source {index+1}</span><select aria-label={`Form stacking-limit source ${index+1}`} value={form.topLoadEvidence?.source??'user_confirmed'} onChange={event=>change(form.id,{topLoadEvidence:evidence(event.target.value as Evidence['source'])})}><option value="measured">Measured by you</option><option value="known">Known product limit</option><option value="user_confirmed">Confirmed by you</option><option value="estimated">Estimate</option>{form.topLoadEvidence?.source==='provider'&&<option value="provider">Provider record</option>}</select></label>}
      <small>Zero allows nothing above this form. Blank leaves support strength unknown. The original form’s limit is not copied; fragile always means no stacking.</small>
      <label className="packing-form-confirm"><input type="checkbox" checked={Boolean(form.reviewedAt)} onChange={event=>onChange(forms.map(other=>other.id===form.id?{...other,reviewedAt:event.target.checked?new Date().toISOString():''}:other))}/><span>I checked form {index+1} can be reproduced within these dimensions without damage, and reviewed its applicable stacking limit.</span></label>
    </fieldset>)}
    <small>Changes stay in this draft until Save. Editing or removing a form selected by a packed item can pause that bag; its recorded position is retained.</small>
  </section>;
}
