# Ads and leads — audit of 2026-11-18

**Asked by the owner, 2026-11-18:** stop building, audit what is built, name gaps, assumptions and blockers, check
the quality of the agents, the architecture and the logic, and make sure the direction is right for a system that
is "reliable, precise and secure".

**Read from:** `origin/main` `4b99978`. **Plan:** [`ADS-PLATFORM-V2-PLAN.md`](ADS-PLATFORM-V2-PLAN.md) — its §0
carries this audit's conclusions and the order of work. Finding ids are **A-*n***.

**What this audit read, and what it did not.** Read: the plan, `pnpm ads:readiness`, `agentModels.ts`,
`scripts/ads-certifications.json`, the planning code (`plan/`, `workers/strategist/`), the module layout, and
searches named beside each finding. **Not re-read line by line:** the publisher, the budget guard, lead intake,
the outcome feed. Their state is taken from the scorecard and their tests, not from a fresh reading.

## 1. Verdict

The design is sound and should be kept. It is proven only against simulators written by the same reader as the
code they test. Nothing has met real Meta, a real image model or a real video model, and no agent's judgement has
been compared with a person's. The next work is proof and research, not more surface.

## 2. What is built

- **One pipeline:** opening → plan (a person approves) → words, pictures, checks → review (a person approves each
  ad) → launch (admin only, fresh sign-in) → monitor → pause, lower or retire.
- **Seven model agents:** Strategist, Copywriter, Art director, Checker, Craft judge, Finished-ad judge, Analyst.
- **Workers with no model:** orchestrator, budget guard, publisher, monitor, lead intake, outcome feed, renderer.
- **Motion ads** from the plan to a paused video ad, on the simulator.
- **Rails:** kill switch; three spend limits; sealed tokens opened in one place; an append-only ledger; a daily
  reconcile against Meta; Launch refused in code below L4.

Scorecard: nine workers at L3, six at L2, none at L4.

## 3. What holds, and why

| Pattern | Why it is right |
|---|---|
| Code gathers the facts, a model proposes, code checks, a person approves | A model's error is caught by something that is not a model |
| Every figure in an ad is a figure of the opening, checked at the copy and again at the renderer | The one legal risk an ad's words carry is closed twice |
| The model never draws a letter | No misspelt pay figure can come from a picture model |
| One ledger row per model call, keyed, budgeted, replayed on a second run | A retry cannot buy or ask twice, and a stored answer is judged against what was sent |
| No agent can spend or contact a lead | The two acts that cost money or trust have exactly one road each |
| What is offered, what is allowed and what is made are read from one place (concepts, formats) | A plan cannot promise an ad that will not be made |
| Launch asks a certification record, not a flag | "Ready" is a recorded run, never somebody's opinion |

## 4. Findings

