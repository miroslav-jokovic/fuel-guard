import type { Env } from "../../env.js";
import { syncVehiclesFromSamsara, NoSamsaraTokenError } from "./samsaraVehicleSync.js";
import { syncVehicleStatsFromSamsara } from "./samsaraStatsFeed.js";
import { syncVehiclePositionsFromSamsara } from "./samsaraPositionsFeed.js";
import { syncDriversFromSamsara } from "./samsaraDriverSync.js";
import { syncRecentDriverScoreWeeks } from "../performance/index.js";
import { snapshotSettledWeeks } from "../performance/index.js";
import { syncIdleFoundation } from "../idle/index.js";
import { syncHosDutySegments, syncHosCurrentStatus } from "./hosSync.js";
import { syncIdleRollup } from "../idle/index.js";
import { syncIdleDutyEvidence } from "../idle/index.js";
import { runDataRetention } from "../org/index.js";
// The machinery every tier shares — which orgs, which slot, which loop. Moved out when LM4's tier
// pushed this file past the 500-line budget; see `lib/tierRunner.ts` for why it is a split and not a
// waiver.
import { orgsToSync, runOrgTier, startTier } from "./lib/tierRunner.js";
import { runSamsaraFeedAlarm } from "./samsaraFeedAlarm.js";
import { samsaraFeedCadences } from "./samsaraFeedHealth.js";
import { dispatchJob } from "../../queue/dispatch.js";
import { monthsToSync, syncIftaMilesForMonth } from "./samsaraIftaSync.js";
import { syncVehicleOdometerReadings } from "./samsaraOdometerSync.js";

/**
 * Tier 5 — PER-FILL TELEMATICS (SAM-S3, D-SAM1). The tier that stops the collection hole growing.
 *
 * ── WHY THIS TIER HAD TO EXIST ───────────────────────────────────────────────────────────────────
 * Per-fill Samsara reconciliation lived inside `modules/anomalies/scoring/reconcile.ts` — it happened
 * as a SIDE EFFECT of scoring a fill, and never otherwise. `ScoreOpts.skipRecon` documents the
 * consequence in its own words: bulk rebuilds reuse stored values so they do not hammer the vendor
 * rate limit. A new import fetches; a bulk rebuild, the post-import cascade and `scoreVehicle` do
 * not — and for a historical row there is nothing stored, so it stayed empty permanently. Measured
 * 2026-09-01: 10,644 of 13,711 tractor fills (77.6%) had no telematics, and by month 2026-03, 2026-04
 * and 2026-06 had ZERO successful reconciliations while 2026-08 onward is ~100% — the signature of
 * "whatever happened to be imported got fetched". Nothing incidental was going to close that.
 *
 * A collector whose coverage depends on what a downstream consumer happened to request is not a
 * collector (plan §1.3). This tier owns the work on its own schedule, and D-SAM3's "enqueue it
 * instead of dropping it" needs no second queue: a pass that skips a fill leaves `samsara_recon_at`
 * null, and null is exactly what the claim selects. The rows ARE the queue.
 *
 * ── WHY IT DISPATCHES INSTEAD OF CALLING ─────────────────────────────────────────────────────────
 * `backfillOrg` lives in `modules/anomalies`, and `samsara -> anomalies` is deliberately NOT in
 * `check-feature-boundaries.mjs`' allow-list: the collector must not depend on the scoring module,
 * which is the whole of D-ARC1 and the inversion this plan is about. So the tier does what
 * `startRebuildOnBoot` does — it DISPATCHES the existing `backfill` kind. A message, not a
 * dependency. `dispatchJob` also gives it the per-org scoring mutex for free (`SCORING_JOB_KINDS`),
 * so a tick can never run alongside a manual rebuild over the same rows; a conflict means one is
 * already running, which is the "already handled" case, and is skipped rather than queued.
 */
