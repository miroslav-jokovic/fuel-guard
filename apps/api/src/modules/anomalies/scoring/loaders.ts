/** Scoring helpers: row types, txn-view mapping, threshold/hours loaders, txn-id collection. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TxnView, Thresholds, OperatingHours, FueledAtPrecision } from "@silvicom/shared";

export const FTXN_COLS =
  "id, org_id, vehicle_id, driver_id, fueled_at, fueled_at_precision, odometer, gallons, price_per_gal, total_cost, version, source, card_ref, control_id, city, state, location_text, tank_type, samsara_odometer, samsara_odometer_at, samsara_odometer_source, samsara_location_matched, samsara_location_confidence, samsara_nearest_station_miles, station_lat, station_lng, samsara_tank_short_gal, samsara_tank_observed_gal, samsara_fuel_pct_before, samsara_fuel_pct_after, samsara_observed_state, samsara_observed_city, samsara_observed_address, samsara_observed_lat, samsara_observed_lng, fueling_time_basis, samsara_recon_at, samsara_recon_checked_at, samsara_recon_status, samsara_recon_error, samsara_recon_evidence_version, is_canonical, duplicate_of, ambient_temp_f, case_level, case_signals, attribution_verdict, logbook_vehicle_id, created_at";

/** Query slack covers the existing Samsara reconciliation windows; event-time filtering remains exact in memory. */
export const EVENT_TIME_QUERY_SLACK_MS = 36 * 3_600_000;

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
export function rowPrecision(
  r: Pick<FtxnRow, "fueled_at" | "fueled_at_precision" | "source">,
): FueledAtPrecision {
  if (r.fueled_at_precision === "instant" || r.fueled_at_precision === "date")
    return r.fueled_at_precision;
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
  samsara_recon_checked_at: string | null;
  samsara_recon_status: string | null;
  samsara_recon_error: string | null;
  samsara_recon_evidence_version: number | string | null;
  is_canonical: boolean;
  duplicate_of: string | null;
  ambient_temp_f?: number | string | null;
  case_level?: string | null;
  case_signals?: { ruleId: string }[] | null;
  /** WP-ATTR — logbook check of the fill's vehicle attribution ('confirmed' | 'suspect' | 'unknown'). */
  attribution_verdict?: string | null;
  logbook_vehicle_id?: string | null;
  created_at: string;
}

export function rowEventTime(r: Pick<FtxnRow, "fueled_at" | "fueled_at_precision" | "source" | "fueling_time_basis" | "samsara_recon_at" | "samsara_location_matched">): string {
  const tankConfirmed = r.fueling_time_basis === "tank_confirmed";
  const telemMatched = r.samsara_recon_at != null && r.samsara_location_matched === true;
  return (tankConfirmed || telemMatched) && r.samsara_recon_at != null ? r.samsara_recon_at : r.fueled_at;
}

export function rowTimeReliable(r: Pick<FtxnRow, "fueled_at_precision" | "source" | "fueling_time_basis" | "samsara_recon_at" | "samsara_location_matched">): boolean {
  const tankConfirmed = r.fueling_time_basis === "tank_confirmed";
  const telemMatched = r.samsara_recon_at != null && r.samsara_location_matched === true;
  return tankConfirmed || telemMatched || r.source === "manual";
}

/** Oldest-to-newest ordering for temporal scoring. Equal event times use business time, creation time, then id. */
export function compareTxnRows(a: FtxnRow, b: FtxnRow): number {
  return Date.parse(rowEventTime(a)) - Date.parse(rowEventTime(b))
    || Date.parse(a.fueled_at) - Date.parse(b.fueled_at)
    || Date.parse(a.created_at) - Date.parse(b.created_at)
    || a.id.localeCompare(b.id);
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
  const eventAt = rowEventTime(r);
  const timeConfirmed = rowTimeReliable(r);
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
    state: r.state,
    city: r.city,
    locationText: r.location_text,
    // WP-BEH: resolved station pin — distance-based same-site / impossible-travel inputs.
    stationLat: n(r.station_lat),
    stationLng: n(r.station_lng),
  };
}

