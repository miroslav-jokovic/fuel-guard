# Handoff — ads and leads, second version: after the planning stage (written 2026-11-16)

You are continuing the build of the ads and lead-collection feature in Silvicom 360 (repo `FuelGuard`).
The planning stage (step V2) is built except its two extra evidence kinds. Check §3 against the code first
(ten minutes), then continue in the order of §6.

## 1. What the owner asked for, in his words

- "we are at really low level regarding this agents, and design and automatization"
- "we have only image ads and no videos, we have design that will not be top of the class and it is little
  bit primitive, looks like AI is in rush to create ad without any research"
- "Settings pages look confusing"
- Four parts: "Silvicom 360 preview, Settings and full control · Agents in charge of research, planning,
  producing and pushing ads (controlled) on social media · Orchestration automated and Manual to be options ·
  Leads collection engine"
- Decisions must be proposed "based on real research and analysis and not on some assumptions".
- Goal: "100% complete and enterprise grade … top of the line modern and trending system and ads".
- 2026-11-15, three rulings: "We will proceed as recommended planing should be mandetory" and "We will test
  in staging in couple days when feature is 100%".
- 2026-11-16: "we will proceed with remaining work".

## 2. Read first

1. `docs/plans/recruitment/ADS-PLATFORM-V2-PLAN.md` — four parts, steps V1–V8, rulings in §5a (Q-APX6 is
   ruled there now). Ids are **D-APX / Q-APX**, a series of their own.
2. Memory: `ads-platform-v2-position.md` (updated 2026-11-15), `recruiting-ads-agent-position.md`,
   `ads-ad-look-position.md`.
3. Progress entries `docs/plans/recruitment/ads-progress/2026-11-15-*.md` — nine now; the last two are
   `…-1700-W-V2c8.md` (the idea reaches the writers) and `…-1900-W-QAPX6.md` (planning mandatory). Add yours.
4. `ADS-AGENT-BUILD-WORKFLOW.md` §4R (readiness levels L1–L5).
5. Work state list `ads-platform-v2` (work_state_read).
6. For V3: `ADS-AD-LOOK-PLAN.md`, `ADS-CREATIVE-QUALITY-PLAN.md` (§8 has the rating page), and the audit
   findings the plan cites (F-AG3, F-AG5, F-AG6).

## 3. State at handoff

- Main: `36c0e62` at the time of writing (other chats keep moving it). Last migration on main: `0618`.
  **No ads migration was added on 2026-11-15**; the ads schema is still `0606`. Staging serves main.
- **Nothing runs anywhere.** Ads are off on staging and production. Parameter Store read 2026-11-15
  (213 names): no `ADS_*`, `META_*` or `HIGGSFIELD_*` name on either environment. Production has no ads rows.
  `scripts/ads-certifications.json` is empty; `HIGGSFIELD_STILL_MODEL` is `null`.
- None of the ads work is released to production.
- Scorecard (`pnpm ads:readiness`): 9 workers at L3; Copywriter, Art director, Craft judge, Finished-ad judge
  and Strategist at L2; none at L4.
- No ads pull request is open. Everything below is merged.

## 4. What was built on 2026-11-15, after the previous handoff

| PR | What |
|---|---|
| #2429 | An approved plan decides which ads are made and in what order (`planDraw`); the Strategist is held to the kinds of ad the carrier's enabled presets can make |
| #2451 | **Each ad is written and drawn from its plan idea.** `writerAngle` (`packages/shared/src/ads/campaignPlan.ts`); `composeCampaign` reads the approved plan once and hands each creative its angle; `copywriter@5` is handed `plan: { idea, proof }`; `artDirector@6` is handed `idea`. The craft judge and the checker are deliberately not told |
| #2460 | **Planning is mandatory (Q-APX6 ruled (b)).** The machine's `draft → compose` row and the `compose` event are gone; `plansFor` is gone; `applyCampaignEvent` refuses any move into `composing` for a campaign that names no plan (`no_approved_plan`) |
| #2462 | Plans and registry record the rebuilt rating page |

**The road of every new campaign now:** draft → planning → plan review → a person edits or approves →
composing, one ad per idea of the plan, in the plan's order, written from that idea → review → as before.

**Measured:** Art director 19 of 19 on two consecutive passes; Copywriter 130 of 131 on the recording pass,
131 of 131 on the second. Twelve new fixtures carry a plan idea (`plan-*` for the Copywriter, `idea-*` for the
Art director); two are ideas made of instructions, which neither agent followed.

