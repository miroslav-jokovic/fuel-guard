# Ads agent — the build workflow, step by step, with every gap and blocker named · 2026-11-01

**Status: PROPOSED 2026-11-01. Nothing built.** This is the executable companion to
`ADS-AGENT-PLAN.md` (v1–v5, #1864–#1868). The plan says *what* and *why*. This document says *in
which order, from which files, blocked by what, and how each step proves it is done*. Where the
two differ, this document is newer and says so (§1.2).

The owner's ask (2026-11-01): *plan the modules and the feature, generate a precise step-by-step
workflow for building it, assume nothing, and make sure there are no gaps and no blockers in the
plan.*

**How "assume nothing" is kept.** Every fact this workflow builds on is either **MEASURED** (read
on main `e18a545`, 2026-11-01, with its file) or **UNVERIFIED** with the step that verifies it
before anything depends on it (the V-steps, §4). There are no blockers *hidden* in the plan. Every
blocker is in the register (§3) with its owner, the step it blocks, and the fallback the build
takes if it is not cleared. "No blockers" is not something a plan can promise when three vendors
must say yes. What it can promise is that none is unnamed, and that nothing waits on one that
does not need to.

---

## 1. Ground truth

### 1.1 Measured on main (2026-11-01)

| # | Fact | Evidence | What it means for the build |
|---|---|---|---|
| M1 | Last migration is **0535**; a parallel chat (hiring workflow HW1–HW12) added 0533–0535 this weekend and has PR #1878 open | `supabase/migrations/`; `gh pr list` | Our migration number is checked **by name** at merge, never reserved (a parallel chat has taken a number before) |
| M2 | `recruiting` is one flat module of 118 files, and HW is editing it now | `apps/api/src/modules/recruiting/` | Ads gets **its own module** (D-AD17); recruiting gets only a small `leads/` folder, and only after HW merges |
| M3 | Job kinds are a TS union (`modules/org/jobs.ts:15`, 41 kinds); **no DB CHECK on `jobs.kind`** | `mig/0027_jobs.sql:8` | New kinds need no migration |
| M4 | **One active job per (org, kind) when `dedup_key` is null** | `mig/0095_jobs_queue.sql:21`; `0027:23` | Every per-campaign / per-creative job **must** carry `dedup_key` (= campaign or generation id) or the second campaign's job is refused |
| M5 | Vendor concurrency is `KIND_CAPS` in `apps/api/src/worker.ts:56` | file | Meta/TikTok/X/Higgsfield kinds pinned there |
| M6 | Schedulers: one registry `SCHEDULERS` with lanes + DB lease (31 entries; lanes `general`, `egress`) | `apps/api/src/schedulers.ts` | Hourly pulls go in the registry, never `setInterval` |
| M7 | `secretBox`: `seal(env, plaintext, aad)`, `open(...)`, `secretAad(orgId, purpose)`, `safeEqual` | `apps/api/src/lib/secretBox.ts:114,129,162,167` | All platform tokens and the Higgsfield key use it |
| M8 | `rawBody` is captured app-wide | `apps/api/src/appHttp.ts:136`; used by `routes/webhooks.ts:64` | Webhook HMAC can be verified over the raw bytes |
| M9 | Notification categories: contract **and** DB CHECK; last CHECK is `mig/0521:309` | file | New categories = one migration that restates 0521's list + ours |
| M10 | Permissions: sections × roles matrix (`APP_SECTIONS` incl. `recruitment`, view/manage) **plus** `ADMIN_ONLY_CAPABILITIES` (named, with a reason, held to routes by `routeGateLedger.test.ts`) | `packages/shared/src/auth.ts:76,139`; `packages/shared/src/namedGrants.ts` | "Who may approve spend" and "who may connect a platform" become **named admin-only capabilities** — no hand-written role list ([CLAUDE.md "No workarounds"]) |
| M11 | Upload byte-sniffing exists | `apps/api/src/modules/document-reading/pages/sniff.ts` | Brand-kit uploads reuse it |
| M12 | Image libs already installed: `sharp` 0.35, `@napi-rs/canvas` 1.0; `@anthropic-ai/sdk` 0.107; **no Remotion, no ffmpeg** in `apps/api/package.json` | file | Stills overlay needs no new dependency |
| M13 | **ffmpeg is in neither build**: production = `infra/image/Dockerfile` (node:22-bookworm-slim, AWS); staging = Railway Nixpacks (`railway.json`) | both files | Video overlay needs ffmpeg added to **both** builds (G9) |
| M14 | Production runs on AWS; staging still on Railway `uat` | AWS migration log (production retired from Railway 2026-10-28) | Webhook URLs differ per environment; both are registered |
| M15 | A public privacy page exists at `/privacy` | `apps/web/src/router/routes/legal.ts:24` | Meta and TikTok app review need a privacy-policy URL — we have one (V7 checks the wording covers ads data) |
| M16 | AI models pinned `haiku-4-5` / `sonnet-4-6`; `callClaude` hard-wired to the fuel tool | `packages/shared/src/ai.ts:11-12`; `apps/api/src/lib/anthropic.ts` | A1.4 generalises it; the pinned models accept forced tool use, so no API-shape change is needed until a model upgrade |
| M17 | Higgsfield on the Mac = CLI with a **personal OAuth (PKCE) token** + plan credits | `~/.config/higgsfield/credentials.json` keys only | Production needs an API key (O2, Q-AD20) |

### 1.2 Corrections to ADS-AGENT-PLAN.md (this document wins)

1. **Remotion is not reused in production.** Remotion needs a paid **Company License** for a
   for-profit company with more than three employees ($100/month minimum for server rendering).
   Stills are composited with `@napi-rs/canvas` + `sharp` (already installed, M12). Video overlay
   uses ffmpeg (G9). Remotion stays a tool for the separate film project. *(Plan §2c said "reuse
   Remotion".)*
2. **Ads is its own module, `apps/api/src/modules/ads/`, not a folder inside recruiting** (D-AD17
   below). The plan placed it under `recruiting/ads/`.
3. **Meta "Connect" is a system-user token, and leads use a Page token derived from it.** A
   user or system-user token alone cannot read a Page's leads; the leadgen subscription needs a
   Page token with `leads_retrieval` + `pages_manage_metadata`, and the business's Leads Access
   Manager must grant our app.
4. **Every per-object job carries a `dedup_key`** (M4). Without it, the second campaign of an org
   waits behind the first.

### 1.3 New decision

- **D-AD17 · Two modules and one seam.** `modules/ads/` is industry-neutral. It owns platforms,
  campaigns, creatives, spend, rules, outcome feeds and the orchestrator, and knows nothing about
  drivers. `modules/recruiting/leads/` owns leads, `leadMatch` and conversion to an applicant. The
  seam is two interfaces in `packages/shared/src/ads/`:
  - `AdBriefSource` — recruiting supplies an opening as a brief (facts, allowed claims, area,
    form questions);
  - `LeadSink` — ads hands each platform lead to recruiting and receives stage changes back
    for the outcome feed.

  The owner's point that "this is used in every industry" is honoured in code: a second brief
  source (a fuel-card offer, a customer campaign) would plug into the same module.
  `lint:boundaries` already forbids reaching into another feature's internals.

---

## 2. The modules (what each folder owns)

```
packages/shared/src/ads/            pure: contracts, policy, folds, state machine (no I/O, no clock)
  contracts.ts        brief, campaign, creative, preset, brandKit, platform adapter interface
  campaignMachine.ts  the orchestrator's states + allowed transitions (pure)
  adsPolicy.ts        caps, raise limits, authority table (D-AD2/D-AD3)
  adClaims.ts         copy claim check (D-AD1)        renderGeometry.ts  safe zones, contrast
  presetDraw.ts       seeded fair draw (D-AD11)       naming.ts          S360_… taxonomy
  adsReport.ts        spend/lead/cohort fold (D-AD5)  rulesSpec.ts       settings → rule specs
packages/shared/src/recruiting/leads/   leadContract.ts, leadMatch.ts, hiringProfile.ts, opening.ts
apps/api/src/modules/ads/
  index.ts            the module's only public surface
  orchestrator/       state-machine runner, job kinds, handlers (D-AD16)
  workers/            brief/, copywriter/, artDirector/, renderer/, checker/, monitor/, analyst/
  platforms/          adapter.ts (interface) · meta/ · tiktok/ · x/  (one folder per platform)
  guard/              budgetGuard.ts, killSwitch.ts, approvals.ts   ← the only path to spend calls
  creative/           higgsfield/ client, overlay/ (canvas + ffmpeg), storage
  leads/              webhooks + backfills → LeadSink
  outcomes/           Conversions API (and TikTok Events API later)
  settings/           versioned settings, connections (sealed tokens)
  routes/
apps/api/src/modules/recruiting/leads/   ledger writes, queue reads, convert_lead, AdBriefSource impl
apps/web/src/features/ads/               settings, brand kit + presets, campaign flow, review
apps/web/src/features/recruitment/leads/ the leads queue
```

---

## 3. Gap and blocker register

Type: **O** = owner input · **V** = vendor access · **C** = code gap · **L** = legal/counsel ·
**U** = unverified fact. "Blocks" names the first step that cannot finish without it; everything
else proceeds.

| ID | Item | Type | Who | Blocks | Fallback if not cleared | Status |
|---|---|---|---|---|---|---|
| G1 | Meta: Business Manager owns the ad account + Page; payment method; **account spending limit set**; Business app with Marketing API + Lead Ads + Webhooks; app **Live** (privacy URL = `/privacy`); admin system user assigned to account, Page and app; token with `ads_management, ads_read, leads_retrieval, pages_manage_metadata, pages_read_engagement, pages_show_list`; Leads Access Manager grants the app; a **sandbox ad account** | O+V | owner (we write the click-path, O1) | B-live steps (B2–B6 live checks) | built and tested against recorded fixtures; **no production launch** | open |
| G2 | Higgsfield **API** account, prepaid balance, key (ID+secret) | O | owner | C3 live, C6 | creative studio runs on recorded responses; the "Generate" button is hidden | open (Q-AD20) |
| G3 | Brand kit: vector logo, colours, company name as printed, phone, 5–10 real photos of our tractors and trailers | O | owner | C4 final look, C6 | no logo overlay; equipment drawn generically; P4 disabled | open (Q-AD14) |
| G4 | First opening: pay basis + range, home time, equipment, lanes, yard + radius + reason | O | owner | first real campaign (G-launch) | nothing launches — by design (D-AD1) | open (Q-AD9) |
| G5 | Spending values: monthly cap, daily max per campaign, max raise per approval, rule thresholds | O | owner | first launch | the settings ship with the benchmark defaults **disabled**; Launch refuses until an admin saves values | open |
| G6 | Approve/edit presets P1–P5 | O | owner | first creative | P2 + P5 only | open (Q-AD12) |
| G7 | TikTok: for Business account, Business Center, ad account, developer registration, app (Marketing API scopes, no "TikTok Accounts" scope) — review 2–3 business days | O+V | owner, then TikTok | H1 | TikTok waits; nothing else does | open |
| G8 | X: Ads account, developer app, Ads API access via an X representative | O+V | owner, then X | H2 | X waits | open |
| G9 | **ffmpeg** absent in both builds | C | us | C6 | video ships later; stills unaffected | **planned in C6.1** |
| G10 | Remotion license | C | us | — | **resolved by §1.2-1** (not used) | closed |
| G11 | Parallel HW program editing `recruiting` | C | us | D1 (touches `useCreateApplicant`/conversion) | D1 starts after HW's last merge; everything else is in `modules/ads` and does not collide | open (watch #1878) |
| G12 | Counsel: Instant Form questions + age wording + images policy (Q-AD8) | L | owner → counsel | none for stills **if** the fallback form is used | form asks only: Class A (yes/no), years of Class A, hazmat (yes/no); the ad states "must be 23+"; no people in generated images | open |
| G13 | Tenstreet API activation + schema (Q-AD4) | V | owner → Tenstreet | D4 switch-on | listener built, switch off | open |
| G14 | Indeed Job Sync approval (Q-AD5) | V | owner → Indeed | posting via API | Indeed posts stay manual | open |
| G15 | M365 mailbox `jobs@` for Indeed emails (Q-AD6) | O | owner | D3 | paste box | open |
| G16 | Current Meta spend baseline (Q-AD16) | O | owner | §8 comparison only | baseline = none | open |
| G17 | Budget vs Meta volume floors (Q-AD18) | O | owner | B6 optimisation switch only | plain lead goal | open |
| G18 | Organic posting (Q-AD19) | O | owner | — | not in this build | open |
| U1 | Sandbox ad account accepts `EMPLOYMENT` campaigns, Instant Forms and `spend_cap` | U | us | B2 design | if not: B2 tests the request builder only, and the first real campaign is created paused in production for a dry check | **V1** |
| U2 | Automated Rule PAUSE with a spend condition works (error 2703 reported) | U | us | B3 | our hourly guard is the only enforcer for spend conditions; Meta rules used only for CPL/frequency | **V2** |
| U3 | Conversion Leads offered under EMPLOYMENT | U | us | B6 switch | feed still runs; switch hidden | **V3** |
| U4 | Higgsfield API offers the models we use (image: `gpt_image_2_5`; video: `seedance_2_5`), image-to-image/video from a reference, a completion webhook | U | us | C3 | the closest documented API model; polling instead of webhook | **V4** (needs G2) |
| U5 | TikTok lead retrieval (API pull; webhook?) | U | us | H1 | hourly pull only | **V5** (needs G7) |
| U6 | Meta's own Help Center wording on employment Instant Form questions (our source is third-party) | U | us | C2 form questions | the G12 fallback form | **V6** |
| U7 | `/privacy` covers ads/lead data adequately for Meta and TikTok review | U/L | us → owner | G1, G7 app review | owner amends the page before review | **V7** |

---

## 4. The workflow

Each step has the same fields. **One step = one PR** unless marked "with". Every PR: branch from
`origin/main`, run the full gate set and check `$?`, the four
template headings, the mutation that went red, CI green, merged by hand, staging verified
(`pnpm verify:live staging`).

### Phase V — verify before building on it (day 1, parallel, no merge needed)

| Step | What | Needs | Done when |
|---|---|---|---|
| **V1** | Sandbox: create an EMPLOYMENT campaign + ad set (15-mi radius) + Instant Form + ad with `spend_cap`, all PAUSED, through raw Graph calls from a script in the scratchpad | G1 sandbox | Each object id recorded, or the exact refusal recorded in the plan |
| **V2** | Sandbox: create an `adrules_library` PAUSE rule with `spent > X AND leads = 0`; then a CPL rule | G1 sandbox | Accepted, or error 2703 recorded → U2 fallback |
| **V3** | Sandbox: list optimisation goals offered for an EMPLOYMENT lead campaign | G1 sandbox | Conversion Leads present / absent recorded |
| **V4** | Higgsfield API: list models; one still + one image-to-video from a reference; webhook delivery | G2 | Model ids, cost per call, latency, webhook payload recorded |
| **V5** | TikTok sandbox/test account: lead form create + lead read | G7 | Recorded |
| **V6** | Read Meta Business Help Center pages on prohibited Instant Form questions and employment audiences | — | Quoted with URL in the plan |
| **V7** | Read `/privacy`; list what Meta/TikTok review needs that it lacks | — | Gap list to the owner, or "adequate" |

### Phase A — foundation (no vendor needed; starts day 1)

| Step | What | Files | Blocked by | Done when |
|---|---|---|---|---|
| **A1** docs | D-AD17 recorded; `docs/ARCHITECTURE.md` module row `ads` + table ownership; `docs/WORKER-DEPLOYMENT.md` lists the new schedulers' lane | docs | — | Merged |
| **A2** migration | All tables (plan §4.1 + v2/v4 additions): `ads_platform_connections` (sealed), `ads_campaigns`, `ads_creatives`, `ad_generations` (append-only), `ads_actions` (append-only), `ads_spend_hourly`, `ads_settings_versions`, `ad_brand_kits(+versions)`, `ad_concept_presets(+versions)`, `ads_outcome_events` (append-only), `recruiting_openings(+versions)`, `hiring_profiles(+versions)`, `recruiting_leads`, `recruiting_contacts` (append-only), `lead_match_verdicts`, `lead_conversions`, `recruiting_ai_outputs`; notification CHECK = 0521's list + 8 categories; RLS on, service-role only, `forbid_org_change()`; matrix `supabase/tests/ads_append_only.test.mjs` | `supabase/migrations/05xx_ads_foundation.sql`, `scripts/table-modules.json`, retention registry | — | `check-rls`, `lint:migrations`, `lint:table-modules`, `lint:table-lifecycle` green; matrix prints `RESULT` and refuses UPDATE/DELETE on the four ledgers |
| **A3** shared | `packages/shared/src/ads/*` + `recruiting/leads/*` (§2) with boundary tests: caps at −1/0/+1, raise limit, claim check (planted figure fails), presetDraw reproducible from seed and never repeats a live preset, naming round-trip, `campaignMachine` rejects every illegal transition, `leadMatch` edges (22/23 y, 23/24 months, each look-back), cohort fold greys young cohorts | shared | A2 (types only) | `pnpm test` + `lint:boundaries` + `lint:shared-contracts` green |
| **A4** AI rail | `callClaude` takes the tool schema as an argument (fuel caller passes its own); generic `aiInputHash`; provenance writer to `recruiting_ai_outputs`; per-agent switch + monthly budget (`withinBudget`) | `apps/api/src/lib/anthropic.ts`, `shared/ai.ts` | — | Fuel tests unchanged and green; a budget-exhausted call records `budget_exhausted` |
| **A5** guard | `ADMIN_ONLY_CAPABILITIES` += `ads.connection`, `ads.spend` (with reasons); `budgetGuard` (the only exported path to adapter spend methods — enforced by a test that greps adapter imports), kill switch, approvals service, settings-versions API | `namedGrants.ts`, `modules/ads/guard/*`, `settings/*` | A2, A3 | `routeGateLedger.test.ts` green both ways; cap+1 refused; kill switch blocks a launch in a test |
| **A6** orchestrator spine | Runner for `campaignMachine`: job kinds `ads_step` with `dedup_key` = campaign id + state (M4), `KIND_CAPS` entries, leased scheduler `ads-orchestrator` (lane `egress`), failure → terminal state visible | `modules/ads/orchestrator/*`, `worker.ts`, `schedulers.ts`, `jobs.ts` | A3, A5 | Two campaigns in one org advance concurrently (test); a crashed step resumes once (at-least-once + idempotent) |

### Phase B — Meta adapter (build on fixtures from day 2; live checks need G1)

| Step | What | Blocked by | Done when |
|---|---|---|---|
| **B1** | Adapter interface + Meta client: Graph version in one constant, `x-business-use-case-usage` respected, retries only on transient codes, every call wrapped by `ads_actions` before/after; Connect = admin pastes the system-user token once (sealed), we derive and seal the Page token, and run a **connection test** (account, Page, spending limit, permissions) shown in Settings | A5, V1 | Recorded-fixture tests; on staging the sandbox connects and the test lists every permission |
| **B2** | Create paused: campaign (`special_ad_categories=[EMPLOYMENT]`, country US, `spend_cap`), ad set (radius ≥ 15 mi, no age/gender fields exist in the builder), Instant Form (questions from `metaLeadForm`, privacy URL), creative, ad; names from `naming.ts` | B1, V1, V6 | Sandbox objects created PAUSED with the right fields (read back and compared) |
| **B3** | Launch / pause / budget through approvals + guard; settings → Meta Automated Rules (`rulesSpec`), kept in sync on every settings save | B2, V2 | Launch without an approval row refused; settings change rewrites the rules (read back) |
| **B4** | Leads: webhook GET verify + POST HMAC (`X-Hub-Signature-256`, raw body M8, constant-time), Page subscribed to `leadgen`, fetch lead by id with the Page token, **hourly backfill** per live form, → `LeadSink` | B1 | Lead Ads Testing Tool lead arrives once via webhook; with the webhook disabled, the backfill brings it within the hour; a forged body → 401 + counter |
| **B5** | Monitor: hourly insights → `ads_spend_hourly`; daily reconcile; `external_change` detection; our auto-pause rules; fatigue from Meta delivery flags | B3 | Forced overspend in a test → pause + alert; an Ads-Manager edit in sandbox → `external_change` |
| **B6** | Outcome feed: Conversions API events per stage (`event_id` = stage row id), daily batch; optimisation switch shown only if V3 says yes | B4, D1 | Events accepted in sandbox (Events Manager test code); replay does not double-send |

### Phase C — creative studio (fixtures from day 2; live needs G2, G3)

| Step | What | Blocked by | Done when |
|---|---|---|---|
| **C1** | Brand kit + presets API: versioned, uploads through `sniff.ts`, SVG rasterised, assets by sha256 | A2 | Uploading a `.png` that is a PDF is refused |
| **C2** | Copywriter + Art director prompt packs (`modules/ads/workers/*/prompt.v1.md` + schema + fixtures); **new gate `lint:agent-fixtures` added to `ci.yml` `gates` in the same PR** | A4, V6 | Fixture agreement recorded as the baseline; a planted invented figure fails the claim check |
| **C3** | Higgsfield client: API key sealed; `Idempotency-Key` = generation id; webhook (verified) or poll; copy output to our storage at once (7-day expiry); credit budget checked before submit; `KIND_CAPS` 1 | A5, V4 | A replayed generation spends nothing; an expired URL never reaches the UI |
| **C4** | Overlay renderer (stills): canvas templates per format (1:1, 4:5, 9:16), text from the brief only, safe-zone + contrast measured over the text's zone | C1, A3 | Golden-image tests per format; a too-long line refuses rather than overflows |
| **C5** | Checker: copy (pure) + visual (Claude vision checklist from the brand kit) + render (pure); one regeneration then stop | C2, C4 | Planted glyph image fails; planted foreign logo fails; second failure stops with the reason |
| **C6** | Video: **C6.1** ffmpeg added to `infra/image/Dockerfile` (apt) and to staging's Nixpacks (`nixpacks.toml` `aptPkgs`), with a boot check that disables video (not the worker) if absent; **C6.2** image-to-video from the reference + ffmpeg overlay + frame-sampled visual check | C3, C5, G9 | `ffmpeg -version` in both deploys' logs; a 9:16 creative passes on sampled frames |

### Phase D — leads into recruiting

| Step | What | Blocked by | Done when |
|---|---|---|---|
| **D1** | `recruiting/leads`: `ingest_lead` RPC (UPDATE-or-INSERT, never partial upsert), dedupe (E.164 phone / lower email vs leads, applicants, drivers), `leadMatch` verdicts, queue read (paged, org-scoped), `convert_lead` → applicant + `lead_conversions` | A2, A3, **G11** | A lead created via webhook, paste and API shows once; convert carries attribution |
| **D2** | `lead_new` instant notify to the assigned recruiter; `lead_uncontacted` escalation; webhook-to-ledger latency metric (alert > 5 min) | D1 | Latency measured on staging; escalation fires at the threshold |
| **D3** | Indeed mailbox (Graph, existing `graphMail.ts`): raw stored, extractor → `proposed` lead, recruiter confirms | D1, G15 | One real Indeed email → one proposed lead |
| **D4** | Tenstreet listener: accept/reject protocol, raw stored, switch **off** | D1 | Contract test against Tenstreet's published protocol; switch-on waits G13 |

### Phase E — screens (`apps/web/src/features/ads/`; `docs/DESIGN-SYSTEM-CONTRACT.md` first; `packages/ui` only)

| Step | What | Blocked by | Done when |
|---|---|---|---|
| **E1** | Settings → Ads control: limits, rules, approvals, AI/render budgets, alerts, kill switch, platform connections + connection test, live spend vs caps (from the fold) | A5, B1 | Browser pass on 3 fixtures (fail/empty/staging) |
| **E2** | Brand kit + preset editors (versioned; "saving creates v2") | C1 | Same |
| **E3** | Campaign flow: pick opening → generate → **review screen** (every format, three checks, Approve / Regenerate / Edit copy) → Create paused → Launch (admin) | A6, B2, C5 | A recruiter reaches a paused sandbox campaign in four clicks; an admin launches it |
| **E4** | Leads queue + lead drawer (source beside fields, verdicts with *why*, Contacted, Convert) | D1 | Same |
| **E5** | Failed-jobs page (reads `GET /api/org/jobs/failed`) | — | A forced failure is listed |

### Phase F — analyst

| Step | What | Blocked by | Done when |
|---|---|---|---|
| **F1** | Daily brief + cohort report: fold numbers, Claude narration checked by the claim checker; per preset hook/hold rate for video | B5, D1 | A planted number in the narration is refused |

### Phase G — prove it and ship it

| Step | What | Done when |
|---|---|---|
| **G-walk** | Staging walk script (in the PR body of the release): connect sandbox → set limits → upload brand kit → generate → review → create paused → launch → test lead → queue → convert → kill switch → reconcile | Every line ticked by the owner |
| **G-sec** | `/security-review` on A5, B1, B4, C3; secrets never in logs (grep of a staging log); tokens never in API responses (test) | No open finding |
| **G-runbook** | `docs/plans/recruitment/ADS-RUNBOOK.md`: kill switch, token rotation, a platform outage, a refused ad, rolling back a release with live campaigns (campaigns are paused before a rollback) | Merged |
| **G-launch** | Production: owner connects the real accounts, saves limits (G5), approves presets (G6), creates the first opening (G4), launches at a small budget | First real lead reaches a recruiter; next morning's brief arrives; reconcile shows zero unexplained |

### Phase H — further platforms (each is an adapter + its V-step)

| Step | What | Blocked by |
|---|---|---|
| **H1** | TikTok adapter: OAuth Connect, HEC toggle, Instant Form, lead pull, Events API outcomes | G7, V5 |
| **H2** | X adapter: after Q-AD21 research to the same standard as Meta and TikTok | G8 |
| **H3** | Indeed Job Sync posting | G14 |

---

## 5. Critical path and calendar (if the Day-0 inputs arrive by Tuesday 11/03)

Releases run Sunday–Thursday nights at 01:07 CT, on the owner's approval. Merges reach staging in
minutes on any day.

| Day | Build (merges) | Owner / vendors (parallel) |
|---|---|---|
| **Sun 11/01** | this workflow · V6, V7 | O1 Meta setup (click-path in §6) · G2 Higgsfield API key · G7 TikTok app · G8 X contact · Tenstreet/Indeed emails |
| **Mon 11/02** | A1, A2, A3 (release Mon night → schema in production) | G3 brand kit, G4 first opening, G5 values, G6 presets |
| **Tue 11/03** | A4, A5, A6 · V1–V4 as soon as G1/G2 exist | |
| **Wed 11/04** | B1, B2, C1, C3 | |
| **Thu 11/05** | B3, B4, C2, C4 | |
| **Fri 11/06** | B5, C5, D1 (if HW merged), E1 | |
| **Sat 11/07** | E2, E3, E4, D2, E5, F1 · G-walk on staging | |
| **Sun 11/08** | G-sec fixes, G-runbook · **release Sun night** | owner's staging walk |
| **Mon 11/09** | **G-launch: Meta stills in production** | |
| **Tue 11/10** | C6 video, B6 outcome feed, D3 mailbox · release Tue night | |
| **Wed 11/11** | Video live | |
| **from ~11/05** | H1 TikTok the day after its app is approved | |

**What moves the date, plainly:** every Day-0 input not in by Tuesday moves the step it blocks by
the same number of days. G1 (Meta) moves the whole launch; G2/G3 move creative; G4/G5 move only
the launch itself. A release the owner does not approve moves everything a day. A step that fails
its *done when* is not merged. **11/09 is a target with these conditions, not a promise.**

---

## 6. Day-0 click-path for the owner (Meta, the one that gates the launch)

1. business.facebook.com → Business settings: confirm the Page and the ad account belong to the
   company's Business; add the payment method.
2. Ad account → Payment settings → **Account spending limit**: set it to the monthly cap you will
   enter in our Settings (or lower).
3. developers.facebook.com → Create app → type **Business** → connect it to the Business. Add the
   **Marketing API**, **Webhooks** and the **Lead Ads / leads retrieval** use case. Set the
   privacy-policy URL to the production web host's `/privacy` page (V7 confirms the exact URL and wording first) and publish the app (Live).
4. Business settings → Users → **System users** → add an **Admin** system user; assign it the
   Page, the ad account (manage) and the app. Generate a token for the app with:
   `ads_management, ads_read, leads_retrieval, pages_manage_metadata, pages_read_engagement,
   pages_show_list`. **Keep it for the Connect screen; do not send it to anyone, including in chat.**
5. Business settings → Integrations → **Leads access** → give the app access to the Page's leads.
6. Marketing API → Tools → create a **sandbox ad account** (for staging).
7. Tell me "Meta ready" (not the token). The Connect screen (B1) takes the token and runs the
   connection test.

---

## 7. Questions still open (everything else is ruled)

Q-AD1 is resolved by v5 (four platforms, Meta first). Still owed: **Q-AD4** Tenstreet ·
**Q-AD5** Indeed · **Q-AD6** mailbox · **Q-AD8** counsel (fallback defined, G12) · **Q-AD9**
first opening · **Q-AD12** presets · **Q-AD13** real drivers · **Q-AD14** brand kit · **Q-AD16**
baseline · **Q-AD18** budget vs floors · **Q-AD19** organic · **Q-AD20** Higgsfield key ·
**Q-AD21** X · **Q-AD22** platform order. Each has its fallback in `ADS-AGENT-PLAN.md` §9 and its
blocking step in §3 above.

---

## Sources (read 2026-11-01)

[Remotion license](https://www.remotion.dev/) · [Remotion pricing 2026](https://www.wireflow.ai/blog/remotion-pricing) ·
[Meta Lead Ads webhooks](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/quickstart/webhooks-integration) ·
[Lead ads webhook connected but silent (Kredoo)](https://blog.kredoo.in/meta-lead-ads-webhook-connected-but-silent/) ·
[Meta Special Ad Categories](https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/special-ad-category) ·
[Graph and Marketing API v24](https://developers.facebook.com/blog/post/2025/10/08/introducing-graph-api-v24-and-marketing-api-v24/) ·
[Meta Ads connector fields (Prismatic)](https://prismatic.io/docs/components/facebook-marketing/)
— plus every source listed in `ADS-AGENT-PLAN.md`.

---

## Progress log

- **2026-11-01** — Workflow written. Measured on main: last migration 0535 (parallel HW
  program); no DB CHECK on `jobs.kind` but one active job per (org, kind) without `dedup_key`;
  `rawBody` captured; `ADMIN_ONLY_CAPABILITIES` is the home for spend/connection rights; `sharp` +
  `@napi-rs/canvas` installed; no ffmpeg in either build; `/privacy` exists. Corrections to the
  plan: Remotion dropped (company license), ads becomes its own module (D-AD17), Meta leads need a
  Page token derived from the system user. 18 gaps/blockers + 7 unverified facts registered, each
  with its blocking step and fallback; 7 verification steps run before anything depends on them.
  **Nothing built.**