export async function loadThresholds(admin: SupabaseClient, orgId: string): Promise<Thresholds> {
  const { data } = await admin
    .from("anomaly_thresholds")
    .select(
      "mpg_drop_pct, capacity_tolerance_pct, rapid_refuel_hours, max_plausible_mph, cost_min_per_gal, cost_max_per_gal, disabled_rules, odometer_tolerance_miles, max_daily_miles, cumulative_window_hours, max_reefer_burn_gph, reefer_tank_default_gal, reefer_diversion_window_days, reefer_diversion_min_tractor_gal, reefer_diversion_max_reefer_gal",
    )
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

export async function loadOperatingHours(
  admin: SupabaseClient,
  orgId: string,
): Promise<OperatingHours> {
  const { data } = await admin
    .from("organizations")
    .select("operating_hours")
    .eq("id", orgId)
    .single();
  const oh = (data?.operating_hours ?? {}) as Partial<OperatingHours>;
  // WP7: an org that never CONFIGURED hours gets the 24/7 sentinel (start === end → off_hours never
  // fires) — we no longer alert against a silently assumed 05:00–20:00 schedule. Orgs that set hours
  // keep them verbatim.
  if (!oh.start || !oh.end) return { start: "00:00", end: "00:00", tz: oh.tz ?? "America/Chicago" };
  return { start: oh.start, end: oh.end, tz: oh.tz ?? "America/Chicago" };
}

/**
 * EVERY tractor fill in a business-time span — the fuel universe intermediate-gallons is summed from.
 *
 * Deliberately unfiltered beyond vehicle + tank: no `.not("odometer","is",null)`, no case/attribution
 * exclusion. A fill that was skipped when picking previousTxn (blank odometer, flagged entry,
 * logbook-suspect) still put real fuel in the tank inside the odometer span, and that is exactly the
 * fuel this span accounting exists to recover (WP4).
 *
 * Split out of the old `sumIntermediateGallons` for audit 2026-08-09 finding B: the fill under test got
 * its intermediate gallons from this query while each BASELINE fill derived the same figure from the
 * previous-fill candidate rows — which carry `.not("odometer","is",null)`. Blank-odometer fills were
 * therefore charged to the fill under test and omitted from every baseline, so three such gaps lifted a
 * true-6.0-MPG truck's median baseline to 9–10 and the next honest fill fired `mpg_deviation` against
 * its own history. One loader + one pure summer means both sides can only ever see the same fuel.
 */
export async function loadSpanFills(
  admin: SupabaseClient,
  vehicleId: string,
  fromRow: FtxnRow,
  toRow: FtxnRow,
): Promise<FtxnRow[]> {
  const fromMs = Date.parse(fromRow.fueled_at);
  const toMs = Date.parse(toRow.fueled_at);
  const fromIso = new Date(Math.min(fromMs, toMs)).toISOString();
  const toIso = new Date(Math.max(fromMs, toMs)).toISOString();
  const { data } = await admin
    .from("fuel_transactions")
    .select(FTXN_COLS)
    .eq("vehicle_id", vehicleId)
    .eq("tank_type", "tractor")
    .gte("fueled_at", fromIso)
    .lte("fueled_at", toIso);
  return (data ?? []) as FtxnRow[];
}

/**
 * Gallons from tractor fills strictly BETWEEN two fills, in event-time order (WP4). Pure — it sums
 * whatever `spanFills` contains, so the caller's single `loadSpanFills` result serves the fill under
 * test and every baseline fill identically (audit 2026-08-09, finding B).
 */
export function sumGallonsBetween(
  spanFills: FtxnRow[],
  previous: FtxnRow,
  current: FtxnRow,
  excludeId: string,
): number {
  return spanFills
    .filter((x) => x.id !== excludeId && compareTxnRows(x, previous) > 0 && compareTxnRows(x, current) < 0)
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
  /** WP-ATTR recursion guard: set on the single re-score after a corroborated logbook re-attribution so a
   *  fill can never re-attribute more than once per scoring pass. */
  reattributed?: boolean;
}

/** Bulk-scope filters for backfillOrg — keep routine runs incremental instead of re-processing history. */
export interface BackfillOpts extends ScoreOpts {
  /** Only rows never Samsara-reconciled (samsara_recon_at IS NULL) — the routine "catch up new fills". */
  onlyUnreconciled?: boolean;
  /** Only fills within the last N days — bounds auto rebuilds so they don't re-score the whole history. */
  sinceDays?: number;
  /**
   * The RE-SCORE TIER's claim (0318): the oldest fills whose `scoring_version` is below this number,
   * i.e. judged by rules that have since changed. Paired with `limit` so one nightly pass takes a bite
   * it can finish, and the backlog drains over several nights rather than in one three-hour sweep.
   */
  staleScoringVersion?: number;
  /** Cap on how many fills one pass claims. Without it a stale-stamp sweep is the full-history sweep. */
  limit?: number;
  /**
   * The COLLECTOR TIER's claim (SAM-S3): the oldest `limit` fills that still have no stored telematics
   * and have not been attempted within `retryAfterHours`.
   *
   * ── WHY IT IS TWO CONDITIONS AND NOT ONE ─────────────────────────────────────────────────────────
   * "Needs data" is `samsara_recon_at is null` — 10,644 of 13,711 tractor fills, measured 2026-09-01.
   * On its own that predicate NEVER CLEARS for a fill Samsara has no history for: 32 rows come back
   * `no_data`, keep a null `samsara_recon_at`, and would therefore be re-claimed on every single tick.
   * Oldest-first would then wedge the tier on the same 32 rows forever and the other 10,612 would never
   * be reached — a scheduler that runs every hour and makes no progress, which is worse than none
   * because it looks busy.
   *
   * "Not attempted recently" is the cooldown, read from `samsara_recon_checked_at`, which
   * `resolveReconciliation` stamps on EVERY attempt including a failed or empty one. That is what lets
   * an attempt clear the claim while still allowing a genuine retry later — the Done-when's "a fill
   * that missed its chance is retried rather than abandoned".
   *
   * ⚠ Claiming on `samsara_recon_checked_at is null` ALONE would be wrong in the other direction:
   * 1,087 fills carry stored telematics from before that column existed, so they would be re-fetched
   * for data we already hold. Both halves are load-bearing.
   */
  reconClaim?: { limit: number; retryAfterHours: number };
}

/** How far back the AUTOMATIC (nightly / on-boot) rules-rebuild reaches. Manual /rebuild is unbounded. */
export const RECENT_REBUILD_DAYS = 180;

/**
 * Collect EVERY matching transaction id for an org, paging past PostgREST's 1000-row cap (a single
 * .select() silently returns only the first 1000 — so an un-paged backfill skips everything beyond it).
 * Optional filters keep routine runs cheap: onlyUnreconciled = never-reconciled rows; sinceDays = recent.
 */
export async function collectTxnIds(
  admin: SupabaseClient,
  orgId: string,
  opts: { onlyUnreconciled?: boolean; sinceDays?: number; staleScoringVersion?: number; limit?: number } = {},
): Promise<string[]> {
  const PAGE = 1000;
  const ids: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = admin.from("fuel_transactions").select("id").eq("org_id", orgId);
    if (opts.onlyUnreconciled) q = q.is("samsara_recon_at", null);
    if (opts.sinceDays != null)
      q = q.gte("fueled_at", new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString());
    // The stale-stamp claim (0318). `or` rather than `lt` because a fill scored before the column
    // existed carries NULL, and NULL fails every comparison — `lt` alone would silently skip exactly
    // the rows with the MOST catching up to do, which is the whole backlog on the first sweep.
    if (opts.staleScoringVersion != null)
      q = q.or(`scoring_version.is.null,scoring_version.lt.${opts.staleScoringVersion}`);
    // Oldest stamp first so a bounded nightly batch drains the backlog in a stable order instead of
    // re-touching whatever happens to sort first. `nulls first` matches idx_fuel_transactions_scoring_version.
    const ordered = opts.staleScoringVersion != null
      ? q.order("scoring_version", { ascending: true, nullsFirst: true }).order("fueled_at", { ascending: true })
      : q.order("vehicle_id", { ascending: true }).order("fueled_at", { ascending: true }).order("created_at", { ascending: true });
    const want = opts.limit != null ? Math.min(PAGE, opts.limit - ids.length) : PAGE;
    if (want <= 0) break;
    const { data } = await ordered.range(offset, offset + want - 1);
    const batch = ((data ?? []) as { id: string }[]).map((x) => x.id);
    // Truncate locally rather than trusting the row count to match what `range` asked for. The cap is
    // the whole promise of this claim — a stale-stamp pass that overshoots it is the full-history sweep
    // it exists to replace — so the invariant is enforced where it is stated, not one layer away.
    const room = opts.limit != null ? opts.limit - ids.length : batch.length;
    ids.push(...batch.slice(0, room));
    if (batch.length < want) break;
    if (opts.limit != null && ids.length >= opts.limit) break;
  }
  return ids;
}
