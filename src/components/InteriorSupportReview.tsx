import { useState } from 'react';
import { confirmInteriorSupport, hasInteriorSupportReview, interiorSupportError, interiorTravelLabel } from '../packing-interior';
import type { PackingInterior } from '../types';
import { uprightFaces } from '../upright';

const axes=['length','width','height'] as const;
export function InteriorSupportReview({model,onChange}:{model:PackingInterior;onChange:(model:PackingInterior)=>void}){
  const [checked,setChecked]=useState(false),[error,setError]=useState('');
  const problem=interiorSupportError(model),reviewed=hasInteriorSupportReview(model);
  const capUnderneath=model.travelUp.axis===model.cavity.opening.axis&&model.travelUp.sign===-model.cavity.opening.sign;
  return <section className="interior-support-review" aria-label="Packing and travel support review">
    <h4>Support during packing and travel</h4>
    <p>The opening faces up while packing. During travel the reviewed {interiorTravelLabel(model)} end faces up, so a different wall may become the base. Static support and recorded load limits are checked in both positions. This does not simulate the rotation, impacts, balance or securing.</p>
    <fieldset><legend>Travel-up end in the original source</legend><div className="interior-face-choices">{uprightFaces.map(face=>{
      const axis=axes.indexOf(face.axis) as 0|1|2;
      return <button type="button" key={face.letter} aria-pressed={model.travelUp.axis===axis&&model.travelUp.sign===face.sign} onClick={()=>{setChecked(false);setError('');onChange({...model,travelUp:{axis,sign:face.sign},supportReview:undefined});}}>Review travel up {face.letter}<small>{face.label}</small></button>;
    })}</div></fieldset>
    {problem&&<p className="scan-geometry-caution" role="status">{problem}</p>}
    {reviewed&&<p className="support-review-date">Traveller-reviewed at {new Date(model.supportReview!.evidence.collectedAt).toLocaleString()}. Review applies to this source, scale and travel end; it is not physical certification.</p>}
    <label className="interior-confirm"><input type="checkbox" checked={checked} onChange={event=>setChecked(event.target.checked)}/><span>I checked the packing floor, closed travel base and support strength, and my recorded stacking limits apply in both positions.</span></label>
    <button className="button button-secondary" type="button" disabled={!checked||capUnderneath} onClick={()=>{try{onChange(confirmInteriorSupport(model));setError('');}catch(reason){setError(reason instanceof Error?reason.message:'The supports could not be reviewed.');}}}>Confirm packing and travel supports</button>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <small>This confirmation stays in the draft until you save. A changed travel end or scale can pause packed positions; cancellation preserves the saved bag.</small>
  </section>;
}
