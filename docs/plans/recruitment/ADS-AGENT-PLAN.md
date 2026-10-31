# Recruiting ads agent — five days to a production Meta ads control plane, with Indeed and Tenstreet feeding the same lead ledger · 2026-10-31

**Status: PROPOSED 2026-10-31. Nothing built. Waits on the owner's answers to Q-AD1–Q-AD9 (§9)
and on three access requests the owner starts today (§2, "Day 0").**

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
| Create ads | The agent drafts each ad (EN + ES) from a **requisition** — pay, home time, equipment, lane — and refuses any claim the requisition does not hold; it creates the Meta campaign, ad set, Instant Form and ad **paused**. | Google, TikTok, LinkedIn: not researched against their employment policies; later adapters. |
| Run ads | A person presses **Launch** and approves every budget increase (Q-RA3 (b), ruled). Money is fenced three times: our cap in code, a Meta-enforced campaign spend cap, and the ad account's own spending limit. | Launching on its own — the owner ruled against it on 10/26. See Q-AD2 if "run" means otherwise. |
| Manage ads | The agent **pauses** on its own in the safe direction: requisition filled, cap reached, ad rejected by Meta, kill switch. It **recommends** budget moves; a person applies them. | Automatic budget reallocation — D-RA10 gates it on eight weeks of data on drivers still seated at 90 days. |
| Monitor ads | Hourly spend and delivery pull, daily reconcile, alerts (overspend, rejected ad, spend with no leads, lead not contacted), a daily brief per campaign with cost per lead. | Cost per *seated driver* needs 90 days of hires to exist. |
| Leads in | Meta leads arrive by signed webhook within seconds, with an hourly backfill so a lost webhook costs at most an hour; deduped against leads, applicants and drivers; scored by `leadMatch`; queued for a recruiter. | — |
| Tenstreet | The listener is built against Tenstreet's published push protocol, behind a switch that stays **off**. | **Going live needs Tenstreet to switch the API on** (not self-serve; one integrator quotes a $500 activation fee) and to send the schema. That takes days to weeks and is outside our control. |
| Indeed | Indeed applicants who arrive by email are read from an intake mailbox into the same ledger. | **Posting through Indeed's Job Sync API needs Indeed's approval and a developer agreement** (open to direct employers since 2026-07-31, but not self-serve). Until then postings stay manual in Indeed and Indeed spend is typed in monthly. |

