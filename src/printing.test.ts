import { afterEach, describe, expect, it, vi } from 'vitest';
import { printPackingSequence } from './printing';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, isPluginAvailable: () => false }, registerPlugin: () => ({}) }));
afterEach(() => vi.unstubAllGlobals());

describe('explicit packing-sequence printing', () => {
  it('does not print a different screen when the user leaves during preparation', async () => {
    const sequence = { isConnected: true, querySelectorAll: () => [] };
    vi.stubGlobal('document', { querySelector: () => sequence, querySelectorAll: () => [] });
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => queueMicrotask(callback));
    const print = vi.fn(); vi.stubGlobal('window', { print });
    const pending = printPackingSequence();
    sequence.isConnected = false;
    await expect(pending).rejects.toThrow('sequence changed');
    expect(print).not.toHaveBeenCalled();
  });
  it('rejects printing without an open sequence and never calls the print dialog', async () => {
    const print = vi.fn(); vi.stubGlobal('window', { print });
    vi.stubGlobal('document', { querySelector: () => null });
    await expect(printPackingSequence()).rejects.toThrow('Open the packing sequence');
    expect(print).not.toHaveBeenCalled();
  });
  it('waits for deferred sequence photos to settle before printing', async () => {
    let photoState = 'loading';
    const photo = { getAttribute: () => photoState };
    const sequence = { isConnected: true, querySelectorAll: () => photoState === 'loading' ? [photo] : [] };
    class FakeMutationObserver {
      constructor(private readonly callback: MutationCallback) {}
      observe() { photoState = 'ready'; this.callback([], this as unknown as MutationObserver); }
      disconnect() {}
    }
    const print = vi.fn();
    vi.stubGlobal('MutationObserver', FakeMutationObserver);
    vi.stubGlobal('document', {
      hidden: false,
      querySelector: () => sequence,
      querySelectorAll: () => [],
    });
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => queueMicrotask(callback));
    vi.stubGlobal('window', { print });

    await expect(printPackingSequence()).resolves.toBeUndefined();
    expect(print).toHaveBeenCalledTimes(1);
  });
});
