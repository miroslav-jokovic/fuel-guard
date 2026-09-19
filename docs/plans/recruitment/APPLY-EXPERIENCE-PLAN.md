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

**Q-AX5 · A rotated invitation cannot be re-sent, and the draft behind it is then unreachable.**
Raised 2026-09-14 while pre-flighting A2. `mintInvitationToken` keeps a SHA-256 and nothing else
(deliberately — `applicationIntake.ts`'s header argues it, and 0232 rejected sealing a copy), so the
plaintext link lives only in the email that carried it. The nudge sweep can mint a replacement on the
SAME invitation row — that is the one path that rotates without costing the driver their typing — but
it fires **once** (`nudged_at`, and the copy promises no second reminder), and no staff route exposes
it: `/application-invites` is list, create, revoke. So a driver who loses the nudge email has a draft
nobody can reach, and the only remedy is a new invitation, which `application_drafts` keys separately
and therefore opens EMPTY.

That is not hypothetical. It is the state of the one finished draft in production: Marija Varmeda's
`certify` draft on `6e03a1e5…`, reachable only through the 2026-09-13 19:28 email.

Candidates: (a) a staff "re-send the link" action that rotates the hash on the existing invitation
and returns the link the way create already does — the sweep's own mechanism, exposed and audited;
(b) let the sweep fire more than once, which changes a promise made to the driver in writing;
(c) carry the draft across invitations by keying it on `driver_id`, which is a bigger change and
loses the per-invitation isolation D-APP16 leans on; (d) nothing, and re-type.
Recommendation: **(a)** — it is the smallest change, it reuses a rotation the code already performs
and documents, and it fixes the case where the driver has done the most work and is therefore owed
the most. ⚠ It needs the same audit rule the create route follows: the id and the expiry, never the
token or its hash.

**Q-AX6 · Re-inviting an applicant from the board silently creates a second them.**
Measured 2026-09-14: Silvicom holds **three** `drivers` rows named Marija Varmeda, same email, all
`identity_source: manual`, created 09-04, 09-11 and 09-14 — one per invitation, each with its own
`application_invitations` row and therefore its own draft.

The cause is not a bug in either component, it is the pair of them. `InviteApplicantDrawer` is the
board's "Invite an applicant" action and it always runs `useCreateApplicant` before
`useCreateApplicationInvite` — by design, and its header argues why (an applicant IS a `drivers` row
with `status = 'applicant'`, and there is no endpoint that makes one and mints the link together).
The re-invite path exists and is correct: `ApplicationInviteCard`, on the applicant's own page, mints
a link against the driver already there. Nothing on the board points at it, and nothing in the drawer
notices that a person with this name and address is already on the board.

So the trap is the entry point, not the code: the obvious button on the applicant board is the only
one a recruiter will find, and using it twice for one person is how a roster acquires duplicates that
`merge_driver` then has to reconcile — against a cascade rule no gate checks.

Candidates: (a) the drawer looks for an existing `applicant` with the same name + email and offers
"invite them again" instead of creating a second row; (b) the applicant board grows a re-invite action
per row, pointing at the card's path, and the drawer stays strictly for people who are new;
(c) a uniqueness constraint on (`org_id`, lower(`email`), `status='applicant'`), which refuses rather
than guides and would have to say something useful when it fires; (d) nothing, and merge the
duplicates when they appear.
Recommendation: **(b) then (a)** — (b) is small, removes the reason to misuse the drawer, and needs no
new matching rule; (a) is the guard for the recruiter who reaches for the drawer anyway. ⚠ Do not do
(c) alone: an applicant with no email is legal here (the field is optional), so the constraint cannot
cover the case that actually produced these three.

⚠ Whatever is chosen, the two orphan Marija rows need deciding before the roster is trusted — see
`merge_driver`'s cascade rule, which no gate enforces.

**Q-AX7 · The office can add an employer but cannot remove one, and that is on purpose for now.**
Shipped 2026-09-14 with the add. The reason is `application_edits`: it stores a contract PATH, so
`["employers", 2, "city"]` names a row by its INDEX. Appending is the only mutation that leaves every
already-recorded path pointing at the row it was written against — an insert or a splice silently
re-points all of them, and the driver's "what changed" list then describes the wrong employer.

The case that needs it is narrow but real: a duplicate, or a job the driver names and then corrects
to a different company. Today both are handled by editing the row's fields.

Candidates: (a) a `removed_at` marker on the row, so the array never shifts and the renderer skips
it — needs a contract field on `applicationEmployerSchema`, which is counsel-adjacent since the
packet prints from it; (b) store edits against a stable row id rather than an index, which is the
right long-term shape and re-writes 0337's `path` semantics; (c) let the office blank the employer's
name and treat an unnamed row as absent, which is a workaround wearing a feature's clothes and would
put an empty row in a signed document; (d) nothing.
Recommendation: **(b), when something else forces 0337 open** — it fixes the cause rather than the
symptom. Until then (d), because the add is what the office visit actually needs and a remove built
on indexes would be a correctness bug the driver signs.

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

**F6 · A printable preview at any stage** — done when an office reader can open the §391.21 document
as a PDF while the driver is still filling it in, marked on every page as something nobody has
signed. Raised by the owner's audit (`HANDOFF-2026-09-11-REVIEW.md` §5, queue item 2): the review
drawer answers *what did they say*, and does not answer the things an office does with an application
— read it away from the desk, print it, put it in front of somebody who has no login, post it to a
terminal.

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

- 2026-09-11 — **F6: the application prints before it is signed.** The SAME renderer over
  `application_drafts.payload` rather than a draft-shaped second one — the office is previewing the
  document that will be FILED, and a second rendering of the same answers would be a second source of
  truth about what a §391.21 application looks like, with the labels drifting first. `preview.ts`
  gathers, `stamp.ts` marks, and one button in the review drawer opens it.
  ⚠ **It refuses once the application is filed**, and that is the decision worth keeping. A certified
  application already HAS a document: rendered at submit, hashed into `documents.sha256`, cited by its
  §391.51(b)(1) `qualification_records` row and offered on the applicant's own page. Re-rendering it
  here would hand somebody a second, uncited copy of a federal record whose bytes do not match the one
  in the file — so the route answers 409 and says where the real one is, and the drawer's button is
  not there to press.
  ⚠ **Words, not a colour** — D-AVI22's ruling next door, applied before it could be re-learned: the
  annual-inspection preview used to stamp its values in red and the office read that as the product
  printing in red. The ink here is identical to the filing's and the band says "DRAFT - NOT A SIGNED
  APPLICATION" across every sheet, once per page, because a preview gets printed and separated and a
  loose page has to carry its own status. The §391.21(b)(12) block prints no name, no date and no
  drawn mark — a signature beside an uncertified statement is the one thing on these pages that could
  be mistaken for evidence — and a test pins that the applicant's name, which legitimately appears in
  the (b)(2) block, in the footer and beside each release they really did sign, never appears there.
  ⚠ **A blank page in the middle of the document, older than this plan and shared by every PDF this
  repo draws.** The preview rendered 8 pages and page 2 read "DOT-regulated" and nothing else. A
  label and its value are drawn at the same `y`, captured before either; close enough to the foot of
  the sheet pdfkit turns the page under the label, and `field()` then advanced the NEW page's cursor
  to a coordinate on the OLD one, pushing the next row off the sheet again. Fixed in `lib/pdfDraw.ts`
  (turn the page before the row, and keep the cursor pdfkit actually left) with its own test; the same
  document is now 5 pages. It was invisible to every gate and to the unit suite — it only shows up if
  somebody rasterises the output and looks at it.
  ⚠ `openInspectionPdf`/`downloadInspectionPdf` moved to `@/lib/documentDownload` and are re-exported
  from where they were. `lint:boundaries` forbids `features/apply` importing `features/maintenance`,
  correctly — and the choice was a copy of those twelve lines or a promotion. A copy is a workaround
  with a delay fuse.
  Measured in a real browser at 320/390/1280 against the built bundle: the footer's three buttons
  stack with the primary at the bottom, nothing clips, no sideways scroll, and the button fetches
  `/api/recruitment/applications/:id/preview.pdf` and opens the bytes as a blob.
  **Q-AX4 is still open** — nothing yet tells the applicant they have been approved.

- 2026-09-11 — **Q-AX4 ANSWERED and built (D-AX14): approval tells the applicant.** Candidate (a) as
  recommended — sent from `approveApplication` itself rather than from a button a recruiter presses,
  because the office has already made its decision by then and a step that can be forgotten is a step
  that will be. Until now the only thing carrying the news that an application had been approved was
  the driver reopening their own link on the off-chance, while the recruiter's drawer said "the
  applicant has been asked to sign it" and nobody had asked them anything.
  ⚠ **THE NOTICE CARRIES NO LINK, and that is the decision rather than an omission.**
  `application_invitations` stores a SHA-256 and nothing else (0220) — the plaintext token is returned
  once, at mint — so at approval there is no link to send. The abandonment sweep's answer is to ROTATE
  the token and email the new one (0232), and that answer is refused here: `APPLY_FLOW_COPY.handoff`
  has already told this applicant *"keep this link — it is where you will sign, and it still works"*,
  and approval is the exact moment they act on it. Rotating would break the product's one promise to
  them at the one moment it is load-bearing. It would also open a lockout this flow cannot afford —
  a nudge that fails to send costs a driver an unfinished form; an approval that fails to send after
  a rotation would cost them a COMPLETED application they can no longer reach, and a replacement
  invitation resumes an EMPTY one.
  So the email names the EARLIER EMAIL'S SUBJECT LINE and sends them to their own inbox. Both
  templates now read that subject from one `applicationInviteSubject`, because two literals would
  drift the first time somebody improved one of them and the failure would be an applicant searching
  their mail for words that were never sent. A third option — a second `sign_token_hash` column so
  both links work — is the honest fix and was costed and declined for now: a migration plus a change
  to token lookup at intake, in two merges. It is the upgrade path if the inbox search proves to be a
  real drop-off.
  ⚠ **Sent AFTER the stamp and after the audit, and never able to change either.** Same ordering the
  invitation route uses and for a sharper reason: `approved_at` is what the certification route reads,
  so an approval rolled back because a mail provider was rate-limited would leave a driver who is
  ALLOWED to sign sitting behind a state that says they are not. A refused send is a sentence in the
  drawer and a line in the log — `no_address`, `mail_disabled`, `send_failed` — and the two that need
  a human say so and name the chase.
  ⚠ **Exactly-once falls out of the existing idempotence.** `approveApplication` already returned
  early on `approved_at`, so a double-click reports `already_notified` and attempts nothing; a driver
  told twice in one second that their application is ready learns nothing the second time and reads a
  system that stutters. No new column was needed to get that.
  A text goes first and the email goes regardless, as the nudge does — every gate that can refuse a
  message leaves the email untouched, so a refusal is never an applicant hearing nothing. It stays
  held on `no_consent` until 10DLC completes.
  The waiting screen now promises the email; its comment explains that the promise is precisely why
  the notice does not rotate the token.
  Proved by mutation rather than asserted: removing the send fails three tests, notifying on a repeat
  approval fails the double-click test, sneaking a link into the template fails "carries no link", and
  changing the invitation's subject alone fails the drift pin.

- 2026-09-13 — **Handoff written: `HANDOFF-2026-09-13-QUEUE.md`, and the queue is reordered by a
  measurement rather than by an estimate.** Production was counted for the first time since the flow
  was built: **`org_disclosures` holds 0 rows**, so no carrier has published any instrument, and
  **4 real drafts are stuck against `WORDING_NOT_FINAL` — one of them on `certify`, the last screen.**
  The blocker has been stated since §1.1 of this plan; what is new is that it is no longer
  hypothetical, and that **only half of it is counsel**: #751 made publishing self-service, so a
  carrier willing to adopt the text can unblock all four this afternoon without an engineer.
  ⚠ The PSP side was counted too, and it reorders §5's item 3: **one** `psp_requests` row exists
  (succeeded, 4 inspections, 4 crashes, 2 distinct inspection DOT numbers), and that driver has **zero**
  `driver_employment_history` rows and **zero** invitations. `crossMatchEmployment` compares DECLARED
  employment against PSP's carrier-date pairs, so the panel would today render for one driver and
  report both DOT numbers as unlisted carriers — against somebody who never filled in an application.
  P12 is still worth building (the violation index is a compliance artifact in its own right, and one
  real report is a genuine fixture), but the panel on top of it must not be described as imminent
  value; that error is already on record once, ten lines above.
  ⚠ A trap recorded for whoever builds P12: **`response_raw` is a one-element ARRAY** and the records
  sit at `response_raw[0].driverInformationResponse.driverRecord.{inspectionRecords, crashRecords}`,
  not at the top level as §5b.1's table and the OpenAPI document both imply. Build the deriver's
  fixture from the production row. Both 2026-09-11 defects were a fixture that did not resemble
  production, and this is the same trap already loaded.
  The lesson worth keeping beyond this feature: **ask the database before ordering a queue.** Two
  items were ranked by size, and neither ranking survived one afternoon of counting rows.

- 2026-09-13 — **The owner ruled §3.1 path (b): the carrier adopts the drafted text and publishes it
  itself, rather than waiting for counsel.** The runbook is `WORDING-PUBLISH-RUNBOOK.md`; the publish
  is six pairs of clicks and no typing, because the editor pre-fills with whatever is live and for an
  unpublished instrument that is our placeholder. What this entry records is everything that had to
  be true before those clicks were safe, because **publishing is what arms the defects below** —
  every one of them was invisible while `org_disclosures` held zero rows.
  ⚠ **The §390.32(d) consent gate was a no-op on three of the four write paths, and the release path
  wrote a signature.** `requireEsignConsent(invitation, wording)` carried a default — the code's
  placeholders — under a comment asserting that a forgetful caller therefore failed CLOSED. That is
  true of every other function reading a version string and **exactly backwards for this one**: the
  gate refuses only while the consent CAN be given, so `v0-draft` means "do not ask". `saveDraft`,
  `openSession` and `recordRelease` all took the default. Measured against a seeded `org_disclosures`
  with no consent given: draft save **200**, capture **201**, release **201 with a
  `driver_authorizations` row written** — an electronic signature from somebody who had never agreed
  to sign electronically, which is the precise gap A4 exists to close. Submit was the only one that
  passed the carrier's wording and the only one that refused. The parameter is now required, so the
  type system asks the question instead of a comment; the same misleading sentence over
  `applicationWordingIsDraft`'s default (where the polarity genuinely is safe) is corrected in place
  rather than left as the trap's instruction manual.
  ⚠ **The cause is a test idiom, and it is worth more than the bug.** Every existing test publishes
  by mocking `ESIGN_CONSENT.version` or `DISCLOSURES[p].version`. Since 0338, production publishes a
  ROW and the constants stay `v0-draft` for ever — so a function that reads the constant is a
  function no such test can question. `publicApplication.test.ts` now has a block that seeds
  `org_disclosures` instead; all five of its assertions were proved by mutating the call sites back.
  ⚠ Two more the publish would have armed, both in `routes/authorizations.ts`. The office recording a
  wet signature composed from the code catalogue, so the same instrument for the same carrier would
  read `v1` on the driver's phone and `v0-draft` on the paper copy — one file, two texts. And a
  revocation named the CURRENT catalogue's version rather than the grant's, which the route's own
  comment had ruled out in writing; revoking a `v1` grant would have filed it under `v0-draft` and the
  append-only history would stop joining up. Both now read what they claimed to. The staff path still
  has no draft refusal, deliberately: whether the office may record a wet signature on placeholder
  text is counsel's question, and adding the refusal would withdraw a capability rather than fix one.
  ⚠ **And the count in `HANDOFF-2026-09-13-QUEUE.md` §2.1 needs correcting: publishing frees ONE
  application, not four.** Measured 2026-09-14 00:34 UTC — of the four drafts, Vince's link expired
  2026-09-12 and Tanja's 2026-09-09, and the fourth is revoked in the QA org. Only Marija's
  `certify` draft sits on a live link. A replacement invitation resumes an EMPTY form, so the other
  two drafts do not follow their drivers to a new link. ⚠ That live link **was rotated by the
  abandonment sweep at 2026-09-13 19:28 UTC** (`nudged_at` set, `expires_at` exactly fourteen days
  later): the link she was originally sent is dead and the one in the nudge email works, which is
  the risk the handoff named the day before it happened. Every invitation in production went to a
  `@silvicominc.com` office mailbox rather than to the applicant.

- 2026-09-13 — **The wording to publish is the CARRIER'S, not ours — and their lawyers already wrote
  three of the six.** The owner asked whether the text behind `/settings/application-wording` was the
  Excel application they supplied. It was not: it was `authorizationContract.ts`, six placeholders an
  engineer typed. Meanwhile `docs/plans/recruitment/APPLICATION.xlsx` — already in the repo, already
  the source of truth for the printed packet — carries counsel's own version of the same
  instruments. Publishing ours beside their paper packet would have given one driver's file **two
  texts for one instrument**, with nothing afterwards able to say which they read. That is the defect
  this entry exists to have avoided rather than to have fixed.
  `packetWording.ts` transcribes **pages 19 (FCRA), 14 (past-employment / §40.25 / §391.23(d)(e)) and
  21 (urinalysis)**, with the carrier's own affirmation sentence off each page as the `intent`. The
  route serves it, and the page offers **"Use our packet's wording"** — ⚠ which fills the editor and
  stops. Nothing publishes without somebody reading it and pressing Publish, because adopting a legal
  instrument is the carrier's act and not a button's; both halves of that restraint are pinned and
  mutation-proved (pre-loading it silently, or showing the button where the packet has no text, each
  turn a test red).
  ⚠ **Two registers, because one rule does not cover both kinds of repair.** 19 spelling repairs
  under `packetText.ts`'s existing guard — the word count may not change, which is the cheap check
  that catches a clause deleted under cover of a typo fix. And **four that change characters**, each
  carrying its own argument: `1681-168lu`→`1681-1681u` (⚠ a statutory citation — an OCR L for a 1),
  `paragrafs (d) and €`→`paragraphs (d) and (e)`, and two split/joined words. Seven further defects
  are recorded and **left standing** (`with` for `wish`, a missing `time`, a missing `of`, `they` for
  `the`), with a test asserting they are still there so a tidy-up cannot quietly redraft an
  instrument. `WORDING-REVIEW-2026-09-13.md` is the sheet counsel reads.
  ⚠ **The packet answers for three of the four instruments the applicant signs, and has NOTHING for
  `psp`** — searched, not assumed: no Pre-Employment Screening Program, no MCMIS, no §382.701
  anywhere in the workbook's 697 strings, and a test pins that. So the applicant's path stays blocked
  on one instrument, and §5 of the review puts three candidate answers to the owner with a
  recommendation (ask counsel for one page — the smallest ask, and the only one of the six gating a
  live vendor call). Also recorded: page 18 IS an MVR authorization the carrier's lawyers wrote and
  this product has nowhere to put, and **page 3 combines a consumer-report disclosure with a general
  liability release**, which is the combination FCRA §604(b)(2)'s "solely" requirement is about —
  which is why page 19 alone was adopted and page 3 was not merged into it.
  The workbook reader moved to `src/testing/packetWorkbook.ts`: `packetStatic.test.ts` and
  `packetWording.test.ts` now check their transcriptions against one parser rather than two.

- 2026-09-13 — **PSP was never the carrier's to write: FMCSA publishes the disclosure and mandates
  it word for word.** The entry above left `psp` as the one instrument nobody had text for, and put
  three candidate answers to the owner. All three were wrong, because the owner knew where to look —
  the form is on the official site. Downloaded from
  `psp.fmcsa.dot.gov/PspApi/documents/PSPDisclosureandAuthorizationForm.pdf` (dated 2/11/2016), and
  both the PDF and its `pdftotext` extraction are committed under
  `docs/plans/recruitment/psp-disclosure/` so `pspDisclosure.test.ts` can compare every published
  paragraph against them. Its own header: *"THE BELOW DISCLOSURE AND AUTHORIZATION LANGUAGE IS FOR
  MANDATORY USE BY ALL ACCOUNT HOLDERS"*, and its closing notice: *"The language must be used in
  whole, exactly as provided… must exist as one stand-alone document… may NOT be included with other
  consent forms or any other language."*
  ⚠ **So this one instrument gets NO repair register, and the absence is the design.** The carrier's
  own pages had their typos fixed under D-PKT9 — ⚠ **reversed 2026-09-14 by D-PKT11, so nothing is
  repaired anywhere now**; improving FMCSA's spelling would in any case breach the
  account-holder agreement the PSP API token is issued under. The only thing done to the text is
  collapsing the PDF's hard line-wraps.
  ⚠ **And publishing anything else for `psp` is REFUSED by name** — `missingPspParagraphs` compares
  the submitted body against all 13 mandated paragraphs and the error says which one went missing.
  This is the only place in the wording feature where a carrier is told what it may publish, and the
  exception is argued where it lives: every other instrument is theirs, and this one is the
  regulator's. An office that quietly shortened it would lose their PSP access with nobody telling
  them. Proved by mutation — disabling the gate turns two tests red.
  The carrier's name is substituted into the two blanks the form leaves (`___ ("Prospective
  Employer")`), read from `organizations.name` rather than typed; an empty name renders visible
  underscores rather than a sentence that proof-reads as fine and authorises nobody. The stand-alone
  requirement was already satisfied by D-APP7's one-instrument-per-screen ceremony, which FCRA
  §604(b)(2) had forced for a different reason.
  ⚠ **One obligation the form creates that this product does not yet meet**, recorded in the review
  rather than built: its disclosure paragraphs promise the applicant a copy of the report and a
  written FCRA rights summary before final adverse action, and within three business days after it
  for applications taken by mail, telephone or computer. R10 is deliberately unbuilt because
  §604(b)(3)(B) carves out trucking — but that carve-out governs the TIMING, not this form's own
  undertaking. Counsel's eye before the first PSP pull.
  **All four instruments the applicant signs now have proper text.** What remains on our placeholders
  is `clearinghouse` (no applicant signs it — §382.701(a)'s consent is given in the FMCSA portal) and
  the 7001(c) consent, whose six clauses are quoted from the statute.

- 2026-09-13 — **Owner ruled the two open questions, and the runbook was corrected before anybody
  followed it.** Page 3 **stays unchanged** — ⚠ the §604(b)(2) exposure is accepted on the PAPER
  packet, not withdrawn, and the review now says in as many words that a future step must NOT merge
  page 3 into `fcra_disclosure` on the grounds that it is also a consumer-report disclosure. It is,
  and that is the problem. The FMCSA form's two closing NOTICEs **display**, because "in whole,
  exactly as provided" is not a sentence to be clever about and over-inclusion cannot breach it
  where an omission could.
  ⚠ **`WORDING-PUBLISH-RUNBOOK.md` was stale in the one way that mattered**: it was written for
  adopting OUR placeholders and said "two clicks per document, nothing to type". Followed as
  written, after #763 and #764, it would have published the engineer's text for all six — including
  a PSP body the API now refuses, which is the only reason the error would have been noticed at all.
  It now says to press the source button first, and §4's verification query prints the first 60
  characters of each published body with the two openings to check them against.
  **And the end of the chain is finally pinned.** Publishing was proved at every layer except the
  one the feature exists for: nothing opened the applicant's link and read what came back.
  `publicApplication.test.ts` now seeds `org_disclosures` with the REAL composed text — packet pages
  19/14/21 and FMCSA's PSP form — and asserts the applicant is served the carrier's words and not
  the placeholder, that every mandated PSP paragraph survives the read path, that all four report
  `draft: false`, and that a half-published carrier still refuses. ⚠ That last case is the state an
  office is really in between the first Publish and the last. Mutation-proved: an overlay that
  silently dropped one instrument turns three of them red.

- 2026-09-13 — **The real instruments made the office's own page unreadable, and only a browser could
  show it.** Measured after #764: FMCSA's PSP disclosure is **6,018 characters** where the
  placeholder it replaces was **409**, and the carrier's past-employment release is **3,085**. The
  wording page renders every body in full, so publishing would have turned the one screen whose job
  is to show a count somebody can act on into **5.2 screens** of dense legal text with the Publish
  buttons somewhere inside it. ⚠ No unit test could see this and none did — it took `vite build` +
  `vite preview` with the REAL payload and a Playwright measurement of `scrollHeight`.
  A long preview is now clamped with a counted control (`Show all 6,018 characters`), which brings
  the page to **3.3 screens**; the toggle is reversible. ⚠ **The clamp is on the PREVIEW only and
  never on the editor** — an office about to publish a legal instrument must be able to read the
  whole of it, so the textarea grows from 10 rows to 28 instead. A box hiding two thirds of what is
  being published would be the worse defect by a distance, and that assertion is the one proved by
  mutation.
  ⚠ Two process notes worth keeping. The toggle was first written as a raw `<button>` and
  `lint:ui-adoption` refused it — `AppButton`'s `variant="link"` already exists for exactly this,
  and its own comment records that its absence was once faked with six `!important`s. And the
  end-to-end check ran the true office flow in a real browser: open the PSP card, press **Use the
  FMCSA wording**, and watch the textarea go from 409 characters at 10 rows to 6,018 at 28, opening
  with *"In connection with your application for employment with Silvicom Inc"* and ending on the
  49 C.F.R. 383.5 notice.

- 2026-09-14 — **D-WORD1: the product ships the wording, and the settings page is gone.** The owner
  ruled that being asked to choose legal text was the wrong shape — *"let's not rely on me choosing
  wording; research and implement proper wording, you can decide"* — and that the page should come
  off the dashboard. Both done, in that order, because removing the page first would have stranded
  the product with no way to publish anything.
  ⚠ **The research finding was not that better text needed writing. It was that four of the six
  already had an authoritative source and nobody had gone and got it.** PSP is FMCSA's mandated
  form (#764). The 7001(c) consent is the statute's own six clauses. The other two the applicant
  signs, plus the drug-and-alcohol one, are the carrier's counsel, off packet pages 19/14/21 (#763).
  That left `clearinghouse`, and researching it turned up a defect rather than a gap: **the
  placeholder described the wrong query type.** It talked about the FULL query, whose consent is
  given inside the FMCSA portal — but the instrument a carrier actually holds is the **limited**
  query consent, §382.701(b), required at least annually, obtained by the employer directly.
  FMCSA publishes a sample for it, committed under `docs/plans/recruitment/clearinghouse-consent/`.
  ⚠ **The sample is NOT mandatory** — *"Employers may, however, use or adapt the content as they
  see fit"* — which is why `clearinghouseConsent.ts` has no refusal gate and `pspDisclosure.ts`
  does. Inventing an obligation the agency declined to impose would be as wrong as ignoring one it
  did. The sample also hands back one decision in a bracket (single or multiple queries? fixed
  period or duration? limited number or unlimited?), and the answer is **forced rather than
  chosen**: §382.701(b) requires a query at least annually for as long as the driver is employed,
  so anything narrower expires into a compliance failure. That scope paragraph is OURS, is exported
  separately from FMCSA's three, and a test asserts it does **not** appear in the sample — so
  nobody can later mistake our drafting for the agency's.
  ⚠ **Two candidates were considered and rejected**, recorded so they are not re-proposed: writing
  model FCRA and §40.25 text ourselves (worse than the carrier's counsel, and the exact thing the
  owner said not to do), and adopting FMCSA's Safety Performance History Records Request as the
  previous-employer release (it is a per-employer fill-in form with blanks, not a single electronic
  release — it does not fit the instrument).
  **`defaultWording(carrierName)` is now the base** that `org_disclosures` overlays, so
  `carrierWording()` takes its base as a required argument and `loadCarrierWording` reads the
  carrier's NAME to fill the "I authorize ___" blanks in FMCSA's two forms. ⚠ **Versions are
  provenance, not counters** — `fmcsa-2016-02-11`, `fmcsa-sample-2026-09-13`, `packet-2026-08-21`,
  `15usc7001c-2026-08-21`. `driver_authorizations.disclosure_version` is what an auditor reads years
  later, and `v1` only means something if you also hold this repository at the right commit. They
  are a separate namespace from the `v1, v2, …` `publishWording` assigns to overrides, so the two
  can never be confused.
  **Deleted:** `ApplicationWordingPage.vue`, its test, `useApplicationWording.ts`, the route, the
  Settings tile and the `admin.settings.application-wording` nav surface. ⚠ **The API router
  stays**, and deleting it would be the mistake: `org_disclosures` is append-only and
  `driver_authorizations` rows point into it, and this is the only code that writes it correctly —
  assigning the version, refusing a non-mandated PSP body, auditing the act. A capability with no
  button is not dead code; an evidence table with no safe writer is a liability.
  ⚠ **The test fallout was the real work and it is worth knowing why: 39 tests failed, and almost
  all of them were correct failures.** Two causes. Every applicant fixture carried
  `consented_at: null`, which was harmless while the catalogue was draft and is now a driver who
  has not started — §390.32(d)'s gate refuses every write before the consent exists, so the default
  fixtures now consent and the gate's own tests override back to null. And a dozen tests asserted
  refusals that are no longer reachable by doing nothing. Those were not deleted: `disclosure_not_final`
  and `WORDING_NOT_FINAL` are the floor under an instrument whose text is not final, so the tests
  now reach that state the only two ways a real carrier still can — a draft OVERRIDE row in
  `org_disclosures`, or `withDraftWording()`, a narrow opt-in mock. A floor nobody stands on is a
  floor nobody notices has gone.
  Three assertions turned over rather than being patched, and each turn is the change stated out
  loud: "leaves every unpublished instrument a draft" became "leaves it on the shipped wording,
  which is not a draft"; "fails CLOSED when the table cannot be read" became "degrades to the
  shipped catalogue", because what a blip now costs is the carrier's override rather than the
  ability to sign at all; and the A1 test that pinned a wording refusal on a submitted link now
  pins the signature the comment had always promised.

- 2026-09-14 — **Handoff written: `HANDOFF-2026-09-14-WORDING.md`, and `HANDOFF-2026-09-13-QUEUE.md`
  is marked superseded at its first line** so nobody starts from a queue whose top item no longer
  exists. Eight PRs merged this session (#762–#769), no migration, `main` `2936c92`.
  ⚠ **The top item is no longer a build.** Everything is proved by tests and by reading production
  rows, and **nobody has opened a live link since the gates opened** — 8 PRs of behaviour change
  ride on a walk-through nobody has done. Marija's `certify` draft is the one usable link (expires
  2026-09-27), her `consented_at` is null so it opens on the 7001(c) screen, and ⚠ **her token was
  rotated by the nudge on 2026-09-13 19:28 UTC** — only the link in that email works. Finishing it
  would produce the first `driver_applications` row this product has ever had.
  ⚠ `MAIL_FROM` is still a bare personal Gmail, raised at the start of 2026-09-13 and untouched.
  ⚠ And one obligation the product now MAKES and does not meet: FMCSA's disclosure promises the
  applicant an adverse-action sequence R10 does not perform. §604(b)(3)(B)'s trucking carve-out
  governs the timing, not this form's own undertaking — counsel, before the first PSP pull.

- 2026-09-14 — **A4 answered and A2 pre-flighted; the walk itself is blocked on one email.**
  `CHECKLIST-TO-LIVE.md` carries the measurements. A4: `TELNYX_FROM` and
  `TELNYX_MESSAGING_PROFILE_ID` are BOTH set in production, so the approval notice's SMS half sends
  after all; `APPLICATION_NUDGE_ENABLED` is absent from all 79 variables and therefore true, so the
  sweep is live. A2, as far as it can go without spending her token: production `9e557f8` differs
  from HEAD `8086eef` in doc files only, schema 0338 current; `org_disclosures` is 0 rows fleet-wide
  so she is served `defaultWording("Silvicom Inc")`, measured as `psp` = **`fmcsa-2016-02-11`**
  (6,018 ch) beside three `packet-2026-08-21` instruments and `15usc7001c-2026-08-21`, none of them
  a draft — **the done-when's version string is already determined by the code.** Silvicom holds 0
  `driver_authorizations`; all six `v0-draft` rows are the QA org's.
  ⚠ Two traps found. There are **two live invitations for the same driver row** — the 2026-09-04
  one was never nudged, so it still opens, and it opens an EMPTY form; finishing on it would satisfy
  the done-when while costing her the whole application again. And the working link for the draft
  that matters is **unrecoverable by any path we control** — hence Q-AX5 above.

- 2026-09-14 — **Two defects found while pre-flighting A2, both in how an invitation reaches a person.**
  The drawer's email hint said "The link is not sent from here" and its header said there was no
  email transport, while `deliverApplicationInvite` has been sending through Brevo and
  `ApplicationLinkOnce` — rendered by that same drawer — headlines the success case "Emailed to …".
  A recruiter who believed the hint would send the link twice, or not at all. Both hints now say the
  link is emailed and that a blank field means they carry it themselves. And ⚠ **Q-AX6**: three
  duplicate `Marija Varmeda` applicant rows, one per invitation, because the board's only invite
  action always creates a driver and nothing points at the re-invite path that already exists.

- 2026-09-14 — **The office can add an employer the applicant left out.** The owner's account of what
  an office visit is for: *"the only critical part is previous companies he has worked and they
  usually don't remember companies or dates, so we can go together and update this."* `editableFields`
  offers only paths the payload already carries and calls creating one "an invention" — right for a
  field nobody is looking at, wrong for a driver across the desk naming a job that §391.21(b)(10) and
  (b)(11) require listed.
  ⚠ **No new endpoint and no migration.** `applicationPathSchema` already takes a two-segment path and
  `withValueAt` already extends an array when the index is its length, so an add is one `{path, value}`
  write, one `application_edits` row, one thing the driver is shown before certifying. The server
  support was pinned by test BEFORE any UI was written, rather than assumed.
  ⚠ **Appends only** — never inserts, never removes; see Q-AX7 for why an index-addressed ledger makes
  a splice a correctness bug. And the form collects a WHOLE employer before saving, because the draft
  schema is `.partial()` at the top level only: an element present must satisfy
  `applicationEmployerSchema` in full, so a blank row saved now and filled in later would be refused.

- 2026-09-18 — **D-AX15: the approval email carries a link, and the old one still works.** This is
  D-AX14's own "third option", taken: *a second `sign_token_hash` column so both links work — the
  honest fix, costed and declined for now … the upgrade path if inbox search proves to be a real
  drop-off.* Built as A5a (migration **0345**, column only) and A5b (the readers), in two merges,
  because a column and its first reader cannot travel together.
  ⚠ **It AMENDS D-AX14 rather than reversing it.** That decision's objection had two halves, and
  only one was ever about the email: *(a)* there was no link to send — 0220 stores a SHA-256 and the
  plaintext existed once, at mint — and *(b)* rotating the token would break the waiting screen's
  promise that "this link is where you will sign, and it still works". A second hash answers (a) and
  leaves (b) untouched. `token_hash` is never written on this path; approval mints a fresh token
  BESIDE it, `resolveInvitation` accepts either, and `APPLY_FLOW_COPY.handoff.waitingNote` stays true
  word for word. Two doors, one application.
  ⚠ **Minted once, ever.** The update carries `.is("sign_token_hash", null)`, because the plaintext
  of a stored hash is unrecoverable and a second mint would silently kill a link already emailed. When
  nothing can be stored the email falls back to the old copy that names the earlier email's subject
  line — never a link whose hash is not on the row, which is the lockout this whole design avoids.
  ⚠ **The text message was deliberately left alone.** Measured: `approvedSmsBody` with a real apply
  URL runs 170–193 characters against a 160-character segment, and carriers bill per segment. The
  nudge next door already pays that (199) because an abandoned form gives the driver nothing else to
  act on. Here the existing sentence — *open the application link we emailed you* — only got truer.
  ⚠ **Three headers argued against this step and were amended with it, not left behind**:
  `applicationApprovalNotice.ts`, `renderApplicationApprovedEmail` and `strings.flow.ts`'s
  `waitingNote`. A repository holding comments that contradict its own behaviour is worse than one
  holding none, because the next reader believes them.
