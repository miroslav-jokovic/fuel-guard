import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ASSISTANT_REPORT_PERIODS,
  assistantMonthsIn,
  assistantUnitKey,
  FUEL_REPORT_TRUCK_FIGURES_NOTE,
  organizationTimezone,
  resolveAssistantRange,
  todayInZone,
  type AssistantRange,
  type AssistantRangeInput,
  type AssistantReportPeriod,
  type FuelReportWindow,
} from "@silvicom/shared";
import { readFuelReport, type FuelReportFilterArgs } from "./fuelReport.js";

/**
 * The assistant's `fuel_report` tool (F21 R1, 2026-11-10): the Fuel Costs report, asked in words.
 *
 * ── WHY IT EXISTS, MEASURED ───────────────────────────────────────────────────────────────────────
 * On 2026-11-09 the owner asked Ask AI for "mpg on my units 748 751 762 763 784 785 786 787 788 … for
 * a month or Q". No tool could answer it: `fuel_ranking` ranks the whole fleet's top N (5 by default,
 * 25 at most) and takes no unit list; its MPG is each subject's own fill-to-fill figure, not the
 * odometer-measured one the Fuel Costs page shows; and every window was "the last N days back from
 * this instant, in UTC", so "October" and "last quarter" were not askable. Three of the twenty
 * questions ever asked ("cost per mile" twice, the nine units once) were this shape.
 *
 * ── WHY IT CALLS `readFuelReport` AND NOTHING ELSE ────────────────────────────────────────────────
 * The Fuel Costs page (`GET /api/fueling/report`) already answers "these trucks, these days": spend,
 * gallons, price per gallon, D-MPG1's fleet MPG over exactly those trucks, fuel cost per mile, and
 * the previous range of equal length (D-FSV3). A second aggregation here would be the fourth copy of
 * MPG that M4 retired — an assistant that disagrees with the page loses the reader in one exchange.
 * So every figure below is a field of `readFuelReport`'s answer, copied out and renamed, never
 * recomputed; the only arithmetic this file owns is CALENDAR (which days a month or a quarter is, on
 * the carrier's clock) and NAMES (unit number → vehicle id).
 *
 * Per-truck rows are one `readFuelReport` per truck, the page's own "filter to one truck" — not a
 * split of the group total, because a fleet MPG is not additive across trucks.
 *
 * ORG-SCOPED: the service role bypasses RLS, so the unit lookup filters `org_id` itself and
 * `readFuelReport` passes `p_org` to every RPC.
 */

/**
 * The calendar (which days a month or a quarter is, on the carrier's clock) lives in
 * `@silvicom/shared` `assistantPeriods.ts` since R6a, so the finance tools resolve "last quarter"
 * exactly as this one does. The names below are that module's, kept under R1's names.
 */
export const REPORT_PERIODS = ASSISTANT_REPORT_PERIODS;
export type ReportPeriod = AssistantReportPeriod;
export type ResolvedRange = AssistantRange;
export const resolveReportRange = resolveAssistantRange;
export const monthsIn = assistantMonthsIn;
export const normalizeUnit = assistantUnitKey;

/** Each named truck is one report read; 25 keeps a quarter for 25 trucks inside a few seconds. */
export const MAX_REPORT_UNITS = 25;
/** Reads in flight at once. The database is small (memory: database-is-micro-and-swapping). */
const CONCURRENCY = 3;

export interface AssistantFuelReportInput extends AssistantRangeInput {
  units?: unknown;
  by?: unknown;
}

/**
 * One window's figures, as the page shows them. Copied out of `readFuelReport`'s answer — the one
 * place in this file that touches a number, and it only renames.
 */
function figures(w: FuelReportWindow) {
  const t = w.totals.tractor;
  const e = w.efficiency;
  return {
    from: w.from,
    to: w.to,
    fills: t.fills,
    gallons: t.gallons,
    spend: t.spend,
    price_per_gal: t.pricePerGal,
    mpg: e?.mpg.mpg ?? null,
    // A withheld MPG keeps its reason, so the answer can say "cannot measure that yet, because…"
    // rather than invent a figure (the `fuel_economics` tool's rule).
    mpg_unavailable_because: e ? e.mpg.reason : FUEL_REPORT_TRUCK_FIGURES_NOTE,
    mpg_measured_share: e?.mpg.measuredShare ?? null,
    // The MPG closes where the fuel roll-up reaches; a partial one is about fewer days than asked.
    mpg_measured_through: e?.mpg.partial ? e.mpg.to : null,
    miles: e?.mpg.miles ?? null,
    fuel_cost_per_mile: e?.costPerMile ?? null,
    reefer_gallons: w.totals.reefer.gallons,
    reefer_spend: w.totals.reefer.spend,
  };
}

