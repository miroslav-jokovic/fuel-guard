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
} from "@fleetguard/shared";

const FTXN_COLS =
  "id, org_id, vehicle_id, driver_id, fueled_at, odometer, gallons, price_per_gal, total_cost, version, source, card_ref";

/** Odometer-integrity rule ids whose presence makes a prior fill unfit for the baseline (docs/09 P0.3). */
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

/** Score a single transaction: assemble context, run the engine, reconcile anomalies, update fields. */
export async function scoreTransaction(admin: SupabaseClient, orgId: string, txnId: string): Promise<void> {
  const { data: row } = await admin.from("fuel_transactions").select(FTXN_COLS).eq("id", txnId).eq("org_id", orgId).single();
  if (!row) return;
  const txn = toTxnView(row as FtxnRow);

  let vehicle: VehicleView = { id: "none", fuelType: "other", tankCapacityGal: 0, baselineMpg: null };
  if (txn.vehicleId) {
    const { data: v } = await admin.from("vehicles").select("id, fuel_type, tank_capacity_gal, baseline_mpg").eq("id", txn.vehicleId).single();
    if (v) vehicle = { id: v.id, fuelType: v.fuel_type, tankCapacityGal: Number(v.tank_capacity_gal), baselineMpg: n(v.baseline_mpg) };
  }

  const thresholds = await loadThresholds(admin, orgId);
  const operatingHours = await loadOperatingHours(admin, orgId);
  const windowMs = (thresholds.cumulativeWindowHours ?? 48) * 3_600_000;
  const txnTime = new Date(txn.fueledAt).getTime();
  const winStart = new Date(txnTime - windowMs).toISOString();

  let previousTxn: TxnView | null = null;
  let recentTxns: TxnView[] = [];
  let crossSourceOdometer: number | null = null;
  let windowGallons = 0;
  let windowMiles: number | null = null;
  let cardVehicleCountInWindow = 0;

  if (txn.vehicleId) {
    // Prior fills with an odometer, newest first (deterministic tiebreak by created_at, id).
    const { data: prevRows } = await admin
      .from("fuel_transactions")
      .select(FTXN_COLS)
      .eq("vehicle_id", txn.vehicleId)
      .lt("fueled_at", txn.fueledAt)
      .not("odometer", "is", null)
      .order("fueled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(12);
    const rows = (prevRows ?? []) as FtxnRow[];

    // Immediate prior (even if itself anomalous) — used for regression/jump/this-fill MPG.
    previousTxn = rows.length ? toTxnView(rows[0]!) : null;

    // Baseline series excludes odometer-anomalous fills (docs/09 P0.3).
    const candidateIds = rows.map((r) => r.id);
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
    recentTxns = rows
      .filter((r) => !badIds.has(r.id))
      .slice(0, 6)
      .map(toTxnView)
      .reverse(); // oldest→newest

    // Cross-source ±tolerance sibling: a fill of the *other* source for the same event.
    if (txn.odometer != null) {
      const { data: sibs } = await admin
        .from("fuel_transactions")
        .select("id, odometer, gallons, source, fueled_at")
        .eq("vehicle_id", txn.vehicleId)
        .neq("id", txn.id)
        .not("odometer", "is", null)
        .gte("fueled_at", new Date(txnTime - 36 * 3_600_000).toISOString())
        .lte("fueled_at", new Date(txnTime + 36 * 3_600_000).toISOString());
      const thisManual = txn.fueledAtPrecision === "instant"; // manual = instant
      let best: { odo: number; dt: number } | null = null;
      for (const s of (sibs ?? []) as { odometer: number | string; gallons: number | string; source: string; fueled_at: string }[]) {
        const sibManual = s.source === "manual";
        if (sibManual === thisManual) continue; // need the opposite source
        const g = Number(s.gallons);
        if (txn.gallons > 0 && Math.abs(g - txn.gallons) / txn.gallons > 0.15) continue; // same fueling event
        const dt = Math.abs(new Date(s.fueled_at).getTime() - txnTime);
        if (!best || dt < best.dt) best = { odo: Number(s.odometer), dt };
      }
      crossSourceOdometer = best?.odo ?? null;
    }

    // Rolling window: gallons + miles span (for cumulative-overfuel).
    const { data: winRows } = await admin
      .from("fuel_transactions")
      .select("gallons, odometer")
      .eq("vehicle_id", txn.vehicleId)
      .gte("fueled_at", winStart)
      .lte("fueled_at", txn.fueledAt);
    const wr = (winRows ?? []) as { gallons: number | string; odometer: number | string | null }[];
    windowGallons = wr.reduce((s, r) => s + Number(r.gallons), 0);
    const odos = wr.map((r) => n(r.odometer)).filter((x): x is number => x != null);
    windowMiles = odos.length >= 2 ? Math.max(...odos) - Math.min(...odos) : null;
  }

  // Card → multiple vehicles in the window (card sharing).
  if (txn.cardRef) {
    const { data: cardRows } = await admin
      .from("fuel_transactions")
      .select("vehicle_id")
      .eq("org_id", orgId)
      .eq("card_ref", txn.cardRef)
      .gte("fueled_at", winStart)
      .lte("fueled_at", txn.fueledAt);
    cardVehicleCountInWindow = new Set((cardRows ?? []).map((r) => r.vehicle_id).filter(Boolean)).size;
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
  });

  const { data: existing } = await admin.from("anomalies").select("id, rule_id, status, source").eq("transaction_id", txnId);
  const { toInsert, toSupersedeIds } = reconcileAnomalies((existing ?? []) as ExistingAnomaly[], fired);

  for (const r of toInsert) {
    // Insert individually so the active-anomaly unique index (idempotency backstop) can no-op a race.
    const { error } = await admin.from("anomalies").insert({
      org_id: orgId,
      transaction_id: txnId,
      vehicle_id: txn.vehicleId,
      rule_id: r.ruleId,
      severity: r.severity,
      status: "open",
      message: r.message,
      evidence: r.evidence,
      source: "rules",
    });
    if (error && error.code !== "23505") throw new Error(error.message); // ignore duplicate-key races
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

/**
 * Score a transaction and re-score the following fills within the baseline window (docs/09 P1.6),
 * since changing one fill shifts the rolling baseline used by the next several.
 */
export async function scoreWithCascade(admin: SupabaseClient, orgId: string, txnId: string): Promise<void> {
  await scoreTransaction(admin, orgId, txnId);
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
  for (const r of ((next ?? []) as { id: string }[])) await scoreTransaction(admin, orgId, r.id);
}

/** Backfill: score every transaction for an org in (vehicle, fueled_at) order. Used after seeding. */
export async function backfillOrg(admin: SupabaseClient, orgId: string): Promise<number> {
  const { data: rows } = await admin
    .from("fuel_transactions")
    .select("id")
    .eq("org_id", orgId)
    .order("vehicle_id", { ascending: true })
    .order("fueled_at", { ascending: true })
    .order("created_at", { ascending: true });
  const ids = ((rows ?? []) as { id: string }[]).map((r) => r.id);
  for (const id of ids) await scoreTransaction(admin, orgId, id);
  return ids.length;
}