**What decides the date is mostly not code.** Meta works on day 1: an app that manages only our own
ad account gets the Marketing API's Limited tier with no App Review and no Business Verification.
Tenstreet and Indeed both need a person at the vendor to approve us. The plan below ships everything
we control by the **Thursday 11/05 night release (live Friday 11/06 morning)**, and finishes the two
vendor connectors the day their access arrives. They are finished, not routed around (`CLAUDE.md`, "No
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
| Message a lead | **nobody automated** | D-RA2 |
| Billing, payment method, account spending limit | **owner, in Meta only** | not in our token's code paths |

---

## 6. Five days, with the release train

Releases run at 01:07 CT, Sunday to Thursday nights, after the owner approves the candidate. A
merge reaches staging in minutes. The migration number is checked by *name* before merge (a
parallel chat may take 0533).

| Day | Merges (each a PR, CI green, merged by hand) | Done when (measured) |
|---|---|---|
| **0 · Sat 10/31** | This plan. **Owner:** answers Q-AD1–9; emails the Tenstreet account manager (Q-AD4/Q-RA1b); submits the Indeed Job Sync request (Q-AD5); in Meta: Business Manager, ad account, Page, the account spending limit, an app with the Marketing API, a system user, a sandbox ad account | Each request has a sent date in the log |
| **1 · Sun 11/01** | **AD1:** migration (all §4.1 tables + categories) · shared contracts, `leadMatch`, `adClaims`, `adsPolicy`, `adsReport` with boundary tests | Fixture tests cover every rule's edge; matrix shows append-only `ads_actions` refusing UPDATE/DELETE for the service role. **Release Sun night** → schema in production |
| **2 · Mon 11/02** | **AD2:** Meta client + sealed account + create-paused + approvals + kill switch + caps · webhook + hourly backfill + `ingest_lead` + dedupe | On staging (sandbox): a campaign is created paused with EMPLOYMENT and `spend_cap`; a cap + 1 request is refused; a test lead arrives once via webhook and once via backfill and is stored once |
| **3 · Tue 11/03** | **AD3:** web — ads page, leads queue, profile + caps settings · generic `callClaude` + copy drafter + claim check · `lead_new` notify | A recruiter on staging drafts → creates → (admin) launches a sandbox campaign; a test lead appears in the queue with its verdicts and a notification |
| **4 · Wed 11/04** | **AD4:** insights pull, reconcile, auto-pause rules, alerts, daily brief · failed-jobs page · Indeed mailbox intake · Tenstreet listener (switch off) | Forced overspend → paused + alert; forced Ads Manager edit → `external_change` alert; forced job failure is listed on the page |
| **5 · Thu 11/05** | Hardening: mutation pass on every guard (each PR lists the mutation that went red), the security review, the full staging walk, the runbook. **Release Thu night** | Owner's staging walk passes; the release PR body lists the approver's steps |
| **Fri 11/06** | Production: owner connects the real ad account, sets caps, launches the first campaign at a small budget | First real lead reaches a recruiter; the brief arrives the next morning |
| **When the vendors answer** | Tenstreet schema → listener on; Indeed approval → Job Sync posting (1.5) | A pushed Tenstreet subject is stored once and answered "accepted"; an Indeed posting goes live from a requisition |

**Risk to the date, said plainly:** five merges in five days is the pace this repo has kept
(e.g. Maintenance M1–M9, 10/28–10/29). The risks are (a) the owner's Meta setup on day 0 — without
a system-user token, AD2 is tested only against recorded responses and cannot be called
production-ready; (b) a release night the owner does not approve, which moves everything a day;
(c) Meta's own review of the first real ad (usually under 24 h; it can be longer). None is solved
by writing code faster.

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
- Gates: `lint:migrations`, `check-rls.mjs`, `lint:upserts`, `lint:boundaries`,
  `lint:table-lifecycle`, `lint:filesize`/`funcsize`, `lint:comment-claims`, `lint:secrets`; all CI
  jobs; `/code-review` and `/security-review` on AD2 and AD4.

---

## 8. How we will know it works (baselines first, targets after four weeks — plan §8)

Cost per lead and per *qualified* lead (recruiter-confirmed Class A + experience) per campaign;
median minutes from lead to first contact; share of leads converted to an application; reconcile
mismatches (target: zero unexplained); Meta rejections per creative; agent agreement (drafts
approved without edits vs edited).

---

## 9. Open questions (owner unless marked)

- **Q-AD1 · Scope of "all social media" for the five days.** Candidates: (a) Meta (Facebook +
  Instagram) only; (b) + Google Ads; (c) + TikTok/LinkedIn. **Recommendation (a):** Meta is where
  the owner already runs ads (Q-RA7f), and each extra platform needs its own employment-policy
  research and adapter. *Fallback:* (a).
- **Q-AD2 · Does "run" change the 10/26 ruling Q-RA3 (b)?** That ruling says the agent creates
  paused and a person launches and approves budget rises. This plan keeps it and adds that the
  agent may **pause and lower** on its own. Candidates: (a) keep (b) + autonomous pause/lower;
  (b) agent may also launch within a pre-approved monthly envelope. **Recommendation (a)** until
  §8's numbers exist. *Fallback:* (a).
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
- **Q-AD7 · Money.** Monthly cap for Meta, maximum daily per campaign, and the ad account spending
  limit you will set (= Q-RA7f-ii). *Fallback:* nothing launches until set (the code refuses).
- **Q-AD8 · Counsel** (adds to Q-RA6): confirm that Instant Form questions on Class A, years of
  experience and hazmat are acceptable, and the wording of the age floor in the ad. *Fallback:*
  those three questions only; age stated in the copy; the open counsel memo status (sent?) is still
  UNVERIFIED from §1.3 of the parent plan.
- **Q-AD9 · The first requisition.** Pay (basis + range), home time, equipment, lanes, the yard and
  radius with its operational reason (= Q-LS2, **never ZIP**), headcount. The agent cannot write an
  ad without it, by design (D-AD1).

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
