# Handoff · 2026-11-01 (evening) · Ads agent, Stage 1 from step A4

**Paste this whole file into a fresh chat.** It continues `HANDOFF-2026-11-01-ADS-STAGE1.md` (the
first Stage 1 brief). That brief's §1 owner rulings, §4 traps and §6 owner track **still hold**; this
file replaces its §2 position and §3 step list from step 4 on. Stage 1 = build the agents and the
orchestrator and prove them against fakes, with **no social-network or Higgsfield credentials**.

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, gates, the release train, "No workarounds".
2. `docs/plans/recruitment/HANDOFF-2026-11-01-ADS-STAGE1.md`: §1 rulings, §4 traps, §5 process.
3. `docs/plans/recruitment/ADS-AGENT-BUILD-WORKFLOW.md`: §1.2 **items 5–9** (corrections found
   while building, below), §4 A4–A6 and B/C/D/E/F, **§4R** (readiness levels, harness, per-worker
   bars), and the **progress log at the end**.
4. `docs/plans/recruitment/ADS-AGENT-PLAN.md` §2c (D-AD16), §4a (D-AD9–D-AD13), §4b, §5.
5. What is built (read the code, it is short): `packages/shared/src/ads/*`,
   `supabase/migrations/0537_ads_foundation.sql`, `apps/api/src/modules/ads/adsSchemaParity.test.ts`.

## 1. Done (all merged to main, on staging; production on the next approved release)

| Step | PR | What |
|---|---|---|
| A1 docs | #1891 | `ads` module + D-AD17 in `docs/ARCHITECTURE.md`; ads schedulers in `docs/WORKER-DEPLOYMENT.md` |
| A2 schema | #1894 | **`0537_ads_foundation.sql`**: 13 ads tables, error codes **AX010–AX031**, DB fences (AX020 launch needs a standing approval of that campaign + kind; AX021 kill switch; AX030 creative content frozen after the workers; AX031 brief frozen), composite `(org_id, id)` FKs everywhere, token envelope CHECK, 8 bell categories. Matrix `supabase/tests/ads-foundation.test.mjs`; hand seeds in `supabase/tests/rls.test.mjs` |
| A3a | #1898 | `campaignMachine` (closed transition table, who may cause each move), `adsPolicy` (`checkSpend`: monthly cap vs **month-end forecast**, account-limit fence, raise bounds; `ADS_AUTHORITY`), `settingsContract` (all money fields null until an admin saves — Launch refuses), `contracts` (`AdBrief`, `AdBriefSource`, `LeadSink`, the lists mirroring 0537's CHECKs) |
| A3b | #1903 | `adClaims` (every digit must be a brief figure; promise terms; forbidden wording EN/ES), `presetDraw` (seeded, live presets excluded), `naming` (`S360|…`, anything else parses to null), `renderGeometry` (safe zones, WCAG over worst pixel, overflow refused), `adsReport` (spend + cohort folds, Central-time month). WCAG math moved to **`packages/shared/src/srgb.ts`** (one home; `apps/driver/scripts/srgb.mjs` imports it) |

Main at handoff: `acd6b5f`. Last migration on main: **`0537_ads_foundation.sql`**. Open HW-program PRs
already claim **0538 and 0539** (#1892/#1902 `0538_driver_employment_gaps`, #1896 `0539_orientation_videos`):
if an ads step needs a migration, take the next free number **and re-check it by name just before merge**.
Release candidate #1890 pins `74b0202`; everything above rides the next train.

## 2. Corrections already recorded (workflow §1.2-5…9) — do not undo them

5. `ads_approvals` exists (A2 lacked it). 6. The ads module's AI provenance is **`ad_generations`**, not
`recruiting_ai_outputs` (D-ARC3). 7. Ads schedulers run in lane **`general`**, not `egress` (egress =
the WEX allowlist only). 8. **There is no `APP_ENVIRONMENT`**: the environment name is
`RAILWAY_ENVIRONMENT_NAME ?? DEPLOY_ENVIRONMENT` (`apps/api/src/lib/schedulerLease.ts:234`; AWS sets
`DEPLOY_ENVIRONMENT` from `infra/server/<env>.env`). Move that expression into ONE helper; the simulator
guard reads it and fails closed (allowed only for a known non-production name, or both unset and
`NODE_ENV` ≠ production). 9. Recruiting's tables (openings, profiles, leads, contacts, verdicts,
conversions, `recruiting_ai_outputs`) are a **new step D0**, with `purge_applicant` + the roster merge
list in the same PR, after the HW program's last merge.

