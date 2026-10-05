# Architecture production readiness and data separation plan

**Status: READY FOR DISCOVERY AND IMPLEMENTATION.** Created October 3, 2026 for Claude Code. This is an execution programme, not a statement that production is already ready. Decision IDs are `D-APR*`; task IDs are `APR*`.

The goal is to finish the existing modular-monolith architecture so collectors, canonical records, and calculation harnesses have enforceable boundaries. The future external API must expose source records and calculated results through separate, deliberate contracts. Calculations must be reproducible within a declared replay horizon, published consistently, and unable to overwrite source evidence or human decisions. Production readiness also requires authorization, recovery, operational visibility, and measured capacity.

Keep one database and the existing TypeScript monorepo. Complete the architecture already chosen in `docs/ARCHITECTURE.md`; introduce infrastructure only when measured requirements justify it. This document coordinates unfinished work in existing plans and supplies their missing acceptance gates. It does not silently supersede owner decisions.

## Execution instructions for Claude Code

Read this document fully, then execute Phase 0 before changing application code. Work in small reviewable increments; each task can span multiple PRs when migration sequencing requires it. A phase is complete only when its checklist has evidence, required CI passes, and any deployment verification has been recorded. A checked box without evidence is unfinished work.

- Read the root and affected directory `CLAUDE.md` and any applicable `AGENTS.md`. Preserve unrelated work and identify the checkout/worktree before editing.
- Use claude-mem `work_state_read(includeClosed=true)` and `work_state_write` as the canonical task tracker. Use list `architecture-production-readiness`; record task ID, status, evidence, blockers, and next safe action. Keep this document's checkboxes as the reviewable milestone record, not a competing daily task list.
- Read the cited implementation before copying its pattern. Paths and signatures below are discovery starting points, not permission to assume unchanged code.
- Reconcile existing architecture, fuel, financial, permissions, and API plans before assigning ownership. Search repository history and available PRs for the existing partner API blueprint; its contents were not available in the checkout audited for this document. Do not create competing API designs without reconciling it.
- Preserve behaviour through captured fixtures and differential checks before changing storage or ownership. Do not bless an existing incorrect result as the expected answer; discrepancies need an explanation and corrected acceptance fixture.
- Run meaningful negative tests: a detector must reject the forbidden implementation, and a security test must exercise the direct access path being protected.
- Follow existing merge/deployment authorization and repository workflow. Document creation does not authorize deleting production data, changing retention or vendor contracts, or changing infrastructure settings.
- At each session end, record completed work, remaining work, exact tests, rollout state, and the next task. Do not mark the programme done because one feature works or CI is green.

For each completed task append: `date | task | commit/PR | tests and results | deployment/schema | parity/operational evidence | rollback | remaining limitations`. Store scrubbed evidence under `docs/audits/architecture-readiness/<date>/`; never commit tokens, credentials, card numbers, or customer payloads.

## Baseline and evidence limits

The October 3 source audit used commit `2a7160c`. These observations must be remeasured in Phase 0:

| Observed condition                                                                                                                 | Source                                                                            | Consequence                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 197 tables declared; 47 raw tables; 29 grandfathered raw-access sites; 58 grandfathered writer sites; 10 dynamic table-access pins | `scripts/table-modules.json`, `check-table-access.mjs`, `check-table-modules.mjs` | Green gates admit known boundary debt. These counts are a dated baseline, not target constants.                             |
| Fuel and vehicle satellites exist, but legacy fields and mirror triggers remain                                                    | migrations `0261_fuel_txn_satellites.sql`, `0262_vehicle_learned_satellites.sql`  | Physical additions did not finish reader/writer migration or retire mixed rows.                                             |
| EFS processing invokes anomaly scoring                                                                                             | `apps/api/src/modules/efs/services/efsProcessing.ts:211`                          | Collector processing depends on harness completion.                                                                         |
| Idle engine fetches and classifies without local raw persistence                                                                   | `apps/api/src/modules/idle/idleEngineSync.ts:1`; fuel plan D-IE8                  | Raw export and replay depend on vendor history. This is an intentional decision requiring reconciliation with the new goal. |
| Idle telemetry persists sample statistics, not the original sample sequence                                                        | `apps/api/src/modules/idle/idleTelemetrySync.ts`                                  | A table labelled raw does not necessarily contain replayable source evidence.                                               |
| Fuel rollup writes chunks before a separate stale-row delete                                                                       | `apps/api/src/modules/fuel-spend/fuelSpendRollup.ts:112,236`                      | Readers can observe a partial generation; failure can leave mixed results.                                                  |
| Import allowances apply to whole module pairs                                                                                      | `scripts/check-feature-boundaries.mjs:62`                                         | Comments describing index-only access are not an enforced public-interface boundary.                                        |
| Queue completion/failure RPCs do not take a worker or attempt identity                                                             | `supabase/migrations/0095_jobs_queue.sql:86`; `apps/api/src/queue/worker.ts`      | A stale worker requires fencing at publication and terminal updates; lease renewal alone is insufficient.                   |

Five architecture checks passed in that audit. Four targeted suites passed 50 tests: fuel rollup, rollup scheduler, idle engine sync, and financial fleet report. These results are regression evidence, not proof of load capacity, security completeness, or recovery.

