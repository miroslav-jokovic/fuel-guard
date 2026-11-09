# Ads lead intake — audit of the whole chain, three channels (2026-11-09)

**Status:** audit, docs only. Read from `origin/main` at `1c26ac7` (LQ1 #2131 and LQ2a/b #2134/#2136 merged;
LQ3a #2137 open; LQ3b in progress in its own worktree — neither is judged here beyond what the plan says).
**Owner's ask:** "audit our automated ads and focus on leads we should receive — we are onboarding with Indeed and
Tenstreet — make sure we will not get random leads that are not reliable and precise; enterprise grade."
**Parent:** [`ADS-LEAD-QUALITY-PLAN.md`](ADS-LEAD-QUALITY-PLAN.md) (LQ1–LQ4, Q-AD47–53). This audit proposes
LQ5–LQ9 and opens Q-AD62–Q-AD66 (pointer in `ADS-AGENT-PLAN.md` §9; first numbered Q-AD54–58, renumbered the same
hour when the creative-quality plan took those). It changes no ruling.
**Same day:** the owner delegated the rulings; Q-AD62–58 are ruled (all (a)) and the build plan written in
[`ADS-LEAD-INTAKE-PLAN.md`](ADS-LEAD-INTAKE-PLAN.md) — start the build there, not here.

Every statement below names the file it was read from. Nothing is estimated without saying so.

---

## 0. The verdict in one paragraph

The intake *pipeline* is sound and better than most carriers run: a lead is stored exactly once per
(org, channel, platform id), matched to a person only by phone or e-mail, kept raw beside its projection, judged by
pure rules against the opening's frozen hiring profile, owned by the opening's recruiter, rung within seconds,
escalated when nobody calls, and never lost (fail-closed webhook under a 48-hour self-healing backfill). LQ1 made the
Meta form itself a higher-intent, SMS-verified, requirements-first form. **What is missing is the second half of the
loop:** nothing records the *recruiter's* verdict on a lead, so the one reliable quality signal (a person called and
found no CDL / wrong number / not interested) has no home, cannot feed the daily brief or the quality alert, and is
never sent back to Meta — so Meta keeps optimising toward the leads it already delivers. Second, a lead whose own
answers fail a hard requirement rings the same bell and the same SLA alarm as a qualifying one. Third, the fact
extraction is Meta-shaped: an Indeed or Tenstreet lead would be judged "unknown" on every requirement. Those three
are the "random leads" the owner means, and all three are closed by changes in recruiting, not in ads.

---

## 1. The chain as built (Meta), stage by stage

