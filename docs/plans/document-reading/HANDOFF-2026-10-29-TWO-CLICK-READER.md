# Handoff — implement the two-click reader plan (paste into a fresh chat)

Read first, in this order:
1. `docs/plans/document-reading/TWO-CLICK-READER-PLAN.md` — the plan. §0 defines "100 %"; §2 the measurements; §3 decisions
   D-TC1–D-TC14; §4 build order TC0–TC5 with done-when; §5 the production-ready checklist; §6 the six questions, **all ruled
   2026-10-29 as recommended**; §7 the log. Append to §7 after every merge (plan-progress-log rule: append at the END).
2. `docs/plans/document-reading/PLACARD-CALCULATOR-RELIABILITY-PLAN.md` — PC1/PC2 merged (not released), PC3–PC8 absorbed by TC2/TC3.
3. `docs/plans/document-reading/READER-CORRECTNESS-PLAN.md` — P1/P2 promises and D-RC1–D-RC4 (every reader fix ships with the
   whole-space test + replay of the stored reads + false-accept 0).
4. Repo `CLAUDE.md`, `apps/web/CLAUDE.md`, `supabase/CLAUDE.md`, `docs/MIGRATION-DISCIPLINE.md` (a column and its first reader
   ship in two merges), `docs/DESIGN-SYSTEM-CONTRACT.md` §3.3–3.4, §4.3 before TC3.

## Where things stand (2026-10-29, main at f011e35 + rulings PR)

- Plan merged as #1828; rulings PR follows. Owner's words: "record the rulings as recommended and proceed with implementation
  of the plan as proposed."
- Rulings: Q-TC1 (a) pass A may leave Sonnet 4.6 on TC2.2's table · Q-TC2 (b) Calculate press stays, auto-read on drop ·
  Q-TC3 yes, driver capture onto the module after TC3 · Q-TC4 (a)+(b) withhold in engine path, ask in load form ·
  Q-TC5 (a) 4.3 + Class 7 Yellow-III into scope · Q-TC6 (a) populate the reference-text store.
- Still owed by the owner, not code: **TC0.1 release approval** for PC1/PC2 (release train, console Settings, 01:07 CT
  Sun–Thu); **TC5.1 attester** for dataset 2026.10.0; a Railway variable for `DOC_OCR_CACHE_DIR` on a persistent path (TC0.3).
- Nothing of §4 is built. Start at **TC0.2** and go in order; TC0.2–TC0.5 and TC1.x need no owner input.

## The order, with the file each step lands in

| Step | Where | Notes |
|---|---|---|
| TC0.2 stage timings | migration `supabase/migrations/05xx_document_reads_stage_timings.sql` (next number — check NAME vs parallel chats before merge); `document_read_transition` gains `p_stage_timings default null`; writer in `apps/api/src/modules/document-reading/read/executeRead.ts` in a SECOND merge; `[metrics]` line in `queue/handlers/documentRead.ts`; stage text in `apps/web/.../bolRead/BolReadPanel.vue` | Column first, reader next merge (`lint:migration-ordering`) |
| TC0.3 warm OCR | `ocr/pageOcr.ts` `ocrEngine({ idleMs })` → never idle-stop (or 24 h); start at boot where `document_read` is drained (`queue/handlers/documentRead.ts` `engine ??=`); `envDocumentReading.ts` `DOC_OCR_CACHE_DIR` | `docs/WORKER-DEPLOYMENT.md` before touching boot |
| TC0.4 probe-vs-rules | `packages/hazmat-engine/src/eligibility.ts` — drop `isResidueLine` from `LINE_PROBES` and `portContext.vesselConnected` from `UNEVALUATED_INPUTS`; new test: mutate each remaining probed input, assert verdict minus input audit unchanged | engine minor bump; acceptance rule unchanged |
| TC0.5 citations | `packages/hazmat-golden/src/citations.json` + census; fix `172.505(b)` → `(c)` in `placards/classify.ts`, `placards/computeFinalize.ts`, `placardCensus.test.ts` title (and `lint:comment-claims` pins titles — move both), PLACARD plan text | verified at law.cornell.edu 2026-10-29: (a) PIH, (b) UF6, (c) DWW, (d) optional |
| TC1.1 segregation row | `packages/hazmat-engine/src/segregation/check.ts` — pick the grid label from PG (`parseHmtRef`), zone (SP 1 = A, SP 2 = B; `tableSelect.ts` `PIH_ASSERTING_PROVISIONS`), phase (PSN/row); most-severe only when unknowable and then `conditional`; `check.test.ts` + `hazmat-golden/placardCensus.test.ts` oracle from the grid's OWN labels (`baseOf()` collapse is the bug) | repro: UN1263#II + UN1710#III van → today `blocked` |
| TC1.2 §172.504(f)(9), §173.150(f)(2) | `placards/compute.ts` / `resolve.ts` — Class 9 non-bulk → `permitted`; KEEP the line in `resolved` (bulk ID display derives from it); non-bulk combustible → no placard, out of aggregate, `info` finding | dataset placard row 9 = "CLASS 9", "Comb liq" = NA1993 |
| TC1.3 Q-PC6 (a) | §172.402 label requirement module | property test entries × packaging × PG |
| TC1.4 equipment fallback | `packages/shared/src/fleet.ts` `resolveVehicleKind` default branch; `apps/api/src/modules/hazmat/hazmatAnalysis.ts`; load form asks | Q-TC4 ruled |
| TC1.5 catalogue, `/calc` gate, dataset cache | `hazmatCalc.ts` (`evaluatedAt` after the spread), `routes/index.ts` (`canView` on `/calc`), `packages/hazmat-data/src/index.ts` (`Map<version, Dataset>`) | |
| TC2.1 per-reader sizing | `executeRead.ts` `loadImages(…, models[0], …)` → per model; `SEND_RULE_VERSION` "2" | replay must be identical in every status |
| TC2.2 bench | new `doc:bench` script: pass A ∈ {sonnet-4-6, sonnet-5-5, opus-5-5} × effort {default, low} on corpus 7B.2 + nine replayable reads; score = wrong UN ids + RC5 defects + ms + $ | paid model spend — small; corpus at `packages/capture-engine/fixtures/real/private/documents` (main checkout) |
| TC2.3/2.4 PC3/PC4 | profile 1.6.0 (`grossWeightText`, `pg` string), `parsePrintedWeight`, `readingExtent.ts` one-char tolerance | PLACARD plan §4 |
| TC2.5 crop re-read | new `evidence/cropWitness.ts`: OCR bbox via `evidence/pageGeometry.ts`, one-field schema, accept only agreeing-with-one-reader AND row/table fit | false-accept census mandatory |
| TC2.6 effort low | `model/readPages.ts` `buildReadRequest` `output_config.effort` — only after TC2.2 shows no loss | in cache key |
| TC2.7 PC5 | `read/readTarget.ts` grouping by OCR paper number + marker | Q-PC2 (a) |
| TC3.x page | `apps/web/src/pages/HazmatCalculatorPage.vue`, new `features/hazmat/bolRead/BolPaperView.vue`, `HazmatCalculatorForm.vue` collapses; PC6 fold in `BolFindingsPanel.vue`; `HazmatCalculatorForm.sequence.test.ts`; three-fixture browser pass | D-TC6; design contract §3.3–3.4 |
| TC4.x | driver capture → module; camera original; model-view rectification | after TC3 |
| TC5.x | attest 2026.10.0; 4.3 + Class 7 scope | owner names attester |

