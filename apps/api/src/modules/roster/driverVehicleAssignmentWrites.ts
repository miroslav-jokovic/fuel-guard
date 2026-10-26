import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignmentInterval } from "@silvicom/shared";

/**
 * Keep Samsara's driver↔vehicle segments in `driver_vehicle_assignments` — the history the Dispatch
 * board's History tab, idle attribution and a team truck's second driver all read.
 *
 * ── WHY EVERY FAILURE IS LOGGED (2026-10-21) ────────────────────────────────────────────────────
 * The 12-hour identity pass ran three times on 2026-10-21 (`[vehicle-sync]` lines at 06:46, 13:33 and
 * 20:23Z) and yet no run had refreshed the 30-day history since 2026-10-20 06:00Z: on 10/17–10/19 each
 * run stamped 800–1,235 rows, after it at most 362. Nothing said why. A supabase-js write does not
 * throw, it RETURNS `{ error }`, and this loop never read it — so a refused batch looked exactly like a
 * written one, and the surrounding `catch` only ever saw the fetch. The result is now counted, and a
 * pass that lost rows says how many, with the database's own words.
 *
 * `duplicateKeys` is in the log because it is the first suspect, not a conclusion. One upsert may not
 * name the same conflict key twice (Postgres 21000, "cannot affect row a second time"), and a 30-day
 * read that takes minutes to page can see a segment on two pages. If the log shows it, the fix is
 * known; if it shows zero, it has been ruled out by the run rather than by a guess.
 */
export interface HistoryWrite {
  rows: number;
  written: number;
  failedBatches: number;
  duplicateKeys: number;
  firstError: string | null;
}

const BATCH = 500;

export async function writeAssignmentHistory(
  admin: SupabaseClient,
  orgId: string,
  intervals: readonly AssignmentInterval[],
): Promise<HistoryWrite> {
  const now = new Date().toISOString();
  const arows = intervals.map((iv) => ({
    org_id: orgId,
    vehicle_samsara_id: iv.vehicleSamsaraId,
    driver_samsara_id: iv.driverSamsaraId,
    start_at: new Date(iv.startMs).toISOString(),
    end_at: iv.endMs != null ? new Date(iv.endMs).toISOString() : null,
    updated_at: now,
  }));
  const keys = new Set(arows.map((r) => `${r.vehicle_samsara_id}|${r.driver_samsara_id}|${r.start_at}`));
  const out: HistoryWrite = { rows: arows.length, written: 0, failedBatches: 0, duplicateKeys: arows.length - keys.size, firstError: null };

  for (let i = 0; i < arows.length; i += BATCH) {
    const batch = arows.slice(i, i + BATCH);
    const { error } = await admin.from("driver_vehicle_assignments").upsert(batch, {
      onConflict: "org_id,vehicle_samsara_id,driver_samsara_id,start_at",
    });
    if (error) {
      out.failedBatches++;
      out.firstError ??= [error.code, error.message].filter(Boolean).join(" ");
    } else {
      out.written += batch.length;
    }
  }

  if (out.failedBatches > 0) {
    console.error(
      `[vehicle-sync] assignment history for org ${orgId}: wrote ${out.written} of ${out.rows} rows; ` +
        `${out.failedBatches} batch(es) refused (${out.duplicateKeys} duplicate key(s) in the read) — first: ${out.firstError}`,
    );
  }
  return out;
}
