# Handoff 2026-09-30 — CI speed: three fixes, no machine change

Repo: ~/Projects/FuelGuard (Silvicom 360). Read CLAUDE.md first, then memory
`ci-on-the-macbook-self-hosted-runner.md` (the measured story), `pr-flow-and-no-assumptions.md`,
`run-all-ci-gates-before-push.md`, `github-push-event-lost-migration-not-applied.md`.

**Owner's goal:** stop losing 15–20 minutes per merge. **Owner's standing rule:** PR → CI green on the
CURRENT head → `gh pr merge N --merge` without asking → verify both services (`/api/version` on
`fleetguardapi-production.up.railway.app` and `fleetguardweb-production.up.railway.app`).

## Where it stands (main `bcacd46`, 2026-09-30 ~17:20 UTC)

- **The repo is PUBLIC again, on GitHub-hosted `ubuntu-latest` (4-core, free).** It went private
  for ~2 h for a self-hosted-runner trial, and the owner reversed that ("A, as recommended").
  - Branch protection is unchanged: required check `build`, `enforce_admins: true`.
  - Repo variable `CI_RUNNER` is **deleted**, and all 7 Mac runners are unregistered, with their
    launchd services removed. `~/actions-runners/` holds only binaries and is safe to delete.
- **#1149 left a harmless switch in place:** every job says
  `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}`, and the Mac-specific branches are keyed on
  `runner.environment` / `runner.os`. Unset means ubuntu. Leave it; it costs nothing. Don't re-add runners.
- Production: both services are on `033fa2a`, schema **0391**, `ok=true`. They are correctly NOT on
  `bcacd46`, which only touched `.github/` + `docs/`, and Railway's `watchPatterns` skip those.

## What was measured (so nobody re-litigates the machine)

| | ubuntu (5 green main runs) | MacBook M4 Pro, 5–7 runners |
|---|---|---|
| whole CI run | 393–678 s | 367 s (PR), 379 s (main) |
| test-api | ~340 s | 166–311 s (contended) |
| native-android | 362–634 s | 289–342 s |

The Mac saved ~nothing end to end: 7 jobs on 14 cores contend, and queueing ate the rest. **The three
levers below are what saves time, and they work on ubuntu.**

Where a merge's 15–20 min goes:
1. PR CI, ~6.5–11 min. `native-android` is the long pole.
2. Railway build, 4–13 min. Out of CI's reach.
3. **Only for migrations:** `migrate.yml` → `.github/actions/require-ci-green` waits for a SECOND full
   CI run on the main merge commit.

## NEXT: three fixes, one PR each (or 1+3 together; 2 alone)

### Fix 1 — `native-android` runs only when native code can have changed
- Only **3 of 160** merges between 2026-09-23 and 09-30 touched `apps/driver/**`,
  `modules/capture-native/**`, `packages/capture-engine/**` or `pnpm-lock.yaml`. Re-derive the path
  list from what the job actually builds: prebuild of `apps/driver`, `:capture-native`, the manifest
  check `apps/driver/scripts/check-android-manifest.mjs`, `app.config.ts`. Also include
  `.github/workflows/ci.yml` itself and `.github/actions/setup/**`.
- ⚠ **`build` is the required check and `needs: [..., native-android]`.** A job skipped by a
  job-level `if:` reports `skipped`, and `build`'s step fails on anything but success
  (read its RESULTS check at the end of ci.yml).
  - Do NOT use workflow-level `paths:` either: that skips the whole workflow, and then the required
    check never reports and the PR can't merge.
  - Pattern: a tiny `changes` job computes the diff (`git diff --name-only` against the PR base or
    `github.event.before`; `dorny/paths-filter` is fine but adds a dependency). `native-android`'s
    heavy steps are gated on its output while the job itself still runs and succeeds. OR `build`
    accepts `skipped` for native-android ONLY when `changes` said "no native change". Pick one and say why.
- On push to main, decide explicitly whether main still builds native always (safer, costs
  nothing on the PR path) or uses the same filter.
- Prove it both ways on real PRs: a docs-only PR shows native-android fast-passing, and a PR
  touching `apps/driver/` runs it fully. Record the before/after job times.

### Fix 2 — migrations accept the PR's green run when main holds exactly the tested code
- Today `require-ci-green` polls for `ci.yml` on the MAIN merge commit's SHA.
  - A PR's CI tests `refs/pull/N/merge`, a synthetic merge of head + base at that moment. When the
    PR is merged (merge commit, repo policy) with base unchanged, main's merge commit has the
    **identical git tree**.
  - Same tree = same code = already proven.
- Design, already worked out (verify every assumption before building):
  - In ci.yml's `build` job, only on `pull_request` and only after it has confirmed every job
    succeeded: read the tree of `$GITHUB_SHA` (the merge ref) with
    `gh api repos/$R/git/commits/$GITHUB_SHA --jq .tree.sha`. Post a commit status on
    `github.event.pull_request.head.sha` with `context=ci/tested-tree`, `state=success`, and
    `description=<tree sha>`. This needs `permissions: statuses: write` on that job.
  - In `require-ci-green`, BEFORE the polling loop: read the main commit's tree and parents. If any
    parent carries a `ci/tested-tree` success status whose description == main's tree, pass
    immediately and log it in the step summary. Otherwise fall through to today's polling, unchanged.
- Users of the gate: `migrate.yml`, `driver-ota.yml`, `driver-android.yml`, `driver-store.yml`. All
  benefit, and none change behaviour when the shortcut doesn't apply (fails closed as before).
