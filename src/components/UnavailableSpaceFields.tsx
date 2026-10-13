import type { Evidence, UnavailableSpace, UnitSystem } from '../types';
import { MAX_UNAVAILABLE_SPACES } from '../container-space';
import { measurementFromInput, measurementInput } from '../measurement-input';

export function UnavailableSpaceFields({spaces,onChange,unit}:{spaces:UnavailableSpace[];onChange:(spaces:UnavailableSpace[])=>void;unit:UnitSystem}) {
  const factor=unit==='metric'?1:25.4,label=unit==='metric'?'mm':'inches';
  const update=(id:string,change:Partial<UnavailableSpace>)=>onChange(spaces.map(space=>space.id===id?{...space,...change,evidence:{...(change.evidence??space.evidence),collectedAt:new Date().toISOString()}}:space));
  return <section className="unavailable-space-fields" aria-label="Unavailable bag spaces">
    <h3>Keep areas free</h3><p>Record a wheel housing, frame intrusion or compartment that cannot be used. Enclose its full size in a rectangular area. Positions use the same inside corner as the packing view: left to right, front to back, and floor to lid. These areas are not assumed to support items placed above them.</p>
    {spaces.map((space,index)=><fieldset className="unavailable-space-card" key={space.id}><legend>Unavailable space {index+1}</legend>
      <label className="field"><span>Area name</span><input aria-label={`Area ${index+1} name`} maxLength={80} value={space.name} onChange={event=>update(space.id,{name:event.target.value})}/></label>
      <div className="space-coordinate-fields">{([['x','From left'],['y','From front'],['z','Above floor'],['length','Length'],['width','Width'],['height','Height']] as const).map(([key,title])=><label className="field" key={key}><span>{title} · {label}</span><input aria-label={`Area ${index+1} ${title.toLowerCase()}`} type="number" inputMode="decimal" min={['x','y','z'].includes(key)?0:.0001} step="any" value={Number.isFinite(space[key])?measurementInput(space[key],factor):''} onChange={event=>update(space.id,{[key]:event.target.value.trim()===''?NaN:measurementFromInput(event.target.value,factor,space[key])})}/></label>)}</div>
      <label className="field"><span>Area size source</span><select aria-label={`Area ${index+1} size source`} value={space.evidence.source} onChange={event=>update(space.id,{evidence:{source:event.target.value as Evidence['source'],confidence:event.target.value==='estimated'?.5:1,collectedAt:new Date().toISOString(),note:'Unavailable area recorded by the traveller; verify the complete intrusion or compartment boundary.'}})}><option value="estimated">Estimated</option><option value="measured">Measured by you</option><option value="user_confirmed">Confirmed by you</option>{!['estimated','measured','user_confirmed'].includes(space.evidence.source)&&<option value={space.evidence.source}>{space.evidence.source}</option>}</select></label>
      <button className="text-button" type="button" onClick={()=>onChange(spaces.filter(value=>value.id!==space.id))}>Remove area {index+1}</button>
    </fieldset>)}
    <button className="button button-secondary" type="button" disabled={spaces.length>=MAX_UNAVAILABLE_SPACES} onClick={()=>onChange([...spaces,{id:globalThis.crypto?.randomUUID?.()??`area-${Date.now()}-${Math.random().toString(36).slice(2,10)}`,name:'Unavailable area',x:0,y:0,z:0,length:NaN,width:NaN,height:NaN,evidence:{source:'estimated',confidence:.5,collectedAt:new Date().toISOString(),note:'Traveller-entered unavailable area; not detected or measured by the scan.'}}])}>Add unavailable area</button>
    <small>{spaces.length} of {MAX_UNAVAILABLE_SPACES} areas recorded. Overlapping areas are allowed and counted once.</small>
  </section>;
}
