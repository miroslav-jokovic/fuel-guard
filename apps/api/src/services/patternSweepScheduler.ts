import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { dispatchJob } from "./queue/dispatch.js";

const INTERVAL_MS = 60_000;

/** Drain pattern-sweep requests that survived a dispatch outage. */
export function startPatternSweepScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const admin = getSupabaseAdmin(env);
  let inFlight = false;
  const run = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const { data, error } = await admin
        .from("pattern_sweep_requests")
        .select("id, org_id, anomaly_id, attempts")
        .in("status", ["pending", "failed"])
        .lte("next_attempt_at", new Date().toISOString())
        .order("next_attempt_at", { ascending: true })
        .limit(25);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as { id: string; org_id: string; anomaly_id: string; attempts: number }[]) {
        const claimed = await admin
          .from("pattern_sweep_requests")
          .update({ status: "running", attempts: row.attempts + 1, updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .in("status", ["pending", "failed"])
          .select("id")
          .maybeSingle();
        if (claimed.error || !claimed.data) continue;
        try {
          const dispatched = await dispatchJob(admin, env, "pattern_sweep", {
            orgId: row.org_id,
            payload: { anomalyId: row.anomaly_id, requestId: row.id },
            dedupKey: `sweep:${row.anomaly_id}`,
          });
          if ("conflict" in dispatched) {
            await admin.from("pattern_sweep_requests").update({
              status: "pending", next_attempt_at: new Date(Date.now() + 60_000).toISOString(), updated_at: new Date().toISOString(),
            }).eq("id", row.id);
          }
        } catch (dispatchError) {
          await admin.from("pattern_sweep_requests").update({
            status: "failed",
            next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
            last_error: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
            updated_at: new Date().toISOString(),
          }).eq("id", row.id);
        }
      }
    } catch (error) {
      console.error("[pattern-sweep] scheduler failed:", error instanceof Error ? error.message : error);
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(() => void run(), INTERVAL_MS);
  void run();
  void timer;
}
