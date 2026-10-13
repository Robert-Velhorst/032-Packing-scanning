import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialData } from './seed';

describe('planner worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('returns a plan tagged with the request id', async () => {
    const addEventListener = vi.fn();
    const postMessage = vi.fn();
    vi.stubGlobal('self', { addEventListener, postMessage });

    await import('./optimizer.worker');
    const listener = addEventListener.mock.calls.find(([type]) => type === 'message')?.[1];
    expect(listener).toBeTypeOf('function');

    const data = createInitialData();
    listener?.({ data: { requestId: 12, trip: data.trips[0], items: data.libraryItems, containers: data.containers } });

    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls[0][0]).toMatchObject({ requestId: 12, plan: { placements: expect.any(Array) } });
  });
});
