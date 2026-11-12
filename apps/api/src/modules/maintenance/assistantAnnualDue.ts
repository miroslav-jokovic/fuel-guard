import type { SupabaseClient } from "@supabase/supabase-js";
import { INSPECTION_EXPIRY_WARNING_DAYS } from "@silvicom/shared";
import { readAnnualDue } from "./inspections/annualDue.js";

/**
 * The assistant's `annual_inspections_due` tool (F21 R6b, 2026-11-10): which trucks and trailers have
 * their §396.17 annual inspection overdue or due within the warning window, from the Shop worklist's
 * "Annual inspection due" group (`GET /api/maintenance/annual-due`, D-MX2).
 *
 * ── WHY IT CALLS `readAnnualDue` AND NOTHING ELSE ────────────────────────────────────────────────
 * `readAnnualDue` is that route's reader: our own inspection records, cut by `inspectionExpiry`, the
 * one "expiring" definition the roster, the inspection form and the dispatch board share
 * (`INSPECTION_EXPIRY_WARNING_DAYS`). This file splits its rows into overdue and due soon by the
 * reader's own `daysRemaining` and renames fields. It never dates an inspection itself.
 *
 * ── WHAT IS NOT HERE ─────────────────────────────────────────────────────────────────────────────
 * A unit with NO recorded inspection is not on this list (the reader's contract: a roster gap, not a
 * shop job), and FleetPal's own dates are not either (the "Dates FleetPal disagrees on" page). The
 * answer says so, so "nothing due" is never read as "every unit inspected".
 *
 * Gated as its page is: `maintenance: view` (`assistantContract.ts`).
 *
 * ORG-SCOPED: `readAnnualDue`'s roster reads filter `org_id`.
 */

export const ANNUAL_DUE_SOURCE = "Shop worklist (/shop), the Annual inspection due group, from our own inspection records";
export const ANNUAL_DUE_KINDS = ["truck", "trailer"] as const;
export const MAX_ANNUAL_DUE_ROWS = 50;

export interface AssistantAnnualDueInput {
  kind?: unknown;
}

export async function assistantAnnualDue(admin: SupabaseClient, orgId: string, input: AssistantAnnualDueInput, now: Date = new Date()): Promise<unknown> {
  const rows = await readAnnualDue(admin, orgId, now);
  if ("error" in rows) throw new Error(rows.error.message);
  const kind = input.kind === "truck" ? "tractor" : input.kind === "trailer" ? "trailer" : null;
  const units = rows
    .filter((r) => !kind || r.subjectType === kind)
    .map((r) => ({ unit: r.unitNumber, kind: r.subjectType === "tractor" ? "truck" : "trailer", expires_on: r.expiresOn, days_remaining: r.daysRemaining }));
  const overdue = units.filter((u) => u.days_remaining < 0);
  const dueSoon = units.filter((u) => u.days_remaining >= 0);
  return {
    source: ANNUAL_DUE_SOURCE,
    warning_window_days: INSPECTION_EXPIRY_WARNING_DAYS,
    overdue_count: overdue.length,
    due_soon_count: dueSoon.length,
    // The reader's own order: overdue first, then soonest.
    units: units.slice(0, MAX_ANNUAL_DUE_ROWS),
    ...(units.length > MAX_ANNUAL_DUE_ROWS ? { units_note: `${MAX_ANNUAL_DUE_ROWS} of ${units.length} units listed, overdue first.` } : {}),
    not_included:
      "Units with no recorded annual inspection are not on this list, and FleetPal's own dates are not used (the " +
      "'Dates FleetPal disagrees on' page). 'Nothing due' does not mean every unit has been inspected.",
  };
}
