# Memorandum for Counsel — Electronic Driver Application and Qualification Instruments

| | |
|---|---|
| **To** | Counsel to Silvicom Inc. |
| **From** | Silvicom Inc., with the Silvicom 360 product team |
| **Date** | September 24, 2026 |
| **Re** | Review of the electronic driver application, its signed instruments, and the adverse-action process |
| **Status** | Confidential. Prepared to request legal advice. |
| **Response requested by** | ____________________ |

> **About this memorandum.** It was prepared by the product team, not by lawyers. Where it states a
> reading of a statute or regulation, that reading is offered so you can confirm or correct it
> quickly. It is not advice, and nothing in it should be relied on as a legal conclusion until you
> have reviewed it. Every citation was checked against the current text on eCFR, the U.S. Code
> (Cornell LII) or the issuing agency's site on September 24, 2026.
>
> *Repository note:* the working record this memorandum replaces, with its history of corrections,
> is kept at `COUNSEL-REVIEW-HISTORY-2026-08-23.md`. Section references such as "§7.2" in other
> plans point to that file.

---

## 1. Executive summary

Silvicom Inc. now takes driver applications electronically through its Silvicom 360 platform. The
applicant consents to electronic records, signs four screening authorizations, completes the
application on a phone, and — once the office has reviewed it — signs the carrier's own 31-page
application packet electronically in 22 places. Each signature is stored with the exact text
signed, the text's version, a timestamp, the IP address and the device.

**The system is live.** One application was filed on September 14, 2026. **No complete packet
has been signed yet.** A filed packet is rendered once and preserved unaltered as a
§391.51 record, so **whatever the packet says when the first applicant signs it is permanent
for that applicant**. That is why we are asking now.

**We need three kinds of answers from you:**

1. **Six questions about instruments applicants are signing today** (Part A, §4). The most urgent
   is **packet page 4**, which we believe breaches the FCRA's "stand-alone disclosure" rule. **We
   have decided to stop collecting signatures on page 4 until you rule on it** (Q1). The platform change ships before any applicant signs the packet.
2. **Three questions about notices to declined applicants** (Part B, §5). The FMCSA-mandated PSP
   form that every applicant signs promises specific notices after an adverse decision. The carrier
   has decided to send them from Silvicom 360 and needs your approval of the notice text.
3. **Approval of four instruments we drafted or adapted** (Part C, §6), and **four structural
   questions** (Part D, §7).

**What a response looks like** (§9): for each question, *approve*, *approve with changes* (with a
redline), or *reject* (with your replacement text or instruction). Any change to a signed instrument
gets a new version identifier. Every later signature carries that identifier, so the record always
shows which text each person signed.

### Priority order

| Priority | Questions | Why |
|---|---|---|
| **1 — before the first packet is signed** | Q1 page 4 · Q2 certification · Q3 electronic use of pages 15/20/22 · Q4 page 15 and the blanket-release rule · Q5 page 22 · Q6 page 19 | Applicants sign these today, and a signed packet cannot be amended afterwards |
| **2 — before the first decline based on a report** | Q7 PSP status · Q8 remote-application exception · Q9 notice text | The carrier's signed PSP form already promises these notices |
| **3 — approve the drafted instruments** | Q10 Clearinghouse · Q11 e-sign consent · Q12 SMS consent · Q13 §40.25 letter | Q12 and Q13 are unused until approved; Q10 and Q11 are in use now |
| **4 — structural** | Q14 employee vs. owner-operator · Q15 owner-operator agreement · Q16 §391.23(i) rights · Q17 smaller items | Affects how the packet may need to be split, not whether it works today |

---

## 2. Background

### 2.1 The hiring process, as the carrier runs it

The carrier set this order on September 24, 2026, replacing the September 17 order. Steps 1–9
happen **before** the applicant travels to the office, and the applicant is not invited to travel
until the federal pre-employment requirements are complete. Steps 10–14 happen on the day of
arrival. *(Steps marked † are being built now; see `APPLICANT-FLOW-PLAN.md`.)*

