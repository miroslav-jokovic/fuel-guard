# Outbound Data API — Implementation Blueprint

**Status: BLUEPRINT — Phase 0 discovery is the first execution step.**
**Owner:** Silvicom 360 platform/API
**Decision IDs:** `D-PAPI-*`
**Last verified against:** isolated planning checkout at `origin/main` commit `752e8cc` (2026-09-28). The active Claude Code checkout contains separate ongoing work and was intentionally not used as the PR base. Recheck all implementation references against the then-current `main` before each build phase.

This is the single decision log and execution plan for FuelGuard/Silvicom 360’s outbound data API. Update this document as each phase is investigated and completed. A later chat or Claude Code session must be able to resume from the current phase, its evidence, decisions, and next step without relying on chat history.

## 1. Objective and product boundary

Build a secure, versioned server-to-server interface through which explicitly authorized external systems can consume data FuelGuard has collected, normalized, entered, or derived. FuelGuard remains responsible for deciding which organizations, integrations, resources, records, fields, actions, and time ranges are available to each consumer.

The intended data path is:

```text
External providers ──► collectors ──┐
Manual/office entry ─────────────────┤
                                    ▼
                         owned canonical/core data
                                    │
                         harness-derived results
                                    ▼
                    outbound API ──► consumer systems
                         └─────────► signed webhooks
```

The API is a **consumer-facing product boundary**, not a pass-through to Samsara, McLeod, FleetPal, EFS/WEX, or internal database tables. It must use the owning module’s exported interface. FuelGuard may be the authoritative source for normalized and derived data it publishes while preserving the original system of record, provenance, freshness, and derivation for each fact.

### Goals

- Provide a predictable and versioned contract for external consumers.
- Give operators explicit, auditable control over every integration’s data access.
- Support bounded reads, reliable incremental synchronization, and signed change notifications.
- Cover existing and future data domains—including roster, loads/stops, positions, fuel, toll/manual expenses, maintenance, and compliance—only when each domain’s source, ownership, contract, and access policy are verified.
- Preserve tenant isolation, module ownership, privacy, retention, and source/harness boundaries.
- Keep the API and its OpenAPI description accurate as the code evolves.

### Out of scope

- Replacing or broadening existing vendor collectors.
- Giving external systems direct database, Supabase/PostgREST, vendor, or collector-staging access.
- Treating current browser/driver endpoints or `/api/tms` as the new partner contract.
- Building a general-purpose customer data warehouse, arbitrary query language, or unrestricted bulk dump endpoint.
- Claiming support for a data domain until its producing workflow and owner interface exist and pass the domain readiness gate in §5.

## 2. Grounded current state

The architecture contract defines collectors → core store → harness, downward-only dependencies, and one owning module per table. The API must sit above those boundaries and read through owner interfaces: [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md), especially §§1–4. Shared TypeScript/Zod contracts belong in `packages/shared` per root `CLAUDE.md`.

The inspected `origin/main` checkout has:

- Unversioned application routers mounted in `apps/api/src/app.ts`, including transactions, anomalies, dispatch, live map, maintenance, and inbound webhooks. These are application surfaces, not a general partner contract.
- `/api/tms`, an inbound McLeod/on-prem agent interface with bearer-token authentication, organization resolution, request validation, and rate limiting. Its token helper is `apps/api/src/lib/ingestToken.ts`; router and lifecycle patterns are in `apps/api/src/modules/mcleod/routes/tmsIngest.ts` and `apps/api/src/modules/mcleod/tmsIngest.ts`.
- Inbound, provider-authenticated callbacks under `/api/webhooks`; they do not implement FuelGuard-to-consumer delivery. See `apps/api/src/routes/webhooks.ts` and raw-body handling in `apps/api/src/appHttp.ts`.
- A user-authenticated live map at `/api/livemap/positions` that composes position, roster, and load context. `vehicle_positions` is Samsara-owned raw data; the live map is not a partner contract. See `apps/api/src/modules/livemap/` and `apps/api/src/modules/samsara/index.ts`.
- McLeod-owned load data and dispatch application reads. Load availability and the current consumer/use case must be remeasured; do not assume the production data is populated.
- No general outbound partner-key registry, per-key scope system, outbound webhook subscription/delivery service, or FuelGuard OpenAPI contract was found in the inspected routes/manifests.
- No toll-expense producer was found. `docs/ARCHITECTURE.md` records `manual-uploads` as a phantom module; do not represent toll/manual expense API support as already implemented. Make it available only after an owned producer and canonical contract are built and verified.

