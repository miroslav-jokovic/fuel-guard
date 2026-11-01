# Ads agent — the build workflow, step by step, with every gap and blocker named · 2026-11-01

**Status: PROPOSED 2026-11-01; v2 the same day: agents first, credentials last, a readiness suite (§4R) gates every real case. Nothing built.** This is the executable companion to
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
5. **(A1, 2026-11-01) `ads_approvals` is added to A2.** A5's "launch without an approval row is
   refused" needs a row to look for, and A2's list had no table for it. Append-only: an approval
   is evidence of who allowed which spend; a withdrawal is a new row.
6. **(A1) The ads module's AI provenance is `ad_generations`, not `recruiting_ai_outputs`.** A4
   said the provenance writer writes `recruiting_ai_outputs`; under D-AD17 `ads` may not write a
   recruiting table (D-ARC3). The generic rail takes its provenance writer from the caller.
7. **(A1) The ads schedulers run in the `general` lane, not `egress`.** `egress` exists for the
   one host WEX allowlists (`schedulers.ts`: the SOAP poller, card sync, mTLS watcher, EFS
   re-fetch); FleetPal and Med-Stop, which also call vendors, are `general`. Meta, TikTok, X and
   Higgsfield check no caller address. Recorded in `docs/WORKER-DEPLOYMENT.md`.
8. **(A1) There is no `APP_ENVIRONMENT` variable.** The handoff and §4R named one; measured, the
   environment name is `RAILWAY_ENVIRONMENT_NAME ?? DEPLOY_ENVIRONMENT`
   (`apps/api/src/lib/schedulerLease.ts:234`; AWS sets `DEPLOY_ENVIRONMENT` from
   `infra/server/<env>.env`). Step 7 moves that expression into one helper and the simulator
   guard reads it, failing closed: allowed only for a known non-production name, or with both
   unset and `NODE_ENV` ≠ `production`.
9. **(A2, 2026-11-01) A2 creates the ads tables only; the recruiting tables move to a new step
   D0.** `lead_conversions` references a `drivers` row, and a drivers-referencing table that
   `purge_applicant` does not own makes every purge of that applicant refuse (PA011, 0535) and a
   roster merge lose it (the merge-driver cascade trap). Adding them therefore means editing
   recruiting's purge and merge list — recruiting work, in a module the HW program was editing.
   Under D-AD17 no ads table references a recruiting one, so nothing in A2–C5 waits for D0.

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
| **A2** migration | All tables (plan §4.1 + v2/v4 additions): `ads_platform_connections` (sealed), `ads_campaigns`, `ads_creatives`, `ad_generations` (append-only), `ads_actions` (append-only), `ads_spend_hourly`, `ads_settings_versions`, `ad_brand_kits(+versions)`, `ad_concept_presets(+versions)`, `ads_outcome_events` (append-only), `ads_approvals` (append-only; §1.2-5), `recruiting_openings(+versions)`, `hiring_profiles(+versions)`, `recruiting_leads`, `recruiting_contacts` (append-only), `lead_match_verdicts`, `lead_conversions`, `recruiting_ai_outputs`; notification CHECK = 0521's list + 8 categories; RLS on, service-role only, `forbid_org_change()`; matrix `supabase/tests/ads_append_only.test.mjs` | `supabase/migrations/05xx_ads_foundation.sql`, `scripts/table-modules.json`, retention registry | — | `check-rls`, `lint:migrations`, `lint:table-modules`, `lint:table-lifecycle` green; matrix prints `RESULT` and refuses UPDATE/DELETE on the five ledgers |
| **A3** shared | `packages/shared/src/ads/*` + `recruiting/leads/*` (§2) with boundary tests: caps at −1/0/+1, raise limit, claim check (planted figure fails), presetDraw reproducible from seed and never repeats a live preset, naming round-trip, `campaignMachine` rejects every illegal transition, `leadMatch` edges (22/23 y, 23/24 months, each look-back), cohort fold greys young cohorts | shared | A2 (types only) | `pnpm test` + `lint:boundaries` + `lint:shared-contracts` green |
| **A4** AI rail | `callClaude` takes the tool schema as an argument (fuel caller passes its own); generic `aiInputHash`; provenance writer passed in by the caller (ads → `ad_generations`, recruiting → `recruiting_ai_outputs`; §1.2-6); per-agent switch + monthly budget (`withinBudget`) | `apps/api/src/lib/anthropic.ts`, `shared/ai.ts` | — | Fuel tests unchanged and green; a budget-exhausted call records `budget_exhausted` |
| **A5** guard | `ADMIN_ONLY_CAPABILITIES` += `ads.connection`, `ads.spend` (with reasons); `budgetGuard` (the only exported path to adapter spend methods — enforced by a test that greps adapter imports), kill switch, approvals service, settings-versions API | `namedGrants.ts`, `modules/ads/guard/*`, `settings/*` | A2, A3 | `routeGateLedger.test.ts` green both ways; cap+1 refused; kill switch blocks a launch in a test |
| **A6** orchestrator spine | Runner for `campaignMachine`: job kinds `ads_step` with `dedup_key` = campaign id + state (M4), `KIND_CAPS` entries, leased scheduler `ads-orchestrator` (lane `general`; §1.2-7), failure → terminal state visible | `modules/ads/orchestrator/*`, `worker.ts`, `schedulers.ts`, `jobs.ts` | A3, A5 | Two campaigns in one org advance concurrently (test); a crashed step resumes once (at-least-once + idempotent) |

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
| **D0** | Recruiting's migration (§1.2-9): `hiring_profiles(+versions)`, `recruiting_openings(+versions)`, `recruiting_leads`, `recruiting_contacts` (append-only), `lead_match_verdicts`, `lead_conversions`, `recruiting_ai_outputs`; `purge_applicant` and the roster merge list (`DRIVER_REASSIGNMENTS`) updated in the same PR; the driver-references check in `lint:migrations` green | A2, **G11** | Matrix: an applicant with a lead conversion is purged whole, and a merge moves it |
| **D1** | `recruiting/leads`: `ingest_lead` RPC (UPDATE-or-INSERT, never partial upsert), dedupe (E.164 phone / lower email vs leads, applicants, drivers), `leadMatch` verdicts, queue read (paged, org-scoped), `convert_lead` → applicant + `lead_conversions` | D0, A3 | A lead created via webhook, paste and API shows once; convert carries attribution |
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

