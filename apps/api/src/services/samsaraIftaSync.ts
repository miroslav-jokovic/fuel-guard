import type { SupabaseClient } from "@supabase/supabase-js";
import { IFTA_MONTHS, iftaMonthNumber, type IftaVehicleReport } from "@silvicom/shared";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { makeSamsaraIftaFetcher, type SamsaraIftaFetcher } from "../lib/samsaraIfta.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";

/**
 * Pull one month of Samsara IFTA jurisdiction miles and store them verbatim (S1).
 *
 * ── THIS SERVICE CALCULATES NOTHING, AND THAT IS THE POINT ───────────────────────────────────────
 * No metres become miles, no litres become gallons, no MPG is derived and no jurisdiction is priced.
 * It resolves a token, fetches, joins Samsara's vehicle id to ours, and writes what came back. Every
 * derived figure lives in `packages/shared/src/ifta/` over these rows, so a corrected rule can be
 * applied to history without re-fetching a period Samsara may since have restated (D-IF1).
 *
 * ── THE 72-HOUR RULE IS ENFORCED HERE, NOT DOCUMENTED HERE (D-IF8) ───────────────────────────────
 * Samsara states the most recent 72 hours may still be processing. A month whose end is inside that
 * window is still worth fetching — a controller wants to see the month in progress — but it is written
 * `provisional = true` so a surface can say so, exactly as F10's tax table flags a quarter IFTA has not
 * finalised. `now` is a parameter rather than a call to the clock so the rule is testable.
 *
 * ── AN UNMAPPED VEHICLE IS COUNTED, NEVER DROPPED SILENTLY ───────────────────────────────────────
 * Samsara reporting a truck we do not hold means the fleet and the telematics account disagree about
 * what exists, which is a finding for a human. Measured on this carrier it is currently zero: all 172
 * vehicles in the 2026 Q2 response matched a `samsara_vehicle_id`.
 */
export interface IftaSyncResult {
  year: number;
  month: string;
  /** Rows written to `samsara_ifta_jurisdiction_miles`. */
  rows: number;
  /** Vehicles Samsara reported, including any that reported no jurisdictions. */
  vehiclesReported: number;
  /** Vehicles Samsara reported that we could not join. */
  unmappedVehicles: number;
  /** True while Samsara may still restate the period. */
  provisional: boolean;
  fetchId: string | null;
}

export interface IftaSyncOptions {
  /** Injected in tests; the real fetcher is built from the org's token. */
  fetcherOverride?: SamsaraIftaFetcher;
  /** The clock, as a parameter. Never read here. */
  now?: Date;
  actorId?: string | null;
}

/** Samsara's stated processing lag. A period ending inside it may still be restated. */
const PROVISIONAL_HOURS = 72;

/**
 * A month is provisional while its last day is within Samsara's processing window — or still in the
 * future, which is the ordinary case for the month a scheduler runs in.
 */
export function isProvisionalMonth(year: number, month: number, now: Date): boolean {
  const endOfMonthUtc = Date.UTC(year, month, 1); // exclusive: the first instant of the next month
  return endOfMonthUtc > now.getTime() - PROVISIONAL_HOURS * 3_600_000;
}

