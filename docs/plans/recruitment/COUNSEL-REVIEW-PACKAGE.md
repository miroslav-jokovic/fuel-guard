# The counsel review — the eight instruments, the packet's signed pages, and four questions that are not about wording

**Created 2026-08-23.** This is the execution artifact for **`APPLICATION-PACKET-PLAN.md` P1** and
**`APPLICATION-SYSTEM-PLAN.md` A0**, which are the same review and were always going to be. It is
addressed to counsel; the owner reads §1 and §5.

> **STATUS: the application system is code-complete and legally inert.** Every step of
> `APPLICATION-SYSTEM-PLAN.md` (A0–A11c) and four of the seven steps of `APPLICATION-PACKET-PLAN.md`
> (P3, P4, P7, P8) are DONE, live and gate-green. No applicant can sign anything, because
> `isDraftDisclosure()` refuses a signature under wording no lawyer has read. **This document is the
> only thing standing between the built system and a usable one.** Nothing here is an engineering
> task.

---

## 0. What is being asked

Eight instruments were written by an engineer as placeholders and shipped deliberately marked as
placeholders (`v0-draft`). Eighteen further pages of the carrier's own packet are instruments too —
static text with a signature under it — and one of them is already known to be legally defective.

Counsel is asked for three things, in this order:

1. **Final wording, or approval of ours, for the eight instruments in §2** — the five screening
   authorizations, the ESIGN consent, the SMS consent, and the §40.25 letter.
2. **A ruling on the carrier's own signed pages in §3**, starting with page 4, which we believe
   cannot be adopted at all.
3. **Answers to §4**, which are not wording questions: an FCRA process that does not exist, a
   §40.25(j) obligation nothing acts on, a worker-classification contradiction inside one document
   set, and a §391.23(i) right with no surface behind it.

**What we need back is a version string per instrument.** See §6 — the mechanism is already built and
the review closes it by itself.

---

## 1. The state of the system, so the review is read against reality

### 1.1 What is live

| Capability | State |
|---|---|
| Invite an applicant, by email, from the Applicants page | live |
| Seven-screen application on a phone; autosave; abandoned-application nudge | live |
| Document capture (licence, medical card) from the phone camera | live |
| §391.21(b)(12) certification with a typed name and an optional drawn mark | live |
| §391.21-shaped PDF (`render.ts`), filed to `qualification_records` | live |
| Packet pages 1, 2, 12, 16, 26 rendered in the carrier's own layout | built, **no caller** |
| Packet static pages 7, 8, 24, 29, 30 as a versioned pack | built, **no caller** |
| Seven Day Work Statement at the hire (migration 0236) | live |
| PSP ordering, employer inquiries, hire-with-carry-over | live, **authorization-gated** |

### 1.2 What is inert, and exactly where it stops

- `recordEsignConsent()` refuses: *"This carrier has not published its final wording yet."*
- `recordRelease()` refuses: *"This disclosure is still draft wording and cannot be signed."*
- `DisclosurePanel.vue` therefore shows the five releases **read-only**, each badged `Not final`.
- `SCREENING_PREREQUISITES` / `hasLiveAuthorization` therefore refuse every PSP order, every §40.25
  letter and every Clearinghouse query, because each is gated on an authorization that cannot exist.
- `SMS_PROVIDER=none`, and separately blocked on 10DLC brand registration.

### 1.3 ~~The one thing that is reachable today~~ · **CLOSED 2026-08-23**

⚠ **Fixed after this document was written.** `submitApplication` now refuses while any instrument the
applicant's path touches is draft, so no §390.32(d)-defective record can be filed at all; the page
says so on its first screen rather than at the Send button, and the form stays usable and saving.
The refusal disappears by itself when counsel's versions land — nothing to remember, nothing to turn
on. **Counsel's answer is still what opens the door; this only guarantees nothing gets through it
first.** The finding as raised:

`esignConsentRequired()` is deliberately armed by counsel's review rather than by a flag:

```ts
export const esignConsentRequired = (consentedAt, doc = ESIGN_CONSENT) =>
  !isDraftDisclosure(doc.version) && !consentedAt;
```

