# Handoff · 2026-11-04 · Ads agent, the rest of Stage 1 in two parallel tracks

**Paste this whole file into TWO fresh chats.** Start the first with "You are **Track W** (workers)" and the second with
"You are **Track S** (screens)". Each chat builds only its own track (§3 or §4); §0–§2 and §5–§7 are common to both.
This replaces the C5 handoff (`HANDOFF-2026-11-04-ADS-STAGE1-C5.md`): its open questions and owner track still hold,
as do the §4 trap lists of every earlier ads handoff and the 11/01 handoff's §1 owner rulings (not to be re-asked).
Stage 1 = agents, orchestrator and screens proven against fakes, **no social-network or Higgsfield credentials**.

## 0. Read first, in this order (both tracks)

1. `CLAUDE.md` (root): hard rules, the release train, "No workarounds", the two-merge rule, the CI job names.
2. `docs/plans/recruitment/ADS-AGENT-BUILD-WORKFLOW.md`: §4 (the step tables — Phase B, C, E, F, G), §4R (the readiness
   levels and what each worker must survive and score), §5 (the stage calendar), and the **progress log's end** (C3,
   C4, D2, C5a, C5b1, C5b2 are the newest; each says what was NOT built and why).
3. `docs/plans/recruitment/ADS-AGENT-PLAN.md`: D-AD1, D-AD9, D-AD11, D-AD12, D-AD16, D-AD17, and §9's open questions
   (Q-AD23 … **Q-AD27**, new in C5a).
4. `pnpm ads:readiness` — the scorecard. `scripts/ads-readiness.registry.mjs` is what it reads.
5. Track S only: `docs/DESIGN-SYSTEM-CONTRACT.md` and `apps/web/CLAUDE.md` before any screen; memory "Surfaces start
   at call sites", "Reuse shared UI", "Browser pass = 3 fixtures".

## 1. Position (11/04 evening)

| Step | PR | Merge | What |
|---|---|---|---|
| C5a | #2012 | `2d9f706` | Checker vision (`workers/checker/`, `checker@1`); AI rail takes images as bytes (ledger keeps sha256); planted-defect corpus of 10 Higgsfield images; `ads:eval checker` = recall, **10/10 twice**. |
| C5b1 | #2017 | `b4818d4` | `compose/composeCreative.ts` (copy → art → render → `frameStill` → overlay EN+ES → visual → `ready` / one regeneration with `REGENERATION_CLAUSES` / `check_failed` + reason); runner `pending`; recipe `overlay_slots {headline, cta}`. |
| C5b2 | **#2021** | **in CI at handoff** | `compose/composeCampaign.ts` (draw seeded by campaign id, stored once via `storePresetDraw` in `transitions.ts`; BATCH 2; creative id = hash(campaign, preset, stint); ≥ 1 ready → review); `queuedRender` (compose never calls Higgsfield; it queues the one-at-a-time `ads_render` job); `HIGGSFIELD_STILL_MODEL = null` until V4. Checker → **L2**. |

- **Main at handoff:** `4306819`. **Newest migration:** `0564_org_role_permissions.sql`. Confirm both BY NAME; other
  chats merge all day (the leads track, the hiring track, the permissions track).
- **Scorecard once #2021 is in:** Orchestrator L3, Budget guard L3; Copywriter, Art director, **Checker**, Renderer L2;
  Monitor, Lead intake, Security L1; **Publisher, Analyst, Outcome feed L0**.
- **Worktrees:** Track W keeps `../FuelGuard-ads-d1`. Track S makes its own (`git worktree add ../FuelGuard-ads-screens
  origin/main`, then memory "Fresh worktree setup": install + `build:rn` + the two `.env`). Never share one tree
  between the two chats (memory "Parallel chats share a tree").
- **Already built that Track S reads:** `GET/PUT /api/ads/settings`, `POST /api/ads/kill-switch(/clear)`,
  `POST /api/ads/campaigns/:id/approvals`, `/api/ads/connections` (+ `/meta`, `/simulator`, `/:id/test`,
  `/:id/disconnect`), `GET/POST /api/ads/brand-kits`, `/brand-kits/assets(/upload-url)`, `GET/POST /api/ads/presets`
  (all in `modules/ads/routes/`, mounted at `/api/ads`). The leads screens (E4) are the **leads track's** (#2019, #2014,
  #2020): do not build them.

## 2. Open questions and blockers (do not route around them)

