# Handoff · 2026-11-04 · Monitor and Lead intake, the climb to L3

**Paste this whole file into a fresh chat.** It continues `HANDOFF-2026-11-04-LEADS-OWNER-CAMPAIGNS.md`, whose step 1 is
answered and whose step 2 is blocked. This is still the SECOND track beside the ads chat. By the owner's yes on 11/04, this
track now owns **Lead intake and Monitor L2–L3**, which were Track W's step 5 (`HANDOFF-2026-11-04-ADS-STAGE1-TRACKS.md` §3).
The progress log tells Track W so. **Everything else in `modules/ads/`, and `features/ads/`, stays the ads chat's.**
The earlier handoffs' traps and process, and the 11/01 owner rulings, **still hold**.

**Status, end of 11/04: §3 steps 1 to 3 are built, in #2047, #2048 and this docs PR, a stack waiting on the owner's merge.**
Merge from the bottom, by §5's first trap. Once merged, Monitor and Lead intake are L3 and this track stops at L4 (Stage 2).
Still open from this work: Q-AD35, and the owner's view of the restated extractor line (§2).

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, the release train, "No workarounds", the two-merge rule.
2. This file, then `HANDOFF-2026-11-04-LEADS-OWNER-CAMPAIGNS.md` §5 (traps) and `HANDOFF-2026-11-04-LEADS-E4B3.md` §5 (traps).
3. `ADS-AGENT-BUILD-WORKFLOW.md`: §4R (the levels; the rows for **Monitor** and **Lead intake**), and the progress log's
   last entries, "Lead intake L2" and "Monitor L2". `ADS-AGENT-PLAN.md` §9: Q-AD32, Q-AD33.
4. `packages/ads-golden/AUTHORING.md`, above all **the independence rule**: `expect` is written from the rules, never pasted
   from a run. Then `packages/ads-golden/src/schema.ts`.
5. The code the runner must drive:
   - `apps/api/src/testing/adsGolden.ts` (the runner, 260 lines), `modules/ads/orchestrator/golden.test.ts`.
   - `modules/ads/monitor/checks.ts`, `reconcile.ts`, and `monitor/thirtyDays.test.ts` (the shape of a monitor run).
   - `packages/shared/src/ads/monitorChecks.ts`, `adsReconcile.ts` (the rules to write `expect` from).
   - `modules/ads/leads/backfill.ts`, `leadFetch.ts`, `leadgenWebhook.ts`, `formRefs.ts`; `recruiting/leads/leadSink.ts`.
   - `scripts/ads-readiness.registry.mjs` (`SCENARIO_DIR`, `scenarios:` pins).

## 1. Done in this track (all merged to main)

| Step | PR | Merge | What |
|---|---|---|---|
| Owner's rulings | #2035 | `83feb57` | Q-AD32, Q-AD33, the previous handoff |
| Lead intake L2 | #2044 | `7861dbf` | `recruiting/leads/leadSink.test.ts`; the gate reads a matrix's `ok(...)` titles; the handover logged |
| Monitor L2 | #2045 | `db787ec` | `monitor/thirtyDays.test.ts`, 30 simulated days across the month's end |

### 1a. Position at handoff
- **Main:** `db787ec`. **Its own CI was still running when this was written:** read the result first.
- **Newest migration on main: `0568_mcleod_gl_key_lines.sql`.** Other chats merge all day, so confirm by NAME.
- **Scorecard on main:** Orchestrator L3, Budget guard L3; Publisher, Monitor, Lead intake, Copywriter, Art director,
  Checker, Renderer, Security L2; Outcome feed, Analyst L0. Re-run it: a handoff's scorecard can be wrong.
- **No open ads or leads PR** at handoff. #2036 was replaced by #2041 (S1d). D9, image-to-image, merged as #2043.
- **The worktree is detached at `db787ec`,** clean but for handoff files. `../FuelGuard-ads-safety` is this track's, so build
  there. `../FuelGuard-ads-d1` and `../FuelGuard-ads-screens` are the ads chat's: do not switch their branches.

## 2. Rulings and open questions

- **Ruled 11/04:** B2c2 first (done). Reconcile leaves the owner's own campaign alerting until the owner runs one, then a
  mark of their own (Q-AD33, nothing built). **Owner-form intake is blocked until counsel answers Q-AD32.** Do not build it.
- **Standing instruction: delete a branch as soon as its PR merges**, local and remote. This replaces "delete only if the
  owner asks". Leave closed-unmerged ones and ask: `claude/leads-handoff-e4` is one (#2014 closed, its file carried in #2031).
  15 older `claude/leads-*` branches on the remote were never checked. Ask before touching them.
- **Owner to decide:** Q-AD31, whether the queue sorts by match. **Counsel:** Q-AD30, Q-AD32, Q-AD8 / G12.
- **Unchanged:** `BACKFILL_STALE_HOURS`; lead retention (Q-LS6 / Q-RA8); the launch gate (**do not build the upload path
  until ruled**); Q-AD23 / Q-AD24; the consent checkbox staying unbuilt.
- **New, not ruled:** §4R's Lead intake bar says "extractor output stays `proposed`", but **no extractor exists**. The L2
  test pins the stronger fact that no model is on a lead's road. Either the bar is restated (recommended: say so in the
  plan, one line) or it waits for an extractor. Say which, do not pass over it.

## 3. Next steps (one PR each, ≤ ~500 lines of code; split above that)

The bars, from §4R:
- **Monitor L3:** golden scenarios: each rule fires exactly at its threshold and minimum spend, never on a learning-phase ad
  set except caps; reconcile flags every planted mismatch and nothing else.
- **Lead intake L3:** 0 lost, 0 duplicated leads over the scenario set; injection text never reaches an action.

