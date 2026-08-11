# Devin handoff — 2026-08-10 — Idling sync, round 2

Round 1 (`fd0ae06`, migration `0174`) is merged and deployed, and it worked: `sync_hos` went green at
19:10 UTC (3.8m, `dutyEvidenceRowsWritten: 13025`, no `dedup_key` on the row). `sync_idle` now gets five
stages further and dies on stage 6 of 6, 26.7 minutes in.

**The changes for round 2 are already made and left uncommitted in the working tree.** Validate, land,
apply `0175`.

---

## 1. What is still failing

```
[sync_idle] FAILED  ran 26.7m  started 2026-08-10T19:10:57Z
  ERROR: Idle learned envelope learned-envelope upsert failed:
         null value in column "unit_number" of relation "vehicles" violates not-null constraint
```

The **third** instance of the round-1 defect, in `idleLearnedEnvelopeSync.ts`. It upserts
`{id, org_id, idle_learned_envelope_*}` onto `vehicles` with `onConflict: "id"`.
`vehicles.unit_number` and `vehicles.tank_capacity_gal` are NOT NULL with no default (migration `0003`),
and Postgres evaluates NOT NULL on the proposed tuple before conflict arbitration, so the write fails on
rows that already exist. Reproduced verbatim on Postgres 16.

It was invisible until round 1 shipped, because stages 2–5 were failing first.

It is also the wrong verb on principle. `vehicles` is the fleet identity table; an upsert that Postgres
DID accept would let an evidence job create or overwrite vehicle rows. An UPDATE cannot.

---

## 2. What is in the working tree

**New**
- `supabase/migrations/0175_idle_learned_envelope_writes.sql` — `apply_idle_learned_envelope(uuid, jsonb)`,
  the same set-based `UPDATE … FROM jsonb_to_recordset` pattern as `0174`, tenant-scoped by `p_org`,
  `security definer`, revoked from public/anon/authenticated, granted to `service_role`. Verified against
  a real Postgres 16 with the `0003`/`0168` column set: applies clean, updates 1 row for the right org,
  **0** for a different org, **0** for an unknown vehicle id **and creates no row**, no-ops on a null
  payload, and `anon`/`authenticated` have no EXECUTE.
- `scripts/check-partial-upserts.mjs` — the fitness gate for this whole class. See §3.
- `scripts/idle-sync-diagnose.mjs` — read-only live diagnostic that produced the evidence above; it
  prints the failing jobs with their error text and durations, distinct-vehicle coverage per table,
  anything wedged with an expired lease, and whether the `0174`/`0175` functions exist. Run it before and
  after the deploy.

**Changed**
- `apps/api/src/services/idleLearnedEnvelopeSync.ts` — writes via the RPC; `org_id` dropped from the row
  payload; `rowsWritten` is now what the database reports it changed.
- `apps/api/src/lib/samsaraHttp.ts`, `apps/api/src/env.ts` — **every Samsara request now carries a
  per-attempt deadline** (`SAMSARA_REQUEST_TIMEOUT_MS`, default 120s). It had none, while every other
  outbound client in the repo sets one (`mailer` 10s, `openMeteo` 15s, `soapClient`, `lovesApiClient`,
  `kwikTripIngest`, `roadRangerIngest`, `postedPriceFetch`). Without it a hung connection waited on
  undici's 300s default and `SAMSARA_MAX_RETRIES=4` paid it five times — up to ~25 minutes for one page,
  and the stats-history fetchers issue two paginated sequences per batch. A timed-out attempt is now an
  ordinary retryable network error.
- `apps/api/src/services/idleFoundationSync.ts` — **every stage is timed**, the totals ride in the job's
  `stats.stageMs`, and a stage that throws is wrapped with its own name, its own duration, and how far
  into the run it died. This job runs 26 minutes across six stages against two systems; when it failed,
  the ledger showed one line of SQL text and no indication of which stage produced it. That is why this
  took three rounds to walk out.
