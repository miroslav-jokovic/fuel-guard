import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { backfillOrg, RECENT_REBUILD_DAYS } from "./scoring/index.js";
import { writeAudit } from "../lib/audit.js";

/**
 * Run a one-time anomaly rebuild shortly after boot so a redeploy automatically re-scores existing
 * transactions with the current rules (suppressions, severities, corrected location logic). It reuses
 * the Samsara values already stored on each row (skipRecon), so it makes NO live Samsara calls and is
 * cheap + idempotent — safe to run on every boot. Disable with REBUILD_ON_BOOT=false.
 */
export function startRebuildOnBoot(env: Env): void {
  if (!env.REBUILD_ON_BOOT) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return; // not configured (e.g. local dev)

  setTimeout(() => {
    void (async () => {
      try {
        const admin = getSupabaseAdmin(env);
        const { data: orgs } = await admin.from("organizations").select("id");
        let total = 0;
        for (const o of orgs ?? []) {
          const count = await backfillOrg(admin, env, o.id as string, { skipRecon: true, sinceDays: RECENT_REBUILD_DAYS });
          total += count;
          await writeAudit(admin, { orgId: o.id as string, action: "transactions.rebuild_on_boot", meta: { count } });
        }
        if (total) console.log(`[rebuild-on-boot] re-scored ${total} transaction(s) across ${orgs?.length ?? 0} org(s)`);
      } catch (e) {
        console.error("[rebuild-on-boot] failed:", e instanceof Error ? e.message : e);
      }
    })();
  }, 45_000); // after the Samsara first-sync (~30s) so vehicle/driver data is fresh first
}
