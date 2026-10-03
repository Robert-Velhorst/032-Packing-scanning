import { describe, expect, it } from 'vitest';
import { comparePackingPlan, comparisonWeightText } from './plan-comparison';
import { buildPlan } from './optimizer';
import { createInitialData } from './seed';
import type { Container, Evidence } from './types';

const source: Evidence = { source: 'measured', confidence: .95, collectedAt: '2026-10-01T00:00:00Z' };
function fixture(quantity = 4) {
  const app = structuredClone(createInitialData()), trip = app.trips[0], item = app.libraryItems[0], bag = app.containers[0];
  item.dimensions = { length: 20, width: 20, height: 20 }; item.massGrams = 100; item.massEvidence = source;
  item.fragile = false; item.flexibility = 'rigid'; item.maxTopLoadGrams = 10000; item.topLoadEvidence = source;
  item.flexibilityEvidence = source; item.fragileEvidence = source; item.keepUprightEvidence = source;
  bag.inside = { length: 100, width: 100, height: 100 }; bag.opening = { length: 100, width: 100 };
  bag.tareGrams = 10; bag.tareEvidence = source; bag.massLimitGrams = 10000; bag.massLimitEvidence = source; bag.openingEvidence = source;
  const second: Container = { ...bag, id: 'second', name: 'Second case', tareGrams: 10 };
  app.libraryItems = [item]; app.containers = [bag, second]; trip.containerIds = app.containers.map(b => b.id);
  trip.entries = [{ ...trip.entries[0], quantity, required: true, accessPriority: 5 }];
  trip.carrierRules = []; trip.lockedPlacements = []; trip.completedInstanceIds = []; trip.unavailableInstanceIds = [];
  const plan = () => buildPlan(trip, app.libraryItems, app.containers);
  const review = () => comparePackingPlan(trip, app.libraryItems, app.containers, plan());
  return { app, trip, item, bag, second, plan, review };
}

