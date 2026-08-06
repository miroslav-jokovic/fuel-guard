/** P1 (2026-08 audit) — deterministic fallback timestamps for GLOBAL snapshot ingests.
 *
 * The posted-price fetchers run per process with no cross-replica lock; when a source provides no
 * timestamp of its own, stamping `new Date()` meant two replicas fetching the same public page wrote
 * two different observed_at values — rows the snapshot unique key (uq_fpp_snapshot, 0125) can never
 * collapse. Bucketing the fallback to the HOUR makes near-simultaneous fetches byte-identical, so
 * the second replica's rows dedupe away instead of stacking into the cost_outlier market median.
 * Source-provided timestamps are always preferred and never bucketed.
 */
export function hourBucketIso(date: Date = new Date()): string {
  const d = new Date(date.getTime());
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}
