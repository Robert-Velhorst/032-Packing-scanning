import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeVoiceDriver } from './native';
import type { VoiceCallbacks } from './session';

type Event = { id: string; kind: string; transcript?: string; confidence?: number };
const bridge = vi.hoisted(() => ({
  available: true, callback: undefined as ((event: Event) => void) | undefined,
  remove: vi.fn(), listen: vi.fn(), stop: vi.fn(),
  addListener: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isPluginAvailable: () => bridge.available },
  registerPlugin: () => bridge,
}));
function setup() {
  bridge.listen.mockResolvedValue(undefined); bridge.stop.mockResolvedValue(undefined);
  bridge.addListener.mockImplementation(async (_: string, callback: (event: Event) => void) => {
    bridge.callback = callback; return { remove: bridge.remove };
  });
  const callbacks: VoiceCallbacks = { ready: vi.fn(), result: vi.fn(), error: vi.fn(), end: vi.fn() };
  return callbacks;
}
afterEach(() => { vi.resetAllMocks(); bridge.available = true; bridge.callback = undefined; });

describe('native voice bridge session authority', () => {
  it('does not expose a native driver when the plugin is absent', () => {
    bridge.available = false;
    expect(nativeVoiceDriver()).toBeUndefined();
  });
  it('filters another session and defaults missing confidence to refusal', async () => {
    const callbacks = setup();
    const session = nativeVoiceDriver()!.listen(callbacks);
    await session.started;
    const id = bridge.listen.mock.calls[0][0].id;
    bridge.callback!({ id: 'another-session', kind: 'result', transcript: 'Packing packed', confidence: 1 });
    expect(callbacks.result).not.toHaveBeenCalled();
    bridge.callback!({ id, kind: 'result', transcript: 'Packing packed' });
    expect(callbacks.result).toHaveBeenCalledExactlyOnceWith({ transcript: 'Packing packed', confidence: 0, final: true });
    session.abort();
  });
  it('discards even a matching final result after abort and removes its listener', async () => {
    const callbacks = setup();
    const session = nativeVoiceDriver()!.listen(callbacks);
    await session.started;
    const id = bridge.listen.mock.calls[0][0].id;
    session.abort();
    bridge.callback!({ id, kind: 'result', transcript: 'Packing packed', confidence: 1 });
    expect(callbacks.result).not.toHaveBeenCalled();
    expect(bridge.remove).toHaveBeenCalledOnce();
    expect(bridge.stop).toHaveBeenCalledWith({ id });
  });
  it('does not start listening when cancelled before listener setup finishes', async () => {
    const callbacks = setup();
    let ready!: (value: { remove: typeof bridge.remove }) => void;
    bridge.addListener.mockImplementation(() => new Promise((resolve) => { ready = resolve; }));
    const session = nativeVoiceDriver()!.listen(callbacks);
    session.abort(); ready({ remove: bridge.remove });
    await session.started;
    expect(bridge.listen).not.toHaveBeenCalled();
    expect(bridge.remove).toHaveBeenCalledOnce();
  });
  it('stops again if a pending native start resolves after cancellation', async () => {
    const callbacks = setup();
    let started!: () => void;
    bridge.listen.mockImplementation(() => new Promise<void>((resolve) => { started = resolve; }));
    const session = nativeVoiceDriver()!.listen(callbacks);
    await vi.waitFor(() => expect(bridge.listen).toHaveBeenCalledOnce());
    session.abort(); started(); await session.started;
    expect(bridge.stop).toHaveBeenCalledTimes(2);
    expect(bridge.stop.mock.calls[0][0]).toEqual(bridge.stop.mock.calls[1][0]);
  });
  it('cleans up a rejected native start without leaking a callback listener', async () => {
    const callbacks = setup();
    bridge.listen.mockRejectedValue(new Error('Microphone permission refused.'));
    const session = nativeVoiceDriver()!.listen(callbacks);
    await expect(session.started).rejects.toThrow('Microphone permission refused.');
    expect(bridge.remove).toHaveBeenCalledOnce();
    const id = bridge.listen.mock.calls[0][0].id;
    bridge.callback!({ id, kind: 'result', transcript: 'Packing packed', confidence: 1 });
    expect(callbacks.result).not.toHaveBeenCalled();
  });
});