- `apps/api/src/services/queue/handlers/samsara.ts`, `samsaraScheduler.ts` — surface `stageMs`.
- Tests: RPC contract + `expectNoVehicleTableWrite` guard for the learned envelope; three new
  `samsaraFetch` deadline cases; stage-timing and failing-stage-naming cases for the foundation.
- `package.json`, `.github/workflows/ci.yml` — `lint:upserts` wired in as a CI step.

---

## 3. The gate — read this before touching it

`scripts/check-partial-upserts.mjs` exists because the same defect shipped three times in three days:

| service | table | shipped in |
|---|---|---|
| `idleEquipmentEvidenceSync` | `idle_park_sessions` | `1136ca7` |
| `idleDutyEvidenceSync` | `idle_park_sessions` | `a4b85f4` |
| `idleLearnedEnvelopeSync` | `vehicles` | `1136ca7`, surfaced only after the first two were fixed |

Nothing caught any of them: the service tests use an in-memory Supabase fake with no constraints, so all
three shipped green.

It derives required columns (NOT NULL, no DEFAULT) from the migration ledger and applies two rules —
**A**: an inline object-literal payload is compared key-by-key, whatever its conflict target; **B**: an
opaque payload keyed on `onConflict: "id"` is banned outright. Known blind spot, stated in the file: an
opaque payload on a *composite* conflict target is not checked.

Verified both directions — clean on the current tree, and reverting **each** of the three services to its
buggy write makes it fail naming that service and its missing columns. It also flagged five call sites
that turned out to use ES6 shorthand keys and three where a `.from()` paired with an unrelated later
`.upsert()`; both were extractor bugs and are fixed. The remaining allowlist entries
(`hazmat_documents`, `hazmat_loads`, `documents`) are genuine complete-row insert-or-skip writes, each
checked by hand against the table's required columns.

I also hand-audited every other write in the idle path against the ledger — `idle_events`,
`idle_settings`, `driver_vehicle_assignments`, `vehicle_engine_days`, `idle_park_sessions`,
`idle_telemetry_windows`, `idle_rollup_days`, `hos_duty_segments`. All carry their required columns.
**After `0175` there is no remaining not-null landmine in this job.**

---

## 4. Verified here / not verified here

Clean on the tree as handed to you: `tsc --noEmit` for `packages/shared` and `apps/api`; `eslint` over
`apps/api/src`, `packages/shared/src` and both new scripts; `check-partial-upserts`,
`check-file-size`, `check-function-size`, `check-migration-versions`, `check-rls`,
`check-test-collection`, `check-feature-boundaries`, `check-waiver-growth`; and `0175` applied and
functionally exercised on Postgres 16.

**Not verified: `pnpm test`.** The working copy's `node_modules` is a darwin-arm64 install and this
sandbox is linux-arm64, so vitest cannot load its rolldown binding. Run it first.

---

## 5. Do this

```bash
pnpm install --frozen-lockfile
pnpm --filter @fuelguard/shared build:rn
pnpm lint && pnpm lint:upserts
pnpm lint:filesize && pnpm lint:funcsize && pnpm lint:migrations && pnpm lint:tests && pnpm lint:boundaries
pnpm typecheck
pnpm test            # ← the one that has NOT been run
pnpm build
```

Then branch, commit, push, PR into `main`:

