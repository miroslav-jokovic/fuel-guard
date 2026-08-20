# The recruiting system — from the phone call to a driver in a truck · 2026-08-20

The owner's framing, verbatim: *"From Recruiter receives call → create applicant profile → finish
all checking (PSP, MVR, Drug testing, Training system with videos, Orientations and hiring)."*

This is an **execution document**: decisions are made, not surveyed; every step in §5 carries its
prerequisites, its build, its verification and its done-when; §4 is the protocol that lets any
session — including a fresh one with no memory of this conversation — pick up the next step
without re-deriving anything. Unknowns are not assumed anywhere: each lives in §6 with a named
owner and a fallback the code takes until the answer arrives.

Sources, so nothing here rests on recall: regulation text read on Cornell LII 2026-08-20; the tree
at `27955f5` (schema `0224`); `docs/vendor/sambasafety-postman-collection.json` (the collection IS
the spec — there is no OpenAPI); FMCSA's own Clearinghouse pages; production numbers from
`HANDOFF-2026-08-20.md` §3.

Related canon, none superseded: `HIRING-PLAN.md` (D-HIRE1–7, done), `EMPLOYER-INQUIRY-PLAN.md`
(D-PEI1–6; E6/E7 remain), `../safety-dqf/PSP-PLAN.md` (D-PSP1–9), `../safety-dqf/SAMBA-RECON.md`,
`../DRIVER-TRAINING-PLAN.md` (adopted by R7, with the refresh pass R7 specifies).

---

## 0. Ground truth

Production, measured 2026-08-20: Silvicom Inc, DOT 1864495, 201 active + applicant drivers,
166 licences, **0 dates of birth, 0 signed authorizations, 0 PSP reports**. Every instrument in
`DISCLOSURES` is `v0-draft` and the signing gate refuses drafts by design.

What shipped in #127–#139 is the middle of the process. What is missing is either end and two limbs:

| Step a recruiter meets | State |
|---|---|
| 1. The call (lead, source, callback, disposition) | Nothing — first artifact today is a `drivers` row with `status='applicant'` |
| 2. Pre-qualification | Nothing |
| 3. MVR — §391.23(a)(1), required for **every** hire | Recon done, catalogue item exists, nothing performs it |
| 4. Drug & alcohol — §382.301 pre-employment | `drug_test` record kind exists; the process does not |
| 5. Clearinghouse — §382.701(a) full query | Catalogue item exists; nothing performs it |
| 6. Training with video | 1396-line plan, planning complete, nothing built |
| 7. Orientation (sessions, acknowledgements, §391.31 road test) | Nothing |
| 8. The hire | **H8 exists and works** |

Cross-cutting gap: no surface shows one candidate's next action across all eight steps.

---

## 1. The architecture

`HANDOFF-2026-08-20.md` §6.2 asked: **pipeline, checklist, or state machine?** The three shipped
surfaces answer three *different questions*, and all three answers are kept:

- `applicantPipeline.ts` derives a **stage** from evidence rows and stores nothing (H6): a stored
  stage is a second copy of facts that goes stale. Its extension point is the requirement list.
- `dqCatalogue`/`dqFile` is a **checklist**: the regulation enumerates items, not order.
- `employer_inquiries` is an **append-only act ledger with a derived status fold**: the attempts
  are themselves the regulatory deliverable, and a fold over attempts-plus-today is the only shape
  that can say "we asked, the clock is running" without a hand-set status.

Every missing step decomposes into those shapes. An MVR order, a drug-test order, a Clearinghouse
query, a recruiter's callback, an orientation session — each is an **act** recordable as a dated
row the moment it happens (or is scheduled: a booked session is a future-dated act, still a fact
with a single writer). `psp_requests` proved the shape for a billed vendor call;
`employer_inquiries` proved it for an unbillable human one. **No `recruiting_stage` column exists
anywhere in this plan.** The one new kind of entity is the lead — a person who exists before any
evidence does — and even the lead's lifecycle is a contact log plus one recorded disposition.

---

## 2. Decisions

**D-REC1 — process state is an act ledger plus a fold; H6 stands, everywhere.** Every step is
recorded as the dated act it is, in an append-only or single-writer table; every "where are they?"
answer is a pure function over those rows and today's date. Materialised projections are allowed
only on the `syncInquiryStatus` terms: exactly one writer, the fold as its only source.

