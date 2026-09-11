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

## 6. Progress log

Append dated lines here. Do not edit the step headings to mark progress — parallel PRs marking
adjacent table rows conflict every time.

- 2026-09-11 — plan written from the audit. Nothing built.
