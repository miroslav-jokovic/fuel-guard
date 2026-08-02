# FuelGuard — Architecture Audit (ranked findings)

**Date:** 2026-08-01 · **Scope:** whole monorepo — `apps/api`, `apps/web`, `apps/admin`, `apps/admin-api`, `packages/*` (main), and the driver app (`feat/driver-app-phase0`). **Method:** four parallel auditors (boundary leaks, oversized modules, RLS/authz, scale hotspots), each evidence-based with file:line. The one security finding (P1‑A) was independently re-verified by reading the code.

## Headline verdict

The architecture is genuinely well-built and the modular boundaries that were designed in are largely holding — but by **evidence**, the honest "scale caveat" I gave earlier is bigger than just hazmat extraction. **The entire API is architecturally pinned to a single instance**: all heavy background work (hazmat vision, org-wide re-scoring backfills, ingest) runs in-process, throttled by *module-level* semaphores and *per-process* rate limiters, and the job-reclaim sweep actively corrupts state if a second instance boots. Nothing here is a design flaw that requires a rewrite — the module boundaries mean each piece can be lifted to a queue/worker cleanly — but this is the #1 thing to resolve before horizontal scale or heavy production load. Tenancy/security posture is strong (no cross-tenant *read* leak found; RLS enabled and org-scoped on every sensitive table), with one write-side defense-in-depth gap to fix.

Ranked P0 (do before scaling / prod load) → P3 (hygiene). Severity = impact × likelihood.

---

## P0 — Single-instance ceiling: all heavy work runs in-process

**A. Background jobs execute on the API event loop; boot-sweep is single-instance-only.**
`apps/api/src/services/jobs.ts:217‑257`. `runJob` runs work via fire-and-forget `void (async…)()` on the API's own event loop — including `backfillOrg` (scores every `fuel_transactions` row for an org, with live Samsara fetches), score-import cascade, nightly reconcile, EFS ingest — triggered by HTTP handlers. `reclaimInterruptedJobs` flips **every** `queued`/`running` job to `failed` with no instance/lease filter; its own comment says this only works as a single in-process instance.
*Impact:* one large-org backfill saturates CPU/DB connections and degrades latency for every tenant on that instance; the moment a 2nd instance (or a worker) boots, the reclaim sweep marks jobs running elsewhere as `failed`, corrupting state and abandoning in-flight work.
*Fix:* move job execution to a dedicated worker consuming a real queue (the `jobs` table can be the queue via `SELECT … FOR UPDATE SKIP LOCKED` + per-worker heartbeat/lease); replace the boot-sweep with lease expiry; never run backfill/scoring on request-serving instances.

**B. Hazmat photo-extraction orchestrator: in-process vision + image work behind a per-process semaphore.**
`apps/api/src/services/hazmatExtraction/orchestrate.ts:25‑34, 56‑165`. Per load: downloads N BOL blobs, CPU-bound `normalizeImage` + `sha256` (blocks the event loop), dual-pass Anthropic vision calls (holds the process seconds). Throttle is a module-level `let active` / `waiters[]`, `MAX_CONCURRENT = 2` — per process. Queued work lives only as in-memory promises (lost on restart, though the runId was already returned to the client). Same pattern in `hazmatAnalysis.ts:101‑113` (MAX_CONCURRENT=4).
*Impact:* single instance → only 2 extractions proceed, rest silently vanish on restart; multiple instances → the spend/DB throttle becomes `2 × instances` with no global coordination.
*Fix:* externalize to the queue/worker; move image normalization off the request process; make concurrency a distributed limit (consumer count / token bucket), not a module `let`.

