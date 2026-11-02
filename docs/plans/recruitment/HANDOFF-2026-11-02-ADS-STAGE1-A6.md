# Handoff · 2026-11-02 · Ads agent, Stage 1 from step A6

**Paste this whole file into a fresh chat.** It continues `HANDOFF-2026-11-01-ADS-STAGE1-A4.md`, whose
§2 corrections, §5 traps, §6 process and §7 owner track **still hold**. This file replaces its §1
position, §3 measurements and §4 step list from step 6 on. Stage 1 = build the agents and the
orchestrator and prove them against fakes, with **no social-network or Higgsfield credentials**.

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, gates, the release train, "No workarounds".
2. `docs/plans/recruitment/HANDOFF-2026-11-01-ADS-STAGE1.md` §1 (owner rulings) and
   `HANDOFF-2026-11-01-ADS-STAGE1-A4.md` §2, §5, §6, §7.
3. `docs/plans/recruitment/ADS-AGENT-BUILD-WORKFLOW.md`: §1.2 **items 5–10**, §4 A6 and B/C/D/E/F,
   **§4R** (readiness levels, harness, the Orchestrator row of the L2/L3 table), and the **progress
   log at the end**.
4. `docs/plans/recruitment/ADS-AGENT-PLAN.md` §2c (D-AD16 — the orchestrator is code, not a model),
   §4a, §5 (authority table).
5. What is built (short; read it): `packages/shared/src/ads/*` (above all `campaignMachine.ts`,
   `adsPolicy.ts`, `aiRail.ts`, `guardContract.ts`), `apps/api/src/modules/ads/**`,
   `supabase/migrations/0537_ads_foundation.sql`.

## 1. Done (all merged to main and on staging)

| Step | PR | What |
|---|---|---|
| A1 docs | #1891 | `ads` module + D-AD17 in `docs/ARCHITECTURE.md`; schedulers in `docs/WORKER-DEPLOYMENT.md` |
| A2 schema | #1894 | `0537_ads_foundation.sql`: 13 tables, AX010–AX031, DB fences AX020 (approval) / AX021 (kill switch) / AX030 / AX031 |
| A3a/A3b | #1898, #1903 | shared: `campaignMachine`, `adsPolicy`, settings contract, `adClaims`, `presetDraw`, `naming`, `renderGeometry`, `adsReport` |
| **A4 AI rail** | **#1905** | `lib/anthropic.ts` `callForcedTool` (Zod-derived tool, answer validated); **`callClaude` retired** (no caller since 991a830). `modules/ads/generations/claudeGeneration.ts` `generateWithClaude`: replay by `(org, idempotency_key)` → per-agent switch (`budgets.agents_enabled`, absent = off; `AD_AI_AGENTS`) → monthly token budget (`aiGate`; **null refuses**, unlike `withinBudget`) → `started` → call → one completion, all in `ad_generations`. Month folded from `ad_generations` (Central time, keyset). `canonicalJson` now in shared |
| **A5 guard** | **#1908** | `ads.spend` on `ADMIN_ONLY_CAPABILITIES` (fresh sign-in every use). `guard/budgetGuard.ts` = the **only** path to `PlatformSpend` (`platforms/adapter.ts` splits each adapter into `PlatformSafe` / `PlatformSpend`; `budgetGuard.boundary.test.ts` scans source). One pass collects every refusal (kill switch, unset caps, month-end forecast incl. other live campaigns, account limit read live, a standing **single-use** approval covering the amounts, two distinct approvers above the line) → `refused` row, no call; else `started` → call → one completion keyed `launch:<approval id>`. `guard/killSwitch.ts` (press = recruitment manage, no password; clear = `ads.spend`), `guard/approvals.ts`, settings save in `settings/settingsVersions.ts` (carries the half it does not change; 23505 → 409), `actions/actionLedger.ts` (the only `ads_actions` writer). Doors at `/api/ads` (`routes/guard.ts`) |

Main at handoff: **`1a3992d`**. Last migration on main: **`0539_orientation_videos.sql`** (the HW program
took 0538 and 0539). Release candidate **#1907** pins `9915f3d`: it carries A4, **not** A5 — A5 rides the
next train.

