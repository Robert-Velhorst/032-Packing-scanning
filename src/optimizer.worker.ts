import { buildPlan } from './optimizer';
import type { Container, LibraryItem, OptimizationMode, PackingPlan, Trip } from './types';

interface PlanRequest {
  requestId: number;
  trip: Trip;
  items: LibraryItem[];
  containers: Container[];
  modes?: OptimizationMode[];
}

self.addEventListener('message', (event: MessageEvent<PlanRequest>) => {
  const { requestId, trip, items, containers, modes } = event.data;
  try {
    if (modes) {
      const plans: PackingPlan[] = modes.map(mode => buildPlan({ ...trip, mode }, items, containers, mode));
      self.postMessage({ requestId, plans });
      return;
    }
    const plan: PackingPlan = buildPlan(trip, items, containers);
    self.postMessage({ requestId, plan });
  } catch (error) {
    self.postMessage({ requestId, error: error instanceof Error ? error.message : 'The packing plan could not be prepared.' });
  }
});
