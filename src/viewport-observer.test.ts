import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeNearViewport } from './viewport-observer';

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed: Element[] = [];
  readonly unobserved: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element) { this.observed.push(element); }
  unobserve(element: Element) { this.unobserved.push(element); }
  disconnect() { this.disconnected = true; }
  emit(element: Element, isIntersecting: boolean) {
    this.callback([{ target: element, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

describe('shared viewport observer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeIntersectionObserver.instances = [];
  });

  it('shares observers by margin and releases them after the last listener leaves', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const first = {} as Element, second = {} as Element, third = {} as Element;
    const firstListener = vi.fn(), secondListener = vi.fn(), thirdListener = vi.fn();
    const stopFirst = observeNearViewport(first, firstListener, '700px 0px');
    const stopSecond = observeNearViewport(second, secondListener, '700px 0px');
    const stopThird = observeNearViewport(third, thirdListener, '300px 0px');
    const [wide, narrow] = FakeIntersectionObserver.instances;

    expect(FakeIntersectionObserver.instances).toHaveLength(2);
    expect(wide.options?.rootMargin).toBe('700px 0px');
    wide.emit(first, true);
    wide.emit(second, false);
    expect(firstListener).toHaveBeenCalledWith(true);
    expect(secondListener).toHaveBeenCalledWith(false);
    expect(thirdListener).not.toHaveBeenCalled();

    stopFirst();
    expect(wide.disconnected).toBe(false);
    stopSecond();
    expect(wide.disconnected).toBe(true);
    stopThird();
    expect(narrow.disconnected).toBe(true);
  });

  it('loads content immediately when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const listener = vi.fn();
    const stop = observeNearViewport({} as Element, listener);
    expect(listener).toHaveBeenCalledWith(true);
    expect(stop()).toBeUndefined();
  });
});
