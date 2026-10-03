import { useState } from 'react';
import { MAX_SEPARATION_RULES, reviewSeparation, separationDescription, separationRuleError } from '../item-separation';
import type { Container, LibraryItem, PackingPlan, SeparationRule, Trip, UnitSystem } from '../types';

export function SeparationNotes({trip,items,bags,plan,unit}: {trip:Trip;items:LibraryItem[];bags:Container[];plan:PackingPlan;unit:UnitSystem}){
  if(!trip.separationRules?.length)return null;
  const review=reviewSeparation(trip,items,bags,plan);
  if(review.error)return <section className="separation-notes" aria-label="Separation checks"><h3>Separation checks</h3><p role="alert">{review.error}</p><p>Planning is paused. Correct the rule records; saved packed positions remain unchanged.</p></section>;
  const name=(id:string)=>items.find(item=>item.id===trip.entries.find(e=>e.id===id)?.itemId)?.name??'Missing entry';
  return <section className="separation-notes" aria-label="Separation checks"><h3>Separation checks</h3>
    <p>Rules apply to every copy of both entries, including saved packed positions. Recorded geometry and compartments do not establish hygiene, cushioning, leak prevention or dangerous-goods compliance.</p>
    {review.error&&<p className="inline-error">{review.error}</p>}
    <ul>{review.checks.map(({rule,status,reason})=><li key={rule.id} data-separation-status={status}>
      <strong>{name(rule.firstEntryId)} ↔ {name(rule.secondEntryId)}</strong><p>{separationDescription(rule,unit)} · {status==='within_model'?'Within recorded separation':status==='conflict'?'Separation conflict':'Separation check incomplete'}</p>
      {reason&&<p>{reason}</p>}{rule.note&&<p>{rule.note}</p>}
    </li>)}</ul>
  </section>;
}

export function SeparationRules({trip,items,unit,onChange}:{trip:Trip;items:LibraryItem[];unit:UnitSystem;onChange:(rules:SeparationRule[])=>void}){
  const [editing,setEditing]=useState<SeparationRule|null|undefined>(),[first,setFirst]=useState(''),[second,setSecond]=useState(''),[kind,setKind]=useState<SeparationRule['kind']>('different_bags'),[gap,setGap]=useState(''),[note,setNote]=useState(''),[error,setError]=useState('');
  const rules=trip.separationRules??[],factor=unit==='metric'?1:25.4;
  const label=(id:string)=>{const entry=trip.entries.find(e=>e.id===id);return `${items.find(i=>i.id===entry?.itemId)?.name??'Missing item'} · ${trip.travellers.find(t=>t.id===entry?.travellerId)?.name??'Traveller'} · ${entry?.quantity??0} copies · checklist row ${trip.entries.findIndex(e=>e.id===id)+1}`;};
  const open=(rule?:SeparationRule)=>{setEditing(rule??null);setFirst(rule?.firstEntryId??trip.entries[0]?.id??'');setSecond(rule?.secondEntryId??trip.entries[1]?.id??'');setKind(rule?.kind??'different_bags');setGap(rule?.clearanceMm===undefined?'':String(rule.clearanceMm/factor));setNote(rule?.note??'');setError('');};
  const save=()=>{
    const unchanged=editing?.kind==='clearance'&&gap===String(editing.clearanceMm!/factor);
    const rule:SeparationRule={id:editing?.id??crypto.randomUUID(),firstEntryId:first,secondEntryId:second,kind,
      ...(kind==='clearance'?{clearanceMm:unchanged?editing!.clearanceMm:Number(gap)*factor}:{}),...(note.trim()?{note:note.trim()}: {})};
    const next=editing?rules.map(r=>r.id===editing.id?rule:r):[...rules,rule];
    const issue=separationRuleError({...trip,separationRules:next});if(issue){setError(issue);return;}onChange(next);setEditing(undefined);
  };
  if(!Array.isArray(rules)||rules.some(rule=>!rule||typeof rule!=='object'))return <section className="separation-rules" aria-label="Item separation rules"><h2>Separation rules need correction</h2><p role="alert">{separationRuleError(trip)}</p><p>Restore valid records in Settings. Saved packed positions remain unchanged.</p></section>;
  return <section className="separation-rules" aria-label="Item separation rules"><div className="section-title-row"><div><span className="panel-kicker">HARD PACKING RULES</span><h2>Keep belongings apart</h2></div><button className="button button-secondary" disabled={trip.entries.length<2||rules.length>=MAX_SEPARATION_RULES} onClick={()=>open()}>Add separation rule</button></div>
    <p>Choose two checklist entries. Each rule applies to all their copies in every approach. New conflicts pause saved packed positions instead of moving them.</p>
    {trip.entries.length<2&&<p>Add at least two checklist entries to create a rule.</p>}
    <ul>{rules.map(rule=><li key={rule.id}><strong>{label(rule.firstEntryId)} ↔ {label(rule.secondEntryId)}</strong><p>{separationDescription(rule,unit)}{rule.note&&` · ${rule.note}`}</p><div><button className="button button-secondary" aria-label={`Edit separation rule for ${label(rule.firstEntryId)} and ${label(rule.secondEntryId)}`} onClick={()=>open(rule)}>Edit rule</button><button className="button button-secondary" aria-label={`Remove separation rule for ${label(rule.firstEntryId)} and ${label(rule.secondEntryId)}`} onClick={()=>{onChange(rules.filter(r=>r.id!==rule.id));if(editing?.id===rule.id)setEditing(undefined);}}>Remove rule</button></div></li>)}</ul>
    {editing!==undefined&&<form className="separation-editor" aria-label="Separation rule editor" onSubmit={event=>{event.preventDefault();save();}}>
      <label className="field"><span>First entry</span><select aria-label="First entry" value={first} onChange={event=>setFirst(event.target.value)}>{trip.entries.map(e=><option key={e.id} value={e.id}>{label(e.id)}</option>)}</select></label>
      <label className="field"><span>Second entry</span><select aria-label="Second entry" value={second} onChange={event=>setSecond(event.target.value)}>{trip.entries.map(e=><option key={e.id} value={e.id}>{label(e.id)}</option>)}</select></label>
      <label className="field"><span>Separation requirement</span><select aria-label="Separation requirement" value={kind} onChange={event=>setKind(event.target.value as SeparationRule['kind'])}><option value="different_bags">Different bags</option><option value="different_compartments">Different reviewed compartments or bags</option><option value="clearance">Minimum geometric gap</option></select></label>
      {kind==='clearance'&&<label className="field"><span>Minimum geometric gap ({unit==='metric'?'mm':'in'})</span><input type="number" required min="0" max={10000/factor} step="any" value={gap} onChange={event=>setGap(event.target.value)}/></label>}
      <label className="field"><span>Reason or reminder (optional)</span><textarea maxLength={500} value={note} onChange={event=>setNote(event.target.value)}/></label>
      <p>A geometric gap is empty space between the recorded occupied shapes. Compartment walls and actual containment must be checked physically. No transport or medical rule is inferred.</p>
      {error&&<p role="alert" className="inline-error">{error}</p>}
      <div className="separation-actions"><button type="submit" className="button button-primary">Save separation rule</button><button type="button" className="button button-secondary" onClick={()=>setEditing(undefined)}>Cancel</button></div>
    </form>}
  </section>;
}
