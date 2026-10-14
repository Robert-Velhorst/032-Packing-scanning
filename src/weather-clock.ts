import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let now = Date.now();
let timer: number | undefined;
const unsubscribeNothing = () => {};
const subscribeWithoutWeatherClock = (_listener: () => void) => unsubscribeNothing;

function notify() {
  now = Date.now();
  for (const listener of listeners) listener();
}

function startTimer() {
  if (!listeners.size || timer !== undefined || document.visibilityState !== 'visible') return;
  timer = window.setInterval(notify, 60000);
}

function stopTimer() {
  if (timer === undefined) return;
  window.clearInterval(timer);
  timer = undefined;
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    notify();
    startTimer();
  } else {
    stopTimer();
  }
}

export function subscribeWeatherClock(listener: () => void, enabled = true) {
  if (!enabled) return unsubscribeNothing;
  const wasInactive = listeners.size === 0;
  listeners.add(listener);
  if (wasInactive) {
    now = Date.now();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    startTimer();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stopTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };
}

export function weatherClockSnapshot() {
  return now;
}

export function useWeatherClock(enabled = true) {
  return useSyncExternalStore(enabled ? subscribeWeatherClock : subscribeWithoutWeatherClock, weatherClockSnapshot, weatherClockSnapshot);
}
