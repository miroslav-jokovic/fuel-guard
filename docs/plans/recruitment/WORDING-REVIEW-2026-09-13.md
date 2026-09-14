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

## 3. ⚠ What the packet does NOT contain — the finding

Searched across all 697 strings in the workbook, not assumed:

- **No PSP authorization.** No *Pre-Employment Screening Program*, no *MCMIS*. **This is the
  blocker**: `psp` is one of the four instruments the applicant signs, and the carrier's lawyers
  never wrote it. The FMCSA PSP account-holder agreement requires the driver's written
  authorization before a report may be pulled.
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

**So publishing from the packet gets three of the four. The fourth needs a decision** — §5.

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
2. **What happens to `psp`?** Three candidate answers, and the second is the recommendation:
   - Publish our placeholder for PSP alone — then one of the four instruments in a driver's file is
     an engineer's text sitting beside three of counsel's. Cheap, and visible for ever in the
     version history.
   - **Ask counsel for one page.** It is the smallest possible ask — a single authorization,
     modelled on page 19 — and it is the only one of the six that gates a live vendor call.
   - Drop PSP from the applicant's path and order the report later against a separately signed
     authorization. Largest change; touches `APPLICATION_RELEASE_ORDER` and the signing ceremony.
3. **Page 3** — §4.1.

Until 2 is answered the applicant's path stays blocked, because `applicationWordingIsDraft()` reads
all four. Publishing the three now is still worth doing: they are three fewer things to do later,
and the version history will show they were adopted before PSP was settled.
