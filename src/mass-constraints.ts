import type { BagMassConflict, Container, LibraryItem, Placement, PlanItem } from './types.ts';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Missing weights remain uncertain. Present invalid values cannot disable a hard mass gate. */
export function itemMassError(item: Pick<LibraryItem, 'massGrams' | 'massRangeGrams'>): string | undefined {
  if (item.massGrams !== undefined && (!finite(item.massGrams) || item.massGrams <= 0)) return 'Item weight must be a finite positive number.';
  const range = item.massRangeGrams;
  if (range !== undefined && (!range || !finite(range.min) || range.min < 0 || !finite(range.max) || range.max <= 0 || range.min > range.max)) {
    return 'Item weight range must have a finite nonnegative lower value and a positive upper value at least as large.';
  }
}

export function bagMassRecordError(bag: Pick<Container, 'tareGrams' | 'massLimitGrams'>): string | undefined {
  if (bag.tareGrams !== undefined && (!finite(bag.tareGrams) || bag.tareGrams < 0)) return 'Empty bag weight must be a finite nonnegative number.';
  if (bag.massLimitGrams !== undefined && (!finite(bag.massLimitGrams) || bag.massLimitGrams <= 0)) return 'Bag weight limit must be a finite positive number.';
}

/** Check a saved physical set before accepting it into a new plan. Unknown values do not erase a known excess. */
export function savedBagMassConflict(bag: Container, placements: Placement[], items: Map<string, PlanItem>): BagMassConflict | undefined {
  let knownUpperMassGrams = bag.tareGrams ?? 0, missingItemCount = 0;
  const missingTare = bag.tareGrams === undefined;
  const invalid = (reason: string): BagMassConflict => ({ containerId: bag.id, status: 'invalid', missingItemCount, missingTare, reason });
  const recordError = bagMassRecordError(bag);
  if (recordError) return invalid(recordError);
  for (const p of placements) if (p.containerId === bag.id) {
    const mass = items.get(p.instanceId)?.upperMassGrams;
    if (mass === undefined) { missingItemCount++; continue; }
    if (!finite(mass) || mass <= 0) return invalid('A saved packed item has an invalid upper weight. Correct its record before replanning.');
    knownUpperMassGrams += mass;
  }
  if (!Number.isFinite(knownUpperMassGrams)) return invalid('Recorded bag and item weights exceed the supported numeric range. Correct them before replanning.');
  if (bag.massLimitGrams === undefined || knownUpperMassGrams <= bag.massLimitGrams + .01) return;
  const show = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: 3 });
  return { containerId: bag.id, status: 'over', knownUpperMassGrams, limitGrams: bag.massLimitGrams, missingItemCount, missingTare,
    reason: `Upper saved packed weight${missingTare || missingItemCount ? ' subtotal' : ''} of ${show(knownUpperMassGrams)} g exceeds the recorded bag weight limit of ${show(bag.massLimitGrams)} g. Saved positions and completion remain unchanged; check the real contents and weights before correcting records or undoing packed positions. New placements in this bag are paused.` };
}
