---
paths:
  - ".github/**"
  - "scripts/ci-local.mjs"
  - "scripts/check-ci-verdict.sh"
  - "scripts/release-train.mjs"
  - "railway.json"
  - "**/*.kt"
  - "**/*.swift"
---

# CI jobs and the merge rule (moved from the root CLAUDE.md)

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