The reasoning is sound and is written down — requiring the consent today would take the application
offline with no way through, because the consent itself cannot be recorded against draft text. **The
consequence is that a driver can complete and certify a §391.21(b) application right now with no
7001(c) consent behind it and no authorizations signed.** 49 CFR §390.32(d) requires an electronic
record satisfying a Part 300–399 document requirement to include proof of consent per 15 U.S.C.
7001(c). An application filed in this window does not have it.

**Nothing has been filed in that window** — the flow has never been walked in a browser by a real
applicant (`RECRUITING-UI-SURFACE-PLAN` U7 is the walkthrough and is not done). We raise it because
the window closes the moment §2's review lands, and because a carrier who started inviting drivers
before that would accumulate defective records silently.

⚠ **And the defect would have been permanent, not transient**, which is the half that decided the
fix: submitting spends the phase (`submitted_at`), so that invitation's file could never afterwards
acquire the consent it was missing. The driver would have to be re-invited into an empty form.

**Recommendation:** ~~do not send a real invitation until §2 is answered~~ — **executed in code
instead.** An invitation sent today reaches a form that fills, saves and refuses to send, and says
so before the driver starts typing.

---

## 2. Part A — the eight instruments we wrote

⚠ **`APPLICATION-PACKET-PLAN.md` P1 says "the five `v0-draft` disclosures". There are eight.** The
count in the plan predates the ESIGN consent (A4), the SMS consent (A11b) and the §40.25 letter, each
of which shipped `v0-draft` for the same reason and each of which is blocked by the same predicate.

| # | Instrument | Where | Statute | What a signature unlocks |
|---|---|---|---|---|
| A1 | Consumer report disclosure and authorization | `DISCLOSURES.fcra_disclosure` | FCRA §604(b)(2) | every consumer report |
| A2 | PSP disclosure and authorization ⚠ **not counsel's to draft** | `DISCLOSURES.psp` | §391.23; PSP account-holder agreement | the FMCSA PSP pull |
| A3 | Previous-employer safety performance release | `DISCLOSURES.previous_employer` | §391.23(a)(2), §391.53, §40.25(g) | the §391.23 and §40.25 letters |
| A4 | Clearinghouse query consent | `DISCLOSURES.clearinghouse` | §382.701(a) | the full query record |
| A5 | Controlled substances and alcohol testing consent | `DISCLOSURES.drug_alcohol` | Part 382; Part 40 | the testing programme |
| A6 | Consent to transact electronically (six clauses) | `ESIGN_CONSENT` | 15 U.S.C. 7001(c); §390.32(d) | **everything** — it gates all of the above |
| A7 | Text message consent | `SMS_CONSENT` | 47 U.S.C. §227; §64.1200(f)(9) | any SMS to an applicant |
| A8 | §40.25 drug and alcohol history request letter | `EMPLOYER_INQUIRIES.drug_alcohol` | §40.25(b), consent per §40.25(a)(1) | the letter itself |

The full text of all eight is reproduced in **Appendix A**. Three notes on how they are built, because
they change what a review has to check:

- **The text is composed server-side, never sent by a client.** What a driver signed is stored as a
  row holding the exact `body`, the exact `intent`, the version, the timestamp, the IP and the user
  agent. Counsel's wording therefore reaches the evidence unaltered, and a later revision is visible
  in the data rather than silent.
- **A6 is stored as six named clauses, not one paragraph**, one per subparagraph of 7001(c)(1)(B)–(C).
  The type system refuses a document with a clause missing. Counsel can review it clause by clause
  with the statute open, and `esignConsentBody()` composes them in statutory order.
- **A1–A5 are five documents rather than one omnibus consent** because §604(b)(2)'s "solely" is read
  literally, and each is presented on a screen of its own with nothing else on it. If counsel's view
  is that fewer documents are acceptable, say so explicitly — the separation is expensive to the
  applicant and we are paying for it on purpose.

⚠ **A2 is the one instrument counsel does not draft.** Verified 2026-08-21 on psp.fmcsa.dot.gov:
FMCSA mandates the exact text of the *Important Disclosure Regarding Background Reports from the PSP
Online Service* + Authorization (`PSPDisclosureandAuthorizationForm.pdf`, last updated 2016-02-11),
to be used **"in whole, exactly as provided, as one stand-alone document, combined with no other
consent form or language"**. Our A2 body below is placeholder prose that must be *replaced by that
form verbatim*, not edited. Counsel's pass over A2 is transcription review — and the account-holder
condition it carries is what §3.7 turns on.

