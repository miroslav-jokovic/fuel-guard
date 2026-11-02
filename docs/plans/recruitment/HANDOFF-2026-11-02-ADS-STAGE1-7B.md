# Handoff · 2026-11-02 (afternoon) · Ads agent, Stage 1 from step 7b

**Paste this whole file into a fresh chat.** It continues `HANDOFF-2026-11-02-ADS-STAGE1-A6.md`, whose
§4 traps, §5 process and §6 owner track **still hold**, as do the earlier handoffs' traps. This file
replaces its §1 position, §2 measurements and §3 step list. Stage 1 = build the agents and the
orchestrator and prove them against fakes, with **no social-network or Higgsfield credentials**.

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, gates, the release train, "No workarounds".
2. `HANDOFF-2026-11-01-ADS-STAGE1.md` §1 (owner rulings, do not re-ask) and
   `HANDOFF-2026-11-02-ADS-STAGE1-A6.md` §4 (traps), §5 (process).
3. `ADS-AGENT-BUILD-WORKFLOW.md`: §1.2 (corrections 1–10), §4 B/C/D/E/F, **§4R** (readiness levels,
   harness, the L2/L3 table), and the **progress log at the end** — its last five entries (A6, step 7
   split, 7a, 7b, 7c) are this session.
4. What is built (read it): `apps/api/src/modules/ads/orchestrator/*`, `guard/guardedPlatform.ts`,
   `platforms/adapter.ts`, `platforms/simulatorGate.ts`, `lib/deployEnvironment.ts`,
   `testing/adsWorld.ts`, `testing/fakeClock.ts`; on the two open branches (§2),
   `platforms/simulator/fakeMeta.ts` and `creative/higgsfield/fakeHiggsfield.ts`.

## 1. Done (merged to main and on staging)

| Step | PR | What |
|---|---|---|
| **A6 orchestrator spine** | **#1912** (`81a908d`) | `orchestrator/transitions.ts` = the ONLY writer of `ads_campaigns.state`: asks `stepCampaign`, an illegal move is a `refused` row; a legal one = `started` row (key `transition:<id>:<state_changed_at>:<event>`) → compare-and-set on `state` + `state_changed_at` → completion; a crash between the last two is settled at the next move from the campaign's own stamp. **No RPC, no migration (decided).** `runner.ts`: one step per `ads_step` job; launch only via `guardedLaunch` (guard closes over `PlatformSpend`); pause via the new `PlatformSafe.pause`; **kill switch → launching/live go to `pausing` on the next tick**; **a launch whose outcome is unknown is PAUSED, never `launch_failed`** (approvals are single-use). `workers.ts`: compose / createPaused / platform are **null** until B1/B2/C (null = the campaign waits, visibly); `agentHasWork` is read by both tick and runner. `tick.ts`: every 60 s, lane `general`, off unless `ADS_ENABLED`, `dedup_key` = `ads_step:<campaign>:<state>`, `KIND_CAPS.ads_step = 2`. 12 mutations red |
| **7a environment + clock** | **#1914** (`486a554`) | `lib/deployEnvironment.ts` = ONE reading of `RAILWAY_ENVIRONMENT_NAME ?? DEPLOY_ENVIRONMENT` (scheduler lease reads it). `isPositivelyNonProduction`: only `uat` (Railway), `staging` (AWS), or no name on a non-built process (laptop/CI); production, unknown names, `Staging`, a nameless built server → no. `platforms/simulatorGate.ts` asks it. `testing/fakeClock.ts` (bound `now`, never backwards). 6 mutations red |

Main at handoff: **`da641c9`**. Last migration on main: **`0542_office_chat_search.sql`** (chat took
0540–0542 today). Release candidate #1907 carried A4; A5, A6, 7a ride the next train.

⚠ **Measured correction (7a):** `GET /api/version`'s `env` — what `pnpm verify:live` prints — is
`NODE_ENV`, and it says `production` on staging too. It is NOT the environment name. Never read it as one.

