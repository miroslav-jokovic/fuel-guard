/**
 * Outbox retry policy — PURE functions, no native imports, so the rules that protect a driver's
 * unsynced work are unit-testable (plan §13.7). The SQLite layer (outbox.ts) and the engine
 * (sync.ts) both defer to these.
 */

export type OutboxStatus = 'pending' | 'in_flight' | 'failed' | 'dead' | 'done';

export interface OutboxRecord {
  /** Client-generated UUID. For a domain row this IS its primary key — the basis of idempotency. */
  id: string;
  kind: string;
  payload: unknown;
  /** Local file URIs staged for upload (receipt/stop photos). Deleted only after a confirmed sync. */
  fileUris: string[];
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  lastError: string | null;
}

/** After this many failed attempts a record stops retrying and waits for a human (never discarded). */
export const MAX_ATTEMPTS = 8;

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60 * 1000;

/**
 * Exponential backoff with ±25% jitter, capped at 5 minutes. Jitter matters: without it, every
 * queued record on every phone in the fleet retries in lockstep the instant a tower comes back
 * (thundering herd — plan §13.8).
 */
export function nextAttemptDelayMs(attempts: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attempts - 1);
  const raw = Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS);
  const jitter = 1 + (random() - 0.5) * 0.5; // 0.75 … 1.25
  return Math.round(raw * jitter);
}

/** A 4xx will not fix itself; network errors, timeouts, throttling and 5xx will. */
export function isTransient(status: number | undefined | null): boolean {
  if (status === undefined || status === null || status === 0) return true; // offline / timeout
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500;
}

/** Records the engine may pick up right now. `in_flight` is excluded (already owned by a run). */
export function isEligible(rec: OutboxRecord, now: number): boolean {
  if (rec.status === 'done' || rec.status === 'dead' || rec.status === 'in_flight') return false;
  return rec.nextAttemptAt <= now;
}

/** Oldest-first so a driver's work syncs in the order it happened. */
export function pickNext(records: readonly OutboxRecord[], now: number): OutboxRecord | null {
  let best: OutboxRecord | null = null;
  for (const rec of records) {
    if (!isEligible(rec, now)) continue;
    if (!best || rec.createdAt < best.createdAt) best = rec;
  }
  return best;
}

export interface FailureOutcome {
  status: Extract<OutboxStatus, 'failed' | 'dead'>;
  attempts: number;
  nextAttemptAt: number;
  lastError: string;
}

/**
 * What happens to a record after a failed attempt.
 *  - transient  → `failed`, retried after a jittered backoff (until MAX_ATTEMPTS)
 *  - permanent  → `dead` immediately (a 422 will never succeed; surface it for manual review)
 *  - exhausted  → `dead` (stop burning battery; the record still exists and is never dropped)
 */
export function outcomeAfterFailure(
  rec: OutboxRecord,
  httpStatus: number | undefined | null,
  message: string,
  now: number,
  random: () => number = Math.random,
): FailureOutcome {
  const attempts = rec.attempts + 1;
  const transient = isTransient(httpStatus);
  if (!transient || attempts >= MAX_ATTEMPTS) {
    return { status: 'dead', attempts, nextAttemptAt: now, lastError: message };
  }
  return {
    status: 'failed',
    attempts,
    nextAttemptAt: now + nextAttemptDelayMs(attempts, random),
    lastError: message,
  };
}

/** Records the driver should be told about ("2 pending", "1 needs attention"). */
export function countPending(records: readonly OutboxRecord[]): number {
  return records.filter((r) => r.status !== 'done' && r.status !== 'dead').length;
}

export function countNeedsAttention(records: readonly OutboxRecord[]): number {
  return records.filter((r) => r.status === 'dead').length;
}