These findings are a starting snapshot, not a substitute for Phase 0’s fresh inventory. Exact route and data availability can change before implementation.

## 3. Decisions and invariants

These are the plan’s governing constraints. Record any change as a dated decision here before implementation; do not silently reinterpret them in code.

- **D-PAPI-1 — Outbound contract, owner interfaces only.** Partner handlers call the owning module’s exported read interface. They never query collector/raw tables or sibling-module internals directly.
- **D-PAPI-2 — Deny by default and scope per integration.** Each integration is associated with one organization, an explicit active credential, approved resources/actions, and any record/field/time constraints. No scope means no access. Object and property authorization are checked on every request.
- **D-PAPI-3 — Explicit response allowlists.** API DTOs are constructed from approved fields. Never serialize database rows, vendor payloads, generic model `toJSON()`, or arbitrary client-selected columns.
- **D-PAPI-4 — Provenance and freshness travel with data.** Each resource contract identifies stable FuelGuard IDs, source/external identity where policy allows, source/provenance, source event/update time, FuelGuard receipt/update time, and quality/freshness semantics where meaningful. Never imply a stale or missing source value is current.
- **D-PAPI-5 — Pull is authoritative; webhooks are notifications.** Consumers retrieve the authorized record through the API. Webhook deliveries carry minimal event metadata by default; they do not bypass the key’s resource/field policy.
- **D-PAPI-6 — API keys for the initial server-to-server contract.** Keys are high entropy, shown once, stored only as non-reversible hashes, separately identifiable per integration, scoped, revocable, rotatable, and optionally expiring. Use the authorization header, not query-string credentials. Evaluate OAuth only if a verified consumer requirement justifies it; do not build both credential systems speculatively.
- **D-PAPI-7 — Separate webhook secrets.** A consumer API key is never reused as a delivery-signing secret. Signed delivery covers the exact transmitted bytes, includes timestamp and unique event/delivery identity, uses constant-time signature comparison, and has a bounded replay window and deduplication behavior.
- **D-PAPI-8 — Bounded and recoverable operations.** Every list/query has explicit maximum page size and bounded filters; high-cost export is asynchronous and permission-checked. Incremental cursors, replay, retries, and corrections have documented semantics before release.
- **D-PAPI-9 — OpenAPI is a checked contract, not an authorization mechanism.** Keep the OpenAPI document in the repo, validate it, and link each operation to the same request/response schemas and security rules used by the implementation. OpenAPI does not enforce tenant/resource/field authorization.
- **D-PAPI-10 — No silent domain promises.** A resource is not advertised or enabled until the domain readiness checklist in §5 passes. Future manual/toll data follows the same ownership and provenance rules as collector-fed data.

## 4. Security and control requirements

Security work is part of each phase and release gate, not a later hardening phase.

### Credential and authorization controls

- Create an integration identity and credential lifecycle separate from employee JWT/session roles and separate from vendor collector credentials.
- Credential record includes org, integration identity, non-secret display prefix, secret hash, scopes, allowed resource/record constraints, creation/expiry/revocation metadata, and last-used metadata. Never return the stored hash or plaintext after issuance.
- Credential create, scope change, rotation, revoke, webhook endpoint/secret change, and data export configuration are admin-authorized and audited. During Phase 0, identify and cite the governing step-up policy and existing `requireFreshAuth` patterns; apply the verified requirement to sensitive grants and changes.
- Authenticate before resource work; resolve organization from credential state, never a caller-supplied `org_id`. Every service-role query includes and tests exact tenant scope (`expectOrgScoped`).
- Enforce integration scope, resource/action, object, field, date-range, and vehicle/load scope on every request. IDs are not authorization.
- Do not put credentials in URLs, logs, audit payloads, metrics labels, traces, or error messages. Redact authorization headers and sensitive webhook bodies.

### Data-release controls

- Produce a field-level data classification and release matrix covering direct identifiers, driver/person data, location, customer/load details, finance, compliance/evidence, derived scores, and raw vendor data.
- Location access is separate from general load access. Define current vs historical position, vehicle allowlists, maximum lookback, allowed precision, sampling/freshness, and retention before exposing coordinates. Current `/api/livemap/positions` behavior is not presumed safe or suitable for partners.
- Protect evidence/document contents with separate explicit scopes and download controls; do not expose signed storage URLs or raw document payloads by default.
- Apply data minimization, retention, deletion/correction behavior, and customer offboarding revocation consistently. Establish read/export audit granularity without logging payload contents.

### Abuse, availability, and webhooks

