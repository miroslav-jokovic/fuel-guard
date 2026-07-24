/** Scoring helpers: row types, txn-view mapping, threshold/hours loaders, txn-id collection. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TxnView, Thresholds, OperatingHours, FueledAtPrecision } from "@fuelguard/shared";

export const FTXN_COLS =
  "id, org_id, vehicle_id, driver_id, fueled_at, fueled_at_precision, odometer, gallons, price_per_gal, total_cost, version, source, card_ref, control_id, city, state, location_text, tank_type, samsara_odometer, samsara_odometer_at, samsara_odometer_source, samsara_location_matched, samsara_location_confidence, samsara_nearest_station_miles, station_lat, station_lng, samsara_tank_short_gal, samsara_tank_observed_gal, samsara_fuel_pct_before, samsara_fuel_pct_after, samsara_observed_state, samsara_observed_city, samsara_observed_address, samsara_observed_lat, samsara_observed_lng, fueling_time_basis, samsara_recon_at";

export const ODOMETER_RULE_IDS = [
  "odometer_missing",
  "odometer_regression",
  "odometer_stale",
  "odometer_implausible_jump",
  "odometer_daily_cap",
  "odometer_mismatch",
];

export const n = (v: unknown): number | null => (v == null ? null : Number(v));

/** True when an ISO instant is exactly the EFS date-only sentinel (noon UTC) → no real time-of-day. */
export function isNoonSentinel(iso: string): boolean {
  const d = new Date(iso);
  return (
    d.getUTCHours() === 12 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

/**
 * Timestamp precision for a row. The explicit `fueled_at_precision` column (written at import,
 * backfilled by migration 0026) is authoritative; the sentinel/source heuristic is only a fallback
 * for rows that predate the column.
 */
export function rowPrecision(r: Pick<FtxnRow, "fueled_at" | "fueled_at_precision" | "source">): FueledAtPrecision {
  if (r.fueled_at_precision === "instant" || r.fueled_at_precision === "date") return r.fueled_at_precision;
  if (r.source === "manual") return "instant";
  return isNoonSentinel(r.fueled_at) ? "date" : "instant";
}

export interface FtxnRow {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  fueled_at: string;
  fueled_at_precision: string | null;
  odometer: number | string | null;
  gallons: number | string;
  price_per_gal: number | string | null;
  total_cost: number | string | null;
  version: number;
  source: string;
  card_ref: string | null;
  control_id: string | null;
  tank_type: string | null;
  city: string | null;
  state: string | null;
  location_text: string | null;
  samsara_odometer: number | string | null;
  samsara_odometer_at: string | null;
  samsara_odometer_source: string | null;
  samsara_location_matched: boolean | null;
  samsara_location_confidence: string | null;
  samsara_nearest_station_miles: number | string | null;
  station_lat: number | string | null;
  station_lng: number | string | null;
  samsara_tank_short_gal: number | string | null;
  samsara_tank_observed_gal: number | string | null;
  samsara_fuel_pct_before: number | string | null;
  samsara_fuel_pct_after: number | string | null;
  samsara_observed_state: string | null;
  samsara_observed_city: string | null;
  samsara_observed_address: string | null;
  samsara_observed_lat: number | string | null;
  samsara_observed_lng: number | string | null;
  fueling_time_basis: string | null;
  samsara_recon_at: string | null;
}

export function toTxnView(r: FtxnRow): TxnView {
  // Time confidence (derived from stored columns, so prior fills reconstruct correctly on rebuild):
  // a telematics-matched stop gives a real, trusted fueling INSTANT even when the stored business
  // timestamp is a date-only sentinel. A manual entry is trusted. An uncorroborated EFS posted time is
  // NOT trusted for time-of-day / interval rules (may be an authorization/settlement time).
  // A tank-rise-confirmed instant is trustworthy even without a location match; otherwise require a
  // corroborated stop (matched location + recovered time). Either way the recovered instant lives in
  // samsara_recon_at and drives the time-of-day / interval rules (fueled_at stays the business time).
  const tankConfirmed = r.fueling_time_basis === "tank_confirmed";
  const telemMatched = r.samsara_recon_at != null && r.samsara_location_matched === true;
  const hasRecoveredTime = tankConfirmed || telemMatched;
  const eventAt = r.samsara_recon_at ?? r.fueled_at;
  const timeConfirmed = hasRecoveredTime || r.source === "manual";
  const precision: FueledAtPrecision = hasRecoveredTime ? "instant" : rowPrecision(r);
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    driverId: r.driver_id,
    fueledAt: r.fueled_at, // business timestamp — never overwritten (day bucketing + dedup; see migration 0026)
    odometer: n(r.odometer),
    samsaraOdometer: n(r.samsara_odometer),
    samsaraOdometerSource: r.samsara_odometer_source ?? null,
    gallons: Number(r.gallons),
    pricePerGal: n(r.price_per_gal),
    totalCost: n(r.total_cost),
    fueledAtPrecision: precision,
    eventAt,
    timeConfirmed,
    tankType: r.tank_type === "reefer" ? "reefer" : "tractor",
    cardRef: r.card_ref,
    controlId: r.control_id,
  };
}

export async function loadThresholds(admin: SupabaseClient, orgId: string): Promise<Thresholds> {
  const { data } = await admin
    .from("anomaly_thresholds")
    .select("mpg_drop_pct, capacity_tolerance_pct, rapid_refuel_hours, max_plausible_mph, cost_min_per_gal, cost_max_per_gal, disabled_rules, odometer_tolerance_miles, max_daily_miles, cumulative_window_hours, max_reefer_burn_gph, reefer_tank_default_gal, reefer_diversion_window_days, reefer_diversion_min_tractor_gal, reefer_diversion_max_reefer_gal")
    .eq("org_id", orgId)
    .maybeSingle();
  return {
    mpgDropPct: n(data?.mpg_drop_pct) ?? 15,
    capacityTolerancePct: n(data?.capacity_tolerance_pct) ?? 5,
    rapidRefuelHours: n(data?.rapid_refuel_hours) ?? 4,
    maxPlausibleMph: n(data?.max_plausible_mph) ?? 85,
    costMinPerGal: n(data?.cost_min_per_gal),
    costMaxPerGal: n(data?.cost_max_per_gal),
    disabledRules: (data?.disabled_rules ?? []) as Thresholds["disabledRules"],
    // 10 mi default: the Samsara reference is a GPS-interpolated stop reading (±1h anchor slack,
    // 0.1 mi rounding) — ±5 flagged honest entries. Orgs can still tighten via settings.
    odometerToleranceMiles: n(data?.odometer_tolerance_miles) ?? 10,
    maxDailyMiles: n(data?.max_daily_miles) ?? 1000,
    cumulativeWindowHours: n(data?.cumulative_window_hours) ?? 48,
    maxReeferBurnGph: n(data?.max_reefer_burn_gph) ?? 1.5,
    reeferTankDefaultGal: n(data?.reefer_tank_default_gal) ?? 50,
    reeferDiversionWindowDays: n(data?.reefer_diversion_window_days) ?? 30,
    reeferDiversionMinTractorGal: n(data?.reefer_diversion_min_tractor_gal) ?? 150,
    reeferDiversionMaxReeferGal: n(data?.reefer_diversion_max_reefer_gal) ?? 0,
  };
}

export async function loadOperatingHours(admin: SupabaseClient, orgId: string): Promise<OperatingHours> {
  const { data } = await admin.from("organizations").select("operating_hours").eq("id", orgId).single();
  const oh = (data?.operating_hours ?? {}) as Partial<OperatingHours>;
  return { start: oh.start ?? "05:00", end: oh.end ?? "20:00", tz: oh.tz ?? "America/Chicago" };
}

/**
 * Gallons from tractor fills strictly BETWEEN the chosen previous fill and this one (WP4). Those fills
 * were skipped when picking previousTxn (blank odometer / flagged entry), but their fuel WAS burned
 * inside the odometer span — omitting it inflates per-fill MPG and masks deviations.
 */
export async function sumIntermediateGallons(
  admin: SupabaseClient,
  vehicleId: string,
  prevFueledAt: string,
  fueledAt: string,
  excludeId: string,
): Promise<number> {
  if (prevFueledAt >= fueledAt) return 0;
  const { data } = await admin
    .from("fuel_transactions")
    .select("id, gallons")
    .eq("vehicle_id", vehicleId)
    .eq("tank_type", "tractor")
    .gt("fueled_at", prevFueledAt)
    .lt("fueled_at", fueledAt);
  return ((data ?? []) as { id: string; gallons: number | string }[])
    .filter((x) => x.id !== excludeId)
    .reduce((s, x) => s + (Number(x.gallons) || 0), 0);
}

/** Score a single transaction: assemble context (incl. Samsara reconciliation), run the engine, persist. */
export interface ScoreOpts {
  /**
   * Reuse the Samsara values already stored on the transaction instead of making a fresh live call.
   * Used by bulk rebuilds so re-scoring thousands of historical rows doesn't hammer the Samsara API
   * (and stay within rate limits). New imports use a fresh reconciliation (skipRecon=false).
   */
  skipRecon?: boolean;
  /**
   * Optional live-recon health counter. When provided, scoreTransaction increments `attempts` for every
   * live Samsara reconcile it tries and `failures` when the fetch itself failed (SamsaraUnavailableError).
   * backfillOrg uses this to abort a bulk re-sync loudly on a systemic outage instead of silently marking
   * thousands of fills blind. Not set on single-fill or skipRecon paths.
   */
  reconHealth?: { attempts: number; failures: number };
  /** Hoisted per-org context, loaded once by a bulk run so it isn't re-queried per fill (F2). */
  ctx?: {
    thresholds?: Awaited<ReturnType<typeof loadThresholds>>;
    operatingHours?: Awaited<ReturnType<typeof loadOperatingHours>>;
    /** Org Samsara token, loaded once; `null` = not configured. Passed to reconcile to skip per-fill lookup. */
    samsaraToken?: string | null;
  };
  /** Raw Samsara stats already fetched (per-vehicle) covering this fill's window — reconcile reuses it
   *  instead of making its own call (F3 dedup). reconcile slices it to this fill's window. */
  prefetchedRaw?: unknown;
  /** Backfill already tried and FAILED to fetch this vehicle's window — skip recon, leave row unreconciled
   *  (deterministic rules still run). Prevents a per-fill retry after a group fetch already failed. */
  reconUnavailable?: boolean;
  /** Bulk backfill: reconcile with CACHED geocodes only (skip the live 1-req/sec Nominatim call so
   *  concurrent workers don't serialize behind it). Exact proximity fills in later via live recon. */
  geocodeCacheOnly?: boolean;
  /** Skip the per-fill learned-value update (offset / tank reliability / capacity). A bulk rebuild learns
   *  each vehicle ONCE up front (learnVehicleValues), then scores every fill against those CONVERGED values
   *  in a single pass — so a rebuild no longer needs to be run twice for learned values to take effect (R-3). */
  skipLearn?: boolean;
}

/** Bulk-scope filters for backfillOrg — keep routine runs incremental instead of re-processing history. */
export interface BackfillOpts extends ScoreOpts {
  /** Only rows never Samsara-reconciled (samsara_recon_at IS NULL) — the routine "catch up new fills". */
  onlyUnreconciled?: boolean;
  /** Only fills within the last N days — bounds auto rebuilds so they don't re-score the whole history. */
  sinceDays?: number;
}

/** How far back the AUTOMATIC (nightly / on-boot) rules-rebuild reaches. Manual /rebuild is unbounded. */
export const RECENT_REBUILD_DAYS = 180;

/**
 * Collect EVERY matching transaction id for an org, paging past PostgREST's 1000-row cap (a single
 * .select() silently returns only the first 1000 — so an un-paged backfill skips everything beyond it).
 * Optional filters keep routine runs cheap: onlyUnreconciled = never-reconciled rows; sinceDays = recent.
 */
export async function collectTxnIds(admin: SupabaseClient, orgId: string, opts: { onlyUnreconciled?: boolean; sinceDays?: number } = {}): Promise<string[]> {
  const PAGE = 1000;
  const ids: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = admin.from("fuel_transactions").select("id").eq("org_id", orgId);
    if (opts.onlyUnreconciled) q = q.is("samsara_recon_at", null);
    if (opts.sinceDays != null) q = q.gte("fueled_at", new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString());
    const { data } = await q
      .order("vehicle_id", { ascending: true })
      .order("fueled_at", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    const batch = ((data ?? []) as { id: string }[]).map((x) => x.id);
    ids.push(...batch);
    if (batch.length < PAGE) break;
  }
  return ids;
}

