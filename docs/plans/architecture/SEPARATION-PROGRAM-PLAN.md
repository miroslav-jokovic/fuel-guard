# The separation program — raw data apart from harness, everywhere, and finance built on top

**Status: ACTIVE PLAN.** Decision-log document per the house convention; execution protocol is
RECRUITING-SYSTEM-PLAN §4 and it governs every step here. Decision IDs are `D-SEP*`. Written
2026-08-27 from a six-audit measurement of the codebase (seam violations, schema mixing,
un-carved remainder, fleet section, McLeod financial groundwork, authorization machinery).
Where this document and a `lint:*` gate disagree, the gate wins and this file has rotted — fix
the file (same standing rule as `docs/ARCHITECTURE.md`).

**What the owner ruled on 2026-08-27** (verbatim intent, recorded so no session re-litigates it):

1. Raw collected data is separated from harness calculation logic, and that is **a rule for all
   sections**, not a fuel-spend nicety — "we will use this in a couple different purposes, that
   is why it is important we have raw data separated from harness." (→ D-SEP1)
2. **Accounting** and **Billing** become full sections: McLeod-fed, with proper RLS, permissions
   and roles. One new `accountant` role, two new sections. (→ D-SEP6, D-SEP7)
3. **Maintenance** becomes its own separate section in architecture and policies — FleetPal data
   implemented later plus custom features. It is NOT a rename of the Fleet nav group, because
   the audit measured that `features/fleet` contains zero maintenance content (it is roster
   forms + idle analytics). (→ D-SEP8, D-SEP9)

---

## §0 Ground truth (measured 2026-08-27, at `origin/main` = 1466f31, migrations through 0260)

The module carve-out (D-ARC1..4) succeeded as a **code** separation: 17 modules under
`apps/api/src/modules/`, all 39 module→module import pairs resolve through sibling `index.js`,
zero deep-internal imports between modules, no dead `API_ALLOW` entries. It has NOT happened at
the **data** layer, and no gate checks that layer:

- `check-feature-boundaries.mjs` scans only files under `apps/api/src/modules` and only import
  pairs — never table access, never `routes/`, never `services/`, never SQL bodies.
- **537 cross-owner table access sites** (reads+writes, non-test) exist under a green build.
  Worst: `roster`-owned tables touched from 179 out-of-owner sites, `fuel` 124, `org` 89.
- **39 static reads of collector staging tables outside their owning module** + 1 dynamic
  `.from(variable)` site (`apps/web/src/features/import/useImport.ts:84`) that no string-literal
  scan can see. Includes `fuel-spend` reading `efs_transactions`
  (`modules/fuel-spend/fuelSpendRollup.ts:184`) and the browser reading `efs_transactions`
  (`apps/web/src/features/reports/useEfsData.ts:43,128`).
- The **Samsara vendor client (~1,000 lines) lives in `apps/api/src/lib/`**, not the collector,
  with 8 non-collector consumers; its credential writer `lib/samsaraToken.ts` is the sole
  writer of `integration_credentials` (org-owned). `modules/fuel` (core) parses the Samsara
  webhook (`modules/fuel/fuelEvents.ts:15,69,106`) and hosts four fuel-price vendor scrapers.
  EFS report parsing executes **in the browser** via `packages/shared` re-exports
  (`apps/web/src/features/import/useImport.ts:1-15,138-141`).
- Flat `services/` is a **gate-laundering channel**: `modules/samsara/samsaraTrailerSync.ts:12`
  → `services/reeferPairing.ts` → `UPDATE trailers` performs a `samsara → roster` write the
  gate would reject if the file lived in a module. 19 deep-internal imports reach from flat
  `routes/`/`services/` into `efs` and `fuel` internals.
- **Mixed tables carry the raw/derived entanglement.** `fuel_transactions`: 46 columns added
  across 20 migrations, written from 5 modules — Samsara recon evidence (~18 `samsara_*`
  columns), anomaly output (`case_*`, `has_anomaly`, `max_severity`), human dispositions
  (`audit_*`, 0035), dedupe verdicts (`is_canonical`/`duplicate_of`, 0160), enrichment
  (`ambient_temp_f`, `station_id`), plus one **browser** writer
  (`apps/web/src/features/fuel/useFuelLog.ts`, pinned). `vehicles`: ~30 learner-computed
  columns written by three non-owner modules; `0119_tank_capacity_autofix.sql` lets a learner
  overwrite the human-entered `tank_capacity_gal` in place. Same disease in
  `declined_transactions`, `drivers` (HOS cache on master data), `driver_scores` (a Samsara
  cache labelled harness), `idle_park_sessions` (four syncs each own a slice of the row).