The separate [database audit](../../audits/2026-10-03-database/report.txt) documents denied-section reads, receipt isolation, stale-token access, tenant FK integrity, and schema drift. It also documents protections and limitations. Findings can have been fixed since the audit; revalidate rather than copying them as current facts. The audit's `reproduce.mjs` reports observed behaviour and is not a passing regression test suite. Recent grant hardening already appears in the audited HEAD; do not repeat it blindly.

## Target architecture and invariants

### Data categories

| Category          | Meaning                                                                                           | Owner and API behaviour                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source evidence   | Facts asserted by a vendor, including units, source IDs, timestamps, revisions, and completeness  | Collector-owned. Source API uses an explicit export contract, redaction, authorization, and licensing checks. It does not expose credentials or arbitrary staging columns. |
| Canonical records | Normalized fleet entities and transactions, identity resolution, corrections, and human decisions | Domain-owned. Canonical API returns stable product concepts with source lineage. Human decisions are never disposable calculation output.                                  |
| Derived results   | MPG, classifications, scores, allocations, aggregations, and materialized reports                 | Harness-owned. Calculated API returns the result with algorithm version, effective parameters, input cutoff, coverage, scope, and publication identity.                    |
| Infrastructure    | Jobs, credentials, rate-limit state, cursors, caches, and operational metadata                    | Platform or integration owner. No automatic external export.                                                                                                               |

Normalization can change units and resolve identity without being a business estimate. Source-provided aggregates must state their source grain; they are not raw samples. Field classification must follow meaning, not table name or the presence of arithmetic.

### Decisions and acceptance invariants

- **D-APR1 — Finish the modular monolith.** Collectors own vendor I/O and parsing. Domain projections own canonical mapping policy. Harness engines are pure functions of explicit normalized inputs; application services fetch those inputs and publish outputs. Coordination lives in the worker/orchestration layer. Stable owner read interfaces may feed the harness directly when a canonical table would add no value; vendor shapes stay inside collectors.
- **D-APR2 — Three public contracts.** Source, canonical, and calculated contracts are separate even if delivered by one API service. Database schemas are implementation details. No `select('*')` export or catch-all table endpoint.
- **D-APR3 — Source evidence and human decisions survive rebuilding.** Recalculation may replace only derived output it owns. Correction, deduplication, and operator adjudication have explicit provenance and survive a reset. Existing append-only and retention-forbidden evidence rules remain binding.
- **D-APR4 — Replay has a declared boundary.** Every derived product declares the retained inputs needed, replay horizon, algorithm/configuration version, and unavailable-input behaviour. Beyond the horizon, stored results must not claim reproducibility. Vendor-backed replay is explicitly labelled and has an outage/expiry contract.
- **D-APR5 — Publication has a consistency contract.** An API response observes one completed generation for its documented scope, or explicitly reports partial scope. A failed build preserves the last valid publication. Multi-page exports pin the same generation or source cutoff.
- **D-APR6 — Job ownership protects writes.** Retry is at least once; idempotency and database fencing protect publication. A worker that lost ownership cannot publish, complete, fail, or alter a newer attempt. No claim of exactly-once vendor calls.
- **D-APR7 — Access is enforced on every reachable surface.** API, direct PostgREST, RPCs, storage, and exports enforce tenant, section, surface, and driver/self rules where applicable. Service-role queries must independently scope their organization. Tenant links must be valid in the database, not just in the UI.
- **D-APR8 — Exceptions are explicit and shrinking.** Product boundary violations go to zero. Necessary platform/admin fabric exceptions have exact symbols/tables, owners, reasons, and test coverage; temporary exceptions also name an expiry and removal task. Adding a blanket allowance is not completion.
- **D-APR9 — Readiness is measured.** Target availability, latency, freshness, recovery, and capacity must be accepted before go-live. No invented benchmark, generic enterprise checklist, or unmeasured microservice migration counts as evidence.

## Owner decisions

Claude should finish discovery and present concrete recommendations for these decisions. Continue independent tasks while a decision is pending; do not implement dependent policy by assumption. Existing recorded rulings take precedence until explicitly changed.

| Decision                                            | Required evidence and recommendation                                                                                                                                                                                                                                                | Blocks                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Q1 Source persistence and replay horizon per domain | Inventory input size, vendor history guarantees, licensing, sensitivity, cost, and replay needs. Recommend bounded retained normalized evidence plus protected raw payloads only where necessary. Reconcile D-IE8 and SEPARATION P2.4/PAN redaction before persisting new payloads. | Phase 3 source retention and full replay sign-off |
| Q2 External API audience and entitlements           | Define allowed tenants/partners, source versus calculated scopes, sensitive field policy, and vendor redistribution rights. Use the existing partner blueprint if available.                                                                                                        | External exposure in Phase 6                      |
| Q3 Operational targets                              | Measure current workloads, then agree numerical latency, freshness, availability, maximum query/export scope, supported fleet/concurrency, and RPO/RTO.                                                                                                                             | Performance and final readiness                   |
| Q4 Canonical correction and identity policy         | Resolve field authority, source conflicts, corrections, lineage/history, and any existing open tank-capacity/source rulings in TELEMETRY.                                                                                                                                           | Affected projections and satellite retirement     |
| Q5 Infrastructure changes                           | Prepare concrete networking, SSL/auth, worker topology, deployment-order and recovery changes with connectivity impact and rollback. Follow existing deployment authority.                                                                                                          | Corresponding production rollout                  |

