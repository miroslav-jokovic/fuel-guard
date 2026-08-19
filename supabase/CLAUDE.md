# supabase/ — schema and behavioural matrices

`docs/MIGRATION-DISCIPLINE.md` is canonical. The short version:

- `supabase/migrations/` is the single source of schema truth. Change schema ONLY by adding the next
  free `NNNN_name.sql` (check `ls supabase/migrations | tail -1`; `lint:migrations` enforces unique
  numbers). Never edit an applied migration; never hand-apply SQL to production.
- `migrate.yml` auto-applies to the production Supabase project on merge to main (gated on CI green).
  Merging a migration deploys it.
- Every `create table` needs `enable row level security` in the same or a later migration
  (`check-rls.mjs`). RLS with zero policies = intentional service-role-only.
- Migration headers carry the house comment discipline: what gap, why this shape, what was rejected
  (see `0146_compliance_documents.sql` for the register).
- Evidence tables are append-only by construction (no UPDATE/DELETE policies) — don't add mutation
  policies to them.

## Test matrices (`supabase/tests/*.test.mjs`)

- In-process PGlite (WASM Postgres) applying ALL migrations via `readdirSync().sort()` — never a
  hand-picked list — plus the auth/storage shims copied from `rls.test.mjs`.
- Auto-discovered by `scripts/run-tests.mjs`; every matrix MUST end with
  `console.log(`\nRESULT: ${pass} passed, ${fail} failed`)` and exit non-zero on failure. No RESULT
  line = build failure, never a silent pass.
- `rls.test.mjs` discovers RLS tables from the live catalog and asserts cross-tenant isolation on
  every one; a table it cannot seed is a FAILURE, not a skip. New tables must be seedable by it.
- These matrices are the only place a migration is EXECUTED before production — that is why they
  exist despite the app deploying to hosted Supabase (they caught a CHECK constraint that had been
  silently broken in production for weeks).
