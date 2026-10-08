import { describe, expect, it } from 'vitest';
import { assessStackLoads, supportArea, topLoadError } from './stack-load';
import { buildPlan } from './optimizer';
import { createInitialData } from './seed';
import type { LibraryItem, OptimizationMode, Placement, PlanItem } from './types';

const evidence = { source: 'user_confirmed' as const, confidence: 1, collectedAt: '2026-09-30T12:00:00Z' };
const modes: OptimizationMode[] = ['balanced', 'maximum_capacity', 'easy_access', 'fragile_protection'];
function item(id: string, massGrams: number | undefined = 100, overrides: Partial<LibraryItem> = {}): LibraryItem {
  return { id, name: id, category: 'other', dimensions: { length: 100, width: 100, height: 10 },
    dimensionEvidence: evidence, massGrams, massEvidence: evidence, flexibility: 'rigid', fragile: false,
    keepUpright: true, createdAt: evidence.collectedAt, updatedAt: evidence.collectedAt, ...overrides };
}
function placement(id: string, z: number, overrides: Partial<Placement> = {}): Placement {
  return { instanceId: `${id}#1`, entryId: id, itemId: id, containerId: 'bag', x: 0, y: 0, z,
    length: 100, width: 100, height: 10, layer: z / 10 + 1, rotation: 0, ...overrides };
}
function planItems(items: LibraryItem[]): Map<string, PlanItem> {
  return new Map(items.map(i => [`${i.id}#1`, { ...i, instanceId: `${i.id}#1`, entryId: i.id, itemId: i.id,
    travellerId: 'person', volumeMm3: 100000, upperMassGrams: i.massRangeGrams?.max ?? i.massGrams,
    priority: 'required', required: true, accessPriority: 1 }]));
}
function fixture(items: LibraryItem[]) {
  const data = structuredClone(createInitialData());
  const trip = data.trips[0], bag = data.containers[0];
  bag.id = 'bag'; bag.inside = { length: 100, width: 100, height: 40 }; bag.opening = { length: 100, width: 100 };
  delete bag.unavailableSpaces; delete bag.lidClearanceMm; delete bag.lidClearanceEvidence;
  trip.containerIds = [bag.id]; trip.lockedPlacements = []; trip.completedInstanceIds = [];
  trip.entries = items.map(i => ({ id: i.id, itemId: i.id, travellerId: trip.travellers[0].id,
    quantity: 1, priority: 'required', required: true, accessPriority: 1 }));
  return { trip, bag, items };
}

