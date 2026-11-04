# Handoff · 2026-11-04 · Ads agent, Stage 1 from step C5 (the Checker, and compose wired)

**Paste this whole file into a fresh chat.** It continues `HANDOFF-2026-11-03-ADS-STAGE1-C.md`. That handoff's
§2 (open questions) and §5 (owner track), and the §4 trap lists it points back to (B5, B4b, D0, B2 handoffs and
the 11/01 handoff's §1 owner rulings, not to be re-asked), **still hold**. This file replaces its §1 position,
§3 step and §6 first action. Stage 1 = agents + orchestrator proven against fakes, **no social-network or
Higgsfield credentials**.

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, the release train, "No workarounds", the two-merge rule.
2. `docs/plans/recruitment/ADS-AGENT-BUILD-WORKFLOW.md`: the **C5 row** (§4, ~line 223), §4R's **Checker** row
   (L2 planted-defect corpus; L3 "pure checks catch 100 %, vision recall measured, an owner-set threshold gates
   L3, a person still approves every creative"), and the **progress log's end** (C1, C2a, C2b, C3, C4 are the
   newest entries — each says what was NOT built and why).
3. `docs/plans/recruitment/ADS-AGENT-PLAN.md`: **D-AD12** (three checks, one regeneration, then stop with the
   reason; "never loops on credits"), D-AD9 (no lettering; image-to-image from our photos), D-AD10 (the visual
   rules are a closed checklist from the brand kit), D-AD13 (generation ledger).
4. What C5 plugs into (all on main except C4, see §1):
   - `packages/shared/src/ads/brandKitContract.ts` — `AD_VISUAL_CHECKS` (the closed checklist: `no_glyphs`,
     `no_foreign_logos`, `equipment_matches_reference`, `no_malformed_people_or_vehicles`, `people_policy_met`,
     `safe_zone_clear`), `people_policy`, `forbidden_marks`, recipe `copy_slots: {name, max_chars}[]`.
   - `apps/api/src/modules/ads/workers/copywriter/copywriter.ts` (`writeCopy`, `judgeCopy` — the copy check,
     pure) and `workers/artDirector/artDirector.ts` (`directArt`; shared `artDirection.ts`).
   - `apps/api/src/modules/ads/creative/higgsfield/render.ts` (`renderStep`, async via job `ads_render`) and
     `creative/overlay/overlay.ts` (`renderOverlay`, which already runs the pure render check and refuses).
   - `apps/api/src/modules/ads/generations/claudeGeneration.ts` + `lib/anthropic.ts` (`callForcedTool`) — the A4
     rail. **It sends text only** (`user: string`); see §3 gap 1.
   - `apps/api/src/modules/ads/workers/agentFixtures.ts` (`EVAL_WORKERS`), `scripts/check-agent-fixtures.mjs`,
     `apps/api/src/scripts/adsEval.ts` — the replay / eval / gate pattern a new model worker joins.
   - `apps/api/src/modules/ads/orchestrator/workers.ts` (`compose: null`) and `runner.ts` lines ~90–97: compose's
     `WorkerResult` is `{ok:true}` → `creatives_ready` or `{ok:false}` → `compose_failed`. **There is no
     "not finished yet"**; see §3 gap 2.
   - `supabase/migrations/0537_ads_foundation.sql` §5 `ads_creatives` (~line 291; content frozen once it leaves
     `generating`/`checking`, AX030) and `CREATIVE_STATES` in `contracts.ts`.
   - `scripts/ads-readiness.registry.mjs` — Checker L1 has `notBuilt("C5 …")`.

## 1. Done

| Step | PR | Merge | What |
|---|---|---|---|
| C1 | #1998 | `f6d1e50` | Brand kit + presets API, versioned (insert-only); uploads sniffed by bytes (shared `sniffFormat`, no boundary breach), SVG checked then rasterised, assets by sha256 in bucket `ad-assets` (**migration 0562**); named grant `ads.brand-kit`. |
| C2a | #1999 | `ed33418` | Copywriter (`workers/copywriter/`, prompt v1, 15 fixtures, **baseline 9/10**), `pnpm ads:eval <worker> [--record]`, gate **`lint:agent-fixtures`** (in `ci.yml` gates). Copy checked by `checkClaims` + slot length (`too_long`). Copywriter **L2**. |
| C2b | #2000 | `59345d7` | Art director (`workers/artDirector/`, shared `artDirection.ts`: pre-check, `judgeArt`, `composeImagePrompt` ending `NO_LETTERING`), **baseline 10/10**. Art director **L2**. |
| C3 | #2002 | `85ac2bc` | Higgsfield client: `renderStep` (Idempotency-Key = ledger row id; while `started` it re-submits under the same key = free poll; no webhook receiver), shared `creditGate`, job `ads_render` (`KIND_CAPS` 1), sealed key reader (`higgsfieldKeyFor`). Output copied to `ad-assets` at once; no URL stored. |
| C4 | **#2005** | **open at handoff** | Overlay renderer: headline ≤ 2 lines / CTA / EEO line (EN+ES), fixed sizes, re-checks claims, contrast sampled under the words, refuses rather than shrinks; goldens `__golden__/{1x1,4x5,9x16}.png`. Renderer **L2**. |

- **First action includes C4:** if #2005 is still open, check its CI (`gh pr checks 2005`). Green → merge it
  (memory "PR flow": merge yourself when green). A failing `overlay.test.ts` golden on Linux would mean Skia
  antialiasing differs more than the tolerance (< 0.5 % of pixels off by > 48 levels): look at the diff, then
  either widen the tolerance with the measured number in a comment, or regenerate goldens on Linux — never
  delete the comparison.
- **Main at handoff:** `85ac2bc` (C4 not yet in). **Newest migration on main:** `0562_ad_assets_bucket.sql`.
  Confirm both BY NAME at start; other chats merge all day.
- **Scorecard (`pnpm ads:readiness`) once C4 is merged:** Orchestrator L3, Budget guard L3, **Copywriter L2, Art
  director L2, Renderer / Higgsfield client L2**, Monitor L1, Lead intake L1, Security L1; **Checker L0**,
  Publisher L0, Outcome feed L0, Analyst L0.
- Worktree `../FuelGuard-ads-d1`; branch a fresh `claude/ads-c5-…` from `origin/main` there.

## 2. Open questions and blockers (do not route around them)

Unchanged from the C handoff: Q-AD23/24/25/26, **Q-AD12 presets, Q-AD14 brand kit, Q-AD20 Higgsfield key**, G12 /
Q-AD8 counsel. New consequences of C3, to keep in view:
- **`HIGGSFIELD_CREDIT_PRICES` is empty** (`creative/higgsfield/prices.ts`): every render is `price_unknown` until
  V4 measures real prices with the owner's key. Compose must treat that as a clean, visible refusal, not a crash.
- **No Higgsfield Connect door** (waits Q-AD20). **No reference-photo upload** to Higgsfield yet (D-AD9
  image-to-image): FakeHiggsfield has no upload endpoint and the upload docs are unread — read
  `https://docs.higgsfield.ai` (the fake's header lists the pages already read, 2026-11-02) before building it,
  cite page + date in the fake, and say what is OUR reading (L4 confirms).

## 3. Next step: C5 — the Checker, then compose wired (PRs ≤ ~500 lines each)

Done-when (workflow): **planted glyph image fails; planted foreign logo fails; a second failure stops with the
reason.** Three checks per creative (D-AD12): copy (pure — `judgeCopy`, exists), render (pure — `renderOverlay`
already refuses on `checkRender` findings), and **visual** (Claude vision over the generated image, answering
each `AD_VISUAL_CHECKS` item pass/fail with a reason, stored with provenance). One regeneration with the failure
added to the prompt (`budgets.max_regenerations`, default 1), then stop and show the reason. A person still
approves every creative.

Two capabilities are missing; each is a fix, not a detour ("No workarounds"):
1. **The AI rail cannot send an image.** `callForcedTool` / `generateWithClaude` take `user: string`. Extend them
   to accept content blocks (text + image, base64 from OUR stored asset — never a provider URL), keeping one
   rail, one ledger row, and the request hash covering the image's sha256 (not its bytes). Read the `claude-api`
   skill before touching the SDK call.
2. **Compose has no "not finished yet".** Rendering is async (`ads_render` job, polled by retry), but the runner
   reads compose as done-or-failed. Recommendation: `WorkerResult` gains `{ pending: true }` → the runner stays in
   `composing` with no event (re-enqueued by the tick), and every sub-step is idempotent by key so re-running
   compose replays instead of re-asking. Read `runner.ts`, `tick.ts` and `campaignMachine.ts` first; if the
   machine needs a change, that is the shared machine's test matrix too.

Suggested order (each its own PR):
- **C5a — the visual check:** rail accepts an image; `workers/checker/` prompt pack (vision, forced tool returning
  one verdict per `AD_VISUAL_CHECKS` item), joins `EVAL_WORKERS` + `lint:agent-fixtures`; a **planted-defect
  corpus** of real images (lettering, a foreign logo, wrong truck type, malformed shapes) — §4R says generate them
  with the developer's Higgsfield CLI login (memory "Higgsfield image generation"); commit small JPEGs, label each
  planted. Pure aggregation: any `fail` = check failed, with reasons. Baseline via `pnpm ads:eval checker`.
- **C5b — compose:** fill `workers.ts` `compose`: per drawn preset, create the `ads_creatives` row (`generating`),
  copy → art → enqueue `ads_render` → (pending) → overlay per format → checks (`checking`) → `ready` or
  `check_failed`; one regeneration on a failed check (new attempt keys), then stop with the reason. First writer of
  `ads_creatives`: pin it in `scripts/table-writers.json`, retire its waiver in `check-table-producers.mjs`, and
  respect AX030 (content frozen after `checking`). Add `pending` to the runner (gap 2).
- Readiness: Checker L1 = C5a + C5b tests pinned; L2 = the planted corpus. Remove the `notBuilt` line.
- Progress-log entry per PR at the END of the workflow file. Mutation-prove every behaviour test.

**Then (unchanged order):** B2c (the ad itself + `createPaused`), F1, D2, E1–E5, B6; C6 (video) after C5 and G9.
**Honest calendar:** the first real ad is no earlier than the day after L4 (Stage 2, credentials). Say so if asked.

## 4. Traps hit in the C chat (add to the earlier lists)

- **`lint:ads-readiness` reads test titles LITERALLY.** An `it.each` title is invisible to it; a pinned case
  needs its own `it("<exact title>", …)` (C2 and C4 both hit this).
- **Table gates read `.from("<literal>")` call sites.** `.from(variable)` fails `check-table-access`; wrapping
  `.from("t")` in an accessor hides the write chain from `check-table-writers`. Write literal chains, pin new
  writers in `scripts/table-writers.json` (insert in place — do not re-sort the file), and retire the matching
  waiver in `check-table-producers.mjs` (it fails on a stale waiver).
- **A new migration changes `supabase/schema.generated.sql`**; commit the regenerated file or `lint:table-writers`
  fails on the diff.
- **New shared exports are invisible to the API until `pnpm --filter @silvicom/shared build:rn`**; the editor's
  diagnostics stay stale until then (tests still run).
- **`ci:local` job names follow `ci.yml`:** `gates`, `typecheck`, `bundle`, `test-api`, `test-web`,
  `test-packages`, `matrices` (there is no `typecheck-build` job).
- **`test-api` under load fails unrelated suites** (seen: `evidence/routes/fileAccess.test.ts`,
  `maintenance/routes/inventoryPartUsage.test.ts`); re-run the file alone and say so in the PR. A local
  `test-packages` once died at 18 s with an empty log and passed on re-run.
- **A literal BOM (U+FEFF) in a regex fails `no-irregular-whitespace`**; write `﻿`.
- **A model counts characters badly:** tell it ~85 % of a limit, enforce the real one in the check
  (`TOLD_LIMIT_SHARE`). Keep length out of the tool schema so an overrun is a recorded, refused answer.
- **`pnpm ads:eval` calls the real model with the developer key** (no ledger, no org): ~10 calls per worker, a
  few cents. `--record` rewrites recordings and `baseline.json`; the gate then demands both match the prompt
  version. Read the recorded answers by hand — the judge cannot tell a right photo from a valid one.
- **FakeHiggsfield serves a real 2×2 PNG** per request (colour from the request id) since C3 decodes outputs.
- **`modules/org/jobs.ts` is at 494/500**: a new job kind gets a one-line comment.
- **Mutation script:** `/private/tmp/.../scratchpad/mut.py` is gone with the old chat; the pattern is: replace
  one exact string (assert count == 1), run the one test file, restore the original bytes and assert they match.

## 5. Owner track (unchanged, due Mon 11/09)

As in the C handoff §5, plus: the **Higgsfield API key (Q-AD20)** now unlocks two concrete things — V4 (real
credit prices into `prices.ts`) and the Connect door. **Brand kit (Q-AD14)**: C4's renderer refuses any format the
kit has no overlay colours for, so no real ad image can be drawn until the kit is saved. **Presets (Q-AD12)**: the
Art director's eval re-runs on P1–P5 once approved. Approval of the next release (it carries A5 → C4).

## 6. First action in the new chat

1. Read §0.
2. Check #2005 (C4): merge it if green (§1). Then confirm main's HEAD and the newest migration **by name**;
   confirm no other chat has an open PR on `modules/ads/workers`, `creative/`, the AI rail (`lib/anthropic.ts`,
   `generations/`) or `orchestrator/` (`gh pr list --state open`).
3. Run `pnpm ads:readiness`; it must match §1 (Copywriter, Art director, Renderer L2; Checker L0).
4. Read `runner.ts`/`tick.ts`/`campaignMachine.ts`, `lib/anthropic.ts` and 0537's `ads_creatives`; say in one short
   message how you will close §3's two gaps (image in the rail; compose `pending`) and what C5a needs that does
   not exist yet. Then build C5a.
