# The recruiting system — from the phone call to a driver in a truck · 2026-08-20

The owner's framing, verbatim: *"From Recruiter receives call → create applicant profile → finish
all checking (PSP, MVR, Drug testing, Training system with videos, Orientations and hiring)."*

This is an **execution document**: decisions are made, not surveyed; every step in §5 carries its
prerequisites, its build, its verification and its done-when; §4 is the protocol that lets any
session — including a fresh one with no memory of this conversation — pick up the next step
without re-deriving anything. Unknowns are not assumed anywhere: each lives in §6 with a named
owner and a fallback the code takes until the answer arrives.

**Revised 2026-08-20** after a three-track adversarial audit (claim-by-claim against the tree,
backend rules, frontend design system). Every correction from that audit is folded in below; the
notable ones are marked ⚠ where a fresh session might otherwise repeat the original mistake.

**Re-verified 2026-08-21** (claims vs the tree at `75020bf`; regulatory claims vs
psp.fmcsa.dot.gov / clearinghouse.fmcsa.dot.gov / ecfr.gov primary sources). Confirmed: nothing
beyond R0b has shipped; D-REC4's no-employer-API claim is FMCSA's own words; the kind CHECKs need
no widening. Corrections folded in below: the PSP instrument's text is FMCSA-mandated (see
`APPLICATION-SYSTEM-PLAN.md` A0), state MVR consent forms and the CA EPN program (§3, R3), the
Clearinghouse 2024–2026 facts and the general-consent collection point (§3, R5, R8), and one
surviving local tone record (§4).