**D-REC2 — a lead is not a driver.** D-HIRE5 made an applicant a `drivers` row because everything
gathered about an applicant is already about the driver they may become. A lead is the step before
that decision. Leads in `drivers` would reopen every status-filter audit (the FleetReadiness
lesson, `constants.ts:74–83`), hand §391 vocabulary to people who never applied, and trap
never-pursued PII behind evidence-table retention. Leads get their own table, are convertible to an
applicant (creating the `drivers` row, carrying source attribution), and are **dispositioned,
never deleted**. Deliberately: lead tables do NOT join `RETENTION_FORBIDDEN` — they are the one
part of recruiting a retention rule may lawfully prune, once §6's Q-REC7 sets the window.

**D-REC3 — a vendor interaction is a ledger with gates, in the PSP shape.** `checkPspGates`
(`apps/api/src/services/pspOrder.ts:148–231`) ordered its refusals deliberately: enabled-flag,
legality (the signed instrument), authority, budget, correctness — each refusing *before* the
ledger row exists. MVR orders copy that shape wholesale. Two Samba-specific rules join the
template: **status comes from the response body, never the HTTP code** (Samba returns application
errors as HTTP 200, codes B01–U02), and the raw report is stored whole with a thin parsed
projection (D-PSP2: a wrong projection is re-derivable without re-buying).

**D-REC4 — the Clearinghouse is a portal workflow we record, not an API we call.** Verified
2026-08-20 on FMCSA's own pages: there is **no employer API** and no integration spec; vendors that
"integrate" are designated C/TPAs driving the portal and its bulk file upload. Two consents exist
and are not interchangeable: the §382.703(a) *general* consent (written, ours to collect — the
`clearinghouse` instrument) supports **limited** queries only; the **full** query's consent is
electronic, *inside the Clearinghouse*, by a driver registered there — external state we cannot
poll. The product records the acts and automates the one automatable thing: the bulk-upload file
for the annual §382.701(b) limited round.

**D-REC5 — the verified negative is the evidence, and it precedes the wheel.** §382.301(a): the
employer must have *received* the MRO's verified negative before the driver first performs a
safety-sensitive function. Driving a CMV is safety-sensitive; the §391.31 road test is driving a
CMV; so scheduling inherits a hard edge — collection early, wheel-time only after the verified
negative **and** the §382.701(a) full-query result are filed. The §382.301(b) prior-program
exception is modelled as an explicit edge path with its §382.301(c) records, never the primary
flow. Q-REC5 flags the road-test reading to counsel; the default is the reading that cannot be
wrong.

**D-REC6 — ELDT is a licensing gate, not a qualification item; only orientation is ours.**
§380.609 puts ELDT between the driver and the State licensing agency via the Training Provider
Registry; a lawfully issued post-2022-02-07 CDL already implies it. `eldt` stays advisory.
FuelGuard builds carrier orientation training — `DRIVER-TRAINING-PLAN.md` already drew this line
("we are not an ELDT provider") — and its certificates state on their face that they are not TPR
training.

**D-REC7 — the road test branches on equipment.** §391.33(a)(1) accepts a CDL in lieu of the road
test *except* for doubles/triples and tank vehicles, where the substitute is removed entirely.
"Road test satisfied by CDL equivalency" is therefore a per-driver answer depending on what they
will haul, and §391.33(c) lets the carrier require a real test regardless. Until §6's Q-REC3
answers what Silvicom hauls, **the equivalency path is disabled** — the fallback that cannot be
wrong — and every driver gets a real §391.31 test.

---

## 3. Facts the design is bound by (each verified, none recalled)

- **Samba requires `birthDate` on every MVR order.** Zero DOBs blocks MVR exactly as it blocks
  PSP. The unblock is the DOB import at `/recruitment/screening` (routed 2026-08-20 — it had
  shipped without a route record).
- **Q-H2 is answered by the collection: `ssn` is optional, 4 or 9 digits.** D-HIRE6's last-four
  column is sufficient for Samba; MVR ordering never needs the sealed full SSN.
- Samba auth is OAuth2 client-credentials (`expires_in: 3600`) **plus** an `X-Api-Key` header —
  three secrets per environment. Hosts: `api-demo.sambasafety.io` (simulates, no state fees) and
  `api.sambasafety.io`. Secrets go in `integration_credentials` (0012's table: service-role only,
  no client policies — the Samsara and EFS-SOAP precedent), sealed with `secretBox`
  (`apps/api/src/lib/secretBox.ts`, AAD-bound to the tenant); non-secret config (environment,
  group id) goes in `org_integrations` (0068) under `provider = 'sambasafety'`.
