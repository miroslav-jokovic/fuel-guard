# Migration Discipline (runbook)

Goal: `supabase/migrations/` is the **single source of truth** for the database, applied only through
the CI pipeline (`.github/workflows/migrate.yml`, which runs `supabase db push` on merges to `main`
that touch `supabase/migrations/**`). The hand-written `supabase/_deploy/*.sql` files are a legacy
manual path that has drifted from reality at least once and should be retired.

These steps need the **Supabase CLI + DB access**, so they run on your machine, not in this session.

## 1. Confirm production matches migrations/ (no drift)
```bash
supabase link --project-ref <YOUR_PROJECT_REF>   # once
supabase db diff --linked --schema public        # shows anything in the DB not represented by migrations/
```
- Empty diff → you're clean; skip to step 3.
- Non-empty diff → the live DB has objects (columns/indexes/policies) that no numbered migration creates.
  This is the drift the `_deploy/reconcile_schema.sql` file was papering over.

## 2. Capture drift as a real migration
For anything the diff reports (cross-check against `supabase/_deploy/reconcile_schema.sql` and the
`apply_00xx.sql` files), add it as the next numbered migration so the numbered set is complete:
```bash
# create supabase/migrations/00NN_reconcile_drift.sql with the missing DDL (idempotent: IF NOT EXISTS)
supabase db diff --linked --schema public --file 00NN_reconcile_drift   # can generate it for you
```
Re-run `supabase db diff` until it is empty. Now `migrations/` fully describes the DB.

## 3. Retire the manual path
- Move `supabase/_deploy/` into `_to_delete/` (or delete on your machine) — nothing should apply SQL by hand anymore.
- Update `apps/api/src/services/schemaCheck.ts`: the warning currently tells operators to
  "Apply supabase/_deploy/reconcile_schema.sql". Change it to "a migration is unapplied — the migrate
  workflow will apply it on the next deploy" (no manual step).

## 4. Guardrail (optional, once clean)
Add a CI check that fails if `supabase db diff` is non-empty on a PR, so drift can never reappear.
(Requires the Supabase CLI + a read-only DB connection secret in CI.)

## Invariant going forward
Change the schema **only** by adding a numbered file to `supabase/migrations/`. Never edit an applied
migration; never hand-apply SQL. The pipeline is the only door.

## The deploy window — a merge is served ~9 minutes before its migration is applied

Two pipelines start from the same merge and finish at different times:

| | |
|---|---|
| **Railway** | deploys on push to `main`, immediately (its own GitHub integration, `railway.json` `watchPatterns`). Nothing in this repository triggers or orders it. |
| **`migrate.yml`** | waits for **CI green** before touching production Supabase — deliberately. It used to run in parallel, so a push with a red test suite still applied migrations (audit 2026-08-09, finding 3.1). It fails closed now. |

Measured on the #430 merge, 2026-09-01:

```
15:33:00Z  merge to main
15:36:01Z  Railway is serving the new API        ← new code, OLD schema
15:44:37Z  CI green
15:45:11Z  migrate.yml applies 0284              ← window closes
```

**Nine minutes and ten seconds** of new code against the previous schema. `deploy-verify.yml`
already models this as normal: it polls for `schema.state = "current"` for up to fifteen minutes and
treats "commit matches, schema behind" as a transient state rather than a failure.

### The window narrowed sharply on 2026-09-05 — and that is not a reason to relax

Everything above is still the right shape, but the eight and a half minutes between "Railway is
serving" and "migrate.yml applies" was mostly **CI queueing behind itself**. Splitting ci.yml into
six parallel jobs took a green run from 15.7 minutes to 3.0 (measured on run 33951043123: 181s wall
against 940s before). `migrate.yml` starts within a minute of CI going green, so the gap is now
roughly a minute rather than nine.

Three things follow, and the second is the one that bites:

1. **The two-merge rule does not change.** A shorter window is still a window.
2. **You can no longer watch for it.** Nine minutes was long enough to notice a 500 and roll back
   inside it. A minute is not. The gate (`lint:migration-ordering`) stops being a backstop for
   human vigilance and becomes the only thing standing there.
3. **The order is no longer guaranteed.** At 3 minutes for Railway and ~4 for migrate the two
   pipelines are close enough that queue time can reorder them, so a merge may now find the NEW
   schema already applied. That is harmless for an added column and is the *safer* direction — but
   it means "the schema is always behind" is no longer a fact you can lean on, in either direction.

The exact new figure wants re-measuring the first time a migration merges to main; it is stated here
as ~1 minute from the CI and migrate timings, not from a stopwatch on a real migration merge.

### What that means for you

**Every merge must work against the schema of the merge before it.** #430 did not: migration 0284
added `renderer_version` and `template_revision` to `vehicle_inspections`, and the same commit added
both names to `REPORT_COLUMNS`, the SELECT list behind the inspections page. PostgREST rejects a
whole query for one unknown column, so the page returned 500 for everyone until the migration landed.

So a column and its first reader ship in **two merges**:

1. **Merge the migration alone.** No code names the new column.
2. Wait for `curl <API_URL>/api/version` to report `"schema":{"state":"current"}` — or for the
   "Apply Supabase migrations" run to go green, which is the same fact.
3. **Merge the code** that reads it.

`pnpm lint:migration-ordering` enforces this on every pull request
(`scripts/check-migration-ordering.mjs`). It flags a column **added to an existing table** whose name
this same change introduces to application source.

**A new table is exempt, on purpose.** Its readers are new code paths, so the window degrades a
feature nobody is using yet rather than breaking one they are — the difference between 0283
(`maintenance_print_profiles` and its service together, harmless) and 0284 (two columns into a live
SELECT list, an outage). Widening the gate to new tables would fail nearly every feature PR and
would be waived within a week, which is how a gate dies.

**A rename has no safe window at all** and is caught by its new name: the old name breaks the moment
the migration lands, the new one breaks until it does. The safe shape is add → backfill → switch →
drop, four merges. 0281 renamed `stock_serial` to `decal_serial` in one merge and got away with it
only because the table was empty and the feature unreleased.

**Dropping a column is not covered by the gate.** The hazard runs the other way — deployed code still
reading a column this merge removes — and detecting it means proving no remaining source names it.
Named here rather than left to be discovered.

### Open question — closing the window instead of policing it

The gate makes the window survivable; it does not remove it. Removing it means **ordering the app
deploy behind the migration**: Railway deploying on a workflow trigger that runs after `migrate.yml`
succeeds, instead of on push. That is Railway configuration plus a deploy token in Actions, and it is
the owner's call because it changes how every deploy in the repository is triggered — including the
failure mode where a broken `migrate.yml` would then block all deploys rather than just schema
changes. Until it is answered, backward compatibility for one release is a property every merge has
to have, and the gate is what checks it.
