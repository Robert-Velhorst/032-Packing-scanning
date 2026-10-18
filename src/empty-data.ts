import type { AppData } from './types.ts';

/** Empty workspace defaults used when clearing local records. */
export function createEmptyData(): AppData {
  return {
    schemaVersion: 1,
    unitSystem: 'metric',
    settings: { automaticPhotoDeletionDays: null, automaticScanDeletionDays: null, highContrast: false, reduceMotion: false },
    trips: [],
    containers: [],
    libraryItems: [],
    activeTripId: '',
    locale: 'en',
  };
}
