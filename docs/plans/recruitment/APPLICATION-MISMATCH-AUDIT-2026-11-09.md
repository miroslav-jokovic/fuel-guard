# Application mismatch audit — applicant form vs dashboard vs filed application (2026-11-09)

Read-only audit of `origin/main` @ `ac44b6b`, after the owner sent themself a real application link and
reported three problems: UI/UX issues on the applicant's form, fields not editable on the dashboard, and
fields on the application that the form never asks. Code reading only — no browser walk. The field-by-field
inventories with file:line for every row are the three appendices beside this file:

- `APPLICATION-MISMATCH-AUDIT-2026-11-09-A-applicant-form.md` — every screen the applicant walks, every input.
- `APPLICATION-MISMATCH-AUDIT-2026-11-09-B-recruiter-dashboard.md` — every recruiter surface, every field, editable or not.
- `APPLICATION-MISMATCH-AUDIT-2026-11-09-C-data-layer.md` — contract → tables → filed packet, and the §391.21(b) checklist.

Items marked ✔ were re-verified by hand at the cited line.

## 1. The shape of the problem

The applicant's facts are captured in **two places** and printed by **a third**:

| Layer | Where | Written to |
|---|---|---|
| Part 1 (phone screening) | `partOne/PartOneFlow.vue`, `applicantScreeningContract.ts` | `application_intakes`, `application_intake_licences`, fill-only onto `drivers` |
| Part 2 (§391.21 form) | `ApplyTaskHub` + `ApplySection`, `applicationContract.ts` | `application_drafts.payload` → on filing `driver_applications.payload`, `driver_employment_history` |
| Filed application | the carrier's 31-page paper packet `packet/assets/application-11.pdf`, filled by `packetFieldValues.ts` | — |

At filing `composeFiledApplication` lays Part 1 over Part 2, then `identityOnRecord` lays `drivers` over both.
The three layers use different key names, different validation rules and different option lists for the
same fact, so most of the reported symptoms come from this, and fixing them screen by screen won't help.

## 2. Fields on the application (the paper packet) the form doesn't fill, or fills wrong

| # | Field on the packet | What happens | Evidence |
|---|---|---|---|
| P1 | **Reason for leaving**, **subject to FMCSRs**, **DOT safety-sensitive** (per employer, §391.21(b)(10)) | Collected and **required** by filing rules, **never printed**; page 12's log has dates/company/address/position/phone only | ✔ no `reason_for_leaving` in `packetFieldValues.ts` |
| P2 | **SSN** (pages 1, 4, 12, 15, 23) | Optional on screen, deliberately never drawn (D-HIRE6) → five blank boxes | C §3 |
| P3 | **Licence TYPE** for every non-CDL licence | Part 1 has no per-licence type; composition sets `kind: null` → blank column | C §3 |
| P4 | Licence question A **denied** vs B **suspended/revoked** | One flag `licence_ever_denied` answers both → a suspension prints "denied: Yes" | ✔ `packetFieldValues.ts:256-259` |
| P5 | **Equipment classes** | Form offers 6, paper has 4 rows → tractor-tanker and bus print as OTHER | C §3 |
| P6 | **Address from/to dates** (3-year history) | Collected, not printed | C §3 |
| P7 | **Employment gap explanations**, experience narrative, applicant email | Collected, not printed | C §3 |
| P8 | Employer **USDOT number**, email, "drove a CMV" | Collected, not printed and not in the recruiter's review summary | C §3/§6 |
| P9 | Page 14 (previous-employer inquiry) and page 21 (seven-day statement incl. name/address/CDL) | Never filled | C §3 |
| P10 | Convictions: **location**, **penalty**, **forfeitures** | Location is only an optional state; penalty optional; forfeitures not asked separately | C §5 |
| P11 | Carrier name/address | Printed from the template's hard-coded Silvicom letterhead, not per org | C §5 |
| P12 | Endorsements (Part 1) | Stored in `application_intakes`, never printed, never returned to the recruiter | B, C |

§391.21(b) result: **Partial** on SSN, address dates, licence type, experience, convictions,
denial-vs-suspension, reason for leaving / FMCSR / safety-sensitive, employment gaps.

## 3. Fields the dashboard can't edit (or the edit doesn't stick)

Today there are **four separate edit paths in three drawers**: "Correct an answer" (draft, writes
`application_edits`), the jobs timeline (same), "Correct these" for Part 1 (v2 only, audit row only), and the
DOB/licence correction, which sits in the *Permissions* and *Road-test* step drawers, not the application drawer.

| # | Gap | Evidence |
|---|---|---|
| E1 | **DOB (and legacy CDL number/state) edits are silently lost.** Every applicant autosave and the filing write `drivers` over the draft, while the drawer shows the edit as done | ✔ `apps/api/src/modules/recruiting/applicationDraft.ts` (`identityOnRecord` spread over payload), `applicationSubmit.ts:321-324` |
| E2 | **No add/remove row** for addresses, accidents, convictions, equipment, other names, extra licences. Only employers can be added/removed | B G6 |
| E3 | **Email edit changes only the draft.** Approval/signing emails still go to `application_invitations.email`; "send again" can't change it | B G2 |
| E4 | **No path at all** for SSN, emergency contact; medical card needs the roster permission; endorsements, the three §382.301(b) answers and "medical card pending" are stored but no endpoint returns them | B |
| E5 | **No "send back to applicant"**: carrier-question answers, table answers and the §40.25(j) answer are "the applicant's to give", but the only route is revoke + new invitation | B G5 |
| E6 | **After filing, only employment can be corrected.** No addendum mechanism for any other fact | B G7 |
| E7 | Part 1 and DOB/licence corrections **write no `application_edits` row**, so the applicant never sees them before signing, though the drawer promises "they are shown every change first"; they also keep working after the applicant has started signing | B G3/G4 |
| E8 | Correction inputs are **plain text boxes holding stored formats** (ISO dates, state codes, `+1…`, enum keys); no date/state pickers | B UI-4 |
| E9 | A refused save **loses what the recruiter typed** | B UI-5 |
| E10 | View-only users see working Save/Approve buttons that 403 | B UI-2 |
| E11 | The review drawer shows every document as **"None declared"**, because it passes `captures: []` | ✔ `ApplicationReviewDrawer.vue:~87` |
| E12 | The record page shows only the name: it loads the whole `drivers` row and displays none of it | B UI-6 |
| E13 | Office-entered name/email/phone (invite) **don't pre-fill** the form; the applicant retypes them, `drivers` keeps the office's version, the packet prints the applicant's, nothing flags the difference | C §4 |

