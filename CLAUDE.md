# FuelGuard

Fleet fuel-security and compliance SaaS for trucking carriers. pnpm monorepo, ESM everywhere,
Node >= 22, TypeScript run via tsx (no compile step except `@fuelguard/shared` for React Native).

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
  sibling `"//lint:*"` comment key. CI runs ~19 of them (`.github/workflows/ci.yml`).

## Hard rules (each one is machine-enforced; the gate is named)

- Schema changes ONLY as the next-numbered file in `supabase/migrations/` (`lint:migrations`). Never
  edit an applied migration. `migrate.yml` auto-applies to production Supabase on merge to main,
  gated on CI green — a merged migration IS a deployed migration.
- Every new table gets `enable row level security` (`check-rls.mjs`). No client policies = deny-all
  on purpose, that's fine.
- Never `.upsert()` with a partial payload (`lint:upserts`) — Postgres checks NOT NULL before conflict
  arbitration. Write an UPDATE or a set-based UPDATE RPC (migrations 0174/0175 are the pattern).
- The API reads with the service role, which BYPASSES RLS: every service query must org-filter itself,
  and tests assert it via `supabaseRecorder`'s `expectOrgScoped`.
- Features under `src/features/<name>` may not import another feature's internals; hazmat packages may
  not import `@fuelguard/*` or use clocks/randomness (`lint:boundaries`).
- 500-line file budget (warn 450), 200-line function budget in api services; grandfathered files may
  only shrink (`lint:filesize`, `lint:funcsize`).
- Evidence tables (`certifications`, `qualification_records`, `documents`, `dq_exports`, audit logs)
  are append-only and pinned in `RETENTION_FORBIDDEN` — corrections are new rows, deletions are
  explicit audited service-role acts, never side effects.
- A comment claiming test coverage ("proves", "pinned by") must quote a real test title
  (`lint:comment-claims`).
- `*.generated.ts` files come from `pnpm gen:rules` — edit the YAML source, never the output.

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
