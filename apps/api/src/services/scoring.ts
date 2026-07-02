import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runAllRules,
  reconcileAnomalies,
  correlateSignals,
  CASE_RULE_ID,
  milesSinceLast,
  computedMpg,
  effectiveBaseline,
  learnOdometerOffset,
  type TxnView,
  type VehicleView,
  type Thresholds,
  type OperatingHours,
  type ExistingAnomaly,
  type FueledAtPrecision,
  type RuleResult,
  type RuleId,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { reconcileWithSamsara } from "./samsaraRecon.js";

const FTXN_COLS =
  "id, org_id, vehicle_id, driver_id, fueled_at, fueled_at_precision, odometer, gallons, price_per_gal, total_cost, version, source, card_ref, city, state, location_text, samsara_odometer, samsara_location_matched, samsara_location_confidence, station_lat, station_lng, samsara_tank_short_gal, samsara_tank_observed_gal, samsara_fuel_pct_before, samsara_recon_at";

const ODOMETER_RULE_IDS = [
  "odometer_missing",
  "odometer_regression",
  "odometer_stale",
  "odometer_implausible_jump",
  "odometer_daily_cap",
  "odometer_mismatch",
];

const n = (v: unknown): number | null => (v == null ? null : Number(v));

/** True when an ISO instant is exactly the EFS date-only sentinel (noon UTC) → no real time-of-day. */
function isNoonSentinel(iso: string): boolean {
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
function rowPrecision(r: Pick<FtxnRow, "fueled_at" | "fueled_at_precision" | "source">): FueledAtPrecision {
  if (r.fueled_at_precision === "instant" || r.fueled_at_precision === "date") return r.fueled_at_precision;
  if (r.source === "manual") return "instant";
  return isNoonSentinel(r.fueled_at) ? "date" : "instant";
}

interface FtxnRow {
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
  city: string | null;
  state: string | null;
  location_text: string | null;
  samsara_odometer: number | string | null;
  samsara_location_matched: boolean | null;
  samsara_location_confidence: string | null;
  station_lat: number | string | null;
  station_lng: number | string | null;
  samsara_tank_short_gal: number | string | null;
  samsara_tank_observed_gal: number | string | null;
  samsara_fuel_pct_before: number | string | null;
  samsara_recon_at: string | null;
}

function toTxnView(r: FtxnRow): TxnView {
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    driverId: r.driver_id,
    fueledAt: r.fueled_at,
    odometer: n(r.odometer),
    gallons: Number(r.gallons),
    pricePerGal: n(r.price_per_gal),
    totalCost: n(r.total_cost),
    fueledAtPrecision: rowPrecision(r),
    cardRef: r.card_ref,
  };
}

async function loadThresholds(admin: SupabaseClient, orgId: string): Promise<Thresholds> {
  const { data } = await admin
    .from("anomaly_thresholds")
    .select("mpg_drop_pct, capacity_tolerance_pct, rapid_refuel_hours, max_plausible_mph, cost_min_per_gal, cost_max_per_gal, disabled_rules, odometer_tolerance_miles, max_daily_miles, cumulative_window_hours")
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
  };
}

async function loadOperatingHours(admin: SupabaseClient, orgId: string): Promise<OperatingHours> {
  const { data } = await admin.from("organizations").select("operating_hours").eq("id", orgId).single();
  const oh = (data?.operating_hours ?? {}) as Partial<OperatingHours>;
  return { start: oh.start ?? "05:00", end: oh.end ?? "20:00", tz: oh.tz ?? "America/Chicago" };
}

/** Score a single transaction: assemble context (incl. Samsara reconciliation), run the engine, persist. */
export interface ScoreOpts {
  /**
   * Reuse the Samsara values already stored on the transaction instead of making a fresh live call.
   * Used by bulk rebuilds so re-scoring thousands of historical rows doesn't hammer the Samsara API
   * (and stay within rate limits). New imports use a fresh reconciliation (skipRecon=false).
   */
  skipRecon?: boolean;
}

