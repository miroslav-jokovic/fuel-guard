# Handoff — ads agents and lead relevance: plan and build what the two audits left (2026-11-10)

**For:** a fresh chat that plans and builds. **From:** the audit chat of 2026-11-10.
**This file is untracked in the main checkout on purpose** (like the other handoffs beside it); the next chat's
first PR commits it together with the rulings in §3.

Read these first, in this order, from `origin/main`:

1. `docs/plans/recruitment/ADS-AGENTS-AUDIT-2026-11-10.md` — findings F-AG1–14 and F-LR1–12, build list AG1–AG9
   and LR1–LR8, Q-AD74–77. **The build list in its §3 is the plan this handoff continues.**
2. `docs/plans/recruitment/ADS-AGENT-PLAN.md` §9 — Q-AD69–73 (enterprise controls) and the pointer to Q-AD74–77.
3. `docs/plans/recruitment/ADS-CREATIVE-QUALITY-PLAN.md` and `ADS-LEAD-INTAKE-PLAN.md` — the parents (CQ1–9, LQ1–9).
4. `docs/plans/recruitment/ads-progress/README.md` — one progress file per step, in the PR that does the work.

---

## 1. Where things stand

**Owner's two asks (2026-11-10):** ads that are "high quality, well directed and composed"; leads that are
"relevant, reliable, and not some random leads that will be useless".

**Verdict of the audits.** Copy is well directed. The image is not: no image model is chosen, nothing directs
composition, one render is centre-cropped to every format, nothing judges the finished ad, a carrier starts with
no presets. Lead intake is reliable; Meta is still asked for the cheapest lead (`LEAD_GENERATION`), and that
waits on a sandbox reading.

**Built today, four PRs, NONE MERGED** (the desktop app's permission check refuses `gh pr merge` on a code PR —
"Merge Without Review"; docs-only PRs do merge). **The owner merges these, in this order:**

| Order | PR | Step | Branch | Note |
|---|---|---|---|---|
| 1 | #2173 | LR1 — the not-qualified alert waits for leads received, not leads called | `claude/ads-lr1-not-qualified-gate` | |
| 2 | #2174 | LR3 — a lead with no phone or email rings nobody; the no-contact alert rings from the webhook road too | `claude/ads-lr3-no-contact-detail` | |
| 3 | #2177 | LR2 — a held number and a current driver ring nobody; a returning person rings "answered again" | `claude/ads-lr2-returning-person` | stacked on #2174 |
| 4 | #2181 | LR4 — close reasons per campaign in the daily brief; analyst prompt v6 | `claude/ads-lr4-closure-reasons` | stacked on #2173; CI was still running at handoff |

**First act of the next chat:** `gh pr view` each of the four. Build nothing that touches
`recruiting/leads/leadSink.ts`, `shared/ads/leadQuality.ts`, `shared/ads/analystBrief.ts` or the analyst worker
until they are on main, or stack on the branch that holds them. A stacked PR shows its parent's commit in its
diff until the parent merges; if a parent is squashed or its branch deleted, rebase the child on main (memory:
`stacked-pr-merge-trap`, `deleting-a-base-branch-closes-its-stacked-pr`).

Merged today: #2170 (Q-AD69–73) and #2171 (the audit document). Q-AD74 is ruled (a) and built as LR2.

---

## 2. What is left

