// src/orchestration/ — the sanctioned home of cross-module chains (program step P1.8). This one is the
// warning desk's tick (WARNING-DESK-PLAN WD2/WD3): the desk's rules (followups) decide what the Samsara
// collector reads, the collector writes its staging, and the desk turns it into follow-ups. Composed
// from each owner's exported interface; no table is named here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { alertRuleKey, resolveFollowUpRules, type WarningSource } from "@silvicom/shared";
import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import {
  listActiveWarnings,
  listSubjectWarnings,
  listWarningsUpdatedSince,
  NoSamsaraTokenError,
  readAlertConfigurations,
  syncSamsaraWarnings,
  type WarningsSyncResult,
} from "../modules/samsara/index.js";
import { evaluateFollowUps, readRuleOverrides, type EvaluateResult } from "../modules/followups/index.js";
import { finishJob, lastDoneJob, startJob, startJobHeartbeat, JobConflictError } from "../modules/org/index.js";
import { enqueueJob } from "../queue/enqueue.js";
import { orgsToSync } from "../modules/samsara/lib/tierRunner.js";

/** Every five minutes (D-WD2): a call made about a warning an hour old is a call about the past. */
export const WARNING_DESK_INTERVAL_MS = 5 * 60_000;
/** First tick after the deploy window (docs/MIGRATION-DISCIPLINE.md §the-deploy-window). */
const FIRST_DELAY_MS = 6 * 60_000;
/** Re-evaluate what changed since the last good pass, less this overlap; at most this far back. */
const EVALUATE_OVERLAP_MS = 10 * 60_000;
const EVALUATE_MAX_LOOKBACK_MS = 8 * 86_400_000;

export interface WarningDeskResult {
  sync: WarningsSyncResult;
  evaluate: EvaluateResult;
}

/** One org's pass: rules → collect → evaluate. A collector failure still evaluates what was collected. */
export async function runWarningDesk(admin: SupabaseClient, env: Env, orgId: string, now: Date): Promise<WarningDeskResult> {
  const configs = await readAlertConfigurations(admin, env, orgId);
  const rules = resolveFollowUpRules(configs, await readRuleOverrides(admin, orgId));
  const enabled = rules.filter((r) => r.enabled);
  const sources = new Set<WarningSource>(enabled.map((r) => r.source));
  const alertConfigs = configs.filter((c) => enabled.some((r) => r.key === alertRuleKey(c.id)));

  let sync: WarningsSyncResult;
  let syncError: Error | null = null;
  try {
    sync = await syncSamsaraWarnings(admin, env, orgId, { now, sources, alertConfigs });
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) throw e;
    syncError = e instanceof Error ? e : new Error(String(e));
    sync = (e as { result?: WarningsSyncResult }).result ?? {};
  }

  const lastGood = await lastDoneJob(admin, orgId, "warning_desk");
  const lastMs = lastGood?.started_at ? Date.parse(lastGood.started_at) : NaN;
  const sinceMs = Math.max(
    now.getTime() - EVALUATE_MAX_LOOKBACK_MS,
    Number.isFinite(lastMs) ? lastMs - EVALUATE_OVERLAP_MS : -Infinity,
  );
  const evaluate = await evaluateFollowUps(admin, orgId, {
    now,
    rules,
    sinceIso: new Date(sinceMs).toISOString(),
    readers: {
      updatedSince: (since) => listWarningsUpdatedSince(admin, orgId, since),
      active: (kinds) => listActiveWarnings(admin, orgId, kinds),
      subject: (q) => listSubjectWarnings(admin, orgId, q),
    },
  });

  if (syncError) {
    const err = new Error(`${syncError.message} (evaluated: ${evaluate.opened} opened, ${evaluate.refreshed} refreshed)`);
    throw err;
  }
  return { sync, evaluate };
}

/** The tick, in-process or queued, through the jobs ledger like every Samsara tier (one run per org at a time). */
export function startWarningDeskScheduler(env: Env): void {
  if (env.SAMSARA_SYNC_HOURS === 0) return; // the Samsara kill switch stops this tier too
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      for (const orgId of await orgsToSync(admin, env)) {
        if (env.JOB_EXECUTION_MODE === "queue") {
          try {
            await enqueueJob(admin, "warning_desk", { orgId });
          } catch (e) {
            if (!(e instanceof JobConflictError)) console.error(`[warning-desk] enqueue failed for org ${orgId}:`, e instanceof Error ? e.message : e);
          }
          continue;
        }
        let jobId: string;
        try {
          jobId = await startJob(admin, orgId, "warning_desk");
        } catch (e) {
          if (e instanceof JobConflictError) continue;
          throw e;
        }
        const stopHeartbeat = startJobHeartbeat(admin, jobId);
        try {
          const r = await runWarningDesk(admin, env, orgId, new Date());
          await finishJob(admin, jobId, { status: "done", stats: { ...r } });
        } catch (e) {
          if (e instanceof NoSamsaraTokenError) {
            await finishJob(admin, jobId, { status: "done", stats: { skipped: "no token" } });
          } else {
            await finishJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
            console.error(`[warning-desk] org ${orgId} failed:`, e instanceof Error ? e.message : e);
          }
        } finally {
          stopHeartbeat();
        }
      }
    } catch (e) {
      console.error("[warning-desk] tick failed:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, FIRST_DELAY_MS);
  setInterval(tick, WARNING_DESK_INTERVAL_MS);
  console.log("[warning-desk] enabled — Samsara warnings → follow-ups every 5m");
}
