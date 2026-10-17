import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlannerWorkerClient, PLANNER_WORKER_MIN_ITEMS, plannerTripForWorker, shouldUsePlannerWorker, type PlannerWorkerRequest, type PlannerWorkerResponse } from './optimizer-worker-client';
import { buildPlan } from './optimizer';
import { createInitialData } from './seed';
import type { PackingPlan, Trip } from './types';

class FakeWorker {
  onmessage: ((event: MessageEvent<PlannerWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  respond(data: PlannerWorkerResponse) { this.onmessage?.({ data } as MessageEvent<PlannerWorkerResponse>); }
  fail(message: string) { this.onerror?.({ message } as ErrorEvent); }
}

const request = (requestId: number): PlannerWorkerRequest => ({
  requestId,
  trip: {} as Trip,
  items: [],
  containers: [],
});

afterEach(() => vi.useRealTimers());

describe('PlannerWorkerClient', () => {
  it('sends only planner-relevant trip fields without changing the plan', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const data = createInitialData();
    const trip = {
      ...data.trips[0],
      sharedPack: {
        householdId: 'household',
        packId: 'pack',
        revision: 1,
        idPrefix: 'shared-copy:',
        baseline: {
          method: 'shared_pack_baseline_v1' as const,
          revision: 1,
          tripId: data.trips[0].id,
          hashes: Object.fromEntries([
            ...['identity', 'name', 'context', 'mode'].map(kind => [JSON.stringify([kind, 'pack']), 'a'.repeat(64)]),
            ...Array.from({ length: 1_000 }, (_, index) => [JSON.stringify(['entry', `entry-${index}`]), 'a'.repeat(64)]),
          ]),
        },
      },
    };

    const plannerTrip = plannerTripForWorker(trip);

    expect(plannerTrip).not.toHaveProperty('sharedPack');
    expect(plannerTrip.entries).toBe(trip.entries);
    expect(plannerTrip.containerIds).toBe(trip.containerIds);
    expect(JSON.stringify(plannerTrip).length).toBeLessThan(JSON.stringify(trip).length / 2);
    expect(buildPlan(plannerTrip, data.libraryItems, data.containers)).toEqual(buildPlan(trip, data.libraryItems, data.containers));
  });

  it('keeps small plans on the main thread and hands medium or complex plans to the worker', () => {
    expect(shouldUsePlannerWorker(PLANNER_WORKER_MIN_ITEMS - 1, false)).toBe(false);
    expect(shouldUsePlannerWorker(PLANNER_WORKER_MIN_ITEMS, false)).toBe(true);
    expect(shouldUsePlannerWorker(1, true)).toBe(true);
  });

  it('passes batched comparison modes through the worker response', async () => {
    const worker = new FakeWorker();
    const client = new PlannerWorkerClient(() => worker as unknown as Worker);
    const plans = [{ mode: 'balanced' }, { mode: 'easy_access' }] as PackingPlan[];
    const pending = client.calculate({ ...request(3), modes: ['balanced', 'easy_access'] });
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ modes: ['balanced', 'easy_access'] }));
    worker.respond({ requestId: 3, plans });
    await expect(pending).resolves.toEqual({ requestId: 3, plans });
    client.dispose();
  });

  it('reuses an idle worker and releases it after the idle timeout', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const createWorker = vi.fn(() => worker as unknown as Worker);
    const client = new PlannerWorkerClient(createWorker, 5_000);
    const firstPlan = {} as PackingPlan;

    const first = client.calculate(request(1));
    worker.respond({ requestId: 1, plan: firstPlan });
    await expect(first).resolves.toEqual({ requestId: 1, plan: firstPlan });

    const second = client.calculate(request(2));
    expect(createWorker).toHaveBeenCalledOnce();
    worker.respond({ requestId: 2, error: 'No valid plan.' });
    await expect(second).resolves.toEqual({ requestId: 2, error: 'No valid plan.' });
    expect(worker.terminate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(worker.terminate).toHaveBeenCalledOnce();
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates in-flight work on cancellation and creates a fresh worker next time', async () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    const createWorker = vi.fn(() => workers[createWorker.mock.calls.length - 1] as unknown as Worker);
    const client = new PlannerWorkerClient(createWorker);
    const pending = client.calculate(request(7));
    client.cancel(7);
    await expect(pending).rejects.toThrow('cancelled');
    expect(workers[0].terminate).toHaveBeenCalledOnce();

    const next = client.calculate(request(8));
    workers[1].respond({ requestId: 8, plan: {} as PackingPlan });
    await expect(next).resolves.toMatchObject({ requestId: 8, plan: expect.any(Object) });
    expect(createWorker).toHaveBeenCalledTimes(2);
    client.dispose();
    expect(workers[1].terminate).toHaveBeenCalledOnce();
  });

  it('rejects worker runtime errors so the caller can fall back', async () => {
    const worker = new FakeWorker();
    const client = new PlannerWorkerClient(() => worker as unknown as Worker);
    const pending = client.calculate(request(4));
    worker.fail('Worker crashed.');
    await expect(pending).rejects.toThrow('Worker crashed.');
    expect(worker.terminate).toHaveBeenCalledOnce();
    client.dispose();
  });
});
