# Devin handoff — 2026-08-10 — Samsara HOS + Idling sync failure

**Task: verify, commit, push, open a PR, and apply migration `0174` to production.**

The code changes are **already made and left uncommitted in the working tree.** Do not re-derive the
fix. Your job is to validate it, land it, and get the migration applied in the right order.

---

## 1. What was broken (so you can recognise a bad verification result)

Both `sync_hos` and `sync_idle` were failing every run in the `jobs` ledger. Three defects, two of them
live in production, one latent.

### 1.1 — Partial `upsert` into `idle_park_sessions` violates NOT NULL (the live outage)

`syncIdleDutyEvidence` and `syncIdleEquipmentEvidence` each own a disjoint group of columns and expressed
"write only my columns" as a PostgREST upsert carrying only those columns. PostgREST compiles that to
`INSERT … ON CONFLICT (id) DO UPDATE`, and **Postgres evaluates NOT NULL on the proposed tuple before
conflict arbitration** — so the insert fails even though every targeted row already exists. Reproduced
against Postgres 16:

```
ERROR:  null value in column "vehicle_id" of relation "idle_park_sessions"
        violates not-null constraint
DETAIL: Failing row contains (…, null, null, null, null, null, null, 0, null, sufficient, 3600, 3600).
```

- `sync_hos`: `syncHosDutySegments` succeeded, then `syncIdleDutyEvidence` threw → job `failed`, and
  `syncIdleRollup` never ran, so the Idling page stayed stale even for data that did land.
- `sync_idle`: `syncIdleFoundation` died at step 4 of 6 → job `failed`; equipment evidence, learned
  envelopes and the rollup never ran.

Introduced by `1136ca7` (equipment) and `a4b85f4` (HOS duty). The unit tests passed because
`createSupabaseRecorder` is an in-memory fake with no constraints — `idleDutyEvidenceSync.test.ts` even
asserted the broken payload shape.

### 1.2 — `hos_covered_sec <= duration_sec` breaks when duration is re-derived (also live)

`0166` and `0167` declare check constraints that span two independently-written column groups. The
capability sync re-derives `duration_sec` from engine states on every run and millisecond rounding moves
it by a second; when it shrinks below an already-stored evidence value, the **capability** upsert fails.
Also reproduced:

```
ERROR:  new row for relation "idle_park_sessions" violates check constraint
        "idle_park_sessions_hos_counts_check"
DETAIL: … duration_sec 13448, hos_covered_sec 13450 …
```

Clamping at write time in one service cannot fix this — the violation is introduced by the other service
later — so the invariant now lives in a `BEFORE INSERT OR UPDATE` trigger.

### 1.3 — Shared idle/HOS dedup key starves `sync_hos` in queue mode (latent)

`dad6d9a` gave `sync_idle` and `sync_hos` the same `idleSyncDedupKey`. `idx_jobs_active_dedup`
(migration `0095`) is unique on `dedup_key` over `status in ('queued','running')`. Under
`JOB_EXECUTION_MODE=queue` the scheduler enqueues `sync_idle`, the row sits in `queued`, and the very next
`sync_hos` enqueue collides and is swallowed as a conflict at `samsaraScheduler.ts` — HOS would never be
enqueued at all. Dormant today only because the mode defaults to `inprocess`; it would fire on the WQ4
cutover. Removed, and no longer needed: each writer now owns a disjoint column group and writes it with a
set-based UPDATE, so concurrent runs converge instead of racing.

---

## 2. What is already in the working tree

**New**
- `supabase/migrations/0174_idle_session_evidence_writes.sql` — `apply_idle_hos_evidence(uuid, jsonb)`
  and `apply_idle_equipment_evidence(uuid, jsonb)` (set-based `UPDATE … FROM jsonb_to_recordset`, one
  round trip per 500-row chunk, tenant-scoped by `p_org`, `security definer`, revoked from
  public/anon/authenticated and granted only to `service_role`), plus the
  `idle_park_sessions_clamp_evidence` BEFORE trigger. Applied and exercised against a real Postgres 16
  with the 0076/0164/0166/0167 schema: clean apply, correct row counts, wrong-org updates 0 rows, unknown
  id updates 0 rows and creates nothing, `p_rows = null` is a no-op, and a `duration_sec` shrink now
  clamps instead of erroring.
- `packages/shared/src/hosVehicleTimeline.ts` — see §2.1.

**Changed**
- `apps/api/src/services/idleDutyEvidenceSync.ts`, `idleEquipmentEvidenceSync.ts` — write via the RPCs;
  `org_id` dropped from the row payload (it is the `p_org` argument now); `rowsWritten` is the count the
  database reports it actually changed rather than the size of the payload sent.
- `apps/api/src/services/jobs.ts`, `queue/dispatch.ts`, `samsaraScheduler.ts` — cross-kind idle/HOS dedup
  key removed; `sync_idle` and `sync_hos` get independent `(org, kind)` slots again. The reasoning is
  left as a comment in `jobs.ts` so nobody re-adds it.
