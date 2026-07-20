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