## 4R. Agents first, credentials last — and a readiness suite before any real case (v2, owner 2026-11-01)

The owner, 2026-11-01: *build the agents first and add the social-network credentials after;
we want tests that make sure each agent and the orchestrator are production ready before we
test in a real situation.* **Agreed. The code already allows it:** only the four platform
adapters and the Higgsfield client need a vendor credential. Everything else (the orchestrator,
the Brief, Copywriter, Art director, Checker, Budget guard, Monitor, Lead intake, Outcome feed and
Analyst workers, the settings, the screens) is built and proven against fakes. The Anthropic key
the API already uses is enough for the Claude workers' evaluations.

**What "100 % production ready" can honestly mean.** No test suite can prove how Meta or TikTok
will behave tomorrow. What this suite proves:
- every rule we wrote holds, and each test has been shown to fail when its rule is broken
  (mutation);
- every failure we can name has been injected and survived: vendor errors, crashes, double
  delivery, an expired token, the kill switch;
- every fake we test against matches the real vendor. The *same* contract tests run against the
  real sandbox the day the credentials arrive, so a fake built on a misreading of the docs is
  caught there, not in production.

The first real campaign is then still created paused and launched by a person under a small cap.
That is "production ready" with the residual risk named, not hidden.

### The readiness levels (every worker and the orchestrator climb them in order)

| Level | Name | What proves it | Needs credentials? |
|---|---|---|---|
| **L1** | Unit-proven | Contract + boundary tests; each guard's mutation listed in its PR and shown red | no |
| **L2** | Fault-proven | Runs against the fakes with injected failures (table below); no double spend, no lost lead, no silent failure | no |
| **L3** | Scenario-proven | Golden scenarios (orchestrator) / evaluation set at its threshold (Claude workers) | no (Claude workers use the existing Anthropic key) |
| **L4** | Sandbox-certified | The **same** contract suite re-run with `ADS_TARGET=sandbox` against Meta's sandbox ad account, TikTok's test account and a small Higgsfield API budget; every recorded fixture re-recorded and diffed | **yes — this is where credentials enter** |
| **L5** | Canary | One real campaign, small cap, created paused, launched by the owner; 72 h with zero unexplained reconcile rows | yes |

**The gate:** `lint:ads-readiness` (new, in `gates`, added to `ci.yml` in the same PR, written on
the pattern of `lint:reader-gate`). It holds a `REQUIRED` list per worker and level (file + test
titles) and fails `build` if a listed test is missing, renamed, skipped, focused or `todo`.
`pnpm ads:readiness` prints the scorecard (worker × level). **Production launch (L5) is refused in
code** unless the scorecard shows L4 for every worker the campaign uses: the Launch route reads
the scorecard committed at the deployed sha. Retiring a required test means editing that list in
a PR that review sees.

### The harness (built in Stage 1; no new dependencies)

