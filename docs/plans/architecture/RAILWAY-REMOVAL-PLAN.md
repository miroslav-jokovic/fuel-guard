# Railway removal — every leftover, what it breaks on AWS, and the fix order

Status: **plan, nothing built** (2026-11-15). Owner's instruction the same day: "document so in
future we never use Railway". The rule itself is in the root `CLAUDE.md` §Hosting; this file is the
inventory that rule points at.

## 1. Why this exists

Production moved to AWS EC2 on 2026-10-28 (`AWS-MIGRATION-PLAN.md`, AWS11/AWS12) and Railway's
production services were deleted. The code was moved, not renamed: it still reads Railway's
environment variables, and where AWS sets the same fact under a neutral name the code reads
Railway's first and falls back. That works wherever a fallback exists. Where none exists, the
feature has been silently OFF on AWS since 10/28 — measured 2026-11-15, three such:

| # | What the owner sees | Cause (file) | Since |
|---|---|---|---|
| R1 | Account menu / driver build card show no release name; `/api/version.version` is `null`; `verify:live` says "release: not reported" for ever, not just 5 minutes | `apps/api/src/lib/releaseVersion.ts` asks GitHub only when `RAILWAY_GIT_REPO_OWNER` and `RAILWAY_GIT_REPO_NAME` are set; AWS sets neither, so it never asks | 2026-10-28 |
| R2 | "Tonight's release" approval in the platform console refuses (`409 not_production`); every release since has been approved on GitHub instead | `apps/admin-api/src/routes/releaseApproval.ts` `isProduction` = `env.RAILWAY_GIT_BRANCH === "production"`; nothing sets it on AWS | 2026-10-28 |
| R3 | The new-version banner works, but its id is a build timestamp, not the commit — two builds of one commit look "different", and the id cannot be matched to a release | `apps/web/vite.config.ts` reads only `RAILWAY_GIT_COMMIT_SHA`, falls back to `local-<Date.now()>` (live `/version.json` 2026-11-15: `local-1794777419786`) | 2026-10-28 |

## 2. The rest of the inventory (works on AWS through a fallback — rename, don't rush)

| File | Railway name read | AWS value comes from |
|---|---|---|
| `apps/api/src/lib/buildInfo.ts` | `RAILWAY_GIT_COMMIT_SHA`, `RAILWAY_GIT_BRANCH`, `RAILWAY_DEPLOYMENT_ID` | `GIT_COMMIT_SHA` / `GIT_BRANCH` build args (`aws-production.yml`, `image.yml`); deployment id has no AWS equivalent → `null` |
| `apps/api/src/lib/deployEnvironment.ts` | `RAILWAY_ENVIRONMENT_NAME` | `DEPLOY_ENVIRONMENT` (`infra/server/compose.yml`, from `ENV_NAME`) |
| `apps/api/src/lib/schedulerLease.ts` | `RAILWAY_SERVICE_NAME`, `RAILWAY_REPLICA_ID`, `RAILWAY_DEPLOYMENT_ID`, `RAILWAY_REPLICA_REGION`, `RAILWAY_GIT_COMMIT_SHA` | `SERVICE_NAME`, container hostname |
| `apps/api/src/lib/shutdown.ts` + `infra/server/compose.yml` | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | compose sets this Railway-named variable on purpose from `DRAIN_SECONDS` — rename both sides together |
| `apps/admin-api/src/env.ts` | `RAILWAY_GIT_BRANCH` | (R2) |
| `.github/workflows/deploy-verify.yml` | reads `railway.json` `watchPatterns` to decide a push needs no deploy; comments on `RAILWAY_DEPLOYMENT_ID` | AWS deploys every push to main; the skip rule is Railway's, not ours |
| `.github/workflows/release.yml`, `smoke.yml` | comments and example URLs (`*.up.railway.app`) | prose only |
| `scripts/supabase-key-watch.mjs` | `RAILWAY_ORG` (an IP-owner pattern, AS400940) | classifies callers seen in Supabase logs; keep until Railway's IPs stop appearing, then delete |
| `railway.json` | the whole file | delete once `deploy-verify.yml` stops reading it |
| `docs/DEPLOYMENT.md` (35 mentions), `docs/WORKER-DEPLOYMENT.md` (7) | describe Railway as the host | rewrite for AWS |

## 3. Fix order (each one PR, each with a test that fails on the Railway name)

1. **R1 + R2 + R3 together** — the three live defects. Read `GIT_BRANCH` / `GIT_COMMIT_SHA`
   (already set in the image); the repository owner/name become constants of `buildInfo` (the repo
   is one repository; deriving it from an env var bought nothing once Railway stopped setting it).
   The console container needs `GIT_BRANCH` at runtime — check `infra/image/Dockerfile`'s console
   stage passes its build arg through to `ENV`, as the api stage does.
2. **`deploy-verify.yml` stops reading `railway.json`**, then `railway.json` is deleted.
3. **Rename the fallback reads** in §2 to the neutral names only, compose and code in one PR.
4. **Docs**: `DEPLOYMENT.md`, `WORKER-DEPLOYMENT.md`, comments and example URLs.
5. **A gate**: `lint:no-railway` — fails on any `RAILWAY_` read or `railway.app` URL outside
   `docs/plans/` history, added to `ci.yml`'s `gates` job in the same PR (root CLAUDE.md: a gate in
   neither list is not a gate).

## 4. Open questions

- **Q-RR1 — Railway account.** The `uat` project and the empty production services still exist on
  Railway (AWS plan, 2026-10-28 entry). Delete the project and cancel the plan? Recommendation: yes,
  after step 2 lands, so nothing in CI can reach it.