- `apps/api/src/services/idleDutyEvidenceSync.test.ts`, `idleEquipmentEvidenceSync.test.ts` — assert the
  RPC contract and `p_org`; new regression guard fails if anyone reintroduces a direct write to
  `idle_park_sessions` from an evidence sync; new case covers `rowsWritten` when the DB changes 0 rows.

### 2.1 — Two pre-existing branch breakages, fixed because they block this PR

Neither was caused by the sync fix; both fail CI on this branch as it stands.

- **`packages/shared/src/hos.ts` was 505 lines, over the hard 500 budget** (`7ff6bea` added the vehicle
  timelines). Split: `buildHosVehicleTimeline`, `buildHosVehicleTimelines`,
  `hosVehicleTimelineOverlapSeconds` and the two timeline interfaces moved to
  `packages/shared/src/hosVehicleTimeline.ts`, re-exported from the package index. **The exported symbol
  set of the package is byte-identical before and after** — verified by diffing the export lists. Only
  two files import from `./hos.js` directly (`hos.test.ts`, `idleRollup.ts`) and both were updated.
- **`apps/api/src/lib/samsara.ts` grew past its 640-line waiver pin to 670.** `7ad0eec` ran Prettier over
  that file and it re-wrapped ~30 long argument lines; the only behavioural line in that commit was the
  `{ maxRps: 5 }` HOS cap. Re-pinned to 670 with that reasoning inline, per the "re-pinning upward is a
  deliberate, reviewable act" rule in `check-file-size.mjs`. **The split is still owed** — flag it in the
  PR description.
- `scripts/check-waiver-growth.mjs` was pointing its probe at `apps/api/src/lib/efsSoap.ts`, which left
  the waiver list on 2026-08-10; the probe was therefore asserting against an unwaived file and failing
  for the wrong reason. Repointed at `samsara.ts`. Not in CI (it runs under `mutation:check`), but it
  was a broken self-test.

### 2.2 — Not mine, decide yourself

`scripts/idle-confidence-diagnose.mjs` is untracked and predates this work. Commit it separately or
leave it — do not fold it into the fix commit.

---

## 3. What I could NOT verify here, and you must

`node_modules` in the working copy was installed for darwin-arm64 and the sandbox is linux-arm64, so
**vitest cannot start** (`Cannot find module './rolldown-binding.linux-arm64-gnu.node'`). **The unit
suite has not been run against these changes.** Run it first, before anything else.

What I did run clean, on the working tree as handed to you:

| Check | Result |
|---|---|
| `tsc --noEmit` (`packages/shared`, `apps/api`) | pass, no output |
| `eslint` on all 12 changed/new TS files | pass |
| `check-file-size` / `check-function-size` / `check-migration-versions` / `check-rls` / `check-test-collection` / `check-feature-boundaries` / `check-waiver-growth` | pass |
| `0174` applied + functionally exercised on Postgres 16 | pass |

---

## 4. Do this

### Step 1 — verify
```bash
pnpm install --frozen-lockfile
pnpm --filter @fuelguard/shared build:rn
pnpm lint
pnpm lint:filesize && pnpm lint:funcsize && pnpm lint:migrations && pnpm lint:tests && pnpm lint:boundaries
pnpm typecheck
pnpm test            # ← the one that has NOT been run; the whole point of this step
pnpm build
```
If `pnpm test` fails, **stop and report the failure — do not "fix" it by loosening an assertion.** The
new tests assert the RPC contract deliberately.

### Step 2 — branch and commit
`feat/efs-card-control-phase-a` is currently level with `origin/main`, and this fix is unrelated to EFS
card control. Put it on its own branch so it can ship without waiting on that review.

