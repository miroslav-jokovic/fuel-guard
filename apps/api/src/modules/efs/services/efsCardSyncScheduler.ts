import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { orgsWithEfsSoap } from "./efsSoapCredentials.js";
import { lastDoneJob } from "../../org/index.js";

/**
 * Keep the EFS card mirror fresh.
 *
 * Cadence is deliberately slow — daily by default, not minutes — for the DOCUMENT: prompts, limits and
 * restrictions, one `getCardv2` per card. STATUS is the exception and has its own few-minute poll
 * below (EFS audit, 2026-09-30). Card CONFIGURATION changes when a human changes it, which is rare;
 * transactions change constantly and already have their own pollers
 * at 5 and 15 minutes. Sweeping cards on that cadence would spend the shared service account's rate
 * budget on data that has not moved, and the guide is explicit that excessive polling can lead to
 * account suspension by WEX IT (p11).
 *
 * Freshness where it matters is handled elsewhere and better: the detail page shows `synced_at` with a
 * staleness line past an hour, an operator can refresh one card on demand, and — the part that
 * actually protects correctness — every mutation re-reads `getCardv2` inside its own operation rather
 * than trusting the mirror. So a stale mirror makes the page slightly out of date; it can never make a
 * write wrong.
 *
 * Shape copied from efsIngestScheduler: early return when unconfigured, an in-flight guard so a slow
 * pass cannot overlap the next tick, per-org dispatch through the jobs ledger (which refuses an
 * overlapping run for the same org), and one org's failure never stopping the others.
 */
export function isEfsCardSyncDue(
  lastFinishedAt: string | null | undefined,
  nowMs: number,
  intervalMs: number,
): boolean {
  if (!lastFinishedAt) return true;
  const finishedMs = Date.parse(lastFinishedAt);
  return !Number.isFinite(finishedMs) || nowMs - finishedMs >= intervalMs;
}

/**
 * How often the daily sweep checks whether it is due. NOT the sweep's interval.
 *
 * It used to tick once per `intervalMs`, from boot. A sweep that failed then waited a full day for the
 * next tick — or for a deploy to restart the clock — and on 2026-09-30 the mirror went from a 20:47
 * success to a deploy-killed run to an EFS timeout with nothing scheduled to try again. `isEfsCardSyncDue`
 * is measured from the last SUCCESS, so ticking often costs one ledger read per org and retries a failed
 * sweep within this interval, without ever sweeping twice in a day.
 */
const SWEEP_CHECK_MS = 15 * 60_000;

export function startEfsCardSyncScheduler(env: Env): void {
  if (!env.EFS_SOAP_ENABLED) return; // the master EFS kill switch
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return; // not configured (e.g. local dev)

  startEfsCardStatusPoll(env);
  const intervalMs = Math.max(1, env.EFS_CARD_SYNC_HOURS) * 60 * 60 * 1000;
  let running = false;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      for (const orgId of await orgsWithEfsSoap(admin, env)) {
        try {
          const lastDone = await lastDoneJob(admin, orgId, "efs_card_sync");
          if (!isEfsCardSyncDue(lastDone?.finished_at, Date.now(), intervalMs)) continue;
          // A conflict means a sweep for this org is already active — that is the ledger doing its
          // job, not an error.
          await dispatchJob(admin, env, "efs_card_sync", { orgId, payload: { orgId } });
        } catch (error) {
          console.error(`[efs-cards] org ${orgId}: could not queue a card sync — ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      console.error(`[efs-cards] sweep failed — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };

  // First pass a few minutes after boot, so a deploy does not have every scheduler dial the vendor at
  // the same instant, and so the transaction feeds — which matter more — go first.
  setTimeout(() => void run(), 5 * 60_000);
  setInterval(() => void run(), Math.min(SWEEP_CHECK_MS, intervalMs));
}

/**
 * The few-minute status poll (efsCardStatusPoll.ts). Its own timer, so a nine-minute detail sweep
 * never holds it back; the jobs ledger's (org, kind) slot keeps one poll per org in flight.
 */
function startEfsCardStatusPoll(env: Env): void {
  const minutes = env.EFS_CARD_STATUS_POLL_MINUTES;
  if (minutes <= 0) return;
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      for (const orgId of await orgsWithEfsSoap(admin, env)) {
        try {
          await dispatchJob(admin, env, "efs_card_status", { orgId, payload: { orgId } });
        } catch (error) {
          console.error(`[efs-cards] org ${orgId}: could not queue a status poll — ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      console.error(`[efs-cards] status poll failed — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  // After the transaction feeds' first pass, like the sweep, but well before it.
  setTimeout(() => void run(), 2 * 60_000);
  setInterval(() => void run(), minutes * 60_000);
}