## 3. Measured for A4 on main `acd6b5f` (verify before relying)

- `callClaude` in `apps/api/src/lib/anthropic.ts:60` (forced `ASSESSMENT_TOOL`) has **no caller** —
  `git grep "callClaude("` finds only its definition. The workflow's "fuel caller passes its own
  schema / fuel tests stay green" premise is therefore moot: there is nothing to keep compatible
  except the function's own tests, if any.
- The live Claude users call **`anthropicClient`** directly and gate on a monthly budget:
  `modules/document-reading/read/executeRead.ts:273,304` (`withinBudget` before and after, a
  `budget_exhausted` outcome) and `modules/hazmat/hazmatExtraction/orchestrate.ts:167`
  (`tokensUsedThisMonth`). **Copy that pattern** rather than inventing one.
- Models pinned in `packages/shared/src/ai.ts:10-12` (`AI_MODELS.fast` haiku-4-5, `.deep` sonnet-4-6).
  Do **not** change models in A4. `fnv1a32` + `aiInputHash` live in `ai.ts`; `withinBudget` at :149.
- `ad_generations` (0537) is written `started` before the call and completed once after it
  (AX011 refuses anything else); `unique (org_id, idempotency_key)` makes a replay spend nothing;
  `status = 'budget_exhausted'` is written instead of a call.

## 4. Next steps, in order (one PR each)