1. **Monitor: the runner and its scenarios.** The golden runner drives only the orchestrator today, and the schema is
   `.strict()` around a campaign timeline, so a monitor run needs new shape. **Recommendation: a separate schema and runner
   beside the orchestrator's, not new branches inside `adsGolden.ts`.** Decide where the YAML lives, and check first:
   `golden.test.ts` runs every scenario through the orchestrator, and the §4R coverage list and the loader read that
   directory, so a new file there may be swept up. The registry pins by name under `SCENARIO_DIR`.
   Scenarios to cover, each at −1 / 0 / +1: both caps, no-lead spend, cost per lead, frequency; a learning ad set held except
   by a cap; reconcile with every field (`missing`, `status`, `daily_budget`, `spend_cap`, `overrun`, `not_ours`) and a clean run.
   Pin them, retire the `later("L3")` gap for Monitor. Split reconcile into its own PR if the first passes ~500 lines.
2. **Lead intake: its scenarios.** A timeline of leads with lost and repeated deliveries across webhook and backfill, ending
   in a count: every lead stored once. **Be honest about the fake:** `recruiting` tests run on the recorder, which cannot
   run `ingest_lead`, and `leadFetch.test.ts`'s `memorySink` only imitates its dedupe. A scenario over a memory sink proves
   the two roads, not the SQL; the matrix `recruiting-lead-functions.test.mjs` proves the SQL. Say which proves what.
3. **A docs PR, merged last:** the progress-log entry, the extractor line, and this file and its predecessor's update.

Then, by the §4R climb: L4 needs vendor credentials (Stage 2), so this track stops at L3 unless the owner gives it more.
Deferred on purpose, unchanged: CAPI/outcome feed, analyst narration, TikTok, X, Indeed, Tenstreet.

## 4. Known limits, recorded so nobody rediscovers them

- `thirtyDays.test.ts` writes spend straight to `ads_spend_hourly`: it exercises the checks, not the pull. A golden
  scenario that goes through `insightsPull` would close that, if the fixture can take its writes. Check first.
- `pause_when_filled` is not checked (recruiting's headcount, D-AD17; `checks.ts` header). No scenario can pin it yet.
- Step 2 of the previous handoff needs more than it says: an unknown form is dropped in `receiveLeadgenDelivery` before
  `fetchWebhookLead`, so the carrier must be found by `ads_platform_connections.page_ref` (Q-AD32).

## 5. Traps hit in this track (add to the earlier lists)

- **Stacked PRs are a GitHub stack here.** `gh pr create --base <branch>` made #2044 + #2045 a stack (#2046). Then
  `gh pr merge` and `gh pr edit --base` are both REFUSED. Merge with
  `gh api -X PUT repos/miroslav-jokovic/fuel-guard/pulls/<n>/merge-async -f sha=<head> -f merge_method=merge -f merge_action=direct_merge`.
  It takes everything open BELOW that PR, so merge from the bottom. The answer is "enqueued", not "merged": read the PR
  once more. The uuid is at `.details.uuid`. Leave `bypass_rules` off.
- **After the bottom merges, GitHub retargets the next PR to main and REWRITES its branch** (a new head, a fresh CI run).
  The local branch then reads "ahead 2, behind 4": never push it. `git reset --hard origin/<branch>` after checking the tree
  is clean. This replaces the older trap "a stacked PR's run tested its old base", at least for a stack.
- **Delete a stack's lower branch only after the next PR has moved to main.** Deleting a PR's base can close it.
- **A command waiting on stdin hangs forever and prints nothing.** A stray `cat > file` cost 58 minutes, and an empty output
  file read as "still running". Give scripts `</dev/null` and each mutant a timeout, and if a job is silent, look at its
  child processes rather than reporting on it.
- **`timeout` does not exist on this Mac.** It fails quietly in a chain.
- **`lint:boundaries` flags a test too.** A recruiting test may not import `modules/ads/`. Build the value in the test. Run the
  gate before trusting a green test; exit 0 from a pipe into `tail` proves nothing.
- **A mutant "killed" only means a non-zero exit.** Print which test failed. A compile error kills everything.
- **Two guards in a row hide a mutant.** `checks.ts` filters by state before the pure list does, so changing one passes an
  end-to-end test. Check the pure test before calling a survivor a hole.
- **The progress log conflicts on nearly every merge,** several times a day. Keep both, theirs first. A scripted swap of the
  conflict halves has worked every time.
- **`git switch` and `git merge` run the graph hook** and can pass 4 minutes on a large merge. Run them alone, not chained.
- **Merging, as before:** the owner says "merge #N" after CI finishes; the app wakes a session on failure, not on green, and
  polling is not allowed here. "Merge if green" while it is still running means stopping and saying so.

## 6. Owner track

- Rule on Q-AD31. Send Q-AD30, Q-AD32 and Q-AD8 / G12 to counsel.
- Look at the Leads tab on staging as a recruiter, and try Delete details as an admin.
- Approve the next release.
- Unchanged, and these set the real date: Meta setup, Higgsfield key, brand kit, first opening, spending values, presets,
  launch gate.

## 7. First action in the new chat

1. Read §0.
2. Confirm main's HEAD, **main's CI result on `db787ec`**, and the newest migration **by name**. List open PRs, and read the
   progress log's tail for anything the ads chat has done in `monitor/` or `leads/`.
3. Run `pnpm ads:readiness` and compare it with §1a. A level going down needs explaining; going up is fine.
4. Work in `../FuelGuard-ads-safety` on a new branch from `origin/main`. Keep this file untracked until the docs PR.
5. Say in one short message where the monitor scenarios will live and why, then build §3 step 1. It needs no owner answer.
