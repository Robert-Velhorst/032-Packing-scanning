import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { subscribeWeatherClock, useWeatherClock, weatherClockSnapshot } from './weather-clock';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared weather clock', () => {
  it('renders its external-store snapshot with the React-compatible runtime', () => {
    const Clock = () => h('time', null, useWeatherClock(false));

    expect(renderToString(h(Clock, {}))).toBe(`<time>${weatherClockSnapshot()}</time>`);
  });

  it('does not install a timer or visibility listener when weather does not need freshness', () => {
    vi.useFakeTimers();
    const handlers = new Map<string, EventListenerOrEventListenerObject>();
    const documentStub = {
      visibilityState: 'visible',
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => handlers.set(type, listener),
      removeEventListener: (type: string) => handlers.delete(type),
    } as unknown as Document;
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', { setInterval, clearInterval } as unknown as Window);

    const listener = vi.fn();
    const unsubscribe = subscribeWeatherClock(listener, false);
    expect(vi.getTimerCount()).toBe(0);
    expect(handlers.has('visibilitychange')).toBe(false);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it('uses one foreground timer and refreshes immediately when the app returns', async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'visible';
    const handlers = new Map<string, EventListenerOrEventListenerObject>();
    const documentStub = {
      get visibilityState() { return visibility; },
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => handlers.set(type, listener),
      removeEventListener: (type: string) => handlers.delete(type),
    } as unknown as Document;
    const windowStub = { setInterval, clearInterval } as unknown as Window;
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', windowStub);

    const first = vi.fn(), second = vi.fn();
    const unsubscribeFirst = subscribeWeatherClock(first);
    const unsubscribeSecond = subscribeWeatherClock(second);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(60000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    visibility = 'hidden';
    const onVisibilityChange = handlers.get('visibilitychange');
    if (typeof onVisibilityChange === 'function') onVisibilityChange(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    if (typeof onVisibilityChange === 'function') onVisibilityChange(new Event('visibilitychange'));
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    unsubscribeFirst();
    unsubscribeSecond();
    expect(vi.getTimerCount()).toBe(0);
    expect(handlers.has('visibilitychange')).toBe(false);
  });

  it('does not start a timer while initially hidden', () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'hidden';
    const handlers = new Map<string, EventListenerOrEventListenerObject>();
    const documentStub = {
      get visibilityState() { return visibility; },
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => handlers.set(type, listener),
      removeEventListener: (type: string) => handlers.delete(type),
    } as unknown as Document;
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', { setInterval, clearInterval } as unknown as Window);

    const listener = vi.fn();
    const unsubscribe = subscribeWeatherClock(listener);
    expect(vi.getTimerCount()).toBe(0);
    visibility = 'visible';
    const onVisibilityChange = handlers.get('visibilitychange');
    if (typeof onVisibilityChange === 'function') onVisibilityChange(new Event('visibilitychange'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });
});