### 2.1 Specific questions on our wording

1. **A1 — does our body need the §606 investigative-consumer-report disclosure?** The carrier's own
   page 4 describes interviews about "reasons for termination of employment" and "work experience",
   which reads as an investigative consumer report. Ours does not mention §606 at all. If any of the
   reports actually obtained are investigative, §606(a)–(b) adds a disclosure and a right to request
   the nature and scope.
2. **A1 — the authorization has no duration.** The carrier's page 4 asserts an evergreen one ("shall
   remain on file … at any time during my contract period"); ours is silent. Which is intended, and
   does the answer change by state?
3. **A4 — we record that we asked for consent, not the consent itself.** §382.701(a)'s full query
   consent is given inside the Clearinghouse. Our row is evidence that the applicant was told, not
   evidence of the consent. Is that the right artifact to hold?
4. **A6 — the withdrawal clause promises a paper form and no fee.** That is a commitment the carrier
   has to be able to keep. Confirm the carrier accepts it, or give us wording they can.
5. **A7 — is the SMS consent required at all, given the applicant is a job applicant?** The clause
   *"You are NOT required to agree to this in order to apply"* is written to keep it out of
   §64.1200(a)(2) territory. Confirm.
6. **A8 — the §40.25 letter is `v0-draft` only because A3's consent is.** The letter itself asks for
   what §40.25(b) names. If A3 is approved, A8 may be approvable in the same pass.

---

## 3. Part B — the carrier's own pages, which are also instruments

`docs/plans/recruitment/APPLICATION.xlsx` is the carrier's real application: 31 pages, letterhead on
every one, `THIS IS NOT AN EMPLOYMENT APPLICATION` and `FOR DEPARTMENT OF TRANSPORTATION VERIFICATION
PURPOSE ONLY` in every footer. **Eighteen of those pages are static text with a signature or a set of
initials under them.** D-PKT4 says no packet wording is adopted verbatim without review, so all
eighteen are in scope, not the five P1 named.

⚠ **These pages are not yet transcribed into the repo** — that work (P5) is deliberately blocked on
this review, because transcribing wording that changes means transcribing it twice. Counsel reviews
the carrier's paper for these; the quotations below are read from the workbook.

### 3.1 Page 4 — Independent Contractor Notification & Release · **we recommend it is not adopted**

Four defects, any one of which is disqualifying:

- **It bundles the disclosure with an authorization and a liability release.** The all-caps block
  reads `I AUTHORIZE, WITHOUT RESERVATION ANY PARTY OR AGENCY CONTACTED BY SILVICOM INC TO FURNISH THE
  ABOVE MENTIONED INFORMATION`. §604(b)(2) requires the disclosure in a document consisting solely of
  the disclosure; the authorization may accompany it, a release of liability may not.
- **It names the wrong consumer reporting agency.** `a consumer report … is being requested from DOT
  Service, Chicago, IL`. We query FMCSA's PSP and an MVR vendor. A disclosure naming an agency we do
  not use discloses nothing, and the page then treats "DOT" as though the federal Department of
  Transportation were that agency.
- **It has the applicant consent to us furnishing their history back to that agency for resale**:
  `my employment history with your if I am hired, will be supplied by DOT to other companies, which
  subscribe to DOT Service.` If the carrier does not do this, it should not be signed; if it does,
  it is a furnisher relationship with §623 duties attached.
- **It takes the Social Security number on the same page as the disclosure**, which is the "solely"
  problem again in a second form.

It is also the page the plan cites for typographical corruption: `typyes`, `concerningmy`, `fromDOT`,
`concering`, `whcihc`, `with your if I am hired`.

**Question B1: is page 4 replaced by our A1, deleted, or rewritten?** Our recommendation is that A1
replaces it and page 4 is dropped, because keeping both puts two contradictory consumer-report
disclosures in one signed packet — see B4.

### 3.2 Page 20 — Fair Credit Reporting Act disclosure

The better of the carrier's two. It is a disclosure plus an authorization and nothing else, which is
the correct shape. Three things for counsel:

