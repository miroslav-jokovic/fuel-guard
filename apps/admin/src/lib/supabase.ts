import { createClient } from "@supabase/supabase-js";

// Platform browser client: anon key + persisted session (MFA/AAL2 handled by Supabase Auth). Only
// non-secret VITE_ values reach the bundle — the service-role key lives ONLY in admin-api.
const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

/** Base URL of the platform API (admin-api), e.g. https://admin.<domain>. */
export const ADMIN_API_URL = import.meta.env.VITE_ADMIN_API_URL ?? "";