async function pool<T, R>(items: readonly T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

const NO_FILTERS: FuelReportFilterArgs = { vehicleIds: [], states: [], siteIds: [], networks: [] };
const read = (admin: SupabaseClient, orgId: string, from: string, to: string, vehicleIds: string[]) =>
  readFuelReport(admin, orgId, from, to, { ...NO_FILTERS, vehicleIds }, { trailing: false, sites: false });

export async function assistantFuelReport(
  admin: SupabaseClient,
  orgId: string,
  input: AssistantFuelReportInput,
  now: Date = new Date(),
): Promise<unknown> {
  const { data: org } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  const timezone = organizationTimezone((org as { operating_hours?: object | null } | null)?.operating_hours);
  const range = resolveReportRange(input, todayInZone(now, timezone));
  if (!range.ok) return { error: range.error };

  const asked = [...new Set((Array.isArray(input.units) ? input.units : []).map((u) => String(u)).filter((u) => normalizeUnit(u) !== ""))];
  if (asked.length > MAX_REPORT_UNITS) {
    return { error: `At most ${MAX_REPORT_UNITS} units per report; ${asked.length} were named. Split the list.` };
  }
  // Named trucks default to one row each — the question "mpg on my units …" is about each of them.
  const by = input.by === "month" || input.by === "total" || input.by === "truck" ? input.by : asked.length > 0 ? "truck" : "total";
  if (by === "truck" && asked.length === 0) {
    return { error: "A per-truck report needs the unit numbers (up to 25). For the whole fleet ranked, use fuel_ranking." };
  }

  let trucks: Array<{ id: string; unit: string }> = [];
  const notFound: string[] = [];
  let otherRows: Array<{ unit: string; status: string | null }> = [];
  if (asked.length > 0) {
    const { data, error } = await admin.from("vehicles").select("id, unit_number, status").eq("org_id", orgId);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ id: string; unit_number: string | null; status: string | null }>;
    const byKey = new Map(rows.filter((r) => r.unit_number).map((r) => [normalizeUnit(r.unit_number!), r]));
    for (const u of asked) {
      const hit = byKey.get(normalizeUnit(u));
      if (hit) trucks.push({ id: hit.id, unit: hit.unit_number! });
      else notFound.push(u);
    }
    trucks = [...new Map(trucks.map((t) => [t.id, t])).values()];
    // A "748 - OLD" row is the same truck before a Samsara gateway swap (memory:
    // samsara-old-suffix-is-a-device-swap). The page filtered to 748 does not include it either, so
    // the figure stays the page's — but the reader is told the older row exists.
    const named = new Set(trucks.map((t) => normalizeUnit(t.unit)));
    otherRows = rows
      .filter((r) => r.unit_number && !named.has(normalizeUnit(r.unit_number)))
      .filter((r) => [...named].some((k) => normalizeUnit(r.unit_number!).startsWith(`${k} `)))
      .map((r) => ({ unit: r.unit_number!, status: r.status }));
    // Named units, none of them ours: answer "no such trucks", never the fleet. An empty scope is not
    // the absence of a scope (`fleetMpg.ts` VehicleScope).
    if (trucks.length === 0) return { error: "None of the named units are in this fleet.", not_found: notFound };
  }
  const ids = trucks.map((t) => t.id);

  const total = await read(admin, orgId, range.from, range.to, ids);
  const result: Record<string, unknown> = {
    source: "Fuel Costs report (/fuel-spend) — the same figures that page shows for these trucks and days",
    timezone,
    period: range.label,
    scope: asked.length > 0 ? { units: trucks.map((t) => t.unit), not_found: notFound, other_rows_for_these_units: otherRows } : "whole fleet",
    total: figures(total.current),
    previous_period: figures(total.previous),
  };
  if (by === "truck") {
    const per = await pool(trucks, (t) => read(admin, orgId, range.from, range.to, [t.id]));
    result.by_truck = trucks.map((t, i) => ({ unit: t.unit, ...figures(per[i]!.current) }));
  } else if (by === "month") {
    const months = monthsIn(range.from, range.to);
    const per = await pool(months, (mo) => read(admin, orgId, mo.from, mo.to, ids));
    result.by_month = per.map((r) => figures(r.current));
  }
  return result;
}
