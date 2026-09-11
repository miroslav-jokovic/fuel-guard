# The applicant's experience — hardening plan

> **Status 2026-09-11: PLANNING. Nothing below is built.** This plan is the output of an audit of
> the live apply flow against three questions the owner asked: is it a wizard a driver can actually
> finish, does what it collects match the carrier's own application (`APPLICATION.xlsx`), and is the
> signing ceremony as precise as the commercial products carriers already know (DocuSign).
>
> ⚠ **It deliberately excludes everything that waits on counsel.** `docs/plans/recruitment/COUNSEL-REVIEW-PACKAGE.md`
> is the one artifact blocking submission at all, and the packet's 21 signature placements (P5) and
> the cutover to the carrier's own document (P6) are both downstream of it. Those stay in
> `APPLICATION-PACKET-PLAN.md` where they belong. **Everything in this plan can ship today.**

## 0. Why this document exists

The apply flow is regulation-correct and has never been walked by a human. Every gate in the repo
passes on every file it touches, and the gates read colour, control provenance and token vocabulary —
never composition, never reachability, never how much work one screen asks for. So the defects below
are all, without exception, in the gates' blind spot. That is the same finding
`RECRUITING-UI-SURFACE-PLAN.md` §"why it exists" recorded a month ago, and this is its second half:
that plan fixed the surfaces the flow was *missing*; this one fixes the flow it *has*.

The audit measured rather than judged wherever a number was available. Where it judged, it says so.

## 1. Ground truth — measured 2026-09-11

### 1.1 The application cannot be submitted today, and that governs the ordering

Every instrument is placeholder text: all five `DISCLOSURES` and `ESIGN_CONSENT` carry
`version: "v0-draft"` (`packages/shared/src/authorizationContract.ts`). Therefore:

| Path | What happens today | Where |
|---|---|---|
| Submit | refused, `WORDING_NOT_FINAL` | `applicationIntake.ts:287` |
| Signing ceremony | skipped entirely | `ApplyPage.vue`, `ceremonyAvailable` |
| 7001(c) consent gate | never fires | `esignConsentRequired()` returns false while draft |

A driver invited today fills in nine screens and cannot send. The page says so on the first screen
and again at the button, which is the right behaviour — but **the system is not live**, and no amount
of UI work makes it live. Counsel is step zero and it is not an engineering step.

**What follows from that:** every step in this plan is chosen because it is *independent* of counsel.
When the wording lands, none of this has to be revisited, and the flow it lands into is one a driver
can finish.

### 1.2 Nine steps, one of which is the whole application

`APPLICATION_SECTION_ORDER` has nine entries. Controls per screen, counted from the templates:

| Screen | Controls | Note |
|---|---|---|
| identity | 10 | + one row per other name |
| addresses | 7 per address | §391.21(b)(3) wants three years; the packet prints three rows |
| licence | 4 | + 4 per additional licence |
| **employment** | **15 per employer + 5 per equipment row + 2** | see below |
| safety | 3 + 5 per accident + 4 per conviction | |
| questions | 9 | two of them grids |
| documents | 4 buttons | |
| review | 0 | |
| certify | 2 | |

The employment screen is the finding. Fifteen controls per employer card (eleven inputs, four
checkboxes), five per equipment row, plus the narrative and the "I have not been employed" checkbox.
**A six-employer history with three equipment rows is 107 controls on one screen** — and six
employers over ten years is ordinary in this industry, not a tail case. §391.21(b)(10) asks for three
years of everything and (b)(11) for seven more of commercial driving; the form already computes that
boundary for the driver, which is the right instinct applied to the wrong half of the problem.

`ApplyPage.vue`'s own docstring promises "one §391.21(b) paragraph at a time". On this screen the
promise is not kept, and it is the screen where roughly nine in ten of these — the same docstring's
number — are being filled in on a phone.

### 1.3 Drivers are shown database column names

`ApplyPage.vue` renders the validation list as:

```
<span class="font-medium text-ink">{{ issue.key }}</span> — {{ issue.message }}
```

`issue.key` is the Zod path, which is the contract key (`useApplicationWizard.ts`, `issuesFromParse`).
So a driver reads **`equipment_experience`**, **`licence_denial_detail`**, **`declares_no_accidents`**.
The list sits at the top of the page, the page scrolls to top, and nothing is marked on the field
itself — the driver is told that something is wrong and not where.

### 1.4 Two controls for the same concept, one of which is a regex

| Field | Control | Accepts |
|---|---|---|
| `employer.started_on` / `ended_on` | `AppDateField` | a calendar |
| `address.from` / `to` | `AppInput`, `placeholder="2024-03"` | `/^\d{4}-\d{2}$/` only |
| `equipment.from` / `to` | `AppInput`, `placeholder="2021-03"` | `/^\d{4}-\d{2}$/` only |

`March 2024`, `3/24`, `03-2024` and `2024-3` are all rejected, and rejected by §1.3's error list —
so the driver is told `addresses` is wrong and left to infer that the month needs a leading zero.

`state` is a bare `AppInput maxlength="2"` in three places (`address.state`, `employer.state`,
`cdl_state`). There is no jurisdiction catalogue in `packages/shared`; the only list of codes in the
repo is a private `US_STATES` Set inside `samsara/location.ts` (65 entries — 50 states, DC, PR and 13
Canadian provinces), not exported and holding no names.

