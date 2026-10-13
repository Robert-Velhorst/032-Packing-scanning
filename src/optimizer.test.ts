import { describe, expect, it } from 'vitest';
import { buildPlan } from './optimizer';
import { createInitialData } from './seed';
import type { LibraryItem, Trip } from './types';

function fresh() {
  const data = createInitialData();
  return {
    trip: structuredClone(data.trips[0]),
    items: structuredClone(data.libraryItems),
    bags: structuredClone(data.containers),
  };
}

function customItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  const time = new Date(0).toISOString();
  return {
    id: 'test-item',
    name: 'Test item',
    category: 'other',
    dimensions: { length: 250, width: 180, height: 50 },
    dimensionEvidence: { source: 'measured', confidence: 1, collectedAt: time },
    flexibility: 'rigid',
    fragile: false,
    keepUpright: false,
    createdAt: time,
    updatedAt: time,
    ...overrides,
  };
}

function addEntry(trip: Trip, itemId: string, entryId = `entry-${itemId}`, travellerId = trip.travellers[0].id) {
  trip.entries = [{
    id: entryId,
    itemId,
    travellerId,
    quantity: 1,
    priority: 'required',
    accessPriority: 3,
    required: true,
  }];
}

describe('buildPlan', () => {
  it('returns deterministic placements and respects container bounds without collisions', () => {
    const { trip, items, bags } = fresh();
    const first = buildPlan(trip, items, bags);
    const second = buildPlan(trip, items, bags);
    const bag = bags[0];

    expect(first.placements).toEqual(second.placements);
    expect(first.excluded).toEqual(second.excluded);
    for (const placement of first.placements) {
      expect(placement.x).toBeGreaterThanOrEqual(0);
      expect(placement.y).toBeGreaterThanOrEqual(0);
      expect(placement.z).toBeGreaterThanOrEqual(0);
      expect(placement.x + placement.length).toBeLessThanOrEqual(bag.inside.length + 0.01);
      expect(placement.y + placement.width).toBeLessThanOrEqual(bag.inside.width + 0.01);
      expect(placement.z + placement.height).toBeLessThanOrEqual(bag.inside.height + 0.01);
      expect(placement.length).toBeLessThanOrEqual(bag.opening.length + 0.01);
      expect(placement.width).toBeLessThanOrEqual(bag.opening.width + 0.01);
    }
    for (let leftIndex = 0; leftIndex < first.placements.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < first.placements.length; rightIndex += 1) {
        const left = first.placements[leftIndex];
        const right = first.placements[rightIndex];
        const separate = left.x + left.length <= right.x + 0.01 || right.x + right.length <= left.x + 0.01
          || left.y + left.width <= right.y + 0.01 || right.y + right.width <= left.y + 0.01
          || left.z + left.height <= right.z + 0.01 || right.z + right.height <= left.z + 0.01;
        expect(separate).toBe(true);
      }
    }
  });

  it('summarizes placements independently for each selected bag', () => {
    const { trip, items, bags } = fresh();
    const firstItem = customItem({ id: 'summary-first', massGrams: 120 });
    const secondItem = customItem({ id: 'summary-second', massGrams: 240 });
    items.splice(0, items.length, firstItem, secondItem);
    const secondBag = { ...structuredClone(bags[0]), id: 'summary-second-bag', name: 'Second bag' };
    bags.push(secondBag);
    trip.containerIds = [bags[0].id, secondBag.id];
    trip.entries = [firstItem, secondItem].map((item, index) => ({
      id: `summary-entry-${index + 1}`,
      itemId: item.id,
      travellerId: trip.travellers[0].id,
      quantity: index === 0 ? 2 : 1,
      priority: 'required',
      accessPriority: 3,
      required: true,
      containerId: index === 0 ? bags[0].id : secondBag.id,
    }));

    const plan = buildPlan(trip, items, bags);
    const itemByInstance = new Map(plan.placements.map(placement => {
      const entry = trip.entries.find(candidate => candidate.id === placement.entryId)!;
      const item = items.find(candidate => candidate.id === entry.itemId)!;
      return [placement.instanceId, item] as const;
    }));

    for (const summary of plan.summaries) {
      const inside = plan.placements.filter(placement => placement.containerId === summary.containerId);
      const plannedItems = inside.map(placement => itemByInstance.get(placement.instanceId)!);
      expect(summary.itemCount).toBe(inside.length);
      expect(summary.usedMassGrams).toBe(plannedItems.reduce((sum, item) => sum + (item.massRangeGrams?.max ?? item.massGrams ?? 0), 0));
      expect(summary.volumeUsedMm3).toBe(plannedItems.reduce((sum, item) => sum + item.dimensions.length * item.dimensions.width * item.dimensions.height, 0));
    }
    expect(plan.summaries.map(summary => summary.itemCount)).toEqual([2, 1]);
  });

  it('keeps a saved placement in place when rebuilding the plan', () => {
    const { trip, items, bags } = fresh();
    const initial = buildPlan(trip, items, bags);
    trip.lockedPlacements = [initial.placements[0]];

    const rebuilt = buildPlan(trip, items, bags);
    const locked = rebuilt.placements.find((placement) => placement.instanceId === initial.placements[0].instanceId);

    expect(locked).toMatchObject({ ...initial.placements[0], locked: true });
  });

  it('uses bag tare and the upper end of a saved item weight range for the weight limit', () => {
    const { trip, items, bags } = fresh();
    const shirt = items.find((item) => item.id === 'sample-shirt')!;
    addEntry(trip, shirt.id);
    shirt.massGrams = 200;
    shirt.massRangeGrams = { min: 180, max: 600 };
    bags[0].tareGrams = 250;
    bags[0].massLimitGrams = 849;

    const plan = buildPlan(trip, items, bags);

    expect(plan.placements).toHaveLength(0);
    expect(plan.excluded[0].reason).toContain('weight limit');
  });

  it('rejects an item that clears the opening dimensions only in a disallowed orientation', () => {
    const { trip, items, bags } = fresh();
    const item = customItem();
    addEntry(trip, item.id);
    items.splice(0, items.length, item);
    bags[0].inside = { length: 500, width: 350, height: 180 };
    bags[0].opening = { length: 220, width: 200 };

    const plan = buildPlan(trip, items, bags);

    expect(plan.placements).toHaveLength(0);
    expect(plan.excluded[0].reason).toContain('opening');
  });

  it('does not rotate a keep-upright item onto its side', () => {
    const { trip, items, bags } = fresh();
    const item = customItem({ dimensions: { length: 160, width: 120, height: 140 }, keepUpright: true });
    addEntry(trip, item.id);
    items.splice(0, items.length, item);
    bags[0].inside = { length: 160, width: 150, height: 130 };
    bags[0].opening = { length: 160, width: 150 };

    expect(buildPlan(trip, items, bags).placements).toHaveLength(0);

    item.keepUpright = false;
    expect(buildPlan(trip, items, bags).placements).toHaveLength(1);
  });

  it('does not place an item in a bag assigned to a different traveller', () => {
    const { trip, items, bags } = fresh();
    const item = customItem();
    addEntry(trip, item.id, 'entry-test-item', 'traveller-someone-else');
    items.splice(0, items.length, item);

    const plan = buildPlan(trip, items, bags);

    expect(plan.placements).toHaveLength(0);
    expect(plan.excluded[0].reason).toContain('eligible bag');
  });
});