Unchanged: Q-AD12 presets, Q-AD14 brand kit, Q-AD20 Higgsfield key, G12 / Q-AD8 counsel, Q-AD23–26. New:
- **Q-AD27** (C5a): a maker's grille badge is neither writing nor a foreign logo, and the truck check compares TYPE not
  make — our reading, recommendation recorded. The owner also sets the **Checker's pass threshold** (Checker L3).
- **Every compose stops at the render** ("no still model chosen yet (V4)") until V4 sets `HIGGSFIELD_STILL_MODEL` and
  its price with the owner's key. That is correct behaviour, not a bug: no track "fixes" it with a model name.
- **No campaign can be created yet** — see Track S's first step. Nothing writes an `ads_campaigns` row today.

## 3. Track W — the workers (one PR each, ≤ ~500 lines)

In this order:
1. **#2021 (C5b2).** `gh pr checks 2021`; green → merge (memory "PR flow"). A `test-api` shard failing on
   `document-reading/ocr/prepareOcrView.test.ts` timing out at 240 s is the known flake (hit twice on 11/04): re-run
   the failed job (`gh run rerun <id> --failed`), say so, and merge when green.
2. **B2c — the ad itself and `createPaused`.** The publisher's second half (`platforms/meta/publisher.ts` has campaign
   + ad set, paused): upload each `ready` creative's PNG (`ads_creatives.assets`, read with `readAdAsset`), make the ad
   creative and the ad, PAUSED, on FakeMeta first; then fill `workers.ts` `createPaused`. The copy that is not overlay
   text (the slots outside `overlay_slots`) is the ad's primary text / headline. Read B2a/B2b's log entries first —
   half-created objects resume, never duplicate (§4R Publisher L2). Publisher → L1, then its L2 faults.
3. **Image-to-image from the kit photo (D-AD9).** Read `https://docs.higgsfield.ai` upload pages, cite page + date in
   FakeHiggsfield's header, mark OUR reading; add the upload to the fake and the client; compose passes the Art
   director's `reference` to the render. Until then the render ignores the photo (said in `composeCreative.ts`).
4. **F1 — Analyst** (daily brief + cohort report): numbers from the fold only (`adsReport.ts`), Claude narration through
   the A4 rail, every number in the narration claim-checked — "a planted number is refused" (§4 F1). A new model
   worker joins `EVAL_WORKERS` + `lint:agent-fixtures` (pattern: `workers/checker/`). Analyst → L1/L2.
5. **Climb to L3** (§4R tables): Copywriter's evaluation set 10 → ≥ 40 briefs × presets, EN + ES (the person's rating is
   the owner's); Monitor and Lead intake golden scenarios (`packages/ads-golden`); Renderer L3; Publisher L2–L3.
6. **G-sec** (`/security-review` on A5, B1, B4, C3 and the API) and **G-runbook** (`ADS-RUNBOOK.md`).

## 4. Track S — the screens (`apps/web/src/features/ads/`, `packages/ui` only)