| # | Step | Where |
|---|---|---|
| 1 | Applicant created; link sent by email | remote |
| 2 | Consent to electronic records; **identity given** (date of birth, licence number and state, licence photos)†; **five permissions signed, each as its own PDF**† | remote, phone |
| 3 | Office reviews the signed permissions | office |
| 4 | Motor vehicle record pulled from SambaSafety, outside the platform, and uploaded | office |
| 5 | FMCSA PSP report obtained | office |
| 6 | Clearinghouse full query: the driver consents in FMCSA's portal, the result is recorded | office |
| 7 | Pre-employment drug test at a collection site; verified negative recorded | external |
| 8 | **Application link sent**†, application completed, office reviews and approves; medical certification verified; previous employers investigated | remote, then office |
| 9 | Orientation videos and quizzes (being built) | remote |
| 10 | Road test, §391.31 | office, on arrival |
| 11 | Live orientation | office |
| 12 | Handbook signed | office |
| 13 | **The office opens signing in person**†; the carrier's 31-page packet is signed electronically | office |
| 14 | Hired, or declined | office |

**The point that matters for §5:** the consumer reports (the MVR and the PSP report) are obtained at
steps 4–5. At that time **every contact with the applicant has been by computer, phone or email**.
Nobody meets the applicant in person until step 10, and **the application itself is completed after
the reports are obtained**.

### 2.2 How a signature is captured

- **Consent first.** Nothing can be signed until the applicant accepts the electronic-records
  consent (Q11). The applicant gives it in the same browser and on the same screen type used for
  everything that follows.
- **One instrument per screen.** Each authorization is shown on its own screen, with nothing else
  on it, and signed there.
- **What is stored per signature:** the complete text shown, a sentence stating the signer's intent,
  the version identifier, the typed name and (optionally) a drawn mark, the time to the second, the
  IP address and the browser identifier. The server builds the text; the applicant's device only
  says who signed and where from.
- **The packet.** The carrier's own PDF is the template. The applicant's answers and marks are
  placed on it, and the signed result is stored with a cryptographic hash beside a certificate of
  completion. It is **never re-rendered**.

### 2.3 The instruments an applicant signs today

| Instrument | Text source | Version identifier | Status |
|---|---|---|---|
| Consent to electronic records | Drafted from 15 U.S.C. 7001(c)(1), six clauses | `15usc7001c-2026-08-21` | **in use** — Q11 |
| FCRA disclosure and authorization | **Your packet, page 20** | `packet-2026-08-21` | **in use** — Q3 |
| Previous-employer release (§391.23, §40.25) | **Your packet, page 15** | `packet-2026-08-21` | **in use** — Q3, Q4 |
| Drug and alcohol testing notification | **Your packet, page 22** | `packet-2026-08-21` | **in use** — Q3, Q5 |
| PSP disclosure and authorization | **FMCSA's mandatory form**, verbatim, carrier's name filled in | `fmcsa-2016-02-11` | **in use** — no drafting possible |
| Clearinghouse limited-query consent | FMCSA's published sample, plus one scope paragraph we added | `fmcsa-sample-2026-09-13` | **in use** (office, on paper); **becoming the fifth permission on the link**† — Q10 |
| The 31-page packet, 22 applicant signatures | **Your packet**, printed exactly as written, typographical errors included | — | **in use** — Q1, Q2, Q5, Q6, Q15 |
| Text-message consent | Placeholder | `v0-draft` | **not in use** — Q12 |
| §40.25 drug and alcohol history request letter | Placeholder | `v0-draft` | **not in use** — Q13 |

The platform refuses any signature or send against text whose version is marked `v0-draft`, which
is why the last two cannot be used until you approve them.

### 2.4 Production record as of September 24, 2026

- **1** application filed (September 14, 2026), with the four authorizations and the PSP form signed.
- **0** complete packets signed. One internal test walk stopped at 20 of 22 signatures.
- **1** PSP report obtained. **0** applicants declined through the platform.

---

## 3. Decisions the carrier has already made

Recorded so you can review them. Each can be reversed on your advice.

| Ref | Decision | Date |
|---|---|---|
| D-WORD1 | The platform ships the wording in §2.3 by default. The carrier does not have to "publish" anything before applicants can sign. | 2026-09-14 |
| D-PKT11 | The carrier's packet prints **exactly as your firm wrote it**, typographical errors included. No page is silently corrected. | 2026-09-14 |
| D-PKT15 | The applicant's §391.21(b)(12) certification is made **by signing packet pages 11, 13 and 17**, not by a separate platform checkbox. | 2026-09-14 |
| Q-HM2 | No MVR integration. MVRs are pulled from SambaSafety outside the platform and uploaded. | 2026-09-17 |
| Q-HM5 | Every federal pre-employment requirement except the road test must be complete **before** the applicant is invited to travel. | 2026-09-17 |
| **L-1** | **Page 4 is withdrawn from electronic signing until you rule on Q1.** The change ships before the first applicant signs the packet; no applicant has signed page 4 so far. | 2026-09-24 |
| **Q-HM14** | The application asks, as a structured question, whether the applicant is applying as a **company driver or an owner-operator**. The answer drives the page 22 reason and the page 31 owner-operator lines. | 2026-09-24 |
| **Q-REC8** | **Adverse-action notices are sent from Silvicom 360**, with a record of each. Until you answer Q7, the platform treats every decline resting on a PSP report or an MVR as owing a notice. | 2026-09-24 |

