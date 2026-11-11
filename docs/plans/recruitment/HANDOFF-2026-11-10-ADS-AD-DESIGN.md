# Handoff — ads: make the finished ad look professional (AG8 and beyond), 2026-11-10 evening

**For:** a fresh chat that plans, then builds, the redesign of what our ads LOOK like. **From:** the Phase 1 build chat
(P1-6 starter presets, P1-7 finished-ad judge). **Untracked on purpose**, like the handoffs beside it; the next
chat's first PR commits it.

## 0. Why this exists — the owner's words

After seeing the ads this chat drew (the finished-ad judge's fixtures), the owner, 2026-11-10: *"they don't look
really good, professional and enterprise grade."* The owner downloaded examples of what social ads should look like,
as inspiration: **`/Users/miroslavjokovic/Projects/FuelGuard/data-samples/Social ads examples/`** (10 files).
`data-samples/` is gitignored — keep it that way: these are other companies' ads, used to learn from, never
copied, never committed, never shown in our product, their brands and marks never reproduced.

The owner's standing instruction for the ads feature still holds: *"you are product manager and you should analyze
and make decisions that will be best solutions for us."* Decide, record each decision in the plan with that
sentence as the authority; the owner can overrule. **Plan first, then implement.**

## 1. Read first, in this order

1. **Look at every image** in the examples folder (Read tool). Then look at ours, for the contrast:
   `apps/api/src/modules/ads/workers/finishedAdJudge/fixtures/images/clean-*.jpg` on branch
   `claude/ads-ag5-finished-ad-judge` (PR #2216) and the overlay goldens under `apps/api/src/modules/ads/creative/overlay/`.
2. `docs/plans/recruitment/ADS-AGENTS-AUDIT-2026-11-10.md` — **F-AG9** ("The overlay will look templated": one
   bundled face, Liberation Sans; fixed 64/44/26 px; the CTA as bold text; a flat plate inset 6 %; `kit.colors` and
   `kit.phone` stored and read by nothing; no logo contrast check; three layouts that move the same stack) and
   **AG8** (kit colours and a brand face, a drawn button, logo contrast, sizes from the format). This redesign is AG8,
   made much larger by the owner's verdict.
3. `docs/plans/recruitment/ADS-CREATIVE-QUALITY-PLAN.md` §7 (in PR #2184, or `origin/claude/ads-phase1-plan`) —
   Phase 1 said "does not restyle the overlay (AG8)". D-AD9, D-AD12, D-AD26–D-AD29 constrain what follows.
4. `docs/plans/recruitment/HANDOFF-2026-11-10-ADS-PHASE1-CONTINUE.md` §5 — the working rules (worktree, slow
   commits, rtk, no `git stash`, prove tests by mutants, goldens looked at before committing).
5. `docs/DESIGN-SYSTEM-CONTRACT.md` for any web UI touched; the overlay itself is not web UI.

## 2. What the examples do that ours does not (this chat's reading — verify it with your own eyes)

Strong references: `images (1).jpeg` (HIGH VALUE FREIGHT, under a bridge at night), `post-8.webp` (Bloom & Grow,
dusk colour grade), `story-7.webp` (OWNER OPERATORS, motion), `images (5).jpeg` (OWNER OPERATOR, chevrons,
APPLY TODAY), `images (2).jpeg` (COMPANY DRIVER, text layered behind the truck), `images (6).jpeg` (JOIN OUR TEAM,
the most "real carrier" one: real trucks, phone, URL, logo). Weak or off-target, use with care: `images.jpeg`
(an agency's own promo), `images (3).jpeg` (a website mock-up, not an ad), `images (4).jpeg` (a Facebook frame
around a loud lime flyer — useful only to show how the platform frames the image), the PSD template (Portuguese,
a person: our people policy applies).

1. **Typography is the design.** Condensed display faces, heavy, often all-caps, at three or four sizes: a small
   wide-tracked kicker ("WE MOVE", "BECOME OUR"), a huge hero line, a sub-line. Ours is one regular sans at three
   fixed sizes. → bundled OFL display faces (e.g. Anton, Bebas Neue, Oswald, Barlow Condensed — check the licence
   of each; `@napi-rs/canvas` `GlobalFonts.register` already loads ours), a type scale derived from the format.
2. **No grey box.** The words sit on the picture, made readable by a gradient scrim or vignette the picture fades
   into — not a rectangle pasted on top. Our plate is the single most "amateur" element. The contrast check
   (`checkRender`, worst sample under the text) still has to pass: a scrim is how it passes without a box.
3. **One accent shape in the brand colour**: a ribbon/pill under the headline ("WITH HIGH LEVEL CARE", "on the Open
   Road", "THIS POST IS FOR YOU"), chevrons, a coloured word inside the headline ("OWNER **OPERATOR**"). Ours uses
   no kit colour except the plate.
4. **The call to action is a designed element** ("APPLY TODAY" with chevrons; a drawn button), not a line of text.
5. **The picture is dramatic and the truck is big**: low angle, golden hour or night light, colour grade, motion,
   the subject filling half or more of the frame. That is the IMAGE model's and the art director's (V4 is still
   unchosen, Q-AD20) — but the art director's prompt and composition clauses can already ask for it.
6. **Depth (text behind the truck)** in `images (2).jpeg` needs a subject mask. Probably a later step; decide.
7. **The brand frame**: logo placed deliberately, phone/URL as a footer band (`images (6).jpeg`). `kit.phone` exists
   and is drawn by nothing today.
8. **The EEO line** ("Equal Opportunity Employer") is drawn inside our plate at body size and reads as clutter.
   It is required — keep it, design it: small, at the edge, in the footer band.

## 3. What must not change (the rails)

- **D-AD9:** the image model never draws letters; our renderer composites every word, so every figure is
  claim-checked and no image carries invented text. The redesign is a renderer redesign plus art-direction prompts.
- **D-AD12:** copy, render (contrast, fit, safe zone) and visual checks still decide; a person approves every ad.
- **The claim check at the overlay** (`overlay.ts` re-checks every drawn word against the brief) stays.
- **Bilingual:** every design must hold the Spanish text, which runs ~15–25 % longer. Fit is measured before the
  render (D-AD26, `overlayFit`); a new type scale means **re-measuring the headline ceiling** (D-AD27, 56 chars,
  `overlayCapacity.test.ts`) — the save refuses a slot above it, so a change ripples into presets (P1-6's starters
  have headline slots 30–42).
- **Safe zones** per format (`renderGeometry.ts`) and the visual check's text band (compose unions the drawn boxes).
- People policy (`none` / `varied`, D-AD8), forbidden marks, no other company's logo.

## 4. Proposed shape of the work (the next chat decides and records it)

- **D1 — the design system for ads**, written into the plan before code: type scale per format, 2–3 bundled
  faces, the scrim rule, accent shapes, the drawn button, the footer band, logo placement and its contrast check;
  each layout (`bottom_plate`, `top_band`, `centered`) re-specified as a real composition, and probably renamed
  (a "plate" may stop existing). Mock-ups first: render 4–6 candidate looks from the existing fixture photos,
  show the owner a side-by-side (an Artifact page works well), get one chosen before building.
- **D2 — the renderer** (`creative/overlay/overlay.ts`, ~250 lines; the 500-line budget applies): fonts, scrim,
  accent, button, footer, kit colours read for real; `overlayFit` kept in step; goldens regenerated with
  `UPDATE_GOLDEN=1` and **opened and looked at**.
- **D3 — copy shape**: a kicker slot and a hero line are new copy roles (the examples' "WE MOVE / HIGH VALUE
  FREIGHT / WITH HIGH LEVEL CARE"). That touches `overlay_slots`, the preset contract, the copywriter prompt and
  its fixtures (a prompt change is a live re-record — **ask the owner before spending the Anthropic key**).
- **D4 — art direction for drama**: the art director's prompt and composition clauses ask for light, angle,
  grade and a big subject; re-record its baseline (ask first). Real proof waits for V4's image model.
- **D5 — the judges agree**: re-run `pnpm ads:eval finishedAdJudge` on the new look (ask first). This chat found
  that no sound ad of the CURRENT overlay ever scored above 3 on `hierarchy_reads` — the new design should move it.

Kit data: `kit.colors` (named hex colours), `kit.logo`, `kit.phone`, `kit.company_name` already exist
(`shared/ads/brandKitContract.ts`); a brand face choice would be a new optional kit field (jsonb, no migration).

## 5. Where things stand (all open, all waiting for the owner's merge, none merged by this chat)

| Order | PR | What | Branch |
|---|---|---|---|
| 1 | #2184 | Phase 1 plan + rulings (docs) — now also D-AD29, Q-AD77/58/76 marked built | `claude/ads-phase1-plan` |
| 2 | #2185 | P1-1/P1-2 published formats only | `claude/ads-ag2-feed-format` |
| 3 | #2187 | P1-3 copy that fits | `claude/ads-ag1-copy-fits` |
| 4 | #2191 | P1-4 art director v3 | `claude/ads-ag3-art-direction` |
| 5 | #2194 | P1-5 frame request and square cut | `claude/ads-ag4-anchored-cut` |
| 6a | #2211 | P1-6 five starter presets, concept families, adopt | `claude/ads-ag6-starter-presets` |
| 6b | #2216 | P1-7 finished-ad judge (second opinion, no floor) | `claude/ads-ag5-finished-ad-judge` |

#2211 and #2216 both stack on #2194 and do not depend on each other. At handoff #2211 had one failed job — a P1-5
compose test (`a model with a documented frame field is asked…`) at 5,011 ms against vitest's 5,000 on a loaded CI
shard (2.4 s locally); the job was re-run. If it recurs, give that test an explicit timeout on #2194's branch and
rebase the children. **Branch the redesign from `claude/ads-ag4-anchored-cut`** (or main once the stack merges):
the overlay there has the layout-aware cut (P1-5) and `overlayFit` (P1-3) the redesign must keep.

Still open after Phase 1: the simulator walk (an adopted starter composing; the review showing the second
opinion), Phase 2 (Q-AD69 maker-checker, Q-AD71, Q-AD72), Phase 3 on the Meta sandbox. Still needed from the owner:
the merges above, the Higgsfield key and the V4 model choice (Q-AD20), Meta sandbox credentials, the copy rating
sheet (#2054, Q-AD57).

## 6. Traps this chat hit (in addition to the first handoff's §5)

- **The API eval needs the key from the main checkout:** the worktree's `apps/api` has no `.env`. Run
  `node --env-file=/Users/miroslavjokovic/Projects/FuelGuard/apps/api/.env --import tsx src/scripts/adsEval.ts <worker> --record`
  from the worktree's `apps/api`. Never read the file.
- **The overlay refuses words the brief does not hold** (`term_not_in_brief`) and low contrast — so a mock-up
  script drawing through `renderOverlay` needs headlines the fixture brief supports and plate/text pairs ≥ 3:1.
- **`lint:ads-readiness` reads test titles literally** — an `it.each` title is not found; a new worker also needs
  its row in `ADS-AGENT-BUILD-WORKFLOW.md` §4R's table.
- **`lint:ui-adoption`** refuses an `h3` at `text-xs`: headings are `text-sm` in a card, `text-lg` for a page section.
- **A mutant aimed at the wrong suite looks like a survivor**; and a test can refuse for the wrong reason (a "score
  6" case that also had a one-letter reason). Re-aim, then check the test's own input.
- **Switching branches in the worktree makes the editor report false type errors** for files the other branch
  lacks; `pnpm typecheck` on the branch is the truth.
- **Zod `.pick()` throws on a schema with refinements** (`adBrandKitSchema`); write the small object instead.
- The Presets card browser pass needs real-shaped mocks: `/api/ads/settings` as an `AdsSettingsView`,
  `/api/members` as `{ members: [] }`, and `/api/ads/spend` can answer 500 (its card shows an error state).

## 7. Done when (for the redesign — the next chat refines it)

- The owner has chosen one look from rendered mock-ups, and the choice is recorded as a decision in the plan.
- Every published format and both languages render in that look through the real overlay, with goldens looked at,
  the contrast, fit, claim and safe-zone checks still passing, and the headline ceiling re-measured.
- The finished-ad judge, re-run on the new look (with the owner's OK for the key), scores it higher than the old one
  on the same photos, and the numbers are in a progress entry.