| # | Step | Notes |
|---|---|---|
| 4 | **A4 AI rail** | A generic forced-tool call taking the tool schema + a provenance writer from the caller; the ads writer records to `ad_generations` (started → succeeded/failed, tokens as `cost_units`). Per-agent switch + monthly token budget from `ads_settings_versions.settings.budgets` (null = **refuse**, per the settings contract — not "unlimited" like `withinBudget`'s null; say so in code). Decide whether `callClaude` is reshaped or retired (it has no caller); record the decision. Tests: budget-exhausted writes `budget_exhausted` and makes no call; a replayed key makes no call; the output is schema-validated before use |
| 5 | **A5 guard** | `ADMIN_ONLY_CAPABILITIES` += `ads.connection`, `ads.spend` (with reasons) in `packages/shared/src/namedGrants.ts`; `routeGateLedger.test.ts` green both ways. `modules/ads/guard/`: `budgetGuard` (calls `checkSpend`; the ONLY import path to adapter spend methods, with a test that fails otherwise), kill switch (new settings version with reason), approvals service (writes `ads_approvals`; second approver per `needsSecondApprover`), settings-versions read/write. Remove the `ads_settings_versions` / `ads_approvals` / `ads_actions` waivers from `scripts/check-table-producers.mjs` as their writers land |
| 6 | **A6 orchestrator spine** | Runner over `stepCampaign`; job kind(s) in `apps/api/src/modules/org/jobs.ts:15`, `KIND_CAPS` in `apps/api/src/worker.ts:56`, leased scheduler `ads-orchestrator` in `SCHEDULERS` (`apps/api/src/schedulers.ts`, lane `general`, off unless `ADS_ENABLED`). ⚠ **Every per-campaign job carries `dedup_key`** (one active job per (org, kind) otherwise — `0095:21`). Tick only enqueues. Every transition writes `ads_actions` (`kind = 'transition'`) |
| 7 | **Harness** | `FakeMeta`, `FakeHiggsfield` as `node:http` servers with fault injection (shapes from the vendors' docs, URL cited in each); `FakeClock`; `packages/ads-golden` (copy `packages/hazmat-golden` layout); Claude replay + `pnpm ads:eval` (copy `apps/api/src/scripts/replayDocumentReads.ts`); the simulator platform behind §2-8's helper |
| 8 | **`lint:ads-readiness`** | Copy `scripts/check-reader-gate.mjs` (REQUIRED list, `--self-test`, refuses skip/only/todo/fails) + `pnpm ads:readiness`; add to `.github/workflows/ci.yml` `gates` **in the same PR** with a `"//lint:ads-readiness"` key |
| 9 | **Workers on fakes** | B1–B5, C1–C5 (+ `lint:agent-fixtures` in ci.yml), F1; D0–D2 only after the HW program's PRs merge. Each to L1 → L2 → L3 per §4R |
| 10 | **Screens on the simulator** | E1–E5, `packages/ui` only, `docs/DESIGN-SYSTEM-CONTRACT.md` first, browser pass on three fixtures |
| 11 | **Stage 1 exit** | Scorecard L3 everywhere; owner walks staging in simulation mode; Launch still refuses (no L4) by design |

Calendar (workflow §5): Stage 1 to L3 by **Sat 11/07**; credentials + L4 from **Mon 11/09**.

## 5. Traps hit in this session (add to the first brief's §4)

- **A new ads table trips five gates at once.** `MODULE_SECTIONS` in `scripts/check-section-policies.mjs`
  (`ads: null` is there now); `scripts/check-table-producers.mjs` WAIVERS (one per schema-only table,
  removed when its writer ships); a `-- raw-access-waiver:` line for a raw-layer table; a
  `-- cross-module-waiver:` line for the notification CHECK; and `supabase/schema.generated.sql` —
  `lint:table-writers` regenerates it, then fails until it is **staged** (`git add`, rerun).
- **The tenant-isolation matrix (`supabase/tests/rls.test.mjs`) cannot seed composite-FK or
  shape-checked tables**: add a `handSeed` entry (the `adsCampaignSeed` helpers are there). Run
  `node scripts/run-tests.mjs --matrices-only` locally before pushing — running only your own matrix
  is how A2's first CI failed.
- **`lint:scanner-parity` refuses any second copy of the Rec.709 weights.** Contrast lives in
  `packages/shared/src/srgb.ts`; import it.
- **`git reset --soft origin/main` after main moved stages a REVERSAL of whatever merged meanwhile**
  (it nearly reverted chat #1897). Restore non-own paths with `git checkout HEAD -- <paths>`, and check
  `gh pr view <n> --json files` before every merge.
- Commits are slow (the post-commit hook rebuilds graphify, ~60–120 s): run them in the background.
- macOS has no `timeout`; the auto-mode classifier sometimes times out — re-check `git status` before
  retrying an edit, since a refused command did nothing.
- Zod 4 here: `z.url()`, `z.iso.datetime()`, and the repo's `recordId()` for ids — not
  `z.string().uuid()/.url()/.datetime()` (deprecated).

## 6. Process (unchanged)

Worktree from `origin/main` (`claude/<topic>`); the whole gate set from `ci.yml` + `pnpm typecheck`,
**checking `$?`**; mutate each new guard and show it red in the PR body, restore byte-for-byte (`cp`);
the four template headings; merge by hand when CI is green (17 checks); append to the END of the
workflow's progress log; memory file `recruiting-ads-agent-position.md` updated per merge.

## 7. Owner track (unchanged, due Mon 11/09)

Meta setup (say "Meta ready" — never paste a token), Higgsfield **API** key, TikTok developer app, X
contact, brand kit + 5–10 truck/trailer photos, the first opening, spending values, presets P1–P5.
**New, for counsel (G12 / Q-AD8):** the banned-wording list in `packages/shared/src/ads/adClaims.ts`
refuses "criminal record" and "conviction", which also refuses "no DUI convictions" — counsel decides
whether a driving-record line is allowed and in which words.

## 8. First action in the new chat

Read §0, confirm main's HEAD and the last migration by name, re-measure §3, then start **A4**.
