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
  // The public apply page's robot check (APPLY-PAGE-PLAN D-AP5/D-AP6): Cloudflare Turnstile's widget, as a PAIR — the
  // site key the page shows (public; served by the API so one deploy sets both) and the secret the server verifies
  // with. Either one unset = the check is off (`turnstileKeys`): every application is recorded as "not checked",
  // never flagged for it, the API says so at boot and the Settings card says it is not set up. One key without the
  // other would flag every applicant (a widget with nothing to verify it, or a verifier with no widget).
  TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  // Where the careers pages are served (APPLY-PAGE-PLAN D-AP9): `https://<CAREERS_HOST>` from `infra/server/<env>.env`,
  // set by compose.yml from the same value Caddy routes on, so the link, the robot check's hostname and the front
  // door cannot disagree. Unset (a laptop, a test) = the office app's own origin, `WEB_APP_URL`, which serves
  // `/careers` too.
  CAREERS_URL: z.string().url().optional(),
  ADS_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"), // the ads orchestrator's tick (A6); off until Stage 1's exit — docs/WORKER-DEPLOYMENT.md § Ads
  // D-AD8 (Q-AD42 (b)): the Meta ad accounts a NON-production host may use — its sandbox accounts, comma-separated,
  // `act_` optional, parsed here to bare ids. Unset or empty = that host refuses every Meta account. Production never
  // reads it. The rule and its other half (Meta shows no payment method) are in `modules/ads/guard/sandboxOnly.ts`.
  META_SANDBOX_AD_ACCOUNT_IDS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((id) => id.trim().replace(/^act_/, "")).filter((id) => id !== "")),
};
