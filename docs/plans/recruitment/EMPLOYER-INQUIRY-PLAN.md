# The previous-employer safety-performance inquiry — 49 CFR §391.23

**Date:** 2026-08-20 · **Status:** scope, not yet built · **Owner decisions needed:** §6
**Regulatory text verified against Cornell LII on 2026-08-20**, not recalled. Every day count and
subsection number below was read from the regulation on that date.

---

## 0. Why this is next, and why it does not wait for anything

H8 files this evidence into the qualification file. **Nothing in the product produces it.**

`driver_employment_history` has carried `inquiry_status`, `inquiry_sent_on` and `inquiry_response_on`
since 0208, and `dqCatalogue` has carried `previous_employer_inquiry` and `previous_employer_response`
as §391.51(b) requirements for longer than that. Both are columns somebody sets by hand to describe
work done in an email client. There is no letter, no record of what was asked, no way to capture what
came back, and no way to document a non-response — which is the one output §391.23 explicitly accepts
in place of an answer.

Unlike PSP, this is required for **every hire**, needs **no vendor**, **no credential**, and **no
purchase**. It is also the largest remaining gap in a §391.51 file: the hiring group has six
non-advisory items and this is two of them.

---

## 1. What the regulation requires

| | |
|---|---|
| **§391.23(a)(2)** | Investigate the driver's safety performance history with **DOT-regulated employers** during the **preceding 3 years**. |
| **§391.23(d)** | Request: general driver identification and employment verification, plus **the §390.15(b)(1) accident data** for the 3 years before the application. |
| **§391.23(e)** | Alcohol and controlled-substances information from previous **DOT-regulated safety-sensitive** employment. **Since 2023-01-06, employers subject to §382.701(a) must use the Drug & Alcohol Clearinghouse to satisfy this for FMCSA-regulated employers.** |
| **§391.23(c)(1)** | Replies, **or documentation of good-faith efforts**, in the investigation file **within 30 days of the date the driver's employment begins**. |
| **§391.23(c)(2)** | A **written record per previous employer contacted**, containing the employer's **name and address**, the **date contacted or the attempts made**, and **the information received**. |
| **§391.23(d) / (g)(1)** | The previous employer **must respond within 30 days of receiving the request**. |
| **§391.23(i)(1)-(2)** | The driver may **review** the information received; records go to them **within 5 business days** of a written request. |
| **§391.23(j)-(k)** | The driver may request a **correction** (previous employer answers within **15 days**) or attach a **rebuttal** (forwarded within **5 business days**). |
| **§391.23(k)(1)-(2)** | Use the information **only** to decide whether to hire, and **protect it from disclosure to anyone not directly involved in that decision**. |
| **§40.25(b), (a)(1), (d)** | D&A history for the **2 years** before the application; requires the employee's **written consent**, and refusal means they may not perform safety-sensitive functions; obtained before they first perform such functions, and **never later than 30 days** after without a documented good-faith effort. |

**Two windows, not one.** §391.23 looks back **3 years**; §40.25 looks back **2**. One letter, two
periods, and a form that asks for "the last three years" of everything is asking for something the
regulation does not entitle us to.

---

## 2. What already exists

- `driver_employment_history` — the employers, `dot_regulated`, and the three inquiry columns.
- `applicantPipeline` — surfaces `previous_employer` as an outstanding release.
- `employmentCoverage` — knows which employers are inside the §391.23(a)(2) window and which owe an
  inquiry (`inquiriesOutstanding`, `inquiriesAwaitingResponse`).
- H8 — projects the inquiry columns into dated `previous_employer_inquiry` /
  `previous_employer_response` qualification records on hire, refusing to invent a date.
- `DISCLOSURES.previous_employer` — the release, `v0-draft` (Q-H3).
- `sendEmail` (`lib/mailer.ts`), Resend/Brevo, and a `documents` store with signed upload URLs.
- 0211/0217 — `previous_employer_*` records are already restricted to §391.53(a)(1) readers, which is
  what §391.23(k)(2) asks for.