- It cites `Section 604(b) of the Fair Credit Reporting Act (15 U.S.C. 1681-168lu)` — an OCR
  corruption of 1681u.
- It says consumer reports may be used `for employment /contract purposes`, which is the
  classification question again (§4.3).
- It contains no statement of the right to a copy of the report and is not accompanied by *A Summary
  of Your Rights Under the FCRA*. §4.1 is the same gap at the process level.

⚠ Whatever happens to this page, it stays on a screen of its own in the signing flow. §604(b)(2) is
the rule `SigningCeremony` was built around and the one placement that can never join a
walk-me-through queue.

### 3.3 Page 19 — Authorization for driving record check

`By signing below I authorize you to release the information requested to SILVICOM, INC as directed
by the Federal Motor Carrier Safety Administration Regulations. I hereby release you from any
liability which might be the result of providing this`

- **A liability release again**, and if the MVR is obtained through a consumer reporting agency
  rather than direct from the state, this is page 4's defect in miniature.
- The sentence is unfinished (`the result of providing this`).
- **The page carries two `Driver signature:` lines and a `Silvicom Inc Representative:` line**, and
  the heading `AUTHORIZATION FOR DRIVING RECORD CHECK` appears twice. It reads as two forms merged by
  accident. Counsel should say how many signatures this page actually takes; see §5.2.

### 3.4 Page 22 — Urinalysis notification

Three statements we believe are wrong on the law, in a document the applicant signs:

- `should controlled substance testing produce a positive result. it will medically disqualify me
  from operating commercial vehicle for this company` — a verified positive is not a medical
  disqualification. It is a §382.501 prohibition from safety-sensitive functions, a §382.705
  Clearinghouse report, and a §40.285 return-to-duty process.
- `my written authorization is required in order for the result of this testing to be provided to
  either party` — under Part 40 the MRO reports verified results to the employer's DER without a
  separate authorization.
- The page does not mention the Clearinghouse at all, which has been the reporting destination since
  2020.

It also carries a `Company reprsentative's signature` line and a `Witness by` line.

### 3.5 Page 18 — CDL certification of compliance

The substance (single licence; notify the employer and the issuing state of a conviction) is right.
The citations are not: the page attributes the licensing rules to `Part 383, 392 and 383` — Part 392
is driving of CMVs, the single-licence rule is §383.21, and the conviction-notification rule is
§383.31. Since D-UI9 keeps citations in print, a wrong one reaches the printed file. `NOTE: All
additional licenses must he returned` is the same OCR corruption family.

### 3.6 The thirteen SIGN pages P1 did not name

Pages **3, 5, 6, 9, 10, 11, 13, 15, 25, 27, 28, 31** (and page 24 — see §5.1) are static text under a
signature or a set of initials. They are in scope under D-PKT4 and we have not reviewed them
line-by-line here. Two are worth naming in advance:

- **Page 15 — past employment verification release.** It takes name, date of birth and SSN and is the
  paper twin of our A3. Same overlap question as page 4 vs A1.
- **Page 31 — the Owner Operator & Leased Driver Agreement signature page.** Its body is pages 29–30
  and **its defects are not spelling**: `shall not he appeasable`, `each party shall appoint one
  arbitration`, `select a natural arbitrator` (the same sentence later says *neutral*), an unmatched
  bracket in the service-of-process clause, and — the one that cannot be repaired by any reading — a
  severability clause with its middle missing: `If any one or more of the provisions contained in the
  Agreement but the Agreement will be enforceable to the extend applicable.`
  ⚠ **We reproduce pages 29–30 exactly as the carrier wrote them and correct nothing**, because the
  gap between a *natural* and a *neutral* arbitrator is the gap between two different agreements.
  `packetStatic.test.ts` asserts in both directions: no correction may be registered against those
  pages, and the two worst clauses are asserted to survive the corrector, so a well-meaning tidy-up
  fails the build. **Question B2: does counsel want to redraft the agreement, or should it stay out
  of the applicant packet until they do?**

### 3.7 ⚠ B4 — three consumer-report disclosures in one packet

