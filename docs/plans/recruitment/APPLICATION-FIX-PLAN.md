# Application fix plan: one fact, one rule, one place to correct it (2026-11-09)

Source: `APPLICATION-MISMATCH-AUDIT-2026-11-09.md` (+ appendices A/B/C). Item IDs below (P1…, E1…) are that
audit's. Decision IDs `D-AM*`, owner questions `Q-AM*` (prefix unused elsewhere as of 2026-11-09).

## 1. Goal

The owner sent themself a real link and found the form, the dashboard and the filed packet disagree. The goal is
that each of these is true, and a test pins it:

1. **Every fact the driver gives lands on the packet.** Nothing is asked that isn't printed or used, and nothing is printed that wasn't asked.
2. **Every fact the office can see, the office can correct in one place.** The correction sticks, and the driver sees it before signing.
3. **A driver on a phone finishes without help.** No dead buttons, no silent data loss, no lockouts, no English on a Spanish page.

## 2. Root cause, and the rule that follows (D-AM1)

The same fact (ZIP, phone, CDL class, licence number, state) has a separate schema in Part 1
(`applicantScreeningContract.ts`), in Part 2 (`applicationContract.ts`), on the packet (`packetFieldValues.ts`) and
in the office correction box (plain text). Fixing screens one at a time just adds a fifth copy.

**D-AM1:** each applicant fact is defined once in `packages/shared/src/applicantFacts.ts`. The definition holds:
- its Zod schema;
- its label key (EN and ES);
- its input kind (date, state, phone, zip, enum + options);
- where it is printed on the packet (page and field);
- whether §391.21 requires it, or the carrier does (`requiredBy: "391.21(b)(n)" | "carrier"`).

Part 1, Part 2, the office correction drawer and the packet field map all read that definition. A gate test asserts
three things:
- every fact has a packet destination or an explicit `notPrinted: "<why>"`;
- every packet field has a fact;
- every fact has an ES label.

This is the "deriving beats restating" rule from CLAUDE.md, and it is what stops this audit from recurring.

## 3. Batches

Each batch is one PR unless noted, with tests and mutation-checked. Order matters: F0 stops harm now, and F1 lays
the foundation everything else reads.

### F0: stop silent harm (no migration; no owner decision needed)

| Fix | Item | Change | Test |
|---|---|---|---|
| Final send can't die silently | §4 trap | `SignOffScreen` renders `ApplyIssueList` (with `final`) above the button; each issue links to the place to fix it | component test: a failing filing rule shows a named message and the button re-enables |
| Miles "100,000" → 100 | §4 | Strip digit separators before parsing; refuse non-numeric with a message instead of guessing | unit test on `toApplication` with `"100,000"`, `"100 000"`, `"abc"` |
| Blank fatalities/injuries → 0 | §4 | Blank stays blank, and filing asks for it | unit + filing-rule test |
| Legacy unticked → "No"; defaults of Yes | §4 | Tri-state with no default; filing requires an answer | unit test |
| Documents "None declared" | E11 | Pass the invitation's real captures to `buildReviewSummary` | drawer test asserting a declared CDL scan is listed |
| DOB edit silently lost | E1 | Remove DOB and CDL number/state from "Correct an answer"; that row says "Corrected in Identity" and opens the identity correction | test: the answer list offers no DOB edit; an API test that a draft PATCH on DOB is refused with a pointer |
| View-only users see Save/Approve | E10 | Gate on the derived permission (`recruitment` manage), not on rendering | test per role |
| Recruiter's typed text lost on refusal | E9 | Keep the input until the server confirms | component test |
| DOB typo locks driver out | §4 trap | The unlock accepts the DOB on record **or** a one-time code to the phone/email on the invitation; the office can reset the DOB through identity correction | API + page test |

### F1: one fact catalogue (D-AM1; no migration)

- Create `applicantFacts.ts`. Move the schemas out of the two contracts so both import them, and existing parsing stays byte-for-byte compatible.
- The unified rules, so Part 1 and Part 2 agree:

| Fact | Rule |
|---|---|
| ZIP | US 5 or 9 digits, CA A1A 1A1, other countries free text up to 20 |
| Phone | E.164; a US mobile is required only for the SMS opt-in |
| CDL class | A, B, C, or **CLP (permit)** |
| Licence number | up to 40 |
| State | jurisdiction code, picked from a list |

- Rename the drifted keys behind a read adapter, so stored drafts still load. The adapter is labelled per the no-workarounds rule, and it is removed once the 90-day draft prune has passed. The renames:
  - `prior_positive_2y` ↔ `prior_failed_pre_employment_test`;
  - the Part 1 licence keys.
- `questionnaire_answers` becomes strict-with-version: answers are kept against the version the driver was asked, never stripped. This fixes the silent drop (§5).
- Gate test as in §2.

### F2: the packet prints what was asked (no migration)

Items P1, P4, P5, P6, P7, P8, P10, P12, P3.

| Item | Change |
|---|---|
| P1 | Per employer: reason for leaving, FMCSR, safety-sensitive. Page 12 has no room, so add an **employment addendum page** in the carrier's style (packet page "12a"). It prints every employer with all §391.21(b)(10) fields, the USDOT number and the gap explanations. |
| P4 | Split `licence_ever_denied` into `licence_denied` and `licence_suspended_revoked`. Migration-free (draft jsonb), with the adapter reading the old single flag into both. |
| P3 | Each licence gets a `kind` (CDL, CLP, non-CDL, other). Part 1's other-licences step asks for it. |
| P5 | The 6 equipment types map to the 4 paper rows with an explicit table, and "OTHER" prints the type's name instead of the bare word. |
| P6, P7 | Address dates, experience and email print on the addendum page. |
| P10 | Convictions ask city + state (required), penalty (required) and a "forfeiture of bond" yes/no. |
| P12 | Endorsements print on the licence line and are returned to the recruiter. |
| P9 (page 14) | Stays blank: it is the office's inquiry to the previous employer, not the driver's. Page 21 (seven-day statement) is driver-filled only when the carrier uses it → **Q-AM4**. |

