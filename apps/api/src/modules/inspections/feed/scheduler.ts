/**
 * The FMCSA feed's clock (INSPECTION-CHALLENGE-PLAN IC1; register: `docs/WORKER-DEPLOYMENT.md`).
 *
 * ── ⚠ ONE PROCESS FLEET-WIDE ──────────────────────────────────────────────────────────────────
 * Started from `startAllSchedulers`, so it runs wherever the schedulers run and nowhere else. Two
 * copies would not corrupt anything — a replayed snapshot is a no-op, every record version is keyed
 * — but each would add a run row a day per dataset and double our share of Socrata's anonymous pool.
 *
 * ── DUE BY THE LEDGER, NOT BY THE CLOCK ───────────────────────────────────────────────────────
 * It ticks hourly and runs an org when that org's last SUCCESSFUL inspection-file run is older than
 * `FMCSA_FEED_HOURS` (24): a deploy, a failed run or a day FMCSA was down is caught up on the next
 * tick instead of waiting a day. The inspection file is the clock because the other datasets hang
 * off it; `fmcsa_fetch_runs` is the ledger, so there is no jobs-ledger row (the boardEtaRecorder's
 * reasoning). An org with no `dot_number` has no FMCSA record to fetch and is skipped.
 */
import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { SocrataClient } from "./socrata.js";
import { lastSucceededAt } from "./store.js";
import { syncFmcsaFeed } from "./sync.js";

const TICK_MS = 60 * 60_000;
/** After boot, behind the vendor feeds that are measured in minutes. */
const BOOT_DELAY_MS = 9 * 60_000;

export function isFmcsaFeedDue(lastFinishedAt: string | null, nowMs: number, intervalMs: number): boolean {
  if (!lastFinishedAt) return true;
  const finishedMs = Date.parse(lastFinishedAt);
  return !Number.isFinite(finishedMs) || nowMs - finishedMs >= intervalMs;
}

export function startFmcsaFeedScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  if (env.FMCSA_FEED_HOURS <= 0) return;
  const intervalMs = env.FMCSA_FEED_HOURS * 60 * 60_000;

  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const admin = getSupabaseAdmin(env);
      const { data, error } = await admin.from("organizations").select("id, dot_number").not("dot_number", "is", null);
      if (error) throw new Error(error.message);
      for (const { id, dot_number } of (data ?? []) as { id: string; dot_number: string }[]) {
        const dot = dot_number.trim();
        if (!/^\d+$/.test(dot)) {
          console.error(`[fmcsa-feed] org ${id}: dot_number ${JSON.stringify(dot_number)} is not a USDOT number; skipped`);
          continue;
        }
        try {
          if (!isFmcsaFeedDue(await lastSucceededAt(admin, id, "fx4q-ay7w"), Date.now(), intervalMs)) continue;
          const client = new SocrataClient({ appToken: env.FMCSA_SOCRATA_APP_TOKEN });
          const results = await syncFmcsaFeed(admin, id, dot, client);
          const summary = results
            .map((r) => (r.outcome === "succeeded" ? `${r.dataset} ${r.rowsSeen} seen/${r.rowsNew + r.rowsChanged + r.rowsReappeared} new/${r.rowsVanished} vanished` : `${r.dataset} FAILED`))
            .join(", ");
          console.log(`[fmcsa-feed] org ${id}: ${summary} (${client.requestCount} requests)`);
        } catch (e) {
          console.error(`[fmcsa-feed] org ${id}: run failed —`, e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      console.error("[fmcsa-feed] tick failed:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  };

  const boot = setTimeout(() => void run(), BOOT_DELAY_MS);
  boot.unref?.();
  const timer = setInterval(() => void run(), TICK_MS);
  timer.unref?.();
}