function startReconTier(env: Env): void {
  startTier(env, "recon", 240_000, env.SAMSARA_RECON_SYNC_MINUTES * 60_000, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      try {
        await dispatchJob(admin, env, "backfill", {
          orgId,
          payload: {
            reconBatch: env.SAMSARA_RECON_BATCH,
            reconRetryAfterHours: env.SAMSARA_RECON_RETRY_HOURS,
          },
        });
      } catch (e) {
        console.error(
          `[samsara-sched] recon tier dispatch failed for org ${orgId}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  });
}

/**
 * Tier 1 — live stats. Shares the "sync_vehicles" slot? No: distinct kind so it never blocks identity.
 */
function startStatsTier(env: Env, intervalMs: number): void {
  startTier(env, "stats", 30_000, intervalMs, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      await runOrgTier(admin, env, orgId, "sync_stats", async () => {
        const r = await syncVehicleStatsFromSamsara(admin, env, orgId);
        // Every field the delta feed made knowable goes into the jobs ledger, because the tier's
        // whole claim — that it stopped losing what happens between polls — is only checkable from
        // outside if the numbers are recorded. `resumed: false` after the first tick means the cursor
        // is not persisting; `pagesCapped` means the walk was cut short; and
        // `dropsSuppressedUnreliableSensor` is what the sensor gate cost, which SAM-S6 re-argues.
        return {
          updated: r.updated,
          pages: r.pages,
          samples: r.samples,
          resumed: r.resumed,
          pagesCapped: r.pagesCapped,
          dropsFiled: r.dropsFiled,
          dropsSuppressedUnreliableSensor: r.dropsSuppressedUnreliableSensor,
        };
      });
    }
  });
}

/**
 * Tier 9 — LIVE POSITIONS for the map (LM4, D-LM1). The fastest tier here by two orders of magnitude.
 *
 * ── IT DOES NOT RUN THROUGH `runOrgTier`, AND THAT IS THE POINT ──────────────────────────────────
 * Every other collecting tier claims a (org, kind) slot in the `jobs` ledger. At 12 ticks a minute
 * this one would write ~17,000 job rows per org per day against a 90-day retention, to record that a
 * five-second poll ran. The ledger's gifts do not apply either: `startTier` already refuses to overlap
 * itself, the schedulers run in exactly one process fleet-wide (docs/WORKER-DEPLOYMENT.md), and there
 * is no manual "sync positions" button for a tick to race. Its freshness stamp is the cursor's own
 * `updated_at`, which `samsaraFeedHealth` reads and 0288 created for exactly this — a column that moves
 * when SAMSARA ANSWERED rather than when we ran.
 *
 * ── THE FIRST DELAY IS FIVE MINUTES, AND THAT NUMBER IS THE DEPLOY WINDOW ────────────────────────
 * Railway serves a merge about three minutes in while `migrate.yml` waits for CI green, so a release
 * carrying 0342 is SERVED before its function EXISTS (docs/MIGRATION-DISCIPLINE.md §the-deploy-window;
 * 2m44s measured on 0316, 2026-09-05). The odometer tier takes 15 minutes for the same reason, but it
 * runs daily and can afford them; a map that stays dark for a quarter of an hour after every deploy
 * cannot. Five is a shade under twice the measured window, and a tick that lands inside it anyway is
 * handled rather than lost: `writerMissing` comes back true, no cursor is stored, and the next tick
 * five seconds later re-reads the same page.
 */
function startPositionsTier(env: Env): void {
  startTier(env, "positions", 300_000, env.SAMSARA_POSITIONS_SYNC_SECONDS * 1_000, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      try {
        const r = await syncVehiclePositionsFromSamsara(admin, env, orgId);
        // Logged only when something is worth saying. A tier that printed a line every five seconds
        // would bury every other message in the service log inside a day, which is the same failure as
        // writing 17,000 job rows, spelt differently.
        if (r.writerMissing) {
          console.warn(
            `[samsara-sched] positions: record_vehicle_positions is not in the database yet for org ${orgId} — ` +
              "this is the deploy window (0342); the next tick will re-read the same page.",
          );
        } else if (r.pagesCapped || r.unmappedVehicles > 0) {
          console.log(
            `[samsara-sched] positions org ${orgId}: wrote ${r.written} of ${r.fixes} fixes over ${r.pages} page(s)` +
              (r.unmappedVehicles > 0 ? `, ${r.unmappedVehicles} unmapped truck(s)` : "") +
              (r.pagesCapped ? ", PAGE CAP HIT" : ""),
          );
        }
      } catch (e) {
        if (e instanceof NoSamsaraTokenError) continue; // an unconfigured org is not a failure
        console.error(
          `[samsara-sched] positions failed for org ${orgId}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  });
}

/**
 * Tier 2 — identity (drivers first so assignments resolve). Uses the "sync_vehicles" kind so a manual
 * "Sync from Samsara" and this scheduled refresh share ONE active-run slot (no concurrent double-sync).
 */
function startIdentityTier(env: Env, intervalMs: number): void {
  startTier(env, "identity", 90_000, intervalMs, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      await runOrgTier(admin, env, orgId, "sync_vehicles", async () => {
        try {
          await syncDriversFromSamsara(admin, env, orgId);
        } catch {
          /* non-fatal */
        }
        const r = await syncVehiclesFromSamsara(admin, env, orgId);
        await admin
          .from("integration_credentials")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("org_id", orgId);
        return { total: r.total, created: r.created, updated: r.updated, assigned: r.assigned };
      });
    }
  });
}

