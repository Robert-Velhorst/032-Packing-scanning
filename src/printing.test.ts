import { afterEach, describe, expect, it, vi } from 'vitest';
import { printPackingSequence } from './printing';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, isPluginAvailable: () => false }, registerPlugin: () => ({}) }));
afterEach(() => vi.unstubAllGlobals());

describe('explicit packing-sequence printing', () => {
  it('does not print a different screen when the user leaves during preparation', async () => {
    const sequence = { isConnected: true };
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
});
