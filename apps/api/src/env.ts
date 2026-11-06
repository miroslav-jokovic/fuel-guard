import { z } from "zod";
import { efsEnvFields } from "./envEfs.js";
import { documentReadingEnvFields } from "./envDocumentReading.js";
import { dispatchBoardEnvFields } from "./envDispatchBoard.js";
import { inspectionsEnvFields } from "./envInspections.js";
import { schedulingEnvFields } from "./envScheduling.js";
import { unitFilesEnvFields } from "./envUnitFiles.js";
import { storageBackupEnvFields } from "./envStorageBackup.js";
import { outboundEnvFields } from "./lib/outboundAllowlist.js";
import { authEnvFields, applyAnonKeyFallback } from "./envAuth.js";
import { samsaraEnvFields } from "./envSamsara.js";
import { fuelEnvFields } from "./envFuel.js";
import { efsIngestEnvFields } from "./envEfsIngest.js";
import { mailEnvFields, applyMailProvider } from "./envMail.js";
import { pspEnvFields } from "./envPsp.js";
import { adsEnvFields } from "./envAds.js";
import { collectorsEnvFields } from "./envCollectors.js";
import { checkPspEnv } from "./lib/pspEnv.js";

/**
 * Validated server environment. Secrets live ONLY here (api), never in the web bundle.
 * Supabase + Anthropic keys are added in later phases; kept optional now so Phase 0 boots.
 */
const EnvSchema = z.object({
  // One vendor integration's variables, lifted into `envEfs.ts` so this file stays inside the
  // file-size budget without a waiver. Spread rather than parsed separately: one object, one parse,
  // one error listing everything a deployment is missing.
  ...efsEnvFields,
  ...outboundEnvFields, // staging recipient guard (RELEASE-TRAIN-PLAN R4)
  ...documentReadingEnvFields, // the document reader's intake and models (DOCUMENT-READER-PLAN)
  ...dispatchBoardEnvFields, // the dispatch board's HOS clocks poll (DISPATCH-BOARD-PLAN DB3)
  ...inspectionsEnvFields, // the FMCSA open-data feed (INSPECTION-CHALLENGE-PLAN IC1)
  ...schedulingEnvFields, // which process runs which schedulers (PLATFORM-RELIABILITY-PLAN D-RLY2)
  ...unitFilesEnvFields, // reading uploaded papers (UNIT-FILES-PLAN UF7b2)
  ...storageBackupEnvFields, // the nightly off-provider copy of every evidence bucket (storageBackup.ts)
  // Split by concern on 2026-11-06 (ads Track G env-split), so this file holds only the process's own
  // settings and `loadEnv`. Every key, default and parse moved unchanged — `envSplit.test.ts`.
  ...authEnvFields, // Supabase + the sealing key (step-up signs with a subkey of it)
  ...samsaraEnvFields, // Samsara token, webhook secret, sync tiers
  ...fuelEnvFields, // routing, geocoding, weather, nightly reconcile, posted prices
  ...efsIngestEnvFields, // EFS report ingestion + SOAP mutual TLS
  ...mailEnvFields, // email, SMS, the applicant nudge
  ...pspEnvFields, // FMCSA PSP
  ...adsEnvFields, // the recruiting ads agent
  ...collectorsEnvFields, // FleetPal, Med-Stop
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.split(",").map((o) => o.trim())),

  // Where the invite email should send users to finish sign-up (the web app's accept page).
  WEB_APP_URL: z.string().url().default("http://localhost:5173"),
  // Split-service web deploy: the API origin baked into the web bundle. The API also uses it for CSP
  // connect-src so browser calls are allowed when the SPA and API live on separate Railway services.
  VITE_API_URL: z.string().url().optional(),
  // Single-service deploy: absolute path to the built web SPA to serve. Defaults next to the API
  // (apps/web/dist). Leave unset in API-only/dev runs and nothing static is served.
  WEB_DIST: z.string().optional(),
  // Phase 5.5 (Anthropic).
  ANTHROPIC_API_KEY: z.string().optional(),
  // Office chat's "Catch me up" (OFFICE-CHAT-PLAN CH12): a short summary, so the small model.
  CHAT_CATCHUP_MODEL: z.string().min(1).default("claude-haiku-5-5"),

  // Sentry error monitoring (optional; no-op when unset). DSN is a project ingest key; traces
  // sampling defaults to 0 (errors only) to bound event volume/cost. See instrument.ts.
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),


  // Driver-qualification expiry alerts (DQF plan C3): ~6h sweep, threshold-crossing emails to the
  // org's notification recipients + notification_events ledger rows. Dedupe keys make re-runs
  // silent; DQ_ALERTS_ENABLED=false turns the sweep off entirely.
  DQ_ALERTS_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false"),

  // The API's own public origin, e.g. https://fleetguardapi-production.up.railway.app. It is what the
  // Samsara settings card prints for an operator to paste; unset, the card prints a bare path and the
  // operator reconstructs the URL, which is exactly how it once became `/api/webhooks`.
  //
  // ⚠ It used to be load-bearing for inbound SMS too, because Twilio signs the full request URL and a
  // proxy rewrites what Express sees. Telnyx signs `timestamp|body` and never the URL, so since the
  // 2026-09-06 provider swap nothing about SMS depends on this being right.
  PUBLIC_API_URL: z.string().url().optional(),

  // GovInfo API (api.govinfo.gov) — used for HMDB/regulatory data lookups. Optional; features
  // that need it will fail clearly when unset.
  GOVINFO_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

// PSP token selection lives in lib/pspEnv.ts; re-exported so callers keep one import site.
export { pspApiKey, pspApiKeyVar } from "./lib/pspEnv.js";

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV === "production") {
    const missing = [
      !env.SUPABASE_URL && "SUPABASE_URL",
      !env.SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
      env.WEB_APP_URL.startsWith("http://localhost") && "WEB_APP_URL",
      env.ALLOWED_ORIGINS.some((origin) => origin.startsWith("http://localhost")) && "ALLOWED_ORIGINS",
    ].filter(Boolean) as string[];
    if (missing.length) {
      throw new Error(`Invalid production environment: missing or unsafe configuration: ${missing.join(", ")}`);
    }
  }

  applyAnonKeyFallback(env, source);

  checkPspEnv(env, source);

  applyMailProvider(env);

  return env;
}
