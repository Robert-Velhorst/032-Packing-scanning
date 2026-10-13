import type { Container, ContainerSummary, Placement, PlanItem } from './types';
import { isValidRejectedPlacement, samePlacementGeometry } from './packing-progress';

const weight = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export interface RecordedBagWeight {
  containerId: string;
  itemCount: number;
  subtotalGrams: number;
  missingItemCount: number;
  missingTare: boolean;
  unresolvedPackedCount: number;
  complete: boolean;
  estimated: boolean;
  limitGrams?: number;
  limitStatus: 'over' | 'within_recorded' | 'incomplete' | 'not_recorded';
}

/** A saved-weight comparison, never a scale reading or a centre-of-mass model. */
export function recordedBagWeights(containers: Container[], summaries: ContainerSummary[], unresolvedPacked: Map<string, number> = new Map()): RecordedBagWeight[] {
  return containers.map(bag => {
    const summary = summaries.find(s => s.containerId === bag.id);
    const validItems = !!summary && weight(summary.usedMassGrams) && Number.isInteger(summary.unweighedCount) && summary.unweighedCount >= 0;
    const missingItemCount = validItems ? summary.unweighedCount : Math.max(1, summary?.itemCount ?? 0);
    const missingTare = !weight(bag.tareGrams);
    const subtotalGrams = (validItems ? summary.usedMassGrams : 0) + (missingTare ? 0 : bag.tareGrams!);
    const unresolvedPackedCount = unresolvedPacked.get(bag.id) ?? 0;
    const complete = validItems && missingItemCount === 0 && !missingTare && unresolvedPackedCount === 0;
    const limitGrams = weight(bag.massLimitGrams) ? bag.massLimitGrams : undefined;
    return { containerId: bag.id, itemCount: summary?.itemCount ?? 0, subtotalGrams, missingItemCount, missingTare, unresolvedPackedCount, complete,
      estimated: (summary?.estimatedMassCount ?? 0) > 0 || !bag.tareEvidence || bag.tareEvidence.source === 'estimated',
      limitGrams, limitStatus: limitGrams === undefined ? 'not_recorded' : subtotalGrams > limitGrams + .01 ? 'over' : !complete ? 'incomplete' : 'within_recorded' };
  });
}

/** A paused/rejected saved lock may still represent a physically packed item. */
export function unresolvedPackedBagCounts(containers: Container[], placements: Placement[], locks: Placement[]): Map<string, number> {
  const result = new Map<string, number>();
  const accepted = new Map(placements.filter(p => p.locked).map(p => [JSON.stringify([p.instanceId, p.containerId]), p]));
  for (const raw of locks) {
    if (isValidRejectedPlacement(raw)) {
      const placement = accepted.get(JSON.stringify([raw.instanceId, raw.containerId]));
      if (placement && samePlacementGeometry(raw, placement)) continue;
    }
    const id = (raw as unknown as { containerId?: unknown } | null)?.containerId;
    const affected = typeof id === 'string' && containers.some(bag => bag.id === id) ? containers.filter(bag => bag.id === id) : containers;
    for (const bag of affected) result.set(bag.id, (result.get(bag.id) ?? 0) + 1);
  }
  return result;
}

export function recordedWeightSpread(records: RecordedBagWeight[]): number | undefined {
  if (records.length < 2 || records.some(record => !record.complete)) return;
  const weights = records.map(record => record.subtotalGrams);
  return Math.max(...weights) - Math.min(...weights);
}

function completeTotals(containers: Container[], placements: Placement[], items: Map<string, PlanItem>): Map<string, number> | undefined {
  const totals = new Map<string, number>();
  for (const bag of containers) {
    if (!weight(bag.tareGrams)) return;
    let total = bag.tareGrams;
    for (const placement of placements) if (placement.containerId === bag.id) {
      const mass = items.get(placement.instanceId)?.upperMassGrams;
      if (!weight(mass)) return;
      total += mass;
    }
    if (!Number.isFinite(total)) return;
    totals.set(bag.id, total);
  }
  return totals;
}

/** Incremental squared totals favor the lighter eligible bag, including tare.
 * Missing weights disable this preference; every physical placement gate still runs. */
export function balancedBagCosts(containers: Container[], placements: Placement[], items: Map<string, PlanItem>, mass: number | undefined): Map<string, number> {
  const costs = new Map<string, number>();
  if (containers.length < 2 || !weight(mass) || mass === 0) return costs;
  const totals = completeTotals(containers, placements, items);
  if (!totals) return costs;
  const scale = Math.max(mass, ...totals.values());
  const normalizedMass = mass / scale;
  const projectedSum = [...totals.values()].reduce((sum, value) => sum + value / scale, normalizedMass);
  for (const [id, total] of totals) costs.set(id, (2 * (total / scale) * normalizedMass + normalizedMass ** 2) / projectedSum ** 2);
  return costs;
}

/** Bounded tie preference only; it cannot outweigh one excluded optional item. */
export function balancedResultPenalty(containers: Container[], placements: Placement[], items: Map<string, PlanItem>): number {
  if (containers.length < 2) return 0;
  const totals = completeTotals(containers, placements, items);
  if (!totals) return 0;
  const scale = Math.max(...totals.values());
  if (scale === 0) return 0;
  const normalized = [...totals.values()].map(value => value / scale), sum = normalized.reduce((a, b) => a + b, 0);
  return 5 * normalized.reduce((penalty, value) => penalty + (value / sum) ** 2, 0);
}