/**
 * Tier 3 — driver performance: refresh the current week's Safety+Efficiency scores, then freeze any settled
 * weeks into the rewards ledger. Both run through the jobs ledger (no overlap); efficiency degrades gracefully.
 */
function startPerformanceTier(env: Env): void {
  const driverScoreMs = env.SAMSARA_DRIVER_SCORE_SYNC_HOURS * 3_600_000;
  startTier(env, "driver-scores", 120_000, driverScoreMs, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      await runOrgTier(admin, env, orgId, "sync_driver_scores", async () => {
        const r = await syncRecentDriverScoreWeeks(admin, env, orgId);
        return { weeks: r.weeks, upserted: r.totalUpserted };
      });
      await runOrgTier(admin, env, orgId, "sync_idle", async () => {
        const r = await syncIdleFoundation(admin, env, orgId);
        return {
          stageMs: r.stageMs,
          fetched: r.idleEvents.fetched,
          upserted: r.idleEvents.upserted,
          capabilityVehicles: r.idleCapabilities.vehicles,
          capabilityLearned: r.idleCapabilities.learned,
          capabilityVehiclesWithData: r.idleCapabilities.vehiclesWithData,
          capabilityVehiclesWithoutData: r.idleCapabilities.vehiclesWithoutData,
          capabilityBatches: r.idleCapabilities.batches,
          engineDaysWritten: r.idleCapabilities.engineDays,
          parkSessionsWritten: r.idleCapabilities.parkSessions,
          staleEngineDaysDeleted: r.idleCapabilities.staleEngineDaysDeleted,
          staleParkSessionsDeleted: r.idleCapabilities.staleParkSessionsDeleted,
          telemetryVehicles: r.idleTelemetry.vehicles,
          telemetryVehiclesWithData: r.idleTelemetry.vehiclesWithTelemetry,
          telemetryWindowsWritten: r.idleTelemetry.windowsWritten,
          telemetrySamples: r.idleTelemetry.samples,
          equipmentEvidenceSessions: r.idleEquipmentEvidence.sessions,
          equipmentEvidenceInside: r.idleEquipmentEvidence.inside,
          equipmentEvidenceOutside: r.idleEquipmentEvidence.outside,
          equipmentEvidenceMixed: r.idleEquipmentEvidence.mixed,
          equipmentEvidenceInsufficient: r.idleEquipmentEvidence.insufficient,
          equipmentEvidenceAmbiguous: r.idleEquipmentEvidence.ambiguous,
          equipmentEvidenceUnknown: r.idleEquipmentEvidence.unknown,
          equipmentEvidenceRowsWritten: r.idleEquipmentEvidence.rowsWritten,
          learnedEnvelopeVehicles: r.idleLearnedEnvelopes.vehicles,
          learnedEnvelopeSufficient: r.idleLearnedEnvelopes.sufficient,
          learnedEnvelopeInsufficient: r.idleLearnedEnvelopes.insufficient,
          learnedEnvelopeNotApplicable: r.idleLearnedEnvelopes.notApplicable,
          learnedEnvelopeRowsWritten: r.idleLearnedEnvelopes.rowsWritten,
        };
      });
      // sync_idle and sync_hos keep INDEPENDENT (org, kind) slots. They both touch idle_park_sessions,
      // but each owns a disjoint column group and writes it with a set-based UPDATE (migration 0174), so
      // they converge rather than race. Giving them a shared dedup key instead starved sync_hos outright
      // under JOB_EXECUTION_MODE=queue — see the note in jobs.ts.
      await runOrgTier(admin, env, orgId, "sync_hos", async () => {
        const r = await syncHosDutySegments(admin, env, orgId);
        const dutyEvidence = await syncIdleDutyEvidence(admin, orgId);
        // Same follow-up the manual/queue handler does: stamp each driver's CURRENT duty status, truck and
        // city (clocks + one fleet GPS snapshot). Best-effort — the scheduled job's segment stats stand even
        // if the live-status pass hiccups. Without this the Drivers page only refreshed on a manual click.
        let currentDrivers = 0;
        let located = 0;
        try {
          const c = await syncHosCurrentStatus(admin, env, orgId);
          currentDrivers = c.drivers;
          located = c.located;
        } catch (e) {
          console.error(
            `[samsara-sched] hos current status (org ${orgId}) failed: ${e instanceof Error ? e.message : e}`,
          );
        }
        // Rollup refresh runs ONCE per tier cycle, here after BOTH of its feeds (idle ran earlier in this
        // tier; duty segments just synced above). It is the derived view rendered by Idling, so a failed
        // refresh must fail this ledger job and become visible/retryable instead of leaving stale data.
        const rollup = await syncIdleRollup(admin, orgId);
        return {
          fetched: r.fetched,
          upserted: r.upserted,
          currentDrivers,
          located,
          dutyEvidenceSessions: dutyEvidence.sessions,
          dutyEvidenceSufficient: dutyEvidence.sufficient,
          dutyEvidenceInsufficient: dutyEvidence.insufficient,
          dutyEvidenceAmbiguous: dutyEvidence.ambiguous,
          dutyEvidenceRowsWritten: dutyEvidence.rowsWritten,
          rollupWindowDays: rollup.windowDays,
          rollupRows: rollup.rows,
          rollupWritten: rollup.written,
          rollupDeleted: rollup.deleted,
        };
      });
      await runOrgTier(admin, env, orgId, "snapshot_driver_week", async () => {
        const r = await snapshotSettledWeeks(admin, env, orgId);
        return { weeksFrozen: r.weeksFrozen.length, rowsWritten: r.rowsWritten };
      });
    }
  });
}