**C. Per-process rate limiters & schedulers assume one instance.**
Samsara/SOAP pacing is a module-level `Map` (`apps/api/src/lib/samsaraHttp.ts:17`, `soapClient.ts:36`) — each process paces to the *full* RPS, so N instances = N× the cap → 429s. Schedulers (`apps/api/src/schedulers.ts`, `setInterval`) are guarded only by the `RUN_SCHEDULERS_IN_PROCESS` env flag with no leader election — two flagged instances double every nightly reconcile / digest / posted-price fetch.
*Fix:* distributed rate limiting per token (shared bucket, or pin a token's traffic to one worker); enforce a single scheduler owner via a leader lock, not just an env flag.

> P0‑A/B/C are one theme: **externalize async work + per-process state to a worker + shared store, then the API tier is stateless and horizontally scalable.** The module boundaries already make this a lift-and-shift, not a rewrite.

---

## P1 — Small, high-value correctness & performance fixes

**A. (SECURITY, verified) Cross-tenant deletion of `load_stops` via `updateLoad` → `replaceStops`.**
`apps/api/src/services/dispatchLoads.ts:233` (update), `:239` (`if (stops) replaceStops`), `:122` (delete). The service-role client bypasses RLS, so code-level `org_id` scoping is the only tenant boundary. `updateLoad` runs `update(...).eq("org_id",orgId).eq("id",loadId)` but never checks a row was hit (a 0-row update is *not* an error), then unconditionally calls `replaceStops`, whose delete is `…from("load_stops").delete().eq("load_id", loadId).eq("status","pending")` — **no `org_id`**.
*Attack:* a dispatcher in Org A sends `PATCH /api/dispatch/loads/{ORG_B_LOAD_ID}` with `{ "stops": [] }` → parent update matches nothing (silently) → `replaceStops` deletes all of Org B's pending stops for that load (a non-empty array also upserts Org-A rows onto Org B's load). HIGH not CRITICAL only because it needs the victim's load UUID (not guessable).
*Fix:* in `updateLoad`, do a scoped `select("id").eq("org_id").eq("id").maybeSingle()` existence check → 404 before touching stops (its siblings `hazmatLoads.updateLoad` and `transitionLoad` already do this); and add `.eq("org_id", orgId)` to the delete/upsert in `replaceStops` as defense-in-depth.

**B. Per-org monthly token tally full-scans the org's entire run history — no supporting index.**
`apps/api/src/services/hazmatExtraction/orchestrate.ts:43‑53`, called before *every* extraction. `hazmat_runs.select("models, created_at").eq("org_id",…).gte("created_at", monthStart)` then sums the `models` jsonb **in JS**. Only indexes on `hazmat_runs` are `(org_id, input_hash)` and `(org_id, load_id, created_at desc)` — **no `(org_id, created_at)`** — so Postgres range-scans all of the org's runs for all time and drags every `models` blob over the wire.
*Fix:* add index `hazmat_runs (org_id, created_at)`; better, maintain a running `hazmat_token_usage(org_id, month)` counter incremented on insert instead of scan-and-sum.

**C. Unbounded reads that grow with history.**
`dispatchLoads.listLoads` (`:60‑64`) fetches *all* loads for an org (no `.limit()`/keyset) plus an `.in()` over every stop; report exports (`routes/reports.ts:34‑53`) pull the whole date-range of `fuel_transactions` into the API process. Fine now, a memory/latency spike (or OOM on the shared instance) for a large org later.
*Fix:* keyset-paginate `listLoads` (the `idx_loads_org_status_created` index supports it); stream/chunk exports and bound the max range.

---

## P2 — Guardrail coverage & maintainability

> **Status (2026-08-02):** **A, C, E resolved.** File-size guardrail is green — `fueling.ts` split into
> `routes/fueling/{plans,mapProxies,networks,stations}.ts` and `dispatchLoads.ts` into
> `services/dispatchLoads/{shared,queries,mutations}.ts` (0 files over budget). `integrations.ts` was
> re-slimmed 545→361 in WQ1c (dispatchJob replaced the copy-pasted job envelope). The boundary linter now
> covers the driver app (forward-looking; activates on merge), catches relative + dynamic-`import()` +
> no-slash-barrel cross-feature leaks, and enforces `@hazmat/engine` determinism/purity — with a self-test
> proving it fires. **B, D remain open** (max-function-length rule + the shared price/paging util).

**A. The file-size fitness check is currently RED and its allowlist is empty.**
`scripts/check-file-size.mjs` — `GRANDFATHERED` is empty, so `routes/fueling.ts` (546) and `routes/integrations.ts` (545) are **active, un-waived violations**, not "grandfathered" as previously assumed. Confirm whether CI gates on `lint:filesize`; if so it's red, if not the guardrail is decorative. *Fix:* split the two files (below) — the right move — rather than re-adding them to the allowlist.

**B. The worst complexity is *under* the line budget (the linter measures files, not functions).**
`scoring/scoreTransaction.ts:20‑416` is a **397-line single function** doing ~10 DB round-trip groups + ~15 branches (load → Samsara reconcile → history → reefer context → TMS gates → rules → anomaly correlate/persist → 25-col update → odometer learning). Similar: `askData.ts:146‑357` (`runTool`, 211 lines, 13-branch ladder), `fuelPlanning.ts:170‑379` (`planFuelRoute`, ~210 lines). *Fix:* extract the comment-delimited stages into context-loader functions, leaving lean orchestrators. Add a **max-function-length** rule so the budget can't be dodged by staying under the file line count.