```bash
git checkout -b fix/idle-hos-sync-evidence-writes
git add supabase/migrations/0174_idle_session_evidence_writes.sql \
        packages/shared/src/hosVehicleTimeline.ts \
        apps/api/src/services/idleDutyEvidenceSync.ts \
        apps/api/src/services/idleDutyEvidenceSync.test.ts \
        apps/api/src/services/idleEquipmentEvidenceSync.ts \
        apps/api/src/services/idleEquipmentEvidenceSync.test.ts \
        apps/api/src/services/jobs.ts \
        apps/api/src/services/queue/dispatch.ts \
        apps/api/src/services/samsaraScheduler.ts \
        packages/shared/src/hos.ts \
        packages/shared/src/hos.test.ts \
        packages/shared/src/idleRollup.ts \
        packages/shared/src/index.ts \
        scripts/check-file-size.mjs \
        scripts/check-waiver-growth.mjs \
        docs/plans/DEVIN-HANDOFF-2026-08-10-IDLE-HOS-SYNC.md
git commit -F- <<'MSG'
Fix idle and HOS evidence writes against the session table

sync_hos and sync_idle were both failing every run. Each evidence sync owns a
disjoint group of columns on idle_park_sessions and expressed that as a PostgREST
upsert carrying only those columns. PostgREST compiles an upsert to INSERT ... ON
CONFLICT DO UPDATE, and Postgres evaluates NOT NULL on the proposed tuple before
conflict arbitration, so the write failed with a not-null violation on vehicle_id
even though every targeted row already existed. sync_hos died before syncIdleRollup
ran, which is why the Idling page also went stale.

Replace both writes with set-based UPDATE RPCs (migration 0174), one round trip per
chunk, tenant-scoped by argument rather than by a column in the payload. rowsWritten
now reports what the database changed instead of the size of the payload sent.

The same table's 0166/0167 check constraints span two independently-written column
groups: the capability sync re-derives duration_sec every run and rounding moves it
by a second, which failed that upsert when a stored hos_covered_sec no longer fit.
Clamping in one service cannot hold an invariant the other service breaks later, so
0174 adds a BEFORE trigger that clamps the derived seconds to duration_sec.

Drop the shared sync_idle/sync_hos dedup key. It rides the global active-dedup index
over queued AND running, so under JOB_EXECUTION_MODE=queue the sync_idle row sitting
in 'queued' would have made every sync_hos enqueue a swallowed conflict. With each
writer owning disjoint columns and using an UPDATE, concurrent runs converge and the
mutex is not needed.

Also unblocks CI on this branch: split hos.ts (505 lines) into hos.ts +
hosVehicleTimeline.ts with an identical exported symbol set, and re-pin the
samsara.ts waiver to 670 after 7ad0eec's formatter pass.
MSG
git push -u origin fix/idle-hos-sync-evidence-writes
```

Open a PR into `main`. In the description, carry over §1 and note that `samsara.ts` still owes a split.

### Step 3 — apply the migration

Order matters. Railway auto-deploys the API on `main`; `.github/workflows/migrate.yml` applies
migrations on `main` but only after CI is green. If the API lands first, the evidence syncs fail with
`function apply_idle_hos_evidence does not exist` instead of the not-null error — no worse than today,
but avoidable. **Apply `0174` via the CLI before the merge lands.** It is additive and idempotent
(`create or replace`, `drop trigger if exists`), so applying it early is safe against the current code.

```bash
supabase login
supabase link --project-ref nsjszqnfppczbnligxll   # matches supabase/config.toml
supabase migration list --linked                   # inspect BEFORE — expect 0173 as the head
supabase db push                                   # applies only unapplied files, in order
supabase migration list --linked                   # verify 0174 is now recorded remotely
```

If `migration list` shows drift (a local file the remote never applied, or vice versa), **stop** and
follow `docs/MIGRATION-DISCIPLINE.md` rather than forcing the push — this repo has been bitten by ledger
drift twice (`49b783a`, `3789ef5`).

Confirm the objects landed:
```sql
select proname, prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and proname in ('apply_idle_hos_evidence','apply_idle_equipment_evidence');
select tgname from pg_trigger where tgname = 'trg_idle_park_sessions_clamp_evidence';
-- must both be false:
select has_function_privilege('anon','public.apply_idle_hos_evidence(uuid,jsonb)','execute'),
       has_function_privilege('authenticated','public.apply_idle_hos_evidence(uuid,jsonb)','execute');
```

### Step 4 — confirm the outage is over

After the API redeploys, trigger a manual sync from **Data & Sync** (or wait one driver-score tier
cycle) and check the ledger:

```sql
select kind, status, error, finished_at, stats
  from jobs
 where kind in ('sync_hos','sync_idle')
 order by created_at desc limit 10;
```

Expected: `status = 'done'` for both, no `error`, and in `stats` — non-zero `dutyEvidenceRowsWritten`,
`equipmentEvidenceRowsWritten` and `rollupWritten`. A `rowsWritten` of 0 with a non-zero `sessions` count
means the UPDATE matched nothing: check `p_org` and whether the sessions were reconciled away, do not
assume success. Then load the Idling page and confirm the day rows are current.

---

## 5. Do not

- Do not "fix" a failing new test by relaxing it. The `expectNoSessionTableWrite` guard and the
  `not.toHaveProperty("org_id")` assertions are the regression protection for this exact incident.
- Do not reintroduce an upsert on `idle_park_sessions` from an evidence sync — that is the bug.
- Do not re-add a shared dedup key across `sync_idle` and `sync_hos`.
- Do not hand-apply SQL in the dashboard. Migrations go through the CLI or the workflow only.
- Do not edit `0166`/`0167` or any other already-applied migration.

## 6. Rollback

Code: revert the commit. Database: the migration is additive; to undo it,

```sql
drop trigger if exists trg_idle_park_sessions_clamp_evidence on public.idle_park_sessions;
drop function if exists public.idle_park_sessions_clamp_evidence();
drop function if exists public.apply_idle_hos_evidence(uuid, jsonb);
drop function if exists public.apply_idle_equipment_evidence(uuid, jsonb);
```

Reverting the code without dropping the functions is harmless — they just go unused. Dropping the
functions without reverting the code puts both syncs back to failing.