### 1.5 The review screen shows counts where it promises entries

`ReviewFields.vue`'s docstring: *"not as a pretty summary but as the answers themselves"*. It renders
`"3 employers"`, `"2 accidents"`, `"1 conviction"`, and omits `other_names`, the whole equipment grid,
the §40.25(j) answer, every questionnaire answer and the captured documents.

⚠ **This is the one UX defect that is also a legal-quality defect.** §391.21(b)(12) has the applicant
certify that *all entries on it* are true and complete. The screen immediately before that
certification does not show the entries. Nobody can swear to what they cannot see — which is the
argument `ApplyPage.vue`'s own header makes for having a review screen at all.

### 1.6 The carrier's page 1 asks five questions our wizard asks at step 6

Parsed from `APPLICATION.xlsx`:

| Workbook | Question | Our screen today |
|---|---|---|
| p1 R13 | Position | step 6 (`questions`) |
| p1 R36 | How did you hear about this company? | step 6 |
| p1 R32 | Can you legally work in USA? | step 6 |
| p1 R32 | Do you have proof of age? | step 6 |
| p1 R34 | May we contact your previous employers? | step 6 |
| p16 R647 | Education and training | step 6 |
| p16 R658 | Military service | step 6 |
| p16 R659 | Other training | step 6 |
| p16 R665 | Three personal references | step 6 |

The paper puts five of these on page 1, beside the name and the address, and four on page 16, at the
back. Our wizard puts all nine on one screen two-thirds of the way through. **"What job are you
applying for?" is the first thing a person expects to be asked** and we ask it sixth, after the two
heaviest screens in the form.

### 1.7 The evidence is recorded and then not printed

`record_driver_release` (0228) stores, per signature: the exact disclosure text, its version, the
intent statement, the signed name, `accepted_at`, `accepted_ip` and `accepted_user_agent`. That is a
better evidentiary record than most commercial e-sign products keep, and the rendered PDF prints
**six of those eight columns** — `file.ts:139` selects `purpose, disclosure_version, disclosure_text,
intent_statement, signed_name, accepted_at` and omits the IP and the user agent that are sitting in
the row. There is no signer event log and no page that gathers the ceremony into one auditable
statement.

DocuSign's Certificate of Completion is the artifact that settles a dispute. We hold every ingredient
of one and never assemble it.

### 1.8 The signer never receives what they signed

Nine public routes hang off the application token; none serves a document, and no completion email
exists (`publicApplication.ts`). Our own 7001(c) consent tells the driver *"you can ask the carrier
for a paper copy… at no charge"* — which discharges 15 U.S.C. 7001(c)(1)(B)(iv) and is far below what
a driver who has ever used DocuSign expects, which is the completed PDF in their inbox before they
have put the phone down.

## 2. Decisions

**D-AX1 · Counsel is step zero and is not in this plan.** Everything here is chosen to be independent
of the wording. No step below changes a disclosure, an intent statement or a version.

**D-AX2 · A screen asks for one thing, and a repeated thing is a loop, not a taller screen.**
The employment screen becomes a sub-flow: one employer per screen, with an explicit "add another /
that is all of them" decision between them. The wizard's step counter keeps counting screens, not
employers — a driver with six jobs must not be told they are on step 4 of 14.

**D-AX3 · A driver is never shown a contract key.** Every field the schema can complain about has a
human label, the label lives beside the copy the field already uses, and a key with no label fails a
test rather than reaching a screen.

**D-AX4 · One control per concept, and a month is a concept.** `AppMonthField` is the third shape of
`DatePickerBase`, beside `AppDateField` and `AppDateTimeField`. Every `YYYY-MM` input in the product
uses it. No caller keeps a regex-validated text box for a date.

**D-AX5 · The jurisdiction catalogue is shared and derived, never restated.** One exported list in
`packages/shared` with code and name. `samsara/location.ts` derives its Set from it rather than
holding a second copy — a copy is a workaround with a delay fuse.

**D-AX6 · The review screen renders the entries, not a count of them.** It is the page a driver
certifies. Anything in the certified payload appears on it; anything not in the payload (the SSN,
which never enters a draft) does not.

**D-AX7 · A carrier question declares which screen it belongs on, and the packet's own page number
is the authority for that.** `QuestionnaireQuestion` gains an optional `screen`. The five questions
the workbook puts on page 1 render on the screens where they read naturally; the four it puts on
page 16 stay on the later screen. **No question's wording, substance or scope changes** — that is
counsel's act and not an engineer's, and the transcription rule from `questionnaireContract.ts` is
unchanged: layout may move, meaning may not.

⚠ **One deliberate departure from the paper.** *"May we contact your previous employers?"* is on the
workbook's page 1 and renders on our **employment** screen, immediately above the employer list.
Asking a driver for permission to contact employers they have not yet named is a question with no
referent. Moving where it is asked changes nothing about what is asked.

**D-AX8 · The certificate of completion is a page of the application PDF, not a second document.**
§390.32(d) wants one reproducible record. A separate certificate is a second file to lose.

