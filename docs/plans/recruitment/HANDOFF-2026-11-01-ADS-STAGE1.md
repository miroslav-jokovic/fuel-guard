# Handoff · 2026-11-01 · Ads agent, Stage 1 (build and prove, no credentials)

**Paste this whole file into a fresh chat.** It is the brief for Stage 1 of the recruiting ads
agent. The design is done and merged; **nothing is built**. Stage 1 builds the agents and the
orchestrator and proves them against fakes, with **no social-network or Higgsfield credentials**.
Credentials arrive in Stage 2 (from Mon 11/09), and the first real ad comes in Stage 3.

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, gates, the release train, "No workarounds".
2. `docs/plans/recruitment/ADS-AGENT-BUILD-WORKFLOW.md`: **the build source of truth.** Read
   §1 (measured facts + corrections + D-AD17), §2 (module map), §3 (gap/blocker register),
   §4 (the A–H steps), **§4R (readiness levels L1–L5, harness, per-worker bars)** and §5 (calendar).
   Where it differs from the plan, the workflow wins (its §1.2).
3. `docs/plans/recruitment/ADS-AGENT-PLAN.md`: the *why*. Read §3 (D-AD1–D-AD8), §4a (creative
   studio, D-AD9–D-AD13), §4b (settings page), §5 (authority table), §2b (D-AD14, the outcome
   feed) and §2c (platforms, Higgsfield, **D-AD16 the orchestrator is code, not a model**).
4. `docs/plans/recruitment/RECRUITER-AUTOMATION-PLAN.md`: §3 (D-RA1–D-RA12, all still binding)
   and §3a (Hiring Profile v1, the seed for `leadMatch`).
5. `docs/MIGRATION-DISCIPLINE.md`, `supabase/CLAUDE.md`, `apps/web/CLAUDE.md`,
   `docs/DESIGN-SYSTEM-CONTRACT.md` (before any screen), `docs/ARCHITECTURE.md`.

## 1. Owner rulings (all 2026-10-31 / 11-01; do not re-ask)

- **A person launches every ad**; the agent may create paused, pause and lower on its own (Q-AD2).
- **Spending rules live on a settings page**, versioned, with live spend against caps (Q-AD7).
- **Build, not buy; no Tenstreet Job Store** (Q-AD15).
- **Platforms:** Facebook + Instagram (one Meta connection) first, then TikTok, then X. The company
  accounts connect through each platform's OAuth / system user. **Never a stored password.**
- **Creative:** Claude composes, Higgsfield renders (the same models used for our videos), 4–5
  versioned concept presets rotated by a recorded seeded draw, brand kit + visual rules as data,
  and **the image model never writes text** (our renderer composites figures from the opening).
- **Small single-job workers under one orchestrator.** The orchestrator is a deterministic state
  machine on our job queue (D-AD16). Five workers use Claude; none of them decides the next step,
  spends money or contacts a person.
- **Agents first, credentials last; readiness tests before any real case** (§4R). Launch is
  refused in code until every worker the campaign uses is at L4.
- Earlier, still binding: no automated first contact with a lead (D-RA2); rules decide and the
  model drafts (D-RA3); provenance + human confirmation on AI output (D-RA4); no protected
  characteristic or ZIP reaches a model (D-RA5).

## 2. Position

- Main `cb6fc2c` (2026-11-01). Ads plan PRs #1864–#1868, workflow #1880, readiness #1882: all merged.
- **Last migration on main is `0536_hire_policy.sql`.** The parallel **hiring-workflow (HW) program**
  is editing `apps/api/src/modules/recruiting/` this weekend (PR #1883 `hw12b-hire-policy-reader`
  open). **Check the next migration number by NAME just before merging**; a parallel chat may take it.
- Workflow §5 calendar: **Stage 1 Mon 11/02 → Sat 11/07** (to L3 for every worker) · release Sun
  11/08 with no platform connected · Stage 2 credentials + L4 from Mon 11/09 · canary earliest
  Tue 11/10–Wed 11/11.

