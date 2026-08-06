# HazmatGuard (FuelGuard build) — STATUS

**Rewritten every session. Keep it short. This is "where are we"; the spec is the plan.**
**Two plans exist:** `docs/18-HAZMATGUARD-PLAN.md` is FuelGuard's own H-phase plan (historical detail).
`../HazmatGuard/docs/PLAN.md` (M-milestones, v1.19) is the **authoritative source of truth** we are
porting *into* FuelGuard. When they disagree, HazmatGuard's PLAN wins and FuelGuard is aligned to it
(with the documented divergences below).

---

## Position — 2026-08-06

FuelGuard is now at **backend parity with every completed HazmatGuard milestone**: **M0.5 defects · M1 ·
M3 · M4 · M5 · M12**. Engine `0.8.0`, normalizer `2.0.0`, dataset as shipped in `@hazmat/data`.
All 11 workspace packages **typecheck clean** (tsc + vue-tsc). The full test suite and the web bundle
were **NOT run in this environment** (see Verification) — that is the main open verification step.

## Done this session (ported from HazmatGuard source of truth)

- **Phase 0 — domain alignment** (`047f121`): `@hazmat/engine` (0.8.0, incl. `checkEligibility` +
  `auditProvidedInputs`), `@hazmat/data`, `@hazmat/placards`, `@hazmat/golden` are byte-identical to
  HazmatGuard.
- **M0.5 defects** (`c2a4771`): D11/D12 image normalizer (real media type from sharp, 1568px + WebP,
  `IMAGE_NORMALIZER_VERSION 2.0.0`); §10.10 cache key now includes engine + dataset + qualification digest.
- **M1 — compliance master data**: `certifications` (0127, temporal, `insert_certification` supersede
  RPC), `hazmat_runs.qualification` (0128), `qualification_records` (0129). Additive — the fuel
  current-value model (0098/0101) is untouched.
- **M3 — §5 qualification gate**: `packages/shared/qualificationGate.ts` (`qualifyDriver`/`qualifyOrg`,
  pure) + `apps/api/services/qualification.ts` (DB-facing `evaluateQualification`); UNCLEARABLE
  `driver_unqualified:*` / `org_unqualified:*` flags; wired into BOTH analysis paths. Compliance API at
  `/api/compliance`; web Compliance roster + `CertManager` (`4b5dd50`, `2086793`).
- **M12.1 — Roadside Defense Packet** (`dee4c0f`): `GET /api/hazmat/loads/:id/packet` (pdfkit, self-
  contained, no-login-to-read). **M12.2 — Reproducible verdict** (`3df38bc`): `GET .../reproduce`.
- **D17/N2/D3 — atomic run recording** (`4f19728`): `record_hazmat_run` RPC (0130) + `org_usage_month`
  counter; insert now THROWS on failure (fail-closed); budget gate moved below the cache; advisories +
  extraction evidence + qualification persisted.
- **M4 — review-queue finish** (`6e56c8e`): server-composed attestation (D4), predecessor supersession
  (D5), `MAX_BOL_PAGES=10` (D19), batch signed URLs (D20), `hazmat_documents.content_type` (0131/D1).
- **M5 — policy + eligibility**: `OrgHazmatPolicy` locked to `z.strictObject` — PUT rejects unknown
  keys (`16347dd`). `checkEligibility` (M5.2) + input audit (M5.3) already live via the aligned engine.
- **Review UX** (`a7a8aa5`): ReviewPanel surfaces advisories + extraction evidence; eligibility copy
  corrected (affirms the eligible/auto-clear path; explains `not_checked` accurately).
- **Design doc**: `docs/plans/drivers-app/DOCUMENT-CAPTURE-ENGINE.md` (M6 native capture, design-first).

## What's left (net-new — NOT a port; HazmatGuard hasn't built these either)

- **M9 — conditional org checks**: add §385.403 permit-required + §172.800 security-plan material lists
  to `@hazmat/data`, enable the two §5.1 checks. Plan: ship **provisional/fail-closed** (SME-pending)
  so it is safe before attestation. *Not started.*
- **M6 — driver capture (native)**: build from the DCE design. Code can be written here; the native app
  must be built/run on a Mac. *Not started.*
- **M7** public calculator · **M10** exact placard art (launch blocker, SME) · **M11** ops readiness.

## Required actions before "live" (blockers)

1. **Apply migrations `0131` + `0132` to Supabase** — the two unapplied migrations. `0131` adds
   `hazmat_documents.content_type` (SELECTed by `listDocuments` + the extraction orchestrator; without it
   those queries fail). `0132` replaces `record_hazmat_run` with the idempotent/UTC-pinned body (safe
   `create or replace`). (0127-0130 already applied.)
