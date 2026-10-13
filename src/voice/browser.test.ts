import { describe, expect, it, vi } from 'vitest';
import { browserVoiceDriver, type RecognitionConstructor } from './browser';

describe('browser local recognition gate', () => {
  it('does not instantiate a recognizer or use a remote-only browser', async () => {
    const constructor = vi.fn();
    const driver = browserVoiceDriver(constructor as unknown as RecognitionConstructor);
    expect((await driver.availability()).available).toBe(false); expect(constructor).not.toHaveBeenCalled();
    expect(() => driver.listen({ ready: vi.fn(), result: vi.fn(), error: vi.fn(), end: vi.fn() })).toThrow();
    expect(constructor).not.toHaveBeenCalled();
  });

  it('checks only local English availability and never downloads automatically', async () => {
    const constructor = Object.assign(vi.fn(), { available: vi.fn(async () => 'downloadable'), install: vi.fn(async () => true) });
    constructor.prototype.processLocally = false;
    const driver = browserVoiceDriver(constructor as unknown as RecognitionConstructor);
    expect(await driver.availability()).toMatchObject({ available: false, downloadable: true });
    expect(constructor.available).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true });
    expect(constructor).not.toHaveBeenCalled(); expect(constructor.install).not.toHaveBeenCalled();
    await driver.install!(); expect(constructor.install).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true });
  });

  it('requires the real local-recognition flag before requesting microphone input and aborts without callbacks', () => {
    const instance = { processLocally: false, lang: '', continuous: true, interimResults: true, maxAlternatives: 5,
      start: vi.fn(), abort: vi.fn(), onstart: null, onend: null, onresult: null, onerror: null };
    const constructor = Object.assign(vi.fn(function() { return instance; }), { available: vi.fn(async () => 'available') });
    constructor.prototype.processLocally = false;
    const driver = browserVoiceDriver(constructor as unknown as RecognitionConstructor);
    const result = driver.listen({ ready: vi.fn(), result: vi.fn(), error: vi.fn(), end: vi.fn() });
    expect(instance).toMatchObject({ processLocally: true, lang: 'en-US', continuous: false, interimResults: false, maxAlternatives: 1 });
    expect(instance.start).toHaveBeenCalledOnce(); result.abort();
    expect(instance.abort).toHaveBeenCalledOnce(); expect(instance.onresult).toBeNull(); expect(instance.onerror).toBeNull();
  });
});
