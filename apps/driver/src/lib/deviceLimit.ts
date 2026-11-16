import { useSyncExternalStore } from 'react';

/**
 * "This phone is a fourth device" (INSTALLED-APP-PLAN IA-S6; the owner's ruling Q-IA14 (b), 2026-11-16).
 *
 * The API refuses every request from a device that does not hold one of the account's three places with 403
 * `device_limit`, until the person signs another device out. `apiFetch` sets this the moment it sees that answer
 * and clears it on the next answer that is not a refusal, and three things read it:
 *
 *   · the root guard, which shows the device-limit screen instead of the app;
 *   · the outbox, which must NOT treat the refusal as a rejection of the driver's work. A 403 is otherwise
 *     permanent and dead-letters at once — every queued stop, photo and message would have gone to "needs
 *     attention" for a reason that has nothing to do with them. While this is set, a failed record is put back
 *     untouched, the way a 429 is (`outcomeWhileDeviceLimited`);
 *   · the screen itself, to leave once a place is free.
 *
 * A separate module, not React state, because `apiFetch` and the outbox run outside React.
 */
type Listener = () => void;
let limited = false;
const listeners = new Set<Listener>();

function set(next: boolean): void {
  if (limited === next) return;
  limited = next;
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.warn('[deviceLimit] listener failed:', e instanceof Error ? e.message : e);
    }
  }
}

export const markDeviceLimited = (): void => set(true);
export const clearDeviceLimited = (): void => set(false);
export const isDeviceLimited = (): boolean => limited;

export function onDeviceLimitChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** For React: whether this phone is currently stopped as a fourth device. */
export function useDeviceLimited(): boolean {
  return useSyncExternalStore(onDeviceLimitChange, isDeviceLimited, isDeviceLimited);
}
