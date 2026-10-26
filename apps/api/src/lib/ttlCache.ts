/**
 * A per-process cache of answers that rarely change and are asked on almost every request — the
 * permission checks in front of a route (OFFICE-CHAT-PLAN Q-CHAT14).
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
 * Measured on uat 2026-10-23 (the office chat load test): `GET /api/chat/:id/sync` topped out at about
 * 11 requests a second while the event loop stayed under 60 ms. Requests queued downstream: each
 * one made four PostgREST calls (membership, module entitlement, two surface-access reads) before its
 * single 1.2 ms chat function. With 40 at once the median was 6 s. The membership answer was already
 * cached (membershipCurrent.ts, SP7); the other two were read fresh every time, though they change
 * only when an admin edits a plan or a permission.
 *
 * ── THE RULES EVERY CACHE HERE KEEPS ────────────────────────────────────────────────────────────
 *   · A short life (seconds), so a change made on ANOTHER process — production runs two services
 *     from one railway.json, and `admin-api` writes entitlements — takes effect within that window.
 *   · The writer in THIS process forgets the affected keys, so a change takes effect here at once.
 *   · A failed read is never cached: the caller sees the error and the next request asks again.
 *   · Concurrent misses for one key share one read, so a burst of 300 asks the database once.
 *
 * Every cache registers itself, so a test can start from empty (`resetTtlCaches`, wired into the
 * api's vitest setup) without importing the modules that own them.
 */

const registry = new Set<TtlCache<unknown>>();

export interface TtlCache<V> {
  /** The cached answer for `key`, or `load()`'s, cached for the cache's life. */
  get(key: string, load: () => Promise<V>, now?: number): Promise<V>;
  /** Drop every key for which `match` is true. */
  forget(match: (key: string) => boolean): void;
  clear(): void;
}

export function createTtlCache<V>(ttlMs: number): TtlCache<V> {
  const values = new Map<string, { value: V; until: number }>();
  const inflight = new Map<string, Promise<V>>();
  // Bumped by `forget`/`clear`, so a read that started before a write cannot store its stale answer.
  let epoch = 0;

  const cache: TtlCache<V> = {
    async get(key, load, now = Date.now()) {
      const hit = values.get(key);
      if (hit && hit.until > now) return hit.value;
      const pending = inflight.get(key);
      if (pending) return pending;
      const started = epoch;
      const p = load().then(
        (value) => {
          if (started === epoch) values.set(key, { value, until: Date.now() + ttlMs });
          return value;
        },
      ).finally(() => {
        if (inflight.get(key) === p) inflight.delete(key);
      });
      inflight.set(key, p);
      return p;
    },
    forget(match) {
      epoch++;
      for (const k of [...values.keys()]) if (match(k)) values.delete(k);
      for (const k of [...inflight.keys()]) if (match(k)) inflight.delete(k);
    },
    clear() {
      epoch++;
      values.clear();
      inflight.clear();
    },
  };
  registry.add(cache as TtlCache<unknown>);
  return cache;
}

/** Empty every cache in this process. Tests; never a request path. */
export function resetTtlCaches(): void {
  for (const c of registry) c.clear();
}
