import { describe, expect, it } from 'vitest';
import { createInitialData } from './seed';
import { buildPlan } from './optimizer';
import { isPackingBackup } from './backup';
import { comparePackingPlan } from './plan-comparison';
import { isSharedPackingRecords, sharedPackingRecords } from './shared-packs';

const modes = ['balanced', 'maximum_capacity', 'easy_access', 'fragile_protection'] as const;
function fixture() {
  const app = structuredClone(createInitialData()), trip = app.trips[0], item = app.libraryItems[0], bag = app.containers[0];
  item.dimensions = { length: 20, width: 20, height: 20 }; item.massGrams = 100; item.fragile = false;
  item.maxTopLoadGrams = 10000; item.topLoadEvidence = { source: 'known', confidence: 1, collectedAt: '2026-10-01T00:00:00Z' };
  bag.inside = { length: 200, width: 100, height: 80 }; bag.opening = { length: 200, width: 100 };
  bag.tareGrams = 10; bag.massLimitGrams = 1000;
  app.libraryItems = [item]; app.containers = [bag, { ...bag, id: 'second', name: 'Second case' }];
  trip.containerIds = app.containers.map(b => b.id); trip.entries = [{ ...trip.entries[0], quantity: 2, required: true, containerId: bag.id }];
  trip.lockedPlacements = []; trip.completedInstanceIds = []; trip.carrierRules = [];
  const initial = buildPlan(trip, app.libraryItems, app.containers);
  trip.lockedPlacements = initial.placements.map(p => ({ ...p, locked: true })); trip.completedInstanceIds = initial.placements.map(p => p.instanceId);
  return { app, trip, item, bag };
}

