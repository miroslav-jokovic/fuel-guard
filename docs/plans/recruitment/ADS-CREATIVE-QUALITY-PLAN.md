# Ads creative quality and variety — plan (CQ1–CQ9)

**Status:** planned 2026-11-09, waiting on the owner's rulings in §5 (Q-AD54–Q-AD61). Owner's ask (2026-11-09):
audit the ads-creation part and the agents; "make sure when ads are created we will not have some bad quality
generic ads produced"; "high grade ads that will be really good and reliable"; "multiple versions in production,
not fall down to 2–3 same patterns"; and first "research real world automated ads systems, not trucking only".
**Parent:** [`ADS-AGENT-PLAN.md`](ADS-AGENT-PLAN.md) (D-AD*, Q-AD*); build order and tracks per
[`ADS-AGENT-BUILD-WORKFLOW.md`](ADS-AGENT-BUILD-WORKFLOW.md). Sibling: [`ADS-LEAD-QUALITY-PLAN.md`](ADS-LEAD-QUALITY-PLAN.md)
(the form after the click; this plan is the ad before it). Opens Q-AD54–Q-AD61 (§9 of the parent points here).

## 0. Why this plan exists — what the audit of main (b492e5e) found

The pipeline is **strong where the parent plan aimed it: safety and correctness.** Every figure in an ad is traced
to the brief (`adClaims.ts`), the image model never writes text and our renderer composites the words (D-AD9), every
model and vendor call is keyed and ledgered (D-AD13), money is behind the guard and a kill switch (D-AD3). None of
that changes here.

It is **weak on creative quality and variety, and the weakness is structural, not a tuning problem.** As built, one
campaign yields at most **2 concepts**, each with **1 image, 1 copy, 1 fixed layout**, written from **3–5 facts**, by
an art director that **never sees the job**, and nothing afterwards measures which concept worked. The "2–3 same
patterns" outcome the owner fears is the current design's ceiling. The findings, each verified at the call site:

