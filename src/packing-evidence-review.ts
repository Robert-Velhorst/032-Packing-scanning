import type { Container, DimensionsMm, Evidence, LibraryItem, PackingPlan, Trip, UnitSystem } from './types.ts';
import { handlingPropertyRows, isPropertyEvidence } from './property-evidence.ts';
import { packingItem } from './packing-forms.ts';
import { packingShapeError } from './packing-geometry.ts';
import { containerSpaceError } from './container-space.ts';
import { interiorSupportError } from './packing-interior.ts';
import { topLoadError } from './stack-load.ts';

export type ReviewStatus = 'missing' | 'invalid' | 'estimated' | 'low_confidence' | 'recorded' | 'optional';
export interface ReviewProperty {
  id: string; label: string; value: string; status: ReviewStatus; needsReview: boolean;
  evidence?: Evidence; detail?: string;
}
export interface ReviewGroup {
  id: string; kind: 'item' | 'container' | 'missing'; recordId: string; name: string;
  properties: ReviewProperty[];
}
export interface PackingEvidenceReview {
  groups: ReviewGroup[]; propertyCount: number; needsReviewCount: number; reviewGroupCount: number;
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const validSize = (size: DimensionsMm | undefined) => !!size
  && [size.length, size.width, size.height].every(n => positive(n) && n <= 10000);
const show = (n: number, factor: number) => Number((n / factor).toFixed(3)).toLocaleString('en-GB');
const pointsText = (n: number | undefined) => Number.isSafeInteger(n) && n! > 0 ? `${n!.toLocaleString('en-GB')} source points` : 'Source point count unavailable';

/** A source/confidence reminder, never a feasibility or physical-acceptance certificate. */
export function reviewProperty(id: string, label: string, value: string, evidence?: Evidence, options: {
  invalid?: string; optionalMissing?: boolean; estimate?: string; now?: number;
} = {}): ReviewProperty {
  const invalid = options.invalid ?? (evidence !== undefined && (!isPropertyEvidence(evidence) || Date.parse(evidence.collectedAt) > (options.now ?? Date.now())) ? 'Source, confidence or review date needs correction.' : undefined);
  const status: ReviewStatus = invalid ? 'invalid' : options.estimate ? 'estimated' : !evidence
    ? options.optionalMissing ? 'optional' : 'missing' : evidence.source === 'estimated' ? 'estimated'
      : evidence.confidence < .8 ? 'low_confidence' : 'recorded';
  return { id, label, value, evidence, status, needsReview: !['recorded', 'optional'].includes(status),
    detail: invalid ?? options.estimate ?? (status === 'missing' ? 'No separate evidence review is saved.'
      : status === 'low_confidence' ? 'Recorded confidence is below 80. Check the value before relying on it.'
        : status === 'optional' ? 'Not needed by this plan’s current weight or carrier-size checks.' : undefined) };
}

/** Inspect only selected records/forms. No values, evidence, progress or source files are changed. */
export function buildPackingEvidenceReview(trip: Trip, library: LibraryItem[], allBags: Container[], plan: PackingPlan, unit: UnitSystem): PackingEvidenceReview {
  const groups: ReviewGroup[] = [], itemById = new Map(library.map(item => [item.id, item])), bagById = new Map(allBags.map(bag => [bag.id, bag]));
  const itemCounts = new Map<string, number>(), bagCounts = new Map<string, number>();
  for (const item of library) itemCounts.set(item.id, (itemCounts.get(item.id) ?? 0) + 1);
  for (const bag of allBags) bagCounts.set(bag.id, (bagCounts.get(bag.id) ?? 0) + 1);
  const lengthFactor = unit === 'metric' ? 1 : 25.4, massFactor = unit === 'metric' ? 1 : 28.3495;
  const lengthUnit = unit === 'metric' ? 'mm' : 'in', massUnit = unit === 'metric' ? 'g' : 'oz';
  const sizeText = (size: DimensionsMm | undefined) => validSize(size) ? `${show(size!.length, lengthFactor)} × ${show(size!.width, lengthFactor)} × ${show(size!.height, lengthFactor)} ${lengthUnit}` : 'Missing or invalid size';
  const massText = (n: number | undefined) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? `${show(n, massFactor)} ${massUnit}` : 'Not recorded';
  const selectedBags = trip.containerIds.map(id => bagById.get(id)).filter((bag): bag is Container => !!bag);
  const weightsNeeded = selectedBags.length > 1 || selectedBags.some(bag => bag.massLimitGrams !== undefined)
    || trip.carrierRules.some(rule => rule.limits?.maxWeightGrams !== undefined);
  const seen = new Set<string>();
  const placementById = new Map(plan.placements.map(p => [p.instanceId, p]));
  const loadedStates = new Set((plan.stackLoads ?? []).filter(load => load.aboveInstanceIds.length > 0).flatMap(load => {
    const p = placementById.get(load.instanceId);
    return p ? [JSON.stringify(['item', p.itemId, p.packingFormId ?? null])] : [];
  }));
  for (const entry of trip.entries) {
    const groupId = JSON.stringify(['item', entry.itemId, entry.packingFormId ?? null]);
    if (seen.has(groupId)) continue;
    seen.add(groupId);
    const original = itemById.get(entry.itemId);
    if (!original || itemCounts.get(entry.itemId)! > 1) {
      groups.push({ id: groupId, kind: 'missing', recordId: entry.itemId, name: original ? 'Conflicting item records' : 'Missing item record',
        properties: [reviewProperty('record', 'Selected item', entry.itemId, undefined, { invalid: original ? 'Multiple item records share this identity. Restore a consistent backup before editing; no record is chosen or changed by this review.' : 'The packing list still references this item. Restore its original record from a backup; it is not silently removed.' })] });
      continue;
    }
    let item = original, formIssue: string | undefined;
    try { item = packingItem(original, entry.packingFormId); } catch (error) { formIssue = error instanceof Error ? error.message : 'The selected packing form needs correction.'; }
    const form = Array.isArray(original.packingForms) ? original.packingForms.find(f => f?.id === entry.packingFormId) : undefined;
    const properties: ReviewProperty[] = [reviewProperty('size', entry.packingFormId ? 'Prepared size' : 'Item size', formIssue ? 'Selected form cannot be used' : sizeText(item.dimensions), form?.dimensionEvidence ?? item.dimensionEvidence,
      { invalid: formIssue ?? (!validSize(item.dimensions) ? 'Record three finite positive dimensions.' : undefined) })];
    if (form) properties.push(reviewProperty('preparation', 'Preparation', form.preparation, form.dimensionEvidence));
    const range = item.massRangeGrams;
    const rangeInvalid = range && (!Number.isFinite(range.min) || range.min < 0 || !positive(range.max) || range.min > range.max);
    properties.push(reviewProperty('mass', 'Item weight', range && !rangeInvalid ? `${massText(range.min)}–${massText(range.max)} · upper value used` : massText(item.massGrams), item.massEvidence,
      { invalid: rangeInvalid ? 'Correct the recorded weight range.' : item.massGrams !== undefined && !positive(item.massGrams) ? 'Record a finite positive weight.'
        : item.massGrams === undefined && !range && item.massEvidence !== undefined ? 'A weight source is saved without a weight value.' : undefined,
        optionalMissing: !weightsNeeded && item.massGrams === undefined && !range }));
    for (const row of handlingPropertyRows(original)) properties.push(reviewProperty(row.label, row.label, row.value, row.evidence));
    const hasLoad = loadedStates.has(groupId);
    const loadIssue = topLoadError(item);
    properties.push(reviewProperty('top-load', 'Stacking limit', item.fragile ? 'Fragile · no planned stack allowed'
      : item.maxTopLoadGrams === undefined ? 'Not recorded' : `${show(item.maxTopLoadGrams, massFactor)} ${massUnit} allowed above`,
      item.fragile ? item.fragileEvidence : item.topLoadEvidence,
      { invalid: formIssue ?? loadIssue, optionalMissing: !item.fragile && item.maxTopLoadGrams === undefined && !hasLoad }));
    if (item.packingShape && !entry.packingFormId) {
      properties.push(reviewProperty('shape', 'Adopted item shape', `${pointsText(item.packingShape.solid?.sourcePointCount)} · occupied-cell estimate`, undefined,
        { invalid: packingShapeError(item), estimate: 'An adopted shape retains estimated completeness and boundaries. A confirmed size does not make the reconstructed shape physically verified.' }));
      if (item.keepUpright) properties.push(reviewProperty('top', 'Reviewed top direction', item.packingShape.upright ? `${item.packingShape.upright.axis} ${item.packingShape.upright.sign > 0 ? 'positive' : 'negative'} end` : 'No reviewed top', item.packingShape.upright?.evidence));
    }
    groups.push({ id: groupId, kind: 'item', recordId: original.id, name: original.name + (form ? ` · ${form.name}` : entry.packingFormId ? ' · missing or invalid form' : ''), properties });
  }
  for (const id of new Set(trip.containerIds)) {
    const bag = bagById.get(id), groupId = JSON.stringify(['bag', id]);
    if (!bag || bagCounts.get(id)! > 1) {
      groups.push({ id: groupId, kind: 'missing', recordId: id, name: bag ? 'Conflicting bag records' : 'Missing bag record', properties: [reviewProperty('record', 'Selected bag', id, undefined,
        { invalid: bag ? 'Multiple bag records share this identity. Restore a consistent backup before editing; saved assignments and positions remain unchanged.' : 'Restore the original bag record from a backup. Saved bag assignments and packed positions remain unchanged.' })] });
      continue;
    }
    const properties = [reviewProperty('inside', 'Usable inside size', sizeText(bag.inside), bag.insideEvidence, { invalid: !validSize(bag.inside) ? 'Record three finite positive inside dimensions.' : undefined }),
      reviewProperty('opening', 'Narrowest opening', bag.opening && positive(bag.opening.length) && positive(bag.opening.width) ? `${show(bag.opening.length, lengthFactor)} × ${show(bag.opening.width, lengthFactor)} ${lengthUnit}` : 'Missing or invalid opening', bag.openingEvidence,
        { invalid: !bag.opening || !positive(bag.opening.length) || !positive(bag.opening.width) ? 'Record the narrowest real opening separately from inside size.' : undefined })];
    const spaceError = containerSpaceError(bag);
    if (spaceError) properties.push(reviewProperty('space-validation', 'Bag space records', 'Correction needed', undefined, { invalid: spaceError }));
    const outsideNeeded = trip.carrierRules.some(rule => rule.applicableBagIds.includes(id) && (rule.limits?.maxOuterDimensionsMm || rule.limits?.maxOuterLinearSumMm));
    properties.push(reviewProperty('outside', 'Outside size', bag.outerDimensionsMm ? sizeText(bag.outerDimensionsMm) : 'Not recorded', bag.outerDimensionsEvidence,
      { invalid: bag.outerDimensionsMm && !validSize(bag.outerDimensionsMm) ? 'Correct outside dimensions.' : !bag.outerDimensionsMm && bag.outerDimensionsEvidence ? 'A size source is saved without outside dimensions.' : undefined, optionalMissing: !outsideNeeded && !bag.outerDimensionsMm }));
    properties.push(reviewProperty('tare', 'Empty bag weight', massText(bag.tareGrams), bag.tareEvidence,
      { invalid: bag.tareGrams !== undefined && (!Number.isFinite(bag.tareGrams) || bag.tareGrams < 0) ? 'Record a finite nonnegative empty weight.' : bag.tareGrams === undefined && bag.tareEvidence ? 'A weight source is saved without an empty weight.' : undefined, optionalMissing: !weightsNeeded && bag.tareGrams === undefined }));
    if (bag.massLimitGrams !== undefined || bag.massLimitEvidence !== undefined) properties.push(reviewProperty('limit', 'Recorded bag weight limit', massText(bag.massLimitGrams), bag.massLimitEvidence,
      { invalid: !positive(bag.massLimitGrams) ? 'Correct the recorded weight limit.' : undefined }));
    if (bag.lidClearanceMm !== undefined) properties.push(reviewProperty('lid', 'Space below the lid', `${show(bag.lidClearanceMm, lengthFactor)} ${lengthUnit}`, bag.lidClearanceEvidence));
    for (const space of Array.isArray(bag.unavailableSpaces) ? bag.unavailableSpaces.filter(Boolean) : []) properties.push(reviewProperty('space:' + space.id, `Keep free · ${space.name}`, sizeText(space), space.evidence));
    for (const c of Array.isArray(bag.compartments) ? bag.compartments.filter(c => c?.opening) : []) {
      properties.push(reviewProperty('compartment:' + c.id, `Compartment size and opening · ${c.name}`, `${sizeText(c)} · opening ${show(c.opening.length, lengthFactor)} × ${show(c.opening.width, lengthFactor)} ${lengthUnit}`, c.evidence));
      properties.push(reviewProperty('support:' + c.id, `Access and supporting bases · ${c.name}`, 'Traveller-reviewed assumption', c.supportEvidence));
      if (c.massLimitGrams !== undefined) properties.push(reviewProperty('compartment-limit:' + c.id, `Contents weight limit · ${c.name}`, massText(c.massLimitGrams), c.massLimitEvidence));
    }
    if (bag.packingInterior) {
      properties.push(reviewProperty('cavity', 'Adopted usable cavity', `${pointsText(bag.packingInterior.cavity?.sourcePointCount)} · connected-space estimate`, undefined,
        { estimate: 'Reviewed entry, floor and connected-space assumptions remain estimates. Physical fit and closure are unverified.' }));
      properties.push(reviewProperty('travel-base', 'Closed travel base', bag.packingInterior.supportReview ? 'Traveller review recorded' : 'Not reviewed', bag.packingInterior.supportReview?.evidence,
        { invalid: spaceError ?? interiorSupportError(bag.packingInterior) }));
    }
    groups.push({ id: groupId, kind: 'container', recordId: id, name: bag.name, properties });
  }
  const rows = groups.flatMap(group => group.properties);
  return { groups, propertyCount: rows.length, needsReviewCount: rows.filter(row => row.needsReview).length,
    reviewGroupCount: groups.filter(group => group.properties.some(row => row.needsReview)).length };
}