Test: a "full application" fixture renders the packet, and an assertion walks the catalogue. Every fact with a
packet destination has non-empty text at that field (the coordinates come from `packetFieldValues`). There's no
text-collision check by eye alone; the memory note on PDF collisions applies, so the batch ends with a look at the
rendered PNG.

### F3: one "Applicant facts" card for the office (needs a migration, split across two merges)

Items E2, E3, E4, E7, E8, E12, E13.

- **One card on the record page**, grouped by the catalogue's sections. Every fact appears once, with its value and its source (driver, office, or scan), and an "Edit" next to it. It **replaces** the four edit paths:
  - "Correct an answer";
  - the jobs timeline edits;
  - `PartOneCorrection`;
  - the identity correction inside the Permissions and Road-test drawers.

  Those drawers link to the card instead of carrying their own copy.
- **Each edit uses the fact's own input kind** (date picker, state list, phone, enum), not a stored-format text box (E8).
- **Add and remove rows** for addresses, accidents, convictions, equipment, other names and licences (E2).
- **Every correction, whatever its source, writes an `application_edits` row**, so the driver sees it on the pre-signing screen (E7). Edits stop at the first packet mark (E7). After that point, see F5.
- **Email or phone edits update the invitation's contact** and say so (E3). That is an audited act.
- **Facts stored but unreachable are returned and editable:** endorsements, the §382.301(b) answers, medical card pending, emergency contact (E4). SSN stays write-only (shown as •••-••-1234, replaceable) → **Q-AM3**.
- **Migration:** only if `application_edits` can't hold Part 1 or identity targets today. Check its `target` constraint first. If it needs widening, the migration merges first and the reader in the next merge (`lint:migration-ordering`).

### F4: the driver's experience (see §4; mostly no migration)

### F5: sending a question back (owner decision Q-AM1). Post-filing addendum DROPPED (Q-AM2 → b)

- Send a single question back to the driver (**Q-AM1**).
- ~~An addendum for post-filing corrections beyond employment (**Q-AM2**). Evidence tables are append-only, so this is a new `application_addenda` row set, and an amended packet is re-signed by the driver.~~ DROPPED 2026-11-09: nothing is edited after signing (Q-AM2 → b).

## 4. Driver UX: what the phone walk should feel like

Today the driver walks:

1. Intro.
2. Consent.
3. Part 1 (10 steps).
4. Signature adoption.
5. 6 permission documents.
6. Wait.
7. Email.
8. DOB unlock.
9. Part 2 (8 tasks).
10. Wait.
11. A second DOB unlock.
12. Sign-off and the packet.

The intro says "8 screens, 30 minutes". These are the changes, in priority order:

**U1: tell the truth up front.** The intro shows the real journey as three stages with honest times:
- "Today: 10 min, with your CDL in hand";
- "Your work history: 20 min, any time this week";
- "Signing: 5 min, after we review".

The progress bar is the same three stages and is always visible, so there is no surprise second half.

**U2: never ask twice.**
- The office's name, email and phone pre-fill the form (E13), shown as "We have this — change it if it's wrong".
- The CDL scan pre-fills the licence number, state, class, expiry and DOB. The driver confirms rather than types.
- Part 1's address seeds the first row of the 3-year address history. Part 1's licence seeds the licence list.
- The DOB unlock is asked once per device. After that, a remembered-device token is used, with the code fallback from F0.

**U3a: SUPERSEDED by `APPLICATION-SCREEN-MAP.md`** (owner 2026-11-09). The owner ruled: independent questions get
one screen each (D-AM2), a fact typed together is grouped (D-AM3), employers are simplified with optional addresses
(D-AM4). The analysis below is kept for the record.

The owner asked for a one-question-per-screen wizard. Here is what that costs. The current form has **about 94
distinct inputs** (appendix A), and several of them repeat:

| Repeating group | Fields per row | Typical rows | Fields in total |
|---|---|---|---|
| Employer | about 12 | 3–5 | 36–60 |
| Address | about 6 | 1–3 | 6–18 |
| Licence | about 5 | 1–2 | 5–10 |

So a strict one-field-per-screen walk is **about 130–170 screens** for a driver with four jobs. At roughly 6 seconds
per tap-and-wait, that is 15+ minutes of navigation alone. Going back to fix one field is also hard.

**Recommended: one *decision* per screen.** A screen is either one question, or one fact that is naturally typed
together. For example, an address is one screen: street, city, state, ZIP. So is a single employer's
name-and-address.

- **Yes/no gates come first and skip whole groups.** "Any accidents in the last 3 years?" is one screen, and only a Yes opens the details. The same goes for convictions, suspensions, other names and other licences. Most drivers answer No and skip about 30 fields.
- **Repeating rows are a short loop.** For each employer:
  1. who and where;
  2. when, and what you did;
  3. why you left, and whether it was DOT/FMCSR work.

  After each employer: "Add the job before this?", with the coverage meter from U5. That makes 3 screens per employer, not 12.
- **Scanned or pre-filled facts are one "Is this right?" screen** listing them, not a screen each.

Estimate for a typical driver (no incidents, 4 employers, 2 addresses): **about 45 screens**, most answered in
one tap. That keeps the one-thing-at-a-time feel on a phone without 150 screens.

The catalogue (D-AM1) carries a `screen` grouping for each fact. The wizard is then **generated** from the
catalogue, not hand-written per screen, so a new fact needs no new screen component. U6's single review page
remains the place to jump back to any answer.