/**
 * Tier 3b — IFTA jurisdiction miles (0255). Daily, and deliberately its own tier rather than a line
 * in tier 3: it is the only Samsara feed whose grain is a MONTH, nothing it reads moves faster than
 * Samsara's 72-hour restatement window, and a tax figure has no business sharing a ledger slot with a
 * driver-score refresh that runs every six hours. `SAMSARA_IFTA_SYNC_HOURS=0` disables it outright.
 */
function startIftaTier(env: Env): void {
  startTier(env, "ifta", 180_000, env.SAMSARA_IFTA_SYNC_HOURS * 3_600_000, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      await runOrgTier(admin, env, orgId, "sync_ifta", async () => {
        const months = monthsToSync(new Date());
        const per: Record<string, number> = {};
        let rows = 0;
        let unmapped = 0;
        for (const { year, month } of months) {
          const r = await syncIftaMilesForMonth(admin, env, orgId, year, month);
          per[`${month} ${year}`] = r.rows;
          rows += r.rows;
          unmapped = Math.max(unmapped, r.unmappedVehicles);
        }
        return { months: per, rows, unmappedVehicles: unmapped };
      });
    }
  });
}

/**
 * Tier 3c — ODOMETER READINGS (W3b, D-FLEET9). The fleet's only measured distance.
 *
 * Its own tier rather than a line in tier 3 for the reason 3b is: the grain is a DAY and a day is
 * only finished once, so pacing it with a driver-score refresh that runs every six hours would spend
 * the vendor's rate limit four times over to learn the same fact. `SAMSARA_ODOMETER_SYNC_HOURS=0`
 * disables it outright.
 *
 * ⚠ THE FIRST DELAY IS FIFTEEN MINUTES, AND THAT NUMBER IS THE DEPLOY WINDOW. Railway serves a merge
 * about three minutes in and `migrate.yml` applies its schema about twelve minutes in
 * (docs/MIGRATION-DISCIPLINE.md §the-deploy-window), so a tier that ticked at boot on the release
 * that ships 0311 would write to a table Postgres does not have yet. Nothing would be lost — the
 * job fails, the next tick repairs it — but a failed job on every deploy is noise that teaches
 * people to ignore the ledger. Fifteen minutes puts the first tick after the window closes.
 */
