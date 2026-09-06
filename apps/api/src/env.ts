import { z } from "zod";
import { efsEnvFields } from "./envEfs.js";
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
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.split(",").map((o) => o.trim())),

  // Supabase (Phase 1/2). Optional so the app still boots locally without them; routes that need
  // them fail clearly at call time.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Anon (publishable) key — used ONLY by the driver-login exchange (routes/auth.ts) to sign a driver
  // in server-side with their username-backed credentials. Same key the web ships publicly.
  SUPABASE_ANON_KEY: z.string().optional(),
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

  // Sentry error monitoring (optional; no-op when unset). DSN is a project ingest key; traces
  // sampling defaults to 0 (errors only) to bound event volume/cost. See instrument.ts.
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  // HazmatGuard extraction (plan H6, D10). Vision models are PINNED in env (not the shipped AI layer's
  // in-code strings) because a verdict must record the exact model id on every run for reproducibility.
  // Pass A = a Sonnet-class vision model; Pass B = a Haiku-class model (independent-prompt cross-read).
  HAZMAT_MODEL_A: z.string().default("claude-sonnet-4-6"),
  HAZMAT_MODEL_B: z.string().default("claude-haiku-4-5"),

  // Samsara telematics (docs/10). Per-org tokens live in integration_credentials; this env var is a
  // single-tenant fallback. SAMSARA_API_URL lets tests point elsewhere.
  SAMSARA_API_TOKEN: z.string().optional(),
  SAMSARA_API_URL: z.string().url().default("https://api.samsara.com"),
  // HERE Routing v8 (truck routing for Smart Fueling). Optional: absent -> route planning is unavailable but
  // the rest of the app boots. HERE_ROUTER_URL lets tests point elsewhere.
  HERE_API_KEY: z.string().optional(),
  HERE_ROUTER_URL: z.string().url().default("https://router.hereapi.com/v8/routes"),
  // HERE Autosuggest (address autocomplete). Reuses HERE_API_KEY; when the key is unset we fall back to Nominatim.
  HERE_AUTOSUGGEST_URL: z.string().url().default("https://autosuggest.search.hereapi.com/v1/autosuggest"),
  // Base64 secret from the Samsara webhook config — used to verify incoming siphoning-alert webhooks.
  // When unset, the webhook endpoint rejects everything (fail-closed).
  SAMSARA_WEBHOOK_SECRET: z.string().optional(),
  // Background auto-sync. DEPRECATED as a cadence — kept only as a kill switch: SAMSARA_SYNC_HOURS=0
  // disables ALL Samsara schedulers (manual buttons still work). Cadence is now tiered below.
  SAMSARA_SYNC_HOURS: z.coerce.number().min(0).default(6),
  // Tier 1 — live stats (current odometer + fuel level): cheap, refresh often. Minutes.
  SAMSARA_STATS_SYNC_MINUTES: z.coerce.number().min(1).default(20),
  // Tier 5 — per-fill telematics (SAM-S3). The tier that makes collection independent of scoring.
  //
  // Before this existed, per-fill Samsara data was fetched only as a SIDE EFFECT of scoring, and the
  // bulk path set `skipRecon` to protect the vendor rate limit — so measured 2026-09-01, 10,644 of
  // 13,711 tractor fills (77.6%) had never had telematics fetched at all, and nothing incidental was
  // ever going to fill them. That starves the tank-capacity and sensor-reliability learners, which is
  // most of the 2.9% alert precision (docs/plans/samsara/SAMSARA-COLLECTION-PLAN.md §0.3–§0.4).
  //
  // The batch is a RATE BUDGET, not a target: Samsara caps /stats/history at 10 req/s per token and one
  // bucket covers up to 96 h of a single truck, so a tick of this size finishes well inside its own
  // interval and leaves the rest for the next one. Raising it is how SAM-S4 closes the historical hole;
  // 0 disables the tier without disabling the rest of Samsara sync.
  SAMSARA_RECON_SYNC_MINUTES: z.coerce.number().min(0).default(60),
  SAMSARA_RECON_BATCH: z.coerce.number().min(0).default(250),
  // How long before a fill whose attempt returned nothing is tried again. Without a cooldown the 32
  // fills Samsara has no history for would be re-claimed on every tick and, oldest-first, would wedge
  // the tier on them forever — see `BackfillOpts.reconClaim`.
  SAMSARA_RECON_RETRY_HOURS: z.coerce.number().min(1).default(72),
  // Tier 2 — identity (vehicles, drivers, assignments): changes slowly, refresh rarely. Hours.
  SAMSARA_IDENTITY_SYNC_HOURS: z.coerce.number().min(0.1).default(12),
  SAMSARA_DRIVER_SCORE_SYNC_HOURS: z.coerce.number().min(0.1).default(6),
  // IFTA jurisdiction miles (0255). Daily is generous: the figures are monthly and Samsara restates
  // only the most recent 72 hours, so nothing moves faster than that. 0 disables the tier outright.
  SAMSARA_IFTA_SYNC_HOURS: z.coerce.number().min(0).default(24),
  // Odometer readings (0311, W3b). Daily, because the collector keeps ONE reading per truck per day
  // per counter and a day is only finished once. The rolling window is four days
  // (ODOMETER_SOURCE_WINDOW_DAYS), so a skipped tick is repaired by the next one rather than leaving
  // a hole a fleet denominator would silently absorb. 0 disables the tier outright.
  SAMSARA_ODOMETER_SYNC_HOURS: z.coerce.number().min(0).default(24),
  // Nightly per-org self-heal (EFS-store repair → rescore → quick rebuild → integrity) at org-local 03:00.
  // Set to "false" to disable.
  NIGHTLY_RECONCILE_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false"),
  // Central Samsara client rate limiting (shared per org token across schedulers + recon + backfill).
  // Steady request cadence (requests/sec) — stays well under Samsara's per-token limits while letting a
  // large backfill finish in minutes. Retries honor Retry-After + exponential backoff before failing.
  SAMSARA_MAX_RPS: z.coerce.number().min(0.1).default(20),
  SAMSARA_MAX_RETRIES: z.coerce.number().int().min(0).default(4),
  // Per-ATTEMPT deadline on every Samsara request. Without one, a hung connection waited on undici's
  // 300s default and each retry paid it again. 120s is generous for the widest stats-history page and
  // still bounds a wedged batch to minutes. 0 disables (tests only).
  SAMSARA_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(0).default(120_000),
  // Two-tier priority split of SAMSARA_MAX_RPS: this fraction is RESERVED for "live" traffic (schedulers,
  // interactive recon) so a bulk backfill can never starve live data updates. Backfill gets the remainder.
  // e.g. 0.6 → live paced at 60% of the cap, backfill at 40%; combined never exceeds the token limit.
  SAMSARA_LIVE_RPS_FRACTION: z.coerce.number().min(0.1).max(1).default(0.6),
  // How many VEHICLES a live backfill reconciles in parallel. Overlaps Samsara-fetch latency + DB writes;
  // the rate limiter still caps total request rate, so this trades latency for wall-clock, not API load.
  SAMSARA_BACKFILL_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  // Geocoding for the location proximity check. Uses OpenStreetMap/Nominatim (free, no key) by default;
  // results are cached in geocode_cache so each station is looked up once. Set GEOCODING_ENABLED=false
  // to turn off. GEOCODE_PROX_MILES = how close the truck's GPS must come to the station to "confirm".
  GEOCODING_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false"),
  GEOCODE_URL: z.string().url().default("https://nominatim.openstreetmap.org/search"),
  // Historical weather backfill for idle events missing a Samsara temperature (CP2). Open-Meteo is free / no key.
  WEATHER_BACKFILL_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false"),
  OPEN_METEO_URL: z.string().url().default("https://api.open-meteo.com/v1/forecast"),
  GEOCODE_PROX_MILES: z.coerce.number().min(1).default(20),
  // Tight radius (miles) used to CONFIRM a fill when we resolved the exact station (site precision) —
  // ~0.5 mi ≈ the truck was in the station's lot. City-level geocodes never confirm (too coarse).
  SITE_PROX_MILES: z.coerce.number().min(0.05).default(0.5),
  // A location mismatch (card used where the truck wasn't) is only raised when the truck's nearest GPS
  // point was at least this far from the claimed station. If it came closer than this — even to a coarse
  // city centroid — we veto the mismatch (border crossing / reverse-geo artifact, not theft).
  LOCATION_MISMATCH_MIN_MILES: z.coerce.number().min(1).default(50),
  // Re-score every transaction with the current rules once, shortly after each boot/deploy (rules-only,
  // no live Samsara calls). Disabled by default because the scoring mutex must not starve live ingestion;
  // enable explicitly for a controlled maintenance window.
  REBUILD_ON_BOOT: z
    .string()
    .default("false")
    .transform((s) => s.toLowerCase() !== "false"),
  // Weekly AI theft digest emailed to each org's notification recipients. Set DIGEST_ENABLED=false to
  // turn off. Cadence is ~weekly (deduped via organizations.last_digest_at).
  DIGEST_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false"),

  // Driver-qualification expiry alerts (DQF plan C3): ~6h sweep, threshold-crossing emails to the
  // org's notification recipients + notification_events ledger rows. Dedupe keys make re-runs
  // silent; DQ_ALERTS_ENABLED=false turns the sweep off entirely.
  DQ_ALERTS_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false"),

  // A10's abandonment nudge — the first thing here that emails an APPLICANT unprompted, so it gets
  // its own switch. Default ON: a recapture feature nobody turns on does not exist, and the real
  // safeguards are structural (one nudge per invitation ever, nothing before 48 h, nothing without a
  // mail provider). False stops the driver email and leaves the office alert.
  // The API's own public origin, e.g. https://fleetguardapi-production.up.railway.app. Needed only to
  // rebuild the exact URL Twilio signed (A11b): a proxy rewrites what Express sees, and a signature
  // over the wrong URL fails — which is the safe direction, so this being unset refuses inbound SMS
  // rather than trusting it.
  PUBLIC_API_URL: z.string().url().optional(),

  // A11b's SMS transport. `none` until 10DLC registration completes (owner + Twilio, multi-week);
  // every send is a no-op until then. Consent, quiet hours and opt-out live in `applicationSms.ts`,
  // so flipping this cannot bypass them.
  SMS_PROVIDER: z.enum(["twilio", "none"]).default("none"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),

  APPLICATION_NUDGE_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false"),

  // Whether THIS process also runs the background schedulers in-process (default true, single-service
  // deploy). Set RUN_SCHEDULERS_IN_PROCESS=false on the API service when a dedicated worker runs them.
  RUN_SCHEDULERS_IN_PROCESS: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false"),

  // Job execution mode (plan Q8, docs/plans/P0-WORKER-QUEUE-PLAN.md). "inprocess" (default) runs job
  // `work` inline via runJob() as today; "queue" makes callers enqueue and the worker pool execute.
  // Migrated per-kind; reversible by flipping this flag.
  JOB_EXECUTION_MODE: z.enum(["inprocess", "queue"]).default("inprocess"),

  // Worker role split (plan WQ3): a worker process runs schedulers, the queue consumer, or both.
  // Deploy 1 `scheduler` replica (owns the setInterval schedulers, single-owner) + N `consumer`
  // replicas (claim + execute jobs, horizontally scalable). Default `both` = the single-worker deploy.
  WORKER_ROLE: z.enum(["scheduler", "consumer", "both"]).default("both"),

  // Automated EFS report ingestion (removes the daily manual upload). "off" (default) disables the
  // scheduler. Sources: "storage" polls a Supabase Storage bucket where reports land under
  // <orgId>/incoming/; "graph" reads an M365 mailbox via Microsoft Graph (see docs/plans/EFS-MICROSOFT365-SETUP.md).
  // EFS_INGEST_MINUTES sets the poll cadence (Chunk 3).
  EFS_INGEST_SOURCE: z.enum(["off", "storage", "graph"]).default("off"),
  EFS_INGEST_BUCKET: z.string().default("efs-reports"),
  EFS_INGEST_MINUTES: z.coerce.number().min(1).default(30),
  // Optional single-tenant guard: when set, only this org ingests (relevant for the shared "graph" mailbox
  // so a multi-org deployment can't double-read one inbox). Unset = every org uses the configured source.
  EFS_INGEST_ORG_ID: z.string().optional(),
  // Microsoft 365 "graph" source — app-only credentials from the Entra app registration. The app needs the
  // Mail.ReadWrite APPLICATION permission (read + mark-as-read) with admin consent, ideally scoped to just EFS_GRAPH_MAILBOX via an
  // Application Access Policy. EFS_GRAPH_FOLDER (optional) restricts reading to one mail folder by name.
  // Automated Pilot public posted-price fetch (fuel_prices_posted — global layer, Phase A of
  // docs/plans/FUEL-PRICE-DATA-PLAN.md). 0 disables. The page updates intra-day; 6h is a respectful cadence.
  PILOT_POSTED_FETCH_HOURS: z.coerce.number().min(0).default(6),
  PILOT_POSTED_URL: z.string().default("https://pilotcompany.com/fuel-prices"),
  // Love's "Store & Fuel Prices" Experience API (live prices) — unset until Love's grants access.
  LOVES_API_BASE_URL: z.string().url().optional(),
  LOVES_TOKEN_URL: z.string().url().optional(),
  LOVES_CLIENT_ID: z.string().optional(),
  LOVES_CLIENT_SECRET: z.string().optional(),
  LOVES_DIESEL_PRODUCT_CODES: z.string().default(""),

  EFS_GRAPH_TENANT_ID: z.string().optional(),
  EFS_GRAPH_CLIENT_ID: z.string().optional(),
  EFS_GRAPH_CLIENT_SECRET: z.string().optional(),
  EFS_GRAPH_MAILBOX: z.string().optional(),
  EFS_GRAPH_FOLDER: z.string().optional(),

  // ── Secret sealing (lib/secretBox.ts) ──────────────────────────────────────────────────────────
  // 32-byte key, base64 or hex: `openssl rand -base64 32`. Required to STORE a TLS private key in
  // Postgres — without it the client-certificate upload endpoint refuses rather than writing key
  // material in the clear. Nothing else depends on it, so an existing deploy keeps booting unchanged.
  // Rotating it makes previously-sealed values unreadable; they report which key id they need.
  SECRETS_ENCRYPTION_KEY: z.string().optional(),

  // ── Optional mutual TLS (client certificate) for the EFS SOAP endpoint ─────────────────────────
  // EFS has not yet confirmed whether their production endpoint requires a client certificate. This
  // block is INERT until a cert is supplied: with all three unset the client uses ordinary TLS and
  // behaves exactly as before, so it is safe to ship ahead of their answer. When EFS says "yes,
  // mTLS", drop the PEMs into these vars and redeploy — no code change.
  //
  // Values are PEM TEXT, not paths (Railway/Docker have no persistent secret files). Newlines may be
  // supplied literally or escaped as \n; both are normalised. Use *_B64 for a base64-encoded PEM when
  // the platform's env editor mangles multi-line values.
  EFS_SOAP_CLIENT_CERT_PEM: z.string().optional(),      // client certificate chain (leaf first)
  EFS_SOAP_CLIENT_KEY_PEM: z.string().optional(),       // matching private key
  EFS_SOAP_CLIENT_KEY_PASSPHRASE: z.string().optional(),// only if the key is encrypted
  EFS_SOAP_CLIENT_CERT_B64: z.string().optional(),
  EFS_SOAP_CLIENT_KEY_B64: z.string().optional(),
  // Extra CA bundle, if EFS's endpoint is signed by a private/enterprise root Node doesn't trust.
  EFS_SOAP_CA_PEM: z.string().optional(),
  EFS_SOAP_CA_B64: z.string().optional(),
  // PKCS#12 alternative (some issuers only hand out a .pfx). Base64 of the .p12/.pfx file.
  EFS_SOAP_CLIENT_PFX_B64: z.string().optional(),
  EFS_SOAP_CLIENT_PFX_PASSPHRASE: z.string().optional(),
  // Escape hatch for a staging endpoint with a self-signed cert. NEVER set this in production — it
  // disables certificate verification for EFS calls. Boot logs a loud warning when it is on.
  EFS_SOAP_TLS_INSECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Escape hatch for pointing the EFS SOAP client at a LOCAL endpoint — a mock CardManagementWS on
  // localhost, or a staging box on a private VLAN — during development. It disables the outbound
  // ADDRESS checks added for security audit 2026-08-09 finding 3.8 (lib/ssrfGuard.ts); https and the
  // ban on credentials embedded in the URL still apply, since neither has a development use.
  //
  // Like EFS_SOAP_TLS_INSECURE this is REFUSED — thrown, not warned about — when NODE_ENV=production.
  // Turning it on there would restore the exact request-forgery hole the guard exists to close, and a
  // bypass that can ship is not a bypass, it is the vulnerability with an env var in front of it.
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // GovInfo API (api.govinfo.gov) — used for HMDB/regulatory data lookups. Optional; features
  // that need it will fail clearly when unset.
  GOVINFO_API_KEY: z.string().optional(),
  // ── FMCSA PSP (HIRING-PLAN H7) ────────────────────────────────────────────────────────────────
  // The token is per PSP ACCOUNT, and an account belongs to a carrier. It lives in env rather than
  // in `org_integrations` because exactly one org has a PSP account today, and a per-org table with
  // one row in it is an abstraction accommodating a case that does not exist yet. When a second
  // carrier arrives this moves, and PSP-PLAN P3 is where that is written down.
  //
  // Tokens are PER ENVIRONMENT and expire after 60 days (§4.2). `PSP_ENVIRONMENT` decides the host,
  // and getting it wrong is not a harmless misconfiguration: a production request BILLS.
  //
  // One variable per PSP ACCOUNT, selected by `PSP_ENVIRONMENT` — so a token cannot be paired
  // with the other account's host. Why that is structural rather than a convention, and the two ways
  // the pair can still be wrong, are in lib/pspEnv.ts.
  PSP_API_KEY_UAT: z.string().optional(),
  PSP_API_KEY_PRODUCTION: z.string().optional(),
  PSP_ENVIRONMENT: z.enum(["uat", "production"]).default("uat"),
  /** §5.4.1 requires a DOT number or a Motor Carrier ID; PSP refuses the request without one (§8.5 detail 10). */
  PSP_DOT_NUMBER: z.string().optional(),
  PSP_MOTOR_CARRIER_ID: z.string().optional(),
  /**
   * The kill switch, and it defaults to OFF. `extractionEnabled` is the precedent: a credential being
   * present is not consent to spend on it, and PSP bills on Success, Partial AND Failure (§8). An
   * integration that starts buying the moment a key lands in the environment is one nobody chose.
   */
  /** The SECOND switch in front of production; neither means anything alone. See lib/pspEnv.ts. */
  PSP_PRODUCTION_ACKNOWLEDGED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  PSP_ORDERS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Records per org per calendar month. A runaway loop must hit a ceiling, not an invoice. */
  PSP_MONTHLY_LIMIT: z.coerce.number().int().positive().default(50),
  /**
   * What one transaction costs, in USD — and NO default, deliberately (PSP-PLAN Q2 is unanswered).
   *
   * P9 says the confirmation states the cost before the operator commits. A number we invented would
   * state it falsely, and the difference between "$10 per record" and "we have not been told the
   * price" is exactly what somebody approving a spend needs to know. Unset, the confirmation says
   * the transaction bills and shows the monthly budget instead; set, it also shows the amount.
   */
  PSP_UNIT_PRICE_USD: z.coerce.number().positive().optional(),

  // Phase 8 — email notifications. Default 'none' = no-op (the app still runs).
  // Auto-detected: if RESEND_API_KEY or BREVO_API_KEY is set and MAIL_PROVIDER is not explicitly
  // specified, the provider is activated automatically — no need to set both vars.
  MAIL_PROVIDER: z.enum(["resend", "brevo", "none"]).default("none"),
  RESEND_API_KEY: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),
  // Sender for outbound email.
  // Default uses Resend's shared test sender (onboarding@resend.dev) — no domain verification
  // required, works with just a RESEND_API_KEY. Switch to your own verified domain address
  // (e.g. "Silvicom 360 <miki@silvicominc.com>") once you have DNS access to verify silvicominc.com
  // in resend.com/domains.
  MAIL_FROM: z.string().default("Silvicom 360 <onboarding@resend.dev>"),
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

  // Single-service deploy convenience: the web build already ships the anon key as
  // VITE_SUPABASE_ANON_KEY in the same Railway environment — accept it as the API-side fallback so the
  // driver-login exchange works without duplicating the variable. (Publishable key; not a secret.)
  if (!env.SUPABASE_ANON_KEY && source.VITE_SUPABASE_ANON_KEY) {
    (env as { SUPABASE_ANON_KEY?: string }).SUPABASE_ANON_KEY = source.VITE_SUPABASE_ANON_KEY;
    console.info("[env] SUPABASE_ANON_KEY taken from VITE_SUPABASE_ANON_KEY");
  }

  checkPspEnv(env, source);

  // Auto-detect provider when MAIL_PROVIDER is left at the default "none". Brevo is preferred (it allows
  // single-sender verification with no DNS), so its key wins if both happen to be set.
  if (env.MAIL_PROVIDER === "none") {
    if (env.BREVO_API_KEY) {
      console.info("[env] MAIL_PROVIDER auto-set to 'brevo' (BREVO_API_KEY is present)");
      (env as { MAIL_PROVIDER: string }).MAIL_PROVIDER = "brevo";
    } else if (env.RESEND_API_KEY) {
      console.info("[env] MAIL_PROVIDER auto-set to 'resend' (RESEND_API_KEY is present)");
      (env as { MAIL_PROVIDER: string }).MAIL_PROVIDER = "resend";
    }
  }

  return env;
}