## 3. What is missing, including two data gaps found in the code

1. **No street address.** §391.23(c)(2) requires the previous employer's **name and address** in the
   written record. `driver_employment_history` holds `employer_city` and `employer_state` and no
   address line — and `applicationEmployerSchema` **does** collect `address_line1`, which 0220's
   projection then drops on the floor. The applicant is already typing an address we discard.
2. **No employer email.** The column exists on the table; the application never asks for one, so
   there is nothing to send to without an office keying it in.
3. No letter, no send, no §391.23(c)(2) written record, no response capture, no chase, no documented
   non-response, and no surface for the driver's (i)–(k) rights.

---

## 4. Decisions

### D-PEI1 — The inquiry is a DOCUMENT, not a status change
`inquiry_status = 'sent'` records that somebody did something. §391.23(c)(2) requires a record of
**what was asked, of whom, at what address, on what date** — and (i) gives the driver the right to
see what came back. So an inquiry is a stored artifact with server-composed, versioned wording, the
same rule `DISCLOSURES` follows and for the same reason: a client-authored letter is worth nothing in
an audit, and "we asked" is not a record of the asking.

### D-PEI2 — The Clearinghouse answers §391.23(e) for FMCSA employers; the letter asks (d)
Since 2023-01-06 the D&A half is a Clearinghouse query for FMCSA-regulated previous employers, not a
question to the employer. The letter therefore asks for **identification, employment verification and
§390.15(b)(1) accident data**. §40.25's 2-year D&A history remains a real obligation for **non-FMCSA
DOT** safety-sensitive employment (FAA, FRA, FTA, PHMSA, USCG) — a rarer case that must not be
deleted just because it is rare, and the one place the driver's **specific written consent** is
required (§40.25(a)(1)). `driver_employment_history.subject_to_fmcsr` already distinguishes them.

### D-PEI3 — Two clocks, and only one of them is ours to miss
The previous employer's 30 days (§391.23(d)) is **their** obligation. Ours is §391.23(c)(1): replies
**or documented good-faith efforts** in the file within 30 days of employment beginning. The product
tracks and alerts on ours, and shows theirs as context — a queue that leads with somebody else's
deadline teaches a recruiter to wait when the rule says to document and move on.

### D-PEI4 — A non-response is a RESULT, and good-faith effort is the deliverable
0208 already encodes `no_response` as a status rather than a failure. Extending that: **attempts are
evidence.** A second letter to the same address, a phone call logged, a bounced email — each is part
of the §391.23(c)(2) record, and after a documented effort the file is complete without a reply.
This is the opposite of a "chase until answered" workflow and it is what the regulation actually asks
for.

### D-PEI5 — §391.23(k)(2) is a storage rule, and it is already half-built
"Protect the records from disclosure to any person not directly involved in deciding whether to hire"
is what `INVESTIGATION_HISTORY_KINDS` and `canReadInvestigationHistory` implement. Responses inherit
it. What is NOT built is (i)–(k): the driver's right to review, to request a correction (15 days),
and to attach a rebuttal (forwarded within 5 business days). A rebuttal is an append-only row on the
same evidence, never an edit to what the employer said.

### D-PEI6 — Email first, but the record accepts any manner of contact
§391.23(c)(2) says "the date the previous employer was contacted, **or the attempts made**" — it does
not say email. Some former employers answer only a fax. So sending an email is one path into the same
record, and "I posted this on the 4th" is another. A workflow that can only represent what it sent
itself cannot represent a good-faith effort.

---

## 5. Steps

**E1 · Close the two data gaps — DONE 2026-08-20 (migration 0222).** `address_line1` (and `employer_email`) on
`driver_employment_history`; carry `address_line1` through 0220's projection instead of dropping it;
ask for the employer's email on the application.
**Done when:** an applicant's typed employer address survives into the history row, and a §391.23(c)(2)
record can name an address without an office retyping one.