| Id | Finding | How it was read | The fix | Where in §0.3 |
|---|---|---|---|---|
| A-1 | **The simulator and the client share one reader.** At least six behaviours are marked "our reading": the wait for a video's `ready`, `image_hash` on a video lead ad, a second finish, a 1080-wide file, the outcome events' shapes, the hourly insights' grain | Comments in `simulator/fakeMeta*.ts`; plan V4 | Run every contract suite on Meta's sandbox (`pnpm ads:certify`); each refusal is fixed in the client AND in the fake, with the page or the sandbox answer cited | 1 |
| A-2 | **Meta's pages are headed v27.0; the client calls v26.0** | Plan V4l | Read the v27.0 changelog, then move `META_GRAPH_VERSION`; FakeMeta answers only the client's version, so both move in one PR | 1 |
| A-3 | **No picture or video model is chosen.** Every real render is refused; the simulator draws placeholders | `prices.ts`, `videoModels.ts` | The sitting (Q-APX12, Q-AD20) on the owner's key, under $4 for video, judged first on "is it still our truck" | 1 |
| A-4 | **No agent's judgement has a human ground truth.** The Finished-ad judge chooses the winner of nine pairings and has never been compared with the owner's taste; Copywriter, Craft judge, Checker and Strategist wait the same way | Scorecard, the L3 line of each | The owner rates the 60 copy sets (ready since 11/16); approvals and rejections of real ads and plans are kept as labels (Q-APX3); no floor or automatic choice is tightened before agreement is measured | owner; 5 |
| A-5 | **Research is thin.** A first campaign's evidence is the job's facts and one benchmark. Two of six evidence kinds (`market`, `swipe`) have no builder | `plan/evidencePack.ts` writes `benchmark`, `lead_outcome`, `our_result` and the job; no `workers/researcher` | Build the Researcher (reads allow-listed pages into evidence items, no tool that writes) and the swipe file; both enter the registry at L0 and are recorded | 2 |
| A-6 | **Leads come from Meta alone** | Search of `apps/api/src/modules` for Tenstreet, Indeed: no hit | V7 through the existing `LeadSink`; Indeed waits on Indeed's approval of the employer | 7 |
| A-7 | **The Checker runs on the writers' model** (Opus 5.5). The two judges were moved to another model for exactly this reason (F-AG7) | `agentModels.ts` | Record the Checker on Fable 5.2 and compare recall with its baseline; move it only if met or beaten twice. Its pure checks do not depend on a model either way | with 2 |
| A-8 | **No expiry is tracked for a Meta token.** A system-user token can be issued non-expiring, but nothing reads which kind a connection holds | Search of `connections/` and `platforms/meta/` for `expires`, `debug_token`: no hit | Read the token's expiry when a connection is checked and show it on the health page; alert before it lapses. Confirm on the sandbox what Meta returns for a system-user token | 3 |
| A-9 | **There is no health page** (last webhook, failed jobs, cost and pass rate per agent) | Plan V8 | Build the read first (API), the page with V6 | 3 |
| A-10 | **A video cannot be priced or, possibly, sent:** the budget is in "credits" Higgsfield does not have, and the video is 1080 wide against a stated 1,200 minimum | Q-APX16, Q-APX17 | As recommended in each question; the sandbox says whether 1080 is refused | 4 |
| A-11 | **"Automated" is gated by evidence that takes elapsed time:** the canary's 72 hours for Level B; 50 real decisions and counsel's wording list for Level C | Q-APX1 | Start the canary as early as the sandbox allows; nothing else shortens it | 5, 6 |
| A-12 | **The whole road has not run in one piece.** Plan → paused video ad is proven link by link, each with its own test | V4o progress entry | The staging walk on a simulator connection, once the workspace exists to walk it in | 3 |
| A-13 | **The database still lets a campaign into `composing` with no plan**; only code refuses it | Plan §5a | The migration, one release after #2460 reaches production | any time |
| A-14 | **Counsel:** the review package, and the release wording for a driver's clip, are outstanding | Plan V4; counsel package | Owner's; blocks driver clips and Level C, nothing else | owner |
| A-15 | **The plan read as "nothing built", and thirteen ruled questions were headed "open"** | The plan's header and §5 headings | Fixed with this audit: §0 added, headings corrected | done |

**Checked and found sound, so not findings:** the Analyst is on Opus 5.5 on purpose (it scored 13 of 14 on Sonnet
5.5, below its baseline); the two judges are on a different model from the writers; no worker, compose or
generation file reads a lead's name, phone or e-mail (`security/adsAgentInputBoundary.test.ts`).

## 5. Assumptions still standing, each labelled where it lives

These are ours, with no page behind them. None is hidden; each is to be looked at when the thing it concerns is
first seen for real.

- A motion ad that cannot be made leaves the creative ready as its still (owner has not ruled).
- The planner chooses a video by whether the picture has something that moves, and keeps one idea a still.
- `MOTION_DIRECTION` is one fixed sentence; the one-second and two-second timings of a motion ad.
- The publisher waits for `ready`: 12 reads, 5 seconds apart.
- With a dark kit ground and white words the frame check cannot fail.

## 6. Blocked on the owner

1. Meta: the app, a system-user token, a sandbox ad account id.
2. The Higgsfield key.
3. The rating of the 60 copy sets.
4. Rulings: Q-APX5, Q-APX16, Q-APX17, Q-APX18, Q-APX19, and the first line of §5 above.
5. Counsel's package.
