/** Vehicle consumption context for scoring: event-time ordered prior fills, baseline inputs, and rolling windows. */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contaminatesBaseline,
  robustWindowMiles,
  resolveCapacity,
  type TxnView,
  type VehicleView,
  type FuelBalanceEvidence,
} from "@fuelguard/shared";
import {
  compareTxnRows,
  FTXN_COLS,
  ODOMETER_RULE_IDS,
  rowEventTime,
  toTxnView,
  loadSpanFills,
  sumGallonsBetween,
  n,
} from "./loaders.js";
import type { FtxnRow } from "./loaders.js";

export interface ConsumptionContext {
  previousTxn: TxnView | null;
  recentTxns: TxnView[];
  intermediateGallons: number;
  windowGallons: number;
  windowMiles: number | null;
  /** WP-ATTR — gallons excluded from the window because their fills' attribution is logbook-contradicted. */
  windowSuspectGallons: number;
  fuelBalance: FuelBalanceEvidence;
}

type TankBalanceRow = {
  id: string;
  created_at: string;
  fueled_at: string;
  fueled_at_precision: string | null;
  source: string;
  fueling_time_basis: string | null;
  samsara_recon_at: string | null;
  samsara_location_matched: boolean | null;
  samsara_fuel_pct_before: number | string | null;
  samsara_fuel_pct_after: number | string | null;
};

