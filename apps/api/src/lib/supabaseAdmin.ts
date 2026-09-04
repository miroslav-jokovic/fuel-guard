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

/**
 * The auth user holding `email`, if any — by id only.
 *
 * supabase-js's admin surface has `getUserById` and a paged `listUsers`, and no lookup by address;
 * paging every account to find one is a scan that grows with the customer base. GoTrue's own admin
 * endpoint takes a `filter` (an ILIKE over email and phone — the dashboard's user search is built
 * on it), so this asks that directly and then matches the address EXACTLY, because the filter is a
 * substring match and `ann@x.test` must not resolve to `joann@x.test`.
 *
 * Read-only, service role. Used when an invitation is redeemed by an address GoTrue already knows —
 * an account created by an earlier invitation that was never finished, or a former member invited
 * back — so the invitation can set that account's password instead of failing on "already exists".
 */
export async function findAuthUserIdByEmail(env: Env, email: string): Promise<string | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase admin not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  const wanted = email.trim().toLowerCase();
  const url = `${env.SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(wanted)}&per_page=50`;
  const res = await fetch(url, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`GoTrue admin user lookup failed (${res.status})`);
  const body = (await res.json()) as { users?: Array<{ id: string; email?: string | null }> };
  return body.users?.find((u) => (u.email ?? "").toLowerCase() === wanted)?.id ?? null;
}
