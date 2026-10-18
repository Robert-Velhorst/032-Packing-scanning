import { memo } from 'react';
import { reviewSeparation, separationDescription } from '../item-separation';
import type { Container, LibraryItem, PackingPlan, Trip, UnitSystem } from '../types';

type SeparationNotesProps = {trip:Trip;items:LibraryItem[];bags:Container[];plan:PackingPlan;unit:UnitSystem};

export const SeparationNotes=memo(function SeparationNotes({trip,items,bags,plan,unit}: SeparationNotesProps){
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
},(previous,next)=>previous.trip.entries===next.trip.entries
  &&previous.trip.separationRules===next.trip.separationRules
  &&previous.trip.lockedPlacements===next.trip.lockedPlacements
  &&previous.items===next.items&&previous.bags===next.bags&&previous.plan===next.plan&&previous.unit===next.unit);
