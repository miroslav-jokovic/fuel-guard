import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeTelematicsCoverage,
  type TelematicsCoverageInput,
  type TelematicsCoverageSummary,
} from "@silvicom/shared";

/**
 * Rows per round trip. PostgREST caps a response anyway, and this figure is read from a settings
 * diagnostic that a person opens occasionally — not from a hot path — so a handful of round trips
 * against the service role is the right trade for not adding a migration.
 */
const PAGE = 1000;

/**
 * Hard stop on paging, so a table that grows unexpectedly cannot turn one page view into an
 * unbounded scan. 60 pages is 60,000 fills against a carrier that holds ~14,500 after eight months —
 * years of headroom, and it terminates. Exceeding it is reported, never silently truncated.
 */
const MAX_PAGES = 60;

export interface TelematicsCoverageResult extends TelematicsCoverageSummary {
  /** True when MAX_PAGES stopped the read — the figure is then a floor, and the surface says so. */
  truncated: boolean;
}

/**
 * How much of this carrier's fuel history the collector has actually corroborated (SAM-S4, D-SAM7).
 *
 * ⚠ ALL-TIME, and that is the entire point. The Coverage page computes the same idea over its 90-day
 * window and reads ~95%, while 76.8% of the carrier's history had never had telematics fetched at all
 * (SAMSARA-COLLECTION-PLAN §0.3). Both were correct; one was useless. A coverage figure whose scope
 * hides the gap converts an unanswered question into a reassuring answer, which is worse than showing
 * nothing — so this one has no window and cannot be given one.
 *
 * Reads with the SERVICE ROLE, which bypasses RLS, so the org filter is this function's own
 * responsibility and is asserted by `expectOrgScoped` in the test.
 */
export async function readTelematicsCoverage(
  admin: SupabaseClient,
  orgId: string,
): Promise<TelematicsCoverageResult> {
  const rows: TelematicsCoverageInput[] = [];
  let truncated = true;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin
      .from("fuel_transactions")
      .select("fueled_at, samsara_recon_status, samsara_recon_at")
      .eq("org_id", orgId)
      // A fill with no truck was never a candidate for per-fill telematics — it has nothing to fetch
      // history FOR — so counting it as an uncovered fill would report a fleet-mapping problem as a
      // collection problem, and no amount of collecting would ever move the number.
      .not("vehicle_id", "is", null)
      .order("fueled_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as TelematicsCoverageInput[];
    rows.push(...batch);
    if (batch.length < PAGE) {
      truncated = false;
      break;
    }
  }

  return { ...computeTelematicsCoverage(rows), truncated };
}
