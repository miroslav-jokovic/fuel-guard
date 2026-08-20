import type { Env } from "../env.js";

/**
 * Which PSP token a process may use, and the two ways that configuration can be wrong.
 *
 * ── ONE VARIABLE PER ACCOUNT, SELECTED BY ENVIRONMENT ──────────────────────────────────────────
 * There used to be a single `PSP_API_KEY`, and nothing checked that its account matched the host
 * `PSP_ENVIRONMENT` chose. Twice on 2026-08-20 the wrong one was loaded — once by a copied value,
 * once by an agent that compared sha256 fingerprints and picked the file whose name lacked `-uat`.
 * Both times the symptom was §8.5 detail 32, "Your token is invalid", which names the token and says
 * nothing about the account it belongs to.
 *
 * Neither direction can spend money — a token answers 401 against the other environment's host,
 * observed both ways — so this is not a spend control. It is a diagnosability control, and the thing
 * being designed out is a mismatch that is possible to express at all. The pairing is now structural:
 * `production` reads the production variable and can read nothing else.
 *
 * A token cannot be told from its own bytes; only the service can say which account issued it.
 * `pnpm --filter @fuelguard/api psp:uat --verify-key` is that check, and it costs nothing.
 *
 * This lives beside `env.ts` rather than inside it because that file crossed the 500-line budget when
 * the pair arrived. The import is type-only in this direction, so nothing circular exists at runtime.
 */

/**
 * ── TWO SWITCHES IN FRONT OF PRODUCTION, BECAUSE ONE IS NOT ENOUGH ─────────────────────────────
 * `PSP_ENVIRONMENT` decides the host, and flipping it from `uat` to `production` is a one-word edit
 * that turns every subsequent order into a real charge against a live account-holder agreement — and
 * into a real person's crash and violation history. That is too much consequence for a value that
 * looks like configuration.
 *
 * So production needs BOTH: the environment set to `production` AND `PSP_PRODUCTION_ACKNOWLEDGED`
 * set explicitly. A typo, a copied `.env`, or a deploy template carrying the wrong value cannot start
 * spending on its own, because neither switch means anything without the other. `PSP_ORDERS_ENABLED`
 * is the third: a credential arriving in the environment is not consent to spend with it.
 */

/** The PSP token for the environment currently selected, or null. Empty strings count as unset. */
export function pspApiKey(env: Env): string | null {
  const key = env.PSP_ENVIRONMENT === "production" ? env.PSP_API_KEY_PRODUCTION : env.PSP_API_KEY_UAT;
  return key && key.trim() !== "" ? key : null;
}

/** Which variable `pspApiKey` reads — so a refusal can name the one that is missing. */
export function pspApiKeyVar(env: Env): string {
  return env.PSP_ENVIRONMENT === "production" ? "PSP_API_KEY_PRODUCTION" : "PSP_API_KEY_UAT";
}

/**
 * The two ways the pair can be misconfigured, checked once at load.
 *
 * Called by `loadEnv` after parsing. One throws and one only warns, and the difference is what the
 * wrong answer costs: identical tokens are a statement that cannot be true, while a stale variable on
 * a deployed service is merely untidy — and failing to boot over it would take the API down to fix a
 * PSP misconfiguration. Pinned by "refuses two environments sharing one token" and "ignores the
 * retired PSP_API_KEY rather than failing a deploy that still carries it".
 */
export function checkPspEnv(env: Env, source: NodeJS.ProcessEnv): void {
  // Setting both to the same string says one account is UAT and production at once. That is never
  // true, and it would restore exactly the confusion the pair was split to end. It cannot fire on a
  // deploy that has only one of them set.
  if (
    env.PSP_API_KEY_UAT
    && env.PSP_API_KEY_PRODUCTION
    && env.PSP_API_KEY_UAT === env.PSP_API_KEY_PRODUCTION
  ) {
    throw new Error(
      "Invalid environment configuration: PSP_API_KEY_UAT and PSP_API_KEY_PRODUCTION hold the same "
      + "token. They are different accounts and must be different tokens.",
    );
  }

  if (source.PSP_API_KEY && !pspApiKey(env)) {
    console.info(
      `[env] PSP_API_KEY is no longer read. Rename it to ${pspApiKeyVar(env)} (PSP is unconfigured until you do).`,
    );
  }
}
