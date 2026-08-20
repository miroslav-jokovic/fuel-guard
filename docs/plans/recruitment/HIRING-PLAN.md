# The hiring process — application, releases, screening, cross-match

**Date:** 2026-08-19 · **Supersedes the framing of** `safety-dqf/PSP-PLAN.md` §5b.4 and the shipped
Recruitment surface (PR #126). Regulatory text verified against 49 CFR §391.21 (Cornell LII,
2026-08-19), not recalled. PSP behaviour verified against the live production API, not assumed.

---

## 0. What was built wrong, stated plainly

PR #126 shipped `driver_employment_history` as an **office transcription** surface: a fleet table of
drivers, a per-driver editor, and gap arithmetic over **one three-year window**. Two things about that
are wrong for what this is for, and one is a duplication.

**Wrong 1 — the author.** §391.21(b) is a form the **applicant fills in and certifies**: "the
applicant must sign stating all entries on it and information in it are true and complete." A carrier
clerk retyping a scanned PDF is a transcription of that artifact, not the artifact. The employment
list has to be captured from the driver, in an application, or the cross-match has nothing
authoritative to compare PSP against — it compares against what a clerk typed.

**Wrong 2 — the window.** The plan and the code both used three years. The verified regulation:

> **§391.21(b)(10)** — "A list of the names and addresses of the applicant's employers during the
> **3 years** preceding", with employment dates and reasons for leaving.
> **§391.21(b)(11)** — "A list of the names and addresses of the applicant's employers during the
> **7-year period preceding the 3 years**" in (10), **but only** "for which the applicant was an
> operator of a **commercial motor vehicle**."

**D-HIRE1 — a "10-year timeline" is not ten years of everything, and building it as one would flag
every honest applicant.** It is 3 years of ALL employment plus 7 years of CMV driving only. Gap
detection therefore applies to the first segment and **must not** apply to the second: an applicant
who spent 2019 in a warehouse has no gap to explain, and a product that says otherwise is wrong in
the direction that costs somebody a job. `employmentCoverage.ts` computes one 3-year window and its
comment says the ten-year list is "tracked, not computed here" — that comment is right about the
regulation and now wrong about the product. The fix is **two segments with different rules**, not one
ten-year window.

**Duplication 3 — Recruitment restating DQF.** The DQF page already carries `employment_application`,
`previous_employer_inquiry` and `previous_employer_response` as §391.51 requirements. The Recruitment
fleet table restated the inquiry state beside them. The boundary was never drawn, so it got drawn
twice.

### D-HIRE2 — the boundary: Recruitment owns the APPLICANT, DQF owns the DRIVER

| | Recruitment | Driver Qualification |
|---|---|---|
| Subject | someone who is **not yet** a driver | someone **hired** |
| Question | should we hire them, and may we legally check? | is their §391.51 file complete? |
| Artifacts | the application, the signed releases, the screening pulls, the cross-match | `certifications`, `qualification_records`, `documents` |
| Ends when | a hiring decision is made | employment ends, plus three years |

**The handoff is the whole relationship: Recruitment PRODUCES the evidence DQF files.** On hire, the
application becomes an `employment_application` record + document; the PSP report becomes a
`psp_report` record; each previous-employer response becomes a `previous_employer_response`. Nothing
is duplicated because nothing is computed twice — DQF reads the rows Recruitment wrote.

Before that moment there is no §391.51 file, because there is no driver. That is why the Recruitment
surface is a **pipeline**, not a second compliance table.

---

## 1. PSP — tested 2026-08-19, and what the test settles

`GET /DayMonitored45` with the configured `PSP_API_KEY`, against both hosts:

| Host | Result |
|---|---|
| UAT `rest-api.uat.psp.tylerapp.com` | **HTTP 401**, `success: 0`, `errorCode: 32` — "Your token is invalid" |
| Production `www.psp.fmcsa.dot.gov/PspRestService` | **HTTP 200**, `success: 1`, `errorCode: 0`, 0 enrolled records |

