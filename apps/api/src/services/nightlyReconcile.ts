import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { syncFuelEventsFromEfs, scoreTouched } from "../modules/efs/index.js";
import { backfillOrg, RECENT_REBUILD_DAYS } from "../modules/anomalies/index.js";
import { syncCardAssignments } from "../modules/fuel/index.js";
import { reconcileAnomalyFlags } from "../modules/anomalies/index.js";
import { backfillFillWeather } from "../modules/fuel/index.js";
import { makeOpenMeteoFetcher } from "../lib/openMeteo.js";
import { startJob, finishJob, latestJob, startJobHeartbeat, scoringDedupKey, JobConflictError } from "../modules/org/index.js";
import { enqueueJob } from "../queue/enqueue.js";

const TARGET_HOUR = 3; // org-local hour to run the nightly self-heal

/**
 * Should the nightly reconcile run now for an org? True only during the org-local target hour AND when it
 * hasn't already run within the last ~20h — so the 30-min ticker fires it exactly once per night. Pure +
 * testable.
 */
export function shouldRunNightly(
  nowMs: number,
  tz: string,
  lastCreatedIso: string | null,
  targetHour = TARGET_HOUR,
): boolean {
  let hour: number;
  try {
    hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date(nowMs)));
  } catch {
    hour = new Date(nowMs).getUTCHours(); // unknown tz → deterministic UTC fallback
  }
  if (hour % 24 !== targetHour) return false;
  if (!lastCreatedIso) return true;
  return nowMs - new Date(lastCreatedIso).getTime() > 20 * 3_600_000;
}

/**
 * One org's nightly self-heal: repair the derived fuel events from the faithful EFS store, re-score what
 * the repair touched, then a quick rules-only rebuild so the whole fleet reflects current logic + data.
 * Returns an integrity summary for the jobs ledger (and, later, the dashboard health card + digest).
 */
export async function runNightlyReconcile(admin: SupabaseClient, env: Env, orgId: string): Promise<Record<string, unknown>> {
  const efs = await syncFuelEventsFromEfs(admin, orgId, null);
  const rescored = efs.touchedIds.length ? await scoreTouched(admin, env, orgId, efs.touchedIds) : 0;
  // Rules-only rebuild of RECENT fills (no live Samsara calls). Bounded so the nightly self-heal doesn't
  // re-score the entire history every night as the fleet grows; a manual Rebuild covers older rows after
  // a detection-logic change.
  const rebuilt = await backfillOrg(admin, env, orgId, { skipRecon: true, sinceDays: RECENT_REBUILD_DAYS });
  // WP1 D4 — keep the card→truck assignment table current from fill history (feeds decline scoring).
  const cards = await syncCardAssignments(admin, orgId).catch(() => null); // best-effort; never blocks the reconcile
  // WP6 — real ambient temperature for recent fills (drives the MPG cold-weather derate off real cold).
  const weatherFilled = await backfillFillWeather(admin, orgId, makeOpenMeteoFetcher(env)).catch(() => null);
  // Repair Fuel-Log flags whose anomalies were superseded by later logic (the bounded rebuild above
  // never revisits old fills, so stale red rows otherwise dead-end on the Alerts page forever).
  const flags = await reconcileAnomalyFlags(admin, orgId).catch(() => null); // best-effort
  return {
    driftFixed: efs.inserted + efs.updated, // rows the store repair created/corrected (0 = clean)
    efsInserted: efs.inserted,
    efsUpdated: efs.updated,
    rescored,
    rebuilt,
    cardsAssigned: cards?.assigned ?? null,
    weatherFilled,
    staleFlagsCleared: flags?.cleared ?? null,
    flagsRestored: flags?.restored ?? null,
    checkedAt: new Date().toISOString(),
  };
}

interface OrgTz {
  id: string;
  tz: string;
}

async function orgsForReconcile(admin: SupabaseClient): Promise<OrgTz[]> {
  const { data } = await admin.from("organizations").select("id, operating_hours");
  return ((data ?? []) as { id: string; operating_hours?: { tz?: string } | null }[]).map((o) => ({
    id: o.id,
    tz: o.operating_hours?.tz ?? "America/Chicago",
  }));
}

/**
 * Start the nightly reconcile scheduler. Checks every 30 min; each org runs once when it's ~03:00 in the
 * org's own timezone (via shouldRunNightly), through the jobs ledger (freshness + no overlap). In-process
 * on the single Railway instance. Set NIGHTLY_RECONCILE_ENABLED=false to disable.
 */
export function startNightlyReconcileScheduler(env: Env): void {
  if (!env.NIGHTLY_RECONCILE_ENABLED) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      const orgs = await orgsForReconcile(admin);
      const now = Date.now();
      for (const o of orgs) {
        const last = await latestJob(admin, o.id, "nightly_reconcile");
        if (!shouldRunNightly(now, o.tz, last?.created_at ?? null)) continue;
        // Queue mode (plan WQ1c): enqueue for the worker; the enqueued row's created_at marks tonight's
        // attempt, so shouldRunNightly won't re-fire it on the next 30-min tick. A conflict = already
        // queued/running for this org → skip.
        if (env.JOB_EXECUTION_MODE === "queue") {
          try {
            await enqueueJob(admin, "nightly_reconcile", { orgId: o.id });
          } catch (e) {
            if (!(e instanceof JobConflictError)) {
              console.error(`[nightly-reconcile] enqueue failed for org ${o.id}:`, e instanceof Error ? e.message : e);
            }
          }
          continue;
        }
        // In-process mode (default today): run inline through the ledger, exactly as before.
        let jobId: string;
        try {
          // P0-3: the nightly chain scores fills (efs sync + backfill) → it holds the scoring mutex,
          // so it can never interleave with a user rebuild / import scoring for the same org.
          jobId = await startJob(admin, o.id, "nightly_reconcile", { dedupKey: scoringDedupKey(o.id) });
        } catch (e) {
          if (e instanceof JobConflictError) continue; // already running
          throw e;
        }
        const stopHeartbeat = startJobHeartbeat(admin, jobId); // P0-4: long chain keeps its lease
        try {
          const stats = await runNightlyReconcile(admin, env, o.id);
          await finishJob(admin, jobId, { status: "done", stats });
        } catch (e) {
          await finishJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
          console.error(`[nightly-reconcile] org ${o.id} failed:`, e instanceof Error ? e.message : e);
        } finally {
          stopHeartbeat();
        }
      }
    } catch (e) {
      console.error("[nightly-reconcile] tick failed:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };

  setTimeout(tick, 120_000); // first check ~2 min after boot
  setInterval(tick, 30 * 60_000); // then every 30 min; the org-local-03:00 gate does the rest
  console.log("[nightly-reconcile] scheduler enabled — checks every 30m for org-local 03:00");
}
