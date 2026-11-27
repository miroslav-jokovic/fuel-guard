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

- `apps/api` — Express 5 API + background worker + schedulers. Serves the built web SPA. Runs on
  **AWS EC2** (us-west-2) as Docker Compose services — `infra/server/compose.yml`: `api` ×2, `worker`,
  `web`, `console`, behind Caddy; settings from SSM Parameter Store; logs in CloudWatch
  `/silvicom/<env>`. Production images come from `aws-production.yml` (called by `release.yml`),
  staging's from `image.yml`. Plan and decisions: `docs/plans/architecture/AWS-MIGRATION-PLAN.md`.
- `apps/web` — Vue 3 + Vite + Tailwind 4 SPA (Pinia, vue-router, TanStack vue-query). See its CLAUDE.md.
- `apps/driver` — Expo/React Native driver app. Ships through the stores only (`driver-store.yml`, EAS → Play/TestFlight); the APK install
  page and the self-hosted OTA server were switched off in the AWS move (D-AWS16).
- `apps/admin` + `apps/admin-api` — internal platform console (the `console` Compose service).

## Hosting: AWS only — Railway is retired

Production left Railway on 2026-10-28 (Railway's production services were deleted that day);
staging runs on AWS, and anything still left in Railway's `uat` project is a remnant awaiting
deletion, not a host. **Never
deploy to, configure, debug on, or read a variable from Railway**, and never propose it. Hosts:
`360.silvicominc.com` + `api.360.silvicominc.com` (production), `staging.360.silvicominc.com` +
`staging-api.360.silvicominc.com` (staging; the office app is on `staging.360` since 2026-11-17). To see what production is doing, read CloudWatch (`AWS_PROFILE=silvicom
AWS_REGION=us-west-2 aws logs filter-log-events --log-group-name /silvicom/production …`), not Railway.

Code still carries Railway names — `RAILWAY_*` environment reads, `railway.json`'s `watchPatterns` in
`deploy-verify.yml`, "Railway" in comments. They are leftovers, and three of them are live defects
on AWS (the release name, console release approval, and the web build id are all read from
variables AWS never sets). Inventory and fix order: `docs/plans/architecture/RAILWAY-REMOVAL-PLAN.md`.
A new `RAILWAY_*` read is never the answer: read the platform-neutral name (`GIT_COMMIT_SHA`,
`GIT_BRANCH`, `DEPLOY_ENVIRONMENT`) that `infra/image/Dockerfile` and `infra/server/` set.
- `packages/shared` — Zod contracts (`*Contract.ts`) + pure domain logic. The ONLY home for
  api/web/driver-shared types and rules; never redefine a contract per app.
- `packages/ui` — shared Vue components + `tokens.css`. `packages/hazmat-*` — hazmat rules engine
  (pure, zero workspace deps) + versioned regulatory data.
- `supabase/` — migrations (single source of schema truth) + PGlite behavioural test matrices. See its CLAUDE.md.

## Commands

- Check in three tiers. While coding: the changed code's test file and its package's typecheck. Once the whole
  change is written: commit, then ONE `pnpm ci:local` (runs `ci.yml`'s PR steps, lists every failure; `--job gates`
  narrows it; a fresh worktree first needs `pnpm install --frozen-lockfile && pnpm --filter @silvicom/shared build:rn`).
  Then push once: CI is the full gate, so a red CI means fixing that gate, not re-running everything locally.
- `pnpm test` — unit suites AND every `supabase/tests/*.test.mjs` matrix, unconditionally. Matrices are
  auto-discovered and must print a `RESULT` line; a silent matrix fails.
- `pnpm typecheck` · `pnpm lint` · `pnpm build` (artefacts only: the web and admin bundles and tokens.css — `pnpm typecheck` is the one type gate).
- `pnpm verify:live` — answers "why don't I see my changes?": compares a deployed `GET /api/version`
  (commit, release tag, migration) with the git ref that host follows. Production trails main BY
  DESIGN until the next release, so it takes a target: no argument = production vs
  `origin/production`, `staging` = staging vs `origin/main` (a merge shows there in minutes), a URL =
  that host vs your HEAD. Production's release tag (`v2026.10.05`, D-REL10) is also in the web
  account menu and the driver app's build card.
- The full gate list lives in root `package.json` — every `lint:*` script is documented by its
  sibling `"//lint:*"` comment key. CI runs most of them by name in the `gates` job
  (`.github/workflows/ci.yml`); the rest are chained onto one of those. **A gate that is in
  `package.json` and in neither list is not a gate** — `lint:wsdl` once crashed on a stale path for
  ten days without anybody being able to notice. Adding a gate means adding it to `ci.yml` in the
  same PR, or chaining it onto a neighbour and saying so in its `"//lint:*"` comment.
- CI is **eight parallel jobs**: `gates`, `typecheck`, `bundle`, `test-api`, `test-web`,
  `test-packages`, `matrices`, `native-android` — the api, web and matrix jobs each fan out into
  shards whose i/n come from GitHub's strategy context — plus a do-nothing `build` job that
  aggregates them and must keep that name, because main's branch protection requires a check called
  exactly `build`. Put a new gate in `gates`; put anything needing `apps/web/dist` in `bundle`, the
  only job that builds. Sharding plan and measurements: `docs/plans/ci/CI-FEEDBACK-LOOP-V2-PLAN.md`.
- `native-android` compiles the capture module's Kotlin (nothing else does) and runs its
  metric-parity test. On a PR it skips unless one of its `NATIVE_INPUTS` changed — anything the job
  starts reading goes on that list in the same PR; on main it always builds. **There is no iOS job**
  (macOS runners bill ~10× Linux): Swift is compiled and checked by hand, per
  `docs/plans/drivers-app/SCANNER-UPGRADE-PLAN.md` §3.4.
- **A merge does not wait for main's CI when main's tree is the one the PR tested.** `build` posts a
  `ci/tested-tree` status on the PR head, and `require-ci-green` (migrate, driver-store)
  accepts it when main's merge commit has that exact tree — else it polls main's run. Rules in
  `.github/actions/require-ci-green/tested-tree.sh`. Main's own CI asks the same question in its
  `plan` job and, on a yes, skips every heavy job but `native-android`; `build` accepts those skips
  only then (`scripts/check-ci-verdict.sh`, run in `gates`). A nightly `schedule` run (09:30 UTC)
  and `workflow_dispatch` always run everything. `deploy-verify` passes pushes that touch only
  paths `railway.json`'s `watchPatterns` exclude (a Railway leftover still in force — see the
  removal plan), and a host serving a later main commit. A push to
  main verifies the STAGING hosts (`STAGING_*` variables); `release.yml` calls it for production.
  Every push-triggered production job (`migrate`, smoke) skips while
  the repository variable `RELEASE_TRAIN` is `on`; deleting that variable is half of the undo.