**D-AX9 · The signer's copy is the same bytes the carrier filed, fetched with the same token.**
The token is already the credential for the whole application — it reads the draft, which holds a
date of birth. Serving the filed PDF to the holder of that token is not an escalation. It is served
through a short-lived signed URL, only after submission, and the fetch is audited.

**D-AX10 · Nothing in this plan is "designed" by replacing a primitive.** Every screen is built from
`@silvicom/ui` and `@/components/ui`. Where a primitive is missing it is added to the package
(D-AX4), never cloned into the feature. `lint:ui-adoption` and `lint:tokens` are the arbiters —
they, and the call sites, outrank `DESIGN-SYSTEM-CONTRACT.md` wherever the two disagree.

## 3. Steps

Each step is one PR. Each has a Done-when written as a sentence about what a driver or a reader can
observe, not about what an endpoint does — the lesson A11b cost, recorded in
`HANDOFF-2026-08-21-NIGHT.md` §3.

### X1 · The two missing primitives, and their first callers

`AppMonthField` (D-AX4) and the jurisdiction catalogue (D-AX5), adopted immediately in the three
month fields and the three state fields so neither ships without a caller.

**Done when:** a driver can pick "March 2024" from a calendar on the address and equipment screens,
and choose Illinois from a list on all three state fields, and `samsara/location.ts` holds no second
copy of the list.

### X2 · What is wrong, said in words, next to the field

D-AX3. A label map, inline errors under the offending control, and focus moved to the first invalid
field instead of scrolling to the top of the page.

**Done when:** a driver who leaves the licence expiry blank sees "Licence expiry date" in the summary
and a message under that box, with the cursor in it — and no screen can render a bare contract key.

### X3 · The review screen shows the application

D-AX6.

**Done when:** every employer, address, accident, conviction, equipment row, licence, other name,
questionnaire answer and captured document the driver entered is visible on the screen where they
certify it, each with a way back to the screen that owns it.

### X4 · The wizard shell

The step rail, the save indicator promoted out of 11px grey, an explicit "finish later" that says how
to come back, and the section-order/placement work from D-AX7.

**Done when:** a driver on a phone can see which steps are done, which is current and what is left;
the page says "Saved" where they will see it; and the first screen asks what job they are applying
for.

### X5 · One employer per screen

D-AX2, the heaviest step and the one with the largest effect on completion.

**Done when:** a driver with six employers is walked through six screens of fifteen controls instead
of one screen of ninety, is told how much of the ten years they have covered, and the step counter
still reads "Step 4 of 9".

### X6 · The driver can see the photograph they just took

**Done when:** an accepted capture shows a thumbnail of what was sent, and a driver who took the
wrong document can see that before they leave the screen.

### X7 · The certificate of completion

D-AX8. The IP and user agent already in the row (§1.7), the consent, and every signature gathered
into one auditable page of the filed PDF.

**Done when:** a reader holding only the filed PDF can say, for each instrument, what text was signed,
by what name, at what moment, from what address and through which link — without opening the database.

### X8 · The signer gets their copy

D-AX9.

**Done when:** a driver who has sent their application can open their own copy of exactly what the
carrier filed, from the link they already have.

### X9 · A date of birth that is actually required

⚠ **Found 2026-09-11 while building X2, and it is not a copy defect.**
`driverApplicationSchema` takes `date_of_birth: dateOfBirthSchema`, and that schema — shared with the
roster, where a driver record may legitimately lack one — is `.nullish()` after a preprocess that
turns `""` into `null`. So **an application with no date of birth validates and submits.**

Two things break at once, and ⚠ **the second is the opposite of what this plan first said.** It read
"creates a draft nobody can ever unlock". Checked against `applicationDraft.ts` while building it:
`draftIsLocked` withholds a draft's body **only once a date of birth is in it**, and `unlockDraft`
returns early — "there is nothing gated" — when there is none. So a blank date of birth does not lock
a driver out. It leaves the draft **ungated**: an address history and an employment history served in
the clear by `GET /:token` to anyone holding the link. The second factor D-APP16 exists to add was
contingent on an answer nothing required.

The first is simpler: §391.21(b)(2) names the date of birth, so the filed document was missing
required content.

The fix is a required variant on the application contract only, leaving the roster's optional one
alone. Safe to tighten: `driver_applications.payload` is never re-parsed on render (`file.ts` casts
it), so no filed row can be made unreproducible by it.

**Done when:** an application with no date of birth is refused, by the same schema on both sides, and
the roster's own optional date of birth still is.

## 4. Open questions

**Q-AX1 · Does the step rail survive at 320px?** The design is a rail; the fallback is the counter we
already have. To be answered against a real screen in X4, not in this document.

**Q-AX2 · Should X5's per-employer screens count toward the progress bar?** D-AX2 says no — the
counter counts sections. If a driver with six jobs reads a bar that does not move for six screens,
that is worse than a longer count, and the answer changes. Measure it in X4/X5, decide there.

**Q-AX3 · Owner: is the completion email in scope, or is the download link enough?** X8 builds the
route and the page either way; the email is a small addition on top and needs a decision about what
it says, which touches wording counsel has not seen. Recommendation: **ship the download in X8, hold
the email until the instruments are published**, so nothing in this plan touches counsel's material.

