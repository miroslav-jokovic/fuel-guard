import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { sweepExpiredChatExports } from "./chatComplianceRecords.js";

/**
 * The seven-day sweep of office chat exports (OFFICE-CHAT-PLAN CHA3b, D-CHAT20). An export is the
 * org's words in three files, made for one matter; the record of it (who, why, which ledger
 * position, the hashes) is kept for good, the files are not. Same shape and same reasons as
 * `dqExportSweeper.ts`, which sweeps the audit binders in the same bucket: hourly, so "seven days"
 * does not mean "up to eight"; a first tick four minutes after boot, because the process restarts far
 * more often than hourly; an in-flight guard; failures logged, never thrown. EXACTLY ONE process.
 */
const HOURLY_MS = 60 * 60 * 1000;

export function startChatExportSweeper(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const { purged } = await sweepExpiredChatExports(getSupabaseAdmin(env));
      if (purged > 0) console.log(`[chat-exports] swept ${purged} expired export(s)`);
    } catch (e) {
      console.error("[chat-exports] sweep failed:", e instanceof Error ? e.message : e);
    }
    inFlight = false;
  };
  const boot = setTimeout(() => void run(), 4 * 60_000);
  boot.unref?.();
  const timer = setInterval(() => void run(), HOURLY_MS);
  timer.unref?.();
}
