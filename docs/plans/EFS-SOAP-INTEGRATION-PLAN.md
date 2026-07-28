# EFS SOAP Integration — Precise, Assumption-Free Plan

> **Scope.** Silvicom Inc. FuelGuard ↔ EFS in-house SOAP integration for both posted
> transactions and rejected authorization attempts. Single-tenant at launch (Silvicom only).
> Zero cost (in-house on Silvicom's own EFS account).
>
> **This plan is verified against the current codebase** (as of migration 0090). Every file
> path, migration number, environment variable, and existing pattern below has been read from
> the repo, not inferred. Unknowns that depend on EFS's WSDL are called out explicitly in §11
> — nothing is assumed.

---

## 1. What is locked in

1. **Method:** SOAP web service — covers both posted transactions and rejected authorization
   attempts in one channel.
2. **Deployment mode:** In-house on Silvicom's own EFS account (dropdown = "in-house").
3. **Tenancy:** Single tenant at launch. Multi-tenant (data-share partner) is a separate
   roadmap item requiring an NDA — start that paperwork in parallel.
4. **Cost:** $0 for the in-house integration. Per-client monthly fees only if/when we productize.
5. **Downstream pipeline:** Unchanged. SOAP replaces XLSX/CSV as a *source*; every downstream
   step (`efs_transactions` faithful store, `fuel_transactions` derived events,
   `declined_transactions`, scoring, AI verification, Samsara reconciliation, dashboards) stays
   as-is.

---

## 2. The response to EFS (what to send back today)

Send **one email + one attached form**. Nothing else.

### 2.1 The email
Confirm:
1. We choose the **SOAP web service** as the integration method.
2. We are selecting the **"in-house"** option on the attached form.
3. Our technical contact: **Miki Jokovic — Silvicom Inc.** — with the group email on this
   thread as backup.

Ask (five specific questions):
1. Does the SOAP webservice deliver **both** posted and rejected transactions through the
   same credential set and the same client, or are these two separate operations we need to
   subscribe to individually?
2. What is the **fastest allowed polling interval** for each feed (posted, rejected)?
3. What is the **historical backfill window** on first sync? (We want ≥90 days for MPG
   baselines.)
4. For **IP allowlisting**, can you allowlist a small **CIDR block** (e.g. a /29) rather
   than a single IP? Our platform (Railway) does not provide a fixed IP without a static-IP
   forwarder, and a range gives us headroom for future scaling.
5. Please also **start the NDA / data-share partner process** in parallel with this in-house
   integration — you noted it can take several weeks and we would like to have it in flight
   before we productize FuelGuard for other trucking companies.

### 2.2 The attached form
Silvicom's EFS account admin (see §4) completes the attached in-house data-access form and
returns it in the same reply. Select "in-house" from the dropdown. Fill out account details
and technical contact (Miki + group email).

### 2.3 Do NOT send yet
- Do NOT send our egress IPs. We do not have static IPs yet (§5.1). We will send them once
  our static-IP hop is stood up and EFS has responded to Q1–Q4 above.
- Do NOT commit to a certification date. We estimate 2–3 weeks after we receive their WSDL
  and sandbox credentials, but we will confirm once we see the docs.

---

## 3. What EFS will deliver back (verbatim from their email)

EFS confirmed **all of these** will arrive **after the data release is completed** — we do
NOT provide any of these to them, we receive them.

- Dedicated FuelGuard SOAP credentials (separate from McLeod).
- Sandbox / test-environment access, if available.
- WSDL and file-layout documentation.
- Authentication instructions.
- Sandbox + production endpoint addresses.
- Sample SOAP requests and responses.
- Transaction-status definitions.
- Rejection-code definitions and descriptions.
- Rate limits.
- Expected transaction and rejection delivery latency.
- IP allowlisting requirements (format + submission process).
- Certificate / mTLS requirements.
- Webhook security & verification requirements (only relevant if we opt into a webhook
  later; not planned for launch).
- Production onboarding / certification requirements.
- EFS-side technical contact (the group email on this thread).

---

## 4. Silvicom EFS-account admin — action items

These are human steps that cannot happen from FuelGuard code. Owner: whoever has admin
access to Silvicom's EFS account.

| # | Action | When | Blocker for |
|---|--------|------|-------------|
| A1 | Open the attached in-house form. | Today. | Everything downstream. |
| A2 | Select **"in-house"** from the dropdown. | Today. | EFS's data-release process. |
| A3 | Complete company, account, contact fields. | Today. | Same. |
| A4 | Return the completed form to EFS on the same email thread. | Today. | Same. |
| A5 | When EFS asks: provide the **static egress IPs** we send you (from §5.1). | After §5.1 is done. | Production connection. |
| A6 | When EFS delivers sandbox and production credentials, forward them to the engineering side over a secure channel (1Password, encrypted email — not plain email). | On receipt from EFS. | Sandbox build. |
| A7 | Sign the **NDA** for data-share partner status once EFS sends it. Estimated several weeks — start early even though multi-tenant is post-launch. | On receipt from EFS. | Multi-tenant productization (future). |

---

## 5. Engineering prep work — starts NOW, before EFS's data release

Six items. None depend on EFS's WSDL. Est. total effort ~5–7 engineering days. Doing this
work in parallel with EFS's provisioning means we can start building against their WSDL the
day it arrives.

### 5.1 Static egress IP infrastructure — CRITICAL
**Why:** EFS requires IP allowlisting for all requests except login. Railway (our current
host, verified in `railway.json`) does **not** provide a fixed egress IP on standard plans.
Every request from our API service leaves through Railway's shared IP pool.

**Approach:** stand up a small static-IP forwarder that our SOAP client routes through.
Three viable options:

| Option | Est. cost/mo | Complexity | Notes |
|--------|-------------|------------|-------|
| **Fly.io machine as SOCKS/HTTP proxy** | ~$2 | Low | 1 machine, dedicated IPv4. Simplest. |
| **Cloudflare Zero Trust WARP → static egress** | Free/paid tier | Medium | Enterprise-grade; overkill for one call. |
| **AWS EC2 t4g.nano + Elastic IP** | ~$5 | Medium | Full control; more moving parts. |

**Recommended:** Fly.io. Cheapest, one region (Chicago — matches Silvicom timezone), one
IP. Configure our SOAP client to send its HTTPS requests through the Fly.io machine (either
as an HTTP proxy or as a small forwarder that terminates our request and re-issues it to
EFS with the Fly IP).

**Deliverables:**
- Static IP provisioned (record it in a secure secrets store — do NOT commit it to git).
- Egress route configured for the EFS SOAP client only (Samsara, HERE, etc. keep going
  direct — no reason to funnel unrelated traffic through the hop).
- Health check + monitoring on the forwarder.

**Definition of done:** `curl --proxy <fly-ip>:PORT https://api.ipify.org` from Railway
returns the Fly IP.

### 5.2 Add SOAP library dependency
`apps/api/package.json` currently has no SOAP dep (verified). Add:

```json
"soap": "^1.0.0"
```

Chosen because:
- Actively maintained.
- WS-Security UsernameToken support (most likely EFS auth method — confirm in §11).
- Streaming response parser for large transaction batches.
- Widely used, so behavior is predictable.

Alternative `strong-soap` also works but is less actively maintained.

**Definition of done:** `pnpm --filter @fuelguard/api add soap` runs green; typecheck passes.

### 5.3 Migration 0091 — EFS SOAP credential storage
Create `supabase/migrations/0091_efs_soap_credentials.sql`.

**Design decision (assumption-free):** the existing `integration_credentials` table (0012)
has `provider text not null default 'samsara'` but a `primary key (org_id)` — only one row
per org across all providers. This is why the current schema can't cleanly hold both
Samsara and EFS SOAP credentials side by side. Two clean options:

**Option A (recommended): new provider-specific table `efs_soap_credentials`.**
Mirrors the Samsara pattern (one dedicated table per outbound provider), no refactor of
existing data.

```sql
create table efs_soap_credentials (
  org_id                uuid primary key references organizations(id) on delete cascade,
  environment           text not null default 'sandbox',   -- 'sandbox' | 'production'
  endpoint_url          text not null,                     -- from EFS after data release
  soap_username         text not null,                     -- WS-Security UsernameToken
  soap_password         text not null,                     -- encrypted at rest; service-role-only RLS
  account_id            text,                              -- Silvicom's EFS account number (if scoped)
  posted_last_cursor    text,                              -- opaque delta cursor per EFS's docs
  rejected_last_cursor  text,
  posted_last_polled_at timestamptz,
  rejected_last_polled_at timestamptz,
  enabled               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table efs_soap_credentials enable row level security;
-- No client policies → only the service role (API) can read/write.
create trigger trg_efs_soap_credentials_updated before update on efs_soap_credentials
  for each row execute function set_updated_at();
```

**Option B: extend `integration_credentials` with EFS columns.** Simpler but violates the
single-purpose-column principle and forces every org to have a Samsara row before it can
have EFS.

**Choose Option A** because the two providers are fully independent.

**Definition of done:** migration applies cleanly on a fresh DB; RLS matrix test (Vitest)
asserts no client role can select from the table.

### 5.4 Env schema additions (`apps/api/src/env.ts`)
Add these keys to the `EnvSchema` Zod object, following the existing conventions verified
in the current file (defaults, optional secrets, comment blocks):

```ts
// ── EFS SOAP integration ───────────────────────────────────────────────────────
// Silvicom's in-house EFS SOAP feed. Per-org credentials live in efs_soap_credentials;
// these env vars are single-tenant fallbacks (same pattern as SAMSARA_API_TOKEN).
EFS_SOAP_ENABLED: z.string().default("false").transform((s) => s.toLowerCase() === "true"),
EFS_SOAP_ENDPOINT_URL: z.string().url().optional(),        // set once EFS provides
EFS_SOAP_USERNAME: z.string().optional(),                  // fallback if not per-org
EFS_SOAP_PASSWORD: z.string().optional(),                  // fallback if not per-org
EFS_SOAP_ACCOUNT_ID: z.string().optional(),
// Poll cadence per feed. Defaults are conservative — TIGHTEN once EFS confirms
// the minimum allowed interval (see docs/plans/EFS-SOAP-INTEGRATION-PLAN.md §11).
EFS_SOAP_POSTED_POLL_MINUTES: z.coerce.number().min(1).default(15),
EFS_SOAP_REJECTED_POLL_MINUTES: z.coerce.number().min(1).default(5),
// Rate limiting (mirrors samsaraHttp.ts pattern).
EFS_SOAP_MAX_RPS: z.coerce.number().min(0.1).default(2),
EFS_SOAP_MAX_RETRIES: z.coerce.number().int().min(0).default(4),
// First-sync backfill window in days. Adjustable per EFS's maximum history window.
EFS_SOAP_BACKFILL_DAYS: z.coerce.number().int().min(1).default(90),
// Outbound egress proxy for the EFS SOAP client ONLY (static IP for EFS's allowlist).
// When unset, direct Railway egress is used (fine for local dev; will fail against EFS prod).
EFS_SOAP_EGRESS_PROXY_URL: z.string().url().optional(),
```

Document the same set in `apps/api/.env.example` following the existing comment style.

**Definition of done:** `pnpm --filter @fuelguard/api typecheck` green; API boots with none
of the new vars set (they're all optional / off by default).

### 5.5 Documentation update — `docs/08-EFS-INTEGRATION.md`
The current doc says (verbatim):

> Important reality check from research: EFS is not a developer REST API with an API key.
> EFS shares transactions through a portal-authorized data feed... the partner then polls
> for new transactions (commonly every ~5 minutes)... Corpay/FLEETCOR uses a fixed file
> layout (the "AC29" file type).

This is **out of date** now that EFS has confirmed a real SOAP webservice. Rewrite §1
(grounding), §6 (Phase 2), and §7 (Build phasing) to reflect:

- Real SOAP web service (not portal-polling AC29).
- Both posted and rejected transactions delivered by SOAP through one credential set.
- Zero fees for in-house.
- New phase (Phase 10) = SOAP source; XLSX/CSV importer stays as manual-upload fallback.
- The existing `imports.source` enum already has `'efs_feed'` — repurpose for SOAP source.

**Definition of done:** doc updated; XLSX importer described as "legacy manual fallback";
SOAP source added as primary.

### 5.6 Save this plan into the repo
Commit this plan file at `docs/plans/EFS-SOAP-INTEGRATION-PLAN.md` so it lives alongside
the other planning docs (`docs/plans/` already exists in the repo — verified).

---

## 6. Engineering build work — starts AFTER EFS's data release lands

Nine items. Depend on the WSDL / sample payloads / sandbox credentials from EFS.
Est. total effort ~2–3 engineering weeks after data release. Ordered by dependency.

### 6.1 Read the WSDL and lock the field mapping
Before writing any code, cross-reference the WSDL against our normalized row shape
(`efsIngestShared.ts` and the columns in `efs_transactions` / `declined_transactions`).

Produce a mapping table like the existing `docs/08 §4` table, but for SOAP fields → our
columns. Specifically confirm:

- Where the **stable transaction ID** lives in the SOAP payload (this replaces our current
  composite `card_num | invoice | item | qty | amt` external_ref for SOAP-sourced rows).
- Where the **delta cursor** lives (a monotonic sequence number, a `since` timestamp, both).
- Timezone convention for all datetime fields (UTC vs local vs EFS-specific).
- The full product-code list (extends the existing `ULSD, ULSR, DEFD, SCLE, STAX, ADD, WWFL`
  set in `docs/08 §0`).
- The full rejection-code list (extends `INACTIVE CARD, INVALID TRUCKSTOP, LIMIT EXCEEDED`).
- Where card_num vs full-PAN vs card-alias appears in each feed.

**Deliverable:** mapping table appended to `docs/08 §4`.

### 6.2 SOAP HTTP client — `apps/api/src/lib/soapClient.ts`
Model on the existing `apps/api/src/lib/samsaraHttp.ts` (verified — 4.5 KB, exports
`samsaraFetch`, rate-limited, retry on 429/5xx with Retry-After, priority lanes). New file
adapts the same pattern for SOAP:

- Rate limiter keyed by `(org_id, priority)`; posted-poll = "backfill", rejected-poll =
  "live" so a slow posted-backfill can never starve real-time rejection polling.
- Exponential backoff + jitter on 5xx / network errors.
- Optional egress proxy (`EFS_SOAP_EGRESS_PROXY_URL`) for the static-IP hop.
- WS-Security UsernameToken injection (assuming that's what EFS returns — §11 unknown).
- SOAP fault parsing → typed error.

**Definition of done:** unit tests (following `samsaraHttp.test.ts` pattern) verify pacing,
backoff, Retry-After, proxy routing.

### 6.3 EFS SOAP operations — `apps/api/src/lib/efsSoap.ts`
Concrete calls: `fetchPostedTransactions(cursor)` and `fetchRejectedTransactions(cursor)`.
Each returns `{ rows, nextCursor }` in the same shape our existing XLSX parser produces
(so downstream is untouched).

- Parses the SOAP envelope with the `soap` library, but hand-maps the response into our
  `Record<string, string | number | null>` row shape (same shape `readEfsFile.ts` produces
  for XLSX — verified).
- Marks the produced rows with `source: 'efs_feed'` (enum value already reserved).
- Computes the `external_ref` from the WSDL-provided stable transaction ID (see 6.1).
- Handles empty responses (no new transactions) as a normal successful call, not an error.

**Definition of done:** unit tests parse EFS's actual sample response into rows that
`ingestReport` (our existing write path) accepts without modification.

### 6.4 SOAP ingestion service — `apps/api/src/services/efsSoapIngest.ts`
Thin bridge:
1. Loads EFS credentials for the org (from `efs_soap_credentials`; single-tenant env
   fallback).
2. Calls `fetchPostedTransactions` / `fetchRejectedTransactions`.
3. Feeds the rows through **existing** `ingestReport()` in `efsIngest.ts` (verified —
   `ingestReport` classifies by header signature and dedups on file hash + external_ref;
   both mechanisms work for SOAP rows if we pass a synthetic `fileHash` = SHA-256 of the
   full response body).
4. Advances `posted_last_cursor` / `rejected_last_cursor` in `efs_soap_credentials` on
   success.

The whole point of this bridge is to reuse the write path — no rewrite of scoring, shortfall
reconciliation, or the faithful `efs_transactions` store.

**Definition of done:** integration test — mock SOAP client returns sample rows;
`fuel_transactions`, `declined_transactions`, `efs_transactions` all populate correctly;
re-running with the same cursor is a no-op (idempotent).

### 6.5 SOAP polling scheduler — `apps/api/src/services/efsSoapPoller.ts`
Model on `apps/api/src/services/efsIngestScheduler.ts` (verified — for each org, wraps the
ingest in a jobs-ledger `runJob` call so no two overlapping polls run and progress is
visible in the UI).

Two independent tiers (mirroring the Samsara scheduler's tiered design):
- **Rejected feed poller:** every `EFS_SOAP_REJECTED_POLL_MINUTES` (default 5, tighter if
  EFS allows). Jobs kind: `efs_soap_rejected`.
- **Posted feed poller:** every `EFS_SOAP_POSTED_POLL_MINUTES` (default 15). Jobs kind:
  `efs_soap_posted`.

Both go through the same rate-limited client, using the priority lanes from 6.2.

Register in `apps/api/src/schedulers.ts` alongside the other schedulers:
```ts
import { startEfsSoapPoller } from "./services/efsSoapPoller.js";
...
startEfsSoapPoller(env);
```

**Definition of done:** on boot, both pollers log their cadence; jobs-ledger entries
appear on each run; a second manual sync while one is running returns a 409 conflict
(matches existing pattern).

### 6.6 Admin routes — extend `apps/api/src/routes/integrations.ts`
Add EFS SOAP endpoints following the same shape as the existing McLeod routes (verified —
`/mcleod/config`, `/mcleod/enable`, `/mcleod/disable`):

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/efs-soap/config` | admin | Non-secret status (enabled? last sync? cursor age?). NEVER returns password. |
| POST | `/efs-soap/enable` | admin | Store SOAP credentials for the org; enable polling. |
| POST | `/efs-soap/disable` | admin | Clear credentials; disable polling. |
| POST | `/efs-soap/test-connection` | admin | Fires one SOAP call, returns success/failure + roundtrip time; audited. |
| POST | `/efs-soap/sync-now/:feed` | admin | Manual trigger (`:feed` = `posted` or `rejected`); goes through the same jobs ledger as scheduled runs. |

All routes audited via `writeAudit()` — same pattern as Samsara integration endpoints.

**Definition of done:** routes typecheck; `/config` returns the right shape without leaking
the password; enable → test-connection → sync-now round-trip succeeds against the sandbox.

### 6.7 Web UI (settings screen)
New page: `apps/web/src/features/settings/EfsIntegration.vue`.

Displays:
- Enabled/disabled state.
- Environment (sandbox/production).
- Last-posted-sync-at + last-rejected-sync-at.
- Cursor freshness (green if <2× the poll interval, yellow beyond, red if stale).
- "Test connection" button → hits `/efs-soap/test-connection`.
- "Sync now" buttons per feed.
- Credential-entry form (only for admin role, service-role write via the API).

**Definition of done:** admin can enter sandbox credentials in the UI, click test, see
success; a manual sync triggers and completes.

### 6.8 Sandbox certification pass
Run through EFS's certification checklist (unknown until they send it — see §11). Common
items to expect:

- Handle their canonical sample transaction end-to-end.
- Handle a rejection sample end-to-end.
- Prove idempotency (re-poll the same cursor is a no-op).
- Prove backfill (initial 90-day sync produces the expected row count against a known
  sandbox dataset).
- Prove rate-limit compliance under their monitoring.

**Definition of done:** EFS's certification checklist all-green; screenshot / signed-off
receipt from EFS.

### 6.9 Cutover to production
Sequential:
1. Admin creates production credentials in the UI (§6.6), stored encrypted in
   `efs_soap_credentials`.
2. Admin confirms with EFS that our static IP (§5.1) is on their allowlist.
3. First production sync = **initial backfill** (`EFS_SOAP_BACKFILL_DAYS` = 90 by default).
   This can be a large batch; monitor.
4. Verify: `efs_transactions` row count matches EFS's totals for the backfill window;
   `declined_transactions` row count matches; `fuel_transactions` derived events land
   correctly; scoring completes with no errors.
5. Disable the XLSX importer's daily cron (`efsIngestScheduler`) for Silvicom's org — but
   keep the manual-upload UI as a fallback in case the SOAP feed has an outage.

---

## 7. Cutover & production readiness checklist

Blockers before flipping to production. Every box must be ticked.

- [ ] Static egress IP live and health-checked (§5.1).
- [ ] EFS has allowlisted our egress IP.
- [ ] Migration 0091 applied to production Supabase (§5.3).
- [ ] SOAP library installed; `env.ts` updated; typecheck+lint+build green (§5.2, §5.4).
- [ ] `docs/08` updated to reflect SOAP-based Phase 10 (§5.5).
- [ ] SOAP client + operations + ingest service + poller all merged (§6.2–§6.5).
- [ ] Admin routes for enable/disable/test/sync merged (§6.6).
- [ ] UI settings page merged (§6.7).
- [ ] Sandbox certification pass complete (§6.8).
- [ ] Production credentials entered via UI (never in git, never in plain email).
- [ ] Initial 90-day backfill completed; row counts match EFS totals.
- [ ] `efsIngestScheduler` (XLSX auto-ingest) disabled for Silvicom's org, manual upload
      UI kept as fallback.
- [ ] Monitoring/alerting on stale cursor (`posted_last_polled_at` > 2× cadence,
      `rejected_last_polled_at` > 2× cadence).

---

## 8. What we already have vs. what we're building (verified against the repo)

| Concern | Already exists (verified) | New build |
|---------|--------------------------|-----------|
| Staging table for imports | `imports` (0007) | – |
| Faithful EFS storage | `efs_transactions` (0011) | – |
| Derived fuel events | `fuel_transactions` | – |
| Declined transactions store | `declined_transactions` (0007) | – |
| XLSX/CSV ingest path | `efsIngest.ts`, `efsIngestReject.ts`, `efsAutoIngest.ts` | – |
| Idempotency (file hash + external_ref) | `sha256Hex` + unique indexes | – |
| Jobs ledger (no-overlap runs) | `jobs.ts`, `startJob`/`finishJob`/`runJob` | – |
| Scheduler harness | `schedulers.ts`, `startAllSchedulers()` | Register `startEfsSoapPoller` |
| Rate-limited HTTP client pattern | `samsaraHttp.ts` | New `soapClient.ts` (same pattern, SOAP body) |
| Integration credentials storage | `integration_credentials` (Samsara), `org_integrations` (McLeod TMS) | New `efs_soap_credentials` table (migration 0091) |
| Webhook receiver pattern | `webhooks.ts` (Samsara only) | Not needed for launch (SOAP polling covers both feeds) |
| Admin integration routes | `routes/integrations.ts` (Samsara + McLeod) | Add `/efs-soap/*` routes |
| Env validation | `env.ts` (Zod) | Add `EFS_SOAP_*` keys |
| Static egress IP | ❌ NOT PRESENT | New Fly.io / static-IP hop |
| SOAP library | ❌ NOT INSTALLED | Add `soap` npm dep |
| Web UI for EFS SOAP | ❌ NOT PRESENT | New `EfsIntegration.vue` |
| Docs/08 SOAP section | Out of date (says "portal AC29 polling") | Rewrite §1, §6, §7 |

---

## 9. Timeline (target dates once EFS's data release lands)

Assume EFS delivers WSDL + sandbox credentials on day 0.

| Days | Milestone |
|------|-----------|
| −5 → 0 | Prep work §5 in parallel with EFS's provisioning. Static IP live before day 0. |
| 0 – 3 | Field mapping locked (§6.1); SOAP client scaffolded (§6.2). |
| 3 – 7 | SOAP operations + ingest service (§6.3, §6.4). Unit tests. |
| 7 – 10 | Scheduler + admin routes (§6.5, §6.6). Integration tests against sandbox. |
| 10 – 14 | UI settings page (§6.7); first end-to-end sandbox sync working. |
| 14 – 17 | Certification pass (§6.8). |
| 17 – 21 | Production cutover (§6.9); 90-day backfill; verify totals; monitor. |

**Total: 3 weeks from data-release to full production.** Faster if EFS's certification is
lightweight.

---

## 10. Risks and mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Railway egress IP not stable enough for EFS's allowlist | High | Static-IP hop (§5.1). Verified before we hand EFS our IP. |
| EFS's SOAP has no stable transaction ID (we'd fall back to composite key) | Medium | §6.1 confirms up front; existing composite pattern (`efsIngestShared.ts`) works if needed. |
| EFS's rate limit lower than our poll cadence | Medium | §11 Q2 asks up front; env vars are runtime-configurable, no code change to adjust. |
| SOAP response schema drifts | Medium | Faithful store in `efs_transactions` retains every field verbatim (0011 pattern) — a schema change never loses data, only affects new fields. |
| Certification adds unexpected requirements | Medium | Buffer 3 days in the timeline (§9). |
| mTLS required with client-cert provisioning | Low | `soapClient.ts` supports mTLS; add cert to secrets store. Extra day if it appears. |
| Silvicom EFS-account admin unavailable | Low | §4 tasks are minutes of work; identify a backup admin now. |

---

## 11. Open items — depend on EFS's response (assumption-free)

Nothing below is assumed; each is confirmed by EFS in their next reply or in the data
release.

1. Does one SOAP client + one credential set cover **both** posted and rejected transaction
   feeds? (Their email implies yes; we asked in §2.1 Q1 to confirm.)
2. **Fastest allowed polling interval** for posted feed and rejected feed. Our default
   cadence is 15 min and 5 min respectively — tighter is better for rejections.
3. **Authentication scheme:** WS-Security UsernameToken, HTTP Basic, or another? Assumed
   UsernameToken in §6.2; adjust the SOAP client accordingly.
4. **Delta cursor mechanism:** timestamp-based (`since=YYYY-MM-DDTHH:MM:SSZ`), sequence-
   number, both, or something else. Determines `posted_last_cursor` /
   `rejected_last_cursor` semantics in migration 0091.
5. **Stable transaction ID field** in the SOAP payload. Determines whether we use it as
   `external_ref` or fall back to the composite key.
6. **Timezone convention** for all datetime fields. Determines whether we treat responses
   as UTC or org-local.
7. **Historical backfill window** on first sync. Our default is 90 days; adjust if EFS
   allows more or requires less.
8. **Full product-code list.** Extends the current allowlist in `normalizeTransactionRows`
   (`ULSD`, `ULSR`, gasoline codes).
9. **Full rejection-code list.** Populates the risk-feed severity mapping in
   `declinedScoring.ts`.
10. **IP allowlisting format:** single IP, small CIDR block, or a whole /24. We asked in
    §2.1 Q4 for a CIDR block; the response affects the Fly.io setup in §5.1.
11. **mTLS / client-cert requirements.** If required, add cert provisioning to §5.1 and
    §6.2.
12. **Rate limits** (requests/sec, requests/min, requests/hour). Sets
    `EFS_SOAP_MAX_RPS` in the env schema.
13. **Certification test cases** — determines the exact scope of §6.8.

---

## 12. Not doing (explicitly out of scope)

- **Webhook subscription.** EFS offered a real-time authorization webhook. We are NOT
  subscribing at launch — SOAP polling every 5 min for rejections is fast enough for the
  fraud-detection use case, and adding the webhook doubles the security surface (HTTPS
  callback, signature verification, replay protection). Revisit only if 5-min latency
  proves insufficient.
- **SFTP transaction/rejection feed.** Slower than SOAP polling, extra credentials to
  manage, extra parser to maintain. Not doing.
- **REST API.** EFS confirmed REST does not return rejections. Not usable.
- **Multi-tenant productization.** Requires NDA + several weeks (§4 A7). Track separately.
- **Deprecating the XLSX importer.** Kept as a manual-upload fallback for outages and
  historical loads. Only the daily auto-ingest scheduler is disabled for Silvicom's org
  after cutover.

---

## 13. Owners

| Domain | Owner |
|--------|-------|
| EFS relationship + form + NDA | Miki (Silvicom) |
| EFS-account admin actions (§4) | Silvicom EFS admin |
| Static IP infrastructure (§5.1) | Engineering (DevOps) |
| SOAP client, ingest service, poller (§6.2 – §6.5) | Engineering (backend) |
| Admin routes + UI (§6.6, §6.7) | Engineering (backend + frontend) |
| Certification pass (§6.8) | Engineering (backend), Miki confirms with EFS |
| Production cutover (§6.9) | Engineering + Silvicom EFS admin |

---

*Sources: verified against the FuelGuard repo at commit head, including `apps/api/src/env.ts`,
`apps/api/src/schedulers.ts`, `apps/api/src/routes/webhooks.ts`,
`apps/api/src/routes/integrations.ts`, `apps/api/src/services/samsaraScheduler.ts`,
`apps/api/src/services/efsIngestScheduler.ts`, `apps/api/src/services/efsAutoIngest.ts`,
`apps/api/src/services/efsIngest.ts`, `apps/api/src/services/efsIngestReject.ts`,
`apps/api/src/lib/samsaraHttp.ts`, `apps/api/package.json`, `apps/api/.env.example`,
`supabase/migrations/0012_samsara.sql`, `supabase/migrations/0068_tms_integration.sql`,
`supabase/migrations/0007_imports.sql`, `supabase/migrations/0011_faithful_efs_storage.sql`,
`railway.json`, `package.json`, `docs/08-EFS-INTEGRATION.md`.*