| # | Finding | Where on main | Weight |
|---|---|---|---|
| G-CQ1 | **The second batch never enters.** `nextPresetBatch(draw, [], BATCH)` is always called with an empty `started` list, so only the first two presets of the draw are ever composed; no machine event or code advances the batch after review (the plan said "the orchestrator calls this after each batch reaches review"). The test "composes the first two in its order" pins the gap. Max 2 concepts per campaign; plan v4 wanted 4–5 for Andromeda. | `compose/composeCampaign.ts:36,73` | high |
| G-CQ2 | **The art director's input is identical for every campaign on the same preset and kit:** template, slot names, scene flags, photo labels. Not the brief, not the opening, not the season. Each P1–P5 recipe exposes one slot (`{time_of_day}`, `{road}`, `{background}`, `{street}`, `{setting}`, `{color}`). Five presets ≈ five pictures, forever. | `workers/artDirector/artDirector.ts:42-49`; fixture recipes | high |
| G-CQ3 | **No per-ad performance data exists or can exist.** Insights are pulled at `level: "campaign"` into `ads_spend_hourly (campaign_id, hour)`. So §8 "measure which preset works for us", D-AD11 reweighting, §2b "fatigue = 2× own history" and any per-preset report have no source. The learning loop is not unbuilt — it has no table. | `monitor/insightsPull.ts:139,189` | high |
| G-CQ4 | **The production brief is thin.** `openingBrief` makes claims from: pay min/max, minimum age, years of Class A, and a home-time TERM only when the typed text exactly matches a `PROMISE_TERMS` phrasing. Equipment and lanes exist on the opening but are **not sent** to the copywriter (`copyUserMessage` = subject + claims). `PROMISE_TERMS` lists 19 terms (sign-on bonus, 401k, health insurance, no-touch, drop & hook, late-model, paid orientation…) and **no opening field can produce any of them** but home time. Production copy can say: pay, age, years, maybe "home weekly", "apply today". That is the generic ad. | `shared/recruiting/leads/openingBrief.ts:44-51`, `copywriter.ts:70-80`, `adClaims.ts:93-113` | high |
| G-CQ5 | **The 40/40 copywriter baseline measures rule compliance on briefs production cannot make**, never craft. Fixtures carry $5,000 sign-on bonuses and benefits; the judge is `judgeCopy` (claims + length). Concrete: the PASSING recorded fixture `p1-otr-bonus` says in Spanish "cada **kilómetro** recorrido" next to "$0.72 por **milla**" — a Spanish-speaking driver notices; the judge cannot. The only quality measure in the design (owner's approve-without-edit rating, PR #2054) is unrecorded. | `workers/agentFixtures.ts:74-78`; `copywriter/fixtures/p1-otr-bonus.json` | high |
| G-CQ6 | **One copy per creative, attempt 1 only**; EN and ES differ by translation. No candidates, no choice, no Meta text variations. | `copywriter.ts:128`, `composeCreative.ts:85` | medium |
| G-CQ7 | **One render per creative, cropped to every format with `fit: cover`.** No composition per aspect; the publisher then uses only 4:5/1:1 (Q-AD29), so the 9:16 crop is paid for and unused. | `composeCreative.ts:136`, `overlay.ts:117-120`, `publisherAds.ts:33` | medium |
| G-CQ8 | **One overlay layout for every ad:** dark plate at the bottom, two-line headline, CTA, EEO line, logo top-left; per format a kit may change only text and plate colour. Every carrier's every ad looks like `__golden__/4x5.png`. | `overlay.ts:47-49`; `brandKitContract.ts:71-76` | medium |
| G-CQ9 | **EN and ES ads share one ad set with geo-only targeting** (no `locales`). Spanish ads are shown to English readers and the reverse, and Meta's allocation will starve one language. | `platforms/meta/publisher.ts:177-181` | medium |
| G-CQ10 | **No creative refresh.** `frequency_max` pauses the whole campaign; nothing enters the next preset from the stored draw. | `monitor/checks.ts` | medium |
| G-CQ11 | **The kit's `company_name` and `phone` are read by nothing** (overlay, copywriter, publisher). The carrier is named only by its logo, if uploaded, and the Page. | grep over `overlay.ts`, `copywriter.ts`, `publisherAds.ts` | medium |
| G-CQ12 | **P5 "Straight talk" is a 3-card carousel; the publisher makes single-image link ads only** (no `child_attachments`): `card_need`/`card_apply` are generated, paid for, discarded. **P4 Walk-around** is 9:16-only motion; motion is unbuilt (C6) and 9:16 unused, so P4 as written ends `no_feed_image`. | `publisherAds.ts:60-76`; P4/P5 recipes | medium |
| G-CQ13 | **A person's rejection reason goes nowhere.** Review has Approve / Reject(reason) only — the plan's "Regenerate this one" and "Edit copy" do not exist; campaign `regenerate` re-runs the same inputs; only visual fails get the fixed `REGENERATION_CLAUSES`. A copy refusal (a one-character Spanish overrun) stops the concept with no retry. | `AdsCreativeReview.vue`, `composeCreative.ts:87`, `artDirection.ts:99-108` | medium |
| G-CQ14 | **The checker judges defects and is told not to judge fit** ("Do not judge whether the image is attractive or fits the job"). No craft or brand-fit gate before the human; recall measured on a 10-image corpus; threshold Q-AD45 unset. | `checker/prompt.v1.md:34` | medium |
| G-CQ15 | **Every creative worker is pinned to `claude-sonnet-4-6`** because the rail forces `tool_choice`, which the Claude 5.x models reject. The parent plan named the fix (structured outputs / strict tools with `auto`, §4a) and it was not taken. | `lib/anthropic.ts:65`, `shared/ai.ts:13` | medium |

Not quality, but blocking any real ad today (state, recorded so the calendar is honest): `HIGGSFIELD_STILL_MODEL =
null` and `HIGGSFIELD_CREDIT_PRICES = {}` (V4, needs the owner's key); no brand kit and no preset exist in production
(Q-AD12, Q-AD14 — P1–P5 live only in test fixtures); Launch refuses below L4 for every worker and the three creative
workers are L2; production on 2026-11-09 has 0 connections and 0 campaigns.

## 1. What real automated-ads systems do — research read 2026-11-09, not trucking only

Each row is what a working system does, then what it means for us. Sources at the end.

| # | Proven practice | Who does it | What it changes here |
|---|---|---|---|
| R1 | **Diversity is the unit, not count.** Meta's Andromeda ranking collapses near-duplicates into one ad and rewards *conceptually* distinct creatives; cosmetic variants (CTA colour, capitalisation) do not count. Practitioner ranges for one ad set: 4–6 for small budgets (AdScale's account data: CTR +22 % vs 1–2, plateau past 7, CPM +8–12 % from fragmentation), 8–20 for larger. Meta publishes no number. | Meta Andromeda; Confect, Chatterbuzz, Admove, AdScale | Our target is **4–6 distinct concepts live per ad set** at our budgets (Boostpoint median $26.86 per applicant → a few hundred dollars a week), not 2 and not 20. G-CQ1 is the first fix. The presets must be *conceptually* different (hook, scene, layout), which is CQ2 + CQ5. |
| R2 | **Platforms assemble ads from asset pools and test combinations themselves.** Meta `asset_feed_spec` (Dynamic Creative): ≤10 images, ≤5 bodies, ≤5 titles, ≤5 CTAs, ≤5 descriptions, 30 assets total, ad set `is_dynamic_creative=true`. Google RSA/PMax: 15 headlines + 4–5 descriptions, "Ad Strength" grades *diversity* of the pool, pinning one asset per slot is discouraged ("pin 2–3 per position" when a legal line must always show). Meta's Advantage+ creative writes up to 5 text variations and rewrites the headline inside the image. | Meta Marketing API; Google Ads Help | Produce **pools**, not single strings: 3–5 primary texts and 3–5 headlines per creative, all claim-checked, and let the platform combine. Our EEO line is the "pinned legal asset". **Whether Dynamic Creative works with Instant Forms is undocumented** (the asset-feed pages never mention `lead_gen_form_id`; one 2026 practitioner source says DC "remains available for Lead Generation", Meta's own page says it is NOT available for *call* lead ads). → Q-AD55: prove on the sandbox; fall back to several single ads per concept. |
| R3 | **Generate many, filter by machine, then a person picks.** Production image pipelines render 2–4 candidates in parallel ("keep the best"), screen with a vision model against the brand kit, then human review; at scale 50–500 candidates with automated pre-filter. "Prompt text gets you 90 % consistency, reference images get you the rest"; a **master frame** the team signed off and a **versioned reference set** beat adjectives. | Treza, Neurohive, Market-IA, Astorie; arXiv 2607.04691 | We already have the reference photo and the vision checker. Add **k candidates per creative** (images and copy), a **craft rubric** as a second, scored judge, and show the person the ranked set. D-AD9 (start from our photo) is confirmed as proven practice. |
| R4 | **Pre-launch predictive scoring filters the slate to the top 20–30 %; in-market testing picks the winner; learnings feed the next round.** AdCreative.ai scores before launch; Pencil/Omneky/Smartly run generate → test → shift budget → regenerate; Motion explains *why* winners won and feeds the next brief. | Cometly, Entropik, Newform, AdStellar roundups | We have none of the loop. **Per-ad insights** (R5) are the prerequisite; then "preset P3 beat P1 on cost per converted lead for this brief type" becomes the next draw's weight (D-AD11 said so; the data source was never built). |
| R5 | **Per-ad data comes from the Insights API with `level=ad`,** joined to the creative's attributes; daily pull after Meta finalises the day; Dynamic Creative adds asset breakdowns (image/title/body) with a narrower metric set. | Meta Insights API; Databricks connector; Supermetrics | A new table at ad grain (new tables are exempt from the two-merge rule), pulled by the existing hourly job alongside the campaign rows. |
| R6 | **Fatigue is a composite, judged against the ad's own baseline, not frequency alone.** 7-day frequency 2.5 warn / 3.0 caution / 3.5 refresh / 4.0 critical on cold audiences; CTR −15 % week over week with frequency ≥ 3; CPM +18 % over two weeks; first-time-impression ratio < 50 %; minimum 7–10 days before judging; Meta's own "Creative limited" (cost per result above history) / "Creative fatigue" (double) statuses. Refresh every 1–2 weeks at high spend, 2–4 weeks at low; Andromeda shortened burn windows to 2–3 weeks on Reels. | Triple Whale framework via adlibrary, adsights, datadrew, makometrics, succession.media | Our `frequency_max` pauses the campaign. Proven practice **retires the ad and enters the next concept** from the stored draw (the draw already holds the order). The thresholds become settings with their source labelled, like the §2a.7 benchmarks. |
| R7 | **Quality is judged by a rubric against human labels, never by compliance alone.** LLM judges reach ~85 % agreement with humans when the rubric decomposes into concrete criteria with reasoning before the score (G-Eval, Prometheus); they over-favour long confident text and cannot judge brand voice unvalidated; the fix is a human-rated set as ground truth, with human effort spent at the rubric's edges. | Braintrust, Mastra, Adaline, FutureAGI; arXiv 2608.24314 | The owner's rating of the 40 copywriter answers (PR #2054) is that ground truth and is still unrecorded. The craft judge (CQ6) is calibrated to it, and it is **not** a gate on its own: the human still approves (D-AD12 stands). |
| R8 | **Employment ads on Meta: fixed 18–65+, all genders, radius ≥ 15 miles, no ZIP, no lookalikes, no exclusions, interests only from an approved list.** `locales` is in neither the allowed nor the forbidden list of Meta's own page. | Meta Special Ad Categories doc | Our adapter already refuses < 15 mi (B2a). Language split per ad set (CQ8) must be **proven on the sandbox** before it is relied on → Q-AD56. |
| R9 | **Recruitment-specific platforms (Appcast, Joveo, PandoLogic, VONQ) optimise *distribution and bidding*, not creative;** their social products (Appcast Brand Ads, Joveo MOJO Gro, Recruitics Social at Scale) sit on top. None publishes how it writes creative. | Joveo, Adway, Guideflow roundups; G2 | Nothing to borrow for creative; confirms the owner's "use proven practice" has to come from general ad tech (R1–R7), not from recruiting vendors. |

What the research did **not** settle (each is a Q-AD, not an assumption): Dynamic Creative with Instant Forms
(Q-AD55); `locales` under EMPLOYMENT (Q-AD56); which Higgsfield model draws our trucks best from a photo (V4,
Q-AD20); whether Meta's "Creative fatigue" status is readable through the API (no developer page surfaced — the
monitor computes its own composite from insights either way).

