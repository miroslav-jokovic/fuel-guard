import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { RECENT_REBUILD_DAYS } from "./scoring/index.js";
import { dispatchJob } from "../../services/queue/dispatch.js";

/**
 * Run a one-time anomaly rebuild shortly after boot so a redeploy automatically re-scores existing
 * transactions with the current rules. Reuses stored Samsara values (skipRecon via the rebuild
 * handler), so it makes NO live Samsara calls. Disable with REBUILD_ON_BOOT=false.
 *
 * P0-2 (2026-08 audit): this used to call backfillOrg DIRECTLY — the only scheduler with no
 * jobs-ledger guard, so a deploy 45s before a user's Rebuild click (or a second replica booting)
 * ran two concurrent rebuilds over the same rows, interleaving scoring writers. It now dispatches
 * the SAME `rebuild` job the button uses: the (org, kind) slot + the per-org scoring dedup key make
 * a concurrent second rebuild structurally impossible — a conflict means one is already running,
 * which is exactly the "already being handled" case, so it is skipped, not queued.
 */
export function startRebuildOnBoot(env: Env): void {
  if (!env.REBUILD_ON_BOOT) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return; // not configured (e.g. local dev)

  setTimeout(() => {
    void (async () => {
      try {
        const admin = getSupabaseAdmin(env);
        const { data: orgs } = await admin.from("organizations").select("id");
        let dispatched = 0;
        let skipped = 0;
        for (const o of orgs ?? []) {
          const result = await dispatchJob(admin, env, "rebuild", {
            orgId: o.id as string,
            payload: { sinceDays: RECENT_REBUILD_DAYS, boot: true },
          });
          if ("conflict" in result) skipped += 1; // a rebuild/scoring run already owns the org — correct, not an error
          else dispatched += 1;
        }
        if (dispatched || skipped) {
          console.log(`[rebuild-on-boot] dispatched ${dispatched} rebuild job(s), skipped ${skipped} (already running)`);
        }
      } catch (e) {
        console.error("[rebuild-on-boot] failed:", e instanceof Error ? e.message : e);
      }
    })();
  }, 45_000); // after the Samsara first-sync (~30s) so vehicle/driver data is fresh first
}