## Traps already hit (don't re-learn them)

- `pnpm lint` is not the gate set: run the `gates` job scripts from `.github/workflows/ci.yml` and `pnpm test`, and CHECK `$?`.
- Fresh worktree: `pnpm install`, `pnpm --filter @silvicom/shared build:rn`, copy the two `.env` files; `supabase db query --linked`
  works only from the MAIN checkout (worktree isn't linked). Node scripts: `node --import tsx` from a dir that resolves tsx
  (e.g. `apps/api`), NOT from the worktree root.
- To run main's engine from a branch checkout: copy `src` into `packages/hazmat-engine/.audit/` and `packages/hazmat-data/.audit/`
  (+ `datasets`) so the package's `node_modules/zod` resolves; delete after.
- api property tests (alignLines/readingExtent) time out when run beside typecheck — re-run alone before calling them flaky.
- `gh pr checks` status is the 2nd TAB column. Never push during a rebase. Squash onto `git merge-base`, never `reset --soft origin/main`.
- Parallel chats share one tree: branch from `origin/main`, check the migration NAME before merge.
- Readers copy to the letter — never a prompt directive for precision; image size and the model pin are the levers (D-TC1).
- "Conservative" ≠ safe when the output is a `violation`: a violation blocks and needs an override (D-TC8).
- A census whose oracle is a copy of the engine's simplification certifies nothing (the `baseOf()` trap).
- Test titles are pinned by `lint:comment-claims` and `lint:reader-gate` (`scripts/check-reader-gate.mjs`) — move title and claim together.

## Production facts for measuring

- 18 finished `shipping_document` reads; replayable ones carry `replay_inputs` (nine as of 10/26; today's 1f251e08 too).
  Dump: `supabase db query --linked -o json` from the main checkout; page images in bucket `document-intake`, `original_path`.
- Production pages are mostly 1500×2000; standard tier sends 952×1270; high tier would send them whole (`visionTier.ts`).
- Models on every read so far: `claude-sonnet-4-6` + `claude-sonnet-5-5`; classifier `claude-haiku-5-5`; driver path
  `HAZMAT_MODEL_A/B` = sonnet-4-6 / haiku-4-5 (`apps/api/src/envDocumentReading.ts`).
- Review rows: 193 (170 implicit, 14 explicit confirms, 7 paper_check, 2 corrections).

## PR discipline

Branch `claude/<topic>` from `origin/main`; one descriptive sentence per commit; PR title = release-notes line; body with the
four headings of `.github/pull_request_template.md`; merge yourself when CI is green; append the §7 log line in the same PR.
