type ViewportListener = (isNearViewport: boolean) => void;

interface ObserverGroup {
  observer: IntersectionObserver;
  listeners: Map<Element, ViewportListener>;
}

const groups = new Map<string, ObserverGroup>();

/** Share one observer for elements using the same viewport margin. */
export function observeNearViewport(element: Element, listener: ViewportListener, rootMargin = '600px 0px') {
  if (typeof IntersectionObserver === 'undefined') {
    listener(true);
    return () => undefined;
  }

  let group = groups.get(rootMargin);
  if (!group) {
    const listeners = new Map<Element, ViewportListener>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
    }, { rootMargin });
    group = { observer, listeners };
    groups.set(rootMargin, group);
  }
  group.listeners.set(element, listener);
  group.observer.observe(element);

  return () => {
    const current = groups.get(rootMargin);
    if (current !== group) return;
    current.listeners.delete(element);
    current.observer.unobserve(element);
    if (!current.listeners.size) {
      current.observer.disconnect();
      groups.delete(rootMargin);
    }
  };
}
