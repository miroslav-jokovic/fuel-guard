# Silvicom 360 (formerly FuelGuard)

Fleet fuel-security and compliance SaaS for trucking carriers. pnpm monorepo, ESM everywhere,
Node >= 22, TypeScript run via tsx (no compile step except `@silvicom/shared` for React Native).

<!-- Maintainers: this file loads into every session, so it holds rules, not their history. Each
measurement that used to live here has a canonical home (docs/MIGRATION-DISCIPLINE.md for the
deploy window, ci.yml's comments for CI timings, scripts/graphify-update.sh for the SQL grammar);
numbers copied into this file went stale for weeks before (CI "~3 min" outlived the truth). Keep
each rule's gate name and one line of why; link the rest. Block HTML comments like this one are
stripped before Claude reads the file. -->

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
  against the deployed `GET /api/version`. Since the release train, production trails main BY DESIGN
  until the next release: check staging (`https://fleetguardapi-uat.up.railway.app`) for a merge,
  production for a release, and `git log origin/production` for what was last released.
- The full gate list lives in root `package.json` — every `lint:*` script is documented by its
  sibling `"//lint:*"` comment key. CI runs most of them by name in the `gates` job
  (`.github/workflows/ci.yml`); the rest are chained onto one of those. **A gate that is in
  `package.json` and in neither list is not a gate** — `lint:wsdl` once crashed on a stale path for
  ten days without anybody being able to notice. Adding a gate means adding it to `ci.yml` in the
  same PR, or chaining it onto a neighbour and saying so in its `"//lint:*"` comment.
- CI is **seven parallel jobs**: `gates`, `typecheck-build`, `test-api`, `test-web`, `test-packages`,
  `matrices`, `native-android` — plus a do-nothing `build` job that aggregates them and must keep
  that name, because main's branch protection requires a check called exactly `build`. Put a new
  gate in `gates`; put anything needing `apps/web/dist` in `typecheck-build`, the only job that builds.
- `native-android` compiles the capture module's Kotlin (nothing else does) and runs its
  metric-parity test. On a PR it skips unless one of its `NATIVE_INPUTS` changed — anything the job
  starts reading goes on that list in the same PR; on main it always builds. **There is no iOS job**
  (macOS runners bill ~10× Linux): Swift is compiled and checked by hand, per
  `docs/plans/drivers-app/SCANNER-UPGRADE-PLAN.md` §3.4.
- **A merge does not wait for main's CI when main's tree is the one the PR tested.** `build` posts a
  `ci/tested-tree` status on the PR head, and `require-ci-green` (migrate, driver-ota/android/store)
  accepts it when main's merge commit has that exact tree — else it polls main's run. Rules in
  `.github/actions/require-ci-green/tested-tree.sh`. `deploy-verify` passes pushes that touch only
  paths `railway.json`'s `watchPatterns` exclude, and a host serving a later main commit. A push to
  main verifies the STAGING hosts (`STAGING_*` variables); `release.yml` calls it for production.
  Every push-triggered production job (`migrate`, `driver-ota`, `driver-android`, smoke) skips while
  the repository variable `RELEASE_TRAIN` is `on`; deleting that variable is half of the undo.
- **Browser tests run in `typecheck-build`**: `pnpm --filter @silvicom/web e2e:apply` runs
  `apps/web/e2e-apply/` — the applicant's page, built, in Chromium, against a stubbed API
  (`e2e-apply/stubApi.ts`, raw JSON). They are the ONLY Playwright specs CI runs: `apps/web/e2e/` is
  `smoke.yml`'s, against production after a deploy, so a stubbed spec must never go there. Locally:
  build `dist` first (CI's placeholder `VITE_SUPABASE_*` values), then run `e2e:apply`.

## Hard rules (each one is machine-enforced; the gate is named)

- Schema changes ONLY as the next-numbered file in `supabase/migrations/` (`lint:migrations`). Never
  edit an applied migration. **A merge deploys to STAGING; a release deploys to PRODUCTION** (the
  release train, live since 2026-10-04 — `docs/plans/ship-pipeline/RELEASE-TRAIN-PLAN.md`):
  - On merge to main, `migrate.yml`'s `migrate-staging` job applies the migration to the staging
    database and Railway `uat` serves the code. Production does not move.
  - Production moves only through `release.yml`: at 01:07 CT, Sunday–Thursday nights, it ships the
    commit the owner approved on the open `main → production` release PR — migrations FIRST, then
    the code. A merged migration is a released migration by the next morning at the earliest, and
    never if nobody approves. Hotfix and rollback are `release.yml` dispatch modes; never move the
    `production` branch or Railway's production triggers by hand (a ruleset refuses even an admin).
  - The nightly `schema-drift.yml` fails when production's schema differs from what the migrations
    build — fix with the next migration, never by hand on either database.
- ...and code still meets the other side's schema. On staging, Railway serves a merge in minutes
  and `migrate-staging` may apply its schema before OR after that; in a release, new schema serves
  OLD code for the deploy minutes. So a column and its first reader ship in two separate merges
  (`lint:migration-ordering`), and a column is dropped only a release after its last reader is gone;
  new tables are exempt, renames need the four-step dance. Measurements and the outage it cost:
  `docs/MIGRATION-DISCIPLINE.md` §the-deploy-window.
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
in aggregate, and by then the product reads as "overcomplicated for no reason". Worked example:
`session.canManage` is one global boolean standing in for the whole section × role matrix the API
and the database already model correctly. Because a recruiter fails it, recruiting UI was placed on
the driver page; because that page then held four regulations, it grew six tabs; because six tabs
hide gaps, the whole surface felt wrong. Three reasonable local decisions, one unusable result.
(`docs/plans/roster/DRIVER-ROSTER-PLAN.md` §2.3 has the measurements.)

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
  `RUN_SCHEDULERS_IN_PROCESS` defaults to **true**, so a service never given it runs them: `api`
  owns them (it is the WEX-whitelisted host), and every other service from `railway.json` gets
  `false` before its first deploy. No gate can see a Railway variable — `docs/DEPLOYMENT.md` has
  the log check.

## graphify

A knowledge graph of this repo lives at `graphify-out/` (gitignored; a fresh clone runs
`pnpm graph:update` once, ~30s). A `PreToolUse` hook points at it on reads and grep-like searches.

- For codebase questions, `graphify query "<question>"` first; `graphify path "<A>" "<B>"` for a
  relationship, `graphify explain "<concept>"` for one concept, `graphify affected "<X>"` for the
  blast radius of a change. Read `GRAPH_REPORT.md` only for broad architecture review.
- ⚠ **It is a map, not the territory.** Verify anything load-bearing at the call site, and be most
  careful with a NEGATIVE — "there is no such function" is the answer a stale or partial graph
  gives confidently and wrongly.
- ⚠ **`built_at_commit` is NOT a staleness check.** It is the HEAD of the last build that CHANGED
  TOPOLOGY, so it trails HEAD after every docs-only or body-only commit while the graph is current.
  When in doubt run `pnpm graph:update`: idempotent, ~30s, a no-op when nothing changed.
- **Rebuild with `pnpm graph:update`, never a bare `graphify update .`** — a graphify without the
  optional `tree_sitter_sql` grammar silently drops every migration; the wrapper refuses to let
  that pass (`scripts/graphify-update.sh`). `post-commit`/`post-merge` git hooks already run it.
