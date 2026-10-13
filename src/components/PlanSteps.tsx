import { SeparationNotes } from './SeparationRules';
import { compartmentFor } from '../compartments';
import { packingFormInstruction } from '../packing-forms';
import { PackingFormNotes } from './PackingFormNotes';
import { packingItemForPlacement } from '../packing-forms';
import { StackLoadNotes } from './StackLoadNotes';
import { RetrievalNotes } from './RetrievalNotes';
import { HandlingPropertyNotes, OpeningEvidenceNotes } from './HandlingPropertyNotes';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Lock, Mic, MicOff, PackageCheck, SkipForward, Volume2, XCircle } from 'lucide-react';
import { PackCanvas } from './PackCanvas';
import { PackingDiagram } from './PackingDiagram';
import { nextUnpackedStep, orderPackingSteps, packingStepPreview, packingStepRelation, resumePackingStep } from '../packing-sequence';
import { uprightInstruction } from '../upright';
import { usePackingVoice } from '../voice/usePackingVoice';
import { useDeviceWorkspace } from './DeviceWorkspace';
import { readLocalStep, stopReading } from '../voice/reading';
import type { PackingVoiceCommand } from '../voice/commands';
import type { Container, LibraryItem, PackingPlan, Placement, Trip } from '../types';

interface Props {
  getPhoto: (id:string)=>Promise<Blob|undefined>;
  trip: Trip; plan: PackingPlan; containers: Container[]; items: LibraryItem[];
  onExit: () => void;
  onComplete: (instanceId: string, complete: boolean) => void;
  onUnavailable: (instanceId: string) => void;
  onLock: (placement: Placement) => void;
  onDoesNotFit: (placement: Placement) => void;
  onResetFailed: () => void;
  onSelectStep: (instanceId: string) => void;
  onPrintSequence: () => void;
}