export async function syncIftaMilesForMonth(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  year: number,
  month: string,
  options: IftaSyncOptions = {},
): Promise<IftaSyncResult> {
  const monthNumber = iftaMonthNumber(month);
  if (monthNumber == null) throw new Error(`Not an IFTA month name: ${month}`);

  const token = options.fetcherOverride ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();
  const fetcher = options.fetcherOverride ?? makeSamsaraIftaFetcher(env, token);

  const report: IftaVehicleReport = await fetcher(year, month);
  const provisional = isProvisionalMonth(year, monthNumber, options.now ?? new Date());

  // Our fleet, keyed by Samsara's id. The service role bypasses RLS, so this `.eq("org_id", …)` is
  // the only tenant boundary between one carrier's miles and another's.
  const { data: vehicleRows, error: vehErr } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id")
    .eq("org_id", orgId)
    .not("samsara_vehicle_id", "is", null);
  if (vehErr) throw new Error(`Could not read vehicles: ${vehErr.message}`);
  const bySamsaraId = new Map<string, string>();
  for (const v of (vehicleRows ?? []) as { id: string; samsara_vehicle_id: string }[]) {
    bySamsaraId.set(String(v.samsara_vehicle_id), v.id);
  }

  const unmapped = new Set<string>();
  const rows = report.rows.flatMap((r) => {
    const vehicleId = bySamsaraId.get(r.samsaraVehicleId);
    if (!vehicleId) {
      unmapped.add(r.samsaraVehicleId);
      return [];
    }
    return [{
      org_id: orgId,
      vehicle_id: vehicleId,
      samsara_vehicle_id: r.samsaraVehicleId,
      period_year: year,
      period_month: monthNumber,
      jurisdiction: r.jurisdiction,
      recognised: r.recognised,
      taxable_meters: r.taxableMeters,
      total_meters: r.totalMeters,
      tax_paid_liters: r.taxPaidLiters,
    }];
  });

  const { data: fetchRow, error: fetchErr } = await admin
    .from("samsara_ifta_fetches")
    .insert({
      org_id: orgId,
      period_year: year,
      period_month: monthNumber,
      echoed_year: report.year,
      echoed_month: report.month,
      vehicles_reported: report.vehicles,
      rows_written: rows.length,
      unmapped_vehicles: unmapped.size,
      troubleshooting: report.troubleshooting,
      provisional,
      fetched_by: options.actorId ?? null,
    })
    .select("id")
    .single();
  if (fetchErr || !fetchRow) throw new Error(`Could not record the IFTA fetch: ${fetchErr?.message ?? "no row"}`);
  const fetchId = String((fetchRow as { id: string }).id);

  if (rows.length > 0) {
    // A FULL payload on every conflict column, so this is a legitimate upsert rather than the partial
    // kind `lint:upserts` forbids — Postgres checks NOT NULL before conflict arbitration, and every
    // NOT NULL column above is present. Re-fetching a month is the ordinary case (Samsara restates the
    // recent 72 hours), so the conflict target is the natural key and the write is idempotent.
    const { error: upErr } = await admin
      .from("samsara_ifta_jurisdiction_miles")
      .upsert(rows.map((r) => ({ ...r, fetch_id: fetchId, fetched_at: new Date().toISOString() })), {
        onConflict: "org_id,vehicle_id,period_year,period_month,jurisdiction",
      });
    if (upErr) throw new Error(`Could not write IFTA miles: ${upErr.message}`);
  }

  return {
    year,
    month,
    rows: rows.length,
    vehiclesReported: report.vehicles,
    unmappedVehicles: unmapped.size,
    provisional,
    fetchId,
  };
}

/**
 * The months a sync should cover, newest first — and the CURRENT month is never one of them.
 *
 * ── MEASURED 2026-08-26, AND IT IS STRONGER THAN THE DOCUMENTATION SAYS ──────────────────────────
 * Samsara's own guidance is that "the most recent 72 hours of data may still be processing", which
 * reads as a caution. It is not. Asking for the month in progress returns **HTTP 400**:
 *
 *     {"message":"IFTA data may still be processing. Please request data prior to 2026-08-01"}
 *
 * The first version of this function returned the current month first, and `syncIftaHandler` iterates
 * without catching — so the very first request of every run would have thrown, and the two COMPLETED
 * months behind it would never have been fetched. A daily scheduler that fails every day and writes
 * nothing is the worst shape a sync can take, because the ledger simply stays empty and nothing says
 * why. Found by running the backfill; seven months landed and August 400'd.
 *
 * So a sync covers completed months only. Three of them, because a carrier files a QUARTER and the
 * month a quarter opens is still being restated when the next one starts. `now` is a parameter —
 * this is called from a scheduler and must be testable without a fake clock.
 */
export function monthsToSync(now: Date, back = 3): { year: number; month: string }[] {
  const out: { year: number; month: string }[] = [];
  // `i` starts at 1: month 0 is the one in progress, which Samsara refuses outright.
  for (let i = 1; i <= back; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ year: d.getUTCFullYear(), month: IFTA_MONTHS[d.getUTCMonth()]! });
  }
  return out;
}
