import { z } from "zod";

/**
 * The EFS integration's environment, lifted out of `env.ts` (A11b, 2026-08-21).
 *
 * ── WHY IT MOVED, WHICH IS NOT "THE FILE WAS LONG" ────────────────────────────────────────────
 * `lint:filesize` refused `env.ts` at 500 lines and offers two ways out: split, or add a waiver — and
 * says in as many words that a waiver is "a deliberate, reviewable act". This block is the one group
 * in that file with a natural boundary: every variable below belongs to ONE vendor integration, is
 * read by `src/efs/` and nowhere else, and has its own plan document. Nothing else in `env.ts` shares
 * a reason to change with it.
 *
 * It is a plain object of Zod fields rather than its own schema, spread into `EnvSchema`, so the
 * parse stays single: one object, one set of defaults, one error message listing everything missing.
 * A second `.parse()` would give a deployment two ways to be half-configured.
 */
export const efsEnvFields = {
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
} as const;
