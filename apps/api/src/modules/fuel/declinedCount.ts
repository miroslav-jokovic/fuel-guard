/**
 * How many card attempts EFS refused in a range of reject days — asked here, where the table lives
 * (queue item 5, §7.2b of `docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md`).
 *
 * ── WHY THE DASHBOARD CANNOT COUNT THIS ITSELF ─────────────────────────────────────────────────
 * `declined_transactions` is `layer: raw` in `scripts/table-modules.json`, sealed to this module by
 * `check-table-access.mjs`. Migration 0347 originally counted declines in SQL and `lint:boundaries`
 * refused it: every one of the 24 existing `raw-access-waiver` lines is an owner acting on its own
 * table, and a foreign reader taking a shortcut would have been the first of a new kind. So the
 * dashboard endpoint asks through this module's index instead — which is why §7.1's "ten reads
 * become one" is honestly "ten become two".
 *
 * ── AND WHY THE WINDOW IS COMPUTED RATHER THAN STORED ──────────────────────────────────────────
 * EFS prints reject times in CENTRAL whatever the station's own zone is, so a decline's business day
 * is a pure computation over one fixed zone — `efsRejectDayWindow`, the same derivation the
 * Rejections page filters with, so the tile and the page it links to count the same set. A fill's
 * day varies by station and needed a stored column (0287); a decline's does not.
 *
 * ⚠ `head: true` — this is a COUNT. No rows cross the wire.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { efsRejectDayWindow, type CalendarDay } from "@silvicom/shared";

export async function countDeclinedAttempts(
  admin: SupabaseClient,
  orgId: string,
  fromDay: CalendarDay,
  toDay: CalendarDay,
): Promise<number> {
  const window = efsRejectDayWindow(fromDay, toDay);
  const { count, error } = await admin
    .from("declined_transactions")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .gte("declined_at", window.gte)
    .lt("declined_at", window.lt);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
