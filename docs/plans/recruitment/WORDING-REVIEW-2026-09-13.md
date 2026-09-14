# The carrier's own wording, transcribed for publishing — review sheet, 2026-09-13

**For the owner and for counsel.** It says exactly what will be published if the office presses
Publish on `/settings/application-wording`, exactly what was changed on the way there, and the four
things nobody should sign off without reading.

The source is `docs/plans/recruitment/APPLICATION.xlsx` — Silvicom's own 31-page packet. The code is
`apps/api/src/modules/recruiting/packetWording.ts`, and `packetWording.test.ts` re-reads the workbook
on every CI run, so a transcription that drifts from the paper fails the build.

---

## 1. What is adopted, and from where

| Instrument the applicant signs | Packet page | Heading taken as the title |
| --- | --- | --- |
| `fcra_disclosure` | **19** | FAIR CREDIT REPORTING ACT DISCLOSURE |
| `previous_employer` | **14** | PAST EMPLOYMENT VERIFICATION |
| `drug_alcohol` | **21** | URINALYSIS NOTIFICATION |

The affirmation shown beside the signature is the carrier's own sentence off the same page, never
one of ours — page 19's *"I hereby authorize SILVICOM, INC to obtain consumer reports…"*, page 14's
*"By signing below, I certify that I have read and fully understand all parts of this release…"*,
page 21's *"I have read and fully understand the conditions above regarding urinalysis notification…"*.

⚠ **Page 19 alone stands for the FCRA disclosure. Page 3 is deliberately not merged into it** — see
§4.1.

⚠ **The urinalysis page's tick-boxes are not transcribed** (*Pre-Employment Qualification /
Suspicion of Controlled Substance / Pre-Qualification for Contracting / Other*). They are a control
the office completes, and a published instrument is a block of text with nothing to tick.

## 2. Everything that was changed

Nothing was reworded. Two registers, both in code, both checked by tests.

### 2.1 Spelling — 19 repairs, every one word-for-word

A test refuses any entry whose two halves differ in **word count**, which is the cheap check that
catches a dropped clause or an inserted qualifier wearing a typo fix as a disguise. The same rule
`packetText.ts` has applied to the printed packet since D-PKT9.

`ahuthorize`→`authorize` · `emplyer/school`→`employer/school` · `emplyment`→`employment` ·
`adultered`→`adulterated` · `preivious`→`previous` · `certy`→`certify` · `prvious`→`previous` ·
`emloyers`→`employers` · `paragrafs`→`paragraphs` · `emplyers`→`employers` ·
`emplyer(s)`→`employer(s)` · `requlated`→`regulated` · `emplyed`→`employed` ·
`infromation`→`information` · `howerver`→`however` · `has not yer received`→`has not yet received` ·
`infromation form previous emplyer(s)`→`information from previous employer(s)` ·
`withing 30 days`→`within 30 days` · `The medical Review Officer`→`The Medical Review Officer`

### 2.2 Four repairs that change characters rather than spelling — **read these**

| # | Page | Packet has | Published as | Why it is a transcription defect |
| --- | --- | --- | --- | --- |
| 1 | 19 | `(15 U.S.C. 1681-168lu)` | `(15 U.S.C. 1681-1681u)` | ⚠ **This alters a statutory citation.** A lower-case L where a `1` belongs. 15 U.S.C. §§1681–1681u is the FCRA; `168lu` cites nothing. |
| 2 | 14 | `paragrafs (d) and €` | `paragraphs (d) and (e)` | A euro sign where `(e)` belongs. The same substitution appears on page 10 as `391.23(d) and €`. §391.23 has paragraphs (d) and (e), and (e) is the one granting the due-process rights the next sentence enumerates. |
| 3 | 19 | `applicants. T he purpose` | `applicants. The purpose` | One word split by a stray space. |
| 4 | 14 | `The applicanthas certain` | `The applicant has certain` | Two words run together by a missing space. |

### 2.3 Seven defects left exactly as written, because the right word is a guess

Recorded rather than silently skipped, and a test asserts each one is **still there** — so a
well-meaning tidy-up fails the build rather than quietly redrafting an instrument.

| Page | As the packet has it | The question |
| --- | --- | --- |
| 14 | "and **with** to review previous employer provided investigative information" | `wish`, surely — but surely is not certainly. |
| 14 | "which may be done at **any** including when applying" | A word is missing after *any*; *time*, on any reading. Not ours to add. |
| 14 | "within 30 days SILVICOM INC making them available" | Reads as though *of* is missing after *days*. |
| 14 | "to furnish SILVICOM INC **they** above requested information" | `the`, most likely — but it sits inside the §40.25 authorization. |
| 19 | "for employment **/**contract purposes" | A stray space before the slash. Repairing it joins two tokens and breaks the word-count guard that makes every other repair checkable. |
| 21 | "regarding pre-employment**.** contracted drivers" | A full stop where a comma belongs. |
| 21 | "informed and understand**.** that should … a positive result**.** it will" | Two more. Punctuation is left alone throughout. |

## 3. ⚠ What the packet does NOT contain

Searched across all 697 strings in the workbook, not assumed:

- **No PSP authorization** — and it turns out there was never supposed to be one. See §3a: FMCSA
  publishes the language and requires it, so this was not a gap in the carrier's packet but a form
  that belongs to the regulator.
- **No Clearinghouse consent.** Expected, and fine — §382.701(a)'s full-query consent is given
  inside the FMCSA portal, and `clearinghouse` is deliberately absent from the applicant's path.
