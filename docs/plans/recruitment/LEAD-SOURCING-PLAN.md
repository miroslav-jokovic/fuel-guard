# Lead sourcing — AI-assisted driver leads

Status: **PROPOSAL, 2026-09-25.** Nothing built. Needs a D-S360 decision before any phase starts
(`docs/SILVICOM-360.md:126-127`: a feature not in the inventory needs one), and the owner's answers
in §7 before S2.

Builds on, and does not replace: `RECRUITING-SYSTEM-PLAN.md` **R1 · Leads** and **R2 ·
Pre-qualification** (designed 2026-08-20, never built), **D-REC1** (act ledger plus fold, never a
stored stage) and **D-REC2** (a lead is not a driver). Where this plan and R1/R2 disagree, this plan
says so in-line and why.

---

## 0. The ask, and the one correction it needs

The owner's ask (2026-09-25): an AI-powered system that **finds** drivers, filters them against
requirements the carrier sets, and hands recruiters leads worth calling, which then enter the
existing onboarding flow. Explicitly **not** "a thousand leads that are unreliable or irrelevant."

The correction: **there is no lawful, reliable place for an AI to "search" for individual CDL
drivers.** Research on 2026-09-25 (§2) closes each candidate:

| Idea | Why it cannot be the engine |
|---|---|
| Buy / pull a list of CDL holders | DMV data is under the **DPPA** (18 U.S.C. §2721). The CDL exception covers *verifying* a driver under 49 U.S.C. ch. 313, not finding one; marketing and solicitation use needs the driver's opt-in. *Maracich v. Spears* (2013) read the exceptions narrowly exactly when data was used to solicit. |
| Scrape *profiles* (LinkedIn, Facebook, the web) | Few drivers have a usable profile, the ones found are stale, and a profile does not tell you the person is looking for work. This produces the 1,000 useless leads. *(Scraping **job-seeking posts** is different; see the amendment below and §3a.)* |
| People-data brokers (enrich a name to a phone) | Poor CDL coverage. Scoring people from data they did not give us is now the subject of FCRA class actions (*Kistler v. Eightfold AI*, filed 2026-01-20). The CFPB withdrew its guidance in 2025, but the statute and private suits remain. |
| Cold-text the numbers we find | TCPA: automated texts are calls, $500–$1,500 **per message**, and 80% of 2024's 2,788 TCPA suits were class actions. Recruiting is not telemarketing (so DNC mostly does not bite), but prerecorded or automated contact without consent does (*Loyhayem*, 9th Cir. 2021). Our toll-free number is also registered as "HR / Staffing" for **opted-in** applicants (SMS-OPT-IN-PLAN). |

**What reliable actually means**, and what this plan builds to: a lead is worth a recruiter's call
when four things are true, and the system shows each one separately:

1. **Real and reachable.** A deduplicated person with a phone that validates (line type, not a
   landline/VoIP burner), who is not already a driver, applicant or open lead.
2. **Allowed to be contacted, on a recorded basis.** They asked us (a form, an application, a job
   board apply) or they have a prior relationship (former driver, past applicant). The basis is a
   row, not an assumption.
3. **Fits the written requirements.** Each requirement in the carrier's Hiring Profile (§4) is
   evaluated separately as `meets`, `does_not_meet` or `unknown`, with where the fact came from
   (`self_reported`, `document`, `verified`). A single blended score does not replace these.
4. **Recently interested.** The interest signal has a date and it is fresh.

So the AI's job is to **qualify, clean, match, explain and draft** the leads that arrive through
lawful channels, and to make sure the right channels are running.

**Amended 2026-09-25, same day — the owner's clarification.** The ask is narrower than "find
strangers". It is: *find people who are publicly saying they are looking for a driving job* (social
posts, resume boards), compare them against the requirements, and make leads. That is an
**intent signal**, and it is the right thing to look for. It is buildable as a **sourcing
engine** (§3a, phase S5b). One constraint shapes it: the sources where most drivers actually post
cannot be collected by a bot. The engine therefore has three kinds of connector, not one crawler.
What stays ruled out is unchanged: DMV lists, bought lists, dossiers built by joining one person's
data across sites, and automated first contact.