function startOdometerTier(env: Env): void {
  startTier(env, "odometer", 900_000, env.SAMSARA_ODOMETER_SYNC_HOURS * 3_600_000, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      await runOrgTier(admin, env, orgId, "sync_odometer", async () => {
        const r = await syncVehicleOdometerReadings(admin, env, orgId);
        // Coverage goes in the ledger because a per-mile figure computed over part of the fleet
        // reads low on miles and high on cost and looks entirely plausible (G10's reasoning).
        return {
          vehicles: r.vehicles,
          vehiclesWithData: r.vehiclesWithData,
          vehiclesWithoutData: r.vehiclesWithoutData,
          readings: r.readings,
          obdReadings: r.obdReadings,
          gpsDistanceReadings: r.gpsDistanceReadings,
          batches: r.batches,
          // `fetches` and `chunks` separate "how many trucks" from "how wide a window" in the ledger.
          // The tier's own window is one slice, so this line reads exactly as it did before the slice
          // walk existed — a backfill is the only run where the two numbers differ.
          fetches: r.fetches,
          chunks: r.chunks,
          windowDays: r.windowDays,
        };
      });
    }
  });
}

/**
 * Tier 4 — daily data retention (DB-only): enforce the per-table retention policy
 * (services/dataRetention.ts) in bounded batches, through the jobs ledger like every other tier so
 * the run + its per-table delete counts are visible on Data & Sync.
 */
function startRetentionTier(env: Env): void {
  startTier(env, "retention", 600_000, 24 * 3_600_000, async (admin) => {
    // ALL orgs — retention is not tied to having a Samsara token.
    const { data: orgs } = await admin.from("organizations").select("id");
    for (const orgId of ((orgs ?? []) as { id: string }[]).map((o) => o.id)) {
      await runOrgTier(admin, env, orgId, "data_retention", async () => {
        const r = await runDataRetention(admin, orgId);
        return {
          totalDeleted: r.totalDeleted,
          tables: Object.fromEntries(
            r.tables.filter((t) => t.deleted > 0 || t.capped).map((t) => [t.table, t.deleted]),
          ),
        };
      });
    }
  });
}

/**
 * Start the tiered Samsara schedulers (in-process on the single Railway instance). Every tier runs
 * through the jobs ledger (freshness + no-overlap) and the rate-limited Samsara client.
 * SAMSARA_SYNC_HOURS=0 remains a kill switch that disables ALL sync (manual buttons still work).
 *
 * ⚠ One function per tier, and that is `lint:funcsize`'s instruction rather than a preference: this
 * function crossed the 200-line budget when the per-fill telematics tier landed (SAM-S3), and the
 * gate's own message is "split into an orchestrator + stage helpers". It was split WHOLE rather than
 * by evicting whichever tier happened to be biggest — squeezing back under leaves the next tier to
 * hit the same wall with no headroom, which is the argument `mountApiRouters` in app.ts already had
 * to make once.
 */