**Q1 is answered: the key is a PRODUCTION token, and it authenticates.** Consequences:

- **Every `POST /Records` from here is a real charge** against a live account-holder agreement. There
  is no free rehearsal on this credential.
- **Get a UAT token before a client is written** (PSP-PLAN Q1's standing recommendation, now binding
  rather than conditional). The guide ships working UAT test drivers (§9.1.1); production ships an
  invoice.
- The 45-day monitoring baseline is **zero enrolled records** — nothing to reconcile against.

**Two endpoints were deliberately NOT called.** `POST /Records` bills (§8 — on `Success`, `Partial`
**and** `Failure`). And `GET /Token` **mints a new token** (§4.3: "A new token was created and
returned"), so using it as a connectivity check risks invalidating the key that was just configured —
the guide never says whether minting rotates, and a probe must not be the thing that finds out.
`GET /DayMonitored45` is the only endpoint that neither bills nor mints.

**A documentation discrepancy, observed rather than inferred.** The v3.9 version-history block lists
`statusDetail 32` as "This PSP account is inactive" — the same text it gives 33. §8.5's table says 32
is "Your token is invalid." **The live API returned 32 with the §8.5 wording**, so §8.5 is correct and
the version-history entry is a copy-paste of 33. Recorded with the other five discrepancies in
PSP-PLAN §2.6.

**One more shape fact:** this endpoint returned a real **HTTP 401** for the bad key, not a 200 with an
error body. So PSP is not uniformly SambaSafety-shaped — but §8 still puts record-request status in
the body. The client must check **both**, and assume neither.

---

## 2. The releases — and the constraint that decides the form's shape

**D-HIRE3 — the disclosure is a SEPARATE DOCUMENT, not a section of the application.**

FCRA §604(b)(2) requires a clear and conspicuous written disclosure "in a document that **consists
solely of the disclosure**." Courts read "solely" literally, and it is the most litigated line in
employment screening: a disclosure sitting inside a multi-page application, next to acknowledgements
or a liability waiver, fails. The **authorization may be combined with the disclosure** and nothing
else may.

So the natural instinct — one long online application with a consent checkbox near the bottom — is
precisely the thing not to build. The application and each release are **separate artifacts, signed
separately**.

Four distinct instruments, with different scopes and different law behind them:

| Release | Authority | Why it cannot be folded into another |
|---|---|---|
| FCRA disclosure + authorization | §604(b)(2) | must consist SOLELY of the disclosure |
| PSP disclosure + authorization | PSP guide §5.4.1 `driverConsent`; Errors 17, 31 | FMCSA requires the carrier disclose PSP access specifically and hold the authorization **before** the request |
| Previous-employer safety-performance release | §391.23(a)(2); §40.25(g) for D&A records | §40.25(g) requires **specific written consent** for drug & alcohol history — a general release does not reach it |
| Clearinghouse full-query consent | §382.701(a) | driver-specific, given in the Clearinghouse itself, not on our paper |

`driver_authorizations` (PSP-PLAN P1, scoped and never built) is the table. It is now the **critical
path**, not a supporting step: **we cannot lawfully call `POST /Records` for anybody until a PSP
authorization exists**, and the API will refuse us anyway (Error 17).

### D-HIRE4 — what makes an e-signature hold up is the evidence, not the drawing

For "our version of DocuSign," the enforceable core under ESIGN/UETA is five things — **consent to
transact electronically, intent to sign, attribution, record retention, accuracy** — plus an audit
trail carrying timestamp, IP and user agent. A drawn squiggle with none of that is weaker than a
typed name with all of it.

The practical consequence for now: **design `driver_authorizations` to carry those fields on day one**
(`disclosure_version`, `disclosure_text`, `accepted_at`, `accepted_ip`, `accepted_user_agent`,
`intent_statement`, `esign_consent_at`), and the PDF sealing can be added later without a migration.
Rendering and sealing a PDF is a library problem (`pdf-lib`, `node-signpdf`) and the smaller half;
the evidence record is the half that has to be right from the first signature, because it cannot be
reconstructed afterwards.

Server composes every disclosure string from a **versioned constant**; the client never authors it.
`hazmat_reviews.attestation` (`0092`, D8) is the proven pattern — *"never paraphrase in the UI."*

---

## 3. The applicant

**D-HIRE5 — an applicant is a `drivers` row with `status = 'applicant'`.** `drivers.status` is a
plain `text` column with no enum and no CHECK (verified in production), so this is a constant in
`packages/shared` and the surfaces that filter on it — no migration, no one-way door. It also matches
what 0212 already committed to when it granted the recruiter `drivers` INSERT: *an applicant IS a
drivers row*.

Two properties fall out for free and both are wanted: `auth_driver_id()` (0083) resolves only
`active` drivers, so an applicant gets no driver-app access; and the DQF overview and roster counts
filter on status already, so an applicant does not appear as an unqualified driver in a compliance
queue they have no business being in. **Every such filter has to be checked** — an applicant showing
up as "missing a medical card" is the failure mode of this decision.

**The applicant is unauthenticated.** They fill the form from an emailed link before they are anyone.
Precedents: `publicHazmat` (unauthenticated, rate-limited, nothing persisted) and `invites` (a random
token pair on a row). Neither is sufficient as-is — `routes/invites.ts:308-314` records that the
invite token *is never presented*, acceptance being authorised by the email claim instead. An
application link must present a real, hashed, single-use, expiring token, because the endpoint behind
it accepts a date of birth and a Social Security number.

**D-HIRE6 — the SSN is the most sensitive field this product has ever handled, and it should mostly
not be stored.** §391.21(b)(2) requires it on the application. PSP does **not** need it (it matches on
name, licence number, licence state and DOB). A SambaSafety MVR needs it or its last four. So: keep
**last four in a column** and the full value **sealed via `secretBox`** only for as long as an order
needs it, or not at all if the vendor accepts last-four. It is never logged, never audited by value,
never in a `meta` blob — the same rule `redactCardXml` established, applied to the worst case.

---

## 4. The cross-match, restated for two segments

`PSP-PLAN.md` §5b.2 stands: the match **corroborates** a listed employer or **discovers** an unlisted
one, and can never refute, because a driver can work two years and never be inspected. What changes
with the real regulation:

- **Segment A (0–3 years, ALL employment).** Gaps are meaningful. A PSP inspection under a DOT number
  absent from the list is a §391.21(b)(10) omission **and** a §391.23(a)(2) inquiry we did not know we
  owed.
- **Segment B (3–10 years, CMV only).** Gaps are **not** meaningful and must not be shown. A PSP
  inspection under an unlisted DOT number here is still a finding — it is direct evidence of CMV
  operation that (b)(11) required them to list — but the absence of anything is not.

PSP's inspection window is **3 years** and its crash window **5 years**, so PSP can only corroborate
into the early part of Segment B and says nothing at all about years 6–10. **The timeline must show
that boundary**, or it implies a verification that does not exist.

**A second cross-match nobody has scoped, and it is free once the first exists:** §391.21(b)(7)
requires the applicant to list every accident for the preceding 3 years, and PSP returns
`crashRecords[]` for 5. A DOT-recordable crash in PSP that the applicant did not declare is a
discrepancy in a self-certified document — and `notPreventable` (§10.5) must be honoured, or a crash
FMCSA already ruled non-preventable gets counted against them.

---

## 5. Steps

**H1 · `driver_authorizations`** — the four instruments of §2, with the ESIGN evidence fields of
D-HIRE4 and server-composed versioned disclosure text. Blocks every screening call.
**Done when:** a PSP authorization can be recorded and read back with its exact disclosure version,
a revocation is a new row, and `POST /Records` cannot be reached without a live one.

**H2 · `applicant` status + the filter sweep** (D-HIRE5). A constant, plus every place that counts or
queues drivers.
**Done when:** an applicant appears in Recruitment, appears in **no** DQF queue or compliance count,
and has no driver-app access.

**H3 · The application contract** — §391.21(b)(1)–(11) as a schema in `packages/shared`, including
the (b)(3) address history, (b)(7) accidents, (b)(8) violations and (b)(9) denials, with the
applicant's certification. The employment section carries a **segment** discriminator.
**Done when:** the schema round-trips a complete application and refuses one missing a (b) item, and
`employmentSegments()` classifies each entry against the two windows with unit tests.

**H4 · `employmentCoverage` → two segments.** Gap arithmetic in Segment A only; Segment B reports
coverage of CMV employment without gap findings. This edits shipped, tested code — the existing
assertions stay and become the Segment A cases.
**Done when:** an applicant with a non-driving job in year 5 produces **zero** gap findings, and one
with a four-month hole in year 2 produces exactly one.

**H5 · The public application surface** — hashed single-use expiring token, rate-limited, the SSN rule
of D-HIRE6, the releases as separate signed documents per D-HIRE3.
**Done when:** a used or expired token is refused, a submitted application is immutable, and the four
releases exist as four rows with four disclosure versions.

**H6 · Recruitment becomes a pipeline — DONE 2026-08-19.**

`/api/recruitment/pipeline` lists **applicants**, not drivers, and that boundary is what removes the
duplication rather than any column change: once the two surfaces are not looking at the same people,
DQF has nothing to restate. Employment history for somebody hired is still reachable on their own
driver page, where a §391.51 file is.

**The stage is derived, never stored.** `applicantPipeline.ts` computes it from the rows that already
exist, so the board cannot disagree with the file it summarises — the failure a status column invites
is somebody recording an authorization and forgetting to advance it. A revoked release moves an
applicant backwards with no column to update, and a test pins that.

**Only the derivable stages exist.** The sketch was invited → applied → releases → screening ordered →
decision; there is no invitation record until H5 and no screening ledger until H7, so modelling those
would be designing against an imagined shape. The **requirement list** is the extension point instead:
H5 adds `application`, H7 adds `psp_report`, and neither renumbers anything.

A gap names a stage (`history_incomplete`) without ever appearing on the outstanding list — the
applicant answered, the answer needs a conversation, and telling a recruiter to go and collect a
document that does not exist is worse than saying nothing.

The router split into `routes/recruitment/{employment,authorizations}.ts` on the `routes/roster/`
pattern when it hit the 500-line budget.

**H7 · PSP client + the cross-match** — PSP-PLAN P2–P7, then P13, now unblocked by H1.
**Done when:** PSP-PLAN's own done-whens, plus: a corroboration report distinguishes the two segments
and never reports a Segment B gap.
**P2, P4–P7, P13 and P14 done 2026-08-19; P9 done 2026-08-20.** P14 is the import path for records the carrier already
bought on the portal — no vendor call, no fee, and the only way those PDFs can enter the file, since
no PSP endpoint lists past transactions. It satisfies the file and does NOT feed the cross-match: an
imported PDF has been read by nobody, and PSP-PLAN D-PSP9 says why an invented `inspections: 0` would
be worse than an absent one.

**H8 · Hire → the DQF handoff** (D-HIRE2) — **DONE 2026-08-19.**

**The handoff moves nothing, and that is D-HIRE5 paying out.** An applicant is a `drivers` row, so
the PSP report, the scans and every qualification record Recruitment gathered are ALREADY filed
against this driver id. The step that looked like a migration of evidence between two worlds turns
out to be a PROJECTION of one thing: `driver_employment_history` carries the §391.23(a)(2) inquiry
state as three mutable columns, and §391.51(b) wants it as dated, append-only records. That is all
the handoff writes.

**D-HIRE7 — never invent a date.** `occurred_on` is NOT NULL, and a history row saying `sent` with no
`inquiry_sent_on` offers two choices: file it under a date nobody recorded, or leave it out and say
so. A wrong date in a §391.51 file is worse than a missing row — it is a false fact in the one place
a carrier is asserting facts — so every such row is REPORTED instead, as a named employer with a
reason a person can act on. The hire drawer shows that list before the button, because hiring is the
last moment it is cheap to fix.

**Hire is a fact, not a permission.** Nothing refuses to record a hire because the file is
incomplete. The carrier hired somebody; a product that declines to write that down does not prevent
the hire, it stops describing reality — and the driver would then have no §391.51 file at all rather
than one with a named gap. The response and the audit entry both carry what was filed AND what is
still outstanding, so the gap is never something nobody was told about.

What shipped:

- **`packages/shared/src/hireHandoff.ts`** — the projection rules, the `HIRE_DATE_MAX_FUTURE_DAYS`
  bound (the date anchors the (b)(10) window and the §391.51(c) clock, so a decade-out typo is worth
  refusing), and `hiringGapsAfterHire`, which never reports an advisory item as missing. Pure; 14 tests.
- **Migration `0218`** — `hire_applicant(...)`, service-role only on the 0174/0178/0183 convention.
  `for update` on the driver row, because two operators pressing Hire when a decision is announced is
  not exotic; a second hire raises **HA010**, which the API turns into an answer rather than a 500.
  The insert carries a `not exists` guard on `detail->>'employment_id'`, so a retry after a dropped
  response files nothing. **The rules are NOT restated in SQL** — the function takes the drafts as
  jsonb, because two versions of §391.23 would drift.
- **`apps/api/src/services/hireApplicant.ts` + `routes/recruitment/hire.ts`** — plan, call, audit,
  plus `GET /drivers/:id/hire-preview` computed by the same function the hire runs, so the
  confirmation cannot promise something the button does not do.
- **Web** — `HireDrawer.vue`, opened from the pipeline row.

**A recruiter may not press it, and the reason is already machine-enforced.** Hiring flips
`drivers.status`, which starts the §391.51(c) clock and decides driver-app access; `0213` refuses a
recruiter's status change in a trigger. A hire endpoint that admitted them would authorise a call the
database then blocks. They get the preview — the read that shows an undated inquiry while there is
still time — and the Hire button is gated on `canWriteDriverLifecycle` in the API, in the trigger and
in the UI, all derived from the one predicate.

**Verified by:** `pnpm typecheck`, `pnpm lint`, the 15 repo gates and full `pnpm test`, including a
new PGlite matrix `hire-applicant` (17 assertions) that proves the two halves land together, that a
replay files nothing, that an active driver's hire date is never re-stamped, and that the function is
executable by `service_role` alone.

**Still open:** the `employment_application` record. H5 owns the artifact, and until an application
exists there is nothing to file — filing a scan under the hire date would be inventing the date this
step exists to refuse.

---

## 6. Open questions

- ~~**Q-H1 — get a UAT PSP token.**~~ **DONE 2026-08-19** — a UAT token is held, so H7's ordered path
  can be proven against the guide's test drivers for free. The production key still bills on Success,
  Partial and Failure; `PSP_ENVIRONMENT` decides which host a request reaches.
- **Q-H2 — does the vendor accept SSN last-four for an MVR?** Decides whether D-HIRE6 stores the full
  value sealed or never stores it at all. Ask SambaSafety.
- **Q-H3 — counsel on the four releases.** The wording is a legal artifact, not a product one; we hold
  the versions and the audit trail, not the drafting.
- **Q-H4 — is an applicant who is never hired purged, and when?** No §391.51 clock runs for somebody
  who was not employed, and FCRA/state law point at retention limits rather than at keeping. This is a
  Phase F question and the answer shapes H5's schema.
