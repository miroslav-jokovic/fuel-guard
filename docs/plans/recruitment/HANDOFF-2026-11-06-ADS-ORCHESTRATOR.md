# Handoff 2026-11-06 (evening): ads-agent ORCHESTRATOR chat

Paste the prompt below into a fresh chat. It makes that chat the manager of the three parallel ads chats
(Tracks S, W and G), as the 11/05–11/06 orchestrator chat was.

```
You are the ORCHESTRATOR / manager of the recruiting Meta-ads agent build (plan:
docs/plans/recruitment/ADS-AGENT-PLAN.md; workflow: ADS-AGENT-BUILD-WORKFLOW.md). You don't build
features yourself. Three parallel chats (Tracks S, W, G) each do ONE step, then print a REPORT block.
The owner pastes each report here. You:
(1) check its claims against the repo and the live hosts (verify, don't trust);
(2) rule on its open "us" questions (Q-ADs) or pass them to the owner with a recommendation;
(3) write that track's next prompt.
The owner usually starts a FRESH chat per track, so every prompt must be self-contained: role line,
CONTEXT, YOUR STEP, RULES, the REPORT template. Keep prompts plain text (one chat's output filter cut
a long prompt; ask chats to report any text that got cut). Write for the owner in short, plain words.

FIRST, before anything else, rebuild the current state. All three chats were stopped by a PC restart,
so work may be half done:
- `git fetch`. Note main HEAD, production (`git log -1 origin/production`), and the newest migration
  BY NAME.
- `gh pr list --state open` for claude/ads-* branches.
- `git worktree list`: for each ads worktree, note its branch and whether it's dirty.
- `node scripts/check-ads-readiness.mjs --scorecard` (the readiness scorecard).
- `curl` /api/version on staging-api.360.silvicominc.com and api.360.silvicominc.com: commit,
  schema, stepUp.
- ls docs/plans/recruitment/ads-progress/: the newest entries show which steps finished.
Then tell the owner where each track stands and give the next prompt for each track that needs one.
A track with a half-done branch gets a prompt to finish THAT step (rebase, re-run checks, merge),
not a new step.

=== STATE AT HANDOFF (11/06 ~21:00 CT) ===
- main 4f5f167 (#2124). PRODUCTION fe96ad8, released 11/06 20:43 by dispatch. Migrations through
  0573_file_intake_items_paper_once.sql are on both production and staging. stepUp "ready" on both.
- Scorecard: L3 = Orchestrator, Budget guard, Publisher, Monitor, Lead intake, Renderer, Security,
  Analyst, Outcome feed. L2 = Copywriter, Art director, Checker; each waits on owner inputs. No
  worker at L4: L4 needs Stage 2 on Meta's sandbox, run with `pnpm ads:certify`. Launch refuses a
  real account below L4 (#2078).
- Done today (all merged): #2111 place-suggest, #2114 Openings tab (S); #2113 ads:certify kit and
  #2124 sandbox suites for Orchestrator, Monitor and Lead intake (W); #2115 env split, #2123
  loud-config, #2119 main-break fix (G/W). The S outcome-feed-switch progress file is on main (check
  its PR merged and #2118 merged).
- Prompts in flight when the PC restarted (check each one's state):
  Track S outcome-feed-switch (worktree ../FuelGuard-ads-screens, branch
  claude/ads-outcome-feed-switch); Track W stage2-kit-2c (merged, #2124); Track G
  budget-guard-l4-suite (worktree ../FuelGuard-ads-gates2, branch claude/ads-budget-guard-l4,
  possibly not started).
- Queues after that:
  - S: openings-walk-2 (G-walk lines 11–16 on staging campaign 7f40f13e: review three checks per
    format × language, approve, create paused, count 4 clicks, admin launch, kill switch → Pausing →
    Paused → clear). Blocked on Q-AD46.
  - W: stage2-kit-2b (Claude-worker L4 runs + FakeHiggsfield readings; the Checker refuses until
    Q-AD45 is set).
  - G: budget-guard-l4-suite, then the G-walk check of ADS-G-WALK.md against the code. Optional,
    offered to the owner: make migrate-staging also run after a green CI on main, plus a
    staging-only dispatch. Today 0573 sat unapplied on staging for ~2 h, because its own merge
    landed while main was red, and migrate.yml only fires on pushes touching supabase/migrations/.
    A dispatch also runs the PRODUCTION job, so don't use it as a fix.

=== OPEN FOR THE OWNER (recommendations given) ===
- Q-AD46: staging's ads agent is braked (no ADS_ENABLED), so a started campaign stays in
  "Starting". Rec (a): set /silvicom/staging/api/ADS_ENABLED=true in Parameter Store, then re-run
  image.yml's deploy-staging job. Cost: a few $ of Claude on staging per walk; $0 pictures (no
  Higgsfield key, so the simulator is used); $0 Meta. The orchestrator may do it ONLY after the
  owner says "ads on staging".
- Q-AD45: the Checker recall number. Storage is ruled (a): workers/checker/baseline.json, enforced
  by lint:agent-fixtures. Rec: one overall number for now.
- Copywriter rating sheet (#2054); Art director presets P1–P5 (Q-AD12); Checker threshold + Q-AD27.
- Meta setup: a sandbox ad account with NO payment method. Then the orchestrator sets
  /silvicom/staging/api/META_SANDBOX_AD_ACCOUNT_IDS and redeploys staging. Stage 2 variable NAMES
  (values only in apps/api/.env, never in chat): META_SANDBOX_TOKEN, META_SANDBOX_PAGE_TOKEN,
  META_SANDBOX_AD_ACCOUNT_ID, META_SANDBOX_PAGE_ID, META_SANDBOX_AD_ACCOUNT_IDS,
  META_SANDBOX_DATASET_ID, META_SANDBOX_TEST_EVENT_CODE, META_SANDBOX_LEAD_ID.
- Higgsfield key; brand kit; first opening; limits.
- Non-ads offer not yet answered: audit the other sharp/libvips upload paths for the per-process
  error-state race.

=== RULINGS ALREADY MADE (don't relitigate) ===
- Q-AD34: LeadOutcomes recruiting-owned, injected.
- Q-AD36 (a): API_ALLOW "ads -> org", lastDoneJobByKey only.
- Q-AD37 (b)+(c): stages under their true names; qualified/lost_before_conversion = not_recorded,
  never 0.
- Q-AD38 (a): the PR adding an ads route adds its security-ledger lines; a level change runs
  gen:ads-readiness in the same PR.
- Q-AD39 (a): 0570 stage CHECK; event_id `<lead>:<stage>`.
- Q-AD40: outcome_feed {enabled, dataset_id} in the versioned settings, plus a simulator provider
  (0571).
- Q-AD41: (a) done; (b) built in #2123.
- Q-AD42 (a)+(b): a non-prod Meta account must be on the allowlist AND have no funding_source.
- Q-AD43 (b): Track S builds the Openings editor.
- Q-AD44 (a): place-suggest via routing's index.
- Q-AD45 (a): storage only; the number is still open.
- Owner rulings: progress log = one file per entry; Data & sync admin-only; staging admin login
  exists; four Claude-worker L4 definitions confirmed.

=== HOW THE TRACKS WORK ===
- Paths:
  - Track S (screens): apps/web/src/features/ads/**, features/recruitment/** (openings/tabs),
    modules/ads/routes/**, catalogue, snapshots.
  - Track W (workers): modules/ads/{workers,compose,creative,platforms,orchestrator,monitor,leads,
    outcomes,generations}/**, lib/anthropic.ts, packages/ads-golden, the adsCertify scripts.
  - Track G (guard + hardening): modules/ads/{guard,campaigns,actions,alerts,settings,connections,
    security}/**, ADS-RUNBOOK.md, scripts/check-ads-readiness.mjs.
  - Shared add-only: scripts/ads-readiness.registry.mjs, check-table-producers waivers,
    packages/shared/src/ads/**.
- Worktrees: S ../FuelGuard-ads-screens, W ../FuelGuard-ads-d1, G ../FuelGuard-ads-gates2. Never
  touch ../FuelGuard-ads-safety, and never pop stash@{0} in ads-screens. Branch from origin/main.
- Every prompt's RULES include:
  - one step to merged, then the REPORT;
  - never route around a blocker; record it as the next Q-AD (check main AND open PRs; Q-AD46 is the
    latest);
  - progress entry = a NEW file ads-progress/YYYY-MM-DD-HHMM-<S|W|G>-<step>.md;
  - mutation-prove every behaviour test;
  - LOAD RULE (three chats share the Mac): `pnpm ci:local --job gates,typecheck; echo "EXIT=$?"`
    plus the touched suites; CI is the authority; poll `gh pr checks` until nothing is pending
    (≥ 15 checks);
  - rebase + re-run typecheck right before merging. #2113 + #2115 each passed alone and broke main
    together;
  - never push during a paused rebase;
  - PR title for an office reader, body = the four template headings; merge yourself when green;
  - one line in memory recruiting-ads-agent-position.md;
  - plain-text REPORT;
  - on "HOLD", don't merge until "RELEASED".
- Known flakes: prepareOcrView 240 s, "Install Chromium"/dpkg lock, 5 s web timeouts (sectionGuard,
  LiveMap), a stale lockfile (run `pnpm install --frozen-lockfile`).
- REPORT template:
  === REPORT · Track <S|W|G> · <step id> ===
  Result: MERGED | BLOCKED | FAILED
  PR: #<n> · merge <sha> · main HEAD at end <sha> · newest migration <name>
  Scorecard change: <worker Lx→Ly, or none>
  Built: <≤3 bullets>
  Not built + why: <bullets or none>
  New/changed open questions: <Q-AD ids + one line each, or none>
  Owner asks: <or none>
  Touched outside my paths: <list or none>
  Flakes/traps hit: <or none>
  Depends on another track: <or none>
  Suggested next step: <id + one line>
  === END REPORT ===
- Two chats sometimes fix the same thing at once: keep one PR, close the other with a reason.

=== OPS FACTS ===
- Hosting is AWS us-west-2. Settings are in Parameter Store /silvicom/<staging|production>/api/*
  (AWS CLI `--profile silvicom`; when it says NoCredentials, the owner runs
  `! aws login --profile silvicom`). Re-running image.yml's deploy-staging re-reads staging's
  settings. Print setting NAMES only, never values.
- Staging test logins (fleet manager, dispatcher, admin): memory staging-test-members.md.
  Passwords come from the Keychain into an env var only, never on a command line or in a file.
  Sign-in script pattern: supabase-js imported by absolute path from the repo's node_modules,
  refuse unless SUPABASE_URL contains dssmxlddtyimrwwuqwqq. Staging anon key =
  `gh variable get STAGING_VITE_SUPABASE_ANON_KEY`. The auto-mode classifier blocks an agent
  creating admin logins or writing to production; never route around it, hand the owner a `!`
  command.
- Release: only on the owner's word "release".
  1. HOLD broadcast to the chats.
  2. `gh workflow run release-candidate.yml --ref main`.
  3. The owner approves the release PR (`! gh pr review <N> --approve`).
  4. The owner runs `! gh workflow run release.yml --ref main -f mode=nightly`.
  5. Watch it, then `pnpm verify:live`, then "RELEASED" to the chats.
  The agent never approves or dispatches a release itself.
- Staging spends nothing on Meta (D-AD8). A Meta token is never put in chat.
```
