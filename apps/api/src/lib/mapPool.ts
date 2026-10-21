/**
 * Run `worker` over `items` with at most `concurrency` in flight; the results keep `items`' order.
 *
 * Moved out of `hereGeocode.ts` (where it bounded HERE geocoding) on 2026-10-21 when the roadside reads
 * needed the same thing for their `.in()` chunks (PLATFORM-RELIABILITY-PLAN D-RLY10): one helper, not a
 * second copy beside it. A worker that throws rejects the whole pool, as `Promise.all` would.
 */
export async function mapPool<T, R>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
    }
  });
  await Promise.all(runners);
  return results;
}