**C. `fueling.ts` / `integrations.ts` tangle multiple domains.**
`fueling.ts`: fuel-plan CRUD + a HERE raster-tile proxy + geocode + **8** truck-stop ingest endpoints + a 121-line `/stations` read-model. `integrations.ts`: Samsara + McLeod/TMS + EFS-SOAP, with a job-envelope block copy-pasted 6×. *Fix:* split by domain (`fueling/{plans,map,networks}.ts`, `integrations/{samsara,tms,efsSoap}.ts`) and extract a `withJob(...)` helper.

**D. Duplicated price/paging logic + a 156-consumer barrel.**
The effective-price + 1000-row paging transform is duplicated across `fueling.ts:442‑538` and `fuelPlanning.ts:264‑326` (and the paging loop re-implemented in 6+ files). `@fuelguard/shared`'s barrel (`packages/shared/src/index.ts`, 53 re-exports) is imported by **156 files** — large blast radius, defeats tree-shaking. *Fix:* promote a shared `resolveCorridorPrices()` + `fetchAllPaged()`; offer subpath entrypoints (`@fuelguard/shared/smartFueling`).

**E. The boundary linter is blind to most of the repo.**
`scripts/check-feature-boundaries.mjs` only covers `apps/web/src/features` + the two hazmat packages. It does **not** cover the driver app — which already has a real cross-feature reach: `driver/src/features/loads/useLoads.ts:23‑24` imports `@/features/auth/SessionProvider` and `@/features/home/useDriverContext`. It also enforces **no** engine determinism/I/O purity (a future `Date.now`/`fetch` in engine logic would pass CI), and its cross-feature regex is bypassable via barrel (`@/features/x` no slash) or dynamic `import()`. *Fix:* parameterize `FEATURES` to multiple roots + run it in the driver repo; add a content scan banning `Date.now|Math.random|new Date(|fetch|node:|supabase` in `hazmat-engine/src`; tighten the regex; promote the shared driver hooks out of `features/`.

---

## P3 — Low / by-design (noted, not alarming)

- **`platform_org_overview`** (`0072`) pins `search_path = public` instead of `''` like every other definer function — hardening/consistency only (EXECUTE is service-role-only). 
- **Unmounted `notifications.ts` router** uses the service-role client with no `requireAuth` — dead code (not mounted); add the guard before anyone wires it.
- **Global-read reference tables** (`fuel_stations`, `route_geometries`, `fuel_prices_posted`) use `using(auth_org_id() is not null)` — intentional shared registries, no tenant data exposed. Conscious decision, not a leak.
- **`hazmat-data/import/`** ships a 35-file network/I/O tree inside the "pure data" package — build-time only, excluded from publish; consider moving to `@hazmat/data-import` to keep the purity claim clean.
- **`bulkTransition`** transitions loads sequentially — bounded by selection size; batch if selections grow.

---

## Confirmed healthy (balance)

- **No cross-tenant read IDOR.** Every id-based load/update in the mounted routers re-scopes `org_id` from the verified JWT (never from the request body); RLS is enabled on all 62 tables with `org_id = auth_org_id()` policies, driver tables further constrained by `auth_driver_id()`, and `org_modules` is select-only so an admin can't self-grant entitlements.
- **admin-api control plane** is strongly layered: JWT → AAL2 (MFA) → fresh platform-admin allowlist (instant revoke) → role → step-up for destructive actions.
- **Driver offline engine** (`data/sync.ts`, `outbox.ts`, `policy.ts`) is exemplary: serial per-device drain, exponential backoff with jitter capped at 5 min, `MAX_ATTEMPTS=8`, 7-day history prune, no full-table refetch. No scaling hotspot.
- Where the boundary + token + design linters actually look, the code is clean — no domain-purity leak, no `packages → apps` edge, no cross-feature reach in web/api.

---

## Suggested order of operations

1. **P1‑A** (cross-tenant `load_stops`) — a few lines, ship now.
2. **P1‑B** (`hazmat_runs(org_id, created_at)` index) — one migration.
3. **P2‑A** — decide the file-size gate's intent (split vs re-list) so CI reflects reality.
4. **P0** — plan the queue/worker extraction (jobs + hazmat + scoring backfill) with distributed concurrency/rate-limits + lease-based reclaim. Largest, but boundaries make it a lift-and-shift; sequence it before onboarding heavy-volume tenants or scaling horizontally.
5. **P2‑B..E** — split the god-function/route files, add the max-function-length + driver/determinism linter rules, dedupe the price/paging util.
