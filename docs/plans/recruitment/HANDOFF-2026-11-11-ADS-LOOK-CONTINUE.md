# Handoff — ads: the look is built (L1–L3); continue with the judge, art direction and the starters, 2026-11-11

**For:** a fresh chat that continues the ad-look redesign. **From:** the chat that planned it, built the renderer,
the preset fields and the copywriter's prompt v4. **Untracked on purpose**, like the handoffs beside it; commit it
with your first PR (the previous handoff, `HANDOFF-2026-11-10-ADS-AD-DESIGN.md`, is already committed on the
branch below).

## 0. The owner's words, in order

- 2026-11-10, on the old ads: *"they don't look really good, professional and enterprise grade."*
- Standing: *"you are product manager and you should analyze and make decisions that will be best solutions for
  us."* Decide, record each decision in the plan under that sentence, the owner can overrule.
- On which look: *"build what you think it is the best and also what is most modern and best quality."*
- On the copywriter's live recording: *"Yes, record it."* **That OK covered that one recording only.** The owner
  was then asked whether the finished-ad judge may run on the Anthropic key and answered by asking for this
  handoff — so **the judge and the art director are NOT yet approved. Ask before each live recording.**
- He also asked, and was answered (do not re-answer unless asked): one ad for months is bad (refresh every 2–4
  weeks; the system retires a tired ad, D-AD23, and entering the next concept is Q-AD68); automatic trend research
  was ruled out on 10-31 (no API reports trends); animation is the video step C6, after the canary, not built;
  better pictures wait on the Higgsfield key and the image-model choice (Q-AD20).

## 1. Read first

1. `docs/plans/recruitment/ADS-AD-LOOK-PLAN.md` **on branch `claude/ads-look-renderer`** — decisions D-ADL1–11,
   questions Q-ADL1–5, and a progress log with every measurement. It is the source of truth; this file is a map.
   Ids are a series of their own (D-ADL / Q-ADL) so they cannot race a parallel chat's D-AD / Q-AD numbers.
2. Memory: `ads-ad-look-position.md` (START HERE note), then `recruiting-ads-agent-position.md`.
3. `HANDOFF-2026-11-10-ADS-AD-DESIGN.md` §3 (the rails) and §6 (traps), and
   `HANDOFF-2026-11-10-ADS-PHASE1-CONTINUE.md` §5 (working rules).

## 2. Where it stands

