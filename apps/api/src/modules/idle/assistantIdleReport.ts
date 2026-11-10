import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assistantMonthsIn,
  assistantPreviousRange,
  assistantWeeksIn,
  organizationTimezone,
  resolveAssistantRange,
  todayInZone,
  type AssistantRangeInput,
  type FleetIdleVerdict,
} from "@silvicom/shared";
import { readFleetIdleVerdict } from "./fuelIdleVerdict.js";

/**
 * The assistant's `idle_report` tool (F21 R6b, 2026-11-10): the Idling page's fleet verdict, asked
 * in words, for calendar periods and week over week.
 *
 * ── WHY IT EXISTS, MEASURED ───────────────────────────────────────────────────────────────────────
 * Week-over-week idling was asked on 07/29 and 08/04 and could not be answered. `idling_summary`
 * takes "the last N days back from this instant, in UTC", has no buckets, and sums `idle_events`
 * cost, which is every idle minute priced. The Idling page's headline is different: avoidable idle,
 * counted only on trucks with no APU or optimized idle and enough coverage to judge, priced on each
 * day's fuel price (`docs/plans/IDLE-AVOIDABLE-HOS.md`). An answer that reports the first figure
 * beside a page showing the second disagrees with it by the whole APU fleet.
 *
 * ── WHY IT CALLS `readFleetIdleVerdict` AND NOTHING ELSE ─────────────────────────────────────────
 * `readFleetIdleVerdict` makes the page's own three reads (rollup days, in-service trucks, day
 * prices) and the page's cost basis, then runs `computeIdleBreakdown`, the same pure function
 * `useIdleBreakdown` runs in the browser. So each window's figures are the page's figures for those
 * days, by construction. This file renames fields and decides CALENDAR only: which days a week or a
 * month is, on the carrier's clock (`assistantPeriods.ts`), and the previous window of equal length.
 * It never adds one week's hours to another; a period total is its own verdict read.
 *
 * ORG-SCOPED: the service role bypasses RLS. `readFleetIdleVerdict` filters `org_id` on every read;
 * the timezone lookup here does too.
 */

/** Buckets per answer. A half-year of weeks or a year of months; each is one verdict read. */
const MAX_WEEKS = 26;
const MAX_MONTHS = 12;
/** Reads in flight at once. Each verdict reads the range's rollup rows; the database is small. */
const CONCURRENCY = 2;

export const IDLE_SOURCE = "Idling page (/idling), the same fleet figures that page shows for these days";

export interface AssistantIdleInput extends AssistantRangeInput {
  by?: unknown;
}

/** One window's figures, as the page shows them. Copied and renamed, never recomputed. */
function figures(from: string, to: string, v: FleetIdleVerdict | null) {
  if (!v) return { from, to, no_idle_data: true };
  return {
    from,
    to,
    engine_on_hours: v.engineOnH,
    drive_hours: v.driveH,
    idle_hours: v.idleH,
    idle_pct_of_engine_on: v.idlePct,
    // The page's headline: idling a driver could have avoided (no APU or optimized idle), on
    // trucks observed long enough to judge.
    avoidable_idle_hours: v.avoidableH,
    avoidable_idle_cost: v.avoidableUsd,
    // Wider: every covered truck's idle beyond its envelope, including APU trucks.
    reducible_idle_hours: v.reducibleH,
    reducible_idle_cost: v.reducibleUsd,
    trucks_judged: v.confidentTrucks,
    trucks_total: v.totalTrucks,
    trucks_left_out_too_little_data: v.thinTrucks,
    figures_reach_through: v.throughDay,
    days_priced_at_day_price: v.avoidablePricing.pricedDays,
    days_priced_at_default_basis: v.avoidablePricing.unpricedDays,
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

export async function assistantIdleReport(
  admin: SupabaseClient,
  orgId: string,
  input: AssistantIdleInput,
  now: Date = new Date(),
): Promise<unknown> {
  const { data: org } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  const timezone = organizationTimezone((org as { operating_hours?: object | null } | null)?.operating_hours);
  const range = resolveAssistantRange(input, todayInZone(now, timezone));
  if (!range.ok) return { error: range.error };

  const by = input.by === "week" || input.by === "month" ? input.by : "total";
  const buckets = by === "week" ? assistantWeeksIn(range.from, range.to) : by === "month" ? assistantMonthsIn(range.from, range.to) : [];
  if (by === "week" && buckets.length > MAX_WEEKS) return { error: `by=week covers at most ${MAX_WEEKS} weeks; ${buckets.length} were asked.` };
  if (by === "month" && buckets.length > MAX_MONTHS) return { error: `by=month covers at most ${MAX_MONTHS} months; ${buckets.length} were asked.` };

  const prev = assistantPreviousRange(range.from, range.to);
  const [current, previous] = await Promise.all([
    readFleetIdleVerdict(admin, orgId, range.from, range.to),
    readFleetIdleVerdict(admin, orgId, prev.from, prev.to),
  ]);
  const result: Record<string, unknown> = {
    source: IDLE_SOURCE,
    timezone,
    period: range.label,
    total: figures(range.from, range.to, current),
    previous_period: figures(prev.from, prev.to, previous),
  };
  if (buckets.length > 1) {
    const per = await pool(buckets, (b) => readFleetIdleVerdict(admin, orgId, b.from, b.to));
    result[by === "week" ? "by_week" : "by_month"] = buckets.map((b, i) => figures(b.from, b.to, per[i]!));
    if (by === "week") result.week_note = "Weeks run Monday to Sunday; the first and last are clipped to the period.";
  }
  return result;
}