describe('candidate plan comparison', () => {
  it('shows actual multi-bag distribution even when candidates place the same number of items', () => {
    const f = fixture(8), balanced = f.review(), capacity = comparePackingPlan(f.trip, f.app.libraryItems, f.app.containers, buildPlan(f.trip, f.app.libraryItems, f.app.containers, 'maximum_capacity'));
    expect(balanced.placedCount).toBe(8); expect(capacity.placedCount).toBe(8);
    expect(balanced.bags.map(b => b.weight.maximumGrams)).toEqual([410, 410]);
    expect(capacity.bags.map(b => b.weight.maximumGrams)).toEqual([810, 10]);
    expect(balanced.positionSignature).not.toBe(capacity.positionSignature);
    expect(balanced.weight).toMatchObject({ complete: true, estimated: false, minimumGrams: 820, maximumGrams: 820 });
  });
  it('identifies identical proposed positions independently of mode, score, timestamp and array order', () => {
    const f = fixture(), plan = f.plan(), same = { ...plan, mode: 'easy_access' as const, score: -1, createdAt: '2000-01-01', placements: [...plan.placements].reverse() };
    const before = structuredClone({ app: f.app, plan, same });
    const a = comparePackingPlan(f.trip, f.app.libraryItems, f.app.containers, plan), b = comparePackingPlan(f.trip, f.app.libraryItems, f.app.containers, same);
    expect(a.positionSignature).toBe(b.positionSignature);
    same.placements = same.placements.map((p, i) => i ? p : { ...p, rotation: p.rotation + 1 });
    expect(comparePackingPlan(f.trip, f.app.libraryItems, f.app.containers, same).positionSignature).not.toBe(a.positionSignature);
    expect({ app: f.app, plan }).toEqual({ app: before.app, plan: before.plan });
  });
  it('retains ranges for every copy, accepts a zero lower bound and includes all selected tare weights', () => {
    const f = fixture(2); f.item.massRangeGrams = { min: 0, max: 150 }; f.second.tareGrams = 30;
    expect(f.review().weight).toMatchObject({ complete: true, estimated: true, minimumGrams: 40, maximumGrams: 340 });
    expect(comparisonWeightText(f.review().weight, 'metric')).toBe('Estimated saved weight: 40–340 g');
  });
  it('labels missing item and tare weights as subtotals rather than zero-weight complete totals', () => {
    const f = fixture(2); delete f.item.massGrams; delete f.item.massEvidence; delete f.second.tareGrams;
    const r = f.review(); expect(r.weight).toMatchObject({ minimumGrams: 10, maximumGrams: 10, missingItemCount: 2, missingTareCount: 1, complete: false });
    expect(comparisonWeightText(r.weight, 'metric')).toBe('Known subtotal: 10 g');
    expect(r.bags.find(b => b.itemCount > 0)?.limitStatus).toBe('incomplete');
    expect(r.bags.find(b => b.id === f.second.id)?.limitStatus).toBe('incomplete');
  });
  it('does not reuse a point weight when its saved range is invalid', () => {
    const f = fixture(1), plan = f.plan(); f.item.massRangeGrams = { min: 200, max: 100 };
    const r = comparePackingPlan(f.trip, f.app.libraryItems, f.app.containers, plan);
    expect(r.weight).toMatchObject({ complete: false, minimumGrams: 20, maximumGrams: 20, missingItemCount: 1 });
  });
  it('keeps paused physical locks in the uncertainty even after their geometric placements are excluded', () => {
    const f = fixture(1), placed = f.plan().placements[0]; f.trip.lockedPlacements = [{ ...placed, locked: true }];
    f.trip.completedInstanceIds = [placed.instanceId]; f.bag.opening = { length: 1, width: 1 };
    const before = structuredClone(f.app), r = f.review();
    expect(r.weight.complete).toBe(false); expect(r.weight.unresolvedPackedCount).toBe(1); expect(r.requiredOutsideCount).toBe(1);
    expect(r.bags[0].limitStatus).toBe('incomplete'); expect(f.app).toEqual(before);
  });
  it('uses selected prepared-envelope volume without reducing mass or altering source scans', () => {
    const f = fixture(1); f.item.flexibility = 'foldable'; f.item.packingForms = [{ id: 'fold', name: 'Fold', kind: 'folded', dimensions: { length: 10, width: 10, height: 10 }, dimensionEvidence: source, preparation: 'Fold without force.', reviewedAt: source.collectedAt }];
    f.trip.entries[0].packingFormId = 'fold'; const before = structuredClone(f.app), r = f.review();
    expect(r.preparationCount).toBe(1); expect(r.weight.maximumGrams).toBe(120);
    expect(r.bags.reduce((v, b) => v + b.usedVolumeMm3!, 0)).toBe(1000); expect(f.app).toEqual(before);
  });
  it('separates unavailable required items from required items that have no feasible placement', () => {
    const f = fixture(2); f.trip.unavailableInstanceIds = [f.trip.entries[0].id + '#1'];
    f.bag.opening = f.second.opening = { length: 1, width: 1 };
    const r = f.review(); expect(r.requiredOutsideCount).toBe(1); expect(r.unavailableRequiredCount).toBe(1);
    expect(r.excluded).toHaveLength(2); expect(r.earlyAccessCount).toBe(0);
  });
  it('does not include unused bag or library weights and discloses missing selected bags', () => {
    const f = fixture(1); f.app.libraryItems.push({ ...f.item, id: 'private-unused', massGrams: 50000 });
    f.app.containers.push({ ...f.bag, id: 'unused', tareGrams: 50000 });
    expect(f.review().weight.maximumGrams).toBe(120);
    f.trip.containerIds.push('missing'); const r = f.review(); expect(r.missingBagCount).toBe(1); expect(r.weight.complete).toBe(false);
  });
  it('avoids arbitrarily chosen masses for conflicting identities', () => {
    const f = fixture(1), plan = f.plan(); f.app.libraryItems.push({ ...f.item, massGrams: 10000 });
    let r = comparePackingPlan(f.trip, f.app.libraryItems, f.app.containers, plan); expect(r.weight.missingItemCount).toBe(1); expect(r.weight.maximumGrams).toBe(20);
    f.app.containers.push({ ...f.bag, tareGrams: 50000 }); r = comparePackingPlan(f.trip, f.app.libraryItems, f.app.containers, plan);
    expect(r.missingBagCount).toBe(1); expect(r.unlinkedPlacementCount).toBe(1); expect(r.weight.complete).toBe(false);
  });
  it('exposes an already excessive known subtotal even when another weight is unknown', () => {
    const f = fixture(1), plan = f.plan(); f.bag.massLimitGrams = 50; delete f.bag.tareGrams; delete f.bag.massLimitEvidence;
    const r = comparePackingPlan(f.trip, f.app.libraryItems, f.app.containers, plan), bag = r.bags[0];
    expect(bag.limitStatus).toBe('over'); expect(bag.marginGrams).toBeUndefined(); expect(bag.limitNeedsReview).toBe(true);
    expect(bag.weight.complete).toBe(false);
  });
  it('keeps lower-confidence, missing, future and malformed sources visibly unreviewed', () => {
    const f = fixture(1); for (const evidence of [undefined, { ...source, confidence: .6 }, { ...source, confidence: 2 }, { ...source, collectedAt: '2099-01-01T00:00:00Z' }]) {
      f.item.massEvidence = evidence; const r = f.review(); expect(r.weight.estimated).toBe(true); expect(r.weight.lowerConfidenceCount).toBe(1);
      expect(r.weight.maximumGrams).toBe(120); expect(r.evidenceReviewCount).toBeGreaterThan(0);
    }
  });
  it('does not clamp invalid volume ratios or imply usable volume when no computed summary exists', () => {
    const f = fixture(1), plan = f.plan(); plan.summaries[0].volumeUsedMm3 = plan.summaries[0].volumeCapacityMm3 * 1.2;
    expect(comparePackingPlan(f.trip, f.app.libraryItems, f.app.containers, plan).bags[0].occupiedPercent).toBe(120);
    plan.summaries = []; expect(comparePackingPlan(f.trip, f.app.libraryItems, f.app.containers, plan).bags[0].occupiedPercent).toBeUndefined();
  });
  it('converts display units without changing range endpoints or stored records', () => {
    const f = fixture(1); f.item.massRangeGrams = { min: 28.3495, max: 56.699 }; f.bag.tareGrams = f.second.tareGrams = 0;
    const before = structuredClone(f.app), r = f.review(); expect(comparisonWeightText(r.weight, 'imperial')).toBe('Estimated saved weight: 1–2 oz');
    expect(f.app).toEqual(before); expect(r.weight.minimumGrams).toBe(28.3495);
  });
});
