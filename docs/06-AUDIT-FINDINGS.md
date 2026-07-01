# FuelGuard — Design Audit & Resolutions (v1.1)

> Pre-build review of docs 00–05. Each finding has a **decision** that is now folded into the
> canonical docs. Severity: **Blocker** (fix before Phase 1 migration) · **High** · **Medium** · **Low**.
> Where a decision changes the schema or a rule, the canonical doc (02) has been updated and the
> change is noted here as the rationale/changelog.

**Totals:** 5 Blockers · 9 High · 10 Medium · 8 Low = 32 findings. The two most dangerous clusters,
resolve first: (A) the invite→membership→JWT-claims chain, and (B) temporal correctness of the
engine under backdated / out-of-order / imported data. Both drive schema decisions you don't want
to retrofit (idempotency keys, soft-delete, version columns, derived odometer).

---

## Blockers

**B1 — "OAuth 2" mislabels an email+password design.**
Docs said "OAuth 2 multitenant login," but the flow is invite → set password → email/password via
Supabase Auth — not an OAuth authorization-code grant with a third-party IdP.
**Decision:** Drop "OAuth 2" wording. v1 = **invite-only email/password via Supabase Auth (GoTrue)**.
Supabase issues OAuth2-style JWTs under the hood, which is the only sense in which "OAuth2" applies.
**Microsoft 365 / Google SSO is deferred** (see `07`/roadmap "Phase 10 — SSO" note). *Updated in 00, 01, 03, 04.*

**B2 — Invite→membership creation left as "trigger OR API."**
The most security-critical flow was unresolved, with an ordering dependency against the JWT hook.
**Decision:** **API-driven, single mechanism.** `POST /invites/accept` (service role) validates the
token, re-checks the email domain, creates the `memberships` row, writes an audit entry, then forces
a client token refresh so claims populate. No `auth.users` trigger for membership. *Updated in 01 §4, 04 Phase 2.*

**B3 — JWT-claims bootstrapping gap on first sign-in.**
If the first token is issued before membership exists, `auth_org_id()` is null and RLS denies
everything → blank app.
**Decision:** Custom Access Token hook looks up membership by `user_id`; if none, it injects **no**
org claim and the app shows an explicit "Account pending / no organization" state (not a white
screen). After `/invites/accept` commits, the client calls `refreshSession()` to obtain a
claim-bearing token. *Updated in 01 §4, 04 Phase 2; new "no-membership" UI state added to Phase 2.*

**B4 — Backdated / out-of-order fill-ups break "previous", baseline, and odometer.**
Drivers backdate `fueled_at`; imports arrive out of order. Inserting between two existing fills
corrupts the *next* fill's `miles_since_last`/`computed_mpg`, and `current_odometer` can go back.
**Decision:**
- `previousTxn` = the row for the **same vehicle** with the greatest `fueled_at` **strictly less
  than** this row's `fueled_at`, tiebreak by `created_at` (precise SQL in 02 §7.1).
- On insert/edit/delete, **re-score a window**: the changed txn **and the immediately following
  txn in time order** for that vehicle (cascade) — implemented in the API scoring service.
- `vehicles.current_odometer` is **derived/advisory** = `max(odometer)` over that vehicle's valid
  txns, refreshed by the scoring service; never trusted for rule logic. *Updated in 02 §3, §7.*

**B5 — Service-role writes have no specified tenant enforcement.**
Engine/audit writes bypass RLS; nothing said how the API derives `org_id`.
**Decision:** **Every API route derives `org_id` from the verified JWT, never from the request
body.** Any `:id` path param is ownership-checked against that `org_id` before any service-role
write. A cross-tenant integration test is a Phase-1/2 deliverable. *Updated in 01 §4/§8, 04 Phase 2/5.*

---

## High

**H1 — DEF & electric vehicles have no MPG; rules divide by zero / false-fire.**
**Decision:** Tier 2 (capacity/top-off) and Tier 3 (MPG) rules run **only for `fuel_type in
('diesel','gasoline')`**. Electric/DEF transactions run **only** odometer + behavioral rules.
DEF is recorded as a separate transaction `product` and excluded from MPG entirely. *Updated 02 §7.*

**H2 — Division-by-zero / null guards unspecified.**
**Decision:** Per-rule guards documented in 02 §7: skip MPG rules when `gallons<=0`, `baseline_mpg`
null, or odometer delta invalid; skip jump rule when `hours_elapsed<=0`; first-ever fill (no
`previousTxn`) **skips** delta-based rules rather than firing them.