**Q-AX4 · Nothing tells the applicant their application has been approved.** Raised 2026-09-11 by F4
(4b), and it is the one seam the two-visit flow opens. The driver hands the application over, the
office approves it days later, and the only thing that carries that news is the driver reopening
their own link on the off-chance. The waiting screen therefore promises nothing — it says "keep this
link", which is true — but the honest product sends an email (and later an SMS) the moment
`approved_at` is stamped.

Candidates: (a) email on approval from `approveApplication`, reusing the invitation mailer; (b) let
the recruiter press "tell them it is ready", so the carrier chooses the moment; (c) nothing, and the
recruiter phones them. Recommendation: **(a)**, because the office has already made its decision by
then and a step that can be forgotten is a step that will be. It needs one sentence of copy about a
signature, which is why it is a question rather than a step: the wording sits beside counsel's.

## 5. What this plan deliberately does not do

- It does not touch any disclosure, intent statement or version. (D-AX1.)
- It does not build the packet's 21 placements or the cutover — `APPLICATION-PACKET-PLAN.md` P5/P6,
  blocked on counsel, and building them against `v0-draft` wording would mean building them twice.
- It does not add signer authentication (an access code or an SMS one-time code). That is a real gap
  — the link alone is the credential for four federal authorizations — but the SMS path is dark for
  want of a phone number, and a half-built factor is worse than a named one. Recorded here so it is
  findable.
