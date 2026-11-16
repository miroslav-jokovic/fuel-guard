import type { SupabaseClient } from "@supabase/supabase-js";
import {
  coverageIsPrintable,
  dayRangeInstants,
  rollUp,
  shiftDay,
  todayInZone,
  type CoverageMonth,
  type RollupBucket,
  type RollupBucketRow,
  type RollupKind,
  type RollupRepair,
  type RollupUnit,
  type RollupUnitRow,
} from "@silvicom/shared";
import { orgTimezone } from "../org/index.js";
import { readCoverage } from "./coverage.js";

/**
 * The repair-cost roll-up's reads (FLEETPAL-INTEGRATION-PLAN.md F9d). The arithmetic is
 * `@silvicom/shared`'s `rollUp`; this file fetches its three inputs and gates it.
 *
 * ── NO ROLL-UP TABLE, MEASURED (2026-11-16) ───────────────────────────────────────────────────
 * The step asked for the live read to be measured before reaching for a materialised total, which
 * would be a second source of truth (D-FLEET9). Production: a twelve-month window is 9,290
 * service-history rows, read in 328 ms on `idx_fleetpal_service_history_org_completed` (EXPLAIN
 * ANALYZE). Ten PostgREST pages. No migration.
 *
 * ── THE REFUSAL NAMES ITS MONTHS (D-FP4) ──────────────────────────────────────────────────────
 * No figure without its bound, so a window touching a month the ledger has not been swept for is
 * refused — and, unlike F9b's 409, says WHICH months, because "a yearly bucket is gated by the
 * ledger" means a year view will meet this every January and the reader must be able to act on it.
 *
 * ── DAYS ARE THE CARRIER'S ───────────────────────────────────────────────────────────────────
 * `completed` is an instant; the bucket is the calendar day it fell on in the org's zone. Bucketing
 * in UTC moved 22 June work orders into July (measured 2026-10-07).
 */

const PAGE = 1000;

export interface RollupQuery {
  from: string;
  to: string;
  bucket: RollupBucket;
  kind: RollupKind;
  limit: number;
  offset: number;
}

export interface RollupAnswer {
  buckets: RollupBucketRow[];
  units: RollupUnitRow[];
  /** Unit rows in the whole answer, before `limit`/`offset`. */
  unitTotal: number;
  /** Per month: FleetPal's invoicing, the ledger family and the "at least" bound (Q10 (a)). */
  coverage: CoverageMonth[];
  unmatchedUnits: number;
}

export type RollupOutcome = { ok: RollupAnswer } | { refused: string[] };

export async function readRollup(admin: SupabaseClient, orgId: string, q: RollupQuery): Promise<RollupOutcome> {
  // The bound first, and it gates everything after it — the arrangement F9b's route chose so that no
  // code path produces a figure without one.
  const coverage = await readCoverage(admin, orgId, q.from, q.to);
  if (!coverageIsPrintable(coverage.months)) {
    return { refused: coverage.months.filter((m) => m.ratioLowerBound === null).map((m) => m.month) };
  }
  const zone = await orgTimezone(admin, orgId);
  const [repairs, units] = await Promise.all([readRepairs(admin, orgId, q.from, q.to, zone), readUnits(admin, orgId)]);
  const result = rollUp(repairs, units, q);
  return {
    ok: {
      buckets: result.buckets,
      units: result.units.slice(q.offset, q.offset + q.limit),
      unitTotal: result.units.length,
      coverage: coverage.months,
      unmatchedUnits: coverage.unmatchedUnits,
    },
  };
}

async function readRepairs(admin: SupabaseClient, orgId: string, from: string, to: string, zone: string): Promise<RollupRepair[]> {
  // `to` is exclusive; `dayRangeInstants` takes the inclusive last day.
  const { start, endExclusive } = dayRangeInstants(from, shiftDay(to, -1), zone);
  const out: RollupRepair[] = [];
  for (let at = 0; ; at += PAGE) {
    const { data, error } = await admin
      .from("fleetpal_service_history")
      .select("id, unit_fleetpal_id, completed, total, total_labor")
      .eq("org_id", orgId)
      .gte("completed", start)
      .lt("completed", endExclusive)
      .order("completed", { ascending: true })
      .order("id", { ascending: true })
      .range(at, at + PAGE - 1);
    if (error) throw new Error(`fleetpal_service_history read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ unit_fleetpal_id: string | null; completed: string; total: unknown; total_labor: unknown }>;
    for (const r of rows) {
      out.push({
        unitFleetpalId: r.unit_fleetpal_id,
        day: todayInZone(new Date(r.completed), zone),
        // `null` stays `null` (D-FIN10): `Number(null)` is 0, and 0 is the claim "this repair was free".
        total: r.total === null || r.total === undefined ? null : Number(r.total),
        labor: r.total_labor === null || r.total_labor === undefined ? null : Number(r.total_labor),
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

async function readUnits(admin: SupabaseClient, orgId: string): Promise<RollupUnit[]> {
  const out: RollupUnit[] = [];
  for (let at = 0; ; at += PAGE) {
    const { data, error } = await admin
      .from("fleetpal_units")
      .select("fleetpal_id, number, vehicle_id, trailer_id")
      .eq("org_id", orgId)
      .order("fleetpal_id", { ascending: true })
      .range(at, at + PAGE - 1);
    if (error) throw new Error(`fleetpal_units read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ fleetpal_id: string; number: string | null; vehicle_id: string | null; trailer_id: string | null }>;
    for (const r of rows) out.push({ fleetpalId: r.fleetpal_id, number: r.number, vehicleId: r.vehicle_id, trailerId: r.trailer_id });
    if (rows.length < PAGE) break;
  }
  return out;
}
