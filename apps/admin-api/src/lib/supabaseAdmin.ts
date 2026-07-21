import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";

let client: SupabaseClient | null = null;

/**
 * Service-role Supabase client for the platform plane (bypasses RLS). Lives ONLY in this service.
 * Every cross-tenant read/write must go through the audited data-access layer, never ad-hoc here.
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