export function PlanSteps({ getPhoto, trip, plan, containers, items, onExit, onComplete, onUnavailable, onLock, onDoesNotFit, onResetFailed, onSelectStep, onPrintSequence }: Props) {
  const device=useDeviceWorkspace();
  const [selection, setSelection] = useState(() => { const steps = orderPackingSteps(plan.placements, containers); const index = resumePackingStep(steps, trip.packingCursor, trip.completedInstanceIds); return { id: steps[index]?.instanceId ?? '', index }; });
  const [diagramOnly, setDiagramOnly] = useState(false);
  const [pending, setPending] = useState<{ command: 'does_not_fit' | 'unavailable'; key: string }>();
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const [photoUrl, setPhotoUrl] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmation = useRef<HTMLButtonElement>(null);
  const previousPending = useRef(false);
  const readingGeneration = useRef(0);
  const advancingFrom = useRef<string | undefined>(undefined);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const ordered = useMemo(() => orderPackingSteps(plan.placements, containers), [plan.placements, containers]);
  const selectedIndex = ordered.findIndex((step) => step.instanceId === selection.id);
  const safeIndex = selectedIndex >= 0 ? selectedIndex : Math.min(selection.index, Math.max(0, ordered.length - 1));
  const placement = ordered[safeIndex];
  const item = placement ? packingItemForPlacement(itemById.get(placement.itemId),placement) : undefined;
  const packingForm=item?.packingForms?.find(form=>form.id===placement?.packingFormId);
  const bag = placement ? containers.find((container) => container.id === placement.containerId) : undefined;
  const compartment=bag?compartmentFor(bag,placement?.compartmentId):undefined;
  const completed = new Set(trip.completedInstanceIds);
  const doneCount = ordered.filter((step) => completed.has(step.instanceId)).length;
  const locked = !!placement && trip.lockedPlacements.some((saved) => saved.instanceId === placement.instanceId);
  const preview = useMemo(() => packingStepPreview(ordered, safeIndex, trip.completedInstanceIds), [ordered, safeIndex, trip.completedInstanceIds]);
  const previewPlan = useMemo(() => ({ ...plan, placements: preview }), [plan, preview]);
  const numbers = useMemo(() => Object.fromEntries(ordered.map((step, index) => [step.instanceId, String(index + 1)])), [ordered]);
  const baseKey = JSON.stringify([trip.id, trip.updatedAt, safeIndex, placement]);
  const voice = usePackingVoice(baseKey + ':' + (pending?.command ?? ''), runCommand, device.confirmInteraction);

  useEffect(() => {
    const packed = advancingFrom.current;
    if (!packed || !trip.completedInstanceIds.includes(packed)) return;
    advancingFrom.current = undefined;
    const next = nextUnpackedStep(ordered, packed, trip.completedInstanceIds);
    if (next >= 0) {
      setSelection({ id: ordered[next].instanceId, index: next });
      onSelectStep(ordered[next].instanceId);
    }
  }, [ordered, trip.completedInstanceIds, onSelectStep]);

  useEffect(() => { setPending(undefined); readingGeneration.current++; stopReading(); setReading(false); voice.resume(); heading.current?.focus({ preventScroll: true }); }, [baseKey]);
  useEffect(() => {
    if (pending) confirmation.current?.focus();
    else if (previousPending.current) heading.current?.focus({ preventScroll: true });
    previousPending.current = !!pending;
  }, [pending]);
  useEffect(() => {
    let active = true; let url = ''; setPhotoUrl('');
    if (item?.photoId) void getPhoto(item.photoId).then((photo) => {
      if (active && photo) { url = URL.createObjectURL(photo); setPhotoUrl(url); }
    }).catch(() => {});
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [item?.photoId,getPhoto]);
  useEffect(() => {
    const leaving = () => { readingGeneration.current++; stopReading(); setReading(false); };
    const hidden = () => { if (document.hidden) leaving(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { readingGeneration.current++; stopReading(); document.removeEventListener('visibilitychange', hidden); };
  }, []);

  function select(index: number) {
    const next = Math.max(0, Math.min(ordered.length - 1, index));
    setSelection({ id: ordered[next]?.instanceId ?? '', index: next });
    if (ordered[next]) onSelectStep(ordered[next].instanceId);
  }
  function markPacked() {
    if (!placement) return;
    if (!completed.has(placement.instanceId)) {
      advancingFrom.current = placement.instanceId;
      onComplete(placement.instanceId, true);
    } else {
      const next = nextUnpackedStep(ordered, placement.instanceId, trip.completedInstanceIds);
      if (next >= 0) select(next);
    }
    setMessage((item?.name ?? 'Item') + ' marked packed. Its position is preserved when the plan changes.');
  }
  async function speak() {
    if (!placement || !item || !bag) return;
    const generation = ++readingGeneration.current;
    voice.pause(); setReading(true); setMessage('Reading this step with an on-device voice…');
    try {
      await readLocalStep('Step ' + (safeIndex + 1) + '. Place ' + item.name + ' in ' + bag.name + (compartment?', compartment '+compartment.name:'') + ', layer ' + placement.layer + '. ' + packingFormInstruction(packingForm) + ' ' + (item.fragile ? 'This item is fragile. Nothing may rest on it. ' : '') + uprightInstruction(item,bag) + ' ' + (!item.fragile && item.maxTopLoadGrams !== undefined ? 'The recorded additional weight allowed above is ' + item.maxTopLoadGrams + ' grams. This does not verify pressure or impact protection. ' : '') + packingStepRelation(placement,ordered,items,bag) + ' Position from the bag inside corner: '+Math.round(placement.x)+', '+Math.round(placement.y)+', '+Math.round(placement.z)+' millimetres. These dimensions are a planning estimate. Confirm that it physically fits.');
      if (generation === readingGeneration.current) setMessage('Step read aloud.');
    } catch (error) { if (generation === readingGeneration.current) setMessage(error instanceof Error ? error.message : 'Spoken steps are unavailable.'); }
    finally { if (generation === readingGeneration.current) { setReading(false); voice.resume(); } }
  }
  function confirmPending() {
    if (!pending || pending.key !== baseKey || !placement) { setPending(undefined); return; }
    if (pending.command === 'does_not_fit') {
      setSelection({ id: placement.instanceId, index: safeIndex }); onDoesNotFit(placement);
      setMessage((item?.name ?? 'Item') + ': trying another placement. Other packed or locked positions stay in place. Any unresolved item remains in the review list.');
    } else {
      select(Math.min(safeIndex + 1, ordered.length - 1)); onUnavailable(placement.instanceId);
      setMessage((item?.name ?? 'Item') + ' marked unavailable for this pack. Restore it from the plan checklist if needed.');
    }
    setPending(undefined);
  }
  function runCommand(command: PackingVoiceCommand) {
    if (command === 'cancel') { setPending(undefined); setMessage('Change cancelled.'); return; }
    if (command === 'confirm') { confirmPending(); return; }
    if (pending) { setMessage('Confirm or cancel the pending change before continuing.'); return; }
    if (command === 'repeat') { void speak(); return; }
    if (command === 'back') { select(safeIndex - 1); return; }
    if (command === 'next' || command === 'skip') { select(safeIndex + 1); return; }
    if (command === 'packed') { markPacked(); return; }
    if (command === 'lock' && placement) { onLock(placement); setMessage('This placement is locked.'); return; }
    if ((command === 'does_not_fit' || command === 'unavailable') && placement) setPending({ command, key: baseKey });
  }

  return <main className="steps-page">
    <header className="steps-header">
      <button className="text-button back-button" onClick={onExit}><ArrowLeft size={17} aria-hidden="true"/> Back to plan</button>
      <button className="button button-secondary sequence-open" onClick={onPrintSequence}>Printable sequence</button>
      <div className="steps-progress-label"><span>PACKING MODE</span><strong>{doneCount} of {ordered.length} packed</strong></div>
      <div className="steps-progress" role="progressbar" aria-label="Items packed" aria-valuemin={0} aria-valuemax={ordered.length || 1} aria-valuenow={doneCount}><span style={{ width: (ordered.length ? doneCount / ordered.length * 100 : 0) + '%' }}/></div>
    </header>
    <details className="packing-voice" aria-label="Optional voice controls">
      <summary>Optional voice controls · {voice.enabled ? 'enabled' : 'off'}</summary><div className="voice-panel-body">
      <div><strong>Hands-free voice · English</strong><p>Uses on-device recognition. This app does not save audio or transcripts. Listening stops when you leave or hide this screen. Accepted commands keep an unlocked workspace active; silence does not.</p></div>
      <button className={'button ' + (voice.enabled ? 'button-secondary' : 'button-primary')} onClick={voice.enabled ? voice.stop : voice.enable} disabled={voice.installing || !placement || (reading && !voice.enabled)} aria-pressed={voice.enabled}>{voice.enabled ? <MicOff size={19} aria-hidden="true"/> : <Mic size={19} aria-hidden="true"/>}{voice.enabled ? 'Stop voice' : 'Enable voice'}</button>
      <p className="voice-status" role="status" aria-live="polite">{voice.state.message}</p>
      {voice.state.downloadable && <div className="voice-download"><p>Downloads an English speech model through your browser or device provider. Download size varies. Enable voice afterwards to start listening.</p><button className="button button-secondary" disabled={voice.installing} onClick={() => void voice.install()}>{voice.installing ? 'Requesting download…' : 'Download English speech model'}</button></div>}
      <details><summary>Voice commands</summary><p>Begin each phrase with “Packing”: <strong>next, back, skip, packed, repeat, lock placement, does not fit, item unavailable, confirm, cancel, stop listening.</strong> Failed-placement and unavailable changes require confirmation. If recognition is uncertain, use touch.</p></details>
    </div></details>
    <p className="packing-feedback" role="status" aria-live="polite">{message}</p>
    {!!trip.rejectedPlacements?.length && <aside className="packing-retry"><p>{trip.rejectedPlacements.length} failed placement {trip.rejectedPlacements.length === 1 ? 'attempt is' : 'attempts are'} excluded. Reset only after checking the item or bag. Packed positions stay locked.</p><button className="button button-secondary" onClick={() => { onResetFailed(); setMessage('Failed attempts cleared. The plan can try those positions again.'); }}>Reset failed attempts</button></aside>}
    {placement && item && bag ? <>
      <div className="step-count">STEP {String(safeIndex + 1).padStart(2, '0')} <span>OF {String(ordered.length).padStart(2, '0')}</span></div>
      <section className="active-step" aria-labelledby="packing-step-title">
        <div className="step-item-image">{photoUrl ? <img src={photoUrl} alt={item.name}/> : <><span className={'category-dot ' + item.category}/>{item.name.slice(0,1).toUpperCase()}</>}</div>
        <p className="eyebrow">{bag.name}{compartment&&` · ${compartment.name}`} · LAYER {placement.layer}</p>
        <h1 id="packing-step-title" ref={heading} tabIndex={-1}>{item.name}</h1>
        <OpeningEvidenceNotes bag={bag}/><HandlingPropertyNotes item={item} expanded/><StackLoadNotes plan={plan} items={items} instanceId={placement.instanceId}/><SeparationNotes trip={trip} items={items} bags={containers} plan={plan} unit="metric"/><RetrievalNotes trip={trip} items={items} bags={containers} plan={plan} instanceId={placement.instanceId}/>
        <p className="step-description">Place this item in <strong>{compartment?`${compartment.name} in ${bag.name}`:bag.name}</strong>. Follow the position below.</p>
        <section className="step-model" aria-label="Current placement view">
          <p><strong>Step {safeIndex + 1}: {item.name}</strong>. Earlier planned positions and any confirmed items are shown as context.</p>
          <button className="button button-secondary" onClick={() => setDiagramOnly(!diagramOnly)}>{diagramOnly ? 'Show 3D view' : 'Show top-view diagram'}</button>
          {diagramOnly ? <PackingDiagram bag={bag} placements={preview} currentId={placement.instanceId} numbers={numbers} items={items}/> : <PackCanvas container={bag} plan={previewPlan} items={items} selectedInstanceId={placement.instanceId} placementLabels={numbers} view="3d"/>}
          <p>{packingStepRelation(placement, ordered, items, bag)} The solid dot marks the reference corner.</p><p className="step-model-legend">{preview.map((step) => `${numbers[step.instanceId]}. ${itemById.get(step.itemId)?.name ?? 'Item'}${step.instanceId === placement.instanceId ? ' (current step)' : completed.has(step.instanceId) ? ' (confirmed packed)' : ' (earlier planned step)'}`).join(' · ')}</p>
        </section>
        <div className="step-placement"><div><span>Position</span><strong>{Math.round(placement.x)} × {Math.round(placement.y)} × {Math.round(placement.z)} mm from the inside corner</strong></div><div><span>Orientation</span><strong>Length × width × height: {Math.round(placement.length)} × {Math.round(placement.width)} × {Math.round(placement.height)} mm</strong></div></div>
        <PackingFormNotes form={packingForm}/>
        {(item.fragile || item.keepUpright) && <div className="step-care"><strong>Careful placement</strong><span>{[item.fragile && 'Nothing may rest on this item. Add cushioning and include its size and weight; impact protection is not simulated.', uprightInstruction(item,bag)].filter(Boolean).join(' ')}</span></div>}
        {item.dimensionEvidence.source === 'estimated' && <p className="step-note">Size is an estimate. Check the real item fits before placing it.</p>}
        {item.massEvidence?.source === 'estimated' && <p className="step-note">Weight is an estimate{item.massRangeGrams ? ' (' + item.massRangeGrams.min + '–' + item.massRangeGrams.max + ' g)' : ''}. Weigh it before relying on the bag limit.</p>}
        <button className="speak-button" onClick={() => reading ? (readingGeneration.current++, stopReading(), setReading(false), voice.resume()) : void speak()}><Volume2 size={19} aria-hidden="true"/> {reading ? 'Stop reading' : 'Read this step aloud'}</button>
        <div className="step-actions">
          <button className="button button-secondary" disabled={safeIndex === 0 || !!pending} onClick={() => select(safeIndex - 1)}><ArrowLeft size={19} aria-hidden="true"/> Previous</button>
          <button className="button button-primary step-done" disabled={!!pending} onClick={markPacked}><Check size={20} aria-hidden="true"/>{completed.has(placement.instanceId) ? 'Packed · continue' : 'Mark packed'}</button>
          <button className="button button-secondary" disabled={safeIndex === ordered.length - 1 || !!pending} onClick={() => select(safeIndex + 1)}>Next <ArrowRight size={19} aria-hidden="true"/></button>
        </div>
        <div className="step-secondary-actions">
          <button className="button button-secondary" disabled={locked || !!pending} onClick={() => onLock(placement)}><Lock size={17} aria-hidden="true"/>{locked ? 'Placement locked' : 'Lock placement'}</button>
          <button className="button button-secondary" disabled={safeIndex === ordered.length - 1 || !!pending} onClick={() => select(safeIndex + 1)}><SkipForward size={17} aria-hidden="true"/> Skip step</button>
          {completed.has(placement.instanceId) && <button className="button button-secondary" disabled={!!pending} onClick={() => { onComplete(placement.instanceId, false); setMessage('Packed confirmation undone. This item can move when the plan changes.'); }}>Undo packed</button>}
          <button className="button button-secondary not-fit" disabled={!!pending} onClick={() => setPending({ command: 'does_not_fit', key: baseKey })}><XCircle size={17} aria-hidden="true"/> Does not fit</button>
          <button className="button button-secondary" disabled={!!pending} onClick={() => setPending({ command: 'unavailable', key: baseKey })}>Item unavailable</button>
        </div>
        {pending && <section className="packing-confirm" aria-label="Confirm packing change"><p>{pending.command === 'does_not_fit' ? 'Reject this placement of ' + item.name + ' and try an alternative? Other locked positions stay in place.' : 'Mark ' + item.name + ' unavailable for this pack? Its current packed confirmation and lock will be removed.'}</p><div><button ref={confirmation} className="button button-primary" onClick={confirmPending}>Confirm {pending.command === 'does_not_fit' ? 'failed placement' : 'item unavailable'}</button><button className="button button-secondary" onClick={() => setPending(undefined)}>Cancel change</button></div><small>Or say “Packing, confirm” or “Packing, cancel”.</small></section>}
      </section>
      <div className="step-list"><strong>Pack in this order</strong>{ordered.map((step,index) => <button key={step.instanceId} className={'step-list-item ' + (index === safeIndex ? 'active ' : '') + (completed.has(step.instanceId) ? 'complete' : '')} aria-current={index === safeIndex ? 'step' : undefined} disabled={!!pending} onClick={() => select(index)}><span className="step-list-number">{completed.has(step.instanceId) ? <Check size={16} aria-label="Packed"/> : String(index + 1).padStart(2,'0')}</span><span>{itemById.get(step.itemId)?.name ?? 'Item'}<small>{containers.find((candidate) => candidate.id === step.containerId)?.name} · layer {step.layer}</small></span>{step.locked && <Lock size={16} aria-label="Placement locked"/>}</button>)}</div>
    </> : <section className="steps-empty"><PackageCheck size={38} aria-hidden="true"/><h1>No placement steps available</h1><p>Add a bag and measured items, or review unresolved items below.</p><button className="button button-primary" onClick={onExit}>Review plan</button></section>}
    {plan.excluded.filter((entry) => entry.reason !== 'Marked unavailable for this plan.').length > 0 && <section className="packing-unresolved"><h2>Still needs a decision</h2>{plan.excluded.filter((entry) => entry.reason !== 'Marked unavailable for this plan.').map((entry) => <p key={entry.instanceId}><strong>{entry.name}{entry.required ? ' · required' : ''}</strong><br/>{entry.reason}</p>)}<button className="button button-secondary" onClick={onExit}>Review items and bags</button></section>}
  </main>;
}
