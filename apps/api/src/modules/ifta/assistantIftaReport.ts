import type { SupabaseClient } from "@supabase/supabase-js";
import { ledgerPosition, milesFromMeters, organizationTimezone, tieOutMiles, todayInZone } from "@silvicom/shared";
import { readIftaPeriod } from "./periodReads.js";

/**
 * The assistant's `ifta_report` tool (F21 R6b, 2026-11-10): the IFTA ledger page (`/ifta`), asked in
 * words ("IFTA by state last quarter", "what do we owe Texas for Q3").
 *
 * ── WHY IT CALLS `readIftaPeriod` AND `ledgerPosition` AND NOTHING ELSE ──────────────────────────
 * `GET /api/ifta/period` is `readIftaPeriod` (the 0256 RPCs plus McLeod's hand-keyed receipts), and the
 * page turns those rows into its figures with `ledgerPosition` from `@silvicom/shared` — the one join
 * the return export also calls, so "what the page says" has one answer (IP9). The tie-out is the page
 * hook's `tieOutMiles` over the same three inputs. This file asks the same read for the same quarter,
 * runs the same two shared functions, and renames fields. It never sums an IFTA figure itself, except
 * Samsara's taxable miles across states, which is exactly the page's `samsaraMiles` input.
 *
 * ── WHAT CAN MAKE A QUARTER INCOMPLETE (the page's own footnote) ─────────────────────────────────
 * Samsara serves a month's IFTA only once it has finished processing it (#1333), so a quarter in
 * progress has fewer than three months; a month can also be provisional. Jurisdictions the tax table
 * cannot price are named, never taxed at zero. The fleet MPG every liability rests on carries the
 * page's verdict. Each of these goes into the answer, so a figure is never read as final when the
 * page would not call it so.
 *
 * Gated as its page is: `fuel: view` (`assistantContract.ts`). No module gate: the IFTA router has none.
 *
 * ORG-SCOPED: `readIftaPeriod` passes `p_org` to both RPCs and filters the receipts read by `org_id`;
 * the timezone lookup here does too.
 */

export const IFTA_SOURCE = "IFTA ledger page (/ifta), the same quarter's figures that page shows";
export const IFTA_QUARTER_PERIODS = ["this_quarter", "last_quarter"] as const;

export interface AssistantIftaInput {
  period?: unknown;
  year?: unknown;
  quarter?: unknown;
  jurisdictions?: unknown;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v: number | null): number | null => (v == null ? null : Math.round(v * 100) / 100);
const gallons = (v: number | null): number | null => (v == null ? null : Math.round(v * 10) / 10);

/** The quarter asked: an explicit year and quarter, else this or last quarter on the carrier's clock. */
function quarterOf(input: AssistantIftaInput, today: string): { year: number; quarter: number } | { error: string } {
  const [ty, tm] = today.split("-").map(Number) as [number, number];
  const thisQ = Math.floor((tm - 1) / 3) + 1;
  if (input.year != null || input.quarter != null) {
    const year = Math.trunc(Number(input.year));
    const quarter = Math.trunc(Number(input.quarter));
    if (!(year >= 2020 && year <= 2100) || !(quarter >= 1 && quarter <= 4)) return { error: "Give year (YYYY) and quarter (1-4) together." };
    if (year > ty || (year === ty && quarter > thisQ)) return { error: `Q${quarter} ${year} has not started yet.` };
    return { year, quarter };
  }
  if (input.period === "this_quarter") return { year: ty, quarter: thisQ };
  return thisQ === 1 ? { year: ty - 1, quarter: 4 } : { year: ty, quarter: thisQ - 1 };
}

export async function assistantIftaReport(
  admin: SupabaseClient,
  orgId: string,
  input: AssistantIftaInput,
  now: Date = new Date(),
): Promise<unknown> {
  const { data: org } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  const timezone = organizationTimezone((org as { operating_hours?: object | null } | null)?.operating_hours);
  const q = quarterOf(input, todayInZone(now, timezone));
  if ("error" in q) return { error: q.error };

  const rows = await readIftaPeriod(admin, orgId, q.year, q.quarter);
  const { miles, position } = ledgerPosition(rows.jurisdictions, rows.receipts, q);
  const s = rows.summary ?? {};
  const monthsFetched = num(s.months_fetched);
  const tieOut = tieOutMiles({
    samsaraMiles: miles.reduce((acc, m) => acc + milesFromMeters(m.taxableMeters), 0),
    odometerMiles: num(s.odometer_miles),
    purchasedGallons: position.mpg.totalGallons,
  });

  const asked = new Set((Array.isArray(input.jurisdictions) ? input.jurisdictions : []).map((j) => String(j).trim().toUpperCase()).filter(Boolean));
  const listed = asked.size > 0 ? position.jurisdictions.filter((j) => asked.has(j.jurisdiction)) : position.jurisdictions;

  const result: Record<string, unknown> = {
    source: IFTA_SOURCE,
    quarter: `Q${q.quarter} ${q.year}`,
    totals: {
      tax_owed: money(position.liability),
      tax_paid_at_the_pump: money(position.credit),
      net: money(position.net),
      net_means: position.net >= 0 ? "still owed across all jurisdictions" : "refundable across all jurisdictions",
      surcharge_not_in_net: money(position.surcharge),
      gallons_from_receipts: gallons(position.receiptGallons),
    },
    fleet_mpg_used: {
      mpg: position.mpg.fleetMpg,
      verdict: position.mpg.verdict,
      total_miles: Math.round(position.mpg.totalMiles),
      total_gallons: gallons(position.mpg.totalGallons),
      concern: position.mpg.concern,
    },
    completeness: {
      months_pulled_from_samsara: monthsFetched,
      of_months: 3,
      any_month_provisional: s.any_provisional === true,
      trucks: num(s.vehicles),
      vehicles_samsara_reported_we_could_not_map: num(s.max_unmapped),
      share_of_miles_priced: position.pricedMileShare,
      jurisdictions_not_priced: position.unpriced,
      samsara_last_fetched_at: s.last_fetched_at == null ? null : String(s.last_fetched_at),
    },
    miles_tie_out: { verdict: tieOut.verdict, samsara_miles: Math.round(tieOut.samsaraMiles), odometer_miles: Math.round(tieOut.odometerMiles), implied_mpg: tieOut.impliedMpg, concern: tieOut.concern },
    by_jurisdiction: listed.map((j) => ({
      jurisdiction: j.jurisdiction,
      taxable_miles: Math.round(j.taxableMiles),
      total_miles: Math.round(j.totalMiles),
      gallons_burned: gallons(j.gallonsConsumed),
      gallons_bought: gallons(j.gallonsPurchased),
      gallons_bought_from_receipts: gallons(j.gallonsFromReceipts),
      rate_per_gallon: j.ratePerGal,
      tax_owed: money(j.liability),
      tax_paid: money(j.credit),
      net: money(j.net),
      surcharge: money(j.surcharge),
      priced: j.priced,
    })),
  };
  if (monthsFetched < 3) {
    result.incomplete_note =
      `Only ${monthsFetched} of 3 months are in: Samsara serves a month's IFTA only after it has finished processing it. ` +
      "These figures will change; never call them the quarter's return.";
  }
  if (asked.size > 0) {
    const missing = [...asked].filter((code) => !listed.some((j) => j.jurisdiction === code));
    if (missing.length > 0) result.no_miles_or_fuel_in = missing;
  }
  return result;
}
