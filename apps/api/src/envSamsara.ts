import { z } from "zod";

/**
 * Samsara telematics: the single-tenant token fallback, the webhook secret and every sync tier's cadence.
 *
 * Split out of `env.ts` by concern (2026-11-06, ads Track G env-split): that file had reached its 500-line
 * budget, and the first casualty was a setting read from `process.env` beside the typed `Env` because there was
 * no room to declare it (D-AD8's sandbox allowlist). Spread into the one schema, so a deployment still gets one
 * parse and one error listing everything it is missing. Every key, default and parse moved unchanged, held so by
 * `envSplit.test.ts` against the pre-split schema's recorded outputs.
 */
export const samsaraEnvFields = {
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
  // Tier 9 — live positions for the map (LM4, D-LM1). SECONDS, and the only tier measured in them.
  //
  // 5 is Samsara's own stated floor — "You should not request updates more frequently than 5 seconds"
  // — and the bottom of the 5–30 s range their TMS integration guide recommends for live tracking.
  // At one request per tick that is 0.2 req/s against a 50 req/s per-org limit, so the freshest board
  // the API can produce costs 0.4% of the budget. The minimum below is the vendor's floor expressed as
  // a constraint rather than a comment: a well-meaning "make the map smoother" edit to 1 second would
  // otherwise get us rate-limited across every other tier that shares the token.
  //
  // 0 disables the tier outright, the same kill switch shape as IFTA and odometer.
  SAMSARA_POSITIONS_SYNC_SECONDS: z.coerce.number().min(0).refine((n) => n === 0 || n >= 5, {
    message: "SAMSARA_POSITIONS_SYNC_SECONDS must be 0 (off) or at least 5 — Samsara's stated floor",
  }).default(5),
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
  // How long before a fill that ALREADY HAS successful evidence is re-asked. A different question
  // from RETRY_HOURS above, on a disjoint population — retry asks "when do we try a fill that never
  // worked", refresh asks "when do we re-ask one that already answered" — so it is its own knob.
  // 24h, not 0, because a live refresh is still how a CORRECTED STATION PIN reaches an old fill;
  // 0 disables the bound. The measurement behind both the bound and the number (55 of 55 sampled
  // fills returned identical evidence) is on `reconRefreshedRecently` in scoring/reconcile.ts.
  SAMSARA_RECON_REFRESH_HOURS: z.coerce.number().min(0).default(24),
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
  // The idle engine's collector (IE2, kind `idle_engine`): the trailing three hours every hour, and
  // the previous two days once a night from inside the same run. 0 disables it outright — it runs in
  // PARALLEL with today's idle numbers and nothing reads it yet, so turning it off loses nothing a
  // later nightly run cannot rebuild for the last two days.
  IDLE_ENGINE_SYNC_MINUTES: z.coerce.number().min(0).default(60),
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
};
