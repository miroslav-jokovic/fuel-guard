# HazmatGuard (FuelGuard build) — STATUS

**Rewritten every session. Keep it short. This is "where are we"; the spec is the plan.**
**Two plans exist:** `docs/18-HAZMATGUARD-PLAN.md` is FuelGuard's own H-phase plan (historical detail).
`../HazmatGuard/docs/PLAN.md` (M-milestones, v1.19) is the **authoritative source of truth** we are
porting *into* FuelGuard. When they disagree, HazmatGuard's PLAN wins and FuelGuard is aligned to it
(with the documented divergences below).

---

## Position — 2026-08-08

**Owner decision (D-H10): do NOT wait for the SME.** Build everything completely; validate against
real BOLs after the build. Attestation/provisional flags stay false until that validation actually
runs — the decision changes sequencing, not what the flags claim.

This session executed the owner's consolidation directives (see the IA plan §6 for full detail):
**H-C4 nav trim** (one HazmatGuard sidebar entry, review badge on it) · **H-C2** (migration `0153`:
cargo tank data onto `trailers`/`vehicles`, profile table/API/page deleted, one-read
`readEquipmentKind`, F-P5 reproduce-kind bug fixed) · **H-P1 packaging model**
(`shared/hazmatPackaging.ts` — package-type vocabulary, §171.8 bulk derivation, lb/kg conversion,
package counts; calculator + load form reworked) · **D-H13** ("Carrier context" → Equipment in
trailer vocabulary; hopper lines default BULK) · **engine `0.9.0`** (`packageCount` evaluated — no
longer blocks auto-clear). Deferred queue (LQ rules blocked on dataset column 8A, H-C1 UI half,
certifications seeding, BOL package-count extraction) is recorded in the IA plan.

**Owner actions this session adds:** apply migration `0153`; run `pnpm test` +
`pnpm --filter @fuelguard/web build` on the Mac; delete the five files listed in `_to_delete/`.

## Position — 2026-08-06

FuelGuard is now at **backend parity with every completed HazmatGuard milestone**: **M0.5 defects · M1 ·
M3 · M4 · M5 · M12**. Engine `0.8.0`, normalizer `2.0.0`, dataset as shipped in `@hazmat/data`.
All 11 workspace packages **typecheck clean** (tsc + vue-tsc). The full test suite and the web bundle
were **NOT run in this environment** (see Verification) — that is the main open verification step.

## This session — M6 advanced document scanner (self-built, DCE realized)

Built the driver document-capture vertical + the self-built scanner core. **DCE
(`docs/plans/drivers-app/DOCUMENT-CAPTURE-ENGINE.md`) is the design of record; PLAN M6/§12.3 is the DoD.**
Committed to `main` (2df6ded → 142ee48):

- **`@fuelguard/capture-engine`** (new pure-TS package): DCE §2 contracts + rejection taxonomy, §4 versioned
  config + Ed25519-verify seam + monotonic guard (§8), the §5 geometry-led quality/legibility gate, provider
  interfaces. Gate thresholds **aligned to the server `usabilityGate` (1200/100/0.06)**, not the DCE draft.
- **Server `/api/me/hazmat/*`** (driver-JWT): create own load · register document · submit(+analyze) · get
  verdict/runs — reusing the built services + 0092 driver-scope RLS; a driver never clears/attests. Every
  create/register/submit step is **idempotent** (offline outbox re-drains, no double-post). Migration
  **`0133`** adds capture-provenance columns to `hazmat_documents` (`quality` already existed).
- **Native Expo module** `apps/driver/modules/capture-native` (iOS Swift VNDocumentCamera + VNRecognizeText;
  Android Kotlin GmsDocumentScanner + ML Kit) — authored here, **builds on the Mac** — plus a **JS fallback**
  (expo-image-picker → 1568 WebP q80 / JPEG → resolution gate before upload) so the vertical runs today.
- **Client**: engine bootstrap (config + provider select), pure capture model (unit-tested), `app/hazmat/
  capture.tsx`, the `HAZMAT_CAPTURE_KIND` outbox handler, `app/hazmat/[loadId].tsx` verdict view (polls runs
  → cleared/rejected/in-review with CFR citations).

**Verified here:** every touched package typechecks clean (`@fuelguard/capture-engine`, `packages/shared`,
`apps/api`, `apps/driver`). **Not run here** (Mac): vitest, the native build, the app runtime.

## Done previously (ported from HazmatGuard source of truth)

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