**E2 · The letter as a versioned artifact — DONE 2026-08-20 for §391.23(d).**
`EMPLOYER_INQUIRIES.safety_performance` is **`v1`, not a draft**: it asks for what the regulation
names, in the regulation's own terms, and needed no legal review to be correct about that. The
§40.25 letter is `v0-draft` and the API refuses to record one, because it rests on a consent whose
wording is unsettled (Q-H3).
 `EMPLOYER_INQUIRIES` beside `DISCLOSURES`: one document
for the §391.23(d) request, one for the §40.25 D&A request, each with `version`, `body`, and the
citation it rests on. Server-composed, stored verbatim on the row that sends it.
**Done when:** the exact words sent to an employer in March are still readable in September, and a
later wording change is visible in the data rather than silent.

**E3 · Send, and make the §391.23(c)(2) record — DONE 2026-08-20 (migration 0223).**
`employer_inquiries` is one row per ATTEMPT. The employer's name and address are **copied onto the
row as contacted** rather than joined: the employment row is editable, and somebody fixing a typo in
2027 must not silently rewrite where we wrote to in 2026 — the same reason `driver_authorizations`
stores `disclosure_text` rather than a version pointer. An append-only trigger refuses every edit to
what was sent while still allowing an outcome to be added, and `inquiry_status` is now DERIVED from
these rows rather than typed.

**The route does not send email, and that is the decision rather than an omission.** Q-PEI2 is
unanswered, and §391.23(c)(2) asks for a record of "the date the previous employer was contacted, or
the attempts made" — not for proof that we operated the mail server. So the letter is composed, the
operator sends it however that employer actually answers, and the record is made either way (D-PEI6).
 A new `employer_inquiries` table — one row per
contact **attempt**, carrying employer name and address as sent, the manner (email/post/phone/fax),
the date, the wording version, and the outcome. `driver_employment_history.inquiry_status` becomes
derived from these rows rather than typed.
**Done when:** sending an inquiry writes a record an auditor can read without asking anyone what
happened, and a second attempt is a second row rather than an overwrite.

**E4 · Capture what comes back — DONE 2026-08-20 (migration 0224).**
The reply lives on the ATTEMPT that produced it (`employer_inquiries.response`), so it cannot drift
away from the letter it answers. The accidents inside it reuse `applicationAccidentSchema` — the
applicant's own §391.21(b)(7) shape — because §391.23(d) asks the EMPLOYER about the same three years
the application asks the DRIVER about, and two answers to one question belong in one shape. That is
what makes HIRING-PLAN §4's second cross-match a comparison rather than a data-cleaning exercise.

**Three rules the API enforces rather than tidying up on read:** an answer must carry what was said
(§391.23(c)(2) wants "the information received", not only that it arrived); a documented
non-response may not carry a reply; and an empty accident list must say it is empty, because
otherwise it means "they reported none" or "we have not asked" depending on who is reading.

**Date disagreements are reported, never applied.** When the employer's dates differ from the
applicant's by more than a month, the drawer says so and stops. Correcting the application from the
reply would edit a document somebody certified as true under §391.21(b), which is the one thing that
document may never have done to it — the difference is a conversation with the driver, not an
arithmetic result.

**No qualification record is filed here**, deliberately: D-HIRE2 draws the line at the hire, an
applicant has no §391.51 file to put one in, and H8 is what projects these at the moment they do.
 Structured answers (dates of employment, position, accidents per
§390.15(b)(1), whether the employer will not answer) plus the letter or fax as a `document`,
projecting to a `previous_employer_response` qualification record with `result`.
**Done when:** a returned form files itself into the driver's §391.51 file, and an employer's refusal
to answer is captured as a documented answer rather than left blank.

