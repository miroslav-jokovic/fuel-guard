import { z } from "zod";

/**
 * Validated server environment. Secrets live ONLY here (api), never in the web bundle.
 * Supabase + Anthropic keys are added in later phases; kept optional now so Phase 0 boots.
 */
const EnvSchema = z.object({
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
  // Where the invite email should send users to finish sign-up (the web app's accept page).
  WEB_APP_URL: z.string().url().catch("http://localhost:5173"),
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
  // Tier 2 — identity (vehicles, drivers, assignments): changes slowly, refresh rarely. Hours.
  SAMSARA_IDENTITY_SYNC_HOURS: z.coerce.number().min(0.1).default(12),
  SAMSARA_DRIVER_SCORE_SYNC_HOURS: z.coerce.number().min(0.1).default(6),
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
  // no live Samsara calls — cheap + idempotent). Set to "false" to disable.
  REBUILD_ON_BOOT: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false"),
  // Weekly AI theft digest emailed to each org's notification recipients. Set DIGEST_ENABLED=false to
  // turn off. Cadence is ~weekly (deduped via organizations.last_digest_at).
  DIGEST_ENABLED: z
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

  // ── EFS SOAP integration (docs/plans/EFS-SOAP-INTEGRATION-PLAN.md) ────────────
  // In-house EFS webservice for both posted transactions and rejected authorization attempts. Per-org
  // credentials live in efs_soap_credentials (migration 0091); these env vars are single-tenant
  // fallbacks (same pattern as SAMSARA_API_TOKEN + integration_credentials.samsara_api_token).
  //
  // EFS_SOAP_ENABLED is the master kill switch: false (default) disables the poller entirely — the
  // whole subsystem stays cold and no calls are made even if credentials happen to exist. Flip to
  // true only after (a) credentials are stored, (b) IP allowlisting is confirmed with EFS, and
  // (c) sandbox certification has passed.
  EFS_SOAP_ENABLED: z
    .string()
    .default("false")
    .transform((s) => s.toLowerCase() === "true"),
  EFS_SOAP_ENVIRONMENT: z.enum(["sandbox", "production"]).default("production"),
  EFS_SOAP_ENDPOINT_URL: z.string().url().optional(),        // SOAP endpoint URL (not the ?wsdl document URL)
  EFS_SOAP_USERNAME: z.string().optional(),                  // fallback if per-org row not set
  EFS_SOAP_PASSWORD: z.string().optional(),                  // fallback if per-org row not set
  EFS_SOAP_ACCOUNT_ID: z.string().optional(),                // Silvicom's EFS account number
  // Poll cadences per feed. Defaults are CONSERVATIVE — tighten once EFS confirms the minimum allowed
  // interval. Rejections are polled more frequently than posted transactions because they're the
  // fraud/control signal we want fresh.
  EFS_SOAP_POSTED_POLL_MINUTES: z.coerce.number().min(1).default(15),
  EFS_SOAP_REJECTED_POLL_MINUTES: z.coerce.number().min(1).default(5),
  // Rate limiting — mirrors samsaraHttp.ts. Adjust once EFS provides their per-token limits.
  EFS_SOAP_MAX_RPS: z.coerce.number().min(0.1).default(2),
  EFS_SOAP_MAX_RETRIES: z.coerce.number().int().min(0).default(4),
  // First-sync backfill window in days. Bounded so a misconfiguration can't request a decade of history.
  EFS_SOAP_BACKFILL_DAYS: z.coerce.number().int().min(1).max(730).default(90),
  // Optional egress proxy URL for the EFS SOAP client ONLY (static IP for EFS's allowlist). When unset,
  // direct Railway egress is used. When Railway Pro static outbound IPs are enabled at the platform
  // level, this stays unset and EFS allowlists the Railway IPs directly.
  EFS_SOAP_EGRESS_PROXY_URL: z.string().url().optional(),

  // GovInfo API (api.govinfo.gov) — used for HMDB/regulatory data lookups. Optional; features
  // that need it will fail clearly when unset.
  GOVINFO_API_KEY: z.string().optional(),

  // Phase 8 — email notifications. Default 'none' = no-op (the app still runs).
  // Auto-detected: if RESEND_API_KEY or BREVO_API_KEY is set and MAIL_PROVIDER is not explicitly
  // specified, the provider is activated automatically — no need to set both vars.
  MAIL_PROVIDER: z.enum(["resend", "brevo", "none"]).default("none"),
  RESEND_API_KEY: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),
  // Sender for outbound email.
  // Default uses Resend's shared test sender (onboarding@resend.dev) — no domain verification
  // required, works with just a RESEND_API_KEY. Switch to your own verified domain address
  // (e.g. "FuelGuard <miki@silvicominc.com>") once you have DNS access to verify silvicominc.com
  // in resend.com/domains.
  MAIL_FROM: z.string().default("FuelGuard <onboarding@resend.dev>"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;

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
