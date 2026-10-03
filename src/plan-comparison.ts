import { unresolvedPackedBagCounts } from './bag-weights';
import { packingItemForPlacement } from './packing-forms';
import { buildPackingEvidenceReview } from './packing-evidence-review';
import { isPropertyEvidence } from './property-evidence';
import type { BagMassConflict, Container, Evidence, ExcludedItem, LibraryItem, OptimizationMode, PackingPlan, Trip } from './types';

export interface ComparisonWeight {
  minimumGrams: number; maximumGrams: number;
  missingItemCount: number; missingTareCount: number; unresolvedPackedCount: number;
  complete: boolean; estimated: boolean; lowerConfidenceCount: number;
}
export interface ComparisonBag {
  id: string; name: string; itemCount: number; weight: ComparisonWeight;
  occupiedPercent?: number; usedVolumeMm3?: number; usableVolumeMm3?: number;
  limitGrams?: number; marginGrams?: number;
  limitStatus: 'over' | 'within_recorded' | 'incomplete' | 'not_recorded';
  limitNeedsReview: boolean;
  massConflict?: BagMassConflict;
}
export interface PlanComparison {
  mode: OptimizationMode; placedCount: number; requiredOutsideCount: number; unavailableRequiredCount: number;
  weight: ComparisonWeight; bags: ComparisonBag[]; missingBagCount: number; unlinkedPlacementCount: number;
  usedBagCount: number; preparationCount: number; earlyAccessCount: number; fragileCount: number;
  evidenceReviewCount: number; unverifiedStackCount: number;
  excluded: ExcludedItem[]; warnings: string[]; positionSignature: string;
}

const finiteWeight = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const sourceReviewed = (e: Evidence | undefined) => isPropertyEvidence(e) && Date.parse(e.collectedAt) <= Date.now()
  && e.source !== 'estimated' && e.confidence >= .8;
const emptyWeight = (): ComparisonWeight => ({ minimumGrams: 0, maximumGrams: 0, missingItemCount: 0,
  missingTareCount: 0, unresolvedPackedCount: 0, complete: false, estimated: false, lowerConfidenceCount: 0 });

