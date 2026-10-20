import { afterEach, describe, expect, it, vi } from 'vitest';
import { printPackingSequence } from './printing';

const native = vi.hoisted(() => ({ platform: false, available: false, print: vi.fn<() => Promise<void>>() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.platform, isPluginAvailable: () => native.available },
  registerPlugin: () => ({ printSequence: native.print }),
}));
afterEach(() => { vi.unstubAllGlobals(); native.platform = false; native.available = false; native.print.mockReset(); });

describe('explicit packing-sequence printing', () => {
  function nativeSequence() {
    native.platform = true;
    const sequence = { isConnected: true, querySelectorAll: () => [] };
    vi.stubGlobal('document', { hidden: false, querySelector: () => sequence, querySelectorAll: () => [] });
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => queueMicrotask(callback));
    const print = vi.fn(); vi.stubGlobal('window', { print });
    return print;
  }
  it('uses the native bridge for the prepared sequence without a browser print fallback', async () => {
    const browserPrint = nativeSequence();
    native.available = true; native.print.mockResolvedValue();
    await expect(printPackingSequence()).resolves.toBeUndefined();
    expect(native.print).toHaveBeenCalledTimes(1);
    expect(browserPrint).not.toHaveBeenCalled();
  });
  it('preserves native interruption errors without opening another print dialog', async () => {
    const browserPrint = nativeSequence();
    native.available = true; native.print.mockRejectedValue(new Error('Printing was interrupted.'));
    await expect(printPackingSequence()).rejects.toThrow('Printing was interrupted.');
    expect(browserPrint).not.toHaveBeenCalled();
  });
  it('refuses native printing when the plugin is absent', async () => {
    const browserPrint = nativeSequence();
    await expect(printPackingSequence()).rejects.toThrow('Printing is unavailable');
    expect(native.print).not.toHaveBeenCalled();
    expect(browserPrint).not.toHaveBeenCalled();
  });
  it('refuses a native request that becomes hidden while preparing', async () => {
    nativeSequence(); native.available = true;
    const pending = printPackingSequence();
    Object.defineProperty(document, 'hidden', { value: true });
    await expect(pending).rejects.toThrow('sequence changed');
    expect(native.print).not.toHaveBeenCalled();
  });
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
