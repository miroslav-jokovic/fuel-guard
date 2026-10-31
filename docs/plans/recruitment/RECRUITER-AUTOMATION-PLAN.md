# Recruiter automation — the whole hire, automated as far as the law and the owner allow · 2026-10-26

**Status: RA0 RULED 2026-10-26 (Q-RA1, Q-RA2, Q-RA3, Q-RA7, Q-RA19 — see §9; the Hiring Profile v1
is §3a). Nothing built. RA1 may start.**

The owner's ask (2026-10-26, in two parts): first, *automate and help the recruiters* — Claude Duet,
Tenstreet over its API with agents inside Silvicom 360, or ads run from our own system; then, *list
everything we should build to automate recruitment as much as possible*, planned to an enterprise
standard, "100% reliable and precise without assumptions."

This document is that plan. It extends `LEAD-SOURCING-PLAN.md` (2026-09-25, D-LS1–10, S0–S8),
`RECRUITING-SYSTEM-PLAN.md` (R0–R10) and `HIRING-MODULE-PLAN.md`; it does not replace them. Where it
re-states a step from one of those plans it says so and keeps that plan's ID.

**How "without assumptions" is honoured here.** Every claim that something *exists* cites the file
and line it was read at on main `c0e2801` (2026-10-26). Every fact the plan needs and does not have
is a numbered question in §9 with an owner, candidate answers, a recommendation and the fallback the
code takes if it is never answered. Every step in §7 has a *done when* that is a measurement, not an
opinion. §5 lists the reliability rules and names the gate, trigger or test that enforces each one.
Where a measurement could not be made, the row says **UNVERIFIED** rather than guessing.

---

## 0. The three routes the owner named, in one page

| Route | Verdict | Why (details in §2) |
|---|---|---|
| **Claude Duet** | **No**, for applicant data | A personal agent for individual US Pro/Max subscribers (research preview since 2026-10-21; no Team/Enterprise). Applicant PII would leave our RLS, audit and retention. It sees only the inbox, never the checklist, the MVR or the board. Its *shape* (morning brief, approve-before-send, ping when done) is built inside Silvicom as A1. |
| **Tenstreet API** | **One-way feed only (T2)**, and only if the owner keeps Tenstreet until our flow goes live | Tenstreet pushes application data to a URL we give it, after an approval by email; fees and schema are not public. The carrier's live intake runs there today (McLeod `driver.tenstreet_id`). A two-way sync is a second source of truth and is rejected. Tenstreet Assistant (VoiceBot calls, auto welcome messages) is not exposed over the API. |
| **Agents inside Silvicom 360 + an ads control plane** | **Recommended** | Our ATS already exists and is more complete than the earlier summary said (§1.1). Agents draft, read and check against the system of record; a person sends and decides. Ads are created paused, capped and reconciled daily, and spend moves only on a person's approval. |

---

## 1. Ground truth, measured 2026-10-26 (main `c0e2801`)

### 1.1 The applicant pipeline that exists

Paths: `api/` = `apps/api/src/modules/`, `shared/` = `packages/shared/src/`, `mig/` =
`supabase/migrations/`, `web/` = `apps/web/src/features/`.

