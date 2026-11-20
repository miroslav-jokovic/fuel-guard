import { z } from "zod";

/**
 * The recruiting ads agent: Meta's leadgen webhook pair and the orchestrator's switch.
 *
 * Split out of `env.ts` by concern (2026-11-06, ads Track G env-split): that file had reached its 500-line
 * budget, and the first casualty was a setting read from `process.env` beside the typed `Env` because there was
 * no room to declare it (D-AD8's sandbox allowlist). Spread into the one schema, so a deployment still gets one
 * parse and one error listing everything it is missing. Every key, default and parse moved unchanged, held so by
 * `envSplit.test.ts` against the pre-split schema's recorded outputs.
 */
export const adsEnvFields = {
  // Meta leadgen webhook (ads B4b): unset = that half answers 503; why in `modules/ads/leads/leadgenWebhook.ts`.
  META_APP_SECRET: z.string().min(1).optional(),
  // Our Meta app's id (audit A-8): with the secret it makes the app access token `debug_token` must be asked with, to
  // read when a connection's token expires. Unset = the expiry is reported as not read, with that reason.
  META_APP_ID: z.string().regex(/^\d{5,20}$/).optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1).optional(),
  // The public apply page's robot check (APPLY-PAGE-PLAN D-AP5/D-AP6): Cloudflare Turnstile's secret, verified on
  // the server. Unset = every application is recorded as "not checked" (never flagged for it), the API says so at
  // boot and the Settings card shows the check is not set up. The site key is the web build's (VITE_TURNSTILE_SITE_KEY).
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  ADS_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"), // the ads orchestrator's tick (A6); off until Stage 1's exit — docs/WORKER-DEPLOYMENT.md § Ads
  // D-AD8 (Q-AD42 (b)): the Meta ad accounts a NON-production host may use — its sandbox accounts, comma-separated,
  // `act_` optional, parsed here to bare ids. Unset or empty = that host refuses every Meta account. Production never
  // reads it. The rule and its other half (Meta shows no payment method) are in `modules/ads/guard/sandboxOnly.ts`.
  META_SANDBOX_AD_ACCOUNT_IDS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((id) => id.trim().replace(/^act_/, "")).filter((id) => id !== "")),
};
