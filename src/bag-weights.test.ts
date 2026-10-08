import { describe, expect, it } from 'vitest';
import { balancedBagCosts, balancedResultPenalty, recordedBagWeights, recordedWeightSpread, unresolvedPackedBagCounts } from './bag-weights';
import { buildPlan } from './optimizer';
import { createInitialData } from './seed';
import type { Container, ContainerSummary, LibraryItem, PlanItem } from './types';

function fixture(quantity = 8) {
  const data = createInitialData(), trip = structuredClone(data.trips[0]), at = new Date(0).toISOString();
  const item: LibraryItem = { ...structuredClone(data.libraryItems[0]), id: 'weight-item', name: 'Recorded weight kit',
    dimensions: { length: 10, width: 10, height: 10 }, massGrams: 500,
    massEvidence: { source: 'measured' as const, confidence: 1, collectedAt: at }, fragile: false, keepUpright: true };
  delete item.massRangeGrams; delete item.packingShape; delete item.packingForms;
  const bag: Container = { ...structuredClone(data.containers[0]), id: 'light', name: 'Light case', inside: { length: 100, width: 100, height: 100 },
    opening: { length: 100, width: 100 }, tareGrams: 0, tareEvidence: { source: 'measured' as const, confidence: 1, collectedAt: at }, travellerIds: [] };
  delete bag.massLimitGrams; delete bag.packingInterior; delete bag.unavailableSpaces; delete bag.lidClearanceMm;
  const bags = [bag, { ...structuredClone(bag), id: 'heavy', name: 'Heavy case' }];
  trip.containerIds = bags.map(b => b.id); trip.lockedPlacements = []; trip.completedInstanceIds = []; trip.unavailableInstanceIds = []; trip.rejectedPlacements = [];
  trip.entries = [{ id: 'weight-entry', itemId: item.id, travellerId: trip.travellers[0].id, quantity, priority: 'required', required: true, accessPriority: 1 }];
  trip.mode = 'balanced';
  return { trip, item, bags };
}
const summary = (id: string, mass: number, missing = 0): ContainerSummary => ({ containerId: id, itemCount: 2, usedMassGrams: mass, unweighedCount: missing, estimatedMassCount: 0, volumeUsedMm3: 1, volumeCapacityMm3: 2 });

