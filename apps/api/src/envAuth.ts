import { z } from "zod";
import type { Env } from "./env.js";

/**
 * The server's own identity: Supabase, and the key that seals stored secrets and signs step-up tokens.
 *
 * Split out of `env.ts` by concern (2026-11-06, ads Track G env-split): that file had reached its 500-line
 * budget, and the first casualty was a setting read from `process.env` beside the typed `Env` because there was
 * no room to declare it (D-AD8's sandbox allowlist). Spread into the one schema, so a deployment still gets one
 * parse and one error listing everything it is missing. Every key, default and parse moved unchanged, held so by
 * `envSplit.test.ts` against the pre-split schema's recorded outputs.
 */
export const authEnvFields = {
  // Supabase (Phase 1/2). Optional so the app still boots locally without them; routes that need
  // them fail clearly at call time.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Anon (publishable) key — used ONLY by the driver-login exchange (routes/auth.ts) to sign a driver
  // in server-side with their username-backed credentials. Same key the web ships publicly.
  SUPABASE_ANON_KEY: z.string().optional(),

  // ── Secret sealing (lib/secretBox.ts) ──────────────────────────────────────────────────────────
  // 32-byte key, base64 or hex: `openssl rand -base64 32`. Required to STORE a TLS private key in
  // Postgres — without it the client-certificate upload endpoint refuses rather than writing key
  // material in the clear. Nothing else depends on it, so an existing deploy keeps booting unchanged.
  // Rotating it makes previously-sealed values unreadable; they report which key id they need.
  SECRETS_ENCRYPTION_KEY: z.string().optional(),
  // The key BEFORE the current one, during a rotation (2026-11-03 ads audit H2): values sealed under it
  // still OPEN, and every new seal uses SECRETS_ENCRYPTION_KEY. Without it, rotating the key made every
  // stored ad-platform token unreadable at once — and a live ad unpausable from here. Remove it once
  // every credential has been re-entered (or re-sealed) under the new key.
  SECRETS_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
};

export function applyAnonKeyFallback(env: Env, source: NodeJS.ProcessEnv): void {
  // Single-service deploy convenience: the web build already ships the anon key as
  // VITE_SUPABASE_ANON_KEY in the same Railway environment — accept it as the API-side fallback so the
  // driver-login exchange works without duplicating the variable. (Publishable key; not a secret.)
  if (!env.SUPABASE_ANON_KEY && source.VITE_SUPABASE_ANON_KEY) {
    (env as { SUPABASE_ANON_KEY?: string }).SUPABASE_ANON_KEY = source.VITE_SUPABASE_ANON_KEY;
    console.info("[env] SUPABASE_ANON_KEY taken from VITE_SUPABASE_ANON_KEY");
  }
}
