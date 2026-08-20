# The recruiting system — from the phone call to a driver in a truck · 2026-08-20

The owner's framing, verbatim: *"From Recruiter receives call → create applicant profile → finish
all checking (PSP, MVR, Drug testing, Training system with videos, Orientations and hiring)."*

Everything regulatory below was read on Cornell LII on 2026-08-20 — not recalled. Everything about
the code was verified against the tree at `27955f5` (schema `0224`). Vendor facts come from
`docs/vendor/sambasafety-postman-collection.json` (the collection IS the spec; there is no OpenAPI)
and from FMCSA's own Clearinghouse pages. Production numbers are the 2026-08-20 handoff's.

This plan is the answer to `HANDOFF-2026-08-20.md` §6. It is an architecture document first and a
step list second: §5's steps each stand alone with their own done-when, per that handoff's §6.4.

Related canon: `HIRING-PLAN.md` (D-HIRE1–7, all steps done), `EMPLOYER-INQUIRY-PLAN.md` (D-PEI1–6,
E6/E7 remain), `../safety-dqf/PSP-PLAN.md` (D-PSP1–9), `../safety-dqf/SAMBA-RECON.md`,
`../DRIVER-TRAINING-PLAN.md` (adopted by R7 below, with a refresh). Nothing here supersedes any of
them; this plan is the spine they were each a vertebra of.

---

## 0. What exists, what is missing

What shipped in #127–#139 is the middle of the process: an applicant can be invited, can certify a
§391.21 application, the §391.23 inquiries go out and are evidenced by their attempts, PSP can be
imported (and ordered, once enabled and signed), and H8 files it all at hire in one transaction.

What does not exist is either end and two whole limbs:

| Step a recruiter meets | State |
|---|---|
| 1. The call (lead, source, callback, disposition) | **Nothing.** First artifact today is a `drivers` row with `status='applicant'`, which assumes the decision to process was already made |
| 2. Pre-qualification (cheap questions before the expensive process) | **Nothing** |
| 3. MVR — §391.23(a)(1), required for **every** hire | **Nothing built.** Recon done, catalogue item exists, nothing performs it |
| 4. Drug & alcohol — §382.301 pre-employment | `drug_test` record kind exists; **the process does not** |
| 5. Clearinghouse — §382.701(a) full query | `clearinghouse_preemployment` catalogue item exists; **nothing performs it** |
| 6. Training with video | 1396-line plan, "planning complete", **nothing built** |
| 7. Orientation (sessions, acknowledgements, §391.31 road test) | **Nothing** |
| 8. The hire | **H8 exists and works** — the only finished part of the back half |

And the cross-cutting gap: no surface shows a recruiter one candidate's *next action* across all
eight steps. `RecruitmentPage` shows the four derivable application stages; everything after
`ready_to_screen` is invisible until the hire preview.

---

## 1. The architectural question, answered

`HANDOFF-2026-08-20.md` §6.2 asked: **pipeline, checklist, or state machine?** The three shipped
surfaces answered differently, and the handoff worried they disagree. Having read all three closely,
they do not — they answer three different questions, and the recruiting system needs all three
answers at once:

- `applicantPipeline` derives a **stage** from evidence rows and stores nothing, because a stored
  stage is a second copy of facts that goes stale (H6). Its extension point is the requirement
  list, not a renumbering.
- `dqCatalogue`/`dqFile` is a **checklist**, because the regulation enumerates items, not order.
- `employer_inquiries` is an **append-only act ledger with a derived status fold**, because the
  attempts are themselves the regulatory deliverable, and because it is the only shape that can
  express "we asked, the clock is running" — a fact about an *act plus today*, not about evidence.

