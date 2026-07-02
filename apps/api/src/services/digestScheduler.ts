import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
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
