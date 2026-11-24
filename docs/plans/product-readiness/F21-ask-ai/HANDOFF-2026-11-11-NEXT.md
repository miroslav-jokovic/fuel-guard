# Handoff — Ask AI (F21): finish R4b, then the first eval baseline — 2026-11-11 evening

Paste everything below the line into a fresh chat.

---

Continue the Ask AI reporting engine (F21). Read `docs/plans/product-readiness/F21-ask-ai/PLAN.md` §5 (Q-AI4, Q-AI12, Q-AI13) and the §6 entries dated 2026-11-11, plus the memory note `ask-ai-assistant-position.md`.

## State (2026-11-11 evening)

**Merged to main today:**
- #2237 Q-AI12: Fuel costs and Buy discipline open at fuel view. The owner's approval of the R4b handoff is recorded in PLAN §5/§6.
- #2239: one org-owned `orgToday`, used at every UTC-day read (DQ, annual inspections, digest, alerts, dispatch board, both assistant tools).
- #2240 Q-AI4: `ai_assistant_usage` is kept 400 days.
- #2244 R3a web half: follow-up questions. #2223 was verified in production first.
- #2241, #2246, #2249: R4b links with the answer's filters for Fuel costs, IFTA and Loads.

**Open, CI green when last checked:**
- #2252: R4b links for Applicants, Drivers and Fuel cards (worktree `../FG-askai-r4b-lists`).
- #2243: the Fleet report's period in its URL (worktree `../FG-fleet-period-url`).

**Pushed, no PR yet:** branch `claude/askai-r4b-fleet-link` (worktree `../FG-askai-r4b-fleet`). It contains #2252 and #2243 merged in, plus:
- the Fleet report link from `finance_report` / `income_statement`, with the tab and the grain;
- the PLAN §6 entry "What is left after R4b, with recommendations".

## Next steps, in order

1. **Merge #2252 and #2243.**
   - Recheck each with `gh pr checks`.
   - After the first one merges, the other turns DIRTY on PLAN.md (and `packages/shared/src/index.ts`). Fix it with: `git merge origin/main`, then keep both sides, main's side first. The resolver script is: for each `<<<<<<< … ======= … >>>>>>>` hunk, keep the `origin/main` side and then ours.
   - Typecheck, push, wait for green, merge.
2. **Open the Fleet report link PR** from `claude/askai-r4b-fleet-link`.
   - Merge `origin/main` in first.
   - Check that `git diff --name-only origin/main...HEAD` is only the Fleet report link files plus PLAN.md.
   - Run the gates (`pnpm ci:local --job gates`, `pnpm typecheck`, `pnpm lint`).
   - Write the PR body under the template's four headings and merge when green. This finishes R4b.
3. **First eval baseline on production (R7). ASK THE OWNER FOR A ONE-LINE "GO" RIGHT BEFORE RUNNING IT.**
   - What it does: reads Silvicom's production data with `apps/api/.env`'s service role, sends tool results to the model provider, costs about $0.05, writes nothing.
   - Command: `pnpm --filter @silvicom/api eval:assistant --org 86d6b3ea-4361-4f71-877f-e8373615769b --record`.
   - Commit `eval/baseline.json` in a PR with a §6 entry giving the score and the failing cases.
   - Then retire `idling_summary` if no case needs it.
4. **Then the recommendations recorded in PLAN §6 ("What is left after R4b").** Ask the owner which to take; recommended order:
   - The owner rules Q-AI1, Q-AI2, Q-AI3, Q-AI5, Q-AI6, Q-AI7, Q-AI8 and Q-AI9 in one pass. The next PR records each ruling.
   - R4b for the four tools still linked bare (`idle_report`, `fleet_now`, `annual_inspections_due`, `maintenance_cost`): check each page's URL state first, and add a link contract only where the page can show exactly the answer.
   - Streaming (Step 2d): measure first from `ai_assistant_usage` latency, and build SSE only if the median answer takes over about 5 s.
   - Dock (Q-AI7 → Step 3a), then voice (Q-AI3 (a)), then `open_view` navigation (Step 5).
   - Breadth (Step 4): one section per PR, guided by where the baseline fails.
   - Writes (Step 6): assign a finding and create a saved view first.
   - Q-AI13: a roster item-state filter, only when an office asks.

## Working rules that bit this session

- **One worktree per PR from a pinned `origin/main` sha.** Stacked branches open only after the one below merges; then merge `origin/main` in.
- **Check a branch with `git diff origin/main...HEAD` (three dots).** Two dots also shows unrelated work that landed on main after the fetch.
- **Every link is built by its page's `*LinkContract.ts` in `packages/shared`**, and the page reads its keys from the same file. `askData` lifts `link` off a tool result with `splitAssistantLink` before the model sees it (D-AI8).
- **`LINK_ANY` restates `@silvicom/ui`'s `ANY_PARAM`.** This is labelled in the code and pinned by a test.
- **Assistant tool tests:** since the carrier-day fix, tools call `orgToday`, so a test client must be a recorder holding an `organizations` row, not `{}`.
- **zsh traps:**
  - never name a shell variable `path` (it is tied to `$PATH`);
  - `timeout` does not exist;
  - foreground `sleep` chains are blocked, so wait with an `until` loop or a background job.
- **Post-merge hook:** `graphify update` runs after every merge and takes about 30–60 s. Don't kill it.
- **Known flakes; rerun alone before believing them:**
  - `pageLoadFailureRetry.test.ts`
  - `UnitFileSection.test.ts`
  - the dashboard widget tests under full-suite load
- **CI's `bundle` job** installs Chromium from Playwright's CDN, which had an outage on 2026-11-11 (around 31-minute hangs). Use `gh run rerun <id> --failed` once it recovers.
