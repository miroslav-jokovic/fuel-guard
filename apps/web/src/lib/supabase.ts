import { createClient } from "@supabase/supabase-js";

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS === "true";

// Browser client: anon key + persisted session. Only VITE_ (non-secret) values reach the bundle.
// In dev-bypass mode we use placeholder values so the client initialises without crashing;
// no real Supabase network calls are made because the session store is fully mocked.
const url = import.meta.env.VITE_SUPABASE_URL ?? (DEV_BYPASS ? "https://placeholder.supabase.co" : "");
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? (DEV_BYPASS ? "placeholder" : "");

export { DEV_BYPASS };
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // needed for the invite/magic-link redirect
  },
});
