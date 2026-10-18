import { lazy, Suspense } from 'react';
import { BookOpen, Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { assessCarrierRule, formatComparisonNumber, isCarrierRuleStale, secureCarrierSourceUrl, type CarrierLimitCheck } from '../carrier-rules';
import { carrierRuleOverridden, carrierRuleHasUpdatedLimits, type CarrierCatalog } from '../carrier-catalog';
import type { CarrierRule, Container, ContainerSummary, LibraryItem, Placement, Trip, UnitSystem } from '../types';
const CarrierLookup = lazy(() => import('./CarrierLookup').then(module => ({ default: module.CarrierLookup })));
const dimLabel = (unit:UnitSystem) => unit === 'metric' ? 'mm' : 'in';

export function CarrierRulesPage({ trip, bags, summaries, placements, items, unit, catalog, onCatalog, onReview, onAdd, onEdit, onDelete }: { trip:Trip; bags:Container[]; summaries:ContainerSummary[]; placements:Placement[]; items:LibraryItem[]; unit:UnitSystem; catalog?:CarrierCatalog; onCatalog:(catalog:CarrierCatalog)=>void; onReview:(draft:CarrierRule)=>void; onAdd:()=>void; onEdit:(rule:CarrierRule)=>void; onDelete:(rule:CarrierRule)=>void }) {
  return <main className="secondary-page carrier-rules-page"><div className="page-heading"><div><p className="eyebrow">TRIP SOURCES</p><h1>Carrier rules</h1><p className="page-subtitle">Keep the rule you checked for this booking beside its official source.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={16}/> Add source record</button></div>
    <div className="carrier-rules-disclaimer"><ShieldCheck size={18}/><span>General baggage pages can differ from a booked flight. Check the exact itinerary, fare, operating airline, and each bag in your booking. The comparisons below check only the limits and measurements you entered; estimated or missing values need confirmation.</span></div>
    <Suspense fallback={<div className="secondary-page" role="status">Opening carrier lookup…</div>}><CarrierLookup catalog={catalog} onCatalog={onCatalog} onReview={onReview}/></Suspense>
    {trip.carrierRules.length === 0 ? <div className="library-empty"><div className="empty-icon"><BookOpen size={22}/></div><h2>No carrier source saved</h2><p>Open the airline's official source or booking details, then save the exact allowance, review date, and the bags it applies to.</p><button className="button button-secondary" onClick={onAdd}><Plus size={15}/> Add a source record</button></div> : <div className="carrier-rule-list">{trip.carrierRules.map((rule) => {
      const updatedLimits = carrierRuleHasUpdatedLimits(rule, catalog);
      const stale = isCarrierRuleStale(rule) || updatedLimits;
      const applicableBags = bags.filter((bag) => rule.applicableBagIds.includes(bag.id));
      const assessment = assessCarrierRule(rule, bags, summaries, { placements, lockedPlacements: trip.lockedPlacements, items });
      const checkedDate = Date.parse(rule.retrievedAt);
      return <article className={`carrier-rule-card ${stale ? 'stale' : ''}`} key={rule.id}>
        <div className="carrier-rule-heading"><div><h2>{rule.carrier}</h2><p>{rule.route || 'Route not specified'} <span>·</span> {rule.fare || 'Fare not specified'}</p></div><span className={`rule-status ${stale ? 'needs-review' : rule.status}`}>{updatedLimits ? 'Updated source needs review' : stale ? 'Recheck source' : rule.status === 'verified' ? 'Checked by you' : rule.retrieval ? 'Booking needs confirmation' : 'Manual note'}</span></div>
        {updatedLimits && <p className="carrier-lookup-warning" role="status">A newer retrieved source has different numeric limits for this allowance. Your saved record and manual overrides are unchanged. Review and save the latest allowance above, then choose which record to keep for your booking.</p>}
        {rule.retrieval && <div className="carrier-provenance"><strong>{carrierRuleOverridden(rule) ? 'Manual override of retrieved limits' : 'Limits from retrieved official page'}</strong><span>Original retrieval: {new Date(rule.retrieval.catalog.retrievedAt).toLocaleString()}</span><span>Allowance: {rule.retrieval.catalog.allowances.find((entry) => entry.id === rule.retrieval!.allowanceId)?.title}</span><small>Refreshing the lookup does not replace this saved record. The bag count checks this record's selected set; passenger entitlements across records are not pooled.</small></div>}
        {rule.notes && <p className="carrier-rule-notes">{rule.notes}</p>}
        <div className="carrier-rule-meta"><span>{applicableBags.length ? `For: ${applicableBags.map((bag) => bag.name).join(', ')}` : 'No bag selected'}</span><span>Reviewed {Number.isFinite(checkedDate) ? new Date(checkedDate).toLocaleDateString() : 'date unavailable'}</span><span>Refresh after {rule.staleAfterDays} days</span></div>
        {(rule.limits || assessment.needsBagSelection) && <CarrierLimitResults assessment={assessment} unit={unit}/>}
        <div className="carrier-rule-actions">{secureCarrierSourceUrl(rule.sourceUrl) ? <a className="text-button" href={secureCarrierSourceUrl(rule.sourceUrl)} target="_blank" rel="noreferrer">Open official source <BookOpen size={14}/></a> : <span className="scan-availability">Source link needs correction</span>}<button className="button button-secondary" onClick={() => onEdit(rule)}>Edit record</button><button className="quiet-icon delete-icon" aria-label={`Remove ${rule.carrier} source record`} onClick={() => onDelete(rule)}><Trash2 size={16}/></button></div>
      </article>;
    })}</div>}
    <div className="privacy-callout"><Lock size={16}/><span>Source records and notes are stored with this trip on this device. The app does not sign in to airline accounts or retrieve booking details.</span></div>
  </main>;
}

