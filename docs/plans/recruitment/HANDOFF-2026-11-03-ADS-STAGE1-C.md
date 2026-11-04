# Handoff · 2026-11-03 · Ads agent, Stage 1 from step C1 (the creative workers)

**Paste this whole file into a fresh chat.** It continues `HANDOFF-2026-11-03-ADS-STAGE1-B5.md`. That
handoff's §4 traps, the B4b handoff's §4, the D0 handoff's §4, the B2 handoff's §4–§5 (traps, process) and the
11/01 handoff's §1 (owner rulings, not to be re-asked) **still hold**. This file replaces the B5 handoff's §1
position, §3 step and §6 first action. Stage 1 = agents + orchestrator proven against fakes, **no
social-network or Higgsfield credentials**.

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, the release train, "No workarounds", the two-merge rule.
2. `docs/plans/recruitment/ADS-AGENT-BUILD-WORKFLOW.md`: the **C1–C6 rows** (§4, lines ~219–224), §4R's
   **Copywriter, Art director, Checker, Renderer** rows (L2 faults, L3 bars — the Copywriter's "0 claims outside
   the brief" is ABSOLUTE because the claim checker is pure), the step-7 split note in the progress log ("Claude
   replay + `pnpm ads:eval` move to C2"), and the **progress log's end** (B5a/B5b/B5c are the newest).
3. `docs/plans/recruitment/ADS-AGENT-PLAN.md`: §2b (concepts = presets, D-AD11), §4a (presets P1–P5, proposed,
   Q-AD12), the brand kit (Q-AD14), D-AD12 (a person approves every creative), D-AD13 (AI budgets), §9.
4. What C plugs into (read before writing it):
   - `supabase/migrations/0537_ads_foundation.sql` — `ad_brand_kits(+_versions)` (~line 128), `ad_concept_presets
     (+_versions)` (~156), `ads_creatives` (~291; frozen once it leaves the workers, AX030), `ad_generations`
     (append-only provenance). C1 is mostly the API over tables that already exist.
   - `apps/api/src/modules/ads/generations/claudeGeneration.ts` + `generationLedger.ts` — the A4 AI rail: the ONE
     way an ads worker asks Claude (per-agent switch, monthly token budget, `ad_generations` provenance). C2's
     workers call it; they never construct a client.
   - `packages/shared/src/ads/adClaims.ts` (the pure claim checker), `presetDraw.ts` (concept rotation),
     `renderGeometry.ts` (safe zones + contrast, already pinned in the Checker's L1), `naming.ts`, `contracts.ts`
     (`AD_AI_AGENTS`, `adBriefSchema`, `CREATIVE_STATES`).
   - `apps/api/src/modules/ads/creative/higgsfield/fakeHiggsfield.ts` (#1923, step 7c) — C3's fake already exists.
   - `apps/api/src/modules/ads/orchestrator/workers.ts` — `compose` and `createPaused` are still `null`; C fills
     `compose` (B2c fills `createPaused`). Read `runner.ts` for how a worker's result moves the campaign.
   - `scripts/ads-readiness.registry.mjs` — Copywriter (L1 partly: claim checker pinned, `notBuilt` C2), Art
     director (`notBuilt` C2), Checker (L1 partly: renderGeometry pinned, `notBuilt` C5), Renderer (`notBuilt`
     C3 + C4).

## 1. Done (all merged to main)

| Step | PR | Merge | What |
|---|---|---|---|
| B5a | #1993 | `41a2758` | Hourly insights → `ads_spend_hourly` (its one writer). Job `ads_insights`, scheduler `ads-insights`. Three LOCAL days re-read every hour in the zone Meta reports for the account (`timezone_name`, never stored); full-row upsert on `campaign_id,hour`, no migration. FakeMeta `fakeMetaInsightsHourly.ts` (`plantHour`, `forgetHour`, `plantFrequency`, `forgetAllHours`). |
| B5b | #1994 | `82e4e48` | Auto-pause checks inside the same job: pure `packages/shared/src/ads/monitorChecks.ts`, applied by `monitor/checks.ts`. Caps always; performance rules never while Meta's `learning_stage_info` says LEARNING or is unreadable. A breach = the agent's `pause` via `applyCampaignEvent` (actor `monitor`), carried to Meta by the orchestrator. Bells: caps → `ads_overspend`, zero-lead → `ads_no_leads`. |
| B5c | #1995 | `070fb88` | Daily reconcile: pure `adsReconcile.ts`, `monitor/reconcile.ts`, job `ads_reconcile`, scheduler `ads-reconcile`. 28-day insights re-read, then Meta vs our rows; each mismatch one `ads_actions` `external_change` row (actor `platform`) + bell, "once" = the ledger's unique idempotency key. Never adopted, zero POSTs to Meta (tested). |

- **Main at handoff:** `070fb88` or later. **Newest migration on main:** `0561_lead_conversion_claim.sql`.
  Confirm both by NAME at start; other chats merge all day (the leads-first chat merges recruiting PRs too).
- **Scorecard (`pnpm ads:readiness`):** Orchestrator L3, Budget guard L3, **Monitor L1** (B5 complete), Lead
  intake L1, Security L1, everything else L0 — Copywriter, Art director, Checker and Renderer are C's.
- Worktree `../FuelGuard-ads-d1` holds this handoff's branch; reuse it from a fresh `origin/main` branch.

## 2. Open questions and blockers (do not route around them)

- **Q-AD23 / Q-AD24:** unchanged, owner has not ruled.
- **Q-AD25 (new, B5b):** B3b's Meta Automated Rules carry no learning-phase filter, so Meta pauses a learning ad
  set on performance rules our monitor holds back. Recommendation (c) find a filter at L4, (a) until then.
- **Q-AD26 (new, B5b):** `pause_when_filled` needs a recruiting → ads seam (D-AD17). Recommendation (b) recruiting
  pushes "opening closed". Not built.
- **Q-AD12 presets, Q-AD14 brand kit, Q-AD20 Higgsfield key** — owner track. C is built and proven WITHOUT them:
  presets and kit come from fixtures; Higgsfield is the fake. Never invent a real preset or brand value in code.
- **G12 / Q-AD8 counsel:** the copy rules the claim checker enforces are the fallback set until counsel rules.

## 3. Next step: C — the creative workers (PRs of ≤ ~500 lines each)

Order (the workflow's dependencies): **C1 → C2 → C3 → C4 → C5**, C6 (video) only after C5 and G9.
1. **C1 — brand kit + presets API.** Versioned (a save is a new version row; nothing edited in place), uploads
   sniffed by content not extension, SVG rasterised, assets stored by sha256. Done-when: a `.png` that is really
   a PDF is refused. ⚠ The sniffer today is `modules/document-reading/pages/sniff.ts` — a feature's internals;
   importing it from `ads` will fail `lint:boundaries`. Check its public export first; if there is none, that is
   a capability to move to `lib/` (or export), said in the PR — not a copy.
2. **C2 — Copywriter + Art director prompt packs** (`modules/ads/workers/*/prompt.v1.md` + zod schema + fixtures),
   both through the A4 rail. **New gate `lint:agent-fixtures` in `ci.yml` `gates` in the SAME PR** (CLAUDE.md: a
   gate in neither list is not a gate). **Claude replay + `pnpm ads:eval` arrive here** (step-7 split note).
   Done-when: fixture agreement recorded as the baseline; a planted invented figure fails the claim check.
3. **C3 — Higgsfield client** on `fakeHiggsfield.ts`: key sealed; `Idempotency-Key` = generation id; verified
   webhook or poll; output copied to our storage at once (Higgsfield URLs expire in 7 days); credit budget checked
   before submit; `KIND_CAPS` 1. Done-when: a replayed generation spends nothing; an expired URL never reaches
   the UI.
4. **C4 — overlay renderer (stills):** 1:1, 4:5, 9:16 templates, text from the brief only, safe zone + contrast
   measured over the text's zone (`renderGeometry.ts`). Golden images per format; a too-long line REFUSES.
5. **C5 — Checker:** copy (pure, `adClaims`) + visual (Claude vision checklist from the brand kit) + render
   (pure); one regeneration, then stop with the reason. Done-when: planted glyph image fails; planted foreign
   logo fails; a second failure stops.
6. **Readiness:** each step replaces its `notBuilt` with pinned tests. Copywriter/Art director/Checker/Renderer
   reach L1 only when every L1 item is pinned.
7. **Docs:** progress-log entry per PR at the END of the workflow file (append-vs-append conflicts with other
   chats: keep both, theirs first — happened on B5b).

Every test that claims a behaviour is shown to fail by mutation before the PR (memory "Mutate to prove").

**Then (unchanged order):** B2c (the ad itself + `createPaused`), F1, D2, E1–E5, B6. **Honest calendar:**
Stage 1 is still C1–C5, B2c, F1, D2, E1–E5 and the eval tooling away; then Stage 2 (credentials, L4). The first
real ad is no earlier than the day after L4. Say so again if asked.

## 4. Traps hit this session (add to the earlier lists)

- **`apps/api/src/modules/org/jobs.ts` is at 493 of 500** (`lint:filesize` failed at 502 on B5c). A new job kind
  gets a ONE-LINE comment. `env.ts` is still at 499, `fakeMeta.ts` at 450 (every new FakeMeta family in its
  own file — the WeakMap-keyed store in `fakeMetaInsightsHourly.ts` is the pattern that adds no field).
- **Derive, don't restate:** B5a wrote its own time-zone arithmetic; `packages/shared/src/calendarDay.ts`
  already owns it (`wallClockInZone`, `wallClockToUtc` — ambiguous → first occurrence, non-existent → backward,
  read back to refuse). B5b fixed it. Search `packages/shared` before writing any helper.
- **A fake that ignores a call's options lets a mutant live**: the in-memory upsert ignored `ignoreDuplicates`,
  so "insert-or-skip instead of replace" survived. Make the test's fake apply what PostgREST would.
- **An injected `temporary` fault makes `MetaGraph` back off and the test times out at 5 s**; use a fault that is
  not retried (`token_expired`) when the test is about a refused read, not about retries.
- **`startAction` already answers the ledger's 23505 as `"duplicate"`** — use it for "record once" instead of
  catching an insert error by message.
- **`ci:local --job test-api` under load times out unrelated suites** (`inventoryAssets` this time); re-run the
  failing file alone before suspecting the change, and say so in the PR.
- **Fetching Meta's docs:** some reference URLs 404 (`/reference/ad-campaign/insights/`); the Breakdowns, Best
  Practices, campaign-group Insights, Ad Set and `ad-campaign-learning-stage-info` pages answered. Cite the
  page and date in the fake's header, and say what is OUR reading (L4 confirms).

## 5. Owner track (unchanged, due Mon 11/09)

Meta setup ("Meta ready", never a token in chat) including the app secret, webhook verify token, App Dashboard
`leadgen` subscription and the Page's Moderate task; **Higgsfield API key (Q-AD20)**; TikTok developer app; X
contact; **brand kit + photos (Q-AD14)**; the first opening; spending values; **presets P1–P5 (Q-AD12)**; counsel
(G12 / Q-AD8); rulings on Q-AD23 / Q-AD24 / **Q-AD25 / Q-AD26**; approval of the next release (it carries
everything from A5 through B5c).

## 6. First action in the new chat

1. Read §0.
2. Confirm main's HEAD and the newest migration **by name**; confirm no other chat has an open PR on
   `modules/ads/workers`, `creative/`, brand kits, presets or Higgsfield (`gh pr list --state open`).
3. Run `pnpm ads:readiness`; it must match §1 (Monitor L1; Copywriter/Art director/Checker/Renderer L0).
4. Read `0537`'s brand-kit and preset tables, the A4 rail, and the sniffer's location; say in one short message
   what C1 needs that does not exist yet (and whether the sniffer can be reached without a boundary breach).
   Then build C1.