---

## 4. Part A — Instruments applicants are signing now

### Q1. Packet page 4 ("Independent Contractor Notification & Release") · **Priority 1**

**Facts.** Page 4 is signed by the applicant. It contains, on one page:

- a consumer-report disclosure naming **"DOT Service, Chicago, IL"** as the reporting agency. The
  carrier does not use that agency; it uses FMCSA's PSP and SambaSafety;
- an all-capitals authorization and **release of liability**: *"I AUTHORIZE, WITHOUT RESERVATION ANY
  PARTY OR AGENCY CONTACTED BY SILVICOM INC TO FURNISH THE ABOVE MENTIONED INFORMATION"*;
- consent to the carrier furnishing the applicant's history **back to that agency for resale** to
  subscribers;
- a field for the applicant's Social Security number.

In the same signing session the applicant also signs **page 20** (a second FCRA disclosure) and
**FMCSA's PSP form**. The PSP form must by its own terms be used *"as one stand-alone document"* and
*"may NOT be included with other consent forms or any other language."*

**Law.** FCRA §604(b)(2)(A)(i), 15 U.S.C. 1681b(b)(2)(A)(i): the disclosure must be *"in a document
that consists solely of the disclosure"*. The authorization may be on the same document
(§604(b)(2)(A)(ii)). *Syed v. M-I, LLC*, 853 F.3d 492 (9th Cir. 2017), held that a liability waiver
in the disclosure document violates the "solely" requirement, and that the violation was willful.
*Gilberg v. California Check Cashing Stores*, 913 F.3d 1169 (9th Cir. 2019), extended this to
extraneous information more generally. Statutory damages for a willful violation are $100–$1,000
per consumer, plus punitive damages (15 U.S.C. 1681n).

**Our reading.** Page 4 cannot be used as an FCRA disclosure. Page 20 is correctly shaped and
already serves that purpose. Because a signature on page 4 adds risk and no protection, the carrier
has **decided to stop collecting it** (decision L-1). Page 4 will not be signed electronically until you rule.

**What we need.** One of the following:
(a) confirm that page 4 is deleted from the packet;
(b) provide a redraft that contains no disclosure, only whatever independent-contractor
acknowledgment you want kept; or
(c) instruct otherwise.
Also: **does the carrier furnish applicant history to "DOT Service" or any other agency?** If it
does, that is a furnisher relationship with FCRA §623 duties, and we need to know.

---

### Q2. Does the packet's certification satisfy §391.21(b)(12)? · **Priority 1**

**Facts.** Under D-PKT15 the only certification on a filed application is the applicant's signature
on packet pages 11, 13 and 17:

| Page | Text |
|---|---|
| **11** | "This certifies that **I completed this application**, and that all entries on it and information in it are true and complete to the best of my knowledge." |
| 13 | "I certify that the answers given herein are true and complete to the best of my knowledge." |
| 17 | "By signing this statement, I certify that this application **has been completed by me**, and that all…" |

**Law.** 49 CFR §391.21(b)(12) requires a certification that *"this application was completed by me,
and that all entries on it and information in it are true and complete to the best of my
knowledge,"* and §391.21(b) places it in the application.

