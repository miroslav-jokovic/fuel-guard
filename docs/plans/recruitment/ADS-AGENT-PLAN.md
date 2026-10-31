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
| Create ads | The agent makes one creative per approved **concept preset** (4–5 distinct concepts in one ad set, §2b.2); Claude writes the copy (EN + ES) into the preset's fixed slots from the **opening** (pay, home time, equipment, lane), Higgsfield renders the stills and motion under the **brand kit**, and our renderer lays the exact figures and logo on top. Copy, visual and render checks run before a person approves. It then creates the campaign, ad set, Instant Form and ad **paused** (§4a). | Google, TikTok, LinkedIn: not researched against their employment policies; later adapters. |
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

## 2b. The same machine in other industries (v4, read 2026-10-31)

The owner, 2026-10-31: *this concept is used in every industry; borrow from all of them, not only
recruitment.* Recruiting is a lead-generation business with extra rules (EMPLOYMENT targeting,
FCRA, HB 3773). The engine underneath is the one that DTC brands, insurance agencies, home-service
contractors, real-estate and auto dealers run on Meta every day. These are their proven practices,
and what each does to this plan.

1. **Send the outcome back to Meta (Conversions API for CRM → "Conversion Leads").** Standard in
   insurance, home services and real estate. The CRM sends each lead's stage changes (keyed by
   Meta's `leadgen_id`, `action_source: system_generated`) through the Conversions API. Meta then
   shows the ad to people who become *qualified* leads, not just people who fill in forms.
   Meta reports 15–21 % lower cost per quality lead (Meta's own figures, no methodology published).
   Since April 2026, Meta's qualified-lead goal for new Instant Form campaigns **requires** this
   feed. Eligibility: about **200 leads a month**, uploads at least daily, and a stage that 1–40 %
   of leads reach within 28 days.
   → **Adopted (D-AD14).** Our ledger already knows each stage, so we send `contacted`, `qualified`
   (recruiter-confirmed), `applied` and `hired` from day one. Volume check: at the benchmark
   $26.86 per lead, 200 leads ≈ **$5,400 a month**. Below that, campaigns run on the plain lead
   goal while the feed builds history, and the switch is offered when the volume is there.
   ⚠ Whether Conversion Leads is available under the EMPLOYMENT category is **not documented
   anywhere we found** — tested in the sandbox in AD2 (Q-AD17).
2. **Concept diversity beats volume (Meta's Andromeda retrieval, 2025–26).** Meta treats
   near-duplicate creatives as one, and calls "creative diversification" its best lever. It
   recommends fewer ad sets with *diverse* creatives in each. Practitioners measure in **distinct
   concepts**: four or more per ad set, the largest concept under 40 % of the ads, a refresh every
   one to three weeks, and new creatives added two at a time into a working ad set. Meta's own
   Delivery column flags "Creative fatigue" and "Creative limited".
   → **D-AD11 revised:** the presets *are* the concepts. One campaign and one ad set per opening,
   holding 4–5 concepts (one creative per preset, both languages), not "two presets per
   campaign". The rotation draw decides *which variant* of a concept is made next and in what
   order new ones enter, two at a time. Fatigue is read from Meta's delivery flags and from cost
   per qualified lead rising to 2× the concept's own history. A fatigued creative is paused and its
   preset's next variant is proposed for approval.
3. **Speed to lead is an integration metric.** Lead-gen playbooks: the lead reaches the CRM within
   5 minutes; past 10 minutes, fix the integration before touching the ads. Contact within 5
   minutes is widely cited as converting several times better (the figure traces to sales
   lead-response studies, not to trucking). Home-service contractors with automated speed to
   contact report 18–28 % lead-to-booked against 8–14 % without it.
   → Measured separately: **webhook-to-ledger latency** (target < 1 min; alert at 5) and
   **ledger-to-first-contact** (the recruiter metric, D-AD7). The second never excuses the first.
4. **Judge quality, not cost per lead, and respect the lag.** Every lead-gen playbook reports
   lead-to-qualified, -appointment and -close *by ad*, and warns that recent cohorts look worse
   because qualification takes days. Meta's learning phase in local lead gen is quoted at 30–45
   days, and rules act only past a minimum spend.
   → The fold (D-AD5) reports **by lead-date cohort** and greys out cohorts younger than the
   median days-to-qualify. Auto-pause rules need minimum spend and minimum leads before they act
   (defaults in §4b), and never act on an ad set Meta marks as learning, except the spend caps.
5. **A naming taxonomy makes creative analysis possible.** Creative-analytics tools (Motion and
   others) parse ad names into fields (`DATE_FORMAT_HOOK_ANGLE`); without consistent names "you
   lose most of the value". For video they track **hook rate** (3-second plays ÷ impressions;
   about 25–35 % is solid on cold audiences) and **hold rate** (ThruPlays ÷ 3-second plays;
   40–50 % average).
   → Every Meta object we create is named by code, never by hand:
   `S360_<opening>_<preset>-v<n>_<format>_<lang>_<yyyymmdd>`. The same fields are stored as
   columns, so the report never parses names. Hook and hold rate are computed for every video
   creative and shown per preset.
6. **Rules engines over autopilots.** Agencies split into rule-runners (you write the rules,
   e.g. Birch) and autopilots (the tool moves budget, e.g. Madgicx). The trade they name is
   visibility into why a decision was made.
   → Confirms D-AD2/D-RA10: written rules with their reasons; budget moves only as
   recommendations until the data exists.
7. **Structure: one campaign per objective, few ad sets, broad targeting, a separate small test
   campaign for experiments, about 50 optimisation events a week per ad set.**
   → One campaign per opening; area experiments (a second radius, a second yard) go in a separate
   test campaign under its own cap, never inside the live one.

---

## 2c. Four platforms, the company accounts, Higgsfield, and the orchestrator (v5, owner's message 2026-10-31)

The owner: *no Job Store (Q-AD15 → C, build). Use our company accounts for Facebook, Instagram,
X and TikTok. Our Higgsfield connection has made our videos before, so the ads agent uses it too.
Should we have separate smaller agents, each in charge of one task, and an orchestrator that runs
the whole operation?*

### Company accounts: connected through each platform's own sign-in, never by password
Every proven ads tool (Birch, Smartly, Hootsuite, Boostpoint) connects the *company's* account the
same way. An admin presses **Connect** in our Settings, signs in on the platform's own page with
the company's business login, and approves the requested permissions. We receive a token. **We
never see, store or type the company's password.** Automating a password login breaks on two-factor
codes, trips the platforms' security checks, and breaks their terms, which risks a ban on the
company's own page. Tokens are sealed per org (`secretBox`, AAD = org + platform), refreshed by a
leased job, and their expiry raises an alert. Disconnecting is one button, and the platform's side
can always revoke.

| Platform | How the company account connects | Access we must request | Job-ad rules | Leads back to us | Readiness |
|---|---|---|---|---|---|
| **Facebook + Instagram** | One Meta connection (Business Manager → system user); Instagram is a placement of the same campaign | Marketing API, Limited tier — at once, no review (§2) | EMPLOYMENT category: no age/gender/ZIP, ≥ 15 mi, no lookalikes | Instant Form webhook + hourly backfill; Conversions API back (D-AD14) | **Day 1** |
| **TikTok** | TikTok for Business account + Business Center; our developer app; the admin authorises by OAuth | Developer profile → developer app review, **2–3 business days** (TikTok); 3–7 days (third parties); a form since 2026-03-20 only if we ask for "TikTok Accounts" scope (we do not) | **HEC Special Ad Category toggle** for US job ads: age and gender targeting removed (official); ZIP and lookalikes also removed according to secondary sources | TikTok Instant Form (lead-gen) libraries are in the Marketing API; leads pulled by API, webhook to be confirmed in AD-T | **~3–5 business days after the app request** |
| **X** | X Ads account; our developer app; the admin authorises by OAuth | **Ads API access is granted through an X representative**; no self-serve form; rate limits are fixed | Not yet researched to the same standard (Q-AD21) | Lead cards and their API: to verify (Q-AD21) | **Unknown — depends on X** |

Each platform is one **adapter** behind the same interface (create paused, launch, pause, budget,
read spend, read leads, apply rules). The control plane, caps, settings page, creative studio and
ledgers are shared and are built once. Adding TikTok is an adapter, not a second system. **Meta
ships first** because it is where the drivers and the benchmark data are (§2a). TikTok follows
the day its app is approved; X follows when X grants access.

**Organic posts are a different capability** (posting to the company's feed, not paid ads). They
need different APIs: Meta content publishing, the TikTok Content Posting API (whose audit third
parties put at 1–4 weeks), and X's paid API tiers. Not in this build unless the owner asks (Q-AD19).

### Higgsfield: what "our connection" is, measured on the Mac 2026-10-31
- The `higgsfield` CLI is signed in by **browser OAuth (PKCE)** as the development account. It
  stores a personal access and refresh token in `~/.config/higgsfield/credentials.json` and spends
  the account's **plan credits**. The video project `Silvicom-360-Videos` used exactly this,
  through the `higgsfield-generate` skill (defaults: GPT Image 2.5 for stills, Seedance 2.5 for
  video), with Remotion composing the finished film.
- Higgsfield's help centre: **the API is a separate product with separate, prepaid USD billing;
  plan credits do not extend to the API, and API charges never touch the plan.** The API uses a
  key (ID + secret, shown once) created at open.higgsfield.ai and kept server-side. The CLI and MCP
  use "your higgsfield.ai account, no API key".
- **Marketing Studio** (in the CLI) already does much of what §4a planned to build: brand kits,
  ad modes (`product_showcase`, `tv_spot`, `ugc`, …), presets, and a **Virality Predictor**. Over
  the API only "Marketing Studio Image" (with presets) is documented; brand kits are not.

**Decision proposed (D-AD15): same Higgsfield, server-grade connection.** The ads agent uses the
same Higgsfield models, presets and prompting that made our videos, through the **API key** of a
Higgsfield API account, sealed per org with its own prepaid budget. Running the CLI's personal
login unattended on a server would tie production to one person's token on one machine. It would
fail silently when the refresh token lapses, and it would mix ad spend into the creative team's
plan credits. That is a workaround in this repo's sense (`CLAUDE.md`). If the owner chooses it
anyway (Q-AD20), it ships labelled as one, with what removes it.
- **Reuse, not rebuild:** the overlay renderer (D-AD9) is the **Remotion** composition from
  `Silvicom-360-Videos` (already proven on our own trucks and fonts), moved into a package. Our
  presets map onto Higgsfield's own presets and modes where they fit. Testimonial-style `ugc` and
  `product_review` modes with AI presenters stay off (FTC 16 CFR 465, §4a). The Virality Predictor
  score is shown beside each creative as information, **never as a gate**, until §8 shows whether
  it predicts our cost per qualified lead.

### The orchestrator and the agents (D-AD16)
**Yes to small modules with one job each. The orchestrator is code, not a model.** This is
Anthropic's own published guidance: use a *workflow* (predefined code paths) when the task's
structure is stable; use an LLM *orchestrator* only when the subtasks cannot be known in advance.
An ad campaign's lifecycle is the same every time (brief → create → check → approve → publish →
watch → learn), and every step touches money or the law. A model deciding *which step runs next*
would be the least controlled part of the system. Anthropic also measured multi-agent setups
at ~15× the tokens of a chat, and others report concurrent agents making conflicting choices. Both
argue against an LLM in charge of spend.

So the **Orchestrator** is a deterministic state machine per campaign, running on our durable job
queue and leased schedulers (D-RA8). It owns the state, the order, the retries, the approvals and
the ledgers. It calls these workers, each with one contract, its own switch (D-RA9), its own budget
and its own fixture tests:

| Worker | Kind | Its one job | May not |
|---|---|---|---|
| **Brief** | code | Turns an opening + profile version into the ad brief (facts, allowed claims, area) | invent a fact |
| **Copywriter** | Claude | Fills a preset's copy slots EN/ES from the brief | change the concept, state a figure not in the brief |
| **Art director** | Claude | Fills the preset's image/motion prompt slots from the brand kit and reference photos | write text into images |
| **Renderer** | Higgsfield + Remotion | Generates stills/motion, composites the exact overlay | spend past the render budget |
| **Checker** | code + Claude vision | Copy, visual and render checks (D-AD12); one regeneration | approve |
| **Publisher** | code, one adapter per platform | Creates paused, launches on approval, pauses, sets caps and platform rules | launch or raise without an approval row |
| **Budget guard** | code | Every spend-affecting call passes `adsPolicy`; the kill switch | be bypassed: it is the only path to an adapter's spend calls |
| **Monitor** | code | Hourly pull, reconcile, auto-pause rules, fatigue flags | change a budget upward |
| **Lead intake** | code (+ Claude for email) | Webhooks, backfills, mailbox, dedupe, `leadMatch` | contact a lead |
| **Outcome feed** | code | Sends lead stages back to each platform (D-AD14) | send anything but id + stage |
| **Analyst** | code fold + Claude narration | Daily brief, cohort report, recommendations | state a number the fold did not produce; act |

Five of the eleven workers use a model; none of them decides what happens next, touches money,
or contacts a person. Each worker is a folder under `apps/api/src/modules/recruiting/ads/` with
its own contract in `packages/shared`, so a worker can be replaced (another image vendor, another
platform) without touching the others. That is the "smaller modules in charge of smaller tasks"
the owner asked for.

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
**v4 (§2b.2):** one ad set per opening holds one creative per enabled preset (4–5 distinct
concepts), so Meta's delivery compares concepts and our report learns from it. New creatives enter
two at a time, in the order the seeded draw sets. Reweighting toward winners is a
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

### D-AD14 · Lead outcomes go back to Meta (§2b.1)
Each stage change in the ledger (`contacted`, `qualified` (a recruiter's confirmation), `applied`,
`hired`) enqueues one Conversions API event for that `leadgen_id`. Events are idempotent by
`event_id` = our stage-row id, batched at least daily, and carry no data beyond the lead id and the
stage. Hashed contact fields are added only if Meta's match rate requires them, and counsel
approves first (Q-AD8). Disabled per org by a switch; the send is ledgered like every vendor call.

### The one-screen flow (easy to use)
**New campaign → pick the opening → the system makes one creative per preset, writes, renders and checks
(about 2–4 minutes for stills; motion takes longer and arrives when ready) → one review screen
shows every format of every creative with the three checks → Approve (or "Regenerate this one" /
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
- **Q-AD15 · RULED 2026-10-31: C, build.** No Job Store.
- **Q-AD16 · What runs today.** Does the carrier already buy Facebook/Instagram through Job Store,
  an agency, or by hand in Ads Manager? Monthly spend and cost per applicant if known. *Fallback:*
  no baseline; §8 starts from zero.
- **Q-AD17 · Conversion Leads under EMPLOYMENT** (us, AD2 sandbox): is the optimisation goal
  offered for an EMPLOYMENT campaign? *Fallback:* the plain lead goal; the CAPI feed still runs,
  so the history exists when it is offered.
- **Q-AD18 · Budget against Meta's volume floors** (owner): Conversion Leads wants about 200 leads
  a month (≈ $5,400 at the benchmark), and leaving the learning phase wants about 50 results a week
  per ad set. Is the monthly Meta budget near that? *Fallback:* one ad set per opening, the plain
  lead goal, and the switch is offered when the volume is there.
- **Q-AD19 · Organic posts too?** Paid ads only (this plan), or also posting to the company's
  Facebook, Instagram, X and TikTok feeds? *Fallback:* paid ads only; organic posting gets its own
  plan (different APIs and audits).
- **Q-AD20 · Higgsfield connection.** (a) A Higgsfield API account with a server key and its own
  prepaid budget (D-AD15, recommended); (b) the CLI's personal login running on the server,
  labelled as a workaround. *Fallback:* (a); until it exists, the creative studio runs against
  recorded responses and the ads page offers no "generate".
- **Q-AD21 · X** (us, after the owner contacts X): Ads API access through X's representative; X's
  employment-ad policy and lead-card API, researched to the same standard as Meta and TikTok
  before any X adapter is built. *Fallback:* X waits.
- **Q-AD22 · Platform order** (owner): Meta first (Day 1), TikTok when its app is approved, X when
  access is granted. *Fallback:* that order.
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

**Platforms, Higgsfield and agents (v5)** — [TikTok HEC ad policy](https://ads.tiktok.com/resources/help/article/housing-employment-credit-hec-ad-policy) ·
[TikTok: create a developer app](https://business-api.tiktok.com/portal/docs/create-a-developer-app/v1.3) ·
[TikTok Marketing API](https://business-api.tiktok.com/portal/docs/marketing-api/v1.3) ·
[TikTok form libraries](https://business-api.tiktok.com/portal/docs/get-form-libraries/v1.3) ·
[TikTok Marketing API v1.3 explained (Soku)](https://soku.ai/blog/tiktok-marketing-api-v1-3-explained) ·
[Boostpoint: TikTok recruiting 2026](https://boostpoint.com/tiktok-recruiting/) ·
[PPC Land: special ad categories](https://ppc.land/special-ad-category/) ·
[X Ads API: getting started](https://docs.x.com/x-ads-api/getting-started) ·
[X Ads API: increasing access](https://docs.x.com/x-ads-api/getting-started/increasing-access) ·
[Higgsfield: what is the API](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-the-higgsfield-api) ·
[Higgsfield Marketing Studio Image API](https://docs.higgsfield.ai/docs/models/marketing-studio-image/generate-and-edit) ·
[Higgsfield Python client](https://github.com/higgsfield-ai/higgsfield-client) ·
[Anthropic's effective-agents patterns (AgentPatterns)](https://agentpatterns.ai/patterns/agent-design/anthropic-effective-agents-framework/) ·
[Workflow vs agent playbook](https://mer.vin/2026/05/when-not-to-build-ai-agents-anthropics-workflow-vs-agent-playbook/) ·
[Anthropic's multi-agent research architecture](https://theaiengineer.substack.com/p/how-anthropic-built-multi-agent-deep)

**Cross-industry (v4)** — [Meta conversion leads + CRM feedback (MarketingQL)](https://marketingql.com/blog/meta-conversion-leads-crm-feedback/) ·
[Conversion Leads & Conversions API for CRM (Zephra)](https://zephraai.com/guides/meta-ads-academy/conversion-leads-optimization) ·
[CAPI for lead ads (LeadSync)](https://leadsync.me/blog/meta-conversions-api-lead-ads/) ·
[Meta's shift to lead optimisation (Click Here Digital)](https://www.clickheredigital.com/insights/meta-shift-to-lead-optimization) ·
[Meta lead ads guide 2026 (AdLibrary)](https://adlibrary.com/posts/meta-lead-ads-guide-2026) ·
[Meta ads for lead generation 2026 (AdLibrary)](https://adlibrary.com/posts/meta-ads-for-lead-generation) ·
[Home service lead-gen benchmarks 2026](https://www.nowbookedmarketing.com/blog/home-service-lead-generation-benchmarks-2026) ·
[Insurance lead generation 2026 (brandID)](https://brandid.app/blog/insurance-lead-generation) ·
[Meta Andromeda guide (Confect)](https://confect.io/tactics/meta-andromeda-2026) ·
[Andromeda: why creative diversity drives delivery (Soku)](https://soku.ai/blog/meta-andromeda) ·
[Andromeda creative playbook (Segwise)](https://segwise.ai/blog/meta-andromeda-update-creative-strategy-2026) ·
[Creatives per ad set (AdScale)](https://adscale.com/blog/how-many-ad-creatives-per-ad-set/) ·
[Andromeda changes (Jetfuel)](https://jetfuel.agency/metas-2026-algorithm-update-what-andromeda-changed-and-how-to-adapt-your-ads/) ·
[Video creative benchmarks 2026 (AdSights)](https://www.adsights.ai/resources/guides/video-creative-metrics-benchmarks-2026-guide) ·
[Hook rate benchmarks 2026 (Sepia Lab)](https://sepia-lab.com/en/blog/hook-rate-benchmarks) ·
[Motion app technical guide](https://www.datashake.fr/en/articles/motion-app-complete-technical-guide-audit)

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
- **2026-10-31, v4** — Owner: *borrow from every industry, not only recruiting.* Added §2b: the
  CRM-to-Meta outcome feed (Conversions API for CRM / Conversion Leads; mandatory for the
  qualified-lead goal since April 2026; ~200 leads/month floor) adopted as D-AD14; Andromeda's
  concept diversity turns the presets into the ad set's 4–5 concepts (D-AD11 revised: one ad set
  per opening, fatigue from Meta's flags and 2× own history, new creatives two at a time);
  webhook-to-ledger latency measured apart from recruiter response; cohort reporting with
  qualification lag; a code-generated naming taxonomy; hook and hold rate for video; a separate
  test campaign. Q-AD17 (Conversion Leads under EMPLOYMENT — undocumented, sandbox test) and
  Q-AD18 (budget against Meta's volume floors). **Nothing built.**
- **2026-10-31, v5** — Owner: no Job Store (**Q-AD15 ruled C**); company accounts for Facebook,
  Instagram, X and TikTok; Higgsfield as used for our videos; small agents plus an orchestrator.
  Added §2c. Accounts connect by each platform's OAuth with the company's business login, never by
  password. Meta ships first, TikTok after app review (2–3 business days per TikTok; HEC toggle),
  and X when X's representative grants Ads API access. Each platform is an adapter behind one
  interface. Measured: the CLI uses a personal OAuth login and plan credits, while Higgsfield's API
  is separate, key-based and prepaid → D-AD15 recommends an API key, and Q-AD20 asks. The Remotion
  composition from Silvicom-360-Videos is reused as the overlay renderer; Marketing Studio presets
  are reused where they fit; Virality Predictor is shown, never a gate. D-AD16: the orchestrator is
  a deterministic state machine on the job queue, calling eleven single-job workers (five use
  Claude; none decides, spends or contacts). New questions Q-AD19–Q-AD22. **Nothing built.**
