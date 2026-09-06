import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { generateAndSendDigest } from "./digest.js";

const WEEK_MS = 7 * 86400_000;
const CHECK_INTERVAL_MS = 6 * 3_600_000; // re-check every 6h

async function runDueDigests(admin: SupabaseClient, env: Env): Promise<void> {
  const { data: orgs } = await admin
    .from("organizations")
    .select("id, notifications_enabled, notification_emails, last_digest_at");
  const now = Date.now();
  for (const o of orgs ?? []) {
    if (o.notifications_enabled === false) continue;
    if (!((o.notification_emails as string[] | null)?.length)) continue;
    const last = o.last_digest_at ? new Date(o.last_digest_at as string).getTime() : 0;
    if (now - last < WEEK_MS) continue; // sent within the last week

    try {
      const r = await generateAndSendDigest(admin, env, o.id as string);
      if (r.sent) {
        await admin.from("organizations").update({ last_digest_at: new Date().toISOString() }).eq("id", o.id);
        console.log(`[digest] sent weekly digest for org ${o.id}`);
      } else if (r.reason && r.reason !== "no_recipients" && r.reason !== "notifications_disabled") {
        console.error(`[digest] org ${o.id} not sent: ${r.reason}`);
      }
    } catch (e) {
      console.error(`[digest] org ${o.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
}

/**
 * Background weekly-digest scheduler. Runs ~every 6h and sends each org's digest at most once per week
 * (deduped by organizations.last_digest_at, so restarts don't double-send). Disable with DIGEST_ENABLED=false.
 */
export function startDigestScheduler(env: Env): void {
  if (!env.DIGEST_ENABLED) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runDueDigests(getSupabaseAdmin(env), env);
    } catch (e) {
      console.error("[digest] scheduler run failed:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };

  setTimeout(run, 120_000); // first check ~2 min after boot
  setInterval(run, CHECK_INTERVAL_MS);
  console.log("[digest] weekly digest scheduler enabled");
}

/**
 * Record that an org's fuel-spend sweep finished (0324).
 *
 * ── WHY IT LIVES HERE AND NOT IN THE SCHEDULER THAT CALLS IT ───────────────────────────────────
 * `organizations` is owned by this module (docs/ARCHITECTURE.md §3) and had exactly two writers —
 * `digestScheduler` above and the web settings composable. `fuelSpendRollupScheduler` stamping it
 * directly would have been the first cross-module write to it, and `lint:table-writers` said so.
 * Routing it through the owner is that gate's own instruction, and it costs one function.
 *
 * It sits in this file rather than a new one because it is the same kind of thing as
 * `last_digest_at`: a per-org scheduler marker whose whole purpose is that a restart re-checks
 * instead of re-running. Two markers, one place, one argument to read.
 */
export async function markFuelSweepComplete(
  admin: SupabaseClient,
  orgId: string,
  at: Date,
): Promise<void> {
  await admin.from("organizations").update({ last_fuel_sweep_at: at.toISOString() }).eq("id", orgId);
}
