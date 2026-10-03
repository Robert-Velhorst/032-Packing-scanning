import { SeparationNotes } from './SeparationRules';
import { useMemo } from 'react';
import { BagMassConflictNote } from './BagMassConflictNote';
import { RetrievalNotes } from './RetrievalNotes';
import { comparePackingPlan, comparisonWeightText, type ComparisonWeight } from '../plan-comparison';
import type { Container, LibraryItem, OptimizationMode, PackingPlan, Trip, UnitSystem } from '../types';

function MissingWeights({ weight }: { weight: ComparisonWeight }) {
  if (weight.complete) return null;
  return <p className="candidate-uncertainty">Weight remains incomplete.{weight.missingItemCount > 0 && ` ${weight.missingItemCount} item ${weight.missingItemCount === 1 ? 'weight' : 'weights'} missing or invalid.`}
    {weight.missingTareCount > 0 && ` ${weight.missingTareCount} empty bag ${weight.missingTareCount === 1 ? 'weight' : 'weights'} missing.`}
    {weight.unresolvedPackedCount > 0 && ` ${weight.unresolvedPackedCount} saved packed positions need review; their contents may still be in the bags.`}</p>;
}

export function PlanComparison({ trip, items, bags, plans, unit, modeCopy, onSelect }: {
  trip: Trip; items: LibraryItem[]; bags: Container[]; plans: PackingPlan[]; unit: UnitSystem;
  modeCopy: Record<OptimizationMode, { title: string; detail: string }>; onSelect: (mode: OptimizationMode) => void;
}) {
  const comparisons = useMemo(() => plans.map(plan => comparePackingPlan(trip, items, bags, plan)), [trip, items, bags, plans]);
  const mass = (n: number) => (n / (unit === 'metric' ? 1 : 28.3495)).toLocaleString('en-GB', { maximumFractionDigits: 3 }) + (unit === 'metric' ? ' g' : ' oz');
  return <section className="candidate-comparison" aria-label="Candidate plan comparison">
    <p>Compare proposed contents, saved weights and recorded bag usage before selecting an approach. Each weight includes all selected bags’ empty weights; missing values stay incomplete.</p>
    <div className="tradeoff-grid">{comparisons.map((candidate, index) => {
      const same = comparisons.slice(0, index).find(prior => prior.positionSignature === candidate.positionSignature);
      return <article className={`tradeoff-card candidate-card ${trip.mode === candidate.mode ? 'active' : ''}`} key={candidate.mode} aria-label={`${modeCopy[candidate.mode].title} candidate`}>
        <div className="tradeoff-top"><h3>{modeCopy[candidate.mode].title}</h3>{trip.mode === candidate.mode && <span>SELECTED</span>}</div>
        <p className="candidate-purpose">{modeCopy[candidate.mode].detail}</p>
        <dl className="candidate-metrics"><div><dt>Proposed items</dt><dd>{candidate.placedCount} placed · {candidate.usedBagCount} {candidate.usedBagCount === 1 ? 'bag' : 'bags'} used</dd></div>
          <div><dt>Required items</dt><dd>{candidate.requiredOutsideCount} outside this plan{candidate.unavailableRequiredCount > 0 && ` · ${candidate.unavailableRequiredCount} marked unavailable`}</dd></div>
          <div><dt>Saved weight</dt><dd>{comparisonWeightText(candidate.weight, unit)}</dd></div>
          <div><dt>Evidence reminders</dt><dd>{candidate.evidenceReviewCount} {candidate.evidenceReviewCount === 1 ? 'property' : 'properties'} to check</dd></div>
        </dl>
        <MissingWeights weight={candidate.weight}/>
        {!!candidate.weight.lowerConfidenceCount && <p className="candidate-uncertainty">Weight evidence needs review for {candidate.weight.lowerConfidenceCount} planned item {candidate.weight.lowerConfidenceCount === 1 ? 'copy or bag' : 'copies or bags'}. Their sources are unreviewed, estimated, lower confidence or invalid.</p>}
        {(candidate.missingBagCount > 0 || candidate.unlinkedPlacementCount > 0) && <p className="candidate-uncertainty">Selected bag records or placement links are missing. Restore or correct them before relying on these subtotals.</p>}
        {same && <p className="candidate-equivalence">Same placed items and proposed positions as {modeCopy[same.mode].title}. Check exclusions and warnings separately.</p>}
        <button className="button button-secondary" type="button" aria-label={`Use ${modeCopy[candidate.mode].title} plan`} aria-pressed={trip.mode === candidate.mode} onClick={() => onSelect(candidate.mode)}>{trip.mode === candidate.mode ? 'Selected plan' : 'Use this plan'}</button>
        <details className="candidate-details"><summary>Bag usage and checks · {candidate.warnings.length} warnings</summary>
          <p>{candidate.preparationCount} recorded preparations · {candidate.earlyAccessCount} priority-access items placed · {candidate.fragileCount} fragile items placed. Placement counts do not establish retrieval ease or impact protection.</p>
          <SeparationNotes trip={trip} items={items} bags={bags} plan={plans[index]} unit={unit}/>
          <RetrievalNotes trip={trip} items={items} bags={bags} plan={plans[index]}/>
          {candidate.unverifiedStackCount > 0 && <p>{candidate.unverifiedStackCount} support/load checks need review.</p>}
          <ul className="candidate-bags">{candidate.bags.map(bag => <li key={bag.id}><h4>{bag.name}</h4>
            <p>{bag.itemCount} proposed {bag.itemCount === 1 ? 'item' : 'items'} · {bag.occupiedPercent === undefined ? 'Recorded volume unavailable' : `~${bag.occupiedPercent.toLocaleString('en-GB', { maximumFractionDigits: 1 })}% of recorded usable volume`}</p>
            <p>{comparisonWeightText(bag.weight, unit)}</p><MissingWeights weight={bag.weight}/>
            <BagMassConflictNote conflict={bag.massConflict} unit={unit}/>
            {bag.limitGrams !== undefined && !bag.massConflict && <p>{bag.limitStatus === 'over' ? 'Exceeds recorded bag limit' : bag.limitStatus === 'incomplete' ? 'Bag-limit check incomplete' : 'Within recorded bag limit'} · {mass(bag.limitGrams)}.{bag.marginGrams !== undefined && ` Upper saved-weight margin: ${mass(bag.marginGrams)}.`} Check the real packed weight.</p>}
            {bag.limitNeedsReview && <p>Bag-limit source or value needs review.</p>}
          </li>)}</ul>
          {!!candidate.excluded.length && <div className="candidate-exclusions"><h4>Items outside this plan</h4><ul>{candidate.excluded.map((item, i) => <li key={`${item.instanceId}:${i}`}><strong>{item.name}{item.required ? ' · required' : ''}</strong> — {item.reason}</li>)}</ul></div>}
          {!!candidate.warnings.length && <div className="candidate-warnings"><h4>Plan warnings</h4><ul>{candidate.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
          <p>Volume uses occupied cells or rectangular bounds. Closure, physical balance, cushioning and fit are unverified. Carrier applicability and source freshness remain in Carrier rules; a bag-limit comparison does not establish carrier acceptance.</p>
        </details>
      </article>;
    })}</div>
  </section>;
}