| Piece | What it is | Pattern it copies |
|---|---|---|
| `FakeMeta`, `FakeTikTok`, `FakeHiggsfield` | In-process `node:http` servers implementing exactly the endpoints our adapters call, with the documented request/response shapes, signed webhooks, and **fault injection** per call: 429 + `x-business-use-case-usage`, 5xx, timeout, error 2703, token expired/revoked, half-created objects, duplicate webhook, out-of-order webhook, a lead the webhook never sends | the Samsara/Telnyx signature tests |
| `FakeClock` | Drives schedulers and the orchestrator through simulated days in seconds | — |
| `packages/ads-golden` | Scenario package: each scenario is a JSON timeline (settings, opening, platform events, insight curves, leads, faults) + the expected ledger and alerts. Runs in CI | `packages/hazmat-golden` |
| Claude replay + live eval | CI replays recorded model outputs (deterministic, free). `pnpm ads:eval <worker>` calls the real model on the evaluation set and reports agreement; required before a prompt or model version ships | `apps/api/src/scripts/replayDocumentReads.ts` |
| **Simulator platform** | An adapter backed by `FakeMeta`, selectable only on a positively non-production environment, fail-closed (§1.2-8; a test proves production and an unknown name cannot select it). The whole product runs end to end on staging, so the owner walks it before any credential exists | — |

### What each worker must survive (L2) and score (L3)

| Worker | Injected faults / adversarial inputs (L2) | Evaluation or scenario bar (L3) |
|---|---|---|
| **Orchestrator** | Process killed **after every side effect** (each state × each vendor call) then restarted; the same job delivered twice; two campaigns in one org at once (M4); kill switch pressed in **every** state; approval missing; budget exhausted mid-step; settings changed mid-run | Every (state, event) pair enumerated: legal ones advance, illegal ones refuse (exhaustive, the machine is finite); 0 duplicate vendor creates (idempotency keys) across all crash points; golden scenarios green |
| **Budget guard** | Cap −1/0/+1; concurrent launches racing the cap; a raise just over the limit; clock at month boundary (Central time); kill switch while a call is in flight | 100 % of spend calls pass through it: a test fails if any adapter spend method is imported outside `guard/` |
| **Publisher (per adapter)** | 429/5xx/timeout on each create step; half-created campaign (campaign yes, ad set no) → resumed, never duplicated; token revoked → stops + alert | Contract suite green on the fake (L2) and on the sandbox (L4) |
| **Monitor** | Insights late, missing hours, numbers revised downward by the platform; an Ads-Manager edit; 30 simulated days with fatigue, overspend, zero-lead spend | Golden scenarios: each rule fires exactly at its threshold and minimum spend, never on a learning-phase ad set except caps; reconcile flags every planted mismatch and nothing else |
| **Lead intake** | Forged signature; duplicate webhook; webhook lost (backfill must bring it); same person on two platforms; malformed phone; prompt-injection text in a lead's free-text answer | 0 lost, 0 duplicated leads over the scenario set; injection text never reaches an action (extractor output stays `proposed`) |
| **Outcome feed** | Replay of the same stage; a stage arriving after 28 days; platform refuses an event | Exactly one accepted event per stage row |
| **Copywriter** (Claude) | Brief missing pay; brief in Spanish; brief containing an instruction ("ignore the rules…"); a preset whose slots are too short | Evaluation set (≥ 40 briefs × presets, EN + ES, written in Stage 1): **0 claims outside the brief reach review** (enforced by the pure claim checker, so this bar is absolute); human-rated "approve without edit" rate recorded as the baseline |
| **Art director** (Claude) | Brand kit missing photos; a preset showing people while the people policy is "none" | Every prompt ends with the no-lettering clause and uses a reference photo when the preset shows equipment (pure check, absolute) |
| **Checker** (Claude vision + pure) | **Planted-defect corpus**: images with lettering, a foreign logo, the wrong truck type, malformed people, overlay outside its safe zone, low contrast — generated for evaluation with the existing Higgsfield CLI login (developer use, not production) | Pure checks (geometry, contrast, length, claims) catch 100 % of their planted defects. The vision checklist's recall per defect type is measured and shown, and an owner-set threshold gates L3. Because a model's recall is never assumed perfect, **a person still approves every creative** (D-AD12) |
| **Analyst** (Claude narration) | A fold with a zero, a negative revision, a young cohort | 0 numbers in the narration that the fold did not produce (claim checker, absolute) |
| **Renderer / Higgsfield client** | Webhook never arrives (poll recovers); output URL expired; replay with the same idempotency key; credit budget exhausted | 0 double charges across replays (fake counts submits); every stored asset matches its sha256 |
| **Security (all)** | Token in a log line; token in an API response; a cross-org read; a non-admin hitting Connect or Launch | Each is a test that fails on the leak (`expectOrgScoped`, log scrape, response scrape, `routeGateLedger.test.ts`) |

---

## 5. Critical path and calendar (v2: credentials leave the critical path until Stage 2)

Releases run Sunday–Thursday nights at 01:07 CT, on the owner's approval. Merges reach staging in
minutes on any day.