---

## 1. What exists today (measured 2026-09-25)

- **No lead entity.** The first artifact is a `drivers` row with `status='applicant'`, created by a
  recruiter (`useCreateApplicant.ts:36-42`), then a token invite (`applicationInvites.ts:115`).
  There is no public open-apply link.
- **No source attribution anywhere.** The only hint is the free-text questionnaire answer
  `heard_from` (`questionnaireContract.ts:182`), which D-APP12 says is projected nowhere.
  **Consequence: today nobody can say which source produces hires.** Fixing that is the first
  requirement, not a later report.
- **Owned pools that already exist and are unworked:**
  - **1,299 non-active McLeod driver records** against 164 active (`rosterRetire.ts:22-26`), with
    `hire_date`/`termination_date` (0098). There is **no termination reason and no rehire-eligible
    flag**. McLeod does not tell us who we would take back.
  - **Stalled applications:** a draft or `consented_at` present and `submitted_at` null. The
    nudge sweep (`applicationNudgeSweep.ts`) sends one reminder, then nothing.
  - **`applicant_dispositions` with `no_response`/`withdrawn`** (0238). These are people who
    started once.
- **Contact rails:**
  - SMS: Telnyx, gated on consent. `sms_consents.driver_id` is NOT NULL (0233:31), so a lead
    **cannot** hold consent today. `SMS_CONSENT_SOURCES` already reserves `lead_form`, and 0233's
    header already says R1 adds `lead_id`.
  - Email: `mailer.ts` `sendEmail` (Brevo). There is **no unsubscribe/suppression mechanism**.
    That is a prerequisite for any outreach that is not one-to-one.
- **AI rails:** `@anthropic-ai/sdk`, `lib/anthropic.ts` (`callClaude` forced-tool structured
  output), `packages/shared/src/ai.ts` (`AI_MODELS`, `withinBudget`, `aiInputHash`). There is a
  precedent for budgeted, hashed calls in `modules/hazmat/hazmatExtraction`.
- **Requirements:** there is **no hiring-policy table**. The pieces are scattered:
  - `CDL_CLASSES` and `ENDORSEMENT_CODES` (`rosterContract.ts:171-175`)
  - the age policy "23" exists only as hint copy (`questionnaireContract.ts:209`)
  - there is no experience minimum, no hiring area and no disqualifying-violation list. R2 already
    defers these to Q-REC1.
- **Permissions:** section `recruitment` (recruiter = manage). New surfaces go in
  `surfaceCatalogue.ts` as children of `recruitment.*` or a new nav surface.

---

## 2. Research summary (2026-09-25)

**Where carriers' good leads actually come from.** Across vendors the pattern is the same. Leads
**arrive** from job boards (Indeed, CDLjobs, JobsInTrucks, ZipRecruiter), social lead ads,
referrals, and matching marketplaces (Drive My Way matches on ~23 driver-set preferences, such as
home time, and sells "genuine interest" rather than volume). The ATS then:

- responds fast (most drivers apply to several carriers, and a same-day reply wins)
- qualifies the lead
- attributes it to a source

Tenstreet (which acquired DriverReach on 2025-03-31) is the hub the lead vendors post into.
Double Nickel's "AI Virtual Recruiter" is a voice agent that calls new leads instantly and books
interviews. Published cost per hire runs **$4k–$12k**. All of these figures are vendor claims.
**The metric the credible sources push is cost per driver still seated at 90 days, not cost per
lead.**

**Channels we can own cheaply:**

- **Google for Jobs.** Free. There is no API; Google crawls `JobPosting` JSON-LD from our own job
  pages, and the Indexing API gets new postings listed within hours.
- **Meta lead ads.** About $27 per CDL applicant (Boostpoint 2026). The campaign must be declared
  Employment (Special Ad Category): no age, gender or ZIP targeting, a minimum 15-mile radius, and
  no lookalikes. The form questions do the pre-qualifying.
