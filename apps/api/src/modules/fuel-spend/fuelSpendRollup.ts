/**
 * Build the daily fuel-spend rollup (migration 0244) for one org and one window.
 *
 * ── WHY THIS RUNS SERVER-SIDE AND NIGHTLY ────────────────────────────────────────────────────────
 * The join it performs — fills, DEF lines, odometer intervals and engine days at one grain — is the
 * expensive and error-prone part of answering "fuel cost more this week, why". Recomputing it in the
 * browser on every page load would be slow, would page tens of thousands of rows to the client, and
 * would let two screens disagree about the same week. Computed once, kept, and read back.
 *
 * ── STALE ROWS ARE SWEPT BY TIMESTAMP, NOT BY KEY ────────────────────────────────────────────────
 * A truck-day can stop existing: a fill is corrected away, a vehicle is reattributed, an odometer
 * interval is repaired. Every fresh row is upserted unconditionally, so every one of them carries an
 * `updated_at` at or after this run started; anything left in the window with an older stamp is by
 * definition a row this derivation no longer produces, and is deleted. That keeps the sweep set-based
 * and org-scoped without an RPC, and without a delete-then-insert window where the table reads empty.
 *
 * ── ORG SCOPING ──────────────────────────────────────────────────────────────────────────────────
 * Every query below filters `org_id` explicitly. The service role bypasses RLS, so the filter IS the
 * tenant boundary — asserted by `expectOrgScoped` in the tests.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveFuelSpendRollup,
  type SpendFill,
  type SpendDefLine,
  type SpendEngineDay,
  type SpendRollupRow,
} from "@silvicom/shared";
import { eachPage } from "../../lib/paging.js";

/**
 * How far back of extra history to read so the first day in the window has a previous fill to measure
 * its odometer interval from. Three weeks covers a truck that fuels fortnightly with room to spare;
 * beyond that `deriveFuelSpendRollup` refuses to smear the gap anyway.
 */
const LOOKBACK_DAYS = 21;
const WRITE_CHUNK = 500;

/** EFS item codes that are DEF. `fuel_transactions` carries no DEF at all, so this is its only source. */
const DEF_ITEMS = ["DEFD", "DEF"] as const;

export interface FuelSpendRollupResult {
  orgId: string;
  from: string;
  to: string;
  written: number;
  deleted: number;
  /** Odometer intervals refused by the plausibility gate — a data-quality figure, worth logging. */
  rejectedIntervals: number;
  /** Fills with no vehicle. Kept on the unattributed row so totals still tie to the bill. */
  unattributedFills: number;
  /** DEF lines whose unit number matched no vehicle in this org. */
  defUnmatched: number;
}

const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