**H3 — `baseline_mpg` nullable vs. "required" contradiction.**
**Decision:** Keep `baseline_mpg` **nullable** in DB (imports/EV), but define explicit behavior:
**no baseline → MPG rules are skipped** until the vehicle has ≥3 valid fills, then the **rolling
median** becomes the baseline. The Phase-3 form requires it for diesel/gas vehicles only. *Aligned across 02, 04.*

**H4 — Off-hours timezone handling under-specified (DST/UTC).**
**Decision:** Rule computes local wall-clock via `fueled_at AT TIME ZONE org.operating_hours.tz`
(IANA tz), supports windows crossing midnight, and the client must submit a true instant. *Updated 02 §7.*

**H5 — Hard-delete cascades destroy historical transactions/anomalies.**
**Decision:** **Soft-delete only** for vehicles & drivers (`status = retired`). `fuel_transactions`
FKs to vehicles/drivers are **`on delete restrict`**. Hard delete blocked when history exists. Stated
retention: transactions/anomalies are immutable history. *Updated 02 §3; 04 Phase 3/8 wording fixed.*

**H6 — No optimistic concurrency / edit-conflict control.**
**Decision:** Add **`version int not null default 1`** to `fuel_transactions` and `anomalies`;
update endpoints require the client's `version` to match (409 on mismatch). Scoring is **serialized
per vehicle** via a Postgres advisory lock. *Updated 02 §3, 01 §5.*

**H7 — Receipt photos vs. 500 MB free tier won't close.**
**Decision:** Photos are **optional** and **client-compressed to ≤200 KB WebP** before upload;
retention policy = 12 months then purge via a scheduled job; storage budget tracked. If volume
grows, move the bucket to a paid tier — documented, not hand-waved. *Updated 01 §6, 05 §7.*

**H8 — No idempotency/dedup for fill-ups or imports.**
**Decision:** Fill-up **`id` is client-generated (UUID v4)** and used as both PK and storage path
prefix → double-submit is a no-op upsert. Imports add **`external_ref text`** (the card txn id) with
a **unique partial index `(org_id, external_ref) where external_ref is not null`**. *Updated 02 §3, §7; see 08.*

**H9 — Audit log misses the most security-relevant events.**
**Decision:** Audited actions expanded now: `auth.login`, `auth.login_failed`, `invite.created`,
`invite.accepted`, `invite.revoked`, `membership.created/updated/deleted`, `role.changed`,
`vehicle.created/updated/retired`, `driver.created/updated/retired`, `transaction.created/edited/deleted`,
`anomaly.status_changed`, `threshold.updated`, `export.generated`, `import.run`, `ai.verification_run`. *Updated 02 §3.*

---

## Medium

**M1 — Multi-org users undefined.**
**Decision:** v1 explicitly **single-org per user** (documented constraint). Schema already supports
many memberships; the JWT hook picks the **sole** membership. If/when multi-org ships, add an
active-org selector + claim. *Documented in 00 §2, 01 §4.*

**M2 — Domain restriction enforced asymmetrically.**
**Decision:** Domain allowlist checked at **both** invite creation **and** `/invites/accept`
(membership creation). **Open signups disabled** in Supabase is a **hard go-live gate** (fail the
checklist if enabled). *Updated 01 §4, 05 §2 & checklist.*

**M3 — `previousTxn` / `recentTxns` not precisely defined.**
**Decision:** Exact definitions added (02 §7.1): ordering column, tiebreak, vehicle scope, validity
predicate, window = last 5 valid fills by `fueled_at`.

**M4 — No pagination spec for large lists/exports.**
**Decision:** **Keyset (cursor) pagination** on all list endpoints using the
`(vehicle_id, fueled_at desc)` / `(org_id, fueled_at desc)` indexes; all exports streamed. *Updated 04 Phase 4/6/7.*

**M5 — Re-score "delete & recreate" wipes investigation state.**
**Decision:** Re-scoring **never deletes** anomalies that are not `open`. It reconciles: still-`open`
rules-anomalies are replaced; `investigating/resolved/dismissed` ones are marked `superseded` (new
status value) with a note linking the new evaluation, preserving workflow + audit history. *Updated 02 §2 (enum), §7; 01 §5.*

