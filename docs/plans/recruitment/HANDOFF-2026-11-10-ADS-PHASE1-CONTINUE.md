# Handoff — ads agents, Phase 1 continues at the starter presets (2026-11-10, afternoon)

**For:** a fresh chat that continues the build. **From:** the Phase 1 build chat of 2026-11-10.
**This file is untracked in the main checkout on purpose**, like the handoffs beside it. The next chat's first PR
commits it.

Read first, in this order:

1. `docs/plans/recruitment/ADS-CREATIVE-QUALITY-PLAN.md` §7 — the Phase 1 plan, the rulings (Q-AD75, Q-AD76,
   Q-AD77, Q-AD58) and decisions D-AD24–D-AD28. **It is in PR #2184; if that is not merged yet, read it from
   `origin/claude/ads-phase1-plan`.**
2. `docs/plans/recruitment/HANDOFF-2026-11-10-ADS-AGENTS-BUILD.md` (also in #2184) — §3 holds the rulings for
   Phase 2 (Q-AD69–Q-AD72), §4 the whole build order, §5 the working rules. Everything there still holds except
   what §3 below corrects.
3. `docs/plans/recruitment/ads-progress/` — the five entries of 2026-11-10 named `…-P1-…`, one per step.

The owner's standing instruction for this feature: *"you are product manager and you should analyze and make
decisions that will be best solutions for us."* Decide, and record each decision in the plan with that sentence as
the authority. The owner can overrule any of them.

---

## 1. Where things stand

**Merged:** the four lead PRs #2173, #2174, #2177, #2181 (LR1–LR4).

**Open, waiting for the owner's merge, in this order** (the desktop app refuses `gh pr merge` from the chat as
"Merge Without Review", for docs-only PRs too this time; do not retry a refused merge):

| Order | PR | Step | Branch | CI at handoff |
|---|---|---|---|---|
| 1 | #2184 | Phase 1 plan, rulings, the first handoff (docs only) | `claude/ads-phase1-plan` | re-running after a one-sentence correction |
| 2 | #2185 | P1-1 + P1-2: ads made only in the published formats; a 9:16-only preset refused at save | `claude/ads-ag2-feed-format` | green |
| 3 | #2187 | P1-3 (AG1): the copy is the best-ranked one that fits; headline slot ceiling 56 | `claude/ads-ag1-copy-fits` | green |
| 4 | #2191 | P1-4 (AG3): art director v3, composition directed | `claude/ads-ag3-art-direction` | green |
| 5 | #2194 | P1-5 (AG4): the frame request and the square cut | `claude/ads-ag4-anchored-cut` | was running |

**#2187, #2191 and #2194 are stacked**, each on the one before, all with base `main`. Each shows its parents'
commits until they merge. If a parent is squashed or its branch deleted, rebase the child on main (memories
`stacked-pr-merge-trap`, `deleting-a-base-branch-closes-its-stacked-pr`).

**First act of the next chat:** `rtk proxy gh pr view` each of the five. If any is still open, either stack the next
step on `claude/ads-ag4-anchored-cut` or wait; do not branch P1-6 from a main that lacks P1-1 (it needs
`publishedFormats` and `OVERLAY_HEADLINE_MAX_CHARS`).

---

## 2. What is left of Phase 1

**P1-6 · AG6 — starter presets and concept fields (Q-AD77, Q-AD58). Track S. No migration.**

- Recipe (`packages/shared/src/ads/brandKitContract.ts`, `adPresetRecipeSchema`) gains optional `hook_family` and
  `scene_family`, closed lists: hooks pay-first, life-first, equipment-first, straight-talk, proof; scenes cab POV,
  equipment on road, equipment at rest, home/street, abstract plate. Optional on the stored recipe (older bodies
  still parse), required by `adPresetSaveSchema` for a new version.
- The API save (`apps/api/src/modules/ads/routes/brandKits.ts`) refuses a pair another LIVE preset already holds,
  naming both keys. It needs the other presets, so it cannot live in the Zod schema.
- `packages/shared/src/ads/starterPresets.ts`: five recipes, five distinct pairs, each parsed by
  `adPresetSaveSchema` in a test. Each needs both slot sets, a feed format, and a headline slot of 56 or fewer.
  Give each three to five image slots and a brief-aware hook formula (CQ5's text in the plan's §3).
- `POST /api/ads/presets/adopt`: writes version 1 of each starter key the carrier does not have, **disabled**.
  Adopting twice writes five once. A new route needs its entry in the security ledger, the route sweep and
  `scripts/table-writers.json` if a new file writes a table.
- Web: the empty Presets tab offers "Start from five ready-made presets"; the preset drawer gains the two family
  fields.
- Done when: an adopted preset composes on the simulator; two live presets with one pair are refused.

**P1-7 · AG5 — the finished-ad judge (Q-AD76: score shown, no floor). Track W. No migration.**

- Worker `finishedAdJudge`: one vision call per published format on the composed English image; four criteria
  (subject legible, words and picture agree, hierarchy reads, looks like the kit), each 1–5 with one line; stored
  under `checks.finished_ad` (add the key to `adCreativeChecksSchema` first — `composeCreative.test.ts` walks the
  schema and fails on a key it does not hold); shown on review as a second opinion, never a gate.
- A new entry in `CAMPAIGN_WORKERS` means the readiness registry row, its pins, the launch-refusal words and the
  `adsCertifyPlan` lines in the same PR.
- Its fixtures are recorded live. **This spends the owner's Anthropic key; ask again before recording** (the
  owner's "Yes, record" on 2026-11-10 was for the art director's 14 fixtures).
