import { describe, expect, it } from 'vitest';
import {
  MAX_ATTEMPTS,
  countNeedsAttention,
  countPending,
  isEligible,
  isTransient,
  nextAttemptDelayMs,
  outcomeAfterFailure,
  pickNext,
  type OutboxRecord,
} from './policy';

function rec(over: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    id: 'r1',
    kind: 'test',
    payload: {},
    fileUris: [],
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 1000,
    lastError: null,
    ...over,
  };
}

describe('backoff', () => {
  it('grows exponentially and caps at 5 minutes', () => {
    const mid = () => 0.5; // no jitter
    expect(nextAttemptDelayMs(1, mid)).toBe(2000);
    expect(nextAttemptDelayMs(2, mid)).toBe(4000);
    expect(nextAttemptDelayMs(3, mid)).toBe(8000);
    expect(nextAttemptDelayMs(20, mid)).toBe(300_000);
  });

  it('applies ±25% jitter so a fleet does not retry in lockstep', () => {
    expect(nextAttemptDelayMs(3, () => 0)).toBe(6000); // 8000 * 0.75
    expect(nextAttemptDelayMs(3, () => 1)).toBe(10_000); // 8000 * 1.25
  });

  it('never returns a negative or zero delay', () => {
    for (let a = 1; a <= 12; a++) {
      expect(nextAttemptDelayMs(a, () => 0)).toBeGreaterThan(0);
    }
  });
});

describe('error classification', () => {
  it('treats offline/timeout/throttle/server errors as transient', () => {
    for (const s of [undefined, null, 0, 408, 425, 429, 500, 502, 503]) {
      expect(isTransient(s)).toBe(true);
    }
  });

  it('treats client errors as permanent', () => {
    for (const s of [400, 401, 403, 404, 409, 422]) {
      expect(isTransient(s)).toBe(false);
    }
  });
});

describe('outcomeAfterFailure', () => {
  it('schedules a retry for a transient failure', () => {
    const out = outcomeAfterFailure(rec(), 503, 'server error', 10_000, () => 0.5);
    expect(out.status).toBe('failed');
    expect(out.attempts).toBe(1);
    expect(out.nextAttemptAt).toBe(12_000);
  });

  it('dead-letters a permanent failure immediately — no pointless retries', () => {
    const out = outcomeAfterFailure(rec(), 422, 'validation failed', 10_000);
    expect(out.status).toBe('dead');
    expect(out.attempts).toBe(1);
  });

  it('dead-letters once attempts are exhausted', () => {
    const out = outcomeAfterFailure(rec({ attempts: MAX_ATTEMPTS - 1 }), 500, 'boom', 10_000);
    expect(out.status).toBe('dead');
    expect(out.attempts).toBe(MAX_ATTEMPTS);
  });

  it('keeps the error message for the needs-attention list (never silently drops work)', () => {
    expect(outcomeAfterFailure(rec(), 422, 'bad vehicle', 1).lastError).toBe('bad vehicle');
  });
});

describe('eligibility & ordering', () => {
  it('excludes done, dead, and in-flight records', () => {
    expect(isEligible(rec({ status: 'done' }), 5000)).toBe(false);
    expect(isEligible(rec({ status: 'dead' }), 5000)).toBe(false);
    expect(isEligible(rec({ status: 'in_flight' }), 5000)).toBe(false);
    expect(isEligible(rec({ status: 'pending' }), 5000)).toBe(true);
    expect(isEligible(rec({ status: 'failed' }), 5000)).toBe(true);
  });

  it('respects the backoff window', () => {
    const r = rec({ status: 'failed', nextAttemptAt: 9000 });
    expect(isEligible(r, 8999)).toBe(false);
    expect(isEligible(r, 9000)).toBe(true);
  });

  it('picks the oldest eligible record so work syncs in the order it happened', () => {
    const a = rec({ id: 'a', createdAt: 300 });
    const b = rec({ id: 'b', createdAt: 100 });
    const c = rec({ id: 'c', createdAt: 200, status: 'in_flight' });
    expect(pickNext([a, b, c], 1000)?.id).toBe('b');
  });

  it('returns null when everything is backed off or finished', () => {
    expect(pickNext([rec({ status: 'done' }), rec({ nextAttemptAt: 99_999 })], 1000)).toBeNull();
  });
});

describe('counters surfaced to the driver', () => {
  const set = [
    rec({ id: '1', status: 'pending' }),
    rec({ id: '2', status: 'failed' }),
    rec({ id: '3', status: 'in_flight' }),
    rec({ id: '4', status: 'done' }),
    rec({ id: '5', status: 'dead' }),
  ];

  it('counts unfinished work as pending (done and dead excluded)', () => {
    expect(countPending(set)).toBe(3);
  });

  it('counts dead-lettered work as needing attention', () => {
    expect(countNeedsAttention(set)).toBe(1);
  });
});

describe('idempotency contract', () => {
  it('a replayed record keeps the same id — the server upsert key', () => {
    // The engine never regenerates ids on retry: the client UUID is the domain row's PK, so a
    // duplicate delivery collides and no-ops instead of double-writing (plan §13.3.2).
    const original = rec({ id: 'fixed-uuid', attempts: 0 });
    const afterFailure = {
      ...original,
      ...outcomeAfterFailure(original, 500, 'timeout', 1000, () => 0.5),
    };
    expect(afterFailure.id).toBe(original.id);
    expect(afterFailure.attempts).toBe(1);
  });
});
