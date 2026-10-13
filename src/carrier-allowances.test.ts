import { describe, expect, it } from 'vitest';
import { assessCarrierRule, isValidCarrierRuleRecord } from './carrier-rules';
import { carrierPackedWeights } from './carrier-packed-weights';
import { carrierRuleDraft, carrierRuleHasUpdatedLimits, carrierRuleOverridden, isCarrierCatalog } from './carrier-catalog';
import { parseEasyjet } from '../server/easyjet';
import { fixture as pageFixture } from '../server/test-fixtures';
import { createInitialData } from './seed';
import { buildPlan } from './optimizer';
import { isPackingBackup } from './backup';
import { isSharedPackingRecords, sharedPackingRecords } from './shared-packs';
import type { CarrierLimits, CarrierRule, Placement } from './types';

function fixture() {
  const data = structuredClone(createInitialData()), item = data.libraryItems[0], bag = data.containers[0], trip = data.trips[0];
  const evidence = { source: 'known' as const, confidence: 1, collectedAt: new Date().toISOString() };
  Object.assign(item, { dimensions: { length: 20, width: 20, height: 20 }, massGrams: 100, massEvidence: evidence, fragile: false, keepUpright: false, flexibility: 'rigid', maxTopLoadGrams: 10000 });
  delete item.scan; delete item.packingShape; delete item.packingForms; delete item.massRangeGrams;
  item.topLoadEvidence = evidence;
  Object.assign(bag, { inside: { length: 200, width: 100, height: 80 }, opening: { length: 200, width: 100 }, tareGrams: 10, tareEvidence: evidence, massLimitGrams: 1000 });
  delete bag.scan; delete bag.packingInterior; delete bag.compartments; delete bag.unavailableSpaces; delete bag.lidClearanceMm;
  const second = { ...structuredClone(bag), id: 'second-case', tareGrams: 30 };
  trip.entries = [{ ...trip.entries[0], itemId: item.id, quantity: 2, required: true, containerId: bag.id }];
  trip.containerIds = [bag.id, second.id]; trip.lockedPlacements = []; trip.completedInstanceIds = []; trip.unavailableInstanceIds = []; trip.rejectedPlacements = []; trip.carrierRules = [];
  data.libraryItems = [item]; data.containers = [bag, second]; data.trips = [trip]; data.activeTripId = trip.id;
  const plan = buildPlan(trip, data.libraryItems, data.containers); expect(plan.placements).toHaveLength(2);
  trip.lockedPlacements = plan.placements.map(p => ({ ...p, locked: true })); trip.completedInstanceIds = plan.placements.map(p => p.instanceId);
  const source = (limits: CarrierLimits, ids = [bag.id]): CarrierRule => ({ id: 'source', carrier: 'Synthetic Air', route: 'Synthetic route', fare: 'Synthetic allowance', sourceUrl: 'https://example.test/allowance', retrievedAt: new Date().toISOString(), staleAfterDays: 7, applicableBagIds: ids, notes: 'Synthetic source only', status: 'manual', limits });
  const context = () => ({ placements: buildPlan(trip, data.libraryItems, data.containers).placements, lockedPlacements: trip.lockedPlacements, items: data.libraryItems });
  return { data, item, bag, second, trip, source, context };
}
describe('carrier piece allowances and saved physical weight', () => {
  it('checks selected physical bags including empty bags and keeps the count independent of units', () => {
    const f = fixture(), before = structuredClone(f.data);
    const r = assessCarrierRule(f.source({ maxBagCount: 1 }, f.trip.containerIds), f.data.containers, []);
    expect(r.bagCount).toMatchObject({ status: 'over', measured: 2, limit: 1, margin: -1, unit: 'bags' }); expect(f.data).toEqual(before);
    expect(assessCarrierRule(f.source({ maxBagCount: 2 }, f.trip.containerIds), f.data.containers, []).bagCount?.status).toBe('within');
  });
  it('preserves a zero allowance and absent counts without inventing a default', () => {
    const f = fixture(); expect(assessCarrierRule(f.source({ maxBagCount: 0 }), f.data.containers, []).bagCount).toMatchObject({ status: 'over', limit: 0 });
    expect(assessCarrierRule(f.source({ maxWeightGrams: 250, weightScope: 'per_bag' }), f.data.containers, []).bagCount).toBeUndefined();
  });
  it('cannot give a count or combined-weight pass for a missing selected bag or duplicate identity', () => {
    const f = fixture(), limits = { maxBagCount: 2, maxWeightGrams: 1000, weightScope: 'combined' as const };
    const r = assessCarrierRule(f.source(limits, [f.bag.id, 'missing']), f.data.containers, [], f.context());
    expect(r.bagCount?.status).toBe('unknown'); expect(r.bagCount?.margin).toBeUndefined(); expect(r.combinedWeight?.status).toBe('unknown');
    expect(assessCarrierRule(f.source(limits, [f.bag.id, f.bag.id]), f.data.containers, []).error).toContain('duplicated');
    expect(assessCarrierRule(f.source(limits), [f.bag, f.bag], []).error).toContain('duplicated');
  });
  it('retains paused packed mass instead of reporting tare alone as within-limit', () => {
    const f = fixture(), before = structuredClone(f.trip.lockedPlacements); f.bag.massLimitGrams = 150;
    const plan = buildPlan(f.trip, f.data.libraryItems, f.data.containers); expect(plan.placements).toHaveLength(0);
    const r = assessCarrierRule(f.source({ maxWeightGrams: 200, weightScope: 'per_bag' }), f.data.containers, plan.summaries, f.context());
    expect(r.bags[0].checks[0]).toMatchObject({ status: 'subtotal_over', measured: 210, limit: 200, margin: -10 });
    expect(r.bags[0].checks[0].detail).toContain('2 saved packed positions'); expect(f.trip.lockedPlacements).toEqual(before); expect(f.trip.completedInstanceIds).toHaveLength(2);
  });
  it('withholds positive margins for unresolved saved contents below a carrier limit', () => {
    const f = fixture(); f.bag.massLimitGrams = 150;
    const check = assessCarrierRule(f.source({ maxWeightGrams: 250, weightScope: 'per_bag' }), f.data.containers, [], f.context()).bags[0].checks[0];
    expect(check).toMatchObject({ status: 'unknown', measured: 210 }); expect(check.margin).toBeUndefined(); expect(check.detail).toContain('cannot establish a pass');
  });
  it('recovers exact totals without double counting accepted locks, including explicit zero tare', () => {
    const f = fixture(); f.bag.tareGrams = 0;
    const r = assessCarrierRule(f.source({ maxWeightGrams: 200, weightScope: 'per_bag' }), f.data.containers, [], f.context());
    expect(r.bags[0].checks[0]).toMatchObject({ status: 'within', measured: 200, margin: 0 });
    expect(carrierPackedWeights(f.data.containers, f.context()).get(f.bag.id)).toMatchObject({ complete: true, subtotalGrams: 200, unresolvedPackedCount: 0 });
  });
  it('adds saved and proposed contents plus each tare once for combined limits', () => {
    const f = fixture(); f.bag.massLimitGrams = 150;
    expect(assessCarrierRule(f.source({ maxWeightGrams: 220, weightScope: 'combined' }, f.trip.containerIds), f.data.containers, [], f.context()).combinedWeight).toMatchObject({ status: 'subtotal_over', measured: 240, margin: -20 });
    f.bag.massLimitGrams = 1000;
    expect(assessCarrierRule(f.source({ maxWeightGrams: 240, weightScope: 'combined' }, f.trip.containerIds), f.data.containers, [], f.context()).combinedWeight).toMatchObject({ status: 'within', measured: 240, margin: 0 });
  });
  it('retains geometry-stale positions and upper ranges without reducing mass for prepared forms', () => {
    const f = fixture(); f.bag.opening.length = 5; f.item.massRangeGrams = { min: 0, max: 300 };
    expect(carrierPackedWeights(f.data.containers, f.context()).get(f.bag.id)).toMatchObject({ subtotalGrams: 610, complete: false, estimated: true, unresolvedPackedCount: 2 });
  });
  it('keeps known over-limit subtotals when other item or tare masses are missing', () => {
    const f = fixture(); delete f.item.massGrams; f.bag.tareGrams = 150; f.bag.massLimitGrams = 100;
    const check = assessCarrierRule(f.source({ maxWeightGrams: 120, weightScope: 'per_bag' }), f.data.containers, [], f.context()).bags[0].checks[0];
    expect(check).toMatchObject({ status: 'subtotal_over', measured: 150 }); expect(check.detail).toContain('item weight records missing');
    delete f.bag.tareGrams;
    const unknown = assessCarrierRule(f.source({ maxWeightGrams: 120, weightScope: 'per_bag' }), f.data.containers, [], f.context()).bags[0].checks[0];
    expect(unknown.status).toBe('unknown'); expect(unknown.margin).toBeUndefined();
  });
  it('does not count an instance in a new proposed bag when its saved position remains physical', () => {
    const f = fixture(), context = f.context(); context.placements[0] = { ...context.placements[0], containerId: f.second.id, locked: false };
    const w = carrierPackedWeights(f.data.containers, context); expect(w.get(f.bag.id)?.subtotalGrams).toBe(210); expect(w.get(f.second.id)?.subtotalGrams).toBe(30); expect(w.get(f.bag.id)?.complete).toBe(false);
  });
  it('keeps ambiguous or malformed saved identities and duplicated item records incomplete', () => {
    const f = fixture(), context = f.context(); context.lockedPlacements.push({ ...context.lockedPlacements[0], containerId: f.second.id });
    const w = carrierPackedWeights(f.data.containers, context); expect(w.get(f.bag.id)?.complete).toBe(false); expect(w.get(f.second.id)?.complete).toBe(false);
    context.lockedPlacements = [null as unknown as Placement]; expect([...carrierPackedWeights(f.data.containers, context).values()].every(w => !w.complete)).toBe(true);
    context.lockedPlacements = f.trip.lockedPlacements.slice(0, 2); context.items = [f.item, structuredClone(f.item)];
    expect(carrierPackedWeights(f.data.containers, context).get(f.bag.id)?.missingItemCount).toBe(2);
  });
  it('cannot accept changed item identities merely because their coordinates match', () => {
    const f = fixture(), context = f.context(); context.placements[0].itemId = 'changed-item';
    expect(carrierPackedWeights(f.data.containers, context).get(f.bag.id)).toMatchObject({ complete: false, subtotalGrams: 210, unresolvedPackedCount: 1 });
  });
  it('keeps invalid mass records and overflowing totals from producing a pass or misleading infinite excess', () => {
    const f = fixture(); f.item.massGrams = NaN;
    let check = assessCarrierRule(f.source({ maxWeightGrams: 1000, weightScope: 'per_bag' }), f.data.containers, [], f.context()).bags[0].checks[0];
    expect(check.status).toBe('unknown'); expect(check.margin).toBeUndefined();
    f.item.massGrams = 1e308;
    check = assessCarrierRule(f.source({ maxWeightGrams: 1000, weightScope: 'per_bag' }), f.data.containers, [], f.context()).bags[0].checks[0];
    expect(check.status).toBe('unknown'); expect(check.measured).toBeUndefined(); expect(check.detail).toContain('invalid');
  });
  it('accepts count-only rules and rejects invalid counts in backups and shared copies', () => {
    const f = fixture(); f.trip.carrierRules = [f.source({ maxBagCount: 1 })];
    expect(isPackingBackup({ format: 'packing-scanning-backup', app: f.data, photos: [] })).toBe(true);
    const validShared = sharedPackingRecords(f.data, f.trip.id);
    expect(isSharedPackingRecords(validShared)).toBe(true);
    for (const count of [-1, 1.5, NaN, Infinity, 101, null as unknown as number]) {
      f.trip.carrierRules[0].limits!.maxBagCount = count;
      expect(isValidCarrierRuleRecord(f.trip.carrierRules[0])).toBe(false); expect(isPackingBackup({ format: 'packing-scanning-backup', app: f.data, photos: [] })).toBe(false);
      const shared = structuredClone(validShared);
      shared.trip.carrierRules[0].limits!.maxBagCount = count;
      expect(isSharedPackingRecords(shared)).toBe(false);
    }
  });
});
describe('retrieved piece allowance provenance', () => {
  it('extracts each one-bag allowance and refuses changed or conflicting piece statements', () => {
    const catalog = parseEasyjet(pageFixture(), new Date().toISOString()); expect(catalog.allowances.every(a => a.limits.maxBagCount === 1)).toBe(true);
    expect(() => parseEasyjet(pageFixture().replace('One small cabin bag', 'Two small cabin bags'), new Date().toISOString())).toThrow();
    expect(() => parseEasyjet(pageFixture().replace('One small cabin bag', 'One small cabin bag Two small cabin bags'), new Date().toISOString())).toThrow(/piece/);
  });
  it('keeps count edits as overrides and flags refreshed legacy copies without overwriting records', () => {
    const old = parseEasyjet(pageFixture(), new Date(Date.now() - 10000).toISOString());
    for (const a of old.allowances) delete a.limits.maxBagCount;
    expect(isCarrierCatalog(old)).toBe(true);
    const rule = carrierRuleDraft(old, 'small'), before = structuredClone(rule), latest = parseEasyjet(pageFixture(), new Date().toISOString());
    expect(carrierRuleHasUpdatedLimits(rule, latest)).toBe(true); expect(rule).toEqual(before);
    const fresh = carrierRuleDraft(latest, 'small'); expect(carrierRuleOverridden(fresh)).toBe(false); fresh.limits!.maxBagCount = 2;
    expect(carrierRuleOverridden(fresh)).toBe(true); expect(fresh.retrieval!.catalog.allowances[0].limits.maxBagCount).toBe(1);
    latest.allowances[0].limits.maxBagCount = 2; expect(isCarrierCatalog(latest)).toBe(false);
  });
});