- ⚠ Keep main's CI running on push (the record, the smoke chain). The gate just stops WAITING for it.
- Prove it:
  - Positive: after merging, run the check logic locally against the merge commit. It must accept.
  - Negative, three cases, all must fall through to polling: a commit whose tree differs (main moved
    between the PR run and the merge), a commit with no status, and a status with the wrong description.
  - Put the shortcut in a script beside the action (`${{ github.action_path }}/tested-tree.sh`) so it
    can be run locally with `GITHUB_REPOSITORY` set.
  - The real test is a PR with a migration. Measure merge → `schema.applied` on `/api/version`. It was
    5 min 2026-09-05; `docs/MIGRATION-DISCIPLINE.md` §the-deploy-window has the method.

### Fix 3 — deploy-verify skips commits Railway doesn't deploy
- `.github/workflows/deploy-verify.yml` runs on every push to main and waits for both hosts to serve
  that commit. `railway.json` `watchPatterns` exclude `**/*.md`, `**/*.mdx`, `docs/**`, `.github/**`,
  `.claude/**` and a few dotfiles, so a docs/CI-only merge "fails" verify while prod is correct.
  This false-alarmed on `bcacd46` today.
- Derive the ignore list FROM `railway.json` (read it in the job), don't restate it. A copy is a
  workaround with a delay fuse (CLAUDE.md). If the commit touches only ignored paths, say
  "nothing to deploy" and pass.
- Separately, the web host's first deploy of a commit can outrun the job's wait (timed out on
  `1de0ea1` today; the next merge superseded it). Consider whether a commit superseded on main
  should count as verified. Measure first.

## After the three: update the docs that are now wrong
- CLAUDE.md says "A green run is ~3 minutes (measured 2026-09-05)". Measured today: 6.5–11 min.
  Replace it with the new measured number after Fix 1.
- CLAUDE.md's deploy-window paragraph: 2m44s. Re-measure after Fix 2.

## Working rules
- One worktree per PR off origin/main: `git fetch && git worktree add ../FuelGuard-<topic> -b
  claude/<topic> origin/main`, then `pnpm install --frozen-lockfile`,
  `pnpm --filter @silvicom/shared build:rn`, and copy `../FuelGuard/apps/{web,api}/.env`.
- Gates (zsh, after `git add`):
  `for g in $(grep -oE 'pnpm (run )?lint:[a-z0-9-]+(:[a-z0-9-]+)?' .github/workflows/ci.yml | sed -E 's/pnpm (run )?//' | sort -u); do pnpm run -s $g >/dev/null 2>&1 || echo FAIL $g; done`,
  plus `pnpm lint`. Workflow YAML has no local parser here (no PyYAML). Use the workspace's `yaml`
  package from `node_modules/.pnpm/yaml@2*`.
- A workflow change is only proven by a real run. Read the job logs with
  `gh api --allow-escape-sequences repos/miroslav-jokovic/fuel-guard/actions/jobs/<id>/logs`.
  `gh run view --log-failed` refuses while the run is in progress.
- ⚠ Check `$?` / `REAL_EXIT`, never infer a pass from empty output. A `; echo exit` after a command
  reports the echo's status.
- After every merge, check within ~2 min that `gh run list --commit <sha>` is non-empty (lost push events).
- Commits: one narrative sentence plus the Co-Authored-By trailer. Watch CI with the `Monitor` tool;
  don't chain `sleep`.
- No workarounds: anything that can't be derived (e.g. the path list) is written down with its reason.

## Progress log

- 2026-09-30 — **Fixes 1 and 3 merged, #1152 (`47aa2c2`).** native-android keeps running as a job,
  and its steps are gated on a diff of `NATIVE_INPUTS` (merge commit vs first parent). `build` is
  unchanged. main always builds. Re-derived count: 7 of 159 merges touched the list, 0 touched
  `apps/driver`. deploy-verify reads `watchPatterns` from railway.json as git pathspecs and also
  accepts a host on a later main commit (compare API `ahead`). Of 78 failures 09-16..09-30, 60 were
  nothing-to-deploy and 12 superseded. **Proven:** #1152's own run built native in full (ci.yml
  changed, 330 s), and deploy-verify on `47aa2c2` passed "Nothing to deploy" on both hosts.
- 2026-09-30 — **Fix 2 merged, #1154 (`cfbe724`).** The status is posted only by
  github-actions[bot] and only on same-repo PRs, and is accepted only when it matches the tree. All
  four callers got `statuses: read` (the repo default token is read-only, so it had to be explicit).
  **Proven:** 10 stubbed cases + 2 mutants. Real no-status: `bcacd46`, `033fa2a` → exit 1. Real
  tree-differs: `cfbe724` itself, since #1154 was tested before #1152 landed. Its head carries tree
  `761d086` and the merge has `19b235a` → exit 1.
- ⚠ **Consequence written into MIGRATION-DISCIPLINE.md §2026-09-30:** the schema can now land before
  the code. Merge → `schema.applied` is **not yet measured**, and the first real migration PR owes it.
- 2026-09-30 — **Measured Fix 1, and it barely moves PR wall time.** native-android now takes 12–13 s
  instead of 275–403 s when nothing native changed. But across the ~37 PR runs of 09-29..30,
  test-api and test-web each ran ~330 s, only 20–40 s under native, so the run just waits on them
  instead: 326/369/374 s after vs a ~370 s median before. The saving is ~5.5 runner-minutes per PR
  and a shorter queue, not a faster merge. **The next wall-time lever is sharding `test-api` and
  `test-web`** (`vitest --shard=i/2` over a matrix), since both are import-bound (ci.yml's comment:
  601 s importing vs 105 s running). Not built. It needs its own measurement. Fix 2 is the one that
  removes whole minutes from a merge, and only for migration/driver-release merges.