```bash
git checkout -b fix/idle-learned-envelope-write
git add supabase/migrations/0175_idle_learned_envelope_writes.sql \
        scripts/check-partial-upserts.mjs scripts/idle-sync-diagnose.mjs \
        apps/api/src/services/idleLearnedEnvelopeSync.ts \
        apps/api/src/services/idleLearnedEnvelopeSync.test.ts \
        apps/api/src/services/idleFoundationSync.ts \
        apps/api/src/services/idleFoundationSync.test.ts \
        apps/api/src/services/queue/handlers/samsara.ts \
        apps/api/src/services/samsaraScheduler.ts \
        apps/api/src/lib/samsaraHttp.ts apps/api/src/lib/samsaraHttp.test.ts \
        apps/api/src/env.ts package.json .github/workflows/ci.yml \
        docs/plans/DEVIN-HANDOFF-2026-08-10-IDLE-SYNC-ROUND-2.md
git commit -F- <<'MSG'
Fix the learned-envelope write and make idle sync failures diagnosable

Third instance of the round-1 defect. syncIdleLearnedEnvelopes owns only the
idle_learned_envelope_* columns on vehicles and wrote them with a partial upsert
keyed on the primary key. Postgres evaluates NOT NULL on the proposed tuple before
conflict arbitration, and vehicles.unit_number and vehicles.tank_capacity_gal are
NOT NULL with no default, so the write failed on rows that already existed. It was
invisible until 0174 shipped and stages 2-5 stopped failing first; sync_idle then
reached stage 6 of 6 and died there 26 minutes into every run.

Replace it with a set-based UPDATE RPC (migration 0175). An UPDATE is also the only
correct verb here: vehicles is the fleet identity table, and an upsert Postgres DID
accept would let an evidence job create rows in it.

Add scripts/check-partial-upserts.mjs and wire it into CI. It derives required
columns from the migration ledger and rejects both an inline payload that omits one
and an opaque payload keyed on the primary key alone. Reverting any of the three
services to its buggy write fails the gate.

Give samsaraFetch a per-attempt deadline. It was the only outbound client in the repo
without one, so a hung connection waited on undici's 300s default and each of the
four retries paid it again.

Time every stage of syncIdleFoundation and name the failing one in the error. A
26-minute six-stage job that reported one line of SQL text and nothing about where it
came from is what made this take three rounds.
MSG
git push -u origin fix/idle-learned-envelope-write
```

### Apply `0175` before the merge lands

Railway deploys the API on `main`; `migrate.yml` applies migrations on `main` but only after CI is green.
If the API lands first the sync fails with `function apply_idle_learned_envelope does not exist` instead
of the not-null error. `0175` is additive and idempotent (`create or replace`), so applying it early is
safe against the currently deployed code.

```bash
supabase login
supabase link --project-ref nsjszqnfppczbnligxll
supabase migration list --linked        # expect 0174 as the head
supabase db push
supabase migration list --linked        # expect 0175
```

Drift → stop and follow `docs/MIGRATION-DISCIPLINE.md`; do not force the push.

### Confirm

```bash
node scripts/idle-sync-diagnose.mjs
```

`sync_idle` should be `DONE`, with `stats.stageMs` giving a per-stage breakdown, non-zero
`learnedEnvelopeRowsWritten`, and `rollupWritten` set. If it fails again, the error now names the stage —
paste that.

---

## 6. Two things this investigation surfaced that are NOT fixed here

**`sync_hos` rewrites half its window every run.** Both successful runs report
`removed: 31469, upserted: 66454` out of `fetched: 124419` — identical at 16:47 and 19:10. The
diff-before-write in `hosSync` exists precisely so a steady-state run writes near zero. One hypothesis:
`fetchHosLogsChunked` anchors its 7-day chunk boundaries to `now`, so they slide every run and
re-segment the same history at different points, orphaning the previous run's rows. The numbers are
larger than that alone explains. Needs its own investigation.

**`efs_process_import` is failing continuously.** The last ten failed jobs of any kind are all
`[scoring] atomic persistence failed for <uuid>: numeric field overflow` in `persist_scoring_outcome`.
Unrelated to idle, currently live.

**`pnpm lint:filesize` is red on `main` right now, from someone else's commit.**
`packages/hazmat-engine/src/placards/compute.ts` is 593 lines against a hard 500 budget, introduced by
`59e93d6 fix(hazmat): placard sizing, §172.332(c) ID-on-placard, weight/packaging verification`. Left
alone deliberately — it is active work in another module and not this PR's to split — but CI will fail
on it, so it has to be resolved by whoever owns that commit before this branch can merge.
