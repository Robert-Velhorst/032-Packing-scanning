import { describe, expect, it } from 'vitest';
import { createInitialData } from './seed';
import { canSeparatePackingCopy, separablePackingEntryIds } from './packing-forms';

describe('bulk separable-entry index', () => {
  it('matches the per-entry safety check across completed, unavailable, locked and rejected copies', () => {
    const trip = createInitialData().trips[0];
    const template = trip.entries[0];
    trip.entries = ['completed', 'unavailable', 'locked', 'rejected', 'available'].map((id) => ({ ...template, id, quantity: 2 }));
    trip.completedInstanceIds = ['completed#2'];
    trip.unavailableInstanceIds = ['unavailable#2'];
    trip.lockedPlacements = [{ ...trip.lockedPlacements[0], instanceId: 'locked#2' }];
    trip.rejectedPlacements = [{ ...trip.lockedPlacements[0], instanceId: 'rejected#2' }];

    const expected = trip.entries.filter((entry) => canSeparatePackingCopy(trip, entry.id)).map((entry) => entry.id);

    expect([...separablePackingEntryIds(trip)]).toEqual(expected);
    expect(expected).toEqual(['available']);
  });
});