## 2. Decisions proposed (D-AD18–D-AD23)

- **D-AD18 · A campaign holds 4–6 distinct concepts, all entered.** The compose step advances the stored draw until
  every eligible preset has a creative, in batches of 2 as today; review shows them all; the publisher makes an ad per
  approved creative in the one ad set (as today). "Distinct" is the preset author's duty, checked by CQ5's concept
  fields (hook family, scene family, layout), not by a similarity score we cannot measure.
- **D-AD19 · Candidates, then a ranked pick.** Each creative asks for k=3 copy candidates (one call, one tool, three
  answers) and renders 2 images (two seeds, same prompt). Every candidate passes the existing checks; the craft judge
  ranks the survivors; the review screen shows the ranked set with the top one selected. Cost is bounded by the
  existing budgets (tokens, credits); the settings page gets `candidates_per_creative` with a hard ceiling.
- **D-AD20 · The brief carries the job, not only the figures.** Equipment, lanes, freight, schedule and benefits are
  structured opening fields (closed catalogues where one exists — `PROMISE_TERMS` already enumerates the benefit
  terms — free text only where it must be), and reach the copywriter as `subject_matter` and the art director as
  `scene_context`. Nothing new may be *claimed*: `checkClaims` still refuses any figure or promise not in `claims`;
  subject matter only tells the model what the job is like.
- **D-AD21 · A craft judge beside the compliance checks, calibrated to the owner's ratings.** A fourth check with a
  decomposed rubric (hook strength, specificity to this job, plain-language fit, Spanish written for a Spanish
  reader, no filler) returns per-criterion reasons then a score; its threshold is set from the human-rated set; it
  ranks (D-AD19) and flags, it never approves. D-AD12 "a person still sees and approves every one" stands.
