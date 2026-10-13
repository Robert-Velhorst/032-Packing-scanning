import { describe, expect, it } from 'vitest';
import { buildPlan } from './optimizer';
import { createInitialData } from './seed';
import { isValidRejectedPlacement, markPackingItemUnavailable, rejectPackingPlacement, samePlacementGeometry, setPackingItemComplete } from './packing-progress';

describe('packing progress and real-world replanning', () => {
  it('refuses packed confirmation for an unavailable or unplaced item', () => {
    const data = structuredClone(createInitialData()), trip = data.trips[0];
    const placement = buildPlan(trip, data.libraryItems, data.containers).placements[0];
    expect(setPackingItemComplete(trip, placement.instanceId, true)).toBe(trip);
    const unavailable = markPackingItemUnavailable(trip, placement.instanceId);
    expect(setPackingItemComplete(unavailable, placement.instanceId, true, placement)).toBe(unavailable);
    expect(setPackingItemComplete(trip, 'other-item', true, placement)).toBe(trip);
  });
  it('preserves existing coordinates on repeated packed confirmations and unlocks only the undone item', () => {
    const data = structuredClone(createInitialData()), trip = data.trips[0];
    const [first, second] = buildPlan(trip, data.libraryItems, data.containers).placements;
    const once = setPackingItemComplete(trip, first.instanceId, true, first);
    const twice = setPackingItemComplete(once, first.instanceId, true, { ...first, x: first.x + 10 });
    expect(twice).toBe(once);
    const both = setPackingItemComplete(twice, second.instanceId, true, second);
    const undone = setPackingItemComplete(both, first.instanceId, false);
    expect(undone.completedInstanceIds).toEqual([second.instanceId]);
    expect(undone.lockedPlacements).toEqual([{ ...second, locked: true }]);
  });
  it('labels side-by-side base items as layer one instead of separate layers', () => {
    const data = structuredClone(createInitialData());
    const plan = buildPlan(data.trips[0], data.libraryItems, data.containers);
    const base = plan.placements.filter((placement) => placement.z === 0);
    expect(base.length).toBeGreaterThan(1);
    expect(base.every((placement) => placement.layer === 1)).toBe(true);
    for (const placement of plan.placements.filter((placement) => placement.z > 0)) expect(placement.layer).toBeGreaterThan(1);
  });
  it('tries another placement without removing a failed item or moving another packed item', () => {
    const data = structuredClone(createInitialData());
    let trip = structuredClone(data.trips[0]);
    const first = buildPlan(trip, data.libraryItems, data.containers);
    const packed = first.placements[0], failed = first.placements[1];
    trip.completedInstanceIds = [packed.instanceId]; trip.lockedPlacements = [{ ...packed, locked: true }];
    trip = rejectPackingPlacement(trip, failed);
    const retry = buildPlan(trip, data.libraryItems, data.containers);
    expect(trip.unavailableInstanceIds).not.toContain(failed.instanceId);
    expect(retry.placements.find((placement) => placement.instanceId === packed.instanceId)).toEqual({ ...packed, locked: true });
    const alternative = retry.placements.find((placement) => placement.instanceId === failed.instanceId)!;
    expect(alternative).toBeDefined();
    expect(samePlacementGeometry(alternative, failed)).toBe(false);
    expect(retry.excluded.some((entry) => entry.instanceId === failed.instanceId)).toBe(false);
  });

  it('keeps an unresolved required item visible when no alternative exists', () => {
    const data = structuredClone(createInitialData());
    let trip = structuredClone(data.trips[0]);
    const item = structuredClone(data.libraryItems[0]); item.dimensions = { length: 100, width: 100, height: 100 };
    const bag = structuredClone(data.containers[0]); bag.inside = { ...item.dimensions }; bag.opening = { length: 100, width: 100 }; delete bag.massLimitGrams;
    trip.entries = [{ ...trip.entries[0], itemId: item.id, quantity: 1, required: true }];
    const first = buildPlan(trip, [item], [bag]);
    expect(first.placements).toHaveLength(1);
    trip = rejectPackingPlacement(trip, first.placements[0]);
    const retry = buildPlan(trip, [item], [bag]);
    expect(retry.placements).toHaveLength(0); expect(retry.requiredExcludedCount).toBe(1);
    expect(retry.excluded[0].reason).toContain('No alternative'); expect(trip.unavailableInstanceIds).toEqual([]);
  });

  it('never silently moves a locked item after the bag is changed', () => {
    const data = structuredClone(createInitialData()), trip = structuredClone(data.trips[0]);
    const first = buildPlan(trip, data.libraryItems, data.containers);
    const saved = first.placements[0]; trip.lockedPlacements = [saved]; trip.completedInstanceIds = [saved.instanceId];
    data.containers[0].inside = { length: 1, width: 1, height: 1 };
    const changed = buildPlan(trip, data.libraryItems, data.containers);
    expect(changed.placements.some((placement) => placement.instanceId === saved.instanceId)).toBe(false);
    expect(changed.excluded.find((entry) => entry.instanceId === saved.instanceId)?.reason).toContain('saved locked placement');
    expect(trip.lockedPlacements).toEqual([saved]); expect(trip.completedInstanceIds).toEqual([saved.instanceId]);
  });

  it('preserves rejection feedback through JSON round trips and treats duplicate reports idempotently', () => {
    const data = structuredClone(createInitialData());
    const trip = data.trips[0], failed = buildPlan(trip, data.libraryItems, data.containers).placements[0];
    const once = rejectPackingPlacement(trip, failed), twice = rejectPackingPlacement(once, failed);
    expect(twice.rejectedPlacements).toHaveLength(1);
    const restored = JSON.parse(JSON.stringify(twice));
    const retry = buildPlan(restored, data.libraryItems, data.containers);
    expect(retry.placements.some((placement) => samePlacementGeometry(placement, failed))).toBe(false);
    expect(trip.rejectedPlacements).toBeUndefined();
  });

  it('marks unavailable idempotently while preserving other confirmations and locks', () => {
    const data = structuredClone(createInitialData()), trip = data.trips[0];
    const placements = buildPlan(trip, data.libraryItems, data.containers).placements.slice(0, 2);
    trip.lockedPlacements = placements; trip.completedInstanceIds = placements.map((p) => p.instanceId);
    const updated = markPackingItemUnavailable(markPackingItemUnavailable(trip, placements[0].instanceId), placements[0].instanceId);
    expect(updated.unavailableInstanceIds).toEqual([placements[0].instanceId]);
    expect(updated.completedInstanceIds).toEqual([placements[1].instanceId]); expect(updated.lockedPlacements).toEqual([placements[1]]);
  });

  it('rejects invalid feedback records and recognises the same geometry despite rotation aliases', () => {
    const data = structuredClone(createInitialData()), placement = buildPlan(data.trips[0], data.libraryItems, data.containers).placements[0];
    expect(isValidRejectedPlacement(placement)).toBe(true);
    expect(isValidRejectedPlacement({ ...placement, x: -1 })).toBe(false);
    expect(isValidRejectedPlacement({ ...placement, width: '300' })).toBe(false);
    expect(isValidRejectedPlacement({ ...placement, layer: 0 })).toBe(false);
    expect(samePlacementGeometry(placement, { ...placement, rotation: 90 })).toBe(true);
  });
});