interface RawFill {
  vehicle_id: string | null;
  fueled_at: string | null;
  state: string | null;
  tank_type: string | null;
  gallons: number | string | null;
  total_cost: number | string | null;
  miles_since_last: number | string | null;
}
interface RawDef {
  unit: string | null;
  tran_date: string | null;
  qty: number | string | null;
  amt: number | string | null;
}
interface RawEngineDay {
  vehicle_id: string;
  day: string;
  drive_sec: number | string | null;
  idle_sec: number | string | null;
  off_sec: number | string | null;
  coverage_sec: number | string | null;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const maybeNum = (v: unknown): number | null => (v == null ? null : Number(v));

export async function buildFuelSpendRollup(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<FuelSpendRollupResult> {
  const runStart = new Date().toISOString();
  const readFrom = addDays(from, -LOOKBACK_DAYS);

  const [fills, defLines, engineDays] = await Promise.all([
    readFills(admin, orgId, readFrom, to),
    readDefLines(admin, orgId, from, to),
    readEngineDays(admin, orgId, readFrom, to),
  ]);

  const derived = deriveFuelSpendRollup({
    fills,
    defLines: defLines.lines,
    engineDays,
    from,
    to,
  });

  const written = await writeRows(admin, orgId, derived.rows);
  const deleted = await sweepStale(admin, orgId, from, to, runStart);

  return {
    orgId,
    from,
    to,
    written,
    deleted,
    rejectedIntervals: derived.rejectedIntervals,
    unattributedFills: derived.unattributedFills,
    defUnmatched: defLines.unmatched,
  };
}

/** Recorded fills. The UTC window is widened a day each side because business dates are station-local. */
async function readFills(admin: SupabaseClient, orgId: string, from: string, to: string): Promise<SpendFill[]> {
  const out: SpendFill[] = [];
  await eachPage<RawFill>(
    (a, b) =>
      admin
        .from("fuel_transactions")
        .select("vehicle_id, fueled_at, state, tank_type, gallons, total_cost, miles_since_last")
        .eq("org_id", orgId)
        .gte("fueled_at", `${addDays(from, -1)}T00:00:00.000Z`)
        .lte("fueled_at", `${addDays(to, 1)}T23:59:59.999Z`)
        .order("fueled_at", { ascending: true })
        .range(a, b),
    (rows) => {
      for (const r of rows) {
        if (!r.fueled_at) continue;
        out.push({
          vehicleId: r.vehicle_id,
          fueledAt: r.fueled_at,
          state: r.state,
          tank: r.tank_type === "reefer" ? "reefer" : "tractor",
          gallons: num(r.gallons),
          totalCost: maybeNum(r.total_cost),
          milesSinceLast: maybeNum(r.miles_since_last),
        });
      }
    },
  );
  return out;
}

/**
 * DEF from the EFS feed, resolved to a truck by unit number.
 *
 * Unit numbers are unique within an org (`vehicles` has a unique on org_id + unit_number) and matched
 * 2,394 of 2,397 DEF lines on real production data. The handful that miss are NOT dropped — they go to
 * the unattributed row, because DEF nobody can place is still DEF the carrier paid for.
 */
async function readDefLines(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<{ lines: SpendDefLine[]; unmatched: number }> {
  const byUnit = new Map<string, string>();
  await eachPage<{ id: string; unit_number: string | null }>(
    (a, b) => admin.from("vehicles").select("id, unit_number").eq("org_id", orgId).range(a, b),
    (rows) => {
      for (const v of rows) if (v.unit_number) byUnit.set(v.unit_number.trim(), v.id);
    },
  );

  const lines: SpendDefLine[] = [];
  let unmatched = 0;
  await eachPage<RawDef>(
    (a, b) =>
      admin
        .from("efs_transactions")
        .select("unit, tran_date, qty, amt")
        .eq("org_id", orgId)
        .in("item", DEF_ITEMS as unknown as string[])
        .gte("tran_date", from)
        .lte("tran_date", to)
        .range(a, b),
    (rows) => {
      for (const r of rows) {
        if (!r.tran_date) continue;
        const vehicleId = r.unit ? (byUnit.get(r.unit.trim()) ?? null) : null;
        if (!vehicleId) unmatched++;
        lines.push({ vehicleId, day: r.tran_date.slice(0, 10), gallons: num(r.qty), amount: num(r.amt) });
      }
    },
  );
  return { lines, unmatched };
}

async function readEngineDays(admin: SupabaseClient, orgId: string, from: string, to: string): Promise<SpendEngineDay[]> {
  const out: SpendEngineDay[] = [];
  await eachPage<RawEngineDay>(
    (a, b) =>
      admin
        .from("vehicle_engine_days")
        .select("vehicle_id, day, drive_sec, idle_sec, off_sec, coverage_sec")
        .eq("org_id", orgId)
        .gte("day", from)
        .lte("day", to)
        .order("day", { ascending: true })
        .range(a, b),
    (rows) => {
      for (const r of rows) {
        out.push({
          vehicleId: r.vehicle_id,
          day: r.day,
          driveSec: num(r.drive_sec),
          idleSec: num(r.idle_sec),
          offSec: num(r.off_sec),
          coverageSec: num(r.coverage_sec),
        });
      }
    },
  );
  return out;
}

/**
 * Write every derived row. The payload carries the FULL row and conflicts on the natural key, not on
 * the primary key — `lint:upserts` bans the latter shape because Postgres checks NOT NULL before
 * conflict arbitration, and a partial payload fails on precisely the rows that already exist.
 */
async function writeRows(admin: SupabaseClient, orgId: string, rows: SpendRollupRow[]): Promise<number> {
  const payload = rows.map((r) => ({
    org_id: orgId,
    vehicle_id: r.vehicleId,
    day: r.day,
    fills: r.fills,
    gallons_tractor: r.gallonsTractor,
    gallons_reefer: r.gallonsReefer,
    gallons_def: r.gallonsDef,
    spend_tractor: r.spendTractor,
    spend_reefer: r.spendReefer,
    spend_def: r.spendDef,
    miles: r.miles,
    mpg_gallons: r.mpgGallons,
    miles_basis: r.milesBasis,
    miles_rejected: r.milesRejected,
    drive_sec: r.driveSec,
    idle_sec: r.idleSec,
    off_sec: r.offSec,
    coverage_sec: r.coverageSec,
  }));
  for (let i = 0; i < payload.length; i += WRITE_CHUNK) {
    const { error } = await admin
      .from("fuel_spend_days")
      .upsert(payload.slice(i, i + WRITE_CHUNK), { onConflict: "org_id,vehicle_id,day" });
    if (error) throw new Error(`fuel spend rollup write failed: ${error.message}`);
  }
  return payload.length;
}

/** Anything in the window this run did not touch is a truck-day the derivation no longer produces. */
async function sweepStale(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
  runStart: string,
): Promise<number> {
  const { data, error } = await admin
    .from("fuel_spend_days")
    .delete({ count: "exact" })
    .eq("org_id", orgId)
    .gte("day", from)
    .lte("day", to)
    .lt("updated_at", runStart)
    .select("id");
  if (error) throw new Error(`fuel spend rollup sweep failed: ${error.message}`);
  return Array.isArray(data) ? data.length : 0;
}
