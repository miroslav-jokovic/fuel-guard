# Handoff — ads and leads, second version: the planning stage (written 2026-11-15, evening)

You are continuing the build of the ads and lead-collection feature in Silvicom 360 (repo `FuelGuard`).
Check §3 against the code first (ten minutes), then continue in the order of §6.

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
- 2026-11-15, after the planning stage: "we will proceed with work as proposed".

## 2. Read first

1. `docs/plans/recruitment/ADS-PLATFORM-V2-PLAN.md` — four parts, steps V1–V8, rulings in §5a, **Q-APX6 open**.
   Ids are **D-APX / Q-APX**, a series of their own.
2. Memory: `ads-platform-v2-position.md` (updated 2026-11-15), `recruiting-ads-agent-position.md`,
   `ads-ad-look-position.md`.
3. Progress entries `docs/plans/recruitment/ads-progress/2026-11-15-*.md` — seven, one per step below. Add yours.
4. `ADS-AGENT-BUILD-WORKFLOW.md` §4R (readiness levels L1–L5; the Strategist has a row now).
5. Work state list `ads-platform-v2` (work_state_read) holds the next-step notes.

## 3. State at handoff

- Main: `0dcdf1a` (+ #2429 if merged, see §4). Last migration on main: `0613`. **No ads migration was added
  today**; the ads schema is still `0606`. Staging serves `0dcdf1a`.
- **Nothing runs anywhere.** Ads are off on staging and production; production has no ads rows and no saved
  ads settings; `scripts/ads-certifications.json` is empty (Launch refused for every real platform);
  `HIGGSFIELD_STILL_MODEL` is `null`.
- **Not re-checked today: AWS Parameter Store.** The session was expired. The 2026-11-14 reading (no
  `ADS_ENABLED`, `META_*`, `HIGGSFIELD_*` name on any server) stands unverified. Owner: `! aws login --profile silvicom`.
- Staging's `/api/version` reports `realtime: failing`, `ok: false` — not an ads fault; not investigated.
- None of today's work is released to production.
- Scorecard (`pnpm ads:readiness`): Strategist **L2** (new), the rest as before (9 at L3, 5 at L2, none at L4).

## 4. What was built on 2026-11-15 (step V2c, the planning stage)

| PR | What |
|---|---|
| #2401 | `modules/ads/plan/evidencePack.ts` (the facts a plan is written from: job, benchmark, lead counts from recruiting, each concept's results; built by code) and `planStore.ts` (the one writer of `ads_campaign_plans`; agent's and person's versions, both through `checkPlan`) |
| #2409 | The **Strategist** (`workers/strategist/`, `claude-fable-5-2`), `plan/planCampaign.ts` (pack → Strategist → store, one second ask with the findings), registered everywhere an agent is |
| #2413 | Routes `GET /api/ads/campaigns/:id/plan`, `POST …/plan/versions` (edit), `POST …/plan/approval` (`routes/plans.ts`, `plan/planDoors.ts`). Only the newest version can be approved |
| #2418 | Q-APX2: `security/adsAgentInputBoundary.test.ts` — no ads agent can be sent a lead's name, phone or e-mail. `metaConnectionsTick` moved to `connections/connectionsTick.ts` |
| #2422 | The plan review screen: `apps/web/src/features/ads/AdsCampaignPlan.vue`, `adsPlan.ts`; Approve in the drawer footer |
| #2425 | `CampaignWorkers.plan` filled, behind the carrier's Strategist switch (`plansFor`); a planned campaign's launch also waits on the Strategist (`meta:plannedstill`) |
| #2429 | **Check its state first** (`gh pr view 2429`): an approved plan decides which ads are made and in what order (`planDraw`, `compose/campaignDraw`); the Strategist is offered and held to the kinds of ad the carrier's enabled presets can make (`plan/concepts.ts`, `concept_not_available`); prompt `strategist@3` |

**The road of a planned campaign now:** draft → (switch on) planning → plan review → a person edits or approves
→ composing, one ad per idea of the plan in the plan's order → review → as before.

## 5. What is true and easy to misread

- **"Planning is on" changes nothing on any server yet.** Ads are off, and the Strategist switch starts off.
- **The idea's own words do not reach the writers.** The plan decides WHICH kinds of ad are made and their
  order. Each idea's direction (`idea`, `proof`) is not handed to the Copywriter or the Art director; they still
  write from the preset's own formula. This is the next step (§6 A).
- **Plans are shown sound, not good.** The Strategist's evaluation (8 openings, 8 of 8 on two passes, three
  prompts) proves a plan cites real facts, states no figure the job lacks, repeats no concept and names only
  makeable kinds of ad. Whether a plan is GOOD has no measure until people approve and edit real plans (L3 gap).
- **No real plan has been seen on staging.** The screen was checked in a real browser against a stubbed server
  with a plan the Strategist actually wrote. The staging walk is owed (§6 B) and needs `ADS_ENABLED` there.
- Three live recordings of the Strategist were run on the owner's Anthropic key today (fixture data only),
  on the earlier "recordings approved" ruling. Say what you are about to record before each one.

## 6. What to do next, in order

### A. Hand each plan idea to the writers (finishes V2)
Give the Copywriter and the Art director the idea of the angle their preset was drawn for (`idea`, `proof`;
never as ad copy — `checkClaims` still holds every figure to the brief). It changes two agents' inputs, so each
needs a new prompt version, re-recorded fixtures and the evaluation run **twice**. The Copywriter's pass takes
about two hours: run it detached (`nohup … &`). Compose must find a creative's angle from the campaign's plan and
the preset's hook and scene (`planDraw` already maps one to the other).