- **Indeed Apply** direct integration is an ATS-partner programme: a developer agreement,
  per-integration approval, and paid clients only. It is unrealistic for one carrier. Indeed and
  most trucking boards can instead **email or post** each lead, which an intake adapter can
  ingest.

**Law that shapes the design** (to counsel, §7; none of this is legal advice):

- **Illinois HB 3773** (IHRA 775 ILCS 5/2-102, in force 2026-01-01). Silvicom hires in Illinois.
  - It covers AI used in **recruitment**.
  - It prohibits discriminatory *effect* regardless of intent.
  - It **names ZIP code as a prohibited proxy**.
  - It requires **notice** of AI use. IDHR withdrew its draft notice rules in June 2026, so the
    form of notice is unsettled but the duty stands.

  Design consequence: the hiring area is expressed as **distance from a named yard or lane, with a
  written operational reason**, never a ZIP list. The AI never sees or scores protected
  characteristics or proxies for them (name-inferred ethnicity, age beyond the ≥ 21/policy gate,
  photos, gender).
- **FCRA / ICRAA:** sourcing is low-risk. The risk sits in **scoring people on data they did not
  give us**. Our match runs only on facts the lead supplied or that we hold from a prior
  relationship. Enrichment from third-party data is out of scope.
- **TCPA:** a recruiter dialling by hand is fine. Automated, bulk or prerecorded contact needs
  prior express consent, and written consent is the safe standard. Revocation by "any reasonable
  means" has applied since 2025-04-11. The FCC one-to-one rule was struck in January 2025.
- **DPPA:** there are no DMV-derived lists, ever.
- **Meta Special Ad Category:** see above.

Sources are listed at the end.

---

## 3. Decisions proposed (D-LS*)

- **D-LS1 · Every lead has a channel, and collection respects each source's access rules.**
  Leads enter only through a named channel with a recorded contact basis:
  - `inbound_form`, `job_board`, `ad_lead`, `referral`, `former_driver`, `past_applicant`,
    `walk_in`, `manual`
  - plus the sourcing engine's `public_post` and `resume_pool` (§3a)

  Automated collection only touches content that is public **without logging in**, or content
  reached through an **official API** under its terms. Anything behind a login is captured by a
  recruiter, one item at a time (§3a). No purchased list, no DMV data, no data-broker enrichment.
  Adding a channel or a connector is a contract change that someone reviews.
