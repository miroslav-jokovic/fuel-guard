import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { sweepExpiredExports } from "./dqExports.js";

/**
 * The seven-day export sweep (DQ-BINDER-PLAN D-BD4).
 *
 * A finished binder is a PII aggregate that exists to be sent: fifteen drivers' licences, medical
 * certificates and addresses in one file. The source scans are retained for years because §391.51
 * says so; the aggregate has no such claim on us, and every day it sits in a bucket is a day it can
 * leak. Regenerating one is a click.
 *
 * The ROW is never touched — `sweepExpiredExports` clears the object and stamps `purged_at`, so the
 * record of who exported which driver's file survives long after the file itself is gone (D-BD9).
 *
 * Same shape as every other scheduler here: interval, in-flight guard, env-gated, failures logged,
 * never crashes the process. Run in EXACTLY ONE process (see startAllSchedulers).
 */
const HOURLY_MS = 60 * 60 * 1000;

export function startDqExportSweeper(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      // Hourly rather than daily: the expiry is a promise about how long these bytes exist, and a
      // daily pass would make "seven days" mean "up to eight". The query is a bounded indexed read
      // that returns nothing on almost every run.
      const { purged } = await sweepExpiredExports(getSupabaseAdmin(env));
      if (purged > 0) console.log(`[dq-exports] swept ${purged} expired binder(s)`);
    } catch (e) {
      console.error("[dq-exports] sweep failed:", e instanceof Error ? e.message : e);
    }
    inFlight = false;
  };

  const timer = setInterval(() => void run(), HOURLY_MS);
  timer.unref?.();
  // Runs one interval in, like the storage reconciler — nothing expires in the first hour of a boot.
}
