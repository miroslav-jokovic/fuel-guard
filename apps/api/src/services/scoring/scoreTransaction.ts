/** Score one transaction + learn per-vehicle values — the core pass. Orchestrator only: each stage's DB
 *  reads live in ./context.ts, the writes in ./persist.ts (P2-B split of the former ~397-line function). */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runAllRules,
  correlateSignals,
  eventTime,
  timeReliable,
  CASE_RULE_ID,
  shouldReattribute,
  type RuleContext,
  type RuleResult,
  type RuleId,
} from "@fuelguard/shared";
import { writeAudit } from "../../lib/audit.js";
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
  loadWindowIdleGallons,
  loadReeferContext,
  loadReeferDiversionContext,
  loadAttributionCheck,
  healMissingAttribution,
  loadTankResidualWindow,
} from "./context.js";
import { loadConsumptionContext } from "./consumptionContext.js";
import {
  buildTxnOutcomePatch,
  failScoringAttempt,
  learnAndUpdateVehicle,
  persistScoringOutcome,
  scoringEngineVersion,
  scoringResultHash,
  startScoringAttempt,
} from "./persist.js";
import { dispatchJob } from "../queue/dispatch.js";

type RuleInputs = {
  consumption: Awaited<ReturnType<typeof loadConsumptionContext>>;
  tankResidualWindow: Awaited<ReturnType<typeof loadTankResidualWindow>>;
  windowIdleGallons: number;
  cardCtx: Awaited<ReturnType<typeof resolveCardContext>>;
  reefer: Awaited<ReturnType<typeof loadReeferContext>>;
  reeferDiversion: Awaited<ReturnType<typeof loadReeferDiversionContext>>;
  driverHomeAtFill: Awaited<ReturnType<typeof deriveDriverHomeAtFill>> | undefined;
  marketPricePerGal: number | null;
};

async function reattributeIfNeeded(
  admin: SupabaseClient,
  orgId: string,
  txnId: string,
  r: FtxnRow,
  txn: ReturnType<typeof toTxnView>,
  attribution: Awaited<ReturnType<typeof loadAttributionCheck>>["check"],
  recon: Awaited<ReturnType<typeof resolveReconciliation>>,
  reattributed: boolean | undefined,
): Promise<boolean> {
  if (
    reattributed ||
    !shouldReattribute(attribution, recon.samsaraLocationMatched, recon.nearestStationMiles)
  ) {
    return false;
  }
  await writeAudit(admin, {
    orgId,
    action: "transaction.reattribute_vehicle",
    entity: "fuel_transaction",
    entityId: txnId,
    meta: {
      fromVehicleId: txn.vehicleId,
      toVehicleId: attribution.logbookVehicleId,
      basis: "logbook+gps",
      fueledAt: r.fueled_at,
    },
  });
  const { error } = await admin
    .from("fuel_transactions")
    .update({
      vehicle_id: attribution.logbookVehicleId,
      logbook_vehicle_id: attribution.logbookVehicleId,
    })
    .eq("id", txnId);
  if (error) throw new Error(`[scoring] could not reattribute transaction ${txnId}: ${error.message}`);
  return true;
}

async function loadRuleInputs(
  admin: SupabaseClient,
  orgId: string,
  txn: ReturnType<typeof toTxnView>,
  r: FtxnRow,
  txnId: string,
  winStartIso: string,
  winEndIso: string,
  thresholds: Awaited<ReturnType<typeof loadThresholds>>,
  vehicle: Awaited<ReturnType<typeof loadVehicleContext>>["vehicle"],
): Promise<RuleInputs> {
  const consumption = await loadConsumptionContext(admin, txn, r, txnId, winStartIso, winEndIso, vehicle);
  // Historical trend rules use the same intermediate-fuel correction as the current-fill MPG calculation.
  txn.intermediateGallons = consumption.intermediateGallons;
  const tankResidualWindow = await loadTankResidualWindow(admin, txn, r, winEndIso);
  const windowIdleGallons = await loadWindowIdleGallons(admin, txn, winStartIso, winEndIso);
  const cardCtx = await resolveCardContext(admin, orgId, txn, winStartIso, r.fueled_at);
  const reefer = await loadReeferContext(admin, orgId, txn, winStartIso);
  const reeferDiversion = await loadReeferDiversionContext(admin, orgId, txn, thresholds, winEndIso);
  const driverHomeAtFill = txn.driverId
    ? await deriveDriverHomeAtFill(admin, orgId, txn.driverId, r.fueled_at)
    : undefined;
  const marketPricePerGal =
    vehicle.fuelType === "diesel" && txn.tankType !== "reefer"
      ? await loadMarketPricePerGal(admin, r.state, r.fueled_at)
      : null;
  return {
    consumption,
    tankResidualWindow,
    windowIdleGallons,
    cardCtx,
    reefer,
    reeferDiversion,
    driverHomeAtFill,
    marketPricePerGal,
  };
}