- **D-LS9 · A signal is not a lead.** What the engine finds is a `sourcing_signal`: a post or
  profile, the facts extracted from it, and its match. It becomes a `recruiting_lead` only when it
  meets all four:
  - it is classified as a driver seeking work (not a recruiter ad)
  - it passes every hard requirement that is known
  - it is fresh (within the posting's freshness window)
  - it has a contact path the person published themselves (a phone or email in the post, or the
    platform's own message button)

  Everything else stays in the signal table, which is prunable on a short window. This is the
  rule that keeps the queue free of a thousand junk leads.
- **D-LS10 · One source, one person, no dossier.** Facts come only from what the person published
  in that post or profile for employers to see. The engine does **not** join one person's
  identities across sites or look them up elsewhere to complete a profile. That kind of joining is
  the consumer-report theory in *Kistler v. Eightfold*. Duplicates are merged only on a phone or
  email the person gave in both places.
- **D-LS2 · Rules decide, the model reads.** The match is a **pure, deterministic function** in
  `packages/shared` over the Hiring Profile and the lead's facts, with one verdict per requirement
  (R2's `meets_floor | below_floor | incomplete` generalised). The model's jobs:
  - extract facts from messy input (a job-board email, a call transcript, a free-text answer)
  - suggest duplicates
  - write the explanation
  - draft the first message

  The model **never produces the verdict**. This is the repo's "SQL/code returns a measurement,
  TS owns the verdict" rule applied to an LLM, and it is what makes the result auditable under
  HB 3773.
- **D-LS3 · No automated rejection.** A lead that fails a hard requirement is *sorted below* and
  *labelled*; only a recruiter dispositions it (`not_qualified`, with the requirement cited).
  `unknown` never counts as a fail, because it is the next question to ask on the call.
- **D-LS4 · Evidence level is part of every fact.** `self_reported | document | verified`. A
  self-reported "3 years OTR" and a verified one are shown differently, and nothing
  self-reported enters the DQF (R2's rule, kept).
- **D-LS5 · Attribution is mandatory and travels.** Every lead carries `channel` + `source`
  (e.g. `job_board` / `cdljobs`) + optional `campaign`. `convert_lead` copies them to the
  applicant, so lead → applicant → hired → still seated at 90 days is answerable per source.
  This is the report that tells the owner where to spend (S7).
- **D-LS6 · Every contact with a lead is made by a person. RULED by the owner 2026-09-25:** *"all
  the contacts will be done by real persons and not automated."*
  - The system **drafts**, a recruiter **reads, edits and sends**. That means one call, one text
    or one email at a time, from a named user, recorded as a `recruiting_contacts` row with
    `created_by`.
  - There is no send-to-many action, no scheduled or triggered send to a lead, no autodialer, no
    prerecorded message and no AI voice agent. Nothing in the pipeline (§3a) can reach a person.
    It can only put them in a recruiter's queue.
  - The ruling does not remove the other rules:
    - **SMS still needs the person's consent.** A text sent by hand from a platform is still a
      text, and our toll-free number is registered for opted-in contacts only. It needs a live
      `sms_consents` row, which requires `sms_consents.lead_id` (the column 0233 reserved for R1).
    - A number found in a post gets a **phone call**, or a text only after the person agrees on
      that call.
    - Email needs the suppression list first, because "stop contacting me" must be honoured
      however it is said (TCPA revocation rule since 2025-04-11).
  - Enforced in code, not left to habit:
    - the outreach routes accept exactly one recipient
    - no job kind in `JobKind` sends to a lead
    - a test pins both
- **D-LS7 · A lead is prunable** (D-REC2 kept). It is operational, not evidence; 0213-style
  guards, cascade FKs, and a retention window from Q-REC7. Unconverted lead PII does not live
  forever.
- **D-LS8 · Ownership.** The lead tables belong to `modules/recruiting` (it owns the applicant it
  converts into). Intake adapters (job-board email parser, Meta webhook, form) live in a new
  `modules/sourcing` as **collectors** that can only write through recruiting's public `index.ts`
  (D-ARC1). *Alternative:* everything inside `recruiting`. Rejected, because the adapters have
  vendor quirks and rate limits that would bloat the module that holds signed legal documents.

---

## 3a. The sourcing engine (intent signals)

**Where drivers publicly say they want work, and what each source allows** (measured 2026-09-25):

| Source | Drivers there? | Automated access | Connector kind |
|---|---|---|---|
| Facebook groups (CDL jobs groups) | **Most of them** | **None.** Meta removed the Groups API on 2024-04-22. Group content needs a login, and a logged-in bot breaks Meta's terms, gets the account banned, and falls outside the *Bright Data* ruling, which covered logged-out scraping only. | **Recruiter capture** |
| Indeed resumes (Smart Sourcing) | Many, opted in to be found | No API for us. A paid subscription; recruiters search and message inside Indeed. | **Recruiter capture** + AI-written search |
| Other resume databases (JobsInTrucks 440–500k profiles, TruckingCrossing, MeetATruckDriver) | Opted in | No API; subscription, search inside the site | **Recruiter capture** + AI-written search |
| TruckersReport "Seek Employment" forum | Drivers post that they want work; modest volume | Public, logged out | **Automated crawler** (first candidate) |
| Tenstreet Driver Pulse (Pulse Match) | 3.7M driver profiles (Tenstreet's claim) | Tenstreet shows our job to matching drivers, who apply. We cannot browse profiles. | Intake (S5), as an applied lead |
| Public Facebook Pages / Marketplace posts, public web pages | Some | Logged-out, public: *Meta v. Bright Data* (N.D. Cal. 2024, unappealed) held that this breaches no terms. Rate-limited, `robots.txt` respected. | **Automated crawler** |
| Reddit (r/Truckers, r/CDL) | Few; pseudonymous, rarely a phone | Official API only. Since late 2025 every client needs manual approval, commercial use needs a paid licence, and unsolicited DMs break site rules. | Automated, **only if approved**. Low priority. |
| X, YouTube comments | Few | Paid or official APIs | Automated, experimental |
| Craigslist | Some | Terms forbid it, and Craigslist won against 3Taps | **None** |

**Three connector kinds, one pipeline.**

1. **Automated connectors** read logged-out public pages and official APIs on a schedule. They run
   in the worker with per-source `KIND_CAPS`. Cheap to run, but yield is low because this is not
   where most drivers post. Each connector is **measured in S7 before it stays on**.
2. **Recruiter capture.** A browser extension, "Send to Silvicom", used while the recruiter
   browses Facebook groups or Indeed normally under their own account. One click sends the post
   or profile they are looking at, plus its URL and their notes, to the pipeline. A person reads
   and chooses each item, so this is not scraping. It removes the retyping and the judging; it
   does not replace the browsing. Counsel confirms this (Q-LS5e). A paste box in the web app does
   the same thing without the extension.
3. **Search assist.** From the Hiring Profile, the AI writes the Boolean search for Indeed Smart
   Sourcing and the keyword set the crawlers use, and suggests which groups to join and which
   job-board filters to set.

**The pipeline** (every step writes a row, per D-REC1):

1. **Capture:** the raw text and URL are stored whole, with the content hash as the idempotency
   key.
2. **Classify** (`callClaude`, fast model): is this a *driver seeking work*, a *recruiter or
   carrier ad*, or *other*? In trucking groups, most posts are recruiter ads. Discarding them is
   most of the precision.
3. **Extract** into the lead contract: CDL class, endorsements, years, equipment, home area as
   stated, availability, the contact path, and the post date. Each fact is marked
   `self_reported`, with the quoted span it came from, so the recruiter can see where every fact
   came from.
4. **Dedupe** against leads, applicants and drivers (phone or email only, D-LS10).
5. **Match** with the same pure `leadMatch.ts` as every other channel. The model never decides
   (D-LS2).
6. **Promote** to a lead under D-LS9, or keep it as a signal. The recruiter sees *why*: the
   quoted post, each requirement's verdict, and how many days old it is.

**Contact** is always by a person (D-LS6, owner ruling 2026-09-25). If a phone number is in the post, a recruiter calls or texts by
hand. Otherwise the recruiter replies through the platform's own message button. No automated
texts or calls to scraped numbers, ever. The first message carries the AI-use notice (HB 3773).

**Cost** is small next to cost per hire. Classification and extraction run a fast model on short
text, deduped by `aiInputHash` and capped by `withinBudget`. The real costs are recruiter time
(capture) and subscriptions (Indeed Smart Sourcing, Tenstreet), which are the owner's call
(Q-LS7).

---

## 4. The Hiring Profile (the "settings")

These are the settings the owner described. They are one versioned, org-scoped record, edited by
`recruitment: manage`. Each field is typed, `hard` or `preference`, and carries a **reason** shown
to recruiters (and to counsel):

| Requirement | Kind | Today |
|---|---|---|
| CDL class (A) | hard | contract exists (`CDL_CLASSES`) |
| Endorsements required / preferred (H, N, X, T…) | hard / pref | contract exists |
| Minimum age (21 federal interstate, §391.11(b)(1); policy 23?) | hard | copy only, Q-LS1 |
| Minimum verifiable CMV experience (months) | hard | nothing, Q-LS1 |
| Position type (company / owner-operator) | hard | questionnaire v2 |
| Equipment experience (dry van, reefer, tanker, flatbed) | pref | nothing, Q-LS1 |
| Hiring area: distance from yard(s) / lanes + home-time model | hard | **nothing, Q-LS2; never ZIP** |
| Disqualifiers + look-back (e.g. major violation in N yrs, §383.51 list) | hard | nothing, Q-LS1 |
| Max moving violations / preventable accidents in N yrs | hard | nothing, Q-LS1 |
| Earliest start / availability | pref | nothing |

Each requirement is evaluated against a fact on the lead. Missing facts become the **call
script**: the drawer lists the `unknown` requirements as the questions to ask. The profile is
versioned, so every verdict records which profile version produced it; changing the rules later
does not silently rewrite past verdicts.

Several open job postings can each narrow the profile (e.g. "Regional reefer, Class A + 2 yrs").
A lead matches against a posting, and the posting generates the Google for Jobs page (S4).

---

## 5. Phases

One PR per step. Each schema change is its own merge before its reader (`lint:migration-ordering`).

- **S0 · Decide.** D-S360 decision; owner answers Q-LS1–Q-LS4; counsel gets Q-LS5. *No code.*
- **S1 · Lead ledger** (= R1, amended):
  - `recruiting_leads` with `channel`/`source`/`campaign` instead of R1's six-value `source`, plus
    `external_ref` (a job board's lead id, used for idempotent intake).
  - `recruiting_contacts`, append-only.
  - `convert_lead` → existing applicant plus invite flow, carrying attribution.
  - Deterministic dedupe on E.164 phone / lower(email) against leads, applicants and drivers.
  - `/recruitment/leads` queue with callbacks.

  **This alone fixes attribution.**
- **S2 · Hiring Profile + match engine** (= R2, generalised):
  - Profile table (versioned) and `hiringProfileContract.ts`.
  - Pure `leadMatch.ts`: per-requirement verdict + evidence level + profile version, exported
    labels, unit tests per rule with boundaries.
  - The queue sorts by `hard requirements met → fewest unknowns → freshness`, and every row shows
    *why*.
- **S3 · Owned pools** (fastest real leads, zero ad spend):
  - Former drivers: import McLeod non-active drivers as `former_driver` candidates **hidden until
    a person marks them eligible for rehire**, because we hold no termination reason (Q-LS4).
  - Stalled and `no_response` applicants surface as re-engagement leads after N days.
  - Contact stays manual or through an existing consent.
- **S4 · Inbound we control:**
  - Public job pages per posting with `JobPosting` JSON-LD plus a sitemap (Google for Jobs).
  - A short lead form that asks the profile's hard questions up front and has an **optional,
    separate** SMS consent checkbox writing `sms_consents(source='lead_form', lead_id)` (the
    migration adds `lead_id` and relaxes `driver_id` to "one of"). The form carries the HB 3773
    AI notice.
  - Rate limiting and bot defence on the public route.
- **S5 · Job-board and ad intake adapters** (`modules/sourcing`):
  - A per-org inbound email address: boards and Indeed email each applicant.
  - A Meta Lead Ads webhook (the lead form is the pre-qualifier).
  - A generic signed JSON webhook for any vendor.
  - Raw payload stored whole, with a re-derivable projection (the D-PSP2 pattern). The model does
    extraction into `leadContract` via `callClaude`, `aiInputHash`-deduped and `withinBudget`.
    **The extraction is shown next to the source text for the recruiter to confirm.**
- **S5a · Measure the sources first** (`LEAD-ENGINE-RESEARCH.md` §5). A two-week pilot with the
  pipeline and paste box only: recruiters paste from resume databases, TruckersReport and their
  Facebook groups. Per source, measure the share of posts that are job seekers, qualified and
  contactable. Connectors are then built in the order those numbers give.
- **S5b · Sourcing engine** (§3a):
  - First, `sourcing_signals` (org-scoped, prunable, raw text + URL + content hash + extraction +
    match + classification) and the capture / classify / extract / match / promote pipeline, fed
    by the web **paste box**.
  - Then the **browser extension** (after Q-LS5e).
  - Then automated connectors one at a time: public pages first, and Reddit only if API access is
    approved. Each stays on only if S7 shows it producing qualified leads.
- **S6 · AI assist in the recruiter's drawer:**
  - Post-call "paste notes / transcript → structured facts" (the recruiter confirms each).
  - A first-message draft in the carrier's voice (sent by the human, not the machine).
  - A dedupe merge suggestion.
  - A plain-language "why this lead is ranked here" built from the verdicts.

  Every AI output is labelled as AI in the UI and logged with the model and profile version.
- **S7 · Source quality report.** Per channel/source/campaign: leads, reached, qualified,
  applied, hired, **still active at 90 days**, and cost if entered. Also run a disparate-impact
  check on dispositions by requirement (HB 3773 is about effect). This is how "reliable" stops
  being an opinion.
- **S8 · Referrals from current drivers** (driver app): a referral link or form creates a
  `referral` lead attributed to the driver. A bonus, if paid, is the owner's policy.
- **Later:** a marketplace feed (Drive My Way-style) as another S5 adapter, if the owner buys one.
  Speed to first contact comes from the queue instead of automation: new inbound leads sit at the
  top, and the nav badge counts leads not yet contacted.

**Not built, on purpose:** logged-in bots or fake accounts, bypassing login walls or CAPTCHAs,
bought lists, DMV data, data-broker enrichment, **any automated contact** (bulk or triggered
SMS/email, autodialer, AI voice agent — D-LS6, owner ruling), auto-rejection, any single opaque
"AI score."

---

## 6. How we will know it works

Targets are set after S1 has run for four weeks and given us a baseline. Today there is no
attribution, so any number would be invented.

- **Precision:** the share of leads that a recruiter, after the first call, marks
  "reachable + meets hard requirements". This is the "not 1,000 junk leads" number.
- **Speed to first contact** for inbound leads (median, business hours).
- **Conversion by source:** lead → application submitted → hired → active at 90 days.
- **Unknown rate:** hard requirements left `unknown` at first contact (measures the forms and
  intake adapters).
- **Match overrides:** how often recruiters disposition against the verdict. A high rate means the
  profile is wrong, not the recruiter.

---

## 7. Open questions

- **Q-LS1 · Hiring requirements** (owner): minimum age (21 or 23), minimum verifiable experience,
  equipment, disqualifiers and look-back windows, violation/accident limits. Merges with Q-REC1.
  *Fallback:* S2 ships regulation floors only (R2's rule), which cannot be wrong, only loose.
  **ANSWERED 2026-10-26 as Q-RA7** — see `RECRUITER-AUTOMATION-PLAN.md` §3a (Hiring Profile v1).
- **Q-LS2 · Hiring area and home-time model** (owner): which yard(s) or lanes, what radius,
  local/regional/OTR, and the operational reason for each. *Fallback:* no area requirement; area
  is shown as information only. **Never a ZIP list** (HB 3773).
- **Q-LS3 · Current sources, volume and spend** (owner): which boards or ads run today, what each
  costs, how leads arrive (email? calls?), and how many a week. Decides whether S5 or S4 comes
  first. Part of Q-REC1.
  **ANSWERED 2026-10-26 as Q-RA7** — see `RECRUITER-AUTOMATION-PLAN.md` §3a (Hiring Profile v1).
- **Q-LS4 · Former drivers** (owner): may we re-contact them, who decides rehire eligibility, and
  is there a list of do-not-rehire? McLeod holds no reason. *Fallback:* the pool is imported but
  invisible until marked eligible one by one.
- **Q-LS5 · Counsel:**
  - (a) HB 3773 notice wording and placement for this use of AI
  - (b) whether the requirements and the hiring-area rule are job-related and consistent with
    business necessity
  - (c) TCPA consent wording for the lead form's optional SMS box. Automated contact is no
    longer asked about: the owner ruled all contact is by a person (D-LS6). Still to confirm: that
    a recruiter's single, hand-sent text through our platform to a consented lead is not an
    automated message.
  - (d) whether CAN-SPAM/unsubscribe applies to recruiting email (we build suppression
    regardless)
  - (e) the sourcing engine: logged-out crawling of public pages; recruiter capture from
    logged-in sites (Facebook groups, Indeed) through an extension; storing a public post's text
    and contact details; and whether matching those facts is a "consumer report" risk under
    D-LS10's limits

  Goes into `COUNSEL-REVIEW-PACKAGE.md`.
- **Q-LS6 · Lead retention** (= Q-REC7): how long an unconverted lead's PII lives. *Fallback:*
  nothing prunes; the schema stays prunable.
- **Q-LS7 · Paid channels** (owner): budget for Meta ads or a board subscription, and who runs the
  ad account. The system ingests; it does not buy media.
- **Q-LS8 · Ordering:** `RECRUITING-UI-SURFACE-PLAN.md:864-876` says its U1 precedes R1. Confirm
  that it still does before S1.

**Recommendation:** approve D-LS1–8, answer Q-LS1–Q-LS4 in one sitting, and start S1 and S3
together. The owned pools need no ad spend and no counsel ruling, and S1's attribution makes
every later channel measurable.

---

## Sources (read 2026-09-25)

- DPPA: [18 U.S.C. §2721 (LII)](https://www.law.cornell.edu/uscode/text/18/2721), [EPIC on the DPPA](https://epic.org/dppa/)
- TCPA and recruiting: [ATS Mako](https://atsmako.com/guides/tcpa-recruiting-sms/), [GoHire](https://gohire.com/text-recruiting-tcpa-compliance/), [Text-Em-All](https://www.text-em-all.com/blog/cold-recruiting-texts-violation-blocked), [Grayscale](https://help.gograyscale.com/en/articles/3353709-do-candidates-need-to-opt-in-before-i-can-text-them)
- Illinois HB 3773: [ILGA bill status](https://www.ilga.gov/ftp/legislation/103/BillStatus/HTML/10300HB3773.html), [Seyfarth](https://www.seyfarth.com/news-insights/illinois-department-of-human-rights-temporarily-withdraws-proposed-rules-on-use-of-artificial-intelligence-in-employment.html), [Ogletree](https://ogletree.com/insights-resources/blog-posts/illinois-steps-up-ai-regulation-in-employment-key-takeaways-for-employers/)
- FCRA and AI scoring: [Fox Rothschild on Eightfold](https://dataprivacy.foxrothschild.com/2026/04/articles/general-privacy-data-security-news-developments/when-ai-meets-the-fcra-what-the-eightfold-class-action-means-for-employers-and-hr-technology-providers/), [CFPB withdrawn guidance](https://www.consumerfinance.gov/compliance/guidance/withdrawn-guidance/), [Federal Register withdrawal of the data broker rule](https://www.federalregister.gov/documents/2025/05/15/2025-08644/protecting-americans-from-harmful-data-broker-practices-regulation-v-withdrawal-of-proposed-rule)
- Meta Special Ad Category: [Boostpoint 2026](https://boostpoint.com/recruiter-tips/recruiters-guide-to-facebook-ads/), [Jon Loomer](https://www.jonloomer.com/qvt/special-ad-categories-targeting/)
- Google for Jobs: [Google JobPosting docs](https://developers.google.com/search/docs/appearance/structured-data/job-posting). Indeed Apply: [Indeed partner docs](https://docs.indeed.com/indeed-apply/ats)
- Scraping and platform access: [TechCrunch on Meta ending the Groups API](https://techcrunch.com/2024/02/05/meta-cuts-off-third-party-access-to-facebook-groups-leaving-developers-and-customers-in-disarray/), [Farella Braun on *Meta v. Bright Data*](https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/), [Reddit Data API 2026 (Prowlo)](https://prowlo.com/blog/reddit-data-api), [Indeed Smart Sourcing](https://www.indeed.com/employers/solutions/smart-sourcing), [Tenstreet Pulse Match](https://www.tenstreet.com/blog/marketing/pulse-match)
- Market: [Tenstreet integrations](https://www.tenstreet.com/integrations), [Tenstreet acquires DriverReach](https://www.tenstreet.com/blog/about-tenstreet/tenstreet-acquires-driverreach-to-enrich-the-scale-of-its-network), [Drive My Way](https://www.drivemyway.com/), [Double Nickel AI Virtual Recruiter](https://www.getdoublenickel.com/features/ai-virtual-recruiter), [Double Nickel on lead cost](https://www.getdoublenickel.com/blog/truck-driver-leads), [Drive My Way on cost per hire](https://hiring.drivemyway.com/employer-blog/strategies-to-reduce-cost-per-hire-for-cdl-drivers/)
