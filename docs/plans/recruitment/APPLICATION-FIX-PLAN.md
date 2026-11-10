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
| Q-AM1 | Can the office send ONE question back to the driver? | (a) yes, a per-question "ask again" that re-opens just that field; (b) no, only revoke and re-invite | **(a)**. Revoke and re-invite discards everything. |
| Q-AM2 | Correct facts after filing? | ANSWERED 2026-11-09: **(b)**. Anything can be edited before signing; nothing after (owner) | — |
| Q-AM3 | Does the SSN print on the packet (it reverses D-HIRE6)? | (a) print it; (b) print the last 4; (c) blank, as today | **(b)**. The boxes aren't blank, and the full SSN isn't on a PDF that gets emailed. |
| Q-AM4 | Is page 21 (seven-day statement) used? | (a) yes, the driver fills it; (b) remove it from the packet | Owner's call: it depends on whether new hires drove in the last 7 days. |
| Q-AM5 | Which carrier-only requirements stay required? (email, phone, donor gender, CDL photos, medical card, selfie, 7 carrier questions, gaps over 30 days) | per item | Keep phone **or** email, CDL photo (skippable to "pending"), medical card or pending. The rest stays required but labelled as the carrier's. |
| Q-AM6 | Spelling on the driver's side | US / British | **US**. The drivers and the regulation say "license". |
| Q-AM7 | Wizard granularity | ANSWERED 2026-11-09: one question per screen, grouped only for one fact (D-AM2/D-AM3); see APPLICATION-SCREEN-MAP.md | — |
| Q-AM13 | Can the office edit the driver's own statements: §40.25(j) (prior positive test or refusal) and the three §382.301(b) testing-program answers? | ANSWERED 2026-11-10 (owner): **yes, every answer is editable before signing**, "because drivers make mistakes and we need control over any mistake". Built as (c). These four edits require a note and are audited as office-entered. Like every edit (D-AM7), the driver sees and accepts them on screen 3.1 before signing, so the signed document is still their statement. The donor gender and the EEO answers are **replace-only**: the office can overwrite them but never sees them, like the SSN, because they must not reach whoever decides the hire. Nothing is editable after signing (Q-AM2). | — |

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

