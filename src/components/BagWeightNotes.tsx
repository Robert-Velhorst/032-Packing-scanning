import { recordedBagWeights, recordedWeightSpread, unresolvedPackedBagCounts } from '../bag-weights';
import { BagMassConflictNote } from './BagMassConflictNote';
import type { Container, PackingPlan, Trip, UnitSystem } from '../types';

const displayWeight = (grams: number, unit: UnitSystem) => unit === 'metric' ? `${Math.round(grams)} g` : `${Math.round(grams / 28.3495 * 10) / 10} oz`;

export function BagWeightNotes({ containers, plan, trip, unit = 'metric' }: { containers: Container[]; plan: PackingPlan; trip: Trip; unit?: UnitSystem }) {
  if (!containers.length) return null;
  const records = recordedBagWeights(containers, plan.summaries, unresolvedPackedBagCounts(containers, plan.placements, trip.lockedPlacements)), spread = recordedWeightSpread(records);
  return <section className="bag-weight-comparison" aria-label="Recorded bag weights"><h3>Recorded bag weights</h3>
    <p>Upper saved weights of planned items plus empty bag weight. Weigh each packed bag; these records do not establish balance or carrier acceptance.</p>
    <ul>{records.map(record => <li key={record.containerId}><strong>{containers.find(bag => bag.id === record.containerId)!.name}</strong><span>{record.complete ? record.estimated ? 'Estimated total' : 'Recorded total' : 'Known subtotal'}: {displayWeight(record.subtotalGrams, unit)}</span>
      {!record.complete && <small>{record.missingItemCount > 0 ? `${record.missingItemCount} item ${record.missingItemCount === 1 ? 'weight' : 'weights'} missing. ` : ''}{record.missingTare ? 'Empty bag weight missing. ' : ''}Total remains incomplete.</small>}
      {record.unresolvedPackedCount > 0 && <small>{record.unresolvedPackedCount} saved packed {record.unresolvedPackedCount === 1 ? 'position needs' : 'positions need'} review. Their contents may still be in the bag.</small>}
      <BagMassConflictNote conflict={plan.massConflicts?.find(c => c.containerId === record.containerId)} unit={unit}/>
      {record.limitGrams !== undefined && !plan.massConflicts?.some(c => c.containerId === record.containerId) && <small>{record.limitStatus === 'over' ? 'Exceeds recorded limit' : record.limitStatus === 'incomplete' ? 'Limit check incomplete' : 'Within recorded limit'} · {displayWeight(record.limitGrams, unit)}. {record.limitStatus === 'over' && !record.complete ? 'Known subtotal already exceeds it. ' : ''}Check the applicable allowance.</small>}
    </li>)}</ul>
    {containers.length > 1 && <p>{spread === undefined ? 'Add missing weights before comparing complete bag totals.' : `Recorded difference between heaviest and lightest bags: ${displayWeight(spread, unit)}.`} Balanced favors lighter eligible bags when the relevant weights are available; assignments, fit and saved packed positions take precedence.</p>}
  </section>;
}
