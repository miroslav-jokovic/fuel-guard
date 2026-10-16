# CI feedback loop v2 — every PR run exhaustive, and under four minutes

**Status:** adopted 2026-10-16. Step 1 built in `claude/ci-sharded-suites`; steps 2–5 follow as their own PRs.
**Goal:** cut the wait on a PR's CI from ~9 minutes to ~3½–4, **without** any run that reports
green having skipped a test. Predecessor: `HANDOFF-2026-09-30-CI-SPEED.md` (native skip, the
`ci/tested-tree` shortcut, main's concurrency fix), which named sharding as "the next wall-time
lever, not built".

## 1. Baseline (measured 2026-10-16)

Ten successful PR runs, per job (seconds):

| Job | Range | What it is |
| --- | --- | --- |
| `test-web` | 357–540 (most ~530) | 417 files, one runner |
| `test-api` | 340–551 | 546 files, one runner |
| `matrices` | 299–459 | 153 PGlite matrices, one runner, 4 at a time |
| `typecheck-build` | 258–391 | typecheck 123 s → build 105 s → Chromium 11 s → e2e 60 s, in sequence |
| `gates` | 129–274 | ~35 gates |
| `test-packages` | 84–146 | |
| `native-android` | 10–16 (330–400 when native inputs change) | |

- Setup (checkout + `./.github/actions/setup`) costs **15–24 s** per job, which makes fanning out cheap.
- Queue time before a job starts: **3–4 s** in 25 recent runs. Runners are not the constraint today.
- Where the web suite's time goes (local, all 417 files, 41 s wall): import 321 s, jsdom environment
  107 s, transform 34 s, **tests 62 s**. It is per-file overhead, not assertions. CI's 4-core runner
  is ~7× slower than the 14-core Mac on it.
- **How PRs actually iterate** (last 200 PR runs, 119 branches): **100 branches ran CI once**,
  17 twice, one 3 times. Iteration happens locally; CI is run once, just before merge.
- 25 of those 200 runs failed and 25 were cancelled. A red run costs a full extra cycle.

## 2. Decisions

- **D-CIF1 — Every PR run stays exhaustive.** No draft lane, no affected-test selection as a
  substitute. Rejected (proposal of 2026-10-16): with 84% of branches running CI once, a draft
  lane speeds up a loop that barely exists, and it needs `build` to report success on a run that
  tested nothing plus a dependency planner whose miss is a silent production risk. The real fast
  lane is local (D-CIF4).
- **D-CIF2 — Shard what is slow, and let the thing that owns the list do the splitting.**
  vitest `--shard` splits the unit suites over the files it collects; `scripts/run-tests.mjs
  --shard=i/n` splits the matrices it discovers (positions mod n, self-tested in `gates`). `i` and
  `n` come from GitHub's `strategy.job-index` / `strategy.job-total`, never from a second
  hand-written number. The plan of 2026-10-16 ruled the matrices unshardable for fear of a
  hand-written file list; with the runner splitting its own discovered list that fear does not
  apply, and without it the matrices (~400 s) would become the new critical path.
- **D-CIF3 — Typecheck and the bundle run side by side.** Neither needs the other's output. The
  duplicate type analysis inside `pnpm build` stays for now (see step 4).
- **D-CIF4 — The fast lane is the developer's machine.** `pnpm ci:local` runs exactly the `run:`
  lines of `ci.yml` (derived, not restated) so a push is preceded by the same gates CI will run.
- **D-CIF5 — Main reuses a proven tree.** When main's merge commit carries the exact tree a PR's
  green `build` recorded in `ci/tested-tree`, main's run skips the heavy jobs and says so; anything
  else runs everything. A nightly full run of main stays as the independent safety net.

## 3. Steps

1. **Shard the slow suites + split typecheck/bundle** — BUILT (`claude/ci-sharded-suites`).
   `test-api` ×3, `test-web` ×3, `matrices` ×3, `typecheck` ∥ `bundle`. 15 jobs per run.
   - Local proof: web shards 139/139/139 = 417 unique files; api 182/182/182 = 546 unique; matrix
     shard 3/3 = 51 of 153; runner self-test + two mutants (ownership `<=`, index ≥ 0) both caught.
   - Owed: CI wall time on the PR itself, then 3 vs 4 shards for api/web (step 1b).
2. **Main reuses the PR's proof (D-CIF5)** + nightly exhaustive run. Required before going above
   ~15 jobs per run: the free plan allows 20 concurrent jobs per account, so a PR run and a main run
   together would queue. Reuse `.github/actions/require-ci-green/tested-tree.sh`; fail closed (no
   proof / tree differs / API error → full run). `require-ci-green` keeps polling main's `build`,
   which now concludes success with a "proof reused" summary.
3. **`pnpm ci:local` (D-CIF4).** Parses `ci.yml`'s `run:` lines (the memory note's recipe), skips
   CI-only steps (Chromium install, native), excludes `lint:fix`, runs independent groups in
   parallel, reports exit codes, not output.