## Phase 0 Documentation discovery and refreshed baseline

**APR0.1 — Inventory the real data paths.** Read `ARCHITECTURE.md`, `SEPARATION-PROGRAM-PLAN.md`, `TELEMETRY-SEPARATION-PLAN.md`, `DATA-LIFECYCLE-PLAN.md`, the fuel D-IE decisions, financial plans, permission plans, migration discipline, worker deployment, and the partner blueprint if accessible. Follow graph references only as an index; verify each load-bearing claim in source.

Produce a machine-readable inventory with each source → collector → source evidence → projection → canonical record → harness → derived table → API/UI/export reader. Include actual writers, RPCs, views, direct SQL, triggers, browser access, versions, retention, source grain, correction semantics, and replay dependencies. Classify all exceptions; reconcile new work with existing plan tasks by linking their IDs and naming a single owner.

**APR0.2 — Capture baseline and choose the pilot.** Use fuel transactions plus fuel-spend as the first full source-to-API pilot; then complete telemetry/idle and finance. Capture scrubbed fixtures covering missing data, late corrections, duplicate events, null versus zero, incomplete pages, timezone/DST boundaries, mixed units/currencies, identity changes, and human dispositions. Record deployed versions and catalog drift using authorized read-only access when available. No production access means deployment verification stays pending.

**Allowed existing APIs and patterns to verify before use:**

