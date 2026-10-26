# Recruiter automation — Claude Duet, Tenstreet, in-house agents, and ads we control · 2026-10-26

**Status: PROPOSED. Nothing built. Two earlier owner rulings would change (§0.2), so §7 comes before
any code.**

The owner's ask (2026-10-26): automate and assist the recruiters. Three candidate routes were named:

1. **Claude Duet** (Anthropic's proactive personal agent).
2. **Tenstreet over its API**, with **agents inside Silvicom 360**.
3. **An automated system for running social-media ads**, controlled by Silvicom 360.

He asked for everything we could build, and only solutions that are reliable and enterprise grade.

This document extends `LEAD-SOURCING-PLAN.md` (2026-09-25, D-LS1–10, phases S0–S8). It does not
replace it. That plan's ledger, Hiring Profile and attribution are the foundation every route below
stands on. That plan and its research note were written in commit `94627f7` and never reached main.
They arrive in the same PR as this document, so the references resolve.

---

## 0. Ground truth, and the two rulings this ask collides with

### 0.1 What exists (measured on main `c0e2801`)

- **Silvicom 360 already holds an ATS.** It covers the invite (by email or by text, #1675/#1679),
  the wizard, Spanish (C4, #1701), capture, the §391.21 packet PDF, the checklist and board
  (`modules/recruiting/applicantChecklist.ts`, `applicantBoard.ts`), MVR, Clearinghouse and
  drug-test recording (D1), Med-Stop, nudges (one per part, Q-AW37), dispositions and adverse
  action. `docs/SILVICOM-360.md` calls it **"code-complete and legally inert until counsel clears
  the instruments."**
- **Leads, attribution and a Hiring Profile do not exist.** There are no lead tables in
  `supabase/migrations/`. The only source hint is the free-text `heard_from`, and it is projected
  nowhere. **Today nobody can say which channel produces hires**, so no ad budget can be steered by
  results yet.
- **The carrier's live recruiting runs in Tenstreet.** McLeod's `dbo.driver_application` holds 2
  rows and `driver.tenstreet_id` exists (`MCLEOD-SQL-SOURCE-OF-TRUTH.md` §0). Whether the Tenstreet
  contract is still active, what it costs and when it renews are **not known to this repo** (Q-RA1).
- **The AI rails exist.** `lib/anthropic.ts` (`callClaude`, forced-tool structured output) and
  `packages/shared/src/ai.ts` (`AI_MODELS`, `withinBudget`, `aiInputHash`). BOL reading and hazmat
  extraction are the precedents for budgeted, hashed and reviewed extraction.
- **The contact rails exist.** Telnyx SMS is gated on `sms_consents`, which today requires
  `driver_id`, so a lead cannot hold consent. Email goes through Brevo and has **no suppression
  list**.

### 0.2 Earlier rulings this ask would replace. Say so before building

| Ruling | What it says | What the new ask needs |
|---|---|---|
| **D-LS6** (owner, 2026-09-25) | *"all the contacts will be done by real persons and not automated."* No triggered or bulk SMS or email to a lead, no autodialer, no AI voice agent. | "Automatization" that **contacts** people breaks it. Drafting, queueing, reading and checking do not. |
| **Q-LS7** (open, recommendation recorded) | "The system ingests; it does not buy media." | An ad system that creates campaigns and moves budget replaces this. |

Neither is mine to overturn. §7 puts both back to the owner with candidates. Note one thing that
is already true: the nudge sweep (`applicationNudgeSweep.ts`) **already sends an automated message to
an applicant**. D-LS6 was written about *leads*, people who have not applied. The line the owner
drew is therefore really **"no automated first contact"**, not "no automation." Q-RA2 asks him to
confirm that reading.

---

## 1. Route 1 · Claude Duet: **not for applicant data**

**Facts (2026-10-26):**

- Duet launched 2026-10-21 as a research preview, for **US Pro and Max subscribers only, from a
  waitlist. Team and Enterprise plans are not included.**
- It is a *personal* agent. It reads one person's Gmail, Slack and other connectors (6,000+), sends
  a morning brief, takes tasks by message and asks before it sends, pays, signs or deletes.
- You cannot choose its model or watch its browser. Anthropic itself warns it may misread a thread
  or misjudge urgency.

**Why it fails "enterprise grade" for recruiting:**

- **The data goes to the wrong place.** Applicant PII (SSN-adjacent identity, MVR, drug-test
  status) would flow through each recruiter's *consumer* subscription. That subscription sits
  outside the organisation's agreements and outside Silvicom's RLS, audit log and retention rules.
- **It cannot be held to our rules.** D-LS6, the HB 3773 AI notice and the FEHA four-year
  record-keeping all need every AI action logged against the applicant's record. Duet's log lives
  in Duet.
- **It sees only what reaches the inbox.** It cannot read the checklist, the board, the MVR or the
  packet, so its brief would be built from email fragments, not from the system of record.

**What it is fine for:** the owner's or a recruiter's own calendar and non-applicant email. **The
idea worth taking is its shape:** a morning brief, approval before any send, and a ping when work
finishes. That shape is built *inside* Silvicom as agent A1 (§3), where it can read the real queue.

---

## 2. Route 2 · Tenstreet over its API

### 2.1 What the API is (public facts; no public developer docs are indexed)

- **Access is by request, approved per use.** The client emails Tenstreet a description of the use.
  After approval, the client gives Tenstreet a URL, and **Tenstreet POSTs to it**: all application
  data, documents, subject updates and Xchange (VOE) data. Delivery can be manual, nightly, or on
  every subject update. The listener acknowledges each delivery, and Tenstreet retries until every
  delivery is accepted. Data can also go *in*: lead and application records can be posted to
  Tenstreet.
- **Fees, rate limits and the schema are not published.** Third parties (LeadsBridge) describe the
  approval as strict. Q-RA1 must get the real terms from the carrier's Tenstreet account manager.
- **Tenstreet now sells its own agent.** *Tenstreet Assistant* was announced at UConnect26 in May
  2026, with rollout planned for August 2026.
  - It runs **VoiceBot calls** to candidates and **automatic welcome messages** to new leads.
  - It reviews PSP-against-application and MVR-against-application discrepancies, reads
    Clearinghouse reports, rekeys faxed VOEs and finds additional licences.
  - It is built into Tenstreet. **None of it is exposed over the API.**
  - Vendor claims: 25% of routine time saved, and heavy users hire at 4.5% against 2%. Read these
    as marketing.
- Tenstreet's own June 2026 analysis of about 5,000 carriers found that **driver interest, built
  through personal recruiter contact, is the strongest predictor of a hire**, and drivers say they
  prefer a human. That supports D-LS6's instinct rather than undermining it.

### 2.2 The real decision is the system of record, not the integration

Two ATSs cannot both be the answer. A two-way sync between them is exactly the "second source of
truth" `CLAUDE.md` forbids. The three possible postures:

| Posture | What it means | Verdict |
|---|---|---|
| **T1 · Tenstreet stays the ATS** | Silvicom takes a one-way push of *hired* drivers' applications and documents into the DQF. We stop investing in our own application flow. | Cheapest and lowest risk, but it writes off the application system, the packet, the instruments and the counsel work, and it pays Tenstreet indefinitely. Agents would then belong inside Tenstreet (Assistant), not inside Silvicom. |
| **T2 · Silvicom becomes the ATS; Tenstreet is a one-way feed until cutover** | Tenstreet's push lands in our lead ledger (S1). The Tenstreet subject id becomes `external_ref`, and the ledger is idempotent on it. Recruiters work from Silvicom. Historical applications are imported once for DQF evidence. Tenstreet is cancelled at renewal. | **Recommended**, *if* the owner confirms Silvicom is meant to be the ATS (D-S360 already lists Applications as a Silvicom 360 safety feature). It is reliable because the data flows one way, has one owner and has a cut-off date. |
| **T3 · Two-way sync** | Both systems are edited and kept in step. | **Rejected.** Every conflict becomes a recruiter's problem, and every agent has to ask which system is right. |

**Caveat that changes T2's timing:** our application flow is *legally inert* until counsel clears
it. T2 therefore cannot cut over before the counsel package closes. Before that, T2 means **Tenstreet
remains the live intake, and Silvicom mirrors it read-only** so that the agents in §3 have data to
work on.

---

## 3. Route 2b · Agents inside Silvicom 360: the catalogue

Every agent follows four rules, inherited from D-LS2/D-LS3/D-LS4 and the BOL reader:

- **The model reads and drafts, and pure rules decide.** No agent rejects, ranks by an opaque
  score, or dispositions anyone (D-LS3).
- **Every output is shown beside its source** and confirmed by a named person before it becomes a
  fact. Every output is stored with the model, the prompt version and `aiInputHash`, and labelled
  "AI" in the UI (the HB 3773 notice and FEHA records).
- **Every agent is budgeted** (`withinBudget`), idempotent on its input hash, and runs as a worker
  job with retries, never inside a request.
- **No agent sees protected characteristics or their proxies.** That means no photo, no inferred
  ethnicity, no age beyond the policy gate and **no ZIP code** (HB 3773 names ZIP).

| # | Agent | What it does for the recruiter | Contacts anyone? | Depends on | Value |
|---|---|---|---|---|---|
| **A1** | **Recruiter morning brief + queue** | The Duet shape, inside Silvicom: who to call today and why, ordered by "hard requirements met → fewest unknowns → freshness." It shows new leads not yet contacted, stalled applications, expiring links and orientation dates at risk. It is delivered in-app and, optionally, by email to the *recruiter*. | No | S1, S2 | **High.** Speed to first contact is the variable carriers win on. |
| **A2** | **Lead intake extractor** | Turns a job-board email, a Meta lead, a Tenstreet push, a pasted Facebook post or a resume into a structured lead, shown beside the source text for confirmation. Deduplicates on phone and email against leads, applicants and drivers. | No | S1, S5 | High |
| **A3** | **Requirement matcher + "why"** | The pure `leadMatch` returns meets, does-not-meet or unknown per requirement, with the evidence level. The model only writes the plain-English reason. | No | S2 | High |
| **A4** | **Message drafter** | Writes a first message, a follow-up or a reply in the carrier's voice and in English or Spanish. **The recruiter edits and sends.** | No, the person sends | S1 | Medium-high |
| **A5** | **Call notes → facts** | The recruiter pastes notes or a call transcript. The agent proposes structured facts (experience, endorsements, home-time wish) and the recruiter ticks each one. | No | S1 | Medium |
| **A6** | **Application discrepancy reviewer** | Compares the §391.21 application with the MVR, PSP and Clearinghouse results and the 10-year employment history. It flags undisclosed violations, licence mismatches, unexplained gaps and the 3-year commercial-driving window. This is Tenstreet Assistant's "processing" tier, built on our own records. | No | Existing D1 records | **High.** It replaces hand reading, and every flag cites the line it came from. |
| **A7** | **§391.23 VOE assistant** | Drafts the previous-employer inquiries, tracks the 30-day clock, reads returned PDFs and faxes into structured responses (the `EMPLOYER-INQUIRY-PLAN` records) and flags non-responses for the good-faith-effort note. | **Employers, not drivers.** The send is the recruiter's click until Q-RA2 says otherwise. | Employer-inquiry module | **High.** VOE chasing is the slowest step in most hires. |
| **A8** | **Document reader** | Reads the CDL, medical card and SSN-card photos into fields (class, endorsements, expiry, restrictions) and checks them against the application. This reuses the BOL reader's pipeline and its review screen. | No | Existing capture | Medium-high |
| **A9** | **Orientation readiness check** | Before the date, it checks that every checklist item, document, drug test result and road test is in place, and tells the recruiter what is missing and who owns it. | No | Checklist | Medium |
| **A10** | **Job ad and posting writer** | From one requisition (the Hiring Profile plus pay, home time and lane), writes the job page, the Indeed posting and the Meta ad text in English and Spanish. It checks every claim against the profile, so no ad promises pay the profile does not hold. | No | S2, §4 | Medium |
| **A11** | **Source quality and fairness analyst** | Weekly, per channel and campaign: leads, reached, qualified, applied, hired, still seated at 90 days and cost. It runs a disparate-impact check on dispositions per requirement (HB 3773 judges *effect*) and writes a plain summary. | No | S1, S7 | **High.** This is what makes "reliable" measurable. |
| **A12** | **Applicant-initiated Q&A** | On the job page, answers questions about pay, home time and equipment **from the Hiring Profile only**. It hands off to a recruiter and never asks about protected traits. | Replies only when the driver starts the conversation | S2, Q-RA2 | Medium. Needs the owner's ruling. |
| *A13* | *Outbound AI voice or SMS agent (the Tenstreet VoiceBot / Double Nickel kind)* | Calls or texts leads on its own. | **Yes, automated first contact** | — | **Not proposed.** It breaks D-LS6 and carries TCPA exposure of $500–$1,500 per message, mostly in class actions. Listed so the owner sees it was considered. |

---

## 4. Route 3 · Ads we control: an ads control plane

### 4.1 What the platforms allow (2026-10-26)

- **Meta (Facebook and Instagram).**
  - The Marketing API manages *our own* ad account with **Standard access**, plus **Business
    Verification**. Advanced access and App Review are needed only to manage other businesses'
    accounts.
  - Job ads **must** be declared `special_ad_categories: ["EMPLOYMENT"]`. That forces all ages and
    genders, removes ZIP and lookalike targeting, and widens US location targeting to at least a
    15-mile radius.
  - Lead Ads deliver a webhook that carries only the `leadgen_id`. We fetch the fields with a Page
    token that has `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`,
    `pages_read_engagement` and `ads_management`.
  - The cost claim is about $27 per CDL applicant (Boostpoint, 2026; vendor figure).
- **Google.**
  - **Google for Jobs** is free. Google crawls `JobPosting` JSON-LD from our own job pages, and the
    Indexing API lists a new page within hours.
  - **Google Ads employment policy** (US) bars targeting by age, gender, parental status, marital
    status and ZIP. Radius, city and country targeting are allowed.
- **Indeed.**
  - The **Job Sync API "is now available to direct employers"** (Indeed release notes,
    2026-07-31), so we can post and update jobs ourselves. Indeed's own Job Sync guide still says
    the opposite. Confirm with Indeed before building (Q-RA5).
  - The Sponsored Jobs API is gated on recent sponsored spend. Indeed Apply into our own ATS needs
    the ATS-partner agreement, which is still unrealistic for one carrier. Leads can arrive by
    email to the intake (A2).
- **TikTok, LinkedIn and CDL boards** (CDLjobs, JobsInTrucks). Not researched to the same depth.
  Treat them as later S5 adapters, and check each platform's employment policy first.

### 4.2 The design: one requisition, many channels, one ledger

```
Requisition (Hiring Profile + pay + lane, versioned)  ── A10 drafts copy ──► recruiter approves
   │
   ├─► Job page (ours) + JobPosting JSON-LD ─────────► Google for Jobs (free)
   ├─► Indeed Job Sync (post / update / close)
   ├─► Meta campaign  ── created PAUSED, EMPLOYMENT category, budget ≤ cap ──► owner clicks "launch"
   └─► Google Ads (later)
                         leads come back ▼
   Meta leadgen webhook · Indeed/board email · job-page form · Tenstreet push (T2)
                         ▼
   recruiting_leads (S1) — channel / source / campaign / external_ref, idempotent
                         ▼
   A1 queue → recruiter → application → hire → still seated at 90 days
                         ▼
   Spend pulled daily from each platform's insights API → A11: cost per seated driver, per campaign
                         ▼
   Budget RECOMMENDATION (shift $X from campaign A to B) → owner approves → API applies it
```

**What makes it enterprise grade rather than a script:**

- **Money moves only with a person's approval.** Campaigns are created `PAUSED`, and launch, budget
  increases and new campaigns are approval actions recorded with `created_by`. A **hard monthly cap
  per channel** is stored in the org's settings and enforced in code, so an API call above it is
  refused before it leaves. A kill switch pauses every campaign in one action.
- **Every outbound ad API call is logged**, append-only, with its request, response and actor, and
  **reconciled daily**: platform-reported spend against our ledger. Any mismatch raises an alert,
  not a silent fix.
- **Intake is idempotent.** Each lead is keyed on `(channel, external_ref)`, and the raw payload is
  stored whole with a re-derivable projection (the D-PSP2 pattern). A webhook whose fetch fails
  goes to a retry queue. A daily backfill pulls each form's `/leads` so that a missed webhook is
  caught.
- **Secrets** (the Meta system-user token and the Indeed client credentials) live in the server's
  secret store, never in the SPA. Token expiry gets its own alert.
- **Compliance is enforced in code.** The `EMPLOYMENT` category is set by code and cannot be edited.
  No audience field accepts age, gender or ZIP. The lead form carries the HB 3773 AI notice and an
  **optional, separate** SMS-consent box that writes `sms_consents(source='lead_form', lead_id)`.
- **The optimisation is a recommendation first.** Automatic reallocation within caps is a later
  switch, turned on only after A11 has eight weeks of 90-day-seated data to optimise on. Before
  then, any "optimisation" optimises cost per *lead*, which is the junk-lead metric the owner
  rejected.

---

## 5. Side by side

| | Claude Duet | Tenstreet API + Tenstreet Assistant (T1) | Silvicom ATS + agents + ads plane (T2) |
|---|---|---|---|
| Where applicant data lives | Each recruiter's consumer account | Tenstreet | Silvicom (our RLS, audit and retention) |
| Sees the real pipeline | No, only the inbox | Yes, inside Tenstreet | Yes |
| Audit trail per applicant | No | Tenstreet's | Ours, append-only |
| Who controls automated contact | Duet's approval prompt | Tenstreet's VoiceBot and welcome messages | The owner's ruling, enforced in code |
| Ads | — | Through Tenstreet's job-board partners | Our control plane with caps and approval |
| Time to first value | Days (waitlist) | Weeks (API approval) | S1 + A1 in about 2–3 weeks; ads plane about 6–8 weeks |
| Running cost | Pro or Max seat per person | Tenstreet contract (unknown, Q-RA1) | Claude API usage (budgeted) + ad spend |
| Lock-in | Low | High | None (it is ours) |
| **Verdict** | **No** for applicant data | **Only** if the owner abandons our ATS | **Recommended** |

---

## 6. Phases (one PR per step; schema merges before its reader)

- **RA0 · Decide.** The owner answers Q-RA1–Q-RA4, and counsel gets Q-RA6. *No code.*
- **RA1 · Foundation** (= LEAD-SOURCING S1 + S2). The lead ledger with `channel/source/campaign/
  external_ref`, the append-only `recruiting_contacts`, and the versioned Hiring Profile with the
  pure `leadMatch`. **Every later step depends on this.**
- **RA2 · Recruiter brief** (A1) and the message drafter (A4). This is the first thing recruiters
  feel.
- **RA3 · Intake adapters** (S5 + A2): the per-org intake email, the Meta Lead Ads webhook with a
  daily backfill, the signed generic webhook, and the **Tenstreet push listener (if T2)**.
- **RA4 · Processing agents:** A6 (discrepancies), A8 (documents), A7 (VOE), A9 (orientation). These
  work on applicants who already exist, so they can run in parallel with RA3.
- **RA5 · Owned channels:** job pages with JSON-LD and a sitemap, the lead form with the AI notice
  and consent, Indeed Job Sync, and A10.
- **RA6 · The ads control plane on Meta:** campaign create (paused), caps, approval, kill switch,
  daily spend reconciliation and A11's source report. Google Ads follows.
- **RA7 · Optimisation:** budget recommendations, then (by switch) automatic reallocation within
  caps. A12, only if Q-RA2 allows it.

---

## 7. Open questions

- **Q-RA1 · Tenstreet** (owner). Is the contract active, what does it cost, and when does it renew?
  Is Tenstreet Assistant in it? Who is the account manager? The API terms, fees and schema come
  from that person. *Decides T1 against T2.*
- **Q-RA2 · D-LS6, restated** (owner). Candidates:
  - (a) Keep it as written: no automated message to anyone who has not applied.
  - (b) **Recommended.** Keep (a) for leads, and allow automated *transactional* messages to people
    who applied *and* consented: confirmations, document requests, appointment reminders. This is
    what the nudges already do. The line becomes "no automated first contact."
  - (c) Allow an AI voice or SMS agent to contact leads (A13). This needs written TCPA consent per
    lead and counsel's sign-off, and it is not recommended.

  The same ruling decides whether A7 may send VOE requests to employers automatically, and whether
  A12 exists.
- **Q-RA3 · Q-LS7, restated** (owner). May the system create and launch campaigns? Candidates:
  - (a) Ingest only, as before.
  - (b) **Recommended.** It creates campaigns paused; a person launches them and approves every
    budget change; hard monthly caps apply.
  - (c) It reallocates automatically within caps, from day one.
- **Q-RA4 · Ad accounts and budget** (owner). Which Meta Business and ad account, who has admin
  rights, whether Business Verification is done, the monthly budget per channel, and which yards or
  lanes we hire for (with the operational reason, never a ZIP list; this is Q-LS2).
- **Q-RA5 · Indeed** (us, by asking Indeed). Confirm that Job Sync access for a direct employer is
  real, and on what terms. The release note and the guide disagree.
- **Q-RA6 · Counsel** (adds to Q-LS5):
  - (a) HB 3773 notice wording for A1–A12
  - (b) whether A6's flags or A11's analysis make any part of this an "automated decision system"
    under California FEHA (from 2025-10-01) or CCPA ADMT (from 2027-01-01), if we hire California
    residents
  - (c) TCPA wording for the lead-form consent box
  - (d) whether Colorado SB 26-189 (in force 2027-01-01) applies to applicants from Colorado

**Recommendation:** answer Q-RA1–Q-RA3 in one sitting. If the answers are T2, (b) and (b), start RA1
immediately. It needs no counsel ruling and no ad spend, and without it neither the agents nor the
ads can be measured.

---

## Sources (read 2026-10-26)

**Claude Duet** — [Anthropic opens Claude Duet to US Pro and Max (AI Weekly)](https://aiweekly.co/alerts/anthropic-opens-claude-duet-an-opus-55-agent-to-us-pro-and-max) ·
[Claude Duet support article](https://support.claude.com/de/articles/17631495-erste-schritte-mit-claude-duet)

**Tenstreet** — [What you need to know about Tenstreet's API](https://www.tenstreet.com/blog/about-tenstreet/tenstreets-api-guide-everyone-else) ·
[Tenstreet Assistant](https://www.tenstreet.com/tenstreet-assistant) ·
[UConnect26 announcement](https://finance.yahoo.com/sectors/technology/articles/uconnect26-tenstreet-helps-carriers-reduce-160000833.html) ·
[Drivers prioritise human connection (Tenstreet, 2026-06-04)](https://www.globenewswire.com/news-release/2026/06/04/3306896/0/en/tenstreet-analysis-reveals-drivers-prioritize-stability-and-connection-amid-ai-recruiting-shift.html) ·
[LeadsBridge: Tenstreet integration](https://leadsbridge.com/documentation/tenstreet/) ·
[Samsara: integrate with Tenstreet](https://kb.samsara.com/hc/en-us/articles/4419950603277-Integrate-with-Tenstreet)

**Meta** — [Special Ad Categories (Marketing API)](https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/special-ad-category) ·
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

- **2026-10-26** — Document created. The three routes were researched and the in-house agent
  catalogue (A1–A13) and the ads control plane were designed. Collisions with D-LS6 and Q-LS7 were
  recorded as Q-RA2/Q-RA3. `LEAD-SOURCING-PLAN.md` and `LEAD-ENGINE-RESEARCH.md` were brought to
  main from `94627f7`. **Nothing built.**