Recorded corrections since the first handoff (workflow §1.2): **10.** `ads.connection` joins the
admin-only list in **B1** with its Connect route (`routeGateLedger.test.ts` refuses a key guarding no
route); approvals are single-use and cover only amounts at or below what was approved.

## 2. Measured for A6 on main `1a3992d` (verify before relying)

- `stepCampaign(from, event, actor)` at `packages/shared/src/ads/campaignMachine.ts:107`;
  `CAMPAIGN_EVENTS` :28, `CAMPAIGN_TRANSITIONS` :63, `campaignEventsFrom` :115,
  `isTerminalCampaignState` :120. The transition table is closed and its triples are enumerated in tests.
- Job kinds: the `JobKind` union at `apps/api/src/modules/org/jobs.ts:15` (no DB CHECK on
  `jobs.kind`, so a kind needs no migration). `KIND_CAPS` at `apps/api/src/worker.ts:56`.
  `SCHEDULERS` at `apps/api/src/schedulers.ts:53` (filtered by lane at :100). ⚠ **One active job per
  (org, kind) unless `dedup_key` is set** (`supabase/migrations/0095…sql:9,17`): every per-campaign job
  carries `dedup_key` (workflow §1.2-4), or the second campaign of an org waits behind the first.
- Environment name: `env.RAILWAY_ENVIRONMENT_NAME ?? env.DEPLOY_ENVIRONMENT` at
  `apps/api/src/lib/schedulerLease.ts:234` — still inline; step 7 moves it into ONE helper (§1.2-8).
- `ads_campaigns.state` (0537) is a membership CHECK only; which move is legal is `stepCampaign`'s.
  `ix_ads_campaigns_active` (org_id, state) where not archived/failed is the tick's read.
- Writers already in place for A6 to call, not copy: `actions/actionLedger.ts`
  (`recordFinished` / `startAction` / `completeAction`; AX020/AX021 return `{ refusedBy }`),
  `guard/budgetGuard.ts` (`guardedSpend`, `guardedAreaChange` — the orchestrator's launch step calls
  these and never an adapter), `settings/settingsVersions.ts` (`settingsInForce`),
  `generations/claudeGeneration.ts`.
- Producer waivers left in `scripts/check-table-producers.mjs`: the brand-kit/preset four (C1),
  `ads_creatives` (C2–C5), `ads_outcome_events` (B6). `ads_campaigns` came off in A5 because the guard
  reads it; **A6 is its first writer** — add it to `scripts/table-writers.json`.

## 3. Next steps, in order (one PR each)