| Existing API or pattern                                                                                 | Exact source                                                                                                                       | Intended reuse and limits                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dispatchJob(admin, env, kind, opts): Promise<RunJobResult>`                                            | `apps/api/src/queue/dispatch.ts`                                                                                                   | Existing registered handler runs in queue or in-process mode. It does not provide an atomic data-write/enqueue boundary by itself.                                                                                                                            |
| `startJob(admin, orgId, kind, opts?)`, `startJobHeartbeat(admin, jobId)`, `finishJob(admin, id, patch)` | `apps/api/src/modules/org/jobs.ts`                                                                                                 | Existing lifecycle/heartbeat pattern. Completion and lease fencing must be strengthened, not assumed.                                                                                                                                                         |
| `eachPage(makeQuery, onPage, pageSize?)`, `fetchAllPaged(makeQuery, pageSize?)`                         | `apps/api/src/lib/paging.ts`                                                                                                       | Avoid row-cap truncation. Callers must provide deterministic ordering and bounded scope; offset paging alone does not freeze a changing dataset.                                                                                                              |
| `idle_engine_write(p_org, p_vehicles, p_from, p_to, p_tz, p_hours, p_stops)`                            | `supabase/migrations/0404_idle_engine_tables.sql:177`, latest replacement `0407_idle_engine_stop_duty.sql:64`; `idleEngineSync.ts` | Copy validation, transaction, tenant/window checks, and service-only grants from the latest definition. Atomic per invocation/batch, not the entire multi-batch run; currently not attempt-fenced.                                                            |
| `getFleetReport` → `computeFleetReport`                                                                 | `apps/api/src/modules/financial/fleetReport.ts`; `packages/shared/src/tmsCost/fleetReport.ts`                                      | Copy the application-service/pure-engine split and coverage semantics. This does not prove a consistent cross-source snapshot.                                                                                                                                |
| Financial projection source identity                                                                    | `apps/api/src/modules/financial/projection.ts`                                                                                     | Copy lineage/idempotency using org, source, source table, external ID; validate source revision/correction behaviour.                                                                                                                                         |
| Owner reads                                                                                             | `modules/samsara/index.ts`, `modules/financial/index.ts`, collector readers                                                        | Extend real exported readers; do not import vendor clients into harnesses.                                                                                                                                                                                    |
| `expectOrgScoped` service query assertions                                                              | `apps/api/src/testing/supabaseRecorder.ts:314`                                                                                     | Check actual query filters; supplement recording tests with database-role behaviour.                                                                                                                                                                          |
| API authorization middleware                                                                            | `apps/api/src/middleware/auth.ts`                                                                                                  | Reuse `requireAuth`, `requireOrg`, and explicit `requireSection(section, 'view' \| 'manage')`; verify actual signatures. `requireAnySection` is a union, stacked section checks are an intersection. Derive org from authenticated context, not request body. |

Verification:

- [ ] APR0.1 Inventory, exception classification, predecessor-task ownership, and unresolved decisions are recorded.
- [ ] APR0.2 Current branch/deployed versions, gate counts, fixtures, and quantitative baseline are recorded with dates.
- [x] Allowed API table verified; missing or changed APIs corrected before dependent work. (2026-10-05, BASELINE.md)
- [ ] Existing audit findings marked still reproducible, fixed with evidence, or unverified.

**Guard:** Do not turn dated measurements into current facts, invent helper signatures, or count a new table as a completed migration.

## Phase 1 Enforce ownership and public interfaces

**APR1.1 — Narrow import boundaries.** Extend the existing boundary checker using syntax-aware resolution where its regex cannot establish the invariant. Allowed inter-module imports must enter the declared public surface and, where necessary, an exact symbol set. Resolve aliases, relative paths, re-exports, barrel exports, dynamic imports, and type-only imports deliberately. Keep composition roots explicit. Add negative fixtures that exercise the actual production scanner, including an allowed module pair importing a forbidden internal file.

**APR1.2 — Close the data-plane blind spots.** Extend the table-access/writer manifest to identify owning RPCs, views, triggers, and direct SQL readers/writers. Check schema-qualified SQL, indirect builders, dynamic table dispatch, and transitive raw reads through views/RPCs. Replace whole-migration free-text bypasses with scoped reviewed declarations. Do not claim complete SQL analysis from a regex; unsupported constructs must fail or require a narrowly recorded exception. Prefer existing parsers/helpers after discovery rather than building a new parser unnecessarily.

**APR1.3 — Define exceptions and engine purity.** Classify existing allowances into product debt, temporary migration compatibility, and permanent platform fabric. Seal designated calculation directories in `packages/shared` against I/O, vendor imports, clocks, randomness, and app dependencies; inject time/configuration as inputs. Existing determinism checks cover hazmat/QR, not every financial or idle engine. Keep adapters outside engine directories. Wire new gates to actual CI and test them with planted violations.

References: `scripts/check-feature-boundaries.mjs`, `check-table-access.mjs`, `check-table-writers.mjs`, `check-table-modules.mjs`, `check-shared-contracts.mjs`, `.github/workflows/ci.yml`.

Verification:

- [ ] APR1.1 Importing collector internals through an allowed pair fails CI; public owner readers pass.
- [ ] APR1.2 Rogue `.from`, indirect writer, raw-reading RPC/view, and unscoped waiver fixtures fail the scanner.
- [ ] APR1.3 Designated engines reject nondeterministic/I/O imports; exact permanent exceptions have owners and tests.
- [ ] Gate counts and source inventory reconcile; unsupported constructs and remaining debt are explicitly listed.

**Guard:** Do not expand `API_ALLOW`, relabel tables, move a file into an owner directory without moving responsibility, or exclude callers merely to make CI green.

## Phase 2 Close production authorization and integrity gaps

This phase is a release prerequisite for widened data/API exposure. It can proceed alongside Phase 1 once Phase 0 establishes the current state.

**APR2.1 — Enforce access on all data paths.** Convert each still-valid database audit finding into a failing regression test before repair. Cover denied-section SELECT and invoker RPCs, anonymous access, two drivers in one org, cross-org access, storage read/upload/delete, and manager exceptions. Review permissive policies together because they combine with OR. Use existing surface/section contracts; preserve legitimate driver self-access without opening office data.

**APR2.2 — Enforce current identity and tenant links.** Design membership/suspension checks for direct database/storage access with recursion and query cost measured. Harden sensitive API validation failure paths. Test issued-token behaviour after suspension, role downgrade, section revocation, and membership deletion. Inventory FK relationships and enforce same-tenant links where required using validated constraints or owner-controlled guards. Global references need documented semantics. Audit and resolve existing invalid links before validating constraints; do not silently delete them.

**APR2.3 — Reconcile schema and harden configuration.** Capture actual drift in new numbered migrations, including functions, signatures, grants, policies, and constraints; test migration replay and application compatibility. Review callable definer helpers, default grants, search paths, bucket validation, and audited transport/network/auth settings. Prepare configuration changes with connection tests and rollback before changing production. Recheck prior fixes to avoid duplicate work.

References: `docs/audits/2026-10-03-database/report.txt`, `supabase/tests/`, `supabase/CLAUDE.md`, `apps/api/src/middleware/membershipCurrent.ts`, shared permission contracts, `scripts/check-section-policies.mjs`, `docs/MIGRATION-DISCIPLINE.md`.

Verification:

- [ ] APR2.1 Direct table/RPC/storage negative tests pass with permitted self/manager cases preserved.
- [ ] APR2.2 Stale identities cannot retain protected access beyond the approved enforcement window; failure paths deny sensitive operations.
- [ ] APR2.2 Cross-tenant links fail at the database boundary; existing violations have an audited resolution.
- [ ] APR2.3 Drift is reconciled or a precisely bounded approved difference; grant/config changes are verified and recorded.

**Guard:** RLS enabled, private buckets, route checks, or org-scoped SELECT alone do not prove section enforcement or tenant FK integrity. Preserve raw evidence while correcting corrupt references.

## Phase 3 Separate collection from calculation and define replay

**APR3.1 — Give collection its own completion boundary.** Copy the registered job dispatch/handler pattern into orchestration. Collector success means complete source evidence and checkpoint committed; calculation success is a separate job/publication state. Extract EFS scoring orchestration from collector services without losing durable retry, scoring mutexes, alerts, or deduplication. Use a transactional outbox or an equivalent durable committed-work record so a crash between evidence persistence and enqueue cannot lose calculation work. The exact design is a Phase 0 choice; this is not an assumed existing outbox API.

**APR3.2 — Move vendor access behind collectors.** Move Samsara token/fetch/parser responsibilities used by idle and routing behind collector interfaces. Engines receive vendor-neutral observations with explicit units, source grain, timestamps, and completeness. Coordinate Samsara/idle cadence outside either domain's internals. An endpoint reading persisted results must not trigger vendor I/O on its critical path unless explicitly contracted as a refresh operation.

**APR3.3 — Implement the approved evidence policy.** After Q1, retain the minimum inputs that support required source export/replay. Preserve source event IDs/revisions, observed and received times, source interval boundaries, completeness/watermarks, and redaction policy. For large GPS/telemetry streams, measure compression/partition/retention needs before selecting storage. Reconcile idle D-IE8 explicitly: either bounded local evidence supports replay, or vendor-dependent replay is an accepted, clearly exposed limitation. Change misleading `raw` classifications for summaries without pretending summaries recreate original samples.

**APR3.4 — Make replay controlled and reproducible.** Replay immutable/versioned inputs with a pinned engine/configuration. Run in isolated generations, compare output, and publish only after validation. Define source correction, identity remapping, late event, out-of-order event, duplicate, timezone change, and revision semantics. Track which derived scopes are invalidated; a fixed trailing rebuild window must not strand older corrections. Retention must never remove inputs still needed by an in-flight build or an approved replay horizon.

References: `queue/dispatch.ts`, `queue/handlers/`, EFS processing, `idleEngineSync.ts`, `idleTelemetrySync.ts`, `packages/shared/src/idleEngine/`, fuel D-IE8, `DATA-LIFECYCLE-PLAN.md`, SEPARATION P2.4.

Verification:

- [ ] APR3.1 Crash after source commit/before dispatch recovers calculation; duplicate delivery produces no duplicate output or alert.
- [ ] APR3.2 Collector-to-harness imports and harness-to-vendor imports fail gates; vendor outage does not prevent reading published data.
- [ ] APR3.3 Every derived product has an honest source/replay/retention contract; sensitive payload policy is enforced.
- [ ] APR3.4 Same input/config/version yields identical output; late corrections beyond the ordinary trailing window are rebuilt.

**Guard:** Do not store unrestricted vendor payloads, sensitive card data, or unlimited telemetry to satisfy replay. A source sample summary cannot stand in for the original sequence.

## Phase 4 Finish canonical and derived storage separation

**APR4.1 — Complete the fuel satellite migration.** Inventory all field readers/writers, including SQL functions and browser queries. Build narrow owner interfaces for reconciliation, scores, and dispositions. Move writers, then readers, to their owned stores in compatible releases; preserve corrections, deduplication, and audit decisions. Prove that rescoring changes only calculated state. Retire trigger branches and legacy fields only after parity, reference scans, and deployed-reader verification.

**APR4.2 — Complete telemetry retirement.** Execute and reconcile TELEMETRY TS1–TS7 rather than starting a competing satellite design. Give current feed state, calibration, and learned idle profiles their declared owners/lifecycles. Follow D-TEL3: remove the corresponding mirror half with its writer flip; follow the staged reader/soak/drop requirements. Resolve missing calibration columns and source-authority questions before flipping. Extend the lifecycle gate to prevent reintroducing telemetry writes into core entity rows.

**APR4.3 — Separate projections from reports.** Keep canonical financial projection policies and lineage in their owner, while pure report math consumes explicit inputs. Establish the same distinction for source-provided aggregates, normalized fuel records, derived risk, and operational caches. Avoid extracting new packages/modules solely for folder symmetry; enforce the actual dependency and write contract.

References: migrations 0261/0262, SEPARATION P2.1/P2.2/P6.1, TELEMETRY D-TEL1–6/TS1–7, financial projection and shared fleet report engine, `table-modules.json`, `table-writers.json`.

Verification:

- [ ] APR4.1 Rebuilding scores/reconciliation cannot erase human dispositions or source evidence.
- [ ] APR4.1 Fuel API/UI/export callers use owner contracts; deprecated mixed-field reads/writes and mirrors are retired.
- [ ] APR4.2 Vehicle/driver telemetry and learner retirement complete with parity and before/after write amplification measurements.
- [ ] APR4.3 Every field's owner/category is consistent with the inventory; source lineage is available for canonical records.

**Guard:** Do not drop columns in the writer-flip release, use unbounded dual-write as the final design, or interpret additive satellites as completion.

## Phase 5 Publish consistent results and fence stale jobs

**APR5.1 — Make publication atomic for its promised scope.** Copy validation and transaction patterns from `idle_engine_write`, then add the missing generation/ownership guarantees. For bounded fuel windows, a transactional replacement may suffice. For large multi-batch builds, stage rows under a generation, validate counts/invariants, then atomically switch a publication pointer. The last valid generation remains readable on failure. Define whole-fleet versus per-vehicle scope explicitly; idle's per-batch transaction does not establish fleet-wide completeness.

**APR5.2 — Fence every attempt.** Introduce a monotonically distinct attempt/publication token or equivalent database ownership proof. Ownership checks must be atomic with domain publication and queue completion/failure/progress. Strengthen the queue driver/RPC contract and in-process path consistently. Stop work cooperatively after lost lease; database fencing is still required for delayed requests. A stale worker's exception path must not requeue/fail the new owner's job. Eliminate the fuel scheduler's unledgered fallback before allowing concurrent execution. Check returned persistence errors in lease/finish/progress helpers: failed mandatory ownership/publication writes must stop the operation and become visible; optional progress failure must not falsely complete or corrupt it.

**APR5.3 — Standardize result provenance and consistency.** Add algorithm version, effective parameter/configuration identity, input watermark/snapshot references, computed time, complete scope, coverage, and publication identity to calculated contracts. Define reproducibility separately from freshness. Query/export readers pin a publication; source readers pin a supported cutoff/revision view. Prevent successful-job stamps from implying a dependent calculation succeeded when it failed. Maintain per-stage states where one job coordinates several outputs.

References: `fuelSpendRollup.ts`, `fuelSpendRollupScheduler.ts`, migration 0404, `queue/worker.ts`, `queue/types.ts`, `queue/pgDriver.ts`, migration 0095, `modules/org/jobs.ts`.

Verification:

- [ ] APR5.1 Reads during chunk writes/failure see the previous complete publication; pointer switch reveals the complete replacement.
- [ ] APR5.2 A worker paused past lease expiry cannot publish or mutate the replacement attempt; test success, exception, progress, shutdown, and cancellation paths.
- [ ] APR5.2 Missing coordination storage fails safely; no concurrent unledgered rebuild proceeds.
- [ ] APR5.3 Multi-page results/export use one publication and state their input scope/version/coverage; partial source input cannot appear complete.

**Guard:** A heartbeat, job mutex, timestamp sweep, or per-batch transaction alone is not a proof of complete publication or stale-worker safety.

## Phase 6 Establish API contracts and product parity

**APR6.1 — Define contracts before external exposure.** After Q2 and blueprint reconciliation, define versioned source, canonical, and calculated DTOs in `packages/shared`. Explicitly select fields, redact sensitive values, and expose source timestamps, units/currency, grain, and correction semantics. Use separate entitlements for source versus calculated exports where required. Define compatibility/deprecation and breaking-change policy. Publish schemas/specification from the same contracts where supported; do not hand-maintain incompatible copies.

**APR6.2 — Bound queries and exports.** Define stable keyset ordering with a unique tie-breaker, maximum date/entity/page scope, quotas, and asynchronous export handling for large scopes. Pin publication/source cutoff across pages. Expired cursors or removed retention windows produce an explicit response, not silently different data. Register routes in existing authorization catalogues and test org/surface/section checks. Source endpoints use collector-owned export readers, never direct vendor access or staging `select('*')`.

**APR6.3 — Make all consumers agree.** Route UI, internal API, external API, and PDF/CSV reporting through the same owner services and calculation definitions. Preserve requested truck/date/state/site/network filters; disclose unsupported scopes rather than silently ignoring them. Show unknown/unavailable independently of zero. Remove browser access exceptions domain by domain; retain intentionally supported direct paths only with equivalent authorization and documented ownership.

References: `packages/shared` contracts, `check-shared-contracts.mjs`, existing route/auth/catalogue tests, `fuelSpendLines.ts`, `financial/reads.ts`, fuel UI/PDF parity tests, `FLEET-MPG-CONSOLIDATION-PLAN.md`, existing `fuel-ux-fixes` work state.

Verification:

- [ ] APR6.1 Contract fixtures exclude credentials/vendor secrets and clearly distinguish source, canonical, calculated, and human data.
- [ ] APR6.2 Pagination is stable under concurrent ingestion/corrections; max scope/quota/export limits and cursor expiry are tested.
- [ ] APR6.2 Cross-tenant IDs, denied scopes/sections, suspended users, and guessed export references are rejected.
- [ ] APR6.3 Identical filters produce identical totals across UI/API/PDF/CSV; unknown data is never turned into a measured zero.

**Guard:** Do not publish a generic database proxy, create a second calculation in an API serializer, or copy a list of roles beside the permission catalogue.

## Phase 7 Prove efficiency and operational recovery

**APR7.1 — Measure before optimizing.** Use approved representative scrubbed data and realistic production-like scale. Measure source fetch pages, vendor quota consumption, collection duration, query p50/p95/p99, memory, SQL plans, database write volume, lock waits, replay duration, and export size. Test normal Q3 capacity and agreed headroom. Identify repeated scans, missing indexes, N+1 queries, unbounded arrays, and unnecessary mirror writes. Drop only proven redundant indexes after checking constraints/predicates and before/after plans. Adopt incremental computation only when correction/invalidation equivalence is proven. Enforce aggregate vendor budgets across job kinds and replicas, with bounded 429/backoff behaviour; per-kind concurrency caps are not a shared vendor request-rate limit.

**APR7.2 — Observe failures and freshness.** Existing jobs/freshness findings are the starting point. Add accountable signals for collection lag, incomplete source pages, schema mismatch, failed derivation, stalled publication, lease loss, queue backlog, retries, retention errors, and vendor quota exhaustion. Report last successful collection and publication separately. Every alert needs an owner, dashboard location, deduplication, retry/recovery action, and a synthetic verification; logs alone are insufficient.

**APR7.3 — Test restore and replay.** Document backup coverage for database and object storage, configuration/secrets recovery, approved RPO/RTO, and access ownership. Restore a scrubbed backup in an isolated environment, verify source evidence/human decisions, rebuild derived output, and validate tenant permissions and totals. Test interrupted backfill, worker restart, vendor outage, bad input, partial source fetch, and retention execution. Record measured recovery time and any irrecoverable evidence.

References: `DATA-LIFECYCLE-PLAN.md`, `WORKER-DEPLOYMENT.md`, `DEPLOYMENT.md`, jobs/freshness modules, source pagination and retention code, approved Q3 targets.

Verification:

- [ ] APR7.1 Agreed capacity/latency/freshness budgets pass with measured headroom and no unbounded query/export path.
- [ ] APR7.1 Mirror retirement reduces measured writes; optimizations preserve parity under corrections and replay.
- [ ] APR7.2 Synthetic failures reach an accountable operator and the documented recovery action works.
- [ ] APR7.3 Database plus object evidence restores within agreed targets; replay/retention drills preserve protected records.

**Guard:** Do not replace measurements with generic performance claims, production load tests without authorization, or a backup-exists checkbox without a restore drill.

## Phase 8 Safe rollout and production acceptance

**APR8.1 — Exercise compatibility and rollout.** Follow expand → backfill → writer switch → reader switch → soak → retire. Some steps require separate merges; existing-column additions and first readers must follow migration discipline. Test old code/new schema and new code/old schema for the supported release window. Drops require source/SQL scans plus confirmation all deployed services and relevant client versions have stopped reading the field. Verify both API and web hosts and exactly one scheduler owner. Maintain compatible rollback until contract cleanup; after destructive schema changes, use tested forward recovery rather than assuming an old binary is safe.

**APR8.2 — Prove shadow parity before switching.** Compare generations against approved ground truth by tenant/entity/period, covering missing input, corrections, late data, and DST. Explain discrepancies; approve intentional changes with versioned fixtures. Reuse the existing idle rollout/parity gates and their established durations/tolerances; do not invent a shorter soak. Update architecture documentation from final manifests and measured implementation.

**APR8.3 — Complete the release evidence.** Run required CI, behavioural security matrices, contract/parity checks, concurrency/failure tests, capacity checks, and restore drill. Record remaining limitations, accepted platform exceptions, owner decisions, rollbacks, and operational ownership. External go-live remains pending if any applicable blocker or decision is unresolved. Scope-limited readiness is allowed only when its excluded domains/endpoints are explicit and inaccessible.

Verification:

- [ ] APR8.1 Compatibility matrix, rollout/rollback steps, deployed schema/version, and scheduler ownership verified.
- [ ] APR8.2 Shadow comparisons and required domain-specific soak passed; intentional differences are explained.
- [ ] APR8.3 Production checklist below complete with evidence; no security, data loss, stale-worker, or publication blocker remains in released scope.

**Guard:** Neither passing CI nor an updated architecture diagram can substitute for deployed verification, security behaviour, or recovery evidence.

## Verification commands and required evidence

Start with these verified existing commands; inspect current `package.json` and CI before extending the list. Run focused suites during each change and the required full checks before merge. New tests/gates must be included in CI, not merely available locally.

```sh
pnpm lint:boundaries
pnpm lint:table-access
pnpm lint:table-writers
pnpm lint:table-producers
pnpm lint:table-modules
pnpm lint:shared-contracts
pnpm lint:table-lifecycle
pnpm lint:rls
pnpm lint:section-policies
pnpm lint:migrations
pnpm lint:migration-ordering
pnpm lint:rpc-org-default
pnpm lint:upserts
pnpm lint:secrets
pnpm lint:mpg
pnpm typecheck
pnpm test
pnpm build
pnpm verify:live
```

`lint:table-writers` regenerates the schema snapshot; review the generated diff. `verify:live` requires configured network/environment access and is a deployment check, not a substitute for compatibility tests. PGlite tests prove synthetic database behaviour; exercise production PostgreSQL semantics in an isolated supported environment for locks, transaction concurrency, query plans, and large data. Never claim an offline matrix proves production performance.

Baseline focused tests:

```sh
pnpm --filter @silvicom/api exec vitest run src/modules/fuel-spend/fuelSpendRollup.test.ts src/modules/fuel-spend/fuelSpendRollupScheduler.test.ts src/modules/idle/idleEngineSync.test.ts src/modules/financial/fleetReport.test.ts
```

Mandatory new acceptance scenarios: crash between collection commit and dispatch; duplicate delivery; truncated source page; old correction outside trailing window; stale worker racing new attempt; interrupted chunk publication; concurrent pagination; revoked identity on direct DB/storage paths; cross-tenant FK; rebuild preserving human decisions; date/filter parity; restore and replay. These must assert behaviour at the actual boundary, not mirror the implementation.

## Production acceptance checklist

This is the final release gate. Every applicable box requires a linked artefact. Any approved exclusion must state the inaccessible endpoint/domain and why it is outside the release.

- [ ] All released source/canonical/derived records have declared owners, lineage, units/grain, and retention/replay semantics.
- [ ] Product boundary violations are zero in released scope; necessary platform exceptions are exact, justified, and tested.
- [ ] Collectors perform vendor I/O; harness engines are pure; orchestration has durable dispatch and independent completion states.
- [ ] Rebuilding derived data cannot alter source evidence, corrections, deduplication decisions, or human dispositions.
- [ ] Released source APIs honestly state retained evidence and vendor-dependent replay limitations.
- [ ] Published results are complete for their promised scope; readers/exports pin a publication and input cutoff.
- [ ] Stale workers cannot publish, complete, fail, or modify a replacement attempt.
- [ ] Tenant/section/surface/driver rules hold across API, direct tables, RPCs, storage, and exports; stale-identity behaviour is approved and tested.
- [ ] Tenant FK integrity and schema/grant/policy consistency hold; prior audit blockers are closed with refreshed evidence.
- [ ] UI/API/PDF/CSV parity holds for identical supported filters; unavailable inputs remain separate from zero.
- [ ] Query/export bounds, vendor quotas, capacity and latency budgets, and data freshness targets pass measured tests.
- [ ] Actionable monitoring and recovery ownership exist; collection and calculation freshness are independently visible.
- [ ] Database/object evidence restore and replay satisfy approved RPO/RTO.
- [ ] Migration compatibility, rollout, soak, rollback/forward recovery, deployed versions, and scheduler ownership are verified.
- [ ] Q1–Q5 decisions affecting released scope are recorded; no unresolved temporary workaround is disguised as readiness.
- [ ] Canonical architecture documentation and manifests match the final implementation; release evidence is reviewable.

## Claude Code starting prompt

> Read `docs/plans/architecture/PRODUCTION-READINESS-AND-DATA-SEPARATION-PLAN.md` and applicable repository instructions. Execute Phase 0 first. Refresh the inventory, reconcile existing plan owners and the partner API blueprint, and establish current evidence before implementation. Track work in claude-mem list `architecture-production-readiness`. Then implement the next dependency-ready task in small compatible PRs, using cited existing patterns and the verification checklist. Continue authorized independent work while owner decisions are pending. Preserve unrelated changes and production evidence. Do not claim enterprise or production readiness until the released scope passes the final acceptance checklist. At each handoff record exact evidence, deployment state, limitations, and next task.

## Progress record

October 3, 2026 — Plan created from source audit and documentation discovery. No application changes, migrations, infrastructure configuration changes, or deployments performed by this document creation. All implementation checkboxes remain open.

2026-10-05 | APR0.2 (part) + allowed-API check | this PR | 15 gates exit 0 on `c9048c9` | none; production at 0423, `ebc8c8e` | [baseline](../../audits/architecture-readiness/2026-10-05/BASELINE.md): debt counts unchanged since 10-03 (29 access / 58 writer / 10 dynamic), 199 tables | n/a, read-only | Found: `data_retention` fails for the real fleet on every run since 09-23 (`scoring_attempts delete: Bad Request`, 129,832 rows overdue; cause unconfirmed). Still open from the audit: `drivers` section gate, SSL off, network open, two plaintext SOAP passwords beside sealed copies. `eachPage`/`fetchAllPaged` now live in `packages/shared/src/paging.ts`. Partner blueprint only on open PR #1100. Not done: APR0.1 inventory, pilot fixtures, compute/swap, stale-token and leaked-password checks. Next: APR0.1 for the fuel pilot.

2026-10-05 | Retention fix (found by APR0.2) | #1285 (`0b8c61a`) | new test fails on main at 37,007 bytes; 2 mutants killed; 11/11 | none; reaches production with the next approved release | cause measured: production rejects a 700-uuid `in.()` URL, accepts 500 | revert the merge | the backlog of 129,832 rows drains at 30,000 per run; verify `data_retention` for org `86d6b3ea…` turns `done` after the release. A failed run still stores empty `stats`.

2026-10-05 | APR0.1 (fuel pilot) | this PR | generator cross-checked (50 = 11 + 31 + 8 files; 29/58 grandfathers equal the gates) | none | [inventory](../../audits/architecture-readiness/2026-10-05/FUEL-PILOT-INVENTORY.md), `fuel-pilot-inventory.json` | n/a | `fuel_transactions` mixes vendor facts, harness identity and flags, enrichment and human verdicts; the 0261 satellites have 0 application readers or writers; vendor re-sends are `ON CONFLICT DO NOTHING` (whether EFS re-sends corrections is unverified); `fuel_spend_days` has no generation or version. Fuel holds 21/29 raw-access and 16/58 writer exceptions. Not done: telemetry/idle and finance inventories, pilot fixtures. Next: APR0.2 fuel pilot fixtures.

2026-10-05 | Follow-ups 4a/4b (found by APR0.1/APR0.2) | #1299 (`b5f433f`), #1300 (`77eff5f`) | new tests fail first (3/3, 2/2) | none; in release candidate #1303 awaiting approval | scoring's three `fuel_transactions` updates filter `org_id`; a failed `data_retention` error ends with "— deleted this run: …" and keeps partial deletes | revert the merge | fuel inventory point 2 updated.

2026-10-05 | APR0.1 (telemetry/idle, finance) | this PR | generator scopes `fuel`/`telemetry`/`finance`; fuel output unchanged apart from the writer-grandfather total (58 → 59, `platform_alert_recipients`, 0427); reader counts cross-checked against `git grep` | none | [telemetry](../../audits/architecture-readiness/2026-10-05/TELEMETRY-INVENTORY.md), [finance](../../audits/architecture-readiness/2026-10-05/FINANCE-INVENTORY.md), `*-inventory.json` | n/a | Finance: `mcleod_gl_totals` unique key lacks `company_id` and the 0310 upsert overwrites it — a second McLeod company would clobber totals (latent; only `TMS` staged); the fleet report reads staging, not `financial_entries`; the `financial_projection` job hardcodes 50 days against D-FIN7's 75; projection never un-canonicalises; no finance table has a retention rule. Telemetry: replay depends on Samsara (D-IE8); stats-feed `fuel_events` is first-write-wins while every other collector overwrites; `idle_rollup_days` has no version; foundation writers are non-transactional; 7 idle/samsara tables plus every `samsara_*` table have no retention rule. Next: fix `mcleod_gl_totals` key (migration + test), then APR0.2 fuel pilot fixtures.
