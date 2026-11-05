import { DEFAULT_ORG_TIMEZONE, wallClockInZone } from "@silvicom/shared";
import type { Env } from "../../../../env.js";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../../../queue/dispatch.js";
import { metaConnectionsTick, type BackfillEnqueue } from "../../leads/backfillTick.js";

/**
 * The `ads-daily-brief` scheduler (F1b; docs/WORKER-DEPLOYMENT.md, ads row): every hour, from 07:00 in the
 * carrier's zone, one `ads_daily_brief` job per carrier with a Meta (or simulator) connection that is
 * `connected` or `failing` — the hourly jobs' own connection read (`metaConnectionsTick`).
 *
 * Every hour from 07:00, not once at 07:00: a deploy or a crash in that hour delays the brief, never loses
 * it. The job stops at once for a day already sent (`dailyBrief.ts`), so the repeats cost one ledger read.
 * `dedup_key` = `ads_daily_brief:<org>`: one per carrier however many connections it has — a second
 * connection's enqueue is the queue's "already on it".
 *
 * Off unless `ADS_ENABLED`. First tick nine minutes after boot, after the insights pull's first run, so
 * the morning's brief reads the hours that pull just settled.
 */
export const ADS_DAILY_BRIEF_MS = 60 * 60_000;
const FIRST_TICK_MS = 9 * 60_000;
/** The zone-local hour the brief is first written: the night's late hours have had seven hours to settle. */
export const BRIEF_HOUR = 7;

export const adsDailyBriefDedupKey = (orgId: string): string => `ads_daily_brief:${orgId}`;

export function briefDue(now: Date, zone: string = DEFAULT_ORG_TIMEZONE): boolean {
  return wallClockInZone(now, zone).hour >= BRIEF_HOUR;
}

export function dailyBriefEnqueue(admin: ReturnType<typeof getSupabaseAdmin>, env: Env): BackfillEnqueue {
  return async (orgId) => {
    const r = await dispatchJob(admin, env, "ads_daily_brief", { orgId, payload: {}, dedupKey: adsDailyBriefDedupKey(orgId) });
    return "conflict" in r ? "conflict" : "queued";
  };
}

export function startAdsDailyBrief(env: Env): void {
  if (!env.ADS_ENABLED) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let running = false;
  const run = async (): Promise<void> => {
    if (running || !briefDue(new Date())) return;
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      const r = await metaConnectionsTick(admin, dailyBriefEnqueue(admin, env));
      if (r.queued > 0) console.log(`[ads-daily-brief] ${r.queued} brief(s) queued for ${r.connections} connection(s)`);
    } catch (error) {
      console.error(`[ads-daily-brief] tick failed — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), FIRST_TICK_MS);
  setInterval(() => void run(), ADS_DAILY_BRIEF_MS);
}
