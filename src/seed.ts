import type { AppData, Evidence, LibraryItem, Trip } from './types.ts';

const now = () => new Date().toISOString();

const evidence = (source: Evidence['source'], confidence: number, note?: string): Evidence => ({
  source,
  confidence,
  collectedAt: now(),
  ...(note ? { note } : {}),
});

const sampleItems: LibraryItem[] = [
  {
    id: 'sample-laptop',
    name: 'Laptop',
    category: 'electronics',
    dimensions: { length: 320, width: 220, height: 25 },
    dimensionEvidence: evidence('user_confirmed', 1, 'Example value; replace with your own measurement.'),
    massGrams: 1400,
    massEvidence: evidence('user_confirmed', 1, 'Example value; replace with your own measurement.'),
    flexibility: 'rigid',
    fragile: true,
    keepUpright: false,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'sample-shirt',
    name: 'Cotton shirt',
    category: 'clothing',
    dimensions: { length: 300, width: 200, height: 30 },
    dimensionEvidence: evidence('estimated', 0.55, 'Example estimate; confirm before planning around it.'),
    massGrams: 200,
    massRangeGrams: { min: 150, max: 260 },
    massEvidence: evidence('estimated', 0.45, 'Example estimate; not measured.'),
    flexibility: 'foldable',
    fragile: false,
    keepUpright: false,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'sample-trainers',
    name: 'Trainers (pair)',
    category: 'footwear',
    dimensions: { length: 280, width: 200, height: 100 },
    dimensionEvidence: evidence('estimated', 0.6, 'Example estimate; confirm before planning around it.'),
    massGrams: 800,
    massRangeGrams: { min: 650, max: 1000 },
    massEvidence: evidence('estimated', 0.45, 'Example estimate; not measured.'),
    flexibility: 'rigid',
    fragile: false,
    keepUpright: false,
    createdAt: now(),
    updatedAt: now(),
  },
];

const sampleContainer = {
  id: 'sample-cabin-case',
  name: 'Cabin case',
  kind: 'cabin_case' as const,
  inside: { length: 500, width: 350, height: 180 },
  opening: { length: 500, width: 350 },
  insideEvidence: evidence('user_confirmed', 1, 'Illustrative inside dimensions only; measure the usable interior.'),
  tareGrams: undefined,
  massLimitGrams: 7000,
  massLimitEvidence: evidence('user_confirmed', 1, 'Example limit only; this is not a carrier rule.'),
  travellerIds: ['traveller-you'],
  createdAt: now(),
};

const sampleTrip: Trip = {
  id: 'sample-trip',
  name: 'Lisbon · Example pack',
  destination: 'Lisbon, Portugal',
  packingOnly: true,
  sample: true,
  travellers: [{ id: 'traveller-you', name: 'You' }],
  containerIds: [sampleContainer.id],
  entries: [
    { id: 'entry-laptop', itemId: 'sample-laptop', travellerId: 'traveller-you', quantity: 1, priority: 'required', accessPriority: 5, required: true },
    { id: 'entry-shirt', itemId: 'sample-shirt', travellerId: 'traveller-you', quantity: 1, priority: 'preferred', accessPriority: 2, required: false },
    { id: 'entry-trainers', itemId: 'sample-trainers', travellerId: 'traveller-you', quantity: 1, priority: 'preferred', accessPriority: 2, required: false },
  ],
  mode: 'balanced',
  completedInstanceIds: [],
  unavailableInstanceIds: [],
  lockedPlacements: [],
  carrierRules: [],
  createdAt: now(),
  updatedAt: now(),
};

export function createInitialData(): AppData {
  return {
    schemaVersion: 1,
    unitSystem: 'metric',
    settings: { automaticPhotoDeletionDays: null, automaticScanDeletionDays: null, highContrast: false, reduceMotion: false },
    trips: [sampleTrip],
    containers: [sampleContainer],
    libraryItems: sampleItems,
    activeTripId: sampleTrip.id,
    locale: 'en',
  };
}
