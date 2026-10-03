import { describe, expect, it } from 'vitest';
import { buildTripSuggestions, matchTripSuggestionItems, tripDurationDays } from './trip-assistant';
import type { LibraryItem, Trip } from './types';

const trip = (overrides: Partial<Trip> = {}): Trip => ({
  id: 'trip', name: 'Trip', destination: '', packingOnly: false, sample: false,
  travellers: [], containerIds: [], entries: [], mode: 'balanced',
  completedInstanceIds: [], unavailableInstanceIds: [], lockedPlacements: [], carrierRules: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const libraryItem = (id: string, name: string, category: LibraryItem['category']): LibraryItem => ({
  id, name, category, dimensions: { length: 1, width: 1, height: 1 },
  dimensionEvidence: { source: 'user_confirmed', confidence: 1, collectedAt: '2026-01-01T00:00:00.000Z' },
  flexibility: 'rigid', fragile: false, keepUpright: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('trip list assistant', () => {
  it('does not change packing-only sessions', () => {
    expect(buildTripSuggestions(trip({ packingOnly: true }))).toEqual([]);
  });

  it('counts dates inclusively and rejects invalid or reversed dates', () => {
    expect(tripDurationDays({ startDate: '2026-10-02', endDate: '2026-10-06' })).toBe(5);
    expect(tripDurationDays({ startDate: '2026-02-30', endDate: '2026-03-02' })).toBeUndefined();
    expect(tripDurationDays({ startDate: '2026-10-06', endDate: '2026-10-02' })).toBeUndefined();
  });

  it('uses duration and laundry only as an editable clothing starting point', () => {
    const noLaundry = buildTripSuggestions(trip({ startDate: '2026-10-02', endDate: '2026-10-06' }));
    const laundry = buildTripSuggestions(trip({ startDate: '2026-10-02', endDate: '2026-10-06', laundryAvailable: true }));
    expect(noLaundry.find((suggestion) => suggestion.id === 'everyday-clothing')).toMatchObject({ quantity: 5 });
    expect(laundry.find((suggestion) => suggestion.id === 'everyday-clothing')).toMatchObject({ quantity: 4 });
  });

  it('uses only activities the traveller selected and makes every recommendation optional or preferred', () => {
    const suggestions = buildTripSuggestions(trip({ activities: ['beach', 'business'] }));
    expect(suggestions.map((suggestion) => suggestion.id)).toContain('swimwear');
    expect(suggestions.map((suggestion) => suggestion.id)).toContain('work-outfit');
    expect(suggestions.map((suggestion) => suggestion.id)).not.toContain('outdoor-layer');
    expect(suggestions.every((suggestion) => suggestion.priority !== 'required')).toBe(true);
  });

  it('does not infer weather, carrier rules, or medical requirements', () => {
    const suggestions = buildTripSuggestions(trip({ destination: 'Reykjavik', startDate: '2026-12-01', endDate: '2026-12-05' }));
    expect(suggestions.map((suggestion) => suggestion.name)).not.toContain('Medication');
    expect(suggestions.map((suggestion) => suggestion.name)).not.toContain('Winter coat');
    expect(suggestions.map((suggestion) => suggestion.name)).not.toContain('Airline baggage allowance');
  });

  it('does not match an electronics category alone to the phone-and-charger reminder', () => {
    const phoneReminder = buildTripSuggestions(trip()).find((suggestion) => suggestion.id === 'phone-charger')!;
    const library = [libraryItem('laptop', 'Laptop', 'electronics'), libraryItem('charger', 'Phone charger', 'electronics')];
    expect(matchTripSuggestionItems(phoneReminder, library).map((item) => item.id)).toEqual(['charger']);
  });
});
