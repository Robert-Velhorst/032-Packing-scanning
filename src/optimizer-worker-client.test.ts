import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlannerWorkerClient, PLANNER_WORKER_MIN_ITEMS, shouldUsePlannerWorker, type PlannerWorkerRequest, type PlannerWorkerResponse } from './optimizer-worker-client';
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
  it('keeps small plans on the main thread and hands medium or complex plans to the worker', () => {
    expect(shouldUsePlannerWorker(PLANNER_WORKER_MIN_ITEMS - 1, false)).toBe(false);
    expect(shouldUsePlannerWorker(PLANNER_WORKER_MIN_ITEMS, false)).toBe(true);
    expect(shouldUsePlannerWorker(1, true)).toBe(true);
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