describe('saved packed-weight constraints', () => {
  it('pauses overweight saved positions in every mode without moving or discarding them', () => {
    const f = fixture(); f.bag.massLimitGrams = 150;
    const before = structuredClone(f.app);
    for (const mode of modes) {
      const plan = buildPlan(f.trip, f.app.libraryItems, f.app.containers, mode);
      expect(plan.placements.filter(p => p.containerId === f.bag.id)).toHaveLength(0);
      expect(plan.requiredExcludedCount).toBe(2);
      expect(plan.totalItems).toBe(2);
      expect(plan.massConflicts?.[0]).toMatchObject({ containerId: f.bag.id, status: 'over', knownUpperMassGrams: 210, limitGrams: 150 });
      expect(plan.excluded.every(e => e.reason.includes('weight'))).toBe(true);
      expect(f.app).toEqual(before);
    }
  });
  it('rechecks increased item weights against the bag limit after packed confirmation', () => {
    const f = fixture(); f.bag.massLimitGrams = 250; f.item.massGrams = 200;
    const before = structuredClone(f.app);
    const plan = buildPlan(f.trip, f.app.libraryItems, f.app.containers);
    expect(plan.placements.filter(p => p.containerId === f.bag.id)).toHaveLength(0);
    expect(plan.requiredExcludedCount).toBe(2); expect(f.app).toEqual(before);
  });
  it('uses upper saved ranges rather than point weights and never moves physical locks to another bag', () => {
    const f = fixture(); f.item.massRangeGrams = { min: 80, max: 300 }; f.bag.massLimitGrams = 500;
    const before = structuredClone(f.trip);
    for (const mode of modes) {
      const p = buildPlan(f.trip, f.app.libraryItems, f.app.containers, mode);
      expect(p.placements).toHaveLength(0); expect(p.massConflicts?.[0].knownUpperMassGrams).toBe(610);
      expect(p.requiredExcludedCount).toBe(2); expect(f.trip).toEqual(before);
    }
  });
  it('continues packing in another eligible bag while pausing the overweight bag', () => {
    const f = fixture(); f.bag.massLimitGrams = 150;
    f.trip.entries.push({ ...f.trip.entries[0], id: 'new-entry', quantity: 1, containerId: undefined });
    const before = structuredClone(f.app);
    for (const mode of modes) {
      const p = buildPlan(f.trip, f.app.libraryItems, f.app.containers, mode);
      expect(p.placements).toHaveLength(1); expect(p.placements[0].containerId).toBe('second');
      expect(p.placements[0].instanceId).toBe('new-entry#1'); expect(p.requiredExcludedCount).toBe(2);
      expect(p.totalItems).toBe(3); expect(f.app).toEqual(before);
    }
  });
  it('keeps a known excessive subtotal visible even when some saved weights are missing', () => {
    const f = fixture(); f.bag.tareGrams = 150; f.bag.massLimitGrams = 120; delete f.item.massGrams;
    const p = buildPlan(f.trip, f.app.libraryItems, f.app.containers);
    expect(p.massConflicts?.[0]).toMatchObject({ status: 'over', knownUpperMassGrams: 150, missingItemCount: 2, missingTare: false });
    expect(p.placements).toHaveLength(0); expect(p.warnings.join(' ')).toContain('subtotal');
    expect(comparePackingPlan(f.trip, f.app.libraryItems, f.app.containers, p).weight.complete).toBe(false);
  });
  it('does not pause a below-limit unknown-weight geometry draft or certify it as complete', () => {
    const f = fixture(); delete f.item.massGrams;
    f.trip.lockedPlacements = []; f.trip.completedInstanceIds = [];
    const p = buildPlan(f.trip, f.app.libraryItems, f.app.containers);
    expect(p.massConflicts).toEqual([]); expect(p.placements).toHaveLength(2);
    expect(p.summaries[0].unweighedCount).toBe(2); expect(p.warnings.join(' ')).toContain('cannot be verified');
    expect(comparePackingPlan(f.trip, f.app.libraryItems, f.app.containers, p).weight.complete).toBe(false);
  });
  it('restores the exact stored positions after correction and respects the exact recorded boundary', () => {
    const f = fixture(), original = structuredClone(f.trip.lockedPlacements); f.bag.massLimitGrams = 150;
    expect(buildPlan(f.trip, f.app.libraryItems, f.app.containers).placements).toHaveLength(0);
    f.bag.massLimitGrams = 210;
    const p = buildPlan(f.trip, f.app.libraryItems, f.app.containers);
    expect(p.massConflicts).toEqual([]); expect(p.placements).toEqual(original); expect(f.trip.lockedPlacements).toEqual(original);
    expect(f.trip.completedInstanceIds).toEqual(original.map(p => p.instanceId));
  });
  it('counts physically saved contents even when a separate geometry edit already pauses the bag', () => {
    const f = fixture(); f.bag.massLimitGrams = 150; f.bag.opening = { length: 1, width: 1 };
    const p = buildPlan(f.trip, f.app.libraryItems, f.app.containers);
    expect(p.massConflicts?.[0].knownUpperMassGrams).toBe(210); expect(p.placements).toHaveLength(0);
    expect(f.trip.lockedPlacements).toHaveLength(2);
  });
  it('refuses invalid bag mass fields at backup and solver boundaries without changing source records', () => {
    for (const value of [-1, NaN, Infinity, 0]) {
      const f = fixture(); f.bag.massLimitGrams = value; const before = structuredClone(f.app);
      expect(isPackingBackup({ format: 'packing-scanning-backup', app: f.app, photos: [] })).toBe(false);
      const p = buildPlan(f.trip, f.app.libraryItems, f.app.containers);
      expect(p.placements).toHaveLength(0); expect(p.massConflicts?.[0].status).toBe('invalid'); expect(f.app).toEqual(before);
    }
    const f = fixture(); f.bag.tareGrams = -1;
    expect(isPackingBackup({ format: 'packing-scanning-backup', app: f.app, photos: [] })).toBe(false);
    expect(buildPlan(f.trip, f.app.libraryItems, f.app.containers).massConflicts?.[0].reason).toContain('Empty bag weight');
  });
  it('rejects invalid item weights or ranges rather than bypassing a limit through NaN or negative mass', () => {
    for (const value of [-1, 0, NaN, Infinity]) {
      const f = fixture(); f.item.massGrams = value; const before = structuredClone(f.app);
      expect(isPackingBackup({ format: 'packing-scanning-backup', app: f.app, photos: [] })).toBe(false);
      const p = buildPlan(f.trip, f.app.libraryItems, f.app.containers);
      expect(p.placements).toHaveLength(0); expect(p.excluded.every(e => e.reason.includes('weight record'))).toBe(true);
      expect(p.totalItems).toBe(2); expect(f.app).toEqual(before);
    }
    const f = fixture(); f.item.massRangeGrams = { min: 200, max: 100 };
    expect(isPackingBackup({ format: 'packing-scanning-backup', app: f.app, photos: [] })).toBe(false);
    expect(buildPlan(f.trip, f.app.libraryItems, f.app.containers).placements).toHaveLength(0);
  });
  it('allows missing optional weights, zero tare and a valid zero-lower-bound range in backups', () => {
    const f = fixture(); f.bag.tareGrams = 0; f.item.massRangeGrams = { min: 0, max: 100 };
    expect(isPackingBackup({ format: 'packing-scanning-backup', app: f.app, photos: [] })).toBe(true);
    delete f.item.massGrams; delete f.item.massRangeGrams; delete f.bag.tareGrams;
    expect(isPackingBackup({ format: 'packing-scanning-backup', app: f.app, photos: [] })).toBe(true);
  });
  it('rejects invalid mass fields in household records as well as local backups', () => {
    const f = fixture(), records = sharedPackingRecords(f.app, f.trip.id);
    expect(isSharedPackingRecords(records)).toBe(true);
    records.containers[0].tareGrams = -1;
    expect(isSharedPackingRecords(records)).toBe(false);
    records.containers[0].tareGrams = 0; records.libraryItems[0].massRangeGrams = { min: 50, max: 10 };
    expect(isSharedPackingRecords(records)).toBe(false);
  });
});
