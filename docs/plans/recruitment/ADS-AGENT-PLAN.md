# Recruiting ads agent — a production Meta ads control plane with its own creative studio, and Indeed and Tenstreet feeding the same lead ledger · 2026-10-31

**Status: PROPOSED 2026-10-31; revised the same day (v2) after the owner's second message.
Q-AD2 RULED (a person launches). The money rules move to a settings page (§4b). Creative production
is added (§4a): Claude composes, Higgsfield renders, the brand kit and the visual rules are set by
the office, and 4–5 concept presets are rotated. Nothing built. Waits on Q-AD1, Q-AD3–Q-AD6 and
Q-AD8–Q-AD14 (§9), and on the access requests in §6 "Day 0".**

The owner's ask (2026-10-31): *an automated ads agent that creates, manages, runs and monitors all
our social-media ads, to get leads and improve recruitment, with Tenstreet and Indeed integrated
(most leads come from them today). Research and plan first; researched, planned and built in 4–5
days, production ready; reliable, precise, secure and safe.*

This document is the build plan for that ask. It does **not** replace
`RECRUITER-AUTOMATION-PLAN.md` (#1768, RA0 ruled 2026-10-26). It **re-orders** that plan: it pulls
the ads control plane (§4.1 items 1.2, 1.3, 1.6, 1.8, 1.9, 1.10, from RA5/RA6) and the Meta lead
intake (2.4, from RA3) ahead of the rest of RA1, and it builds only the part of RA1 they stand on
(the lead ledger 2.1, dedupe 2.10, Hiring Profile 1.1 and `leadMatch` 3.1). Every D-RA ruling
stands. Item IDs below are that plan's.

---

## 0. The answer on one page

| The ask | What five days can make production-ready | What five days cannot, and why |
|---|---|---|
| Create ads | The agent picks two of the 4–5 approved **concept presets**, Claude writes the copy (EN + ES) into the preset's fixed slots from the **opening** (pay, home time, equipment, lane), Higgsfield renders the stills and motion under the **brand kit**, and our renderer lays the exact figures and logo on top. Copy, visual and render checks run before a person approves. It then creates the campaign, ad set, Instant Form and ad **paused** (§4a). | Google, TikTok, LinkedIn: not researched against their employment policies; later adapters. |
| Run ads | A person presses **Launch** and approves every budget increase (Q-RA3 (b), ruled). Money is fenced three times: our cap in code, a Meta-enforced campaign spend cap, and the ad account's own spending limit. | Launching on its own — the owner ruled against it on 10/26. See Q-AD2 if "run" means otherwise. |
| Manage ads | The agent **pauses** on its own in the safe direction: requisition filled, cap reached, ad rejected by Meta, kill switch. It **recommends** budget moves; a person applies them. | Automatic budget reallocation — D-RA10 gates it on eight weeks of data on drivers still seated at 90 days. |
| Monitor ads | Hourly spend and delivery pull, daily reconcile, alerts (overspend, rejected ad, spend with no leads, lead not contacted), a daily brief per campaign with cost per lead. | Cost per *seated driver* needs 90 days of hires to exist. |
| Leads in | Meta leads arrive by signed webhook within seconds, with an hourly backfill so a lost webhook costs at most an hour; deduped against leads, applicants and drivers; scored by `leadMatch`; queued for a recruiter. | — |
| Tenstreet | The listener is built against Tenstreet's published push protocol, behind a switch that stays **off**. | **Going live needs Tenstreet to switch the API on** (not self-serve; one integrator quotes a $500 activation fee) and to send the schema. That takes days to weeks and is outside our control. |
| Indeed | Indeed applicants who arrive by email are read from an intake mailbox into the same ledger. | **Posting through Indeed's Job Sync API needs Indeed's approval and a developer agreement** (open to direct employers since 2026-07-31, but not self-serve). Until then postings stay manual in Indeed and Indeed spend is typed in monthly. |

**What decides the date is mostly not code.** Meta works on day 1: an app that manages only our own
ad account gets the Marketing API's Limited tier with no App Review and no Business Verification.
Tenstreet and Indeed both need a person at the vendor to approve us. The plan below ships the control plane
and still-image ads with the **Thursday 11/05 night release (live Friday 11/06)**, motion with the
**Sunday 11/08 release (live Monday 11/09)**, and finishes the two vendor connectors the day their
access arrives (§6). They are finished, not routed around (`CLAUDE.md`, "No
workarounds").

---

## 1. Ground truth, measured 2026-10-31 (main `d69f693`)

Everything in `RECRUITER-AUTOMATION-PLAN.md` §1 still holds (re-checked: no leads, requisition,
ads, hiring-profile or Tenstreet code or migration exists on main; the last migration is
`0532_scanner_relay.sql`). The rails this build uses:

| Rail | State | Evidence |
|---|---|---|
| Sealed per-org credentials (AES-256-GCM, AAD = org + purpose) | EXISTS | `apps/api/src/lib/secretBox.ts`; `medstop_credentials` (`mig/0463`) |
| Durable queue, `dedup_key`, backoff, per-kind caps for vendor calls | EXISTS | `mig/0095`; `apps/api/src/queue/worker.ts` (`kindCaps`, EFS/FleetPal pinned at 1) |
| Leased schedulers, one runner per lane | EXISTS | `apps/api/src/schedulers.ts`; `docs/WORKER-DEPLOYMENT.md` |
| Webhook signature pattern (HMAC over raw body) | EXISTS | `api/samsara/fuelEventsWebhook.ts`; `lib/telnyxSignature.ts` |
| Raw payload + re-derivable projection + idempotency key (D-PSP2) | EXISTS (pattern) | `mig/0216` |
| `notify()` with dedupe; a new category needs contract **and** DB CHECK | EXISTS | `api/messaging/notify.ts`; `shared/notificationsContract.ts`; `mig/0521:308-317` |
| Inbound mail via Microsoft Graph (EFS reports mailbox) | EXISTS | `apps/api/src/lib/graphMail.ts` |
| AI call: `callClaude` hard-wired to the fuel-risk tool; models pinned `haiku-4-5` / `sonnet-4-6` | PARTIAL | `apps/api/src/lib/anthropic.ts`; `packages/shared/src/ai.ts:11-12` |
| AI provenance pattern (`models`, `prompt_version`, `schema_hash`, tokens, failure code, review row) | EXISTS (pattern) | `mig/0448:143-186` |
| A public, token-less apply page | **NONE** — `/apply/:token` only | `apps/web/src/router/routes/auth.ts:40` |
| CAPTCHA / shared-store rate limiter for public forms | **NONE** | `middleware/applicationLimits.ts:55-58` |

The last two rows decide where an ad's click lands: **in five days it lands on a Meta Instant Form,
not on our site.** A public form on our site needs bot defence that does not exist (Q-RA11, RA5).

---

## 2. Research, read 2026-10-31 (what changed since 10/26, and what it does to the design)

**Meta access.** An app that manages only its own ad account gets `ads_management` and `ads_read`
at standard access as soon as the Marketing API product is added. Meta has renamed the tiers: the
Marketing API Access Tier is **Limited** (was "Standard") or **Full** (was "Advanced"). Limited is
rate-limited per ad account and allows one system user and one admin system user. Business
Verification is required only for Full access or for managing other businesses' accounts. → One
carrier, one ad account: Limited is enough. Our volume (a handful of campaigns, hourly reads) is far
inside it. The `kindCaps` pin of 1 keeps us there.

**Meta employment rules** (Special Ad Category `EMPLOYMENT`, mandatory for US job ads; Meta's
classifiers now apply it on their own to job-looking images):
- Audience: ages 18–65+, all genders, no ZIP, no excluded locations, radius ≥ 15 miles,
  **no lookalike or saved audiences**.
- Instant Form: **may not ask age, gender, marital status, address, city or ZIP**. On every form,
  Meta prohibits **criminal or arrest history, driver's licence numbers and health information**.
  Job-related knock-out questions are allowed. A form holds at most 15 questions.
- **Effect on the Hiring Profile:** a Meta lead can answer *Class A held*, *years of Class A* and
  *hazmat endorsement*. It **cannot** answer age (≥ 23) or any of the four disqualifiers (DUI,
  preventable accident, Clearinghouse, drug test). So for every Meta lead, `leadMatch` returns
  `unknown` on age and disqualifiers **by design**. This is correct, not a gap: those facts arrive
  with the application. The ad copy states the age floor in words ("must be 23 or older"), as Meta's
  guidance says. This closes Q-RA10 with a fallback; §9 Q-AD8 asks counsel to confirm.

**Indeed.** The 2026-07-31 release note stands: direct employers may use the Job Sync API
(GraphQL; 2-legged token with advertiser; scopes `employer_access` + `employer.hosted_job`). But
the integration guide still requires Indeed's approval and a developer agreement. As of
2026-08-31, a job with several locations or languages must be split into one posting per location
and language. **Not self-serve → not in the five days.** Q-RA5 becomes Q-AD5: request access today.

**Tenstreet.** No public schema. Activation is by request; an integrator documents a $500 fee and a
lead-source label Tenstreet fixes at setup. Tenstreet pushes application data, documents, subject
updates and Xchange data, on a schedule or per subject update, and retries until we answer
"accepted". **Not self-serve → listener built, switch off, finished when the schema arrives.** Q-RA1b
is still owed.

**A question that may remove a connector:** if Indeed applicants already flow *into* Tenstreet
(Tenstreet's job-board integrations), the Tenstreet feed brings Indeed leads as well, and the
Indeed email intake is only a stop-gap. Q-AD4.

---

## 2a. Proven practice — what carriers and ad platforms already do (v3, read 2026-10-31)

The owner, 2026-10-31: *don't reinvent the system; thousands of companies run this already;
research proven real-world examples and best practice and use them.* This section is that survey.
Every part of §3–§6 now says which proven pattern it copies. Where we still build, the reason is
written down.

### What exists on the market

| Kind | Examples | What they do | Price signals (public) |
|---|---|---|---|
| **ATS marketplace** | **Tenstreet Job Store** (already in the carrier's Tenstreet dashboard) | One posting to ~20 boards and social sites, **Facebook and Instagram included**, run as lead-generation campaigns that go to a lead form; free attribution reports (Origins); a free concierge for active clients who manages the spend across merchants | Job Store itself free; you pay the merchant per posting |
| **Managed social recruiting for CDL** | Boostpoint, Leadgamp, Conversion Interactive, Randall Reilly, CDLLife (several are Tenstreet partner agencies) | Build and optimise Meta campaigns for driver jobs; short mobile application; ATS integration (Tenstreet, DriverReach) | Boostpoint: $750/month minimum ad budget. Leadgamp: $6,000/month for ads management + ATS integration |
| **Programmatic job advertising** | Appcast, Joveo, PandoLogic | Spread a budget across job boards, bidding per click or applicant toward a target cost | Platform fee typically 10–20 % of media; PandoLogic pay-per-applicant (e.g. $25) |
| **Meta rules engines** | Meta's own Automated Rules (free), Birch (ex-Revealbot), Madgicx | Pause/scale/notify on conditions; Birch runs rules you write, Madgicx moves budget itself | Birch rules from $99/month |
| **AI creative platforms** | Smartly, Pencil, AdCreative.ai, Creatify | Brand kit → templated variants → predictive scoring → launch | $39–$249/month self-serve; Smartly enterprise ($50K+/month spend) |

### The proven practices, and what each one changes here

1. **Lead Ads (Instant Forms) beat landing pages for drivers.** Agencies that tested landing pages,
   calls, messages and Instant Experiences report lead forms win: Meta pre-fills name, phone and
   email, so applying takes two taps. → Unchanged: the ad click lands on an Instant Form (§1).
2. **Lead with real pay and real home time.** Drivers screenshot misleading ads into Facebook
   groups. → D-AD1 and D-AD9 already force every figure to come from the opening.
3. **Real equipment, real drivers.** Drivers want to see what they will drive; real-driver video
   is reported as the best-performing type. → **D-AD9 tightened (below): generated media must start
   from our real photos**, and P4 "Walk-around" (real truck, animated) becomes the lead preset.
   Invented scenes are a supplement, never the main creative.
4. **Speed to lead decides conversion.** Facebook leads are passive and apply to several carriers
   the same day. → D-AD7 unchanged (instant notify + escalation); the uncontacted-lead threshold
   is the one setting this plan treats as most important.
5. **Guardrails as rules, enforced by the platform.** Practitioners pause at about 2× target cost
   per result once a minimum spend is reached, exclude ad sets still in Meta's learning phase, and
   scale winners in steps of about 20 %. Rules start conservative on a small budget. → **D-AD3
   gains a fourth fence: our settings are also written as Meta Automated Rules**
   (`/act_<id>/adrules_library`, PAUSE / NOTIFICATION, half-hourly), so Meta enforces them even
   when our server is down. ⚠ A developer reports error 2703 when a PAUSE rule uses a spend
   condition. AD2 tests that in the sandbox, and our hourly pull stays the backstop whatever the
   answer.
6. **Many diverse creatives, few ad sets, broad targeting.** Meta's delivery rewards a pool of
   different creatives over narrow targeting (and EMPLOYMENT forbids narrow targeting anyway).
   → D-AD11's two-presets-per-campaign stands; the cap on live creatives per ad set is a setting.
7. **Defaults come from a benchmark, not a guess.** Boostpoint's 2026 benchmark for CDL drivers
   on Meta (891 campaigns): **median $26.86 per applicant, middle half $17.00–$42.31, 8 % apply
   rate**; about 37 applicants per $1,000. → The settings page ships with these as its starting
   defaults, each labelled with its source: alert above $42 per lead after 5 leads; pause an ad that
   spends $85 (≈ 2 × $42) with no lead. The owner changes them; four weeks of our own data replaces
   them (§8).
8. **Attribution to hire, not to click.** Appcast's 2025 benchmark puts the median cost per hire at
   $851 across 1,300 employers; vendors sell "listing to hire" tracking (Tenstreet Origins).
   → This is the one thing **no vendor can do for us**: only Silvicom holds the hire *and* whether
   the driver is still seated at 90 days (McLeod, Samsara). It is the reason to own the ledger
   (D-RA1), and it is RA6/11.2 of the parent plan.

### Build, buy or use what we already pay for — the honest comparison (Q-AD15)

| Option | What we get | What we give up |
|---|---|---|
| **A. Tenstreet Job Store for Facebook/Instagram** (already in the dashboard) | Campaigns run by Tenstreet; concierge; zero build | Ads, spend and leads stay inside Tenstreet; no cost per *seated* driver; no control of creative or caps in our system; ends when Tenstreet is cancelled (T2 plan) |
| **B. A managed vendor** (Boostpoint, Leadgamp, …) | Proven CDL playbook; fast start | ≥ $750/month media minimum or ~$6,000/month fees; leads arrive through an ATS integration; creative rules are theirs |
| **C. Build as planned, on Meta's own machinery** | Our caps, our brand rules, leads in our ledger, cost per seated driver; Meta does the delivery, rules enforcement and creative testing | Six build days (§6); we own the maintenance |

**Recommendation: C, built thin.** We copy the proven pieces as they are (Lead Ads, EMPLOYMENT
broad targeting, Meta Automated Rules, campaign spend caps, the benchmark defaults, real-photo
creative) and build only the parts no vendor can give us: one lead ledger tied to the hire and
the 90-day outcome, the claim checks against the opening, and the settings page. **Before AD1
starts we need one fact (Q-AD16):** if the carrier already buys Facebook through Job Store or an
agency, that is the baseline C must beat on cost per qualified lead. Both run side by side for four
weeks, and the cheaper one wins.

---

## 3. Decisions proposed (D-AD*)

All D-RA rulings apply unchanged. These add to them. None is ruled until the owner says so.

- **D-AD1 · The requisition is the only source of an ad's facts** (D-RA11 made concrete). Copy may
  state a number, a pay basis, a home-time pattern, an equipment type or a lane only when the
  requisition version holds it. Enforced by a pure `adClaims.ts` in shared (extracts every money
  figure, number-with-unit and listed term from the copy and requires each in the requisition) plus
  a forbidden-term list (age words beyond the legal floor, gendered terms, "recent graduates",
  health, criminal history). A failed check blocks *Create*, and the reason is shown. Meta's own
  review still runs after ours.
- **D-AD2 · The agent's authority is a closed table in code** (§5). *May alone:* draft, check,
  create **paused**, read, pause, report, recommend. *Only with a person's approval row:* launch,
  raise a budget, change the area, edit a live ad's copy. *Never:* target by age, gender or ZIP
  (the request builder has no such fields), message a lead (D-RA2), delete (only archive), touch
  billing, raise Meta's spending limits. A test enumerates every Meta call site and asserts its
  authority class.
- **D-AD3 · Money is fenced three times, and the fences do not trust each other.**
  1. **Ours:** `adsPolicy.ts` (pure) checks the per-channel monthly cap and the per-campaign daily
     cap before every spend-affecting call. Boundary tests at cap − 1, cap and cap + 1.
  2. **Meta's, per campaign:** every campaign is created with a lifetime `spend_cap` equal to its
     approved amount. Meta stops delivery there even if our process is down.
  3. **Meta's, per account:** the owner sets the ad account's spending limit by hand in Business
     Manager. **Our token never changes it.** The agent reads it and **refuses to launch** when it
     is unset or above the monthly cap.
  An hourly spend pull pauses a campaign at 100 % of its approved daily amount. The kill switch
  pauses every active campaign through the API and blocks new launches until a person clears it.
- **D-AD4 · Reconcile, never self-correct.** Each day, Meta-reported spend per campaign is compared
  with what was approved (`ads_actions`). An overrun, a campaign Meta reports that we did not
  create, or a status we did not set (someone edited in Ads Manager) raises an alert. Nothing is
  "fixed" silently. Edits made in Ads Manager are allowed (Ads Manager stays usable), but they are
  surfaced as `external_change` rows.
- **D-AD5 · Numbers come from a fold; the model only narrates.** Spend, impressions, clicks,
  leads, cost per lead, frequency, rejection counts and time to first contact come from a pure
  fold over stored rows (the fleet-report pattern). The daily brief's prose is generated from the
  fold's output and may not contain a number the fold did not produce (the same claim checker as
  D-AD1). This is D-RA3 applied to reporting.
- **D-AD6 · Every lead is idempotent, raw-kept and recoverable.** Meta: `leadgen_id` is the
  `external_ref`. The webhook is verified with `X-Hub-Signature-256` (HMAC-SHA256 with the app
  secret, over the raw body); an unverified request gets 401 and a counter. An **hourly** backfill
  reads each live form's leads since its cursor, so a lost webhook costs at most an hour. It is
  hourly, not the daily backfill in D-RA7, because speed to first contact is the conversion lever.
  Tenstreet and the Indeed mailbox write through the same `ingest_lead`.
- **D-AD7 · A lead is contacted by a person** (D-RA2, ruled). The system's job is speed: a new
  lead notifies its assigned recruiter at once, and a lead not contacted within the threshold
  (settings, default 15 business minutes) escalates. No automated SMS or email goes to a lead.
- **D-AD8 · Staging spends nothing.** Staging uses a Meta **sandbox ad account**, which runs the
  full API with no delivery and no billing, and the Lead Ads Testing Tool for leads. Production is
  the only environment holding the real account's token. The token is per org, sealed and never
  in an environment variable. A test asserts that the staging config cannot hold a non-sandbox
  account id.

---

## 4. What gets built

### 4.1 Schema — one migration, all new tables (new tables are exempt from the two-merge rule)

All tables are RLS-on, service-role only, and org-scoped, with `forbid_org_change()`. "Append-only"
means BEFORE triggers that fire for the service role (EI010/SO010 family), plus the table listed in
`RETENTION_FORBIDDEN`.

| Table | Purpose | Notes |
|---|---|---|
| `hiring_profiles`, `hiring_profile_versions` | 1.1 — v1 seeded from plan §3a | Versions immutable |
| `requisitions`, `requisition_versions` | 1.2 — profile version, pay, home time, equipment, lane, area (yard + radius + written reason, **never ZIP**), headcount, status | Closing one pauses its ads (1.8) |
| `recruiting_leads` | 2.1 — `channel`, `source`, `campaign_ref`, `external_ref`, `raw`, projected name / E.164 phone / `email_lower`, `status`, `assigned_to`; unique `(org_id, channel, external_ref)` | Operational, prunable later (D-RA12) |
| `recruiting_contacts` | 2.1 — append-only, one recipient, `created_by`, direction | Evidence of who contacted whom |
| `lead_match_verdicts` | 3.1 — lead × profile version × requirement → verdict, evidence level | Recomputed, never edited |
| `lead_conversions` | lead → applicant `drivers` row, carrying attribution (the handoff's trap: a table, not a column) | |
| `ads_accounts` | platform, account id, Page id, form ids, sealed token, `expires_on`, `is_sandbox` | Secrets as `medstop_credentials` |
| `ads_campaigns` | platform ids (campaign, ad set, ad, form), requisition version, approved daily and lifetime amounts, our status, Meta's last status | |
| `ads_creatives` | copy EN/ES, image ref, claim-check result, `recruiting_ai_outputs` ref, approval | |
| `ads_actions` | **append-only**: create / launch / pause / budget / archive / kill / `external_change` — actor (person or `agent`), approval ref, request, response, Meta's ids | The money audit trail |
| `ads_spend_hourly` | pulled insights: spend, impressions, clicks, leads, by campaign by hour | Pulled, so re-derivable |
| `recruiting_ads_settings` | per-channel monthly cap, per-campaign daily cap ceiling, kill-switch state, uncontacted threshold | Defaults in code (`recruiting_settings` pattern) |
| `recruiting_ai_outputs` | D-RA4 provenance for drafted copy and briefs (the `document_reads` column set) | Append-only status transitions |
| `ad_brand_kits` (+ versions) | v2, D-AD10 — logo, colours, fonts, overlay templates per format, equipment reference photos, visual-rule checklist | Assets in storage by sha256 |
| `ad_concept_presets` (+ versions) | v2, D-AD11 — hook, copy structure, slot templates, motion template, formats, enabled | Owner-edited |
| `ad_generations` | v2, D-AD13 — **append-only**: every Claude and Higgsfield call, prompt, model, request id, idempotency key, cost, asset sha256, check results | The creative audit trail |
| `recruiting_ads_settings_versions` | v2, §4b — every save of the settings page with its actor | Replaces the single settings row |

### 4.2 Shared (pure, no clock or model — `lint:boundaries`)
`hiringProfileContract.ts`, `requisitionContract.ts`, `leadContract.ts`, `leadMatch.ts` (handoff
RA1.4, with boundary tests), `adClaims.ts` (D-AD1), `adsPolicy.ts` (D-AD3 caps + the D-AD2
authority table), `adsReport.ts` (the D-AD5 fold), `metaLeadForm.ts` (maps our profile to the
allowed Instant Form questions, and refuses a prohibited question type).

### 4.3 API (`apps/api/src/modules/recruiting/ads/*` and `.../leads/*`)
- **Meta client:** Graph API version pinned in one constant; every call goes through one function
  that writes `ads_actions` before and after; `kindCaps` = 1; retries on Meta's transient codes
  only; rate-limit headers (`x-business-use-case-usage`) read and respected.
- **Jobs:** `ads_create_campaign` (paused), `ads_apply_action` (launch/pause/budget, approval
  required by type), `ads_pull_insights` (hourly, leased scheduler), `ads_reconcile` (daily),
  `meta_leads_backfill` (hourly), `lead_match_recompute`, `ads_daily_brief`.
- **Routes:** Meta webhook (GET challenge + signed POST); leads queue / lead / convert; requisition
  CRUD (versioned); campaign draft / create / approve / kill switch; Tenstreet listener (switch off).
- **Generic `callClaude`** (handoff RA1.8): the tool schema becomes an argument. The copy drafter
  uses `deep`, the brief narrator `fast`. Both are budget-gated (`withinBudget`), provenance-stamped
  and switched per org (D-RA9).
- **Notifications** (contract + DB CHECK in the same migration): `ads_overspend`,
  `ads_rejected`, `ads_no_leads`, `ads_external_change`, `ads_token_expiring`, `lead_new`,
  `lead_uncontacted`, `ads_brief`.
- **Indeed email intake:** a Graph-read mailbox (Q-AD6). Each message is stored raw; an extractor
  proposes the lead fields (provenance, `proposed`); a recruiter confirms before the lead counts.

### 4.4 Web
- `/recruitment/ads`: requisitions → campaigns. Draft (the agent writes EN/ES; the claim check is
  shown line by line) → **Create paused** → **Launch** (approval) → live tiles from the fold (spend
  vs cap, leads, cost per lead, rejections) → Pause / Archive. A kill switch is in the header,
  visible only to those who may use it.
- `/recruitment/leads`: queue sorted `hard met → fewest unknowns → freshness`; every row says
  *why*; source text beside the projected fields; Contacted / Convert.
- `/settings/recruiting`: Hiring Profile editor (saving creates a version), ads caps, ad-account
  connection status (never the token), and the AI notice copy (HB 3773).
- A failed-jobs page (handoff RA1.10): the ads jobs must not fail where nobody can see (D-RA8).
- All of it is built from `packages/ui` under `docs/DESIGN-SYSTEM-CONTRACT.md`, with dates in
  MM/DD/YYYY and the browser pass on the three fixtures (failure, empty, staging).

---

## 4a. Creative production (v2, the owner's 2026-10-31 second message)

The owner's words: *use our Higgsfield connection for images and motion, our Anthropic API and
skills to compose the ads, be able to set rules for this, control the visual and design rules, and
keep 4–5 viral/trending concept presets that the system picks at random instead of reinventing a
concept each time; precise, secure, really controlled, easy to use and automated.*

### Research behind it (read 2026-10-31)

- **Higgsfield has a server API** (`https://api.higgsfield.ai`; header
  `Authorization: Key <id>:<secret>`). It is asynchronous: submit a request, then poll
  `/requests/{id}/status` or receive a webhook. Submissions accept an `Idempotency-Key`. **Output
  files are kept for at least seven days only**, so we copy each one into our storage at once.
  Keys come from Higgsfield Cloud. There is an official Python client; the JS SDK is "coming soon",
  so we call REST. ⚠ **What we have today is the `higgsfield` CLI on a Mac**, signed in as the
  development account. That is not a server integration. Production needs its own API key, sealed
  per org like the Meta token, with its own credit budget (Q-AD10).
- **Anthropic.** Ad composing is a single structured call, not an agent loop: one request with a
  `strict` JSON schema returns the copy and the filled prompt slots. Anthropic's runtime "Agent
  Skills" run inside a code-execution container, which is more machinery and attack surface than
  a copywriting call needs. **"Our skills" therefore become versioned prompt packs in the repo**
  (system prompt + schema + fixtures), held to the regression gate 12.6 of the parent plan. The
  design skills we use in Claude Code (`banner-design`, `design-system`, `impeccable`) are used at
  build time, to design the presets and overlay templates, not at run time (Q-AD11).
  ⚠ The current model generation (Opus 5.5 / Sonnet 5.5 / Haiku 5.5) **rejects forced
  `tool_choice`**, which `callClaude` relies on today. The generic helper (handoff RA1.8) uses
  structured outputs (`output_config.format`) or `strict` tools with `auto`. Model choice stays in
  `AI_MODELS`, per agent, and is decided by the fixture gate (Q-RA22), not by this plan.
- **Meta and AI images.** Ordinary (non-political) ads do not have to declare AI use. Meta itself
  adds an "AI info" label when it detects AI, including from C2PA metadata (third-party sources say
  since June 2026). The label shows beside "Sponsored" only when the image has a **photorealistic
  AI-made person**. → The presets prefer trucks, roads and cabs over AI-made faces.
- **FTC 16 CFR 465** (in force 2024-10-21): a testimonial by someone who does not exist, or who did
  not have the experience, is prohibited; an AI avatar is not banned by itself. → **No preset puts
  words in a generated person's mouth.** Quotes come only from real drivers with a signed release
  (Q-AD13).
- **Employment-ad law on images** (Title VII §704(b); ADEA, 29 CFR 1625.4): an ad may not indicate
  a preference by age, sex, race and so on, and pictures can do that as well as words. → A visual
  rule: generated people, when there are any, vary across the set, and no set shows only one
  demographic. Counsel confirms the wording (Q-AD8).
- **"Trending" cannot be fetched reliably.** Meta's Ad Library API returns only political and
  social-issue ads outside the EU, and no API reports what is "viral". → Presets are curated by a
  person and versioned. The system measures which preset works *for us* (§8) and reports it.

### D-AD9 · The image model never writes text or numbers, and starts from our real photos
**v3 (proven practice 3):** wherever a preset shows equipment, the generation is *image-to-image*
or *image-to-video* from a real photo in the brand kit (Higgsfield takes an uploaded image as
input — the day/night pair in the Higgsfield memory is the same technique). A preset may use a
text-only scene (road, sky, a cab interior) only when it shows no equipment and no person.
Generated images and video carry **no lettering**: every prompt ends with "no text, no logos, no
lettering", and the visual check (D-AD12) rejects any frame with glyphs in it. Pay, home time, the
call to action, the logo and the "Equal Opportunity Employer" line are **composited by our own
renderer** (server-side, from templates in the brand kit). The figures therefore come straight
from the requisition and are always exact. The precision of an ad never depends on an image model
spelling "$0.68/mile" correctly.

### D-AD10 · The brand kit and the visual rules are data, versioned, set in Settings
`ad_brand_kits` (versioned) holds the logo files, the brand colours, the fonts, the overlay
templates per format (1:1 and 4:5 feed, 9:16 Stories/Reels) with their safe zones, the reference
photos of our real equipment (tractor make and colour, trailer types), and the visual rules as a
closed list of checks (allowed and forbidden elements, people policy, text coverage, competitors'
marks). Each ad records the brand-kit version it was made under, so a past ad can be explained.

### D-AD11 · Concept presets: 4–5, versioned, rotated with a recorded seed
A preset (`ad_concept_presets`, versioned, owner-edited) is a fixed recipe, **not a free prompt**:
the hook formula, the copy structure, the image prompt *template* with named slots (equipment,
time of day, setting), the motion template, the overlay template and the formats. The model
**only fills the slots** from the requisition and the brand kit; it cannot change the concept.

**Selection: random, but fair and reproducible.** For each new campaign, the system draws from the
enabled presets **excluding any preset already live for the same requisition**. The draw is
uniform until §8 has data. Its seed is stored, so the same inputs show why that preset was picked.
Each campaign carries **two creatives from two different presets** in one ad set, so Meta's
delivery compares them and our report learns from it. Reweighting toward winners is a
*recommendation* until D-RA10's data exists, then a switch.

**Starting presets** (proposed; the owner edits them before AD3, Q-AD12):

| # | Preset | Format | What it shows | Why it works for drivers |
|---|---|---|---|---|
| P1 | **Windshield sunrise** | 9:16 motion (Reels/Stories), 4:5 still | POV from the cab at dawn on an open highway, slow push-in; overlay: pay + home time | First-person "this could be your morning" is the most-copied trucking Reels hook |
| P2 | **The number** | 1:1 / 4:5 still | A late-model tractor (from our equipment reference), dark background; the pay figure large in the overlay | Drivers scan for the pay; it answers the first question in one second |
| P3 | **Home on time** | 4:5 still, 9:16 motion | The truck pulling into a quiet street at dusk, porch light on; no faces needed | Home time is the top reason drivers change carriers |
| P4 | **Walk-around** | 9:16 motion | Slow orbit of our actual equipment (image-to-video from the reference photo) | Shows real equipment, not stock photos — a trust signal |
| P5 | **Straight talk** | 1:1 carousel (3 cards) | Card 1 what you get, card 2 what we need (from the Hiring Profile), card 3 how to apply | Self-qualifies: fewer junk leads (the "not 1,000 junk leads" rule) |

### D-AD12 · Every creative passes three checks before a person sees it
1. **Copy check** (pure, D-AD1): every claim is in the requisition, no forbidden term, the length
   fits each placement, and both EN and ES are present.
2. **Visual check** (Claude vision, a fixed checklist from the brand kit): no glyphs or lettering,
   no foreign logos, the equipment matches the reference type, no malformed people or vehicles,
   the people policy is met, and the overlay's safe zone is clear. Each item is answered
   `pass/fail` with a reason and stored with provenance. A fail **regenerates once** with the
   failure added to the prompt, then stops and shows the reason. It never loops on credits.
3. **Render check** (pure): the composited overlay's text measures inside its safe zone and meets
   the contrast floor, measured over the zone the text occupies (the measuring trap recorded in
   the Higgsfield memory). Video length and aspect ratio are within Meta's limits.

Only a creative with three greens can be approved; a person still sees and approves every one.

### D-AD13 · Generation is a ledgered, budgeted, idempotent job
`ad_generations` (append-only) records each Claude call and each Higgsfield request: preset and
brand-kit versions, the full prompt, the model, the Higgsfield request id, the `Idempotency-Key`
(= our generation id), cost (tokens; Higgsfield credits), status, the stored asset's sha256 and
path. Higgsfield's webhook (or a poll as backstop) completes the job. The asset is copied into our
storage at once (outputs expire after seven days). Monthly budgets for Anthropic tokens and for
Higgsfield credits are settings (§4b). An exhausted budget is a recorded `budget_exhausted`, not a
crash, and it never blocks pausing or monitoring.

### The one-screen flow (easy to use)
**New campaign → pick the opening → the system picks two presets, writes, renders and checks
(about 2–4 minutes for stills; motion takes longer and arrives when ready) → one review screen
shows every format of both creatives with the three checks → Approve (or "Regenerate this one" /
"Edit copy") → Create (paused) → Launch.** That is four clicks for a recruiter and one for the
approver. Nothing on the screen asks for a prompt.

---

## 4b. The Ads control settings page (v2 — replaces Q-AD7's "tell me the numbers")

`/settings/recruiting/ads` is admin-only to edit (the *ads approve* action, Q-AD3) and readable by
recruiters. Every save writes a new version with its actor; nothing is edited in place.

| Group | Settings | Enforced where |
|---|---|---|
| **Spending limits** | monthly cap per channel; maximum daily budget per campaign; maximum lifetime per campaign; the largest raise one approval may make (in % and $) | `adsPolicy` before every call (D-AD3) + Meta's campaign `spend_cap` |
| **Account guard** | the ad account's spending limit as Meta reports it (read-only), shown beside the monthly cap with a red state when it is missing or higher | Launch refuses (D-AD3 fence 3) |
| **Auto-pause rules** | pause when cost per lead exceeds $X after Y leads; when $Z is spent with no lead; when frequency exceeds N; at the daily cap; when the opening is filled. **Defaults from the 2026 CDL benchmark (§2a.7), labelled with their source** | written to Meta as Automated Rules (§2a.5) **and** checked by our hourly pull; each pause ledgered with its rule |
| **Approvals** | who may launch, raise or change the area (from the permission matrix, not a role list); whether a second approver is needed above $X | the approval route |
| **AI and rendering budgets** | Anthropic tokens per month; Higgsfield credits per month; maximum regenerations per creative | D-AD13 |
| **Alerts** | who gets each alert (overspend, rejected, no leads, external change, budget nearly used); the uncontacted-lead threshold | `notify()` categories |
| **Kill switch** | one button, with the reason required; shows what it paused | D-AD3 |

The same page shows **spend control live**: month-to-date spend against each cap, per campaign
today and lifetime, the forecast to month end at the current daily budgets, AI and render credits
used, and the reconcile status. The figures come from the D-AD5 fold, so the settings page and the
ads page can never disagree.

---

## 5. The agent's authority table (D-AD2) — the thing that makes it safe

| Action | Who may | Guard |
|---|---|---|
| Draft copy, check claims | agent | D-AD1; provenance row |
| Create campaign / ad set / form / ad | agent, **status PAUSED** | requisition approved; claim check green; `special_ad_categories=['EMPLOYMENT']` set in code; Meta `spend_cap` set |
| Launch | person with *ads approve* (Q-AD3) | account limit present and ≤ monthly cap; caps; kill switch clear |
| Raise a budget | person with *ads approve* | `adsPolicy` caps |
| Lower a budget, pause | agent or person | always allowed — the safe direction |
| Pause on requisition filled / cap / rejection / kill | agent, automatically | logged with its cause |
| Edit a live ad's copy | person | the edit re-runs the claim check and goes back through Meta review |
| Change area or targeting | person | radius ≥ 15 mi; no ZIP field exists |
| Archive | agent (after its requisition closes) or person | never delete |
| Pick presets, compose, render, check, regenerate once | agent | D-AD11–D-AD13; within the AI and render budgets |
| Approve a creative | person | three green checks (D-AD12) |
| Edit the brand kit, presets, settings | admin | versioned; actor recorded |
| Message a lead | **nobody automated** | D-RA2 |
| Billing, payment method, account spending limit | **owner, in Meta only** | not in our token's code paths |

---

## 6. The schedule, with the release train (v2: creative production adds two build days)

Releases run at 01:07 CT, Sunday to Thursday nights, after the owner approves the candidate; there
is no release on Friday or Saturday night. A merge reaches staging in minutes. The migration number
is checked by *name* before merge (a parallel chat may take 0533). `/code-review` and
`/security-review` run on every PR as it goes, not saved for the end.

| Day | Merges (each a PR, CI green, merged by hand) | Done when (measured) |
|---|---|---|
| **0 · Sat 10/31** | This plan. **Owner:** the questions in §9; Tenstreet email (Q-AD4); Indeed Job Sync request (Q-AD5); in Meta: Business Manager, ad account, Page, the account spending limit, an app with the Marketing API, a system user, a sandbox ad account; **a Higgsfield Cloud API key** (Q-AD10); **the brand kit assets** (Q-AD14) | Each request has a sent date in the log |
| **1 · Sun 11/01** | **AD1:** migration (all §4.1 tables, creative tables, settings versions, notify categories) · shared: `leadMatch`, `adClaims`, `adsPolicy`, `adsReport`, preset + brand-kit contracts, `presetDraw` (seeded), render-check geometry | Boundary tests on every rule; matrix proves `ads_actions` and `ad_generations` refuse UPDATE/DELETE for the service role. **Release Sun night** → schema in production |
| **2 · Mon 11/02** | **AD2:** Meta client + sealed account + create-paused + approvals + kill switch + caps · lead webhook + hourly backfill + `ingest_lead` + dedupe | Staging (sandbox): a campaign is created paused with EMPLOYMENT and `spend_cap`; cap + 1 refused; a test lead arrives once by webhook and once by backfill and is stored once |
| **3 · Tue 11/03** | **AD3: the creative engine** — generic Claude helper (structured outputs), the composer prompt pack + fixtures, Higgsfield client (stills, webhook + poll, idempotency key, copy to storage), visual check, overlay renderer, `ad_generations` | From a fixture requisition, P2 and P5 produce creatives whose overlay figures equal the requisition's; a planted glyph frame fails the visual check; a replayed generation does not spend credits twice |
| **4 · Wed 11/04** | **AD4: the screens** — settings page (§4b), brand kit + preset editors, the one-screen campaign flow, the leads queue | A recruiter on staging goes from opening to a paused sandbox campaign in four clicks; an admin launches it; a test lead shows in the queue with its verdicts |
| **5 · Thu 11/05** | **AD5: monitoring** — insights pull, reconcile, auto-pause rules, alerts, daily brief, failed-jobs page · the full staging walk. **Release Thu night if the walk passes** | Forced overspend → paused + alert; Ads Manager edit → `external_change`; forced job failure listed |
| **Fri 11/06** | **Production, still images:** owner connects the real accounts, sets the limits, approves the presets, launches the first campaign at a small budget | First real lead reaches a recruiter; the brief arrives next morning |
| **6 · Sun 11/08** | **AD6:** motion (image-to-video for P1, P3, P4; 9:16) · Indeed mailbox intake · Tenstreet listener (switch off) · the mutation pass written into each PR. **Release Sun night** | A motion creative passes the visual check on sampled frames; an Indeed email becomes one proposed lead |
| **Mon 11/09** | **Production, motion** | First Reels creative approved and launched |
| **When the vendors answer** | Tenstreet schema → listener on; Indeed approval → Job Sync posting (1.5) | A pushed Tenstreet subject is stored once and answered "accepted"; an Indeed posting goes live from an opening |

**The date, said plainly.** Static-image Meta ads with the full control plane: **Friday 11/06**.
Motion and the Indeed mailbox: **Monday 11/09** — the two added build days are the creative
engine and its screens, and there is no Friday or Saturday release. The risks are (a) the Day 0
setup (without a Meta system-user token and a Higgsfield key, AD2/AD3 are tested only against
recorded responses and are not production-ready); (b) a release the owner does not approve, which
moves everything a day; (c) Meta's review of the first real ad (usually under 24 h). Writing code
faster solves none of them.

---

## 7. Security and safety review (done in AD5, recorded here as the checklist)

- The token is sealed per org (AAD = org + `meta_ads`). It is never logged, never returned to the
  SPA, and carries the least scopes (`ads_management`, `ads_read`, `leads_retrieval`,
  `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`). `expires_on` raises an
  alert 14 days ahead.
- Webhook: raw-body HMAC with a constant-time compare; replay bound on the lead's `created_time`;
  the body-size limit applies; the verify token for the GET challenge is held as a separate secret.
- Lead PII: service-role only, org-scoped, `expectOrgScoped` in every service test; never sent to
  a model except the fields the copy or brief needs (D-RA5's allowlist test). Copy drafting never
  sees a lead.
- Prompt injection: lead text and email bodies reach a model only in the extractor, whose output is
  `proposed` until a person confirms it, and whose tool schema cannot trigger an action.
- Money: §3 D-AD3 + §5. The kill switch works even when the API is degraded (it is a DB flag every
  spend path reads, *then* the pause calls).
- Higgsfield: the key is sealed per org (AAD = org + `higgsfield`), never on a developer's Mac in
  production; its webhook is verified, otherwise the job polls; asset URLs are fetched only from
  Higgsfield's host (allowlist) and stored by sha256; the credit budget is checked before submit.
- Brand-kit uploads go through the upload gate that knows files by their bytes (type sniffed, not
  trusted from the name); SVG logos are sanitised or rasterised before use.
- No lead data, applicant data or person's name ever reaches the composer or Higgsfield: they see
  the opening, the brand kit and the preset only (D-RA5's allowlist test extends to both).
- Gates: `lint:migrations`, `check-rls.mjs`, `lint:upserts`, `lint:boundaries`,
  `lint:table-lifecycle`, `lint:filesize`/`funcsize`, `lint:comment-claims`, `lint:secrets`; all CI
  jobs; `/code-review` and `/security-review` on AD2 and AD4.

---

## 8. How we will know it works (baselines first, targets after four weeks — plan §8)

Cost per lead and per *qualified* lead (recruiter-confirmed Class A + experience) per campaign;
median minutes from lead to first contact; share of leads converted to an application; reconcile
mismatches (target: zero unexplained); Meta rejections per creative; agent agreement (drafts
approved without edits vs edited); per preset: cost per qualified lead, visual-check first-pass
rate, and Higgsfield credits per approved creative.

---

## 9. Open questions (owner unless marked)

- **Q-AD1 · Scope of "all social media" for the five days.** Candidates: (a) Meta (Facebook +
  Instagram) only; (b) + Google Ads; (c) + TikTok/LinkedIn. **Recommendation (a):** Meta is where
  the owner already runs ads (Q-RA7f), and each extra platform needs its own employment-policy
  research and adapter. *Fallback:* (a).
- **Q-AD2 · RULED 2026-10-31: (a).** A person launches; the agent may pause and lower on its own.
- **Q-AD3 · Who may approve spend?** **Recommendation:** admin only, a new *ads approve* action in
  the permission matrix (not a hand-written role list); recruiters draft and create paused.
  *Fallback:* admin only.
- **Q-AD4 · Tenstreet (= Q-RA1b).** Account manager's name, monthly cost, renewal date, the API
  activation fee, **and whether Indeed applicants already land in Tenstreet**. Please email the
  account manager today asking for the API (push of subjects to our URL) and its schema.
- **Q-AD5 · Indeed.** How is Indeed used today: free or sponsored postings, who posts, where
  applicants go (Indeed Apply → email? → Tenstreet?), and monthly spend? Please submit the Job Sync
  integration request today. *Fallback:* manual posting, email intake, spend typed in monthly.
- **Q-AD6 · Intake mailbox** (= Q-RA12). A new M365 mailbox (e.g. `jobs@`) read through Graph.
  **Recommendation:** yes — the code and credentials exist. *Fallback:* the paste box.
- **Q-AD7 · RULED 2026-10-31: a settings page** (§4b), not numbers in code. Still owed: the first
  values (= Q-RA7f-ii). *Fallback:* nothing launches until they are set; the code refuses.
- **Q-AD8 · Counsel** (adds to Q-RA6): confirm that Instant Form questions on Class A, years of
  experience and hazmat are acceptable, and the wording of the age floor in the ad. *Fallback:*
  those three questions only; age stated in the copy; the open counsel memo status (sent?) is still
  UNVERIFIED from §1.3 of the parent plan.
- **Q-AD9 · The first requisition.** Pay (basis + range), home time, equipment, lanes, the yard and
  radius with its operational reason (= Q-LS2, **never ZIP**), headcount. The agent cannot write an
  ad without it, by design (D-AD1).
- **Q-AD10 · Higgsfield for production.** A Higgsfield Cloud API key for the server (not the CLI
  login), which account pays, and a monthly credit cap. *Fallback:* no rendering; AD3 is built
  against recorded responses and the ads page offers no "generate" until a key exists.
- **Q-AD11 · What "our skills" means.** (a) The Claude Code design skills we already use, applied
  at build time to design presets and overlay templates; (b) runtime Anthropic Agent Skills in a
  code-execution container. **Recommendation (a)**, with the composing rules held as a versioned
  prompt pack in the repo: one structured call is cheaper, faster, and has no sandbox to secure.
  *Fallback:* (a).
- **Q-AD12 · The five presets.** Approve, edit or replace P1–P5 (§4a) before AD3. Each one is
  editable later in Settings, versioned. *Fallback:* P2 and P5 only (stills; nothing invented).
- **Q-AD13 · Real drivers.** May we use real drivers' photos or words? Only with a signed release
  stored on their record. *Fallback:* no people in quotes; generated scenes favour trucks, roads and
  cabs (FTC 16 CFR 465; Meta's "AI info" label beside a photorealistic AI person).
- **Q-AD15 · Build, buy, or Job Store** (§2a): A Tenstreet Job Store, B a managed vendor, C build
  thin on Meta's machinery. **Recommendation C**, run beside whatever is live today for four weeks.
  *Fallback:* C.
- **Q-AD16 · What runs today.** Does the carrier already buy Facebook/Instagram through Job Store,
  an agency, or by hand in Ads Manager? Monthly spend and cost per applicant if known. *Fallback:*
  no baseline; §8 starts from zero.
- **Q-AD14 · The brand kit.** The logo as vector, the colours, the font (if any), the company name
  exactly as it should read, the phone number shown, and 5–10 real photos of our tractors and
  trailers from several angles (these become the reference images, so generated trucks look like
  ours). *Fallback:* no logo overlay; equipment drawn generically, which weakens P4.

---

## Sources (read 2026-10-31)

**Meta** — [Marketing API authorization](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization) ·
[Meta Marketing API: access tiers, permissions](https://www.lilachbullock.com/meta-marketing-api/) ·
[Meta Ads API setup and limits (2026)](https://admanage.ai/blog/meta-ads-api) ·
[Special Ad Category for employment: 2026 rules (Boostpoint)](https://boostpoint.com/meta-special-ad-category/) ·
[Why Facebook rejects job ads (Boostpoint)](https://boostpoint.com/facebook-job-ad-rejected/) ·
[Special Ad Categories (Jon Loomer)](https://www.jonloomer.com/special-ad-categories-meta-ads/) ·
[Facebook Lead Ads for recruiting (Boostpoint)](https://boostpoint.com/facebook-lead-ads-for-recruiting/)

**Indeed** — [Release notes 2026](https://docs.indeed.com/release-notes/2026#2026-05-15) ·
[Job Sync API guide](https://docs.indeed.com/job-sync-api/job-sync-api-guide) ·
[Job postings](https://docs.indeed.com/job-postings/) ·
[Integration basics](https://docs.indeed.com/integration-basics) ·
[Indeed API guide 2026 (100Hires)](https://100hires.com/indeed-api.html)

**Tenstreet** — [What you need to know about Tenstreet's API](https://www.tenstreet.com/blog/integrations-2/tenstreets-api-guide-everyone-else/) ·
[Tenstreet integrations](https://www.tenstreet.com/integrations) ·
[LeadsBridge: Tenstreet](https://leadsbridge.com/documentation/tenstreet/)

**Proven practice (v3)** — [Tenstreet integrations / Job Store merchants](https://www.tenstreet.com/integrations) ·
[Tenstreet: Facebook in Job Store](https://www.tenstreet.com/blog/job-store/facebook-now-available-job-store) ·
[Tenstreet FAQs](https://www.tenstreet.com/tenstreet-faqs) ·
[FreightWaves: Tenstreet automated marketing tools](https://www.freightwaves.com/news/tenstreets-automated-marketing-tools-help-recruiters-target-the-right-drivers) ·
[Boostpoint: CDL recruiting costs and 2026 benchmarks](https://boostpoint.com/industries-trucking/cdl-driver-recruiting-costs-channels/) ·
[Leadgamp](https://leadgamp.com/) ·
[Leadgamp: social media for truck drivers](https://leadgamp.com/blog/tpost/g6ybd5j5z1-how-to-use-social-media-to-recruit-truck) ·
[Recruit truck drivers on social media (2026)](https://otrucking.com/resources/guides/social-media-recruiting-truck-drivers/) ·
[MA Team: driver recruiting channels](https://mateam.net/truck-driver-recruiting-channels/) ·
[Joveo: programmatic platforms 2026](https://www.joveo.com/blog/best-programmatic-job-advertising-platforms/) ·
[Programmatic job advertising costs (Prepzo)](https://prepzo.ai/blog/programmatic-job-advertising) ·
[Birch: Facebook ads automation](https://bir.ch/blog/facebook-ads-automation) ·
[Birch: automated rules cheat sheet](https://bir.ch/facebook-automated-rules) ·
[Madgicx vs Birch 2026](https://www.get-ryze.ai/blog/madgicx-vs-birch-revealbot-2026) ·
[Meta: schedule-based ad rules](https://developers.facebook.com/documentation/ads-commerce/marketing-api/ad-rules/guides/scheduled-based-rules) ·
[Meta: ad rule reference](https://developers.facebook.com/docs/marketing-api/reference/ad-rule/) ·
[Report of error 2703 on spend-condition PAUSE rules](https://github.com/MojoTheApe/adopy-campaing-launcher/issues/787) ·
[AI ad creative platforms 2026 (Superside)](https://www.superside.com/blog/ai-ad-creative-generators)

**Creative (v2)** — [Higgsfield API docs](https://docs.higgsfield.ai/docs) ·
[Higgsfield API reference](https://docs.higgsfield.ai/docs/api-reference/overview) ·
[Higgsfield quickstart](https://docs.higgsfield.ai/docs/quickstart.md) ·
[Official Higgsfield platforms](https://higgsfield.ai/creator-hub/help-center/getting-started/official-higgsfield-platforms) ·
[AI images in Facebook ads: Meta's rules (Showfolk)](https://www.showfolk.ai/blog/ai-generated-images-facebook-ads-rules) ·
[AI ad disclosure requirements 2026 (CineRads)](https://www.cinerads.com/blog/ai-ad-disclosure-requirements) ·
[Does Meta allow AI-generated ads? (Mockingbird)](https://www.mockingbirdhouse.com/learning/ai-ad-creative/does-meta-allow-ai-generated-ads) ·
[FTC final rule banning fake reviews and testimonials](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials) ·
[Sidley: FTC rule on fake and AI-generated reviews](https://www.sidley.com/en/insights/newsupdates/2024/08/us-ftcs-new-rule-on-fake-and-ai-generated-reviews-and-social-media-bots)

---

## Progress log

- **2026-10-31** — Plan written at the owner's request ("automated ads agent … built in 4–5
  days, production ready"). Research refreshed: Meta's tiers renamed (Limited/Full); own-account
  use needs no App Review or Business Verification; employment Instant Forms may not ask age or
  location, and no form may ask criminal history or a licence number, so age and disqualifiers stay
  `unknown` for Meta leads by design; Indeed Job Sync is open to direct employers but needs
  approval; Tenstreet API activation is by request (a fee is reported). Re-orders
  RECRUITER-AUTOMATION-PLAN: ads control plane + Meta intake pulled forward on top of the
  lead-ledger part of RA1. **Nothing built.**
- **2026-10-31, later (v2)** — Owner's second message. **Q-AD2 ruled:** a person launches. **Q-AD7
  ruled:** the money rules live on a settings page (§4b) with spend shown live. Creative production
  added as §4a (D-AD9–D-AD13): Claude composes into fixed preset slots; Higgsfield renders through
  its server API (the CLI login on the Mac is not production); the image model never writes text,
  so the figures are composited by our renderer from the opening; the brand kit and the visual
  rules are versioned data; 4–5 presets rotate by a recorded seeded draw, two per campaign; every
  creative passes copy, visual and render checks before a person approves it. Research: Higgsfield
  outputs expire after seven days; Meta labels AI content itself and shows the label beside
  "Sponsored" only for a photorealistic AI person; the FTC bans testimonials from people who do
  not exist; the current Claude models reject forced `tool_choice`. Schedule moved: stills Friday
  11/06, motion Monday 11/09. **Nothing built.**
- **2026-10-31, later still (v3)** — Owner: *don't reinvent; research proven real-world systems
  and best practice.* Added §2a: the market (Tenstreet Job Store already runs Facebook/Instagram
  lead campaigns for carriers; managed CDL vendors; programmatic platforms; Meta rules engines; AI
  creative platforms), eight proven practices, and the build/buy comparison (Q-AD15, recommends
  building thin on Meta's own machinery and running it beside today's channel for four weeks).
  Changes: our limits are also written as Meta Automated Rules (spend-condition PAUSE to be tested,
  error 2703 reported); setting defaults come from Boostpoint's 2026 CDL benchmark (median $26.86
  per applicant); generated media starts from our real equipment photos. Q-AD16 asks what runs
  today. **Nothing built.**
