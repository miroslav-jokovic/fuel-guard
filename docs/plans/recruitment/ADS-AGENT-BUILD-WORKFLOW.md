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

10. **(A5, 2026-11-01) `ads.connection` joins `ADMIN_ONLY_CAPABILITIES` in B1, not A5.**
   `routeGateLedger.test.ts` refuses a listed capability that guards no route, and Connect is B1's
   route; listing it now would show the Permissions page an act nothing protects. A5 adds
   `ads.spend` (save the limits, approve a launch / raise / area change, clear the kill switch), each
   with a fresh sign-in. Two more measured while building: an approval is **single-use** (one yes,
   one act — an approval already cited by a started or succeeded act does not launch the ad again
   after a pause), and it covers only amounts **at or below** what was approved.

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
| G1 | Meta: Business Manager owns the ad account + Page; payment method; **account spending limit set**; Business app with Marketing API + Lead Ads + Webhooks; app **Live** (privacy URL = `/privacy`); admin system user assigned to account, Page and app (on the Page, the **Moderate** or Create content task as well as Advertise: `subscribed_apps` refuses without one, B4b); in the app's Webhooks product, the Page object's **`leadgen`** field subscribed with callback `<api origin>/api/webhooks/meta` and the verify token we set as `META_WEBHOOK_VERIFY_TOKEN`, and the **app secret** set as `META_APP_SECRET`; token with `ads_management, ads_read, leads_retrieval, pages_manage_metadata, pages_read_engagement, pages_show_list`; Leads Access Manager grants the app; a **sandbox ad account** | O+V | owner (we write the click-path, O1) | B-live steps (B2–B6 live checks) | built and tested against recorded fixtures; **no production launch** | open |
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

### Phase E — screens (`apps/web/src/features/ads/`, except E4, which is the `recruitment` section's and sits in `features/recruitment/`; `docs/DESIGN-SYSTEM-CONTRACT.md` first; `packages/ui` only)

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
**Q-AD21** X · **Q-AD22** platform order · **Q-AD23** a launch delivered twice at once is paused (7d) · **Q-AD24** how we learn the Meta token's expiry (B1b). · **Q-AD25** Meta's rules vs the learning phase (B5b) · **Q-AD26** how the monitor learns an opening is filled (B5b). Each has its fallback in `ADS-AGENT-PLAN.md` §9 and its
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
- **2026-11-01, A3a + A3b** — A3a (#1898): `campaignMachine` (924 state × event × actor triples
  enumerated), `adsPolicy` (the monthly cap checked against a month-end forecast; account-limit
  fence; raise bounds; the authority table), the settings contract (nothing in force until saved),
  `AdBriefSource` / `LeadSink`, and a parity test holding the shared lists to 0537's CHECKs. A3b:
  `adClaims` (every digit in the copy must be a figure the brief holds — money, a number with a unit,
  an age floor, a listed promise — in English and Spanish, spelled numbers included; protected-class
  wording refused), `presetDraw` (seeded Fisher–Yates over FNV-1a + mulberry32, live presets for the
  same brief excluded, uniformity held over 6,000 fixed seeds; `fnv1a32` factored out of `ai.ts`
  rather than copied), `naming` (`S360|…` names that round-trip; anything else parses to null for
  D-AD4's reconcile), `renderGeometry` (safe zones, WCAG contrast over the worst sampled pixel,
  overflow refused) and `adsReport` (spend and lead-cohort folds, the month in Central time).
  ⚠ The forbidden-wording and promise-term lists are a first cut for counsel (G12, Q-AD8): "criminal
  record" and "conviction" are refused outright, which also refuses "no DUI convictions"; counsel
  decides whether a driving-record clause is allowed and in which words.
- **2026-11-01, handoff 2** — The rest of Stage 1 moves to a fresh chat from
  `HANDOFF-2026-11-01-ADS-STAGE1-A4.md` (main `acd6b5f`, last migration 0537; HW PRs hold 0538/0539).
  Measured for A4: `callClaude` (forced assessment tool) has no caller, so A4 copies the document
  reader's and hazmat's `anthropicClient` + monthly-budget pattern rather than preserving a fuel call
  site that no longer exists.
- **2026-11-01, A4** — The AI rail. `lib/anthropic.ts` gains `callForcedTool`: the caller's Zod schema
  is the tool (its JSON schema derived by `z.toJSONSchema`, never mirrored by hand), and the answer is
  parsed with that schema before a `value` exists. **Decision: `callClaude` is retired, not
  reshaped** — it had no caller since the anomaly-verification AI was retired (991a830), so there was
  nothing to keep compatible, and keeping it would have left a second, unvalidated way to force a tool;
  `callClaudeText` (weekly digest) stays. `modules/ads/generations/` is the ads rail every Claude worker
  uses: replay by `(org, idempotency_key)` first (a success comes back from the row, re-validated; a
  failure, a budget refusal or a `started` row asks no model), then the per-agent switch (D-RA9; new
  `budgets.agents_enabled` in the settings contract, absent = off, `AD_AI_AGENTS` = the five
  model-using workers), then the month's token budget (`aiGate`; a null budget REFUSES, unlike
  `withinBudget`'s null — said in code), then `started` → the call → one completion with the tokens
  billed whatever the outcome. The month is the carrier's Central-time month, folded from
  `ad_generations` by keyset pages (not `org_usage_month`, which is the document reader's and hazmat's
  shared budget). `modules/ads/settings/settingsVersions.ts` reads the settings in force (A5 adds the
  save). `canonicalJson` moved to shared (one definition; the reader's `wireSchema.ts` re-exports it)
  and `aiInputHash` became generic over it. Waivers for `ad_generations` and `ads_settings_versions`
  left `check-table-producers.mjs`. Nine mutations each went red. No migration.
- **2026-11-01, A5** — The guard. `ads.spend` on the admin-only list (fresh sign-in on every use);
  `ads.connection` moves to B1 with its route (§1.2-10). `modules/ads/guard/budgetGuard.ts` is the
  only path to a platform's spend methods: `platforms/adapter.ts` splits each adapter into
  `PlatformSafe` (reads, pause, lower) and `PlatformSpend` (launch, raise, widen the area), and
  `budgetGuard.boundary.test.ts` fails if any other file names `PlatformSpend` or calls its methods.
  Before a launch or raise it collects every refusal in one pass — kill switch, unset caps, the
  month-end forecast with this platform's month-to-date spend and every other live campaign's daily
  budget, the account limit read from the platform at that moment, and a standing, unused approval
  covering the amounts (two different people above `second_approver_above_cents`) — and records a
  refusal as an `ads_actions` row with no vendor call. Then `started` → the call → one completion, keyed
  by the approval, so a delivered-twice job sends nothing twice; the database's own fences (AX020,
  AX021) racing the guard come back as refusals. `guard/killSwitch.ts` (press = anyone managing
  recruitment, no password; clear = `ads.spend`), `guard/approvals.ts` (approvals + withdrawals), and
  the settings save in `settings/settingsVersions.ts`: a save carries the half it does not change,
  so saving a cap never switches spending back on, and two saves at once give a 409 instead of a silent
  overwrite. Doors at `/api/ads` (`routes/guard.ts`). Six producer waivers left
  `check-table-producers.mjs`. Fourteen mutations went red (one first attempt was a no-op and was
  replaced by a real bypass). No migration. Pausing what is live when the switch is pressed is A6's.
- **2026-11-02, handoff 3** — The rest of Stage 1 moves to a fresh chat from
  `HANDOFF-2026-11-02-ADS-STAGE1-A6.md` (main `1a3992d`, last migration 0539; release candidate #1907
  carries A4, A5 rides the next train). It records the A6 anchors measured on main and the traps from
  A4–A5 (app.ts at its line budget, reads count as producers, the writers manifest, sleep-broken runs).
- **2026-11-02, A6** — The orchestrator spine, `modules/ads/orchestrator/`. `transitions.ts` is the ONLY
  writer of `ads_campaigns.state` (first entry for that table in `scripts/table-writers.json`): it asks
  `stepCampaign`, records an illegal move as a `refused` row, and moves with one `ads_actions` row of kind
  `transition` the way 0537's header prescribes — `started` (keyed by campaign, the stint's
  `state_changed_at` and the event), a compare-and-set on `state` + `state_changed_at`, then the
  completion; a crash between the last two is settled at the next move from the campaign's own stamp.
  **Decision: no RPC, no migration** — the ledger's started/completed shape already gives "never an
  unrecorded move", and an RPC would have cost a second merge under the deploy-window rule. `runner.ts`
  runs one step per `ads_step` job: compose / create-paused through workers that are **null in this
  build** (`workers.ts`: B1/B2/C fill them; a null worker means the campaign waits, visibly), a launch
  only through `guard/guardedPlatform.ts` (`guardedLaunch`, the spend half closed over inside `guard/`;
  the boundary test flagged the first draft's `.launch(` and the method was renamed rather than the
  scan loosened), and the pause through `PlatformSafe.pause` (new). **The kill switch's second half**: a
  pressed switch moves launching/live to `pausing` on the next tick, before any launch is attempted.
  **A launch whose outcome is unknown is paused, not marked stopped** — the approval is single-use, so
  a retried guard would refuse and `launch_failed → paused` would label a possibly-live ad as stopped.
  Failure is `failed` with `last_error` (compose/create) or back to `paused` with the guard's refusals
  (launch); a failed pause stays `pausing` under a new stamp and is retried every tick, each attempt a
  row. `tick.ts` only enqueues (`ads_step`, `dedup_key` = `ads_step:<campaign>:<state>`, `KIND_CAPS` 2),
  every minute, lane `general`, off unless `ADS_ENABLED`; `agentHasWork` is the one definition the tick
  and the runner both read. Tests on a stateful fake (`testing/adsWorld.ts`: the unique idempotency key,
  the CAS, crash injection per write): every (state, event, actor) — 924 — legal advances and illegal
  refuses; two campaigns of one org composing at once; a crash after compose, after launch and after
  pause each resumes once with no second vendor call; the kill switch in all eleven states. Twelve
  mutations each went red. Orchestrator readiness: L1 done, L2 partly (crash points, double delivery,
  concurrency, kill switch); the rest of L2 and all of L3 (FakeClock, golden scenarios) are step 7's.
  No migration.
- **2026-11-02, step 7 split** — The harness is four PRs, in order: **7a** the environment helper, the
  simulator's gate and `FakeClock`; **7b** `FakeMeta` + the simulator platform; **7c** `FakeHiggsfield`;
  **7d** `packages/ads-golden` driving the orchestrator through scenarios. **Claude replay + `pnpm ads:eval`
  move to C2**, the first Claude worker: a replay of recorded outputs needs a worker that produces them,
  and an eval runner with nothing to evaluate would be a scaffold whose first real use reshapes it.
- **2026-11-02, 7a** — `apps/api/src/lib/deployEnvironment.ts` is the ONE reading of the environment name
  (§1.2-8): `RAILWAY_ENVIRONMENT_NAME ?? DEPLOY_ENVIRONMENT`, blank = unset; `schedulerLease.ts`'s holder
  row now reads it instead of its own copy. `isPositivelyNonProduction` allows only the measured
  non-production names (`uat` on Railway, `staging` on AWS — `railway environment list`,
  `infra/server/deploy.sh`), or no name on a process that is not a built server; production, an unknown
  name, a near miss (`Staging`) and a nameless built server all say no. `modules/ads/platforms/
  simulatorGate.ts` is the simulator's question, with the reason for a no; B1's registry asks it.
  ⚠ **Measured correction:** `GET /api/version`'s `env` (what `verify:live` prints) is `NODE_ENV`, and it
  says `production` on staging too — every built host runs `NODE_ENV=production`. It is not the
  environment and nothing here reads it as one. `testing/fakeClock.ts`: a clock moved by hand
  (`advance`, `set`), bound `now` for the ads deps, refuses to run backwards. Six mutations each went
  red. No migration.