## 2. Open — pushed branches, no PR yet

| Step | Branch / worktree | State |
|---|---|---|
| **7b FakeMeta** | `claude/ads-7b-fake-meta`, `../FuelGuard-ads-7b` (head `a798da7`, main merged in) | `platforms/simulator/fakeMeta.ts` + 13 tests, 10 mutations red. First `ci:local` failed ONLY on an ESLint `no-explicit-any` in the test — fixed (`GraphBody` type), `eslint apps/api/src/modules/ads` exit 0. The re-run was **killed by Claude Code at 50/53 steps (all green) for low memory** — the three left were the long unit suites. **Not re-run.** |
| **7c FakeHiggsfield** | `claude/ads-7c-fake-higgsfield`, `../FuelGuard-ads-7c` (head `ff43071`, on main `da641c9`) | `creative/higgsfield/fakeHiggsfield.ts` + 15 tests, 11 mutations red; typecheck clean; `any` already replaced (`HfBody`). **No `ci:local` run yet.** Its progress-log entry is in the branch |

Both progress-log entries append at the END of the workflow: whichever merges second gets a conflict
there — keep both, 7b before 7c.

## 3. Next steps, in order (one PR each)

| # | Step | Notes |
|---|---|---|
| 7b | **Finish FakeMeta** | Gate it (§5 decision), open the PR with the four headings and the mutation table (F1–F10, listed in its progress-log entry), merge on green, `verify:live staging` |
| 7c | **Finish FakeHiggsfield** | Same; merge main first (log conflict, above). Mutations H1–H11 in its log entry |
| 7d | **`packages/ads-golden`** | Copy `packages/hazmat-golden` (YAML scenarios, `schema.ts`, `load.ts`, `runner.ts`, `golden.test.ts`, `AUTHORING.md`; package `@hazmat/golden` → `@silvicom/ads-golden`). A scenario = settings, campaigns, a FakeClock timeline of events (person acts, platform changes, kill switch, faults) + the expected ledger (`ads_actions` kinds/statuses), final states and vendor-call counts. It drives the REAL `runCampaignStep` + `orchestratorTick` over `adsWorld` with fake workers. ⚠ `packages/*` may not import `apps/api` — the runner probably lives in `apps/api` (e.g. `apps/api/src/modules/ads/orchestrator/golden.test.ts`) reading the package's scenarios, or the package exports data only; decide by reading how `hazmat-golden` reaches the engine and say why. First scenarios: happy path draft→live; kill switch mid-launch; crash after each side effect; two campaigns one org; approval missing; budget exhausted mid-step; settings changed mid-run (the §4R Orchestrator L2 row) |
| 8 | **`lint:ads-readiness`** | Copy `scripts/check-reader-gate.mjs` (REQUIRED list per worker × level, `--self-test`, refuses skip/only/todo/fails) + `pnpm ads:readiness` scorecard; add to `ci.yml` `gates` **in the same PR** with a `"//lint:ads-readiness"` key. Orchestrator L1 + the L2 rows A6/7d cover go in first |
| 9 | **Workers on fakes** | B1 (Meta client + Connect + `ads.connection` on the admin-only list, §1.2-10; **the simulator platform = B1's client pointed at FakeMeta behind `simulatorGate`**, decided in 7b), B2–B5 (each adds its FakeMeta endpoints: ad sets, forms, leads + `leadgen` webhook, insights), C1–C5 (+ `lint:agent-fixtures` in ci.yml; **C2 also brings Claude replay + `pnpm ads:eval`**, moved there in the step-7 split), F1; D0–D2 — **re-check** HW PRs first (`gh pr list`), D0 edits `purge_applicant` + the roster merge list in the same PR (§1.2-9). Each worker L1 → L2 → L3 per §4R; fill its line in `orchestrator/workers.ts` |
| 10 | **Screens on the simulator** | E1–E5, `packages/ui` only, `docs/DESIGN-SYSTEM-CONTRACT.md` first, browser pass on three fixtures. E1 shows the per-agent switches and the kill switch with its reason; E5 shows `failed` + `last_error` |
| 11 | **Stage 1 exit** | Scorecard L3 everywhere; owner walks staging in simulation mode; Launch still refuses (no L4) |

Calendar (workflow §5): Stage 1 to L3 by **Sat 11/07**; credentials + L4 from **Mon 11/09**.

## 4. Traps hit today (add to the earlier lists)

- **`budgetGuard.boundary.test.ts` reads TEXT**: any `.launch(` / `.raiseDailyBudget(` / `.changeArea(`
  outside `guard/` and `platforms/` fails it, even on a safe wrapper. Name wrappers differently
  (`guardedLaunch`); never loosen the scan.
- **ESLint `no-explicit-any` is an ERROR in tests too** (`Record<string, any>` for a fetched body failed
  `gates › Lint`). Type the body (`GraphBody`, `HfBody`).
- **A fake's own bug must not look like a fault**: an exception inside a `node:http` handler leaves the
  request unanswered = an injected `hang`. Both fakes answer 500 naming themselves (`fake_meta_bug`,
  `fake_higgsfield_bug`); keep that in any new fake.
- **Verify a signature with an independent implementation** written from the vendor's docs, never the
  fake's own `sign` — two copies of one helper agreeing prove nothing.
- **The recorder fixture is not enough for races**: `testing/adsWorld.ts` is a stateful ads DB (unique
  idempotency key → 23505, CAS-by-filters, `crashOnWrite(table, nth)`, monotonic `now`). Reuse it; do
  not hand-roll another.
- **Memory**: two heavy jobs at once (a `ci:local` plus a typecheck in another worktree) got the gate
  run killed. Run ONE `ci:local` at a time and nothing heavy beside it. A killed background job is not
  restarted without the owner's word.
- Seven ads worktrees exist (`../FuelGuard-ads-a4`, `-a5`, `-a6`, `-7`, `-7b`, `-7c`, `-ho7`); a4/a5/a6/7
  are merged and may be removed (`git worktree remove`) to free disk and memory.

## 5. Process (unchanged, plus one open decision)

Worktree from `origin/main` (`claude/<topic>`); install + `pnpm --filter @silvicom/shared build:rn` +
copy `apps/api/.env` and `apps/web/.env`; the whole gate set via `pnpm ci:local`, **checking its exit**;
mutate each new guard and show it red in the PR body, restore byte-for-byte (`cp` + `cmp`); the four
template headings; merge by hand when CI is green (17 pass + 1 skipping); `pnpm verify:live staging`
(and `git merge-base --is-ancestor <merge> <served>` when staging serves a later commit); append to the
END of the workflow's progress log; memory file `recruiting-ads-agent-position.md` updated per merge.

**Open decision for the owner (asked, not yet answered):** for 7b and 7c, either re-run `pnpm ci:local`
one at a time (~6–9 min each, the documented process) or push the PRs and let GitHub CI be the gate
(runs every gate off the Mac). Ask once at the start; default to the documented process if no answer.

## 6. Owner track (unchanged, due Mon 11/09)

Meta setup (say "Meta ready" — never paste a token), Higgsfield **API** key, TikTok developer app, X
contact, brand kit + 5–10 truck/trailer photos, the first opening, spending values, presets P1–P5.
Counsel (G12 / Q-AD8): whether "no DUI convictions" may be said, and in which words. Approve the next
release (carries A5, A6, 7a).

## 7. First action in the new chat

Read §0, confirm main's HEAD and the last migration by name, check both branches in §2 still exist
(`git ls-remote origin claude/ads-7b-fake-meta claude/ads-7c-fake-higgsfield`), ask the §5 decision, then
finish **7b**, then **7c**, then start **7d**.
