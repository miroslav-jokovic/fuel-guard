/**
 * "Something was just queued" — the trigger DRIVER-APP-PLAN §13.3 lists first ("on successful
 * enqueue") and the sync engine never had.
 *
 * Found 2026-10-20 (PLATFORM-RELIABILITY-PLAN D-RLY7): `enqueue()` wrote the record and returned, and
 * nothing woke the engine. Its other triggers are reconnect, foreground, a manual tap, and a 60-second
 * tick that fires only while the in-memory pending count is above zero — and that count was refreshed
 * only by a sync run. So a load accepted, a shift started or a message sent WHILE ONLINE sat on the
 * phone until the driver next switched apps or lost signal, and the badge said nothing was waiting.
 *
 * A separate module so the queue (outbox.ts) does not import the engine (sync.ts imports the queue),
 * and so the signal is testable without React Native. One listener in practice: `initSync`'s.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe; returns the unsubscribe. */
export function onEnqueued(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Called by `enqueue` once the record is durable. A listener's failure never fails the enqueue. */
export function notifyEnqueued(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.warn('[outbox] enqueue listener failed:', e instanceof Error ? e.message : e);
    }
  }
}