| Stage | When | Work | Exit criterion |
|---|---|---|---|
| **Stage 1 — build + prove, no credentials** | Mon 11/02 → Sat 11/07 | A1–A6 · harness (fakes, FakeClock, `ads-golden`, simulator) · workers on fakes: B1–B5 + C1–C5 + D1–D2 + F1 against fakes · evaluation sets + `pnpm ads:eval` · E1–E5 on the simulator · `lint:ads-readiness` | Scorecard shows **L3 for every worker**; owner walks the full flow on staging in simulation mode |
| Release | Sun 11/08 night | everything above to production, **with no platform connected** (Launch refuses: no L4) | `verify:live` shows the release |
| **Stage 2 — credentials + certification** | from Mon 11/09 (or the day the owner's setup is done, if later) | owner connects Meta sandbox + real account, Higgsfield API key; V1–V4; L4 contract suite on the sandbox; fixtures re-recorded and diffed; any difference fixed and re-certified | Scorecard shows **L4** for every worker the first campaign uses |
| **Stage 3 — canary** | the day after L4 (earliest Tue 11/10) | first opening, limits saved, presets approved, one Meta stills campaign at a small cap, launched by the owner | 72 h, zero unexplained reconcile rows, first lead reached a recruiter → **L5** |
| Video, outcome feed, mailbox | after the canary | C6, B6, D3 — each climbs L1→L4 the same way | — |
| TikTok, X | when each platform grants access | H1, H2 — adapter + its L4 against that platform's sandbox/test account | — |

**What this changes against v1 of this calendar:** the first real ad moves from Mon 11/09 to the
day after L4 (earliest **Tue 11/10–Wed 11/11**). In exchange, the owner's Meta, Higgsfield, TikTok
and X setup is no longer on the critical path until 11/09, and nothing reaches a real platform
before it has been proven against a fake **and** certified against that platform's sandbox. **What
still moves the date:** a Stage-1 worker that does not reach L3 (it is not merged around), the
setup not done by 11/09 (Stage 2 starts the day it is), and an unapproved release night.

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
- **2026-11-01, v2** — Owner: build the agents first, add social credentials after; tests must
  prove each agent and the orchestrator production ready before any real case. Added §4R:
  readiness levels L1–L5, `lint:ads-readiness` (reader-gate pattern) with Launch refused in code
  below L4, fakes with fault injection, `packages/ads-golden` (hazmat-golden pattern), Claude
  replay + live eval (replayDocumentReads pattern), a simulator platform for staging only, and
  per-worker fault and evaluation bars. The same contract suite runs on the fakes and later on
  the sandboxes, so a fake built on a misread doc is caught before production. Calendar v2: Stage
  1 (no credentials) through Sat 11/07; Stage 2 certification from Mon 11/09; canary earliest Tue
  11/10–Wed 11/11. Measured: no fast-check/msw/nock installed, so state-machine pairs are
  enumerated exhaustively and fakes are `node:http`. **Nothing built.**
- **2026-11-01, handoff** — Stage 1 is handed to a fresh chat in
  `HANDOFF-2026-11-01-ADS-STAGE1.md`: the read-first list, every owner ruling, steps 1–11 in
  order with the traps measured on main `cb6fc2c` (last migration 0536; HW program PR #1883 open),
  what is out of Stage 1, and the owner's parallel track. **Nothing built.**
- **2026-11-01, A1** — Stage 1 started in the planning chat (owner: "proceed"). Main `74b0202`,
  last migration `0536_hire_policy.sql`; release candidate #1890 pins its SHA, so these merges ride
  the next train. A1: `ads` row and D-AD17 in `docs/ARCHITECTURE.md` (with the recruiting tables
  planned under `recruiting`), the ads schedulers in `docs/WORKER-DEPLOYMENT.md`. Measuring for A1
  found four corrections (§1.2-5…8): an `ads_approvals` table A2 lacked, ads AI provenance in
  `ad_generations`, lane `general` not `egress`, and no `APP_ENVIRONMENT` variable.
- **2026-11-01, A2** — Migration `0537_ads_foundation.sql`: the ads module's thirteen tables
  (configuration versions, sealed connections, campaigns, creatives, and the four append-only
  ledgers plus settings versions, pinned in `RETENTION_FORBIDDEN`) and the bell's eight categories.
  Beyond the step text, the database itself refuses a launch, raise or area change without a
  standing approval of that campaign and kind (AX020) or while the kill switch is on (AX021),
  freezes a creative's content once it leaves the workers (AX030) and a campaign's brief (AX031),
  stores no plaintext token (envelope-shape CHECK), and keeps every cross-table reference inside
  one org (composite FKs). Matrix `ads-foundation.test.mjs` 71/71; three guard mutations each went
  red. Correction §1.2-9: the recruiting tables move to a new step D0.