The missing steps all decompose into those same three shapes. An MVR order, a drug-test order, a
Clearinghouse query, a recruiter's callback, a scheduled orientation session — every one is an
**act** that can be recorded as a dated row the moment it happens, with state derived from the log
plus the clock. `psp_requests` already proved the shape for a billed vendor call; `employer_inquiries`
proved it for an unbillable human one. The things that feel like "real state that is not derivable"
(the handoff's worry) — a callback promised for Thursday, an orientation booked for the 14th — are
not stage values; they are **future-dated acts**, and a row that says so is still a fact with a
single writer, not a status somebody must remember to advance.

So: **no `recruiting_stage` column, anywhere** (D-REC1). The one genuinely new kind of entity is the
lead (D-REC2) — a person who exists before any evidence does — and even the lead's lifecycle is a
log of contacts plus one recorded disposition, not a status ladder.

---

## 2. Decisions

**D-REC1 — process state is an act ledger plus a fold; H6 stands, everywhere.** Every step of
recruiting is recorded as the dated act it is (a call logged, an order placed, a session scheduled,
a result filed) in an append-only or single-writer table, and every "where are they?" answer is a
pure function over those rows and today's date. The precedents are binding: `employerInquiryState`
folds attempts; `syncInquiryStatus` shows how a materialised projection is allowed to exist — with
exactly one writer and the fold as its only source. A stored stage column would be the failure H6
named, now with eight steps' worth of chances to go stale.

**D-REC2 — a lead is not a driver.** D-HIRE5 made an applicant a `drivers` row because everything
gathered about an applicant is already about the driver they may become. A lead is the step before
that decision: a phone call that may never become anything. Putting leads in `drivers` would mean
every status filter audit again (the FleetReadiness lesson, `constants.ts`), would hand `§391`
vocabulary to people who never applied, and would trap never-pursued PII behind evidence-table
retention rules written for qualification files. So leads live in their own table, are convertible
to an applicant (creating the `drivers` row and carrying source attribution forward), and are
**dispositioned, never deleted** — "not interested", "did not meet minimums", "unreachable" are
answers a recruiter recorded, and next quarter's "why did we lose 40 tanker leads" question is
asked of those answers.

**D-REC3 — a vendor interaction is a ledger with gates, in the PSP shape.** `checkPspGates` ordered
its refusals deliberately: legality (the signed instrument), then authority, then budget, then
correctness — each refusing *before* the ledger row exists. MVR orders and drug-test orders copy
that shape wholesale, because every reason it was right for PSP holds: the calls cost money, the
legality gate is FCRA, and a validator that disagrees with the order path costs money to discover.
Two Samba-specific rules join the template: **status comes from the response body, never the HTTP
code** (Samba returns application errors as HTTP 200 — codes B01–U02), and the raw report is stored
whole with a thin parsed projection (D-PSP2's move; a wrong projection is re-derivable without
re-buying).

**D-REC4 — the Clearinghouse is a portal workflow we record, not an API we call.** Verified
2026-08-20: FMCSA offers **no API** — its own FAQ says there are no integration specs for automated
employer access, and the "integrated" vendors are designated C/TPAs driving the portal and its bulk
file upload. Two consents exist and they are not interchangeable: the §382.703(a) *general* consent
(written, ours to collect — the `clearinghouse` instrument in `DISCLOSURES`) supports **limited**
queries only; the **full** query's consent is electronic, *inside the Clearinghouse*, given by a
driver who must be registered there — an external state we cannot poll. So the product records the
acts (query requested → awaiting the driver's in-Clearinghouse consent → result filed as a
document + `clearinghouse_full` record) and automates the one thing automatable: generating the
portal's bulk-upload file for the annual §382.701(b) limited queries.

**D-REC5 — the verified negative is the evidence, and it precedes the wheel.** §382.301(a) is
explicit that the employer must have *received* the verified negative before the driver first
performs a safety-sensitive function — a test *ordered* is not compliance. Driving a CMV is a
safety-sensitive function, and the §391.31 road test is driving a CMV, so the orientation schedule
inherits a hard edge: collection early, road test only after the MRO's verified negative (and the
§382.701(a) full query result) are in hand. The §382.301(b) prior-program exception is real but so
narrow (30-day currency, records chased from the previous program) that it is modelled as an edge
path with its own required records (§382.301(c)), never the primary flow. Whether a pre-hire road
test is legally "for the employer" is flagged to counsel (Q-REC5), but the product defaults to the
reading that cannot be wrong.