**U3: built for a thumb.**
- Every field gets the right `inputmode` and `autocomplete`, and `autocapitalize=characters` with `autocorrect=off` on licence numbers.
- Dates use one picker everywhere. Month+year is enough where the regulation allows it (addresses, employers, equipment); the exact day only for DOB and incidents.
- Long answers (what happened, reason for leaving, experience) are multi-line.
- Yes/No are two big buttons, never a checkbox.
- Required fields are marked; optional ones say "optional"; carrier-only requirements say "Silvicom asks for this", from the catalogue's `requiredBy`.

**U4: errors you can act on.**
- Errors show inline under the field, in the page's language, and name the field and the fix ("Use 4 digits for the year").
- The final screen lists anything missing with a "Fix" link that jumps to the field. A button never does nothing.
- Server validation (SSN) runs on blur, not at the last tap.

**U5: work history that doesn't feel like a tax form.**
- Employers are a timeline: newest first, with gaps drawn as gaps ("Jan–Mar 2025: what were you doing?" with quick picks for unemployed, school or family).
- An "Add the job before this" button walks backward until 3 years (10 for CMV) are covered.
- A coverage meter shows "2 years 4 months of 3 covered".

**U6: one review screen before handing over.** It shows everything on one scrolling page, in the same groups as the office card, each with "Edit". On the second visit, the office's changes are highlighted on the same page ("Silvicom changed your ZIP from 6060 to 60601"), and the driver accepts them before signing.

**U7: Spanish means Spanish.** Every string goes through `APPLY_COPY`, including:
- date labels;
- picker text;
- "Optional";
- Yes/No;
- shared validation messages. Shared code returns a message key and parameters, never an English sentence.

A gate fails on a literal string in an `apply/` template.

**U8: not just Americans with a US mobile.**
- Foreign addresses and licences (F1).
- Phone **or** email required, not both, unless the carrier rules otherwise (**Q-AM5**).
- Permit holders can continue.
- "Skip the photos, I'll bring my CDL" lets the driver continue, and the office sees "CDL photo pending".

**U9: wording.** US spelling for the driver ("License", "Expiration") → **Q-AM6**. One label per fact, from the catalogue (no "Phone" vs "Mobile phone number"). Distinct screen titles ("About you" appears once).

**How we prove U1–U9:** a Playwright walk in `apps/web/e2e-apply/` on a 390×844 viewport, in EN and ES. It goes from the link to the hand-off. It asserts no English text on the ES walk, every error names a field, and the time-to-finish with typed fixtures. Then the owner repeats the real-phone walk that started this.

## 5. Open questions (owner)

