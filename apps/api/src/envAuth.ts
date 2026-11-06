import { z } from "zod";
import type { Env } from "./env.js";
import { canMintStepUp } from "./lib/stepUpToken.js";

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

/**
 * Can "Confirm it's you" work on this deploy? What it lacks, by setting NAME — never a value. Empty = ready.
 *
 * The ONE definition (Q-AD41 (b), 2026-11-06), derived from what the step-up path itself needs: the password grant in
 * `routes/authStepUp.ts` calls Supabase with SUPABASE_URL and SUPABASE_ANON_KEY (after `applyAnonKeyFallback`), and
 * `lib/stepUpToken.ts` mints and verifies with an HKDF subkey of SECRETS_ENCRYPTION_KEY — asked through
 * `canMintStepUp`, the same decode the minting runs, so a key that is set but unusable counts as missing. The route
 * refuses on this, `/api/version` reports it (`stepUp`), `pnpm verify:live` and deploy-verify read that, and the boot
 * log says it.
 *
 * Why it is loud: staging's Parameter Store lost SUPABASE_ANON_KEY and for about two weeks every step-up answered 503
 * `step_up_unavailable`. The web prompt called that a wrong password, so permission saves, ads Connect, settings
 * saves, launch and kill-switch clears all failed while looking like typing mistakes. A setting a route cannot work
 * without has to be visible where a deploy is checked, not only where a person types a password.
 */
export function stepUpMissing(env: Env): string[] {
  return [
    !env.SUPABASE_URL && "SUPABASE_URL",
    !env.SUPABASE_ANON_KEY && "SUPABASE_ANON_KEY",
    !canMintStepUp(env) && "SECRETS_ENCRYPTION_KEY",
  ].filter((name): name is string => typeof name === "string");
}

/** `/api/version`'s word for it: "ready", or "missing:" and the names, comma-separated. */
export type StepUpReadiness = "ready" | `missing:${string}`;
export function stepUpReadiness(env: Env): StepUpReadiness {
  const missing = stepUpMissing(env);
  return missing.length === 0 ? "ready" : `missing:${missing.join(",")}`;
}

/** Said once at boot when step-up cannot work, as `metaWebhookBootWarning` is for its receiver. Null when ready. */
export function stepUpBootWarning(env: Env): string | null {
  const missing = stepUpMissing(env);
  if (missing.length === 0) return null;
  return `[step-up] ⚠ ${missing.join(" and ")} not set — every "Confirm it's you" answers 503 step_up_unavailable, so no admin act behind a fresh sign-in (permission saves, ads Connect, settings saves, launch, kill-switch clear) can be done on this deploy. /api/version reports stepUp: ${stepUpReadiness(env)}.`;
}
