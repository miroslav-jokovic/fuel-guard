/**
 * A per-key cache of an IN-FLIGHT PROMISE with a short life — the live map board's C3 cache
 * (`modules/livemap/liveMapBoardCache.ts`), lifted here when the dispatch board needed the same thing
 * (PLATFORM-RELIABILITY-PLAN D-RLY4), so the two cannot drift into two sets of semantics.
 *
 * Caching the promise rather than the value gives two wins from one line: callers that arrive while
 * a read is still running COALESCE onto it (a herd of browsers resuming at once costs one read), and
 * callers that arrive after it settles get the cached value until it expires.
 *
 *  · The life is measured from when the read STARTED, so a slow read cannot extend its own life.
 *  · A FAILED read is evicted at once — never replayed to every caller for the rest of its life, which
 *    would turn one upstream blip into an outage. The eviction checks identity, so a slow failure
 *    landing after a newer entry took the slot cannot evict the healthy one.
 *  · ⚠ The key is a TENANCY BOUNDARY whenever the value is tenant data: the API reads with the service
 *    role, which bypasses RLS, so a key without the org in it would serve one carrier another's data.
 *  · ⚠ A cached value is shared between callers and must be treated as immutable.
 *  · Per process. With two replicas each holds its own copy, which costs one extra read per life,
 *    never a wrong answer.
 */
export interface CoalescingCache<V> {
  get(key: string, load: () => Promise<V>, nowMs?: number): Promise<V>;
  /** Drop one key (a write that changed it) or everything (tests). */
  invalidate(key?: string): void;
}

export function createCoalescingCache<V>(ttlMs: number, maxEntries = 500): CoalescingCache<V> {
  const entries = new Map<string, { startedAtMs: number; value: Promise<V> }>();
  return {
    get(key, load, nowMs = Date.now()) {
      const hit = entries.get(key);
      if (hit && nowMs - hit.startedAtMs < ttlMs) return hit.value;
      const value = load();
      const entry = { startedAtMs: nowMs, value };
      // Bounded: keys include a day or a user on some callers, and a long-lived process must not
      // accumulate one entry per key it has ever seen. Oldest-first eviction (Map keeps insert order).
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
      value.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      return value;
    },
    invalidate(key) {
      if (key === undefined) entries.clear();
      else entries.delete(key);
    },
  };
}