**PR [#2227](https://github.com/miroslav-jokovic/fuel-guard/pull/2227)** — branch `claude/ads-look-renderer`,
worktree `/Users/miroslavjokovic/Projects/FG-ads-look`, head `92a0e95`, **CI green**, mergeable, **stacked on
#2194** (`claude/ads-ag4-anchored-cut`). Four commits:

| Step | What | Key? |
|---|---|---|
| L1 `f8dc95d` | The renderer: words on the picture in display faces, measured scrim, drawn button, footer with phone and legal line, kit colours read, two looks `rail` and `ribbon` | no |
| L2 `c242be0` | Preset contract: optional `look`; `overlay_slots.kicker` / `.subline`; Presets drawer fields; kit drawer says "Ground colour" | no |
| L3 `1c3393e` | Copywriter prompt v4: slots drawn on the picture carry `on_image`; 69 fixtures re-recorded live | **yes, used** |
| `92a0e95` | `composeCreative.test.ts` gets one 20 s limit for the file | no |

The stack it waits on, all OPEN, all based on `main`, all waiting for the owner's merge:
#2184 (plan) → #2185 → #2187 → #2191 → #2194, then #2211 (starter presets) and #2216 (finished-ad judge), which
both stack on #2194 and not on each other. **#2227 does not contain #2211 or #2216.**

### The code, in three files (`apps/api/src/modules/ads/creative/overlay/`)

- `overlayLooks.ts` — what a look IS (`LOOKS`, a `LookSpec` per look), `paletteOf` (accent, primary, ground from
  the kit), `SCRIM_STEPS`, `QUIET_SHARE`. Add or change a look here.
- `overlayLayout.ts` — where every word goes, no picture: claim check, capitals, the headline ladder, rows,
  footer, the `stack` rect. `overlayFit` (in `overlay.ts`) calls it, so the fit asked before the render and the
  render agree.
- `overlay.ts` — paints: `scrimFor` (measures), shapes, logo chip, text, then `checkRender` on the finished
  background.
- Fonts: `apps/api/src/lib/adFonts.ts`; Barlow Condensed ×4 and Anton, OFL, in `apps/api/src/lib/fonts/` with
  licence files.
- Shared: `AD_LOOKS`, `overlaySlotList`, `OVERLAY_SMALL_LINE_MAX_CHARS = 28`, `OVERLAY_HEADLINE_MAX_CHARS = 58`.

### Numbers already measured (do not re-derive; they are in the plan's log)

- Headline limit on the 386 recorded headlines: `ribbon` 58, `rail` 52, 45 or fewer fits every look, format and
  layout.
- Small lines: 28 of the widest capital fit both lines in both looks on every format; 29 do not.
- Copywriter v4: 63 of 64 agree (v3: 58 of 60). Headline median 29 → 27 characters.
- Mutants: 12 of 12 (renderer), 8 of 8 (contract/compose/editor), 1 of 1 (roles sent) caught.

## 3. What to do next, in the order proposed to the owner

**A. L5 — the finished-ad judge on the new look (ask for the key first).** This is the before-and-after score for
the whole redesign; the plan's "done when" needs it. Known baseline: no sound ad of the OLD overlay scored above
3 of 5 on `hierarchy_reads`.
- The judge (`workers/finishedAdJudge/`) lives on `claude/ads-ag5-finished-ad-judge` (#2216), **not** on the look
  branch. Its fixture images (`fixtures/images/clean-*.jpg`, `weak-*.jpg`) are ads drawn by the OLD overlay over
  the checker's clean photos (`workers/checker/fixtures/images/clean-highway|clean-empty-road|clean-truck-yard.jpg`).
- So: make a branch that holds both (branch from `claude/ads-look-renderer`, merge
  `origin/claude/ads-ag5-finished-ad-judge`; expect a conflict in `overlay.test.ts` / the readiness registry at
  most), find how #2216 drew its fixture images, redraw the three `clean-*` with the new renderer **on the same
  photos with the same words**, and record. Keep the old images' scores as the "before" (they are in #2216's
  fixture JSON, `recorded.output.scores`).
- Decide and record: do the `weak-*` fixtures (planted defects: weak hierarchy, off-kit colours, blurred subject,
  words that mismatch) get redrawn too? `weak-hierarchy` was planted by drawing badly with the old overlay — the
  new renderer may not be able to draw that defect at all, which is itself a finding.
- Put the per-criterion before/after table in the plan's progress log.

**B. L4 — art direction for drama (ask for the key first).** D-ADL10: the art director's prompt and composition
clauses (`packages/shared/src/ads/artDirection.ts`: `FOCAL_CLAUSE`, `DISTANCE_CLAUSE`, `QUIET_REGION`) ask for a
low angle, golden hour or night, the subject filling half the frame or more. The renderer's stack budget is
`QUIET_SHARE = 0.4` of the frame while `QUIET_REGION` tells the image model "the lower third" — reconcile them
(either the clause says two fifths, or the budget says a third; measure which reads better). Real proof waits
for V4's image model; say so.

**C. Which starter preset takes which look (Q-ADL4) — no key.** Needs #2211 merged or merged into your branch.
Recommendation on record: pay-led and equipment-led concepts take `rail` (its accent marks the figure), lifestyle
and "straight talk" take `ribbon`. Add the kicker and second-line slots (max 28) to the starters that suit them.

**D. Two weak spots in the v4 copy — fixing either is a prompt change, so a live re-record (ask first).**
1. "No fact twice" is not held: 3 of 12 pairs repeat a word between rows ("Class A dedicated" over "Dedicated
   route. 401k.").
2. P5 (carousel): the slot drawn as the headline is a card (`card_get`), written long (47–68 characters). P5
   needs its own short headline slot before it uses the small lines — a preset change, not a prompt change.

**E. Not started, not promised:** a third look (D, italic and slanted, was judged promotional; C, the brand
frame, a flyer); words behind the truck (needs a subject mask, D-ADL9); the owner's copy rating sheet (#2054,
Q-AD57) is still the only ground truth for copy quality and is still empty.

## 4. Rails that must not move

- D-AD9: the image model never draws letters; our renderer composites every word.
- Every drawn line of COPY is claim-checked at the renderer (`overlayLayout.ts` step 1). The legal line and the
  kit's phone are not copy and are not claim-checked — a phone is digits.
- D-AD12: copy, render and visual checks decide; a person approves every ad.
- The visual check's band is `stack` (kicker to button), not the union of every drawn box.
- `plate_color` null = no darkening, the contrast check alone decides. Do not "fix" that.
- `data-samples/` is gitignored: other companies' ads, never committed, never reproduced.

## 5. Traps this chat hit

- **A hook rewrites shell commands** (`ls`, `cat`, `grep`, `find`, `git`, `du`, `wc`, `curl` → `rtk …`) and auto
  mode then refuses the call once. Write `rtk git`, `rtk grep`, `rtk ls`, `rtk read` yourself and it passes first
  time. `zsh` also eats `--include=*.ts`: quote it or drop it.
- **An unquoted heredoc runs backticks.** A PR body written through `python3 - <<EOF` lost a test title to the
  shell. Use `<<'EOF'`, or the Write tool.
- **`git push` hung for six minutes once** (a stalled `git-remote-https` child). Kill and re-push with
  `GIT_TERMINAL_PROMPT=0`.
- **A new test title in `overlay.test.ts` must be mirrored in `scripts/ads-readiness.registry.mjs`**
  (`lint:ads-readiness` reads titles literally), with the reason written above the entry.
- **Re-recording the copywriter moves the headline corpus**, so `overlayCapacity.test.ts` re-measures the
  ceiling: it went 56 → 58. Change the figure in shared to what is measured; never bend the test.
- **Planted fixtures are skipped by `--record`** and keep the old `prompt_version`: bump the five
  `planted-*.json` by hand or `lint:agent-fixtures` fails.
- **`AppSelect` and a null option:** an option with `value: null` collides with the default disabled
  "Select…" placeholder (both are `""`). Pass `placeholder=""` when null is a real choice.
- **The capacity test timed out** until text measurements were cached (`shaped()` in `overlayLayout.ts`).
- **CI is slower than a laptop by 2×** on the compose tests; that file now has a 20 s limit. If another ads test
  that renders whole composes times out by milliseconds, it is the same thing.
- **Goldens:** `UPDATE_GOLDEN=1 pnpm exec vitest run src/modules/ads/creative/overlay/overlay.test.ts` from
  `apps/api`, then OPEN the PNGs before committing. 14 of them.

## 6. Commands that worked

```bash
# Live recording (the worktree has no .env; never read the file):
cd /Users/miroslavjokovic/Projects/FG-ads-look/apps/api
node --env-file=/Users/miroslavjokovic/Projects/FuelGuard/apps/api/.env --import tsx src/scripts/adsEval.ts <worker> --record
# 64 copywriter calls took about 25 minutes, one after another: run it in the background.

# Render real ads to look at (scratch script pattern): import overlay.ts by absolute path from a .mts file,
# run with `node --import tsx <file>.mts` from apps/api; photos in workers/checker/fixtures/images/.

# Browser pass of the ads settings page (the worktree has no apps/web/.env):
cd apps/web && VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key \
  VITE_DEV_BYPASS=true node scripts/preview-local.mjs --port 4391   # read the real port from the END of the log
# then Playwright with one ctx.route on /(api|rest/v1|auth/v1|storage/v1)/ — /api/ads/settings needs an
# AdsSettingsView ({settings: ADS_SETTINGS_UNSET, version: null, kill_switch: false, ...}), /api/ads/presets
# {presets:[...]}, /api/members {members:[]}; page: /settings/recruiting/ads.

# Gates run locally before each push (all green at 92a0e95):
pnpm typecheck && pnpm lint && pnpm lint:filesize && pnpm lint:funcsize && pnpm lint:tests && pnpm lint:boundaries \
  && pnpm lint:comment-claims && pnpm lint:ads-readiness && pnpm lint:agent-fixtures && pnpm lint:ui-adoption
```

The mock-up page shown to the owner (four candidate looks): https://claude.ai/artifact/94CaFt22aDGaTywd9ueQCB.
The scratch scripts (`mock.mjs`, `try.mts`, `live.mts`, `cap.mts`, `cap2.mts`, `pass.mjs`) were in that chat's
scratchpad and may be gone; nothing depends on them.

## 7. Done when (for the redesign as a whole)

- The judge, re-run on the new look with the owner's OK, scores it above the old one on the same photos, and the
  per-criterion numbers are in the plan's log.
- The starters each name a look, and at least two use the small lines.
- #2227 and whatever you add are merged after #2194, and the plan says what is still open.