- **Browser tests run in `bundle`**: `pnpm --filter @silvicom/web e2e:apply` runs
  `apps/web/e2e-apply/` — the applicant's page, built, in Chromium, against a stubbed API
  (`e2e-apply/stubApi.ts`, raw JSON). Beside them, `tutorials --check` runs every video tutorial's
  steps camera-less (`apps/web/tutorials/README.md`). Those two are the ONLY Playwright runs in CI:
  `apps/web/e2e/` is `smoke.yml`'s, against production after a deploy, so a stubbed spec must never
  go there. Locally: build `dist` first (CI's placeholder `VITE_SUPABASE_*` values), then run `e2e:apply`.

## Hard rules (each one is machine-enforced; the gate is named)

- Schema changes ONLY as the next-numbered file in `supabase/migrations/` (`lint:migrations`). Never
  edit an applied migration. **A merge deploys to STAGING; a release deploys to PRODUCTION** (the
  release train, live since 2026-10-04 — `docs/plans/ship-pipeline/RELEASE-TRAIN-PLAN.md`):
  - On merge to main, `migrate.yml`'s `migrate-staging` job applies the migration to the staging
    database and `image.yml` deploys the code to the AWS staging server. Production does not move.
  - Production moves only through `release.yml`: at 01:07 CT, Sunday–Thursday nights, it ships the
    commit the owner approved on the open `main → production` release PR — migrations FIRST, then
    the code. A merged migration is a released migration by the next morning at the earliest, and
    never if nobody approves. Hotfix and rollback are `release.yml` dispatch modes; never move the
    `production` branch by hand (a ruleset refuses even an admin).
  - **A migration that changes a ROLE (`alter role … set`) is tested against PRODUCTION, never only
    staging.** Production's PostgREST lowercased 0610's `work_mem = '16MB'` to `16mb` and every API
    read failed for 30 minutes (2026-11-15); staging's PostgREST build passed it through and showed
    nothing. Release verify does not catch it — it checks the code is live, not that reads succeed.
  - The nightly `schema-drift.yml` fails when production's schema differs from what the migrations
    build — fix with the next migration, never by hand on either database.
- ...and code still meets the other side's schema. On staging, AWS serves a merge in minutes
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
  style of `git log` (they read as a narrative, not conventional-commit tags). A PR's TITLE is its
  line in the release notes, so write it for an office reader; its body follows the four headings of
  `.github/pull_request_template.md` (what changes for a user, migration and risk, how to check it on
  staging, tests) — `gh pr create --body-file` skips the template, so write them in. The `area:`
  label is applied from the files by `pr-area.yml` (rules: `AREAS` in `scripts/release-train.mjs`).
- Background work runs in the worker (`WORKER_ROLE=scheduler|consumer|both`); schedulers must run in
  exactly ONE process fleet-wide — never add one without checking `docs/WORKER-DEPLOYMENT.md`.
  `RUN_SCHEDULERS_IN_PROCESS` defaults to **true**, so a service never given it runs them: `api`
  owns the egress lane (it is the WEX-whitelisted host) and the `scheduler` worker the general lane;
  `infra/server/compose.yml` gives `web` and `console` `false`, and any new Compose service gets
  `false` too. Who holds each lane right now: `platform_scheduler_leases`.

## graphify

A knowledge graph of this repo lives at `graphify-out/` (gitignored; a fresh clone runs
`pnpm graph:update` once, ~30s). A `PreToolUse` hook reminds of it on `Grep` only.

- **Use it by exact symbol name.** `graphify explain "<symbol>"` for what defines, imports and calls
  one symbol; `graphify affected "<symbol>"` for the blast radius of a change (it follows
  re-exports grep misses); `graphify path "<A>" "<B>"` for how two symbols connect. These are
  accurate and cost ~150–300 tokens.
- **Do not use `graphify query "<question>"` to find code.** It matches question WORDS, not
  meaning: measured 2026-10-21, "where is the IFTA sync scheduler" returned eight unrelated test
  helpers (it matched "call" and "sync") and "which code computes fleet MPG" returned the hazmat
  placard engine, each at up to ~2,000 tokens, while one grep found `samsaraScheduler.ts`. To
  DISCOVER code, grep; once you have a name, switch to `explain`/`affected`. That measurement is
  also why the hook no longer fires on Bash, Read or Glob — it added ~50 tokens to every call and
  steered toward `query`. Read `GRAPH_REPORT.md` only for broad architecture review.
- ⚠ **It is a map, not the territory.** Verify anything load-bearing at the call site, and be most
  careful with a NEGATIVE — "there is no such function" is the answer a stale or partial graph
  gives confidently and wrongly.
- ⚠ **`built_at_commit` is NOT a staleness check.** It is the HEAD of the last build that CHANGED
  TOPOLOGY, so it trails HEAD after every docs-only or body-only commit while the graph is current.
  When in doubt run `pnpm graph:update`: idempotent, ~30s, a no-op when nothing changed.
- **Rebuild with `pnpm graph:update`, never a bare `graphify update .`** — a graphify without the
  optional `tree_sitter_sql` grammar silently drops every migration; the wrapper refuses to let
  that pass (`scripts/graphify-update.sh`). `post-commit`/`post-merge` git hooks already run it.