- **M9 — conditional org checks: BOTH checks built (PROVISIONAL, SME-attestation pending).** §172.800
  security-plan (`securityPlan.ts`, >792 gal Div 2.1 / Class 3 PG I/II) and now §385.403(b) FMCSA safety
  permit (`safetyPermit.ts`, >25 kg net Div 1.1/1.2/1.3 or placardable Div 1.5) — both fail-closed, both
  emit UNCLEARABLE org flags (`org_unqualified:security_plan`, `org_unqualified:hazmat_safety_permit`)
  wired through `qualifyOrg` + the DB-facing `evaluateQualification`. eCFR-verified thresholds; `attested`
  stays false until SME sign-off. **Remaining §385.403 dataset work (SME + new entry fields):** categories
  (a) Class 7 RCQ, (c)-(e) PIH hazard zones A/B/C/D, (f) methane content — not dataset-evaluable today, so
  recorded as candidates (never silently passed), the hazmat-trained person remains the backstop.
- **M6 — driver capture: vertical BUILT this session.** Engine core + `/api/me/hazmat/*` + 0133 + native
  module + JS fallback + capture/verdict screens, all typechecked. Remaining: build the native module on a
  Mac (`expo prebuild` + run), run `pnpm test`, and the DCE-0 on-hardware checks (ML Kit no-egress; OCR
  confidence/latency on a min-spec Android). v2 RawCapture + a real Ed25519 verifier/remote fetch deferred.
- **M7 — public placard calculator: BUILT.** Free, unauthenticated, rate-limited `/api/public/hazmat/calc`
  + `/products` (shared `computeCalc`) and a public `/placard-calculator` landing page (session-free
  PublicLayout, reusing the extracted `HazmatCalculatorForm`), answering with CFR citations. Typechecks
  clean (api tsc + web vue-tsc). Remaining for SEO: prerender/meta for indexing (SPA route is live).
- **M10 — placard-art provenance/regression/labeling infra: BUILT (provisional).** `@hazmat/placards/
  provenance.ts` — per-placard provenance (source DOT Chart 17 2022-10-06, §172.519 geometry, §172.407(d)(5)
  PANTONE 186U/151U/109U/335U/285U — all eCFR-verified), a SHA-256 pin over all 25 rendered SVGs (visual-
  regression test), and specimen labeling now on every calc surface (VerdictPanel + PublicLayout + packet).
  `PLACARD_ART_ATTESTED=false`, `symbolProvisional` unchanged. **Remaining (design + SME, launch blocker):**
  trace the placeholder pictograms from DOT Chart 17, confirm PANTONE/geometry, per-placard SME sign-off →
  flip `symbolProvisional`/`attested`. Cannot be derived from the CFR text — needs the source artwork.
- **M11 — operational readiness: code slices BUILT; infra actions are the owner's.** (§13, `docs/plans/
  HAZMATGUARD-M11-OPS.md`.) DONE (typechecked): Sentry PII scrubbing (`lib/sentryScrub.ts` beforeSend —
  strips CDL/DOB/address/medical-registry + image bytes, keeps only user.id, release-tagged engine+data+art;
  unit-tested), nightly hazmat storage-orphan reconcile (`storageReconcile.ts` + scheduler — deletes objects
  with no row past 24h, flags missing-object rows, never drops a row; pure planner tested), and a
  provider-agnostic off-provider backup (`storageBackup.ts`, `BackupTarget` seam). Docs: RPO 1h / RTO 4h +
  restore runbook + drill log. **Owner infra (not code):** enable PITR, stand up the 2nd storage provider +
  schedule the backup, run the first restore drill. ·
  **M9** §385.403 (build from CFR, provisional). **M8** SME real-BOL validation is the final step after build.

## Required actions before "live" (blockers)

1. **`pnpm install`** — new workspace package `@fuelguard/capture-engine` (added as an `apps/driver` dep);
   links it so Metro + tsc + vitest resolve it on the Mac.
2. **Apply migration `0133`** to Supabase — `hazmat_documents` capture-provenance columns (additive,
   insert-only, safe after 0132). Migrations 0127–0132 already applied.
3. **Build the driver app on a Mac** — `expo prebuild` then `expo run:ios` / `run:android` to compile the
   native `capture-native` module (authored in the cloud VM, never compiled there).
4. **Run `pnpm test` + `pnpm --filter @fuelguard/web build`** on a Mac (native-binary reason below).
5. **DCE-0 on-hardware checks** (DCE §9/§12): ML Kit no-egress network capture during a scan + OCR (BOLs are
   PII); OCR confidence/latency on a min-spec Android (confidence is SECONDARY in the gate — a tune).
6. **git cleanup** (cloud bridge can't unlink): `rm -f .git/index.lock .git/tmp_ci*`.

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
| 2026-08-06 | Audit fixes (0132 idempotent RPC + UTC bucket + catch guard) · **M9 §172.800** security-plan check (provisional/fail-closed; §385.403 deferred to SME). |