function buildRuleContext(
  txn: ReturnType<typeof toTxnView>,
  vehicle: Awaited<ReturnType<typeof loadVehicleContext>>["vehicle"],
  r: FtxnRow,
  thresholds: Awaited<ReturnType<typeof loadThresholds>>,
  operatingHours: Awaited<ReturnType<typeof loadOperatingHours>>,
  recon: Awaited<ReturnType<typeof resolveReconciliation>>,
  attribution: Awaited<ReturnType<typeof loadAttributionCheck>>["check"],
  driverOffDutyAtFill: boolean,
  inputs: RuleInputs,
): RuleContext {
  const { consumption, cardCtx, reefer, reeferDiversion } = inputs;
  return {
    txn,
    vehicle,
    previousTxn: consumption.previousTxn,
    recentTxns: consumption.recentTxns,
    intermediateGallons: consumption.intermediateGallons,
    thresholds,
    operatingHours,
    crossSourceOdometer: recon.crossSourceOdometer,
    crossSourceOdometerSource: recon.crossSourceOdometerSource,
    windowGallons: consumption.windowGallons,
    fuelBalance: consumption.fuelBalance,
    windowMiles: consumption.windowMiles,
    windowSuspectGallons: consumption.windowSuspectGallons,
    windowIdleGallons: inputs.windowIdleGallons,
    attributionSuspect: attribution.verdict === "suspect",
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
    tankResidualWindow: inputs.tankResidualWindow,
    truckToStationMiles: recon.nearestStationMiles,
    driverOffDutyAtFill,
    reeferTankCapacityGal: reefer.reeferTankCapacityGal,
    reeferWindowGallons: reefer.reeferWindowGallons,
    reeferPaired: reeferDiversion.reeferPaired,
    orgUsesReeferFuel: reeferDiversion.orgUsesReeferFuel,
    reeferDiversionReeferGal: reeferDiversion.reeferDiversionReeferGal,
    reeferDiversionTractorGal: reeferDiversion.reeferDiversionTractorGal,
    reeferLoadInWindow: reeferDiversion.reeferLoadInWindow,
    driverHomeAtFill: inputs.driverHomeAtFill,
    ambientTempF: n(r.ambient_temp_f),
    marketPricePerGal:
      vehicle.fuelType === "diesel" && txn.tankType !== "reefer" ? inputs.marketPricePerGal : null,
  };
}