- Switched off or out of budget, the creative still reaches review and says the judge did not run.

**Then the Phase 1 walk** (handoff §6 "Done when"): on the simulator, a campaign composes from an adopted starter
preset; the review screen shows the finished-ad score. Nothing built so far has been walked on the simulator.

After Phase 1: Phase 2 (Q-AD69 maker-checker, Q-AD71 label, close reasons in the campaign drawer, Q-AD72
mechanism switched off), then Phase 3 on the Meta sandbox. The first handoff's §4 has the order.

---

## 3. What this chat decided or corrected (all recorded in the plan's §7)

- **P1-1 and P1-2 went as one PR** (#2185): every code PR waits for the owner's merge.
- **D-AD26:** the copy is chosen by measuring the overlay's fit BEFORE the render (`overlayFit`), so a fallback
  costs no picture. A contrast refusal is the picture's and still stops at the overlay.
- **D-AD27, corrected by measurement:** the headline ceiling is **56 characters**, measured with the real overlay
  over 360 recorded headlines (45 or fewer always fit, nothing over 56 fits). The first definition, from the mean
  letter width, gave 50–52 and was wrong. `overlayCapacity.test.ts` re-measures it.
- **D-AD28:** the part of the picture that stays plain is derived from the preset's layout and TOLD to the art
  director; it is not an answer (the first handoff's `empty_space` field was not built). The art director
  answers `focal_subject` and `camera_distance` only.
- **D-AD28, corrected:** the square cut keeps the edge the WORDS sit against (bottom for `bottom_plate`, top for
  `top_band`, centre for `centered`), not the subject's side and not `focal_subject`. The text stack is the same
  height in pixels on both formats, so this is the cut that keeps the headline off the truck.
- **Art director v3 live record:** 42 calls. Run 1 scored 7 of 14 (the model wrote the layout into its slots);
  after rewording rules 9 and 10, two consecutive runs scored 14 of 14. 13 of 14 answers chose `medium`: the
  answers are acceptable, the eval does not say they are good.

---

## 4. Known gaps, stated plainly

- **No real image exists.** `HIGGSFIELD_STILL_MODEL` is null (V4, Q-AD20). The composition clauses, the frame
  request and the cut are proven on the simulator and fixtures only. `prices.test.ts` fails the day a model is set
  without its price, its image field and its frame field.
- A brand kit zone moved to the opposite edge from its layout would disagree with the cut. Nothing checks it.
- A creative mid-compose at deploy with an art answer stored under prompt v2 stops as `replay_off_schema`;
  "Make new ads" starts a fresh one. Production has no campaigns.
- `outcomeFeed.sweep.test.ts` failed once in a full local run under load and passed alone three times; not
  caused by this work.

**Still needed from the owner:** merge the five PRs; the Higgsfield API key (Q-AD20); the Meta sandbox credentials
and `META_SANDBOX_AD_ACCOUNT_IDS` on staging; the copy rating sheet on #2054 (Q-AD57).

---

## 5. Working rules that cost time today (in addition to the first handoff's §5)

- **Worktree:** `/Users/miroslavjokovic/Projects/FuelGuard-ads-ag`, installed, `build:rn` done, web `.env` copied.
  It sits on `claude/ads-ag4-anchored-cut`. The main checkout has no ads module.
- **A commit takes two to four minutes** (the post-commit hook rebuilds the graph). Run `git commit` and
  `git push` in the foreground with a 600000 ms timeout, one git write at a time.
- **The `rtk` hook rewrites `ls`, `cat`, `grep`, `wc` inside a command and auto mode then refuses the call
  once.** Write `rtk ls`, `rtk read <file>`, `rtk proxy grep`, `rtk wc`, `rtk git`, `rtk proxy gh` from the start.
- **zsh aborts on an unmatched glob:** quote `--include="*.ts"`.
- **GitHub sometimes starts no CI run for a new PR** (#2181 had none). Check `gh pr checks` a minute after
  opening; an empty commit pushed to the branch starts it.
- **Local checks before a push**, from the worktree: `pnpm typecheck`; `node scripts/ci-local.mjs --job gates`
  (everything staged first; about two minutes); in `apps/api`
  `CI=true npx vitest run src/modules/ads src/modules/recruiting src/queue`; in `apps/web`
  `CI=true npx vitest run src/features/ads`; in `packages/shared` `CI=true npx vitest run src/ads`.
- **A new headline-slot fixture above 56 breaks a preset SAVE** (`brandKits.test.ts`, the shared contract test).
  A recipe that only passes through `adPresetRecipeSchema` (the worker fixtures' `hook: 60`) is unaffected.
- **Overlay goldens** are regenerated with `UPDATE_GOLDEN=1` and must be opened and looked at before committing.
- **Prove each test by breaking the code.** The mutant scripts of this chat (5, 14, 11 and 9 mutants) follow one
  pattern: replace a line, run the suites, restore the file, print RED or green.
- **Do not use `git stash`** in this repository (memory `git-stash-pop-takes-another-sessions-stash`); this chat
  did once and was lucky.
- **A plan correction** goes on the plan's own branch while #2184 is open, never into a code PR's branch (two
  branches editing `ADS-CREATIVE-QUALITY-PLAN.md` would conflict).

---

## 6. Done when

- P1-6 and P1-7 are merged or open and green, each with its progress file and its mutants named.
- The simulator walk in the first handoff's §6 has been done and what it showed is written in a progress entry.
- Q-AD77, Q-AD58 and Q-AD76 are marked built in the plan.
