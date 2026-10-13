import type { Container, LibraryItem, Placement, Trip } from './types.ts';
import { isValidRejectedPlacement, samePlacementGeometry } from './packing-progress.ts';
import { itemMassError } from './mass-constraints.ts';

export interface CarrierPackingContext { placements: Placement[]; lockedPlacements: Trip['lockedPlacements']; items: LibraryItem[] }
export interface CarrierPackedWeight {
  subtotalGrams: number; missingItemCount: number; missingTare: boolean;
  unresolvedPackedCount: number; complete: boolean; estimated: boolean; invalidTotal: boolean;
}
const uncertain = (evidence: LibraryItem['massEvidence'] | Container['tareEvidence']) => !evidence ||
  !['measured', 'known', 'user_confirmed', 'provider'].includes(evidence.source) || !Number.isFinite(evidence.confidence) || evidence.confidence < 1;

/** Saved physical positions take precedence over proposed positions of the same instance. */
export function carrierPackedWeights(bags: Container[], context: CarrierPackingContext): Map<string, CarrierPackedWeight> {
  const result = new Map<string, CarrierPackedWeight>();
  for (const bag of bags) {
    const missingTare = typeof bag.tareGrams !== 'number' || !Number.isFinite(bag.tareGrams) || bag.tareGrams < 0;
    result.set(bag.id, { subtotalGrams: missingTare ? 0 : bag.tareGrams!, missingItemCount: 0, missingTare,
      unresolvedPackedCount: 0, complete: false, estimated: uncertain(bag.tareEvidence), invalidTotal: false });
  }
  const items = new Map<string, LibraryItem[]>();
  for (const item of context.items) items.set(item.id, [...(items.get(item.id) ?? []), item]);
  const placements = new Map<string, Placement[]>(), locks = new Map<string, Placement[]>();
  function incomplete(raw: unknown) {
    const id = (raw as { containerId?: unknown } | null)?.containerId;
    const affected = typeof id === 'string' && result.has(id) ? [result.get(id)!] : [...result.values()];
    for (const bag of affected) { bag.unresolvedPackedCount++; bag.missingItemCount++; }
  }
  for (const raw of context.lockedPlacements) {
    if (!isValidRejectedPlacement(raw)) { incomplete(raw); continue; }
    locks.set(raw.instanceId, [...(locks.get(raw.instanceId) ?? []), raw]);
  }
  for (const raw of context.placements) {
    if (!isValidRejectedPlacement(raw)) { incomplete(raw); continue; }
    placements.set(raw.instanceId, [...(placements.get(raw.instanceId) ?? []), raw]);
  }
  for (const id of new Set([...placements.keys(), ...locks.keys()])) {
    const saved = locks.get(id), proposed = placements.get(id), rows = saved ?? proposed!;
    if (rows.length !== 1 || (!saved && proposed!.length !== 1)) {
      for (const raw of [...(saved ?? []), ...(proposed ?? [])]) incomplete(raw);
      continue;
    }
    const row = rows[0], bag = result.get(row.containerId);
    if (!bag) { if (saved) incomplete(row); continue; }
    const current = proposed?.length === 1 ? proposed[0] : undefined;
    if (saved && (!current?.locked || row.itemId !== current.itemId || row.entryId !== current.entryId || !samePlacementGeometry(row, current))) bag.unresolvedPackedCount++;
    const records = items.get(row.itemId), item = records?.length === 1 ? records[0] : undefined;
    if (!item || itemMassError(item)) { bag.missingItemCount++; continue; }
    const mass = item.massRangeGrams?.max ?? item.massGrams;
    if (mass === undefined) { bag.missingItemCount++; continue; }
    bag.subtotalGrams += mass;
    bag.estimated ||= item.massRangeGrams !== undefined || uncertain(item.massEvidence);
  }
  for (const bag of result.values()) {
    bag.invalidTotal = !Number.isFinite(bag.subtotalGrams);
    bag.complete = !bag.invalidTotal && !bag.missingTare && bag.missingItemCount === 0 && bag.unresolvedPackedCount === 0;
  }
  return result;
}
