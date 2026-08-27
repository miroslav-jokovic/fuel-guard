import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../../services/queue/dispatch.js";
import { orgsWithEfsSoap } from "./efsSoapCredentials.js";
import { lastDoneJob } from "../../org/index.js";

/**
 * Keep the EFS card mirror fresh.
 *
 * Cadence is deliberately slow — daily by default, not minutes. Card CONFIGURATION changes when a
 * human changes it, which is rare; transactions change constantly and already have their own pollers
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

export function startEfsCardSyncScheduler(env: Env): void {
  if (!env.EFS_SOAP_ENABLED) return; // the master EFS kill switch
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return; // not configured (e.g. local dev)

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
  setInterval(() => void run(), intervalMs);
}