Sources, so nothing here rests on recall: regulation text read on Cornell LII 2026-08-20; the tree
at `efbebd4` (schema `0224`); `docs/vendor/sambasafety-postman-collection.json` (the collection IS
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

⚠ **The stage vocabulary does not grow.** `APPLICANT_REQUIREMENTS`
(`packages/shared/src/applicantPipeline.ts`) is the extension point and each of R3/R5/R6/R8 adds
its requirement there (plus `APPLICANT_REQUIREMENT_LABELS`, a total record) — but `ApplicantStage`
stays at its four members. `applicantProgress` derives the stage from employment coverage and
releases alone; new requirements appear on the **chase list** and as **board next-actions** (R9),
never as new stages. `ready_to_screen` with an outstanding MVR is a correct sentence: ready to
screen, not yet screened. Extending the stage union instead would couple every step's PR to the
web filter bar — exactly the coupling the one-step-one-PR rule exists to prevent.

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
never deleted** — by people. Deliberately: lead tables do NOT join `RETENTION_FORBIDDEN`, and
their append-only guards use **0213's trigger style (`auth_role() is null` passes)**, not the
EI010 family that fires for the service role too — so the day §6's Q-REC7 sets a window, a
retention rule can actually prune lead PII (contacts FK `on delete cascade` from their lead).
Append-only against every human path; prunable by the one audited service-role act. ⚠ The EI010
style here would have made the "prunable" promise structurally false.

**D-REC3 — a vendor interaction is a ledger with gates, in the PSP shape.** `checkPspGates`
(`apps/api/src/services/pspOrder.ts`, declared at `:162`) ordered its refusals deliberately:
enabled-flag, configured, **legality** (the signed instrument), **authority** (the step-up
re-authentication — it spends money and pulls a person's record), **budget**, **correctness** —
each refusing *before* the ledger row exists. MVR orders copy that shape wholesale, all six gates.
Two Samba-specific rules join the template: **status comes from the response body, never the HTTP
code** (Samba returns application errors as HTTP 200, codes B01–U02), and the raw report is stored
whole with a thin parsed projection (D-PSP2: a wrong projection is re-derivable without
re-buying). And 0216's two hard-won ledger features come along ⚠: an **`idempotency_key`** with a
unique index (a replayed request must dedupe, not double-bill) and the status **`indeterminate`**
(a network failure after dispatch leaves us not knowing whether we were charged — 0216's header
argues this is the one status a billed vendor call genuinely needs).

**D-REC4 — the Clearinghouse is a portal workflow we record, not an API we call.** Verified
2026-08-20 on FMCSA's own pages: there is **no employer API** and no integration spec; vendors that
"integrate" are designated C/TPAs driving the portal and its bulk file upload. Two consents exist
and are not interchangeable: the §382.703(a) *general* consent (written, ours to collect — the
`clearinghouse` instrument) supports **limited** queries only; the **full** query's consent is
electronic, *inside the Clearinghouse*, by a driver registered there — external state we cannot
poll. The product records the acts and automates the one automatable thing: the bulk-upload file
for the annual §382.701(b) limited round.

⚠ **And its results are testing records.** `clearinghouse_full` / `clearinghouse_limited` are
members of `TESTING_RECORD_KINDS` (`packages/shared/src/auth.ts:184–189`), readable only by
`canReadTestingRecords` = admin + safety_manager (0211 — the recruiter AND the fleet_manager are
excluded). So the Clearinghouse workflow is a **safety_manager/admin workflow**, not a recruiter
one: requesting, filing and reading all gate on `canReadTestingRecords` (0217's lesson — nobody
may buy what they cannot read — applied in the other direction). The ledger's own outcome
vocabulary carries **no testing facts**: `awaiting_driver_consent | completed | driver_refused |
cancelled` — whether a record was *found* lives only in the filed `qualification_records` row,
behind the kind-based policies. Everyone else (the recruiter, the board) sees step-state only:
query pending / query done / driver refused.

**D-REC5 — the verified negative is the evidence, and it precedes the wheel.** §382.301(a): the
employer must have *received* the MRO's verified negative before the driver first performs a
safety-sensitive function. Driving a CMV is safety-sensitive; the §391.31 road test is driving a
CMV; so scheduling inherits a hard edge — collection early, wheel-time only after the verified
negative **and** the §382.701(a) full-query result are filed. The §382.301(b) prior-program
exception is modelled as an explicit edge path with its §382.301(c) records, never the primary
flow. Q-REC5 flags the road-test reading to counsel; the default is the reading that cannot be
wrong. The same visibility line as D-REC4 applies: the *state* of the requirement (satisfied /
outstanding) is visible to every file reader — that is the binder's existing rule, "checklist
state is computed from everything" while row contents stay restricted — but a non-negative
outcome is content, and only `canReadTestingRecords` roles ever see it.

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
  `api.sambasafety.io`. ⚠ Secrets get a **dedicated `samba_credentials` table** — 0091's stated
  precedent is "one dedicated table per outbound integration provider", and `integration
  _credentials` (0012) has `org_id` as a bare primary key with `provider default 'samsara'`, so
  Samba columns cannot live beside the Samsara row. Values are stored as secretBox envelopes on
  the `samsaraToken.ts` pattern (envelope-in-column, AAD bound to org + purpose, legacy-plaintext
  detection). Non-secret config (environment, group id) goes in `org_integrations` (0068) under
  `provider = 'sambasafety'`.
- Samba is async: poll `GET /transactional/v1/mvrorders/:orderId`, or webhooks whose
  **signature scheme is undocumented** (recon §3, still open — and recon §3's rule is binding ⚠:
  "a receiver that cannot verify is a receiver that must not accept", so the unverifiable
  receiver **rejects with 401**, never 202-and-discards). Reports are content-negotiated:
  **PDF for `documents`, JSON for the projection — two fetches, one order.** `OVERNIGHT` states
  HI/MO/CA; `stateAccessCode` for CA/PA and `customerOrgId` for UT per the collection — ⚠ which
  contradicts itself on whether UT needs an access code, so all three states are guarded with
  named errors (the fleet has no drivers there) and the collection is re-read at execution.
- **The `qualification_records` and `documents` kind CHECKs already contain every kind this plan
  files** ⚠: 0217 lists `mvr`, `road_test`, `cdl_equivalency`, `clearinghouse_full`,
  `clearinghouse_limited`, `drug_test` (and more). **No widening migration exists anywhere in
  this plan** — a session that ships one is re-dropping a production constraint for nothing.
- Provenance CHECKs admit only real sources (`samba_api`, `portal_import`) with
  `coalesce(..., '')` ⚠ — `unknown` is the *reader's* fallback (0219's `pspRecordSource`), never
  an accepted written value; a row that does not say where it came from is refused, which is
  0219's whole argument.
- `SCREENING_PREREQUISITES` (`packages/shared/src/authorizationContract.ts:229–234`) already maps
  `mvr_order → [fcra_disclosure]` and `clearinghouse_full → [clearinghouse]`. The legality gates
  are specified; only the wording (Q-H3) is missing.
- The Clearinghouse full-query consent cannot be collected on our paper (§382.703(b),(d)).
  **§382.701(b)(3): a limited-query hit escalates to a full query within 24 hours** or the driver
  comes off safety-sensitive functions.
- Interstate minimum age is 21 — §391.11(b)(1).
- Silvicom runs 201 active CDL drivers, so a Part 382 program (C/TPA or consortium, collection
  sites, MRO) **already exists somewhere**; R6 integrates with it rather than inventing one.
- `mvr` is deliberately **not** a restricted kind (it is FCRA-gated at order time, not
  §382.401-gated at read time), so MVR records print in default binders — consistent with 0211's
  split; stated here so nobody "fixes" it.
- **MVR consent is federal-form-free but not state-form-free** (verified 2026-08-21). No FMCSA form
  exists for the §391.23(a)(1) inquiry — the FCRA §604(b)(2) standalone disclosure (the
  `fcra_disclosure` instrument) plus DPPA permissible use is the federal whole of it, and §391.25's
  annual pull needs no driver consent at all (§391.27's driver violation list was abolished
  2022-05-09; nobody rebuilds it). But **PA (DL-503), WA, NH and PR require their own signed
  release**, and **California is a program, not a form**: the Employer Pull Notice program is
  mandatory for employers of CA-licensed CDL drivers (CVC §1808.1), electronic-only from
  2026-04-01. R3 carries "state form required" as data keyed on licensing state, beside the
  access-code guards it already has.
- **A pre-employment Clearinghouse query satisfies §391.23(e)/§40.25 for FMCSA-regulated previous
  employers since 2023-01-06** — the manual drug-and-alcohol-history inquiry survives only for
  prior employers regulated by another DOT mode (FAA/FRA/FTA/PHMSA/USCG). The §391.23(d) general
  safety-performance investigation is untouched. Recorded here so `EMPLOYER-INQUIRY-PLAN.md`
  sessions (E6/E7) scope accordingly.
- **Clearinghouse operational facts, 2024–2026** (verified 2026-08-21 on FMCSA's pages):
  Clearinghouse-II is in effect since 2024-11-18 — a prohibited driver now loses the CDL itself at
  the State, so MVR monitoring will surface downgrades (a signal, never a substitute for queries).
  Query plans are $1.25 flat, purchasable **only by the employer** (a C/TPA cannot — already §6);
  query records carry their own 3-year retention. The "30-day full-query consent expiry" that
  vendors quote has **no primary source** — `awaiting_driver_consent` stays an open state with no
  invented deadline. From **2026-04-27** Clearinghouse registration requires IDEMIA identity
  verification, and FMCSA's new **Motus** portal rolls out through 2026 and may re-skin the screens
  R5 documents.
- Office-facing alerting is **email via `lib/mailer.ts` plus the notification ledger** — the
  `dqAlertScheduler` pattern; `notify()` reaches the driver app only, and `NotificationCategory`
  is a closed enum that must be extended (with a `notificationRoute` entry web-side) for every
  new alert kind.

---

## 4. Execution protocol — read this before executing anything, every session

**Resume ritual (a fresh chat starts here):**

1. Read this document top to bottom. Then `HANDOFF-2026-08-19.md` §4 and `HANDOFF-2026-08-20.md`
   §4 — the harness facts and the mistakes that already cost a day each. Then the `CLAUDE.md` of
   every package the step touches (root, `apps/web`, `apps/api` if present, `supabase`).
2. Establish reality, never assume it: `git log --oneline -15`, `pnpm verify:live` (and
   `gh run list --workflow=migrate.yml` before believing a schema mismatch — deploy and migrate
   finish at different times; and remember 2026-08-20's lesson that a Railway platform incident
   can hold main's deploys in a queue for hours while CI stays green).
3. Find the first §5 step not marked **DONE**. Check its prerequisites against §6. A missing
   prerequisite means *run the fallback written next to it* — it never means guess.
4. One step (or named sub-step) per branch (`claude/<topic>`), PR to `main`, merge after CI —
   `main` is branch-protected (required check `build`, admins included), so there is no other
   path.
5. When a step ships, mark it **— DONE <date> (migrations NNNN–NNNN)** in place, with a "What
   shipped" list and "Verified by:" naming the gates run — the register `HIRING-PLAN.md` uses.
   When a §6 question is answered, strike it through in place with the answer and date. **This
   document is the memory between sessions; the chat is not.**

**Backend rules (each machine-enforced or test-asserted; gate names verified ⚠ —
`lint:rls`, `lint:migrations`, `lint:comment-claims`, `lint:filesize`, `lint:funcsize`,
`lint:boundaries`, `lint:ui-adoption`, root `lint:tokens-parity`, and the web-package
`pnpm --filter web lint:tokens`):**

- Migration numbers are **never pinned in advance** — next-numbered at execution. (Convention,
  not a gate ⚠: `lint:migrations` only catches duplicates and malformed names. The training
  plan's pinned numbers went stale by 145 within a month; that is the argument.)
- Every new table: `org_id` (nothing scopes without it), `enable row level security`
  (`lint:rls`). No client policies means deny-all, API-only — the default here; a client policy
  is added only with a §391.23(k)(2)-style argument written above it.
- Every service query org-filters itself and a test asserts it via `supabaseRecorder`'s
  `expectOrgScoped` (the service role bypasses RLS).
- Append-only tables pick their trigger style **deliberately** ⚠: the EI010/DA010 family fires
  for the service role too (evidence — nothing may rewrite it, ever); 0213's style exempts
  `auth_role() is null` (operational tables retention must be able to prune). Each table's header
  states which and why, on 0208's model, and declares its side of the evidence line
  (`RETENTION_FORBIDDEN` in `dataRetention.ts`, or prunable-and-why). Named five-character
  SQLSTATEs, mapped by the API to answers, not 500s — the recorder can script RPC failures to
  prove it.
- Every new table gets a PGlite matrix in `supabase/tests/*.test.mjs` printing a `RESULT` line,
  with the default-privileges block from `restricted-records.test.mjs` before the migration loop
  and `role` inside the claims JSON.
- Anything that spends money ships behind an env flag **default off**, with a monthly ceiling
  counted from the ledger's `billed` rows, unit price recorded per row, an idempotency key, and
  an `indeterminate` status for the dispatched-but-unconfirmed case (0216/0219).
- Vendor payloads at rest are redacted of DOB and licence numbers (`redactRequest` in
  `pspOrder.ts`); raw *responses* are stored whole; PII never reaches logs or `meta`.
- Webhooks are wake-up signals, never sources of truth: authenticate (constant-time via
  `safeEqual` — API-local, `apps/api/src/lib/secretBox.ts`), then fetch the referenced resource
  through the authenticated API. An unverifiable receiver **rejects**; it never accepts quietly.
- Background work: a new job kind joins the closed `JobKind` union (`services/jobs.ts`), registers
  in `services/queue/handlers/index.ts`, and — if it calls a vendor — gets a `KIND_CAPS` entry in
  `worker.ts` (cap 1 until the vendor's rate limits are known). Schedulers run in exactly one
  process fleet-wide — `docs/WORKER-DEPLOYMENT.md` before adding one.
- Acts a person takes write audit entries whose `entityId` is a **row UUID** (non-UUIDs land as
  null — `auditEntityId.test.ts`), with H8's honesty: `filed`, `skipped` AND `outstanding`.
  Security-definer RPCs write their own audit row from `p_actor` (the JWT-based table triggers
  see null through the service role).
- Restricted content is restricted at the **projection**, not just the row policy ⚠: any ledger
  or list surface whose rows imply testing outcomes collapses them for roles failing
  `canReadTestingRecords` (step-state only). RLS protects the table; the API answer is what a
  recruiter actually sees.
- Gates before any PR: `pnpm test`, `pnpm typecheck`, `pnpm lint`, plus the step's named extras.
  Comments claiming coverage quote a real test title (`lint:comment-claims`). File and function
  budgets hold — and a route file with six verbs starts split (`routes/<area>/` + service) rather
  than budget-diving at 500 lines.

**Frontend rules (the other half of the P0b lesson — most of these are NOT machine-enforced ⚠):**

- ⚠ **The gates outrank the contract.** `docs/DESIGN-SYSTEM-CONTRACT.md` has drifted:
  `ui-system-inventory.mjs` now *fails* local `Base*` primitive clones (import `App*` from
  `@fuelguard/ui`), bans `text-ink-subtle` outright, and `check-design-tokens.mjs` bans generic
  shadows (`shadow-card/overlay/dialog` only), `*-neutral-*` ring/border utilities, and any
  colour role not defined in `tokens.css`. Until R0b lands, read the two gate scripts before
  writing UI, and trust them over the contract.
- A new routed page ships **in one commit** with: the route record, `meta.title` (the page's h1 —
  AppShell renders it), `parent` for sub-pages (the back chevron), and **an entry point** — a nav
  entry (`lib/nav.ts`, gated `canViewSection(role, "recruitment")`) or an in-product button.
  A route reachable by no link is the P0b incident again.
- Recruitment routes carry `requiresAuth` **only** — never `requiresManage`, which is
  `canManageFleet` (admin + fleet_manager) and bounces the recruiter to the dashboard. Pages
  self-gate actions via `rolesThatManage("recruitment")`; testing-restricted surfaces gate via
  `canReadTestingRecords`.
- Every new state vocabulary ships as a pair: the machine tokens in shared **plus** an exported
  label map beside them (the `INQUIRY_STATE_LABELS` pattern), and tones added in `lib/badges.ts`
  **only** — no `.vue` file carries a status literal or a local tone `Record` (R0b removed
  `InquiryQueuePage.vue`'s instance; the last survivor, `ApplicationInviteCard.vue`'s `STATE_TONE`,
  went with A1 on 2026-08-21 — it is `applicationInviteBadge` in `lib/badges.ts` now. There is no
  known instance left; a new one is a regression, not a precedent).
- List pages over the roster (leads, annual round, the board): `FilterBar` with search and a
  domain-noun count, `TablePagination` in the table footer, and empty-state copy in the house
  voice (fact, then next action). 201 rows with a lone filter select is not a list page.
- Any new notification kind extends `NotificationCategory` **and** adds a `notificationRoute`
  entry web-side in the same PR — an alert that cannot deep-link to its queue is half an alert.
- Documents: human uploads use the existing storage path from the web
  (`useEmployerInquiries`/`usePspImport` precedent); vendor-fetched files (R3's PDFs) are filed
  API-side. Both end as `documents` rows — a filed id that points at nothing is not a filed
  document.

---

## 5. Steps — each stands alone; execute in order unless its prerequisites say otherwise

### R0 · The owner interview — no code

The highest-value research is not in a regulation. Put the §6 register (Q-REC1–Q-REC7, plus the
standing blockers Q-H3, the DOB CSV, Q2/PSP price, the UAT token status) in front of the owner as
one list and record the answers in §6, struck through in place.
**Done when:** every Q-REC entry in §6 is either answered in place or explicitly deferred by the
owner, and the standing blockers have a current status line each.

### R0b · Reconcile the design system's paper with its gates — DONE 2026-08-20 (no migrations)

The canonical contract and the live gates disagreed (§4's ⚠). **What shipped:**
- `docs/DESIGN-SYSTEM-CONTRACT.md` reconciled with the gates: the primitive inventory moved to
  `@fuelguard/ui` (§1.1, with the old→new name map; the previous "import `Base*` locally" rule is
  marked superseded in place), the token linter's six rules listed (§4.1), `text-ink-subtle` →
  `ink-tertiary`/`ink-disabled` (§4.2), badge anatomy `rounded-detail` with no case transform
  (§2.4/§4.3), shape-role radii and named elevations (§3.4/§3.5), and every prescriptive class
  string re-verified against the current source.
- **Decision recorded (§5.2b):** new list pages compose `DataWorkspace` → `FilterBar embedded` →
  `DataTable embedded`; existing standalone-cards pages are left alone. `DriversPage` is the
  reference.
- `InquiryQueuePage` and `ScreeningReadinessPage` rebuilt on that shell — which also removed a
  third, unflagged defect: both wrapped a non-embedded `DataTable` in an outer `BaseCard`, drawing
  a card inside a card. Both gained search, a domain-noun count, and `TablePagination`; the local
  `STATE_TONE` record moved to `lib/badges.ts` as `inquiryStateTone`.
- `BADGE_BASE` dropped `capitalize` (it title-cased sentence-case labels); twelve raw-token call
  sites pinned it locally as visible markers of unmapped vocabularies, and four lowercase literals
  became proper labels ("Still held", "Superseded", "Fired", "Co-driver"/"Driver").
- Corrected in this plan: `AppRadioGroup` exists in `@fuelguard/ui` (R7's audit claim was stale).

**Verified by:** `vue-tsc`, 360 web tests, `lint:ui-adoption`, `pnpm --filter web lint:tokens`,
eslint — all green.

### R0c · The surfaces — its own plan (`RECRUITING-UI-SURFACE-PLAN.md`, 2026-08-21)

**Prerequisites:** none. ⚠ **U1 of that plan precedes R1**, on one ground: R1's payoff is a lead
becoming an applicant, and the act that turns somebody into an applicant is not offered anywhere in
recruitment today.

R0b reconciled the design system's *paper* with its *gates*. This is the other half of the same
lesson: the gates measure colour and control provenance, never composition or reachability — so
A0–A11b shipped regulation-correct into surfaces that pass every check and do not compose.
Measured 2026-08-21 with both gates green:
[`RECRUITING-UI-SURFACE-PLAN.md`](./RECRUITING-UI-SURFACE-PLAN.md). Its decisions are `D-UI1`–`D-UI8`;
its execution protocol is §4 of this document, unchanged; it ships no migration and no API change.

⚠ **Its D-UI1 is this document's own §4 frontend rule, already written and already broken:** *"a new
routed page ships in one commit with … an entry point … a route reachable by no link is the P0b
incident again."* `ApplicationInviteCard` mounts in exactly one place — inside the **Employment** tab
of a driver's detail page — so an applicant must be hand-created as a driver row before anyone can be
invited to apply, and `/recruitment` offers no way to start one. `/recruitment/screening` and
`/recruitment/inquiries` carry no nav entry at all.

⚠ **It does not pre-empt R9** (D-UI8): the nav label "Applicants" is R9's word to change, and every
surface it builds composes shared components so the board re-arranges them rather than replacing them.

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
  iff `converted_driver_id is not null`. Header declares it **operational, not evidence** —
  mutable transcription on 0208's argument, prunable once Q-REC7 sets a window, deliberately NOT
  in `RETENTION_FORBIDDEN` (D-REC2).
- Same migration: `recruiting_contacts` — append-only act log: `org_id`, `lead_id` FK **`on
  delete cascade`**, `kind` in (`call`, `sms`, `email`, `in_person`, `note`,
  `callback_planned`), `occurred_at` default now, `due_on date` (CHECK: present iff
  `kind = 'callback_planned'`), `note`, `created_by`. BEFORE UPDATE/DELETE trigger in **0213's
  style** (`auth_role() is null` passes — D-REC2's prunability depends on it), SQLSTATE
  **`RC010`**.
- Same migration: RPC `convert_lead(p_org, p_lead, p_actor, p_identity jsonb)` — `security
  definer`, `search_path = ''`, `FOR UPDATE` on the lead, refuses an already-dispositioned lead
  with SQLSTATE **`LC010`**; one transaction creates the `drivers` row (`status='applicant'`,
  identity coalesced from the lead), sets `disposition='converted'` + `converted_driver_id`,
  **and writes its own audit row from `p_actor`** (0218 is the template — the JWT-based
  `audit_drivers` trigger sees null through the service role).
- Shared: `packages/shared/src/leadContract.ts` (Zod, including the label maps for source and
  disposition) + `packages/shared/src/leadQueue.ts` — pure fold: per-lead latest contact, next
  planned callback (latest `callback_planned` with no later contact), callback list ordered by
  `due_on`, overdue derived from today. No stored status anywhere.
- API: `apps/api/src/routes/recruitment/leads.ts` + `apps/api/src/services/leads.ts` (split from
  day one — six verbs). Roles: `rolesThatManage("recruitment")` write; recruitment view roles
  read.
- Web: `/recruitment/leads` — in one commit: route record with `meta.title` and
  `parent: "/recruitment"`, a **nav entry** in `lib/nav.ts` (the leads queue is a
  start-of-day surface; `NavItem.badge` may carry the overdue-callback count), tones in
  `lib/badges.ts`. Page: `FilterBar` (search + count) → `DataTable` + `TablePagination`,
  contact `SlideOver` with `#footer` actions, disposition with note, convert action into the
  existing invite flow. Route meta is `requiresAuth` only (§4's recruiter trap).

**Verify:** PGlite matrix `supabase/tests/recruiting-leads.test.mjs` (RLS deny-all, RC010 for a
client/API update, service-role DELETE succeeds and cascades — the prunability pin, LC010 on
double-convert, convert atomicity); unit tests for the `leadQueue` fold incl. future-dated
callbacks; `expectOrgScoped` on every service query; `lint:rls`, full gate list.
**Done when:** a phone call can be recorded before any decision exists, the callback list orders
itself and goes red by itself, a dead lead is dispositioned without deleting anything, a
retention prune (exercised in the matrix, not production) actually removes contact PII, and a
converted lead's applicant carries its source.

### R2 · Pre-qualification

**Prerequisites:** R1. Org-policy minimums come from Q-REC1; until then only regulation floors
run — the fallback that cannot be wrong.

**Build.** `prequalSchema` in `leadContract.ts` (DOB or age, CDL class/state/endorsements,
years of CMV experience, domicile, self-reported accidents/violations — a transcription of a
phone call, mutable, never evidence). Pure `packages/shared/src/prequalification.ts`: named
rules, each citing its floor (age ≥ 21 interstate, §391.11(b)(1); CDL held for CDL-required
work), verdict tokens `meets_floor | below_floor | incomplete` **with their exported label map**
— statements about data, never "failed". Verdict renders on the lead row and drawer via
`lib/badges.ts` tones; nothing from pre-qual enters a qualification file.
**Verify:** unit tests per rule incl. boundary ages; a test pinning that no prequal field
appears in any `qualification_records` write path.
**Done when:** a lead below a floor says so and why, an incomplete answer set says `incomplete`
rather than passing, and no pre-qual answer exists anywhere in DQF.

### R2b · The application system — its own plan (`APPLICATION-SYSTEM-PLAN.md`, 2026-08-21)

**Prerequisites:** R2 for prefill (D-APP14); nothing else. Runs in parallel with R3 onward.

H5a/H5b shipped the application's *middle*: a hashed single-use link, a session-free page, one
schema both sides, an immutable certified submission, and a per-instrument signing endpoint that has
never had a caller. What the owner asked for on 2026-08-21 — automated delivery, a resumable
mobile form, a DocuSign-shaped signing ceremony, document photography from the same link, and the
whole thing landing in DQF — is **A0–A11** in
[`APPLICATION-SYSTEM-PLAN.md`](./APPLICATION-SYSTEM-PLAN.md). Its decisions are `D-APP1`–`D-APP15`;
its execution protocol is §4 of this document, unchanged.

⚠ **It opened with a live defect, and A1 closed it (2026-08-21, migration 0225).**
`resolveInvitation` killed the token on `used_at`, which `submit_driver_application` stamps — and
`POST /:token/release` resolves through the same function — so the signing `ApplyPage.vue` promised
the driver after submission was unreachable through the link that promised it. The invitation is now
a session with three phase stamps (D-APP1): revocation and expiry kill all of it, and each write path
refuses only its own spent phase. ~~**A2 is the next step**~~ — ⚠ **A0–A11b are ALL DONE as of 2026-08-21 (schema 0233), live and
verified.** See that plan's §5 register for what each step shipped and the six places its own text
was corrected against primary sources rather than followed. What remains of the application system is
not code: **A0** (counsel's review of wording the carrier already drafted, which arms three gates with
no deploy), 10DLC registration, and one production `update organizations set legal_address = …`.

### R3 · MVR orders — demo environment first

**Prerequisites:** Samba credentials (Q-REC4 — demo credentials suffice for all of R3);
**ordering against production additionally needs Q-H3** (a real `fcra_disclosure` signature —
the gate refuses drafts) and DOBs. Neither blocks building or demo-verifying.

**Build.**
- Credentials: dedicated `samba_credentials` table (0091's one-table-per-provider precedent;
  RLS on, zero policies), values sealed as secretBox envelopes on the `samsaraToken.ts`
  pattern; environment/config in `org_integrations` under `provider='sambasafety'`. Token cache
  respecting `expires_in`.
- Migration: `mvr_orders` on the `psp_requests` (0216) template **in full** ⚠ — `org_id`,
  `driver_id`, `samba_order_id`, **`idempotency_key` with its unique index**, `status` in
  (`pending`, `sent`, `fulfilled`, `failed`, `error`, **`indeterminate`**) derived **from the
  response body** at write time, `error_code` (B01–U02), `request_redacted jsonb` (DOB and
  licence blanked per `redactRequest`; ⚠ 0216's own column is named `request_body` — this table
  picks the better name, so don't grep 0216 for it), `response_raw jsonb` whole, `unit_price_usd` (env
  `MVR_UNIT_PRICE_USD`, optional, no invented default — 0219's stance), `billed boolean`
  stored, `created_by`, timestamps. Partial unique index on `(org_id, driver_id) where status
  in ('pending','sent')`.
- Client `apps/api/src/mvr/client.ts` — scripted-`fetch` tests only, like `psp/client.ts`;
  auth, place order, poll order, fetch report twice (Accept: `+pdf` then `.json`).
- Pure validation `packages/shared/src/mvr/validate.ts` + `packages/shared/src/mvr/order.ts`:
  DOB present, name charset (no accents; suffix enum), state mapping (`subType`, `host` incl.
  the OVERNIGHT set), named-error guards for **UT, CA and PA alike** (§3's ⚠ — the collection
  contradicts itself on UT; re-read it at execution), `purpose: 'EMPLOYMENT'`,
  `customPersonId = drivers.id` (recon §9) — plus a `stateFormRequired` lookup (PA `DL-503`, WA,
  NH, PR; CA additionally needs EPN program enrolment — §3's state-form fact) surfaced in the
  order preflight, so a missing state form is a named refusal at the desk, not a discovery at the
  DMV.
- Gates in `apps/api/src/services/mvrOrder.ts`, **all six in D-REC3's order** ⚠:
  `MVR_ORDERS_ENABLED` (default off, env.ts's PSP flag shape) → configured → legality
  `missingAuthorizations(auths, 'mvr_order')` → **authority (step-up re-auth — the PSP gate's
  reasoning applies verbatim)** → budget `MVR_MONTHLY_LIMIT` from `billed` rows this calendar
  month → correctness. Every refusal before the ledger row exists.
- Ingest on `fulfilled`: PDF → `documents` (API-side), JSON projection → `qualification_records`
  kind `mvr` with provenance CHECK admitting `('samba_api','portal_import')` via
  `coalesce(..., '')` — **no `unknown` in the CHECK, no kind-CHECK widening** (§3's ⚠s).
- Surfaces: order button + preflight on the driver's screening card (the PSP drawer is the
  model; extend `applicantPipeline`'s requirement list + labels in this PR); the
  screening-readiness page gains the MVR verdict **from the same validator the order path
  runs**; MVR records render in the driver detail's employment/qualification sections alongside
  `PspRecordsSection`'s pattern.

**Verify:** matrix for `mvr_orders` (RLS, in-flight uniqueness, idempotency-key uniqueness);
recorder tests: a scripted HTTP-200 body error lands as `failed` with its code; a dispatch that
dies before a response lands as `indeterminate`; refusal without a live `fcra_disclosure`;
refusal without step-up; `expectOrgScoped`; a full demo-environment round trip (order → poll →
two report fetches → document + record filed) via an extended `scripts/samba-recon.mjs`, run
and its output quoted in the PR.
**Done when:** a demo order round-trips to a filed PDF and a parsed record, a B01-style error is
a failed order not a success, an interrupted dispatch is `indeterminate` not a retry, ordering
refuses without the signed instrument and without step-up, and `mvr_preemployment` reads
`current` in a demo org's file.

### R4 · MVR delivery in the worker

**Prerequisites:** R3. The webhook half additionally needs the signature answer (Q-REC4);
fallback ⚠: the receiver **rejects every request with 401** (recon §3's rule — a receiver that
cannot verify must not accept); the poller is the truth.

**Build.** Poll loop as a queue handler: the new kind joins the **`JobKind` union**
(`services/jobs.ts`), registers in `services/queue/handlers/index.ts`, and gets a **`KIND_CAPS`
entry of 1** in `worker.ts` until Samba's rate limits are answered (Q-REC4). The feeding
scheduler runs in exactly one process fleet-wide — `docs/WORKER-DEPLOYMENT.md` first. Webhook
receiver (once unblocked): authenticate via `safeEqual` on the Basic credentials Samba sends,
treat the payload as a wake-up only, fetch the report through the authenticated API. Order
failure/`indeterminate` outcomes alert the office by the mailer + notification-ledger pattern
(§3's alerting fact), with the `NotificationCategory` + `notificationRoute` pair in the same PR.
§391.25 monitoring enrolment is **not** part of this step — a later step proposes it separately
with D-PSP4's discipline.
**Verify:** handler unit tests with the recorder; a pending demo order fulfils with no human
refresh; the unverifiable webhook path returns 401 in a test; scheduler registered per the
deployment doc's checklist.
**Done when:** the demo org's pending orders complete unattended, a failed order tells somebody
without being looked for, and the readiness page counts them without disagreeing with the
ledger.

### R5 · Clearinghouse — a safety_manager/admin workflow (D-REC4 ⚠)

**Prerequisites:** portal access to read FMCSA's current bulk-query template (execution reads
the template before writing the generator). Running real queries needs Q-H3 (the
`clearinghouse` instrument signed) and the employer's query plan purchased in the portal
(owner act, §6). ⚠ From 2026-04-27 Clearinghouse registration itself requires IDEMIA identity
verification (owner act too), and Motus may re-skin the portal screens this step documents —
re-verify the screens at execution, not from this page (§3's 2024–2026 facts).

**Build.**
- Migration: `clearinghouse_queries` act ledger — `org_id`, `driver_id`, `kind`
  (`full_preemployment`, `limited_annual`), `requested_at`, `requested_by`, outcome columns on
  the 0223/0224 mutability split: `outcome` in (`awaiting_driver_consent`, `completed`,
  `driver_refused`, `cancelled`) — **no testing facts on the ledger** (D-REC4 ⚠; whether a
  record was found lives only in the filed, kind-restricted `qualification_records` row),
  `outcome_at`, `document_id` FK. Immutability trigger on the request columns (EI010 style —
  this ledger is §382.701(e) evidence, 3-year retention, so it also joins
  `RETENTION_FORBIDDEN`), SQLSTATE **`CQ010`**.
- Access ⚠: request, file and read all gate on **`canReadTestingRecords`** (admin +
  safety_manager) — routes intersect the section roles with the predicate, the `pspOrders.ts`
  precedent. Everyone else — recruiter, fleet_manager, the R9 board — sees step-state only
  (pending / done / driver refused), projected at the API.
- Fold in `packages/shared/src/clearinghouseQueue.ts` (+ label maps): per-driver derived state,
  the annual due date from the newest `clearinghouse_limited` record, and the **24-hour
  escalation clock** when a filed limited result records a hit (§382.701(b)(3)) — computed from
  the restricted records, so the fold's full output is itself restricted-facing.
- ⚠ The 24-hour clock gets a **delivery mechanism, not just a page**: an hourly scheduler sweep
  (singleton rules; the 6-hourly `dqAlertScheduler` cadence is too coarse for a 24h deadline)
  that emails the office via `lib/mailer.ts` and writes the notification ledger, with the new
  `NotificationCategory` + web `notificationRoute` entry in the same PR.
- `driver_refused` is terminal with its consequence stated plainly: §382.703(c) — no
  safety-sensitive functions; for an applicant, the hire cannot proceed.
- Bulk generator: pure function, active CDL roster with a live §382.703(a) consent on file →
  the portal's template file, downloadable from the annual-round page.
- ⚠ **Where the §382.703(a) general consent is actually signed** — a gap this plan left unnamed
  until 2026-08-21: deliberately not on the applicant link (D-REC4;
  `APPLICATION-SYSTEM-PLAN.md` §7), so it is collected at orientation as one of **R8's
  acknowledged instruments** (the 0215 `clearinghouse` purpose already exists — it widens
  nothing). Its wording must **state its multi-year timeframe explicitly**: FMCSA honours an
  evergreen general consent only if the form says so (counsel, Q-H3). Annual limited queries
  concern employed drivers only, so orientation is early enough.
- Surfaces (all gated as above, `requiresAuth`-only route meta + page-level predicate): a
  per-driver query card in the driver detail's qualification area; an annual round page
  (`FilterBar` + search + count + `TablePagination` — it is a 201-row roster) listing who is
  due, who lacks consent, the generated file, and any live escalation clock first.

**Verify:** matrix (RLS, CQ010, RETENTION_FORBIDDEN pin); fold unit tests incl. the 24-hour
clock and refusal; projection tests: a recruiter-role request sees step-state and never an
outcome beyond it; `expectOrgScoped`; generator golden-file test against the captured template;
scheduler registered per the deployment doc.
**Done when:** a safety manager carries one driver through query → external-consent wait →
filed result without an act going unrecorded, a limited hit produces an email and a clickable
notification within the hour, a recruiter can see that a query is pending but never what it
found, and the annual round produces one portal-ready file instead of 201 portal visits.

### R6 · Drug & alcohol, §382.301

**Prerequisites:** Q-REC2 (who the C/TPA, collection network and MRO are) decides only the
*integration* half; the recorded process below ships against any C/TPA via manual result
entry + document upload — the fallback that works today.

**Build.**
- Migration: `drug_screen_orders` act ledger — `org_id`, `driver_id`, `test_kind`
  (`preemployment` first; the vocabulary admits the Part 382 panel later), `ordered_at`,
  `ordered_by`, `collection_site_note`, outcome columns (`awaiting_collection`, `collected`,
  `verified_negative`, `verified_positive`, `refusal`, `cancelled`) with dates, immutable
  request columns (EI010 style — this is §382.401 territory, evidence, `RETENTION_FORBIDDEN`),
  SQLSTATE **`DS010`**.
- Visibility ⚠ (the mechanism, not just the predicate): result *entry* and result *reading*
  gate on `canReadTestingRecords`; every list/ledger projection for other roles collapses
  outcomes to step-state (`awaiting_collection | collected | closed`) — a non-negative is
  `closed` without satisfaction, visible as consequence (the file stays incomplete, wheel-time
  stays blocked) but never as content. The binder precedent is the model: checklist state
  computes from everything; row contents stay behind the kind policies.
- The MRO's verified negative files the evidence: `documents` (human upload via the existing
  web storage path) + `qualification_records` kind `drug_test` → `drug_test_preemployment`
  satisfied (no kind widening — §3).
- The §382.301(b) exception as an explicit edge path: its own action demanding the §382.301(c)
  records as uploaded documents before it will mark the requirement satisfied, and saying on
  the record that the exception was used.
- D-REC5's gate as pure logic: `packages/shared/src/orientationGates.ts` —
  `wheelTimeBlockers(records)` returns named reasons (`no_verified_negative`,
  `no_clearinghouse_full`) with their exported human labels (fact, then action: "No verified
  negative on file. Book collection first."). Built here, enforced in R8.
- Requirement-list extension (+ labels) in this PR, per §1.
- Vendor eCCF ordering only if Q-REC2 reveals the C/TPA exposes it — a separate later sub-step,
  gated and ledgered like R3 if it ever exists.

**Verify:** matrix (RLS, DS010, RETENTION_FORBIDDEN pin); unit tests: ordered ≠ satisfied,
verified negative satisfies, exception path refuses without its records, `wheelTimeBlockers`
truth table; projection test: a recruiter-role read never contains `verified_positive` or
`refusal`; `expectOrgScoped`.
**Done when:** the file distinguishes ordered from done, a verified negative turns
`drug_test_preemployment` current, the exception path cannot be taken silently, a recruiter
sees consequences but never outcomes, and `wheelTimeBlockers` answers correctly for every
combination.

### R7 · Training — by refreshing the plan that exists

**Prerequisites:** none to start the refresh. Video content itself is the owner's (Q-REC1).

**Build.** `DRIVER-TRAINING-PLAN.md` is adopted, not rewritten — its decisions (provider
interface, immutable pinned versions, honest-effort rules, append-only events, **and its
already-hashed single-use link tokens** ⚠ — its §7.2 predates and matches 0220's discipline;
there is nothing to replace there) survive contact with today's tree. One refresh commit
updates it in place before its Phase 0:
- Migration numbers → next-numbered-at-execution language.
- Transcode/email onto the **durable worker queue** ⚠ (the queue and
  `P0-WORKER-QUEUE-PLAN.md` postdate the training plan — `worker.ts` itself does not); ffmpeg
  goes in the worker image, and the refresh names who owns that Railway build change.
- Training compliance tables join `RETENTION_FORBIDDEN`.
- Applicants ARE assignable (orientation content pre-hire; D-HIRE5's single driver id means
  completions persist through H8 with no carry-over machinery) — but no assignment is
  auto-created pre-hire until Q-REC6 answers.
- The certificate face carries the not-TPR/not-ELDT line (D-REC6).
- Role lists rechecked against the current matrix (`recruiter`/`recruitment` postdate the plan).
- ⚠ **The plan's §12.4 UI spec is re-based on the live gates**: `text-ink-subtle` is banned,
  `text-white/25` fails the unknown-colour-role rule (the watermark needs a tokens.css role),
  `text-xl` sits outside the six-size scale, and the mockup's badge anatomy (border pills,
  `rounded-full`) contradicts `lib/badges.ts` — the mockup stays a sketch, the system stays the
  law. The learner surfaces build on the `packages/ui` primitives — **`AppRadioGroup` already exists**
  (corrected 2026-08-20: the audit that claimed no radio primitive existed was itself stale), and
  anything still missing (custom video controls) lands in `packages/ui` first, because raw
  `<button>`/`<input>` in pages/features is a zero-tolerance gate with no exemption list — and the token-link pages get a `layout: "training"` in `App.vue` on the
  `ApplyLayout` precedent, `public: true` + `noindex` route meta, and `allowedHeaderExceptions`
  entries with reasons.
Then execute its Phase 0+1 (buckets, provider, schema) and Phases 2/3 as the refreshed document
specifies — in-app-only training is shippable before any link infrastructure.
**Verify:** the refreshed plan's own phase gates; every new table through §4's bar.
**Done when:** the refresh commit lands with all eight deltas, and Phases 0–1 ship exactly as
the refreshed document specifies.

### R8 · Orientation and the road test

**Prerequisites:** R6 (the gate logic), R7 Phase 3 if orientation content is video-delivered
(attendance-only orientation does not wait for it). Q-REC3 decides whether the equivalency
path is ever enabled; until answered it stays off (D-REC7).

**Build.**
- Migration: `orientation_sessions` (`org_id`, scheduled acts: `starts_at`, `location`,
  `capacity`, `created_by`) and `orientation_attendance` (`org_id`, `session_id`, `driver_id`,
  `attended`, `note`) — attendance append-only (EI010 style — attendance is the §391.31-era
  record trail), SQLSTATE **`OA010`**; a scheduling change is a new session row with the old
  one cancelled by a recorded act, not an edit.
- Booking wheel-time refuses on `wheelTimeBlockers` (R6) with the blocker's label shown.
- Acknowledgements on the instrument pattern: versioned wording, D-HIRE4's signature evidence,
  one document per instrument (handbook, policies). ⚠ Mechanically that means: widen **0215's
  `purpose` CHECK** by next-numbered migration for the new purposes, and add them to
  **neither** `APPLICATION_RELEASE_ORDER` (the applicant flow presents that explicit list, so
  handbook instruments cannot leak into it) **nor** `SCREENING_PREREQUISITES` (they authorize
  no vendor call). Drafts refused the same way as every instrument. ⚠ The §382.703(a)
  Clearinghouse general consent is collected here as one of these acknowledged instruments
  (R5's ⚠ names why here and not the applicant link; the 0215 `clearinghouse` purpose already
  exists and is already in `SCREENING_PREREQUISITES`, so it is the one instrument in this list
  that widens nothing), with its multi-year timeframe stated in the wording.
- Road test: the §391.31(c) eight-item checklist as the form; examiner identity; on pass, the
  §391.31(e) certificate (pdfkit — `dqBinder/pdfDraw.ts` is the in-repo precedent) filed as
  `documents` + `qualification_records` kind `road_test`. The `cdl_equivalency` write path
  exists but is disabled until Q-REC3 (and when enabled, refuses for tank/doubles assignments —
  §391.33(a)(1)). No kind widening (§3).
- Fold: orientation state per driver derives from sessions + attendance + records; requirement
  list extended (+ labels) in this PR. Web surfaces follow §4's frontend rules (route + title +
  parent + entry point, tones in `lib/badges.ts`, pagination on rosters).
**Verify:** matrix (RLS, OA010, the 0215 CHECK widening); gate refusal tests (no wheel-time
before the negative and full query); certificate golden test; equivalency-disabled pin; a pin
that the applicant release flow still presents exactly `APPLICATION_RELEASE_ORDER`.
**Done when:** an orientation day is schedulable and auditable, wheel-time cannot be booked
ahead of D-REC5's evidence, handbook instruments exist without touching the applicant flow, and
a tank-vehicle driver cannot be road-test-complete by equivalency.

### R9 · The recruiter board

**Prerequisites:** ships last by H6's rule — every stage it shows must be derivable, and by now
each of R3/R5/R6/R8 has already extended the requirement list in its own PR (§1 ⚠ — the stages
themselves never grew, so no cross-PR type coupling exists to untangle).

**Build.** `packages/shared/src/recruitingBoard.ts`: one pure fold over leads, contacts,
applicants, authorizations, applications, inquiries, MVR/PSP ledgers, Clearinghouse and drug
step-states, sessions and records → per-person **next action** (call back Thursday, send the
application, chase the release, order the MVR, book orientation, hire) with its blocking reason
when blocked. ⚠ The fold's inputs for testing-restricted areas are the **projected step-states,
never the outcomes** (D-REC4/D-REC5's visibility line) — the board must be safe to render for
every recruitment role. `/recruitment` grows into that board; the existing four-stage view
remains as the applicant slice; the nav label "Applicants" is renamed to match what the page
now is (R9 decides the word, the rename ships with the board).
**Verify:** fold unit tests per next-action rule; a projection test that no board payload for a
recruiter contains a testing outcome; a pin that the board's verdicts are computed by the same
functions the acting surfaces use (P0b's rule, fleet-wide).
**Done when:** a recruiter starts the day on one page, every row says the next action and why,
nothing on it can disagree with the files it summarises, and nothing on it says what only
`canReadTestingRecords` may read.

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
  whether a no-hit bills, and the UT access-code contradiction in the collection.
  *Fallback:* R3 builds and verifies against demo only; R4's webhook receiver rejects with 401;
  the poller is the truth; `KIND_CAPS` stays at 1.
- **Q-REC5 · Counsel:** is a pre-hire §391.31 road test "performing a safety-sensitive
  function" under §382.107/§382.301(a)? *Fallback (permanent until answered):* assume yes —
  D-REC5's ordering holds; a "no" only relaxes scheduling.
- **Q-REC6 · Pre-hire training** (owner + counsel): may applicants be assigned orientation
  content, and does any of it count as compensable time the carrier must track?
  *Fallback:* R7 makes applicants technically assignable; no assignment is auto-created
  pre-hire until answered.
- **Q-REC7 · Lead retention** (owner): how long does a dispositioned lead's PII live?
  *Fallback:* no retention rule prunes leads until a window is chosen; D-REC2 keeps them
  prunable-by-design (0213-style triggers, cascade FKs) so the choice is one rule, not a schema
  change.
- **Standing blockers, unchanged and still the real ones:** **Q-H3** (counsel wording for all
  five instruments — gates every signature, therefore every PSP/MVR order and §40.25 letter),
  the **DOB CSV** (blocks PSP and MVR alike; the import page is live at
  `/recruitment/screening`), **Q2** (confirm `PSP_UNIT_PRICE_USD`), the **UAT PSP token**
  (PSP support provisioning), **Q-PEI1/Q-PEI3** (counsel/product, own plan), and the
  **Clearinghouse query plan** purchase in FMCSA's portal (owner act; C/TPAs cannot buy it —
  verified on FMCSA's pages; $1.25 flat per query, so ~250 queries ≈ $312/yr at Silvicom's
  size), and — from 2026-04-27 — the **IDEMIA identity verification** that Clearinghouse
  registration will require (owner act too; §3's 2024–2026 facts).