**Our reading.** Page 11 differs from the regulation only in voice ("I completed" for "was completed
by me"), and we believe it is sufficient. Page 11 is the last page of the application proper;
pages 12–31 are releases, notices and policies.

**What we need.** (a) Is page 11's wording sufficient? (b) Is it acceptable that the certification
falls on page 11 of 31, or must it follow every page the applicant fills in? The applicant also
fills in pages 12, 16 and 26. If it must follow them, we will reorder the signing sequence.

---

### Q3. Electronic use of packet pages 15, 20 and 22 · **Priority 1**

**Facts.** Your firm's pages 15 (previous-employer release), 20 (FCRA disclosure) and 22
(urinalysis notification) are signed twice by each applicant:

1. **At step 2, on screen**, as standalone authorizations. For that version we corrected obvious
   spelling errors (19 corrections, none changing the word count) and four typographical errors
   (table below). Seven apparent errors we did **not** correct, because the right word was not
   certain. They are listed in Appendix B.
2. **At step 13, on the printed packet**, exactly as written (D-PKT11), errors included.

The four typographical corrections:

| Page | As written | As shown on screen | Why |
|---|---|---|---|
| 20 | `(15 U.S.C. 1681-168lu)` | `(15 U.S.C. 1681-1681u)` | A lower-case "L" in place of "1" **in the statutory citation** |
| 20 | `T he purpose` | `The purpose` | Stray space |
| 15 | `paragrafs (d) and € of Section 391.23` | `paragraphs (d) and (e) of Section 391.23` | Euro sign in place of "(e)" |
| 15 | `The applicanthas certain` | `The applicant has certain` | Missing space |

**The issue.** The same applicant signs two slightly different texts of the same instrument. Neither
text was written for electronic signature.

**What we need.** (a) Confirm the three pages may be signed electronically under the electronic-records consent (Q11).
(b) Choose one text: approve our corrected text for **both** the screen and the printed packet, or
give us a clean redraft of the three pages. We would then print that text in place of the originals.
Either way, the result gets one new version identifier.

---

### Q4. Page 15 and the ban on blanket releases (§40.321(b)) · **Priority 1**

**Facts.** Page 15 authorizes *"the above mentioned employer/school"* to release drug and alcohol
testing information to Silvicom Inc. The applicant signs page 15 **once**. The carrier then contacts
every previous employer the applicant listed.

**Law.**
- 49 CFR §391.23(f)(1): the carrier must give each previous employer the driver's consent meeting
  §40.321(b) before drug and alcohol information is released.
- 49 CFR §40.321(b): the consent must be *"a statement signed by the employee that he or she agrees
  to the release of a particular piece of information to a particular, explicitly identified, person
  or organization at a particular time."* **Blanket releases are prohibited**, including a release
  *"to a category of parties"* such as *"companies to which the employee may apply for employment"*.
- Since January 6, 2023, the Clearinghouse replaces these letters for FMCSA-regulated previous
  employers (§391.23(e)(4)). A direct request is still required for employers regulated by other DOT
  agencies (FAA, FTA, FRA, PHMSA, USCG), and for follow-up testing plans (§391.23(e)(4)(i)–(ii)).

**Our reading.** One signature on a page naming "the above mentioned employer" may be a release to
a category of parties. Our proposal: the platform generates **one consent per previous employer**
requiring a §40.25 request. Each consent names the employer, the information (§40.25(b)(1)–(5)), the
recipient (Silvicom Inc.) and the date, and the applicant signs each one. The page 15 signature
would continue to cover the §391.23(d) safety-performance inquiry, which is not drug and alcohol
information.

**What we need.** Confirm the per-employer approach, and approve or redline the consent wording we
will draft for it (paired with Q13).

---

### Q5. Page 22 (urinalysis notification) · **Priority 1**

**Facts and our concerns.** Page 22 states that:

- a positive result *"will medically disqualify me from operating commercial vehicle"*. A verified
  positive is not a medical disqualification. It is a prohibition from safety-sensitive functions
  (49 CFR §382.501), a Clearinghouse report (§382.705), and a return-to-duty process (Part 40,
  Subpart O).
- *"my written authorization is required in order for the result of this testing to be provided to
  either party"*. The Medical Review Officer reports verified results to the employer without a
  separate authorization (49 CFR §40.163).
- The page does not mention the Clearinghouse.

The page also asks why the test is required ("Pre-Employment Qualification" / "Suspicion of
Controlled Substance" / "Pre-Qualification Contracting a Driver/Owner Operator" / "Other"). Under
decision **Q-HM14**, the platform will tick this from the applicant's structured answer
(company driver or owner-operator), not infer it from free text.

**What we need.** A corrected page 22, or approval to replace the two sentences above with wording
you provide. Also confirm the Q-HM14 approach to the checkbox.

---

### Q6. Page 19 (driving record authorization) · **Priority 1**

**Facts.** Page 19 carries its heading twice, two identical driver signature lines, two carrier
countersignature lines, a liability release, and an unfinished sentence (*"…any liability which
might be the result of providing this"*). The carrier obtains MVRs from **SambaSafety**, a consumer
reporting agency.

**What we need.** (a) Is page 19 one authorization or two? The platform currently collects both
signatures. (b) A completed final sentence. (c) Since the MVR comes through a consumer reporting
agency, confirm that page 19's liability release does not affect the page 20 disclosure, which is a
separate page signed separately.

---

## 5. Part B — Declined applicants

### Q7. Does a decline based on a PSP report owe a notice? · **Priority 2**

**Law and facts.**
- *Mowrer v. U.S. Dep't of Transp.*, 14 F.4th 723 (D.C. Cir. 2021), held that FMCSA is **not** a
  consumer reporting agency in operating MCMIS and the PSP. The court assumed without deciding that
  the records are consumer reports.
- 49 U.S.C. 31150(b)(1) requires FMCSA to ensure PSP information is released *"in accordance with
  the Fair Credit Reporting Act"*.
- The FMCSA-mandated PSP form, which **every applicant signs**, states that for applications made
  by computer the carrier *"must provide you within three business days of taking adverse action
  oral, written or electronic notification"* of four specified facts. It also states that the
  carrier must provide a copy of the report within three business days of a request. The PSP
  enrollment agreement adds that applicants must be pointed to consumerfinance.gov/learnmore.

**Our reading.** Whether or not a PSP report is a "consumer report" by statute, the carrier has
**undertaken the notice in an instrument it has the applicant sign**, and FMCSA's program terms
require it. The carrier has therefore decided (Q-REC8) to send the notice for every decline based in
whole or in part on a PSP report. It will do the same for an MVR from SambaSafety, which is plainly
a consumer report. A decline based only on a previous employer's reply to the carrier's own
§391.23 inquiry would not trigger a notice, because no reporting agency is involved.

**What we need.** Confirm or correct that approach.

---

### Q8. The remote-application exception · **Priority 2**

**Law.** FCRA §604(b)(3)(B), 15 U.S.C. 1681b(b)(3)(B), replaces the pre-adverse-action copy and
summary of rights with a notice **within three business days after** the adverse action. It applies
where the applicant applied *"by mail, telephone, computer, or other similar means"* for a position
whose qualifications the Secretary of Transportation sets (49 U.S.C. 31502). It also requires, under
§604(b)(3)(C)(ii), that **"as of the time at which the consumer report is procured"** all contact
between applicant and employer on the application was by those means.

**Facts.** In the carrier's process (§2.1), reports are obtained at steps 4–5, before any in-person
contact and before the application form. An applicant who walks in with a paper application before the reports are pulled is not
covered by the exception.

**Our reading.** For applicants who applied through the platform link and had no in-person contact
before the reports were obtained, the three-business-day post-decision notice applies. For anyone
else, the full pre-adverse sequence applies: a copy of the report and the CFPB *Summary of Your
Rights*, a waiting period, then the final notice. The platform will record, for each applicant,
whether any in-person contact preceded the report, and choose the sequence from that record.

**What we need.** (a) Confirm the reading. (b) Tell us the waiting period the carrier should use in
the in-person sequence.

---

### Q9. Text of the notices · **Priority 2**

We will draft three templates from the statute and the PSP form: (1) the post-decision notice for
remote applicants, §604(b)(3)(B)(i)(I)–(IV); (2) the pre-adverse-action notice; and (3) the final
adverse-action notice under §615(a). Each will name the reporting agency (FMCSA, or SambaSafety),
include its address and toll-free number, state that the agency did not make the decision, and
explain the rights to a free copy and to dispute.

**What we need.** Approval of the three templates. We will send them separately once drafted. **No
notice will be sent before you approve them.** Declines are already recorded with the date and
whether they rested on a purchased report, so no timeline will have to be reconstructed.

---

## 6. Part C — Instruments for approval

### Q10. Clearinghouse limited-query consent · **Priority 3**

**Text.** FMCSA's published sample (*"FMCSA does not require that motor carrier employers … use this
sample format"*), reproduced word for word, with the carrier's name inserted. The sample leaves the
scope to the employer. We added this paragraph, marked as ours:

> This consent covers more than one limited query. It applies for as long as I am employed by or
> under contract to Silvicom Inc, and there is no limit on the number of limited queries that may be
> conducted during that time. I understand that federal law requires a limited query to be run at
> least once a year, and that I may withdraw this consent at any time by telling Silvicom Inc in
> writing — in which case I understand they must stop me performing safety-sensitive functions.

*Intent statement:* "I consent to Silvicom Inc running limited queries of the FMCSA Drug and Alcohol
Clearinghouse about me, on the terms set out above."

**Law.** 49 CFR §382.701(b)(2) allows limited-query consent that is *"effective for more than one
year"*. §382.703(a) requires written or electronic consent. The full pre-employment query is
consented to in FMCSA's own portal (§382.701(a)) and is not part of this instrument.

**What we need.** Approve, or redline the scope paragraph.

### Q11. Consent to electronic records (15 U.S.C. 7001(c)) · **Priority 3**

**Text.** Six clauses, each mapped to the statute. It is in use now.

| Clause | Statute | Text |
|---|---|---|
| You can have these on paper instead | 7001(c)(1)(B)(i) | You do not have to do any of this electronically. If you would rather fill in this application on paper and sign it by hand, tell the carrier and they will send you one. |
| You can change your mind | 7001(c)(1)(B)(i) | You can withdraw this consent at any time. If you withdraw it before you have sent your application, this link stops working and the carrier will send you a paper form instead; nothing you have already signed is undone, and there is no fee either way. |
| What this consent covers | 7001(c)(1)(B)(ii) | This consent covers this job application and the authorizations that go with it — nothing else, and nothing after you are hired. |
| How to withdraw and update contact details | 7001(c)(1)(B)(iii) | To withdraw your consent, or to give the carrier a new email address or phone number, contact the carrier directly using the details in the message that sent you this link. |
| How to get a paper copy afterwards | 7001(c)(1)(B)(iv) | After you have sent your application you can ask the carrier for a paper copy of anything you signed, at no charge. |
| What you need | 7001(c)(1)(C)(i) | You need a device with a current web browser and an internet connection to read and sign these documents, and either a printer or somewhere to save a PDF if you want to keep your own copy. |

*Intent statement:* "I agree to sign this application and its authorizations electronically, and to
receive the records that go with them electronically."

**Notes.** 7001(c)(1)(C)(ii) requires consent given in a way that *"reasonably demonstrates"* the
applicant can access the records. The applicant consents in the same browser that then displays
every instrument and the PDF copies. 49 CFR §390.32(d) requires this proof of consent for every
electronic record kept under Parts 300–399.

**What we need.** (a) Approve or redline. (b) Confirm the carrier can honor paper at no charge.
(c) **Scope:** the applicant signs the packet (step 13) in the office, after the application is
submitted. Does "this job application and the authorizations that go with it" cover the packet, or
should the scope clause name it?

### Q12. Text-message consent · **Priority 3**

**Status.** Placeholder, **not in use**. The platform sends applicants text messages only about
their own application (a link back to it, a reminder, a notice that the office has approved it). It
sends no marketing. The carrier's toll-free sending number requires documented opt-in to pass
carrier verification.

**Proposed text** (replacing the placeholder):

> By checking this box, you agree that Silvicom Inc may send text messages to the mobile number you
> gave us about your driver application — for example, a link back to your application, reminders,
> and updates on its status. Message frequency varies with your application. Message and data rates
> may apply. Agreeing is not a condition of applying or of being considered. Reply STOP to stop
> receiving texts at any time, or HELP for help.

*Intent statement:* "I agree to receive text messages from Silvicom Inc about my application."

**What we need.** Approve or redline. Also confirm that informational, non-marketing messages to an
applicant need only this prior express consent, not the prior express *written* consent that 47 CFR
§64.1200(a)(2) requires for telemarketing.

### Q13. §40.25 drug and alcohol history request · **Priority 3**

**Status.** Placeholder, **not in use**. Paired with Q4.

**Scope, as narrowed by §391.23(e)(4).** Since January 6, 2023, the Clearinghouse full query
replaces this letter for FMCSA-regulated previous employers. The letter is now needed only for
(i) previous employers regulated by another DOT agency, and (ii) a follow-up testing plan where the
applicant has not completed follow-up testing.

**Proposed text:**

> Silvicom Inc is considering [applicant] for a safety-sensitive position. Under 49 CFR §40.25(b) and
> §391.23(e), and with the applicant's specific written consent enclosed, we request the following
> for the two years before [date of application]: (1) alcohol tests with a result of 0.04 or higher
> alcohol concentration; (2) verified positive drug tests; (3) refusals to be tested, including
> verified adulterated or substituted results; (4) other violations of DOT agency drug and alcohol
> testing regulations; and (5) for any violation, documentation of the applicant's successful
> completion of DOT return-to-duty requirements, including any follow-up testing plan. Please reply
> in writing to [contact] in a form that ensures confidentiality (§40.25(g)). If you hold no such
> information, please say so.

**What we need.** Approve or redline, together with the per-employer consent in Q4.

---

## 7. Part D — Structural questions

### Q14. Company drivers and owner-operators · **Priority 4**

**Facts.** The carrier engages both. Every packet page is footed *"THIS IS NOT AN EMPLOYMENT
APPLICATION"*. Page 4 speaks of an *"application for Independent contract"*, and pages 29–31 are an
Owner Operator & Leased Driver Agreement. The platform's instruments, like §391.21, call the
document an application for employment. Under decision Q-HM14 each applicant will be asked which they are applying as.

**Law.** The FTC staff report *40 Years of Experience with the Fair Credit Reporting Act* (July 2011),
p. 32, reads "employment purposes" to include *"a trucking company that obtains consumer reports on
individual drivers who own and operate their own equipment"*. Some district courts disagree for
independent contractors generally (e.g., *Smith v. Mutual of Omaha Ins. Co.*, No. 4:17-cv-00443, 2018 WL 6921119 (S.D. Iowa Oct. 4, 2018)). The
PSP form states that its "employment" concept follows the definition of "employee" in 49 CFR
§383.5, which includes independent contractors who drive. 49 CFR Part 391 applies to every driver
the carrier uses, whatever the relationship.

**Our reading.** Treat both groups identically for FCRA and Part 391 purposes. That errs on the
inclusive side.

**What we need.** (a) Confirm. (b) Should the footer *"THIS IS NOT AN EMPLOYMENT APPLICATION"* remain
on a document that is, for §391.21 purposes, the application? (c) Should owner-operators and company
drivers sign different packets?

### Q15. The Owner Operator & Leased Driver Agreement (pages 29–31) · **Priority 4**

**Facts.** The agreement is printed exactly as written, and the applicant signs page 31 as driver
and, where applicable, as owner-operator. It contains defects that change meaning, not just spelling:

- *"shall not he appeasable"*;
- *"select a natural arbitrator"*, where the same sentence later says *neutral*;
- an unmatched bracket in the service-of-process clause;
- a severability clause missing its middle: *"If any one or more of the provisions contained in the
  Agreement but the Agreement will be enforceable to the extend applicable."*

**Question.** Is this agreement intended to be the lease required by 49 CFR §376.12 (truth-in-leasing)
for owner-operators who lease equipment to the carrier? If so, it may need terms it does not have.

**What we need.** (a) A redraft, or (b) an instruction to take pages 29–31 out of the applicant
packet until a redraft exists. Under Q-HM14, company drivers are not asked to sign page 31 as
owner-operator.

### Q16. The applicant's right to review previous-employer information · **Priority 4**

**Facts.** Page 15 contains the notice §391.23(i)(1) requires: the right to review, to have errors
corrected, and to attach a rebuttal. It also sets the carrier's process: a written request to the
Safety Manager, and a response within five business days.

**What we need.** (a) Confirm page 15 satisfies §391.23(i)(1). (b) Confirm the carrier's process as
stated on page 15 is the one to build. The platform will record each request and each response date.

### Q17. Smaller items · **Priority 4**

- **Page 18 citations.** It attributes the single-licence and conviction-notification rules to
  *"Part 383, 392 and 383"*. The rules are §383.21 and §383.31. May we correct the citation, or do
  you prefer to redraft the page?
- **Page 26, §40.25(j).** Applications filed before this question existed show neither box ticked,
  plus a line saying the form did not ask. Is that acceptable on the carrier's form?
- **Page 17.** The top half is the applicant's certification and history authorization. The bottom
  half (interview notes, result) is the carrier's and is not shown to the applicant. Please confirm
  that is correct.

---

## 8. What the platform already does

So that you can assume the following when you review:

- A signature is refused against any text marked draft, and the refusal names the reason.
- Nothing can be signed before the electronic-records consent is given.
- An applicant who admits a prior failed or refused pre-employment test (§40.25(j)) is **blocked from
  load assignment** until return-to-duty documentation is on file. The hire is allowed; driving is not.
- Every decline is recorded with its date and whether it rested on a purchased report.
- Filed records are append-only. A correction is a new record, never an edit.
- The applicant can download a PDF of what they signed.

---

## 9. Form of response

For each question, please give:

| | |
|---|---|
| **Answer** | Approve · Approve with changes · Reject |
| **Text** | For changes: a redline, or replacement text |
| **Effective** | Immediately, or a date |

When you change an instrument, the platform assigns a new version identifier. Every signature
taken after that carries the new identifier, and signatures already taken keep the old one. **You
do not need to decide whether existing signatures must be re-collected** unless you believe they
must. If so, please say which, and we will arrange it.

**Attachments:**
1. `APPLICATION.xlsx` / `Application 11.pdf` — the carrier's 31-page packet (your firm's document).
2. `PSPDisclosureandAuthorizationForm.pdf` — FMCSA's mandatory PSP form.
3. `SampleLimitedQueryConsent.pdf` — FMCSA's sample limited-query consent.
4. A specimen of a filed packet with test data, and its certificate of completion. Available on
   request, once Q1 is answered.

---

## Appendix A — Authorities cited

| Authority | Subject |
|---|---|
| 15 U.S.C. 1681b(b)(2)–(3) (FCRA §604) | Disclosure, authorization, adverse action, remote-application exception |
| 15 U.S.C. 1681m(a) (FCRA §615) | Adverse-action notice |
| 15 U.S.C. 1681n | Civil liability for willful noncompliance |
| 15 U.S.C. 7001(c) (E-SIGN) | Consumer consent to electronic records |
| 49 U.S.C. 31150 | PSP: FCRA compliance, written consent |
| 47 U.S.C. 227; 47 CFR 64.1200 | Text messages |
| 49 CFR 390.32 | Electronic records and signatures under Parts 300–399 |
| 49 CFR 391.21, 391.23, 391.25, 391.31, 391.51 | Application, investigations, annual review, road test, qualification file |
| 49 CFR 376.12 | Lease requirements |
| 49 CFR 382.501, 382.701, 382.703, 382.705 | Prohibition, Clearinghouse queries, consent, reporting |
| 49 CFR 40.25, 40.163, 40.321 | Previous-employer testing history, MRO reporting, confidentiality |
| *Syed v. M-I, LLC*, 853 F.3d 492 (9th Cir. 2017) | Liability waiver in FCRA disclosure |
| *Gilberg v. Cal. Check Cashing Stores*, 913 F.3d 1169 (9th Cir. 2019) | Extraneous information in FCRA disclosure |
| *Mowrer v. U.S. Dep't of Transp.*, 14 F.4th 723 (D.C. Cir. 2021) | FMCSA is not a consumer reporting agency for the PSP |
| FTC, *40 Years of Experience with the FCRA* (2011), p. 32 | "Employment purposes" includes owner-operators |

## Appendix B — Apparent errors left as written on pages 15, 20 and 22

We did not correct these because the intended word is a guess, and guessing would change a signed
instrument. Please correct them in any redraft (Q3).

| Page | Text | Likely intended |
|---|---|---|
| 15 | "and **with** to review previous employer provided investigative information" | *wish* |
| 15 | "which may be done at **any including** when applying" | *any time, including* |
| 15 | "within 30 days SILVICOM INC making them available" | *30 days **of** Silvicom Inc* |
| 15 | "to furnish SILVICOM INC **they** above requested information" | *the* — this is inside the §40.25 authorization |
| 20 | "for employment /contract purposes" | spacing only |
| 22 | "regarding pre-employment**.** contracted drivers / owners" | comma |
| 22 | "I have been informed and understand**.** that should … a positive result**.** it will" | commas |

## Appendix C — Packet pages the applicant signs

| Page | What is signed | Question |
|---|---|---|
| 3 | Orientation and the drug test it includes | — |
| 4 | Background reports, independent contractor release | **Q1 — withdrawn from signing** |
| 5, 6, 9 | Initials: qualifications, required documents, company rules | — |
| 10 | Company rules, part four | — |
| 11 | Previous-employer permission; application certification | Q2 |
| 13 | Answers true; application open 45 days | Q2 |
| 15 | Past employment and testing history release | Q3, Q4, Q16 |
| 17 | Certification and history authorization (top half) | Q2, Q17 |
| 18 | Single-licence certification | Q17 |
| 19 | Driving record authorization (two lines) | Q6 |
| 20 | FCRA disclosure and authorization | Q3 |
| 22 | Urinalysis notification | Q3, Q5 |
| 25 | Receipt of handbooks | — |
| 26 | §40.25(j) prior test question | Q17 |
| 27 | Passengers and off-duty logging | — |
| 28 | Alcohol and drug abuse policy | — |
| 31 | Owner Operator & Leased Driver Agreement — as driver, and as owner-operator | Q14, Q15 |

Pages 18, 19 and 22 also carry lines for a carrier representative, and pages 22 and 31 a witness
line. The applicant is not asked to sign those.