/**
 * Tier 8 — THE FRESHNESS ALARM (SAM-S5, D-SAM6). The only tier that reads rather than collects.
 *
 * ── WHY IT IS NOT A `jobs` KIND LIKE THE OTHERS ──────────────────────────────────────────────────
 * Every collecting tier runs through `runOrgTier` for the (org, kind) mutex and the failure record.
 * This one collects nothing: it reads the ledgers the others write, decides whether to speak, and
 * remembers what it said in `samsara_feed_alerts`. Giving it a job kind would put its own rows into
 * the very ledger it reads and buy nothing — the duplicate-suppression it needs is the memory table,
 * not a mutex, and `startTier`'s own re-entrancy guard covers the overlap case.
 *
 * ── THE INTERVAL IS DERIVED, NOT CHOSEN ──────────────────────────────────────────────────────────
 * Checking more often than the fastest feed polls cannot find anything new, so the alarm runs on the
 * SHORTEST configured cadence. Clamped at both ends for reasons that are about the clamp and not
 * about a preference: below a minute is pointless for bounds measured in hours, and above an hour
 * would delay a one-hour bound's alert by as much as the bound itself.
 *
 * ── THE FIRST DELAY IS THE SLOWEST COLLECTOR'S FIRST DELAY, PLUS HEADROOM ────────────────────────
 * Raised from 5 to 7 minutes when LM4 landed. `never` is an ALERTABLE state for any ruled feed, and a
 * feed whose tier has not had its first tick yet is indistinguishable from one that has never
 * delivered — so an alarm that evaluates at the same instant as a collector's first run is a coin
 * flip on mailing a carrier about an outage that is really a cold start. The positions tier's first
 * tick is at 5 minutes (it waits out the deploy window); this waits for it. It costs two minutes once
 * per process start and nothing else, and the cadence-derived interval below is unchanged.
 */
function startFeedAlarmTier(env: Env): void {
  const cadences = Object.values(samsaraFeedCadences(env)).filter((ms) => ms > 0);
  const interval = Math.min(Math.max(Math.min(...cadences), 60_000), 3_600_000);
  startTier(env, "feed-alarm", 420_000, interval, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      try {
        const r = await runSamsaraFeedAlarm(admin, env, orgId);
        if (r.error) {
          console.error(`[samsara-sched] feed alarm failed for org ${orgId}: ${r.error}`);
        } else if (r.sent.length > 0) {
          console.log(
            `[samsara-sched] org ${orgId}: feed alarm ${r.sent.map((d) => `${d.action} ${d.feed}`).join(", ")}` +
              (r.muted ? " (muted)" : ""),
          );
        }
      } catch (e) {
        console.error(
          `[samsara-sched] feed alarm threw for org ${orgId}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  });
}

export function startSamsaraScheduler(env: Env): void {
  if (env.SAMSARA_SYNC_HOURS === 0) return; // legacy kill switch → disable all Samsara scheduling
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return; // not configured (e.g. local dev)

  startStatsTier(env, env.SAMSARA_STATS_SYNC_MINUTES * 60_000);
  startIdentityTier(env, env.SAMSARA_IDENTITY_SYNC_HOURS * 3_600_000);
  startPerformanceTier(env);
  if (env.SAMSARA_IFTA_SYNC_HOURS > 0) startIftaTier(env);
  if (env.SAMSARA_ODOMETER_SYNC_HOURS > 0) startOdometerTier(env);
  if (env.SAMSARA_RECON_SYNC_MINUTES > 0 && env.SAMSARA_RECON_BATCH > 0) startReconTier(env);
  if (env.SAMSARA_POSITIONS_SYNC_SECONDS > 0) startPositionsTier(env);
  startRetentionTier(env);
  // Reads what the tiers above recorded and says so when one of them has stopped delivering.
  startFeedAlarmTier(env);

  console.log(
    `[samsara-sched] tiered sync enabled — stats every ${env.SAMSARA_STATS_SYNC_MINUTES}m, identity every ${env.SAMSARA_IDENTITY_SYNC_HOURS}h` +
      (env.SAMSARA_POSITIONS_SYNC_SECONDS > 0
        ? `, live positions every ${env.SAMSARA_POSITIONS_SYNC_SECONDS}s`
        : ", live positions DISABLED") +
      (env.SAMSARA_RECON_SYNC_MINUTES > 0 && env.SAMSARA_RECON_BATCH > 0
        ? `, per-fill telematics ${env.SAMSARA_RECON_BATCH} fills every ${env.SAMSARA_RECON_SYNC_MINUTES}m`
        : ", per-fill telematics DISABLED"),
  );
}
