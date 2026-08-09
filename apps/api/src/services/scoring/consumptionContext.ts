/** Vehicle consumption context for scoring: event-time ordered prior fills, baseline inputs, and rolling windows. */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contaminatesBaseline,
  robustWindowMiles,
  type TxnView,
} from "@fuelguard/shared";
import {
  compareTxnRows,
  FTXN_COLS,
  ODOMETER_RULE_IDS,
  rowEventTime,
  toTxnView,
  sumIntermediateGallons,
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
}

/** Tractor consumption context ordered by the effective fueling event time, not only stored business time. */
export async function loadConsumptionContext(
  admin: SupabaseClient,
  txn: TxnView,
  r: FtxnRow,
  txnId: string,
  winStartIso: string,
  winEndIso: string,
): Promise<ConsumptionContext> {
  let previousTxn: TxnView | null = null;
  let recentTxns: TxnView[] = [];
  let intermediateGallons = 0;
  let windowGallons = 0;
  let windowMiles: number | null = null;
  let windowSuspectGallons = 0;

  if (txn.vehicleId && txn.tankType !== "reefer") {
    const previousQuery = () =>
      admin
        .from("fuel_transactions")
        .select(FTXN_COLS)
        .eq("vehicle_id", txn.vehicleId)
        .eq("tank_type", "tractor")
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
    recentTxns = recentRows.map((row, index) => {
      const view = toTxnView(row);
      const previous = recentRows[index - 1];
      if (previous) {
        view.intermediateGallons = rows
          .filter((x) => compareTxnRows(x, previous) > 0 && compareTxnRows(x, row) < 0)
          .reduce((sum, x) => sum + (Number(x.gallons) || 0), 0);
      }
      return view;
    });
    if (prevRow) intermediateGallons = await sumIntermediateGallons(admin, txn.vehicleId, prevRow, r, txnId);

    const { data: winRows } = await admin
      .from("fuel_transactions")
      .select("id, fueled_at, created_at, fueled_at_precision, source, fueling_time_basis, samsara_recon_at, samsara_location_matched, gallons, odometer, samsara_odometer, samsara_odometer_source, attribution_verdict")
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
      fueled_at: string;
      created_at: string;
      fueled_at_precision: string | null;
      source: string;
      fueling_time_basis: string | null;
      samsara_recon_at: string | null;
      samsara_location_matched: boolean | null;
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
    // The current fill stays in; attribution-suspect historical fills are excluded from the vehicle window.
    const wr = wrAll.filter((x) => x.id === txnId || x.attribution_verdict !== "suspect");
    windowSuspectGallons = wrAll
      .filter((x) => x.id !== txnId && x.attribution_verdict === "suspect")
      .reduce((s, x) => s + Number(x.gallons), 0);
    windowGallons = wr.reduce((s, x) => s + Number(x.gallons), 0);
    windowMiles = robustWindowMiles(
      wr.map((x) => ({ enteredOdometer: n(x.odometer), samsaraOdometer: n(x.samsara_odometer), samsaraSource: x.samsara_odometer_source })),
    ).miles;
  }

  return { previousTxn, recentTxns, intermediateGallons, windowGallons, windowMiles, windowSuspectGallons };
}