2. **`pnpm install`** — `@hazmat/placards` was added as an `apps/api` workspace dep for the packet (M12.1).
3. **Run the test suite + web build on a Mac** (see Verification).
4. **git cleanup** (cloud bridge can't unlink): `rm -f .git/index.lock .git/tmp_ci_idx`.

## Verification state (honest)

- All 11 packages typecheck clean (tsc + vue-tsc), every session change.
- Engine/data/placards/golden byte-identical to HazmatGuard — its **490 tests** validate the rule
  logic upstream.
- **Test suite NOT run here**: `device_bash` runs in a Linux-arm64 VM but `node_modules` hold macOS
  binaries -> vitest/rolldown native bindings are missing. Run `pnpm test` on the Mac.
- **Web `vite build` NOT run here** (same native-binary reason). Run `pnpm --filter @fuelguard/web build`.

## Divergences from HazmatGuard (INTENTIONAL — do not "fix")

- FuelGuard **keeps module entitlements**: the `org_module_enabled('hazmatguard')` gate stays in both
  analysis paths + hazmat routes. HazmatGuard removed modules (its decision #3).
- FuelGuard **keeps the fuel current-value compliance model** (0098/0101); `certifications` is additive,
  hazmat-only. The two models coexist.
- Package names `@fuelguard/*` vs `@hazmatguard/*`; migration numbering 0127-0131 vs 0001-0007.
- `apps/api/services/hazmatLoads.ts` is byte-identical to source (modulo package name); `hazmatAnalysis.ts`
  differs only by the kept module gate + the qual-call arg form.

## Notes / assumptions to know

- The §5 gate **fail-closes every hazmat load until `certifications` are populated** (a qualified driver
  can't be demonstrated) — correct safe default, but no load clears until the roster is entered.
- Advisories render in the ReviewPanel (needs_review), not in the read-only VerdictPanel — this matches
  HazmatGuard (neither renders them on the calculator surface).

## Audit findings — 2026-08-06 (independent review of the run-recording chain)

Both are **latent, narrow-window, and inherited from the HazmatGuard source of truth** (they exist
upstream too) — not regressions introduced by the port. **Both FIXED 2026-08-06** (migration `0132` +
orchestrate catch guard, commit `406a568`); the same fix should still go upstream to HazmatGuard.

1. **Abort-path duplicate-run collision (medium).** In `executeExtraction`, if the main-path
   `insertHazmatRun` COMMITS but a *later* step throws (realistically `transitionLoad`, less so
   `notifyReviewersOfFlag`), control enters the `catch`, which calls `finish()` → `insertHazmatRun`
   with the **same `runId`** → PK violation → `insertHazmatRun` throws again *inside the catch*. Net:
   the run row exists but the load is never transitioned and no reviewer is notified — a stuck load
   with no review signal (worse than the intended "record extraction_failed + flag"). The RPC itself
   is atomic (single txn, run insert first) so there is no double-count or half-write; the gap is
   purely orchestration-level. **Fix options:** make the abort record idempotent (`insert ... on
   conflict (id) do nothing`) and/or wrap the catch's `finish()`. **Fixed:** `0132` uses `on conflict (id)
   do nothing` + a `row_count` guard (counter not double-counted); `orchestrate.ts` wraps the catch's
   `finish()`. Same fix should still go upstream.

2. **Budget-counter month bucket is timezone-sensitive (low, config-dependent).** The counter is
   written under DB `now()` (`to_char(now(),'YYYY-MM')`) while `tokensUsedThisMonth` reads the bucket
   from the app's `new Date().toISOString().slice(0,7)`. Both are UTC under Supabase's default session
   TimeZone, so they match in practice — but if a non-UTC session TZ is ever set, a month-boundary
   write/read split could make the budget gate read 0 for that window. **Fixed:** `0132` pins the
   bucket to `to_char(now() at time zone 'UTC','YYYY-MM')`; the app read key is already UTC.

**Verification method:** typecheck (all 11 packages) + byte-parity with the HazmatGuard source (whose
490 tests cover the rules) + this manual/adversarial review. The full test suite was NOT run in-env
(see Verification) — running it on a Mac is the remaining confirmation step.

## Session log

| Date | What moved |
|---|---|
| (pre-session) | FuelGuard H0-H7 hazmat built (see 18-plan build-status 2026-07-31). |
| 2026-08-06 | Phase 0 align · M0.5 · M1 · M3 · compliance API+UI · M12.1/M12.2 · D17/N2/D3 · M4 · M5 · review-UX. FuelGuard -> HazmatGuard backend parity. |