- **Rebuildability is broken where the money is.** Wiping `fuel_transactions` to re-derive
  would destroy human verdicts because they share rows. Neither EFS nor Samsara retain
  replayable raw payloads (only 8 tables repo-wide keep a raw blob). The clean reference is
  fuel-spend: `fuelSpendRollup.ts` upsert + `sweepStale()`, humans and machines write different
  columns, `sync_fuel_exceptions` (0250) auto-closes vanished findings.
- **Migrations:** 63 of 258 span more than one module's tables; the ≥6-module tail is almost
  entirely `merge_driver`, re-issued **8 times** (0110, 0155, 0203, 0234–0236, 0238, 0239).
  Only 27 of 118 tables carry `COMMENT ON TABLE`. No table→module→layer manifest exists
  (`scripts/table-writers.json` maps table→writer-file only). ~22 migrations froze one-time
  calculations into the append-only history.
- **Ownership matrix rot** (ARCHITECTURE.md vs measured reality): `compliance` code lives at
  `modules/evidence/dqBinder/` and `dispatch` at `modules/loads/dispatchLoads/` (doc points at
  dead paths); `duty_equipment_segments` is assigned to `samsara` but written only via the duty
  RPCs called from `modules/driver-app/dutySessions.ts`; `driver_authorizations` is assigned to
  `psp` but written only by `recruiting`; `manual-uploads` is a **phantom collector** — no
  `services/import*` exists, `imports` is written by `modules/efs`, `import_rows` has zero
  application references.
- **Finance groundwork:** migration 0257 shipped `financial_entries` + `mcleod_settlements` +
  `mcleod_ap_vouchers` + `mcleod_billing` (dedup-by-design, all deny-all RLS by intent,
  `0257:44-46`), proven by `supabase/tests/financial-entries.test.mjs`. But **no code touches
  any of the four** (four producer waivers, `check-table-producers.mjs:34-37`). The McLeod
  agent's settlement/AP/GL sweeps are print-only reconciliation CLIs
  (`tools/mcleod-agent/{settlements,expenses,ledger}.mjs`) never called by `agent.mjs`; the
  connection model is push (on-prem agent → API bearer token, hash in
  `org_integrations.ingest_token_hash`), and **no billing/AR extraction exists at any layer**
  — not even the SQL query. Shared holds the pure math (`packages/shared/src/tmsCost/`:
  `computeCpm`, `reconcileSettlementToLedger`, `summarizeApSpendByAccount`,
  `buildLedgerCoverageReport`) with **zero consumers in `apps/`**.