If the packet is adopted as it stands and our instruments stay, an applicant signs **page 4**, **page
20** and **our A1** — three disclosures about the same consumer reports, naming different agencies,
with different scopes and different durations. Each one arguably undermines the other two, and the
"solely" defence for A1 is harder to make when the same signing session carried two more.

**Our recommendation: one consumer-report disclosure survives, and it is A1.** Counsel to confirm.

⚠ **And the PSP form makes this more than a preference.** FMCSA's mandated PSP disclosure must be
used *"as one stand-alone document, combined with no other consent form or language"* (§2). A signing
session that hands the applicant page 4, page 20, A1 and A2 in sequence is not obviously compliant
with that condition, and the condition is a term of the carrier's PSP account-holder agreement — so
the exposure is the account, not only the statute.

---

## 4. Part C — four questions that are not about wording

### 4.1 ⚠ C1 — there is no adverse action process, anywhere

Searched the whole repository: no `adverse action`, no `pre-adverse`, no *Summary of Your Rights*,
no step in any of the four recruitment plans that owns it.

FCRA §604(b)(3) requires that before taking adverse action based in whole or in part on a consumer
report, the person taking it provides the applicant with a copy of the report and the CFPB's summary
of rights — and then, after, an adverse action notice under §615(a). The product buys PSP reports and
MVRs *precisely so somebody can decline an applicant on them*, and it has no surface for either
notice, no waiting period, and no record that one was sent.

**This is the largest compliance gap in the feature and it is not a wording question.** It needs a
decision (does the carrier do this in FuelGuard, or outside it?) and, if inside, a step of its own.
It is out of scope for the packet plan and belongs in `RECRUITING-SYSTEM-PLAN.md`.

### 4.2 C2 — a `yes` on the §40.25(j) question obliges the carrier, and nothing acts on it

P8 shipped page 26's question — *did you test positive or refuse a pre-employment test for a job you
applied for but did not obtain, in the past two years?* — and stores the answer. §40.25(j) then
requires the carrier to obtain documentation of the return-to-duty process before the driver performs
a safety-sensitive function. **Nothing acts on a yes:** no queue entry, no document request, no block
on hire. Recording the obligation without discharging it is arguably worse than not asking, because
the file now proves the carrier knew.

The renderer also carries a third state the carrier's form does not have. Applications filed before
the question existed render as **neither box marked, plus a line saying the form never asked** —
because `driver_applications` is append-only and an unticked NO would assert something the applicant
never said. **Question C2b: is counsel content with a third state on the carrier's own form?**

### 4.3 ⚠ C3 — the packet says it is not an employment application; our system says it is

Every page of the carrier's packet footers `THIS IS NOT AN EMPLOYMENT APPLICATION`. Page 4 is headed
`Independent Contractor Notification & Release` and opens *"In connection with my application for
Independent contract with you"*. Pages 29–31 are an Owner Operator & Leased Driver Agreement. Page 22
offers `Pre-Qualification for Contracting a Driver/ Owner Operator` as a box to tick.

Against that, the system it is being rendered by calls the document an **application for employment**
throughout, because §391.21 does: our A1 body opens *"In connection with your application for
employment"*, the §391.23 letter says *"is considering {{driver}} for employment"*, and the whole
qualification file is built as a §391.51 driver qualification file.

Both cannot be true of the same signed packet, and the contradiction is inside one signing session.
It also reaches further than the paperwork: worker classification drives FCRA's employment-purpose
basis, the §604(b)(2) analysis, and whether the §391.51 file is the right container at all.

**Question C3: is this carrier hiring employees, contracting owner-operators, or both — and does the
answer differ per applicant?** If both, the packet has to fork, and that is a product decision this
plan has not made.

### 4.4 C4 — §391.23(i)–(l) has a comment and no surface

The code knows the rule: `employerInquiryContract.ts` states *"The driver has the right to review the
information you provide"* in the letter we send, and `employerInquiry.ts` cites §391.23(i) in its
header. But there is no screen on which a driver reviews what came back, no rebuttal record, and no
written policy artifact of the kind §391.23(j) contemplates. Post-application, and therefore not
blocking this review — but it is owed, and counsel should say what the carrier's policy is so it can
be built against something.

---

## 5. Findings that change the plans, and which the owner has to rule on

### 5.1 ⚠ Q-PKT5 — page 24 is classified STATIC and it is a signed post-hire training record