- Apply per-integration and per-organization quotas, request-rate limits, maximum page size/date window/body size, query-cost controls, concurrency limits, and bounded webhook retries. Return documented retry guidance and `Retry-After` where appropriate.
- Verify authentication and authorization for webhook subscription management. Restrict destinations to approved HTTPS endpoints and validate DNS/IP/redirect behavior to prevent SSRF; endpoint validation and delivery-time connection safety must both be covered. Never let a partner supply arbitrary callback destinations to a data-read route.
- Persist delivery state with event ID, attempt count, timestamps, response class, next retry, and terminal/dead-letter state; do not persist secrets or unnecessary payload data. Provide controlled replay and endpoint disable/secret rotation.
- Webhook receiver must be able to verify signature over raw bytes and timestamp and safely deduplicate delivery IDs. Specify delivery ordering as best-effort unless an ordering guarantee is implemented and proved.
- Monitor authentication failures, authorization denials, rate-limit refusals, stale source feeds, export job health, webhook lag/failure, and unexpected volume. Keep alarms actionable without exposing PII.

## 5. Domain readiness gate

Each proposed resource gets one row in the contract inventory. It cannot enter the supported OpenAPI surface until all checks pass:

1. Identify the producing source/workflow and whether it is live, planned, manual, or derived; verify real code and representative data/freshness for the target org(s).
2. Identify the canonical table/module owner from `scripts/table-modules.json` and `docs/ARCHITECTURE.md`; confirm the exported owner interface. If the interface is absent, add that as a prerequisite in the same module’s plan—not a direct-table API workaround.
3. Define stable resource ID, external/source identity policy, lifecycle, update time, provenance, null/unknown/stale meanings, and correction/deletion/tombstone behavior.
4. Inventory fields and classify sensitivity; approve field allowlist and exact resource/action scopes. Define joins and object-level visibility for related records.
5. Define list/detail/filter/sort/page limits, incremental cursor semantics, replay window, and expected data volume. For positions, also complete the location-specific controls in §4.
6. Define contract schemas, OpenAPI examples, errors, and consumer-visible freshness/quality states.
7. Add tenant, scope, object, and property authorization tests plus data-shape, pagination, redaction, and lifecycle tests.
8. Record evidence, reviewer, decision, and status in the inventory below.

### Initial inventory (discovery snapshot; Phase 0 must update)

| Domain | Evidence from inspected code/docs | API readiness at blueprint time | Required gate before exposure |
|---|---|---|---|
| Roster | `modules/roster/`; canonical owner in architecture; user-facing and TMS ingest routes exist | Candidate | Stable consumer DTO and per-integration field/object policy |
| Loads, stops, events | `modules/loads/`; McLeod mirrored load ownership; dispatch reads exist | Candidate; production population must be checked | Owner read interface and complete lifecycle/correction semantics |
| Current/historical positions | Samsara owns position staging; live-map composition exists | Sensitive candidate; **not** ready by virtue of live-map route | Dedicated owner read contract, scope/precision/window/freshness/retention rules |
| Fuel transactions/events | EFS/Samsara collectors feed canonical fuel and event data | Candidate | Separate raw/source facts from canonical/enriched/derived fields; define corrections and attribution |
| Toll/manual expenses | No toll producer found in inspected `origin/main`; architecture says no generic manual-uploads module | Not ready | Approved producer/owner and canonical data contract must exist first |
| Maintenance/inventory | `modules/maintenance/` and FleetPal collector exist in inspected tree | Candidate; remeasure exact shipped domains | Separate FuelGuard-owned inventory state, FleetPal facts, documents, and financial truth |
| Finance/fuel spend | Financial and fuel-spend owners/interfaces exist; source/derived boundaries are domain-specific | Candidate | Finance authorization, reconciliation meaning, PII/financial field allowlist |
| Compliance/evidence | Evidence owns regulated records/documents; harness reads evidence interfaces | Sensitive candidate | Specific record/document scopes, legal access/retention policy, audit/export behavior |
| Derived insights/reports | Harness modules calculate anomalies, IFTA, performance, reports | Candidate | Meaning/version/freshness/provenance plus scope and export limits |

“Candidate” is not a release commitment. Add/remove rows only with verified source evidence and a recorded decision.

## 6. Phases and ordered steps

A phase may be refined incrementally in this same file. Do not start a dependent implementation phase before its exit gate is evidenced. Each phase is self-contained enough to execute in a fresh session.

### Phase 0 — Baseline and requirement discovery (first)

**Outcome:** a current, evidence-backed resource catalog and consumer requirement baseline; no API implementation.