- **Authorization machinery:** one org-wide `user_role` enum (7 values; values are
  unremovable — 0210's own header), one role per user per org, JWT-claim based
  (`auth_org_id()`/`auth_role()`, 0002/0006). Capability matrix `SECTION_ACCESS` in
  `packages/shared/src/auth.ts:83-96` (7 sections × 7 roles), kept in lockstep with SQL **by
  hand** (auth.ts:78-81 says so). Two route idioms coexist: matrix-derived
  `requireRole(...rolesThatManage("dispatch"))` vs hand-listed
  `requireRole("admin","fleet_manager","dispatcher")` — the entire fuel-spend surface uses the
  drift-prone latter. `routeAuth.test.ts` asserts 401-unauthenticated only, never role. 32
  tables are deliberate deny-all; web reads **28 tables directly over PostgREST** where RLS is
  the only wall; the driver app is API-only. No finance section, no column-level security, no
  read-audit (4 read-flavoured audit actions repo-wide), `writeAudit` is best-effort.
- **Fleet section:** `apps/web/src/features/fleet/` = 16 files, 2,359 lines: idle analytics
  (~1,152) + roster forms (~1,132). Zero maintenance content anywhere in the repo. Maintenance
  in the product docs means the unbuilt FleetPal collector + McLeod AP repair dollars already
  flowing with unit numbers in free text (FINANCIAL-STORE-PLAN §6 "maintenance arrives twice").
  `/maintenance` URL + route name are taken by the downtime page
  (`apps/web/src/router/routes/system.ts:25-28`). RBAC section `fleet` spans 11 API gate sites
  beyond the nav group; `user_role` value `fleet_manager` is baked into ~20 migrations' RLS
  predicates and is unrenameable.

## §1 Architecture — the target, restated with layers made physical

Same three layers as ARCHITECTURE.md §1, now with the **data plane** included in the contract:

```
COLLECTORS   raw/staging tables, vendor clients, vendor parsing, credentials, schedulers/pollers.
             Raw tables are frozen at ingest: no harness-computed column ever lands on them.
             Each collector retains a replayable raw payload where the vendor allows it.
    ▼
CORE STORE   canonical entities, one owner each. Master-data columns are human/collector truth;
             machine-learned state lives in satellite tables, never overwrites master data.
    ▼
HARNESS      calculations, scores, rollups, reports, features. Owns its derived tables. Every
             derived table is rebuildable from raw+core by an idempotent job (the
             fuelSpendRollup pattern). Reads collectors ONLY through the owner's interface.
```

New modules this program adds to the ARCHITECTURE.md matrices:

| Module | Layer | Owns (tables) | Feeds / fed by |
|---|---|---|---|
| `financial` | core | `financial_entries` (already reserved, ARCHITECTURE.md:90) | fed by `mcleod` collector (+ `efs` fuel, `fleetpal` later) |
| `accounting` | harness | reporting/config tables it creates (CPM rules, allocation rules) | reads `financial`, `mcleod` via owner interfaces |
| `billing` | harness | AR/invoice surfaces it creates | reads `financial`, `mcleod_billing` via owner interface; projects revenue onto `loads` |
| `maintenance` | harness | its own feature tables (work later) | McLeod AP repair spend via `financial`; `fleetpal` collector later |
| `fleetpal` | collector | none yet (unchanged: planned) | must share the maintenance `dedup_key` contract BEFORE it lands |

Sections: `APP_SECTIONS` grows `accounting`, `billing`, `maintenance`. Roles: `user_role` grows
`accountant` (one value — additions are irreversible, so the minimum that expresses the job).

## §2 Decisions

- **D-SEP1 — Raw/harness separation is universal and machine-enforced.** No harness or core
  code reads a collector's staging table; no calculation output lands on a raw table; vendor
  payloads are parsed only inside collectors. Enforced by a table-access gate (P0.3) fed by a
  table→module→layer manifest (P0.2), with today's violations grandfathered into a ratchet that
  only shrinks. Prose stopped working the day `fuel_transactions` got its 46th derived column;
  only the gate scales to the next data source.
- **D-SEP2 — The manifest is the contract.** `scripts/table-modules.json` records
  `table → {module, layer: raw|core|derived}` for all 118 tables. Gates read it; ARCHITECTURE.md
  §2–§4 becomes a rendering of it, not a second source of truth. A migration touching tables of
  more than one module fails without a named waiver (grandfathering the existing 63).
- **D-SEP3 — Mixed tables split forward, never backward.** Never-edit stands. New satellite
  tables keyed on the parent id (`fuel_txn_recon`, `fuel_txn_scores`, `fuel_txn_dispositions`;
  `vehicle_learned_state`), old columns deprecated via `COMMENT ON COLUMN`, views preserving
  read shape while writers migrate one at a time. Done inside the owning module's step, per
  D-ARC4 rule 4.
- **D-SEP4 — Collectors retain replayable raw.** EFS and Samsara (the two highest-money
  sources) gain `*_raw_payloads` retention on the `load_external_payloads` pattern (0150),
  keyed by fetch + content hash. "Recompute from raw" becomes available where it matters most.
- **D-SEP5 — `merge_driver` leaves SQL.** Replaced by a TS service in `modules/roster` that
  enumerates driver-referencing tables from the manifest. Kills the only recurring forced
  cross-module migration class (8 re-issues to date).
- **D-SEP6 — Finance is collector → core → two harnesses.** `mcleod` (collector) lands
  settlements/vouchers/billing raw; `financial` (core) owns the `financial_entries` projection
  and its dedup rules (D-FS1..6 stand unmodified); `accounting` and `billing` are harness
  modules reading through `financial`'s interface. Nothing about this pipeline is exempt from
  D-SEP1 — it is the first consumer built on the clean seam, which is why the gates land first.
- **D-SEP7 — One `accountant` role, three new sections, API-only reads.** `accountant` joins
  `user_role`; `accounting`/`billing`/`maintenance` join `APP_SECTIONS` with matrix rows:
  admin + accountant manage accounting/billing, auditor views, dispatcher/driver/recruiter
  none; maintenance manage = admin + fleet_manager (+view accountant, for the spend side).
  All four 0257 tables **stay deny-all**; the web reads finance through API endpoints gated
  `requireRole(...rolesThatManage(section))` (the matrix idiom, never hand-listed roles), every
  service query proven by `expectOrgScoped`, sensitive reads audited (D-SEP10). No PostgREST
  path for finance — RLS-as-only-wall is the posture we are moving away from, not extending.
- **D-SEP8 — Maintenance is its own section, built ahead of its collector.** Section, role
  matrix row, module skeleton and nav land now; first data is McLeod AP repair spend already
  arriving through the `financial` projection (`category='maintenance'`, reserved at 0257:70);
  FleetPal is a later collector that MUST adopt the dedup contract (D-FS1 `dedup_key`) before
  its first row, or maintenance double-counts against McLeod AP free-text units.
- **D-SEP9 — The fleet web feature splits instead of renaming.** `features/fleet/` roster forms
  fold into `features/roster/` (exists); idle analytics become `features/idle/` (matching API
  module `idle`). The RBAC section key `fleet` and role `fleet_manager` are **not renamed**
  (enum unrenameable; 11 API gates + ~30 test personas). Nav labels are a U-step cosmetic
  decision, recorded in §6. `/maintenance` URL stays with the downtime page; the new section
  routes under `/accounting`, `/billing`, `/shop` (or similar — §6).
- **D-SEP10 — Finance-grade controls reuse existing precedents, not new inventions.**
  Step-up on financial writes via `requireFreshAuth` (exists, `middleware/requireFreshAuth.ts:60`);
  read-audit rows for financial exports/statements on the `compliance.binder_downloaded` model;
  a matrix↔SQL sync gate so `SECTION_ACCESS` and RLS role lists cannot drift silently (closes
  the hand-held gap named at auth.ts:78-81 and in ARCHITECTURE.md §6's last row).
- **D-SEP11 — Vendor parsing leaves the browser and leaves `packages/shared`'s public surface.**
  EFS report parsing moves server-side into the `efs` collector; the web uploads the raw file.
  `packages/shared` keeps cross-app *contracts*; vendor payload *parsers* live in their
  collector. (The pure `tmsCost/` math stays shared — it is calculation, not parsing, and the
  agent mirrors it by design.)
- **D-SEP12 — `manual-uploads` is struck from the collector matrix.** Its tables were never
  its own: `imports` belongs to `efs` (its only writers); `import_rows` (zero references) is a
  drop candidate decided in P1.9's PR. The four fuel-price scrapers currently inside
  `modules/fuel` become the `posted-prices` collector (name final at P1.6).

## §3 Facts the design is bound by (each measured this audit, none recalled)

1. `psp` never writes `driver_authorizations`; `recruiting` is its only writer — ownership
   transfers to `recruiting` in the manifest (P0.2), not by code move.
2. `duty_equipment_segments` writers are the duty RPCs (0143) called only from
   `modules/driver-app/dutySessions.ts` — ownership transfers to `driver-app`.
3. RPC-bodied writes bypass `check-table-writers.mjs` entirely (its stated v1 scope) —
   `certifications`, `duty_equipment_segments`, `hazmat_runs`, recruiting's tables. The
   table-access gate (P0.3) must parse migration SQL bodies or the freeze has a hole.
4. Three tables' only writer is a **browser file** (`anomaly_thresholds`,
   `driver_performance_settings`, `fuel_discount_rules`) — the freeze can't collapse to owner
   paths until those get API endpoints.
5. The IFTA "module" is a web hook (`apps/web/src/features/ifta/useIftaPeriod.ts:68-69`)
   calling RPCs (0256/0258) that read `samsara_ifta_jurisdiction_miles` directly — the tolerated
   §4 exception currently licenses **browser→staging**. Building the `ifta` API module is a
   build, not a move.
6. `org_modules.module_key` is a closed CHECK constraint (0088:33-35) mirrored in
   `packages/shared/src/entitlements.ts:13-21` — IF accounting/billing/maintenance are also
   commercial entitlements, both lists need widening (§6 Q4 decides whether they are).
7. Role changes ride JWT claims and take effect on token refresh; `platform_admins` (0070)
   deliberately does fresh-lookup instead. Finance authority revocation latency is a §6
   question, answered before the `accountant` enum value ships.
8. The McLeod credential posture (hashed bearer token in `org_integrations`, agent holds SQL
   credentials on-prem) deviates from the `*_credentials` secretBox pattern ARCHITECTURE §2
   describes. Financial payloads raise the stakes; §6 Q3 rules on it before P3.2.
9. `financial_entries` is NOT in `RETENTION_FORBIDDEN` and has no append-only trigger — it has
   `is_void` + canonical dedup instead. Whether it joins the evidence set or stays
   prunable-with-voids is decided in P3.4's PR header, per the 0208 model.
10. `lint:filesize`/`lint:funcsize` budgets apply to every file this program moves; grandfathered
    files may only shrink. `routes/integrations.ts` (830 lines) cannot be moved whole.
11. Two orgs exist in production; `pnpm verify:live` compares HEAD + highest migration against
    deployed `GET /api/version`; a merged migration IS a deployed migration (migrate.yml).
12. The dynamic `.from(variable)` site (`useImport.ts:84`) means the gate must flag indirection,
    not just literals, or it advertises a false guarantee.

## §4 Execution protocol

RECRUITING-SYSTEM-PLAN §4 governs verbatim: resume ritual (read this doc top to bottom, then
`git log -15`, `pnpm verify:live`, find the first non-DONE step); one step per
`claude/<topic>` branch, PR to `main`, merge after CI; mark steps
**— DONE <date> (migrations NNNN–NNNN, PR #N)** in place with "What shipped" + "Verified by:"
naming gates; strike §6 questions through in place when answered. Migration numbers are never
pinned in advance. Program-specific additions:

- **Measure before claiming** (fuel-spend working rules): every "moved cleanly" claim names the
  gate run that proves it; every new gate ships with a test that demonstrates it can fail.
- **A move-PR moves, a split-PR splits, a schema-PR migrates — never two of those at once.**
- Grandfather lists (P0 gates) may only shrink; a PR that grows one is a review rejection.
- Steps marked ∥ are parallel-safe (different files, different tables); everything else assumes
  its phase order. Phases 3–5 may start once P0 is DONE — they do not wait for all of P1/P2.

## §5 Steps

### Phase 0 — Truth and gates (nothing moves until the seam is enforceable)

- **P0.1 — Correct ARCHITECTURE.md and extend its matrices.** Fix the three stale "lives in"
  entries (compliance → `modules/evidence/dqBinder`, dispatch → `modules/loads/dispatchLoads`,
  manual-uploads struck per D-SEP12); re-own `duty_equipment_segments` → `driver-app` and
  `driver_authorizations` → `recruiting` (§3.1–2); add the §1 table rows for `financial`,
  `accounting`, `billing`, `maintenance`, `posted-prices`; add a `layer` column to the
  ownership matrices; record D-SEP1..12 by reference. Done when: doc PR merged; no code.
- **P0.2 — `scripts/table-modules.json` + `check-table-modules.mjs` (`lint:table-modules`).**
  Every table gets `{module, layer}`; the gate fails (a) any table absent from the manifest,
  (b) any `table-writers.json` write site outside the owner module path that is not in the
  grandfather list (seeded with today's ~60), (c) any NEW migration whose tables span >1 module
  without a `-- cross-module-waiver:` header naming the reason. Done when: gate in CI, its
  self-test proves it can fail, grandfather list committed with counts in the PR body.
- **P0.3 — Table-access gate.** Extend the boundary script (or sibling `check-table-access.mjs`)
  to scan ALL of `apps/api/src`, `apps/web/src`, `apps/admin-api/src` for `.from("…")` /
  `.rpc("…")` literals AND migration SQL function bodies, resolving each against the manifest:
  `raw`-layer tables readable only inside the owning module; `derived` tables writable only by
  their owner. Dynamic `.from(variable)` is flagged as an error unless allow-listed (§3.12).
  Grandfather = the audited 39+1 sites + SQL offenders (`ifta_period_*`). Done when: gate in
  CI, ratchet documented, `pnpm lint` green.
- **P0.4 ∥ — Matrix↔SQL sync gate (`lint:section-policies`).** Asserts every RLS policy role
  list that names roles equals the `rolesThatManage`/`rolesThatCanView` set for the section the
  table's module maps to (mapping lives in the manifest), and that every mounted router carries
  a `requireRole`. Existing deviations grandfathered. This is the gate D-SEP7 depends on;
  land it before the finance sections exist so they are born checked. Done when: in CI with
  failing-case test.

### Phase 1 — Close the code-layer seam (moves only, no schema)

- **P1.1 ∥ — Warm-ups:** `services/reproduce.ts` → `modules/hazmat`;
  `services/rebuildScheduler.ts` → `modules/anomalies`; `services/weatherBackfill.ts` →
  `modules/idle` (closes a pinned violation; `fuel -> idle` already allowed). Three PRs or one;
  Done when: `services/` shrinks by three, gates green, grandfather entries removed.
- **P1.2 — `reeferPairing` → `modules/roster` behind an exported interface**
  (`recordInferredPairing()`), `samsaraTrailerSync` calls it; `samsara -> roster` added to
  `API_ALLOW` with the reason string. Closes the sharpest laundered write.
- **P1.3 — Samsara client + credentials into `modules/samsara`.** The ~1,000 lib lines move;
  the 8 non-collector consumers switch to samsara's index interface (typed fetch functions,
  not raw client export); `lib/samsaraToken.ts`'s `integration_credentials` write moves behind
  an `org` interface. Biggest pure-move step; split into 2–3 PRs by consumer group if budget
  demands, lib files first.
- **P1.4 — Queue split.** `services/queue/{registry,worker,pgDriver,dispatch,enqueue}` promote
  to `src/queue/` (platform infra); handlers redistribute by owner (`scoring.ts` → anomalies;
  score/snapshot handlers out of `handlers/samsara.ts` → performance; its credential write →
  org). `apps/api/CLAUDE.md`'s handler-location rule updates in the same PR. Done when:
  `handlers/index.ts` registry and `KIND_CAPS` verified in sync by existing tests.
- **P1.5 — Webhook and scraper relocation (D-SEP11/12).** Samsara webhook verification/parsing
  → `modules/samsara`, writing `fuel_events` through fuel's interface; the four price scrapers
  + `postedPriceFetch` → `modules/posted-prices` (new collector, tables stay fuel-owned,
  writes through fuel's interface — or table ownership moves with them, decided in the PR per
  the ARCHITECTURE amendment rule).
- **P1.6 — Flat routes dissolve.** `routes/integrations.ts` splits three ways into
  `modules/{samsara,efs,org}/routes/` (830 lines — split PRs); `routes/fueling/networks.ts` →
  posted-prices/fuel routes; `routes/reports.ts` + `services/askData.ts` → new `insights`
  harness module (matrix row added in P0.1) reading owners' interfaces instead of 10 raw
  tables.
- **P1.7 — `routing` carve-out.** `fuelPlanning` splits vendor calls (→ samsara/HERE clients in
  their collectors) from planning math; duplicated pricing path
  (`fuelPlanning.ts:245-294` vs `routes/fueling/stations.ts:21-97`) collapses to one function;
  two `fuel_plans` writers become one; build-or-drop on `fuel_plans` decided in the PR
  (one production row ever).
- **P1.8 — Orchestration seam.** `nightlyReconcile` moves to a named `orchestration` home
  (decision in the PR: `org` vs `src/orchestration/`), with its 4-module fan-out expressed as
  allow-listed interface calls. §6 Q6 must be answered first.
- **P1.9 — EFS parsing server-side (D-SEP11).** Upload endpoint in `modules/efs` accepts the
  raw file; `useImport.ts` stops importing `efsImport/*`; the dynamic-`.from()` site dies;
  `import_rows` build-or-drop decided here.
- **P1.10 — `ifta` API module (a build).** Wraps the period reads behind
  `modules/ifta/routes/`; the samsara staging read moves behind a samsara-exported read
  interface (or an owner-blessed view named in the manifest); web feature switches from raw
  RPC to the API. Browser→staging path closes.

### Phase 2 — The data-layer split (schema, forward-only)

- **P2.1 — `fuel_transactions` satellites (D-SEP3).** New tables `fuel_txn_recon`,
  `fuel_txn_scores`, `fuel_txn_dispositions` keyed on the txn id, org_id + RLS on each,
  backfill migration copies existing values, a view preserves the current read shape, writers
  migrate one module per PR (anomalies, samsara-recon, org-audit, dedupe), old columns get
  deprecation comments. The browser writer (`useFuelLog.ts`) gets an API endpoint and dies.
  PGlite matrix proves: raw row insert never touches satellites; satellite rebuild leaves
  dispositions intact.
- **P2.2 — `vehicles` learner split.** `vehicle_learned_state` (or per-domain: tank + idle
  envelope) satellite; `0119`-style autofix writes the satellite and NEVER master data;
  master `tank_capacity_gal` reverts to human/collector truth. Same view+migrate-writers
  pattern.
- **P2.3 ∥ — `declined_transactions` scoring satellite** (same pattern, smaller).
- **P2.4 ∥ — Raw payload retention (D-SEP4).** `efs_raw_payloads`, `samsara_raw_payloads` on
  the 0150 pattern; ingest writes them from day one; retention stance declared per the 0213
  vs EI010 trigger decision in each header.
- **P2.5 — `merge_driver` → TS (D-SEP5).** `modules/roster` service enumerating
  driver-referencing tables from the manifest; the SQL function is superseded (left in place,
  documented as retired — never edited); recruiting-evidence-keeping semantics (0234) carried
  over with the existing matrix tests as the proof.
- **P2.6 ∥ — Catalog annotations + snapshot.** One migration per module adding
  `COMMENT ON TABLE` (`module=…; layer=…; rebuild=…`); CI job dumps the PGlite-applied catalog
  to `supabase/schema.generated.sql` as a reviewable artifact (not a source of truth).

### Phase 3 — Finance data: McLeod → collector → core (accounting's substrate)

- **P3.1 — Wire contracts.** `packages/shared` payload schemas mapping the proven fact schemas
  (`tmsCost/settlementFact`, `expenseFact`) onto the 0257 column sets (incl.
  `accrual_key`/`post_key`); no parser logic in shared (D-SEP11).
- **P3.2 — Ingest endpoints + agent wiring (settlements, AP).** `/api/tms/settlements`,
  `/api/tms/vouchers` in `modules/mcleod` (same token middleware; §6 Q3 credential ruling
  applied); upsert services on `(org_id, external_id)`; `agent.mjs` gains the sweeps (today
  print-only) with `sendBatched`; producer waivers for `mcleod_settlements`/`mcleod_ap_vouchers`
  removed — **that gate turning green is this step's acceptance criterion.** `expectOrgScoped`
  on every query.
- **P3.3 — Billing extraction (greenfield).** `BILLING_HISTORY` query in the agent
  (`queries.mjs`), `billing.mjs` sweep with GL-BILL reconciliation proof (the 0257:274 claim
  becomes runnable), shared contract, `/api/tms/billing` endpoint, upsert into `mcleod_billing`;
  waiver removed.
- **P3.4 — `modules/financial` (core).** The projection service: `dedup_key` computation,
  canonical selection, D-FS2 fuel policy (McLeod fuel + PILOKNTN AP rows collapse into the EFS
  entry), accrual-vs-payment lifecycle split, `is_void` carry-through, unit-string →
  `vehicle_id`/`driver_id`/`load_id` resolution (extending `entityLookup`/`rosterMatch`
  patterns). `financial_entries` waiver removed; retention stance declared (§3.9). PGlite
  matrix: same source row twice → one canonical entry; void propagates; maintenance category
  rows carry the dedup key FleetPal will later have to match (D-SEP8).
- **P3.5 — Backfill to 2024-01-01 (D-FS3)** as a job-queue kind (closed `JobKind` union +
  `KIND_CAPS` cap 1), idempotent, with the agent-side reconciliation totals re-verified against
  persisted rows and the numbers quoted in the PR body.

### Phase 4 — Roles, sections, policies (before any finance UI exists)

- **P4.1 — The enum + matrix migration.** `accountant` added to `user_role` (isolated
  migration, house convention); `APP_SECTIONS` += `accounting`, `billing`, `maintenance`;
  `SECTION_ACCESS` rows per D-SEP7; `USER_ROLE_LABELS`, role schema, invite/member surfaces,
  `SettingsUsersPage` `SECTION_LABELS` updated; ~30 test personas extended. RLS: finance
  tables stay deny-all (no new policies — the point); any *client-readable* maintenance table
  born later carries matrix-derived role lists checked by P0.4's gate. §6 Q1 (revocation
  latency) answered in this PR's header.
- **P4.2 — Route gates.** All new finance/maintenance routers use
  `requireRole(...rolesThatManage(section))`; financial writes take `requireFreshAuth`;
  `routeAuth.test.ts` extended to assert role-gating presence (not just 401) for the new
  mounts.
- **P4.3 ∥ — Read-audit.** `financial.statement_viewed` / `export.generated`-style rows on
  finance list/export endpoints, `entityId` = row UUID where one exists; audit-write failure
  policy for finance decided here (best-effort vs fatal — §6 Q2).

### Phase 5 — The product surfaces

- **P5.1 — `modules/accounting` (harness).** AP/settlement/cost surfaces over `financial`'s
  interface: spend by account (`summarizeApSpendByAccount` gets its first consumer), settlement
  cost by truck, CPM (`computeCpm` re-pointed at `financial_entries` per FINANCIAL-STORE-PLAN
  §5.3), allocation-rules config table (owner: accounting; §6 Q5 is its prerequisite). Web
  `features/accounting/` + nav group, API-only reads.
- **P5.2 — `modules/billing` (harness).** Invoice/AR surfaces, margin-per-truck (billing is
  the only equipment-carrying money table), revenue onto `loads` via `order_external_id`
  (FINANCIAL-STORE-PLAN §5.4). Web `features/billing/` + nav.
- **P5.3 — `modules/maintenance` (harness skeleton + first data).** Section live per D-SEP8:
  repair-spend view from `financial_entries` `category='maintenance'` (McLeod AP), unit-number
  free-text resolution surfaced honestly (unmatched = unmatched, no guessing); FleetPal
  collector remains a §6-gated future with its dedup contract written here first. Route path
  decided per D-SEP9 (not `/maintenance` — taken).
- **P5.4 — Fleet feature split (D-SEP9).** Roster forms → `features/roster/`; idle analytics →
  `features/idle/`; `table-writers.json` paths updated (2 pins); sidebar-collapse localStorage
  key migration noted in the PR (label-keyed state, orphaning is silent); nav labels final.

### Phase 6 — Ratchet to zero

- **P6.1 — Grandfather burn-down.** Scheduled passes shrinking P0.2/P0.3 lists to zero for
  collector-staging reads and out-of-owner writes; ARCHITECTURE.md §6 table updated to show
  the freeze actually collapsing (the promise measured false this audit).
- **P6.2 — Contracts gate.** The last hand-held rule ("contracts only in `packages/shared`",
  plus D-SEP11's converse "vendor parsers never in shared") becomes a lint, closing
  ARCHITECTURE.md §6's known gap.

## §6 Prerequisites and open questions (owner · fallback)

1. **Accountant authority latency** — JWT claim (refresh-delayed revocation, like every org
   role) or fresh-lookup (like `platform_admins`)? Owner: Miki. Fallback: JWT claim, consistent
   with all org roles; revisit only if a finance incident demands instant revocation.
2. **Finance audit-write failure policy** — `writeAudit` is best-effort by design; is a failed
   audit row fatal for a financial read/export? Owner: Miki. Fallback: fatal for exports,
   best-effort for list reads, stated per-endpoint.
3. **McLeod credential posture** — keep hashed ingest token in `org_integrations` or migrate to
   a `mcleod_credentials` secretBox table per ARCHITECTURE §2? Owner: Miki. Fallback: keep the
   token model (push architecture means the API never holds SQL credentials — arguably already
   the safer shape); record the deviation in ARCHITECTURE.md §2 instead of pretending.
4. **Are accounting/billing/maintenance commercial entitlements** (rows in `org_modules`, CHECK
   constraint + `entitlements.ts` widened) or role-gated features of the base product? Owner:
   Miki. Fallback: role-gated only; entitlement wiring added later if sold separately (the
   constraint widening is cheap and additive).
5. **Overhead allocation rules** — FINANCIAL-STORE-PLAN §6's finance ruling on `ap_glid` →
   category/allocation. Owner: finance (Miki). Fallback: `DEFAULT_CPM_RULES` stance — direct
   costs only, overhead unallocated and labelled as such (D-MC28).
6. **Orchestration seam** — where does legitimate cross-module chaining live (nightlyReconcile
   fans across 4 modules)? Owner: this program, decided in P1.8's PR after P1.1–P1.5 shrink
   the problem. Fallback: `src/orchestration/` with explicit allow entries.
7. **Nav labels after the split** — does a "Fleet" group survive holding roster+idle, or do
   they regroup? Owner: Miki at P5.4. Fallback: keep "Fleet" label (roster+idle), add
   "Maintenance", "Accounting", "Billing" groups; zero RBAC impact either way (D-SEP9).
8. **`fuel_plans` and `import_rows`** build-or-drop — decided in P1.7 / P1.9 PRs from
   production row counts at execution time (one row ever / zero references at audit time).
9. **FleetPal timeline** — collector unbuilt on purpose; its gate is the dedup contract from
   P3.4/P5.3. No fallback needed; it simply does not land before that contract exists.
