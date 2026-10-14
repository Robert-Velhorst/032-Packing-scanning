import { buildPlan } from './optimizer';
import type { Container, LibraryItem, PackingPlan, Trip } from './types';

interface PlanRequest {
  requestId: number;
  trip: Trip;
  items: LibraryItem[];
  containers: Container[];
}

self.addEventListener('message', (event: MessageEvent<PlanRequest>) => {
  const { requestId, trip, items, containers } = event.data;
  try {
    const plan: PackingPlan = buildPlan(trip, items, containers);
    self.postMessage({ requestId, plan });
  } catch (error) {
    self.postMessage({ requestId, error: error instanceof Error ? error.message : 'The packing plan could not be prepared.' });
  }
});
