import type { SupabaseClient } from "@supabase/supabase-js";
import {
  coverageFromBuckets,
  type TelematicsCoverageBucket,
  type TelematicsCoverageSummary,
} from "@silvicom/shared";

/**
 * How much of this carrier's fuel history the collector has actually corroborated (SAM-S4, D-SAM7).
 *
 * ⚠ ALL-TIME, and that is the entire point. The Coverage page computes the same idea over its 90-day
 * window and reads ~95%, while 76.8% of the carrier's history had never had telematics fetched at all
 * (SAMSARA-COLLECTION-PLAN §0.3). Both were correct; one was useless. A coverage figure whose scope
 * hides the gap converts an unanswered question into a reassuring answer, which is worse than showing
 * nothing — so this one has no window and cannot be given one.
 *
 * ── IT USED TO PAGE THE WHOLE HISTORY, AND THAT IS WHY D-SAM7 WAS STUCK (Q-SAM8, 2026-09-05) ─────
 * This function read `fuel_transactions` 1,000 rows at a time in a sequential loop and handed every
 * row to `computeTelematicsCoverage`. Measured in production: **16 round trips over 15,948 rows**,
 * growing by about one more every two weeks. Its own header called that acceptable because it served
 * "a settings diagnostic that a person opens occasionally — not from a hot path" — which was true,
 * and which is exactly why S5's fourth bullet could not put the figure on the Dashboard, where every
 * authenticated member lands. The blocker was never the permission Q-SAM7 described.
 *
 * `telematics_coverage_buckets()` (migration 0322) counts in the database instead: one round trip,
 * returning a histogram of RAW column states bounded by months × 2 × statuses rather than by row
 * count — 22 cells for 2,400 fills in the matrix. `MAX_PAGES`, the page loop and `truncated` are all
 * gone with it, because the condition `truncated` reported cannot arise any more.
 *
 * ── THE VERDICT DID NOT MOVE INTO SQL, AND THAT WAS THE WHOLE DIFFICULTY ─────────────────────────
 * Q-SAM7 rejected recomputing this in the browser because a second implementation of the three-state
 * predicate is a second source of truth with a delay fuse; expressing it in SQL would be the same
 * mistake with a different accent. So the aggregate names no bucket, and `coverageFromBuckets` — the
 * same function the row-based `computeTelematicsCoverage` runs — is still the only place a column
 * state becomes pending, no-data or reconciled. The two are held together by
 * `agrees with itself whether it counted the rows or was handed the counts` and, across the language
 * boundary, by the `telematics-coverage-buckets` matrix.
 *
 * ── ORG SCOPE ───────────────────────────────────────────────────────────────────────────────────
 * `admin` is the SERVICE ROLE, which has `bypassrls`, so the function's `security invoker` gives this
 * caller no tenant boundary at all — `p_org` is the boundary, and passing it is this function's own
 * responsibility exactly as the `.eq("org_id", …)` it replaces was. ⚠ `expectOrgScoped` cannot see
 * it: that helper skips `rpc:` queries by construction, so the test asserts the ARGUMENT instead.
 * An assertion that silently started passing for everything is worse than no assertion.
 */
export type TelematicsCoverageResult = TelematicsCoverageSummary;

export async function readTelematicsCoverage(
  admin: SupabaseClient,
  orgId: string,
): Promise<TelematicsCoverageResult> {
  const { data, error } = await admin.rpc("telematics_coverage_buckets", { p_org: orgId });
  if (error) throw new Error(error.message);
  // `fills` is `int` on the wire and arrives as a number, but it is coerced rather than trusted: a
  // string would propagate as a silent NaN through every percentage below, and a NaN renders as "—"
  // rather than as an error.
  const buckets = ((data ?? []) as TelematicsCoverageBucket[]).map((b) => ({
    ...b,
    fills: Number(b.fills),
  }));
  return coverageFromBuckets(buckets);
}