## 3. Stage 1 — the steps, in order (one PR each; schema before reader)

| # | Step | Workflow ref | Notes / measured traps |
|---|---|---|---|
| 1 | **A1 docs**: D-AD17 in `docs/ARCHITECTURE.md` (module `ads` + table ownership); `docs/WORKER-DEPLOYMENT.md` names the new schedulers' lane | §4 A1 | Docs-only PR |
| 2 | **A2 migration** `05xx_ads_foundation.sql`: every table in workflow §4 A2; notification CHECK = **restate `mig/0521:309`'s list** + the 8 ads categories; RLS on, service-role only, `forbid_org_change()`; matrix `supabase/tests/ads_append_only.test.mjs` (prints `RESULT`) | §4 A2 | New tables are exempt from the two-merge rule. Update `scripts/table-modules.json` + the retention registry (`lint:table-modules`, `lint:table-lifecycle`). Append-only = BEFORE triggers that fire for the service role, + `RETENTION_FORBIDDEN` |
| 3 | **A3 shared**: `packages/shared/src/ads/*` + `src/recruiting/leads/*` (workflow §2), with the boundary tests in §4 A3 | §4 A3 | Pure: no clock, no randomness, no model (`lint:boundaries`). `presetDraw` takes the seed as an argument. `campaignMachine` (state, event) pairs are **enumerated exhaustively**; no fast-check/msw/nock is installed, and do not add one |
| 4 | **A4 AI rail**: `callClaude` takes the tool schema as an argument (the fuel caller passes its own); generic `aiInputHash`; provenance writer; per-agent switch + monthly budget | §4 A4 | `apps/api/src/lib/anthropic.ts`; `packages/shared/src/ai.ts:11-12` pins `haiku-4-5` / `sonnet-4-6`, which accept forced tool use, so **don't change models here**. Fuel tests must stay green unchanged |
| 5 | **A5 guard**: `ADMIN_ONLY_CAPABILITIES` += `ads.connection`, `ads.spend` (with reasons); `budgetGuard` (the only import path to adapter spend methods, with a test that fails otherwise), kill switch, approvals, settings versions | §4 A5 | `packages/shared/src/namedGrants.ts`; `routeGateLedger.test.ts` must stay green both ways. **No hand-written role list** |
| 6 | **A6 orchestrator spine**: `campaignMachine` runner, job kind(s) in `apps/api/src/modules/org/jobs.ts`, `KIND_CAPS` in `apps/api/src/worker.ts:56`, leased scheduler in `SCHEDULERS` (`apps/api/src/schedulers.ts`) | §4 A6 | ⚠ **One active job per (org, kind) unless `dedup_key` is set** (`mig/0095:21`, `0027:23`): every per-campaign/per-creative job carries `dedup_key`. There is no DB CHECK on `jobs.kind`, so no migration is needed for a kind |
| 7 | **Harness**: `FakeMeta`, `FakeHiggsfield` (TikTok later) as in-process `node:http` servers with fault injection; `FakeClock`; `packages/ads-golden` (copy `packages/hazmat-golden`'s layout); Claude replay + `pnpm ads:eval` (copy `apps/api/src/scripts/replayDocumentReads.ts`); the **simulator platform** (refused when `APP_ENVIRONMENT` = production, with a test) | §4R harness | Build fakes from the vendors' **documented** shapes and cite the doc URL in each; L4 later re-runs the same suite against the real sandbox |
| 8 | **`lint:ads-readiness`** gate (copy `scripts/check-reader-gate.mjs`: `REQUIRED` list, `--self-test`, refuses skip/only/todo/fails) + `pnpm ads:readiness` scorecard; **added to `.github/workflows/ci.yml` `gates` in the same PR**, with a `"//lint:ads-readiness"` comment key | §4R gate | A gate in neither list is not a gate (root `CLAUDE.md`) |
| 9 | **Workers on fakes**: B1–B5 (Meta adapter: connect, create paused, launch/pause/budget + Automated Rules sync, leads webhook + hourly backfill, monitor/reconcile); C1–C5 (brand kit/presets, prompt packs + **`lint:agent-fixtures`** in `ci.yml`, Higgsfield client, canvas overlay, checker); D1–D2 (**only after the HW program's PRs merge**: leads ledger, `ingest_lead`, dedupe, `leadMatch`, convert, notify + latency); F1 analyst | §4 B/C/D/F | Each worker reaches **L1 → L2 → L3** per §4R's table before it counts. Stills overlay uses `@napi-rs/canvas` + `sharp` (already installed). **No Remotion** (company license). **No ffmpeg** in this stage (video is after the canary) |
| 10 | **Screens on the simulator**: E1 settings + connections, E2 brand kit/presets, E3 campaign flow + review screen, E4 leads queue, E5 failed-jobs page | §4 E | Browser pass on three fixtures (fail / empty / staging). Shared UI from `packages/ui` only |
| 11 | **Stage 1 exit**: scorecard shows L3 for every worker; owner walks the whole flow on staging in simulation mode; then the Sun 11/08 release | §5 | Launch still refuses (no L4) — by design |

**Not in Stage 1. Do not drift into it:** any real vendor call (V1–V5, L4), TikTok/X adapters,
video/ffmpeg (C6), the Conversions API live send (B6), the Indeed mailbox (D3), the Tenstreet
listener (D4), organic posting.

## 4. Traps measured on main (2026-11-01)

- `rawBody` is captured app-wide (`apps/api/src/appHttp.ts:136`); verify webhook HMAC over it, constant-time (`safeEqual` in `secretBox.ts:167`).
- Seal every token with `seal(env, plaintext, secretAad(orgId, purpose))` (`secretBox.ts:114,162`). Never log one or return one to the SPA (write a test for each).
- Meta leads need a **Page token derived from the system user**, plus Leads Access Manager. A user or system-user token alone returns nothing. Build the fake to behave that way.
- Upload sniffing exists at `apps/api/src/modules/document-reading/pages/sniff.ts`. Reuse it for brand-kit uploads.
- The service role bypasses RLS: every service query org-filters itself, asserted with `supabaseRecorder`'s `expectOrgScoped`.
- Never `.upsert()` with a partial payload (`lint:upserts`). `ingest_lead` is an UPDATE-or-INSERT RPC (migrations 0174/0175 are the pattern).
- 500-line file / 200-line function budgets (`lint:filesize`, `lint:funcsize`). Plan the folders small (workflow §2).
- A comment that says "proves" or "pinned by" must quote a real test title (`lint:comment-claims`).
- Production runs on AWS (`infra/image/Dockerfile`), staging on Railway `uat` (Nixpacks). Both must boot the worker.

## 5. Process

- Branch from `origin/main` (`claude/<topic>`). Parallel chats share one working tree, so use a worktree.
- Run the whole gate set and **check `$?`** before pushing. `pnpm lint` is not the gate set: read root `package.json` `"//lint:*"` keys and `ci.yml` `gates`.
- Every PR body has the four headings of `.github/pull_request_template.md`. The title is a release-note line for an office reader. The Tests section names the mutation that went red.
- Merge by hand when CI is green (auto-merge is not allowed). Then `pnpm verify:live staging`.
- Commit messages are one descriptive sentence, ending with the co-author line.
- Progress goes at the **END** of `ADS-AGENT-BUILD-WORKFLOW.md`'s progress log. New questions go into the plan's §9 with candidates + recommendation + fallback. A blocker is recorded, never routed around.

## 6. Owner's parallel track (not on Stage 1's critical path; needed by Mon 11/09)

Meta setup (workflow §6 click-path; the owner says "Meta ready", **never pastes the token in
chat**), a Higgsfield **API** key (separate from the Mac CLI login), the TikTok developer app, X
contact, the brand kit + 5–10 real truck/trailer photos, the first opening (pay, home time,
equipment, lanes, yard + radius + reason), spending values, approval of presets P1–P5.

## 7. First action in the new chat

Read §0's files, confirm main's HEAD and the last migration name, then start **step 1 (A1)** and
**step 2 (A2)**.