describe('recorded cross-bag weight distribution', () => {
  it('spreads recorded weights even without mass limits, deterministically and without changing records', () => {
    const { trip, item, bags } = fixture(), before = structuredClone({ trip, item, bags });
    const plan = buildPlan(trip, [item], bags);
    expect(plan.excluded).toEqual([]);
    expect(plan.summaries.map(s => s.usedMassGrams)).toEqual([2000, 2000]);
    expect(buildPlan(trip, [item], bags).placements).toEqual(plan.placements);
    expect({ trip, item, bags }).toEqual(before);
  });
  it('includes different empty-bag weights instead of equalizing only item weight', () => {
    const { trip, item, bags } = fixture(); bags[1].tareGrams = 2000;
    const plan = buildPlan(trip, [item], bags), records = recordedBagWeights(bags, plan.summaries);
    expect(plan.excluded).toEqual([]);
    expect(records.map(r => r.subtotalGrams)).toEqual([3000, 3000]);
    expect(plan.summaries.map(s => s.itemCount)).toEqual([6, 2]);
    expect(recordedWeightSpread(records)).toBe(0);
  });
  it('uses upper ranges and disables numeric comparison when an item or tare is missing', () => {
    const { trip, item, bags } = fixture(2); item.massRangeGrams = { min: 400, max: 800 };
    let plan = buildPlan(trip, [item], bags);
    expect(plan.summaries.map(s => s.usedMassGrams)).toEqual([800, 800]);
    expect(recordedBagWeights(bags, plan.summaries).every(r => r.estimated)).toBe(true);
    delete bags[1].tareGrams;
    const records = recordedBagWeights(bags, [summary('light', 1000), summary('heavy', 500, 1)]);
    expect(records[1]).toMatchObject({ subtotalGrams: 500, missingItemCount: 1, missingTare: true, complete: false });
    expect(recordedWeightSpread(records)).toBeUndefined();
    expect(balancedBagCosts(bags, [], new Map(), 500).size).toBe(0);
    delete item.massGrams; delete item.massRangeGrams;
    plan = buildPlan(trip, [item], bags);
    expect(plan.summaries.reduce((count, s) => count + s.unweighedCount, 0)).toBe(2);
  });
  it('retains bag/traveller assignments and hard mass limits in every mode', () => {
    const { trip, item, bags } = fixture(2); bags[1].tareGrams = 2000; trip.entries[0].containerId = 'heavy';
    for (const mode of ['balanced', 'maximum_capacity', 'easy_access', 'fragile_protection'] as const) {
      const plan = buildPlan(trip, [item], bags, mode);
      expect(plan.placements.map(p => p.containerId)).toEqual(['heavy', 'heavy']);
      bags[1].massLimitGrams = 2200;
      expect(buildPlan(trip, [item], bags, mode).placements).toHaveLength(0);
      delete bags[1].massLimitGrams;
      bags[1].travellerIds = ['different-traveller'];
      expect(buildPlan(trip, [item], bags, mode).requiredExcludedCount).toBe(2);
      bags[1].travellerIds = [];
    }
  });
  it('keeps packed positions and completed flags while assigning new items to lighter bags', () => {
    const { trip, item, bags } = fixture(4); trip.entries[0].containerId = 'heavy';
    const initial = buildPlan(trip, [item], bags);
    trip.lockedPlacements = initial.placements.slice(0, 2).map(p => ({ ...p, locked: true }));
    trip.completedInstanceIds = trip.lockedPlacements.map(p => p.instanceId); delete trip.entries[0].containerId;
    const before = structuredClone(trip), next = buildPlan(trip, [item], bags);
    expect(next.placements.filter(p => p.locked)).toEqual(trip.lockedPlacements);
    expect(next.placements.filter(p => !p.locked).every(p => p.containerId === 'light')).toBe(true);
    expect(trip).toEqual(before);
  });
  it('does not choose a lighter bag through a too-small opening, inadequate interior or recorded intrusion', () => {
    const { trip, item, bags } = fixture(1); bags[1].tareGrams = 2000;
    item.dimensions = { length: 50, width: 40, height: 30 };
    bags[0].opening = { length: 20, width: 20 };
    expect(buildPlan(trip, [item], bags).placements.map(p => p.containerId)).toEqual(['heavy']);
    bags[0].opening = { length: 100, width: 100 }; bags[0].inside = { length: 40, width: 40, height: 40 };
    expect(buildPlan(trip, [item], bags).placements.map(p => p.containerId)).toEqual(['heavy']);
    bags[0].inside = { length: 100, width: 100, height: 100 };
    bags[0].unavailableSpaces = [{ id: 'blocked', name: 'Recorded unusable compartment', x: 0, y: 0, z: 0, ...bags[0].inside, evidence: item.dimensionEvidence }];
    expect(buildPlan(trip, [item], bags).placements.map(p => p.containerId)).toEqual(['heavy']);
    bags[1].massLimitGrams = 2100;
    expect(buildPlan(trip, [item], bags).requiredExcludedCount).toBe(1);
  });
  it('keeps positive limit conflicts visible even with missing weights; missing values never claim within-limit', () => {
    const { bags } = fixture(); bags[0].massLimitGrams = 800; bags[1].massLimitGrams = 800; delete bags[1].tareGrams;
    const records = recordedBagWeights(bags, [summary('light', 1000, 1), summary('heavy', 500, 1)]);
    expect(records[0].limitStatus).toBe('over'); expect(records[1].limitStatus).toBe('incomplete');
    expect(recordedBagWeights(bags, [summary('light', 500), summary('heavy', 500)])[0].limitStatus).toBe('within_recorded');
  });
  it('does not fabricate weights for missing, invalid or unknown records and labels unsourced tare as estimated', () => {
    const { bags } = fixture(); delete bags[0].tareEvidence; bags[1].tareGrams = -1;
    const records = recordedBagWeights(bags, [summary('light', 500), summary('heavy', NaN)]);
    expect(records[0]).toMatchObject({ complete: true, estimated: true });
    expect(records[1]).toMatchObject({ complete: false, subtotalGrams: 0, missingTare: true });
    expect(recordedBagWeights(bags, [])[0].complete).toBe(false);
    const items = new Map<string, PlanItem>();
    expect(balancedBagCosts(bags, [], items, undefined).size).toBe(0);
    expect(balancedBagCosts(bags, [], items, -1).size).toBe(0);
    expect(balancedResultPenalty(bags, [], items)).toBe(0);
  });
  it('normalizes large finite weights without overflow and treats zero as recorded', () => {
    const { bags } = fixture(); bags[0].tareGrams = 1e307; bags[1].tareGrams = 2e307;
    const costs = balancedBagCosts(bags, [], new Map(), 1e307);
    expect(costs.get('light')!).toBeLessThan(costs.get('heavy')!);
    expect([...costs.values()].every(Number.isFinite)).toBe(true);
    expect(balancedResultPenalty(bags, [], new Map())).toBeLessThanOrEqual(5);
    bags[0].tareGrams = bags[1].tareGrams = 0;
    expect(recordedWeightSpread(recordedBagWeights(bags, [summary('light', 0), summary('heavy', 0)]))).toBe(0);
    expect(balancedResultPenalty(bags, [], new Map())).toBe(0);
  });
  it('withholds complete totals for paused packed records and fails closed for unidentified malformed locks', () => {
    const { trip, item, bags } = fixture(2); trip.entries[0].containerId = 'heavy';
    trip.lockedPlacements = buildPlan(trip, [item], bags).placements.map(p => ({ ...p, locked: true }));
    let plan = buildPlan(trip, [item], bags);
    expect(unresolvedPackedBagCounts(bags, plan.placements, trip.lockedPlacements).size).toBe(0);
    const duplicate = { ...trip.lockedPlacements[0], x: 120 };
    expect(unresolvedPackedBagCounts(bags, plan.placements, [...trip.lockedPlacements, duplicate]).get('heavy')).toBe(1);
    item.dimensions = { length: 20, width: 20, height: 20 };
    plan = buildPlan(trip, [item], bags);
    const unresolved = unresolvedPackedBagCounts(bags, plan.placements, trip.lockedPlacements);
    expect(unresolved.get('heavy')).toBe(2);
    const records = recordedBagWeights(bags, plan.summaries, unresolved);
    expect(records[1]).toMatchObject({ complete: false, unresolvedPackedCount: 2 });
    expect(recordedWeightSpread(records)).toBeUndefined();
    expect(unresolvedPackedBagCounts(bags, [], [null as unknown as typeof trip.lockedPlacements[number]])).toEqual(new Map([['light', 1], ['heavy', 1]]));
  });

});
