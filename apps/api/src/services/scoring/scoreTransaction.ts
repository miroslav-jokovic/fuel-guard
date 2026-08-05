/** Score one transaction + learn per-vehicle values — the core pass. Orchestrator only: each stage's DB
 *  reads live in ./context.ts, the writes in ./persist.ts (P2-B split of the former ~397-line function). */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runAllRules,
  correlateSignals,
  CASE_RULE_ID,
  type RuleContext,
  type RuleResult,
  type RuleId,
} from "@fuelguard/shared";
import type { Env } from "../../env.js";
import { resolveReconciliation } from "./reconcile.js";
import { resolveCardContext } from "./cardContext.js";
import { loadMarketPricePerGal } from "./marketPrice.js";

export { learnVehicleValues } from "./learnVehicle.js"; // re-export: barrel + backfill import path unchanged
import { deriveDriverHomeAtFill } from "./tmsGates.js";
import { FTXN_COLS, toTxnView, loadThresholds, loadOperatingHours, n } from "./loaders.js";
import type { FtxnRow, ScoreOpts } from "./loaders.js";
import {
  loadVehicleContext,
  loadConsumptionContext,
  loadReeferContext,
  loadReeferDiversionContext,
} from "./context.js";
import { persistAnomalies, persistTxnOutcome, learnAndUpdateVehicle } from "./persist.js";

export async function scoreTransaction(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  txnId: string,
  opts: ScoreOpts = {},
): Promise<void> {
  const { data: row } = await admin
    .from("fuel_transactions")
    .select(FTXN_COLS)
    .eq("id", txnId)
    .eq("org_id", orgId)
    .single();
  if (!row) return;
  const r = row as FtxnRow;
  const txn = toTxnView(r);

  const { vehicle, samsaraVehicleId, odometerOffsetSource } = await loadVehicleContext(
    admin,
    txn.vehicleId,
  );

  const thresholds = opts.ctx?.thresholds ?? (await loadThresholds(admin, orgId));
  const operatingHours = opts.ctx?.operatingHours ?? (await loadOperatingHours(admin, orgId));
  const windowMs = (thresholds.cumulativeWindowHours ?? 48) * 3_600_000;
  // Rolling windows anchor on the STORED fueled_at (business time) — never the recovered instant.
  const winStartIso = new Date(new Date(r.fueled_at).getTime() - windowMs).toISOString();

  // Samsara reconciliation: the fueling-time odometer truth + recovered fueling time + location check.
  // Also applies the telematics-recovered instant to `txn` in memory — so it must run before the context
  // loaders and rule evaluation below. Kept whole as `recon` and threaded into the ruleCtx + the outcome write.
  const recon = await resolveReconciliation(
    admin,
    env,
    orgId,
    r,
    txn,
    vehicle,
    samsaraVehicleId,
    opts,
  );

  const { previousTxn, recentTxns, intermediateGallons, windowGallons, windowMiles } =
    await loadConsumptionContext(admin, txn, r, txnId, winStartIso);

  // Card-identity context (WP3): a true CARD-keyed vehicle count + the fuel_cards assignment.
  const cardCtx = await resolveCardContext(admin, orgId, txn, winStartIso, r.fueled_at);

  const { reeferTankCapacityGal, reeferWindowGallons } = await loadReeferContext(
    admin,
    orgId,
    txn,
    r,
    winStartIso,
  );
  const {
    reeferPaired,
    orgUsesReeferFuel,
    reeferDiversionReeferGal,
    reeferDiversionTractorGal,
    reeferLoadInWindow,
  } = await loadReeferDiversionContext(admin, orgId, txn, r, thresholds);

  // McLeod/TMS driver-home gate (opt-in, corroboration-only): if a driver owns this fill, was it made
  // while that driver was on home time / off duty? undefined for non-TMS orgs (fuel-only behavior kept).
  const driverHomeAtFill = txn.driverId
    ? await deriveDriverHomeAtFill(admin, orgId, txn.driverId, r.fueled_at)
    : undefined;

  const ruleCtx: RuleContext = {
    txn,
    vehicle,
    previousTxn,
    recentTxns,
    intermediateGallons,
    thresholds,
    operatingHours,
    crossSourceOdometer: recon.crossSourceOdometer,
    crossSourceOdometerSource: recon.crossSourceOdometerSource,
    windowGallons,
    windowMiles,
    cardVehicleCountInWindow: cardCtx.cardVehicleCountInWindow,
    cardAssignedVehicleId: cardCtx.cardAssignedVehicleId,
    cardManualAssignedVehicleId: cardCtx.cardManualAssignedVehicleId,
    cardIdentifiable: cardCtx.cardIdentifiable,
    samsaraLocationMatched: recon.samsaraLocationMatched,
    locationEvidence: recon.locationEvidence,
    tankFillShortGal: recon.tankFillShortGal,
    tankObservedRiseGal: recon.tankObservedRiseGal,
    tankPctBefore: recon.tankPctBefore,
    tankPctAfter: recon.tankPctAfter,
    reeferTankCapacityGal,
    reeferWindowGallons,
    reeferPaired,
    orgUsesReeferFuel,
    reeferDiversionReeferGal,
    reeferDiversionTractorGal,
    reeferLoadInWindow,
    driverHomeAtFill,
    ambientTempF: n(r.ambient_temp_f),
    // WP7 market cost-outlier input — diesel tractor fills only (a dyed-reefer or gasoline price vs the
    // highway-diesel posted median would be a category error).
    marketPricePerGal:
      vehicle.fuelType === "diesel" && txn.tankType !== "reefer"
        ? await loadMarketPricePerGal(admin, r.state, r.fueled_at)
        : null,
  };
  const fired = runAllRules(ruleCtx);

  // Correlate the fired signals into ONE per-transaction case (multi-signal model). A lone weak signal
  // stays "clear" (no anomaly) so normal fills don't all look flagged; independent corroborating signals
  // (or one physically-impossible one) become a single "theft_case" alert.
  const assessment = correlateSignals(fired);
  const caseFired: RuleResult[] =
    assessment.level === "clear"
      ? []
      : [
          {
            ruleId: CASE_RULE_ID as RuleId,
            fired: true,
            severity: assessment.severity!,
            message: assessment.summary,
            evidence: {
              level: assessment.level,
              score: assessment.score,
              axes: assessment.axes,
              signals: assessment.signals,
            },
          },
        ];

  await persistAnomalies(admin, orgId, txnId, txn.vehicleId, r.fueled_at, caseFired);
  await persistTxnOutcome(admin, txnId, {
    txn,
    previousTxn,
    intermediateGallons,
    assessment,
    ruleCtx,
    recon,
  });
  await learnAndUpdateVehicle(
    admin,
    txn,
    vehicle,
    samsaraVehicleId,
    odometerOffsetSource,
    recentTxns,
    opts,
  );
}

/** Score a transaction and re-score the following fills within the baseline window (docs/09 P1.6). */
