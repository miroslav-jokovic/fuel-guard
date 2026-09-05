# Silvicom 360 (formerly FuelGuard)

Fleet fuel-security and compliance SaaS for trucking carriers. pnpm monorepo, ESM everywhere,
Node >= 22, TypeScript run via tsx (no compile step except `@silvicom/shared` for React Native).

## Package map

- `apps/api` — Express 5 API + background worker + schedulers. Serves the built web SPA. Deploys to
  Railway (two services from `railway.json`: `fleetguardapi` is WEX-whitelisted and runs the pollers).
- `apps/web` — Vue 3 + Vite + Tailwind 4 SPA (Pinia, vue-router, TanStack vue-query). See its CLAUDE.md.
- `apps/driver` — Expo/React Native driver app. Ships via GitHub Actions (APK + fingerprint-gated OTA).
- `apps/admin` + `apps/admin-api` — internal platform console (own Railway service).
- `apps/driver-dist` — zero-dependency APK install page.
- `packages/shared` — Zod contracts (`*Contract.ts`) + pure domain logic. The ONLY home for
  api/web/driver-shared types and rules; never redefine a contract per app.
- `packages/ui` — shared Vue components + `tokens.css`. `packages/hazmat-*` — hazmat rules engine
  (pure, zero workspace deps) + versioned regulatory data.
- `supabase/` — migrations (single source of schema truth) + PGlite behavioural test matrices. See its CLAUDE.md.

## Commands

- `pnpm test` — unit suites AND every `supabase/tests/*.test.mjs` matrix, unconditionally. Matrices are
  auto-discovered and must print a `RESULT` line; a silent matrix fails.
- `pnpm typecheck` · `pnpm lint` · `pnpm build` (mostly `tsc --noEmit`).
- `pnpm verify:live` — answers "why don't I see my changes?": compares git HEAD + highest migration
  against the deployed `GET /api/version`.
- The full gate list lives in root `package.json` — every `lint:*` script is documented by its
  sibling `"//lint:*"` comment key. CI runs 24 of them, all in the `gates` job
  (`.github/workflows/ci.yml`).
- CI is **six parallel jobs**, not one: `gates`, `typecheck-build`, `test-api`, `test-web`,
  `test-packages`, `matrices` — plus a do-nothing `build` job that aggregates them, and which must
  keep that name because main's branch protection requires a check called exactly `build`. A green
  run is ~3 minutes (measured 2026-09-05; it was 15.7 before the split). Put a new gate in `gates`;
  put anything needing `apps/web/dist` in `typecheck-build`, which is the only job that builds.

## Hard rules (each one is machine-enforced; the gate is named)

- Schema changes ONLY as the next-numbered file in `supabase/migrations/` (`lint:migrations`). Never
  edit an applied migration. `migrate.yml` auto-applies to production Supabase on merge to main,
  gated on CI green — a merged migration IS a deployed migration.
- ...but NOT an immediately deployed one. Railway serves a merge ~3 min in while `migrate.yml` waits
  for CI green, so **a merge can be served against the previous schema**. A column and its first
  reader ship in two separate merges (`lint:migration-ordering`); new tables are exempt, renames need
  the four-step dance. Measured, and the outage it cost, in `docs/MIGRATION-DISCIPLINE.md`
  §the-deploy-window. **The window was 9m10s and is now 2m44s** — measured on migration 0316,
  2026-09-05, after CI went from 15.7 to ~3 minutes — which makes the RULE more important, not
  less: a gap that short cannot be watched for. It will not go much lower by speeding up CI;
  `migrate.yml` itself accounts for ~2 of the 5 minutes from merge to schema applied.
- Every new table gets `enable row level security` (`check-rls.mjs`). No client policies = deny-all
  on purpose, that's fine.
- Never `.upsert()` with a partial payload (`lint:upserts`) — Postgres checks NOT NULL before conflict
  arbitration. Write an UPDATE or a set-based UPDATE RPC (migrations 0174/0175 are the pattern).
