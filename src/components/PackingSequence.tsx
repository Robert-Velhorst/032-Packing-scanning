import { SeparationNotes } from './SeparationRules';
import { compartmentFor } from '../compartments';
import { RetrievalNotes } from './RetrievalNotes';
import { BagWeightNotes } from './BagWeightNotes';
import { PackingEvidenceReview } from './PackingEvidenceReview';
import { PackingFormNotes } from './PackingFormNotes';
import { packingItemForPlacement } from '../packing-forms';
import { StackLoadNotes } from './StackLoadNotes';
import { HandlingPropertyNotes, OpeningEvidenceNotes } from './HandlingPropertyNotes';
import { uprightInstruction } from '../upright';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WeatherNotes } from './WeatherLookup';
import { ArrowLeft, Printer } from 'lucide-react';
import { orderPackingSteps, packingStepPreview, packingStepRelation } from '../packing-sequence';
import { PackingDiagram } from './PackingDiagram';
import { ContainerSpaceNotes } from './ContainerSpaceNotes';
import { printingAvailable, printPackingSequence } from '../printing';
import { LocalPhoto } from './LocalPhoto';
import type { Container, LibraryItem, PackingPlan, Trip } from '../types';

export function PackingSequence({ trip, plan, containers, items, getPhoto, onExit }: { trip: Trip; plan: PackingPlan; containers: Container[]; items: LibraryItem[]; getPhoto:(id:string)=>Promise<Blob|undefined>; onExit: () => void }) {
  const ordered = useMemo(() => orderPackingSteps(plan.placements, containers), [plan.placements, containers]);
  const heading = useRef<HTMLHeadingElement>(null);
  const [printing, setPrinting] = useState(false);
  const [printMessage, setPrintMessage] = useState('');
  useEffect(() => { heading.current?.focus(); }, []);
  async function print() {
    setPrinting(true); setPrintMessage('');
    try { await printPackingSequence(); setPrintMessage('Print dialog requested. Choose your printer or save as PDF.'); }
    catch (error) { setPrintMessage(error instanceof Error ? error.message : 'Printing could not start.'); }
    finally { setPrinting(false); }
  }
  const itemById = new Map(items.map((item) => [item.id, item]));
  const bagById = new Map(containers.map((bag) => [bag.id, bag]));
  const numbers = Object.fromEntries(ordered.map((step, index) => [step.instanceId, String(index + 1)]));
  const sequenceIds = new Set(ordered.map((step) => step.instanceId));
  const outsidePackedCount = [...new Set(trip.completedInstanceIds)].filter((id) => !sequenceIds.has(id)).length;
  return <main className="packing-sequence-page">
    <div className="sequence-toolbar"><button className="button button-secondary" onClick={onExit}><ArrowLeft size={18}/> Back to packing</button><button className="button button-primary" disabled={printing || !printingAvailable()} onClick={() => void print()}><Printer size={18}/>{printing ? 'Preparing print…' : 'Print or save PDF'}</button></div>
    <p className="sequence-print-status" role="status">{printMessage || (!printingAvailable() ? 'Printing is unavailable on this device. The sequence remains available offline.' : '')}</p>
    <header><p className="eyebrow">OFFLINE PACKING SEQUENCE</p><h1 ref={heading} tabIndex={-1}>{trip.name}</h1><p>{ordered.length} items in this sequence · {ordered.filter((step) => trip.completedInstanceIds.includes(step.instanceId)).length} confirmed in this sequence</p>{outsidePackedCount > 0 && <p>{outsidePackedCount} saved packed {outsidePackedCount === 1 ? 'confirmation is' : 'confirmations are'} outside this sequence. Their contents may still be in the bags; review the conflicts before changing packed positions.</p>}<p>Packing record updated {new Date(trip.updatedAt).toLocaleString()}. This copy will not update after printing.</p></header>
    <p className="sequence-note">Adopted occupied-cell shapes or rectangular planning estimates. Follow the insertion sequence; confirm real support, opening clearance and bag closure. Numbered shapes are planned positions, not proof that an item has been packed. All positions and dimensions below use millimetres.</p>
    {trip.sample && <p className="sequence-note">Example pack: replace sample dimensions and weights before relying on the plan.</p>}
    <section className="sequence-bags"><h2>Bag contents</h2>{containers.map((bag) => {
      const summary = plan.summaries.find((entry) => entry.containerId === bag.id);
      return <div key={bag.id}><h3>{bag.name}</h3><p>{summary?.itemCount ?? 0} planned items · upper saved item weight {Math.round(summary?.usedMassGrams ?? 0)} g{summary?.unweighedCount ? ' · ' + summary.unweighedCount + ' items with unknown weight' : ''}{summary?.estimatedMassCount ? ' · includes estimated weight' : ''}. Empty bag weight {bag.tareGrams === undefined ? 'not recorded' : Math.round(bag.tareGrams) + ' g'}. Weigh the packed bag before relying on a limit.</p><OpeningEvidenceNotes bag={bag}/><ContainerSpaceNotes bag={bag}/></div>;
    })}</section>
    <BagWeightNotes containers={containers} plan={plan} trip={trip}/>
    <WeatherNotes trip={trip} unit="metric"/>
    <SeparationNotes trip={trip} items={items} bags={containers} plan={plan} unit="metric"/>
    <RetrievalNotes trip={trip} items={items} bags={containers} plan={plan}/>
    <PackingEvidenceReview trip={trip} items={items} bags={containers} plan={plan} unit="metric" print/>
    <ol className="sequence-cards">{ordered.map((step, index) => {
      const item = packingItemForPlacement(itemById.get(step.itemId),step), bag = bagById.get(step.containerId);
      if (!item || !bag) return null;
      return <li key={step.instanceId} className="sequence-card"><div className="sequence-step-heading"><strong className="sequence-number">{index + 1}</strong>{item.photoId && <LocalPhoto eager photoId={item.photoId} getPhoto={getPhoto} className="sequence-photo" alt={item.name}/>}<div><h2>{item.name}</h2><p>{bag.name}{step.compartmentId&&` · ${compartmentFor(bag,step.compartmentId)?.name??'Missing compartment'}`} · {trip.travellers.find((traveller) => traveller.id === trip.entries.find((entry) => entry.id === step.entryId)?.travellerId)?.name ?? 'Traveller'} · {trip.completedInstanceIds.includes(step.instanceId) ? 'Confirmed packed' : 'Not confirmed packed'}</p></div></div>
        <div className="sequence-instruction"><PackingDiagram bag={bag} placements={packingStepPreview(ordered, index, trip.completedInstanceIds)} currentId={step.instanceId} numbers={numbers} notes={false} items={items}/><div><PackingFormNotes form={item.packingForms?.find(form=>form.id===step.packingFormId)}/><p>{packingStepRelation(step, ordered, items, bag)}</p><p><strong>Position:</strong> {Math.round(step.x)} × {Math.round(step.y)} × {Math.round(step.z)} mm from the inside corner.</p><p><strong>Orientation:</strong> length × width × height {Math.round(step.length)} × {Math.round(step.width)} × {Math.round(step.height)} mm.</p><p><strong>Size evidence:</strong> {item.dimensionEvidence.source.replace('_', ' ')} · {Math.round(item.dimensionEvidence.confidence * 100)}% recorded confidence.</p><HandlingPropertyNotes item={item} expanded/><StackLoadNotes plan={plan} items={items} instanceId={step.instanceId}/>{item.fragile && <p>Fragile: do not rest anything on this item. Add cushioning and include its dimensions and weight; impact protection is not simulated.</p>}{item.keepUpright && <p>{uprightInstruction(item,bag)}</p>}<p className="paper-check">□ Physically checked and packed</p></div></div>
      </li>;
    })}</ol>
    {!!plan.excluded.length && <section className="sequence-review"><h2>Items outside this sequence</h2>{plan.excluded.map((entry) => <p key={entry.instanceId}><strong>{entry.name}{entry.required ? ' · required' : ''}</strong> — {entry.reason}</p>)}</section>}
    {!!plan.warnings.length && <section className="sequence-review"><h2>Unresolved warnings</h2>{plan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</section>}
    <footer>Stored on this device. No account, sharing or carrier acceptance is implied by this sequence.</footer>
  </main>;
}