### B. The staging walk (owner must turn ads on for staging)
Switch the Strategist on in Settings › Ads control, create a simulator campaign, read the plan, edit it,
approve it, watch the ads made in the plan's order. Three fixtures for the screen (every read fails, every read
empty, real data).

### C. Q-APX6 — ask the owner
Planning is built as the carrier's choice (switch on = planned). Options and recommendation are in the plan.
If he rules it mandatory: reverse `plansFor` in `orchestrator/workers.ts` and remove the `draft → compose` row.

### D. Then, per the plan: V3 design quality → V4 video → V6 Ads workspace (V8 health page with it) →
V5 automation modes → V7 lead engine. The Researcher (web pages into `market` evidence) and the swipe file
(`swipe` evidence) are V2's remaining evidence kinds and have no code yet.

### E. What only the owner can unblock (nothing real runs without it)
- Meta: the app, a system-user token, a **sandbox ad account id**
  (`/silvicom/staging/api/META_SANDBOX_AD_ACCOUNT_IDS`), then `pnpm ads:certify` for L4.
- Higgsfield: the API key and the image model choice (Q-AD20).
- His rating of the 60 copy sets (PR #2054) — the only ground truth for the words.
- Q-APX5 (speech-to-text for driver clips): research owed by Claude, nothing built.

## 7. Traps met on 2026-11-15

- **Run a model evaluation twice.** `strategist@1` scored 8 of 8, then 7 of 8: its texts ran at the schema's
  length limits and one went over. Fix the prompt (state lengths well under the limits); never loosen the contract.
- **A prompt change keeps every earlier prompt file.** `prompt.v1.md`, `v2`, `v3` all stay; never `git rm` one.
- **A new ads agent touches:** `AD_AI_AGENTS`, `AD_AGENT_MODELS`, `WORKER_DIR` in `workers/agentModels.test.ts`,
  `EVAL_WORKERS` + a fixture schema in `agentFixtures.ts`, the web `AGENT_LABEL`, `AD_WORKER_OFFICE_LABEL`,
  `WORKER_RUNS` in `adsCertifyPlan.ts`, the readiness registry **and a row in ADS-AGENT-BUILD-WORKFLOW §4R's
  table** (the generator refuses a worker the table does not name), `EVAL_OF` in the boundary test.
- **Launch-gate keys must match `^[a-z]+:[a-z]+$`** — `meta:plannedstill`, not `meta:still+plan`.
- **The certification rule in tests needs `vi.stubEnv("DEPLOY_ENVIRONMENT", "production")`**; otherwise the
  sandbox rule answers first.
- **Git in a worktree is slow** behind the post-commit hook (commit and rebase took up to ten minutes each).
  Run them in the background and touch nothing in that worktree until they finish. After a rebase onto a moved
  main, `pnpm install --frozen-lockfile` again or the gates stop with "Run: pnpm install".
- **Push only after the gates pass**: chain with `if [ $G -eq 0 ]`, never `;`.
- **The preview port:** `preview-local.mjs` prints colour codes; strip them before grepping the port, and confirm
  the listening process's cwd is your worktree.
- **A real browser pass finds what component tests cannot.** It found Approve below the fold and a refusal
  listed where the person was not. Scratchpad scripts (may be gone): `plan-shots.mjs`, `sheet.mjs`.
- **Mutation scripts**: `mutate_v2c*.py` pattern — Python, one mutant at a time, original text held in memory
  and restored in `finally`. A no-op mutant is not a survivor; say which is which.
- Tests whose fake database needs ad presets: `apps/api/src/testing/adsPresetRows.ts` (`presetRows(org, concepts)`).
- claude-mem's work-state write refuses a JSON-array `work_product` string with a 400; pass one URL.

## 8. Commands that worked

```bash
# live eval or recording, from the worktree's apps/api (never read the .env file itself)
env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN node \
  --env-file=/Users/miroslavjokovic/Projects/FuelGuard/apps/api/.env \
  --import tsx src/scripts/adsEval.ts <worker> [--record]      # EVAL_SHOW=1 prints a disagreeing answer

# before every push
node scripts/ci-local.mjs --job gates,typecheck                 # add test-web, test-packages when touched
pnpm gen:ads-readiness && pnpm ads:readiness                    # after any registry or fixture change

# web
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key CI=true \
  npx vitest run src/features/ads                               # from apps/web
VITE_DEV_BYPASS=true VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… node scripts/preview-local.mjs --port 4391

# servers
curl -s https://staging-api.360.silvicominc.com/api/version
aws ssm describe-parameters --profile silvicom --region us-west-2 --query 'Parameters[].Name' --output text
```

## 9. Housekeeping

- Worktree in use: `../FG-ads-v2c` (branch `claude/ads-v2c-ads-follow-plan`). Start each piece on a new branch
  from `origin/main`.
- Worktrees holding only merged branches, safe to remove: `../FG-ads-v1b`, `../FG-ads-v1c`, `../FG-ads-v2a`,
  `../FG-ads-v2b`.
- PR flow: branch `claude/<topic>` from `origin/main`, PR, merge yourself when every check passes and none is
  pending. Title for an office reader; body follows the four headings of `.github/pull_request_template.md`.