export async function scoreTransaction(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  txnId: string,
  opts: ScoreOpts = {},
): Promise<void> {
  const { data: row } = await admin.from("fuel_transactions").select(FTXN_COLS).eq("id", txnId).eq("org_id", orgId).single();
  if (!row) return;
  const r = row as FtxnRow;
  const txn = toTxnView(r);

  let vehicle: VehicleView = { id: "none", fuelType: "other", tankCapacityGal: 0, baselineMpg: null };
  let samsaraVehicleId: string | null = null;
  let odometerOffsetSource = "auto";
  if (txn.vehicleId) {
    const { data: v } = await admin.from("vehicles").select("id, fuel_type, tank_capacity_gal, baseline_mpg, samsara_vehicle_id, odometer_offset, odometer_offset_source").eq("id", txn.vehicleId).single();
    if (v) {
      vehicle = { id: v.id, fuelType: v.fuel_type, tankCapacityGal: Number(v.tank_capacity_gal), baselineMpg: n(v.baseline_mpg), odometerOffset: n(v.odometer_offset) ?? 0 };
      samsaraVehicleId = v.samsara_vehicle_id ?? null;
      odometerOffsetSource = (v.odometer_offset_source as string) ?? "auto";
    }
  }

  const thresholds = await loadThresholds(admin, orgId);
  const operatingHours = await loadOperatingHours(admin, orgId);
  const windowMs = (thresholds.cumulativeWindowHours ?? 48) * 3_600_000;
  // Rolling windows are anchored on the STORED fueled_at (business time) — the same clock every other
  // row in the DB is on — never on the in-memory telematics-recovered instant.
  const storedTime = new Date(r.fueled_at).getTime();
  const winStart = () => new Date(storedTime - windowMs).toISOString();

  // ── Samsara reconciliation: the ±5 odometer truth + recovered fueling time + location check ──
  let crossSourceOdometer: number | null = null;
  let samsaraLocationMatched: boolean | null = null;
  let locationConfidence: string | null = null;
  let stationLat: number | null = null;
  let stationLng: number | null = null;
  let locationEvidence: Record<string, unknown> | null = null;
  let reconAt: string | null = null;
  let tankFillShortGal: number | null = null;
  let tankObservedRiseGal: number | null = null;
  let tankPctBefore: number | null = null;
  // The EFS fueling time is "precise" when it carries a real time-of-day (timed report / manual),
  // not the date-only noon sentinel. Only then can we compare Samsara's position at the exact minute.
  const preciseTime = txn.fueledAtPrecision === "instant";
  if (txn.vehicleId && opts.skipRecon) {
    // Rebuild path: trust the values the last live reconciliation already wrote to the row. The
    // stored fueled_at stays the EFS business date; the telematics-recovered instant lives in
    // samsara_recon_at and is applied IN MEMORY ONLY so time-based rules can run.
    crossSourceOdometer = n(r.samsara_odometer);
    samsaraLocationMatched = r.samsara_location_matched ?? null;
    locationConfidence = r.samsara_location_confidence ?? null;
    stationLat = n(r.station_lat);
    stationLng = n(r.station_lng);
    tankFillShortGal = n(r.samsara_tank_short_gal);
    tankObservedRiseGal = n(r.samsara_tank_observed_gal);
    tankPctBefore = n(r.samsara_fuel_pct_before);
    reconAt = r.samsara_recon_at ?? null;
    if (!preciseTime && reconAt) {
      txn.fueledAt = reconAt;
      txn.fueledAtPrecision = "instant";
    }
  } else if (txn.vehicleId) {
    const recon = await reconcileWithSamsara(admin, env, orgId, {
      vehicleId: txn.vehicleId,
      samsaraVehicleId,
      fueledAt: txn.fueledAt,
      city: r.city,
      state: r.state,
      locationName: r.location_text,
      preciseTime,
      gallons: txn.gallons,
      tankCapacityGal: vehicle.tankCapacityGal || null,
    }).catch(() => null);
    if (recon) {
      crossSourceOdometer = recon.crossSourceOdometer;
      samsaraLocationMatched = recon.locationMatched;
      locationConfidence = recon.locationConfidence;
      stationLat = recon.stationLat;
      stationLng = recon.stationLng;
      locationEvidence = recon.locationEvidence;
      reconAt = recon.matchedAt;
      tankFillShortGal = recon.tankFillShortGal;
      tankObservedRiseGal = recon.tankObservedRiseGal;
      tankPctBefore = recon.tankPctBefore;
      if (!preciseTime && recon.matchedAt) {
        // Date-only EFS: recover the precise time from the telematics stop so time-based rules can
        // run — IN MEMORY ONLY. The stored fueled_at keeps the EFS business date (rewriting it moved
        // spend onto neighboring dates on the dashboard and reordered the MPG chain).
        txn.fueledAt = recon.matchedAt;
        txn.fueledAtPrecision = "instant";
      }
    }
  }

  let previousTxn: TxnView | null = null;
  let recentTxns: TxnView[] = [];
  let windowGallons = 0;
  let windowMiles: number | null = null;
  let cardVehicleCountInWindow = 0;

  if (txn.vehicleId) {
    const { data: prevRows } = await admin
      .from("fuel_transactions")
      .select(FTXN_COLS)
      .eq("vehicle_id", txn.vehicleId)
      .lt("fueled_at", r.fueled_at)
      .not("odometer", "is", null)
      .order("fueled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(12);
    const rows = (prevRows ?? []) as FtxnRow[];

    const candidateIds = rows.map((x) => x.id);
    let badIds = new Set<string>();
    if (candidateIds.length) {
      const { data: anoms } = await admin
        .from("anomalies")
        .select("transaction_id, rule_id, status")
        .in("transaction_id", candidateIds)
        .neq("status", "superseded")
        .in("rule_id", ODOMETER_RULE_IDS);
      badIds = new Set((anoms ?? []).map((a) => a.transaction_id as string));
    }
    // Previous fill = the most recent fill whose odometer is NOT already flagged as anomalous.
    // Comparing against a known-bad reading (a typo) cascaded false regressions / MPG anomalies onto
    // every correct entry that followed it — same exclusion recentTxns has always applied.
    const prevRow = rows.find((x) => !badIds.has(x.id)) ?? null;
    previousTxn = prevRow ? toTxnView(prevRow) : null;
    recentTxns = rows.filter((x) => !badIds.has(x.id)).slice(0, 6).map(toTxnView).reverse();

    const { data: winRows } = await admin
      .from("fuel_transactions")
      .select("gallons, odometer")
      .eq("vehicle_id", txn.vehicleId)
      .gte("fueled_at", winStart())
      .lte("fueled_at", r.fueled_at);
    const wr = (winRows ?? []) as { gallons: number | string; odometer: number | string | null }[];
    windowGallons = wr.reduce((s, x) => s + Number(x.gallons), 0);
    const odos = wr.map((x) => n(x.odometer)).filter((x): x is number => x != null);
    windowMiles = odos.length >= 2 ? Math.max(...odos) - Math.min(...odos) : null;
  }

  if (txn.cardRef) {
    const { data: cardRows } = await admin
      .from("fuel_transactions")
      .select("vehicle_id")
      .eq("org_id", orgId)
      .eq("card_ref", txn.cardRef)
      .gte("fueled_at", winStart())
      .lte("fueled_at", r.fueled_at);
    cardVehicleCountInWindow = new Set((cardRows ?? []).map((x) => x.vehicle_id).filter(Boolean)).size;
  }

  const fired = runAllRules({
    txn,
    vehicle,
    previousTxn,
    recentTxns,
    thresholds,
    operatingHours,
    crossSourceOdometer,
    windowGallons,
    windowMiles,
    cardVehicleCountInWindow,
    samsaraLocationMatched,
    locationEvidence,
    tankFillShortGal,
    tankObservedRiseGal,
    tankPctBefore,
  });

  // Correlate the fired signals into ONE per-transaction case (multi-signal model). A lone weak signal
  // stays "clear" (no anomaly) so normal fills don't all look flagged; independent corroborating signals
  // (or one physically-impossible one) become a single "theft_case" alert.
  const assessment = correlateSignals(fired);
  const caseFired: RuleResult[] =
    assessment.level === "clear"
      ? []
      : [{ ruleId: CASE_RULE_ID as RuleId, fired: true, severity: assessment.severity!, message: assessment.summary, evidence: { level: assessment.level, score: assessment.score, axes: assessment.axes, signals: assessment.signals } }];

  const { data: existing } = await admin.from("anomalies").select("id, rule_id, status, source").eq("transaction_id", txnId);
  const { toInsert, toSupersedeIds } = reconcileAnomalies((existing ?? []) as ExistingAnomaly[], caseFired);

  for (const res of toInsert) {
    const { error } = await admin.from("anomalies").insert({
      org_id: orgId,
      transaction_id: txnId,
      vehicle_id: txn.vehicleId,
      rule_id: res.ruleId,
      severity: res.severity,
      status: "open",
      message: res.message,
      evidence: res.evidence,
      source: "rules",
      // Denormalized for queue filtering — the STORED business time, consistent with the fuel log.
      fueled_at: r.fueled_at,
    });
    if (error && error.code !== "23505") throw new Error(error.message);
  }
  if (toSupersedeIds.length) {
    await admin.from("anomalies").update({ status: "superseded" }).in("id", toSupersedeIds);
  }

  // Refresh an already-open case in place when the signals changed (rebuild/re-score) — but never
  // disturb one a reviewer has moved to investigating/resolved/dismissed.
  if (caseFired.length) {
    const openCase = (existing ?? []).find((a) => a.rule_id === CASE_RULE_ID && a.status === "open");
    if (openCase && !toInsert.length) {
      const c = caseFired[0]!;
      await admin.from("anomalies").update({ severity: c.severity, message: c.message, evidence: c.evidence, fueled_at: r.fueled_at }).eq("id", openCase.id);
    }
  }

  await admin
    .from("fuel_transactions")
    .update({
      miles_since_last: milesSinceLast(txn, previousTxn),
      computed_mpg: computedMpg(txn, previousTxn),
      has_anomaly: assessment.level !== "clear",
      max_severity: assessment.severity,
      samsara_odometer: crossSourceOdometer,
      samsara_location_matched: samsaraLocationMatched,
      samsara_location_confidence: locationConfidence,
      station_lat: stationLat,
      station_lng: stationLng,
      samsara_tank_short_gal: tankFillShortGal,
      samsara_tank_observed_gal: tankObservedRiseGal,
      samsara_fuel_pct_before: tankPctBefore,
      // The telematics-recovered instant is stored HERE — never written over fueled_at. fueled_at
      // stays the EFS business time so dashboards, dedupe keys and the MPG chain remain stable.
      samsara_recon_at: reconAt,
    })
    .eq("id", txnId);

  if (txn.vehicleId) {
    const vehUpdate: Record<string, unknown> = {};
    // vehicles.current_odometer:
    //  - Samsara-linked truck → the periodic sync owns it (OBD reading, authoritative). Never
    //    overwrite it with a driver-entered value.
    //  - Unlinked truck → LATEST entered odometer, not MAX: one fat-fingered 9,999,999 under MAX
    //    poisoned the value forever; "latest" self-heals on the next correct entry.
    if (!samsaraVehicleId) {
      const { data: lastRow } = await admin
        .from("fuel_transactions")
        .select("odometer")
        .eq("vehicle_id", txn.vehicleId)
        .not("odometer", "is", null)
        .order("fueled_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastRow?.odometer != null) vehUpdate.current_odometer = lastRow.odometer;
    }

    // Auto-derive baseline MPG from the vehicle's own fuel history when it isn't set (Samsara has no
    // MPG). effectiveBaseline returns the median of recent computed MPG once there are ≥3 valid fills.
    if (vehicle.baselineMpg == null) {
      const base = effectiveBaseline(vehicle, recentTxns);
      if (base != null) vehUpdate.baseline_mpg = base;
    }

    // Auto-learn the odometer offset (dash − Samsara) from recent fills that carry BOTH readings, so a
    // truck whose dash sits a constant amount off OBD stops false-flagging. A manual override is never
    // overwritten. Median over the last 10 pairs; only applied once they cluster tightly (learner's rules).
    if (odometerOffsetSource !== "manual") {
      const { data: pairRows } = await admin
        .from("fuel_transactions")
        .select("odometer, samsara_odometer")
        .eq("vehicle_id", txn.vehicleId)
        .not("odometer", "is", null)
        .not("samsara_odometer", "is", null)
        .order("fueled_at", { ascending: false })
        .limit(10);
      const pairs = ((pairRows ?? []) as { odometer: number | string; samsara_odometer: number | string }[])
        .map((p) => ({ entered: Number(p.odometer), samsara: Number(p.samsara_odometer) }))
        .reverse(); // OLDEST→NEWEST so the learner's `window` keeps the most recent
      const learned = learnOdometerOffset(pairs);
      if (learned && learned.offset !== (vehicle.odometerOffset ?? 0)) {
        vehUpdate.odometer_offset = learned.offset;
        vehUpdate.odometer_offset_source = "auto";
      }
    }

    if (Object.keys(vehUpdate).length) {
      await admin.from("vehicles").update(vehUpdate).eq("id", txn.vehicleId);
    }
  }
}

/** Score a transaction and re-score the following fills within the baseline window (docs/09 P1.6). */
export async function scoreWithCascade(admin: SupabaseClient, env: Env, orgId: string, txnId: string): Promise<void> {
  await scoreTransaction(admin, env, orgId, txnId);
  const { data: row } = await admin.from("fuel_transactions").select("vehicle_id, fueled_at").eq("id", txnId).single();
  if (!row?.vehicle_id) return;
  const { data: next } = await admin
    .from("fuel_transactions")
    .select("id")
    .eq("vehicle_id", row.vehicle_id)
    .gt("fueled_at", row.fueled_at)
    .order("fueled_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(5);
  for (const x of ((next ?? []) as { id: string }[])) await scoreTransaction(admin, env, orgId, x.id);
}

/**
 * Backfill / rebuild: score every transaction for an org in (vehicle, fueled_at) order. Pass
 * skipRecon=true for a rebuild of existing data so it reuses stored Samsara values (no live API spam).
 */
export async function backfillOrg(admin: SupabaseClient, env: Env, orgId: string, opts: ScoreOpts = {}): Promise<number> {
  const { data: rows } = await admin
    .from("fuel_transactions")
    .select("id")
    .eq("org_id", orgId)
    .order("vehicle_id", { ascending: true })
    .order("fueled_at", { ascending: true })
    .order("created_at", { ascending: true });
  const ids = ((rows ?? []) as { id: string }[]).map((x) => x.id);
  for (const id of ids) await scoreTransaction(admin, env, orgId, id, opts);
  return ids.length;
}

/** Score only the transactions from one import (post-import) — far cheaper than a full org backfill. */
export async function scoreImport(admin: SupabaseClient, env: Env, orgId: string, importId: string): Promise<number> {
  const { data: rows } = await admin
    .from("fuel_transactions")
    .select("id")
    .eq("org_id", orgId)
    .eq("import_id", importId)
    .order("vehicle_id", { ascending: true })
    .order("fueled_at", { ascending: true })
    .order("created_at", { ascending: true });
  const ids = ((rows ?? []) as { id: string }[]).map((x) => x.id);
  for (const id of ids) await scoreTransaction(admin, env, orgId, id);
  return ids.length;
}
