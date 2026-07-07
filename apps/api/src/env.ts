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

  // Samsara telematics (docs/10). Per-org tokens live in integration_credentials; this env var is a
  // single-tenant fallback. SAMSARA_API_URL lets tests point elsewhere.
  SAMSARA_API_TOKEN: z.string().optional(),
  SAMSARA_API_URL: z.string().url().default("https://api.samsara.com"),
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
  // Nightly per-org self-heal (EFS-store repair → rescore → quick rebuild → integrity) at org-local 03:00.
  // Set to "false" to disable.
  NIGHTLY_RECONCILE_ENABLED: z.string().default("true").transform((s) => s.toLowerCase() !== "false"),
  // Central Samsara client rate limiting (shared per org token across schedulers + recon + backfill).
  // Steady request cadence (requests/sec) — stays well under Samsara's per-token limits while letting a
  // large backfill finish in minutes. Retries honor Retry-After + exponential backoff before failing.
  SAMSARA_MAX_RPS: z.coerce.number().min(0.1).default(5),
  SAMSARA_MAX_RETRIES: z.coerce.number().int().min(0).default(4),
  // Geocoding for the location proximity check. Uses OpenStreetMap/Nominatim (free, no key) by default;
  // results are cached in geocode_cache so each station is looked up once. Set GEOCODING_ENABLED=false
  // to turn off. GEOCODE_PROX_MILES = how close the truck's GPS must come to the station to "confirm".
  GEOCODING_ENABLED: z.string().default("true").transform((s) => s.toLowerCase() !== "false"),
  GEOCODE_URL: z.string().url().default("https://nominatim.openstreetmap.org/search"),
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
  DIGEST_ENABLED: z.string().default("true").transform((s) => s.toLowerCase() !== "false"),

  // Automated EFS report ingestion (removes the daily manual upload). "off" (default) disables the
  // scheduler; "storage" polls a Supabase Storage bucket where reports are delivered under
  // <orgId>/incoming/ (by an email-forwarding rule, SFTP→bucket sync, or manual drop). Direct IMAP/SFTP
  // sources slot behind the same interface later. EFS_INGEST_MINUTES sets the poll cadence (Chunk 3).
  EFS_INGEST_SOURCE: z.enum(["off", "storage"]).default("off"),
  EFS_INGEST_BUCKET: z.string().default("efs-reports"),
  EFS_INGEST_MINUTES: z.coerce.number().min(1).default(30),

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
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
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