**The copy rating page** (https://claude.ai/artifact/KG1h65doetP92nctQvSvnx) was rebuilt as version 2 from the
`copywriter@5` recordings: 60 sets, 170 candidates shown, previews redrawn in the current looks. It held no
ratings. Sources: `~/.claude-mem/deliverables/FuelGuard/ad-copy-ratings-v5/` (`build-data.mts`,
`render-looks.mts`, the page). Saving a rating on the published page signed in was not tested.

## 5. What is true and easy to misread

- **The Strategist's switch no longer chooses a road.** It starts off like every agent (D-RA9 stands). With it
  off a campaign stops at planning with "the Strategist is switched off in the ads settings"; a person
  switches it on and presses *Try planning again*.
- **Only the code refuses an ad without a plan.** The database still allows a campaign into `composing` with
  no plan from any state but plan review (AX032 holds that one row). The migration is owed **one release
  after #2460 ships**, never in the same release (MIGRATION-DISCIPLINE §the-deploy-window).
- **Campaigns made before #2460** (staging has some, production none) carry no plan: one already composing
  finishes on the seeded draw; one in review can be approved and launched; none can be sent to make ads again.
  The seeded draw and the unplanned launch list stay in the code for them.
- **Every new campaign's launch waits on the Strategist's L4** (`meta:plannedstill`).
- **On the "proof" preset the plan's idea lost the headline.** Its formula leads with figures, so the headline
  stayed "$0.72 per mile" and the idea (the owner who still drives) went to the line under it. Not a check
  failure; a judgement nobody has made yet.
- **Plans and copy are shown sound, not good.** No measure of "good" exists until the owner rates the 60 sets
  and people approve real plans.
- **The staging walk is deferred by the owner** until the feature is complete. Do not ask him to switch ads on
  for staging before then.
- **A Copywriter prompt change re-records all 131 model fixtures**, the 60 starter sets among them, so the
  rating page must be rebuilt again. Read its `ratings` and `starters` stores first (ArtifactData); never
  replace a page that holds ratings.

## 6. What to do next, in order

### A. V3 · Design quality (the plan's next step, ~6 days)
The plan's four parts, in the order I would build them:
1. **Make many, show few.** Per angle: three pictures and three sets of words; the finished-ad judge ranks the
   nine pairings; the person sees the winner and may open the rest. Today one render is made per creative.
   Read `compose/composeCreative.ts` first: the copy candidates and the fit ranking already exist (D-AD26), so
   the new part is several renders and the pairing rank. Check what it costs per campaign in renders and
   tokens before proposing the numbers; the owner asked for decisions from measurement.
2. **Photo library.** The brand kit's photos gain tags (truck, trailer, driver, yard, road); a kit with one
   photo is told it will repeat itself (F-AG5). This is a brand-kit contract change: check whether it needs a
   migration or lives in the versioned kit JSON.
3. **Preview as shown.** Each ad in a Facebook feed frame and an Instagram story frame, both languages.
4. **A reference set of the carrier's own choosing** (Q-APX3) that the judge scores against.

Done when the review screen shows a winner and its rivals, and the preview frames match Meta's safe zones
measured on the sandbox. "Top of class" cannot be claimed before a real image model is chosen (Q-AD20).
Write new questions as Q-APX7 onward with what was read for each; check the number is free on `origin/main`
first (parallel chats).

### B. Small owed items, any time
- **The Strategist fixture `otr-many-facts`** lists "no-touch freight" and "pets allowed" as job details; a
  real opening never does (`openingSubjectMatter`). Correct the brief, re-record the Strategist, run twice.
- **Whether the craft judge should rank by "does it carry the plan's idea".** A judge prompt change, its own
  recording. Would also settle the "proof" preset question in §5.
- **The Researcher and the swipe file** — V2's two remaining evidence kinds (`market`, `swipe`); no code yet.

### C. Then, per the plan
V4 video → V6 Ads workspace (V8 health page with it) → V5 automation modes → V7 lead engine.

### D. After the release that carries #2460
The migration holding "no `composing` without `plan_id`" in the database, with its PGlite matrix case.

### E. What only the owner can unblock (nothing real runs without it)
- Meta: the app, a system-user token, a **sandbox ad account id**
  (`/silvicom/staging/api/META_SANDBOX_AD_ACCOUNT_IDS`), then `pnpm ads:certify` for L4.
- Higgsfield: the API key and the image model choice (Q-AD20).
- His rating of the 60 copy sets on the rating page — the only ground truth for the words.
- Q-APX5 (speech-to-text for driver clips): research owed by Claude, nothing built; V4's driver clip waits on it.

## 7. Traps met on 2026-11-15

- **Build writer fixtures from `opening-*` briefs.** A job detail that reads as a benefit may only be quoted
  whole; two fixtures built on the Strategist's malformed brief were refused 3 of 3 until the two phrases were
  moved to facts. Check details with `checkClaims` before recording.
- **Run a model evaluation twice.** The one Copywriter refusal on the recording pass did not repeat.
- **The Copywriter recording takes about 60 minutes a pass** (131 calls). Run it detached (`nohup … &`) and
  watch the log; background Bash with a 10-minute timeout is killed long before it ends.
- **A prompt change keeps every earlier prompt file**, and planted fixtures must be refiled under the new
  version (`recorded.prompt_version`) or `lint:agent-fixtures` fails.
- **The craft judge's request is built from the Copywriter's message.** A field added there reaches the judge
  unless it is deleted in `judgeUserMessage`.
- **A surviving mutant can be a real hole.** The mandatory-planning change passed every test with a shortcut
  put back in the machine; looking for why found `failed → resume_compose`. A no-op mutant is not a survivor:
  say which is which.
- **The readiness registry names tests by title.** Renaming or removing a test fails `gen:ads-readiness` with
  the title; change the registry in the same PR and say why.
- **Main moves every few minutes.** `git fetch` and `git rebase origin/main` before pushing, check
  `git diff --stat origin/main HEAD` shows only your files, then `pnpm install --frozen-lockfile` and the
  gates again. A merge can answer "Base branch was modified": wait a few seconds and retry.
- **rtk condenses command output** and can drop words from long lines; use `rtk proxy <cmd>` for anything read
  closely (plan text, grep results).
- **Scratchpad scripts cannot `import "sharp"` or Playwright by name**; resolve them through
  `createRequire("<worktree>/apps/api/package.json")`.
- Mutation scripts: Python, one mutant at a time, original text held in memory and restored in `finally`.
- claude-mem's work-state write refuses a JSON-array `work_product` string; pass one URL.

## 8. Commands that worked

```bash
# live eval or recording, from the worktree's apps/api (never read the .env file itself)
env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN node \
  --env-file=/Users/miroslavjokovic/Projects/FuelGuard/apps/api/.env \
  --import tsx src/scripts/adsEval.ts <worker> [--record]      # EVAL_SHOW=1 prints a disagreeing answer

# before every push
node scripts/ci-local.mjs --job gates,typecheck                 # add test-web, test-packages when touched
pnpm gen:ads-readiness && pnpm ads:readiness                    # after any registry or fixture change

# the suites the ads work touches
CI=true npx vitest run src/modules/ads src/queue                # from apps/api
CI=true npx vitest run src/ads                                  # from packages/shared
CI=true npx vitest run                                          # from packages/ads-golden
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key CI=true \
  npx vitest run src/features/ads                               # from apps/web
node supabase/tests/ads-foundation.test.mjs

# servers
curl -s https://staging-api.360.silvicominc.com/api/version
aws ssm describe-parameters --profile silvicom --region us-west-2 --query 'Parameters[].Name' --output text
```

## 9. Housekeeping

- Start each piece on a new branch from `origin/main` in a new worktree; then `pnpm install --frozen-lockfile`
  and `pnpm --filter @silvicom/shared build:rn`.
- Worktrees holding only merged branches, safe to remove: `../FG-ads-v1b`, `../FG-ads-v1c`, `../FG-ads-v2a`,
  `../FG-ads-v2b`, `../FG-ads-v2c`, `../FG-ads-v2d`, `../FG-ads-v2e`, `../FG-ads-v2f`.
- PR flow: branch `claude/<topic>` from `origin/main`, PR, merge yourself when every check passes and none is
  pending. Title for an office reader; body follows the four headings of `.github/pull_request_template.md`.
- Recordings run on the owner's Anthropic key on the standing "recordings approved" ruling, fixture data only.
  Say what you are about to record before each one.
