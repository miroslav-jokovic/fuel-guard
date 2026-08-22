import { z } from "zod";
import { checkPspEnv } from "./lib/pspEnv.js";

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
  // Does THIS host serve the fuel-card routes at all? (Step 5.10)
  //
  // Two Railway services run this same image: `fleetguardapi` is whitelisted by WEX and is where the
  // pollers run, and `fleetguardweb` serves the SPA plus a full, identical copy of the API whose
  // egress WEX's firewall refuses. So every fuel-card route exists on the web host and every one of
  // them fails there — as a vendor `NotAllowed`, which reads like an entitlement problem with the
  // ACCOUNT rather than a request that arrived at the wrong building.
  //
  // Set to false on the web service. A route that cannot succeed should not exist rather than fail
  // politely, and this is preferred over whitelisting a second egress IP: fewer whitelisted addresses
  // is the stronger position with WEX.
  //
  // Defaults TRUE, deliberately. The default has to be the behaviour of the host that matters, so a
  // forgotten variable degrades to "the API host serves its routes" rather than to a silent, total
  // outage of card control that every gate would report as healthy.
  EFS_ROUTES_ENABLED: z.string().default("true").transform((s) => s.toLowerCase() !== "false"),
  EFS_SOAP_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  EFS_SOAP_ENDPOINT_URL: z.string().url().optional(),        // SOAP endpoint URL (not the ?wsdl document URL)
  EFS_SOAP_USERNAME: z.string().optional(),                  // fallback if per-org row not set
  EFS_SOAP_PASSWORD: z.string().optional(),                  // fallback if per-org row not set
  EFS_SOAP_ACCOUNT_ID: z.string().optional(),                // optional account identifier; not sent to CardManagementWS
  // Optional production-org scope for the env fallback. Without this, the fallback applies to every org.
  EFS_SOAP_ORG_ID: z.string().uuid().optional(),
  // Poll cadences per feed. Defaults are CONSERVATIVE — tighten once EFS confirms the minimum allowed
  // interval. Rejections are polled more frequently than posted transactions because they're the
  // fraud/control signal we want fresh.
  EFS_SOAP_POSTED_POLL_MINUTES: z.coerce.number().min(1).default(15),
  EFS_SOAP_REJECTED_POLL_MINUTES: z.coerce.number().min(1).default(5),
  // Rate limiting — mirrors samsaraHttp.ts. Adjust once EFS provides their per-token limits.
  EFS_SOAP_MAX_RPS: z.coerce.number().min(0.1).default(2),
  EFS_SOAP_MAX_RETRIES: z.coerce.number().int().min(0).default(4),
  // Card control's own request budget. Deliberately NOT a third slice of EFS_SOAP_MAX_RPS: splitting
  // that would silently slow both existing pollers the day card control ships. The cost of the
  // choice is that total offered load is EFS_SOAP_MAX_RPS + EFS_SOAP_INTERACTIVE_RPS, so keep
  // EFS_SOAP_MAX_RPS below the vendor ceiling accordingly. The guide warns (p11) that excessive
  // polling can lead to account suspension by WEX IT — raise either number only with their limits in
  // hand, never by guessing.
  EFS_SOAP_INTERACTIVE_RPS: z.coerce.number().min(0.1).default(1),
  // Per-request deadlines. Before these existed NEITHER dispatch branch in soapClient.ts set any
  // timeout, so a half-open socket hung until the process died. A human waiting on a card lock gets
  // the tighter one; a backfill page nobody is watching gets the looser one.
  EFS_SOAP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20_000),
  EFS_SOAP_INTERACTIVE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),
  // Session cache lifetime. EFS expires the login clientId daily around 03:00 CT (guide p11), and
  // efsSoapSession.ts takes the MINIMUM of this and the next 02:55 CT, so a shorter value here is
  // always safe and a longer one never outlives the vendor's own reset.
  EFS_SOAP_SESSION_TTL_MS: z.coerce.number().int().min(60_000).default(20 * 60 * 1000),
  // How long the SHARED login circuit breaker stays open after a credential verdict
  // (InvalidLoginException / InvalidAccountException / AccountLockedException). Shared because the
  // same service account drives transaction ingestion: without one breaker in front of both, card
  // control and the two pollers race each other into the vendor's lockout.
  EFS_LOGIN_BREAKER_MS: z.coerce.number().int().min(60_000).default(30 * 60 * 1000),
  // ── Card control (docs/plans/EFS-CARD-CONTROL-PLAN.md) ────────────────────────────────────────
  // Master switch for card WRITES. Default false, and it is only the first of four ANDed facts —
  // the org must also be enabled, its SOAP credentials enabled, and its write entitlement confirmed
  // by the probe. Reads are unaffected: turning writes off must not blind the operator.
  EFS_CARD_CONTROL_ENABLED: z.string().default("false").transform((s) => s.toLowerCase() === "true"),
  // Gates the QA entitlement probe endpoint. Staging only, and unset again once the probe has run.
  EFS_CARD_CONTROL_PROBE_ENABLED: z.string().default("false").transform((s) => s.toLowerCase() === "true"),
  // Explicit emergency escape hatch for a production probe. Default FALSE so a probe cannot write a live card by accident.
  EFS_ALLOW_PRODUCTION_PROBE: z.string().default("false").transform((s) => s.toLowerCase() === "true"),
  // D1: clear overrides via the dedicated `deleteOverride` operation (guide p27) instead of the
  // three-field setCardv2 echo. Default FALSE — the echo path stays the mechanism until the D1 probe
  // proves this account is entitled to the op and records its observed post-state (fix plan D1).
  // The fallback is not deleted when this turns on; turning it off restores the proven path.
  EFS_CARD_DELETE_OVERRIDE_ENABLED: z.string().default("false").transform((s) => s.toLowerCase() === "true"),
  // Whole-orchestration deadline for one mutation: fresh getCardv2 → setCardV2 → verifying re-read.
  // Deliberately larger than the sum of the per-request timeouts, because the budget has to cover the
  // pacing waits between three calls in the interactive lane, not just the sockets. When it expires
  // the write is NOT retried: the ledger row stays 'sent' (outcome unknown) and a human is told so.
  EFS_CARD_WRITE_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(25_000),
  // Wait before the SECOND verifying re-read when the first says the edit did not land. The
  // 2026-08-12 no_change incident (audit Part 1, H2): a vendor-side apply lag makes an immediate
  // re-read see the old document, recording a SUCCESSFUL write as failed and inviting a retry of a
  // change that already landed. Phase 0's experiments measure the real latency; this default is the
  // floor until they do. 0 disables the second read (not recommended outside tests).
  EFS_CARD_VERIFY_RETRY_MS: z.coerce.number().int().min(0).max(30_000).default(3_000),
  // getPolicy cache TTL (lib/efsPolicyCache.ts). A policy is shared by up to 99 cards and changes
  // when a human changes it; dialing the vendor once per card-page view was the 15-20s page (audit
  // P1-1). Ten minutes keeps the page honest without spending the shared account's rate budget.
  EFS_POLICY_CACHE_MS: z.coerce.number().int().min(0).max(3_600_000).default(10 * 60 * 1000),
  // Org-wide ceiling on card mutations per rolling hour, counted from the ledger. Per-user limits do
  // not stop three collaborating accounts; this does. Roughly ten times the busiest legitimate hour
  // we can construct (a theft sweep locking one depot's cards).
  EFS_CARD_MAX_MUTATIONS_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(50),
  // How often the card mirror is swept. DAILY on purpose: card configuration changes when a human
  // changes it, and spending the shared service account's rate budget on data that has not moved is
  // exactly the "excessive polling" the EFS guide warns can get an account suspended (p11).
  EFS_CARD_SYNC_HOURS: z.coerce.number().min(1).max(168).default(24),
  // Per-card getCardv2 calls per sweep. The roster (one call) is always complete; this bounds the
  // DEPTH pass, which is one paced request per card and would otherwise run for minutes on a large
  // fleet. Cards catch up across runs.
  //
  // ⚠ THIS MUST EXCEED THE FLEET (Step 7.5). "Cards catch up across runs" is only true in the weak
  // sense that every card eventually gets a turn; if the budget is below the fleet then NO sweep
  // ever leaves the whole fleet holding a current document, and every surface that judges a row
  // against one sync cycle — `staleAfterMinutes`, Step 7.8's override badge — is measuring against a
  // cadence the sweep is configured not to meet. `syncEfsCards` emits `mirror_detail_budget_short`
  // when this is violated, because nothing else in the system would ever have said so.
  //
  // 200 shipped against a production fleet of 199. 1000 is five times that fleet and about eight
  // minutes of the backfill lane at EFS_SOAP_MAX_RPS=2 — a nightly sweep, not an interactive one,
  // and the ceiling stays at 5000 for an account that outgrows even this.
  EFS_CARD_SYNC_MAX_DETAIL: z.coerce.number().int().min(1).max(5000).default(1000),
  // First-sync backfill window in days. Bounded so a misconfiguration can't request a decade of history.
  EFS_SOAP_BACKFILL_DAYS: z.coerce.number().int().min(1).max(730).default(90),
  // Maximum days of history per SOAP request. The EFS Card Web Service Integration Guide (p.11,
  // "Pulling Transactional Data") states: "Pull a maximum of 7 days of data at once", and warns that
  // "requests for longer periods may time out (the server stores 15 minutes of data in memory)".
  //
  // A timeout would be loud, but a SILENTLY TRUNCATED response is not — we would ingest a partial
  // window, advance the cursor past it, and never know which transactions were dropped. So the
  // default follows the published limit rather than an informal larger one. The ceiling stays at 30
  // only so an account with WRITTEN confirmation from EFS can raise it; do not exceed 7 otherwise.
  EFS_SOAP_MAX_DAYS_PER_REQUEST: z.coerce.number().int().min(1).max(30).default(7),

  // ── Catch-up paging ────────────────────────────────────────────────────────────────────────────
  // A poll normally fetches ONE window. That is right in steady state (a 48h look-back every 15 min)
  // but wrong for a backfill: 180 days at 7-day windows is 26 windows, i.e. 6.5 hours of waiting for
  // timers rather than for EFS. So when the cursor is more than one window behind, the poll keeps
  // paging until it catches up or hits one of the two budgets below — whichever comes first.
  //
  // Both budgets exist to bound ONE poll, not to limit total throughput: the cursor advances after
  // every completed page, so a poll that stops early simply resumes from there on the next tick.
  // Nothing is re-fetched and nothing is lost.
  EFS_SOAP_BACKFILL_MAX_PAGES: z.coerce.number().int().min(1).max(50).default(12),
  // Wall-clock budget. The poller's in-flight guard already prevents overlap, so a long pass only
  // delays the next tick — but an unbounded one would hide a slow endpoint behind "still running".
  EFS_SOAP_BACKFILL_MAX_MS: z.coerce.number().int().min(5_000).max(600_000).default(240_000),
  // Row budget. Every page of a poll is ingested as ONE import with ONE upsert; a 26-window pass
  // would put ~100k rows in a single request. 5k is comfortably inside what the existing file
  // imports already do (a 3,703-line report upserts fine), with headroom.
  EFS_SOAP_MAX_ROWS_PER_POLL: z.coerce.number().int().min(100).max(50_000).default(5_000),
  // Optional egress proxy URL for the EFS SOAP client ONLY (static IP for EFS's allowlist). When unset,
  // direct Railway egress is used. When Railway Pro static outbound IPs are enabled at the platform
  // level, this stays unset and EFS allowlists the Railway IPs directly.
  EFS_SOAP_EGRESS_PROXY_URL: z.string().url().optional(),

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
  // (e.g. "FuelGuard <miki@silvicominc.com>") once you have DNS access to verify silvicominc.com
  // in resend.com/domains.
  MAIL_FROM: z.string().default("FuelGuard <onboarding@resend.dev>"),
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