- **D-AD22 · Ad-grain insights and a per-concept report.** `ads_ad_spend_hourly (org, ad, hour)` filled by the
  existing insights job at `level: "ad"`; the daily brief and a Campaigns-tab table read cost per lead and per
  converted lead **per preset**; the draw takes a weight from it only after an owner-set number of leads (Q-AD59),
  and the weight is a recorded input of the draw, so "why this preset" stays reproducible.
- **D-AD23 · Fatigue retires the ad and enters the next concept.** The composite from R6 (frequency, CTR vs the ad's
  own first week, CPM drift, Meta status when readable) is a setting with its source; a fatigued ad is paused at
  Meta and its preset marked `retired` on the campaign; the next preset in the stored draw is composed and, once
  approved, published. The whole-campaign pause stays for the caps and no-lead rules.

## 3. The steps

Order follows dependency and payoff; CQ1 is small and unblocks everything the owner asked for.

| Step | Track | What is built | Done when | Blocked by |
|---|---|---|---|---|
| **CQ1 · Enter every batch** | W | `composeCampaign` keeps a window of `BATCH` (2) creatives drawing at once and enters the next unstarted preset of the draw whenever one finishes, until every drawn preset has a finished creative; only then `creatives_ready`, so review sees the whole set. **Built 2026-11-09 as the all-at-once variant**, not "first batch to review, the rest arrive": that would need compose to run in `review` (a runner and tick change for a few minutes' head start), and the machine's own comment already says composing = "one creative per enabled preset". | `composeCampaign.test.ts` "a third preset enters once one of the first two has finished, and waits while both are still drawing"; mutants: no refill (the old bug), no cap, started-not-moved-first — all red. | none — **DONE** |
| **CQ2 · Widen the brief (D-AD20)** | S + W | Opening gets `schedule`, `benefits` (boxes derived from `PROMISE_TERMS`), `bonus {kind, cents}`, `in_our_words` (claim-checked against the opening's own facts); `openingBrief` makes claims of them (and of any figure typed into home time or lanes) and `subject_matter` of equipment/schedule/lanes/typed home time; copywriter v2 reads subject matter, the carrier's line and the company name, and sees each fact written out; art director v2 reads the details as scene context. One fit pass for wording-only refusals. **Built 2026-11-09 (Q-AD54 taken as (b))**; freight as a separate catalogue was not needed — no-touch, drop & hook and the rest are already `PROMISE_TERMS` boxes. | 20 fixtures made through `openingBrief` from opening fields; live 58/60 after the fit pass (the two refused are honest refusals); `foreign_unit`, road names, "and up", ranges and vouched details pinned in `adClaims.test.ts`; 6 mutants red. | none — **DONE** |
| **CQ3 · Ad-grain insights (D-AD22)** | W + G | Migration **0577** `ads_ad_spend_hourly` (new table, RLS, composite FKs to campaign AND creative); `insightsPull` adds a `level: "ad"` read per campaign with ads, same window, full-row upsert. **Built 2026-11-09** (#2145). Reader **built the same day**: shared `foldConcepts`, `GET /api/ads/campaigns/:id/concepts`, the "What each concept did" table in the campaign drawer. The daily brief's per-preset lines wait for the analyst chat (prompt @4). | `insightsPull.test.ts` +5, matrix +6, 6 mutants; reader: fold tests, org-scoped reader test, sweep pins the cross-org figure absent, 4 mutants. | none — **DONE** |
| **CQ4 · Candidates and ranking (D-AD19, D-AD21)** | W | Copywriter v3 returns `k` candidates (setting, default 3); each through the checks; invented ones dropped, wording ones fitted once together; craft judge (`workers/craftJudge/`, five criteria, seeded presentation order) ranks the survivors; `ads_creatives.candidates` (0579) holds the ranked set with scores and reasons; `copy` holds the pick; review shows the ranked alternates. **Built 2026-11-09** (#2155 column, CQ4b workers). Still open: two renders per creative (waits V4's model); "use this one instead" (CQ4c); the judge's L3 waits on the rating sheet. | Planted filler ranked last 6/6 twice; copywriter 58/60 sets with a survivor; 6 mutants red. Cost: one Copywriter call (~3× the tokens of one copy) + one judge call per creative. | Owner's rating sheet (#2054), Q-AD57 — **BUILT, L3 open** |
| **CQ5 · Presets that are actually different** | owner + S | Recipe gains `concept` (hook family: pay-first / life-first / equipment-first / straight-talk / proof; scene family; layout key); the preset drawer requires them; a save refuses a concept triple another enabled preset already has. Starting set rewritten with 3–5 image slots each (scene, weather, viewpoint, mood, setting) and a brief-aware hook formula; P4 re-specified as a still until C6; P5 as a single image or dropped until carousels exist. | P1–P5 saved in production by the owner (Q-AD12 finally closed); `lint:agent-fixtures` fixtures regenerated on the real recipes. | Q-AD12, Q-AD58 |
| **CQ6 · Overlay layouts** | W | 3 layouts on every format — `bottom_plate` (as today), `top_band` (logo bottom-right), `centered` — chosen by the preset's `layout`; same contrast and safe-zone checks; goldens per layout; kit keeps colours only. **Built 2026-11-09**; the side column was dropped (honest only on 1:1/4:5, which would tie layout to format). | Render goldens ×3 per format; compose test: the checker's band follows the layout; 5 mutants red. | none — **DONE** |
| **CQ7 · Text pools on the platform (R2)** | W | Publisher sends the ranked copy candidates as Meta text variations: Dynamic Creative (`asset_feed_spec`, `is_dynamic_creative`) if Q-AD55 proves it with Instant Forms, else one ad per candidate pair (≤ 3 per concept) named `|v1..3`. | Publisher contract test on fake and sandbox. | Q-AD55 (sandbox) |
| **CQ8 · Language split (R8)** | W | One ad set per language with `locales` if Q-AD56 proves it under EMPLOYMENT; else two ad sets differing only by the form language, budgets split by a setting. | Contract test on sandbox; monitor reads both. | Q-AD56 (sandbox) |
| **CQ9 · Fatigue → refresh (D-AD23)** | G + W | **CQ9a built 2026-11-10**: migration 0581 (`retire_ad` kind, `ads_creative_retired` category), settings group `creative_refresh` (retire off by default; min_days 7, ctr_drop 25 %, min_impressions 2,000 — R6's numbers), pure `fatigueVerdict` (last week vs the ad's own first week, from CQ3's per-ad hours), `PlatformSafe.pauseAd`, the Settings card. **CQ9b built 2026-11-10**: the monitor's retire step inside the hourly job (verdict → `pauseAd` → `retire_ad` row → `platform_status = retired` → bell), switch-gated. **Entering the next concept on a live campaign = Q-AD68** (below), not assumed. CPM drift dropped: CPM moves with the auction, not the ad (R6's own caveat). | `adFatigue.test.ts` 7; adapter `pauseAd` 3; matrix +3; `retireTired.test.ts` 5, 4 mutants. | Q-AD68 — **retire DONE, enter-next open** |

Also in CQ4's PR, because it is the same rail: the generation rail moves off forced `tool_choice` to a strict tool
with `auto` + a "no tool call" refusal path, so each worker's model is chosen by its fixture gate (Q-RA22), not by
what the rail can call (G-CQ15). The three workers re-record their baselines on the chosen models in that PR.

Readiness: each step that touches a worker replaces its registry pins in the same PR (`scripts/ads-readiness.registry.mjs`,
`pnpm gen:ads-readiness`). The craft judge is a new §4R row ("Craft judge") with L1 pure rubric parsing, L2 fixtures,
L3 agreement with the rated set, L4 a sandbox run's pictures judged. It joins `CAMPAIGN_WORKERS["meta:still"]`
(13 workers; Launch then needs its L4 too — that is the point).

## 4. Order and what blocks what

```
CQ1 ──────────────────────────────┐
CQ3 (migration) ── reader (+1 merge) ──┤
CQ2 (fields) ── fixtures ── CQ4 (needs rating sheet) ── CQ5 (owner saves presets) ── CQ6
                                  └── CQ9 (needs CQ1 + CQ3 reader)
Sandbox (Stage 2): CQ7, CQ8 — proven there before they are relied on
```

CQ1, CQ3 and CQ6 have no owner dependency and can start now. CQ2 waits one ruling (Q-AD54). CQ4 waits on the
rating sheet the owner has had since 11/05 — without it the craft judge has no ground truth and would be a model
grading a model (R7). CQ5 is the owner typing five presets; everything upstream makes that worth doing. CQ7/CQ8 are
sandbox facts first.

**Calendar, honestly:** CQ1 + CQ3 + CQ6 ≈ 3 PRs, 1–2 days. CQ2 ≈ 3 PRs (migration, brief, prompts) ≈ 2 days. CQ4 ≈
2 days once the sheet exists. CQ5 is owner time. CQ9 ≈ 2 days after CQ3's reader. Total ≈ 8–10 build days across
tracks, on top of Stage 2 (sandbox L4) which gates any real ad regardless. None of it moves the first-real-ad date
earlier; all of it decides what that ad looks like.

## 5. Open questions (also in ADS-AGENT-PLAN §9)

- **Q-AD54 · Which opening fields widen the brief (owner).** (a) The CQ2 list: freight (catalogue), schedule
  (catalogue), benefits (multi-select of `PROMISE_TERMS`), bonus amount + kind, plus the existing equipment and lanes.
  (b) (a) plus one free "why drive for us" line (≤ 140 chars), claim-checked like copy. (c) Keep the brief as is and
  accept generic copy. **Rec: (b)** — the line is where a carrier sounds like itself; the claim check keeps it honest.
- **Q-AD55 · Dynamic Creative with Instant Forms (us, sandbox).** Meta's asset-feed pages never mention lead forms;
  one 2026 source says available, Meta says not for call ads. (a) Prove on the sandbox in Stage 2; if it works, CQ7 uses
  it. (b) If not, one ad per candidate pair (≤ 3 per concept). **Rec: (a) then (b)**; never assume.
- **Q-AD56 · `locales` under EMPLOYMENT (us, sandbox).** Meta's page lists it neither way. (a) Prove on the sandbox;
  (b) else two ad sets by form language. **Rec: (a) then (b).**
- **Q-AD57 · The craft judge's agreement bar (owner).** The threshold at which the judge's ranking is trusted to
  order candidates: (a) 0.8 agreement with the owner's ratings on the 40; (b) 0.9; (c) no judge, show candidates
  unranked. **Rec: (a)** — R7's ~85 % is the realistic ceiling; the human still chooses.
- **Q-AD58 · The concept families (owner).** The closed lists for `concept.hook_family` and `scene_family` in CQ5.
  Proposed hooks: pay-first, life-first (home time), equipment-first, straight-talk (what you get / what we need),
  proof (real figures, real equipment). Scenes: cab POV, equipment on road, equipment at rest, home/street, abstract
  plate. (a) Take these; (b) edit. **Rec: (a)**, edited in the drawer later; they are data, not code.
  **Ruled (a), 2026-11-10, by the owner's delegation (§7.1)** — as closed lists in the contract, not drawer-edited
  data: the distinct-pair rule of Q-AD77 needs two presets' families to be comparable.
- **Q-AD59 · When performance may weight the draw (owner).** (a) After 50 leads per preset across the org; (b) after
  20; (c) recommendation only, never automatic. **Rec: (a)** — below that the noise outweighs the signal (R4's own
  caveat: cheap junk leads look like winners; use cost per *converted* lead from the outcome feed, not cost per lead).
- **Q-AD60 · Candidates per creative (owner, cost).** k=3 copies and 2 images ≈ 3× the tokens and 2× the credits of
  today's creative. (a) 3/2 as D-AD19; (b) 2/1 (copy only); (c) 5/3 for the first campaigns, then lower. **Rec: (a)**,
  as a setting with a ceiling of 5/3.
- **Q-AD68 · How the next concept enters a LIVE campaign (us; opened by CQ9a, 2026-11-10).** Compose runs only in
  `composing`, and `publishCampaign` makes a whole campaign; a retired ad's replacement needs both to work beside
  delivery. (a) A creative-level loop: the runner gains a `refresh` step for `live` campaigns that composes ONE
  creative for the next unstarted preset of the stored draw, puts it in review, and on approval publishes ONE ad into
  the existing ad set (`publishAds` already works per creative; the campaign's refs gain the new ad id) — no new
  campaign state, review shows "a new concept awaits approval" on a live campaign. (b) Pause the campaign and
  `regenerate` (today's path): the whole campaign leaves delivery for the minutes a person takes. (c) Retire only;
  a person starts a new campaign for the opening. **Rec: (a)** — it is what D-AD23 means and what R6 describes; it is
  2–3 PRs (runner step, incremental publish, review copy), after CQ9b.
- **Q-AD61 · Where the craft judge's rubric lives (us).** (a) A prompt pack in `workers/craftJudge/` like the others,
  rubric criteria as data in the kit (a carrier may add "never say 'family'"); (b) rubric fixed in code. **Rec: (a)**
  for the criteria's *weights and extras*; the five base criteria stay in the prompt pack so the baseline means one
  thing.

## 6. What this plan does not change

D-AD9 (no lettering from the image model; our renderer composites the figures), D-AD12 (three checks, a person
approves every ad), D-AD13 (ledgered, budgeted, idempotent), the guard, the kill switch, the claim check. The craft
judge is additive; candidates and pools multiply what passes those checks, they never bypass them.

## 7. Phase 1 — image direction and correctness (planned 2026-11-10)

**What this is.** The first phase of [`HANDOFF-2026-11-10-ADS-AGENTS-BUILD.md`](HANDOFF-2026-11-10-ADS-AGENTS-BUILD.md)
§4: steps AG1–AG6 of [`ADS-AGENTS-AUDIT-2026-11-10.md`](ADS-AGENTS-AUDIT-2026-11-10.md) §3, in the order that makes
the first real render a composed one. No vendor and no key is needed; everything is proven on the simulator and the
fakes, and nothing here is called production-ready before L4 (Q-AD73).

**Authority.** The owner's instruction for the handoff (2026-11-10): *"you are product manager and you should
analyze and make decisions that will be best solutions for us."* Every ruling below marked **PM** is made on that
delegation, on the date given, and the owner can overrule any of them.

### 7.1 Rulings this phase builds on

| Question | Ruling (PM, 2026-11-10) | Why |
|---|---|---|
| **Q-AD75** composed per format | Render and check only the formats the publisher sends (4:5, and 1:1 when the preset has it). 4:5 is the primary: the model is asked for that aspect. 1:1 is cut from it, anchored on the subject, not on the centre. 9:16 is neither rendered nor checked until Q-AD29 opens a placement for it. Two renders are revisited only if V4 shows the anchored crop loses the subject. | An unused 9:16 crop failing a good feed ad is a bug today. One render keeps credits flat; the feed image is what a driver sees. |
| **Q-AD76** judge of the finished ad | Build it; show its score and its one-line reasons to the reviewer; **no floor**. A floor is added only after its scores have been compared with the owner's approve/reject on 30 real ads. | A threshold set before that comparison is a number somebody picked. |
| **Q-AD77** starter presets | Five starter presets shipped as adoptable data; a carrier adopts them into its own versioned presets and edits them. Five distinct hook × scene pairs; a save refuses two live presets with the same pair. Nothing is auto-enabled. | An empty Campaigns tab that cannot compose is the first thing a new carrier meets, and distinct concepts are what Meta's delivery needs. |
| **Q-AD58** the concept families | **(a), the lists proposed in §5**: hooks pay-first, life-first, equipment-first, straight-talk, proof; scenes cab POV, equipment on road, equipment at rest, home/street, abstract plate. They are closed lists in the contract, so the distinct-pair rule compares like with like. | Q-AD77 cannot be built without them, and the proposal has stood unchallenged since 11/09. |

Decisions made while planning (D-AD24–D-AD28), each the smallest thing that keeps one fact in one place:

- **D-AD24 · The feed formats have one home, in shared.** `FEED_FORMATS` moves from the Meta publisher to
  `shared/ads/renderGeometry.ts` with a pure `publishedFormats(formats)` (the preset's formats the publisher will
  send, best first). The preset save, compose and the publisher all read it. A list restated in the save schema
  would drift the day Q-AD29 opens 9:16.
- **D-AD25 · A stored preset with no feed format stops compose before any model is asked.** The save refuses it
  (AG2); a preset saved before AG2 stops with `no_feed_format`, by name, before the copywriter spends a token.
  Today it is rendered, approved, then refused at publish.
- **D-AD26 · The copy that ships is chosen before the image is rendered.** Whether a headline fits is a fact about
  the text, the format and the layout, not about the picture. So the fit is measured first (no image, no vendor
  call), the first ranked candidate that fits every published format in both languages is chosen, and
  `candidates` records which one and why each earlier one was passed over. A contrast refusal is the image's and
  stays where it is. Falling back *after* the render would pay for a picture to learn something already known.
- **D-AD27 · A headline slot's ceiling is a shared figure pinned to the renderer.** The save schema lives in
  shared and cannot measure a font; the renderer lives in the API. So the ceiling is a constant in shared
  (`OVERLAY_HEADLINE_MAX_CHARS`), and an API test re-measures it with the real overlay and fails when it is no
  longer true. **Corrected the same day by measurement (P1-3):** this entry first defined the ceiling as two
  lines at the mean letter advance, which gives 50 (4:5) and 52 (1:1) and is wrong — 9 of 10 recorded headlines
  of 50–54 characters fit. Measured over the 360 headlines of the copywriter's fixtures that reach the layout
  step: 45 or fewer always fit, nothing over 56 fits, between them it depends on the words. **The ceiling is 56**,
  one number for every layout (the three layouts move the same stack). Under it, each candidate is judged by
  D-AD26, not refused at save.
- **D-AD28 · Where the picture stays quiet is derived from the layout, never asked.** The handoff's AG3 gives the
  art director an `empty_space` answer. The code already knows where the words go (`layout` and the text zone), and
  a model's answer could only agree or be wrong. So the prompt is *told* the quiet region in words, and the art
  director answers only what it alone decides: `focal_subject` and `camera_distance`, fixed vocabularies. The
  1:1 cut (AG4) is anchored on the side of the frame the layout leaves to the subject.

### 7.2 The steps

Each line is one PR (P1-1 and P1-2 went as one, #2185: both are a few lines over the same new function, and every
code PR waits for the owner's own merge), branched from `origin/main`, with its progress file in `ads-progress/`. None needs a
migration: the recipe and `ads_creatives.candidates` / `checks` are jsonb, and every new field is optional or
defaulted so a body stored before it still parses.

| Step | Track | What is built | Done when |
|---|---|---|---|
| **P1-1 · AG2 + D-AD24** | S | `FEED_FORMATS` and `publishedFormats` in shared; the publisher imports them. `adPresetSaveSchema` refuses a format set with no feed format, in the sentence the editor shows. The preset form says 9:16 is kept for Stories and not made yet. | Contract tests: 9:16-only refused with its sentence, 9:16 + 4:5 accepted; the publisher's tests unchanged and green; mutants named. |
| **P1-2 · Q-AD75 part one + D-AD25** | W | `composeCreative` frames, overlays, checks and stores `publishedFormats(recipe.formats)` only; a preset with none stops `no_feed_format` first. | Compose test: a visual failure planted on 9:16 only no longer fails the creative, and no 9:16 asset is stored; a 9:16-only stored preset stops before the copywriter is called. |
| **P1-3 · AG1 (D-AD26, D-AD27)** | W | `overlayFit` in `overlay.ts` (the layout step of `renderOverlay`, split out, no image); compose picks the first ranked candidate that fits; `adCandidatesSchema` gains optional `passed_over: [{ index, reason }]` and `chosen` becomes the real index; review shows "the judge's first choice did not fit the image: …". The shared ceiling (56, measured) and the test that re-measures it; the save refuses a headline slot above it. | Compose test: ranked[0] needs three lines, ranked[1] ships, the reason is on the row, and no render was asked for ranked[0]; all refused → stops with every reason; parity test red when a template size changes. |
| **P1-4 · AG3 (D-AD28)** | W | Art director v3: input gains layout, the quiet region in words, the published formats, the chosen headline; answer gains `focal_subject` and `camera_distance`; `composeImagePrompt` writes them and the quiet-region sentence. New `prompt.v3.md`, fixtures' versions bumped, re-recorded live until two runs agree. | Baseline recorded twice, both scores in the progress entry; a planted answer outside the vocabulary is refused. **Spends the owner's Anthropic key** — said in the PR before recording. |
| **P1-5 · AG4, Q-AD75 part two** | W | The render asks for 4:5 (the parameter name is the model's and is read from Higgsfield's documentation when V4 chooses one; on the simulator the request carries the aspect and FakeHiggsfield honours it); `frameStill` takes an anchor and the 1:1 cut keeps the subject's side. | Golden: a subject planted off-centre survives the 1:1 cut; the centre-crop mutant loses it. |
| **P1-6 · AG6 (Q-AD77, Q-AD58)** | S | Recipe gains optional `hook_family` and `scene_family` (closed lists); a NEW save requires them; the API save refuses a pair another live preset holds; `shared/ads/starterPresets.ts` holds five recipes (each parsed by `adPresetSaveSchema` in a test); `POST /api/ads/presets/adopt` writes version 1 of each key the carrier does not have, **disabled**; the empty Presets tab offers "Start from five ready-made presets". | Adopt twice writes five once; an adopted preset composes on the simulator; two live presets with one pair refused with both keys named. |
| **P1-7 · AG5 (Q-AD76)** | W | Worker `finishedAdJudge`: one vision call per published format on the composed English image; four criteria (subject legible, words and picture agree, hierarchy reads, looks like the kit), each 1–5 with one line; stored under `checks.finished_ad`; shown on review as a second opinion, never a gate. Registry row, readiness pins, launch-refusal words and `adsCertifyPlan` lines in the same PR. | Fixtures recorded twice; switched off or out of budget, the creative still reaches review and says the judge did not run. |

**Order and why.** P1-1 and P1-2 first: they are the bug (an image nobody uses fails an ad that is fine), small,
and every later step reads `publishedFormats`. P1-3 before P1-4 because the art director is to see the *chosen*
headline, and until P1-3 the chosen one may not be drawable. P1-6 is independent of the W steps and is what makes
the simulator walk in the handoff's §6 possible, so it may be built in parallel when a W step sits in CI.

**What Phase 1 does not do.** It chooses no image model (V4, Q-AD20), sets no quality floor (Q-AD76), does not let
the reviewer pick another candidate (AG7), and does not restyle the overlay (AG8). The simulator's picture is a
kit photo or a drawn road, so "composed" is proven as *the request carries the direction and the cut keeps the
subject*, not as a judgement of a real model's output.

## Sources (read 2026-11-09)

Meta, primary: [Asset Feed Spec](https://developers.facebook.com/docs/marketing-api/ad-creative/asset-feed-spec/) ·
[Asset Feed Options (limits)](https://developers.facebook.com/docs/marketing-api/ad-creative/asset-feed-spec/options/) ·
[Special Ad Categories](https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/special-ad-category) ·
[Insights API](https://developers.facebook.com/docs/marketing-api/insights/) ·
[Call lead ads: no dynamic creative](https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-calling).
Google, primary: [Responsive search ads](https://support.google.com/google-ads/answer/7684791) ·
[Ad Strength](https://support.google.com/google-ads/answer/9921843) ·
[Asset groups](https://support.google.com/google-ads/answer/10724748).
Andromeda and diversity (practitioner): [Confect](https://confect.io/tactics/meta-andromeda-2026) ·
[Chatterbuzz](https://www.chatterbuzzmedia.com/blog/meta-andromeda-creative-targeting/) ·
[Admove](https://www.admove.ai/blog/meta-andromeda-guide) ·
[AdScale 4–6 per ad set](https://adscale.com/blog/how-many-ad-creatives-per-ad-set/) ·
[Riffkit: what counts as a new ad](https://riffkit.ai/blog/meta-andromeda-creative-diversity).
Advantage+ creative: [Starti](https://starti.ai/news/meta-advantage-creative-enhancements-what-each-one-changes) ·
[AdsUploader](https://adsuploader.com/blog/advantage-plus-creative-enhancements) ·
[The Keyword: text rewrite on images](https://www.thekeyword.co/news/meta-advantage-creative-text-swap).
Fatigue: [adlibrary](https://adlibrary.com/posts/ad-fatigue) · [adsights](https://www.adsights.ai/blog/topics/creative-strategy/creative-fatigue-in-meta-ads-detection-and-management-strategies) ·
[datadrew](https://datadrew.io/blog/ad-creative-fatigue-signals/) · [succession.media](https://succession.media/guides/meta-creative-fatigue-how-many-creatives-to-test/) ·
[makometrics](https://makometrics.com/blog/creative-fatigue-meta-ads-detection-playbook) · [unrealmango: real vs invented thresholds](https://unrealmango.com/blog/ad-fatigue/).
Creative platforms: [Cometly testing platforms](https://www.cometly.com/post/ai-creative-testing-platform) ·
[Cometly variation generators](https://www.cometly.com/post/ai-ad-variation-generator) · [Entropik](https://www.entropik.io/resources/blog-articles/ai-creative-testing-platforms-2026) ·
[Newform](https://www.newform.com/guides/best-meta-ad-creative-testing-tools-2026) · [AdStellar](https://www.adstellar.ai/blog/best-ad-creative-testing-platforms).
Image pipelines: [Treza](https://www.trezalabs.com/blog/how-to-build-an-ai-image-generation-pipeline) ·
[Neurohive review system](https://neurohive.io/en/guides/brand-consistency-in-ai-image-generation-a-review-system-for-campaign-teams/) ·
[Market-IA brand kit](https://www.market-ia.fr/en/blog/ai-brand-kit-visual-identity-consistency-scale-2026) ·
[Astorie](https://astorie.ai/blog/brand-visual-consistency-with-ai) · [arXiv 2607.04691](https://arxiv.org/pdf/2607.04691).
LLM judges: [Braintrust HITL](https://www.braintrust.dev/articles/human-in-the-loop-evals-for-llm-apps) ·
[Braintrust judge vs human](https://www.braintrust.dev/articles/llm-as-a-judge-vs-human-in-the-loop-evals) ·
[Mastra](https://mastra.ai/articles/llm-as-a-judge) · [Adaline rubric](https://www.adaline.ai/docs/evaluate/llm-as-a-judge) ·
[FutureAGI](https://futureagi.com/blog/what-is-llm-judge-prompting-2026/) · [arXiv 2608.24314](https://arxiv.org/pdf/2608.24314).
Recruiting platforms: [Joveo guide](https://www.joveo.com/programmatic-job-advertising-the-ultimate-guide/) ·
[Adway social vendors](https://adway.ai/blog/best-programmatic-social-media-job-advertising-platforms-2026/) ·
[Guideflow](https://www.guideflow.com/blog/programmatic-job-advertising-software).
Practitioner sources are vendor or agency blogs; where two disagreed (ads per ad set), both numbers are given and the
smaller one is taken for our budgets.
