# Handoff · 2026-11-04 (late) · Ads agent, Track S (screens), second chat

**Paste this whole file into a fresh chat, starting with "You are Track S (screens)".** It continues
`HANDOFF-2026-11-04-ADS-STAGE1-TRACKS.md` (its §0 read-first list, §4 step list, §5–§7 traps and rules still
hold) after the first Track S chat finished the campaign API and the first Settings screen. Track W (workers) runs in
parallel from `HANDOFF-2026-11-04-ADS-TRACK-W-2.md`; build nothing from its §2.

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, release train, "No workarounds", the two-merge rule, the CI job names.
2. `HANDOFF-2026-11-04-ADS-STAGE1-TRACKS.md` §0 item 5, §4 (Track S's steps), §5 (traps), §7 (first actions).
3. `docs/plans/recruitment/ADS-AGENT-BUILD-WORKFLOW.md`: §4 rows E1–E5 and the **progress log's end** (S1a, S1b, S1c,
   E1a, S1d are this track's; B2c2, "the two halves Track S waits on", and the L3 entries are Track W's).
4. `docs/plans/recruitment/ADS-AGENT-PLAN.md` §4b (Settings › Ads control: the table of groups and the "spend
   control live" paragraph) and §9 Q-AD28 (built as (a)).
5. `docs/DESIGN-SYSTEM-CONTRACT.md`, `apps/web/CLAUDE.md`; memory "Surfaces start at call sites", "Reuse shared UI",
   "Browser pass = 3 fixtures", "Browser pass past login", **"Staging web calls a dead API host"** (new, §2 below).
6. `pnpm ads:readiness`.

## 1. Position

| Step | PR | Merge | What |
|---|---|---|---|
| S1a | #2025 | `cde0c14` | 0566 `ads_campaigns.brand_kit_id` (Q-AD28 = a column; the KIT, not a version). |
| S1b | #2030 | `e322563` | `POST/GET /api/ads/campaigns`, `GET /campaigns/:id`; recruiting's `AdBriefSource` (`recruiting/leads/adBriefSource.ts`) + shared `openingBrief` (claims = only saved facts); `insertCampaign` in `transitions.ts`. Fixed `routeGateLedger.test.ts` (was blind to `xRouter(args)` mounts). |
| S1c | #2033 | `01aeee1` | `POST /campaigns/:id/moves` (the machine's person events) and `/launch` (`ads.spend` + fresh sign-in; `findCoveringApproval` pre-check; budget written in the move's compare-and-set). **Security L2.** |
| E1a | #2037 | `ba294a0` | Settings › Ads control at `/settings/recruiting/ads` (catalogue `admin.recruiting.ads`, gate `section("recruitment")`): limits, automatic pauses (benchmark hints from shared `ADS_BENCHMARK_SUGGESTIONS`), approvals, AI budgets, agent switches, kill switch. `features/ads/` in the "drivers" release area. |
| S1d | #2041 | `14fe649` | `POST /campaigns/:id/creatives/:creativeId/decision` (recorded via `guard/approvals.ts`, moved by Track W's `compose/decideCreative.ts`, own row withdrawn on a lost race); `creatives_approved` on the moves door behind ≥ 1 approved ad. |

- **Every campaign door E3 needs exists:** create → decide each ad / Regenerate → approve the campaign → create paused
  (the runner) → approve the spend (`/campaigns/:id/approvals`, A5) → Launch.
- **Main at handoff:** `824efc0`. **Newest migration:** `0569_mcleod_tractor_periods.sql`. Confirm both **by name**.
- **Scorecard:** Orchestrator, Budget guard L3; Publisher, Copywriter, Art director, Checker, Renderer, **Security**
  L2; Monitor, Lead intake L1 (Track W's #2047/#2048/#2049 take them to L3, open at handoff); Outcome feed, Analyst L0.
- **Worktree:** `../FuelGuard-ads-screens` (Track S's; never Track W's `../FuelGuard-ads-d1`). It is set up (install,
  `build:rn`, both `.env`). `git fetch` and branch from `origin/main` for each step.
- **Open ads PRs at handoff:** Track W's #2047, #2048, #2049 (monitor / lead-intake L3, docs) — none on Track S's files.

## 2. Blocker found: staging cannot be checked in a browser (owner's call)

Logged in at the real staging host `https://staging-api.360.silvicominc.com` (`STAGING_WEB_URL`), **every** page's
`apiFetch` fails ("Failed to fetch"): dashboard tiles read "—", `/recruitment` and every Settings page are blank. Not
E1a: pages it never touched fail the same way.

- **Measured cause:** the staging web build's API base is the repository variable `STAGING_VITE_API_URL =
  https://fleetguardapi-uat.up.railway.app` — the OLD `uat` service, last deployed **10/28** (`70e1592`). Its CORS
  preflight from the new staging origin answers 204 with no `Access-Control-Allow-Origin`.
- `pnpm verify:live staging` is green because it reads `STAGING_API_URL` (the new host, serving main) — not what the
  browser calls.
- **Likely fix (NOT done — a deployment-config change, the owner's to approve):** `STAGING_VITE_API_URL` →
  `https://staging-api.360.silvicominc.com` (same origin as the web), then a staging rebuild. Ask the owner first.
- **Owed once fixed:** E1a's staging pass as the fleet-manager test member (manages recruiting, not an admin; memory
  "Staging test members", login at the NEW host). Expect: fields greyed, no Save, "Stop all ads" offered, no Clear.
  The card must first be turned on for `fleet_manager` on Settings › Permissions (Q-SET2: it starts off).
- Every later screen's "staging" fixture waits on the same fix. Until then: fail + empty + a SAVED fixture via build +
  preview (dev bypass), and say in the PR that the staging pass is owed and why.

## 3. Next steps (Track S), in this order — one PR each, ≤ ~500 lines

1. **E1b — Settings › Ads control: alerts and connections.**
   - **Alerts:** who hears each `ADS_ALERT_CATEGORIES` category (member ids, `alerts.recipients`; empty = the admins,
     a lead alert = who holds recruitment manage) and `uncontacted_lead_minutes` (5–1440). Same save as E1a (a new
     settings version, admin + fresh sign-in): extend `adsSettingsForm.ts` — today it passes `alerts` through
     untouched, and its test pins that; move that pin to "E1a's fields pass through an alerts-only change". Members
     come from an existing members read (find the call site; do not add a second).
   - **Connections + their test:** `/api/ads/connections` (list), `/simulator` (connect), `/meta` (connect),
     `/:id/test`, `/:id/disconnect` (routes/connections.ts). Admin-only with a fresh sign-in except the test (admin,
     no prompt) — read the route's gates, never restate them. A Meta connect form is the owner's G1 click-path; on
     staging only the simulator is real (Stage 1, no credentials).
   - Browser pass on fail / empty / saved. Mutation-prove.
2. **E1c — spend so far against the caps** ("spend control live", plan §4b): month-to-date per platform vs its cap,
   per campaign today and lifetime, the month-end forecast, AI tokens and render credits used, reconcile status. The
   figures come from the D-AD5 fold (`packages/shared/src/ads/adsReport.ts`), so the page and the guard read the same
   numbers — **a new read** (`GET /api/ads/spend` or similar in `routes/`, Track S's) over `ads_spend_hourly` and the
   ledgers, through the fold; never a second calculation. Decide the shape first and say it in one message.
3. **E2 — brand kit + preset editors** (versioned; "saving creates v2"), over `GET/POST /api/ads/brand-kits`,
   `/brand-kits/assets(/upload-url)`, `GET/POST /api/ads/presets` (C1). The preset editor MUST ask for:
   - `overlay_slots` — headline + call to action, two different copy slots (compose refuses a preset without it);
   - `platform_slots` — primary text + headline, two different copy slots, **neither an overlay slot** (Track W's
     B2c2: the publisher refuses a creative whose preset leaves it null, `no_platform_slots`).
   The rules live in `adPresetRecipeSchema`'s `superRefine` (`brandKitContract.ts`): show its messages, don't restate them.
   Uploads go through `FileDropzone` (the only sanctioned uploader).
4. **E3 — the campaign flow**: pick an open opening → choose kit + connection → Create (a fresh uuid per form, S1b) →
   the review screen (every format × language, the three checks with reasons, Approve / Reject with reason /
   Regenerate; `last_error` shown) → Approve the campaign → (runner creates it paused) → approve the spend → Launch
   (admin, fresh sign-in, at the approved amounts). Buttons come from `campaignEventsFrom(state)` plus the door
   rules, never a hand list. Done-when: a recruiter reaches a paused simulator campaign in four clicks; an admin
   launches it. Images: `ads_creatives.assets` paths — find how Track W serves an asset (`readAdAsset`) and whether a
   signed-URL read exists; if not, that read is Track S's route.
5. **E5 — failed-jobs page** (`GET /api/org/jobs/failed`, `apps/api/src/modules/org/jobs.ts`). A forced failure is listed.
6. **G-walk** script in the last PR's body for the owner (stage-1 tracks handoff §4 item 6).

## 4. Traps (11/04, Track S's own, add to §5 of the tracks handoff)

- **A router factory with arguments** (`adsRouter({ briefSourcesFor })`) was invisible to `routeGateLedger.test.ts`
  until S1b fixed its regex; if a gate counts mounts, check it sees yours.
- **A new route needs:** the surface catalogue entry, the route, `routeTable.test.ts`'s probe list AND
  `pnpm --filter @silvicom/web` route snapshot (`-u`), `SettingsPage.test.ts` / `settingsSurfaces.test.ts` counts for a
  Settings card, and a release-train area for a new `features/` folder (`lint:release-train`). `surfaceCatalogue.ts`
  sits at 499/500 lines: a new entry there needs a split or a trimmed comment.
- **`AppSwitch`'s `label` is only an accessible name** — put the words in a row beside it (`ScoreFeatureOptions.vue`).
- **`ci:local` dies under memory pressure** in this machine's long sessions; a killed run is not a result. Never
  restart one the harness stopped without the owner's word.
- **Known flakes seen today, each passed alone 3×:** `org/routes/sectionAccess.test.ts` (non-JSON body),
  `recruiting/routes/publicApplicationSms.test.ts` (in the full batch), `packetOverlay.test.ts` (5 s timeout under
  load), `e2e-apply/employmentTimeline.spec.ts` (5 s wait). Re-run, say so in the PR; never weaken the test.
- **The progress log conflicts on every rebase** (Track W, leads, hiring chats). Keep BOTH, theirs first; a
  `git -c core.hooksPath=/dev/null rebase` skips the slow graph hook mid-rebase.
- **Staging's address is `staging-api.360.silvicominc.com`**, not `fleetguardweb-uat…` (frozen 10/28).

## 5. Owner track (unchanged from the tracks handoff §6, plus one)

- **New:** `STAGING_VITE_API_URL` (§2) — until it is fixed nobody can walk staging in a browser, including the owner's
  G-walk.
- G1 Meta setup · G2 / Q-AD20 Higgsfield key · G3 / Q-AD14 brand kit · G6 / Q-AD12 presets · G4 / Q-AD9 first opening ·
  G5 limits (E1a's page is where they go) · G12 counsel · Q-AD27 + Checker threshold · Q-AD31–33 (leads chat).

## 6. First action in the new chat

1. Read §0. Confirm main's HEAD and the newest migration by name; `gh pr list --state open` for any PR on
   `apps/web/src/features/ads/` or `modules/ads/routes/` (Track W must not have one; if one appears, wait for it).
2. `pnpm ads:readiness` must match §1 (Monitor / Lead intake may read L3 if Track W's PRs merged).
3. Ask the owner the §2 question in one short message, then start **E1b** without waiting for the answer.
4. Each PR: progress-log entry at the END of `ADS-AGENT-BUILD-WORKFLOW.md`; mutation-prove every behaviour test (the
   one-exact-string pattern, restore and compare bytes); root `pnpm typecheck` + full gates (`pnpm ci:local`, check
   `$?`); the four PR-template headings; merge when green; one line in memory `recruiting-ads-agent-position.md`.
