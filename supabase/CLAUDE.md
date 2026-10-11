# supabase/ — schema and behavioural matrices

`docs/MIGRATION-DISCIPLINE.md` is canonical. The short version:

- `supabase/migrations/` is the single source of schema truth. Change schema ONLY by adding the next
  free `NNNN_name.sql` (check `ls supabase/migrations | tail -1`; `lint:migrations` enforces unique
  numbers). Never edit an applied migration; never hand-apply SQL to production.
- Merging a migration applies it to STAGING (`migrate.yml` `migrate-staging`, gated on CI green).
  PRODUCTION gets it only in a release: `release.yml` runs `supabase db push` at 01:07 CT for the
  commit the owner approved, BEFORE deploying that commit's code (root CLAUDE.md, release train).
  `schema-drift.yml` compares the two databases every morning; any difference is a failed check.
- Production's catalog is not what the migrations alone imply until proven: 0422/0423 reconciled 66
  items of drift from edited early migrations (2026-10-04). A migration that reshapes an OLD table
  must also apply cleanly to production's shape — `schema-drift-production-shape.test.mjs` is the
  harness; a matrix built from migrations alone could not see 0422's first production failure.
- Every `create table` needs `enable row level security` in the same or a later migration
  (`check-rls.mjs`). RLS with zero policies = intentional service-role-only.
- Migration headers carry the house comment discipline: what gap, why this shape, what was rejected
  (see `0146_compliance_documents.sql` for the register).
- **A new function is closed to `anon` and `authenticated` by default** (0412). A function an RLS policy
  calls, or one the browser calls through `supabase.rpc`, needs `grant execute on function … to
  authenticated;` in the same migration — forgetting it fails loudly as `permission denied for
  function`. A service-role-only function needs nothing (`service_role` keeps its default). Write
  `revoke all … from public, anon, authenticated` anyway: it states the intent and survives a
  changed default. `definer-rpc-grants.test.mjs` fails CI on a client-executable SECURITY DEFINER
  function outside the RLS helpers. The `in schema public … from public` form in Supabase's docs
  removes nothing — see 0412 for the measurement.
- Evidence tables are append-only by construction (no UPDATE/DELETE policies) — don't add mutation
  policies to them.

## Test matrices (`supabase/tests/*.test.mjs`)

- In-process PGlite (WASM Postgres) applying ALL migrations via `readdirSync().sort()` — never a
  hand-picked list — plus the auth/storage shims copied from `rls.test.mjs`.
- Auto-discovered by `scripts/run-tests.mjs`; every matrix MUST end with
  `console.log(`\nRESULT: ${pass} passed, ${fail} failed`)` and exit non-zero on failure. No RESULT
  line = build failure, never a silent pass.
- **`await db.close()` immediately before that RESULT line** (`lint:matrix-exit`). This paragraph
  used to specify only how to exit on FAILURE, which left the green path to Node — and Node cannot
  end a process while PGlite's WASM handles are open, so a passing matrix sat idle for ~10 seconds
  after its last assertion. 21 of 59 did exactly that: ~210s of every CI run, invisible because they
  passed and printed the right counts (measured 2026-09-05, `fuel-range-totals` 11.33s → 1.32s).
  A bare `process.exit()` is NOT the alternative — it can truncate the buffered stdout that
  `run-tests.mjs` parses the RESULT line out of, turning a pass into "did not execute".
- They run CONCURRENTLY, bounded by cores and by memory (each holds ~1.2 GB of PGlite heap). Matrices
  are independent by construction — own database, own migrations, shared nothing — and anything that
  breaks that assumption breaks the suite. Don't reach for shared fixtures or a common temp path.
- `rls.test.mjs` discovers RLS tables from the live catalog and asserts cross-tenant isolation on
  every one; a table it cannot seed is a FAILURE, not a skip. New tables must be seedable by it.
- These matrices are the only place a migration is EXECUTED before production — that is why they
  exist despite the app deploying to hosted Supabase (they caught a CHECK constraint that had been
  silently broken in production for weeks).