- Samba is async: poll `GET /transactional/v1/mvrorders/:orderId`, or webhooks whose
  **signature scheme is undocumented** (recon §3, still open). Reports are content-negotiated:
  **PDF for `documents`, JSON for the projection — two fetches, one order.** `OVERNIGHT` states
  HI/MO/CA; `stateAccessCode` needed for CA/PA and `customerOrgId` for UT — all guarded as named
  errors because the fleet has no drivers there (recon §8).
- **Application errors return HTTP 200** with body codes B01–U02. A status-code-only client
  records failed orders as successes.
- `SCREENING_PREREQUISITES` (`packages/shared/src/authorizationContract.ts:229–234`) already maps
  `mvr_order → [fcra_disclosure]`, `clearinghouse_full → [clearinghouse]`. The legality gates are
  specified; only the wording (Q-H3) is missing.
- The Clearinghouse full-query consent cannot be collected on our paper (§382.703(b),(d)).
  **§382.701(b)(3): a limited-query hit escalates to a full query within 24 hours** or the driver
  comes off safety-sensitive functions.
- Interstate minimum age is 21 — §391.11(b)(1).
- Silvicom runs 201 active CDL drivers, so a Part 382 program (C/TPA or consortium, collection
  sites, MRO) **already exists somewhere**; R6 integrates with it rather than inventing one.
- The catalogue already carries every requirement this plan satisfies: `mvr_preemployment`,
  `annual_mvr_review`, `drug_test_preemployment` (kind `drug_test`),
  `clearinghouse_preemployment` (kind `clearinghouse_full`), `clearinghouse_annual`
  (kind `clearinghouse_limited`), `road_test` (kinds `road_test`, `cdl_equivalency`). The steps
  below build the *processes*; the checklist vocabulary does not change.

---

## 4. Execution protocol — read this before executing anything, every session

**Resume ritual (a fresh chat starts here):**

1. Read this document top to bottom. Then `HANDOFF-2026-08-19.md` §4 and `HANDOFF-2026-08-20.md`
   §4 — the harness facts and the mistakes that already cost a day each.
2. Establish reality, never assume it: `git log --oneline -15`, `pnpm verify:live` (and
   `gh run list --workflow=migrate.yml` before believing a schema mismatch — deploy and migrate
   finish at different times).
3. Find the first §5 step not marked **DONE**. Check its prerequisites against §6. A missing
   prerequisite means *run the fallback written next to it* — it never means guess.
4. One step (or named sub-step) per branch (`claude/<topic>`), PR to `main`.
5. When a step ships, mark it **— DONE <date> (migrations NNNN–NNNN)** in place, with a "What
   shipped" list and "Verified by:" naming the gates run — the register `HIRING-PLAN.md` uses.
   When a §6 question is answered, strike it through in place with the answer and date. **This
   document is the memory between sessions; the chat is not.**

**Rules that apply to every step (the enterprise bar — each is machine-enforced or test-asserted):**

