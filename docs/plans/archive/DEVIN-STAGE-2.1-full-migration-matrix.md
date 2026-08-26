# Task: make the RLS matrix apply ALL migrations, not a hand-picked subset

Repo: `FuelGuard` (pnpm workspaces monorepo). Work on a branch. Do not push to `main`.

## Goal

`supabase/tests/rls.test.mjs` applies a **hand-maintained list of 48 migration files**. There are
**161 on disk**. Replace the list with a directory read so every migration is applied, in lexical
order, exactly as production applies them.

## Why this matters (do not skip — it determines what counts as "done")

This matrix is the only thing in the repo that proves tenant isolation. Two facts about the current
state:

1. **It tests a schema that no longer exists.** `0078_role_department_rls.sql` does
   `drop policy if exists vehicles_write` and recreates it with a different role set. The matrix
   loads `0004_rls.sql`'s version and asserts against that. `0078` is not in the list. So its role
   assertions describe a schema that has not been real since migration 78.
2. **The subset hides regressions.** A recent audit found `0141` was missing from the list, which
   left the matrix carrying four `authenticated`-granted functions that production has not had for
   20 migrations.

The list is also applied in a **different order than production** (`0068` before `0053`, `0134-0138`
before `0127`). Production applies lexically. Order-dependent DDL can diverge silently.

## The change

In `supabase/tests/rls.test.mjs`, replace the hard-coded array (starts around line 98, `for (const f of [`)
with a lexical directory read:

```js
import { readdirSync } from "node:fs";
// …
const MIGRATIONS = readdirSync(join(HERE, "..", "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
for (const f of MIGRATIONS) {
  await db.exec(read(`migrations/${f}`).replace(/create extension if not exists pgcrypto;?/gi, ""));
}
```

Keep the `pgcrypto` strip — PGlite has `gen_random_uuid()` built in.
**Never apply anything from `supabase/_deploy/`.** That directory is an out-of-band apply channel and
is not part of the migration ledger.

## Expect failures on the first run. Here is the decision tree.

113 migrations have never run through PGlite. When one fails to apply:

- **PGlite lacks a Postgres feature** (an extension, a `storage.*`/`auth.*` object, a role) →
  **add a shim to the harness preamble** (the `db.exec` block near the top already shims
  `auth.users`, `storage.objects`, `storage.foldername`, and the app roles). Extend that.
- **The migration references a Supabase-managed object** → shim it, same place.
- **The migration genuinely fails** → that is a real finding. Stop and report it; do not work around it.

**The one thing you must not do:** re-narrow the list, add a skip list, wrap `db.exec` in a
`try/catch` that swallows errors, or otherwise make a migration failure invisible. A migration that
cannot be applied must fail the run loudly. If you cannot get one to apply, leave it failing and
report it rather than hiding it.

## Also clean up

After the list is gone, the ~38 `alter table ... add column if not exists ...` statements immediately
following it exist **only because the subset omitted the migrations that create those columns**.
Remove the ones that are now redundant. Any that are still needed indicate a real gap — report those
rather than keeping them silently.

## Commands

```bash
corepack enable
pnpm install --frozen-lockfile

# the one you are iterating on
node supabase/tests/rls.test.mjs

# all four behavioural matrices
pnpm test:rls

# full suite (unit + matrices)
pnpm test

# repo checks that must stay green
pnpm lint
pnpm typecheck
pnpm lint:tests
```

## Definition of done

1. `node supabase/tests/rls.test.mjs` applies all 161 migrations and exits 0.
2. `pnpm test:rls` — all four matrices green.
3. `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm lint:tests` — green.
4. The assertion count **went up, not down**. It is currently 265 for `rls.test.mjs`. Loading more
   migrations creates more tables, and `supabase/tests/lib/tenantIsolation.mjs` discovers tables at
   run time, so its coverage should grow on its own. If the count drops, something is being skipped.
5. `tenantIsolation.mjs` still reports `0 unseedable`. If new tables cannot be auto-seeded, add an
   entry to the `handSeed` map in the caller (see the existing `hazmat_cargo_tank_profiles` example)
   — do not remove the table from coverage.
6. **Prove the matrix still catches regressions.** In a scratch copy, edit `0004_rls.sql` and change
   `ftxn_select`, `drivers_select` and `anomalies_select` to `using (true)`, then run the matrix. It
   MUST fail naming those three tables. Revert the scratch copy. Paste the output in your report.

## Report back

- Which migrations failed to apply on the first run, and how each was resolved (shim vs real bug).
- Any real schema bug the full application surfaced.
- Assertion count before and after.
- The output of the step-6 mutation check.
- Which of the ~38 column shims you removed, and which you had to keep and why.