| ID | Question | Options | Recommendation |
|---|---|---|---|
| Q-AM1 | Can the office send ONE question back to the driver? | ANSWERED 2026-11-11 (owner, "as proposed"): **(a)**, a per-question "ask again" (F5) | — |
| Q-AM2 | Correct facts after filing? | ANSWERED 2026-11-09: **(b)**. Anything can be edited before signing; nothing after (owner) | — |
| Q-AM3 | Does the SSN print on the packet (it reverses D-HIRE6)? | ANSWERED 2026-11-11 (owner): **(a) print the full SSN**, reversing D-HIRE6's blank. "The application is given to nobody; only to the driver and filed with us. The driver owns the SSN." The driver enters it in the FORM (not only at sign-off) and the office reviews it like every answer. **Admin and safety see all nine digits; everyone else sees the last four and may only replace it** — a new named permission, not Q-WF4b's picture permission, which also ships to the recruiter. See Q-AM17 | — |
| Q-AM4 | Is page 21 (seven-day statement) used? | ANSWERED 2026-11-11 (owner): **(a)**, the driver fills page 21 at signing. "Most of the time we will update it and put all zeros." It reverses the 2026-08-23 move to the hire (`sevenDayStatement.ts`, D-PKT7): the statement returns to the packet, the office corrects it before signing like any answer, and the driver page's form stays for a start date that falls too long after signing | — |
| Q-AM5 | Which carrier-only requirements stay required? (email, phone, donor gender, CDL photos, medical card, selfie, 7 carrier questions, gaps over 30 days) | ANSWERED 2026-11-11 (owner, "as proposed"): phone **or** email; CDL photo skippable to "pending"; medical card or pending; the rest required but labelled as the carrier's. Every document photo is optional (already so: `APPLICATION_CAPTURE_REQUIRED` is empty) | — |
| Q-AM6 | Spelling on the driver's side | ANSWERED 2026-11-11 (owner, "as proposed"): **US** | — |
| Q-AM7 | Wizard granularity | ANSWERED 2026-11-09: one question per screen, grouped only for one fact (D-AM2/D-AM3); see APPLICATION-SCREEN-MAP.md | — |
| Q-AM13 | Can the office edit the driver's own statements: §40.25(j) (prior positive test or refusal) and the three §382.301(b) testing-program answers? | ANSWERED 2026-11-10 (owner): **yes, every answer is editable before signing**, "because drivers make mistakes and we need control over any mistake". Built as (c). These four edits require a note and are audited as office-entered. Like every edit (D-AM7), the driver sees and accepts them on screen 3.1 before signing, so the signed document is still their statement. The donor gender and the EEO answers are **replace-only**: the office can overwrite them but never sees them, like the SSN, because they must not reach whoever decides the hire. Nothing is editable after signing (Q-AM2). | — |
| Q-AM14 | An office correction and its `application_edits` row are two writes, not one transaction (`applicationEditLog.ts`). If the second fails, the change is made but the driver is not shown it, and a retry finds nothing to log. Close the window? | ANSWERED 2026-11-11 (owner): **(a)**, one transaction, built with F4's draft-function work | — |
| Q-AM15 | The rows of addresses, other names, licences, equipment, accidents and convictions have no key, so an office correction records a POSITION (`["addresses", 2, "city"]`). The office's own removals are replayed by every reader (`currentEditPaths`, F3c part 2). But when the DRIVER deletes or reorders a row on their phone after an office correction, nothing is logged, so the card and 3.1 point the correction at the wrong row. Close it? | ANSWERED 2026-11-11 (owner, "as proposed"): **(a)**, a stable `key` on every row | — |
| Q-AM16 | When the office corrects an applicant's email, the invitation's email now moves (E3), but `drivers.email` does not. No application path has ever written it: the roster owns the row, and a recruiter does not hold the roster section. So a later re-invite starts from the old address, and the Recruiting list shows it. Move it too? | ANSWERED 2026-11-11 (owner, "as proposed"): **(a)**, through a roster-owned RPC | — |
| Q-AM17 | Who may read the full SSN once the driver types it in the form? | ANSWERED 2026-11-11 (owner): **admin and safety**; everyone else the last four, replace-only. A named switch in Settings → Permissions, shipped to the safety manager, the admin holding it always (`CLOSE_APPLICATION_PERMISSION`'s pattern) | — |
| Q-AM18 | EEO self-identification: ask it? | ANSWERED 2026-11-11 (owner): **only if the carrier's paper asks it.** `application-11.pdf` prints the equal-opportunity STATEMENT (page 1 and "Qualifications") and no self-identification questions, so it is not asked and the reserved `eeo` key goes. The owner's rule, kept for every question: **the online form is a prefill of the carrier's paper application, and the paper decides what is asked** | — |
| Q-AM19 | Documents | ANSWERED 2026-11-11 (owner): every document photo stays optional; **the office can send a separate documents-only link at any time**, opening just the photo list; photos are **normalised to scan quality** (cropped to the card, straightened, evened) so nobody scans them separately. Both are new builds | — |

## 6. Size and order

| Batch | Size | Depends on |
|---|---|---|
| F0 | 1 PR, about 1 day | — |
| F1 | 1–2 PRs, about 2 days | — |
| F2 | 1 PR, about 2 days | F1 |
| F3 | 2 PRs (migration first, if one is needed), about 3 days | F1 |
| F4 (U1–U9) | 4 PRs, about 6 days: (1) the catalogue-generated wizard engine, U3a; (2) U1+U2+U6; (3) U3+U4+U5; (4) U7+U8+U9 with the ES gate | F1; U6 needs F3's edit rows |
| F5 | after Q-AM1/2 | F3 |

## 7. Progress log

(append entries at the END)

- 2026-11-09: plan written from the mismatch audit. Nothing built yet.
- 2026-11-09: owner ruled one question per screen, grouped only when the fields are one fact (D-AM2/D-AM3), with simpler employers and optional employer addresses (D-AM4). The full screen list is in `APPLICATION-SCREEN-MAP.md`. Q-AM7 is answered; Q-AM8–11 are open.
- 2026-11-09: owner asked for typed dates ("1001" → 10/01/2026, "10011985" → 10/01/1985), and ruled wizard = application = dashboard at 100%, with every fact editable. Recorded as D-AM6 (typed date, SCREEN-MAP §9; it joins F0 because it is today's worst input) and D-AM7 (parity gate `lint:application-parity` plus office edits for every answered fact, SCREEN-MAP §10). Q-AM2 was taken as answered (a), pending the owner's confirmation; Q-AM12 is open.
- 2026-11-09: owner ruled the office edits everything before signing and nothing after (Q-AM2 → b, so no addendum), and the Spanish date order is MM/DD like English (Q-AM12 → a). The owner said "proceed as proposed", so F0 starts on `claude/application-f0`.
- 2026-11-10: status review. Merged and in production (release v2026.11.10): F0 as #2166, and the typed dates (D-AM6) as #2169.
  - **Two F0 rows did not ship:**
    - "DOB typo locks driver out": the unlock still takes only the date of birth (`DraftUnlockGate.vue`, `POST /:token/unlock`), and no one-time code exists. It becomes **F0b**, its own PR right after F1, because it sends a code by SMS (Telnyx) or email (Brevo) and needs its own limiter and audit.
    - "Legacy unticked → No; defaults of Yes": this moves into **F1**, because a tri-state yes/no with no default is an input kind of the catalogue, not a per-screen fix.
  - **Owner questions still open, with the recommendations as written:**
    - Q-AM1 (a): send one question back.
    - Q-AM3 (b): print the last 4 of the SSN.
    - Q-AM4: owner's call.
    - Q-AM5: phone or email, the CDL photo skippable to "pending", and the medical card or pending.
    - Q-AM6: US spelling.
    - Q-AM8–11, in `APPLICATION-SCREEN-MAP.md` §8: Q-AM8 (a), street optional on previous homes; Q-AM9 (a), one DOT question per employer; Q-AM10 (a) later, the FMCSA name search; Q-AM11 (a), employer dates as month and year.
  - **F1 needs none of these.** Q-AM8, Q-AM9 and Q-AM11 change catalogue entries, not the catalogue's shape. F1 builds the entries as the screens are today, and a ruling becomes a one-entry edit.
  - **Order from here:** F1 → F0b → F2 and F3 (in parallel, both on F1) → F4 → F5 (on Q-AM1). That is about 13 working days. F1 starts on `claude/application-f1`.
- 2026-11-10: F1 part 1 is on `claude/application-f1`.
  - **What it adds:** the fact catalogue `packages/shared/src/applicantFacts.ts`, with two parity tests:
    - `applicantFacts.test.ts` walks both Zod contracts;
    - `applicantFactsPacket.test.ts` walks what the packet fill places on a full application.
  - **What fails CI from now on:**
    - a contract key with no entry (or no declared reason it is not a fact);
    - an entry for a key no contract has;
    - a packet place that does not exist;
    - a packet value no fact claims;
    - an identity or Part 1 door that does not own the fact.
  - **The office-gap list:** facts with no office editor today are pinned as an inline snapshot (13 facts). F3 shrinks it.
  - **Departures from the plan, and why:**
    - The schemas are *referenced* by path, not moved. Moving them would be the same Zod in a new file, and the tests derive the paths from the schemas.
    - Labels stay in `APPLY_COPY` via `fieldLabels.ts`. Its type already forces the Spanish to cover every key.
    - D-AM7's `lint:application-parity` is these two tests rather than a `scripts/*.mjs` gate. The facts are TypeScript, and the `lint:*` scripts are plain Node. The tests run in `test-packages` and `test-api` on every PR, so a lint wrapper would only run them a second time.
  - **The unified rules F1 listed are behaviour changes with their own merges:**
    - non-US ZIP and phone need a migration first, because 0376's CHECKs hold Part 1 to a 5-digit ZIP and a US mobile;
    - CLP as a CDL class;
    - the key renames.
  - **Next:** F1 part 2 (the yes/no answers with no default, moved from F0), then F0b.
  - **New question:** Q-AM13.
- 2026-11-10: owner answered Q-AM13: every answer is office-editable before signing. The four drug-test statements need a note, and they reach the driver for acceptance on 3.1. Donor gender and EEO are replace-only. F3's card builds these doors. The catalogue's `office` reasons now name F3 instead of an open question.
- 2026-11-10: F1 part 2 is on `claude/application-f1-yesno`. This is the F0 row "Legacy unticked → No; defaults of Yes", which moved into F1.
  - **No question starts answered any more:**
    - each job's "Did you drive a truck?" (`operated_cmv`) and "Was this employer regulated by the DOT?" (`dot_regulated`). Both used to start at Yes (audit finding 15);
    - a legacy link's §40.25(j) question. It was an unticked checkbox, so skipping it filed No (finding 13). It is now a Yes/No question.
  - **The contract:** the two employer fields became `.nullish()`, so a draft can hold an unanswered job and the office's correction path still parses it.
  - **Where a blank is refused:**
    - the hand-off and the filing (`unansweredEmployerQuestions`, in `driverApplicationSchema`'s refinement);
    - the job panel's Save, for the applicant and the office alike (`employerProblems`);
    - the wizard's jobs screen.
    - A legacy filing is refused without §40.25(j) (`applicationLegacyFilingIssues` in `applicationSubmit`). A v2 link already asks it in Part 1.
  - **Kept:** the "answer Yes if unsure" asymmetry now lives in the hint, in English and Spanish. A PSP-suggested job still arrives as Yes/Yes, because PSP's own record is the evidence.
  - **Fixed along the way:** the office record's rule that dropped a Yes on a row whose answer was never recorded. The form now shows such a row as unanswered, so a Yes there is the office's answer and is sent.
  - **Next:** F0b (the one-time code for the DOB unlock).
- 2026-11-10: F0b is on `claude/application-f0b-unlock-code`. This is the F0 row "DOB typo locks driver out".
  - **What the driver gets:** once a date of birth has failed, the unlock screen offers "Email me a code" and "Text me a code". The code goes only where the link went:
    - the invitation's own email;
    - or the number they agreed to be texted on.
    - The request names a channel, never an address.
  - **What the code is:** six digits, 10 minutes, 5 tries. Only the newest code counts. A right code releases exactly what the date of birth would (`releasedView`, shared with `/unlock`).
  - **What the office sees:** "The date of birth on file may be wrong", with when the code was used. The office corrects the date in Identity (Q-AM13).
  - **Table:** migration 0585 `application_unlock_codes` (hashes only, 90-day retention; `audit_logs` keeps each send and use).
  - **Limits:** sends are 3 per link per hour (`unlockCodeLimiter`); verifies use the unlock's own 10 per 10 minutes.
  - **Departures from the row:**
    - The office "reset the DOB" already exists: it is Identity correction. Nothing new was built for it.
    - The code does not reset a sent sign link's five-try count. A link already stopped gives no code; "send it again" stays its remedy (D-AW14).
  - **Not built:** the remembered-device token from U2. It belongs to F4.
  - **Production, read-only on 2026-11-10:** 5 invitations, all with an email, 4 with SMS consent, 0 sign-link lockouts. Email covers everyone today.
  - **Next:** F2 and F3, in parallel on F1.
- 2026-11-10: F3 has started. Two merges so far.
  - **#2195 (merged):** migration **0586** gives `application_edits` a `note` column and a `withheld` flag. A withheld row holds no values, and a CHECK enforces that. These are for the Q-AM13 doors still to come: the drug-test statements need a note, and donor gender and EEO are replace-only.
  - **`claude/application-f3-card`:** the "Applicant facts" card on the office's review drawer.
    - **What it is:** every application fact the catalogue gives a door, once, grouped by the section the driver met it in.
    - **How it edits:** each answer is edited with its own control (typed date, state list, Yes/No, choice), never a stored-format box (E8).
    - **Where a save goes:** through the writer that holds the answer. Draft answers go to the draft edit. The date of birth and current licence go to the identity correction. On a v2 link, the phone, the current street, the CDL class and expiry, and every Part 1 licence go to the Part 1 correction, one answer at a time (`partOneCorrectionWith`).
    - **Retired:** "Correct an answer" (`ApplicationAnswerList`, `editableFields`) and the Part 1 form (`PartOneCorrection`).
    - **The F0b notice** now points at the card.
  - **Server, E7:**
    - The Part 1 and identity corrections now write an `application_edits` row per changed answer, addressed where the application files it (`partOneEdits`, held to `composeFiledApplication` by test). The driver sees them on 3.1. Until now they wrote only an audit row.
    - All three office corrections stop at the driver's first packet mark. Part 1 and identity used to stop at filing.
    - `applicationEditLog.ts` is now the one writer of `application_edits`.
    - The review response says `signingStarted`. The card's Part 1 and identity rows stay open before the form is sent, while the office screens, as the old Part 1 form did.
  - **Not yet:**
    - the jobs and gaps (still in `OfficeJobsSection`);
    - adding and removing rows (E2);
    - email and phone moving the invitation's contact (E3);
    - the 13 gap facts (`applicantFacts.test.ts` snapshot unchanged);
    - pointing the Permissions and Road-test drawers' identity copy at the card.
  - **Found:**
    - The SSN exists only after signing. The driver types it on the sign-off screen and it is sealed into `driver_applications`, so there is nothing for the office to replace before signing. That catalogue entry's door needs a ruling, not a build.
    - New question: Q-AM14.
- 2026-11-10: F3 part 1 merged (#2195 migration 0586, #2199 the card). F3c part 1 is on `claude/application-f3c-statements`: the owner's Q-AM13 exceptions.
  - **New door, `part_one_answer`** (`partOneAnswerSchema`, `POST …/part-one/answer`). It corrects ONE Part 1 answer the whole-set correction does not carry. It goes through the same writer, `record_applicant_intake`, overwriting only that key. No migration was needed: the function writes only the keys sent, and `drivers` keeps the rest.
  - **The driver's four drug-and-alcohol statements** (§40.25(j), the three §382.301(b) answers) have the catalogue rule `statement`.
    - A reason is required on the card, on the route, and on a legacy link's draft §40.25(j) (`note_required`).
    - The reason is kept on the edit row (`application_edits.note`).
    - The driver reads it beside the change on 3.1.
  - **Donor gender** has the rule `replace_only`.
    - The review sends only `donorGenderGiven`, and `partOneForFiling` now names its fields instead of spreading the intake row.
    - The editor opens empty.
    - The edit row is withheld: no values, held by 0586's CHECK.
    - 3.1 says "They replaced this answer…" and nothing more.
  - **Endorsements** (checkboxes, as the wizard has) and **"I don't have a medical card yet"** are ordinary Part 1 answers now.
  - **The office-gap snapshot went from 13 facts to 5:** education, references, EEO, carrier answers, SSN.
  - **Two of those are not builds, and need owner rulings:**
    - **EEO is never asked.** No screen writes the reserved `eeo` key, so there is no driver answer to correct. Replace-only applies the day a screen asks it.
    - **The SSN exists only after signing.** The driver types it on the sign-off screen and it is sealed into `driver_applications` (D-APP3), so before signing there is nothing to replace. With Q-AM3 (last 4 on the packet), the question is whether the office may type an SSN before the driver signs.
  - **Next (F3c part 2):**
    - the jobs and gaps into the card;
    - adding and removing rows (E2);
    - email and phone moving the invitation's contact (E3);
    - the education and references tables;
    - the carrier's own answers;
    - the Permissions and Road-test drawers pointing at the card.
- 2026-11-10: F3c part 2, step 1 — **the jobs and gaps are on the card** (`claude/application-f3c-jobs`).
  - **Decision:** the jobs timeline and its one employer form (`OfficeJobsSection`) are now the card's Employment group, drawn under the group's own rows. They were a second section of the drawer under the card. Jobs are not made into rows: a job is added, removed and corrected by its key (Q-AX7), a gap is explained against the timeline's dates, and the PSP record is read against all the jobs. None of that is one answer with a before and after. So there is still ONE editor of a job, and every answer is on the one card.
  - **The card's search finds the jobs** (`jobsMatch`): by the employer's name, by the employer form's labels, or by "job", "gap" or "employment". Before, the timeline could never match a search because it is not rows.
  - **Once every door is shut** (a view-only reader, signing started, filed), the card is not drawn. The timeline then stays on the drawer read-only, beside the PSP record, as it did before.
  - **Next:** step 2, adding and removing rows (E2).
- 2026-11-10: F3c part 2, step 2 — **adding and removing rows (E2)** (`claude/application-f3c-rows`).
  - **Two new draft edit ops.** `add_row` and `remove_row` work on `APPLICATION_ROW_LISTS`: addresses, other names, licences, equipment, accidents and convictions. An added row is sent whole and re-parsed by the draft schema. A blank row filled in one answer at a time would be refused at the first step, because a city is `min(1)`. Each op writes ONE edit row: `[list, i]`, with nothing before an add and nothing after a removal.
  - **What they refuse:**
    - removing the current home, which is corrected, never removed;
    - adding an accident or conviction while the driver's answer is still "none". The office changes that answer first, as its own correction;
    - on a v2 link, a licence row. Those licences are Part 1's, and filing drops the draft's copy. The API refuses it too.
  - **The card:** "Add …" sits at the end of each list's section. It opens the catalogue's questions for that list, each with the card's own control, starting from the driver's own blank row (`""`, never null). "Remove …" under each row asks for a confirm first. Neither shows while a search is typed or once the draft's door is shut.
  - **Removals are replayed** (`currentEditPaths`, shared). The rows have no key, so a removal moves later rows up. The card's "corrected" mark, the driver's 3.1 list and the office's "What you changed" all name each change where it is NOW. A correction to a row that was removed later says so. The edit rows themselves are never rewritten.
  - **New question Q-AM15:** the driver's own deletions are not replayed.
  - **Next:** step 2b, v2 licence add/remove through Part 1's whole-set correction. Then step 3 (E3).

- 2026-11-10: F3c part 2, step 2b — **a v2 link's other licences are added and removed through Part 1** (`claude/application-f3c-v2-licences`).
  - **Why Part 1:** on a v2 link the licences are Part 1's whole list, and filing drops the draft's copy. So "Add licence" and "Remove licence N" send the whole Part 1 set with that one licence changed (`partOneLicencesWith`). It goes through the existing Part 1 correction route, with no new route and no migration. The draft route still refuses a v2 licence row (#2213).
  - **Which window applies:** each list opens with its own door's window (`listDoor`, `editableLists`). A v2 licence follows Part 1's, which is open while the office screens. Every other list follows the draft's.
  - **The add form:** it does not ask the licence's "kind", which Part 1 never holds. The Part 1 contract checks the new licence before anything is sent, so a missing expiry or a duplicate licence is refused in the contract's words.
  - **One removal, one line:** `partOneEdits` now logs ONE licence taken out of the middle as one removal row `[additional_licences, k]`. Before, it logged a shift of every licence after it. The driver reads one act as one line, and `currentEditPaths` replays it like the draft's `remove_row`.
  - **Next:** step 3 (E3), a changed email or phone moves the invitation's contact.
- 2026-11-10: F3c part 2, step 3 — **a corrected email or phone moves how the carrier reaches the applicant (E3)** (`claude/application-f3c-contact`).
  - **Email:** when the office corrects the email answer, `application_invitations.email` moves with it. Every later message (approval, unlock code, signing link, travel) goes to that address. The move is audited by field name, never by value. The same address in other capitals moves nothing. A blank email is refused by the draft schema.
  - **Phone:** texts go to the number a consent names, and consent attaches to a NUMBER, so nothing moves to the new one. If THIS applicant was texted at the number the phone answer held, that consent is revoked (`withdrawSmsConsentOnNumber`, reason `office_corrected_phone`, audited). It is not `revoke_sms_consent`: that is STOP's, and it revokes every consent on the number org-wide. The applicant agrees again on their own link. This covers both doors: the Part 1 correction on a v2 link and the draft on a legacy one. A draft phone edit on a v2 link moves nothing, because Part 1's phone is the one that files.
  - **The card says so before Save** ("Emails … go to X. Saving sends them to the new address instead." / "They get texts at this number. Saving stops them…"), from the review's new `contact` field. The toast after Save says what moved.
  - **No migration.** 0233's guard leaves `revoked_at` and `revoked_reason` mutable, and both writes sit in files already listed as those tables' writers.
  - **New question Q-AM16:** `drivers.email` does not move.
  - **Next:** step 4, the education and references tables.
- 2026-11-10: F3c part 2, step 4 — **education and references on the card** (`claude/application-f3c-tables`).
  - **One row per row given.** A carrier question answered as a table is on the card as one row per row the driver gave, at `["questionnaire", question, i]`. That is three path segments, inside `applicationPathSchema`, so the schema was not widened. Each row is corrected whole, with each column's own control. A cell would be four segments deep, and a row is what the driver typed as one thing.
  - **Adding:** a row is added by `set` at the next index, up to the question's own `maxRows` (three references).
  - **Removing:** a new op, `remove_answer_row`. The replay (`currentEditPaths`) treats a table's rows like a list's.
  - **Checks:** the draft schema holds the questionnaire as an open record, so the applier checks each row against the question's columns. It refuses a hole, a row past the limit, a column the question does not ask, and a blank row, which filing would drop.
  - **The catalogue:** both facts now have the draft's door. The office-gap snapshot goes from 5 to **3**: EEO, carrier answers and SSN. The first two need owner rulings.
  - **Fixed — corrections showed the raw key:** a correction of any carrier question was labelled "questionnaire" on the driver's 3.1 and the office's "What you changed". `describeField` did not know the draft's key. It does now, and a table row reads "Three personal references · 2".
  - **Fixed — every editor said "Not shown to you":** #2221 (E3) put the contact notice between a `v-if` and its `v-else`. Every ordinary answer's editor then said "Not shown to you…". A regression test now pins the order.
  - **Next:** step 5, the carrier's own answers (`carrier_answers`, labelled from the invitation's stamp).
- 2026-11-11: F3c part 2, step 5 — **the carrier's own questions on the card** (`claude/application-f3c-carrier-answers`).
  - **One row per stamped question.** `carrier_answers` is one catalogue fact. The card lays it out once for each question on THIS applicant's stamp, which the review response carries as `carrierQuestions` (never the live list, D-CQ2). Each row is worded as stamped and sits under "The carrier's own questions". The draft does not carry the stamp (Q-CQ7), but the review does, so no migration was needed.
  - **The form's own control.** Each answer is corrected with the control the applicant's form answered it with (`questionControl`): yes/no, one of a list (its frozen choices only), a long answer, and a plain box for everything else. ⚠ The form asks a carrier "date" or "number" question in a plain text box and stores what was typed ("03/01/2026"). The card does the same. A date picker would write a different string than the form reads back, breaking D-AM7. Whether the form itself should ask those with the typed-date control is a form change, not a card one, and is not made here.
  - **The skip.** An optional question offers "I'd rather not say" as the form does: a box that puts the control away and stores the skip's words. The built-in optional questions (military service, other training, …) now offer theirs too. Before, the card opened a skipped yes/no answer empty. The browser pass found that a ticked skip also hid a yes/no question's own words, which live in its legend. The editor now names the question while the control is put away.
  - **Checked against the stamp.** The API refuses a correction (`carrierAnswerRefusal`, shared) to a question this applicant was not asked, an answer of the wrong kind or outside the choices, and a blank. A required question must be answered, and an optional one is answered or skipped, as on the form. It also refuses anything but one answer at `["carrier_answers", id]`. Before this step, a `set` there was taken for any id and any value. An invitation with no stamp takes none.
  - **Named where it is read.** The office's "What you changed" names a correction by the stamped words. The office's page serves no applicant bundle, so `describeField` would have said "The carrier's own questions" for every one. The driver's 3.1 already names them from its own bundle.
  - **The catalogue:** the office-gap snapshot goes from 3 to **2**: EEO and SSN, both waiting on owner rulings. (Step 4's entry said "the first two" need rulings; it is EEO and SSN, not carrier answers.)
  - **Next:** step 6, the Permissions and Road-test drawers' identity correction points at the card.
- 2026-11-11: F3c part 2, step 6 — **one editor of the date of birth and licence: the card** (`claude/application-f3c-identity-drawers`).
  - **The second editor is gone.** The Permissions step's "Date of birth and licence" (`ApplicantIdentityCorrection`) and the Road-test step's "Add the licence number" were a second editor of the same three answers, though both posted to the same identity route. Now `ApplicantIdentityOnFile` shows the three read-only (PSP, the MVR and the Clearinghouse run on them) with **"Correct them in the application"**. The page swaps the step drawer for the review drawer at the date-of-birth row (no nested dialogs). Closing the review brings back the step the office came from. An ordinary review does not do this. `useApplicantIdentity.ts` is deleted.
  - **The card had to become able to.** Pointing at the card as it stood would have been a regression in three ways:
    - **It showed the wrong values.** The card read the identity from the DRAFT, and at the Permissions step there usually is no draft. A licence PSP had already been ordered on read "Not answered", and a draft saved before the identity was given held a stale copy. The review response now carries `identity`, the record's values (`identityOnRecord`, only those set). The card lays them over the draft's copy, as filing does.
    - **It could not ENTER them.** The identity is written as all three at once. The card's one-row-at-a-time save sends the other two as shown, so with any missing every save was refused. While any is missing, Edit now opens all three together (`identityTogether.ts`). Once all are on file, each is corrected on its own as before.
    - **The step came back stale.** The steps show the identity from the page's own driver read, and nothing re-read it after a card correction. The page now re-reads it when the review closes.
  - **Road test (RT-A1, amended).** RT-A1 put the licence fix "here, in place, not in another drawer". With one editor the fix is in the application, and going there unmounts the road-test form. So a missing licence is now said at the TOP of the form, before anything is rated, with "Add it in the application". The in-form line after a pass is rated stays, without a button. It points to the note above, because a button there would throw away a rated test.
  - **No migration**; the identity route and its window (the first packet mark) are unchanged.
  - **F3c part 2 is complete** with this step. The office-gap snapshot holds EEO and SSN only, both waiting on owner rulings (with Q-AM14–Q-AM16).
- 2026-11-11: **owner rulings on every open question** (§5; Q-AM8–11 in `APPLICATION-SCREEN-MAP.md` §8).
  - **The rule that decides the rest: the online form is a prefill of the carrier's paper application** (`application-11.pdf`), and the paper decides what is asked. So EEO is not asked (Q-AM18), the street stays asked on previous homes (Q-AM8), and page 21 returns (Q-AM4).
  - **The SSN:** entered by the driver in the form, reviewed by the office like every answer, printed in full on the packet (Q-AM3). Admin and safety read all nine digits, and everyone else only the last four (Q-AM17).
  - **Employer dates stay the exact day** (Q-AM11 → b). Q-AM1, 5, 6, 9, 10, 14, 15 and 16 as recommended.
  - **New:** a documents-only link the office can send at any time, and scan-quality photos (Q-AM19).
  - **What is left, in order:**
    1. F2: the packet prints everything asked. **F2a** (this entry) prints the addendum. **F2b** prints the endorsements on the licence line; they live on the intake row, so the filing must compose them into the payload first, or a filed packet could not be reproduced. **F2c** makes three form changes: split "denied" from "suspended or revoked" (P4), a type for each licence (P3), and the conviction's place, penalty and bond (P10).
    2. Remove the reserved `eeo` key (Q-AM18).
    3. The SSN in the form, printed in full, with its permission (Q-AM3, Q-AM17). Needs a migration.
    4. Page 21 back in the packet (Q-AM4).
    5. One transaction for a correction and its edit row (Q-AM14), then stable row keys (Q-AM15), then the roster email (Q-AM16).
    6. F4, the driver's experience (U1–U9), with Q-AM5, Q-AM6 and Q-AM9.
    7. The documents-only link and scan-quality photos (Q-AM19). They are independent of the rest.
    8. F5, sending a question back (Q-AM1).
    9. The FMCSA name search (Q-AM10), later.
  - **P5 is already done:** `PACKET_ROW_OF` folds the six classes onto the four printed rows, and `foldedType` prints a tanker or bus by name in the type column.
- 2026-11-11: **F2a: the addendum** (`claude/application-f2-addendum`). P1, P6, P7 and P8 now print on a sheet appended after the continuation sheet and before the carrier's questions:
  - each employer's USDOT number, inquiry e-mail, whether the job was driving, DOT regulation, the two §391.21(b)(10)(iv) answers and the reason for leaving;
  - each address's months;
  - each stretch without work, with its explanation;
  - the applicant's e-mail and experience narrative.
  - **The layout:** the sheet shares one question-and-answer layout with the carrier's-questions sheet (`packetAnswerSheet.ts`). An employer whose answers cross a page is headed again on the next one.
  - **The catalogue:** each of those facts now names an `addendum.*` place instead of a `notPrinted` reason.
  - **The parity test** (`applicantFactsPacket.test.ts`) holds the sheet to the catalogue in both directions. It gains the §3 F2 check: on a full application, every place the catalogue names holds text. The exceptions are named: yes/no pairs, later lines of a wrapped answer, and printed names beside withdrawn signatures.
  - **Every packet is one page longer** (two or three with many employers). An unanswered question prints "Not answered.", never an invented "No".