| # | Stage | Where | What guards precision today | Grade |
|---|---|---|---|---|
| 1 | Who sees the ad | `platforms/meta/publisher.ts:159–181` | `special_ad_categories: ["EMPLOYMENT"]`, US; targeting = ONE pin + radius, 15–50 mi, refused outside (`:226`). No age, interest or lookalike targeting is possible under EMPLOYMENT, which is Meta's rule, not ours. | ✅ (one reading owed, F-LA8) |
| 2 | What the ad says | `shared/ads/adClaims.ts`, Copywriter | Every number is a brief figure (`checkClaims`); "23 or older", "N+ years Class A" stated in words because the form may not ask. | ✅ |
| 3 | The form | `shared/ads/metaLeadForm.ts`, `metaLeadFormScreens.ts` (LQ1) | Contact from Meta's prefilled types; three catalogue questions only (Class A held, Class A years, hazmat); higher intent (review step), SMS-verified phone, intro listing the requirements, thank-you "a recruiter will call". `block_display_for_non_targeted_viewer: true`. | ✅ (SMS flag unverifiable by read-back — Q-AD48 (a)/(b) stands) |
| 4 | Delivery | `ads/leads/leadgenWebhook.ts`, `leadFetch.ts`, `backfill.ts` | HMAC over raw bytes, 503 without secret; ids only → queued fetch; `form_id` on the fetched lead must equal the delivery's; a form no campaign owns → 200 + dropped + counted; hourly backfill reaches back to the last complete run (90-day floor). `platform_refs` is only ever merged (`transitions.ts:127`), so an archived campaign's late lead still resolves. | ✅ |
| 5 | Store once | `0554 ingest_lead`, `shared/recruiting/leads/leadContract.ts` | `ON CONFLICT (org, channel, external_ref) DO NOTHING`; phone → E.164 or null (never guessed); e-mail lower-cased or null; raw kept whole. | ✅ |
| 6 | Same person? | `0554 recruiting_lead_matches` | Phone or e-mail only, never name (D-LS10); both leads kept (attribution), queue shows the person once with `also`. | ✅ |
| 7 | Judge | `shared/recruiting/leads/leadMatch.ts`, `recruiting/leads/verdicts.ts` | Pure rules vs the opening's newest profile version; self-reported experience never `meets` (Q-RA7b); entirely-below → `does_not_meet`; age + 4 disqualifiers `unknown` by construction. Append-only rows, healed on retry. | ✅ logic · ⚠ Meta-shaped input (F-LA4) · ⚠ never re-judged (F-LA5) |
| 8 | Own + ring | `leadAssignment.ts` (LQ2b), `leadNotify.ts` | `assigned_to` = the opening's recruiter; `lead_new` to them / recruitment managers. | ⚠ rings for every lead, verdicts unread (F-LA2) |
| 9 | Escalate | `leadUncontacted.ts` | `new` older than `alerts.uncontacted_lead_minutes` → `lead_uncontacted`; held numbers and manual channels skipped. | ⚠ same (F-LA2) |
| 10 | Work it | `leadContacts.ts`, `doNotContact.ts`, `convertLead` (0561) | Each call/text recorded with outcome (`reached/voicemail/no_answer/wrong_number/declined`); first contact moves `new → contacted`; do-not-contact holds the NUMBER (TCPA); convert = one applicant once. | ❌ no close-out: `qualified`, `not_qualified`, `lost` have NO writer (F-LA1) |
| 11 | Measure | `monitorChecks.ts`, LQ3 (in flight) | cpl_max, no_lead_spend, frequency; LQ3 adds wrong-number share and hard-does-not-meet share after 10 attempted leads (alert only, Q-AD51). | ⚠ blind to the recruiter's verdict (F-LA1) |
| 12 | Teach Meta | `ads/outcomes/` (B6), `shared/ads/leadOutcomes.ts` | Conversions API, stages `contacted, converted, applied, hired, lost_after_conversion`; `qualified`/`lost_before_conversion` marked `not_recorded`. | ⚠ no negative signal before conversion (F-LA1) |

What is right and should not be touched: stages 1–6 and the append-only verdict design. The 2026-11-03 lead-path
audit (H1 backfill catch-up, H3 do-not-contact) and LQ1/LQ2 already fixed what those found.

---

## 2. Findings

Severity is about *leads a recruiter will waste a call on* or *a quality signal that is lost*, not about outages.

### F-LA1 · HIGH — A recruiter cannot close a lead, so the human verdict is never recorded

- **Measured:** the only writers of `recruiting_leads.status` are `leadContacts.ts:57` (`new → contacted`) and
  `0558 purge_lead` (`→ lost` on purge). `qualified`, `not_qualified`, `lost` are in the CHECK (0553:207) and in
  `LEAD_STATUSES`, and nothing writes them. `shared/ads/leadOutcomes.ts:32` already names the hole:
  `UNRECORDED_LEAD_STAGES = ["qualified", "lost_before_conversion"]`. Joanna tracks exactly these in Tenstreet
  (`INDEED-APPLY-ONBOARDING-REPLY-2026-11-06.md` §2).
- **Why it is the biggest precision gap:** the recruiter's call is the only *verified* judgement the system will
  ever have on a Meta lead (the form may not ask age, licence number or disqualifiers). Without a place to write it:
  1. `OPEN_LEAD_STATUSES = ["new","contacted","qualified"]` — a junk lead, once called, is `contacted` and stays in
     the open queue forever; the queue fills with people nobody will call again.
  2. LQ3's quality measure can only count `wrong_number` outcomes and *self-reported* `does_not_meet`. "Reached,
     has no CDL", "reached, wants local only", "reached, not interested" — the majority of junk — is invisible.
  3. The outcome feed sends Meta only positive stages. Meta's Conversion Leads optimisation is built on the whole
     funnel including disqualified leads (Meta's CRM-integration guidance; L4 records the exact wording under
     EMPLOYMENT, Q-AD17). Today we teach Meta that every lead we did not convert is simply "pending", so the
     algorithm has no reason to stop delivering the same kind.
  4. Indeed Disposition Sync (the onboarding reply, item 5) promises a status for every applicant; one rejected
     before conversion would send none.