| # | Step | Notes |
|---|---|---|
| 6 | **A6 orchestrator spine** | `modules/ads/orchestrator/`: a runner that loads a campaign, asks `stepCampaign`, performs the step's side effect (for `launching`: `guardedSpend`, never an adapter), and writes the new state **with** one `ads_actions` row (`kind = 'transition'`, the state left in `cause`). Job kind `ads_step` in `JobKind` + `KIND_CAPS`, **`dedup_key` = campaign id + state**; leased scheduler `ads-orchestrator` in `SCHEDULERS`, lane **`general`**, off unless `ADS_ENABLED` — the tick only enqueues. The kill switch pressed → the next tick moves every live campaign toward `pausing` (A5 only stops new spending; this pauses delivery). Failure → a terminal `failed` state visible to E5. **Done when:** two campaigns in one org advance concurrently (test); a crashed step resumes once (at-least-once + idempotent); kill switch in every state; every illegal (state, event) refused. Check `docs/WORKER-DEPLOYMENT.md` before adding the scheduler (exactly one process fleet-wide) |
| 7 | **Harness** | `FakeMeta`, `FakeHiggsfield` as `node:http` servers with fault injection (shapes from the vendors' docs, URL cited in each); `FakeClock`; `packages/ads-golden` (copy `packages/hazmat-golden`); Claude replay + `pnpm ads:eval` (copy `apps/api/src/scripts/replayDocumentReads.ts`); the simulator platform behind ONE environment helper (§1.2-8), fail-closed |
| 8 | **`lint:ads-readiness`** | Copy `scripts/check-reader-gate.mjs` (REQUIRED list, `--self-test`, refuses skip/only/todo/fails) + `pnpm ads:readiness`; add to `ci.yml` `gates` **in the same PR** with a `"//lint:ads-readiness"` key |
| 9 | **Workers on fakes** | B1 (Connect + `ads.connection` on the admin-only list, §1.2-10) – B5, C1–C5 (+ `lint:agent-fixtures` in ci.yml), F1; D0–D2 now that the HW PRs have merged — **re-check** first (`gh pr list`), and D0 edits `purge_applicant` + the roster merge list in the same PR (§1.2-9). Each worker to L1 → L2 → L3 per §4R |
| 10 | **Screens on the simulator** | E1–E5, `packages/ui` only, `docs/DESIGN-SYSTEM-CONTRACT.md` first, browser pass on three fixtures. E1 must show the per-agent switches (`budgets.agents_enabled`, A4) and the kill switch with its reason |
| 11 | **Stage 1 exit** | Scorecard L3 everywhere; owner walks staging in simulation mode; Launch still refuses (no L4) by design |

Calendar (workflow §5): Stage 1 to L3 by **Sat 11/07**; credentials + L4 from **Mon 11/09**.

## 4. Traps hit in A4–A5 (add to the earlier handoffs' trap lists)

- **`apps/api/src/app.ts` sits at its 500-line budget** (476 after A5). A new router mount must stay
  in `app.ts` (`routeAuth` / `routeGates` / `routeGateLedger` read its source); if it tips over,
  move plumbing that mounts no `…Router()` into `appHttp.ts` — never a waiver, never a mount.
- **A READ is producer evidence** for `lint:table-producers`: the first code that reads an ads table
  makes its waiver stale, and the gate fails until the entry is removed.
- **A new write site needs `scripts/table-writers.json`** (`lint:table-writers`), separate from the
  producer waiver; `schema.generated.sql` regenerates and must be staged.
- **`expectOrgScoped` flags `user_profiles`** when a route resolves the actor's name with
  `displayNameFor` — exempt it with a comment (it is keyed by the caller's own user id).
- **A first mutation can be a no-op** (A5's G2 removed a check another line already enforced): if a
  mutant stays green, prove it changes behaviour before blaming the test, then write a real bypass.
- **`pnpm ci:local` across a laptop sleep** (A5: 12 h wall-clock) produces `ECONNRESET` and 5-second
  timeouts in unrelated suites; re-run the failed files alone before believing them.
- Local web suites time out under load (`ActivityWidget`, `LiveMapWorkspace`): re-run alone; CI shards
  them and passes.
- Main moves under a long run: `git fetch` + `git merge origin/main` before pushing; the waiver list
  (`check-table-producers.mjs`) is the usual conflict — keep both sides' intent.

## 5. Process (unchanged)

Worktree from `origin/main` (`claude/<topic>`; A4/A5 used `../FuelGuard-ads-a4`, `../FuelGuard-ads-a5`);
install + `pnpm --filter @silvicom/shared build:rn` + copy `apps/api/.env` and `apps/web/.env`; the whole
gate set via `pnpm ci:local`, **checking its exit**; mutate each new guard and show it red in the PR body,
restore byte-for-byte; the four template headings; merge by hand when CI is green (17 pass + 1 skipping);
`pnpm verify:live staging`; append to the END of the workflow's progress log; memory file
`recruiting-ads-agent-position.md` updated per merge.

## 6. Owner track (unchanged, due Mon 11/09)

Meta setup (say "Meta ready" — never paste a token), Higgsfield **API** key, TikTok developer app, X
contact, brand kit + 5–10 truck/trailer photos, the first opening, spending values, presets P1–P5.
Counsel (G12 / Q-AD8): whether "no DUI convictions" may be said, and in which words. Approve release
#1907 (carries A4) and the next one (A5).

## 7. First action in the new chat

Read §0, confirm main's HEAD and the last migration by name, re-measure §2, then start **A6**.