- **No electronic-records consent.** It could not be there: 15 U.S.C. 7001(c) exists because the
  driver signs on a phone, which a paper packet never contemplated. Its six clauses are quoted from
  the statute rather than drafted.
- **An MVR authorization with nowhere to go.** Page 18, *AUTHORIZATION FOR DRIVING RECORD CHECK*, is
  a real release the carrier's lawyers wrote — and this product has no MVR instrument to publish it
  into. No vendor was ever bought, `AUTHORIZATION_PURPOSES` has no `mvr`, and
  `SCREENING_PREREQUISITES.mvr_order` is called by nothing. Recorded so nobody concludes it was
  missed.

**So publishing from the packet gets three of the four. The fourth comes from FMCSA** — §3a.

## 3a. ⚠ PSP: FMCSA writes this one, and mandates it word for word

The owner's instinct was right — it is on the official site. Downloaded 2026-09-13 from
[psp.fmcsa.dot.gov/PspApi/documents/PSPDisclosureandAuthorizationForm.pdf](https://www.psp.fmcsa.dot.gov/PspApi/documents/PSPDisclosureandAuthorizationForm.pdf),
form dated `LAST UPDATED 2/11/2016`. The PDF and its text extraction are committed under
`docs/plans/recruitment/psp-disclosure/`, and a test compares every published paragraph against
them.

Its own header reads **"THE BELOW DISCLOSURE AND AUTHORIZATION LANGUAGE IS FOR MANDATORY USE BY ALL
ACCOUNT HOLDERS"**, and its closing notice is unambiguous:

> Account holders are required by FMCSA to use the language contained in this Disclosure and
> Authorization form to obtain an Applicant's consent. **The language must be used in whole, exactly
> as provided.** Further, **the language on this form must exist as one stand-alone document. The
> language may NOT be included with other consent forms or any other language.**

Three consequences, all implemented:

1. **No repair register for this text.** The carrier's own pages get their typos fixed under §2.1's
   rule. This one gets nothing — "exactly as provided" is an instruction from the agency whose
   system the report comes from, and improving its spelling would breach the account-holder
   agreement the API token is issued under. Only the PDF's hard line-wraps are collapsed.
2. **Publishing anything else for `psp` is refused**, by name: the API compares the submitted body
   against all 13 mandated paragraphs and tells the office which one went missing. This is the only
   place in the whole wording feature where a carrier is told what it may publish, and the reason is
   that this instrument is not theirs.
3. **The stand-alone requirement is already satisfied** by the signing ceremony — one instrument per
   screen, four screens, which FCRA §604(b)(2) had already forced (D-APP7). ⚠ Worth a look on the
   day it renders: the screen also carries the carrier's name and a step counter, which are UI
   chrome rather than consent language, but somebody should agree that reading is right.

The carrier's name is substituted into the two blanks the form leaves for it (`___ ("Prospective
Employer")`) — the form's own fill-in field, not an edit to the language. A carrier with no name on
file gets visible underscores rather than a sentence that proof-reads as fine and authorises nobody.

⚠ **One thing the form obliges that this product does not yet do.** Its disclosure paragraphs
promise the applicant a specific adverse-action sequence — a copy of the report and a written
summary of FCRA rights *before* final adverse action, and within three business days after it for
applications taken by mail, telephone or computer. Publishing this text is a promise the carrier
makes. `R10` in the recruiting plan is the unbuilt adverse-action step, deliberately deferred
because §604(b)(3)(B) carves out trucking; that carve-out governs the *timing*, not this form's own
undertaking. Worth counsel's eye before the first PSP pull.

## 4. Two things worth counsel's eye beyond the typing

### 4.1 Page 3 and FCRA §604(b)(2)

*Independent Contractor Notification & Release* is also a consumer-report disclosure, and it
combines the disclosure with a general liability release (*"I AUTHORIZE, WITHOUT RESERVATION ANY
PARTY OR AGENCY…"*) and a standing authorization for the whole contract period. §604(b)(2) requires
the disclosure to be *"in a document that consists solely of the disclosure"*, and courts read
*solely* literally.

That is why page 19 alone is adopted as `fcra_disclosure` and page 3 is not merged into it —
merging would import the problem into the one instrument built to avoid it. **Page 3 still prints in
the paper packet**, unchanged. Whether it should is counsel's call, not ours.

### 4.2 The due-process paragraph names a 30-day window twice, differently

Page 14 gives the driver *"as late as 30 days after being employed or being notified of denial"* to
request the previous-employer information, and separately deems the request waived if the driver has
not arranged to receive the records *"within 30 days"* of them being made available. Both are on the
same page and read as one clause on a first pass. Not a defect we can fix — flagged because it is
the sentence a driver disputes.

## 5. What is actually being asked

1. **Adopt pages 14, 19 and 21 as the published wording?** They are your lawyers' words, spelling
   repaired per §2.1, with §2.2's four character repairs and §2.3's seven defects left standing.
2. **PSP is answered** (§3a) — FMCSA's form, verbatim, with the refusal to publish anything else.
   Nothing to decide; worth reading once because of the adverse-action promise it carries.
3. **Page 3** — §4.1. Does it stay in the paper packet as it is?
4. **The two closing NOTICEs on the FMCSA form** are shown to the driver along with everything else,
   because "in whole" is not a sentence to be clever about — but they read as addressed to the
   account holder, and on paper they sit below the signature. Ruling welcome.

**All four instruments the applicant signs now have proper text**, so publishing unblocks the path.
The two that remain on our placeholders are `clearinghouse` — which no applicant signs, because
§382.701(a)'s consent is given inside the FMCSA portal — and the 7001(c) electronic-records consent,
whose six clauses are quoted from the statute.