**M6 — Storage path needs `fillup_id` that doesn't exist pre-insert.**
**Decision:** Resolved by H8 — client-generated UUID is known before upload; path =
`org_id/vehicle_id/{fillup_uuid}.webp`. *Updated 01 §6, 04 Phase 4.*

**M7 — Storage RLS policy SQL missing (easy to leave bucket open).**
**Decision:** Concrete Storage policy SQL added (02 §6.1) using
`split_part(name,'/',1) = auth_org_id()::text`; a cross-org object-read negative test is on the
go-live checklist. *Updated 02, 05.*

**M8 — No API rate limiting.**
**Decision:** `express-rate-limit` (per-IP + per-user) on auth, invite, score, import, and export
routes; added to Phase 8. *Updated 04 Phase 8, 05.*

**M9 — `exceeds_tank_capacity` and `implausible_topoff` double-fire.**
**Decision:** Rule **precedence**: if `exceeds_tank_capacity` fires, suppress `implausible_topoff`;
if `mpg_deviation` fires, top-off is still allowed but the queue UI groups anomalies per transaction.
*Updated 02 §7.2.*

**M10 — Soft "warn don't block" vs. Critical capacity flag interplay.**
**Decision:** Capacity-exceed at entry triggers a **hard confirm** ("This exceeds the tank's
capacity and will be flagged for review — submit anyway?"), separating typo-correction from genuine
theft capture. *Updated 04 Phase 4.*

---

## Low

**L1 — `cost_outlier` method unspecified / cold-start.**
**Decision:** v1 = **configurable fixed band** (`min/max $/gal` per org); statistical (σ) version deferred. *Updated 02 §7.4, thresholds.*

**L2 — `mpg_sustained_decline` "beyond noise" not implementable.**
**Decision:** Concrete test: median MPG of last 3 valid fills < 90% of median of the prior 3.
Unit-testable. *Updated 02 §7.3.*

**L3 — Auto-calc of price/gallons/total can disagree with stored values.**
**Decision:** **`gallons` and `total_cost` are authoritative**; `price_per_gal` is derived
(`total/gallons`, rounded to 3dp) with a CHECK tolerance. *Updated 02 §3, 04 Phase 4.*

**L4 — "Real on day one" gap between seed (Phase 1) and engine (Phase 5).**
**Decision:** "Day one" = after the **Phase-5 backfill** script runs over seed data; noted in README & roadmap.

**L5 — `updated_at` trigger referenced but not provided; thresholds lacks `created_at`.**
**Decision:** Trigger function SQL included in 02 §3.1; `created_at` added to `anomaly_thresholds`.

**L6 — `enabled_rules` empty="all on" footgun.**
**Decision:** Replaced with **`disabled_rules text[]`** (off is additive/explicit). *Updated 02 §3, §7, 04 Phase 6.*

**L7 — No backup/rollback / migration-down strategy.**
**Decision:** Document Supabase backup cadence + a restore runbook; migrations ship with `down`
counterparts where practical; added to 05. *Updated 05 §7.*

**L8 — Secrets: grep-only leak check.**
**Decision:** API error responses **never echo upstream Supabase errors verbatim** (map to
`{error:{code,message}}`); key-rotation procedure documented. *Updated 01 §8, 05 §3.*

---

## Cross-cutting

**C1 — No API contract anywhere.**
**Decision:** A concise **API contract** (method, auth/role, Zod input/output, error codes per
endpoint) lives in `packages/shared` as Zod schemas and is summarized in 01 §9 (new). Built before Phase 2.

**C2 — RLS testing mandated but not specified.**
**Decision:** An automated **RLS test matrix** (per table × per role × own-org/other-org) is a
**Phase-1 deliverable** (Vitest against the client SDK), not a manual check. *Updated 03 Phase 1, 04 Phase 1.*

---

## New scope folded in (this revision)

Beyond fixes, two capabilities were added and fully specified in their own docs:

- **`07-AI-VERIFICATION.md`** — a Claude API verification layer that sits **after** the deterministic
  rules to judge location plausibility and produce explainable, prioritized risk assessments. New
  table `ai_verifications`; new API routes; cost controls.
- **`08-EFS-INTEGRATION.md`** — **CSV import now**, **EFS data-feed later**. New tables `fuel_cards`,
  `imports`, `import_rows`; field mapping; idempotent, staged ingestion; reconciliation to vehicles/drivers.

Both are reflected in the updated schema (02), architecture (01), roadmap (03), and prompt pack (04).