| Group | Steps |
|---|---|
| Ads, buildable now | AG1 copy fallback when the overlay refuses · AG2 refuse a preset with no feed format · AG3 composition direction for the art director |
| Ads, were waiting on a ruling (now ruled, §3) | AG4 composed per format · AG5 a judge that sees the finished ad · AG6 starter presets and concept fields |
| Ads, later | AG7 reviewer picks a candidate or re-renders · AG8 overlay craft · AG9 results feed the next draw |
| Leads, Meta sandbox first | LR5 quality-lead goal (Q-AD17) · LR6 phone lookup (= LQ8b) · LR7 re-judge on profile change (= LQ9) · LR8 test and organic leads, dated alert key |
| Leftovers from LR1–LR4 | a returning person still counted as a new lead in the quality shares · close reasons not in the campaign drawer · nothing rings on close reasons |
| Enterprise controls | Q-AD69 maker-checker · Q-AD70 invoice reconciliation · Q-AD71 period close · Q-AD72 lead retention · Q-AD73 real-platform proof |
| Owner acts | Higgsfield API key (Q-AD20) · Meta sandbox credentials and `META_SANDBOX_AD_ACCOUNT_IDS` on staging · the copy rating sheet (#2054, Q-AD57) |

---

## 3. Product rulings, by delegation

The owner's instruction for this handoff: *"you are product manager and you should analyze and make decisions
that will be best solutions for us."* These are ruled on that delegation, 2026-11-10. **Record each in its plan
file, with this sentence as the authority, in the PR that first builds on it.** The owner can overrule any of them.

| Question | Ruling | Why |
|---|---|---|
| **Q-AD75** composed per format | **Render and check only the formats the publisher sends (4:5, and 1:1 when the preset has it). 4:5 is the primary: ask the model for that aspect. 1:1 is cut from it, anchored on the subject the art director names (AG3), not on the centre. 9:16 is not rendered or checked until Q-AD29 opens a placement for it.** Revisit two renders only if V4 shows the anchored crop loses the subject. | An unused 9:16 crop failing a good feed ad is a bug today. One render keeps credits flat; the feed image is what a driver sees. |
| **Q-AD76** judge of the finished ad | **Build it; show its score and its one-line reasons to the reviewer; NO floor yet.** A floor is added only after its scores have been compared with the owner's approve/reject on 30 real ads. | A threshold set before that comparison is a number somebody picked. The reviewer still gains a second opinion on day one. |
| **Q-AD77** starter presets | **Ship five starter presets as adoptable data: a carrier adopts them into its own versioned presets and edits them. Five distinct hook × scene pairs; a save refuses two live presets with the same pair.** Nothing is auto-enabled. | An empty Campaigns tab that cannot compose is the first thing a new carrier meets, and distinct concepts are what Meta's delivery needs. |
| **Q-AD69** maker-checker | **The two-approver amount is required at first save of Settings › Ads control (no more `null`). Add a setting "the person who created a campaign may not approve its spend", default OFF, saved as a settings version; when ON it is refused in `findCoveringApproval` and in the AX020 trigger.** | A hard rule locks out a one-admin carrier. Requiring the figure removes the silent "nobody is ever second-checked". |
| **Q-AD70** invoice reconciliation | **Not now. Reopen when one real campaign has run a full calendar month.** | Production has no campaigns; a control with nothing to reconcile proves nothing. |
| **Q-AD71** period close | **Now: any month younger than 28 days is labelled "may still change" wherever a month's spend is shown. The frozen monthly figure is built with Q-AD70.** | Cheap, honest, and the frozen figure is what an invoice would be compared with. |
| **Q-AD72** lead retention | **Build the mechanism now, switched OFF: a scheduled tombstone through `purge_lead`'s own path for a never-converted lead untouched for N days, N a setting with no default. Counsel sets N (add to the counsel package, with LQ4).** | The period is a legal question; the mechanism is not, and it should exist before the first thousand leads do. |
| **Q-AD73** real-platform proof | No decision: Stage 2 closes it. Nothing in §4 is called production-ready before L4 passes. | |
| Close reasons (LR4 leftovers) | **Show them in the campaign drawer beside "What each concept did". No new alert**: Q-AD51 (a) stands, and a third alert rule waits until four weeks of real counts show which reason predicts anything. | A number nobody has seen yet is not a threshold. |
| Returning person in the quality shares | **Exclude them, by a set-based database function (one migration, then its reader in a second merge), built with LR7.** | One RPC per lead is not acceptable at volume; the two-merge rule applies to a function and its first reader. |
| "Answered again" recipient | **Leave as built: the new lead's recruiter.** | They own the row they are told to open. |
| AG7 "reject reason" | **Fixed reason list for a rejected creative (wrong truck, weak headline, off-brand, bad crop, other), each mapped to a fixed regeneration clause. Never free text into a prompt.** | Same rule the lead close-out follows; keeps reviewer text out of the model's instructions. |

---

## 4. Build order

Each line is one PR unless split. Tracks follow the ads workflow: **W** workers/platform, **S** screens/recruiting.
Plan each phase in the plan file before building it; a step that needs a migration follows the two-merge rule.

**Phase 1 — image direction and correctness (no vendor, no key). Target: the first real render is a composed one.**

1. **AG2** (S) — preset save refuses a format set with no feed format. `adPresetSaveSchema`; ~2 hours.
2. **Q-AD75 part one** (W) — compose renders and checks only the publisher's formats; a 9:16-only failure no
   longer fails the creative. `compose/composeCreative.ts`, `platforms/meta/publisherAds.ts:33` is the source of
   "which formats"; derive, do not restate.
3. **AG1** (W) — copy fallback: try ranked[0], on an overlay refusal the next; record which was used and why on
   `ads_creatives.candidates`. Preset save refuses a headline slot longer than the overlay's measured capacity
   for its layout (measure it in `overlay.ts`; the audit only inferred the number).
4. **AG3** (W) — art director v3: input gains layout, text zone in words, formats, chosen headline; answer gains
   fixed-vocabulary `focal_subject`, `camera_distance`, `empty_space`; `composeImagePrompt` writes them. Re-record
   its fixtures live, twice.
5. **Q-AD75 part two / AG4** (W) — request 4:5 from the model; anchor the 1:1 crop on `focal_subject`.
6. **AG6** (S, one migration if `hook_family`/`scene_family` are columns; check whether they belong in the
   recipe jsonb first — then no migration) — concept fields, the distinct-pair rule, five starter presets, an
   "adopt" door and button.
7. **AG5** (W) — finished-ad judge: one vision call per format on the composed image; scores and reasons on the
   creative; shown on review. Twelfth-or-later `CAMPAIGN_WORKERS` entry means registry, readiness, launch-refusal
   words and `adsCertifyPlan` lines in the same PR.

**Phase 2 — controls and visibility (no vendor).**

8. **Q-AD69** (S + one migration for the trigger half; settings half first).
9. **Q-AD71 label** (S) and **close reasons in the campaign drawer** (S).
10. **Q-AD72 mechanism, off** (S; scheduler → read `docs/WORKER-DEPLOYMENT.md` before adding one).

**Phase 3 — Meta sandbox (needs the owner's credentials).**

11. **LR5 first.** One sandbox reading answers Q-AD17. Yes → the conversion-leads goal behind a setting, once the
    outcome feed has events. No → write that in the plan and stop; the lever does not exist.
12. **LR6** (= LQ8b, already specified in the work-state list `ads-lead-intake-build`), **LR7** (= LQ9, plus the
    returning-person function), **LR8**.
13. Stage 2 certification (`pnpm ads:certify`, pass records in `scripts/ads-certifications.json`).

**Phase 4 — after real ads exist:** AG7, AG8, AG9, the craft half of the copy baseline (needs the rating sheet).

**What to ask the owner for on day one, in one message:** merge the four PRs; the Higgsfield API key; the Meta
sandbox credentials; the rating sheet on #2054. Phase 1 and 2 do not wait for any of them.

---

## 5. Working rules that cost time today

- **Read `modules/ads` only from a worktree at `origin/main`.** The main checkout sits on an old branch that has
  no ads module. Worktree used today: `../FuelGuard-ads-sapq` (installed, `build:rn` done; on
  `claude/ads-lr4-closure-reasons`). Branch each step from `origin/main`.
- **The `rtk` hook rewrites `git`, `gh`, `grep`, `ls`, `cat`, `wc` at the start of a command, and auto mode then
  refuses the call once.** Write them as `rtk git …`, `rtk gh …`, `rtk grep …`, `rtk read <file>` from the start.
- **zsh:** `$M:apps/…` reads `:a` as a modifier — quote `"origin/main:path"`. An unmatched glob aborts the whole
  command line.
- **Do not run the complete API suite locally** (the Mac runs out of room; one run hung for ten minutes and
  produced a false failure). Run `pnpm typecheck`, `node scripts/ci-local.mjs --job gates` (needs everything
  staged), and `npx vitest run src/modules/ads src/modules/recruiting src/queue` in `apps/api`. GitHub CI is the
  full check. `pkill -f vitest` before judging a failure.
- **Prove each test by breaking the code** (LR1–LR4: 4, 5, 7 and 6 mutants). Read the runner's own exit code.
- **A prompt change is a new `prompt.vN.md`, a version bump, every planted fixture's `prompt_version` bumped by
  hand, and a live re-record** — from `apps/api`:
  `env -u ANTHROPIC_BASE_URL node --env-file=/Users/miroslavjokovic/Projects/FuelGuard/apps/api/.env --import tsx src/scripts/adsEval.ts <worker> --record`.
  Run it until two runs agree fully; say every run's score in the progress entry. It spends the owner's
  Anthropic key: the owner agreed for LR4, say so again before a larger set (the copywriter has 60 cases).
- **A new field on a shared contract breaks other fixtures:** run root `pnpm typecheck`, not one package's.
- **The settings save replaces the whole object** — a new settings field must round-trip through
  `apps/web/src/features/ads/adsSettingsForm.ts`, or be derived from an existing one (LR1 did the second).
- **`shared/ads` may not import `shared/recruiting`** (D-AD17). Carry recruiting's vocabulary as data
  (`LeadQualityCounts.closed` is a `Record<string, number>`).
- **Merging:** open the PR, say it is green, leave the merge to the owner unless a docs-only PR. Do not retry a
  refused merge.

---

## 6. Done when

- Phase 1: on the simulator, a campaign composes from an adopted starter preset; the 4:5 image keeps its subject
  clear of the text; the review screen shows the finished-ad score; a bad 9:16 crop no longer fails the ad.
- Phase 2: Settings › Ads control cannot be saved without a two-approver amount; the campaign drawer shows close
  reasons; a month under 28 days old says it may still change.
- Phase 3: Q-AD17 is answered in the plan in one sentence, either way.
- Every step has its progress file, its mutants named, and its question marked ruled in the plan.