**D-REC6 — ELDT is a licensing gate, not a qualification item; only orientation is ours.** Part 380
subpart F puts ELDT between the driver and the *State licensing agency*: a provider on the Training
Provider Registry trains, the registry tells the State, the State refuses the skills test otherwise
(§380.609). A lawfully issued post-2022-02-07 CDL therefore already implies ELDT, which is why
`eldt` is advisory in the catalogue and stays that way. What FuelGuard builds is carrier
orientation training — `DRIVER-TRAINING-PLAN.md` already drew this line correctly ("we are not an
ELDT provider") — and its certificates must say on their face that they are not TPR training.

**D-REC7 — the road test branches on equipment.** §391.33(a)(1) accepts a CDL in lieu of the road
test — *except* for drivers of doubles/triples or tank vehicles, for whom the carve-out removes the
substitute entirely. So "road test satisfied by CDL equivalency" is not a fleet-wide policy but a
per-driver answer that depends on what they will haul, and §391.33(c) lets the carrier require a
real test anyway. The catalogue already models the requirement with two evidence kinds
(`road_test`, `cdl_equivalency`); what R8 adds is the act (the test, the §391.31(e) form and
certificate) and the equipment branch that decides whether the equivalency is even lawful.

---

## 3. Facts that bound the design (verified, with the surprises flagged)

- **Samba requires `birthDate` on every MVR order.** The zero-DOB production state blocks MVR
  exactly as it blocks PSP. The DOB import (`/recruitment/screening`) is the unblock for both.
- **Q-H2 is answered by the collection: `ssn` is optional, 4 or 9 digits.** D-HIRE6's last-four
  column is sufficient for Samba; nothing about MVR ordering needs the sealed full SSN.
- Samba is async (poll `mvrorders/:id`, or webhooks whose **signature scheme is undocumented** —
  recon §3's open question stands; until answered the receiver trusts nothing and the poller is
  the source of truth). Reports are content-negotiated: **PDF for `documents`, JSON for the parsed
  projection — two fetches, one order.** `OVERNIGHT` states exist (HI/MO/CA); `stateAccessCode`
  (CA/PA) and Utah's `customerOrgId` are guarded as named errors, not config, because the fleet has
  no drivers there.
- **The Clearinghouse full-query consent cannot be collected on our paper** (§382.703(b),(d)) — the
  workflow must represent "waiting on the driver, elsewhere" honestly, the way `awaiting` already
  does for employers.
- **§382.701(b)(3): a limited query that finds a record escalates to a full query within 24 hours**
  or the driver comes off safety-sensitive functions. The annual-query surface must carry that
  clock, not just the annual one.
- **Interstate minimum age is 21 (§391.11(b)(1))** — the first pre-qualification question, and the
  cheapest.
- Silvicom runs 201 active CDL drivers today, so a Part 382 testing program — a consortium/C/TPA,
  collection sites, an MRO — **already exists somewhere**. R6 integrates with whatever that is; it
  does not invent a testing apparatus (Q-REC2 asks the owner who it is).
- The whole screening front half stays blocked on **Q-H3** (every instrument `v0-draft`; the gate
  refuses draft signatures by design) and on the **zero dates of birth**. No step below unblocks
  either; only the owner can.

---

## 4. The shape of the build

Two new operational tables, one act-ledger per vendor, and derived surfaces — no new state machine:

- **`recruiting_leads`** — the person before the decision: name, phone/email, source, the
  pre-qualification answers (a transcription, mutable like `driver_employment_history`, with the
  same header argument), a disposition (recorded, never deleted), and `converted_driver_id` when a
  recruiter promotes one. **`recruiting_contacts`** — the act log: each call/text/email, dated,
  append-only, including future-dated planned callbacks. The callback list is a fold: latest
  planned contact per undispositioned lead, ordered by date.
- **`mvr_orders`** — `psp_requests`' sibling: gates before the row, status from the body, raw
  stored, price recorded, PDF→`documents` + projection→`qualification_records` (kind `mvr`) on
  fulfilment.
- **Drug tests and Clearinghouse queries** need no vendor ledger yet — they are recorded acts with
  filed results (R5/R6), gaining automation only where automation exists.
- **Orientation** — sessions (scheduled acts), attendance, acknowledgements (the instrument
  pattern), the road test form and certificate.
- **The recruiter board** grows by H6's rule: each step that lands adds derivable stages/requirements
  to the fold; no stage ships before its data exists.

---

## 5. Steps — each stands alone, in the order a recruiter meets them

**R0 · The owner interview.** The highest-value research is not in a regulation: how the process
runs today — where calls come from and their volume; who screens; **who the current C/TPA,
collection sites and MRO are**; what an orientation day looks like; whether Silvicom hauls tank or
doubles (D-REC7's branch); and the standing blockers (Q-H3 wording, the DOB CSV, the PSP price).
**Done when:** Q-REC1–Q-REC6 have answers recorded in this document, struck through in place.

**R1 · Leads.** `recruiting_leads` + `recruiting_contacts`, the callback fold, disposition, and
conversion (lead → `drivers` applicant row + invitation, source carried). Recruiter-writable
(`recruitment: manage`), org-scoped, RLS on.
**Done when:** a phone call can be recorded before any decision exists, a callback list orders
itself, a dead lead is dispositioned without deleting anything, and conversion attributes the
eventual applicant to a source.

**R2 · Pre-qualification.** Structured answers on the lead (age vs §391.11(b)(1), CDL class and
endorsements, experience, domicile, self-reported history) and a pure `prequalification.ts` verdict
— derived, advisory, one line per rule, so a recruiter sees "does not meet minimums" before the
expensive process starts. The applicant's later certified §391.21 application supersedes the
transcription; nothing from pre-qual enters a qualification file.
**Done when:** a lead that fails a minimum says so and why, and no pre-qual answer ever appears as
evidence.

**R3 · MVR orders (the demo environment first).** The Samba client (three secrets, org
integration), `mvr_orders` with the PSP gate order (`SCREENING_PREREQUISITES` already maps
`mvr_order → [fcra_disclosure]`), validation refusing before money (DOB present, no accented
names, guarded states), body-derived status, and ingest: PDF filed, JSON projected, `mvr` record
written — which turns `mvr_preemployment` green in the file for the first time. Exercised entirely
against `api-demo.sambasafety.io`, the PSP-UAT lesson applied.
**Done when:** a demo order round-trips to a filed document and record, a scripted B01-style
HTTP-200 error lands as a failed order, and ordering refuses without a live `fcra_disclosure`
authorization.

**R4 · MVR delivery in the worker.** The poller (and the webhook receiver only once the signature
question is answered — until then it may 202-and-ignore), as queue handlers under `WORKER_ROLE`,
one scheduler fleet-wide per `docs/WORKER-DEPLOYMENT.md`. Monitoring enrolment for §391.25
(`annual_mvr_review`) is a separate later step and is **not** started here (the D-PSP4 discipline:
a change notice notifies; a billed pull is an operator's decision).
**Done when:** a pending demo order fulfils without a human refresh, and the readiness page counts
MVR-ready drivers with the same validator the order path runs.

**R5 · Clearinghouse.** The recorded workflow: a query act with its kind (full pre-employment /
limited annual), the awaiting-external-consent state named honestly, results filed as
document + record (`clearinghouse_full` / `clearinghouse_limited` kinds — the catalogue items
exist); the §382.701(b)(3) 24-hour escalation clock on a limited hit; and the bulk-upload CSV
generator for the annual round. The `clearinghouse` instrument's role is scoped to §382.703(a)
general consent (limited queries) — full-query consent is tracked, never collected.
**Done when:** a recruiter can carry one driver through query → consent-wait → filed result without
leaving out an act, and the annual round produces a portal-ready file instead of 201 portal visits.

**R6 · Drug & alcohol, §382.301.** The recorded process against the carrier's existing C/TPA
(R0 answers who): order/collection acts, the MRO's verified negative filed as the `drug_test`
record that satisfies `drug_test_preemployment`, the (b) exception as an explicit edge path with
its §382.301(c) records, and D-REC5's gate expressed where scheduling lives: no road test, no
wheel-time, before the negative and the full-query result are filed. Vendor API integration
(Quest/CRL-style eCCF ordering) only if R0 reveals the C/TPA offers one.
**Done when:** the file shows ordered ≠ done, a verified negative satisfies the requirement, and an
orientation schedule cannot book wheel-time ahead of it.

**R7 · Training, by refreshing the plan that exists.** `DRIVER-TRAINING-PLAN.md` is adopted, not
rewritten — its decisions (provider interface, immutable versions, honest-effort rules, append-only
events) survive contact with today's tree. The refresh pass before its Phase 0: renumber migrations
(0225+), move transcode/email onto the worker queue (the plan predates `worker.ts`), join the
training tables to `RETENTION_FORBIDDEN`, reuse the `application_invitations` hashed-token
precedent for links, decide whether applicants are assignable (orientation content pre-hire says
yes; Q-REC6), and put the not-ELDT disclaimer on the certificate face (D-REC6).
**Done when:** the refreshed plan's Phase 0+1 ship as that document specifies, against current
infrastructure.

**R8 · Orientation and the road test.** Sessions as scheduled acts with attendance; handbook and
policy acknowledgements on the instrument pattern (versioned wording, signature evidence per
D-HIRE4); the §391.31 road test with the (c) content list, the (e) form and certificate filed as
the `road_test` evidence, and the equipment branch deciding whether `cdl_equivalency` is even
offered (D-REC7). D-REC5's sequencing gate enforced here.
**Done when:** an orientation day is schedulable, its record trail survives an auditor, and a
tank-vehicle driver cannot be marked road-test-complete by CDL equivalency.

**R9 · The recruiter board.** The spine surface: every undispositioned lead and every applicant,
each with a derived next action — call back Thursday, send the application, order the MVR, book
orientation, hire — folding over everything R1–R8 recorded. Ships last because H6 forbids it
shipping first: every stage it shows must be derivable from rows that exist, and by R9 they all are.
**Done when:** a recruiter starts their day on one page, and nothing on it can disagree with the
files it summarises.

E6 and E7 (`EMPLOYER-INQUIRY-PLAN.md`) remain sanctioned to build at any point; they belong to that
plan, not this one.

---

## 6. Open questions

- **Q-REC1** — the owner interview (R0): today's process, sources, volume, orientation day.
- **Q-REC2** — who is the current C/TPA / consortium / MRO, and do they expose ordering or results
  electronically? Decides R6's integration half.
- **Q-REC3** — does Silvicom haul tank vehicles or doubles? Decides D-REC7's default branch.
- **Q-REC4** — does a SambaSafety account exist (credentials, which MVR products are on the
  contract, monitoring pricing)? The recon's rep questions ride along: webhook signature, rate
  limits, whether a no-hit bills.
- **Q-REC5** — counsel: is a pre-hire §391.31 road test "performing a safety-sensitive function for
  the employer" under §382.107/§382.301(a)? The product assumes yes (D-REC5) because that reading
  cannot be wrong; a no would only relax scheduling.
- **Q-REC6** — may applicants be assigned orientation training pre-hire (R7), and does any of it
  count as paid time the carrier must track? Owner + counsel.
- **Q-REC7** — lead retention: how long does a dispositioned lead's PII live? Leads are not
  evidence (D-REC2), so a retention rule is *allowed* to prune them — someone must choose the
  window.
- Standing, unchanged, still the real blockers: **Q-H3** (disclosure wording), **Q-PEI1**,
  **Q-PEI3**, **Q2** (PSP price), and the **DOB CSV**.