describe('static stacking bounds', () => {
  it('carries cumulative upper weight through three layers, excluding own weight', () => {
    const items = planItems([item('base', 1000, { maxTopLoadGrams: 350, topLoadEvidence: evidence }), item('middle', 150), item('top', 100, { massRangeGrams: { min: 90, max: 201 } })]);
    const checks = assessStackLoads([placement('base', 0), placement('middle', 10), placement('top', 20)], items);
    expect(checks[0]).toMatchObject({ upperLoadGrams: 351, status: 'conflict', aboveInstanceIds: ['middle#1', 'top#1'] });
    expect(checks[1]).toMatchObject({ upperLoadGrams: 201, status: 'unverified' });
    expect(checks[2]).toMatchObject({ upperLoadGrams: 0, status: 'clear' });
  });
  it('counts full bridging load on each supporter and distinct descendants once on a shared ancestor', () => {
    const placements = [placement('floor', 0), placement('left', 10, { length: 50 }), placement('right', 10, { x: 50, length: 50 }), placement('bridge', 20)];
    const checks = assessStackLoads(placements, planItems([item('floor'), item('left'), item('right'), item('bridge', 400)]));
    expect(checks.map(c => c.upperLoadGrams)).toEqual([600, 400, 400, 0]);
    expect(assessStackLoads([...placements].reverse(), planItems([item('floor'), item('left'), item('right'), item('bridge', 400)])).find(c => c.instanceId === 'floor#1')?.upperLoadGrams).toBe(600);
  });
  it('does not transfer side contact, separated vertical surfaces or contact across bags', () => {
    const lower = placement('lower', 0);
    expect(supportArea(placement('upper', 10), lower)).toBe(10000);
    expect(supportArea(placement('upper', 10, { x: 100 }), lower)).toBe(0);
    expect(supportArea(placement('upper', 11), lower)).toBe(0);
    expect(supportArea(placement('upper', 10, { containerId: 'other' }), lower)).toBe(0);
  });
  it('requires known finite positive upper weights for a numeric limit, but allows unknown own weight', () => {
    const map = planItems([item('base', 100, { massGrams: undefined, maxTopLoadGrams: 500, topLoadEvidence: evidence }), item('upper', 100, { massGrams: undefined })]);
    expect(assessStackLoads([placement('base', 0), placement('upper', 10)], map)[0]).toMatchObject({ status: 'conflict', unknownMassCount: 1 });
    map.get('upper#1')!.upperMassGrams = 500;
    expect(assessStackLoads([placement('base', 0), placement('upper', 10)], map)[0]).toMatchObject({ status: 'within_recorded_limit', upperLoadGrams: 500 });
    map.get('upper#1')!.upperMassGrams = 500.0001;
    expect(assessStackLoads([placement('base', 0), placement('upper', 10)], map)[0].status).toBe('conflict');
  });
  it('treats fragile as no-stack even with a positive recorded limit or unknown mass above', () => {
    const checks = assessStackLoads([placement('base', 0), placement('top', 10)], planItems([item('base', 100, { fragile: true, maxTopLoadGrams: 900, topLoadEvidence: evidence }), item('top', 100, { massGrams: undefined })]));
    expect(checks[0]).toMatchObject({ limitGrams: 0, status: 'conflict' });
  });
  it('rejects malformed limits and source evidence while preserving absent legacy limits', () => {
    expect(topLoadError(item('legacy'))).toBeUndefined();
    for (const limit of [-1, NaN, Infinity, 100001]) expect(topLoadError(item('bad', 100, { maxTopLoadGrams: limit, topLoadEvidence: evidence }))).toBeDefined();
    expect(topLoadError(item('bad', 100, { maxTopLoadGrams: 0 }))).toBeDefined();
    expect(topLoadError(item('bad', 100, { topLoadEvidence: evidence }))).toBeDefined();
    expect(topLoadError(item('bad', 100, { maxTopLoadGrams: 10, topLoadEvidence: { ...evidence, confidence: 2 } }))).toBeDefined();
  });
});