/** Compare actual solver candidates using saved records. No probability of physical fit or balance is inferred. */
export function comparePackingPlan(trip: Trip, library: LibraryItem[], allBags: Container[], plan: PackingPlan): PlanComparison {
  const itemCounts = new Map<string, number>(), bagCounts = new Map<string, number>();
  for (const item of library) itemCounts.set(item.id, (itemCounts.get(item.id) ?? 0) + 1);
  for (const bag of allBags) bagCounts.set(bag.id, (bagCounts.get(bag.id) ?? 0) + 1);
  const selectedBags = allBags.filter(b => trip.containerIds.includes(b.id) && bagCounts.get(b.id) === 1);
  const bagIds = new Set(selectedBags.map(b => b.id)), records = new Map(library.map(item => [item.id, item]));
  const unresolved = unresolvedPackedBagCounts(selectedBags, plan.placements, trip.lockedPlacements);
  let preparationCount = 0, earlyAccessCount = 0, fragileCount = 0;
  const bags: ComparisonBag[] = selectedBags.map(bag => {
    const placements = plan.placements.filter(p => p.containerId === bag.id), weight = emptyWeight();
    if (finiteWeight(bag.tareGrams)) {
      weight.minimumGrams = weight.maximumGrams = bag.tareGrams;
      if (!sourceReviewed(bag.tareEvidence)) { weight.estimated = true; weight.lowerConfidenceCount++; }
    } else weight.missingTareCount++;
    weight.unresolvedPackedCount = unresolved.get(bag.id) ?? 0;
    for (const placement of placements) {
      const item = itemCounts.get(placement.itemId) === 1 ? packingItemForPlacement(records.get(placement.itemId), placement) : undefined;
      const entry = trip.entries.find(e => e.id === placement.entryId && e.itemId === placement.itemId);
      if (placement.packingFormId) preparationCount++;
      if (entry && entry.accessPriority >= 4) earlyAccessCount++;
      if (item?.fragile) fragileCount++;
      if (!item) { weight.missingItemCount++; continue; }
      const range = item.massRangeGrams;
      if (range !== undefined) {
        if (!range || !finiteWeight(range.min) || !finiteWeight(range.max) || range.max <= 0 || range.min > range.max) {
          weight.missingItemCount++; continue;
        }
        weight.minimumGrams += range.min; weight.maximumGrams += range.max;
        weight.estimated = true;
      } else if (finiteWeight(item.massGrams) && item.massGrams > 0) {
        weight.minimumGrams += item.massGrams; weight.maximumGrams += item.massGrams;
      } else { weight.missingItemCount++; continue; }
      if (!sourceReviewed(item.massEvidence)) { weight.estimated = true; weight.lowerConfidenceCount++; }
    }
    weight.complete = weight.missingItemCount === 0 && weight.missingTareCount === 0 && weight.unresolvedPackedCount === 0;
    const summary = plan.summaries.find(s => s.containerId === bag.id);
    const usableVolumeMm3 = summary && Number.isFinite(summary.volumeCapacityMm3) && summary.volumeCapacityMm3 > 0 ? summary.volumeCapacityMm3 : undefined;
    const usedVolumeMm3 = summary && Number.isFinite(summary.volumeUsedMm3) && summary.volumeUsedMm3 >= 0 ? summary.volumeUsedMm3 : undefined;
    const limitGrams = finiteWeight(bag.massLimitGrams) && bag.massLimitGrams > 0 ? bag.massLimitGrams : undefined;
    return { id: bag.id, name: bag.name, itemCount: placements.length, weight, usableVolumeMm3, usedVolumeMm3,
      occupiedPercent: usableVolumeMm3 !== undefined && usedVolumeMm3 !== undefined ? usedVolumeMm3 / usableVolumeMm3 * 100 : undefined,
      limitGrams, marginGrams: limitGrams === undefined || !weight.complete ? undefined : limitGrams - weight.maximumGrams,
      limitStatus: limitGrams === undefined ? 'not_recorded' : weight.maximumGrams > limitGrams + .01 ? 'over'
        : weight.complete ? 'within_recorded' : 'incomplete',
      limitNeedsReview: bag.massLimitGrams !== undefined && (limitGrams === undefined || !sourceReviewed(bag.massLimitEvidence)),
      massConflict: plan.massConflicts?.find(c => c.containerId === bag.id) };
  });
  const weight = emptyWeight();
  for (const bag of bags) {
    for (const key of ['minimumGrams', 'maximumGrams', 'missingItemCount', 'missingTareCount', 'unresolvedPackedCount', 'lowerConfidenceCount'] as const) weight[key] += bag.weight[key];
    weight.estimated ||= bag.weight.estimated;
  }
  const missingBagCount = new Set(trip.containerIds.filter(id => !bagIds.has(id))).size;
  const unlinkedPlacementCount = plan.placements.filter(p => !bagIds.has(p.containerId)).length;
  weight.complete = bags.length > 0 && bags.every(b => b.weight.complete) && !missingBagCount && !unlinkedPlacementCount;
  const positionSignature = JSON.stringify(plan.placements.map(p => [p.instanceId, p.itemId, p.containerId, p.compartmentId ?? null,
    p.compartmentKey ?? null, p.packingFormId ?? null, p.packingFormKey ?? null, p.shapeKey ?? null, p.interiorKey ?? null,
    p.x, p.y, p.z, p.length, p.width, p.height, p.rotation, p.layer, p.insertionOrder ?? null]).map(p => JSON.stringify(p)).sort());
  return { mode: plan.mode, placedCount: plan.placements.length,
    requiredOutsideCount: plan.excluded.filter(e => e.required && e.reason !== 'Marked unavailable for this plan.').length,
    unavailableRequiredCount: plan.excluded.filter(e => e.required && e.reason === 'Marked unavailable for this plan.').length,
    weight, bags, missingBagCount, unlinkedPlacementCount, usedBagCount: bags.filter(b => b.itemCount > 0).length,
    preparationCount, earlyAccessCount, fragileCount,
    evidenceReviewCount: buildPackingEvidenceReview(trip, library, allBags, plan, 'metric').needsReviewCount,
    unverifiedStackCount: (plan.stackLoads ?? []).filter(load => load.status === 'unverified' || load.status === 'conflict').length,
    excluded: plan.excluded, warnings: plan.warnings, positionSignature };
}

/** Labels make partial sums explicit; unknown masses are never presented as zero-weight totals. */
export function comparisonWeightText(weight: ComparisonWeight, unit: 'metric' | 'imperial'): string {
  const show = (n: number) => (n / (unit === 'metric' ? 1 : 28.3495)).toLocaleString('en-GB', { maximumFractionDigits: 3 });
  const amount = weight.minimumGrams === weight.maximumGrams ? show(weight.maximumGrams) : `${show(weight.minimumGrams)}–${show(weight.maximumGrams)}`;
  const status = !weight.complete ? 'Known subtotal' : weight.estimated ? 'Estimated saved weight' : 'Recorded weight';
  return `${status}: ${amount} ${unit === 'metric' ? 'g' : 'oz'}`;
}