`APPLICATION-PACKET-PLAN.md` §2.2 classifies page 24, `DRIVER SAFETY TRAINING`, as **STATIC** —
"policy or contract text with nothing to fill". P3 shipped it into the versioned static pack on that
basis, filed **once per version, identical for everybody**, so no applicant's mark can ever appear on
it. Reading the page:

- `On this day, ____________, 20___, I have completed training of log preparation and other public
  safety issues.` — a fill-in date and an affirmation of a **completed** training.
- `DRIVER -PRINT` · `Driver signatrure | Date` · `Instructor's signatrure` — three marks, one of them
  an instructor's.
- `I understand that by not followign DOT regulations I will be subject to company disciplinary
  actions. I am also aware and have been informend of all company fines which will be enforced` — a
  term creating a liability, not a policy statement.

`packetStatic.ts` lines 126–128 reproduce those three lines as inert labels inside a document nobody
signs, and D-PKT9's spelling repairs were applied to the page on the ground that pages 7, 8 and 24
are "policy statements, not instruments". **On this reading page 24 is an instrument, and a post-hire
one** — an applicant cannot truthfully affirm training they have not had, which is the same argument
that moved pages 21 and 23 out of the application.

**Recommendation: page 24 is reclassified NOT OURS and moves to training (`DRIVER-TRAINING-PLAN.md` /
R7), the way the Seven Day Work Statement moved to the hire under D-PKT7.** That drops the static pack
from five pages to four and the spelling register loses six entries. It is an owner decision because
it amends D-PKT1's inventory.

### 5.2 ⚠ Q-PKT6 — the twenty-one placements have not been split into driver marks and carrier marks

D-PKT6 commits to walking the driver to all 21 placements with a Next button. The inventory that
produced 21 counted signature lines; it did not ask **whose**. Reading the pages, at least these are
the carrier's, not the applicant's:

| Page | Line |
|---|---|
| 18 | `Silvicom Inc Representative:` |
| 19 | `Silvicom Inc Representative:` (twice) |
| 22 | `Company reprsentative's signature` · `Witness by` |
| 31 | one of three `Signature | Date` lines |

A ceremony built from the raw count would walk a driver to a line where the company signs. **Before
P5, the placement inventory must be re-derived with each placement labelled `driver` or `carrier`,
and the carrier's left unsigned in the applicant's flow.**

⚠ **And it cannot be re-derived by searching for the word "signature".** The packet spells it
`signatrure` on pages 22, 23 and 24 — a grep for `signature` misses three pages, which is very
likely how a count of 21 was reached in the first place.

### 5.3 P1's scope is wrong in both directions

As written it names five disclosures and five packet pages. It is **eight instruments** (§2) and
**eighteen packet pages** (§3). The plan is corrected in place; this section records why.

### 5.4 Two renderers are built and unreachable

`renderApplicationPacketPdf` and `renderStaticPackPdf` have no production caller — P6, the cutover,
waits on P5, which waits on this review. That is correct sequencing, not an omission, but it means
**the packet has never been produced for a real submission** and the pages have never been checked
against the carrier's paper by somebody holding both.

---

## 6. What we need back, and what happens when it arrives

**A version string per instrument** — anything that is not `v0…` and does not end `-draft`. That is
the whole mechanism:

```ts
export const isDraftDisclosure = (version: string): boolean =>
  version.startsWith("v0") || version.endsWith("-draft");
```

The gate is tied to the hazard rather than to a feature flag on purpose: when reviewed wording lands
and the versions become `v1`, the refusals disappear by themselves on every write path, the ESIGN
consent starts being required, the `Not final` badges clear, and screening unblocks. Nobody has to
remember to turn anything on — which matters, because the thing that would need remembering is *"stop
collecting signatures on text no lawyer has read"*.

Concretely, per instrument, we need: the final `title`, `body` (or the six `clauses` for A6), and
`intent` sentence, plus the version string. ⚠ **Except A2**, where what we need is confirmation that
FMCSA's form has been transcribed correctly and that its stand-alone condition is satisfied by how
the ceremony presents it. Changes of a single character require a new version,
because the version is stored on every signed row and is how a challenge is answered.

