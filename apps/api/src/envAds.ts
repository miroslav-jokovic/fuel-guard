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
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1).optional(),
  ADS_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"), // the ads orchestrator's tick (A6); off until Stage 1's exit — docs/WORKER-DEPLOYMENT.md § Ads
};