Start with the API the screens need, then the screens. In this order:
1. **The campaign doors (API).** Missing today, each a fix, not a detour:
   - **create a campaign** from an opening: the brief through the recruiting `AdBriefSource` (D-AD17; ads never reads
     an opening), frozen in `brief_snapshot`, `settings_version_id` = the version in force, a connection id; the row's
     only writer is `orchestrator/transitions.ts` (`lint:table-writers`), so the insert goes there;
   - **list / read campaigns and their creatives** (assets, the three checks, `last_error`);
   - **approve / reject a creative** and **regenerate** (approval kinds `approve_creative` / `reject_creative` exist in
     `APPROVAL_KINDS`; the machine has `regenerate` and `creatives_approved`), and **launch** (`paused → launch`, actor
     `approver`; the guard's approvals door exists).
   - ⚠ **Decide first: which brand kit a campaign uses.** Compose today refuses with more than one kit ("which one
     this campaign uses is not chosen"). The honest fix is a column (`ads_campaigns.brand_kit_id`, new column → its
     first reader in a SEPARATE merge, `lint:migration-ordering`); write the choice into the plan's open questions
     with candidates (column · always the newest kit · one kit per org by rule) and a recommendation (the column)
     before building it.
2. **E1 — Settings › Ads control:** limits, rules, approvals, AI and render budgets, alerts, kill switch, connections +
   connection test, live spend vs caps (from the fold). Browser pass on 3 fixtures (fail / empty / staging).
3. **E2 — Brand kit + preset editors** (versioned; "saving creates v2"). The preset editor MUST ask for
   `overlay_slots` (headline + call to action, chosen among the copy slots) — compose refuses a preset without it.
4. **E3 — Campaign flow:** pick opening → generate → **review screen** (every format × language, the three checks with
   their reasons, Approve / Regenerate / Edit copy) → Create paused → Launch (admin). Done-when: a recruiter reaches a
   paused simulator campaign in four clicks; an admin launches it. Security L2 ("a non-admin hitting Launch") lands here.
5. **E5 — Failed-jobs page** (`GET /api/org/jobs/failed`).
6. **G-walk** script in the PR body for the owner: connect simulator → limits → brand kit → generate → review →
   create paused → launch → test lead → queue → convert → kill switch → reconcile.

## 5. Traps (11/04, add to the earlier lists)

- **Root `pnpm typecheck`, not `tsc -p apps/api`.** A shared contract change broke only `packages/shared`'s own test
  fixture and CI's `typecheck` failed (#2017). Any `packages/shared` change → the root typecheck.
- **A table write outside its owner file fails `lint:table-writers`** — route it through the owner (`ads_campaigns` =
  `transitions.ts`, `ads_creatives` = `compose/`), and retire the producer waiver when a table gets its first writer.
- **Progress-log appends conflict with every other ads/leads chat.** On a rebase, keep BOTH entries (theirs first).
  Same for `scripts/check-table-producers.mjs` waiver lines.
- **Rebasing a stacked branch after amending its base:** `git rebase --onto <new base> <old base commit> <branch>`;
  a plain rebase re-applies the old base commit and conflicts.
- **GitHub Actions stalled ~40 min on 11/04** (every run queued, githubstatus green). Check
  `gh api "/repos/miroslav-jokovic/fuel-guard/actions/runs?status=queued"`; it cleared by itself. Auto-merge is not
  enabled on this repo — merge by hand.
- **A model's eval is only as good as the corpus and the question.** C5a went 8/10 → 10/10 by (a) not capping a
  free-text reason below what the model writes, (b) not asking the model to locate a region from numbers — cut the
  region out and send it as its own image.
- **The recorder does not filter** (memory): a fixture function must answer only the ids the query asked for, or a
  test passes for the wrong reason.
- **`pnpm ci:local` measures nothing if files change while it runs** — run it on a still tree.
- **Mutation script** is gone with the old chat; pattern: replace one exact string (assert count == 1), run the one
  test file, restore the original bytes and assert they match.

## 6. Owner track (due Mon 11/09; these set the real date, not the code)

G1 Meta setup (workflow §6 click-path) · G2 / Q-AD20 Higgsfield key (→ V4: still model + price) · G3 / Q-AD14 brand
kit (logo, colours, name, phone, 5–10 truck photos) · G6 / Q-AD12 presets P1–P5 · G4 / Q-AD9 first opening · G5 limits ·
G12 counsel · Q-AD27 + the Checker threshold · rating the Copywriter's evaluation set · approving release PRs.

**Calendar (audit, 11/04):** Stage 1 code complete about **Mon 11/09** with both tracks in parallel (Tue 11/10 – Wed
11/11 with one); then the owner's staging walk + a release; Stage 2 (L4 on sandbox) 2–3 days after the owner's Meta +
Higgsfield setup; first real ad (canary) **earliest Thu 11/12, realistically Fri 11/13 – Mon 11/16**; L5 (Meta stills
done) canary + 72 h ≈ **Mon 11/16 – Thu 11/19**. Video, outcome feed and mailbox ~1 week after; TikTok / X when each
platform approves. Every day the owner's setup waits moves the first ad by a day.

## 7. First action in each new chat

1. Read §0 (Track S: also item 5).
2. Confirm main's HEAD and the newest migration **by name**; `gh pr list --state open` — no other chat may have an open
   PR on your track's files (Track W: `modules/ads/{workers,compose,creative,platforms,orchestrator}`,
   `lib/anthropic.ts`; Track S: `apps/web/src/features/ads/`, `modules/ads/routes/`). If the other track's PR touches a
   file you need, wait for its merge rather than editing it in parallel.
3. `pnpm ads:readiness` must match §1.
4. Track W: do §3 step 1 (#2021). Track S: say in one short message how you will close the brand-kit-choice question
   and the campaign doors' shape, record the question in the plan, then build §4 step 1.
5. Each PR: progress-log entry at the END of the workflow file; mutation-prove every behaviour test; full gates with
   `$?`; the four PR-template headings; merge when green.