- Migration numbers are **never pinned in advance** — next-numbered at execution
  (`lint:migrations`; the training plan's numbers went stale by 145 within a month).
- Every new table: `enable row level security` (`check-rls.mjs`). No client policies means
  deny-all, API-only — the default here; a client policy is added only with a §391.23(k)(2)-style
  argument written above it.
- Every service query org-filters itself and a test asserts it via `supabaseRecorder`'s
  `expectOrgScoped` (the service role bypasses RLS).
- Append-only tables get a BEFORE UPDATE/DELETE trigger raising a named five-character SQLSTATE
  (the EI010/DA010/HA010 family), and the API maps that code to an answer, not a 500 — the
  recorder can script RPC failures to prove it.
- Every new table gets a PGlite matrix in `supabase/tests/*.test.mjs` printing a `RESULT` line,
  with the default-privileges block from `restricted-records.test.mjs` before the migration loop
  and `role` inside the claims JSON.
- Each table declares its side of the evidence line in its header comment, on 0208's model:
  evidence (append-only, `RETENTION_FORBIDDEN` in `dataRetention.ts`) or operational
  (mutable/prunable, and why that is safe).
- Anything that spends money ships behind an env flag **default off**, with a monthly ceiling
  counted from the ledger, and unit price recorded per row (`unit_price_usd`, 0219's pattern).
- Vendor payloads at rest are redacted of DOB and licence numbers (`redactRequest`,
  `pspOrder.ts:112–130`); raw *responses* are stored whole; PII never reaches logs or `meta`.
- Webhooks are wake-up signals, never sources of truth: authenticate (constant-time via
  `safeEqual`), then fetch the referenced resource through the authenticated API. Until Samba's
  signature scheme is answered, its receiver may 202-and-discard; the poller is the truth.
- New routed pages: route record **in the same commit** as the page (the P0b/E5 incident:
  two finished pages shipped unreachable), `PageHeader`, and the `lint:ui-adoption`,
  `lint:tokens` gates. Session-free pages join the exemption list in
  `scripts/ui-system-inventory.mjs` with a reason.
- Acts that a person takes (convert, order, file, refuse, schedule) write audit entries with
  `filed`/`skipped`/`outstanding`-grade honesty (H8's audit is the model).
- Gates run before any PR: `pnpm test`, `pnpm typecheck`, `pnpm lint`, plus the step's named
  extras. Comments claiming coverage quote a real test title (`lint:comment-claims`). File and
  function budgets hold (`lint:filesize`, `lint:funcsize`).

---

## 5. Steps — each stands alone; execute in order unless its prerequisites say otherwise

### R0 · The owner interview — no code

The highest-value research is not in a regulation. Put the §6 register (Q-REC1–Q-REC7, plus the
standing blockers Q-H3, the DOB CSV, Q2/PSP price, the UAT token status) in front of the owner as
one list and record the answers in §6, struck through in place.

**Done when:** every Q-REC entry in §6 is either answered in place or explicitly deferred by the
owner, and the standing blockers have a current status line each.

### R1 · Leads

**Prerequisites:** none. (Source vocabulary refined by Q-REC1 later; ships with a closed
starter set + `other`.)

**Build.**
- Migration (next-numbered): `recruiting_leads` — `id uuid pk`, `org_id` FK, `full_name` not
  null, `phone`, `email`, `source` in a closed set (`referral`, `job_board`, `website`,
  `walk_in`, `rehire`, `other`) with `source_note`, `prequal jsonb` (R2 fills it),
  `disposition` null or in (`converted`, `not_interested`, `not_qualified`, `unreachable`,
  `withdrawn`) with `disposition_note`/`disposition_at`/`disposition_by`,
  `converted_driver_id` FK null, timestamps, `created_by`. CHECK: `disposition = 'converted'`
  iff `converted_driver_id is not null` (both-or-neither). Header comment declares it
  **operational, not evidence** — mutable transcription on 0208's argument, prunable once
  Q-REC7 sets a window, deliberately NOT in `RETENTION_FORBIDDEN` (D-REC2).
- Same migration: `recruiting_contacts` — append-only act log: `lead_id` FK, `kind` in
  (`call`, `sms`, `email`, `in_person`, `note`, `callback_planned`), `occurred_at` default now,
  `due_on date` (CHECK: present iff `kind = 'callback_planned'`), `note`, `created_by`.
  BEFORE UPDATE/DELETE trigger raising SQLSTATE **`RC010`**.
- Same migration: RPC `convert_lead(p_org, p_lead, p_actor, p_identity jsonb)` — `security
  definer`, `search_path = ''`, `FOR UPDATE` on the lead, refuses an already-dispositioned lead
  with SQLSTATE **`LC010`**; one transaction creates the `drivers` row (`status='applicant'`,
  identity coalesced from the lead) and sets `disposition='converted'` +
  `converted_driver_id`. 0218 is the template, including the errcode-to-answer handling.
- Shared: `packages/shared/src/leadContract.ts` (Zod), `packages/shared/src/leadQueue.ts` —
  pure fold: per-lead latest contact, next planned callback (latest `callback_planned` with no
  later contact), callback list ordered by `due_on`, overdue derived from today. No stored
  status anywhere.
- API: `apps/api/src/routes/recruitment/leads.ts` + `apps/api/src/services/leads.ts` —
  list/create/update lead, log contact, disposition, convert. Roles:
  `rolesThatManage("recruitment")` write; recruitment view roles read.
- Web: `/recruitment/leads` — route record in the same commit — page with the callback-led
  queue, contact drawer, disposition (with note), convert action into the existing invite flow.

**Verify:** PGlite matrix `supabase/tests/recruiting-leads.test.mjs` (RLS deny-all, RC010 on
attempt to edit a contact, LC010 on double-convert, convert atomicity); unit tests for the
`leadQueue` fold incl. future-dated callbacks; `expectOrgScoped` on every service query;
`check-rls`, `lint:migrations`, full gate list.

**Done when:** a phone call can be recorded before any decision exists, the callback list orders
itself and goes red by itself, a dead lead is dispositioned without deleting anything, and a
converted lead's applicant carries its source.

### R2 · Pre-qualification

**Prerequisites:** R1. Org-policy minimums (experience, endorsements) come from Q-REC1;
until then only regulation floors run — the fallback that cannot be wrong.

**Build.** `prequalSchema` in `leadContract.ts` (DOB or age, CDL class/state/endorsements,
years of CMV experience, domicile, self-reported accidents/violations — a transcription of a
phone call, mutable, never evidence). Pure `packages/shared/src/prequalification.ts`: named
rules, each citing its floor (age ≥ 21 interstate, §391.11(b)(1); CDL held for CDL-required
work), verdict vocabulary `meets_floor | below_floor | incomplete` — worded as statements about
data, never "failed". Verdict renders on the lead row and drawer; nothing from pre-qual ever
enters a qualification file.

**Verify:** unit tests per rule incl. boundary ages; a test pinning that no prequal field
appears in any `qualification_records` write path.

**Done when:** a lead below a floor says so and why, an incomplete answer set says `incomplete`
rather than passing, and no pre-qual answer exists anywhere in DQF.

### R3 · MVR orders — demo environment first

**Prerequisites:** Samba credentials (Q-REC4 — demo credentials suffice for all of R3);
**ordering against production additionally needs Q-H3** (a real `fcra_disclosure` signature —
the gate refuses drafts) and DOBs. Neither blocks building or demo-verifying.

**Build.**
- Credentials: three sealed columns on `integration_credentials` (0012/0091 precedent) +
  `org_integrations` row `provider='sambasafety'` for environment/config. Token cache
  respecting `expires_in`.
- Migration: `mvr_orders` on the `psp_requests` (0216) template — `org_id`, `driver_id`,
  `samba_order_id`, `status` in (`pending`, `sent`, `fulfilled`, `failed`, `error`) derived
  **from the response body** at write time, `error_code` (B01–U02), `request_redacted jsonb`
  (DOB and licence blanked per `redactRequest`), `response_raw jsonb` whole,
  `unit_price_usd`, `billed boolean` stored (0216's argument: reconciliation reads what was
  true that day), `created_by`, timestamps. Partial unique index on `(org_id, driver_id)
  where status in ('pending','sent')` — `already_in_flight` enforced by the database, not
  just the service.
- Client `apps/api/src/mvr/client.ts` — scripted-`fetch` tests only, like `psp/client.ts`;
  auth, place order, poll order, fetch report twice (Accept: `+pdf` then `.json`).
- Pure validation `packages/shared/src/mvr/validate.ts` + `packages/shared/src/mvr/order.ts`:
  DOB present, name charset (no accents; suffix enum), state mapping (`subType`, `host`
  incl. the OVERNIGHT set), named-error guards for UT/CA/PA, `purpose: 'EMPLOYMENT'`,
  `customPersonId = drivers.id` (recon §9).
- Gates in `apps/api/src/services/mvrOrder.ts`, in the D-REC3 order: `MVR_ORDERS_ENABLED`
  (default off) → legality `missingAuthorizations(auths, 'mvr_order')` → budget
  `MVR_MONTHLY_LIMIT` counted from `billed` rows this calendar month → correctness (the
  validator above). Every refusal before the ledger row exists.
- Ingest on `fulfilled`: PDF → `documents`, JSON projection → `qualification_records` kind
  `mvr` with provenance a closed set (`samba_api`, `portal_import`, `unknown` — 0219's
  pattern, `coalesce(..., '')` in the CHECK). Widen the `qualification_records` kind CHECK
  only if `mvr` is absent from the current constraint — **read the constraint first**
  (0217's file shows the current set; verify at execution).
- Surfaces: order button + preflight on the driver's screening card (the PSP drawer is the
  model); screening-readiness page gains the MVR verdict **from the same validator the order
  path runs** (P0b's rule: a page with its own checklist eventually disagrees at billed cost).

**Verify:** matrix for `mvr_orders` (RLS, in-flight uniqueness); recorder tests: a scripted
HTTP-200 body error lands as `failed` with its code; refusal without a live `fcra_disclosure`;
`expectOrgScoped`; a full demo-environment round trip (order → poll → two report fetches →
document + record filed) via an extended `scripts/samba-recon.mjs`, run and its output quoted
in the PR.

**Done when:** a demo order round-trips to a filed PDF and a parsed record, a B01-style error
is a failed order not a success, ordering refuses without the signed instrument, and
`mvr_preemployment` reads `current` in a demo org's file.

### R4 · MVR delivery in the worker

**Prerequisites:** R3. The webhook half additionally needs the signature answer (Q-REC4);
fallback: receiver 202s, authenticates nothing, discards — the poller is the truth.

**Build.** Poll loop as a queue handler under `WORKER_ROLE` (consumer), fed by a scheduler
that must run in exactly one process fleet-wide — check `docs/WORKER-DEPLOYMENT.md` before
adding it, per the standing rule. Webhook receiver (when unblocked): authenticate via
`safeEqual` on the Basic credentials Samba sends, treat the payload as a wake-up only, fetch
the report through the authenticated API (§4's webhook rule). §391.25 monitoring enrolment is
**not** part of this step — a later step proposes it separately with D-PSP4's discipline
(a change notice notifies; a billed pull is an operator's decision).

**Verify:** handler unit tests with the recorder; a pending demo order fulfils with no human
refresh; scheduler registered per the deployment doc's checklist.

**Done when:** the demo org's pending orders complete unattended and the readiness page counts
them without a reload disagreeing with the ledger.

### R5 · Clearinghouse

**Prerequisites:** portal access to read FMCSA's current bulk-query template (execution reads
the template before writing the generator — its columns are FMCSA's to define, not ours to
assume). Running real queries needs Q-H3 (the `clearinghouse` instrument signed) and the
employer's query plan purchased in the portal (owner act, §6).

**Build.**
- Migration: `clearinghouse_queries` act ledger — `driver_id`, `kind` (`full_preemployment`,
  `limited_annual`), `requested_at`, `requested_by`, outcome columns on the
  `employer_inquiries` mutability split (what was asked is frozen; what came back is
  recordable): `outcome` (`awaiting_driver_consent`, `completed_no_record`,
  `completed_record_found`, `driver_refused`), `outcome_at`, `document_id` FK. Immutability
  trigger on the request columns, SQLSTATE **`CQ010`**. Evidence side: the filed result is a
  `documents` row + `qualification_records` kind `clearinghouse_full` /
  `clearinghouse_limited` (verify the kind CHECK contains them; widen next-numbered if not).
- Fold in `packages/shared/src/clearinghouseQueue.ts`: per-driver derived state, the annual
  due date from the newest `clearinghouse_limited` record, and the **24-hour escalation
  clock** the moment a limited query records `completed_record_found` (§382.701(b)(3)) —
  surfaced as the queue's most urgent row and a notification.
- `driver_refused` is a terminal answer with a consequence the fold states plainly:
  §382.703(c) — no safety-sensitive functions; for an applicant, the hire cannot proceed.
- Bulk generator: pure function, active CDL roster with a live §382.703(a) consent on file →
  the portal's template file, downloadable from the annual-queries surface.
- Surfaces: per-driver query card (request → consent-wait → file the result with the portal
  PDF); an annual round page listing who is due, who lacks consent, and the generated file.

**Verify:** matrix (RLS, CQ010); fold unit tests incl. the 24-hour clock and refusal;
`expectOrgScoped`; generator golden-file test against the template captured from the portal.

**Done when:** one driver can be carried through query → external-consent wait → filed result
without an act going unrecorded, a limited hit shows a 24-hour clock, and the annual round
produces one portal-ready file instead of 201 portal visits.

### R6 · Drug & alcohol, §382.301

**Prerequisites:** Q-REC2 (who the C/TPA, collection network and MRO are) decides only the
*integration* half; the recorded process below ships against any C/TPA via manual result
entry + document upload — the fallback that works today.

**Build.**
- Migration: `drug_screen_orders` act ledger — `driver_id`, `test_kind`
  (`preemployment` first; the vocabulary admits the Part 382 panel later), `ordered_at`,
  `ordered_by`, `collection_site_note`, outcome columns (`awaiting_collection`, `collected`,
  `verified_negative`, `verified_positive`, `refusal`, `cancelled`) with dates, immutable
  request columns (SQLSTATE **`DS010`**). The MRO's verified negative files the evidence:
  `documents` + `qualification_records` kind `drug_test` → `drug_test_preemployment`
  satisfied. A non-negative outcome files nothing into DQF by itself and routes to the
  §391.23(k)-style restricted read path (`canReadTestingRecords` — the recruiter is already
  excluded by 0211; keep it that way).
- The §382.301(b) exception as an explicit edge path: its own action that demands the
  §382.301(c) records (program identity, participation, last test dates, prior-employer
  results) as uploaded documents before it will mark the requirement satisfied, and says on
  the record that the exception was used.
- D-REC5's gate as pure logic: `packages/shared/src/orientationGates.ts` —
  `wheelTimeBlockers(records)` returns the named reasons (`no_verified_negative`,
  `no_clearinghouse_full`) that R8's scheduler will refuse on. Built here, enforced there.
- Vendor eCCF ordering (Quest/CRL-style) only if Q-REC2 reveals the C/TPA exposes it —
  a separate later sub-step, gated and ledgered like R3 if it ever exists.

**Verify:** matrix (RLS, DS010); unit tests: ordered ≠ satisfied, verified negative
satisfies, exception path refuses without its records, `wheelTimeBlockers` truth table;
`expectOrgScoped`.

**Done when:** the file distinguishes ordered from done, a verified negative turns
`drug_test_preemployment` current, the exception path cannot be taken silently, and
`wheelTimeBlockers` answers correctly for every combination.

### R7 · Training — refresh the plan that exists, then execute it

**Prerequisites:** none to start the refresh. Video content itself is the owner's (Q-REC1).

**Build.** `DRIVER-TRAINING-PLAN.md` is adopted, not rewritten — its decisions (provider
interface, immutable pinned versions, honest-effort rules, append-only events) survive contact
with today's tree. One refresh commit updates it in place before its Phase 0: renumber
migrations to next-numbered-at-execution language; move transcode/email onto the worker queue
(`apps/api/src/worker.ts` postdates the plan — ffmpeg belongs in the worker image); join the
compliance tables to `RETENTION_FORBIDDEN`; replace its invented link tokens with the
`application_invitations` hashed-single-use precedent (0220); applicants ARE assignable
(orientation content pre-hire; D-HIRE5's single driver id means completions simply persist
through H8 — no carry-over machinery); the certificate face carries the not-TPR/not-ELDT line
(D-REC6); role lists rechecked against the current matrix (`recruiter` and `recruitment`
postdate the plan). Then execute its Phase 0+1 (buckets, provider, schema) and Phase 2/3 as
that document specifies — in-app-only training is shippable before any link infrastructure.

**Verify:** the refreshed plan's own phase gates; every new table through §4's bar (matrix,
RLS, retention declaration).

**Done when:** the refresh commit lands, and Phases 0–1 ship exactly as the refreshed document
specifies.

### R8 · Orientation and the road test

**Prerequisites:** R6 (the gate logic), R7 Phase 3 if orientation content is video-delivered
(attendance-only orientation does not wait for it). Q-REC3 decides whether the equivalency
path is ever enabled; until answered it stays off (D-REC7).

**Build.**
- Migration: `orientation_sessions` (scheduled acts: `starts_at`, `location`, `capacity`,
  `created_by`) and `orientation_attendance` (`session_id`, `driver_id`, `attended`,
  `note`) — attendance append-only (SQLSTATE **`OA010`**); a scheduling change is a new
  session row with the old one cancelled by a recorded act, not an edit.
- Booking wheel-time refuses on `wheelTimeBlockers` (R6) with the blocker named to the user.
- Acknowledgements on the instrument pattern: versioned wording, D-HIRE4's signature
  evidence, one document per instrument (handbook, policies) — the `DISCLOSURES` machinery
  generalised, drafts refused the same way.
- Road test: the §391.31(c) eight-item checklist as the form; examiner identity; on pass, the
  §391.31(e) certificate (pdfkit, already in the repo) filed as `documents` +
  `qualification_records` kind `road_test`. The `cdl_equivalency` write path exists but is
  disabled until Q-REC3 (and when enabled, refuses for tank/doubles assignments —
  §391.33(a)(1)).
- Fold: orientation state per driver derives from sessions + attendance + records — no
  status column.

**Verify:** matrix (RLS, OA010); gate refusal tests (no wheel-time before the negative and
full query); certificate golden test; equivalency-disabled pin.

**Done when:** an orientation day is schedulable and auditable, wheel-time cannot be booked
ahead of D-REC5's evidence, and a tank-vehicle driver cannot be road-test-complete by
equivalency.

### R9 · The recruiter board

**Prerequisites:** ships last by H6's rule — every stage it shows must be derivable, and only
after R1–R8 are they all. Each of R3, R5, R6, R8 extends `applicantPipeline`'s requirement
list **in its own PR** (the extension point H5/H7 promised and never used); R9 is the surface
over the accumulated fold.

**Build.** `packages/shared/src/recruitingBoard.ts`: one pure fold over leads, contacts,
applicants, authorizations, applications, inquiries, MVR/PSP ledgers, Clearinghouse and drug
ledgers, sessions and records → per-person **next action** (call back Thursday, send the
application, chase the release, order the MVR, book orientation, hire) with its blocking
reason when blocked. `/recruitment` grows into that board; the existing four-stage view
remains as the applicant slice of it.

**Verify:** fold unit tests per next-action rule; a pin that the board's verdicts are computed
by the same functions the acting surfaces use (P0b's rule, fleet-wide).

**Done when:** a recruiter starts the day on one page, every row says the next action and why,
and nothing on it can disagree with the files it summarises.

E6 and E7 (`EMPLOYER-INQUIRY-PLAN.md`) stay sanctioned at any point; they belong to that plan.

---

## 6. Prerequisites register — every unknown, its owner, and the fallback the code takes

Nothing in §5 assumes an answer here. Each entry names what is blocked and what the code does
until the answer arrives. Strike entries through in place as they resolve, with the answer and
date.

- **Q-REC1 · The process today** (owner): sources and volume of calls, who screens, what an
  orientation day looks like, policy minimums for R2, training content inventory for R7.
  *Fallback:* R1 ships the starter source set; R2 runs regulation floors only.
- **Q-REC2 · The testing program** (owner): who is the C/TPA/consortium, the collection
  network, the MRO; do they expose electronic ordering or results?
  *Fallback:* R6 ships the recorded process with manual result entry; no vendor integration.
- **Q-REC3 · Equipment** (owner): does Silvicom haul tank vehicles or doubles?
  *Fallback:* the §391.33 equivalency path stays disabled; everyone gets a real road test
  (D-REC7 — cannot be wrong, only stricter than necessary).
- **Q-REC4 · SambaSafety account** (owner + Samba rep): demo and production credentials, which
  MVR products the contract carries, monitoring price, webhook signature scheme, rate limits,
  whether a no-hit bills. *Fallback:* R3 builds and verifies against demo only; R4's webhook
  half stays a 202-and-discard; the poller is the truth.
- **Q-REC5 · Counsel:** is a pre-hire §391.31 road test "performing a safety-sensitive
  function" under §382.107/§382.301(a)? *Fallback (permanent until answered):* assume yes —
  D-REC5's ordering holds; a "no" only relaxes scheduling.
- **Q-REC6 · Pre-hire training** (owner + counsel): may applicants be assigned orientation
  content, and does any of it count as compensable time the carrier must track?
  *Fallback:* R7 makes applicants technically assignable; no assignment is auto-created
  pre-hire until answered.
- **Q-REC7 · Lead retention** (owner): how long does a dispositioned lead's PII live?
  *Fallback:* no retention rule prunes leads until a window is chosen; D-REC2 keeps them
  prunable-by-design so the choice is one rule, not a schema change.
- **Standing blockers, unchanged and still the real ones:** **Q-H3** (counsel wording for all
  five instruments — gates every signature, therefore every PSP/MVR order and §40.25 letter),
  the **DOB CSV** (blocks PSP and MVR alike; the import page is live at
  `/recruitment/screening`), **Q2** (confirm `PSP_UNIT_PRICE_USD`), the **UAT PSP token**
  (PSP support provisioning), **Q-PEI1/Q-PEI3** (counsel/product, own plan), and the
  **Clearinghouse query plan** purchase in FMCSA's portal (owner act; C/TPAs cannot buy it —
  verified on FMCSA's pages).