**Order of value if the review has to be staged:** A6 first — it gates all seven others and every
write path. Then A1–A3, which unblock screening. A4, A5, A7, A8 and the packet pages can follow.

**The first real signature does not go to the carrier.** `APPLICATION-SYSTEM-PLAN.md` A0's own
Done-when requires it to land in the `FuelGuard EFS QA` org, never against Silvicom.

---

## Appendix A — the eight instruments, verbatim

Reproduced from `packages/shared/src/authorizationContract.ts`,
`packages/shared/src/smsConsentContract.ts` and
`packages/shared/src/employerInquiryContract.ts` as of 2026-08-23. `{{carrier}}`, `{{driver}}` and
`{{window}}` are filled in server-side when the document is served.

### A1 · Consumer report disclosure and authorization — `fcra_disclosure`, `v0-draft`
*Title:* Disclosure regarding background reports
*Authority:* FCRA §604(b)(2)

> In connection with your application for employment, and throughout your employment if you are
> hired, we may obtain one or more consumer reports about you for employment purposes. These reports
> may include information about your driving record, your safety performance history with previous
> employers, and your crash and roadside inspection history. This disclosure is provided to you in a
> separate document that contains nothing else.

*Intent:* I have read this disclosure and I authorize the preparation of consumer reports about me
for employment purposes.

### A2 · PSP disclosure and authorization — `psp`, `v0-draft`
*Title:* FMCSA Pre-Employment Screening Program (PSP) disclosure and authorization
*Authority:* 49 CFR §391.23; FMCSA PSP account holder agreement

⚠ **The text below is a placeholder that will be DISCARDED, not edited.** It is replaced verbatim by
FMCSA's own `PSPDisclosureandAuthorizationForm.pdf`. The official form carries fill-in blanks for the
prospective employer's name; the serving path substitutes the org's legal name server-side, so the
stored text is the **filled** text the driver actually saw. A2 is the one template in an otherwise
static catalogue.

> We are requesting your crash and roadside inspection history from the Federal Motor Carrier Safety
> Administration's Pre-Employment Screening Program (PSP), which draws on the Motor Carrier
> Management Information System (MCMIS). The record covers crashes from the last five years and
> roadside inspections from the last three. You may review your own PSP record and may dispute
> information in it with the FMCSA.

*Intent:* I authorize this company to obtain my PSP record from the FMCSA in connection with my
application for employment.

### A3 · Previous-employer safety performance release — `previous_employer`, `v0-draft`
*Title:* Previous-employer safety performance release
*Authority:* 49 CFR §391.23(a)(2), §391.53; §40.25(g)

> We are required to investigate your safety performance history with the DOT-regulated employers you
> have worked for during the preceding three years. This release authorizes those employers to
> provide us with that history, including accident information and, where applicable, records of your
> participation in a controlled substances and alcohol testing programme as §40.25(g) requires your
> specific written consent to release.

*Intent:* I authorize my previous DOT-regulated employers to release my safety performance history,
including drug and alcohol testing records, to this company.

### A4 · Clearinghouse query consent — `clearinghouse`, `v0-draft`
*Title:* Drug & Alcohol Clearinghouse query consent
*Authority:* 49 CFR §382.701(a)

> We are required to query the FMCSA Drug & Alcohol Clearinghouse for records of any drug or alcohol
> programme violations before we may permit you to perform a safety-sensitive function, and at least
> annually thereafter. A full query requires your consent, which you give in the Clearinghouse
> itself; this record notes that we asked for it.

*Intent:* I understand a full Clearinghouse query requires my consent and that I give that consent
through the FMCSA Clearinghouse.

### A5 · Controlled substances and alcohol testing consent — `drug_alcohol`, `v0-draft`
*Title:* Controlled substances and alcohol testing consent
*Authority:* 49 CFR Part 382; Part 40

> As a condition of employment in a safety-sensitive function you are subject to pre-employment,
> random, post-accident, reasonable-suspicion, return-to-duty and follow-up testing for controlled
> substances and alcohol, conducted under 49 CFR Part 40.

*Intent:* I consent to controlled substances and alcohol testing as required by 49 CFR Part 382.