**E5 · The queue, driven by OUR clock — DONE 2026-08-20.**
`/recruitment/inquiries` leads with §391.23(c)(1) — thirty days from the date employment begins to
have replies **or documented good-faith efforts** in the file. The employer's own thirty days
(§391.23(g)(1)) appear as context on each row and never as the headline, because a queue built on
their clock says *"wait, they still have eleven days"* and one built on ours says *"you have eleven
days to have this documented, and a second attempt is documentation"*. Only the second sentence
describes something the carrier can act on.

**`documented` is DONE, not outstanding.** An employer who never answered but was chased and written
down closes the obligation; showing them as forever open would report a lawful file as incomplete —
the failure D-PSP1 named in a different costume.

**Applicants are in the queue with no deadline at all**, ordered last. §391.23(c)(1) has no date to
count from until somebody is hired, so they are not late for anything — but sending before the hire
is exactly how a carrier makes that deadline, and hiding them would hide the cheapest work on the
list.

Files with nothing outstanding are omitted entirely: a queue padded with finished work is a queue
nobody reads.
 Derived state per employer — not sent, sent, overdue,
answered, documented non-response — with the §391.23(c)(1) 30-day deadline measured from the hire
date, surfaced on the applicant pipeline and the driver's Employment tab.
**Done when:** a recruiter can see every inquiry due, and every hire whose 30-day file deadline is
approaching, without opening one driver at a time.

**E6 · The driver's §391.23(i)–(k) rights.** A request-to-review that produces the records within 5
business days, a correction request (15 days), and a rebuttal stored append-only beside the response
it disputes.
**Done when:** a driver can be given what §391.23(i) entitles them to, and a rebuttal never edits the
employer's original words.

**E7 · Hire-time integration.** H8 already projects the inquiry columns; extend it to cite the
`employer_inquiries` rows so the qualification record points at the artifact rather than restating it.
**Done when:** hiring produces §391.51 records that reference the actual letters and replies.

---

## 6. What is blocked, and what is not

**Unblocked, needs nothing from anyone:** E1, E3, E4, E5, E7, and the §391.23(d) half of E2. This is
the majority of the feature and it is buildable today. **E1–E3 shipped 2026-08-20.**

**Blocked on the disclosure wording (Q-H3):** the §40.25 D&A request, which needs the driver's
specific written consent (§40.25(a)(1)) — the same `v0-draft` problem as PSP, affecting only the
non-FMCSA employers of D-PEI2.

**Q-PEI1 — Does the §391.23(d) safety-performance inquiry require the driver's signed release?**
§391.23 obliges the *previous employer* to respond and does not, in the text read on 2026-08-20, make
the driver's consent a precondition; a former employer is not a consumer reporting agency, so FCRA
§604(b) does not reach a direct employer-to-employer inquiry. Carrier practice is to include a
release anyway. **This is a question for counsel, not a thing to assume** — and the answer decides
whether E3 can send before the wording is final.

**Q-PEI2 — Do we send from our domain on the carrier's behalf, or draft for the carrier to send?**
Sending as Silvicom from a FuelGuard domain is a deliverability and impersonation question (SPF/DKIM,
and what the reply-to means). The alternative is generating the letter for the carrier's own mail.

**Q-PEI3 — Do previous employers get a link to answer online?** The highest-value UX by a distance —
a structured reply beats a PDF nobody can query — and it is the applicant-invitation pattern (H5)
pointed at a different recipient. It is also the largest single piece of work here.

**Q-PEI4 — Inbound email.** Parsing replies would be convenient and is a large surface with a real
spoofing risk. Recommend upload-and-record first; revisit once volume justifies it.

---

## 7. Suggested order

**E1 → E2(d) → E3 → E4 → E5**, then E7, then E6, with Q-PEI3 folded into E4 if the answer is yes.
E1–E3 is the smallest slice that produces a real §391.23(c)(2) record; E4–E5 is what makes it a
workflow instead of a filing cabinet.