export function resolveFuelBalance(
  rows: TankBalanceRow[],
  vehicle: VehicleView,
  purchasedGallons: number,
  mileageBasis: FuelBalanceEvidence["mileageBasis"],
  baselineMpg: number | null,
  duplicateGallonsExcluded = 0,
): FuelBalanceEvidence {
  const capacity = resolveCapacity(vehicle).gallons;
  const ordered = rows
    .filter((x) => x.fueling_time_basis === "tank_confirmed")
    .filter((x) => {
      const before = n(x.samsara_fuel_pct_before);
      const after = n(x.samsara_fuel_pct_after);
      return before != null && after != null && before >= 0 && before <= 100 && after >= 0 && after <= 100;
    })
    .sort((a, b) => Date.parse(rowEventTime(a)) - Date.parse(rowEventTime(b)) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const fallback: FuelBalanceEvidence = {
    mode: "mpg_fallback", purchasedGallons: Math.round(purchasedGallons * 100) / 100,
    canonicalTransactionCount: rows.length, startTankGallons: null, endTankGallons: null,
    consumedGallons: null, capacityGallons: capacity || null, sampleCount: 0,
    mileageBasis, baselineMpg, baselineSource: baselineMpg != null ? "vehicle_configured" : "none", duplicateGallonsExcluded,
  };
  if (ordered.length < 2 || capacity <= 0) return fallback;
  const startTankGallons = capacity * n(ordered[0]!.samsara_fuel_pct_before)! / 100;
  const endTankGallons = capacity * n(ordered.at(-1)!.samsara_fuel_pct_after)! / 100;
  const consumedGallons = startTankGallons + purchasedGallons - endTankGallons;
  if (consumedGallons < 0 || consumedGallons > purchasedGallons + capacity) return fallback;
  return {
    ...fallback,
    mode: "tank_balance",
    startTankGallons: Math.round(startTankGallons * 100) / 100,
    endTankGallons: Math.round(endTankGallons * 100) / 100,
    consumedGallons: Math.round(consumedGallons * 100) / 100,
    capacityGallons: capacity,
    sampleCount: ordered.length,
  };
}

/** Tractor consumption context ordered by the effective fueling event time, not only stored business time. */
export async function loadConsumptionContext(
  admin: SupabaseClient,
  txn: TxnView,
  r: FtxnRow,
  txnId: string,
  winStartIso: string,
  winEndIso: string,
  vehicle: VehicleView,
): Promise<ConsumptionContext> {
  let previousTxn: TxnView | null = null;
  let recentTxns: TxnView[] = [];
  let intermediateGallons = 0;
  let windowGallons = 0;
  let windowMiles: number | null = null;
  let windowSuspectGallons = 0;
  let fuelBalance: FuelBalanceEvidence = {
    mode: "mpg_fallback",
    purchasedGallons: 0,
    canonicalTransactionCount: 0,
    startTankGallons: null,
    endTankGallons: null,
    consumedGallons: null,
    capacityGallons: null,
    sampleCount: 0,
    mileageBasis: "none",
    baselineMpg: vehicle.baselineMpg ?? null,
    baselineSource: vehicle.baselineMpg != null ? "vehicle_configured" : "none",
    duplicateGallonsExcluded: 0,
  };

  if (txn.vehicleId && txn.tankType !== "reefer") {
    const previousQuery = () =>
      admin
        .from("fuel_transactions")
        .select(FTXN_COLS)
        .eq("vehicle_id", txn.vehicleId)
        .eq("tank_type", "tractor")
        .eq("is_canonical", true)
        .not("odometer", "is", null);
    // Fetch both business-time sides. A recovered event time can move a fill across the fueled_at boundary,
    // so a single `fueled_at < current` query cannot reliably find the actual previous fill.
    const [{ data: beforeRows }, { data: afterRows }] = await Promise.all([
      previousQuery()
        .lt("fueled_at", r.fueled_at)
        .order("fueled_at", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(12),
      previousQuery()
        .gte("fueled_at", r.fueled_at)
        .order("fueled_at", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(12),
    ]);
    const rows = [...new Map(
      ([...(beforeRows ?? []), ...(afterRows ?? [])] as FtxnRow[]).map((x) => [x.id, x]),
    ).values()]
      .filter((x) => x.id !== txn.id && compareTxnRows(x, r) < 0)
      .sort((a, b) => compareTxnRows(b, a));

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
    const ODO_SIGNALS = new Set(ODOMETER_RULE_IDS);
    const odoBad = (x: FtxnRow) => badIds.has(x.id) || (x.case_signals ?? []).some((sg) => ODO_SIGNALS.has(sg.ruleId));
    // A logbook-contradicted fill carries another truck's gallons/odometer and cannot train this context.
    const attrBad = (x: FtxnRow) => x.attribution_verdict === "suspect";
    const prevRow = rows.find((x) => !odoBad(x) && !attrBad(x)) ?? null;
    previousTxn = prevRow ? toTxnView(prevRow) : null;
    // Theft-contaminated fills must not train the MPG baseline.
    const recentRows = rows
      .filter((x) => !odoBad(x) && !attrBad(x) && !contaminatesBaseline(x.case_level, x.case_signals))
      .slice(0, 6)
      .reverse();
    /**
     * ONE fuel universe for EVERY intermediate-gallons figure on this vehicle (audit 2026-08-09,
     * finding B).
     *
     * The fill under test used to take its intermediate gallons from a dedicated query over ALL
     * tractor fills in the span, while each BASELINE fill derived the same figure from `rows` — the
     * previous-fill candidates, which are loaded with `.not("odometer", "is", null)`. A blank-odometer
     * fill was therefore charged against the fill under test's odometer span and omitted from every
     * baseline's. That does not merely add noise; it biases the baseline in one direction only. Three
     * such gaps moved a true-6.0-MPG truck's median baseline to 9–10 MPG, and the next honest fill
     * fired `mpg_deviation` against a history that never happened.
     *
     * `loadSpanFills` is the only producer of this set, and it applies no odometer / case /
     * attribution filter — precisely because a skipped fill's fuel was still burned inside the span —
     * so the two sides can no longer quietly diverge. The span reaches back to the OLDEST fill either
     * side needs and `sumGallonsBetween` clips each pair exactly as the old query's in-memory filter
     * did, so the fill under test's own figure is unchanged.
     */
    const spanAnchor =
      [prevRow, recentRows[0]]
        .filter((x): x is FtxnRow => x != null)
        .sort((a, b) => Date.parse(a.fueled_at) - Date.parse(b.fueled_at))[0] ?? null;
    const spanFills = spanAnchor ? await loadSpanFills(admin, txn.vehicleId, spanAnchor, r) : [];
    recentTxns = recentRows.map((row, index) => {
      const view = toTxnView(row);
      const previous = recentRows[index - 1];
      if (previous) view.intermediateGallons = sumGallonsBetween(spanFills, previous, row, txnId);
      return view;
    });
    if (prevRow) intermediateGallons = sumGallonsBetween(spanFills, prevRow, r, txnId);

    const { data: winRows } = await admin
      .from("fuel_transactions")
      .select("id, is_canonical, fueled_at, created_at, fueled_at_precision, source, fueling_time_basis, samsara_recon_at, samsara_location_matched, samsara_fuel_pct_before, samsara_fuel_pct_after, gallons, odometer, samsara_odometer, samsara_odometer_source, attribution_verdict")
      .eq("vehicle_id", txn.vehicleId)
      .eq("tank_type", "tractor")
      .gte("fueled_at", winStartIso)
      .lte("fueled_at", winEndIso)
      // OLDEST→NEWEST for robustWindowMiles' regression check; event-time filtering below removes business-time straddlers.
      .order("fueled_at", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    const wrAll = ((winRows ?? []) as {
      id: string;
      is_canonical: boolean;
      fueled_at: string;
      created_at: string;
      fueled_at_precision: string | null;
      source: string;
      fueling_time_basis: string | null;
      samsara_recon_at: string | null;
      samsara_location_matched: boolean | null;
      samsara_fuel_pct_before: number | string | null;
      samsara_fuel_pct_after: number | string | null;
      gallons: number | string;
      odometer: number | string | null;
      samsara_odometer: number | string | null;
      samsara_odometer_source: string | null;
      attribution_verdict: string | null;
    }[]).filter((x) => {
      const at = Date.parse(rowEventTime(x));
      const start = Date.parse(winStartIso);
      const end = Date.parse(winEndIso);
      return Number.isFinite(at) && at >= start && at <= end;
    });
    const duplicateGallonsExcluded = wrAll
      .filter((x) => x.is_canonical === false)
      .reduce((sum, x) => sum + (Number(x.gallons) || 0), 0);
    // The current fill stays in; attribution-suspect historical fills are excluded from the vehicle window.
    const wr = wrAll.filter((x) => x.is_canonical !== false && (x.id === txnId || x.attribution_verdict !== "suspect"));
    windowSuspectGallons = wrAll
      .filter((x) => x.id !== txnId && x.attribution_verdict === "suspect")
      .reduce((s, x) => s + Number(x.gallons), 0);
    windowGallons = wr.reduce((s, x) => s + Number(x.gallons), 0);
    const mileage = robustWindowMiles(
      wr.map((x) => ({ enteredOdometer: n(x.odometer), samsaraOdometer: n(x.samsara_odometer), samsaraSource: x.samsara_odometer_source })),
    );
    windowMiles = mileage.miles;
    fuelBalance = resolveFuelBalance(wr, vehicle, windowGallons, mileage.basis, vehicle.baselineMpg ?? null, duplicateGallonsExcluded);
  }

  return { previousTxn, recentTxns, intermediateGallons, windowGallons, windowMiles, windowSuspectGallons, fuelBalance };
}