| Capability | State | Evidence |
|---|---|---|
| Applicant = `drivers` row, `status='applicant'` (D-HIRE5); no separate table | EXISTS | `web/recruitment/useCreateApplicant.ts:19-44`; vocabulary `mig/0240:24` |
| Invite by email, by text (recruiter attests the applicant asked), rotate, revoke; token stored as SHA-256; 14-day default TTL in `recruiting_settings` | EXISTS | `api/recruiting/applicationLink.ts:115,168`; `applicationInviteText.ts`; `shared/applicationIntake.ts:28`; `mig/0379:40-58` |
| Part 1 intake (v2), consents and releases, Part 2 §391.21 form, office review, signing ceremony, filing through `submit_driver_application`, 31-page packet PDF, countersign | EXISTS | `api/recruiting/routes/publicApplicationIntake.ts:49-88`; `applicationReview.ts:62-292`; `applicationSubmit.ts:232,347`; `mig/0376:1189`; `mig/0387` |
| Spanish (C4) | EXISTS | merged 2026-10-21 (#1701) |
| Checklist: 19 steps folded from evidence rows; federal gates + handbook block the hire; orientation rows have `evidence: null` and never block | EXISTS | `shared/hiringSteps.ts:40-326`; `shared/hiringChecklist.ts:353,420`; `api/recruiting/applicantChecklistInputs.ts:100-115` |
| Nudges: one `part_one` and one `part_two` reminder after `reminder_after_hours` (default 48), every 6 h, text via outbox (needs consent) then email; token rotated first | EXISTS | `api/recruiting/applicationNudgeSweep.ts:240,269`; `api/evidence/dqAlertScheduler.ts:229`; `shared/applicationNudge.ts:36,115-119,179` |
| Drug test **ordered** through Med-Stop (admin, safety_manager, recruiter) and **results read back** by a sweep; a verified negative auto-files `qualification_records.drug_test`; positive/refusal/dilute notifies the DER | EXISTS | `api/medstop/routes/order.ts:15,94`; `api/medstop/syncTests.ts`; `sync.ts:211`; `outcomes.ts:114` |
| Med-Stop person created automatically when Part 1 completes (10 per sweep, one attempt, never retried) | EXISTS | `api/medstop/applicantCreate.ts:41,99,122,140`; `queue/handlers/medstop.ts:24` |
| Appointment text to the applicant (`drug_test_site` template) | EXISTS | `api/recruiting/applicantDrugTestSend.ts:19`; `routes/drugTest.ts:136` |
| PSP **ordered** through the FMCSA PSP API, auto-files `psp_report`; portal purchases importable | EXISTS | `api/psp/pspOrder.ts:286,325`; `routes/pspOrders.ts:163`; `routes/psp.ts:84` |
| MVR, Clearinghouse query, medical-registry verification: **recorded by hand**, no vendor call. MVR integration was deferred on purpose (Q-HM2: the office pulls and uploads) | EXISTS (manual) | `api/recruiting/routes/hiringEvidence.ts:80,108,168`; `shared/hiringEvidence.ts:63` |
| §391.23 employer inquiries: letter composed, attempts ledgered, 30-day clocks, replies **filed by hand**; **no send path** (Q-PEI2 open); phone verification calls ledgered | EXISTS (E1–E5) | `api/recruiting/routes/inquiries.ts:66-169`; `shared/inquiryQueue.ts:28,30,141`; `mig/0223:27`; `mig/0376:1112` |
| Dispositions `declined / withdrawn / no_response`, free-text reason, `rested_on_consumer_report`, append-only | EXISTS | `shared/applicantDisposition.ts:23`; `mig/0238:46-80` |
| **Adverse action notices: NOT BUILT** (R10). Only disclosure text and the flag exist; no pre-adverse/adverse steps or timers | NOT BUILT | `api/recruiting/fcraSummary.ts:64`; `pspDisclosure.ts:66-68`; `mig/0238` comment |
| Road test (§391.31): examiners, ceremony, certificate, driver's copy | EXISTS (RT0–RT4) | `api/recruiting/routes/roadTest.ts:43-159`; `mig/0372` |
| Handbook signing + countersign; blocks the hire | EXISTS (HB0–HB5, QH0) | `api/recruiting/routes/handbook.ts:50-177`; `mig/0374:42,91`; `mig/0387:53` |
| Orientation (OR1–OR3), training videos (D4), live sessions (D5) | NOT BUILT | `mig/0373` kinds only; `web/recruitment/hiringStepDrawers.ts:145-146` shows "unbuilt" |
| Hire: `hire_applicant` sets `status='active'` + `hire_date`, hands employment-history records over, ends links; **needs `roster` manage, so a recruiter cannot hire**. **Does not** create a driver-app login, Samsara link, EFS card or McLeod record | EXISTS (partial) | `api/recruiting/hireApplicant.ts:102,183,213`; `routes/hire.ts:43-61`; `mig/0386:68,126-136` |
| Purge (admin, archived first, typed name; refuses anyone hired or linked) | EXISTS | `api/recruiting/applicantPurge.ts:55`; `mig/0380`, `0387` |
| Draft/capture prune (the "A11 90-day prune" the comments mention) | **UNVERIFIED — no job found** | `applicantChecklistInputs.ts:205` comment only |
| Leads, source attribution, Hiring Profile, prefill from a lead (A3b) | NOT BUILT | no `recruiting_leads` migration; `RECRUITING-SYSTEM-PLAN.md:540-588` |
| Web: `/recruitment` board (7 stages), `/recruitment/:id` record + step drawers, `/recruitment/screening`, `/recruitment/inquiries`, `/recruitment/templates`, `/settings/recruiting`, `/apply/:token` | EXISTS | `apps/web/src/router/routes/recruitment.ts`; `shared/surfaceCatalogue.ts:53,202-306,413` |
| Recruiter role: `recruitment: manage`, `roster: view`, nothing else; may order Med-Stop; may read investigation history; drug-test records stay with admin/safety_manager | EXISTS | `shared/auth.ts:158,347-349` |

### 1.2 The platform rails an automation module stands on

| Rail | State | Evidence |
|---|---|---|
| Durable job queue: `dedup_key`, `attempts`/`max_attempts` (5), `run_after`, leases, `claim_next_job` with `SKIP LOCKED`, backoff `min(300, 5·2^(n-1))` s, terminal `status='failed'` with `error` | EXISTS | `mig/0027`, `mig/0095:7-22,46-107`; `apps/api/src/queue/worker.ts:19-21,88`; `queue/types.ts:21-39` |
| Handlers are at-least-once and must be idempotent | EXISTS (contract) | `queue/types.ts:21-22` |
| Failed-jobs API exists; **no page renders it** | PARTIAL | `api/org/routes/jobs.ts:56,63` |
| Schedulers: single registry, one runner per lane via DB lease (D-RLY2, 0506); boot reclaim lease-aware | EXISTS | `apps/api/src/schedulers.ts:38-46,53-96,110-154`; `docs/WORKER-DEPLOYMENT.md` "Lanes and leases" |
| Some schedulers are bare `setInterval` with no ledger row (SMS outbox drain) | GAP | `api/recruiting/smsOutboxScheduler.ts:36`; `jobs.ts:58-76` |
| AI: `callClaude` is **hard-wired to the fuel-risk tool**; raw SDK used by document reading, hazmat, Ask-AI | PARTIAL | `apps/api/src/lib/anthropic.ts:5-42,60-82` |
| AI models pinned: `fast: claude-haiku-4-5`, `deep: claude-sonnet-4-6` | EXISTS | `shared/ai.ts:10-12` |
| AI budget: `anomaly_thresholds.ai_monthly_token_budget`, spend in `org_usage_month`, `withinBudget` | EXISTS | `mig/0003:177`; `mig/0130:16`; `shared/ai.ts:149` |
| AI provenance pattern: `document_reads` stores `models[]`, `prompt_version`, `schema_hash`, `cache_key`, tokens, closed `failure_code` incl. `budget_exhausted`; review rows in `document_read_reviews` (confirmed/corrected, explicit) | EXISTS (pattern) | `mig/0448:143-186`; `web/hazmat/bolRead/bolReview.ts` |
| AI USD cost column | NONE | — |
| SMS: `sendOrQueueSms` checks wording, live consent, usable number, suppression, local hours; closed template list; outbox stores template+params only; STOP/receipts via Ed25519-verified webhook | EXISTS | `api/recruiting/smsOutbox.ts:62,225-262`; `mig/0376:1368-1429`; `apps/api/src/routes/webhooks.ts:49-100` |
| `sms_consents.driver_id` **NOT NULL** — a lead cannot hold consent; `lead_form` already reserved as a source | GAP (known) | `mig/0233:25-54`; `shared/smsConsentContract.ts:36`; `mig/0504:43-44` |
| SMS send retry/backoff | NONE | `smsOutbox.ts:202-203` |
| Toll-free verification (+1 833 352 1766, "HR / Staffing") — **approval UNVERIFIED**; last seen "Waiting For Vendor" 2026-09-29 | UNVERIFIED | `docs/plans/sms/SMS-PROVISIONING.md` |
| Email: `sendEmail` (Brevo/Resend) with outbound allowlist; **no suppression, unsubscribe, List-Unsubscribe or bounce webhook anywhere** | GAP | `apps/api/src/lib/mailer.ts:2-97` |
| Inbound email: only the M365 mailbox for EFS reports | GAP | `apps/api/src/lib/graphMail.ts` |
| Secrets: per-integration credentials tables sealed with AES-256-GCM (`secretBox`), AAD = org+purpose | EXISTS (pattern) | `apps/api/src/lib/secretBox.ts:4-30,114,129`; `mig/0463:18-32` (Med-Stop) |
| Raw payload stored whole + thin projection + idempotency key (D-PSP2) | EXISTS (pattern) | `mig/0216:30-69` |
| Webhook signature verification: HMAC-SHA256 (Samsara), Ed25519 (Telnyx) | EXISTS (pattern) | `api/samsara/fuelEventsWebhook.ts:14-20`; `lib/telnyxSignature.ts:33` |
| `audit_logs` append-only (trigger), `writeAudit` | EXISTS | `mig/0003:185-197`; `mig/0395:63-80`; `apps/api/src/lib/audit.ts:4-43` |
| Retention: `RETENTION_RULES` + `RETENTION_FORBIDDEN`, daily `data_retention` job | EXISTS | `api/org/dataRetentionPolicy.ts:24-45`; `dataRetentionForbidden.ts:12` |
| Per-domain settings table pattern (`recruiting_settings`, service-role only, defaults in code) | EXISTS | `mig/0379:40-58`; `api/recruiting/recruitingSettings.ts:30-59` |
| Notifications: `notify()` with `dedupeKey`, categories in `NOTIFICATION_CATEGORIES` **and** a DB CHECK (both must change for a new category) | EXISTS | `api/messaging/notify.ts:15-110`; `shared/notificationsContract.ts:17-115`; `mig/0521:308-317` |
| Reports: service does I/O, pure shared fold does the math (fleet report) | EXISTS (pattern) | `api/financial/fleetReport.ts:117`; `shared/tmsCost/fleetReport.ts:216` |
| Public routes: token-only; **no tokenless page**; limiters are in-memory per replica; **no CAPTCHA/Turnstile** | GAP | `api/recruiting/routes/publicApplication.ts:76-228`; `apps/api/src/middleware/applicationLimits.ts:55-58` |
| Driver-app login: username + password on a synthetic Supabase user, issued by the roster module; `drivers.user_id` | EXISTS | `api/roster/driverCredentials.ts:11-22`; `roster/routes/credentials.ts:61-148`; `mig/0329` |
| Samsara driver sync: matches id → phone → name, **skips applicants**, inserts unmatched; our token is read-only | EXISTS | `api/samsara/samsaraDriverSync.ts:34-45,174,215,228`; [[samsara-api-token-is-read-only]] |
| EFS: `fuel_cards.driver_id`; EFS import auto-creates drivers by name (`identity_source='efs'`); new hires' cards reach us 1–7 days before McLeod does | EXISTS | `mig/0007:13-25`; `api/efs/services/efsCardLinking.ts`; `api/mcleod/rosterDriverSettle.ts` |
| McLeod roster: not a creation source; link → CDL → name; unmatched reported, never inserted; rehire detected (D-MR7a) | EXISTS | `api/mcleod/rosterIngest.ts`; `rosterMatch.ts`; `rosterDriverSettle.ts` |

### 1.3 Where the other recruiting plans stand (their own logs, read 2026-10-26)

| Plan | Built | Not built / open |
|---|---|---|
| RECRUITING-SYSTEM (R0–R10) | R0a, R0b, R0b2, R2b, R9 | **R0 interview (Q-REC1 never answered)**, R1 leads, R2 pre-qualification, R3/R4 MVR (deferred by Q-HM2), R7 training, R8 orientation half, **R10 notices** (unblocked by Q-REC8, sending waits counsel Q9) |
| APPLICATION-SYSTEM | A1–A11c | A3b prefill (waits R1) |
| APPLICATION-FLOW-V2 | C0–C4, M1/M2, AW6, Q-AW55/56 | C3d4 perf parked; Q-AW54 `capture_mode`; real-phone QA walk owed |
| EMPLOYER-INQUIRY | E1–E5 | E6 driver's §391.23(i)–(k) rights, E7 hire-time records; Q-PEI1–4 open |
| ORIENTATION | OR0 (0373) | OR1–OR3; Q-OR7 (§382.601 policy text missing), Q-OR8 |
| ROAD-TEST | RT0–RT4 complete | — |
| HANDBOOK-SIGNING | HB0–HB5, QH0–QH2 | Q-HB2 re-sign on amendment (deferred) |
| MVR-RELEASE-AND-TEMPLATES | MV0–MV3 live | Q-MVR1–11 (mostly counsel/wording) |
| DRIVER-TRAINING | nothing | all phases; D4/D5 of HIRING-MODULE |
| SMS-OPT-IN | SMS1–SMS4, D-SMS11 | toll-free approval UNVERIFIED; 0 production consents at last measure (09-29); Q-SMS3–5 |
| COUNSEL-REVIEW-PACKAGE | memo written 2026-09-24 | **no answers recorded; whether it was SENT is UNVERIFIED** |

### 1.4 Corrections to the list given in chat on 2026-10-26

The chat list said "Exists" for adverse action: **it does not** (R10 not built). It said drug-test
results read-back, PSP pull and the medical registry check were new: **drug test read-back and PSP
pull exist**; only the registry check is new. It said travel booking "exists in part": `applicant_travel`
and `TravelPanel.vue` exist; no booking integration does. Everything else in that list stands.

---

## 2. The three routes, with the facts behind the verdicts

### 2.1 Claude Duet
Launched 2026-10-21 as a research preview for **US Pro and Max subscribers from a waitlist; Team and
Enterprise are not included**. It reads one person's Gmail/Slack/etc. (6,000+ connectors), sends a
morning brief, takes tasks by message and asks before it sends, pays, signs or deletes. The model is
not selectable and its browser cannot be watched; Anthropic warns it may misjudge urgency.

Why it is not enterprise grade *for applicant data*: PII would sit under each recruiter's consumer
subscription, outside the org's agreements, RLS, `audit_logs` and `RETENTION_RULES`; HB 3773 notice
and FEHA record-keeping need every AI action logged against the applicant, and Duet's log lives in
Duet; it cannot read the checklist, the MVR, the board or the packet. It stays fine for a person's
own calendar and non-applicant mail. Its shape is A1 (§4.3).

### 2.2 Tenstreet
- **API (public facts only; no developer docs are indexed).** A client emails Tenstreet how it will
  use the data; after approval it gives Tenstreet a URL and **Tenstreet POSTs**: all application
  data, documents, subject updates and Xchange (VOE) data — manually, nightly, or on each subject
  update; the listener answers accepted/rejected and Tenstreet retries until accepted. Records can
  also be posted *in*. Fees, rate limits and the schema are **not published** (Q-RA1).
- **Tenstreet Assistant** (UConnect26, May 2026; rollout planned August 2026): VoiceBot calls,
  automatic welcome messages, PSP/MVR-vs-application discrepancy review, Clearinghouse reading,
  VOE rekeying. Built into Tenstreet; **not over the API**. Vendor claims (25% time saved, 4.5% vs
  2% hire rate) are marketing.
- Tenstreet's own June 2026 analysis of ~5,000 carriers: driver interest built through personal
  recruiter contact is the strongest predictor of a hire. That supports D-LS6.

**Postures.** T1 (Tenstreet stays the ATS; Silvicom imports hired drivers' documents for the DQF)
writes off the application system, the packet and the counsel work and pays Tenstreet indefinitely.
**T2 (recommended)**: Tenstreet pushes into our lead ledger with the subject id as `external_ref`
until our flow is cleared by counsel, then is cancelled at renewal. T3 (two-way) is rejected: a
second source of truth (`CLAUDE.md`, "No workarounds").

### 2.3 Ads and job boards — platform rules (read 2026-10-26)
- **Meta.** Marketing API on our *own* ad account needs Standard access + Business Verification
  (Advanced access/App Review only for other businesses' accounts). Job ads **must** declare
  `special_ad_categories: ["EMPLOYMENT"]` + `special_ad_category_country`: all ages 18–65+, all
  genders, no ZIP or lookalike targeting, US location widened to ≥15 miles. Lead Ads webhooks carry
  only `leadgen_id`; fields are fetched with a Page token holding `leads_retrieval`,
  `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `ads_management`. One
  secondary source says employment lead forms may not ask age/gender/location — **verify against
  Meta's policy before RA5** (Q-RA10). Vendor cost claim ≈ $27 per CDL applicant (Boostpoint 2026).
- **Google.** Google for Jobs is free: it crawls `JobPosting` JSON-LD on our pages; the Indexing
  API lists a new page within hours. Google Ads employment policy (US): no age, gender, parental
  status, marital status or ZIP targeting; radius ≥ 1 km, city and country allowed.
- **Indeed.** Release notes 2026-07-31: "The Job Sync API is now available to direct employers."
  The Job Sync guide still says the opposite. **Confirm with Indeed before RA5** (Q-RA5). Sponsored
  Jobs API is gated on recent sponsored spend. Indeed Apply into a non-partner ATS is not available;
  leads can arrive by email.
- **TikTok, LinkedIn, CDL boards:** not researched; later S5 adapters after reading each platform's
  employment policy.

### 2.4 Law that binds the design (to counsel; none of this is legal advice)
- **Illinois HB 3773** (in force 2026-01-01): AI in recruitment with a discriminatory *effect* is
  actionable; **ZIP code is a named proxy**; notice of AI use is required. IDHR withdrew its draft
  rules 2026-06-02; the duty stands, the form is unsettled.
- **California FEHA ADS regulations** (2025-10-01): employers ≥5, vendor-as-agent liability, four
  years of records, anti-bias testing relevant to defence. *Mobley v. Workday* (2026-06-22): FEHA may
  reach screening tools even for jobs outside California. Applies if we hire California residents
  (Q-RA6b).
- **Colorado SB 26-189** (2027-01-01): transparency model, AG enforcement.
- **TCPA:** automated or prerecorded contact needs prior express consent; revocation by any
  reasonable means since 2025-04-11; $500–$1,500 per message, mostly class actions. A recruiter
  dialling or typing one message by hand is not automated.
- **FCRA:** scoring people on data they did not give us is where the risk sits (*Kistler v.
  Eightfold*, 2026). Our match runs only on facts the person supplied or we hold from a prior
  relationship (D-LS10).
- **DPPA:** no DMV-derived lists, ever.

---

## 3. Decisions proposed (D-RA*)

Each is a rule the code enforces, not a preference. None is ruled until the owner says so.

- **D-RA1 · One system of record for applicants: Silvicom 360.** Tenstreet is a one-way feed (T2)
  with a cut-off date. **T2 confirmed as the posture 2026-10-26: the contract is active (Q-RA1).** No two-way sync. Enforced: the Tenstreet listener writes only to
  `recruiting_leads` / raw payload tables; no job kind posts to Tenstreet.
- **D-RA2 · No automated first contact. RULED by the owner 2026-10-26 (Q-RA2 (b)):** nothing
  automated reaches a person who has not applied. Automated *transactional* messages to an applicant with a
  live consent (confirmations, document requests, reminders) are allowed — the nudge sweep already
  does this. Enforced: every outbound route takes exactly one recipient; `JobKind` has no kind that
  sends to a lead; a test pins both (D-LS6's test, extended).
- **D-RA3 · Rules decide, the model reads and drafts.** Verdicts come from pure functions in
  `packages/shared` (`leadMatch`, discrepancy rules, readiness rules). The model extracts, explains
  and drafts. No AI output rejects, ranks by an opaque score or dispositions anyone. Enforced:
  `lint:boundaries` keeps the model call out of `packages/shared`; a fold test proves each verdict
  from fixtures without any model.
- **D-RA4 · Every AI output carries its provenance and a human confirmation.** Stored with `model`,
  `prompt_version`, `schema_hash`, `input_hash`, tokens, and a `status` of
  `proposed | confirmed | corrected | rejected` with `actor`. Nothing proposed becomes a fact without
  a confirmation row. Labelled "AI" in the UI. This is `document_reads`' pattern (`mig/0448`), reused.
- **D-RA5 · No agent sees a protected characteristic or a proxy.** No photo, no inferred ethnicity,
  no age beyond the ≥21/policy gate, no gender, **no ZIP code** (HB 3773). Enforced: the contract
  each agent is given is an allowlist of fields; a test asserts the forbidden keys are absent from
  the prompt payload for every agent.
- **D-RA6 · Money moves only on a person's approval, under a cap, and is reconciled daily. RULED
  by the owner 2026-10-26 (Q-RA3 (b)).** Campaigns are created paused; launch, budget change and new campaign are approval actions with
  `created_by`; a monthly cap per channel lives in `recruiting_ads_settings` and is checked before any
  platform call; platform-reported spend is reconciled against our ledger every day and a mismatch
  alerts, never self-corrects. One action pauses everything.
- **D-RA7 · Every inbound lead is idempotent and keeps its raw payload.** Key `(org, channel,
  external_ref)`; raw payload whole + re-derivable projection (D-PSP2); unsigned webhooks are
  refused; every connector has a daily backfill so a missed push is caught.
- **D-RA8 · Every automation is a ledgered job or a leased scheduler, with a terminal failure a
  person can see.** No bare `setInterval`. Failed jobs get a page (the `jobs.ts:63` gap closes in
  RA1). Vendor-calling kinds have `KIND_CAPS` of 1.
- **D-RA9 · Every agent has its own on/off switch per org, off by default, and a monthly budget.**
  In `recruiting_ai_settings`; the switch is read at run time; budget exhaustion is a recorded
  `failure_code`, not a crash.
- **D-RA10 · Measure before optimising.** Ads budget reallocation runs as a *recommendation* until
  A11 has eight weeks of 90-day-seated data; automatic reallocation is a later switch (D-RA9).
- **D-RA11 · Deriving beats restating.** Hiring requirements live once, in the versioned Hiring
  Profile; ads copy, the lead form's questions, `leadMatch` and the job page all read it. No ad may
  state a figure the profile does not hold (A10's check).
- **D-RA12 · A lead is operational, not evidence.** Prunable under `RETENTION_RULES` after Q-LS6's
  window; `recruiting_contacts` and consent rows are append-only and in `RETENTION_FORBIDDEN`.

---

## 3a. Hiring Profile v1 — RULED by the owner 2026-10-26 (Q-RA7 = Q-REC1 / Q-LS1 / Q-LS3)

This is the first version of the profile that item 1.1 stores and `leadMatch` (3.1) evaluates. It
answers Q-REC1, open since 2026-08-20. Every rule below is a **sort and a label, never an automatic
rejection** (D-LS3, D-RA3). A fact the system does not yet hold is `unknown`, not `does_not_meet`.

| Requirement | Rule (v1) | Evidence that satisfies it | Source of the ruling |
|---|---|---|---|
| **Age** | ≥ 23 (carrier policy; federal floor is 21) | date of birth from Part 1 (`self_reported`), confirmed by the CDL (`document`) | Q-RA7a; matches `questionnaireContract.ts:209`'s hint |
| **Experience** | ≥ 2 years **verifiable** Class A | `self_reported` from the application → `verified` only when an employer reply (`employer_inquiries.outcome='responded'`) or MVR issue date confirms it; until then the verdict is `unknown` | Q-RA7b |
| **Licence** | Class A CDL (required by law for the equipment hauled) | CDL from Part 1 licences (`document`) | Q-RA7c; Q-REC3 (dry van and reefer only) |
| **Hazmat endorsement** | **preferred** — sorts higher, not required | CDL endorsements | Q-RA7c |
| Reefer experience | not required | — | Q-RA7c (not chosen) |
| Automatic-only (E) restriction | **not ruled** (Q-RA7c-ii) | — | *Fallback:* no rule; the restriction is shown, not judged |
| **Hard disqualifiers** | (1) DUI/DWI in a CMV, ever; in any vehicle, within 5 years · (2) preventable DOT-recordable accident within 3 years · (3) Clearinghouse *prohibited* status · (4) positive or refused D&A test without a completed return-to-duty | MVR, PSP crash record, Clearinghouse query, employer D&A inquiry — each `document` or `verified`; the applicant's own answer is `self_reported` | Q-RA7d (all four chosen) |
| **Moving violations / accidents** short of a disqualifier | **no numeric limit** — the engine shows the 3-year counts (moving, serious per §383.51 Table 2, preventable accidents) and the verdict stays `unknown`; the recruiter judges each MVR | MVR, PSP | Q-RA7e |
| **Hiring area / home time** | not part of Q-RA7 — remains Q-LS2 / Q-RA4 (distance from a named yard with a written reason; never ZIP) | — | open |

**Sources today (Q-RA7f):** Tenstreet job-board postings, Indeed (direct), Facebook/Instagram (ads
and groups), referrals from current drivers. **Monthly spend per channel and weekly lead volume were
not given — owed as Q-RA7f-ii**; until then A11 reports cost only where a figure is entered.

What this changes in the plan: `leadMatch` v1 has exactly five evaluable rules (age, experience,
Class A, hazmat-preferred, the four disqualifiers) and one display-only block (violation counts).
The profile table stores these as versioned rows, so changing "23" or "2 years" later is a new
version, and every past verdict keeps the version it was made under.

---

## 4. The catalogue — everything to build, by stage of the hire

Columns: **State** = EXISTS (with evidence in §1) / PLANNED (plan and step) / NEW. **Auto** = the
system does it alone, no message to a driver · **Approve** = prepared, one click by a person ·
**Person** = drafted or reminded, a recruiter does it. **Phase** refers to §7.

### 4.1 Job openings and ads
| # | Item | State | Auto level | Phase |
|---|---|---|---|---|
| 1.1 | Versioned **Hiring Profile** (age, experience, endorsements, equipment, disqualifiers, look-back windows, hiring area as *distance from a named yard with a written reason* — never ZIP) | PLANNED (LEAD-SOURCING S2 / R2) | Person sets, versioned | RA1 |
| 1.2 | **Requisition** (opening): profile version + pay, home time, lane, equipment, start date, headcount; the single source every ad derives from (D-RA11) | NEW | Approve | RA1 |
| 1.3 | **A10 ad/posting writer**: job page, Indeed posting, Meta ad text, EN + ES, each claim checked against the profile | NEW | Auto draft → Approve | RA5 |
| 1.4 | **Public job pages** with `JobPosting` JSON-LD + sitemap + Indexing API ping (Google for Jobs) | PLANNED (S4) | Auto | RA5 |
| 1.5 | **Indeed Job Sync**: post, update, close | NEW (Q-RA5) | Auto | RA5 |
| 1.6 | **Meta campaign create** (paused, EMPLOYMENT category set in code, no editable audience fields for age/gender/ZIP) | NEW | Approve | RA6 |
| 1.7 | Google Ads campaign create | NEW | Approve | later |
| 1.8 | **Auto-close**: filled or closed requisition pauses/ends every linked ad and posting | NEW | Auto | RA6 |
| 1.9 | **Daily spend pull** per platform + **reconcile** against our ads ledger; mismatch → alert | NEW | Auto | RA6 |
| 1.10 | **Monthly cap per channel** + **kill switch** | NEW (`recruiting_ads_settings`) | Auto, enforced | RA6 |

### 4.2 Getting leads in
| # | Item | State | Auto level | Phase |
|---|---|---|---|---|
| 2.1 | **Lead ledger** `recruiting_leads` (`channel/source/campaign/external_ref`, raw payload), `recruiting_contacts` append-only, `convert_lead` → applicant + invite carrying attribution | PLANNED (R1 / S1) | Auto | RA1 |
| 2.2 | Lead-stage SMS consent: `sms_consents.lead_id`, `driver_id` relaxed to "one of" (0233's reserved change) | PLANNED (S4) | Auto | RA1 |
| 2.3 | **Lead form** on the job page: profile's hard questions, HB 3773 AI notice, optional separate SMS consent, rate limit + bot defence (Q-RA11: Turnstile or equivalent — none exists today) | PLANNED (S4) | Auto | RA5 |
| 2.4 | **Meta Lead Ads webhook** + daily `/leads` backfill | PLANNED (S5) | Auto | RA3 |
| 2.5 | **Intake mailbox** per org: parses Indeed/board applicant emails (needs inbound email — only M365 EFS mailbox exists; Q-RA12 which mailbox) | PLANNED (S5) | Auto | RA3 |
| 2.6 | **Tenstreet push listener** (T2): accept/reject protocol, raw stored, `external_ref` = subject id | NEW (Q-RA1) | Auto | RA3 |
| 2.7 | **Signed generic webhook** for any vendor (HMAC, replay bound — Samsara/Telnyx pattern) | PLANNED (S5) | Auto | RA3 |
| 2.8 | **Paste box** + later browser extension for public "looking for work" posts (D-LS9 signals) | PLANNED (S5a/S5b) | Person captures, Auto reads | RA3 / later |
| 2.9 | **A2 extractor**: any source → `leadContract`, shown beside the source text | PLANNED (S5) | Auto → Person confirms | RA3 |
| 2.10 | **Dedupe** on E.164 phone / lower(email) vs leads, applicants, drivers; merge suggestion (A-merge) | PLANNED (S1) | Auto | RA1 |
| 2.11 | **Phone line-type check** (mobile vs landline/VoIP) via Telnyx Number Lookup (Q-RA13 cost) | NEW | Auto | RA3 |
| 2.12 | **Referral link** in the driver app → `referral` lead credited to the driver | PLANNED (S8) | Auto | RA8 |

### 4.3 Qualifying and responding fast
| # | Item | State | Auto level | Phase |
|---|---|---|---|---|
| 3.1 | **A3 `leadMatch`**: per-requirement `meets / does_not_meet / unknown` + evidence level + profile version; model writes the plain-English *why* | PLANNED (S2) | Auto (rules) | RA1 |
| 3.2 | **Call-today queue** ordered `hard met → fewest unknowns → freshness`; every row shows why | PLANNED (S2) | Auto | RA2 |
| 3.3 | **A1 morning brief** per recruiter: in-app (`notify`, new category `recruiting_brief` in contract + DB CHECK) and email to the *recruiter*; deduped per day | NEW | Auto | RA2 |
| 3.4 | Uncontacted-lead badge in nav; response-time alert over a threshold in settings | NEW | Auto | RA2 |
| 3.5 | **Lead assignment** (round-robin or by yard/lane), reassign on inactivity | NEW (Q-RA14 rule) | Auto | RA2 |
| 3.6 | Callback reminders the recruiter set | NEW | Auto | RA2 |
| 3.7 | **Owned pools**: former drivers imported hidden until a person marks rehire-eligible (Q-LS4); stalled/`no_response` applicants resurfaced after N days | PLANNED (S3) | Auto list → Person | RA2 |

### 4.4 Talking with drivers
| # | Item | State | Auto level | Phase |
|---|---|---|---|---|
| 4.1 | **A4 drafter**: first message, follow-up, reply; EN/ES; carrier voice | PLANNED (S6) | Person sends | RA2 |
| 4.2 | **Conversation on the record**: inbound SMS threaded to the lead/applicant (outbox + webhook exist; threading view is new) | PARTIAL (`applicationSms.ts:288`) | Person | RA2 |
| 4.3 | **A5 call notes → facts**, each ticked by the recruiter | PLANNED (S6) | Person confirms | RA2 |
| 4.4 | Click-to-call with the call logged as a `recruiting_contacts` row (Q-RA15: Telnyx Voice or dialer link only) | NEW | Person | RA4 |
| 4.5 | **Booking link** (interview / orientation) synced to the recruiter's calendar (Q-RA16: M365 Graph calendar — `graphMail.ts` precedent — or none) | NEW | Driver self-books → Auto | RA4 |
| 4.6 | **Transactional automated messages** to consented applicants: confirmation, document request, appointment reminder (closed template list, one per event, deduped) | PARTIAL (nudges) | Auto **if Q-RA2 (b)** | RA2 |
| 4.7 | **Email suppression + unsubscribe + bounce webhook** (List-Unsubscribe; Brevo/Resend bounce events) — prerequisite for any automated email | NEW | Auto | RA1 |
| 4.8 | SMS outbox retry/backoff (today: fail once) | NEW | Auto | RA1 |
| 4.9 | **A12 applicant Q&A** on the job page, answers only from the profile, hands off to a recruiter, never asks protected traits | NEW | Replies only when the driver starts | RA7, if Q-RA2 allows |

### 4.5 The application
| # | Item | State | Auto level | Phase |
|---|---|---|---|---|
| 5.1 | Invite by email/text, Part 1, Part 2, Spanish, packet, signing, countersign | EXISTS (§1.1) | — | — |
| 5.2 | Stalled-application reminders, one per part | EXISTS | Auto | — |
| 5.3 | **A3b prefill** from the lead's answers (nothing typed twice) | PLANNED (APPLICATION-SYSTEM A3b) | Auto | RA3 |
| 5.4 | **A8 document reader**: CDL, medical card, SSN card photos → fields, checked against the application; reuses `document_reads` pipeline + BOL review screen | NEW (pipeline EXISTS) | Auto → Person confirms | RA4 |
| 5.5 | **Gap and window checks**: 10-year history gaps, 3-year commercial-driving window, employer count vs inquiry rows | NEW (pure fold) | Auto flags | RA4 |
| 5.6 | Draft/capture prune per A11 (comment only today) — **verify whether it exists; build if not** | UNVERIFIED | Auto | RA1 |

### 4.6 Background checks
| # | Item | State | Auto level | Phase |
|---|---|---|---|---|
| 6.1 | MVR, Clearinghouse, drug test recorded on the applicant | EXISTS | Person records | — |
| 6.2 | Drug test ordered via Med-Stop; results read back; negative auto-files | EXISTS | Auto | — |
| 6.3 | PSP pulled via FMCSA API; auto-files | EXISTS | Auto | — |
| 6.4 | MVR ordered from a vendor | **DEFERRED by Q-HM2** (office pulls by hand) | — | not planned; re-ask only if the owner reopens Q-HM2 |
| 6.5 | **Medical-examiner National Registry check** (NRCME has no public API; Q-RA17: manual with a deep link + reminder, or a vendor) | NEW | Approve / Person | RA4 |
| 6.6 | **A6 discrepancy reviewer**: application vs MVR, PSP, Clearinghouse, employment history — undisclosed violations, licence mismatches, date conflicts; every flag cites the line | NEW | Auto flags → Person decides | RA4 |
| 6.7 | **A7 VOE assistant**: drafts §391.23 requests, **sends by email from our domain** (Q-PEI2), tracks the 30-day clock (exists), reads replies (PDF/fax image) into `employer_inquiries.outcome` for confirmation, chases non-responses, writes the good-faith-effort note | PARTIAL (compose + clock EXIST; send, read, chase NEW) | Approve to send, Auto to read | RA4 |
| 6.8 | Employer **online reply link** (Q-PEI3) | PLANNED (EMPLOYER-INQUIRY) | Auto | RA4 |
| 6.9 | **Checklist auto-ticks** — already true for every step with an evidence row; what is new is 6.5–6.7 writing their rows | EXISTS (mechanism) | Auto | — |
| 6.10 | E6: the driver's §391.23(i)–(k) review/rebuttal rights | PLANNED (EMPLOYER-INQUIRY E6) | Person | RA4 |

### 4.7 Decision and offer
| # | Item | State | Auto level | Phase |
|---|---|---|---|---|
| 7.1 | No automatic rejection (D-LS3) | — | Person | — |
| 7.2 | **R10 adverse action**: pre-adverse notice + copy of report + FCRA summary, waiting period timer, adverse notice; sent from Silvicom (Q-REC8 ruled) — **sending waits on counsel memo Q9** | PLANNED (R10) | Approve; Auto timer | RA4 (build), send on counsel |
| 7.3 | **Structured decision reason** (closed list + note) on every disposition; feeds 11.6 | NEW (today free text) | Person, enforced | RA1 |
| 7.4 | **Offer letter** from a template, e-signed with the existing mark ceremony | NEW (Q-RA18 whether the carrier uses one) | Approve | RA7 |
| 7.5 | **Recruiter may hire when every gate is green** (Q-RA19 ruled (b) 2026-10-26): `POST /hire` accepts `recruitment: manage` too; `hireBlockers` unchanged; audit unchanged | NEW (today needs `roster` manage) | Approve | RA1 |

### 4.8 Orientation and start
| # | Item | State | Auto level | Phase |
|---|---|---|---|---|
| 8.1 | **Orientation date as an event** → welcome message (consented), pre-orientation forms, training enrolment, travel task, equipment task | NEW (OR1–3 NOT BUILT; Q-OR7/8 open) | Auto | RA7 |
| 8.2 | Travel: `applicant_travel` + panel exist; booking integration | PARTIAL | Approve | later |
| 8.3 | **A9 readiness check** N days before: every gate, document, test and road test present or named with its owner | NEW | Auto | RA4 |
| 8.4 | Road test scheduling + scored form | EXISTS (RT0–RT4) | — | — |
| 8.5 | Handbook signing | EXISTS | — | — |
| 8.6 | Training videos + quizzes, live sessions | PLANNED (DRIVER-TRAINING, D4/D5) | — | separate plan |

### 4.9 From applicant to driver (the hidden manual work)
| # | Item | State | Auto level | Phase |
|---|---|---|---|---|
| 9.1 | Hire sets `active` + `hire_date`, hands evidence over | EXISTS | Approve | — |
| 9.2 | **DQF assembled** from the applicant's evidence — already the same rows (applicant = driver row) | EXISTS by construction | Auto | — |
| 9.3 | **Driver-app credentials** issued at hire (reuse `driverCredentials.ts`), delivered by the recruiter in person or by consented text | NEW (mechanism EXISTS) | Approve | RA6 |
| 9.4 | **Samsara driver** created/linked — our token is read-only; needs a write-scoped token (Q-RA20) or stays a checklist item | NEW | Auto *or* Person | RA6 / Q-RA20 |
| 9.5 | **EFS card assigned**: link the card EFS issued (arrives 1–7 days before McLeod) to this driver row instead of letting import create a by-name duplicate (`identity_source='efs'`) | NEW (linking EXISTS) | Approve | RA6 |
| 9.6 | **McLeod record**: Alex enters it; we **check** within N days that a McLeod driver matched by CDL exists and alert if not (rosterMatch by CDL EXISTS) | NEW (check) | Person, Auto check | RA6 |
| 9.7 | Payroll/settlement setup checklist (owner's items; Q-RA21) | NEW | Person, tracked | RA6 |
| 9.8 | **Truck ready on day one**: assignment present in McLeod/Samsara by orientation date, else alert | NEW | Auto check | RA6 |
| 9.9 | **Hire-time records citing the inquiry rows** (E7) | PLANNED | Auto | RA6 |

### 4.10 The first 90 days and rehires
| # | Item | State | Auto level | Phase |
|---|---|---|---|---|
| 10.1 | Day 7/30/60 check-ins drafted for recruiter / fleet manager | NEW | Person | RA8 |
| 10.2 | **Early-warning flags**: no load in X days, idle, roadside event, complaint — read from loads/Samsara/inspections through their modules' interfaces (D-SEP1) | NEW | Auto | RA8 |
| 10.3 | **Exit reason + rehire-eligible flag**, required when status leaves `active` (McLeod holds no reason — this is the only place it will exist) | NEW | Person, enforced | RA8 |
| 10.4 | Former-driver pool, hidden until marked eligible | PLANNED (S3) | Auto → Person | RA2 |
| 10.5 | Withdrawn/no-response applicants offered back after N days | PLANNED (S3) | Auto list → Person | RA2 |
| 10.6 | Referral link + credit (bonus policy is the owner's) | PLANNED (S8) | Auto | RA8 |

### 4.11 Managers and reports
| # | Item | State | Auto level | Phase |
|---|---|---|---|---|
| 11.1 | **Funnel per channel/source/campaign**: lead → contacted → qualified → applied → hired → seated at 90 days | PLANNED (S7) | Auto (pure fold) | RA6 |
| 11.2 | **Cost per driver seated at 90 days**, per channel (spend from 1.9) | NEW | Auto | RA6 |
| 11.3 | Budget recommendations → owner approves → API applies | NEW | Approve | RA7 |
| 11.4 | Recruiter workload + response-time report | NEW | Auto | RA6 |
| 11.5 | **A11 weekly summary**: what moved, what is stuck, which source is working | NEW | Auto | RA6 |
| 11.6 | **Disparate-impact check** on dispositions per requirement (HB 3773 is about effect); protected characteristics are never collected, so the check uses only the dimensions the law lets us test (Q-RA6a) | PLANNED (S7) | Auto | RA6 |

### 4.12 Compliance running in the background
| # | Item | State | Auto level | Phase |
|---|---|---|---|---|
| 12.1 | SMS consent, suppression, STOP, quiet hours | EXISTS | Auto | — |
| 12.2 | Email suppression / unsubscribe / bounce | NEW (4.7) | Auto | RA1 |
| 12.3 | **AI notice** (HB 3773) on the lead form, the application and the applicant's record; every AI output provenance-stamped (D-RA4) | NEW | Auto | RA1 |
| 12.4 | Lead PII pruned after Q-LS6's window; contacts/consents append-only | NEW rule | Auto | RA1 |
| 12.5 | Evidence tables append-only | EXISTS | — | — |
| 12.6 | **Agent regression set**: each agent re-run on a fixed fixture set before a prompt/model version ships; a drop in agreement fails the gate | NEW (`lint:agent-fixtures`, in `gates`) | Auto | RA2 onward |
| 12.7 | Failed-jobs page (closes `jobs.ts:63`) | NEW | Auto | RA1 |

---

## 5. The reliability bar — each rule and what enforces it

| Rule | Enforced by |
|---|---|
| Schema only as the next-numbered migration; column and first reader in separate merges | `lint:migrations`, `lint:migration-ordering` |
| Every new table: RLS on; org-filtered service reads; `expectOrgScoped` in tests | `check-rls.mjs`; `supabaseRecorder` |
| No partial `.upsert()`; lead intake writes are UPDATE-or-INSERT RPCs with the idempotency key | `lint:upserts`; RPC `ingest_lead(org, channel, external_ref, raw)` modelled on 0174/0175 |
| At-least-once jobs, idempotent handlers, `dedup_key` per (org, kind, subject) | `queue/types.ts` contract; a test enqueues twice and asserts one row |
| Vendor kinds capped at 1 (Meta, Indeed, Tenstreet, Telnyx lookup); AI kinds at 2 | `KIND_CAPS` in `worker.ts` |
| Schedulers: registry + lane lease, never bare `setInterval` | `SCHEDULERS` in `schedulers.ts`; code review; `docs/WORKER-DEPLOYMENT.md` updated in the same PR |
| Webhooks: signature verified over the raw body with a replay bound; unverified → 401 and a counter | `telnyxSignature.ts` / `fuelEventsWebhook.ts` pattern; test with a forged body |
| Raw payload stored whole; projection re-derivable; a replay from raw rebuilds the projection | D-PSP2; `supabase/tests/*.test.mjs` matrix: insert raw → project → mutate projection → re-project → equal |
| Secrets sealed per org with AAD = org + purpose; never in the SPA; expiry alert | `secretBox.ts`; `lint:secrets` (gitleaks); a `key_expires_on` column + the Med-Stop alert pattern |
| Ads: cap checked in code before every spend-affecting call; create = paused; approval row with `created_by`; daily reconcile; kill switch | Pure `adsPolicy.ts` in shared with boundary tests (cap − 1, cap, cap + 1); matrix on the approval trigger; reconcile job with an alert category |
| AI: budget gate, provenance, confirmation row, allowlisted prompt payload | `withinBudget`; the `document_reads` columns reused; a test asserts forbidden keys absent for every agent |
| AI regression: fixture set per agent, agreement threshold | `lint:agent-fixtures` (new, in `gates` in the same PR — `CLAUDE.md`'s rule) |
| Append-only: contacts, consents, approvals, ad ledger, AI outputs | BEFORE triggers firing for the service role (EI010/SO010 family); listed in `RETENTION_FORBIDDEN`; `lint:table-lifecycle` |
| Every automated send: one recipient, consent checked at send time, closed template list, deduped per event | `sendOrQueueSms` (exists) + the email equivalent (new); route schema `recipient: one`; test pins "no job kind sends to a lead" |
| Dates shown MM/DD/YYYY from one definition | `lint:date-format` |
| 500-line files, 200-line functions | `lint:filesize`, `lint:funcsize` |
| Every "proves" comment names a real test | `lint:comment-claims` |
| Tests prove themselves: each step's PR lists the mutation that went red | [[prove-tests-fail-by-mutating]]; PR template "Tests" heading |
| Staging walk before release for every surface; the release approver's steps in the PR body | PR template; `pnpm verify:live staging` |
| Rollback: every agent and every channel has an org-level switch (D-RA9); the kill switch pauses ads; a feed can be disabled without a deploy | `recruiting_ai_settings`, `recruiting_ads_settings`, `org_integrations.enabled` |

---

## 6. The ads control plane

```
Requisition (profile version + pay + lane + headcount)
   │  A10 drafts copy (EN/ES), checks every claim against the profile  ──► recruiter approves copy
   ├─► Job page + JobPosting JSON-LD + sitemap ──► Indexing API ping ──► Google for Jobs (free)
   ├─► Indeed Job Sync: post / update / close                          (Q-RA5)
   ├─► Meta campaign: created PAUSED, EMPLOYMENT, country, ≤ cap ──► owner clicks Launch
   └─► Google Ads (later)
                      ▼ leads come back
   Meta leadgen webhook + daily /leads backfill · intake mailbox · job-page form · Tenstreet push · signed webhook
                      ▼ ingest_lead(org, channel, external_ref, raw)   — idempotent, raw kept
   recruiting_leads ─► A2 extraction (proposed) ─► recruiter confirms ─► leadMatch verdicts
                      ▼
   A1 brief / call-today queue ─► recruiter ─► convert_lead ─► applicant ─► hire ─► seated 90 d
                      ▼
   ads_spend_daily (pulled) ⇄ ads_ledger (ours): reconcile job, alert on mismatch
                      ▼
   A11: cost per seated driver per campaign ─► recommendation ─► owner approves ─► API applies (≤ cap)
```

Tables (all new, RLS on, service-role only): `requisitions`, `requisition_versions`, `ads_accounts`
(sealed tokens, `expires_on`), `ads_campaigns` (platform ids, status, cap, requisition), `ads_actions`
(append-only: create/launch/pause/budget-change with actor, request, response), `ads_spend_daily`,
`recruiting_ads_settings` (caps per channel, kill switch state). Secrets follow `medstop_credentials`.

---

## 7. Phases — one PR per step, schema before reader, each with its *done when*

| Phase | Steps | Done when (measured) |
|---|---|---|
| **RA0 · Decide** | Owner answers Q-RA1–4, Q-RA19; counsel gets Q-RA6 added to the package; the UNVERIFIED items in §1 are measured (toll-free approval, counsel memo sent, draft prune) | Every question in §9 has a ruling or a dated fallback |
| **RA1 · Foundation** | 2.1 lead ledger + contacts + `convert_lead` (R1/S1) · 1.1 Hiring Profile + 3.1 `leadMatch` (S2) · 1.2 requisition · 2.2 lead consent column · 2.10 dedupe · 4.7 email suppression/bounce · 4.8 SMS retry · 7.3 structured reasons · 12.3 AI notice + provenance table · 12.7 failed-jobs page · generic `callClaude` + input hash · `recruiting_ai_settings` | A lead created three ways (form, paste, API) shows once with its channel; `leadMatch` fixture tests cover every rule's boundary; a bounced email suppresses the address; the failed-jobs page lists a forced failure |
| **RA2 · Recruiter feel** | 3.2 queue · 3.3 A1 brief · 3.4 badge/alert · 3.5 assignment · 3.6 callbacks · 3.7 owned pools · 4.1 A4 drafter · 4.2 conversation view · 4.3 A5 notes · 4.6 transactional messages (if Q-RA2 b) · 12.6 fixture gate | Median time-to-first-contact is measured for the first time (baseline); brief deduped once per recruiter per day; drafter output never sent without a click (test) |
| **RA3 · Intake** | 2.4 Meta webhook+backfill · 2.5 mailbox · 2.6 Tenstreet listener (T2) · 2.7 signed webhook · 2.8 paste box · 2.9 A2 extractor · 2.11 line-type check · 5.3 prefill | A dropped webhook is recovered by the backfill within 24 h (test by suppressing the webhook); every lead row has raw payload; replay rebuilds projections equal |
| **RA4 · Processing agents** | 6.6 A6 discrepancies · 6.7 A7 VOE send/read/chase · 6.8 reply link · 6.5 registry check · 5.4 A8 document reader · 5.5 gap checks · 8.3 A9 readiness · 7.2 R10 build (send on counsel) · 4.4 click-to-call · 4.5 booking · 6.10 E6 | Each agent's fixture agreement ≥ the threshold set in RA2; every flag cites a source line; VOE median days-to-response measured before/after |
| **RA5 · Owned channels** | 1.3 A10 · 1.4 job pages + JSON-LD · 1.5 Indeed Job Sync · 2.3 lead form + bot defence | Google indexes a page within 24 h (Search Console); Indeed shows the posting; form leads attribute correctly |
| **RA6 · Money and the hire** | 1.6 Meta create · 1.8 auto-close · 1.9 spend reconcile · 1.10 caps + kill switch · 9.3–9.9 applicant→driver provisioning and checks · 11.1–11.6 reports | Reconcile shows zero unexplained mismatch over 14 days; a cap+1 request is refused (test); hire creates credentials and links the EFS card without a by-name duplicate (count `identity_source='efs'` duplicates before/after) |
| **RA7 · Optimisation and orientation** | 11.3 budget recommendations → (switch) auto-reallocation · 8.1 orientation event · 7.4 offer letter · 4.9 A12 Q&A (if allowed) | Eight weeks of 90-day-seated data exist before the auto switch is offered |
| **RA8 · After the hire** | 10.1–10.3, 10.6, 2.12 referrals | Exit reason present on 100% of status changes after the rule ships |

Everything in RA4 that touches only existing applicants can run **in parallel** with RA3.

---

## 8. How we will know it works

Baselines are taken in RA1–RA2; targets are set after four weeks of data, never invented.

- **Speed to first contact** (median, business hours) for inbound leads.
- **Precision**: share of leads a recruiter marks "reachable + meets hard requirements" after the
  first call — the "not 1,000 junk leads" number.
- **Conversion by source**: lead → applied → hired → seated at 90 days; **cost per seated driver**.
- **Unknown rate**: hard requirements still `unknown` at first contact (measures forms and intake).
- **Override rate**: dispositions against the verdict (a high rate means the profile is wrong).
- **Agent agreement**: confirmed vs corrected per agent per prompt version (D-RA4 rows).
- **Hours per hire** on the processing steps (VOE, discrepancy review, documents) before vs after.
- **Reconcile mismatches** per month (target: zero unexplained).

---

## 9. Open questions

Owner questions, with candidates, a recommendation and the fallback the code takes if unanswered.

- **Q-RA1 · Tenstreet — RULED 2026-10-26: the contract is ACTIVE.** T2 stands; 2.6 (the push
  listener) is built in RA3. **Q-RA1b still owed** (owner): monthly cost, renewal date, whether
  Tenstreet Assistant is included, and the account manager's name — the API terms, fees and schema
  come from that person, and the renewal date is the cut-off T2 plans around. *Fallback:* 2.6 is
  designed from the public description (accept/reject POST protocol) and finished when the schema
  arrives.
- **Q-RA2 · D-LS6 restated — RULED 2026-10-26: (b).** No automated *first* contact; automated
  *transactional* messages (confirmations, document requests, appointment reminders) may go to an
  applicant with a live consent. So 4.6 is built; 4.9 (A12 Q&A, driver-initiated) is allowed; A7
  may send VOE requests to *employers* automatically once Q-PEI2 settles the sender. (c) stays
  out. D-RA2 is now a ruling, not a default.
- **Q-RA3 · Q-LS7 restated — RULED 2026-10-26: (b).** The system creates campaigns paused; a person
  launches and approves every budget change; monthly caps per channel are enforced in code; spend is
  reconciled daily; one action pauses everything. D-RA6 is now a ruling. Auto-reallocation (c)
  remains behind D-RA10's eight-week gate and its own switch.
- **Q-RA4 · Ad accounts** (owner): Meta Business + ad account + Page, admin, Business Verification
  done?, monthly budget per channel, yards/lanes we hire for with the operational reason (= Q-LS2).
  **Fallback:** RA5/RA6 wait.
- **Q-RA5 · Indeed** (us, by asking Indeed): is direct-employer Job Sync real and on what terms?
  **Fallback:** XML feed, or Indeed leads by email only.
- **Q-RA6 · Counsel** (adds to the memo): (a) HB 3773 notice wording and which dimensions 11.6 may
  test; (b) FEHA/CCPA ADMT exposure if California residents apply; (c) TCPA wording for the lead
  form's SMS box; (d) Colorado SB 26-189; (e) whether A6's flags are an "automated decision". **Must
  first be confirmed: was the 2026-09-24 memo ever sent?** (§1.3, UNVERIFIED.)
- **Q-RA7 · Hiring requirements — RULED 2026-10-26** (= Q-REC1 / Q-LS1 / Q-LS3, open since
  2026-08-20). The answers are the Hiring Profile v1 in **§3a**: age ≥ 23; ≥ 2 years verifiable
  Class A; Class A CDL; hazmat preferred; four hard disqualifiers (CMV DUI ever / any DUI 5 y,
  preventable recordable accident 3 y, Clearinghouse prohibited, positive/refusal without RTD); no
  numeric violation limit (recruiter judges, counts shown); sources = Tenstreet boards, Indeed,
  Facebook/Instagram, referrals. **Two pieces still owed:** Q-RA7c-ii (is an automatic-only CDL
  restriction acceptable? *fallback:* shown, not judged) and Q-RA7f-ii (monthly spend per channel
  and weekly lead volume; *fallback:* cost reported only where entered).
- **Q-RA8 · Lead retention** = Q-REC7 / Q-LS6 (owner). **Fallback:** nothing prunes; schema stays
  prunable.
- **Q-RA9 · Former drivers** = Q-LS4 (owner): may we re-contact; who marks rehire-eligible.
  **Fallback:** imported, invisible until marked one by one.
- **Q-RA10 · Meta lead-form fields** (us): confirm against Meta policy whether employment lead forms
  may ask location/age. **Fallback:** the form asks neither; the profile's hard questions only.
- **Q-RA11 · Bot defence** (owner/us): Cloudflare Turnstile (free tier) vs hCaptcha vs none. Today
  there is no CAPTCHA and limiters are per replica. **Recommendation:** Turnstile + a shared-store
  limiter. **Fallback:** per-replica limiter + honeypot field.
- **Q-RA12 · Intake mailbox** (owner): a new M365 mailbox (reusing `graphMail.ts`) vs Brevo inbound
  parsing. **Recommendation:** M365, the credentials and code exist. **Fallback:** recruiters
  forward to the paste box.
- **Q-RA13 · Phone lookup cost** (owner): Telnyx Number Lookup is per query; budget it or skip.
  **Fallback:** skip; line type `unknown`.
- **Q-RA14 · Assignment rule** (owner): round-robin, by yard/lane, or manual. **Fallback:** manual
  with an "unassigned" queue.
- **Q-RA15 · Click-to-call** (owner): Telnyx Voice (recorded? consent to record varies by state) vs
  a `tel:` link that logs the attempt. **Recommendation:** `tel:` link + logged attempt.
- **Q-RA16 · Calendar** (owner): M365 Graph calendar for booking, or none. **Fallback:** a booking
  slot table with no external calendar.
- **Q-RA17 · National Registry check** (owner/us): NRCME has no public API. Deep link + reminder +
  recorded act (exists), or a vendor. **Fallback:** deep link + recorded act.
- **Q-RA18 · Offer letter** (owner): does the carrier issue one? Template? **Fallback:** not built.
- **Q-RA19 · May a recruiter hire? — RULED 2026-10-26: (b).** A recruiter may complete the hire
  when every gate is green. Build (RA1, item 7.5): `routes/hire.ts` accepts `recruitment: manage`
  as well as `roster: manage`; `hireBlockers` and the `compliance.applicant_hired` audit are
  unchanged; the web `HireDrawer` shows for the recruiter. ⚠ `rosterMastery` / `canWriteDriverLifecycle`
  (`hire.ts:34-36`) is the predicate to widen — read its SP5 comment before touching it, and keep
  the status→active trigger (`mig/0386:68`) as the only path.
- **Q-RA20 · Samsara write token** (owner): a second, write-scoped token for driver creation, or
  the Samsara driver stays a checklist item for the office. **Fallback:** checklist item + the
  existing sync links it once Samsara has it.
- **Q-RA21 · Payroll/settlement checklist** (owner): the items and who owns each. **Fallback:** a
  free-form checklist the admin edits.
- **Q-RA22 · AI models** (us): `AI_MODELS` pins `haiku-4-5` / `sonnet-4-6`; each agent picks fast or
  deep and the fixture gate decides whether a newer model ships. No assumption about model names is
  made here; `AI_MODELS` is the one place they live.
- **Q-RA23 · Chat/notification channel for the brief** (owner): in-app + email, or also the office
  chat (`OFFICE-CHAT-PLAN`). **Fallback:** in-app + email.

**Position after 2026-10-26's sitting:** Q-RA1, Q-RA2, Q-RA3, Q-RA7 and Q-RA19 are ruled; RA0 is
complete for RA1's purposes. Still owed, none blocking RA1: Q-RA1b (Tenstreet terms), Q-RA7c-ii
(automatic-only restriction), Q-RA7f-ii (spend and volume per channel), Q-LS2/Q-RA4 (hiring area),
and the two UNVERIFIED facts in §1.3 (was the counsel memo sent; was the toll-free number approved).

---

## Sources (read 2026-10-26)

**Claude Duet** — [Anthropic opens Claude Duet to US Pro and Max (AI Weekly)](https://aiweekly.co/alerts/anthropic-opens-claude-duet-an-opus-55-agent-to-us-pro-and-max) ·
[Claude Duet support article](https://support.claude.com/de/articles/17631495-erste-schritte-mit-claude-duet)

**Tenstreet** — [What you need to know about Tenstreet's API](https://www.tenstreet.com/blog/about-tenstreet/tenstreets-api-guide-everyone-else) ·
[Tenstreet Assistant](https://www.tenstreet.com/tenstreet-assistant) ·
[UConnect26 announcement](https://finance.yahoo.com/sectors/technology/articles/uconnect26-tenstreet-helps-carriers-reduce-160000833.html) ·
[Drivers prioritise human connection (2026-06-04)](https://www.globenewswire.com/news-release/2026/06/04/3306896/0/en/tenstreet-analysis-reveals-drivers-prioritize-stability-and-connection-amid-ai-recruiting-shift.html) ·
[LeadsBridge: Tenstreet](https://leadsbridge.com/documentation/tenstreet/) ·
[Samsara: integrate with Tenstreet](https://kb.samsara.com/hc/en-us/articles/4419950603277-Integrate-with-Tenstreet)

**Meta** — [Special Ad Categories](https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/special-ad-category) ·
[Lead Ads webhooks](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/quickstart/webhooks-integration) ·
[Marketing API authorization](https://developers.facebook.com/docs/marketing-api/get-started/authorization) ·
[Boostpoint: employment special ad category 2026](https://boostpoint.com/meta-special-ad-category/)

**Google / Indeed** — [Google Ads: employment in personalised advertising](https://support.google.com/adspolicy/answer/16700442) ·
[Indeed release notes (2026-07-31)](https://docs-plus.indeed.com/release-notes) ·
[Indeed Job Sync API](https://docs.indeed.com/job-sync-api)

**Law** — [Manatt: California and Illinois AI hiring 2026](https://www.manatt.com/insights/newsletters/employment-law/ai-assisted-hiring-faces-a-new-compliance-landscape-in-2026-california-and-illinois-put-discriminatory-impact-and-transparency-front-and-center) ·
[Epstein Becker Green: workplace AI regulation 2026](https://www.ebglaw.com/insights/publications/workplace-ai-regulation-in-2026-how-employers-can-navigate-the-changing-legal-landscape)

---

## Progress log

- **2026-10-26** — Document created as the three-route analysis (Duet / Tenstreet / in-house +
  ads). `LEAD-SOURCING-PLAN.md` and `LEAD-ENGINE-RESEARCH.md` brought to main from `94627f7`.
- **2026-10-26, later** — Rewritten as the whole-hire plan after a measured inventory of main
  `c0e2801`: §1 (what exists, with file:line), §4 (the catalogue, 12 stages, ~90 items), §5 (the
  reliability bar with its enforcement), §7 (RA0–RA8 with *done when*), §9 (Q-RA1–23). Corrections
  to the chat list recorded in §1.4: adverse action is NOT built; Med-Stop read-back and PSP pull
  ARE built; hire provisions nothing downstream; a recruiter cannot hire. **Nothing built.**
- **2026-10-26, evening** — Owner sitting. **Q-RA1 ruled: Tenstreet active** (terms owed as
  Q-RA1b). **Q-RA2 ruled (b)**: no automated first contact; transactional messages to consented
  applicants allowed — D-RA2 is a ruling. **Q-RA3 ruled (b)**: create paused, person launches,
  caps — D-RA6 is a ruling. **Q-RA19 ruled (b)**: a recruiter may hire when every gate is green
  (item 7.5 moves to RA1). Q-RA7 remains the one owner answer RA1's match engine waits on.
  **Nothing built.**
- **2026-10-26, later the same evening** — **Q-RA7 ruled**, six parts in one sitting; recorded as
  the Hiring Profile v1 in §3a. This closes Q-REC1 (RECRUITING-SYSTEM-PLAN §6) and Q-LS1/Q-LS3
  (LEAD-SOURCING-PLAN §7) by reference. Not given: spend and volume per channel (Q-RA7f-ii) and
  the automatic-only restriction (Q-RA7c-ii). ⚠ Q-RA7e is a deliberate *non*-rule: violation
  counts are shown and the recruiter judges — so A11's precision metric (§8) cannot use "meets" for
  violations and must use the recruiter's recorded decision reason (item 7.3) instead. **Nothing
  built.**
- **2026-10-31** — The owner asked for the ads agent with Tenstreet and Indeed in 4–5 days, production
  ready. Written as `ADS-AGENT-PLAN.md`: it re-orders this plan (ads control plane 1.2/1.3/1.6/1.8–1.10
  and Meta intake 2.4 pulled ahead of the rest of RA1, on top of 2.1/2.10/1.1/3.1) without changing
  any D-RA ruling, and asks Q-AD1–9. Q-RA10 gets a fallback from Meta's form rules (no age, no
  location, no criminal history, no licence number). **Nothing built.**