## 4. Applicant form: UI/UX and data defects

**Blocks real applicants**
- Part 1 accepts US addresses only (US state list, 5-digit ZIP); place lists are US + Canada only, though the question says "another country".
- A US mobile and an email are both required.
- CDL class must be A/B/C, so a permit holder can't continue (Part 2 accepts free text: the rules differ).
- CDL photos can't be skipped; "Education and training" needs at least one row.

**Wrong data saved without warning**
- "100,000" approximate miles is saved as **100**: `parseInt` stops at the comma. ✔ `draft.ts:69-71,134`
- A blank fatalities/injuries box is saved as **0**. ✔ `draft.ts:140`
- Legacy links save an unticked "failed pre-employment test" as "No"; "DOT-regulated" and "drove a truck" default to Yes.

**Traps**
- **"Sign and send it" does nothing when a check fails.** `send()` puts the problems in `wizard.issues`, but
  `SignOffScreen` only shows `sendError`, so there's no message and the button just doesn't work. ✔ `useApplicationSending.ts:77-111`, `SignOffScreen.vue` (renders `error` only)
- A typo in the Part 1 DOB can't be fixed by the applicant, and the **same date unlocks the draft**, so the driver can be locked out.
- Part 1 answers become read-only, with only a free-text "Tell us" note to correct them.
- The SSN is validated only on the server, at the final send; the error appears at the top of the page.
- The intro promises "8 screens, about 30 minutes" and leaves out about 20 other steps.

**Misleading or inconsistent wording**
- A 2-digit year shows "Enter your date of birth."
- "Driving experience" says Optional, but it or an equipment row is required.
- The same fields are labelled differently in Part 1 and Part 2 ("Mobile phone number"/"Phone", "ZIP code"/"ZIP").
- Two screens are both called "About you".
- British spelling throughout (Licence, Expiry, Offence).
- Employer dates need the exact day; addresses and equipment need only the month.
- Required markers appear only on the carrier questions.
- Long answers (what happened, reason for leaving, experience) are single-line boxes.
- The "other names" inputs have no label.
- Licence-number boxes don't turn off phone autocapitalise/autocorrect.

**Spanish**
- Month/Day/Year labels, date-picker text, "Optional" placeholders and Yes/No on sign-off are hard-coded English.
- Every validation sentence from shared code is English.

**Required though §391.21 doesn't require it, and not labelled as the carrier's rule:** email, phone, CDL class,
donor gender, CDL photos, medical card or "pending", selfie, the 7 carrier questions, every gap over 30 days.

## 5. Mismatches between layers (root causes)

- **Key names:** `prior_positive_2y` vs `prior_failed_pre_employment_test`; Part 1 licence keys (`state_code`,
  `licence_number`, `expires_on`, `agency`) vs contract (`cdl_*`, `issuing_authority`, `number`, `expires_at`);
  employer `address_line1…` vs `driver_employment_history.employer_*`; draft `questionnaire` vs filed `questionnaire_answers`.
- **Rules:** CDL class A/B/C vs free text ≤10; ZIP 5 digits vs 3–20 chars; phone US mobile vs any 7–40; licence number ≤40 vs ≤60.
- **Silently dropped:** `questionnaire_answers` is a non-strict Zod object, so answer keys not in the current
  version are stripped on submit; composition drops expired licences from Part 1.
- **Carrier questions** are labelled on the dashboard with the *current* questionnaire, not the version the applicant answered.

## 6. Suggested order of work (for the owner to rule on)

1. **Silent data loss and traps first, one PR, no migration:**
   - the sign-off issue list;
   - miles comma parsing;
   - blank → 0 for fatalities/injuries;
   - `captures: []`;
   - drop DOB from "Correct an answer" (route it to the identity correction) so edits stop vanishing;
   - hide Save/Approve from view-only users.
2. **Packet completeness, §391.21(b)(10) exposure:**
   - print reason for leaving, FMCSR and safety-sensitive (a second employment page or an addendum page);
   - split denied vs suspended;
   - licence type for each licence;
   - map the 6 equipment classes to the 4 rows.
3. **One "Applicant facts" card on the record page:**
   - every fact, with an edit next to each;
   - Part 1 and identity corrections write `application_edits` and stop at the first packet mark;
   - generic add/remove for row tables;
   - email edits update the invitation.
4. **Unify the Part 1 / Part 2 rules** (one ZIP, phone, class and licence schema in `packages/shared`). Allow foreign
   addresses and licences, permits, and an optional phone or email (one of the two).
5. **Owner decisions needed:**
   - **(a)** "send back to applicant" for a single answer (new act);
   - **(b)** an addendum for post-filing corrections beyond employment (new evidence rows);
   - **(c)** whether SSN prints on the packet (reverses D-HIRE6);
   - **(d)** which carrier-required fields stay required, and that they get labelled as such;
   - **(e)** spelling: US English ("License") for the applicant.
