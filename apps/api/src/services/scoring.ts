import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runAllRules,
  reconcileAnomalies,
  maxSeverity,
  milesSinceLast,
  computedMpg,
  type TxnView,
  type VehicleView,
  type Thresholds,
  type OperatingHours,
  type ExistingAnomaly,
  type FueledAtPrecision,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { reconcileWithSamsara } from "./samsaraRecon.js";

const FTXN_COLS =
  "id, org_id, vehicle_id, driver_id, fueled_at, odometer, gallons, price_per_gal, total_cost, version, source, card_ref, city, state, location_text";

const ODOMETER_RULE_IDS = [
  "odometer_missing",
  "odometer_regression",
  "odometer_stale",
  "odometer_implausible_jump",
  "odometer_daily_cap",
  "odometer_mismatch",
];

const n = (v: unknown): number | null => (v == null ? null : Number(v));
const precisionFromSource = (source: string): FueledAtPrecision => (source === "manual" ? "instant" : "date");

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

interface FtxnRow {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  fueled_at: string;
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
    fueledAtPrecision: precisionFromSource(r.source),
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
    odometerToleranceMiles: n(data?.odometer_tolerance_miles) ?? 5,
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
export async function scoreTransaction(admin: SupabaseClient, env: Env, orgId: string, txnId: string): Promise<void> {
  const { data: row } = await admin.from("fuel_transactions").select(FTXN_COLS).eq("id", txnId).eq("org_id", orgId).single();
  if (!row) return;
  const r = row as FtxnRow;
  const txn = toTxnView(r);

  let vehicle: VehicleView = { id: "none", fuelType: "other", tankCapacityGal: 0, baselineMpg: null };
  let samsaraVehicleId: string | null = null;
  if (txn.vehicleId) {
    const { data: v } = await admin.from("vehicles").select("id, fuel_type, tank_capacity_gal, baseline_mpg, samsara_vehicle_id").eq("id", txn.vehicleId).single();
    if (v) {
      vehicle = { id: v.id, fuelType: v.fuel_type, tankCapacityGal: Number(v.tank_capacity_gal), baselineMpg: n(v.baseline_mpg) };
      samsaraVehicleId = v.samsara_vehicle_id ?? null;
    }
  }

  const thresholds = await loadThresholds(admin, orgId);
  const operatingHours = await loadOperatingHours(admin, orgId);
  const windowMs = (thresholds.cumulativeWindowHours ?? 48) * 3_600_000;
  let txnTime = new Date(txn.fueledAt).getTime();
  const winStart = () => new Date(txnTime - windowMs).toISOString();

  // ── Samsara reconciliation: the ±5 odometer truth + recovered fueling time + location check ──
  let crossSourceOdometer: number | null = null;
  let samsaraLocationMatched: boolean | null = null;
  let locationEvidence: Record<string, unknown> | null = null;
  let reconAt: string | null = null;
  let tankFillShortGal: number | null = null;
  let tankObservedRiseGal: number | null = null;
  // The EFS fueling time is "precise" when it carries a real time-of-day (timed report / manual),
  // not the date-only noon sentinel. Only then can we compare Samsara's position at the exact minute.
  const preciseTime = r.source === "manual" || !isNoonSentinel(txn.fueledAt);
  if (txn.vehicleId) {
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
      locationEvidence = recon.locationEvidence;
      reconAt = recon.matchedAt;
      tankFillShortGal = recon.tankFillShortGal;
      tankObservedRiseGal = recon.tankObservedRiseGal;
      if (preciseTime) {
        // Timed report / manual: the reported time IS the fueling time → enable time-based rules.
        txn.fueledAtPrecision = "instant";
      } else if (recon.matchedAt) {
        // Date-only EFS: recover the precise time from the telematics stop, so time-based rules work.
        txn.fueledAt = recon.matchedAt;
        txn.fueledAtPrecision = "instant";
        txnTime = new Date(recon.matchedAt).getTime();
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
    previousTxn = rows.length ? toTxnView(rows[0]!) : null;

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
  });

  const { data: existing } = await admin.from("anomalies").select("id, rule_id, status, source").eq("transaction_id", txnId);
  const { toInsert, toSupersedeIds } = reconcileAnomalies((existing ?? []) as ExistingAnomaly[], fired);

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
    });
    if (error && error.code !== "23505") throw new Error(error.message);
  }
  if (toSupersedeIds.length) {
    await admin.from("anomalies").update({ status: "superseded" }).in("id", toSupersedeIds);
  }

  await admin
    .from("fuel_transactions")
    .update({
      miles_since_last: milesSinceLast(txn, previousTxn),
      computed_mpg: computedMpg(txn, previousTxn),
      has_anomaly: fired.length > 0,
      max_severity: maxSeverity(fired),
      samsara_odometer: crossSourceOdometer,
      samsara_location_matched: samsaraLocationMatched,
      samsara_tank_short_gal: tankFillShortGal,
      samsara_tank_observed_gal: tankObservedRiseGal,
      samsara_recon_at: reconAt,
      ...(reconAt ? { fueled_at: txn.fueledAt } : {}),
    })
    .eq("id", txnId);

  if (txn.vehicleId) {
    const { data: maxRow } = await admin
      .from("fuel_transactions")
      .select("odometer")
      .eq("vehicle_id", txn.vehicleId)
      .not("odometer", "is", null)
      .order("odometer", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxRow?.odometer != null) {
      await admin.from("vehicles").update({ current_odometer: maxRow.odometer }).eq("id", txn.vehicleId);
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

/** Backfill: score every transaction for an org in (vehicle, fueled_at) order. Used after seeding. */
export async function backfillOrg(admin: SupabaseClient, env: Env, orgId: string): Promise<number> {
  const { data: rows } = await admin
    .from("fuel_transactions")
    .select("id")
    .eq("org_id", orgId)
    .order("vehicle_id", { ascending: true })
    .order("fueled_at", { ascending: true })
    .order("created_at", { ascending: true });
  const ids = ((rows ?? []) as { id: string }[]).map((x) => x.id);
  for (const id of ids) await scoreTransaction(admin, env, orgId, id);
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
