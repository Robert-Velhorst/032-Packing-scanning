import type { CarrierLimits, CarrierRule, Container, ContainerSummary, DimensionsMm, Evidence } from './types.ts';
import { carrierCatalogStale, isCarrierRetrieval } from './carrier-catalog.ts';
import { carrierPackedWeights, type CarrierPackingContext, type CarrierPackedWeight } from './carrier-packed-weights.ts';

export type CarrierCheckStatus = 'within' | 'over' | 'unknown' | 'estimate_within' | 'estimate_over' | 'subtotal_over';

export interface CarrierLimitCheck {
  key: string;
  label: string;
  status: CarrierCheckStatus;
  measured?: number;
  limit?: number;
  margin?: number;
  unit: 'mm' | 'g' | 'bags';
  detail: string;
}

export interface CarrierBagChecks {
  bagId: string;
  bagName: string;
  checks: CarrierLimitCheck[];
}

export interface CarrierRuleAssessment {
  bags: CarrierBagChecks[];
  combinedWeight?: CarrierLimitCheck;
  bagCount?: CarrierLimitCheck;
  needsBagSelection: boolean;
  error?: string;
}

export function secureCarrierSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function carrierReviewDate(timestamp: number | string = Date.now()): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** A day-only review must never become a future review or silently refresh on edit. */
export function carrierReviewTimestamp(reviewDate: string, previous?: string, now = Date.now()): string {
  const start = new Date(`${reviewDate}T00:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate) || !Number.isFinite(start.getTime())
    || carrierReviewDate(start.getTime()) !== reviewDate || reviewDate > carrierReviewDate(now)) {
    throw new Error('Enter a valid review date today or earlier.');
  }
  if (previous && Number.isFinite(Date.parse(previous)) && Date.parse(previous) <= now && carrierReviewDate(previous) === reviewDate) return previous;
  return new Date(reviewDate === carrierReviewDate(now) ? now : start.getTime()).toISOString();
}

export function isValidCarrierRuleRecord(value: unknown, tripContainerIds?: string[]): value is CarrierRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Partial<CarrierRule>;
  return typeof rule.id === 'string' && rule.id.length > 0
    && typeof rule.carrier === 'string' && rule.carrier.trim().length > 0
    && typeof rule.route === 'string' && typeof rule.fare === 'string'
    && typeof rule.sourceUrl === 'string' && secureCarrierSourceUrl(rule.sourceUrl) !== undefined
    && typeof rule.retrievedAt === 'string' && Number.isFinite(Date.parse(rule.retrievedAt))
    && Number.isInteger(rule.staleAfterDays) && (rule.staleAfterDays ?? 0) >= 1 && (rule.staleAfterDays ?? 0) <= 365
    && Array.isArray(rule.applicableBagIds) && rule.applicableBagIds.every((id) => typeof id === 'string' && (!tripContainerIds || tripContainerIds.includes(id)))
    && new Set(rule.applicableBagIds).size === rule.applicableBagIds.length
    && typeof rule.notes === 'string'
    && (rule.retrieval === undefined || isCarrierRetrieval(rule.retrieval))
    && (rule.limits === undefined || isValidCarrierLimits(rule.limits))
    && (rule.status === 'manual' || rule.status === 'verified');
}

function isValidCarrierLimits(value: unknown): value is CarrierLimits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const limits = value as Partial<CarrierLimits>;
  const hasDimensions = limits.maxOuterDimensionsMm !== undefined;
  const hasLinearSum = limits.maxOuterLinearSumMm !== undefined;
  const hasWeight = limits.maxWeightGrams !== undefined;
  const hasCount = limits.maxBagCount !== undefined;
  return (hasDimensions || hasLinearSum || hasWeight || hasCount)
    && (!hasCount || Number.isInteger(limits.maxBagCount) && limits.maxBagCount! >= 0 && limits.maxBagCount! <= 100)
    && (!hasDimensions || validDimensions(limits.maxOuterDimensionsMm))
    && (!hasLinearSum || positiveFinite(limits.maxOuterLinearSumMm))
    && (!hasWeight || positiveFinite(limits.maxWeightGrams))
    && (!hasWeight || limits.weightScope === 'per_bag' || limits.weightScope === 'combined')
    && (hasWeight || limits.weightScope === undefined);
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validDimensions(value: unknown): value is DimensionsMm {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const dimensions = value as Partial<DimensionsMm>;
  return [dimensions.length, dimensions.width, dimensions.height].every(positiveFinite);
}

/** Compare recorded external bag measurements with a traveller-entered source limit. */
export function assessCarrierRule(
  rule: CarrierRule,
  bags: Container[],
  summaries: ContainerSummary[],
  packing?: CarrierPackingContext,
): CarrierRuleAssessment {
  const limits = rule.limits;
  const applicableBags = bags.filter((bag) => rule.applicableBagIds.includes(bag.id));
  if (!limits) return { bags: [], needsBagSelection: false };
  if (!isValidCarrierLimits(limits)) return { bags: [], needsBagSelection: false, error: 'Correct the numeric limits in this source record before comparing bags.' };
  if (new Set(rule.applicableBagIds).size !== rule.applicableBagIds.length || new Set(bags.map(b => b.id)).size !== bags.length) return { bags: [], needsBagSelection: false, error: 'Correct duplicated bag identities before comparing this source.' };
  if (applicableBags.length === 0) return { bags: [], needsBagSelection: true };
  const missingBags = rule.applicableBagIds.filter(id => !bags.some(b => b.id === id));
  const packedWeights = packing ? carrierPackedWeights(bags, packing) : undefined;
  const bagCount: CarrierLimitCheck | undefined = limits.maxBagCount === undefined ? undefined : {
    key: 'bag-count', label: 'Number of selected bags', unit: 'bags', limit: limits.maxBagCount,
    status: missingBags.length ? 'unknown' : applicableBags.length > limits.maxBagCount ? 'over' : 'within',
    ...(missingBags.length ? {} : { measured: applicableBags.length, margin: limits.maxBagCount - applicableBags.length }),
    detail: missingBags.length ? 'A selected bag record is missing. Restore or review the selection before checking this allowance.'
      : `${applicableBags.length} selected bag${applicableBags.length === 1 ? '' : 's'} ${applicableBags.length > limits.maxBagCount ? (applicableBags.length === 1 ? 'exceeds' : 'exceed') : (applicableBags.length === 1 ? 'is within' : 'are within')} the recorded allowance of ${limits.maxBagCount}. Count every selected bag, including empty bags. Confirm which passenger and allowance this set belongs to; separate source records are not pooled.`,
  };

  const perBag: CarrierBagChecks[] = applicableBags.map((bag) => {
    const checks: CarrierLimitCheck[] = [];
    if (limits.maxOuterDimensionsMm) checks.push(checkOuterDimensions(bag, limits.maxOuterDimensionsMm));
    if (limits.maxOuterLinearSumMm !== undefined) checks.push(checkOuterLinearSum(bag, limits.maxOuterLinearSumMm));
    if (limits.maxWeightGrams !== undefined && limits.weightScope === 'per_bag') {
      const weight = packedWeights?.get(bag.id);
      checks.push(weight ? packedWeightCheck('bag-weight', `${bag.name} gross weight`, weight, limits.maxWeightGrams)
        : checkBagWeight(bag, summaries.find((summary) => summary.containerId === bag.id), limits.maxWeightGrams));
    }
    return { bagId: bag.id, bagName: bag.name, checks };
  });

  let combinedWeight: CarrierLimitCheck | undefined;
  if (limits.maxWeightGrams !== undefined && limits.weightScope === 'combined') {
    const inputs = applicableBags.map((bag) => ({ bag, summary: summaries.find((summary) => summary.containerId === bag.id) }));
    const incomplete = inputs.find(({ bag, summary }) => missingWeightReason(bag, summary));
    if (missingBags.length) {
      combinedWeight = unknownWeightCheck('combined-weight', 'Combined bag weight', limits.maxWeightGrams, 'A selected bag record is missing.');
    } else if (packedWeights) {
      const weights = applicableBags.map(b => packedWeights.get(b.id)!);
      const combined: CarrierPackedWeight = { subtotalGrams: weights.reduce((n, w) => n + w.subtotalGrams, 0),
        missingItemCount: weights.reduce((n, w) => n + w.missingItemCount, 0), missingTare: weights.some(w => w.missingTare),
        unresolvedPackedCount: weights.reduce((n, w) => n + w.unresolvedPackedCount, 0), complete: weights.every(w => w.complete),
        estimated: weights.some(w => w.estimated), invalidTotal: weights.some(w => w.invalidTotal) };
      combinedWeight = packedWeightCheck('combined-weight', 'Combined bag weight', combined, limits.maxWeightGrams);
    } else if (incomplete) {
      combinedWeight = unknownWeightCheck('combined-weight', 'Combined bag weight', limits.maxWeightGrams, `${incomplete.bag.name}: ${missingWeightReason(incomplete.bag, incomplete.summary)}.`);
    } else {
      const total = inputs.reduce((sum, { bag, summary }) => sum + bag.tareGrams! + summary!.usedMassGrams, 0);
      const estimated = inputs.some(({ bag, summary }) => summary!.estimatedMassCount > 0 || isEstimatedEvidence(bag.tareEvidence));
      combinedWeight = weightCheck('combined-weight', 'Combined bag weight', total, limits.maxWeightGrams, estimated);
    }
  }

  return { bags: perBag, ...(combinedWeight ? { combinedWeight } : {}), ...(bagCount ? { bagCount } : {}), needsBagSelection: false };
}

function packedWeightCheck(key: string, label: string, weight: CarrierPackedWeight, limit: number): CarrierLimitCheck {
  if (weight.invalidTotal || !Number.isFinite(weight.subtotalGrams)) return unknownWeightCheck(key, label, limit, 'The saved weight total is invalid.');
  if (weight.complete) return weightCheck(key, label, weight.subtotalGrams, limit, weight.estimated);
  const missing = [weight.missingTare ? 'empty bag weight missing or invalid' : '',
    weight.missingItemCount ? `${weight.missingItemCount} item weight records missing or unresolved` : '',
    weight.unresolvedPackedCount ? `${weight.unresolvedPackedCount} saved packed positions need review; their contents may still be in the bags` : ''].filter(Boolean).join('; ');
  const over = weight.subtotalGrams > limit;
  return { key, label, unit: 'g', status: over ? 'subtotal_over' : 'unknown', measured: weight.subtotalGrams, limit,
    ...(over ? { margin: limit - weight.subtotalGrams } : {}),
    detail: `Upper saved-weight subtotal ${formatComparisonNumber(weight.subtotalGrams)} g ${over ? 'already exceeds' : 'cannot establish a pass against'} the ${formatComparisonNumber(limit)} g recorded limit. ${missing}. Saved physical positions are counted separately from the proposed sequence. Check the actual contents and weigh the packed bags before travel.` };
}

function checkOuterDimensions(bag: Container, maximum: DimensionsMm): CarrierLimitCheck {
  const measured = bag.outerDimensionsMm;
  if (!validDimensions(measured)) return { key: 'outer-dimensions', label: 'Maximum side dimensions', status: 'unknown', unit: 'mm', detail: 'Measure all three outside dimensions of this bag, including handles and wheels.' };
  const actualSides = [measured.length, measured.width, measured.height].sort((a, b) => b - a);
  const maximumSides = [maximum.length, maximum.width, maximum.height].sort((a, b) => b - a);
  const over = actualSides.some((side, index) => side > maximumSides[index]);
  return {
    key: 'outer-dimensions', label: 'Maximum side dimensions', status: comparisonStatus(over, isEstimatedEvidence(bag.outerDimensionsEvidence)),
    unit: 'mm',
    detail: over
      ? `${formatMm(measured)} exceeds ${formatMm(maximum)}. Sides can be rotated to compare; confirm that the values include handles and wheels.`
      : `${formatMm(measured)} is within ${formatMm(maximum)} when the bag is rotated to fit. Confirm that the values include handles and wheels.`,
  };
}

function checkOuterLinearSum(bag: Container, maximum: number): CarrierLimitCheck {
  const measured = bag.outerDimensionsMm;
  if (!validDimensions(measured)) return { key: 'outer-linear-sum', label: 'Combined outer dimensions', status: 'unknown', limit: maximum, unit: 'mm', detail: 'Measure all three outside dimensions of this bag, including handles and wheels.' };
  const total = measured.length + measured.width + measured.height;
  const over = total > maximum;
  return {
    key: 'outer-linear-sum', label: 'Combined outer dimensions', status: comparisonStatus(over, isEstimatedEvidence(bag.outerDimensionsEvidence)),
    measured: total, limit: maximum, margin: maximum - total, unit: 'mm',
    detail: `${formatMm(total)} ${over ? 'exceeds' : 'is within'} the ${formatMm(maximum)} recorded limit. Include handles and wheels.`,
  };
}

function checkBagWeight(bag: Container, summary: ContainerSummary | undefined, maximum: number): CarrierLimitCheck {
  const missing = missingWeightReason(bag, summary);
  if (missing) return unknownWeightCheck('bag-weight', `${bag.name} gross weight`, maximum, `${missing}.`);
  return weightCheck('bag-weight', `${bag.name} gross weight`, bag.tareGrams! + summary!.usedMassGrams, maximum, summary!.estimatedMassCount > 0 || isEstimatedEvidence(bag.tareEvidence));
}

function missingWeightReason(bag: Container, summary: ContainerSummary | undefined): string | undefined {
  if (!summary || !Number.isFinite(summary.usedMassGrams) || summary.usedMassGrams < 0
    || !Number.isInteger(summary.unweighedCount) || summary.unweighedCount < 0
    || !Number.isInteger(summary.estimatedMassCount) || summary.estimatedMassCount < 0) return 'no complete, valid packing weight summary';
  const missing: string[] = [];
  if (summary.unweighedCount > 0) missing.push(`${summary.unweighedCount} item weight${summary.unweighedCount === 1 ? '' : 's'} missing`);
  if (typeof bag.tareGrams !== 'number' || !Number.isFinite(bag.tareGrams) || bag.tareGrams < 0) missing.push('empty bag weight missing or invalid');
  return missing.length ? missing.join(' and ') : undefined;
}

function isEstimatedEvidence(evidence: Evidence | undefined): boolean {
  return !evidence || !['measured', 'known', 'user_confirmed', 'provider'].includes(evidence.source) || !Number.isFinite(evidence.confidence) || evidence.confidence < 1;
}

function comparisonStatus(over: boolean, estimated: boolean): CarrierCheckStatus {
  return estimated ? (over ? 'estimate_over' : 'estimate_within') : (over ? 'over' : 'within');
}

function weightCheck(key: string, label: string, measured: number, limit: number, estimated: boolean): CarrierLimitCheck {
  const over = measured > limit;
  if (!Number.isFinite(measured)) return unknownWeightCheck(key, label, limit, 'The recorded weight total is invalid.');
  const status = comparisonStatus(over, estimated);
  const qualifier = estimated ? 'Estimated upper gross weight' : 'Recorded gross weight';
  return {
    key, label, status, measured, limit, margin: limit - measured, unit: 'g',
    detail: `${qualifier} ${formatComparisonNumber(measured)} g ${over ? 'is above' : measured === limit ? 'is at' : 'is below'} the ${formatComparisonNumber(limit)} g recorded limit. Weigh the packed bag before travel.`,
  };
}

function unknownWeightCheck(key: string, label: string, limit: number, reason: string): CarrierLimitCheck {
  return { key, label, status: 'unknown', limit, unit: 'g', detail: `Cannot check: ${reason} Add the missing weight information, then weigh the packed bag before travel.` };
}

function formatMm(dimensions: DimensionsMm): string;
function formatMm(value: number): string;
function formatMm(value: number | DimensionsMm): string {
  if (typeof value === 'number') return `${formatComparisonNumber(value / 10)} cm`;
  return `${[value.length, value.width, value.height].sort((a, b) => b - a).map((side) => formatComparisonNumber(side / 10)).join(' × ')} cm`;
}

/** Keep small differences visible; rounding must not turn a nonzero margin into zero. */
export function formatComparisonNumber(value: number): string {
  const rounded = Number(value.toFixed(4));
  return String(rounded === 0 && value !== 0 ? value : rounded);
}

/** Treat a source record as stale when its date or refresh window is unusable. */
export function isCarrierRuleStale(rule: Pick<CarrierRule, 'retrievedAt' | 'staleAfterDays' | 'retrieval'>, now = Date.now()): boolean {
  if (rule.retrieval && carrierCatalogStale(rule.retrieval.catalog, now)) return true;
  const retrievedAt = Date.parse(rule.retrievedAt);
  const staleAfterDays = rule.staleAfterDays;
  if (!Number.isFinite(retrievedAt) || retrievedAt > now || !Number.isFinite(staleAfterDays) || staleAfterDays < 1 || staleAfterDays > 365) return true;
  return now - retrievedAt >= staleAfterDays * 24 * 60 * 60 * 1000;
}