### A6 · Consent to transact electronically — `ESIGN_CONSENT`, `v0-draft`
*Title:* Agreeing to sign and receive these documents electronically
*Authority:* 15 U.S.C. 7001(c); 49 CFR §390.32(d)

Stored and served as six named clauses, in statutory order:

| Clause | Statute | Text |
|---|---|---|
| **You can have these on paper instead** | 7001(c)(1)(B)(i)(I) | You do not have to do any of this electronically. If you would rather fill in this application on paper and sign it by hand, tell the carrier and they will send you one. |
| **You can change your mind** | 7001(c)(1)(B)(i)(II) | You can withdraw this consent at any time. If you withdraw it before you have sent your application, this link stops working and the carrier will send you a paper form instead; nothing you have already signed is undone, and there is no fee either way. |
| **What this consent covers** | 7001(c)(1)(B)(ii) | This consent covers this job application and the authorizations that go with it — nothing else, and nothing after you are hired. |
| **How to withdraw, and how to update your contact details** | 7001(c)(1)(B)(iii) | To withdraw your consent, or to give the carrier a new email address or phone number, contact the carrier directly using the details in the message that sent you this link. |
| **How to get a paper copy afterwards** | 7001(c)(1)(B)(iv) | After you have sent your application you can ask the carrier for a paper copy of anything you signed, at no charge. |
| **What you need to read and keep these records** | 7001(c)(1)(C)(i) | You need a device with a current web browser and an internet connection to read and sign these documents, and either a printer or somewhere to save a PDF if you want to keep your own copy. |

*Intent:* I agree to sign this application and its authorizations electronically, and to receive the
records that go with them electronically.

### A7 · Text message consent — `SMS_CONSENT`, `v0-draft`
*Title:* Text message consent
*Authority:* 47 U.S.C. §227; 47 CFR §64.1200(f)(9)

> PLACEHOLDER — pending counsel. By agreeing, you allow {{carrier}} to send you text messages about
> your driver application, including a link back to the application you have started. Message
> frequency is limited to messages about your own application. Message and data rates may apply. You
> are NOT required to agree to this in order to apply for a position, and agreeing is not a condition
> of being considered. Reply STOP at any time to stop receiving texts; reply HELP for help.

*Intent:* I agree to receive text messages from {{carrier}} about my application.

⚠ Separately blocked on 10DLC brand/campaign registration, opened 2026-08-21. `SMS_PROVIDER=none`
until it lands, so this instrument is inert twice over.

### A8 · §40.25 drug and alcohol history request — `EMPLOYER_INQUIRIES.drug_alcohol`, `v0-draft`
*Title:* Request for drug and alcohol testing history
*Authority:* 49 CFR §40.25(b); consent per §40.25(a)(1)

> PLACEHOLDER — not to be sent. {{carrier}} is considering {{driver}} for a safety-sensitive position
> and requests the information listed in 49 CFR §40.25(b) for the two years before their application:
> alcohol tests with a result of 0.04 or higher, verified positive drug tests, refusals to test,
> other violations of DOT drug and alcohol regulations, and documentation of any completed
> return-to-duty requirements.
>
> This request must be accompanied by the driver's specific written consent under §40.25(a)(1). The
> wording of that consent is not final, so this letter cannot be sent.

⚠ **For contrast, the §391.23(d) letter beside it is `v1` and needs no review** — it asks for what
§390.15(b)(1) names, in the regulation's own terms, and is already sending.

---

## Appendix B — how to read the carrier's packet alongside this

The workbook stores **zero page breaks**: pagination is an Excel print setting, so a page number is
recoverable only from the footer row that carries it. Every page reference in this document was
derived that way, and any re-derivation must use the same anchor.

| Class | Pages | In this review? |
|---|---|---|
| **FILL** — takes applicant data | 1, 2, 12, 16, 26 | no — rendered, no wording adopted |
| **SIGN** — static text plus a mark | 3, 4, 5, 6, 9, 10, 11, 13, 15, 18, 19, 20, 22, 25, 27, 28, 31 | **yes, all of them** |
| **STATIC** — attached, unsigned | 7, 8, 29, 30 (and 24 — see §5.1) | 29–30 yes (§3.6); 7, 8 no |
| **NOT OURS** | 14, 17, 21, 23 (and 24, proposed) | no |