- It does not add a decline-to-sign path. Also a real gap against DocuSign, also wording-adjacent
  (what a declined application says to the driver is counsel's sentence), deferred with the rest.

## 7. Owner feedback, 2026-09-11 — F1–F5

Six observations after X1–X9 landed. Three were the form's own doing and are small; two change the
**lifecycle** and are not.

**F1 · The form used controls the rest of the product does not.** `apps/web/CLAUDE.md` says
*"FilterSelect (toolbars) vs ComboSelect (forms)"* and the apply flow was the one surface answering a
choice with the browser's native `<select>` — a different chevron, a different focus ring, and on a
phone a native sheet thrown over the page. Every gate passed; nothing reads composition.

**F2 · The employment panel looked mandatory and is not.** Owner: *"most of the drivers are not
remembering all places and exact company names, so this should be much simpler with company name,
and dates from to he worked there, all other things are optional."* They were right and the form was
lying about itself — `applicationEmployerSchema` has only ever required `employer_name` and
`started_on`; everything else is already `.nullish()`. Fifteen controls in one column simply looked
like fifteen questions.

**F3 · Mobile, and text that overlaps or leaves its frame.** A measured sweep at 320/390, not a
reading — the same method that found five defects in X4 and X5 that no test saw.

**F4 · The application must be reviewable and EDITABLE by the office, and signed only after it is
approved.** This is the one that changes the shape of the thing. Today there is no review at all:
`application_invitations` has `consented_at`, `releases_completed_at` and `submitted_at` and nothing
else, the dashboard has no surface that shows a filed application, and the driver's certification is
the last act before filing.

**F5 · Releasing the copy to the driver is an office decision, not an automatic one.** X8 hands the
copy to anyone holding the link the moment the application is filed. That becomes a gate.

### The decisions F4 turns on, answered by the owner 2026-09-11

**D-AX11 · The four authorizations stay UP FRONT; only the §391.21(b)(12) certification moves.**
`SCREENING_PREREQUISITES` gates `psp_record` on `psp` + `fcra_disclosure`, `mvr_order` on
`fcra_disclosure`, and `previous_employer_inquiry` on `previous_employer`. Those four signatures are
exactly what let the office screen — so moving them behind the review would mean **reviewing blind**,
which is the opposite of what a review is for. The driver therefore signs twice, and the second touch
buys something the first cannot: a certification of the document that will actually be filed.

⚠ This is a deliberate reversal of **D-APP4**, which put all signing before the form on the grounds
that *"a second touch loses people"*. That reasoning still holds for the authorizations, which is why
they stay. It does not hold for the certification, because a certification of answers the office has
since corrected is a certification of something else.

**D-AX12 · An office edit is shown to the driver, marked, before they certify.** §391.21(b)(12) is
the applicant's own statement that the entries are true. If the carrier has changed one, an auditor —
or a plaintiff — will ask whether the applicant saw the change. The signing screen marks each edited
answer and shows what it was.

**D-AX13 · An edit is a correction, never an overwrite.** The evidence rule this repository already
holds: corrections are new rows. The draft payload the office edits is not yet a filed application,
so the edit is cheap — but who changed what, and when, is recorded, because the answer being
certified is no longer only the driver's.

### Steps

**F1 · The forms control everywhere** — done when no screen in the apply flow renders a native
dropdown, and a test says so rather than a convention.

**F2 · Three fields and a disclosure** — done when a driver adding a job is asked for the company, the
start and the end, with everything else reachable and marked optional.

**F3 · The mobile sweep** — done when every screen at 320 and 390 has no horizontal overflow, no
clipped text and no control colliding with another, measured in a browser.

**F4 · Review, edit, approve, then sign** — done when an office reader can open a submitted
application, correct it, approve it, and the driver is asked to certify the corrected document with
the changes marked.

**F5 · The copy is released, not served** — done when the driver's download answers "not yet" until
the office releases it.

## 6. Progress log

Append dated lines here. Do not edit the step headings to mark progress — parallel PRs marking
adjacent table rows conflict every time.

- 2026-09-11 — plan written from the audit. Nothing built.
- 2026-09-11 — **X1 MERGED** (#737). `AppMonthField` + `packages/shared/src/jurisdictions.ts`;
  `samsara/location.ts` derives both of its lists rather than holding the only copy. Draft restore
  normalises a stored state, which is what stops a resumed form silently losing one.
- 2026-09-11 — **X9 added** from a defect found while building X2: the application accepts an empty
  date of birth, which both omits §391.21(b)(2) content and creates a draft the resume gate can never
  unlock. Recorded rather than smuggled into X2.
- 2026-09-11 — **X2 built.** Labels, driver-readable messages, inline errors, focus. Two things the
  audit did not predict: `AppFormField` was camelising its ARIA slot props, so every error was
  visible and inaudible; and `AppCombobox` inherited attributes onto its positioning `<div>`, so the
  same was true of every state field. Both fixed in `packages/ui` with their own tests.
- 2026-09-11 — **X2 MERGED** (#738). Two `packages/ui` defects fixed along the way, both older than
  the change: `AppFormField` camelised its ARIA slot props (every field error in the product was
  visible and inaudible), and `AppCombobox` inherited attributes onto its positioning div.
- 2026-09-11 — **X3 built.** The review screen is composed by `reviewSummary.ts`, a pure function, so
  "everything the driver typed is on the page they certify" is an assertion that walks a filled draft
  rather than a claim about markup. It found the omission it was written for on its first run.
- 2026-09-11 — **X3 MERGED** (#739).
- 2026-09-11 — **X4 built, and it is the first thing in this flow ever rendered in a browser.**
  Verified against the built bundle at 320px, 390px and 900px with Playwright route mocks, which is
  what U7 of `RECRUITING-UI-SURFACE-PLAN.md` has been owed since 2026-08-22. Three defects were
  visible there and invisible to every gate: "You are here" collided with a two-line step label at
  320px; disabled step rows stacked `text-ink-tertiary` on the button's own `disabled:` mute; and the
  carrier's questions took a 680px input for a two-word answer beside three-up name fields.
  **Q-AX1 is answered: the rail survives 320px, because the bar indicates and the list navigates.**
- 2026-09-11 — ⚠ **A D-UI9 violation found, older than this plan.** `proof_of_age`'s hint has carried
  "§391.11(b)(1)" since A9. `strings.test.ts` walks `APPLY_COPY` and the carrier's questions are not
  in it, so the gate had a blind spot exactly the shape of the thing that got through — and it only
  surfaced because D-AX7 moved that question onto a screen one page test happened to check. The
  citation is gone and the gate now walks the questionnaire definition too.
- 2026-09-11 — **X4 MERGED** (#740).
- 2026-09-11 — **X5 built.** The employment screen is a list plus one panel per job, not 107 controls.
  The coverage meter derives from `employmentCoverage` in shared rather than computing a second
  answer — including the part that is easy to get wrong, that a hole in years four to ten is not a
  defect. **Q-AX2 is answered and D-AX2 stands:** the counter still reads "Step 4 of 9", because the
  jobs are a panel and not extra screens, so the bar never stalls.
  Two more defects found in the browser at 390px: the job list truncated its own dates
  ("Driver · 02/01/2025…"), and `Remove` sat a thumb's width from `Change` on a list row — it now
  lives in the panel, where the driver can see what they are deleting.
- 2026-09-11 — **X5 MERGED** (#741).
- 2026-09-11 — **X7 built.** The certificate of completion is a page of the filed application, and it
  prints what the database has held all along: `file.ts` was selecting five of the eight columns
  `record_driver_release` writes, so the carrier's evidentiary record was better than the document it
  files. ⚠ Two things found while building it: the per-instrument pages were headed
  `Authorization — fcra_disclosure`, a machine token on a page whose reader is an auditor — the same
  defect D-AX3 fixed on the driver's screen; and `render.ts` crossed the 500-line budget, so the
  certificate is its own module. The column list is pinned by a test of the QUERY, because that is
  where the defect lived and no test of the renderer could ever have seen it.
- 2026-09-11 — **X7 MERGED** (#742). ⚠ Its CI run failed once on
  `inventory/labelPdf.test.ts` — a file this PR does not touch, not reproducible in five full local
  runs, and green on re-run. That is the open api flake in
  [[api-test-flake-is-not-timeouts]]; this is one more measured instance of it.
- 2026-09-11 — **X8 built.** `GET /api/public/application/:token/document`. ⚠ The first version of its
  org-scope test was worthless and a mutation proved it: it gathered every `eq` against
  `driver_applications` and found an `org_id` among them, so it passed with this module's own filter
  deleted — `ensureApplicationPdf` queries the same table and its filter answered for both. Replaced
  with `expectOrgScoped`, which `apps/api/CLAUDE.md` names for exactly this reason.
  **Q-AX3 stands as recommended: the download ships, the completion email does not** — its wording is
  counsel's material and nothing in this plan touches that.
- 2026-09-11 — **X8 MERGED** (#743).
- 2026-09-11 — **X9 built, and its own step text was wrong.** See the corrected §X9: a blank date of
  birth left the draft UNGATED rather than un-unlockable. Requiring it in the contract closes that
  at the first screen, because `APPLICATION_SECTION_KEYS.identity` owns the field and the wizard
  validates each screen with the contract's own object.
  ⚠ Doing it surfaced a second defect immediately, and **X2's totality test is what caught it**: Zod
  runs a `superRefine` after a failed regex, and `dateOfBirthIssue`'s unparseable branch answers with
  the regex's own sentence — so a blank date of birth produced two issues for one mistake, one of them
  phrased for whoever wrote the schema, arriving on the driver's screen as `code: "custom"` (which
  every caller treats as human-written). Guarded, and pinned in both packages.
- 2026-09-11 — **X6 built, and the plan is complete but for counsel.** The thumbnail is this
  session's object URL and nothing else: the server returns slots and dates rather than pictures on
  purpose, and re-serving them would mean a signed read URL per slot on an unauthenticated surface on
  every page load. A capture from a previous visit shows "Received" and no picture, which is true.
  One URL per slot at most — retaking replaces and revokes, so the rule the existing revoke stated
  ("a phone should not hold four hundred-kilobyte blobs alive because a licence was re-taken four
  times") still holds. Both leak directions are mutation-proved.
- 2026-09-11 — **F1 + F2 MERGED** (#746). The forms control everywhere, and a job panel that asks
  for three things.
- 2026-09-11 — **F3 MEASURED CLEAN — no fixes were needed.** All nine screens plus the job panel,
  at 320 and 390, against the built bundle: no horizontal overflow, no clipped text, and no
  colliding visible text. ⚠ Recorded with the METHOD, because the first two runs of the detector
  both lied and a future reader should not trust a bare "it's fine":
  · comparing every element on the page flagged the drawer's contents against the page behind the
    scrim — an overlay is SUPPOSED to sit on top, so elements in different positioned contexts must
    not be compared;
  · and it then flagged the panel's own labels against its footer, because an element scrolled out
    of an `overflow-y-auto` container still reports a rect that intersects its siblings. Anything
    clipped by a scrolling ancestor has to be excluded before the comparison means anything.
  Both traps make a *dirty* result out of a clean page, which is the safe direction — but a third
  version of the same mistake could as easily hide a real one.
- 2026-09-11 — **F4 begun.** 0336 adds the five review/approval columns and nothing reads them yet:
  a column and its first reader ship in two merges, because Railway serves a merge before
  `migrate.yml` applies its schema. `application_edits` is deliberately NOT in this migration — a
  table with no writer fails `lint:table-producers`, and there is no code here to write it.
- 2026-09-11 — **F4 (2/n) built.** 0337 `application_edits` + `applicationReview.ts` + three routes.
  The edit window closes at **approval**, not at signing: it would be easy to leave it open while the
  draft is still a draft, and it must not be — approval is what tells the driver *this document, now*,
  and an answer moving underneath them between being asked and signing is what this flow exists to
  stop. Every edit is applied to a COPY and the copy re-parsed with `driverApplicationObject.partial()`
  before anything is written, so an office cannot leave a draft the driver is then unable to certify;
  `.partial()` because a draft is allowed to be unfinished, and parsing it whole would refuse most of
  the corrections an office actually wants to make.
  ⚠ A cross-tenant test here was worthless as first written — `supabaseRecorder` records `.eq()` and
  does not apply it, so a flat array answers another carrier's query with this carrier's row. It uses
  a function fixture now, which is what [[supabase-recorder-does-not-filter]] has been saying.
- 2026-09-11 — **F4 (2/n) MERGED** (#749). ⚠ Its first CI run failed `gates`: I ran eleven lint
  scripts and not `lint:table-writers`, which pins every table write site and wants every live table
  assigned a module. Three new write sites and one unowned table, caught by exactly the manifest that
  exists to catch them.
- 2026-09-11 — **Carrier-owned wording built** (0338), answering the owner's screenshot. The office
  publishes its own text for the six instruments; anything unpublished keeps the code's `v0-draft`
  placeholder, so **every existing refusal stays exactly where it was** and the whole change is
  behaviour-preserving until a carrier publishes. `loadCarrierWording` is called INSIDE
  `submitApplication`, `recordRelease` and `recordEsignConsent` rather than passed in — a caller that
  could forget is a caller that could open the signing gate on placeholder text — and a failed read
  degrades to the placeholders, which is the only safe direction.
  ⚠ The version is **assigned**, never typed: `driver_authorizations` stores the text and the version
  together, so two versions must never be able to mean two different things.
  ⚠ The table was reshaped once, by `rls.test.mjs`. Its first CHECK made the row's shape depend on
  the VALUE of `instrument`, and the tenant-isolation matrix seeds generically from the catalog and
  fills only NOT NULL columns — `supabase/CLAUDE.md` is explicit that an unseedable table is a
  failure, not a skip. The fix was a better design: `body` always holds the text as shown (composed
  at publish time for the consent), and `clauses` records what it was composed from.
- 2026-09-11 — **Carrier-owned wording MERGED** (#750), and the settings screen built on top of it.
  `/settings/application-wording`, gated `manage("settings")` — a recruiter processing applications
  has no business rewriting a federal authorization, and the blast radius of a bad edit is every
  signature taken afterwards. The page leads with the COUNT of unpublished instruments, because it is
  the only number on it anybody can act on: until it is zero, nothing an applicant does works.
  The 7001(c) consent is asked for as six fields rather than one box, and the editor is pre-filled
  with whatever is live — for an unpublished instrument that is our placeholder, which is the point:
  the office edits a starting draft rather than facing six empty boxes.
  ⚠ Three gates caught things a reading would not have: `lint:surfaces` (a permission granting
  nothing, because the surface named a path the route snapshot did not have), `routeReachability`
  (a page nothing links to — the reason that test exists is that ten of eleven `/settings/*` routes
  were on the settings page and one was reachable only by typing the URL), and the route-table probe
  list, which refuses a new route it has not been told to expect.

- 2026-09-11 — **F4 (3/n): the review drawer**, on the applicant's record page and mounted from it
  (the owner chose "full-width drawer from that page"). The invitation row emits which application;
  the page opens `ApplicationReviewDrawer`. It renders the driver's OWN summary — `buildReviewSummary`,
  the same function their certify screen uses — above a correction list built from the saved payload,
  and that split is deliberate: reading a document wants `04/01/2026` and "Illinois (IL)", correcting
  a field wants exactly the characters that are stored, because those are the characters being
  replaced. `SlideOver` gained an `xl` size rather than a bespoke panel beside it.
  ⚠ **The edit path did not work at all, and its tests could not see it.** `editApplication` parsed the
  saved draft with `driverApplicationObject.partial()` — the CERTIFIED contract, which is `.strict()`
  — and a real autosaved payload carries `questionnaire`, which the certified document does not. Every
  correction to every real application came back "That is not a valid answer for this field". The
  fixture was a hand-written contract-shaped object, so nothing failed. Fixed with
  `applicationDraftPayloadSchema` in shared (the draft as it is actually written), and the fixture is
  now draft-shaped; reverting the schema fails three tests.
  ⚠ **`prior_failed_pre_employment_test` was never autosaved**, from the day P8 added it. §40.25(j)'s
  two-year question — by the form's own reckoning the most consequential answer on it — was lost by any
  driver who ticked it, closed the tab and came back, silently, because `fromDraftPayload` floors every
  missing key at the empty draft. Fixed, and pinned by a TOTALITY test over every key of a maximal
  draft rather than another spot check, which is what let it through.
  ⚠ Two measured layout defects, found in the browser at 320/390 and not by reading: `PspRecordsSection`'s
  two `shrink-0` buttons held the applicant record page 439px wide at every viewport (the whole page
  scrolled sideways on a phone, which also pushed the fixed drawer's panel off the right of the screen),
  and `SlideOver`'s panel had no `min-w-0`, so one long unbroken string — an email address — held the
  drawer wider than the phone it was open on. `break-words` does not reduce min-content width; only
  `min-w-0` on the flex item lets the panel take the width it is given.
  ⚠ And nothing may sit between `TransitionChild` and `DialogPanel`, not even an HTML comment:
  `as="template"` requires exactly one child node, and adding one took every drawer in the app down.
- 2026-09-11 — **F4 (4a/n): the server side of the hand-off.** `POST /api/public/application/:token/review`
  stamps `review_requested_at`, and `GET /:token` now serves all five phases plus what the office
  corrected. Nothing changes for a driver yet — the applicant's page still submits directly — and that
  ordering is deliberate: refusing an uncertified submission before the client knows to hand over first
  would break the flow between two merges, so the refusal is F4 (4c), after the page moves.
  ⚠ The hand-off endpoint takes NO body. The answers are already saved — the form autosaves after every
  screen and the office opens that draft — and a body here would be a second copy of the application
  arriving by a different road, with the two free to disagree. Completeness is not re-checked either:
  the page runs `driverApplicationSchema` before calling, the binding parse is at certification, and a
  second check here would have to be written against the DRAFT shape, which means restating the
  contract in a second vocabulary.
  ⚠ `applicantVisibleEdits` deliberately drops `edited_by`. The driver is owed what changed about their
  own statement before they swear to it; which member of staff typed it is the carrier's internal
  record, and naming an individual to an applicant is a different thing.
  ⚠ Idempotent through the WRITE FILTER (`.is("review_requested_at", null)`), not the read above it:
  a check-then-write has a gap and this is a button pressed twice on a phone with one bar.
  `applicationIntake.ts` reached 506 lines with the two new phases, so the four-authorization ceremony
  moved to `applicationReleases.ts` — a real seam (FCRA §604(b)(2) makes each instrument its own
  document, signed on its own) rather than a cut made for the line count.
- 2026-09-11 — **F4 (4b/n): the applicant's page becomes two visits.** The first ends at "Check your
  answers" with **Send it to <carrier>**; the second opens on a signing screen that shows what the
  office changed, the whole document, the §391.21(b)(12) certification and the signature.
  `APPLICATION_FILLING_SECTIONS` is the wizard's order now — the same nine sections minus `certify`,
  which is not a screen of the first visit — so the counter reads "Step 8 of 8" and the step list
  stops at "Check your answers" rather than offering a screen the driver cannot reach from there.
  ⚠ **The Social Security number moved to the signing screen, and it was forced rather than chosen.**
  D-APP3 keeps it out of every saved draft, and the application is now signed on a SECOND visit — so a
  number typed on the first is gone by then. Asking beside the signature is also the better privacy
  answer: typed once, sealed immediately, held nowhere in between.
  ⚠ `applicationBeforeCertificationSchema` uses `.extend()` and NOT `.omit()`. `driverApplicationObject`
  is `.strict()`, so omitting `certified`/`signed_name` makes them UNRECOGNISED keys — and `toApplication`
  always emits both. The first version did exactly that and refused every hand-off with
  `Unrecognized keys: "certified", "signed_name"`, an error naming no field on any screen. Pinned by a
  test that fails when the `.extend` is swapped back for an `.omit`.
  ⚠ Three files hit the 500-line budget at once and each was split along a real seam, not a convenient
  one: `strings.flow.ts` (the ceremony and lifecycle copy — everything left in `strings.ts` is a
  question the form asks), `applicationRules.ts` (the rules that span fields, imported back by
  type-only reference so there is no runtime cycle), and `ApplyPage.vue` → `ApplicationFiledCard.vue`,
  `DraftUnlockGate.vue`, `ApplyIssueList.vue`.
  Measured in a real browser at 320/390/1280 on all three screens: no sideways scroll, nothing out of
  frame. **Q-AX4 is open and is the visible seam** — nothing tells the applicant their application has
  been approved, so the waiting screen promises no email and says "keep this link" instead.
- 2026-09-11 — **F4 (4c/n): the certification is refused until the office approves.** `submitApplication`
  now reads `applicationAwaitsSignature(phasesOf(invitation))` and answers `not_yet_approved` (409, not
  500) to anything else. §391.21(b)(12) has the applicant swear every entry is true and complete, and
  the office can change an entry between the driver sending it and the driver signing it — so a
  signature taken before the review is a signature on a document that may not be the one filed, and
  `submitted_at` spends the phase, so that file could never afterwards be corrected.
  ⚠ It shipped THREE merges after the phase column and one after the page that hands the application
  over, in that order deliberately: a gate landing first would have refused every submission from the
  client still in the field. That is the deploy-window rule applied to behaviour rather than to a
  column, and it is the reason F4's server half was split 4a/4c around the page in 4b.
  ⚠ Read through the shared predicate rather than from `approved_at` directly — the office's drawer,
  the applicant's page and this route all read the same three timestamps, and three readings are three
  chances for two screens to disagree about whether somebody may sign.
  The submit fixture became `submittableInvitation` and now carries the review and approval stamps; it
  has grown twice for the same reason (the consent in 2026-08-23, these two now), each time because a
  gate that had been inert became real, and each time the fixture started saying out loud what a
  lawful submission rests on.
- 2026-09-11 — **Handoff written: `HANDOFF-2026-09-11-REVIEW.md`.** It carries the audit of the
  owner's hiring flow against what is built (§3 there), the two "nothing is happening" defects and
  their single root cause (§4), and the recommended queue (§5). ⚠ One correction on record: surfacing
  `crossMatchEmployment` was described to the owner as cheap and it is not — P12's three derived PSP
  tables do not exist in any migration, so the function has nothing to read.
- 2026-09-11 — **F5: the draft is visible.** The owner filled in their own test application and was
  told **"Not started"** — on two screens, for two different reasons, with one cause: *nothing
  staff-facing read the draft*. The applicant board computed its stage from `driver_employment_history`,
  written only at SUBMISSION; the invitation row read `consented_at`, a stamp never set while the
  carrier's wording is draft, which is the state of every carrier today. So a driver six screens in, an
  application waiting on the office, and one already sent back to be signed all read the same as an
  untouched link.
  `applicationProgress(phases, hasDraft)` in shared is the one answer all three surfaces now give —
  the office's drawer, the board and the invitation row — and the board gained `filling_in`,
  `awaiting_review` and `awaiting_signature` between "not started" and the file's own stages. ⚠ The
  application's state only leads UNTIL it is filed: after that the employment rows exist and what a
  recruiter needs is what the FILE is missing, so `certified` falls through rather than being a stage.
  ⚠ The "Waiting on" column answers WHO for those three stages. Listing "Employment history" beside
  "Waiting for you" would tell a recruiter to chase a driver for something the carrier is sitting on.
  ⚠ A revoked link is not an application in progress, and its draft row survives the revocation — both
  the board and the row read `revoked_at` first, pinned by a test each.
  ⚠ `has_draft` is the row's EXISTENCE, never its payload: a list endpoint carrying everybody's answers
  would put dates of birth and licence numbers into a response nobody asked for.
  Traps: a PostgREST `.select()` built by string concatenation loses its inferred types and every read
  becomes `GenericStringError` — the column list must be one literal. And `apps/web/src/lib/badges.ts`
  crossed the 500-line budget, so the recruiting badges moved to `badges.recruiting.ts` (one reader,
  the recruiter; same policy, second file).
