import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";

let client: SupabaseClient | null = null;

/**
 * Service-role Supabase client (bypasses RLS). API-only — never shipped to the browser.
 * Every caller must independently derive org_id from the verified JWT and ownership-check ids
 * before writing (audit B5). Lazily created so the app boots without Supabase configured.
 */
export function getSupabaseAdmin(env: Env): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase admin not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}
