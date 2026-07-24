# HazmatGuard — Implementation Plan (BOL Compliance, Load Eligibility & Placarding Module)

> The single source of truth for building the hazmat module. Written to be followed from any
> fresh chat/session with zero prior context: every decision is stated, nothing is assumed.
> Companion research: `docs/17-HAZMAT-BOL-COMPLIANCE.md` (rule catalogs, citations, ecosystem).
> Status: PLANNED · Owner: Miki (Silvicom Inc.) · Created 2026-07-23.
> Audit trail: v1 drafted + adversarial review (20 findings, fixed) 2026-07-23; v2 three-lens
> audit — regulatory (live-eCFR verified), codebase (real source), followability/business —
> 37 findings, all resolved in-place 2026-07-23. Load-bearing v2 corrections: §172.336(c) is now
> a TABLE (old (c)(2)–(c)(6) cites are dead — citation resolver added); ID-retention window is
> previous-OR-current business day, distillates only, never ethanol IDs; residue exclusion cite
> is §172.504(d)/§173.29(c); analysis runs in-process (the jobs table is a ledger, not a queue);
> six-role RLS matrix; API mounts under /api/hazmat/*; storage is no-client-delete + signed URLs.
> v3 (2026-07-24, owner decisions): D4 revised — **Table 2 scope only** at v1, with total Table 1
> recognition + fail-closed block (`table1_out_of_scope_v1`); new D11 — the 15-yr hazmat expert's
> documented audit flow drives H3 rule ordering/calibration, H7 review ordering, golden
> authorship, and a traceability matrix (CFR wins conflicts; disagreements investigated + logged).
> v4 (2026-07-24): focused audit of the BOL↔library resolution algorithm against the live
> 172.101 table. Two errors fixed (mandatory PG equality — Class 2 gases have NO PG; "exactly
> one row" — 'or'-alternates and UN/NA D/I duplicates need canonical-entry semantics) and the
> full `resolveHmtLine()` spec locked in H6: enumerated normalization (only reg-authorized
> transforms), ID-blocking, conditional PG, class normalization incl. Combustible-liquid
> reclass, exact-only matching justified by real near-miss pairs (1206/1208, 1267/1268,
> 1203/1230), <1 ms/line perf budget with CI benchmark, mutation-sweep test requirement.
> Note: the 2026-01-14 FR fuel rule (eff. 2026-02-13) amended §172.336 marking rules, not the
> HMT — dataset v1 must pin post-2026-02-13 text (already implied by "current eCFR"; stated
> here for the record).
> v4.1 (2026-07-24): validated against a real catalog-style BOL (IBA, UN3264 drums + dormant
> pre-printed lines). Added H6 rule c2 `preprinted_line_not_loaded` (blank-count-and-weight
> lines → one-tap not-loaded confirmation; dormant lines still HMT-resolved and template errors
> reported as warnings — the test BOL's pre-printed "UN1219 … PG III" is a live example: UN1219
> is PG II only). The BOL joins the golden corpus as a composite fixture.
> v4.2 (2026-07-24, expert field case): special-permit / claimed-exception logic added end-to-
> end — engine gate `placard_exception_requires_special_permit` (H2 step 10), `specialPermits`
> in BolFields + §172.203(a) rules (H3), `special_permit` doc kind + load columns (H4), dedicated
> SP reviewer attestation (H7), dock-side driver coaching + SP capture with expiry extraction +
> offline permit access (H10), PHMSA SP-database auto-lookup in backlog. Golden scenario: the
> real "shipper claims no placards, no permit in hand" 3-hour roadside case — resolved at the
> dock instead.
> v4.3 (2026-07-24, expert field case): HM-column X/RQ correctness cluster added — per-line
> `hmColumnMark` in BolFields; Appendix A hazardous-substances/RQ table added to the H1 dataset;
> four new rules (mark missing on hazmat line, mark on non-hazmat line, RQ required but absent
> §172.203(c), RQ over-declared) + deterministic RQ evaluation with interval arithmetic for
> concentration-qualified mixtures (decides the IBA "<5% sulfuric acid" case as NOT RQ);
> indeterminate → conditional, fail-closed. Petroleum-exclusion calibration unchanged.
> v4.4 (2026-07-24, expert field case): marine-pollutant + port/IMDG exception logic, verified
> against live eCFR. Appendix B MP list added to dataset; `portContext.vesselConnected` input
> (one-tap driver question — the fact that flips the regimes); H2 step 11 MP exception ladder
> (NO MP placard exists — mark only; §171.4(c)(1) non-bulk highway off-switch; §172.322(d)
> exceptions; §172.203(l)(4)); new `marks` verdict output distinct from placards; H2 step 12
> IMDG drayage gate (US placards still computed + automatable US overlays checked; regime-level
> judgments → `imdg_drayage_review` human review); full IMDG depth = named backlog pack.
> Verification caveats from research (Appendix B intro wording; §172.322(e) size sub-clauses)
> carried into H1 fixture tasks.
> v4.5 (2026-07-24, owner request): "We don't haul" deny rules — policy `denyRules` at
> class/division + PG + ID granularity (e.g., 6.1 PG I), locked precedence deny > allow,
> deny-list builder UI (H8), and the accidental-load protection chain: coached pre-load BOL
> scan (H10), full-screen DO-NOT-LOAD driver result, immediate `hazmat.policy_block` push to
> dispatcher + safety, and override restricted to `policyBlockOverrideRoles` (default admin
> only). Golden scenarios: deny-combo matching incl. deny-beats-allow and PG-level splits.

---

## 0. How to use this document

- **Phases H0–H12 are dependency-ordered.** Build one phase per working session, exactly like
  `03-ROADMAP.md` — each phase ends demoable and green (`pnpm lint && pnpm test`) before the next starts.
- Each phase has: **Objective · Deliverables · Decisions (locked) · Contracts (schema/API) ·
  Tests · Exit criteria · Verification** (sanity ✓ codebase ✓ goals ✓). If, while building, a
  decision proves wrong against the real codebase, update THIS file in the same PR — the doc and
  the code must never disagree.
- A ☐/☑ box in the phase header tracks completion. Update it when the phase merges.
- Naming used throughout: the module code name is **`hazmat`** (packages, routes, feature dirs);
  the standalone product name is **HazmatGuard** (branding only, never in code identifiers).

## 1. Locked decisions (from research + product discussions — do not re-litigate silently)

| # | Decision | Rationale (short) |
|---|----------|-------------------|
| D1 | **AI reads, code decides.** Vision models ONLY convert photos → structured fields. Every compliance/eligibility/placard verdict comes from a deterministic, versioned rules engine with a CFR citation per finding. No LLM output ever becomes a verdict. | Only way to guarantee repeatable correctness; matches 17 §1. |
| D2 | **Fail-closed.** Any low confidence, dual-pass disagreement, HMT mismatch, arithmetic failure, policy block, or unknown product → load is `needs_review`; only a fully-green run or a human attestation produces `cleared`. There is no "probably fine" state. | "Nobody gets a ticket because of us." |
| D3 | **Separable module.** Engine + data live in dependency-free packages; app code depends on them, never the reverse. Enforced in CI (H0). Sellable later as standalone HazmatGuard app and as a licensed API. | Product strategy (3 revenue doors). |
| D4 *(revised 2026-07-24)* | **Launch scope: Table 2 materials only, fuel-depth BOL validation.** The engine's *placard-logic depth* covers Table 2 classes (Class 3, Combustible liquid, 2.1, 2.2, 4.1, 4.2, 5.1, non-PIH 6.1, 8, 9, 1.4/1.5/1.6 deferred too — see H2). Rationale: the overwhelming majority of carriers haul Table 2 materials only; Table 1 (explosives 1.1–1.3, 2.3 poison gas, 4.3 in bulk contexts, PIH Zone A/B, Yellow-III radioactive) is a specialist niche. **Fail-closed corollary (non-negotiable):** the engine still RECOGNIZES Table 1 materials from the dataset — any Table 1 line produces a blocking `table1_out_of_scope_v1` finding and the load can never be cleared or made eligible in v1. Silence or a wrong verdict on a Table 1 load is forbidden; "we don't cover this yet, do not rely on the tool" is the only allowed answer. Deep BOL description validation ships first for fuel products (Class 3, Combustible liquid, 2.1). Table 1 support = a later expansion pack (Business backlog). | Miki 2026-07-24. |
| D11 | **The expert audit flow is a first-class input.** A hazmat safety professional (15 yrs trucking-industry hazmat experience, working with Miki) documents her EXACT BOL-audit flow — what she checks, in what order, what fails a load, what she does next. That flow drives: the H3 rule ordering + severity calibration, the H7 review-screen ordering, golden scenarios (her real-world edge cases), and she is the designated SME for independent golden authorship (fills the Business §costs line 7 role). **Conflict rule: where her flow and the CFR disagree, the CFR wins the verdict — but every disagreement is investigated and documented before being resolved** (it's either an exception we missed or a habit that isn't law; both outcomes are valuable and recorded in the traceability matrix, H3). The engine stays deterministic — her flow shapes ordering, calibration, UX, and tests, never replaces rules with intuition. | Miki 2026-07-24. |
| D5 | **Licensed second data source: YES, budgeted.** eCFR is primary; a licensed maintained 172.101 dataset (Hazcheck DGL Data, or equivalent) is the second source; both must agree before a dataset release ships. Commercial shadow validator (Labelmaster DGIS) evaluated in H11. | Miki 2026-07-23. |
| D6 | **Reviewers = customer's own hazmat-trained staff** (49 CFR 172 Subpart H). Product is decision support; attestation is by the customer. Expert-review-as-a-service = possible future paid tier (see §Business), NOT in v1. | Miki 2026-07-23. |
| D7 | **v1 capture = mobile web in the existing Vue app.** Drivers already have logins; a mobile-first capture flow ships in `apps/web`. The future native driver app reuses the identical API contract (H10 defines it). | Miki 2026-07-23. |
| D8 | Positioning/legal: outputs labeled **"automated pre-check for review by hazmat-trained personnel"**; named-reviewer attestation to clear/override; full evidence chain stored per run; marketing may never say "guaranteed compliant" (see §Business). | 17 §9; non-delegable duties (49 CFR 171.2). |
| D9 | Regulatory dataset updates are **human-reviewed releases** (never auto-sync), versioned, with effective dates; every verdict records dataset + engine version so it is reproducible forever. | 17 §6. |
| D10 | Model usage follows the existing `07-AI-VERIFICATION.md` discipline: pinned model IDs in env, Zod-validated structured output, content-hash caching, per-org token budget, kill-switch, `ANTHROPIC_API_KEY` server-side only. | Consistency with shipped AI layer. |

## 2. Goals, non-goals, success criteria

**Goals.** (G1) Zero silent wrong verdicts: an incorrect placard/compliance answer must be
impossible without a human having overridden a flag. (G2) BOL verdict + placard set + eligibility
in < 60 s from photo submission for the green path. (G3) Review rate low enough to be usable
(< 25% of loads flagged after week-4 calibration; measured, then tightened). (G4) Every verdict
carries citations + plain-language explanation a driver/dispatcher understands. (G5) Module fully
separable: engine packages build & test with the rest of the repo deleted. (G6) Audit trail
sufficient to defend any verdict years later (image, extraction, dataset+engine versions, rules
fired, reviewer identity).

**Non-goals (v1).** International modes (IATA/IMDG/TDG/ADR), rail; hazardous waste manifests;
**Table 1 materials entirely (D4-revised: recognized and blocked, never assessed)**; automated
393 securement *certification*
(H9 is checklist/defect assist only); native mobile app (H10 preps for it); state-level permit
rules (tracked in Business §backlog); non-US operation.

**Success criteria at launch (measured in H11 shadow mode).** Golden suite: 100% pass,
≥ 400 scenarios. Extraction on the real-photo corpus: ≥ 98% field-level accuracy on cleared
loads, **0 silent errors** (wrong value that reached `cleared` without review) across the entire
shadow period. Reg-dataset release process exercised at least once end-to-end.

## 3. References

`17-HAZMAT-BOL-COMPLIANCE.md` Appendix A (BOL rules + traps), Appendix B (placard/segregation
rules + traps), Appendix C (data sources). eCFR 49 CFR Parts 172/173/177. PHMSA interpretation
letters cited therein. Internal: `01-ARCHITECTURE.md`, `02-DATA-MODEL.md` (+§10 amendments),
`07-AI-VERIFICATION.md`, `MIGRATION-DISCIPLINE.md`, `scripts/check-feature-boundaries.mjs`,
`scripts/gen-rule-catalog.mjs` (catalog.yaml → generated TS pattern to reuse).

## 4. Phase map

| Phase | Goal | Depends on | Demoable outcome |
|-------|------|------------|------------------|
| **H0** ☐ Module foundation | Packages, boundaries, entitlements, CI guards | — | Engine package builds standalone; CI fails on boundary violation; org entitlement gates empty Hazmat nav item. |
| **H1** ☐ Regulatory data layer | Versioned HMT/ERG datasets + import/diff/release tooling | H0 | `hazmat-data` ships dataset v1; two-source diff report runs; product lookup works in a test. |
| **H2** ☐ Rules engine: placards, eligibility, segregation | The deterministic core + golden suite | H1 | Engine answers every golden scenario with citations; 100% pass. |
| **H3** ☐ Rules engine: BOL compliance findings | Expert audit-flow capture (D11) + shipping-paper ruleset (fuel depth) + severity tiers | H2 | BOL field-set in → tiered findings with citations out; trap tests pass. |
| **H4** ☐ Schema, API & storage | Tables, RLS, routes, storage buckets | H0 | Load CRUD via API with RLS-verified isolation; documents upload. |
| **H5** ☐ Manual UI: placard calculator + load workspace | Value before AI; dispatcher manual path | H2–H4 | Dispatcher enters a load by hand → placards, eligibility, findings on screen. |
| **H6** ☐ Extraction service | Vision dual-pass + quality gate + cross-validation | H3, H4 | Photo in → validated fields or precise review flags; corpus harness runs. |
| **H7** ☐ Review queue & attestation | Fail-closed workflow UX | H5, H6 | Flagged load reviewed field-by-field with pixel evidence; attestation recorded. |
| **H8** ☐ Company policy & trip context | Allowed products, carrier relationship, tank state, business-day IDs | H2, H4 | Policy blocks an ineligible product; residue/same-day rules change placard output correctly. |
| **H9** ☐ Securement & placard-photo verification | Truck photo vs computed placards + checklist | H2, H6 | Photo of placarded truck → match/mismatch against required set. |
| **H10** ☐ Driver capture (mobile web) | Guided capture flow + API contract for future native app | H6, H7 | Driver submits BOL+securement photos from a phone; load lands analyzed. |
| **H11** ☐ Hardening & shadow pilot | Shadow mode on real loads, calibration, shadow validator, ops runbook | H5–H10 | 4+ weeks shadow metrics; go/no-go vs §2 criteria. |
| **H12** ☐ Productization | HazmatGuard branding, standalone deploy, API productization | H11 | Same repo deploys a HazmatGuard-branded instance; entitlement matrix proven. |
| **B** ☐ Business & GTM | Pricing, legal, ops, marketing guardrails | parallel | §Business complete with owner sign-off. |

---

## Phase H0 ☐ — Module foundation & boundaries

**Objective.** Create the separable module skeleton and the guardrails that keep it separable forever.

**Deliverables.**
1. `packages/hazmat-engine` — new pnpm workspace package `@hazmat/engine`. Pure TypeScript,
   strict, **zero runtime dependencies** and **zero imports from any other workspace package**
   (dev-deps allowed: typescript, vitest, zod is permitted as the single exception because the
   engine's I/O schemas are Zod — Zod is dependency-light and already the repo standard).
   Exports: `evaluateLoad()`, `computePlacards()`, `validateBol()`, `checkEligibility()`,
   `checkSegregation()` + all I/O types. No I/O, no Date.now() (caller passes `evaluatedAt`),
   no network, no DB — a pure function library.
2. `packages/hazmat-data` — package `@hazmat/data`. Ships versioned dataset JSON + a typed
   loader + Node-only maintenance scripts (`import/`, excluded from the published surface).
   `@hazmat/engine` does NOT import `@hazmat/data`; the **caller** loads a dataset and passes it
   into engine functions. This keeps the engine testable with synthetic datasets and the data
   updatable without touching engine code.
3. Boundary enforcement in CI: extend `scripts/check-feature-boundaries.mjs` with a package-level
   check — fail if `packages/hazmat-engine/**` or `packages/hazmat-data/**` contains
   `from "@fuelguard/` or `from "@/` or any workspace import other than `@hazmat/engine` (data may
   not even import engine). Add to the same npm script CI already runs.
4. Org entitlements: migration `0079_org_entitlements.sql` —
   `alter table organizations add column entitlements text[] not null default '{fuelguard}';`
   Values are product slugs: `fuelguard`, `hazmatguard`. JWT custom-claims hook is **not** changed
   (claims stay small); the web app reads entitlements via the existing org query, the API guards
   hazmat routes with a middleware `requireEntitlement('hazmatguard')` that checks the org row
   (service-role read, cached 60 s in-process).
5. `apps/web/src/features/hazmat/` empty feature dir + nav item gated by entitlement;
   `apps/api/src/routes/hazmat/` mounted under **`/api/hazmat/*`** (inside the existing `/api`
   prefix — rate limiters and the SPA fallback in app.ts key on it; see H4) behind auth +
   entitlement middleware.
6. **Entitlement management endpoint** in the platform admin-api (service-role, 0070 pattern):
   grant/revoke `hazmatguard` per org + `org.entitlement_changed` audit action. (Interim before
   it ships: manual SQL by platform operator, audit-logged.)
7. Add a `hazmat` section to `APP_SECTIONS`/`SECTION_ACCESS` in `packages/shared/src/auth.ts` —
   the codebase's single source of truth for role-based section access (six roles exist:
   admin, fleet_manager, driver, auditor, dispatcher, safety_manager) — so nav, `requireRole`,
   and RLS all derive hazmat access from one map (H4 matrix defines the values).

**Decisions.**
- Engine language: TypeScript (not Rust/WASM) — same stack, testable by the whole team; determinism
  needs no special runtime. Revisit only if the API-licensing door (H12) demands polyglot SDKs.
- Package names use the `@hazmat/*` npm scope (not `@fuelguard/*`) so extraction to a separate repo
  is a copy, not a rename.
- Versioning: `@hazmat/engine` uses semver, starting `0.1.0`; **every verdict-affecting change bumps
  minor and adds a CHANGELOG entry** — the version is stored on every verdict row (H4).

**Tests.** Engine package: `pnpm --filter @hazmat/engine test` runs standalone; a CI job builds
the two packages **in isolation** (temp dir, `pnpm deploy`-style) to prove G5 separability.
Boundary script: fixture test with a deliberate violation must fail.

**Exit criteria.** Both packages build+test in isolation; boundary CI red/green demonstrated;
entitlement-gated empty Hazmat page visible for Silvicom org only when entitlement added.

**Verification.** *Sanity:* no product logic yet, nothing to get wrong. *Codebase:* pnpm
workspaces + numbered migrations (next free = 0079 — confirm against `supabase/migrations/` at
build time; 0016 is duplicated historically, never reuse a number) + existing boundary-script
pattern + existing auth middleware in `apps/api/src/middleware/`. *Goals:* G5 enforced from day
one; D3 satisfied structurally.

---

## Phase H1 ☐ — Regulatory data layer

**Objective.** A versioned, two-source-verified, machine-readable copy of every regulatory table
the engine needs. This phase is pure data engineering — no AI, no app code.

**Deliverables (all inside `packages/hazmat-data`).**
1. **Dataset schema** (TypeScript types + Zod) — modeled at TWO granularities, because the
   printed table is not flat (verified against live eCFR: one entry can span multiple PG
   sub-rows, carry several legal 'or'-alternate names, and duplicate across UN/NA and D/I
   symbol variants):
   - `HmtEntry` (canonical): `{ entryId, symbols, psnPrinted, psnAlternates[], italicText,
     hazardClass, subsidiaryClasses[], idPrefix: 'UN'|'NA', idNumber, pgRows: Array<{ pg: 'I'|'II'|'III'|null,
     labelCodes, specialProvisions, bulkPackagingRef, quantityLimits, vesselStowage }> }` —
     one per printed entry; **PG is null for entries with an empty PG column (all Class 2
     gases — UN1075/UN1978 have NO packing group)**; italic text is stored separately and is
     never part of the PSN (§172.101(c)(2)); pure "X, *see* Y" cross-reference lines are
     excluded from the match space ("see also" entries like Propane are real entries and stay).
   - `HmtMatchRecord` (derived at build time, one per matchable combination): `{ normalizedPsn,
     idPrefix, idNumber, pg, entryId }` — the 'or'-alternates each expand to their own record
     ("Gas oil", "Diesel fuel", "Heating oil, light" are three records → one UN1202 entry).
     **Resolution semantics everywhere in this plan: "resolves uniquely" means exactly one
     `entryId` + one pg-row — NOT one flat record** (otherwise alternates and UN/NA-vs-D/I
     duplicates self-ambiguate: "Diesel fuel" legally exists as both NA1993(D) and UN1202(I),
     and BOTH are valid domestically per §172.101(b)(3)/(b)(5) + PHMSA 18-0096).
   - `PlacardSpec`: Table 1 / Table 2 membership per class/division, placard name, design ref (§172.521–.560), wording options (GASOLINE §172.542(c), FUEL OIL §172.544(c)).
   - `SegregationCell`: the full §177.848(d) grid — `{ rowClass, colClass, value: 'X'|'O'|'*'|null, notes }` transcribed cell-by-cell.
   - `HazSubstance` (Appendix A to §172.101 — the hazardous-substances/RQ table): `{ name,
     nameNormalized, casNumber, rqPounds, rqKg }`, plus the Appendix A mixture rules encoded as
     data where mechanical. Powers the RQ correctness rules (H3): RQ is required only when a
     listed substance meets/exceeds its RQ **in one package** (§171.8 "hazardous substance",
     §172.203(c)); petroleum fuels stay excluded (CERCLA petroleum exclusion — the existing
     `rq_missing_on_fuel` never-fires calibration is unchanged).
   - `MarinePollutant` (Appendix B to §172.101): `{ name, nameNormalized, severe: boolean }`
     ("PP" column = severe). Name-based, not UN-indexed — matched against PSNs and G-entry
     technical names. Mixture qualification thresholds (≥10%, ≥1% severe — §171.8) use the same
     interval-arithmetic approach as RQ; indeterminate → conditional. A material *declared* MP
     on the paper but not in Appendix B is VALID, not an error (voluntary IMDG-criteria MPs,
     App. B intro ¶4) — honor the declaration, fail-closed.
   - `ErgEntry`: `{ idNumber, guideNumber }` from ERG 2024.
   - `SpecialProvisionText`: id → text for provisions the engine interprets (only those it needs; list grows explicitly).
   - `Dataset`: `{ version, sourceEcfrDate, sourceSecondaryRef, effectiveDate, rows..., checksum }`.
2. **eCFR importer** (`import/ecfr.ts`): pulls Title 49 point-in-time XML from the eCFR versioner
   API, parses Part 172 (HMT table), 172.504(e) tables, 177.848(d) into the schema. Parser has
   its own unit tests with frozen XML fixtures checked into the repo.
3. **Second-source diff** (`import/diff.ts`): loads the licensed dataset (Hazcheck DGL CSV/Excel
   per D5 — exact column mapping written when the license lands; the diff tool takes a mapping
   config) and reports every row-level disagreement with the eCFR parse. **Release rule: zero
   unexplained disagreements.** Explained ones (e.g., vendor includes guidance rows) are recorded
   in `datasets/vX/diff-report.md`.
   **License procurement requirement (do this FIRST in this phase):** obtain, in writing, that
   the license permits (a) embedding the data in a commercial SaaS, and (b) use in a product
   competitive with the vendor's own compliance tools — data vendors commonly forbid exactly
   this, and discovering it at signing time voids the two-source launch rule. If refused:
   fallback second source = another licensed HMT vendor (3E) or, failing both, a **second
   independent human transcription** of the fuel-relevant HMT rows + placard/segregation tables
   (bounded work, ~200 rows) — the two-source *principle* is non-negotiable, the vendor is not.
   Note for door 3 (H12): the licensed data must never be re-exposed through the public calc API —
   engine outputs are verdicts, not dataset rows, which keeps the API outside typical
   redistribution clauses; confirm this reading with the vendor in the same letter.
3b. **Citation resolver check** (build-time): every citation string in the H2/H3 rule catalogs
   must resolve against the current eCFR structure (section + paragraph existence via the eCFR
   API); unresolvable citations fail the dataset build. This is what catches restructurings like
   §172.336(c)'s conversion to a table (old (c)(2)–(c)(6) designators no longer exist).
4. **ERG importer**: one-time extraction of UN→guide mapping from the ERG 2024 PDF into
   `erg2024.json`, hand-verified for every fuel ID (1203, 1202, 1993, 3475, 1170, 1987, 1863,
   1268, 1223, 1075, 1978, 3257) + spot-check of 30 random IDs; frozen until ERG 2028.
5. **Release process** (documented in `packages/hazmat-data/RELEASING.md`): poll eCFR
   `latest_amended_on` (weekly scheduled job in H11; manual until then) → if changed, run importer
   → run diff vs licensed source → human reviews the delta → bump dataset version
   (`2026.07.0` calendar-versioned) with `effectiveDate` → full golden suite (H2) must pass →
   merge. Emergency path: same steps, same day, no shortcuts — the steps ARE the safety.
6. **Dataset v1 shipped**: built from current eCFR, second-source-verified (or, if license
   procurement lags: shipped `provisional: true` — the H4/H7 **clear endpoint** then refuses ALL
   clearing, auto or attested, in production (see H4 state-machine note; the engine itself is a
   pure function and has no clearing concept). This makes the license genuinely blocking for
   launch but not for development).

**Decisions.**
- Datasets are JSON files inside the package (~2–4 MB acceptable), loaded whole into memory; no
  DB table for HMT rows. Rationale: engine purity, trivial versioning via package release, no
  migration churn on reg updates. The DB stores only *which* dataset version each verdict used.
- Product resolution for company policy and UI pickers comes from the same dataset — no separate
  product table. A curated `fuelProducts.json` (the ~14 fuel descriptions from 17 §A.7) ships as
  a convenience overlay with `hmtRef` links into the dataset, **plus `defaultFlashPointF` (cited
  source per value) and `typicalEthanolPct` where applicable** — overlay fields that feed engine
  inputs the HMT itself does not carry (H2 flash-point/ethanol rules).
- PHMSA interpretation letters that modify engine behavior (15-0187R, 25-0024, 18-0023, 18-0096,
  14-0178, 07-0100) are encoded as `interpretations.json` `{ id, url, summary, affectsRules[] }`
  and referenced in rule citations — so a citation can say "§172.336(c)(5) + PHMSA 18-0023".

**Tests.** Parser fixtures (frozen XML → expected rows, incl. rowspan/footnote edge cases);
round-trip checksum; every fuel product's row asserted field-by-field against hand-typed
expected values (typed directly from eCFR by a human, committed as
`fixtures/handVerifiedRows.ts` — this is the "human ground truth" anchor); segregation grid:
one test per cell (17 §B.4 caution) — all ~289 cells asserted against a hand-typed copy.

**Exit criteria.** Dataset v1 builds reproducibly; diff report clean or fully explained; all
hand-verified fixtures pass; RELEASING.md walkthrough performed once by a second person.

**Verification.** *Sanity:* two independent transcriptions (parser + hand-typed fixtures) must
agree — a parser bug cannot ship silently. *Codebase:* scheduled-job infra exists
(`apps/api/src/schedulers.ts` + `jobs` table, migration 0027) for the H11 poller; scripts follow
the existing `scripts/*.mjs` pattern. *Goals:* D5, D9, G6 (dataset version on every verdict).


---

## Phase H2 ☐ — Rules engine: placards, eligibility, segregation

**Objective.** The deterministic core. After this phase the hardest correctness problem is solved
and permanently regression-guarded.

**Engine I/O contract (locked — breaking changes bump minor version).**
```ts
// @hazmat/engine — all Zod-schema'd
interface LoadInput {
  evaluatedAt: string;                    // ISO; caller-supplied (engine is clock-free)
  vehicle: {
    kind: 'cargo_tank' | 'van_or_flatbed';        // bulk vs non-bulk carrier context
    cargoTankCapacityGal: number | null;          // per-tank; >=1000 gal → 4-sided ID display.
                                                  // null = unknown → engine directs the conservative
                                                  // 4-sided display AND emits a conditional finding
                                                  // ('tank_capacity_unknown') — never guesses smaller.
    compartments: Array<{ index: number; capacityGal: number }> | null;
                                                  // produced by the cargo-tank profile (H4 table +
                                                  // H5 CRUD); null tolerated (arithmetic checks skip,
                                                  // conditional finding emitted)
  };
  tankState: 'loaded' | 'residue_uncleaned' | 'cleaned_and_purged';
  lines: Array<{                          // one per product (per compartment for tanks)
    hmtRef: string;                       // canonical resolution: `${entryId}#${pg ?? 'none'}`
                                          // (entryId per H1's HmtEntry model; produced by pickers
                                          // (manual) or resolveHmtLine() (H6 locked spec))
    reclassedCombustible: boolean;        // offeror's §173.150(f) election — INPUT, never inferred
    quantity: { value: number; unit: 'gal' | 'lb' | 'kg' | 'L' };
    grossWeightLb: number | null;         // needed only for non-bulk Table 2 aggregation
    compartmentIndex: number | null;
    isResidueLine: boolean;
    flashPointF: number | null;           // for lowest-flash-point ID selection; dataset default per product, overridable
    ethanolPct: number | null;            // drives UN3475 logic + §172.336(c)(5) extra-ID rule
    packagingKind: 'bulk' | 'non_bulk';
    packageCount: number | null;
  }>;
  claimedExceptions: {                    // what the SHIPPER asserts, captured at pickup (H10 flow)
    shipperClaimsNoPlacards: boolean;     // "shipper says this load doesn't need placards"
    claimedSpecialPermits: string[];      // DOT-SP numbers claimed verbally or shown on docs
  };
  portContext: {                          // D11 field case — the vessel-leg fact no BOL states,
                                          // but which flips entire exception regimes:
    vesselConnected: boolean | null;      // any vessel leg in the movement (port pickup/delivery,
                                          // ocean booking). null = unknown → MP determinations go
                                          // conditional (ask, don't guess: assuming YES creates
                                          // false violations, assuming NO drops real ones)
    imdgPapers: boolean | null;           // the document is an IMDG dangerous goods declaration
  };
  tripContext: {
    previousOrCurrentBusinessDayIds: string[] | null;
                                          // §172.336(c) table, business-day row: retention window is the
                                          // PREVIOUS OR CURRENT business day (not since-midnight — a
                                          // narrower window over-flags the common overnight
                                          // gasoline→diesel case). null = UNKNOWN → conditional finding
                                          // asking the driver; [] = confirmed none. Never conflate.
                                          // HARD RULE: only petroleum-distillate lowest-flash-point IDs
                                          // are retainable; 3475/1987 (ethanol blends) may be displayed
                                          // ONLY while the material is aboard — never retained
                                          // (§172.336(c) table; §172.303).
    carrierRelationship: 'carrier_supplied_cargo_tank' | 'shipper_supplied_common_carrier' | 'private_carrier' | 'unknown';
  };
  policy: OrgHazmatPolicy | null;         // null → skip eligibility (pure calculator mode)
  dataset: Dataset;                       // injected, versioned
}
interface Verdict {
  engineVersion: string; datasetVersion: string;
  placards: {
    required: Array<{ placard: PlacardName; positions: 'each_side_and_each_end'; because: Citation[] }>;
    optionalSubstitutions: Array<{ instead: PlacardName; use: PlacardName; because: Citation[] }>;  // e.g. GASOLINE wording
    prohibited: Array<{ placard: PlacardName; because: Citation[] }>;                               // e.g. DANGEROUS on bulk; any placard on cleaned tank
    idDisplays: Array<{ idNumber: string; format: 'on_placard' | 'orange_panel' | 'white_square_on_point';
                        positions: string; because: Citation[] }>;
    ergGuides: Array<{ idNumber: string; guide: string }>;
    marks: Array<{ mark: 'MARINE_POLLUTANT' | 'LIMITED_QUANTITY' | 'HOT';
                   positions: string; because: Citation[] }>;   // marks are NOT placards (step 11)
  };
  eligibility: { status: 'eligible' | 'blocked' | 'not_checked'; blocks: Finding[] };
  segregation: Finding[];                 // violations of §177.848 for this product mix
  trace: TraceNode[];                     // every rule evaluated, fired-or-not, with inputs — the explainability record
}
type Citation = { cfr: string; interpretation?: string };  // e.g. {cfr:'49 CFR 172.504(f)(2)(i)'}
type Finding = { ruleId: string; tier: 'violation'|'conditional'|'warning'|'info';
                 message: string; citations: Citation[]; evidence: Record<string, unknown> };
type PlacardName =                                          // closed enum derived from dataset PlacardSpec
  | 'FLAMMABLE' | 'GASOLINE' | 'COMBUSTIBLE' | 'FUEL_OIL' | 'FLAMMABLE_GAS' | 'NON_FLAMMABLE_GAS'
  | 'OXYGEN' | 'POISON_GAS' | 'FLAMMABLE_SOLID' | 'SPONTANEOUSLY_COMBUSTIBLE' | 'DANGEROUS_WHEN_WET'
  | 'OXIDIZER' | 'ORGANIC_PEROXIDE' | 'POISON' | 'POISON_INHALATION_HAZARD' | 'CORROSIVE'
  | 'RADIOACTIVE' | 'CLASS_9' | 'DANGEROUS'
  | 'EXPLOSIVES_1_1' | 'EXPLOSIVES_1_2' | 'EXPLOSIVES_1_3' | 'EXPLOSIVES_1_4' | 'EXPLOSIVES_1_5' | 'EXPLOSIVES_1_6';
type TraceNode = { ruleId: string; fired: boolean; inputs: Record<string, unknown>;
                   citations: Citation[]; note?: string };  // one per rule evaluated, fired or not
```

**Citation currency (locked):** the eCFR has restructured some sections into tables — notably
**§172.336(c), where old designators (c)(2)–(c)(6) no longer exist** (only (c)(1) remains;
(c)(2) is Reserved). All user-facing citations for those rules must read "§172.336(c) table"
with a row description (e.g., "compartmented tank, multiple petroleum distillate fuels"); the
>10%-ethanol extra-ID requirement is now in the regulation text itself (PHMSA letters 18-0023/
18-0096 are supporting history, not primary authority). H1 gains a **build-time citation
resolver check**: every citation string in the rule catalogs must resolve against the current
eCFR structure or the dataset build fails. (Legacy paragraph designators elsewhere in this plan
are shorthand for the current locations; the catalog is what ships.)

**Implementation decisions.**
- Rule structure mirrors the proven `anomalyRules/` pattern: `packages/hazmat-engine/src/placards/rules.ts`
  as pure functions + a `catalog.yaml` (ruleId, title, citations, tier, docs) compiled by the existing
  `scripts/gen-rule-catalog.mjs` approach into a generated TS catalog — one authoritative rule
  registry rendered in UI and docs.
- The placard algorithm implements, in order: (1) tank-state gate (residue keeps everything,
  §172.514(b)/§173.29; cleaned+purged prohibits everything — cite **§172.502(a) for placards and
  §172.303 for ID-number/marking removal**, two different authorities); (2) per-line class
  resolution honoring `reclassedCombustible`; (3) **Table 1 gate (D4-revised):** any line whose dataset row
  is a Table 1 class/division → blocking finding `table1_out_of_scope_v1` (tier `violation`,
  message states the tool does not assess this material in v1), no placard directives are emitted
  for the load, and eligibility is forced `blocked`. Table 1 *recognition* is dataset-driven and
  total; Table 1 *logic* (any-quantity placards, §172.504(f)(1)/(4)/(5)/(8)/(11) interplay,
  explosive-division rules) is deferred to the Table 1 expansion pack. §172.505 *subsidiary*
  PIH/DWW checks remain live (a Table 2 material can carry them; dataset-driven, cheap, and
  cutting them would be a silent hole); (4) Table 2 with
  the **aggregate-across-all-Table-2-materials** 1,001-lb rule, computed exactly as: aggregate =
  Σ gross weight of lines that are Table 2 AND non-bulk AND not residue-only AND not §172.505
  materials — the bulk and §172.505 exclusions come from §172.504(c); the residue exclusion from
  **§172.504(d) + §173.29(c)** (it is NOT in (c) — cite it correctly or independent verifiers
  will "fix" it wrong). Bulk and §172.505 lines placard regardless of the aggregate. If aggregate
  < 1,001 lb the non-bulk Table 2 placards are *not required* but remain listed as permissive
  options (§172.502(c)). **Conservative-fallback principle, precisely scoped:** when an input is
  unknown the engine may direct MORE *placards* for hazards actually present (§172.502(c)) and
  MORE ID-display positions/formats for materials **actually aboard** — but NEVER an ID number or
  placard for a material not present (§172.502(a) for placards; §172.303 prohibited marking for
  IDs; the §172.336(c) business-day retention is a narrow exception limited to petroleum-
  distillate lowest-flash-point IDs, and expressly NOT ethanol-blend IDs — see the tripContext
  hard rule); (5) §172.504(f) exceptions incl.
  (f)(2) FLAMMABLE-covers-COMBUSTIBLE one-way logic; (6) DANGEROUS option evaluation for non-bulk
  only, with the 2,205-lb single-category-single-facility bar (input: quantities are per BOL =
  one loading facility; multi-pickup loads are out of v1 scope and force `needs_review` via a
  `multi_stop_placard_review` conditional finding); (7) subsidiary placards §172.505; (8) ID
  display sub-engine (§172.328/.332/.334/.336 incl. (c)(2)/(c)(3) wording options, (c)(5)
  lowest-flash-point + ethanol exception, business-day-row retention — all "(c)(N)" shorthand
  here maps to the current §172.336(c) table rows per the citation-currency rule above); (9) ERG
  guide lookup; (10) **special-permit / claimed-exception gate (D11 field case — the "3-hour
  roadside stop"):** if the verdict requires placards (or any other requirement) AND
  `claimedExceptions.shipperClaimsNoPlacards` is true, emit blocking finding
  `placard_exception_requires_special_permit` (citations: §172.504(a) + §172.203(a)): the ONLY
  lawful bases for the claim are a DOT special permit, a specific regulatory exception the BOL
  itself evidences (e.g., limited-quantity marks), or shipper error. Required resolution path
  (H7/H10): obtain the DOT-SP number, verify it appears on the shipping paper (§172.203(a) —
  its absence there is a violation in its own right), and upload the permit document. **The
  engine never adjudicates what a special permit authorizes** — permits are bespoke legal
  documents; an SP-based deviation ALWAYS routes to human review, where the reviewer signs a
  dedicated attestation ("I have read DOT-SP ____ and confirm it covers this deviation for this
  shipper/carrier"). A DOT-SP number on the BOL with no claim attached triggers the milder
  `special_permit_on_paper` conditional: permit copy must be uploaded (most SPs require a
  current copy carried aboard the vehicle) and reviewed. Claimed SP numbers that appear nowhere
  on the paper → `special_permit_not_on_shipping_paper` violation;
  (11) **marine pollutant overlay (D11 field case; verified 2026-07-24):** evaluated for any
  line matching Appendix B (or declared MP on the paper). HARD CALIBRATION: **there is no
  MARINE POLLUTANT placard** — §172.504 contains none; the engine emits MP *mark* directives
  (placard-sized square-on-point) in a new `marks` output array alongside placards, never a
  placard. The exception ladder, in order: (a) non-bulk + highway + `vesselConnected === false`
  → entire MP overlay OFF (§171.4(c)(1), §172.203(l)(4)) — this IS the expert's "small
  packagings" case; (b) `vesselConnected === null` → conditional `vessel_leg_unknown` (one-tap
  driver question, H10); (c) packages ≤5 L / ≤5 kg per single/inner packaging → mark not
  required (§172.322(d)(1)-(2); unknown inner sizes → fail-closed conditional); (d) LQ-marked
  packages → mark not required (§172.322(d)(4)); (e) highway: a subpart E/F label/placard on
  the bulk packaging/vehicle substitutes for the MP mark (§172.322(d)(3) — highway only, never
  vessel); (f) otherwise: bulk <1,000 gal → mark on two opposing sides/ends, ≥1,000 gal and
  vehicles/freight containers → each side + each end (§172.322(b)-(c)). Paper entry "Marine
  Pollutant" + component names required per §172.203(l)(1)-(2) only when bulk or
  vessel-connected ((l)(4) excepts non-bulk highway);
  (12) **IMDG / port-drayage gate (recognized, not fully adjudicated in v1):** `imdgPapers ===
  true` (or vessel-connected pickup with IMDG-style DGD) → the engine still computes and
  requires US subpart F placards for the motor vehicle (§171.25(b)(1); container placards may
  satisfy — §172.502(b)/§172.504(a)) and runs the automatable US overlays: shipper-certification
  presence (§171.22(f)(2)), English (§171.22(f)(3)), ER phone required whenever there is a
  public-highway leg (§171.25(d)(2) relief does NOT apply to drayage; §172.604 format +
  identifier rules), RQ overlay (§171.23(b)(5)), "Waste" prefix (§171.23(b)(6)). Everything
  regime-level — IMDG-vs-§177.848 segregation choice (§171.25(b)(1) authorizes IMDG Ch. 7.2 as
  an alternative: never hard-fail 177.848 on an IMDG load without checking the other regime →
  human), portable-tank specs (§171.25(c)), single-port-area claims (§171.25(d)), IMDG placard
  spec equivalence — emits conditional `imdg_drayage_review` → human review. Full IMDG depth =
  backlog expansion pack.
- Segregation: pure table lookup over every pair of placard/label-required lines (§177.848(d)) +
  the absolute bans (§177.848(c)) + note (e) adjacency rule surfaced as `warning` (photo layout
  isn't knowable from a BOL).
- Eligibility: `OrgHazmatPolicy` (defined here, stored in H8) =
  `{ allowedClasses: string[]; allowedIdNumbers: string[] | 'any_within_classes';
     denyRules: Array<{ classOrDivision?: string; pg?: 'I'|'II'|'III'; idNumber?: string; note?: string }>;
     maxPackingGroup: 'I'|'II'|'III'|null; perVehicleOverrides: Array<{vehicleRef, ...same}>; blockOnUnknownProduct: true }`.
  **Deny rules (D11/owner request 2026-07-24 — "we don't haul" list):** each rule matches on any
  combination of class/division + PG + ID number, so "6.1 PG I" (combo), "2.3" (whole
  division — Table 1, so v1 blocks it anyway), or a specific UN number are all expressible.
  **Precedence is locked: deny beats allow, always** — a product matching any deny rule is
  `blocked` no matter what the allow lists say, with the policy rule (and its `note`, e.g.
  "insurance excludes PG I toxics") quoted in the finding. Eligibility evaluation order:
  Table 1 gate → deny rules → allow lists → maxPackingGroup → unknown-product block.
  `blockOnUnknownProduct` is hard-locked `true` — a product that fails HMT resolution can never be eligible (D2).
- **Org-settings registry (single home rule):** EVERY org-level hazmat flag lives in
  `hazmat_policies.policy`. **Authoritative schema home = `@hazmat/engine`** (which already owns
  `OrgHazmatPolicy` as an engine input type); `packages/shared/src/hazmatPolicy.ts` **re-exports**
  it (dependency direction shared→engine is legal under D3; the reverse is banned — never define
  the type twice). The full field list — including fields consumed by later phases — is declared
  now so no phase invents a new home: the eligibility fields above + `carrierRelationshipDefault`
  (H8), `driversMayCreateLoads: boolean` default true (H10), `placardMismatchBlocks: boolean`
  default false (H9), `enforcement: 'shadow'|'active'` default 'shadow' (H11 — this exact field
  name everywhere; no `hazmat_enforcement` alias), `extractionEnabled: boolean` default true
  (H6 kill-switch; note: this deliberately diverges from the FuelGuard AI layer's
  `organizations`-column kill-switch precedent — hazmat keeps ALL its flags in one place),
  `requiredPhotoAngles: string[]` (H9), `policyBlockOverrideRoles: Role[]` default `['admin']`
  (who may override a company deny-rule block — H6 outcome table). App-only fields that the
  engine never reads (photo angles, enforcement, override roles) live in an `AppHazmatSettings`
  extension schema defined in shared,
  intersected at the API layer — the engine type stays pure.
- Lowest-flash-point ID selection (§172.336(c)(5)): `flashPointF` comes from the line input; when
  null on any line of a multi-distillate load, the engine does NOT guess — it emits conditional
  finding `flash_point_needed_for_id_selection` and directs per-product ID display (the always-legal
  fallback). Dataset support: H1's `fuelProducts.json` carries `defaultFlashPointF` per curated product.
- Everything returns `trace` — the engine never answers without showing its work.

**Golden test suite (the heart of the phase).**
- Format: YAML scenario files in `packages/hazmat-engine/test/golden/` — `{ name, docRef, input, expect }` —
  loaded by one Vitest runner. Human-readable so a hazmat-knowledgeable reviewer (not only a dev) can audit them.
- Mandatory coverage with per-category budgets (minimum **400 scenarios total**; dedupe rule: the
  ~289-cell segregation grid and per-row HMT field values are already asserted cell-by-cell in H1
  fixtures — H2 does NOT re-enumerate them, it covers only *interactions*): every Table 2 row
  (~16) + one `table1_out_of_scope_v1` blocking scenario per Table 1 row (~7 — proves the gate,
  not the logic); every §172.504(f) exception involving only Table 2 classes — (f)(2), (f)(3),
  (f)(7), (f)(9), (f)(10) (~15; Table-1-involving exceptions ship with the expansion pack);
  1,001-lb aggregate edges — 999/1000/1001
  lb, mixed-class aggregation, residue exclusion (~15); DANGEROUS permutations incl. every reason
  it's forbidden (~15); every fuel product of 17 §A.7 alone + all pairwise cargo-tank combos
  (~110); tank states × products (~45); business-day ID scenarios incl. the overnight case and
  the ethanol never-retain rule (~15); both "trap" lists (17 §A.8 + §B.6), ≥1 scenario each
  (~30); segregation *interaction* pairs — one scenario per distinct X/O outcome class plus every
  fuel-relevant pairing (~40); eligibility allow/deny/unknown-product (~20); remainder =
  regression additions from H11.
- **Independent authorship rule (concrete):** the engine is implemented by the developer;
  golden `expect` values are authored **by Miki working directly from the CFR text/doc 17**, or
  by a contracted hazmat SME (budget line in Business §costs) — never by the engine implementer,
  and never by running the engine and pasting its output. The "different chat session, same
  person implementing" shortcut is expressly forbidden. Each scenario file carries
  `verifiedBy: <name>` + date; the H2 exit criteria include a **signed scenario-review log**
  (who verified which files, when) — CI checks the field exists, the log proves a human did it.
  Known doc-17 erratum for fixture authors: **17 §B.5 mis-groups UN3475 under ERG Guide 128 —
  the correct guide is 127** (17 §5.2 has it right); do not copy the B.5 grouping.

**Exit criteria.** 100% golden pass; mutation-style spot check (flip 10 random rule constants →
≥10 scenario failures each time — proves the suite actually constrains the code); `trace` output
reviewed for 5 scenarios by Miki for explainability quality.

**Verification.** *Sanity:* independent-authorship rule + mutation check prevent a
self-confirming test suite. *Codebase:* catalog.yaml/generated pattern, Vitest, pure-function
rule style all already exist (`anomalyRules/`). *Goals:* G1 (deterministic core), G4 (trace +
citations), D1, D4-revised (Table 2 depth + total Table 1 recognition-and-block).

---

## Phase H3 ☐ — Rules engine: BOL compliance findings

**Objective.** `validateBol()` — the shipping-paper ruleset with calibrated severity tiers, fuel
depth first (D4).

**Deliverable 0 — Expert audit-flow capture (D11; do this FIRST, it feeds everything below).**
The expert documents her exact BOL-audit procedure using a structured template we provide
(committed as `docs/hazmat-EXPERT-FLOW.md`):
- Numbered steps in the order she actually works. Per step: what she looks at on the paper,
  what makes it pass vs. fail, what she does on a fail (reject / call shipper / fix-and-note /
  wave through), roughly how often it fails in practice, and one real example.
- A "war stories" section: the strangest/trickiest BOLs she has seen in 15 years (each becomes a
  golden composite scenario in this phase's test set).
- Her personal red-flag heuristics (things that make her slow down even when the paper looks
  legal) — these become `warning`-tier rules or review-UI hints, clearly separated from CFR rules.
Then build the **traceability matrix** (`expert-step ↔ ruleId(s) ↔ CFR citation`), committed
next to the flow doc: every expert step maps to ≥1 rule (or a documented decision NOT to encode
it, with reason); every rule maps to an expert step or is marked "regulatory-only" (legally
required but not in her habit — reviewed WITH her before shipping). Disagreements resolve per
the D11 conflict rule and are logged in the matrix. Finding ordering in `validateBol()` output
follows her step order, so verdicts read in the sequence a professional auditor expects.

**Input contract.** `validateBol(bol: BolFields, ctx: BolContext)` — `BolFields` is what
extraction OR manual entry produces (same type either way); `BolContext` carries everything the
rules read that the paper can't show. Complete signature (every named rule below can be computed
from exactly these inputs — that is the contract test):
`BolContext = { carrierRelationship: LoadInput['tripContext']['carrierRelationship'];
declaredLines: LoadInput['lines'] | null; dataset: Dataset; policy: OrgHazmatPolicy | null }`
(declaredLines powers cross-checks like the ethanol rule; dataset powers HMT-dependent rules —
PG-on-class-2, LPG notation, reclassed-description acceptance, blend-code list; policy powers
`ethanol_content_unconfirmed`).
```ts
interface BolFields {
  hasNonHazmatLines: boolean | null;            // true = mixed paper (non-hazmat lines present);
                                                // false = all-hazmat; null = not determinable
  hmColumnPresent: boolean | null;              // an HM/X column exists on the paper
  hazmatEntriesFirst: boolean | null;           // hazmat lines precede all non-hazmat lines
                                                // (computable from line order on mixed papers)
  specialPermits: Array<{ number: string;       // "DOT-SP 12345" / legacy "DOT-E" patterns found
                          associatedLine: number | null }>;  // which line it's entered against, if clear
  lines: Array<{ rawText: string; hmColumnMark: 'X'|'RQ'|null;   // the actual per-line HM-cell content
                 idNumber: string|null; psn: string|null; hazardClass: string|null;
                 packingGroup: string|null; quantity: {value:number|null; unit:string|null};
                 packageSpec: string|null; sequenceAsPrinted: string[];   // token order actually on paper
                 modifiers: { rq:boolean; residueLastContained:boolean; hot:boolean; ltdQty:boolean;
                              technicalNames:string[]; nonCorrosiveLpgNotation:'noncorrosive'|'not_for_qt'|null } }>;
  emergencyPhone: { number: string|null; providerIdentifierAdjacent: boolean|null; offerorNameAdjacentOrProminent: boolean|null; appearsOncePromincentlyOrPerLine: 'per_line'|'once_prominent'|'absent'|null };
  shipperCertification: { present: boolean|null; wordingVariant: 1|2|'nonstandard'|null; signed: boolean|null };
  pageInfo: { page: number|null; totalPages: number|null; multiPage: boolean|null };
  shipperName: string|null; carrierName: string|null; date: string|null;
}
```
Every field is nullable — "not found" is itself information; a required-but-null field yields a
finding whose tier depends on the rule.

**Ruleset.** Implements 17 Appendix A as ~45 discrete rules, each with `ruleId`, tier, citations
(the build task literally walks A.1–A.8 and creates one rule per requirement/trap). Non-negotiable
calibrations (these ARE the product's expertise — from 17 §A.8):
`quantity_before_description` → **not** a finding; `one_cargo_tank_quantity` → compliant;
`hm_entry_distinction_missing` (renamed from `hm_column_missing` — §172.201(a)(1) offers THREE
disjunctive methods) fires only when `hasNonHazmatLines === true` AND `hmColumnPresent !== true`
AND `hazmatEntriesFirst !== true` — and even then as **conditional**, not violation, because the
third method (contrasting color) is not reliably knowable from a photo; all-hazmat rack BOLs
(`hasNonHazmatLines === false` or `null`) fire nothing.
**HM-mark correctness cluster (D11 field case — shippers mismark X/RQ; per-line
`hmColumnMark`):** `hm_mark_missing_on_hazmat_line` — mixed paper, column present, hazmat line's
cell empty, and hazmat-first ordering doesn't save it → violation (§172.201(a)(1)(iii));
`hm_mark_on_non_hazmat_line` — X/RQ marked on a line that is not hazmat → violation (misleading
entry; sends responders/officers chasing the wrong line); `rq_designation_missing` — the RQ
evaluation (below) says RQ is REQUIRED but "RQ" appears neither in the HM column nor adjacent
to the basic description → violation (§172.203(c); "X" instead of "RQ" is exactly this case);
`rq_designation_not_applicable` — "RQ" marked but the material is not an Appendix A hazardous
substance at/above its RQ → **warning** (over-declaration isn't the crime under-declaration is,
but it's wrong on the paper and the shipper report says so).
**RQ evaluation (deterministic, Appendix A data, fail-closed):** per line — identify candidate
substances via PSN match against Appendix A `nameNormalized`, plus G-entry technical names in
parentheses; compute per-package quantity (package count × per-package weight — the H6 c2
machinery); listed substance AND per-package ≥ RQ → RQ required. **Mixtures with concentration
qualifiers use interval arithmetic, never guesses**: "contains less than 5% sulfuric acid" in a
627-lb drum → upper bound 5% × 627 ≈ 31 lb < the 1,000-lb sulfuric-acid RQ → definitively NOT
RQ-required (decidable!); when the bound cannot decide (no concentration given, or the interval
straddles the RQ) → `rq_indeterminate` conditional, human resolves. Straight petroleum fuels:
excluded, never evaluated.
`certification_missing` tier =
**conditional** keyed to `ctx.carrierRelationship` (violation only for
`shipper_supplied_common_carrier`; info for carrier-supplied/private; `unknown` → conditional with
the question surfaced); `rq_missing_on_fuel` never fires (petroleum exclusion); `placard_note_absent`
never fires; `ethanol_blend_misdescribed` (E>10% described as UN1203 → **violation**) — detection
sources, in order: (a) `ctx.declaredLines` declares a >10% ethanol product while the BOL line says
UN1203; (b) BOL free text/product code indicates a blend grade >E10 (curated code list in
`fuelProducts.json`, e.g., "E15", "E85"); when the true blend % is unknowable from both sources
the rule stays SILENT (no guessing) but `ethanol_content_unconfirmed` fires as **conditional**
whenever the org's policy includes any >E10 product and a UN1203 line is present; reclassed
combustible descriptions accepted in both NA1993 and UN1202 forms; `pg_on_class2` → violation
(propane with PG); `lpg_qt_notation_missing` → violation for UN1075/1978; sequence interruption →
violation with the §172.203(k) technical-name interspersion exception honored; ER-phone rules per
§172.604 incl. identifier-adjacency logic.
Non-fuel-class lines (launch scope D4): basic-description + ER-phone + certification rules run
(they're class-generic); class-specific depth rules run only for fuel classes; any non-fuel line
additionally gets `out_of_depth_scope` **conditional** finding → forces review (fail-closed, D2)
with message "this class's deep validation ships in a later dataset".

**Tests.** One golden YAML per rule (fire + not-fire + boundary), ≥ 3 scenarios/rule (~150);
plus 20 full-BOL composite scenarios transcribed from real rack BOLs (Silvicom's own paperwork —
Miki supplies 20 historical BOLs; they are transcribed by hand into `BolFields` fixtures);
plus the expert's war-story scenarios (Deliverable 0). Independent-authorship rule from H2
applies — **the expert is the designated golden author/verifier for this phase** (D11).

**Exit criteria.** All rule + composite tests pass; a printed "rule catalog" page (generated from
catalog.yaml) lists every BOL rule with tier + citation; the traceability matrix is complete
(no unmapped expert steps, no unreviewed regulatory-only rules); calibration sign-off by **both**
Miki and the expert.

**Verification.** *Sanity:* calibration list prevents the classic failure (pedantic false
violations destroying trust — G3). *Codebase:* same catalog/testing machinery as H2. *Goals:*
G4, D2 (conditional tiers + out-of-scope fail-closed), D4-revised (fuel depth, Table 2 scope), D11 (expert flow drives ordering/calibration).


---

## Phase H4 ☐ — Schema, API & storage

**Objective.** Persistence and transport for loads, documents, runs, verdicts, reviews — with the
same RLS/audit discipline as the rest of the app.

**Migrations** (numbered from the next free slot; names below are canonical):
```sql
-- 00NN_hazmat_core.sql
create type hazmat_load_status as enum
  ('draft','submitted','extracting','needs_review','cleared','rejected','superseded','cancelled');
create type hazmat_doc_kind as enum ('bol','securement','placard_photo','special_permit','other');
-- hazmat_loads additionally carries: special_permit_numbers text[] not null default '{}',
-- claimed_no_placards boolean not null default false  (feeds engine claimedExceptions)
```

**Load state machine (locked — the only legal transitions; enforced in the API layer, tested):**

| From | Event | To |
|---|---|---|
| draft | driver/dispatcher submits (docs or manual lines complete) | submitted |
| submitted | extraction job starts (photo path) | extracting |
| submitted | manual-only analysis completes green | cleared* |
| submitted / extracting | analysis completes with ANY flag (incl. `recapture_needed`, `extraction_failed` — flags are values in `hazmat_runs.flags`, not statuses) | needs_review |
| extracting | analysis completes green | cleared* |
| needs_review | reviewer resolves all flags → re-run green + attestation | cleared |
| needs_review | reviewer rejects (e.g., illegible, wrong document) | rejected |
| draft / submitted / needs_review | creator or admin/dispatcher cancels (wrong/duplicate load; reason required) | cancelled *(new enum value; excluded from review-rate metrics)* |
| cleared | superseding load is cleared (`supersedes_load_id` chain) | superseded |
| rejected | driver resubmits documents | submitted |
| cleared | ANY new run on this load (re-analysis, dataset re-check, document added) | needs_review; the prior clearing review row is kept, load's previous verdict marked superseded-by-run-id |
| cleared | load edited | FORBIDDEN — cleared loads are immutable; create a new load (link `supersedes_load_id`) which sets the old load to superseded |
| any | org disables module mid-flight | loads keep their status; see entitlement rule below |

\* Auto-clear (`cleared` without human review) is legal ONLY via the H6 green-outcome table.
Clearing (auto or attested) is **refused** — hard API error, no exceptions, attestation does NOT
bypass — when the active dataset has `provisional: true` in a production environment (H1 §6).
`hazmat_loads` gains `supersedes_load_id uuid references hazmat_loads(id)`.

```sql

create table hazmat_loads (
  id uuid primary key,                          -- client-generated (existing idempotency pattern, 02 §10.2)
  org_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete restrict,
  trailer_id uuid,                              -- FK to trailers table (exists since migration 0030) added in-migration after confirming its name
  driver_id uuid references drivers(id) on delete restrict,
  status hazmat_load_status not null default 'draft',
  tank_state text not null default 'loaded'
    check (tank_state in ('loaded','residue_uncleaned','cleaned_and_purged')),
  carrier_relationship text not null default 'unknown'
    check (carrier_relationship in ('carrier_supplied_cargo_tank','shipper_supplied_common_carrier','private_carrier','unknown')),
  planned_pickup_at timestamptz,
  declared_lines jsonb not null default '[]',   -- LoadInput.lines (manual path) — engine input, immutable once cleared
  bol_fields jsonb,                             -- BolFields actually used for the verdict (from extraction or manual)
  version int not null default 1,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table hazmat_documents (
  id uuid primary key, org_id uuid not null references organizations(id) on delete cascade,
  load_id uuid not null references hazmat_loads(id) on delete cascade,
  kind hazmat_doc_kind not null, page int not null default 1,
  storage_path text not null,                   -- bucket 'hazmat', key org_id/load_id/{doc_uuid}.webp
  sha256 text not null,                         -- integrity + extraction cache key component
  captured_at timestamptz, uploaded_by uuid references auth.users(id),
  quality jsonb,                                -- usability-gate result {usable, blurScore, glareScore, ...}
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table hazmat_runs (                      -- one row per analysis run (a load can be re-run)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  load_id uuid not null references hazmat_loads(id) on delete cascade,
  engine_version text not null, dataset_version text not null,
  extraction jsonb,                             -- both passes + agreement report + per-field confidence + bboxes
  verdict jsonb not null,                       -- full engine Verdict incl. trace
  outcome text not null check (outcome in ('green','flagged')),
  flags jsonb not null default '[]',            -- blocking flags (drive needs_review)
  advisories jsonb not null default '[]',       -- non-blocking annotations (H9 photo checks) — never affect status
  models jsonb,                                 -- {passA:{model,tokens},passB:{...}} — null for manual runs
  input_hash text not null,                     -- CACHE KEY ONLY (no unique constraint). Defined per run type:
                                                --  photo run: sha256(doc sha256s ‖ model ids ‖ prompt version ‖ engine ver ‖ dataset ver)
                                                --  manual run: sha256(canonical declared_lines+context JSON ‖ engine ver ‖ dataset ver)
                                                --  review re-run: prior run hash ‖ sha256(human corrections JSON)
  created_at timestamptz not null default now()
);
create index on hazmat_runs (org_id, input_hash);   -- lookup index; duplicates allowed (re-runs after version bumps are new rows)
create table hazmat_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  load_id uuid not null references hazmat_loads(id) on delete cascade,
  run_id uuid not null references hazmat_runs(id),
  reviewer_id uuid not null references auth.users(id),
  action text not null check (action in ('field_confirmed','field_corrected','cleared','rejected','override','cant_read')),
  field_path text, old_value jsonb, new_value jsonb,
  attestation text,                             -- exact attestation string shown+accepted (D8)
  created_at timestamptz not null default now()
);
-- 00NN_hazmat_cargo_tank_profiles.sql — the producer for H2's vehicle block.
-- NOTE: FuelGuard's vehicles.tank_capacity_gal AND trailers.reefer_tank_capacity_gal are FUEL
-- tanks (chassis/reefer) — never reuse either as cargo capacity.
create table hazmat_cargo_tank_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  trailer_id uuid references trailers(id) on delete restrict,  -- 0030 PK confirmed = id; restrict preserves evidence chain (trailers soft-delete via status='retired')
  vehicle_id uuid references vehicles(id),      -- for straight trucks / bobtails; exactly one of the two set
  cargo_capacity_gal numeric(8,1),              -- null = unknown → engine conservative path (H2)
  compartments jsonb not null default '[]',     -- [{index, capacityGal}]
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (num_nonnulls(trailer_id, vehicle_id) = 1)
);
-- 00NN_hazmat_policy.sql  (H8 fills usage; table created here)
create table hazmat_policies (
  org_id uuid primary key references organizations(id) on delete cascade,
  policy jsonb not null,                        -- OrgHazmatPolicy, Zod-validated at the API boundary
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
```
RLS — explicit matrix for the REAL role model. **The codebase has six roles** (`admin,
fleet_manager, driver, auditor, dispatcher, safety_manager` — migrations 0077/0078,
`packages/shared/src/constants.ts`) and a section-based access map (`APP_SECTIONS` +
`SECTION_ACCESS` in `packages/shared/src/auth.ts`, consumed by nav, `requireRole`, and RLS SQL).
**Deliverable: add a `hazmat` section to `APP_SECTIONS`/`SECTION_ACCESS`** and derive both UI
gating and policies from it (the 0078 `rolesThatManage()` pattern). This table IS the spec,
mirrored in the RLS test matrix:

| Table | driver | dispatcher | safety_manager | fleet_manager / admin | auditor | service role |
|---|---|---|---|---|---|---|
| hazmat_loads | insert own (`created_by=auth.uid()`, only when policy `driversMayCreateLoads`); select own; update own **drafts** | insert/select/update org loads (drafts + submit) | select all; status actions via API | all org | select only | all |
| hazmat_documents | insert on own loads; select own | insert/select org | select | select/insert | select | all |
| hazmat_runs | select runs of own loads | select org | select | select | select | insert (only writer) |
| hazmat_reviews | **no access** | **no access** (dispatchers create loads; they don't clear them — separation of duties) | insert/select (primary reviewer persona) | insert/select | select | all |
| hazmat_policies | select | select | select | select; **update = admin only** | select | all |
| hazmat_cargo_tank_profiles | select | select | select/insert/update (0078 precedent: safety_manager writes equipment) | select/insert/update | select | all |

Verdict/extraction/review rows are **immutable** (no update policy exists at all; corrections
create new runs/reviews — G6). **Entitlement lifecycle:** the analysis orchestrator re-checks
entitlement at execution start and aborts with flag `entitlement_revoked` (no token spend);
after revocation, existing hazmat data stays **readable** (record-retention duties survive
subscriptions — auditor/admin roles via signed URLs) but every write path is closed.
Entitlement writes themselves have an owner: **an admin-api endpoint** (platform-admin service,
0070 pattern — service-role only) grants/revokes product entitlements and writes an
`org.entitlement_changed` audit entry; until that endpoint ships (H0 deliverable), the documented
interim is manual SQL by the platform operator with a note in the org's audit log. `audit_logs.action` additions:
`hazmat.load_created/submitted/analyzed/cleared/rejected/overridden`, `hazmat.policy_updated`,
`hazmat.dataset_updated`.

**Storage.** New bucket `hazmat`, keyed `org_id/load_id/{doc_uuid}.webp`. **Do NOT clone the
receipts bucket policies** (0005_storage.sql grants org members select/insert/DELETE by org
prefix — a member-deletable 3-year evidence store is a contradiction, and org-prefix select lets
any driver read every document). Hazmat bucket: **insert only** for authorized writers, **no
client select, no client delete**; documents are served exclusively through API-issued signed
URLs (route enforces the H4 role matrix), and deletion happens only via a service-role
**retention job** (new deliverable, H11 runbook: purge originals after the 3-year window,
audit-logged). **Unlike receipts, originals are kept full-resolution**
(extraction quality + legal evidence — G6): client uploads a display WebP *and* the original
JPEG (`.orig.jpg` suffix, same key stem). Retention: 3 years (matches longest paper-retention
duty + dispute window; configurable per org later). Storage cost accepted (~1–2 MB × pages —
see Business §costs).

**API routes** (`apps/api/src/routes/hazmat/`, **mounted at `/api/hazmat/*`** — NOT `/hazmat/*`:
app.ts mounts all routers under `/api`, keys both rate limiters to `/api` paths, and its SPA
history fallback serves index.html for everything else, so a bare `/hazmat/*` mount would collide
with the H5 web routes and bypass rate limiting entirely. `/analyze` additionally gets the
existing `strictLimiter` treatment like `/api/ai`, since it is model-spend-bearing. Zod contracts
live in `packages/shared/src/hazmatApi.ts` + `src/hazmatPolicy.ts`, re-exported from the shared
barrel `src/index.ts` per repo convention — app-layer DTOs live in `shared`, NOT in `@hazmat/*`,
preserving the boundary):
`POST /hazmat/loads` · `GET /hazmat/loads?status=` (keyset-paginated) · `GET /hazmat/loads/:id`
· `PATCH /hazmat/loads/:id` (draft only) · `POST /hazmat/loads/:id/documents` (returns signed
upload URL + registers row) · `POST /hazmat/loads/:id/analyze` (manual or after capture; enqueues
job; 202 + run id) · `POST /hazmat/loads/:id/review` (field confirm/correct → re-run) ·
`POST /hazmat/loads/:id/clear` (attestation payload required) · `POST /hazmat/calc` (stateless
placard calculator: `LoadInput`-minus-dataset in → `Verdict` out; also the future licensed-API
surface, H12) · `GET/PUT /hazmat/policy`.
**Analysis execution model (corrected against source — the "jobs worker" is NOT a queue):**
`worker.ts` is a single-replica *scheduler host* and `0027_jobs.sql` is a job **ledger** (no
payload, no retry columns, and a partial unique index allowing only ONE active `(org_id, kind)`
row — using it as a per-load queue would serialize an org to one analysis at a time and no
consumer exists to pick rows up). Therefore: **analysis runs in-process in the API** via an
`analysisOrchestrator` service — `POST /analyze` returns `202 {runId}` immediately, executes
async in the same process (concurrency-limited semaphore, e.g. 4 concurrent per instance),
owns its own retry policy (extraction pass retries ×2 with backoff; terminal failure →
`extraction_failed` flag per the outcome table), re-checks entitlement at execution start, and
records progress/results ONLY in `hazmat_runs` + load status — **never in `jobs` rows** (their
org-wide `jobs_select` RLS would leak run errors to all members; `jobs` is used solely for the
H11 eCFR-poller scheduler, which fits its one-active-per-kind semantics). This is adequate at
pilot scale; a dedicated queue is a documented post-pilot upgrade if H11 load-testing demands it.
The orchestrator (minus extraction) is built HERE in H4 so the manual path (H5) uses the same
run/outcome machinery — H6 plugs extraction passes into it.

**Tests.** RLS matrix extension for all new tables × roles × {own,other} org through the client
SDK; contract tests per route; immutability tests (update attempts fail).

**Exit criteria.** Load CRUD + document registration works end-to-end via API against local
Supabase; RLS matrix green; `POST /hazmat/calc` returns a verdict using dataset v1.

**Verification.** *Sanity:* immutable runs/reviews are what make the audit trail trustworthy.
*Codebase:* confirmed existing infra reused — client-generated UUIDs (02 §10.2), the jobs
ledger's real semantics respected (0027 — scheduler-only; analysis is in-process by design), keyset pagination (01 §9), storage RLS pattern, `version` columns. Migration numbers
assigned at build time (0079+ as of writing). Trailer FK: `trailers` table exists (0030);
confirm exact name/PK in migration. *Goals:* G2 (async analyze ≤60 s), G6 (evidence chain), D6
(reviewer roles).

---

## Phase H5 ☐ — Manual UI: placard calculator + load workspace

**Objective.** Full product value with zero AI: dispatchers build/declare loads by hand and get
verdicts. This hardens the engine against real use before extraction exists, and remains forever
as the fallback path and the sales demo.

**Deliverables.**
1. `features/hazmat/` pages (Tailwind UI v4 components, existing app shell):
   - **Placard Calculator** (`/hazmat/calculator`): product picker (curated `fuelProducts.json`
     overlay + full HMT search by UN number or name), per-compartment quantities, tank state,
     business-day IDs → renders required placards as visual placard graphics (SVG set built once for
     all placard designs), ID-display instruction ("1203 on each side and each end — orange panel
     or on placard"), optional substitutions, prohibited list, ERG guides, and the full citation
     trace behind a "why?" expander per item. Stateless (calls `POST /hazmat/calc`).
   - **Load Workspace** (`/hazmat/loads`, `/hazmat/loads/:id` — web routes; API is under
     `/api/hazmat/*`): create load → pick vehicle/trailer/driver (existing fleet data) → declare
     lines manually (same pickers) → **manual context fields: tank state, carrier relationship,
     previous/current-business-day IDs** (plain inputs in this phase; H8 later adds computation,
     org defaults, and pre-fill — without them here, every H5 load would flag on unknown context
     with no review queue built yet) → run analysis → verdict panel: BOL findings grouped by
     tier with citations, eligibility verdict, placard set, segregation warnings. Status chip per
     `hazmat_load_status`. Loads that flag anyway are **view-only until H7 ships the review
     queue** (state machine allows it; nothing can clear them — acceptable within this phase).
2. Placard SVG library: all Table 1/Table 2 placard designs + GASOLINE/FUEL OIL wordings +
   orange panel + white square-on-point, each parameterized by ID number. Lives in
   `packages/ui` (it's brandable product UI, not engine).
3. **Cargo-tank profile CRUD** (`/hazmat/settings/equipment` or embedded in trailer/vehicle
   forms): capacity + compartment plan per trailer/straight-truck → `hazmat_cargo_tank_profiles`
   (H4). The load workspace requires a profile (or an explicit "capacity unknown" choice, which
   the engine treats conservatively per H2) before analysis.
4. Empty-state + entitlement-gated nav ("Hazmat" section appears only with `hazmatguard`).

**Decisions.** Manual line entry always resolves against the dataset **before** submission —
free-text products are impossible in the UI (unknown product = can't be added = fail-closed at
the source). Quantity units restricted to the engine's set. The calculator is public-demo-able
later (H12 marketing) but v1 ships behind login.

**Tests.** Component tests for calculator state; Playwright e2e: create load → declare
gasoline+diesel split → verdict shows FLAMMABLE + 1203 with §172.336(c)(5) citation; a second
e2e for residue tank keeping placards.

**Exit criteria.** Miki can run the 12 §B.6 trap scenarios through the calculator UI and every
answer matches the golden suite (same engine — this is a UI-wiring check, and doubles as the
first user-acceptance pass on explanation quality).

**Verification.** *Sanity:* shipping value before AI de-risks the whole program. *Codebase:*
features/ boundary, packages/ui, Tailwind templates, Playwright config all exist. *Goals:* G4
(citations in UI), business goal "sellable demo early".


---

## Phase H6 ☐ — Extraction service (photo → validated BolFields)

**Objective.** The only AI in the system, wrapped in enough independent checks that a wrong read
cannot silently pass (D1/D2).

**Pipeline (service `apps/api/src/services/hazmatExtraction/`, invoked by the H4 in-process `analysisOrchestrator`):**
1. **Usability gate** (before any model call): server-side image checks — resolution floor
   (min 1200 px long edge), blur (variance of Laplacian, threshold tuned on corpus), glare
   (specular highlight area %), skew estimate. Fail → `quality.usable=false`, load flagged
   `recapture_needed` with the specific reason, no extraction attempted.
2. **Pass A**: pinned Claude Sonnet vision model (env `HAZMAT_MODEL_A` — added to the Zod
   `EnvSchema` in `apps/api/src/env.ts` with a pinned default, per the repo rule that ALL env
   goes through `loadEnv`; note the shipped AI layer keeps model strings in code + org tier
   columns — hazmat deliberately env-pins instead, because verdict reproducibility requires the
   exact model ID on every run), structured output =
   `BolFieldsExtraction` (BolFields + per-field `{confidence: 0..1, bbox}` + per-line
   `sourceRowBbox`). Temperature 0. Prompt renders the document ONLY as data; all text from the
   photo is untrusted (prompt-injection discipline from 07 §8).
3. **Pass B**: pinned second model (env `HAZMAT_MODEL_B`, launch value = Claude Haiku latest),
   independent prompt wording, same schema. (Same-family caveat is accepted at launch because
   passes are advisory to *agreement*, while the decisive independent check is step 4; an
   external-vendor pass (e.g., cloud OCR) is an H11 upgrade decision informed by corpus metrics.)
4. **Deterministic cross-validation** (code, not AI):
   a. **HMT tuple check** per line via `resolveHmtLine()` — the locked algorithm spec below.
   b. **Agreement check**: passes A and B must agree exactly on safety-critical fields
      (id numbers, PSNs, classes, PGs, quantities+units, per-line association, ER phone digits,
      certification presence); non-critical fields (shipper name spelling…) tolerate divergence.
   c. **Arithmetic**: line quantities vs printed totals (when totals present); package-count ×
      per-package weight = extended line weight (resolves ambiguous handwriting: a glyph that
      could be "2" or "D" is confirmed by 627# × 2 = 1,254); gallons vs compartment capacities
      (vehicle known); page count complete (`1 of N` → N docs present).
   c2. **Pre-printed catalog lines** (verified real-world pattern — shipper templates list every
      product they ever ship; only lines with handwritten counts + weights are aboard): a line
      with NO unit count AND NO weight is classified `preprinted_line_not_loaded` — surfaced in
      driver/review UI as a one-tap confirmation ("these N listed products are NOT on board —
      correct?"), not a hard flag; confirmed-not-loaded lines are excluded from the verdict but
      **still resolved against the HMT** (a PG/ID error on a dormant template line is reported
      as a `warning` to the shipper-facing report — template errors become live violations the
      day a quantity is handwritten in). A line with a count but no weight, or vice versa →
      normal flag. Loads with unconfirmed catalog lines never auto-clear.
   d. **Declared-vs-extracted reconciliation**: when the load has `declared_lines` (dispatcher
      path), every extracted line must match a declared line on (idNumber, psn, pg) and quantities
      within 2%; any unmatched line in either direction → flag `declared_extracted_mismatch`.
      When `declared_lines` is empty (driver self-created), this check is skipped and the load
      NEVER auto-clears (see outcome table) — a human confirms lines instead.
   e. **Policy plausibility**: extracted products ⊆ policy-allowed products (soft — flags, never blocks extraction itself).
5. **BolFields → LoadInput mapper** (deterministic code, its own unit tests): idNumber+psn+pg →
   `hmtRef` via dataset resolution (already guaranteed unique by 4a); class printed as
   "Combustible liquid" on a Class-3-eligible row → `reclassedCombustible=true` **only when**
   `declared_lines` agrees (the election is the offeror's — D1); disagreement or no declaration →
   flag `reclassification_unconfirmed`. `ethanolPct`/`flashPointF` from `fuelProducts.json`
   overlay via the resolved product (per-line override only from declared lines, never from the
   model). `packagingKind` from vehicle kind + line "1 cargo tank" packaging text; quantities
   normalized to engine units. Every mapped field carries provenance (`extracted`|`declared`|`dataset_default`)
   stored in the run — the review UI shows provenance.
6. **Outcome** — locked table (THE auto-clear boundary; any case not listed = flagged). This
   table is OWNED by the H4 `analysisOrchestrator` and applies to **every** run type: for manual
   runs (H5, no extraction) rows 1–3 and the cross-validation row are vacuously green and the
   remaining rows decide; extraction rows activate in H6. A manual run's fields are
   human-entered, which is why the manual path may auto-clear on a green verdict — the human IS
   the extraction:

| Condition (evaluated in order) | outcome | load status |
|---|---|---|
| Usability gate fail | flagged (`recapture_needed`) | needs_review |
| Model API down / retries exhausted / budget exhausted | flagged (`extraction_failed` — reviewer gets manual-entry action) | needs_review |
| Any cross-validation failure (4a–4d) or confidence below threshold | flagged (named field flags) | needs_review |
| Verdict contains any `violation` finding | flagged | needs_review |
| Verdict contains any `conditional` finding | flagged | needs_review |
| `eligibility.status = 'blocked'` | flagged | needs_review (rejection is a human decision, never automatic). **Policy deny-rule blocks additionally: (a) fire an immediate `hazmat.policy_block` notification to dispatcher + safety_manager/admin (existing notification service — this is the "driver is about to load something we don't haul" alarm, so it must be push/immediate, not digest); (b) show the driver a full-screen DO-NOT-LOAD result naming the product and the company rule; (c) may only be overridden by roles listed in policy `policyBlockOverrideRoles` (default: admin only) with a typed reason — a company's own deny rule outranks an ordinary reviewer** |
| Any segregation finding of tier violation | flagged | needs_review |
| Driver self-created load (no declared_lines) | flagged (`lines_unconfirmed`) | needs_review |
| Dataset `provisional` in prod | flagged (`dataset_provisional`) | needs_review |
| Only `warning`/`info` findings + everything above green | **green** | **cleared** (auto) |

   `warning`/`info` findings ride along on cleared loads (visible, non-blocking) — that's what
   tiers are for. H9 advisories never enter this table (separate `advisories` column).
7. Caching (`input_hash` per the H4 definition), token budget, kill-switch (policy
   `extractionEnabled`) — all per the 07 pattern. Kill-switch off → manual entry path only;
   product still fully functions (mirrors the AI-layer independence rule).

**`resolveHmtLine()` — the BOL↔library resolution algorithm (LOCKED SPEC; audited against the
live 172.101 table 2026-07-24).** Lives in `@hazmat/engine` (pure; operates on the injected
`Dataset`; `buildDatasetIndex(dataset)` is exported and the caller memoizes it per dataset
version). Used by the extraction pipeline here and by anything else that must turn
(id, psn, class, pg) text into an `hmtRef`.

*Design doctrine (Fellegi–Sunter / Christen, record-linkage practice for safety-critical
domains): deterministic matching with blocking on the strongest key; near-miss = clerical
review, never a lowered threshold. NO similarity scores anywhere in the accept path — the table
contains real pairs where fuzzy matching confidently picks the wrong product (Heptanes UN1206 /
Hexanes UN1208: PSN edit-distance 2, ID distance 1, identical class 3 PG II; Petroleum crude oil
UN1267 / Petroleum distillates UN1268: adjacent IDs, identical class AND PG set). Fuzzy
similarity may be used ONLY to rank suggestions shown to the human reviewer after a failure.*

Algorithm (every step deterministic; the normalization ruleset is enumerated in code, versioned
as `psnNormalizerVersion`, and stored on every run):
1. **Normalize the ID**: extract prefix (UN/NA) + 4 digits. Prefix is part of the key — UN1993
   and NA1993 are different key spaces. Missing prefix on the paper → try UN then NA; both
   resolving (different entries) → fail `id_prefix_ambiguous`.
2. **Block on (prefix, idNumber)** via hash index → candidate entry set (always a handful; never
   scan PSNs table-wide).
3. **Normalize the extracted PSN**, applying ONLY transformations the regulation itself
   authorizes (§172.101(c)(1)–(2)): casefold; whitespace collapse; singular/plural fold;
   "n.o.s." variant fold (NOS/N.O.S./n.o.s); strip leading shipping-paper modifiers that are
   additions, not name ("Waste", "RQ", "HOT"); strip a trailing parenthetical **only when the
   candidate entry carries the G symbol** (appended technical names are correct usage on
   G-entries — but parentheticals are load-bearing elsewhere: "Fuel oil (No. 1, 2, 4, 5, or 6)"
   and UN3475's "with more than 10% ethanol" qualifier must NOT be stripped). NO stemming, NO
   word dropping, NO edit distance.
4. **Match within the candidate set** against `HmtMatchRecord.normalizedPsn` (alternates are
   separate records). Exactly one entryId → continue; zero → fail `psn_no_match` (reviewer sees
   fuzzy-ranked suggestions); >1 entryId → fail `psn_ambiguous`.
5. **PG check — conditional, not mandatory**: if the entry's pg-rows are `[null]` (Class 2
   gases), a PG on the paper is itself the violation (H3 rule) and no PG agreement is required.
   If the entry has one pg-row, extracted PG must equal it (null extracted → conditional
   finding, resolution proceeds). If multiple pg-rows (UN1268, UN1863, UN1987...), the extracted
   PG selects the row; null extracted PG → fail `pg_required_ambiguous` (PG legally required on
   the paper for these).
6. **Class check — normalized comparison**: accept plain ("3"), subsidiary notation ("3 (6.1)")
   matched against class+subsidiaryClasses, and **"Combustible liquid" as satisfying class for a
   Class 3 PG III entry when the reclassification election is confirmed** (§173.150(f); feeds
   the H6 §5 `reclassedCombustible` mapper rule). Any other mismatch → fail `class_mismatch`.
7. **Output**: `hmtRef = { entryId, pg }` + the matched alternate + normalizer version. Any
   failure at any step → the line fails cross-validation → `needs_review` per the outcome table.
   D-symbol and I-symbol entries are both accepted for domestic loads — never report ambiguity
   the ID already resolves.

*Performance (the "fast" requirement, measured not assumed):* all indexes are hash maps built
once per dataset version (`buildDatasetIndex`: ~10⁴ records, <100 ms build, memoized);
per-line resolution is O(candidates) ≈ O(1), budget **<1 ms per line, <10 ms per BOL** on the
API instance; a CI benchmark asserts the budget so a regression fails the build. No network, no
DB in the path.

*Tests specific to this algorithm (in addition to H2/H3 goldens):* the named adversarial pairs
as permanent fixtures — 1202↔1203, 1203↔1230 (transposition→methanol), 1267↔1268, 1206↔1208,
1075↔1073, 1978↔1971 — each asserting the misread fails rather than cross-matching; a
**mutation sweep**: every fuel-product PSN and ID mutated by 1 character (all positions) must
either still resolve to the SAME entry (pure normalization equivalence) or FAIL — zero
wrong-entry resolutions tolerated, run in CI; alternate-name coverage (every 'or'-alternate of
every fuel entry resolves to its entry); D/I duplicate acceptance (NA1993 "Diesel fuel" and
UN1202 "Diesel fuel" both resolve, distinctly); G-entry technical-name acceptance
("Flammable liquids, n.o.s. (xylene)" resolves to UN1993).

*Known limitation (accepted, documented):* trade names on BOLs ("Jet A", "ULSD", "87 octane")
are NOT PSNs and never match — the H3 rule for a missing/invalid PSN fires instead; the curated
`fuelProducts.json` may carry a trade-name synonym list used ONLY for review-UI suggestions and
the `ethanol_blend` code list, never for auto-resolution.

**Confidence thresholds (initial, recalibrated in H11 from corpus data — thresholds live in one
config file, never inline):** critical fields < 0.98 → review; non-critical < 0.90 → review;
any handwriting-classified critical field → review regardless of stated confidence.

**Corpus harness.** `apps/api/test/hazmatCorpus/` — a runner that executes the full pipeline
(mocked models replay recorded responses; live mode behind env flag) over the ground-truth corpus
(started in this phase with Silvicom's 20 transcribed BOLs from H3 + every new photo collected in
H10/H11, target ≥ 200 by launch), reporting: field accuracy, review rate, and **silent-error
count (must be 0 — the release-blocking metric)**.

**Tests.** Unit: each cross-validation check with crafted failure fixtures (misread digit lands
on wrong-HMT-row; row-swap between lines; quantity total mismatch; low-res image). Integration:
pipeline on 5 fixture photos end-to-end with recorded model responses.

**Exit criteria.** Corpus harness runs green on the starter corpus with 0 silent errors; a
deliberately corrupted photo produces `recapture_needed`; a deliberately mis-associated fixture
(gasoline gallons on diesel line) is caught by tuple/arithmetic checks.

**Verification.** *Sanity:* the decisive checks (HMT tuple, arithmetic) are deterministic — model
choice cannot weaken them. *Codebase:* orchestrator execution (H4), model pinning via validated env, budget + cache + kill-switch
mirroring the shipped `aiVerification` service. *Goals:* G1/G2/D2; success-criteria metrics defined
and mechanically measurable from day one.

---

## Phase H7 ☐ — Review queue & attestation

**Objective.** The fail-closed workflow where humans resolve flags — designed so reviewing is
faster than re-reading the BOL.

**Deliverables.**
1. **Queue** (`/hazmat/review`): loads in `needs_review`, sorted oldest-first, filter by
   flag type/vehicle/driver; badge count in nav. Modeled on the anomaly queue UX users already know.
2. **Review screen** (the core): left = document image (zoom/rotate); right = flagged items
   only, **ordered per the expert audit flow (D11/H3 Deliverable 0) — the reviewer works the
   flags in the same sequence a veteran auditor works a BOL**, each showing: extracted value,
   the **cropped image region** (bbox) as visual evidence,
   both passes' values when they disagreed, the machine reason, and actions
   **Confirm / Correct / Can't read**. Confirmed/corrected fields re-enter the pipeline
   (new run: cross-validation re-executes with human values marked `human_verified` — they skip
   agreement checks but still hit HMT tuple + arithmetic; a human typo that breaks HMT resolution
   re-flags rather than passes, preserving D2). "Can't read" on a critical field → `rejected`
   with reason `illegible_document` + driver notified to recapture. An `extraction_failed` flag
   presents a **"Enter fields manually"** action (pre-filled with whatever passes produced) so the
   review path degrades gracefully to the manual path when models are unavailable.
3. **Clearing**: when a run is green (or all flags human-resolved), reviewer sees the full
   verdict + placard graphics and must click **"I attest I am trained under 49 CFR 172 Subpart H
   and have reviewed this assessment"**. Special-permit deviations additionally require the
   dedicated SP attestation ("I have read DOT-SP ____ and confirm it covers this deviation for
   this shipper/carrier") with the permit document displayed alongside — an SP-based load can
   NEVER clear on the standard attestation alone (exact string stored in `hazmat_reviews.attestation`, D8).
   Only then `status='cleared'`. **Override** (clearing despite a `violation` finding) requires a
   typed reason ≥ 20 chars, writes `action='override'`, and is surfaced in the H12 compliance report and per-load audit bundle — possible because the customer owns the duty (D6), loud because we must be able to
   prove we flagged it.
4. Driver/dispatcher notification hooks into the existing email/notification service (Phase-8
   infra): flagged → assigned reviewers; cleared/rejected → submitting driver.

**Tests.** Playwright: full journey — submit fixture load → flag → confirm one field, correct one
field → re-run → green → attest → cleared; override journey with audit assertion; RLS/role test
that a driver cannot access review routes.

**Exit criteria.** Median simulated review time for a 2-flag load < 90 s (measured in e2e with
realistic fixtures); every review action visible in `audit_logs`.

**Verification.** *Sanity:* human values still pass deterministic checks — review can't become
the silent-error backdoor. *Codebase:* anomaly-queue patterns, notification service, audit
actions list extended (H4). *Goals:* D2, D6, D8, G3 (review speed is what makes low review-rate
tolerable), G6.


---

## Phase H8 ☐ — Company policy & trip context

**Objective.** The inputs that rules need but photos can't provide — modeled, defaulted, and
surfaced so nothing is silently assumed (the "facts outside the photo" problem from research).

**Deliverables.**
1. **Policy settings UI** (`/hazmat/settings`, admin-only): allowed classes (checkbox grid of
   **Table 2 classes/divisions only — Table 1 classes are rendered disabled with "not supported
   in v1"; they cannot be enabled, matching the engine's hard gate, D4-revised**),
   allowed/forbidden product lists (HMT-resolved pickers; Table 1 products excluded from the
   picker), max PG, per-vehicle/trailer overrides, and a **"We don't haul" deny-list builder**:
   add rules as class/division + optional PG + optional specific product, each with an optional
   reason note ("insurance", "no tank washouts", …), rendered as red chips; the UI states the
   precedence rule plainly ("deny always wins over allow") and previews example products each
   rule catches. Changing the deny list re-evaluates nothing retroactively (verdicts are
   immutable) but applies to every load analyzed afterward. Writes `hazmat_policies.policy` (Zod `OrgHazmatPolicy`).
   Default policy on entitlement grant: **deny-all** — an org must explicitly configure what it
   hauls before any load can be eligible (fail-closed onboarding; a wizard offers a "fuel hauler
   starter set" = the curated fuel products). The wizard also shows a **Subpart I advisory +
   attestation** (49 CFR 172.800(b): a security plan and security training are required for
   "large bulk quantity" loads — >792 gal in a single packaging — of Division 2.1 or Class 3
   PG I/II, i.e., essentially every gasoline or propane cargo-tank load this product targets):
   "Confirm your company maintains the required security plan" — recorded, not verified; a
   product claiming "every load pre-checked against 49 CFR" cannot be silent on an obligation
   attaching to ~100% of its customers' loads.
2. **Carrier relationship**: org-level default (`organizations`-adjacent setting stored in
   `hazmat_policies.policy.carrierRelationshipDefault`) + per-load override field in the load
   form. Drives the H3 certification-rule tier. UI copy explains the distinction in plain words.
3. **Tank state & trip context capture**: load form requires tank state (`loaded` /
   `residue_uncleaned` / `cleaned_and_purged`); per-trailer **last-contained memory** — on load
   clearing, the trailer's `last_hazmat_contents` (jsonb on trailer row or a small
   `hazmat_trailer_state` table if trailers schema shouldn't grow — decide in-migration) is
   updated; next load on that trailer pre-fills residue context and **cross-checks**: declaring
   `cleaned_and_purged` when yesterday's load was gasoline surfaces a `conditional` finding
   ("confirm cleaning/purging occurred — placards must remain otherwise, §172.514(b)").
   Business-day ID list (§172.336(c) table, business-day row): computed from the org's
   **submitted-or-later** loads (not cleared-only — trucks move in shadow mode and before
   adoption) for that vehicle/trailer across the **previous AND current business day** (the
   regulation's actual window; a since-midnight window would falsely demand ID changes on the
   common overnight gasoline→diesel case) in org tz (`operating_hours.tz`), then **confirmed by
   the driver** in the capture flow ("Yesterday/today this trailer hauled: 1203 — correct?" with
   an "also hauled something else" escape). Driver-confirmed → `previousOrCurrentBusinessDayIds:
   string[]`; unconfirmable (no data, driver unsure) → `null` → the engine's conditional finding
   path (H2). Ethanol-blend IDs are excluded from retention by the engine's hard rule regardless
   of what this list contains.
   The same submitted-or-later basis feeds trailer last-contained memory, with the same
   driver-confirmation prompt when history is absent (paper-era trailers).
4. **Driver hazmat endorsement**: migration adds `drivers.hazmat_endorsement_expires_at date`
   (null = unknown). Eligibility emits `driver_endorsement_missing_or_expired` (**conditional** —
   forces review; it's DMV data we don't verify) — **citation: 49 CFR 383.93(b)(4) + §383.5**
   (H endorsement required for vehicles hauling placard-required hazmat) — and therefore fires
   **only when the engine's verdict actually requires placards** (a legitimately placard-free
   load, e.g. non-bulk reclassed combustible, needs no endorsement; firing on mere hazmat
   presence over-flags). Settings UI: endorsement date on the driver form + 30-day expiry
   reminder via the existing notification service.
5. Segregation pre-check in the load form: adding a second product runs eligibility+segregation
   live (calc endpoint) before submission.

**Tests.** Policy deny/allow matrix; trailer state machine (loaded→residue→cleaned) across three
sequential loads; business-day ID computation across the previous/current business-day boundary in org tz; certification tier
flips with relationship setting.

**Exit criteria.** The two research scenarios that *cannot* be answered from a BOL alone —
(a) residue placarding, (b) business-day lowest-flash-point ID retention — produce correct, cited
verdicts using only data the system now captures.

**Verification.** *Sanity:* every engine input in H2's `LoadInput` now has a defined producer —
no orphan inputs (checked item-by-item: `hmtRef` → pickers (H5) / mapper (H6 §5);
`reclassedCombustible` → product-picker variant (manual) / declared-lines-confirmed mapper rule
(photo); `vehicle.*` → cargo-tank profiles (H4 table, H5 CRUD); `flashPointF`/`ethanolPct` →
`fuelProducts.json` defaults + declared-line overrides (H1/H6); `quantity`/`grossWeightLb` →
form / extraction; `tankState` → form + trailer memory (this phase); `previousOrCurrentBusinessDayIds` →
computed + driver-confirmed (this phase); `carrierRelationship` → settings default + per-load
override (this phase); `policy` → settings (this phase); `dataset` → `@hazmat/data` (H1);
`evaluatedAt` → API clock). *Codebase:* trailers exist (0030+), org tz exists,
settings-page patterns exist. *Goals:* closes the "confidently wrong without context" gap; D2.

---

## Phase H9 ☐ — Securement & placard-photo verification

**Objective.** The photo-checklist module, honestly scoped (no 393-certification claims), plus
the closing-the-loop feature: verifying the *actual truck* shows the *computed placards*.

**Deliverables.**
1. Required-photo checklist per load, configurable per org (default for cargo tanks:
   left side, right side, rear, front/tractor placard, hose tray, dome/valve area). Driver flow
   (H10) enforces capture of each angle.
2. **Placard verification** (vision, Pass A model): for each side photo — placards detected
   (design + wording + legible ID number) → compared in code against the verdict's required set →
   `match` / `mismatch(details)` / `not_assessable(reason)`. Results are **advisories**
   (`hazmat_runs.advisories`, H4) — rendered prominently in load detail and review, but they never
   change load status at launch (that's exactly the H4 flags-vs-advisories split). When an org
   enables `placardMismatchBlocks` (H11+, precision proven), mismatch is promoted to a blocking
   flag. Never auto-fails the driver: `not_assessable` prompts recapture, not a violation.
3. **Securement checklist assist** (cargo-tank v1): binary detectors — hoses stowed, dome lids
   appear closed, no visible leak/sheen on shell/ground. Each returns yes/no/not_assessable +
   evidence crop. Output is labeled "visual pre-check — does not replace the driver's inspection"
   (49 CFR 392.9 duty stays with driver/carrier).
4. All results stored on the run (same immutability), shown in load detail + review.

**Decisions.** Detection verdicts NEVER block clearing on their own at launch (advisory tier;
org can opt into "placard mismatch blocks" once precision is proven in H11 — a policy flag,
default off). No tiedown/WLL math claims anywhere in UI or marketing (17 §7 scope).

**Tests.** Fixture photo set (staged photos of Silvicom trucks: correct placards, wrong placard,
missing placard, obscured) → expected outcomes; not_assessable on night/blurred shots.

**Exit criteria.** On the fixture set: zero false "match" on wrong/missing placard photos
(false-positive match is the dangerous direction); ≥ 80% match-rate on correct-placard photos
(rest may be not_assessable — acceptable).

**Verification.** *Sanity:* asymmetric error budget (false-match = 0) encodes the safety
direction. *Codebase:* same model plumbing as H6. *Goals:* differentiator feature (17 §7),
honest-scope liability posture (D8).

---

## Phase H10 ☐ — Driver capture (mobile web)

**Objective.** Drivers submit everything from the cab in under 2 minutes, on the existing web
app (D7), with the API contract that the future native app will reuse unchanged.

**Deliverables.**
1. Mobile flow `/hazmat/submit` (driver role): pick load (dispatcher-created) OR self-create
   (org policy flag `driversMayCreateLoads`, default on) → **pickup questions incl. "Did the
   shipper say this load needs no placards?" (sets `claimedExceptions`) and "Is this load coming
   from or going to a port/vessel?" (sets `portContext.vesselConnected` — one tap; it flips the
   marine-pollutant and IMDG exception regimes, H2 steps 11–12); the flow **encourages a
   pre-load check**: "Scan the BOL BEFORE loading starts" is the coached default, so a policy
   deny-rule block fires while the product is still on the dock — the DO-NOT-LOAD screen +
   instant dispatcher/safety notification (H6 outcome table) exist precisely so an accidental
   "we don't haul this" pickup is caught before the trailer doors close, not in a review queue
   after departure; a YES immediately
   coaches the driver at the dock: "Ask the shipper for the DOT-SP special permit number and
   photograph the permit — without it, this claim is not verifiable and you may be placed out
   of service"** (the D11 field case: resolve it at the dock in minutes, not at roadside in 3
   hours) → guided special-permit capture when applicable (own doc kind; extraction reads the
   SP number, grantee, and **expiration date** — expired permit → violation flag; grantee not
   matching the shipper/carrier → conditional) → guided BOL capture (frame overlay,
   live blur/glare hinting via canvas checks, page-by-page for multi-page, auto-crop preview,
   retake loop) → securement checklist angles (H9 list, one screen per angle with example
   silhouette) → confirm tank state + relationship prompts (H8, pre-filled) → submit → live
   status (extracting → verdict/flags) with plain-language result: green "Cleared — placards:
   [graphics]" / flagged "Sent to review — you'll be notified" / recapture instructions naming
   the exact problem ("page 2 too blurry — retake"). Any stored special-permit document is
   **available offline in the driver's load view** — at a roadside inspection the driver shows
   the officer the permit in seconds (this, plus the SP number verified on the BOL, is the
   entire point of the feature).
2. Client-side capture quality pre-check mirrors the H6 server gate thresholds (shared constants
   in `packages/shared`) so most bad photos never upload.
3. **API contract freeze for native app**: the endpoints used by this flow (H4 set + signed
   uploads) are documented in `packages/shared/hazmatApi.ts` with a CONTRACT.md; the native app
   (future, out of scope) must need zero new endpoints — review this explicitly at phase end.
4. Offline-tolerant: photos persist in-browser (IndexedDB) until upload completes; submit is
   idempotent (client-generated load/doc UUIDs).

**Tests.** Playwright mobile-viewport e2e of the whole flow; upload-interruption resume test;
role test (driver sees submit, not review).

**Exit criteria.** A real phone, in the yard, submits a real BOL + 6 photos in < 2 min on LTE;
the load reaches a verdict; Miki performs this test personally.

**Verification.** *Sanity:* capture quality is the #1 real-world failure driver (research:
Transflo/arXiv) — this phase is where precision is won or lost operationally. *Codebase:* web
app is mobile-responsive by design (00 §6), drivers have logins, storage upload path exists.
*Goals:* D7, G2, G3 (good capture ⇒ low review rate).


---

## Phase H11 ☐ — Hardening & shadow pilot

**Objective.** Prove the §2 success criteria on real loads before anything can block a truck.

**Deliverables.**
1. **Shadow mode** (policy field `enforcement: 'shadow'|'active'`, default shadow — H2 registry): the full
   pipeline runs on every real Silvicom hazmat load for **≥ 4 consecutive weeks**; verdicts are
   recorded and shown to Miki/safety staff but nothing blocks dispatch. Weekly metrics review:
   review rate, flag reasons ranked, extraction accuracy vs human-verified truth, silent errors
   (target 0), time-to-verdict.
2. **Calibration loop**: every false flag → either a threshold/config change or a golden-suite
   addition (a false flag is a missing calibration test by definition). Every human correction →
   corpus ground truth. Confidence thresholds re-derived from corpus ROC at week 3.
   **Known shadow-mode caveat (accepted):** trip-context inputs (business-day IDs, trailer
   last-contained) are only as complete as submitted loads — during shadow the driver-confirmation
   prompts (H8) carry the weight; measure how often drivers correct the pre-fill as a data-quality metric.
3. **Shadow validator decision (D5 part 2)**: trial Labelmaster DGIS (or equivalent) against a
   sample of engine verdicts; document agreement; decide keep/drop with cost in Business §.
   Decision recorded in this file.
4. **External-OCR pass decision**: from corpus metrics, decide whether to add a non-Anthropic
   Pass C (cloud OCR) for critical-digit corroboration; record decision + rationale here.
5. **Ops runbook** (`docs/hazmat-RUNBOOK.md`): reg-update watch duty (weekly eCFR poll job now
   scheduled + Federal Register PHMSA alert subscription; SLA: human review of any change within
   **5 business days**, emergency same-day path for immediately-effective rules); model-version
   upgrade procedure (corpus must pass first); dataset release checklist; incident procedure
   ("customer reports wrong verdict": freeze nothing, delete nothing, reproduce from the stored
   run, root-cause, add a golden test, notify affected orgs — template letter included).
6. Load-test: 50 concurrent analyses through the in-process orchestrator (semaphore-limited per instance; verify queue-wait stays within G2's 60 s or scale API instances / revisit the post-pilot queue upgrade); token-cost report per load.
7. **Go/no-go review** against §2 success criteria, written into this file with numbers.

**Exit criteria.** 4-week metrics meet §2; runbook exercised (one simulated reg change + one
simulated wrong-verdict incident end-to-end); go decision signed by Miki.

**Verification.** *Sanity:* nothing enforces until measured reality says so. *Codebase:*
schedulers/jobs/notifications all exist. *Goals:* literally the measurement of G1–G6.

---

## Phase H12 ☐ — Productization (HazmatGuard)

**Objective.** The same codebase sells three ways (D3): module in FuelGuard, standalone
HazmatGuard, engine-as-API.

**Deliverables.**
1. **Branding layer**: a `product` config resolved at runtime per org (name, logo, palette
   tokens, support email) — `entitlements=['hazmatguard']` orgs get HazmatGuard chrome, both →
   combined suite chrome. One deployment serves both (no fork); a dedicated
   HazmatGuard domain fronts the same Railway services (Caddy/host-based product default).
2. **Standalone onboarding**: signup→org→policy wizard flow that never touches FuelGuard
   concepts (vehicles/trailers optional-minimal: a load can reference a free-text unit when the
   org has no fleet module). Migration in this phase: `hazmat_loads.unit_label text` fallback
   (`vehicle_id` is already nullable in the H4 DDL — the new work is `unit_label` + a check that
   at least one of the two is present).
   **Standalone parity requirement (prevents a permanent flag-storm for door-2 buyers):** every
   context input that fleet records normally feed must have a fleet-free producer, or the
   outcome table flags every load forever and G3 dies for exactly the standalone product:
   `hazmat_cargo_tank_profiles` gains `unit_label text` as an alternative key (constraint becomes
   "exactly one of trailer_id / vehicle_id / unit_label"); business-day IDs and last-contained
   memory key on the same unit_label; endorsement dates attach to standalone driver records
   (drivers table exists without the fleet module). Where a lite org still lacks data, the
   driver **one-tap confirmations** (H8/H10 prompts) are the producer of record — the wizard
   sets these prompts on by default for standalone orgs.
3. **API productization (door 3, deferred-but-prepared)**: `POST /hazmat/calc` gets API-key auth
   (separate from user JWTs), per-key rate limits + usage metering rows; NOT publicly sold yet —
   packaging/pricing decision in Business §. OpenAPI doc generated from the Zod contracts.
4. **Compliance reporting & audit bundle** (the renewal lever and the H7 forward-reference
   target): per-org report — loads analyzed, violations caught pre-dispatch, flags by type,
   overrides with reasons and reviewers, review-rate trend, dataset versions in effect — plus a
   per-load **exportable audit bundle** (images, extraction, verdict with citations, reviews,
   attestations) for insurers/DOT audits; and a public "current dataset version + effective
   date" trust page.
5. Marketing site content for HazmatGuard (see Business § for claims guardrails) + the placard
   calculator as a gated demo.
6. Trademark/name clearance completed BEFORE any public use (Business §legal).

**Exit criteria.** A fresh org onboards into standalone HazmatGuard, configures policy, runs the
calculator, submits a manual load — with FuelGuard entitlement absent and no broken surfaces;
Silvicom org sees both products cleanly.

**Verification.** *Sanity:* branding is config, never code paths inside the engine. *Codebase:*
multi-org + platform-admin infra already exists (0070–0073); Railway multi-service deploys exist.
*Goals:* D3; business doors 1–3.

---

## Business & GTM track (parallel — owner: Miki; items blocking a phase are marked)

**Positioning & claims (blocks H12 marketing).** Product promise: *"Every hazmat load
pre-checked against 49 CFR before the wheels roll — flagged problems come with the regulation
text that proves it."* NEVER claim: "guaranteed compliant", "replaces training", "DOT-approved".
ALWAYS: "decision support for hazmat-trained personnel". These rules bind website, sales decks,
and in-app copy; legal review of final copy before publication.

**Legal package (blocks H11 pilot with any external org; internal Silvicom shadow needs none).**
Terms: customer retains offeror/carrier duties (49 CFR 171.2); attestation model documented;
limitation of liability; data retention (3-yr imagery). **Data processing:** customer BOL images
(shipper/consignee names, quantities, commercial terms) are processed by an AI subprocessor —
required before the first external customer: a DPA template, a public subprocessor list
(Anthropic, Supabase, Railway, HERE if applicable), verification of Anthropic's commercial
data-retention terms, and in-app disclosure copy at upload. E&O/professional liability insurance
quote obtained before first external customer. Trademark: knockout search for "HazmatGuard"
("Fleetguard" conflict precedent noted in research) + registration filing; fallback names listed
before H12 starts. Decide company-name umbrella branding at the same time (renaming FuelGuard is
NOT required by this plan; suite structure recommended — sibling products under one platform).

**Pricing (decide during H11; hypotheses to validate in pilot).** FuelGuard add-on: per-vehicle/mo
uplift. Standalone HazmatGuard: per-driver or per-load tiers (fuel haulers think in
trucks; brokers in loads). One org can't A/B a meter — so **recruit 2–3 external design partners
during H11** (legal package permitting), at least one on each meter, before pricing is set.
Engine API (door 3): per-call with volume tiers; **dated go/no-go checkpoint: 6 months after
standalone GA, owner Miki** — decision recorded in this file. A one-page competitive battlecard
(vs Labelmaster DGIS, Hazcheck, manual consultants) exists before H12 marketing. Cost floor per
analyzed load (models + storage) reported by H11 metrics; price ≥ 10× floor.

**Enterprise readiness (blocks the first enterprise deal, not the pilot).** SSO (M365/Google) —
already deferred in the core app; commit it a phase number when the first enterprise prospect
requires it. SOC 2 Type I: decide timeline at first enterprise deal (the audit-first data model
makes this cheaper than usual). Published SLA: uptime target + support response tiers + the
**documented degraded mode** (extraction down → manual entry path keeps the product functional —
write this into the SLA as the resilience story, it's a genuine differentiator).

**Costs & procurement (owner: Miki; blocks H11 go/no-go).** Named budget lines, quotes obtained
during H1–H5 so nothing surprises the pilot: (1) **Hazcheck DGL Data license** (or equivalent
second source) — REQUIRED for production clearing (H1 §6 provisional rule makes this genuinely
launch-blocking; get the quote in H1, sign before H11); (2) Labelmaster DGIS shadow-validator
trial (H11 decision input — trial cost only unless kept); (3) model spend per analyzed load
(2 vision passes + placard photos; measured precisely by H11, budgeted from H6 corpus runs
before that); (4) full-resolution image storage, 3-yr retention (≈ 5–10 MB/load; priced against
Supabase storage tiers at pilot volume); (5) E&O insurance premium; (6) trademark search + filing; (7) **hazmat SME / expert advisor agreement (D11)** — the 15-yr expert working with Miki fills
the independent-authorship + calibration-review role for H2/H3 and the flow-capture work
(Deliverable 0). Formalize it: a simple advisor agreement (scope: flow documentation, scenario
verification, calibration sign-off; compensation: hourly, revenue-share, or advisory equity —
Miki decides; IP assignment of the documented flow to the company; permission to reference her
experience in marketing — "designed with a 15-year hazmat safety veteran" is a legitimate,
claims-guardrail-compatible credibility line). This replaces the generic "contracted SME"
placeholder.
Pricing floor rule (≥ 10× per-load cost) computes from lines 3–4.

**Ops & support.** Reg-watch duty is a named-person responsibility with the H11 SLA. Support
tiering: wrong-verdict reports are SEV-1 with the runbook's incident path. A public
"dataset version + effective date" page builds trust (auditors love it).

**Future revenue/backlog (explicitly out of v1, kept visible):** expert-review-as-a-service tier
(D6 alternative); **Table 1 expansion pack (D4-revised)** — explosives/PIH/radioactive placard
logic + the deferred §172.504(f) interplay + Class 1 compatibility groups; a premium tier for
the specialist carriers who haul it (they exist, they pay more, and the fail-closed gate means
v1 already tells them "not yet" honestly); non-fuel class depth packs (chemicals, gases) — each
is "H3-depth for class X" + golden scenarios; state permit/registration tracking; PHMSA hazmat registration tracking —
**obligation is §107.601 et seq. (filing §107.608; §107.620 is only the carry-proof-on-board
provision), applies to offerors AND carriers, and triggers on any placard-required quantity,
i.e., essentially every load this product clears — near-universal applicability, prioritize
accordingly**; Subpart I security-plan template/assistance (the H8 attestation's natural upsell); driver training-record tracking (Subpart H dates) — natural upsell, small
build; roadside "inspection mode" screen (papers + verdict + ERG + special permits for an officer);
**PHMSA special-permit database auto-lookup** (PHMSA publishes issued SPs — verify number is
real/current/granted to this party automatically instead of by reviewer eyeball) + SP expiry
reminders across an org's recurring shippers; **IMDG/port-drayage expansion pack** — full §171.22–.25
adjudication (IMDG segregation matrix, portable-tank specs, single-port-area mode, IMDG LQ
mark rules, export pre-port completeness incl. §176.27(c) container packing certificate) for
drayage-carrier customers, building on the v1 recognized-context gate (H2 step 12); IATA/IMDG
modes for the API product; Spanish driver UI.

---

## Risk register (top items; mitigations are in-plan)

| Risk | Mitigation (phase) |
|---|---|
| Golden suite self-confirms wrong logic | Independent authorship + mutation checks (H2) |
| Reg change ships late or wrong | Two-source releases, SLA, versioned datasets, poller (H1/H11) |
| Extraction silently wrong | HMT tuple + arithmetic + dual-pass + fail-closed (H6); silent-error metric is release-blocking |
| Review queue too noisy → users bypass/rubber-stamp | Calibration tiers (H3), shadow-mode tuning (H11), review-speed target (H7) |
| Context inputs wrong (tank state lies, relationship mis-set) | Trailer memory cross-checks, conditional findings force the question (H8) |
| Engine correct but UI shows it wrong | e2e trap-scenario UI tests (H5), single rendering path from `Verdict` |
| Legal exposure from a cleared-but-wrong load | Attestation + evidence chain + override visibility (H7), insurance + terms (Business) |
| Model deprecation/behavior drift | Pinned versions, corpus gate on every change (H6/H11) |
| Scope creep into all-hazmat depth before fuel is solid | D4-revised + `out_of_depth_scope`/`table1_out_of_scope_v1` fail-closed findings (H2/H3) |
| Trademark conflict discovered late | Clearance before H12 public use (Business) |
| Data-license terms forbid SaaS embedding / competitive use | Written rights confirmation FIRST in H1; named fallbacks (3E, independent transcription) |
| Expert unavailable / knowledge stays in one head | Flow captured as a written, versioned artifact + traceability matrix (H3 §0) — the document is the asset, not the dependency; advisor agreement secures availability (Business §costs 7) |
| Table 1 load slips through as "unknown product" instead of the explicit block | `blockOnUnknownProduct` already blocks unknowns; golden scenarios assert BOTH paths (recognized-Table-1 → `table1_out_of_scope_v1`, unresolvable → unknown-product block) |
| Regulation restructured → shipped citations go stale | Build-time citation resolver (H1 §3b); catalog fails closed |

---

*End of plan. Keep this file authoritative: update decisions inline (marked D#-revised with
date), tick phase boxes on merge, and record H11 go/no-go numbers directly in §H11.*