- The API reads with the service role, which BYPASSES RLS: every service query must org-filter itself,
  and tests assert it via `supabaseRecorder`'s `expectOrgScoped`.
- Features under `src/features/<name>` may not import another feature's internals; hazmat packages may
  not import `@silvicom/*` or use clocks/randomness (`lint:boundaries`).
- 500-line file budget (warn 450), 200-line function budget in api services; grandfathered files may
  only shrink (`lint:filesize`, `lint:funcsize`).
- Evidence tables (`certifications`, `qualification_records`, `documents`, `dq_exports`, audit logs)
  are append-only and pinned in `RETENTION_FORBIDDEN` — corrections are new rows, deletions are
  explicit audited service-role acts, never side effects.
- A comment claiming test coverage ("proves", "pinned by") must quote a real test title
  (`lint:comment-claims`).
- `*.generated.ts` files come from `pnpm gen:rules` — edit the YAML source, never the output.

## No workarounds (judgement, not a gate — held to the same standard as the gates above)

A workaround is any change that gets the immediate task working by routing *around* a missing or
wrong capability instead of fixing it: a hand-written role list beside a derived matrix, a component
placed on the wrong page because the right page's permission check says no, a second source of truth
because the first one is inconvenient to reach, a value copied instead of derived.

Each one is individually cheap and locally defensible. That is the problem — they are only visible
in aggregate, and by then the product reads as "overcomplicated for no reason". Worked example, so
this is not an abstraction: `session.canManage` is one global boolean standing in for the whole
section × role matrix the API and the database already model correctly. Because a recruiter fails it,
recruiting UI was placed on the driver page; because that page then held four regulations, it grew
six tabs; because six tabs hide gaps, the whole surface felt wrong. Three reasonable local decisions,
one unusable result. (`docs/plans/roster/DRIVER-ROSTER-PLAN.md` §2.3 has the measurements.)

So, when the honest fix is out of scope:

- **Stop and say so.** Name the missing capability and what it would cost. Do not ship the detour.
- **Write the blocker into the plan's open-questions section**, with the candidate answers and a
  recommendation. A blocker recorded is work; a blocker routed around is debt nobody can find.
- **Never leave a workaround unlabelled.** If the owner rules that one ships anyway, the comment
  above it says it is a workaround, what it works around, and what removes it — in this repo's
  register, not as a TODO.
- **Deriving beats restating.** If a fact exists in a matrix, a contract or a catalogue, read it
  from there. A copy is a workaround with a delay fuse.

## Conventions

- Comments explain WHY, long-form, citing decision IDs (D-DQ6, F-H2), audit dates, and incidents.
  Match that register; don't strip it.
- Plans live in `docs/plans/<area>/` as decision-log documents; `docs/DESIGN-SYSTEM-CONTRACT.md` and
  `docs/MIGRATION-DISCIPLINE.md` are canonical — read them before UI or schema work.
- `docs/ARCHITECTURE.md` (module map, table ownership, D-ARC*) and `docs/SILVICOM-360.md` (product
  scope, D-S360*) are canonical since the 2026-08-26 re-founding — read them before adding a
  service, a table, or a feature. The product is Silvicom 360; "FuelGuard" in code predates the
  rename step and is expected until it lands.
- Branches: `claude/<topic>`; PRs to `main`. Commit messages are one descriptive sentence in the
  style of `git log` (they read as a narrative, not conventional-commit tags).
- Background work runs in the worker (`WORKER_ROLE=scheduler|consumer|both`); schedulers must run in
  exactly ONE process fleet-wide — never add one without checking `docs/WORKER-DEPLOYMENT.md`.
  `RUN_SCHEDULERS_IN_PROCESS` defaults to **true**, so a service that is never given it runs them:
  production is two services from one `railway.json`, and `@fleetguard/web` ran the whole scheduler
  set alongside `@fleetguard/api` until 2026-09-05 for exactly that reason. `api` owns them (it is
  the WEX-whitelisted host); every other service from that file gets `false` before its first
  deploy. No gate can see a Railway variable — `docs/DEPLOYMENT.md` has the log check.