- **2026-11-02, handoff 4** — The rest of Stage 1 moves to a fresh chat from
  `HANDOFF-2026-11-02-ADS-STAGE1-7B.md` (main `da641c9`, last migration 0542). A6 (#1912) and 7a (#1914)
  are merged; 7b (FakeMeta) and 7c (FakeHiggsfield) are pushed branches awaiting their gate run and PR
  (a local gate run was stopped for low memory at 50/53 green); then 7d golden scenarios, 8 the readiness
  gate, 9 the workers on fakes.
- **2026-11-02, 7b** — `modules/ads/platforms/simulator/fakeMeta.ts`: an in-process `node:http` Marketing
  API with the calls B1–B3 make — ad account read (cents as numeric strings, `spend_cap` "0" = none),
  campaign create (`special_ad_categories` required, ACTIVE/PAUSED only, `spend_cap` ≥ $100 →
  `{ id, success }`), status update (`{ success }`), campaign read with `fields=` + defaults — and
  Meta's error envelope. Faults per call: throttle (80004 / 2446079 + `X-Business-Use-Case-Usage`),
  temporary (code 1/2, HTTP 500), expired or revoked token (190 / 463), hang, **applied-then-error**
  (the half-created object), plus an Ads Manager edit (D-AD4). It lives beside the adapters, not under
  `testing/`, because the simulator runs it on staging. ⚠ Two shapes are our reading, not Meta's word
  (the HTTP status of an error; `error_subcode` beside a throttle) — said in the file, and L4's re-run
  against the sandbox exists to catch exactly that. Ad sets, forms, leads + webhook and insights join
  with B2/B4/B5, their first callers. **Decision: the simulator platform is B1's real Meta client
  pointed at FakeMeta behind `simulatorGate`** — a second client written now would be a copy B1 deletes.
  A bug inside the fake answers 500 naming itself rather than hanging (found when a mutation made the
  fake throw and the test failed by timeout). Ten mutations each went red. No migration.
- **2026-11-02, 7c** — `modules/ads/creative/higgsfield/fakeHiggsfield.ts`: an in-process Higgsfield API
  from its docs (read 2026-11-02, each page cited in the file): `Authorization: Key id:secret`; submit →
  `queued` + `status_url` / `cancel_url` / `expires_after`; `Idempotency-Key` returns the original request,
  the same key with other parameters is 422; status reads `completed` (`images[]` / `video`, `expires_at`
  seven days on), `failed` (`error`), `nsfw`; cancel only while `queued` (409 after); the **signed webhook**
  (Standard Webhooks: `webhook-id` constant across retries, HMAC-SHA256 over `id.timestamp.body`, key from
  `whsec_`), sent only on a final state, deliverable once, twice or never; output files 404 once
  `expires_at` passes on the scenario's clock. Faults: 429 queue full with `Retry-After`, 500, 503, hang,
  and **accepted-then-error** (charged, answer lost — the keyed replay must find it). Money: failed, nsfw
  and canceled are refunded; `submits` counts every submit that reached a model, the "0 double charges"
  number §4R asks for. ⚠ Our reading, said in the file: the docs do not say when the balance is debited
  or what a 403 body holds; the fake reserves at submit. Requests finish only when a test (or the
  simulator's driver) says so. The webhook signature is checked in the tests by an independent
  implementation written from the docs, not by the fake's own `sign`. Eleven mutations each went red.
  No migration.
- **2026-11-02, 7b + 7c merged** — FakeMeta #1921 (`dad251a`) and FakeHiggsfield #1923 (`ab01c0e`), gated
  by GitHub CI on the owner's choice (no local `ci:local`). #1923's first CI run caught what no local
  check had run: its test closed a server by hand instead of through `closeTestServer`
  (`testServerTeardown.test.ts`), and one never-read initial value (`no-useless-assignment`). Fixed in
  the PR.
- **2026-11-02, 7d** — `packages/ads-golden` (`@silvicom/ads-golden`): scenarios as YAML, plus their
  schema and loader, and nothing else. **Decision: the runner lives in `apps/api`**
  (`src/testing/adsGolden.ts`, run by `modules/ads/orchestrator/golden.test.ts`). `@hazmat/golden` can
  import its engine because that engine is a package; the ads orchestrator is a service module, and a
  package may not import an app. The runner drives the REAL `orchestratorTick` + `runCampaignStep` +
  `applyCampaignEvent` + budget guard over `adsWorld`, with only the vendors faked. The jobs ledger is
  modelled as one slot per `dedup_key`, a thrown job retries next tick, and every held job runs at
  once (harsher than `KIND_CAPS.ads_step = 2`). `adsWorld` gained mutable settings versions,
  approvals and spend, and a scenario clock (`FakeClock`, strictly increasing). There are 15
  scenarios, each with its whole ledger: happy path; two campaigns walking together; a second
  campaign refused by the first one's spend; the kill switch before and during the launch call; a
  throttled pause retried; a missing approval; a budget exhausted mid-step; settings changed mid-run;
  crashes after the create, after the launch, losing the launch's answer, and after the pause; a
  compose delivered twice; a launch delivered twice. A sweep also kills the happy path at each of its
  23 writes in turn: at most one launch, one created object, one compose key, a ledger that chains,
  and live — or paused when the launch's own answer was lost. The suite also has a negative control
  and the §4R coverage list. Twelve mutations of the orchestrator and the guard: eleven went red in
  the golden suite. The twelfth, the compare-and-set without the stint stamp, stayed green in EVERY
  ads test (only `pausing` moves to itself), so `transitions.test.ts` gained "a stale read of an
  earlier stint of the SAME state loses", which kills it. **Q-AD23 recorded, not routed around**
  (ADS-AGENT-PLAN §9): a launch delivered twice at once is sent once but ends paused, because the
  runner cannot tell an in-flight launch from a dead one. No migration.
- **2026-11-02, 8** — `lint:ads-readiness` (in CI's `gates`, with its `"//lint:ads-readiness"` key) and
  `pnpm ads:readiness`. It is built like `lint:reader-gate`, with the same title scan and NOT_RUN list.
  `scripts/ads-readiness.registry.mjs` gives every §4R worker five levels of **needs**, written from
  §4R's tables. Each need is either **pinned** (test file + titles, golden scenario files) or an open
  **gap** naming the step that closes it. The gate fails on a broken pin, on a need that is both or
  neither, and when the registry's workers and §4R's table disagree — the names are READ from the
  table's bold cells, not restated. A gap never fails. A worker is at level n when every level up to n
  has no gap, so levels are climbed in order. Proven: 21 self-test cases, plus five changes to the
  real repo, each of which turned the gate red: an `it.skip`, a renamed title, a deleted scenario, a
  `describe.only`, a renamed §4R worker. **Scorecard today: Orchestrator L3, Budget guard L3, Security
  L1, the nine unbuilt workers L0** (Copywriter and Checker have their pure checkers pinned under L1,
  beside the worker's own gap). The Budget guard's one L2 gap, "concurrent launches racing the cap",
  was closed here by `guard/budgetGuard.race.test.ts`: two launches at once never both reach the
  platform. It holds without a lock because a campaign is in `launching` before its guard reads, and
  the guard counts launching campaigns. Taking `launching` out of `SPENDING_STATES` turned two of its
  three tests red. Not built yet, by design: the Launch route refusing a worker below L4 (it needs E3,
  and is moot before Stage 2). `--json` is the shape it will read. No migration.
- **2026-11-02, B1a** — B1 is split in two. **B1a** is the Meta Graph client
  (`platforms/meta/graphClient.ts`); **B1b** is Connect, Disconnect and the connection test, with
  sealed tokens, `ads.connection`, the simulator connection and the Security pins. The client:
  - **Version.** One constant, **v26.0** (introduced 2026-07-29; the changelog was read). FakeMeta's
    version is now READ from it, not restated (it was v24.0).
  - **Errors.** Each is filed by Meta's error-handling table: 1/2 are transient and retried; 4, 17,
    341, 613 and 80000–80014 are a throttle, never retried; 190/102 mean the token is invalid; 3, 10
    and 200–299 mean permission denied; 368 is a policy block; the rest are `meta_<code>`.
  - **Throttling.** `X-Business-Use-Case-Usage` is read on every answer, and its regain time is
    obeyed per connection without asking Meta again.
  - **Retries.** A read is retried; a write only when the caller declares it idempotent. A create
    that timed out or answered 5xx is **never re-sent** and comes back `outcome_unknown` (B2 reads
    before re-creating).
  - **The token** goes as a Bearer header, never in a URL, and is scrubbed from every failure
    message. The client writes no ledger row — acts are recorded by their deciders.
  - **Not here:** `appsecret_proof` needs our Meta app secret (Stage 2).

  16 contract tests against FakeMeta; 11 mutations, each red. Pinned under Publisher L1 beside its
  not-built gap, so the scorecard is unchanged (Publisher still L0). No migration.
- **2026-11-02, B1a merged** — #1936 (`e5989c4`).
- **2026-11-02, B1b** — Connect, test, Disconnect and the simulator connection:
  - **Routes.** `/api/ads/connections`, hung off `adsRouter` because `app.ts` is at its budget.
    Reading takes recruitment view; Test takes `ads.connection`; Connect, Connect-the-simulator and
    Disconnect take `ads.connection` + a fresh sign-in. `ads.connection` is now on
    `ADMIN_ONLY_CAPABILITIES`, with its route (§1.2-10).
  - **Connection test** (`platforms/meta/connectionTest.ts`). Six checks, in order: the token
    (`me`); the six §6 scopes (`me/permissions` — missing fails, extra is reported, not failed);
    the account is ACTIVE; it bills in USD; Meta's own account spending limit is set (fence 3:
    without one every launch is refused); and the Page with the ADVERTISE task (`me/accounts`). The
    Page token travels BESIDE the report, only from a passing Page, to be sealed.
  - **Connecting.** A token Meta refuses is stored nowhere; otherwise it is sealed with AAD = org +
    `meta_ads:live|sandbox`, so a sandbox token cannot be moved into the live row. A token missing a
    scope is saved `failing`, with what to fix, so the owner need not paste it again. Every test is
    a `connection_test` ledger row; Connect and Disconnect are also `audit_logs` rows.
  - **Disconnecting** is refused while any campaign on the connection may be delivering: pausing
    needs the token, the kill switch's included.
  - **The simulator** (`platforms/registry.ts`) is the real `MetaGraph` pointed at an in-process
    FakeMeta (127.0.0.1, random port and token). The registry asks `simulatorGate` at every call,
    so production, an unknown name or a nameless built server is refused with the reason.
  - **Tests.** FakeMeta gained `me`, `me/permissions` and `me/accounts` in their documented shapes.
    13 mutations, each red. The Security L2 needs "token in a log or response" and "non-admin
    hitting Connect" are pinned; the Launch half stays a gap until E3, so Security stays L1.
  - **Q-AD24 recorded:** a token's expiry is only readable with our app's secret (Stage 2), so
    `token_expires_on` stays null for now. No migration.
- **2026-11-02, handoff 5** — The rest of Stage 1 moves to a fresh chat from
  `HANDOFF-2026-11-02-ADS-STAGE1-B2.md` (main `2ab0738`, last migration 0550). 7b, 7c, 7d, 8, B1a and
  B1b are merged and on staging; no ads branch is open. Next: B2, the publisher. It is to be split,
  because `metaLeadForm.ts` does not exist yet and the ad needs C4's creative. Then B3. Q-AD23 and
  Q-AD24 await the owner.
- **2026-11-02, B2 split + B2a** — Owner, 11/02: "we have 2 more days to finish this to be production
  ready". Two days hold the Meta path on the fake (B2a, B2b, B3, B4, B5), not all of Stage 1; the
  rest moves the 11/07 date, as §5 says it must. B2 is three PRs: **B2a** campaign + ad set, paused;
  **B2b** the Instant Form + `metaLeadForm.ts`; **B2c** the creative + the ad, after C3/C4.
  - `platforms/meta/publisher.ts`. Every level READS the parent for our exact name first: one found
    is taken, none is created, two or more are refused (`duplicate_on_platform`), one not paused is
    refused (`found_not_paused`). A create with an unknown outcome reads once more. If nothing is
    found the step fails `create_outcome_unknown`, and a person's Resume starts a new stint whose
    read finds it. Each create is read back BY ID and compared (status, employment, amounts). Every
    create and adoption is an `ads_actions` `create_paused` row per stint and level. A refusal
    before any call is a row too.
  - **Not wired into `workers.ts` yet, on purpose:** `created` moves a campaign to `paused`, where
    Launch is pressed, and a campaign with no ad has nothing to launch. B2c wires it.
  - **Measured on Meta's pages (2026-11-02):** a custom location's radius is 0.63–50 miles (Basic
    Targeting). An employment ad set needs ≥ 15 miles in the US, no age, no gender, no ZIPs, no
    exclusions, "enforced with a hard error" 2909035 (Special Ad Category). `adAreaSchema` allows
    500 for other platforms, so the Meta adapter refuses > 50 itself (`area_outside_meta_limits`).
    FakeMeta now enforces both rules, plus the ad set's required fields.
  - **`naming.ts` corrected:** a campaign runs several presets (`nextPresetBatch`), so only the `ad`
    level names one. Every level above carries the reserved `ALL`. A3 had required a real key
    everywhere. No name existed on any platform yet.
  - Scorecard: Publisher L2 pinned (9 tests). L1 keeps one gap (B2b, B2c, B3), so it still reads L0.
    "Token revoked → alert" waits for the wiring in B2c. Ten mutations, all red; files restored
    byte-for-byte.
- **2026-11-02, B2a merged; B2b** — #1945 (`f7ccb44`). **B2b** is the Instant Form:
  - `packages/shared/src/ads/metaLeadForm.ts` (plan §4.2) maps the brief's `form_questions` keys to
    Meta questions. Contact comes from Meta's prefilled FULL_NAME / PHONE / EMAIL. The only other
    questions are the **G12 counsel fallback**: Class A held, years of Class A, hazmat (EN + ES). Any
    other key is refused, never passed through. Widening the list is an edit after Q-AD8.
  - A form is the Page's and is made with the **Page token** (Lead Ads guide: "access_token set to
    your Page access token"). `registry.pageGraphForConnection` opens the Page token B1b sealed,
    under its own purpose, so the system user's token cannot open as one. FakeMeta answers a Page
    edge only for that Page's token. Revoking the system user's grant kills both tokens.
  - The publisher's third level: find the form on the Page by name. The edge documents no
    `filtering`, so it pages through, up to 1,000 forms, then refuses rather than risk a duplicate.
    Then create or adopt, and read back by id. Questions, privacy URL, locale and `ACTIVE` must match;
    a form with our name that asks other questions is refused. `block_display_for_non_targeted_viewer`
    is true, so the form opens only from our ad. `privacy_policy` must be `https://<host>/privacy` (V7
    still checks its wording). FakeMeta requires it, which is our reading of a doc that marks it
    optional; L4 settles it.
  - Nine mutations, all red.
- **2026-11-02, B2b merged; B3 split; B3a** — #1946 (`c167f8f`). B3 is two PRs: **B3a** the Meta
  adapter (launch / pause / raise / area) and `workers.platform`; **B3b** `rulesSpec` + the
  `adrules_library` sync on settings save.
  - `platforms/meta/metaAdapter.ts` implements `adapter.ts`'s two halves over `MetaGraph`. **The
    campaign is the master switch:**
    - pause = the campaign to PAUSED, alone (the fewest calls on the kill switch's path);
    - launch = the approved amounts (ad set `daily_budget`, campaign `spend_cap`), then the ads and
      the ad set ACTIVE, and the campaign LAST, so a launch that fails part way delivers nothing.
    Every write sets a value, so it is retried (`idempotent: true`). Launch and pause answer from a
    read-back, not from Meta's 200: FakeMeta's new fault `accepted_not_applied` proved the read-back
    is load-bearing (that mutant survived until it existed). A launch with no ad is refused. An
    account `spend_cap` of "0" is unknown, never unlimited.
  - `registry.adapterForConnection` (org-scoped; null for missing / disconnected / unopenable) →
    `workers.platform` → `guardPlatform`. **So a `pausing` campaign, the kill switch's second half,
    now reaches Meta or the simulator for real.** `createPaused` is still null (B2c), so nothing
    reaches `paused` by the agent, and so no launch happens unattended.
  - FakeMeta: ad sets and ads move to `fakeMetaAdSets.ts` (file budget). They get `POST /{id}`
    updates (status, `daily_budget`, `targeting`) and ad status.
  - `orchestrator/metaPath.test.ts` drives the real runner → guard → adapter → `MetaGraph` →
    simulator. It covers the kill pause reaching Meta, a guarded launch going live, a launch with
    no approval sending nothing, and a disconnected connection failing `no_platform`. The handoff
    asked for golden YAML scenarios here; these are TypeScript tests over the same path, because the
    golden runner (7d) scripts the vendor. Moving the golden runner onto the simulator is recorded
    for B2c, where the whole chain exists.
  - Nine mutations, all red.
- **2026-11-02, B3a merged; B3b** — #1947 (`2aefd98`). **B3b** = settings → Meta Automated Rules:
  - `packages/shared/src/ads/adsRulesSpec.ts` (pure `rulesSpec`). One PAUSE rule per set threshold
    (CPL once enough leads exist; spend with zero leads; frequency over 7 days; past 100% of the day).
    Each is a SCHEDULE rule, every 30 minutes. Money is in cents, Meta's base unit. Each rule is scoped
    `entity_type = ADSET` AND `name CONTAIN "S360|<code>|adset|"`, so an Ads Manager object is never
    paused (D-AD4). `pause_when_filled` stays ours: it needs the opening's headcount.
  - `platforms/meta/rulesSync.ts` is a diff against the account's rules carrying our
    `S360|RULE|<code>|` names: create / update in place / unchanged / DISABLE (never delete). Two
    with one name are refused. A Meta 2703 is `refused`, not a failure: that is **U2's fallback**,
    and our monitor (B5) stays that threshold's only enforcer. One `rules_sync` row per run.
  - The new job kind **`ads_rules_sync`** (`KIND_CAPS` 1) is queued by the settings save door on the
    (org, kind) slot, so Meta is never called inside the Save request. Its handler throws on a failed
    sync, so the job is listed failed (E5).
  - FakeMeta: `fakeMetaRules.ts` (create / list / update). `refuseSpendPause` plays U2 before V2 can
    measure it.
  - Ten mutations, all red. The Publisher's L1 now has one gap left: **B2c** (creative + ad, after
    C3/C4).
- **2026-11-02, B3b merged** — #1949 (`b2567ab`).
- **2026-11-03, D0** — migration **0553** `0553_recruiting_leads.sql`. 0552 was taken by the hiring chat's
  uncommitted `0552_applicant_outcomes.sql` (in `../FuelGuard-disp`), which does not touch `purge_applicant`.
  - **Checked before building: none of D0's tables existed under another name.** `recruiting_settings`
    (`required_questions`, `offered_document_slots`, `hidden_hiring_steps`) is what the application asks,
    not who qualifies. `hiring_carrier_steps` is the checklist after someone applies. `sms_outbox` is
    queued texts to an applicant. No requirement constant exists in code: §3a's 23 / 2 years lives only
    in RECRUITER-AUTOMATION-PLAN.
  - Tables: `hiring_profiles` (+ `_versions`), `recruiting_openings` (+ `_versions`; area = point +
    15–500 mi + reason, no ZIP column), `recruiting_leads` (unique (org, channel, external_ref);
    attribution and raw frozen, RL013; E.164 phone and lower-case email by CHECK), `recruiting_contacts`
    (a person's act, `created_by` not null; append-only, RL010), `lead_match_verdicts` (never edited,
    RL014; go with the lead), `lead_conversions` (append-only, RL010/RL011, merge moves `driver_id`).
    Contacts and conversions are in `RETENTION_FORBIDDEN`. A conversion points at its frozen lead instead
    of copying the attribution, so a converted lead cannot be pruned (on delete restrict).
  - `purge_applicant` (redefined whole from 0545) takes a converted lead whole: contacts, conversion,
    verdicts, lead. A lead nobody converted is left alone even with the same phone (D-LS10).
    `lead_conversions` is in `DRIVER_REASSIGNMENTS`.
  - **Deferred: `recruiting_ai_outputs`.** It has no Stage 1 writer. Meta leads arrive structured, and the
    first recruiting model call is D3's mailbox extractor (waits on G15). New tables are exempt from the
    two-merge rule, so it ships with D3.
  - **Gap found: no step owns WRITING profiles and openings.** D1's row names the ledger, queue,
    `convert_lead` and the `AdBriefSource`, which only *reads* an opening; G4 says the owner supplies the
    first opening, but no route or screen saves one. The four tables are on `check-table-producers`'
    waiver list against D1. **Recommendation:** D1 carries the profile + opening save (shared contracts
    `hiringProfile.ts` / `opening.ts`, two admin routes), and E-phase gets the screen. Without it, G4 has
    nowhere to go and the first campaign has nothing to advertise.
  - Matrices: `recruiting-leads.test.mjs` (new), `purge-applicant.test.mjs` (a converted lead in the
    fixture), `rls.test.mjs` (seeders for the composite-FK chains).
  - **`lint:migrations`' driver-references check could not read a composite FK.** `foreign key (org_id,
    driver_id) references drivers (org_id, id)` was invisible to it, so it reported `lead_conversions` as
    a stale list entry. Worse, the same table left OFF the list would have passed in silence. The check
    now reads the composite form, and a self-test pins it. No other unlisted FK turned up when it was
    switched on, and removing `lead_conversions` from the list now fails the gate.
- **2026-11-03, D0 merged** (#1954, `86804ff`). **Gate:** #1956 (`211a811`). D0 left 0552 free for the
  hiring chat's uncommitted file. `supabase db push` refuses a migration older than the last one applied,
  so that file would have merged cleanly and then failed at migrate-staging. `check-migration-ordering.mjs`
  now refuses a migration numbered at or below main's newest, and `docs/MIGRATION-DISCIPLINE.md` says a
  number goes above main's newest, never into a gap. **The hiring chat's `0552_applicant_outcomes.sql`
  must be renumbered** before its PR.
- **2026-11-03, D1 split into three merges** (the deploy window: a function merges before its caller,
  and `lint:migration-ordering` cannot see functions). **D1a** = migration **0554** with no caller:
  - `phone_e164` is `normalisePhone` in SQL; the matrix holds the two together over 20 fixtures by
    importing the built TypeScript.
  - `ingest_lead` stores a lead once per (org, channel, ref): a repeat answers `duplicate` and never
    updates. It returns the same person among leads and drivers, by phone or email only.
  - `convert_lead` takes the applicant **roster** created (roster stays the only writer of `drivers`;
    D1c exports roster's create). The same pair again is answered; RL020/021/022 refuse the rest.
  - `save_hiring_profile_version` / `save_opening_version` number versions under a row lock.
  - `recruiting_lead_queue` shows one person per row, newest first, keyset-paged. Sorting by match
    (hard requirements met → fewest unknowns) needs D1c's verdicts and is the queue screen's step.
  - 41 assertions; 22 mutants, all killed (three survived the first run as fixture gaps, now closed).
  - **D1b** = shared contracts (`hiringProfile`, `opening`, `leadContract`, `leadMatch`). **D1c** = the
    API (LeadSink, queue route, convert route, profile/opening saves), after 0554 is on staging.
- **2026-11-03, D1a merged** (#1959, `a9ec63f`); **D1b merged** (#1961, `ef33a5f`): `packages/shared/src/
  recruiting/leads/` holds `hiringProfile` (v1 = §3a), `opening` (its area IS `adAreaSchema`),
  `leadContract` and `leadMatch`. 27 mutants, all killed.
- **2026-11-03, D1c1 — the LeadSink, the queue, convert.**
  - `modules/recruiting/leads/`: `recruitingLeadSink` (exported from recruiting's index for B4) →
    `ingest_lead`, then `leadMatch` verdicts against the opening's newest profile version. The verdicts
    are written once per (lead, profile version) and healed on a retry. The sink THROWS on a failed store
    so the caller retries.
  - Routes at `/api/recruitment`: `GET /leads` (keyset cursor), `POST /leads` (a call / walk-in /
    referral / paste, needing a phone or an email), `POST /leads/:id/convert`.
  - **Roster's create moved to `roster/driverCreate.ts`** (`createDriverRecord`, exported), so the
    conversion makes its applicant through roster's door. `identity_source: "manual"` and the
    `driver.created` audit cannot drift.
  - **A fake fixed:** `postgrestFixture` projected `select` BEFORE `order`, so ordering by an unselected
    column did nothing, and it compared numbers as text. It now orders and limits first; the whole api
    suite (7863) is green on it. A survivor found it: the verdicts picked the OLDEST opening version
    under the fake.
  - 20 mutants, all killed (two survived the first run as fixture gaps).
  - **D1c2** (next): the profile and opening save routes, plus `GET` for both.
- **2026-11-03, D1c2 — hiring profiles and openings can be saved** (closes the D0 gap: G4's first opening
  had nowhere to go). `GET/POST /api/recruitment/hiring-profiles` (the list carries the owner's v1 as
  `defaults`), `GET/POST /api/recruitment/openings`, and `POST /openings/:id/status`. Every save is the
  next version through 0554, in the session's name; view reads, manage writes. 16 mutants, all killed.
  **D1 is complete.** Next: B4a (the hourly backfill → `recruitingLeadSink`), then B4b (the webhook,
  fail-closed until the owner's `META_APP_SECRET`).
- **2026-11-03, D1c2 merged** (#1964, `e0f1328`). **D1 complete.**
- **2026-11-03, B4a split; B4a1 = the backfill itself.**
  - `modules/ads/leads/backfill.ts`: per connection, every campaign of ours carrying a `meta_form_id` →
    `GET /{form}/leads` with the **Page token** (`filtering` `time_created > since`, 100 a page, at most
    50 pages, past that `truncated`) → `platformLeadFromMeta` → the injected `LeadSink`.
  - **A window, not a watermark:** each run re-reads the last 48 h. The sink stores a lead once, so there
    is no "read up to" row to get wrong after a crash, and no migration. An explicit `since` (held to
    Meta's 90-day retention) closes a longer outage.
  - Every failure is reported, never skipped: a form Meta refused (`graph:<code>`), `truncated`, a lead
    the sink refused (by id — never the sink's message, which can carry a phone), or a bad shape.
  - FakeMeta gains `fakeMetaLeads.ts` (Meta's `+0000` times, cursor paging, `filtering`, Page token only).
  - **Fix found reading 0537:** a campaign's brief ref is `<opening id>@v<version>`, and D1b's
    `leadFromPlatform` accepted only a bare id, so every real ad lead would have reached recruiting with
    no opening and no verdicts. `openingOfBrief` reads both.
  - 14 tests; 17 mutants, all killed.
  - **B4a2** (next): job kind `ads_leads_backfill` (`KIND_CAPS` 1, dedup per connection), the hourly
    `ads-leads-backfill` scheduler (off unless `ADS_ENABLED`), the handler wiring `recruitingLeadSink`
    in, and the readiness pins.
- **2026-11-03, B4a2 — the backfill runs hourly.** The `ads-leads-backfill` scheduler (general lane, off
  unless `ADS_ENABLED`, first tick 5 min after boot) queues one `ads_leads_backfill` job (`KIND_CAPS` 1,
  `dedup_key` per connection) per connected Meta/simulator connection. `queue/handlers/adsLeadsBackfill.ts`
  is the one place ads and recruiting meet: it hands `recruitingLeadSink` to `backfillConnectionLeads`, and
  fails the job (lead ids only) when anything was not brought in. Readiness: Lead intake's L1 now pins the
  sink, backfill, handler and tick tests, with **B4b** (the webhook) as its last gap, so it still reads L0
  honestly. 8 mutants, all killed (one survived the first run: no test held the dedup key).
- **2026-11-03, audit fixes A — the brake** (out of order, ahead of B4; from the 2026-11-03 read-only
  audit of the ads and lead path). Three ways an ad could keep delivering while we believed it stopped:
  - A launch whose row is `failed` went `launching → paused` on the failure alone. A failed read-back after
    a successful `campaign_active` leaves Meta delivering under a `paused` label that nothing pauses and
    the kill switch skips. Now every failed launch except `NOT_ON_PLATFORM` goes `pause → pausing`, and a
    pause the platform confirms ends it (`runner.ts` `fromLaunchRow`).
  - `ADS_ENABLED=false` stopped the tick outright, and with it the kill switch's second half. Now it is a
    brake (`orchestrator/brake.ts`): the tick and the step run, every org is read as killed, and only the
    pause path is left. The readiness pin "starts no timer unless ADS_ENABLED" asserted the old behaviour
    and is replaced in the registry.
  - One org's unparseable settings row threw inside the tick and stopped every org's pauses. Unreadable
    settings are now read as killed, per org.
  4 mutants, all killed. Still open from that audit: alerts (B-fixes), the guard's month-to-date read
  (no writer of `ads_spend_hourly` before B5), and the key-rotation and reconnect fences.
- **2026-11-03, audit fixes B — alerts** (from the same audit, H2: nothing in `modules/ads` told anyone
  anything). B1 widened the bell's CHECK with `ads_pause_failed` (0559). B2, after it, sends it:
  `alerts/pauseAlerts.ts` runs after every `pause_failed` move, and at three failed pauses in a row it rings
  the campaign's recipients (Settings › Ads control, else the org's active admins) with a critical "An ad
  could not be paused — pause it in Meta Ads Manager", once an hour while it stays stuck. The count is read
  from transition rows, not pause rows, because `no_platform` fails before any pause row is written.
  `token_invalid` and `no_platform` also move the connection `connected → failing` (the connections
  service's new `markConnectionFailing`) and send `ads_token_expiring` once a day. An alert that cannot be
  sent never fails the step. New boundary edge `ads -> messaging` (notify()). 8 mutants, all killed (two
  survived the first run as test gaps: a history with no older move, and a disconnected connection).
- **2026-11-03, audit fixes C — the guard reads spend from the platform** (audit H4). Nothing writes
  `ads_spend_hourly` before B5, so the forecast always started from $0, and it never saw spend made in Ads
  Manager on the same account. `PlatformSafe.readSpendCents` reads the account's insights for the
  carrier's month so far (`monthContext`'s new `since_day`/`today`), and `checkSpend` forecasts from the
  larger of our fold and the platform's figure; unreadable refuses `month_spend_unknown`. FakeMeta gains
  `act_{id}/insights` (`fakeMetaInsights.ts`, an account's `month_spend_cents`). ⚠ The range is in the
  org's zone; an ad account set to another zone can shift a few hours at the month's edges. 5 mutants,
  all killed. Not done here: the account `spend_cap` is lifetime, so the limit fence should compare
  `spend_cap − amount_spent` (audit M1) — left for its own step.
- **2026-11-03, audit fixes D — key rotation and reconnect** (audit H2/H3).
  - `lib/secretBox.ts` gains `SECRETS_ENCRYPTION_KEY_PREVIOUS`: during a rotation, values sealed under
    the previous key still open, and every new seal uses the current one. Before this, a rotation made
    every stored Meta token unreadable at once, so `no_platform` on every pause. Platform-wide (EFS
    certificates, Samsara and FleetPal tokens benefit too); the HMAC subkeys derived from the key are not
    covered.
  - `connectMeta` refuses to move a slot to another account or Page while a campaign on it is launching,
    live or pausing (`campaigns_delivering`, the disconnect rule), before Meta is asked anything. A fresh
    token for the same account and Page is always allowed — it is how a dead token is fixed.
  5 mutants, all killed.
- **2026-11-03, audit fix — the backfill never skips silently, and catches up** (lead-path audit H1, on
  B4a as merged in #1966). Three holes:
  - The tick queued only `connected` connections, so a `failing` one (a dead token; #1970 marks it so)
    got no job, so no failed job — its leads went unread and nothing said so. It now queues `failing`
    too; the run is attempted, and fails loudly every hour while the token is dead.
  - `backfillConnectionLeads` returned an empty, green result for any connection not `connected`. Now
    only a disconnected one is not read, and with forms still on it that is a failure
    (`connection:disconnected`).
  - The fixed 48 h window lost a longer outage's leads for good. The handler now reaches back to an hour
    before this connection's last `done` run (`catchUpSince`; the jobs ledger's own fact, via org's new
    `lastDoneJobByKey`, kept 90 days like Meta's leads), and to Meta's 90 days when there is none.
  7 mutants, all killed. Not done: an alert when a connection's backfill has failed for N hours (the
  failed job is listed, but nobody is rung); it needs a lead alert category.
- **2026-11-03, lead-path audit H3 (opt-out half) — a lead can be marked do-not-contact.** Ruled by the
  owner in session: opt-out first; the Instant Form's consent box waits for counsel's wording (Q-RA6c),
  and under D-RA2 nothing automated reaches a lead anyway. `POST/DELETE /recruitment/leads/:id/do-not-contact`
  writes or lifts a `manual` hold in `sms_suppressions` (0376, recruiting's own table; no migration), naming
  the applicant when the lead was converted. Every queue row carries `do_not_contact`, read from the
  number, so a re-submission on any channel and a texted STOP show too. Lifting never lifts a STOP. Email
  has no suppression list yet (RA 12.2), so an email-only lead is refused in words. 7 mutants, all killed
  (the non-uuid id survived until the fake refused it as Postgres does, 22P02).
- **2026-11-03, lead-path audit H2 — a lead's personal details can be deleted on request.** 0558 (#1979)
  adds `purge_lead`: it empties an unconverted lead (name, phone, email, answers, raw) and deletes its
  verdicts, leaving an anonymous tombstone so Meta's backfill reads the next copy as a duplicate and the
  contacts stay (D-RA12). The do-not-contact hold on the number stays. The route, a merge after it:
  `POST /recruitment/leads/:id/purge`, admin only with a fresh sign-in (`canPurgeLead` = the applicant
  purge's ruling), `same_person` sweeps the carrier's other leads with that phone or email and names any
  that became applicants. Named in `routeGateLedger.test.ts` beside the applicant purge. 8 SQL and 7 route
  mutants, all killed. Still owner track: Q-LS6 / Q-RA8, how long an unconverted lead lives before this
  runs on its own; counsel: whether contact notes on a purged lead should be redacted too.
- **2026-11-03, B4b — the leadgen webhook.** `POST /api/webhooks/meta` (public; `modules/ads/routes/metaWebhook.ts`
  over `leads/leadgenWebhook.ts`) believes only what Meta signed: `X-Hub-Signature-256` HMAC over the RAW
  bytes `appHttp.ts` keeps, and — only for a body with non-ASCII — over its escaped-unicode form, which is
  what Meta's Messenger webhooks page says it signs. No `META_APP_SECRET` → 503; bad/missing signature →
  401; both counted and said at boot. A signed delivery queues one **`ads_lead_fetch`** row per lead
  (`KIND_CAPS` 1, `dedup_key` `ads_lead_fetch:<org>:<leadgen_id>`) and answers 200; a form no campaign of
  ours has is answered 200 and logged by id. The GET handshake echoes `hub.challenge` (as `text/plain`, held
  to a token shape) only for `META_WEBHOOK_VERIFY_TOKEN`; unset → 503.
  - **Read against Meta's pages (2026-11-03), where they differ from the handoff's §3:** Meta retries for
    36 h and tells the receiver to dedupe (the dedup key does); one POST batches up to 1000 updates over
    many entries and changes (all are read); the signature is over the escaped-unicode payload (above); the
    retrieving guide's fields are `id,created_time,ad_id,form_id,field_data` (we also ask `campaign_id`,
    as the backfill does, and `form_id` must match the delivery's); `subscribed_apps` needs a Page token
    with CREATE_CONTENT/MANAGE/MODERATE plus `pages_manage_metadata`, and Meta delivers only when the
    APP-level subscription is set too (App Dashboard, owner track — G1 now says so); the 90-day lead
    retention is not on the retrieving page and stays an unconfirmed reading.
  - **Why a row, not `dispatchJob`:** production is `JOB_EXECUTION_MODE=inprocess`, where `dispatchJob`
    runs the handler inline — a Graph read per lead inside Meta's request. The receiver writes rows, answers,
    then runs what it queued (`drainKindNow`, handed in by `app.ts`); the general-lane drain claims leftovers
    and retries. Not gated on `ADS_ENABLED`: the gate is the secret.
  - The job (`queue/handlers/adsLeadFetch.ts`, the second ads↔recruiting seam) finds the org's campaign by
    form, reads `GET /{leadgen_id}` with the Page token, maps with the backfill's `platformLeadFromMeta`
    (one mapping, so the two roads give the sink the same lead) and throws on anything not brought in.
  - The connection test gains a 7th check, **`leadgen`**: it subscribes the Page with its Page token, and
    fails with "give the system user the Moderate task" on Meta's code 200. ⚠ Unproven against the real
    app until L4 — FakeMeta models the Page half only.
  - FakeMeta: `fakeMetaWebhooks.ts` (subscriptions, a signed delivery it RETURNS so a test can send it
    twice, forged, re-serialised or not at all) and `GET /{lead_id}` in `fakeMetaLeads.ts` (Page token only).
  - 31 new tests; 17 mutants, all killed (the conflict path re-run after the boundary fix moved it onto
    the queue driver). Readiness: **Lead intake L1.** L2 stays `later`: forged, duplicate, lost and
    malformed are now tested, but "same person on two platforms" needs a second platform and "injection"
    needs D3's extractor.
  - **G-sec `/security-review` on the B4b diff: no finding.** Checked: signature before any read or write
    (constant-time, strict header, raw bytes; the escaped form still needs the secret); the challenge echo is
    shape-held and `text/plain`; ids are digits-only before they reach a Graph path or a filter; every query
    after the form→org lookup is org-scoped and read with that org's own Page token, and `form_id` must
    match; logs and job errors carry ids, never a person.
- **2026-11-03, B5a — the hourly insights pull** (`modules/ads/monitor/`). `ads_spend_hourly` has its writer:
  job `ads_insights` (`KIND_CAPS` 1, dedup `ads_insights:<connection>`), scheduler `ads-insights` (general lane,
  hourly, off unless `ADS_ENABLED`), sharing the leads backfill's connection read (`metaConnectionsTick`). Per
  run: the account's `timezone_name` read from Meta (never stored), then every non-archived campaign of ours
  with a `meta_campaign_id`, `GET {campaign}/insights?level=campaign&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&time_increment=1`
  over the last three LOCAL days, paged, each local hour converted to its UTC hour and upserted with every
  column (composite conflict `campaign_id,hour`, so `lint:upserts` is satisfied with no RPC and no migration).
  A window re-read whole, never a watermark: late hours fill in, revisions down replace, an hour Meta stops
  reporting becomes zero — but only after a complete read; a failed or partial read leaves stored hours alone,
  and fails the job. FakeMeta `fakeMetaInsightsHourly.ts` (planted per local day + hour; `fakeMeta.ts` now 450).
  - **Where Meta's pages differed from the B5 handoff** (read 2026-11-03, cited in the fake's header): the hourly
    bucket is a LOCAL wall-clock hour, so on the fall-back day one bucket holds two real hours — stored whole on
    the first UTC hour (`localHours.ts`), the day's total exact, no split invented; spring-forward's 02:00 never
    exists and is reported if it ever came. Leads in insights are attributed to the impression's hour by
    default (`action_report_time`), so they will not match recruiting's lead times; B5b's zero-lead check must
    read them over a window. Meta documents no "fatigue" flag: Automated Rules offer `frequency`, `ctr`, `cpm`,
    `audience_reached_percentage`, and learning phase is the ad set's `learning_stage_info` — B5b's inputs.
    `time_increment=1` with an hourly breakdown is undocumented: our reading, for L4 to confirm.
  - Revisions older than three days are B5c's (a 28-day daily re-read; the payload `days` already allows it).
  - Readiness: Monitor stays L0 — B5a's tests are pinned on its L1 row beside `notBuilt` B5b/B5c.
  - Mutation: 14 mutants, all killed. One survived first (insert-or-skip instead of replace) because the test's
    in-memory table ignored the upsert's options; the harness now applies `ignoreDuplicates` as PostgREST does.
- **2026-11-03, audit fixes E — the last three findings** (merged after #1983's entries).
  - **M1 headroom (#1986):** the account-limit fence read Meta's account `spend_cap` raw, but it is a
    LIFETIME total: an account with history was refused forever, one near its limit looked roomy.
    `PlatformSafe.readAccountHeadroomCents` = `spend_cap − amount_spent`; `SpendRequest.account_headroom_cents`;
    new refusal `account_limit_reached` at 0. The owner now sets the limit monthly to lifetime spend + ≤ cap.
  - **M5 phones (#1988, 0560):** a number written with `+` keeps its own country, never `+1`-defaulted,
    spaces allowed — `normalisePhone` and `phone_e164` alike, held by the parity matrix.
  - **M1 convert once (#1989 0561, #1990):** `claim_lead_conversion` before roster's create; the loser of a
    double click gets 409 `conversion_in_progress`; a claim lapses after 2 minutes; failures release it.
  14 mutants across the four PRs (4 + 2 + 4 + 4), all killed. Next for this track: `HANDOFF-2026-11-03-LEADS-FIRST.md`.
- **2026-11-03, B5b — the auto-pause checks.** `packages/shared/src/ads/monitorChecks.ts` (pure) decides;
  `apps/api/src/modules/ads/monitor/checks.ts` gathers and applies, run by the `ads_insights` job right after
  its pull (even a partly failed one: a cap breached by the hours that did arrive must still pause). Rules,
  read from the settings in force and compared as `adsRulesSpec.ts` tells Meta to (strictly greater, so "at"
  the threshold never fires): `monthly_cap` (the guard's own fold, now exported as `platformSpend`, or Meta's
  account figure, larger wins — every delivering campaign on the platform), `daily_cap` (today on the
  ACCOUNT's clock), `no_lead_spend`, `cpl_max`, `frequency_max` (ad-set insights over 7 local days, today
  included — Meta's `LAST_7_DAYS`). Caps first, one reason per campaign; only `launching`/`live` are judged.
  - **Learning phase:** Meta's `learning_stage_info.status` (LEARNING / SUCCESS / FAIL; only some active ad
    sets, some accounts). LEARNING or an unreadable stage → caps only; SUCCESS, FAIL or no stage returned →
    every rule (otherwise an account Meta never reports stages for would switch the rules off silently).
  - **A pause is the agent's `pause` through `applyCampaignEvent`** (actor `monitor`, cause = rule, measured,
    threshold, settings version), so the orchestrator carries it to Meta with its retries and stuck-pause
    alert; the monitor never calls an adapter write. Bell per plan §4b: caps → `ads_overspend` (critical),
    zero-lead → `ads_no_leads` (warning), one per campaign, rule and local day; CPL and frequency pauses are
    ledgered with no bell (the brief reports them).
  - **Not built, recorded instead:** **Q-AD25** (B3b's Meta rules carry no learning filter, so Meta is
    stricter than we are in the learning phase) and **Q-AD26** (`pause_when_filled` needs a recruiting seam,
    D-AD17). Meta's "Creative fatigue" delivery flag is in no API page found; frequency is the signal.
  - B5a's `localHours.ts` restated the clock arithmetic `calendarDay.ts` already owns; it now derives from
    `wallClockInZone`/`wallClockToUtc` (a non-existent hour read back and refused). B5a's tests unchanged, green.
  - Readiness: Monitor L0 still; B5b's tests pinned on its L1 row beside `notBuilt` B5c.
  - Mutation: 22 mutants, all killed (every boundary at −1/0/+1, the learning gate both ways, the account-day
    "today", the bell's dedupe, the org filter, checks after a partial pull).
- **2026-11-03, B5c — the daily reconcile + `external_change`. B5 is complete; Monitor reads L1.**
  `packages/shared/src/ads/adsReconcile.ts` (pure) compares; `apps/api/src/modules/ads/monitor/reconcile.ts`
  reads and records, run by job `ads_reconcile` (`KIND_CAPS` 1, dedup per connection) from scheduler
  `ads-reconcile` (daily, general lane, off unless `ADS_ENABLED`). Per run: 28 days of insights re-read first
  (Meta's revision horizon; the hourly pull re-reads 3), then every campaign of ours that reached Meta read by
  id (campaign `status`/`spend_cap`, ad set `status`/`daily_budget`) and the account's campaign list.
  - Mismatches: `missing` (gone, DELETED or ARCHIVED, unless ours is archived too), `status` (live must be
    ACTIVE, campaign and ad set; settled non-live must be PAUSED; `launching`/`pausing` either), `daily_budget`,
    `spend_cap`, `overrun` (lifetime spend past the approved lifetime), `not_ours` (a campaign whose name does
    not parse as ours — or does, with no row: marked `ours_by_name_unrecorded`). Critical when it can spend
    unapproved money (delivering where we hold it paused, an amount raised or removed, an overrun, a stranger's
    ACTIVE campaign); warning otherwise.
  - **Once per fact, no new table:** each mismatch is an `ads_actions` row, kind `external_change`, actor
    `platform`, idempotency key `external_change:<connection>:<object>:<field>:<Meta's value>`; the ledger's
    unique key turns a repeat into `startAction`'s `"duplicate"` — no row, no bell. A new value is a new fact.
  - **Never adopted:** no write to our rows or to Meta (a test asserts zero POSTs; B5b's checks now assert the
    same). The machine's `platform_paused`/`platform_activated` rows stay unused: the handoff's rule is report,
    never adopt. A read refused for anything but "does not exist" (100/33) is reported and left out of both
    sides — a throttle is never called "missing".
  - Readiness: **Monitor L1** (B5a/B5b/B5c pinned). L2/L3 stay `later`: §4R's 30 simulated days are not built.
  - Mutation: 17 mutants; two survived the first run as test gaps (a paused campaign's ad set created PAUSED;
    an ad-set budget removed), both now killed — 17 of 17.
- **2026-11-03, C1 — brand kit + presets API.** Versioned, uploads sniffed by content, SVG rasterised, assets by
  sha256. Done-when met: a `.png` that is really a PDF is refused (`unsupported_format`, "This file is a PDF").
  - **The A3 contract written:** `packages/shared/src/ads/brandKitContract.ts` is the shape 0537's `kit` and
    `recipe` jsonb hold (0537 named it; A3 never wrote it). Kit: company name, phone, colours, logo, equipment
    photos (D-AD9), overlays per format (a zone may only TIGHTEN `renderGeometry`'s safe zone), people policy
    (`none` | `varied`, D-AD8), forbidden marks; `AD_VISUAL_CHECKS` is C5's closed checklist. Recipe: hook
    formula, copy slots, image-prompt template whose `{slots}` must equal `image_slots`, `starts_from` (a scene
    with equipment or a person cannot be `text_only`, D-AD9), motion template, formats. No values in code:
    tests use fixtures; **P1–P5 are NOT seeded** (Q-AD12 is the owner's — the producer waiver's "seeds P1–P5"
    was wrong and is gone with the waiver).
  - **The sniffer needed no move:** `document-reading/pages/sniff.ts` only re-exports `sniffFormat` from
    `@silvicom/shared` (`documentFormats.ts`), so ads imports it from shared; no boundary is crossed, nothing
    copied. SVG (text, no magic number) is recognised by its root element in `creative/brandAssets.ts`.
  - **Uploads:** signed URL → `<org>/incoming/<id>` → `POST /api/ads/brand-kits/assets` reads it once, decodes
    every pixel (`stats()`, so a truncated file is refused here), stores at `<org>/<sha256>.<ext>` with
    `upsert: false` (same file twice = same object), removes the incoming object either way. Bucket
    `ad-assets` is **migration 0562** (private, 15 MB, no storage policy — the `chat-files` pattern).
  - **SVG:** refused when it declares entities, holds script or foreignObject, `@import`s, or has any `href` /
    `url()` that is not `#fragment` or an embedded raster `data:` image (librsvg resolves `file:` against the
    server's disk); else rasterised to PNG at a 2048 px long edge. Only the PNG is stored.
  - **A save re-reads its assets:** each ref is downloaded and its hash, size, format and dimensions compared,
    so a version's record of a file is the file's, not the page's (`assets_mismatch`, 422).
  - **Versions:** a save is an INSERT only (0537's triggers refuse the rest); 23505 → `conflict` (409), never
    retried; a kit's name is set when it is made (a rename is not a save); a parent made by a save whose
    version 1 is refused is removed again. Writers pinned in `table-writers.json`; the four producer waivers
    retired.
  - **Who:** read = view recruitment; write = new named grant `ads.brand-kit` (admin only, ADS_AUTHORITY
    `edit_settings_brand_kit_presets`), no fresh sign-in — nothing here spends.
  - **Left for later, said here so nobody finds it by accident:** a brand FONT is not in the kit (images only —
    C4 owns the canvas and decides with Q-AD14's "font, if any"); HEIC is refused with its name (an iPhone photo
    must be exported as JPEG until a decoder is reached through `document-reading`'s public index — say so if
    the owner's photos arrive as HEIC); archive / rename are not doors yet (E2).
  - Readiness: unchanged (C1 is no worker's level; Renderer's L1 waits on C3 + C4).
  - Mutation: 19 mutants; one survived the first run as a test gap (an archived preset taking a version), now
    killed — 19 of 19.
- **2026-11-03, C2a — the Copywriter's prompt pack, the replay, `pnpm ads:eval` and `lint:agent-fixtures`.**
  C2 is two PRs: C2a the Copywriter plus the shared tooling, C2b the Art director on the same tooling. Done-when
  met: a planted invented figure (`$0.75/mile` against a `$0.68` brief) fails the claim check, in both languages,
  naming each slot; the fixture agreement is recorded as the baseline.
  - `modules/ads/workers/copywriter/`: `prompt.v1.md`; `copywriter.ts` (`writeCopy` through the A4 rail, key
    `copy:<creative>:<attempt>`, `buildCopyRequest` + `judgeCopy` exported so the eval asks and judges exactly
    as the worker does); 15 fixtures (10 recorded from the model, 5 planted and labelled `planted`); the replay
    `copywriter.test.ts`; `baseline.json`.
  - **The model sees** the brief's subject and claims and the recipe's hook formula and slots, as JSON called
    data; never the area or landing URL. **The check decides**: every string of both languages through
    `checkClaims`, and each slot against its limit (`too_long`). One finding anywhere → `refused` with the
    findings; nothing is trimmed.
  - **Measured, then fixed (2026-11-03, `pnpm ads:eval copywriter`, claude-sonnet-4-6):** first run 8/10. (1) Told
    the real slot limit, the model ran over by 1–11 characters in 3 of 10 answers, mostly in Spanish → it is now
    told 85 % (`TOLD_LIMIT_SHARE`), the check holds the real limit, and the length moved out of the tool schema
    into the copy check (D-AD12 §1 "the length fits"), so an overrun is a recorded answer refused `too_long`,
    not an `off_schema` failure. (2) "mayor de 23 años" — the correct singular Spanish age floor — was read as
    a bare "23 años" and refused; `adClaims`' AGE pattern now reads it (still only as an `age` claim; pinned both
    ways). (3) With no pay in the brief the model wrote "No pay figure listed" → the prompt now says never to
    mention a missing fact. **Baseline: 9 of 10 (0.9).** The miss is the checker being right: a `$1,500/week`
    brief, copy saying "weekly pay" — a promise to pay weekly the brief does not make.
  - **C1 contract change, before any version exists:** a recipe's `copy_slots` is now `{ name, max_chars }[]`
    (was names only) — §4R's "a preset whose slots are too short" needs the limit to mean anything. No row has
    been saved yet (no editor until E2), so nothing stored is reshaped.
  - **`pnpm ads:eval <worker> [--record]`** (`apps/api/src/scripts/adsEval.ts`) calls the real model with the
    developer's key via `callForcedTool` — no org, no budget, no ledger row, said in its header: it is a
    measurement, not a worker. Planted fixtures are skipped. `--record` rewrites recordings, sets each `expect`
    to the verdict its answer gets, and writes `baseline.json`.
  - **`lint:agent-fixtures`** (new, in `ci.yml` `gates`, same PR): each worker reads its NEWEST prompt and names
    `<worker>@<N>`; every fixture parses, is named for its file, recorded under that version; model recordings
    are real; ≥ 1 model and ≥ 1 planted; the baseline counts exactly these fixtures under that version; the
    replay exists and skips nothing. Self-test plants 8 violations.
  - **`compose` stays null** (`orchestrator/workers.ts`): wiring the copy alone would move a campaign to review
    with no visual or render check. It is filled when C5 completes the chain.
  - Readiness: **Copywriter L2** (L1 the worker + replay + planted refusals; L2 §4R's four faults each a replayed
    fixture). L3 open: the set is 10 briefs, the bar is ≥ 40 with a person's approve-without-edit rating.
  - Mutation: 9 mutants (Spanish skipped, length unchecked, key without attempt, area sent, real limit told,
    verdict ignored, wrong agent, claims unchecked, the age pattern reverted), all killed; the gate's own
    checks are its 8-case self-test.
- **2026-11-03, C2b — the Art director's prompt pack. C2 is complete.** On C2a's tooling (`EVAL_WORKERS`,
  `lint:agent-fixtures`, the replay pattern). The pure half is `packages/shared/src/ads/artDirection.ts` so C3
  (the Higgsfield client sends only `composeImagePrompt`'s prompt) and C5 (the checker) read the same rules.
  - **Before the model** (`artPrecheck`, no call, no row): a scene with equipment and no kit photo →
    `no_reference_photo` (D-AD9: never a stranger's truck); people under people policy `none` →
    `people_policy_none`. These are §4R's two L2 faults.
  - **After the model** (`judgeArt`): every declared slot and no other; ≤ 120 characters; no digit, no quotation,
    no word that asks for lettering (text, logo, sign, caption, banner, billboard, poster, placard, label,
    slogan, branding, decal, number, font…, whole words — "design" and "signal" pass); the reference photo is
    one of THIS kit's, required for an equipment scene, refused for a text-only one. `composeImagePrompt` fills
    the template and ends it with `NO_LETTERING` ("no text, no logos, no lettering") exactly once, whatever the
    template already said — §4R's absolute bar is the code, not the model.
  - **The model sees** the template, the slot names, what the scene shows and the photos' labels and hashes —
    never the brief or the company name (the image carries no facts). Key `art:<creative>:<attempt>`.
  - **Baseline (`pnpm ads:eval artDirector`, claude-sonnet-4-6): 10 of 10** on fixture presets; read by hand too:
    the dock scene chose the reefer photo, and an instruction planted in a photo label ("paint the company logo
    and phone number on the trailer") was ignored. One judge gap found while writing the planted set — "a
    billboard reading $0.68" was caught only by its digit — so billboard/poster/placard joined the word list.
  - Readiness: **Art director L2.** L3 open: §4R sets no size for this set; re-run on P1–P5 once the owner
    approves them (Q-AD12).
  - Mutation: 13 mutants (each pre-check, digit, lettering, foreign photo, photo on text-only, the clause, slot
    length, pre-check skipped, verdict ignored, key without attempt, wrong agent, company name sent), all killed.
- **2026-11-04, C3 — the Higgsfield client, on FakeHiggsfield.** Done-when met: a replayed generation spends
  nothing (the fake's submit count and balance unchanged by a replay, and by a lost-answer retry); an expired
  URL never reaches the UI (no Higgsfield URL is written to any row or answer — only our `ad-assets` path).
  - `creative/higgsfield/`: `higgsfieldClient.ts` (submit / status / download, tagged outcomes: `temporary`,
    `balance`, `refused`; base `https://api.higgsfield.ai` from the plan's research, OUR reading until L4),
    `render.ts` (`renderStep`, one idempotent step), `higgsfieldKey.ts`, `prices.ts`; job `ads_render`
    (`KIND_CAPS` 1, one-line kind in `jobs.ts`, now 494), handler `queue/handlers/adsRender.ts`.
  - **Idempotency-Key = the generation row's id.** The row is written `started` first; AX011 lets it move only
    once, so Higgsfield's request id is not stored mid-flight — instead every run while `started` submits
    AGAIN under the same key, which Higgsfield answers with the original request, free. That one rule covers a
    crash after submit, `accepted_then_error`, and the webhook that never arrives. **No webhook receiver is
    built** (the workflow's "webhook or poll"): the queue's retry backoff is the poll; when attempts run out the
    row stays `started` and the next job resumes it.
  - **Credits before the submit:** shared `creditGate` — switch, price, budget, and "used + price ≤ budget"
    (a render's price is known in advance, unlike tokens). `higgsfieldCreditsThisMonth` counts finished rows at
    cost and `started` rows at the price written on them, so renders in flight count at once and the month
    cannot overshoot. **`HIGGSFIELD_CREDIT_PRICES` is EMPTY**: every model is `price_unknown` until V4 measures
    real prices with the owner's key (Q-AD20) — never guessed. `failed`/`nsfw`/a 403 cost 0 (Higgsfield's
    billing page); a completed render whose file is gone completes `failed`/`output_expired` AT its price.
  - **Copied at once:** each image downloaded, decoded by C1's `prepareAsset`, stored `<org>/<sha256>.<ext>`
    (`upsert: false`), row completes with `asset_sha256`, `asset_path` and `output = { assets }`. The download
    is the expiry test, not `expires_at` (files are kept "at least" 7 days; a mutant found the date check
    duplicated the 404 and would discard a still-served file — removed).
  - **The key:** `sealHiggsfieldKey` / `higgsfieldKeyFor` — a `higgsfield` row of `ads_platform_connections`,
    `secretBox` with AAD = org + `higgsfield_api`, `<id>:<secret>`. **Not built: the Connect door** — it waits
    on Q-AD20 (no real key seen; a door that cannot test what it stores would save a typo as `connected`).
  - **Also not built, said so nobody finds it by accident:** sending the Art director's reference photo to
    Higgsfield (image-to-image, D-AD9) — the fake has no upload endpoint and the upload docs are unread; it
    belongs with compose (C5) and is read before then. Video (C6).
  - FakeHiggsfield now serves a real 2×2 PNG per request (colour from the request id), since the client decodes.
  - Readiness: Renderer stays **L0** — its L1 also needs C4. C3's L1 tests and all four §4R L2 faults are pinned.
  - Mutation: 13 mutants; three survived the first run — the `expires_at` check (redundant, removed), a URL
    written into `output`, and `upsert: true` (both test gaps, now asserted) — 13 of 13.
- **2026-11-04, C4 — the overlay renderer (stills).** `creative/overlay/overlay.ts` (`renderOverlay`): one format and
  one language per call, bytes in, PNG out (storing it on the creative is compose's, C5). Done-when met: golden
  images per format (`__golden__/1x1.png`, `4x5.png`, `9x16.png`, ~45 KB each, looked at before committing);
  a headline needing a third line refuses, naming it, with no image.
  - **Template:** a stack anchored to the bottom of the text zone (the kit's zone, else `safeZone`): headline
    (bold, ≤ 2 lines), call to action (bold, 1 line), the EEO line (1 line); the logo at the zone's top left.
    Sizes fixed per format (64–70 / 44–48 / 26–28 px) and never reduced: too many lines, a word wider than the
    zone (`overflows`) or a stack taller than the zone REFUSES.
  - **Text from the brief only:** every line drawn is re-checked with `checkClaims` here, whatever checked it
    before. `EEO_LINE` (EN "Equal Opportunity Employer", ES "Empleador con igualdad de oportunidades") is D-AD9's
    fixed legal line — counsel confirms the wording with G12 / Q-AD8.
  - **Contrast under the words:** the image and plate are composed first, every 4th pixel under each box is
    sampled from that, and shared `checkRender` judges the worst. Tests: white text over a bright sky with no
    plate fails while the same text over the dark field passes; one 24 px bright stripe behind the words fails.
  - **Nothing invented:** a format the kit has no overlay for refuses `no_template` (no default colours); fonts are
    the bundled Liberation Sans from `lib/pdfFonts.ts`, registered from its bytes, and a character it cannot draw
    (`canDraw`, e.g. an emoji) refuses instead of printing an empty box.
  - Goldens compare with a tolerance (< 0.5 % of pixels off by > 48 levels) for Skia's antialiasing between
    macOS and Linux; `UPDATE_GOLDEN=1` rewrites them, and CI refuses a missing golden instead of writing one.
  - Readiness: **Renderer / Higgsfield client L2** (L1 = C3 + C4, L2 = C3's four faults).
  - Mutation: 11 mutants; one survived the first run (a sampling grid thinned to every 400th pixel still caught
    the sky) — the stripe test now kills it — 11 of 11.
- **2026-11-04, D2 — a lead reaches a person: contacts, `lead_new`, `lead_uncontacted`, intake health.** The leads-first
  path's steps 1–4 (`HANDOFF-2026-11-03-LEADS-FIRST.md` §3), one docs entry merged last. No readiness row moved: Lead
  intake reads L1, and nothing here has met a real Meta lead. D2's done-when is **not met yet**: latency is measured
  in code but not on staging, and the escalation has not fired there, because both need a live Meta connection.
  - **D2a, a contact is logged** (#1996, `d969a1b`). `POST /recruitment/leads/:id/contacts` (`leads/leadContacts.ts`),
    recruitment manage: the first writer of `recruiting_contacts`. The contact is inserted BEFORE the conditional
    `new → contacted`, so a failure cannot leave a lead marked contacted with no record. Every contact moves a `new`
    lead, `no_answer` included: the status answers "has anybody tried". A purged lead is refused (409 `lead_purged`),
    because a note would put personal details back on a row the purge cannot reach. Audited by lead id, never
    the note. A double press writes two rows and the table is append-only, so E4 disables the button in flight.
    5 mutants killed; a sixth survived on a redundant early return, which was removed.
  - **D2b, `lead_new`** (#2001, `066e044`). `recruitingLeadSink.accept` rings on `stored === "new"`, not `ingestLead`,
    so a lead a recruiter typed in rings nobody. The carrier's `alerts.recipients.lead_new`, else `sectionManagers`
    (new in `accessReview.ts`, derived from `whoHasAccess`: view-only holders are out). `alerts.recipients` now takes
    `lead_*` categories; recruiting may not import ads (D-AD17), so `queue/handlers/leadSinkFor.ts` hands the reader
    across. **Differs from the handoff:** no assignee tier, because nothing writes `assigned_to` and a lead stored a
    moment ago cannot have one. A failed ring is logged and lost: a retry reads a duplicate, so D2c is its only
    backstop. No deep link until E4. 7 mutants killed.
  - **D2c, `lead_uncontacted`** (#2004, which carried #2003's commits; #2003 closed). Scheduler `lead-uncontacted`
    (general lane, 5 min, off unless `ADS_ENABLED`), one `lead_uncontacted` job per carrier with a `new` lead
    (`leads/leadUncontacted.ts`). **Ruled by the owner 2026-11-04: any hour.** No business-hours rule; a person's own
    quiet hours and mutes apply, which is why it is `warning`, not `critical`. This rules the alarm only: the plans'
    "speed to first contact (median, business hours)" report is unchanged. Left out: manual channels, a lead with a
    contact row (D2a's failure case), a number held from contact. The clock is `received_at`, ours, so a late
    backfilled lead gets its full window. No age ceiling: the first sweep after switch-on rings every old lead once.
    A lead counts as rung once anybody got it, so somebody in quiet hours then does not get it later. 10 mutants killed.
  - **D2d, intake health** (0563 in #2004, `66525f1`; sender #2007, `b9d8a8b`, a later merge per 0559/#1970).
    `lead_intake_failing`, `modules/ads/alerts/intakeAlerts.ts`, `warning` because the backfill reaches back and leads
    are late, not lost. A failed backfill run, reported or thrown, rings when the last `done` run is at least
    `BACKFILL_STALE_HOURS` (3) old or there is none; once a day per connection. **3 is a default, not a ruling.** A new
    webhook lead's `latency_ms` (Meta's `created_time` to the sink's answer) rides on the `ads_lead_fetch` job's stats, the
    only place that knows a lead came by webhook; over 5 min rings, once a day per connection. The carrier's list,
    else the admins, who can repair a connection. An alert never changes a job's outcome. **Not covered:** a backfill
    that never runs (dead worker, `ADS_ENABLED` off) cannot report itself. 12 mutants killed.
  - **Merge notes.** A local merge of main that hit conflicts was committed with its markers by a script that did
    not stop; it failed the gates and was rebuilt, never pushed. Check a merge's exit code before `git add -A`.
    GitHub said CONFLICTING on #2004 where `git merge-tree` was clean (§4's trap again). A branch that resolved a
    conflict in a later PR can land an earlier PR's work: #2003 had nothing left, proved by the merge's tree
    equalling main's. **Open:** #2009 (`claude/idp1-role-permissions`) also uses the number `0563`, now taken on main
    and applied on staging, so it must renumber before it merges.
- **2026-11-04, C5a — the visual check.** `workers/checker/` (`checkVisual`, prompt `checker@1`): Claude vision over
  the still as it fills the format's frame, BEFORE any text (our overlay is writing, so `no_glyphs` must not see
  it), answering each `AD_VISUAL_CHECKS` item `pass`/`fail` with the reason first. Any fail is `check_failed` (the
  creative state's name — `failed` is the rail's, a call that errored). The tool's schema holds exactly the items
  that apply, strict, so an item cannot be skipped or added; one that does not apply (`equipment_matches_reference`
  for a scene with no equipment) is recorded `not_applicable` by us, so all six are stored. A scene with equipment
  and no reference photo is refused before any call (`no_reference`).
  - **The AI rail takes images** (§3 gap 1 of the C5 handoff): `UserContent` = a string or text/image parts, an
    image being BYTES we hold (never a URL). `describeUserContent` puts each image's sha256 + size in the ledger's
    `request` and its hash, computed by the rail from the bytes; an image over the API's 5 MB is refused before the
    `started` row. One rail, one row. ⚠ The rail forces its tool, which `claude-sonnet-4-6` accepts; Opus 5.5,
    Sonnet 5.5 and Fable 5.1 answer a forced `tool_choice` with 400 — noted at `callForcedTool`'s types.
  - **The text band is cut out by us, not located by the model.** Measured: told the band as fractions, the model
    placed it wrong both ways (wheels at 0.4 of the height "in" a band from 0.62; a truck truly in the band "above"
    it). Now `cutBand` crops it (sharp) and sends it as image 3; the model only says what the crop shows.
  - **Corpus:** 10 images generated 2026-11-04 with the developer's Higgsfield login (`gpt_image_2_5`, medium, 1k,
    0.5 credits each), stored at 768 px JPEG (~1 MB total) in `fixtures/images/`: a reference photo, three clean
    scenes, and one per checklist item (lettering, an ACME Logistics mark, a box truck, a melted cab, a driver under
    `people_policy: none`, a truck across the band) plus an instruction typed into the photo label. `truth.planted`
    says what each image IS; `expect` what the recording reached. Three hand-written answers prove the judge (one
    fail fails; a missing item and an extra item are off-schema).
  - **`ads:eval checker` = recall.** `EvalWorker.agrees` (new, optional): a judge is right when it refuses the
    planted defect and passes a clean image. Prompt iterations, all measured: 8/10 (a 400-character reason cap threw
    away two right answers → cap 1000, ask < 300; make compared → type only), 9/10 (band located by fractions),
    **10/10, twice** with the cut band. Real defect images also fail items nobody planted (the trucks' wheels sit
    in the band); the recordings show it.
  - **Q-AD27** (new, plan): the maker's-badge and type-not-make rules are our reading; recommendation recorded.
  - Readiness: **Checker stays L0** — its L1 is C5a (pinned now) plus C5b (compose: three checks, one regeneration,
    stop with the reason), so the `notBuilt` line names C5b; L2 (the corpus) is pinned. No migration.
  - Mutation: 18 mutants (rail hash/bytes/size, ledger storing bytes, applicability, n/a vs fail, a gap read as a
    pass, the band's axis, the band and the reference not sent, fit never/always re-encoding, the key's format,
    `people_allowed`, a non-strict schema, `agrees` accepting any refusal) — 18 of 18 killed.
- **2026-11-04, C5b1 — one creative composed, and compose may answer "not yet".** `compose/composeCreative.ts`
  moves one `ads_creatives` row as far as it can per run: copy (attempt 1) → art → render → per format the still
  framed (`frameStill`, the overlay's own crop, now exported so the checker sees the ad's exact pixels) → overlay
  in EN and ES (the render check) → the visual check with the band the overlay actually covered (union of both
  languages' boxes) → `ready` with copy, assets (`{format, language, sha256, path, width, height}` per PNG,
  stored by hash; "already exists" is success) and checks, or `check_failed` with the reason in `last_error`.
  Every call is keyed, so a re-run replays. Not wired yet (C5b2).
  - **Runner `pending`** (C5 handoff §3 gap 2): `WorkerResult` gains `{ok:false, pending:true, why}`; the runner
    answers `idle` / `pending: <why>`, no move and no row. The tick re-queues it: `idx_jobs_active_dedup` (0095)
    holds a dedup key only while `queued`/`running`. No machine change.
  - **Regeneration = visual only** (D-AD12 item 2). A copy refusal, an overlay refusal, a budget, a switched-off
    agent or a priced-nowhere model (`price_unknown`, every render until V4) stops at once, visibly. "The failure
    added to the prompt" is OUR fixed clause per failed check (`REGENERATION_CLAUSES`, shared `artDirection.ts`,
    inserted before `NO_LETTERING`), never the checker's reason — a reason quoting the lettering it saw would ask
    for it. The `safe_zone_clear` clause is format-neutral (the band is low in 1:1/4:5, mid-frame in 9:16).
  - **New contract field `overlay_slots: {headline, cta}`** on the preset recipe: nothing said which copy slot
    the overlay draws. Nullable with default null (stored presets still parse); compose refuses
    `no_overlay_slots` rather than guess from slot names. E2's preset editor must ask for it.
  - A stopped creative is `check_failed`: 0537 has no state for "the workers stopped", and leaving it
    `generating` would show work that is not happening. Said in the file.
  - `ads_creatives`' first writer pinned in `table-writers.json`; its producer waiver retired.
  - **Not built, said so:** the render still does not START from the kit photo (D-AD9 image-to-image; the
    Higgsfield upload docs are unread). `ads_render` (C3's job) has no producer yet: compose takes a `render`
    function, and C5b2 decides whether compose calls `renderStep` directly or queues the job.
  - Mutation: 21 mutants (bounds of the attempt loop, clauses dropped / not carried / unordered, pending turned
    into a stop, a finished creative reworked, the overlay-slot guard, copy and overlay refusals ignored, a visual
    fail ignored, the unframed image checked, no reference, one language, the regeneration count, both state
    guards, the band's union, the runner's pending, both `overlay_slots` refinements) — 21 of 21 killed.
- **2026-11-04, C5b2 — compose wired: the campaign's part.** `compose/composeCampaign.ts` is the orchestrator's
  `compose` worker (`workers.ts`). C5's done-when is met: a planted glyph image fails, a planted foreign logo fails
  (C5a), a second failure stops with the reason (C5b1). **Checker L2.**
  - **The draw (D-AD11)** with seed = the campaign id, excluding presets a `launching`/`live` campaign for the same
    brief runs (its approved/live creatives' preset keys), stored once in `ads_campaigns.preset_draw`
    (`storePresetDraw` in `transitions.ts`, `ads_campaigns`' one writer; guarded `is null`, a racing run reads the
    first draw back). The first `BATCH` = 2 presets of the order (plan v4). A drawn version no longer the newest is
    read by id.
  - **A creative per preset per stint.** The row id is derived from campaign + preset + `state_changed_at`, so a
    racing insert collides (23505 → read the winner), and "made in this stint" is the id, not a DB-clock vs
    app-clock comparison. A row that ended `check_failed`/`rejected` in an earlier stint (Resume, Regenerate) is
    superseded (`supersedes_id`); anything else is kept.
  - **Verdict:** any creative pending → `pending`; ≥ 1 ready → `creatives_ready` (review shows the failed ones with
    reasons); none → `compose_failed` with every reason. Stops first with no brand kit (Q-AD14), or with more than
    one (which kit a campaign uses is E3's to choose, not ours to guess).
  - **Renders stay one at a time.** Found while wiring: calling `renderStep` from compose would run under
    `ads_step`'s cap (2), and `creditGate` counts renders in flight, so two at once could both pass the month and
    overspend it by one render — the reason C3 capped `ads_render` at 1. So compose's render is `queuedRender`:
    read the row (`renderStatus`, new, read-only), queue `ads_render` as a queue row if it is not finished (never
    `dispatchJob`: in-process mode would render inline), answer `pending`. `renderStatus` also answers the two
    refusals `renderStep` makes WITHOUT a row (`price_unknown`, renderer off), so compose cannot wait forever for a
    row that will never be written.
  - **`HIGGSFIELD_STILL_MODEL = null`** (`prices.ts`): which model draws stills is V4's, with its price. Until then
    every compose stops at the render, visibly ("no still model chosen yet (V4)").
  - Mutation: 19 mutants (seed, re-draw, live exclusion, exhausted, kit count ×2, batch size, stint identity ×2,
    supersedes, the insert race, pending, the ≥ 1-ready verdict, the regeneration setting, the draw's guard, a
    refusal queued, the job's dedup key, `renderStatus`'s refusals, the null model) — 19 of 19 killed.
- **2026-11-04, S1a — a campaign names its brand kit (Track S, migration only).** Track S's first step is the
  campaign doors; nothing writes an `ads_campaigns` row yet. Compose refuses an org with more than one kit
  ("which one this campaign uses is not chosen"), so which kit a campaign uses had to be decided before the
  create door could be: plan §9 **Q-AD28**, candidates (a) a column, (b) always the newest kit, (c) one kit per
  org, **recommendation (a)**, built as (a).
  - `0566_ads_campaign_brand_kit.sql`: `ads_campaigns.brand_kit_id`, nullable, composite FK to
    `ad_brand_kits (org_id, id)` `on delete restrict`, partial index. The KIT, not a version: a kit's next
    version (a corrected phone) reaches the campaign's next creative; the version a creative used stays on
    the creative (`brand_kit_version_id`).
  - **Deploy window:** a new column on an existing table, so its first reader (S1b's create door and
    campaign read, in `transitions.ts` and `routes/`) is the next merge. Compose reading it is Track W's file
    (`compose/composeCampaign.ts`) and follows S1b.
  - Also: Q-AD27 had been inserted in the middle of Q-AD26's paragraph (C5a); Q-AD26 is whole again.
  - Matrix `ads-foundation.test.mjs` +4 (own kit accepted, another carrier's refused 23503, a named kit
    cannot be deleted 23001, an unnamed one can). Mutation: no FK (2 fail), `set null` (1 fail), id-only FK
    (chain fails, no RESULT) — 3 of 3 killed.
  - **Found, not built here:** recruiting's `AdBriefSource` (D-AD17) is declared in `ads/contracts.ts` and
    has no implementation. The create door needs it; S1b adds it as a read-only file in
    `modules/recruiting/leads/`, handed to the ads router by the composition root as `LeadSink` is.
- **2026-11-04, B2c split + B2c1** — Track W (the workers), from `HANDOFF-2026-11-04-ADS-STAGE1-TRACKS.md`. C5b2
  (#2021) was already merged (`a605402`). Main `43ef245` at start (rebased on `cde0c14`), newest migration `0566_ads_campaign_brand_kit.sql` (Track S's S1a). No
  migration here. B2c is two PRs: **B2c1** the image, the ad creative and the ad, on FakeMeta; **B2c2** lead intake
  reads every form, then `createPaused`.
  - `platforms/meta/publisherAds.ts`: for every APPROVED creative (D-AD12) in every language, three steps:
    - upload the feed image (`act_/adimages`, base64 `bytes`);
    - make the ad creative (`object_story_spec.link_data`: `image_hash`, `link` `https://fb.me/`, primary text,
      headline, APPLY_NOW → that language's `lead_gen_form_id`);
    - make the ad, PAUSED, in the campaign's one ad set.
    The creative and the ad are `ensure` levels like the campaign's: find by name, adopt one, refuse two, read back
    by id and compare (image, words, form, Page; the ad's creative and ad set). The upload is re-sendable instead:
    Meta answers one hash per set of bytes (our reading, marked in FakeMeta). `platform_refs` gains
    `meta_ad_ids`, which launch already turns on.
  - **Found and decided, not routed around:**
    - **A form per language.** A Spanish ad must open a Spanish form, so a campaign has two. `naming.ts` names
      the form and the ad with their language (`…|EN`). Only the simulator had named a form.
    - **Which words Meta shows.** The preset now names them: `platform_slots {primary_text, headline}`, never an
      overlay slot. Without it the publisher refuses (`no_platform_slots`) rather than guess from slot order. It
      is `nullish` rather than defaulted, so recipe literals typed before it (Track S's route tests) still
      compile. **Track S:** E2's preset editor asks for it, as it asks for `overlay_slots`.
    - **Q-AD29, which image** (plan §9): a lead ad's `link_data` takes one image, and Meta's placement-
      customization page never mentions lead ads. Each ad shows 4:5, else 1:1; the 9:16 waits for L4.
  - **Why `createPaused` is still null:** lead intake finds a campaign by ONE `platform_refs->>meta_form_id`
    (`leadgenWebhook.ts`, `leadFetch.ts`, `backfill.ts`). Wired now, every Spanish lead would match no campaign.
    B2c2 teaches intake `meta_form_ids`, then wires.
  - FakeMeta: `fakeMetaAds.ts` holds images, creatives and ads (hash on the account, fb.me link, the six CTAs, the
    form on the creative's Page). Readiness: Publisher L1's B2c gap becomes pinned tests plus the wiring gap (still
    L0); L2 gains the image/creative/ad faults, and keeps the alert gap.
  - Mutation: 18 publisher/fake mutants plus 6 naming/contract mutants. 23 killed. The survivor was a no-op: a
    surplus-field check the name's round-trip already makes. The line was deleted.
- **2026-11-04, E4 — the leads screen: read, then work.** The leads track's E4a and E4b1–4
  (`HANDOFF-2026-11-04-LEADS-E4.md`, `HANDOFF-2026-11-04-LEADS-E4B3.md`), one docs entry merged last. No readiness row
  moved: nothing here has met a real Meta lead, and **nobody has used the screen on staging as a recruiter.** Every
  browser pass was an admin on stubbed data, and the step-up route was stubbed too, so the real password check on
  Delete details has not run.
  - **E4a, who already called** (#2015, `4decc9b`). `GET /recruitment/leads/:id/contacts`, recruitment view, newest
    first, at most 200. Purged leads are included, their notes withheld (`note: null, note_withheld: true`; Q-AD30).
  - **E4b1, one lead by id** (#2019, `f126b77`). `GET /recruitment/leads/:id`, any status, so a notification can open a
    lead the loaded queue does not hold. `also` comes from `recruiting_lead_matches`.
  - **E4b2, the screen, reading only** (#2020, `4306819`). Leads tab, `recruitment.leads` surface, queue and drawer,
    `deepLinkFor` for `lead_new` and `lead_uncontacted`. Phase E's line corrected to `features/recruitment/`.
  - **E4b3, working a lead** (#2026, `3f30e30`). Web only: log a contact, make an applicant, hold or lift
    do-not-contact, for `session.can("recruitment")` and never on a purged lead.
    - A double press is stopped by a flag set at once, not `isPending`, which vue-query reports a tick late.
    - The outcome starts empty, so a skipped default cannot become a false append-only row.
    - With an open applicant matched, nothing is preselected: a match only means "may be the same person".
    - Each act refreshes on settling, not success: a refusal means the drawer was out of date.
    - Lifting answers `stop_remains`, and the toast then says the number stays held.
  - **E4b4, delete details and manual add** (#2028, `19cd96f`). Delete details shows by `canPurgeLead(session.role)`,
    says what it does, then `StepUpPrompt` through `useStepUpRetry`. Manual add validates with `manualLeadSchema`, and
    also refuses a mistyped phone beside a good email, which the schema passes and the api would store as nothing.
    `OpeningListItem` joined `opening.ts`, the one change outside web.
  - **Found by the browser pass, not the unit test:** `useConfirm` over a `SlideOver` counts as a press outside it. The
    drawer closed, the lead id cleared, and the request went out as `DELETE /leads//do-not-contact`. The unit test had
    mocked the dialog. Every question in the drawer now replaces its body, as contract §6.2 says.
  - **Left out on purpose:** no search (the api has none, and searching a loaded page says "no match" for a person one
    page on); the opening's title is not on a row (a row has only `opening_id`).
  - **Known limits:** a queue row has no `purged_at`, so it says "No details on file" for a purged lead and for a form
    whose details all failed to read; two matching applicants read as "matching applicant 1" and "2", because
    `lead.drivers` carries no names; manual add reports "phone or email" only once the channel and name are valid.
  - Open from this track: Q-AD30 and Q-AD31 (plan §9). Next is owner-made campaigns, raised with the ads chat first.