function CarrierLimitResults({ assessment, unit }: { assessment:ReturnType<typeof assessCarrierRule>; unit:UnitSystem }) {
  if (assessment.error) return <div className="carrier-limit-results" role="alert"><strong>Cannot compare limits</strong><p>{assessment.error}</p></div>;
  if (assessment.needsBagSelection) return <div className="carrier-limit-results"><strong>Cannot compare limits yet</strong><p>Select the bags this source applies to, then add their outside measurements and empty weights.</p></div>;
  const statusLabel:Record<CarrierLimitCheck['status'],string>={within:'Within entered limit',over:'Over entered limit',unknown:'Cannot check',estimate_within:'Estimated within limit',estimate_over:'Estimate above limit',subtotal_over:'Saved subtotal above limit'};
  const formatValue=(value:number,check:CarrierLimitCheck)=>check.unit==='bags'?`${value} bag${value===1?'':'s'}`:check.unit==='g'?`${formatComparisonNumber(value/(unit==='metric'?1:28.3495))} ${unit==='metric'?'g':'oz'}`:`${formatComparisonNumber(value/(unit==='metric'?1:25.4))} ${dimLabel(unit)}`;
  const allChecks=[...assessment.bags.flatMap((bag)=>bag.checks),...(assessment.combinedWeight?[assessment.combinedWeight]:[]),...(assessment.bagCount?[assessment.bagCount]:[])];
  return <div className="carrier-limit-results"><div className="carrier-limit-heading"><strong>Recorded limits comparison</strong><span>Traveller-entered values</span></div>
    {assessment.bags.map((bag)=>bag.checks.length>0&&<section className="carrier-limit-bag" key={bag.bagId}><h3>{bag.bagName}</h3>{bag.checks.map((check)=><CarrierCheckRow key={check.key} check={check} statusLabel={statusLabel} formatValue={formatValue}/>)}</section>)}
    {assessment.combinedWeight&&<section className="carrier-limit-bag"><h3>Selected bags together</h3><CarrierCheckRow check={assessment.combinedWeight} statusLabel={statusLabel} formatValue={formatValue}/></section>}
    {assessment.bagCount&&<section className="carrier-limit-bag carrier-piece-count"><h3>Selected bag allowance</h3><CarrierCheckRow check={assessment.bagCount} statusLabel={statusLabel} formatValue={formatValue}/></section>}
    {!allChecks.length&&<p>Add numeric limits to compare this source with the packing plan.</p>}
    {allChecks.some((check)=>check.unit==='g')&&<p className="carrier-limit-caveat">Weight uses saved item weights plus the recorded empty bag weight. Estimated or missing weights are flagged; weigh the packed bags before travel.</p>}
    <p className="carrier-limit-caveat">A comparison checks your entered measurements against your saved source. It does not confirm the airline will accept a bag or that the source applies to your booking.</p>
  </div>;
}

function CarrierCheckRow({ check, statusLabel, formatValue }: { check:CarrierLimitCheck; statusLabel:Record<CarrierLimitCheck['status'],string>; formatValue:(value:number,check:CarrierLimitCheck)=>string }) {
  return <div className={`carrier-limit-check ${check.status}`}><div><strong>{check.label}</strong><span className={`carrier-check-status ${check.status}`}>{statusLabel[check.status]}</span></div><p>{check.detail}</p>{check.margin!==undefined&&check.limit!==undefined&&<small>{check.margin===0?'At entered limit':check.margin>0?`${formatValue(check.margin,check)} below limit`:`${formatValue(Math.abs(check.margin),check)} over limit`}</small>}</div>;
}
