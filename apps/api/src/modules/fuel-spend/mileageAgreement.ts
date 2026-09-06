import type { SupabaseClient } from "@supabase/supabase-js";
import { assessMileageAgreement, type MileageAgreementResult, type MonthlyMileage } from "@silvicom/shared";
import { eachPage } from "../../lib/paging.js";
import { readMonthlyMileageByMonth } from "../samsara/index.js";

/**
 * The cross-source mileage check, assembled (M5, D-MPG1 point 2, plan Q3).
 *
 * ── WHAT IT ANSWERS AND WHY IT SHIPS ───────────────────────────────────────────────────────────
 * `fuel_spend_days.miles` is what the spend report divides and prints. It agreed with Samsara's own
 * IFTA jurisdiction miles to within 0.08% in July 2026 and ran 3.78% ahead of them in August, and
 * the step landed in the week of 2026-07-28. **Nothing noticed for five weeks**, because nothing in
 * the product put the two numbers side by side — a person found it by accident while deciding which
 * of two disagreeing pages was wrong. This is the comparison, made every time the report is read.
 *
 * It REPORTS; it never reconciles. The two figures answer different questions over independent
 * pipelines, and that independence is what makes the comparison worth anything (D-MPG2).
 *
 * ── WHOLE CALENDAR MONTHS ONLY, WHICH THE WINDOW USUALLY IS NOT ────────────────────────────────
 * Samsara publishes jurisdiction miles per vehicle per calendar MONTH and cannot be cut finer, so
 * half a month of allocated miles against a whole month of jurisdiction miles reads as a 50%
 * collapse that is an artefact of the window and nothing else. Only months lying entirely inside
 * `[from, to]` are compared. A one-week report therefore has nothing to check, and says so rather
 * than checking the wrong thing.
 *
 * ── WHY THIS IS NOT SCOPED BY TRUCK ────────────────────────────────────────────────────────────
 * The check is about whether the two SOURCES agree, not about any subset of the fleet. Narrowing it
 * to the trucks a screen is filtered to would make the comparison depend on the filter — a divergence
 * appearing and disappearing as the reader picks trucks is worse than no check, because it teaches
 * them to ignore it.
 */

/**
 * The wire shape is `MileageAgreementResult` in `@silvicom/shared` — one home for a contract the API
 * writes and the web reads (`lint:shared-contracts`).
 */
export type { MileageAgreementResult } from "@silvicom/shared";

/** Whole calendar months entirely inside `[from, to]` — the only months either side can both answer. */
export function wholeMonthsIn(from: string, to: string): Array<{ year: number; month: number; key: string }> {
  const out: Array<{ year: number; month: number; key: string }> = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return out;
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const first = new Date(Date.UTC(year, month - 1, 1));
    const last = new Date(Date.UTC(year, month, 0));
    if (first >= start && last <= end) {
      out.push({ year, month, key: `${year}-${String(month).padStart(2, "0")}` });
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/** This system's own distance for those months, from the rollup the spend report reads. */
async function readRollupMilesByMonth(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const byMonth = new Map<string, number>();
  await eachPage<{ day: string; miles: number | string }>(
    (a, b) =>
      admin
        .from("fuel_spend_days")
        .select("day, miles")
        // The service role bypasses RLS; this is the only tenant boundary on the read.
        .eq("org_id", orgId)
        .gte("day", from)
        .lte("day", to)
        .order("day", { ascending: true })
        .range(a, b),
    (rows) => {
      for (const r of rows) {
        const miles = Number(r.miles) || 0;
        if (miles === 0) continue;
        const key = r.day.slice(0, 7);
        byMonth.set(key, (byMonth.get(key) ?? 0) + miles);
      }
    },
  );
  return byMonth;
}

/**
 * Does the distance behind this window's figures agree with the independent source?
 *
 * Both totals cover the whole fleet: every truck-day in the month on one side, every vehicle-month
 * Samsara published on the other. A month either side cannot speak for comes back `unmeasurable`
 * rather than agreeing — an absent feed is not agreement, and a check that read silence as a pass
 * would have been quiet through exactly the outage it exists to catch.
 */
export async function getMileageAgreement(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<MileageAgreementResult> {
  const months = wholeMonthsIn(from, to);
  if (months.length === 0) {
    return {
      months: [],
      worst: null,
      verdict: "unmeasurable",
      concern: null,
      monthsChecked: [],
      windowTooShort: true,
    };
  }

  const [ours, theirs] = await Promise.all([
    // Read over the months' own span rather than the caller's window: a window may start mid-month,
    // and half a month of our miles against a whole month of theirs is the artefact this avoids.
    readRollupMilesByMonth(
      admin,
      orgId,
      `${months[0]!.key}-01`,
      new Date(Date.UTC(months.at(-1)!.year, months.at(-1)!.month, 0)).toISOString().slice(0, 10),
    ),
    readMonthlyMileageByMonth(admin, orgId, months.map(({ year, month }) => ({ year, month }))),
  ]);

  const input: MonthlyMileage[] = months.map(({ key }) => ({
    month: key,
    miles: Math.round((ours.get(key) ?? 0) * 10) / 10,
    referenceMiles: theirs.get(key)?.miles ?? 0,
  }));

  return {
    ...assessMileageAgreement(input),
    monthsChecked: months.map((m) => m.key),
    windowTooShort: false,
  };
}