- **Fix (LQ5, recruiting; ~1.5 days):**
  - A **close-out door** `POST /api/recruitment/leads/:id/close` (recruitment manage) with a fixed reason list, no
    free text in the reason: `not_qualified:<requirement key from LEAD_REQUIREMENTS>`, `not_interested`,
    `unreachable` (after ≥ N attempts, N from the contacts rows, not typed), `wrong_number`, `duplicate`,
    `out_of_area`, `spam`. A **`recruiting_lead_closures`** append-only row (reason, closed_by, closed_by_name,
    note nullable) and the status move (`not_qualified` for the first reason, `lost` for the rest) in one RPC
    (0174/0175 set-based UPDATE pattern; never a partial upsert). Reopen = a new row + status back to `contacted`.
  - `LeadOutcomes` gains `not_qualified` and `lost_before_conversion` with writers → `UNRECORDED_LEAD_STAGES`
    shrinks to `qualified` (or `qualified` := a positive close-out, owner's call, Q-AD64).
  - The outcome feed sends the two new stages (Q-AD65); `0570`'s stage CHECK derives from
    `LEAD_OUTCOME_STAGES`, so this is a migration first, reader second.
  - LQ3's `LeadQuality` reader counts closures by reason per campaign, and the daily brief gets "closed: N
    (not qualified a, wrong number b, unreachable c)".
  - Queue: a "Closed" filter; the default stays open leads.

### F-LA2 · HIGH — A lead whose own answers fail a hard requirement rings the same bell and the same SLA

- **Measured:** `leadNotify.ts` `ringNewLead` and `leadUncontacted.ts` `sweepUncontactedLeads` read no verdict
  (grep: no `verdict`/`summary`/`hardUnmet` in either file). A person who answers "No" to "Do you hold a valid
  Class A CDL?" is a `does_not_meet` on a hard requirement (`leadMatch.ts`, `judged("class_a", true, …)`) — and
  still produces `lead_new` to every recruitment manager and a `lead_uncontacted` escalation after N minutes.
  The queue only sorts them down (`compareLeadMatch`, D-LS3 "a sort, never a filter") and the web badge says
  "1 not met" (`badges.recruiting.ts:288`).
- **Why it matters:** the bell is the speed-to-lead mechanism; every false ring trains recruiters to ignore it.
  D-LS3 says `unknown` is not a fail — correct, and untouched here. `does_not_meet` is different: it is a fact the
  person stated about themselves, on a form whose intro (LQ1) told them the requirement.
- **Fix (LQ6, recruiting; ~0.5 day, can ride with LQ3b):** `ringNewLead` and the uncontacted sweep read the lead's
  summary (one query, `readLeadVerdicts` already exists): `hardUnmet > 0` → no `lead_new`, excluded from the
  SLA sweep, counted in the brief as "did not qualify by their answers: N". The queue shows them under their own
  lane ("Does not qualify — their answer"), still callable, still convertible — nothing is deleted or hidden
  (Q-AD63). A self-reported `does_not_meet` later contradicted on the call is corrected by a new verdict row with
  evidence `verified`, which `readLeadVerdicts` already prefers (newest per requirement).

### F-LA3 · MEDIUM — Phone validity is checked by shape only; two of three channels have no verification at all

- **Measured:** `normalisePhone` (`smsConsentContract.ts`, twin `0554 phone_e164`) accepts any 10-digit US string.
  LQ1's SMS verification proves possession *at submit time, on Meta only*. Indeed Apply and Tenstreet posts carry
  whatever the person typed; a manual lead too. Nothing knows whether a number is mobile, landline or VoIP, live or
  disconnected, before a recruiter dials it — and `wrong_number` is one of the two LQ3 quality measures.
- **Industry practice:** a carrier/line-type lookup at ingest (every CRM lead-quality vendor does this first). We
  already run on Telnyx for SMS ([[sms-provider-is-telnyx]]); Telnyx Number Lookup returns line type and carrier
  for a per-lookup fee (price to be read from the Telnyx pricing page in the build PR, not stated here).
- **Fix (LQ8, recruiting; ~1 day; Q-AD62):** at ingest, for a lead with a phone: one lookup → columns
  `phone_line_type` (`mobile|landline|voip|unknown`), `phone_lookup_at`, `phone_lookup_result` (two merges:
  column then reader). Never a filter: a VoIP/landline lead is flagged in the queue and the brief, and LQ3 reports
  wrong-number share *by line type* so the owner sees whether the flag predicts anything before anyone acts on it.
  A lookup is not contact (D-RA2 holds). The lookup failing must not fail the ingest (the lead is stored first,
  looked up after, on the same job).

### F-LA4 · MEDIUM — Facts are extracted from Meta's catalogue only; Indeed and Tenstreet leads would be judged "unknown" on everything

- **Measured:** `leadFactsFromAnswers` (`leadMatch.ts`) reads exactly three keys — `class_a_held`,
  `class_a_years`, `hazmat_endorsement` — through `catalogueAnswer`, which resolves against `META_FORM_CATALOGUE`
  keys or their EN/ES labels. `LeadFacts` can carry only those three plus `date_of_birth`. `recordLeadVerdicts`
  takes `answers`, not facts.
  - **Indeed** screeners (Joanna, 11/06): *OTR* years, *willing to stay out 3 weeks*, hazmat. The first is a
    different fact from "Class A years"; the second is a **requisition** fact (home time) that `HiringRequirements`
    cannot hold at all. `INDEED-APPLY-ONBOARDING-REPLY` §4.1 already recommends one screener catalogue with Meta
    and Indeed as two renderers; this audit confirms the reader side has the same shape problem.
  - **Tenstreet** posts (`TENSTREET-INTAKE-PLAN.md` F1): DOB, licence class and endorsements, experience,
    accident/violation/DUI answers, verified employment (Xchange/VOE) — richer than any form, with evidence above
    `self_reported` for DQF-sourced items. D-TS6 proposes storing `age_23_plus: yes/no/unknown` as an *answer*,
    which `LeadFacts` cannot read (it wants `date_of_birth`).
- **Why it matters:** every lead from the two channels being onboarded would sort as "8 unknown", below every Meta
  lead that answered one question, and the quality alert would never see a Tenstreet applicant who declared a
  CMV DUI.
- **Fix (LQ7, shared + recruiting; ~2 days, BEFORE the Indeed and Tenstreet listeners):**
  - `LeadFacts` becomes the one seam. Per-channel pure readers in `packages/shared/src/recruiting/leads/facts/`:
    `metaFacts(answers)` (today's function, renamed), `indeedFacts(screenerAnswers, questionIds)`,
    `tenstreetFacts(parsedPost)`. `recordLeadVerdicts` takes `facts`, and the sink chooses the reader by
    `channel`. Evidence level comes from the reader (`document` for a DQF licence record, `verified` for Xchange).
  - `HiringRequirements` gains `home_time` (`{ mode: "off" | "preferred" | "required", min_days_out: n }`) and
    `LeadFacts` gains `willing_days_out`; `leadMatch` judges it like hazmat. Hiring Profile v1 (Q-RA7) did not name
    home time because the owner was asked about qualifications, not the job; the Indeed screener shows it is a
    requirement the carrier already applies. Owner confirms the number (3 weeks) in the build PR.
  - Age: the reader computes the age verdict from the DOB *at ingest* and the DOB is never written to `answers`
    (D-TS6's intent, achieved through a fact, not a yes/no answer). `recordLeadVerdicts` already stores the verdict
    with its detail; `detail.age` is a number, not a date.
  - `catalogueAnswer`'s rule stands for every reader: an answer that is not in the catalogue is absent, never
    guessed; Tenstreet maps by `CustomDataId`, Indeed by screener question id (D-TS9's rule, generalised).

### F-LA5 · MEDIUM — Verdicts are written once at ingest and never re-judged when the profile changes

- **Measured:** `recordLeadVerdicts` writes only when the lead has no rows for the opening's *current* profile
  version, and it is called from `ingestLead` only. If the owner saves a new profile version (min years 2 → 3), every
  open lead keeps its verdicts against the old version; the queue shows "meets" for people who no longer do, and
  LQ3's hard-does-not-meet share is measured against a profile the opening no longer uses.
- **Fix (LQ9, recruiting; ~0.5 day; Q-AD66):** a re-judge sweep, run when an opening version or a profile version is
  saved, over that opening's leads in `OPEN_LEAD_STATUSES`: compute facts (via the channel reader, F-LA4) and write
  new rows for the new version. Append-only already (RL014); `readLeadVerdicts` already returns the newest. One job
  kind, dedup per opening.

### F-LA6 · LOW — A lead with no usable phone or e-mail is stored silently

- **Measured:** `leadFromPlatform` stores `phone_e164: null` when `normalisePhone` fails; `ingest_lead` accepts it;
  the queue shows a row nobody can call; no count, no bell. With SMS verification on Meta this should be zero, so a
  non-zero count is itself a signal (a Meta field rename, a form edited by hand in Ads Manager, a bad channel reader).
- **Fix (with LQ6):** `fetchWebhookLead`/`backfill` report `no_contact_detail` per campaign; the existing
  `lead_intake_failing` bell (0563) rings once a day when > 0. The lead is still stored.

### F-LA7 · LOW — No volume-anomaly check

- **Measured:** `monitorChecks.ts` has caps, no-lead spend, CPL and frequency; LQ3 adds two quality shares. Nothing
  reads leads-per-hour. A burst (30 leads in an hour on a form averaging 2 a day) is the classic bot/click-farm
  pattern and the first visible symptom of Meta delivering broadly.
- **Fix (with LQ3b or after):** rule `lead_burst` in `monitorChecks.ts`: leads in the last local hour >
  max(5, 6 × the 7-day hourly median) → `ads_lead_quality` alert (the category LQ3a adds), never a pause.

### F-LA8 · LOW, a reading — Audience expansion is off by Meta's rule, not by ours, and is not read back

- **Measured:** `adSetParams` (`publisher.ts:165`) sends `targeting.geo_locations.custom_locations` and nothing
  else — no `targeting_automation.advantage_audience: 0`. Meta's help says Advantage+ audience is not offered to
  Special Ad Category campaigns, and `EMPLOYMENT` is set, so expansion should be impossible by construction; but
  the publisher's read-back (`ADSET_FIELDS` includes `targeting`) does not assert it.
- **Fix:** at the Publisher's L4 sandbox run, read the created ad set's `targeting` back and record the reading
  (`readings.recorded.json`): no `targeting_automation`, no `targeting_optimization`, no `flexible_spec`; then the
  publisher verify refuses an ad set whose read-back shows any of them. No code before the reading.

---

## 3. Indeed and Tenstreet against the same chain

Neither listener is built; both plans route through `ingest_lead` with their own `channel`, which is right. What each
needs from this audit before it goes live:

| Stage | Indeed Apply (Job Sync API; reply drafted 11/06) | Tenstreet (XML push; plan 11/03, nothing built) |
|---|---|---|
| Store once | `external_ref` = Indeed's application id — confirm the field name from the Indeed Apply payload spec before the migration-free listener ships. | `external_ref` = `DriverId` (D-TS1). ⚠ A **later post for the same DriverId is a `duplicate` and changes nothing** (`ingest_lead` never updates). D-TS8's "refresh contact details when no recruiter edited them" needs its own set-based UPDATE RPC — it cannot ride on `ingest_lead`. Decide D-TS8 first. |
| Same person | Phone/e-mail match works unchanged; an Indeed applicant who also filled the Meta form shows once with `also`. | Same. A Tenstreet post for a person already on the roster (`drivers` match) is the rehire case — [[roster-lifecycle-position]] applies, the lead is not the driver. |
| Judge | **F-LA4**: three screeners, two of which `leadMatch` cannot read today. Also: Indeed asks the screeners *in Indeed's words*; our catalogue must be the source and Indeed's screener definitions a render of it, or the answers cannot be read back by key. | **F-LA4**: the richest source we will have, and today it would judge as all-unknown. The DQF items carry `document` evidence — the first leads whose experience can `meet` without a call. SSN and EEO: D-TS4/D-TS5 (owner) — recommend exclusion; if kept, sealed log only, never `answers`. |
| Own + ring | Indeed leads carry no opening unless the posting is made from one. Job Sync postings should be created *from an opening* (`brief_source = recruiting_opening`) so `openingOfBrief` and LQ2b's recruiter work unchanged. | Tenstreet posts carry `JobRequisitionData`; map requisition → opening by a code the carrier sets on the opening (`CustomDataCustomerCode`), else no opening (unsorted, unowned, as a manual lead is). |
| Close-out | **F-LA1** is a go-live blocker: Disposition Sync is promised in the reply; "rejected before conversion" would send nothing. | Joanna's four stages (qualified, interested, not qualified, lost) are exactly the close-out reasons; without F-LA1 recruiters keep working in Tenstreet. |
| Phone | No SMS verification exists on Indeed Apply → **F-LA3** matters most here. | Same. |
| Fail-closed | Credentials by the signatory, in our secret store (reply item 13). | D-TS7 secret URL + `CompanyId`; `Mode=TEST` refused on production and `PROD` refused on staging (the D-AD8 pattern). |

---

## 4. Order of work (proposal)

| Step | Closes | Track | Size | Before what |
|---|---|---|---|---|
| **LQ5** close-out door + closures table + outcome stages | F-LA1 | recruiting (S) | ~1.5 d, 1 migration + 1 reader PR | first real Meta spend; Indeed Disposition Sync |
| **LQ6** bells and SLA read the summary; lane in the queue; `no_contact_detail` count | F-LA2, F-LA6 | recruiting (S) | ~0.5 d, no migration | can ride with LQ3b |
| **LQ7** `LeadFacts` seam with per-channel readers; `home_time` requirement | F-LA4 | shared + recruiting (W) | ~2 d, 1 profile-contract change | Indeed and Tenstreet listeners |
| **LQ8** phone line-type lookup at ingest (Telnyx) | F-LA3 | recruiting (S) | ~1 d, 1 migration + 1 reader PR | Indeed/Tenstreet go-live |
| **LQ9** re-judge sweep on profile/opening save | F-LA5 | recruiting (S) | ~0.5 d | — |
| `lead_burst` monitor rule | F-LA7 | ads (W) | ~0.25 d | — |
| Targeting read-back reading | F-LA8 | Publisher L4 | at the sandbox run | Launch certification |

None of these needs a vendor credential to build; LQ8 needs the Telnyx lookup product enabled on the account we have.
LQ3 (in flight) is not changed by this audit; LQ5 widens what its reader can count.

---

## 5. Open questions (also pointed to from ADS-AGENT-PLAN §9)

- **Q-AD62 · Phone line-type lookup at ingest** (owner; cost). (a) Every lead with a phone, all channels. (b) Only
  leads without SMS verification (Indeed, Tenstreet, manual). (c) None. **Rec (a):** cents per lead against a
  recruiter's dial, and the Meta-side figure is what tells us whether SMS verification is working.
- **Q-AD63 · What happens to a lead whose own answer fails a hard requirement** (owner). (a) No `lead_new` bell, no
  SLA alarm, own lane in the queue, still callable and convertible. (b) Bell to a separate audience. (c) Unchanged.
  **Rec (a).** D-LS3 is untouched: `unknown` still rings.
- **Q-AD64 · Close-out reasons, and whether `qualified` is a status a recruiter sets** (owner; counsel informed). The
  reason list in F-LA1 is fixed and operational (no free text in the reason; an optional note never leaves the
  drawer). (a) `qualified` is set by the recruiter after the call ("worth an application"). (b) `qualified` :=
  converted (today's Q-AD37 (b) wording). **Rec (a):** it is Joanna's own stage, and it is the positive signal the
  outcome feed lacks between `contacted` and `converted`.
- **Q-AD65 · Send negative stages to Meta** (owner; L4 confirms under EMPLOYMENT, with Q-AD17). (a) Send
  `not_qualified` and `lost_before_conversion` through the outcome feed. (b) Positive stages only. **Rec (a):**
  Meta's Conversion Leads optimisation is built on the whole funnel; a feed with no negatives teaches nothing.
- **Q-AD66 · Re-judge open leads when the profile changes** (us). (a) Sweep writes new verdict rows for open leads of
  the openings pinning the new version. (b) New leads only. **Rec (a).**

---

## Sources (read 2026-11-09, `origin/main` @ `1c26ac7` unless noted)

- `apps/api/src/modules/ads/leads/{leadgenWebhook,leadFetch,backfill,formRefs}.ts` ·
  `apps/api/src/modules/ads/platforms/meta/publisher.ts` · `apps/api/src/modules/ads/orchestrator/transitions.ts`
- `apps/api/src/modules/recruiting/leads/{leadSink,verdicts,leadNotify,leadUncontacted,leadContacts,doNotContact,leadAssignment,leadQueue}.ts` ·
  `apps/api/src/modules/recruiting/routes/leads.ts`
- `packages/shared/src/recruiting/leads/{leadContract,leadMatch}.ts` ·
  `packages/shared/src/ads/{metaLeadForm,metaLeadFormScreens,leadOutcomes,settingsContract,monitorChecks}.ts`
- `supabase/migrations/0553_recruiting_leads.sql`, `0554_recruiting_lead_functions.sql`, `0558_recruiting_lead_purge.sql`
- `docs/plans/recruitment/ADS-LEAD-QUALITY-PLAN.md`, `INDEED-APPLY-ONBOARDING-REPLY-2026-11-06.md` and
  `TENSTREET-INTAKE-PLAN.md` (the last two are in the owner's working tree, not yet on main)
- Meta: Lead Ads › Create; Page `leadgen_forms` reference; Conversion Leads / CRM integration guidance (the exact
  EMPLOYMENT behaviour is an L4 reading, Q-AD17). Telnyx: Number Lookup API (price to be read at build time).