function makeCaseFired(assessment: ReturnType<typeof correlateSignals>): RuleResult[] {
  if (assessment.level === "clear") return [];
  return [
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
}

async function dispatchAlertSweep(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  txnId: string,
  assessment: ReturnType<typeof correlateSignals>,
  skipLearn: boolean | undefined,
): Promise<void> {
  if (assessment.level !== "alert" || skipLearn) return;
  try {
    const { data: openCase } = await admin
      .from("anomalies")
      .select("id")
      .eq("transaction_id", txnId)
      .eq("rule_id", CASE_RULE_ID)
      .eq("status", "open")
      .maybeSingle();
    if (openCase?.id) {
      const request = await admin.from("pattern_sweep_requests").upsert(
        { org_id: orgId, anomaly_id: openCase.id as string, status: "pending", next_attempt_at: new Date().toISOString() },
        { onConflict: "anomaly_id", ignoreDuplicates: true },
      );
      if (request.error) throw new Error(request.error.message);
      const { data: sweepRequest } = await admin.from("pattern_sweep_requests")
        .select("id").eq("anomaly_id", openCase.id as string).maybeSingle();
      try {
        await dispatchJob(admin, env, "pattern_sweep", {
          orgId,
          payload: { anomalyId: openCase.id as string, requestId: sweepRequest?.id as string | undefined },
          dedupKey: `sweep:${openCase.id as string}`,
        });
      } catch (error) {
        // Evidence enrichment must not fail scoring, but its failure must be operationally visible.
        console.error(
          `[scoring] pattern sweep dispatch failed for ${openCase.id as string}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  } catch (error) {
    console.error("[scoring] pattern sweep lookup failed:", error instanceof Error ? error.message : error);
  }
}

export async function scoreTransaction(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  txnId: string,
  opts: ScoreOpts = {},
): Promise<void> {
  const { data: row, error: rowError } = await admin
    .from("fuel_transactions")
    .select(FTXN_COLS)
    .eq("id", txnId)
    .eq("org_id", orgId)
    .single();
  if (rowError) throw new Error(`[scoring] could not load transaction ${txnId}: ${rowError.message}`);
  if (!row) return;
  const r = row as FtxnRow;
  // Duplicate source rows remain auditable but must never be scored as independent physical fills.
  if (r.is_canonical === false) return;
  const txn = toTxnView(r);

  // WP-BEH — SELF-HEAL blanks from the logbook (never overwrites): a missing driver is filled in place;
  // a missing vehicle triggers ONE re-score under the filled vehicle (all vehicle context changes).
  if (!opts.reattributed) {
    const healed = await healMissingAttribution(admin, orgId, txnId, txn);
    if (healed === "vehicle_filled") {
      return scoreTransaction(admin, env, orgId, txnId, {
        ...opts,
        reattributed: true,
        skipRecon: false,
        prefetchedRaw: undefined,
      });
    }
  }

  const { vehicle, samsaraVehicleId, odometerOffsetSource } = await loadVehicleContext(
    admin,
    txn.vehicleId,
  );

  const thresholds = opts.ctx?.thresholds ?? (await loadThresholds(admin, orgId));
  const operatingHours = opts.ctx?.operatingHours ?? (await loadOperatingHours(admin, orgId));

  // Samsara reconciliation runs before temporal context loading: the recovered event time and live station
  // coordinates must participate in the first scoring pass, not only in a later rebuild.
  //
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
  const windowMs = (thresholds.cumulativeWindowHours ?? 48) * 3_600_000;
  const windowAnchorIso = timeReliable(txn) ? eventTime(txn) : txn.fueledAt;
  const windowAnchorMs = Date.parse(windowAnchorIso);
  const winStartIso = new Date(windowAnchorMs - windowMs).toISOString();
  const winEndIso = new Date(windowAnchorMs + windowMs).toISOString();

  const { check: attribution, driverOffDutyAtFill } = await loadAttributionCheck(admin, orgId, txn);
  if (
    await reattributeIfNeeded(admin, orgId, txnId, r, txn, attribution, recon, opts.reattributed)
  ) {
    return scoreTransaction(admin, env, orgId, txnId, {
      ...opts,
      reattributed: true,
      skipRecon: false,
      prefetchedRaw: undefined,
    });
  }

  const inputs = await loadRuleInputs(
    admin,
    orgId,
    txn,
    r,
    txnId,
    winStartIso,
    winEndIso,
    thresholds,
    vehicle,
  );
  const ruleCtx = buildRuleContext(
    txn,
    vehicle,
    r,
    thresholds,
    operatingHours,
    recon,
    attribution,
    driverOffDutyAtFill,
    inputs,
  );
  const fired = runAllRules(ruleCtx);

  // Correlate the fired signals into ONE per-transaction case (multi-signal model). A lone weak signal
  // stays "clear" (no anomaly) so normal fills don't all look flagged; independent corroborating signals
  // (or one physically-impossible one) become a single "theft_case" alert.
  const assessment = correlateSignals(fired);
  const caseFired = makeCaseFired(assessment);
  const outcome = buildTxnOutcomePatch({
    txn,
    previousTxn: inputs.consumption.previousTxn,
    intermediateGallons: inputs.consumption.intermediateGallons,
    assessment,
    ruleCtx,
    recon,
    attribution,
  });
  const engineVersion = scoringEngineVersion();
  const attempt = await startScoringAttempt(admin, {
    orgId,
    txnId,
    engineVersion,
    resultHash: scoringResultHash({ txnId, engineVersion, caseFired, outcome }),
  });

  // The database RPC commits anomaly reconciliation, the transaction outcome, and attempt completion
  // together. A retry of this same attempt is idempotent if the response was lost after commit.
  try {
    await persistScoringOutcome(admin, {
      attempt,
      orgId,
      txnId,
      vehicleId: txn.vehicleId,
      fueledAt: r.fueled_at,
      caseFired,
      outcome,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await failScoringAttempt(admin, attempt.id, message);
    } catch (recordError) {
      console.error(
        `[scoring] failed to record attempt failure ${attempt.id}:`,
        recordError instanceof Error ? recordError.message : recordError,
      );
    }
    throw error;
  }

  await dispatchAlertSweep(admin, env, orgId, txnId, assessment, opts.skipLearn);

  await learnAndUpdateVehicle(
    admin,
    txn,
    vehicle,
    samsaraVehicleId,
    odometerOffsetSource,
    inputs.consumption.recentTxns,
    opts,
  );
}

/** Score a transaction and re-score the following fills within the baseline window (docs/09 P1.6). */
