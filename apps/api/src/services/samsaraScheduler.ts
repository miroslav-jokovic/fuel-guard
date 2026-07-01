import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { syncVehiclesFromSamsara, NoSamsaraTokenError } from "./samsaraVehicleSync.js";
import { syncDriversFromSamsara } from "./samsaraDriverSync.js";

/** Orgs to auto-sync: those with a per-org token, plus all orgs when a single-tenant env token is set. */
async function orgsToSync(admin: SupabaseClient, env: Env): Promise<string[]> {
  const set = new Set<string>();
  const { data: creds } = await admin
    .from("integration_credentials")
    .select("org_id, samsara_api_token, enabled");
  for (const c of creds ?? []) {
    if (c.enabled !== false && c.samsara_api_token) set.add(c.org_id as string);
  }
  if (env.SAMSARA_API_TOKEN) {
    const { data: orgs } = await admin.from("organizations").select("id");
    for (const o of orgs ?? []) set.add(o.id as string);
  }
  return [...set];
}

/** Sync one org: drivers first (so assignments can resolve), then vehicles + odometer + assignments. */
async function syncOrg(admin: SupabaseClient, env: Env, orgId: string): Promise<void> {
  try {
    await syncDriversFromSamsara(admin, env, orgId);
    await syncVehiclesFromSamsara(admin, env, orgId);
    await admin
      .from("integration_credentials")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("org_id", orgId);
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) return; // org has no token → nothing to do
    console.error(`[samsara-sync] org ${orgId} failed:`, e instanceof Error ? e.message : e);
  }
}

/**
 * Start the background Samsara sync so telematics data (vehicles, odometer, drivers, assignments)
 * refreshes automatically — no manual button. Runs shortly after boot, then every SAMSARA_SYNC_HOURS.
 * Set SAMSARA_SYNC_HOURS=0 to disable. Runs in-process on the single Railway instance.
 */
export function startSamsaraScheduler(env: Env): void {
  const hours = env.SAMSARA_SYNC_HOURS;
  if (!hours || hours <= 0) return; // disabled
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return; // not configured (e.g. local dev)

  let running = false;
  const run = async () => {
    if (running) return; // never overlap runs
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      const orgIds = await orgsToSync(admin, env);
      for (const orgId of orgIds) await syncOrg(admin, env, orgId);
      if (orgIds.length) console.log(`[samsara-sync] refreshed ${orgIds.length} org(s)`);
    } catch (e) {
      console.error("[samsara-sync] scheduler run failed:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };

  setTimeout(run, 30_000); // first refresh ~30s after startup
  setInterval(run, hours * 3_600_000);
  console.log(`[samsara-sync] scheduler enabled — every ${hours}h`);
}