1. Rebase discovery on the current target branch and record commit SHA, migration/schema state, and active plan/PR dependencies. Do not inspect, stage, or modify another active checkout’s changes.
2. Inventory all mounted API routes and auth gates from `apps/api/src/app.ts`, route-auth ledgers/tests, and module exports. Separate user routes, inbound vendor webhooks, inbound collector ingest, admin APIs, and candidate outbound resources.
3. Walk `scripts/table-modules.json`, canonical architecture ownership, and each candidate module’s `index.ts` interfaces. Trace field flow source → raw/staging → core → harness; verify no API consumer shortcut crosses ownership boundaries.
4. Measure source availability and freshness for each tenant/domain in scope; check the presence of loads, positions, manual records, and representative changes. Record which domains are live, planned, empty, or unsupported. No inferred population from schema alone.
5. Document the first receiving system(s), their use cases, needed fields, expected volume/cadence/latency, consumer network/runtime, error/retry behavior, and data-sharing constraints from approved requirements. If no consumer is selected yet, keep the contract consumer-neutral and do not invent partner-specific promises.
6. Build the full field classification/release matrix, object relationships, organization/vehicle/customer scope requirements, location and evidence policies, retention, correction, deletion, and audit decisions. Validate against existing policies and legal/product requirements; record cited evidence.
7. Inventory existing API contract tooling/package dependencies and CI gates; check official OpenAPI spec and tooling documentation before selecting OAS version, generation/validation approach, and code-first/spec-first workflow.
8. Convert every unverified dependency or unresolved policy into an explicit prerequisite step with an owner, required evidence, and exit gate in this plan. Keep every dependent resource/phase blocked until that prerequisite is complete. If a prerequisite is governed by another approved plan, link it and keep the dependent work blocked until that plan’s prerequisite is verified; do not count an unresolved external dependency as a phase exit.

**Evidence to record:** route/domain map; data lineage/ownership matrix; field sensitivity/release policy; consumer requirements; data availability/freshness measurements; current step-up/auth policy with source; OpenAPI tooling decision; dated D-PAPI decision entries.

**Exit gate:** product/API owner approves the scope and all field/resource policies; every initial resource passes or is explicitly deferred by evidence; no unresolved policy or dependency blocks the next phase; prerequisites placed in this or another approved plan remain blocked until their evidence-backed exit gates pass; no payload/authorization rule is guessed. Update §§2, 3, 5, and phase details with exact code paths and decisions.

**Anti-patterns:** do not infer a supported feature from a route, migration, table, or plan; do not treat sample/empty tenant data as proof of production readiness; do not promise tolls or position history without a producer/retention proof.

### Phase 1 — Contract architecture and OpenAPI decision

**Outcome:** approved API contract standards and resource specifications, before implementation.

1. Decide route/version policy, content type, stable ID format, timestamps, units, pagination, filtering, sorting, error envelope, deprecation/compatibility policy, and generated-client expectations.
2. Define snapshot and incremental sync behavior: deterministic ordering, opaque cursors, watermark semantics, late-arriving and corrected data, tombstones/deletions, full resync, replay bounds, and concurrent-write behavior.
3. Define common resource envelope/metadata for source, source update, FuelGuard ingestion/update, and data-quality/freshness where applicable.
4. Select the pinned OpenAPI Specification version after checking current official specification and validating the chosen parser/generator/docs toolchain. Keep the spec as a first-class repo artifact and choose spec-first or code-first with one declared source of truth; do not maintain duplicate handwritten schemas.
5. Map OpenAPI schemas to `packages/shared` Zod contracts and select CI drift/compatibility checks. Document differences that cannot be expressed in the chosen spec and enforce them separately.
6. Produce one reviewed operation/resource contract per Phase 0-approved domain, including security requirements, field allowlists, examples, errors, limits, and lifecycle semantics.