describe('planner stacking constraints', () => {
  it('never adds support above a fragile locked base in any mode; required exclusion stays explicit', () => {
    const { trip, bag, items } = fixture([item('base', 100, { fragile: true }), item('top', 200)]);
    trip.lockedPlacements = [placement('base', 0)]; trip.completedInstanceIds = ['base#1'];
    const before = structuredClone(trip);
    for (const mode of modes) {
      const plan = buildPlan(trip, items, [bag], mode);
      expect(plan.placements.map(p => p.instanceId)).toEqual(['base#1']);
      expect(plan.excluded[0]).toMatchObject({ instanceId: 'top#1', required: true });
      expect(plan.excluded[0].reason).toContain('stacking');
    }
    expect(trip).toEqual(before);
  });
  it('catches a new third layer overloading an earlier limited base in every mode', () => {
    const { trip, bag, items } = fixture([item('base', 100, { maxTopLoadGrams: 250, topLoadEvidence: evidence }), item('middle', 150), item('top', 101)]);
    trip.lockedPlacements = [placement('base', 0), placement('middle', 10)];
    for (const mode of modes) {
      const plan = buildPlan(trip, items, [bag], mode);
      expect(plan.placements).toHaveLength(2);
      expect(plan.excluded[0].reason).toContain('cumulative');
    }
  });
  it('accepts the exact upper range bound and rejects unknown weight above a limit', () => {
    const { trip, bag, items } = fixture([item('base', 100, { maxTopLoadGrams: 300, topLoadEvidence: evidence }), item('top', 100, { massRangeGrams: { min: 90, max: 300 } })]);
    trip.lockedPlacements = [placement('base', 0)];
    expect(buildPlan(trip, items, [bag]).placements).toHaveLength(2);
    delete items[1].massGrams; delete items[1].massRangeGrams;
    expect(buildPlan(trip, items, [bag]).excluded[0].reason).toContain('Unknown weight');
  });
  it('preserves conflicting packed locks in storage, pauses that bag and still uses another eligible bag', () => {
    const { trip, bag, items } = fixture([item('base', 100, { fragile: true }), item('middle'), item('extra')]);
    trip.lockedPlacements = [placement('base', 0), placement('middle', 10)]; trip.completedInstanceIds = ['base#1', 'middle#1'];
    const other = { ...structuredClone(bag), id: 'other' }; trip.containerIds.push('other');
    const before = structuredClone(trip);
    const plan = buildPlan(trip, items, [bag, other]);
    expect(plan.placements).toHaveLength(1); expect(plan.placements[0]).toMatchObject({ instanceId: 'extra#1', containerId: 'other' });
    expect(plan.excluded).toHaveLength(2); expect(plan.excluded.every(e => e.reason.includes('undo packed or unlock'))).toBe(true);
    expect(trip).toEqual(before);
  });
  it('places a fragile item above a heavier support and preserves deterministic output', () => {
    const { trip, bag, items } = fixture([item('delicate', 50, { fragile: true }), item('support', 500)]);
    const plan = buildPlan(trip, items, [bag], 'fragile_protection');
    expect(plan.placements.find(p => p.itemId === 'support')?.z).toBe(0);
    expect(plan.placements.find(p => p.itemId === 'delicate')?.z).toBe(10);
    expect(plan.stackLoads?.some(load => load.status === 'conflict')).toBe(false);
    expect(buildPlan(trip, items, [bag], 'fragile_protection').placements).toEqual(plan.placements);
  });
  it('requires a full footprint in protection mode and retains the legacy support fraction in balanced mode', () => {
    const { trip, bag, items } = fixture([item('support', 100, { dimensions: { length: 70, width: 100, height: 10 } }), item('delicate', 50, { fragile: true })]);
    bag.inside.height = 20; trip.lockedPlacements = [placement('support', 0, { length: 70 })];
    expect(buildPlan(trip, items, [bag], 'balanced').placements).toHaveLength(2);
    expect(buildPlan(trip, items, [bag], 'fragile_protection').placements).toHaveLength(1);
  });
  it('flags an existing partially supported locked stack when switching to protection mode without altering its records', () => {
    const { trip, bag, items } = fixture([item('support', 100, { dimensions: { length: 70, width: 100, height: 10 } }), item('delicate', 50, { fragile: true })]);
    trip.lockedPlacements = [placement('support', 0, { length: 70 }), placement('delicate', 10)];
    const before = structuredClone(trip);
    expect(buildPlan(trip, items, [bag], 'balanced').placements).toHaveLength(2);
    const plan = buildPlan(trip, items, [bag], 'fragile_protection');
    expect(plan.placements).toHaveLength(0); expect(plan.excluded[0].reason).toContain('full rectangular support');
    expect(trip).toEqual(before);
  });
  it('excludes an invalid stacking record without discarding unrelated eligible items', () => {
    const { trip, bag, items } = fixture([item('bad', 100, { maxTopLoadGrams: -1, topLoadEvidence: evidence }), item('good')]);
    const plan = buildPlan(trip, items, [bag]);
    expect(plan.placements[0].itemId).toBe('good'); expect(plan.excluded[0].reason).toContain('Correct');
  });
});