4. **Remove the duplicate type analysis.** Make workspace `build` scripts bundle-only where they are
   `tsc --noEmit` today, keeping `pnpm typecheck` as the sole type gate. Needs Railway's build
   command checked first (it may rely on `build` typechecking). Saves ~100 s in `bundle`, which is
   then the likely critical path.
5. **Per-file overhead (measure first).** Candidates: cache vitest's transform output between runs,
   share one jsdom per worker where suites allow it. Measured and rejected locally 2026-10-16:
   `deps.optimizer` (41 → 43 s) and `pool: threads` (41 → 60 s). `isolate: false` stays rejected (it
   hangs `apps/api`, ci.yml's comment).

## 4. Open questions

- **Q-CIF1 — shards per suite.** 3 is the starting point (15 jobs per run, under the 20-job limit).
  4 only if the measured run shows api/web as the critical path and step 2 has landed.
  Recommendation: decide from step 1's numbers.
- **Q-CIF2 — rebalance the matrices by time?** Round-robin by name is blind to duration. Each
  shard's summary now prints per-matrix seconds; rebalance only if shards differ by > 60 s.

## 5. Not doing

New CI provider · self-hosted Mac runners (tried and reversed 2026-09-30) · affected tests as merge
authority · draft-deferred full CI · merge queue (needs an organization-owned repo).

## 6. Progress log

- 2026-10-16 — Plan rewritten from the Codex proposal: kept sharding and main-tree reuse, dropped
  the draft lane and affected-test preflight (D-CIF1), added matrix sharding (D-CIF2) and
  `ci:local` (D-CIF4). Step 1 built and proven locally; CI measurement owed.
- 2026-10-16 — **Step 1 measured on its own PR run (38916104315): 345 s wall, all green**, against
  443–580 s. Per job: test-web 161/195/192, test-api 188/146/132, matrices 158/179/122, typecheck
  157, bundle 212, gates 134, test-packages 122; queue 2–4 s with 15 jobs. That run's pole was
  native-android (332 s), which built in full because `ci.yml` is one of its `NATIVE_INPUTS`; on an
  ordinary PR the pole is now **`bundle` at ~212 s**, so a typical run should finish in ~3½–4 min.
  The shards are already below `bundle`, so a 4th shard buys nothing until step 4 shortens it
  (answers Q-CIF1: stay at 3). Next lever in order: step 4 (bundle), then step 2.
- 2026-10-16 — **Step 1 merged (#1585, `277d722`). Step 4 built** (`claude/ci-bundle-only-builds`):
  the `build` script is deleted from the nine workspaces where it equalled `typecheck`
  (`tsc --noEmit`: api, admin-api, shared, qr, sms-engine, capture-engine, hazmat data/engine/
  placards), and web/admin `build` is `vite build` alone. Railway was checked first: web's
  `railway.json` already ran `vite build` directly (DEPLOYMENT.md §"does NOT typecheck"); admin's
  calls `build` and now skips `vue-tsc` on the same reasoning. Nothing else calls a removed script
  (one stale setup-guide line fixed). Local `pnpm build`: 2.6 s, web + admin + tokens produced;
  all 39 gate commands from ci.yml, `typecheck`, `build` and `lint:light-dark` green.
- 2026-10-16 — **Step 4 merged (#1587, `7fce904`): `bundle` 212 → 107 s** (its Build step 105 → 5 s)
  on run 38918926831, 359 s wall with native-android building (ci.yml changed). No single pole left
  on an ordinary PR: test shards 130–220 s, gates 130–245 s, typecheck ~160 s.
- 2026-10-16 — **Step 2 built** (`claude/ci-main-reuses-proof`). A `plan` job, push only, runs
  `tested-tree.sh` on main's commit; on a yes the seven heavy jobs skip (`!cancelled() && reuse !=
  'true'`), native-android still builds, and `build` accepts `skipped` only from a SUCCESSFUL plan
  that said reuse, never for native-android. A plan that breaks is ignored, not a verdict: the heavy
  jobs ran, so they decide. Nightly `schedule` 09:30 UTC (clear of the 01:07 CT train) and
  `workflow_dispatch` run everything; the concurrency key now includes the event so neither shares
  a push run's group. Proof: `scripts/check-ci-verdict.sh` (new step in `gates`) extracts the
  verdict step from ci.yml and runs 15 `needs` fixtures; four mutants each turn a case WRONG, and
  an unparseable ci.yml exits 2 rather than passing. Real data: `tested-tree.sh` on the last six
  main merges → 5 reuse, 1 full run (`277d722`, main moved during its PR run). Owed: the first real
  reused push on main, and the first nightly.