**References:** `packages/shared` contract conventions in root `CLAUDE.md`; API error/body validation patterns in `apps/api/CLAUDE.md`; official [OpenAPI Specification](https://spec.openapis.org/oas/); OWASP API inventory and authorization risks in [OWASP API Security Top 10](https://api-security.owasp.org/editions/2023/en/0x11-t10/).

**Verification:** OpenAPI document validates with the selected official-version-compatible validator; every operation has explicit security, request/response schema, bounded parameters, success/error examples; Zod/OpenAPI parity has an automated check or documented enforceable alternative; compatibility rules are executable.

**Anti-patterns:** do not expose DB column names as public contracts by default; do not copy user-route shapes without contract review; do not claim that OpenAPI enforces security.

### Phase 2 — Integration identity, keys, admin lifecycle, and audit

**Outcome:** operators can safely grant, inspect, rotate, expire, and revoke distinct partner credentials.

1. Define schema/table ownership, RLS-deny-by-default policy, admin permission and step-up rules, audit events, retention, key lifecycle state machine, and migration/deploy ordering from current repo rules.
2. Implement high-entropy per-integration API keys with recognizable non-secret prefix; persist only a one-way hash; reveal plaintext once; generic auth failures; constant-time comparison where applicable; never place key in URLs or logs.
3. Implement multiple active keys per integration for overlap rotation; immediate revoke/expiry; last-used tracking that cannot amplify writes or reveal sensitive query content. Keep provider/collector credentials and `/api/tms` token storage semantically separate.
4. Implement grant UI/API or documented operator control plane: create integration identity, select approved scopes/constraints, issue/rotate/revoke keys, inspect metadata and usage, disable integration, and audit each change.
5. Verify credential lifecycle against key theft, org disablement, user departure, customer offboarding, concurrent rotation, and partial migration/deploy windows.

**References:** token shape/hash/one-time display tests in `apps/api/src/lib/ingestToken.ts` and `.test.ts`; lifecycle in `apps/api/src/modules/mcleod/tmsIngest.ts`; tenant/RLS/migration requirements in root `CLAUDE.md` and `docs/MIGRATION-DISCIPLINE.md`.

**Verification:** tests prove plaintext is never stored/returned again, old keys fail after revoke/expiry, key A cannot use key B’s scopes/org, grants are audited, org filters are enforced, and unauthorized roles/step-up failures are denied. New schema passes RLS/migration/table-owner gates.

**Anti-patterns:** do not reuse the current single McLeod integration hash as a multi-partner registry without a deliberate ownership/schema decision; do not store API keys encrypted when verification only needs a hash; do not log auth headers or include secrets in support exports.

### Phase 3 — Partner request authentication and authorization boundary

**Outcome:** `/api/v1` requests are authenticated and authorized independently of employee sessions.

1. Add a dedicated partner API router/middleware mounted with explicit rate, request-size, timeout, and observability controls; do not add partner credentials to broad `requireAuth` user-session semantics.
2. Resolve tenant and integration identity solely from verified key metadata. Reject disabled, expired, malformed, unknown, or revoked credentials with a uniform response.
3. Enforce resource/action scopes and field projections centrally and at the owner query boundary; require explicit policy checks for object IDs and joined records. Use allowlists, never caller-selected arbitrary columns.
4. Apply bounded pagination, date windows, page/body/response limits, query-cost controls, per-key and per-org quotas, and safe 429/5xx retry headers.
5. Add explicit route-auth inventory/fitness coverage so every new route has the intended machine auth and no route is accidentally public or user-only.
6. Record security-relevant read/export metadata (integration, org, resource, action, time, result counts/correlation ID) without storing full sensitive payloads.

**References:** `apps/api/src/app.ts` rate-limiter/router ordering; `apps/api/src/routeAuth.test.ts`; `apps/api/src/testing/routeLedger.ts`; `apps/api/src/testing/supabaseRecorder.ts` `expectOrgScoped`; root `CLAUDE.md` service-role rule; OWASP API1/API3/API4/API5.

**Verification:** for every operation test missing/invalid/revoked key, wrong org, missing scope, unauthorized object/field, bounded-query refusal, rate quota, and cross-tenant attempts; every database access is proven org-scoped. Verify auth/redaction in logs, metrics, and errors.

**Anti-patterns:** no relying on RLS alone for service-role API reads; no trusting UUID unpredictability; no IP address as the sole identity; no unbounded `limit`, page, date, or export request.

### Phase 4 — Canonical resource read interfaces and API resources

**Outcome:** approved resource endpoints use owner interfaces and truthful provenance/freshness semantics.

1. For each Phase 0-approved domain, verify or add a small owner-module read interface; document exact fields, joins, ordering, corrections, and failure behavior. Keep partner DTO mapping in the API boundary, not the collector parser.
2. Build list/detail endpoints with cursor pagination, stable sort, server-side filter allowlists, explicit DTOs, consistent error envelope, source/provenance/freshness metadata, and conditional caching only where policy permits.
3. Implement incremental sync/cursors and tombstone/correction behavior from Phase 1 contract; ensure replay is idempotent and cursor advances only after complete pages.
4. For loads, preserve McLeod ownership and lifecycle; do not provide writes that compete with the TMS master. For positions, use a dedicated Samsara owner interface and enforce per-integration vehicle/time/precision/freshness rules; do not expose the current fleet-wide dispatch live-map route as-is.
5. Release future manual/toll domains only after a separately owned producer, canonical schema/interface, provenance, retention, and source-specific validation are in place. API plan does not invent a second manual ingestion path.
6. Publish each endpoint only after it passes the §5 domain readiness gate; make unsupported resource/scope responses explicit and non-leaky.

**References:** owner map in `docs/ARCHITECTURE.md` and `scripts/table-modules.json`; module exports in `apps/api/src/modules/{roster,loads,samsara,fuel,maintenance,evidence}/index.ts`; live-map composition at `apps/api/src/modules/livemap/liveMapBoard.ts` as a source to analyze, not copy blindly; current dispatch routes under `apps/api/src/modules/loads/routes/`.

**Verification:** contract/schema tests; stable pagination/replay/correction tests; exact org-scope assertions for every read; per-object/property authorization matrix; source freshness/staleness/null semantics; response redaction and no raw collector table reads from partner layer; query-volume/latency measurements at agreed pilot scale.

**Anti-patterns:** no direct `.from()` against another module’s or collector’s tables; no DTO spread from DB rows; no returning “success/fresh” when the source feed is stale or missing; no undocumented data writes.

### Phase 5 — OpenAPI publication and consumer implementation package

**Outcome:** an external developer can implement against the approved, versioned contract without relying on private chat or code knowledge.

1. Publish the validated OpenAPI document through the approved developer-facing channel, with environment/base URL, auth header example, scopes, pagination, errors, and version support.
2. Add copy-ready curl examples and representative payloads for every supported domain, including stale/unknown data and authorization errors. Never place live credentials or PII in examples.
3. Document credential issue/rotation/revoke, least-privilege setup, rate limits, retry/backoff, cursor persistence, full-resync, deletion/correction, time zones/units, and support/error correlation process.
4. If SDKs are generated, pin generator/version and check generated artifacts against the OpenAPI contract in CI; do not make SDK generation a prerequisite for using the API.
5. Add a consumer sandbox/test tenant and contract smoke procedure with synthetic/minimized data only; document which services are unavailable in sandbox.

**Verification:** external reviewer can complete auth, retrieve a page, continue via cursor, interpret an error/freshness field, and rotate/revoke credentials from docs alone; OpenAPI validation and generated artifacts are reproducible.

**Anti-patterns:** no API docs that reveal internal table/service names as required integration details; no examples with real org/driver/load/location data; no spec publication before access restrictions and deployment match it.

### Phase 6 — Outbound webhook subscriptions and delivery platform

**Outcome:** consumers can receive authorized, recoverable notifications without polling every resource continuously.

1. Define the versioned event catalog, triggering transaction/commit point, event identity, event time, resource identity, minimal payload, allowed subscriptions, scope checks, ordering expectations, and replay/recovery contract.
2. Build subscription lifecycle with admin-controlled endpoint URL, subscribed event types, associated integration identity/scopes, separate signing-secret issue/rotation/revoke, and audit trail.
3. Validate endpoint URL as HTTPS and apply SSRF protections at setup and delivery (DNS resolution/IP classes, redirect refusal or safe revalidation, connect/read timeout, response-size cap). Revalidate each connection to reduce DNS rebinding risk; never allow arbitrary redirect to a private/internal destination.
4. Queue deliveries durably with unique delivery/event ID, timestamp, versioned body, signature over exact bytes, retry policy with exponential backoff/jitter and bounded attempts, delivery history, terminal failure/dead-letter state, and controlled replay.
5. Define signature header and verifier contract; require receiver timestamp freshness, constant-time MAC verification, and dedupe by stable delivery ID. Keep API key and webhook secret independent.
6. Keep the webhook body minimal and require authorized API fetch for full data. If events include fields, apply the same field/object policy as API reads at delivery time and on replay.

**References:** queue infrastructure and handlers in `apps/api/src/queue/`; delivery jobs use existing queue patterns only after inspection; inbound raw body and signature patterns in `apps/api/src/appHttp.ts`, `apps/api/src/routes/webhooks.ts`, `apps/api/src/lib/telnyxSignature.ts` are references for exact-byte verification, not an outbound delivery implementation. Official [OpenAPI webhooks](https://spec.openapis.org/oas/) describe webhook operations; API description does not implement delivery/security.

**Verification:** signature known-answer tests; tampered body/stale timestamp/replay rejection; duplicate and out-of-order handling; retry schedule and retry exhaustion; endpoint timeout/redirect/private IP/DNS change refusal; cross-org subscription isolation; disable/revoke/replay authorization; queue outage recovery; no secret/payload leakage in logs.

**Anti-patterns:** no fire-and-forget HTTP calls in request handlers; no unsigned callback; no credentials in webhook body/URL; no assume-once delivery; no unbounded retry or sensitive full-record fanout.

### Phase 7 — Scale, resilience, and operational controls

**Outcome:** the interface stays bounded and observable as partner count and data volume grow.

1. Measure agreed read and delivery workloads. Add indexes/materialized read models only from measured query plans and owned-module approval; preserve one table owner and source of truth.
2. Establish per-tenant/key quotas, concurrency/backpressure, queue partition/fairness, maximum lag, high-water alerts, and customer-visible health/status without exposing another tenant’s data.
3. Define and implement export jobs for large authorized extracts: job lifecycle, snapshot/as-of semantics, encryption/storage, short-lived download access, expiry/deletion, cancellation, audit, and retry/idempotency.
4. Test recovery after consumer downtime, cursor loss, webhook backlog, partial export, source lag, key rotation, and deployment rollback. Define service objectives only after measurements and operational ownership are approved.
5. Add dashboards/alerts and runbooks for keys, data freshness, API quotas/429s, 5xx, slow queries, webhook delivery lag/failures, dead letters, replay, and customer offboarding.

**Verification:** load tests at measured target volumes; fairness between tenants; cursor/export consistency under concurrent writes; backpressure and recovery; retention expiry; incident and key-revocation runbook exercise.

**Anti-patterns:** no premature microservices, cache, or queue replacement; no customer SLA without measurement and on-call ownership; no export link without expiry and authorization.

### Phase 8 — Security, contract, and release verification

**Outcome:** all approved endpoints and webhooks pass the full release gate before external production access.

1. Run the documented auth matrix and cross-tenant/object/property tests for all operations and webhook management/delivery paths.
2. Validate OpenAPI against implementation and schemas; enumerate deployed hosts/routes/versions; check no debug/test endpoints or obsolete routes are accidentally exposed.
3. Complete threat review covering credential theft, cross-tenant access, excess property release, location misuse, SSRF, replay, resource exhaustion, business-flow abuse, unsafe upstream data, and webhook/export leakage, mapped to the current official OWASP API Security Top 10.
4. Verify audit/read logs, redaction, retention, RLS, migration ordering, module boundaries, size/function limits, route auth inventory, and CI gates against root `CLAUDE.md`, `apps/api/CLAUDE.md`, and `docs/MIGRATION-DISCIPLINE.md`.
5. Pilot with one approved integration and synthetic or explicitly authorized data. Verify delivery, freshness, corrections, revocation, recovery, customer support, and measured limits before production credentials.
6. Roll out per integration/resource behind explicit enablement; monitor; provide immediate revoke/disable and rollback; only then approve broader production access.

**Verification:** signed security and product-owner release checklist with links to passing CI/evidence, deployed contract/version, access grant, runbooks, and pilot results.

**Anti-patterns:** no production enablement with unresolved policy, scope, tenant, data-quality, retention, incident-response, or source-readiness questions; no “tests pass” as a substitute for proving field-level authorization and tenant isolation.

## 7. Execution and session handoff protocol

- Work on one phase at a time; update this document with discoveries and decisions before crossing its exit gate.
- Every factual statement added during refinement cites an exact repository path/line, migration, test title, measured output, or official documentation URL and retrieval/version date.
- Each step records: **status** (`not started`, `investigating`, `blocked`, `verified`), evidence, decision, artifacts/PR, verification result, and next action. A blocker is explicit with owner and resolution step; never route around it or leave an assumption implied.
- Recheck repository guidance and current target-branch state in each new chat. Preserve unrelated working-tree changes. The plan file remains the single source of plan state; do not create competing copies or side plans without recording their relationship here.
- A phase marked `verified` has evidence and an exit-gate signoff in this document. Do not mark complete based on intent or implementation alone.
- At each phase boundary, append a dated handoff note with current phase, completed evidence, outstanding blocker(s), exact next step, active branch/PR, and relevant file locations. If no blocker remains, state `none`.

### Progress ledger

| Phase | Status | Evidence / PR | Next action |
|---|---|---|---|
| 0 — Baseline and requirement discovery | Not started | Blueprint created from `origin/main` snapshot; discovery must be rerun on implementation target | Inventory current routes, owners, consumer requirements, data availability, and field policy |
| 1 — Contract and OpenAPI | Not started | — | Begins after Phase 0 exit gate |
| 2 — Integration identity and keys | Not started | — | Begins after Phase 1 decisions |
| 3 — Auth and authorization boundary | Not started | — | Begins after Phase 2 lifecycle design |
| 4 — Canonical resource reads | Not started | — | Begins after approved per-resource contracts |
| 5 — OpenAPI publication and consumer package | Not started | — | Begins after API implementation contract is stable |
| 6 — Outbound webhooks | Not started | — | Can begin after identity/auth and event contract gates |
| 7 — Scale and operations | Not started | — | Begins after measured pilot workload |
| 8 — Release verification | Not started | — | Required before each external production enablement |

## 8. Documentation references

### Repository contract and reusable patterns

- [`CLAUDE.md`](../../../CLAUDE.md) — module boundaries, shared contracts, tenant scoping, migration discipline, plan conventions.
- [`apps/api/CLAUDE.md`](../../../apps/api/CLAUDE.md) — router/auth/audit/query rules.
- [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) — collectors/core/harness, module/table ownership and boundaries.
- [`docs/SILVICOM-360.md`](../../SILVICOM-360.md) — product scope and source inventory; validate current status before promising coverage.
- [`docs/MIGRATION-DISCIPLINE.md`](../../MIGRATION-DISCIPLINE.md) — schema rollout and migration ordering.
- `apps/api/src/lib/ingestToken.ts` + `.test.ts` — existing one-time bearer token/hash pattern; inbound-only reference.
- `apps/api/src/modules/mcleod/routes/tmsIngest.ts`, `apps/api/src/modules/mcleod/tmsIngest.ts` — existing integration identity binding and lifecycle; inbound-only reference.
- `apps/api/src/app.ts`, `apps/api/src/routeAuth.test.ts`, `apps/api/src/testing/routeLedger.ts` — route mounting, rate limiting, authentication inventory.
- `apps/api/src/testing/supabaseRecorder.ts` — `expectOrgScoped` proof for service-role tenant filtering.
- `apps/api/src/modules/livemap/` and `apps/api/src/modules/samsara/index.ts` — position composition and source ownership to assess, not to expose blindly.

### Official external references

- [OpenAPI Initiative — OpenAPI Specification versions and schemas](https://spec.openapis.org/oas/) — verify and pin the chosen version/tool compatibility at Phase 1; do not infer tool support from the specification alone.
- [OWASP API Security Top 10 (2023)](https://api-security.owasp.org/editions/2023/en/0x11-t10/) — threat checklist for object/property/function authorization, resource consumption, SSRF, inventory, and unsafe API consumption. Recheck for a newer official edition at Phase 0/8.
- [RFC 6750 — OAuth 2.0 Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750) — bearer-token transport/security guidance applicable to API-key bearer credentials; this does not require adopting OAuth.
- [GitHub Docs — Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) — official implementation example for HMAC-SHA256 payload signature and constant-time comparison; verify generic event/timestamp/replay semantics separately before adopting a provider-specific format.

## 9. Decision log

| ID | Date | Decision | Evidence/status |
|---|---|---|---|
| D-PAPI-1 | 2026-09-28 | Build a controlled outbound data API over FuelGuard’s owned/normalized/derived data; consumers do not integrate with internal collectors or tables. | User direction; aligned with `docs/ARCHITECTURE.md` collectors → core → harness. |
| D-PAPI-2 | 2026-09-28 | API keys authenticate consumer reads; webhooks notify consumers of changes; webhook signing secret is separate. | User direction. Lifecycle/security design is detailed in this plan. |
| D-PAPI-3 | 2026-09-28 | The plan must include all applicable domains, including loads and positions, while only releasing a domain after source/owner/data/access readiness is proven. | User direction; Phase 0 and §5 enforce readiness. |
| D-PAPI-4 | 2026-09-28 | This blueprint lands on an isolated branch/PR, separate from the active Claude Code checkout. | User direction; branch `claude/outbound-data-api-blueprint` is based on `origin/main`. |

### Handoff — 2026-09-28

**Current phase:** Phase 0 is not started; this document is the blueprint only.
**Verified snapshot:** isolated base `origin/main` at `752e8cc`; repo architecture/auth/integration patterns and official OpenAPI/OWASP references were reviewed to draft the gates.
**Outstanding:** run Phase 0 against the target branch before implementation; name the first consumer/use case; remeasure domains, population, freshness, route/tooling state, and policy. No API implementation has been authorized by this plan.
**Next action:** review this blueprint, then execute Phase 0 and update this same file with measured evidence and locked decisions before building Phase 1.
