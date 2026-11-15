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
| Q-AM20 | The signed packet prints the full SSN (Q-AM3), but only admin and safety may see all nine digits (Q-AM17). The filed packet is a stored document that recruiters open, so a full SSN on it reaches the readers Q-AM17 keeps it from. Which wins, and how? | ANSWERED 2026-11-12 (owner, "as proposed"): **(a)**. The stored packet prints the last four (`•••-••-1234`). A holder of "See the full SSN" gets the full packet rendered on demand from the sealed number, never stored. The office preview masks for non-holders the same way. The driver sees their own full number on the signing pages | — |
| Q-AM21 | Page 21 returns to the signing packet (Q-AM4). Should the signed page 21 also be a row of the roster's `seven_day_statements` (0236)? | ANSWERED 2026-11-12 (owner): **(a) yes**. Filing writes it through `record_application_seven_day_statement` (0591): `source = application`, the filed application named and unique, written once. The roster section shows it as the current statement, and the roster form stays for a start date too long after signing | — |
| Q-AM22 | The other names are a list of plain STRINGS (`other_names: string[]`), so a row had nowhere to hold Q-AM15's key, and an office correction to one was named by position. Key them? | ANSWERED 2026-11-13 (owner, "as recommended"): **(b)**, keyed in the DRAFT only, as `{ name, key }`. The form's filing and the preview's composition hand on the names, so the certified shape, the packet and `drivers` stay as they are | — |
| Q-AM23 | Q-AM5 ruled "phone **or** email". Read against the code on 2026-11-14: the signed application requires BOTH today (`driverApplicationSchema`), so a driver with no email cannot send at all; the carrier's paper asks "Phone #" and has no applicant e-mail field; and a driver with no phone is not sent to Med-Stop (it requires `phone1`), cannot be texted, and prints a blank "Phone #". Which is built? | (a) e-mail optional ("I don't have email"), phone stays required; (b) phone or email as ruled, a phone-less driver added to Med-Stop by hand and reached by e-mail only | **(a)**: it removes the block that exists, and matches the paper |
| Q-AM24 | A permit (CLP) holder: the class is the roster's `CDL_CLASSES` (A, B, C), written to `drivers.cdl_class`, and Med-Stop requires a class. The paper asks no class | (a) the permit holder picks the class they are training for, and the office reads "permit" from the license kind; (b) add CLP to the roster's class list (roster, Med-Stop and every class reader change) | **(a)** |
| Q-AM25 | Q-AM19's second half: photos "normalised to scan quality (cropped to the card, straightened, evened)". Read against the code on 2026-11-14: (1) the in-page scanner already CROPS to the outline, for the four first-visit photographs only (`LiveScanner`, `LIVE_SLOTS`); the documents list's "Take photo" opens the phone's camera app and sends the whole frame. (2) Straightening and evening are the scanner programme's Phase 6 (`SCANNER-UPGRADE-PLAN.md`, "Enhancement"): a separate ARCHIVE copy, the original of record never modified (D-SCAN6), never binarised, and no quality floor until samples exist (D-SCAN10). That programme waits on its device session (D-SCAN13, an owner ruling). A cropper written inside the application would be a second implementation of Phase 6 and would alter what is filed. How is it built? | (a) Now: the documents list's "Take photo" uses the in-page scanner, so every document is cropped to its outline as the CDL is; straightening and evening come with Phase 6, as a derived copy made on the server (`sharp` and the `document_derive` job are there). (b) Pull Phase 6's ARCHIVE copy ahead of the device session for photographs from the link, server-side — reverses D-SCAN13's order for this one path. (c) Crop, straighten and even in the browser inside the application now | **(a)**. (c) is not recommended: it is a second scanner, it changes the filed photograph itself, and there are no samples to tune it on |

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
- 2026-11-11: **F2b: the endorsements print on the licence line (P12)** (`claude/application-f2-endorsements`). F2a merged as #2255.
  - **The fact:** Part 1's endorsements are now an application fact, `cdl_endorsements`. Filing composes them from the intake row (`composeFiledApplication`, in the roster's order; an empty list is filed as an answer). The packet prints them with the class in the licence grid's TYPE column, as `A (HNT)`.
    - The catalogue's intake entry now says `through` it. So the card shows one row where the application files it, and the office's correction is recorded at `["cdl_endorsements"]` (`shownAt`).
    - A legacy link has no Part 1, so it has no endorsements row.
  - **Found and fixed:** the office's preview drew the RAW draft. On a v2 link the draft is what the applicant's tab last saved. So a licence, phone, class or §40.25(j) answer the office corrected in Part 1 afterwards never reached the preview, and neither did any endorsement. The preview now composes exactly as filing does (`applicationAsFiled.ts`, shared by both), with the record's identity laid over it. This is a D-AM7 mismatch the audit had not listed.
  - **Not done:** an office correction to the endorsements made BEFORE this merge has its edit row at `["endorsements"]`. Driver screen 3.1 still names it (the label is kept), but the card does not mark the row corrected. This affects only applications still open across the merge.
  - **Next:** F2c, with three form changes: P4 (denied vs suspended or revoked), P3 (a type for each licence) and P10 (each conviction's place, penalty and bond).
- 2026-11-11: **F2c part 1: the carrier's page 2 questions, as the paper asks them** (`claude/application-f2c-licence-questions`). F2b merged as #2258.
  - **P4:** "denied" (A) and "suspended or revoked" (B) are asked apart, in the paper's own words, each with its own "If yes, explain".
    - A keeps the key `licence_ever_denied`. B is `licence_suspended` and `licence_suspension_detail`.
    - The packet marks each line from its own answer.
    - **An application filed before F2c** answered ONE combined question. It still prints that answer on both lines, as it was signed: `driver_applications` is append-only and must re-render (§390.32(d)). This is a read of old records, not a workaround.
  - **P10, ruled by the paper (owner 2026-11-11):** the conviction grid's columns are DATE CONVICTED, VIOLATION, STATE OF VIOLATION and PENALTY. So the state and the penalty are now required on every conviction.
    - The plan's earlier "city + state" and separate "bond forfeiture" are dropped: the paper asks neither. Its heading already says "convictions and forfeitures", and the form's question says the same.
  - **The rules:** both are `applicationPaperFilingIssues`. They run on every new filing, v2 and legacy alike, and on the driver's screen. They are not in the contract, because filed applications without them must go on parsing.
  - **Found in the browser pass:** `AppButton`'s link variant inherited the control's `whitespace-nowrap`. So the "Before you can go on" list, whose links are whole questions, ran past the card's edge on a 390 px phone. Link buttons wrap now, in every app.
  - **Not done, and why:**
    - **The new refusals read in English on the Spanish page,** as every existing filing rule does. That is U7's "shared code returns a message key" (F4), which fixes them all together.
    - **The new questions say "license"** (Q-AM6, US) while the rest of the screen still says "licence". F4's U9 renames the rest.
  - **Next: F2c part 2, P3, a type for each licence.** Part 1's other-licences screen asks it, and `application_intake_licences` needs a `kind` column. That is a migration, so it merges first and its reader in a second merge.
- 2026-11-11: **F2c part 2: a type for each licence (P3)** (migration `claude/application-f2c-licence-kind` #2265, then `claude/application-f2c-licence-type`). F2c part 1 merged as #2260.
  - **The answers:** the paper's TYPE column is free text. The four answers are the plan's P3 list: CDL, CLP, a regular licence (not a CDL), or other. They are stored as codes (`LICENCE_KINDS`, 0588's CHECK), so every packet prints the same words (`CDL`, `CLP`, `Non-CDL`, `Other`, `licenceKindWords`) whatever language the form was read in. The current CDL has no type of its own: its TYPE cell is its class and endorsements (F2b).
  - **The form:** Part 1's other-licences screen asks the type between the number and the expiry date, in the paper's column order, and refuses "Add this licence" without one. The list line names it. The new words use US spelling (Q-AM6); the rest of the screen is renamed with U9.
  - **Filing and the card:** `partOneForFiling` reads `kind`, and composition files the code into `additional_licences[].kind`. The office card shows it as a four-answer choice and corrects it through the Part 1 correction (`partOneCorrectionWith`). The card's licence adder now asks it too: the `PART_ONE_SKIPS` exception went with the reason for it. The driver's review shows the words, not the code.
  - **Fixed before it shipped, a wipe:** the identity correction posts Part 1's licence list back whole (`correctIdentityThroughPartOne`). Re-posted without `kind`, every type would have become NULL on the first date-of-birth fix. Both reads now select it, and the tests assert the select itself, because `supabaseRecorder` serves whole rows whatever is selected.
  - **Old records:** a licence recorded before 0588 has no type and prints blank; the office can set it on the card. A pre-v2 draft's free-text `kind` ("B", "permit") prints as filed (§390.32(d)).
  - **Not done, why:**
    - **The type is not required at the door** (`applicantIntakeLicenceSchema.kind` is nullish). The office correction posts every stored licence back whole, and a licence stored before 0588 has none. Only the screen requires it.
    - **The legacy Part 2 licence fields** (`LicenceFields.vue`, legacy links only) still take free text. No legacy link is still being filled.
    - **The card's adder does not require a type**, like every other column it asks.
  - **Next:** item 2, remove the reserved `eeo` key (Q-AM18).
- 2026-11-11: **Item 2: the reserved `eeo` key is gone (Q-AM18)** (`claude/application-remove-eeo`). The carrier's paper prints an equal-opportunity statement and asks no self-identification question, so the form asks none. The key, its schema slot, `readableAnswers` (which existed only to drop it), the carrier-question guard and the catalogue entry are removed. No screen ever wrote the key, so no filed payload holds it. The office-gap snapshot is `["ssn"]`.
  - **Next:** item 3, the SSN in the form (Q-AM3, Q-AM17).
- 2026-11-11: **Item 3 (the SSN), step 1: where it lives before signing** (`claude/application-ssn-in-form`, migration 0589).
  - **The table:** `application_ssns` holds a typed SSN between the form and filing, one row per invitation, in 0220's two shapes: the last four in the clear and the whole number only sealed (secretBox v1, purpose `driver_ssn`). It is removed with its invitation. Its one writer, `record_applicant_ssn`, refuses another org's or driver's invitation (SN001), a revoked one (SN002) and a filed one (SN003). The office's window (until the first packet mark) is the API's check, as for every other door.
  - **The draft rule stays:** `applicationDraftSaveSchema` still refuses an SSN in a draft (D-APP3). The form posts it to its own route.
  - **The steps that follow:**
    - (2) the form asks the SSN and posts it sealed;
    - (3) the "See the full SSN" permission (`CLOSE_APPLICATION_PERMISSION`'s pattern), shipped to the safety manager, with the admin always holding it, plus the office card showing `•••-••-1234` with "Replace" for everyone else;
    - (4) filing moves it onto `driver_applications` and deletes the pre-signing row;
    - (5) the packet.
  - **Blocked:** step (5) waits on **Q-AM20** (§5). A full SSN on the stored packet reaches the recruiters Q-AM17 keeps it from. The recommendation is (a): the stored packet prints the last four, and the full packet is rendered on demand for permission holders.
- 2026-11-12: **Item 3, step 2: the driver enters the SSN in the form** (`claude/application-ssn-form`). 0589 merged as #2272. Q-AM20 answered **(a)** (§5).
  - **The form:** "About you" asks it again. F4 had moved it to the sign-off screen only because a draft cannot hold it. `SsnField` posts it on a press to `POST /:token/ssn`, its own route, never the draft (D-APP3 stands). The page then holds only the last four (`ssn_on_file`), and the typed digits are cleared. The sign-off screen shows the same control, so a driver who skipped it can still give it. A number already on file shows as `•••-••-1234` with "Change it".
  - **The server:** `recordApplicantSsn` seals it (purpose `driver_ssn`, as filing always has) and writes it through `record_applicant_ssn`. It answers with the last four only, and refuses once the driver has made a packet mark, as every other answer does. The unlock (date of birth or code) releases the last four with the draft, never more.
  - **Filing:** `ssnForFiling` files the saved last four and envelope as they are, unopened. A number typed at sign-off by a page served before this change still wins. Once the filing commits, the pre-signing row is deleted, so the number lives in one place.
  - **Still optional:** Q-H2 made the number optional, and no ruling changed that.
  - **Next:** step 3, the "See the full SSN" permission and the office card's replace door.
- 2026-11-12: **Item 3, step 3: "See the full SSN", and the office's replace door** (`claude/application-ssn-office`). Step 2 merged as #2283.
  - **The permission:** `FULL_SSN_PERMISSION` (`recruitment.full_ssn`) follows `CLOSE_APPLICATION_PERMISSION`'s pattern. It ships to the safety manager, the admin always holds it, and a carrier switches it per role in Settings → Permissions (0564 already accepts the key, so no migration).
  - **The card:** the identity group has its own SSN row (`ApplicantSsnRow`), not a catalogue row. Everyone sees `•••-••-1234`. A holder gets **Show**, which reads the nine digits per press with a plain request, never a cached query; **Hide** drops them. Anyone who corrects the application, recruiters included, gets **Replace**, which types a new number without seeing the old one.
  - **The API:**
    - `GET /applications/:id/ssn` sits behind recruitment view plus the permission. It is never cached, and every read writes an `application.ssn_viewed` audit row without the number.
    - `POST /applications/:id/ssn` is recruitment manage. It is closed at the first packet mark, like every correction. It writes a WITHHELD edit row at `["ssn"]`, so the driver's 3.1 says it was replaced and shows no digits, plus an `application.ssn_replaced` audit row.
    - The review carries only `ssn.last4`.
  - **The catalogue:** the SSN's door is `office: "ssn"`. **The office-gap list is empty: every fact the driver answers can now be corrected.**
  - **Next:** step 5, the packet (Q-AM20 (a)): the stored packet prints the last four, and holders get the full packet on demand. Step 4 (filing moves it and deletes the pre-signing copy) shipped with step 2.
- 2026-11-12: **Item 3, step 5: the SSN on the packet (Q-AM20 (a))** (`claude/application-ssn-packet`). Step 3 merged as #2286. **Item 3 is complete with this step.**
  - **Four places, measured:** page 1 `Social Security number`, page 4's rule shared with the printed name (x310.8–463.8), page 12's `SS #` cell, and page 15's `SSN`. D-HIRE6's blank and its pin test are gone. The packet prints only what its caller hands it (`PacketFieldInput.ssn`), so no rendering prints more than its reader may see.
  - **Who reads what:**
    - **The stored packet** (`file.ts`): `•••-••-1234`, from the clear last four. It never reads the sealed column.
    - **The office preview:** masked by default. A holder of "See the full SSN" gets all nine, and the read is audited.
    - **The driver's reading copy:** their own number in full.
    - **The filed packet in full,** for a holder only: a new **Open with the full SSN** button in the document viewer of the driver's qualification file. It calls `GET /filed-applications/:documentId/full-ssn.pdf`, which covers the four places on the stored copy (the countersigned one once there is one) and draws the nine digits there. It is never stored, uncached and audited. It refuses a number kept as its last four only, and an application filed before the packet.
  - **`maskSsn` and `formatSsn`** in `applicationIntake.ts` are the one definition the card, the packet and the preview use.
  - **Known, and why:** the full copy's cover is visual, so the masked four stay in its text layer. A grid cell redrawn alone may be a point off its original size.
  - **Next:** item 4, page 21 back in the packet (Q-AM4).
- 2026-11-12: **Item 3 complete** (#2265 licence type, #2272/#2283/#2286/#2290 SSN). **Item 4 (page 21) scoped; one owner question, Q-AM21.**
  - **What page 21 needs, measured:** `application-11.pdf` page 21 asks name, address, CDL (#, state, expiry), today's date, seven dated days of hours, a total, and "last relieved from duty at ___ at ___ am/pm". It has two driver signature lines and a `Company Representative` line. Today it has no signing places (`packetPlacements.ts`), no field geometry and no contract key: it left the packet on 2026-08-23 (D-PKT7).
  - **The build, in order:**
    - (1) a contract key `seven_day_statement` (days' hours, last relieved) on the application, nullish for old filings and required by `applicationPaperFilingIssues` for new ones. The seven dates are derived: the seven days before the signing day (Q-AM4: the driver fills it at signing; the roster form stays for a start date too long after).
    - (2) the office corrects it through the draft door before signing, "usually to zeros" (Q-AM4).
    - (3) the sign-off screen shows it for the driver to fill or accept.
    - (4) page 21's geometry and signing places: two driver marks and the carrier's countersign line, like `p18c`.
    - (5) filing: Q-AM21.
  - **Next:** build (1)–(4); (5) after Q-AM21.
- 2026-11-12: **Item 4, step 5's migration: page 21 is also the roster's record (Q-AM21 (a))** (`claude/application-page-21`, migration 0591; 0590 was taken by a parallel chat's unit notes).
  - `seven_day_statements` gains `source` (office, the default, or application) and `application_id`, which is unique, cascades with its application and is checked to be set exactly for application rows. The SD010 guard now covers both.
  - `record_application_seven_day_statement` writes a page-21 row once per application. It is service-role only and refuses another org's application (SD020).
  - **Next:** the reader merge, page 21 steps (1)–(5).
- 2026-11-12: **Item 4: page 21 is back in the packet (Q-AM4, Q-AM21)** (`claude/application-page-21-form`). The 0591 migration merged as #2292. **Item 4 is complete with this merge.**
  - **The answers:** `seven_day_hours` (seven numbers, oldest first) and `last_relieved_at` (local `YYYY-MM-DDTHH:mm`) on the application. Both are nullish for old filings. The dates are derived, never stored: `sevenDayWindow` of the application's day (`displayDayOf(certified_at)`, the day the page prints).
  - **When they are asked:** at signing. `sevenDayStatementIssues` is its own rule, run only at filing and never at the form's hand-off, which comes first. Splitting it from `applicationPaperFilingIssues` was forced: the hand-off would otherwise have refused every application for a page not yet asked.
  - **The driver:** the sign-off screen shows "Your last seven days", seven boxes named by their days in the carrier's calendar, a total, and "When were you last off duty?". Autosaved once whole.
  - **The office:** the card corrects it before signing as one row (seven boxes, usually zeros) through the draft door. `last_relieved_at` uses a date-and-time box.
  - **The packet:**
    - the identity block is the single-licence block (same eight spans as pages 18/19, measured from the page's vector rules);
    - the dated grid, the total, and the date and 12-hour time last relieved;
    - two driver signature places `p21a` (with its date) and `p21b`, and the carrier's countersign line `p21c`.
    - The walk grows from 15 to 17 stops (16 for a company driver), and the carrier's lines from four to five. Every pinned count says why it moved.
    - The workbook keeps page 21's last row as ONE row holding the driver's and the carrier's lines, so the placement tests name it (`TWO_LINE_ROWS`).
  - **Filing:** `recordSevenDayFromApplication` writes the roster's `seven_day_statements` row through 0591's function, once per application, best effort. It reads `last_relieved_at` in the carrier's zone.
  - **⚠ Deploy note:** a packet's text version (A-5) changes with page 21, so a driver part-way through signing when this deploys is refused at their next mark (DR037) and restarts the walk. That is the existing mechanism, working as designed.
  - **Next:** item 5, Q-AM14 (one transaction for a correction and its edit row).
- 2026-11-12: **Item 5, step 1: an office correction and its edit row are one transaction (Q-AM14 (a))** (migration `claude/application-edit-one-transaction` #2300, then `claude/application-edit-one-transaction-reader`).
  - **The functions (0593):** one `correct_*` function per office door: `correct_application_draft`, `correct_applicant_intake`, `correct_applicant_identity` and `correct_applicant_ssn`. Each calls the existing writer unchanged, then `record_application_edits`, the one writer of the rows. A plpgsql call is one transaction, so if the rows are refused (AE001 for a malformed list or path, 23514 for 0586's CHECK) the correction is undone with them.
  - **Why new functions, not an optional `p_edits` on the old four:**
    - Every applicant save goes through two of those writers, and the applicant never logs an edit.
    - A defaulted argument means drop-and-recreate (PGRST203), which would re-copy four long bodies.
    - The old signatures and their callers stay exactly as they were.
  - **The API:**
    - `recordOfficeEdits` and its after-the-fact insert are gone.
    - `editsParam` shapes the rows the call carries. `editRowsRefusal` turns a refused row into `edit_not_recorded`, which now says "Nothing was changed".
    - All five doors call their `correct_*` function: the draft, the Part 1 correction, the single Part 1 answer, the identity (both writers) and the SSN replace.
    - The edit rows are computed before the write, from the values read before it, as they already were.
  - **Tests:**
    - The matrix (`application-corrections-one-transaction.test.mjs`) proves that a refused row leaves each wrapped write as it was.
    - The route tests read the rows off the call (`testing/officeEdits.ts`).
    - Each door's refusal maps to `edit_not_recorded` with no audit row.
  - **Next:** Q-AM15, a stable key on every row of the six lists.
- 2026-11-12: **Item 5, step 1 complete:** #2300 (0593) and #2301 merged.
- 2026-11-12: **Item 5, step 2: stable row keys (Q-AM15 (a))** (`claude/application-row-keys`, no migration). Drafts are JSON, so a key is just another field on the row.
  - **The key:** `applicationRowKeySchema` (a record id, nullish) is now on every row of addresses, other licences, equipment, accidents and convictions, the way the employers have had one since AW1.
    - It is nullish because every filing before it has none.
    - The form leaves it off a filing (`toApplication`), so a filed document is exactly what it was. The key addresses a draft row, never an answer.
    - The catalogue lists it as `NOT_APPLICANT_FACTS`, and the card's labels name it ("This row's record") so the labels test holds.
  - **Who mints it:**
    - the form, when it makes a row (`newRowKey` in each `empty*`) and when it loads a draft saved before keys (`fromDraftPayload`, AW1's rule for jobs);
    - the API, on the office's first write (`withRowKeys`), and on an added row the card sent without one.
  - **The office's edits name the row by key:**
    - a correction is `["addresses", "<key>", "city"]`;
    - `remove_row` takes `key`, and `index` reaches only a row that was keyless when read (`rowIndex`, the employers' rule);
    - `add_row` logs the new row's key;
    - a whole-row `set` keeps the row's key;
    - the card sends keys (`keyedEditPath`).
  - **The readers look a keyed correction up, rather than replay it:** `currentEditPaths(edits, rows)` finds the key in the draft the reader holds, so the card's mark, the office's "What you changed" and the driver's 3.1 follow the row wherever the driver has moved it. A correction is `gone` once its row is deleted. The replay stays for the positional paths that remain.
  - **Not done, and why:**
    - **The other names stay positional** (Q-AM22, §5). They are strings, with nowhere to hold a key, and keying them changes the list's shape for every reader. The recommendation is to key them in the draft only.
    - **Deploy window:** a positional correction recorded before this merge is still replayed. A keyed removal after it does not shift that correction. This only affects an application open across the deploy.
    - A browser left open on old code during the deploy drops the keys on its next save. The API then re-keys the rows on the office's next write, and an office correction made in that window shows as gone on 3.1. The fix is a reload, which the next page load does anyway.
  - **Next:** Q-AM16, the roster email following an office email correction, through a roster-owned RPC. Q-AM22 waits for the owner.
- 2026-11-12: **Item 5, step 2 complete:** Q-AM15 merged as #2305.
- 2026-11-12: **Item 5, step 3: the roster's email follows an office email correction (Q-AM16 (a))** (migration `claude/application-roster-email` #2306, then `claude/application-roster-email-reader`).
  - **The roster's function (0594):** `move_applicant_roster_email` sets `drivers.email` only when all of these hold:
    - the invitation is this org's and unfiled;
    - its driver is still an applicant;
    - the row still holds the address being replaced (ignoring case and spaces), or none.
    - An email set on the roster since is never overwritten from an application, and a hired driver's email is the roster's own business.
    - It answers whether it moved.
  - **The roster's door:** `moveApplicantRosterEmail` in `modules/roster`, exported from its index. Recruiting calls it after the invitation's email moves (`moveContact`) and never writes `drivers` itself.
  - **What the office sees:**
    - The audit row carries `rosterEmailMoved`.
    - The review returns `contact.rosterEmailMoved`, and the toast adds "Their driver record has the new address too." only when it moved.
  - **Item 5 is complete with this merge.** Q-AM22 (the other names) waits for the owner.
  - **Next:** item 6, F4 (U1–U9), with Q-AM5, Q-AM6 and Q-AM9.
- 2026-11-12: **Item 5 is complete:** Q-AM16 merged as #2306 (0594) and #2312.
- 2026-11-12: **Item 6 (F4), first PR: shared rules speak the page's language (U7)** (`claude/application-f4-scope`, no migration).
  - **Why this first:** F4's other PRs rebuild the screens on top of the same rules. Keying the rules first means the wizard engine renders keys from the start, and no screen gets built twice. It also closes the gap named under F2c ("the new refusals read in English on the Spanish page").
  - **The catalogue:** `APPLICANT_ISSUE_TEXT` (shared, `applicantIssues.ts`) holds every sentence a shared rule says to an applicant, by key, with typed params. It covers:
    - the cross-field rules;
    - the filing rules: v2, legacy, the carrier's paper, and page 21;
    - the two job questions;
    - composition's expiration refusal;
    - the two "ends before it starts" refinements;
    - the date-of-birth refinement (`dateOfBirthProblem`, now in `dateOfBirthRules.ts` for the file budget).
  - **How each kind of issue carries its key:**
    - Every issue keeps `message` (English, for the API and the office) and adds `issueKey` and `params`.
    - A Zod refinement carries its key in the issue's `params`, which survive `safeParse` (`issueKeyOf`).
  - **The page:**
    - `APPLY_COPY.ruleIssues` is the catalogue itself in English. Its Spanish twin (`es/strings.es.issues.ts`) is checked key for key by `satisfies`, so a new rule without Spanish fails `vue-tsc`.
    - `messageFor` renders a keyed issue in the page's language. The job form (`employerCheck`) now goes through it too; it had shown the rule's English directly.
  - **US spelling (Q-AM6):** composition's refusal now reads "Give the expiration date of your OH license".
  - **Not done, and why:**
    - **The carrier's own questions** keep their English `message` in the API. The page already says "Answer this question." in its own language, because the label beside it names the question.
    - **The schema's own shape messages** ("Expected a date as YYYY-MM-DD") stay unkeyed. `messageFor` never shows them to a driver (its generic branches).
    - **U7's gate on literal strings in `apply/` templates** is not built here. It comes with the wizard engine, which replaces those templates.
  - **Next:** Q-AM6, US spelling on every driver screen (U9's spelling half). Then the F4 wizard engine.
- 2026-11-12: **F4 PR 1 (U7) merged as #2316.**
- 2026-11-12: **F4: US spelling on the driver's side (Q-AM6, the spelling half of U9)** (`claude/application-us-spelling`, no migration).
  - **The gate:** `strings.test.ts` now fails on "licence" or "expiry" in any ENGLISH string the applicant can read. It walks every `APPLY_COPY` leaf, functions included, and the served questionnaire. It found 45; all now read "license" and "expiration".
  - **The shared words the page shows:**
    - the section title ("Your license");
    - the two CDL photo names;
    - the documents list;
    - Part 1's licence-list refusals (`applicantScreeningContract`);
    - one packet signing place.
  - **Kept, and why:**
    - **Contract keys and code names** (`licence_suspended`, `additional_licences`, `LicenceFields.vue`). They are code, and renaming them is a migration of every stored payload for no reader's benefit.
    - **The office's own surfaces** (DQ catalogue, MVR, roadside, notifications). Q-AM6 rules the driver's side.
    - **The legal instruments** (the authorization release text, the disclosures). Editing those is counsel's act, as the citation gate already says.
    - **The questionnaire's proof-of-age hint** is fixed in v3 in place. Its spelling is not the question asked, and screen map §5 drops that question with the wizard.
  - **Next:** the F4 wizard engine (plan §6, F4 PR 1: generated from the catalogue).

- 2026-11-12: **Q-AM6 merged as #2317.**
- 2026-11-12: **F4 PR 1a: the wizard engine, and Stage 1 one question per screen (SCREEN-MAP §7, D-AM2/D-AM3, U7's gate)** (`claude/application-wizard-engine`, no migration).
  - **The catalogue says where each fact is asked.** `ApplicantFact.ask` is a list of places: the screen, its "IF" condition (`when`) and, for a date, which years a short answer means (`dates`). A list, because one fact can be asked twice: the CDL's number on its own card, and each other licence's in the loop.
  - **The screens are generated, not written.** `WIZARD_SCREENS` (`packages/shared/src/applicantWizard.ts`) is, for each id in `WIZARD_SCREEN_IDS`, the facts whose `ask` names it, in catalogue order. One fact is a single-question screen; several are one fact typed together (the address, the licence card).
    - The ids are a listed vocabulary, because the page's copy and the walking order are keyed by them. A test holds the list and the catalogue to each other both ways.
    - A choice's answers are read from the contract's own enum (`factChoices`), never restated.
  - **One `WizardScreen` renders any screen.** The control comes from the fact's `input` kind alone. It reads and writes through a binding (`wizard/wizardBinding.ts`), the one place a page says where its answers live. Part 1's binding is `partOneFields.ts`; Part 2's draft gets its own with PR 1b.
  - **Stage 1 (Part 1's typed pages).** "About you" is now the phone, then the date of birth. The CDL is its card, its class, its expiration, then its endorsements. The drug-and-alcohol page is one question to a screen, and 1.12 and 1.13 appear only after a "yes" to 1.11. `PartOneAnswerFields.vue` is gone.
  - **The page still saves; the screen only asks** (`usePartOneWizard`).
    - A screen's Continue checks that screen's share of the page's own check. Its Back steps within the page.
    - The page's last screen is the page's old Continue. So the posting order (0376), the device copy, the resume point and the screen reports are all unchanged and stay per page.
    - If the page's Continue still refuses, the walk opens the screen holding the problem.
    - "Step n of m" counts screens: 16, or 18 after a "yes" to 1.11.
  - **U7's gate** (`templateLiterals.test.ts`) reads every driver template under `apply/` with Vue's own parser. It fails on:
    - a literal text node;
    - a static or quoted-sentence `label`/`legend`/`hint`/`placeholder`/`title`/`alt`/`heading`/`aria-label`;
    - a picker left with `AppCombobox`'s English "Select…".
  - **What the gate fixed.**
    - It found: the signing rail ("0 of 22 done", "Page 4", its two list labels), "You are reading page…" and "Take me back", the read-only releases panel, three "Optional" placeholders, two page labels, the packet viewer's label, and "Select…" on eight pickers. The rail's screen-reader sentence lives in its script, where no template gate looks; it moved with them.
    - All now come from `APPLY_COPY` (`strings.screens.ts`), with Spanish drafted for the owner's review.
    - The office's own screens in the folder are listed by name and left in English (Q-AM6's ruling).
  - **Not done, and why:**
    - **Stage 2** (Part 2's five section components) and the loops, including Part 1's other-licences loop: PR 1b. Their facts get `ask`; `loop` and `quickPicks` join the type then, with their first reader.
    - **Part 1's two loop columns and the medical card's "not yet"** are named in `ASKED_BY_HAND`, with where each is asked. The catalogue test holds every Part 1 fact to an `ask` or a line there.
    - **The screen reports stay per page** (`part1.about`). A finer name is a new value in 0376's vocabulary, so it waits for U1's measured walk, which will decide what it needs to time.
    - **Yes/No is still the radio pair** (`YesNoQuestion`). The two big buttons are U3.
  - **Proof:**
    - shared: 10 wizard tests;
    - web: the walk (7), the screen (8) and the gate (3);
    - every mutant caught (9, including one survivor that got its own test);
    - every e2e-apply spec walks the new screens (35 passed);
    - a screenshot pass at 390×844 in EN and ES.
  - **Next:** F4 PR 1b, Stage 2 generated, with the loops (addresses, employers, licences, equipment, accidents, convictions), replacing the five section components.
- 2026-11-13: **F4 PR 1a merged as #2325** (in production with `v2026.11.13`). **F4 PR 1b, Stage 2, planned against the code and every later ruling.** The owner said "proceed as proposed, without assumptions".
  - **Measured first:**
    - Production, read-only: **0 open legacy links** (no Part 1 row) against 4 open v2 links.
    - Every invitation is minted with its Part 1 row (`mintIntakeRow`), so no new legacy link can exist.
    - So the generated walk serves **Part 2's task list only** (`useTaskHub`, v2). The legacy wizard keeps the section components until a closing PR retires the legacy Part 2 path with them. That is sequencing, not a second editor: no link can reach it.
  - **Where SCREEN-MAP §3 is overruled by a later ruling** (it predates them):

    | Row | SCREEN-MAP §3 says | Built as | Ruling |
    |---|---|---|---|
    | 2.10 employer dates | month and year | the exact day, as today | Q-AM11 (b) |
    | 2.19c conviction place | city and state | the state only | P10, the paper's columns |
    | 2.22/2.23 education | level + CDL school, table dropped | the paper's table, one screen | Q-AM18's rule: the paper decides |
    | §5 "proof of age" | dropped | asked, as `p01.proof_of_age` prints it | Q-AM18's rule |
    | 2.24a military "when" | a date range | the paper's free text | Q-AM18's rule |
    | 2.30 documents | multi-pick, then a photo each | the documents task, unchanged here | Q-AM19 builds documents separately |

  - **Order: one PR per task, each complete.** The task list already makes a task the unit the driver opens, saves and closes.
    1. **1b-1, the engine and "Your driving record."**
       - The generated walk inside a task (`useTaskWalk`). Continue checks only that screen's share of the task's own check (`validateSection`). Continue on the last screen closes the task (`hub.finish`), and a refusal opens the screen holding the problem.
       - Loops are derived from the catalogue: a screen whose facts are one list's columns repeats per row, then asks "Any other?". A gate is a yes/no that answers whether the list has rows (`ask.gate`).
       - Quick picks file the English words, because the packet is the carrier's English paper (Q-AW11). The button shows them in the page's language, as license kinds already do (`licenceKindWords`).
       - Screens: accidents (gate; date; what happened; hurt and killed together, one fact; hazmat spill), convictions (gate; date; offence with quick picks; state; penalty with quick picks), denied plus its detail, suspended plus its detail. The §40.25(j) question stays Part 1's (D-AW13).
       - **Hazmat spill becomes a real Yes/No** (SCREEN-MAP 2.18d; F1 part 2's rule that no question starts answered). It was a checkbox defaulting to No. It is now nullish in the contract (every filed payload holds a boolean, so they still parse) and required per accident by `applicationPaperFilingIssues`, because the paper's grid has the column.
    2. **1b-2, "About you" and the carrier's questions.** Name (one fact, grouped), email, other names (gate, then a list), and the SSN. Every asked carrier question is one screen, generated from the served definition (the built-in questions and the carrier's own; a table question is one screen). Quick picks for "How did you hear about us?". "Applying as" is skipped when the opening says which (SCREEN-MAP 2.3), if the invitation carries it; if not, it is recorded here as a gap.
    3. **1b-3, "Where you have lived."** The move-in month of the current home; then a loop of earlier homes (address, then dates) until the coverage meter reads three years. The street stays asked and may be left for the office (Q-AM8 (a)).
    4. **1b-4, "Where you have worked."**
       - The employer loop (2.7–2.15): name; city and state, optional; dates (exact day); drove a truck; position only if not; one DOT question with "Not sure" (Q-AM9 (a)); reason for leaving with quick picks; "Did you work anywhere before?".
       - Gap explanations with quick picks; equipment (multi-pick, then one screen per class); the experience narrative.
       - **D-AM4 moves the employer address requirement from the driver's hand-off to the office's "Send for signing"**, and filing still refuses without it. "Not sure" (Q-AM9) is stored per job, and the office resolves it before Send for signing.
       - The office keeps the one employer form (HW5b).
    5. **1b-5, closing:** retire the legacy Part 2 path and the five section components (SCREEN-MAP §7).
  - **After 1b:** U1 (the true intro and the three-stage bar), U2 (remembered device, scan prefill), U3 (big Yes/No that advances, keyboards), U4 (errors on blur), U5 (backwards job walk and coverage meter, largely 1b-4), U6 (one review page with the office's changes), U8 (phone or email, Q-AM5; permit holders; "I'll bring my CDL"). Then the timed walk at 390×844 in EN and ES, and the owner's real-phone walk.
- 2026-11-13: **F4 PR 1b-1: the walk inside a task, and "Your driving record" one question to a screen** (`claude/application-wizard-stage2`, no migration).
  - **The engine (shared):**
    - Stage 2 ids are `<task>.<question>`.
    - `GENERATED_TASKS` lists the tasks that are walked (`safety` for now).
    - A screen's `list` is derived: every field is one list's column.
    - `FactAsk.gate` is a yes/no that answers whether its list has rows.
    - `FactAsk.quickPicks` names one of the `QUICK_PICKS` lists.
    - `TASK_FACTS_ASKED_ELSEWHERE` names the one fact the task owns but does not ask (§40.25(j), Part 1's).
    - Tests hold every fact of a generated task to an `ask`, and every loop to its gate.
  - **The walk (web):**
    - `useTaskWalk` steps the open task's screens. Each row repeats its list's screens, then asks "Any other …?": Yes adds a row and walks it, and No moves on.
    - Continue checks that screen's share of `validateSection`. The last Continue is the task's "Save and continue". A refusal at the close opens the first screen holding the problem, and a problem no screen holds is said on the screen in front of the driver.
    - `draftFields.ts` is Part 2's binding. A gate's No clears its list and its Yes opens one blank row. An answer that closes a conditional screen empties it, read from the catalogue's `when`.
    - `TaskWalk.vue` shows "Question n of m", the row's name ("Accident 2") and "Remove this accident".
    - The page's buttons step the walk. The task's issue list moves under each box.
  - **Found in the build, fixed:**
    - Yes on a gate left a blank first row that filing drops, so the list rule held the driver on "Yes". A Yes gate is no longer refused for its empty list; the close still is.
    - On the Spanish page a quick pick put the English word in the box. It now reads in the page's language and files English, and typing a pick's own words files the pick.
  - **Hazmat spill is a real Yes/No** (SCREEN-MAP 2.18d). It is nullable in the contract (`.nullable().default(false)`: filed payloads and the previous employer's report are unchanged), required per accident by `applicationPaperFilingIssues`, and the packet prints nothing for unanswered, never "No". A new accident's counts start blank, not "0" (2.18c). A draft saved before keeps the box it held.
  - **Proof:**
    - shared: wizard tests (5 new) and the filing rule;
    - web: binding (7), walk (12), component (4);
    - 11 of 12 mutants killed. The survivor (`list` taken from a mixed screen) is equivalent for the catalogue: no screen mixes a row column with a plain fact.
    - All 37 e2e-apply specs pass, the new `drivingRecordWalk.spec.ts` among them.
    - Screenshots at 390×844 in EN and ES.
  - **Next:** 1b-2, "About you" and the carrier's questions.
- 2026-11-13: **F4 PR 1b-1 merged** (#2345, `1fa0700`). CI's first two runs failed on `vue/no-mutating-props` ("Any other?" now goes through `walk.answerAnother`) and on `applicationContract.ts` at 501 lines (the hazmat comment shortened).
- 2026-11-13: **F4 PR 1b-2: "About you" and the carrier's questions, one question to a screen** (`claude/application-wizard-about-you`, no migration).
  - **"About you"** walks: the name (one fact typed together, D-AM3), other names, email, the SSN (its own control and save, drawn by the fact's `ssn` door), the carrier's page-1 questions, then Part 1's date of birth and phone, read-only with "Something wrong? Tell us".
  - **"The carrier's questions"** walks each question of the served definition on its own screen: education, military service (with "If so, when?" only after a yes), other training, references, then the carrier's own stamped questions.
    - The questions are the definition's, not the catalogue's (`askedByDefinition`), so a carrier's change needs no catalogue edit (D-APP12).
    - A table question stays one screen, per the paper ruling above.
  - **One control per question kind** (`QuestionField.vue`) and one set of answer rules (`questionnaireAnswers.ts`), shared by the walk and `QuestionnaireFields` until 1b-5 retires the latter.
  - **Departures from SCREEN-MAP, each for a reason:**
    - **2.1, other names:** one screen with the list and "Add a name" (2.1a's own wording), not a Yes/No gate first. The contract has no `declares_no_other_names`, so a No could not be stored and a returning driver would be asked again. Adding one is a contract change for an optional fact that only steers the walk.
    - **2.3, "Company driver or owner-operator?":** always asked. The skip "when the opening says which" has nothing to read: an invitation carries no opening, and no lead→invitation link exists (checked 2026-11-13).
    - **2.4, "How did you hear about us?":** always asked, for the same reason (no lead source reaches the invitation).
      - Its quick picks are SCREEN-MAP's own: Indeed, Facebook, a friend or a driver, our website.
      - Production held five drafts and no filed application on 2026-11-13, too few answers to choose picks from data.
      - The picks are on v3's question (`QuestionnaireQuestion.quickPicks`, edited in place: how it is answered, not what is asked). A draft answered against v2 is asked by v2, which has none, so its box works without the taps.
    - **Proof of age** is still asked: the paper decides (see the ruling above).
  - **The walk matches a problem to its screen by PATH**, not by DOM id (`pathUnder`): one other name's problem is the list's screen's, and a reference's phone is the references screen's.
  - **A v2 draft always holds Part 1's date of birth and phone.** The server gates every v2 draft behind the date of birth Part 1 recorded (`gatedRelease`), and the unlock lays them in, so "About you" never needs to ask them.
  - **Proof:**
    - shared: task screens, facts asked by the definition, picks only on text questions;
    - web: walk (+7), binding (+2), component (+4), and two page tests moved to the walked task;
    - 10 of 11 mutants killed. The survivor (names edited in place) is equivalent, because autosave watches the draft deeply; the comment that claimed otherwise is corrected;
    - new `aboutYouWalk.spec.ts`. 35 of 38 e2e-apply specs pass locally. The other three are `assistantDock` on `/settings`, which fail identically on plain `origin/main` locally;
    - screenshots at 390×844 in EN and ES.
  - **Seen, left to U3:** the carrier's Yes/No questions use the segmented control, smaller than the driving record's big Yes/No.
  - **Next:** 1b-3, "Where you have lived."
- 2026-11-13: **F4 PR 1b-2 merged** (#2352).
- 2026-11-13: **F4 PR 1b-3a: the answers the office completes** (D-AM4 and Q-AM8 (a); `claude/application-office-completes`, no migration). The groundwork for 1b-3 and 1b-4: both rulings let the driver leave an answer the office finds, so one rule serves both.
  - **`OFFICE_COMPLETES`** (shared): an employer's address (`job_address`) and an address's street and ZIP (`address_street`, new). Each is judged three ways:
    - **the driver's checks skip it** (`driverMustAnswer`): the task's check, the review list, the send, and the one employer form, on both sides;
    - **the office's Send for signing refuses** while any remains, naming each (`office_must_complete`, 409). It is the one refusal there: D-AF6's warnings are about travel and hire, and these are answers on the document. A link sent without them sends the driver to sign something filing would refuse;
    - **filing still refuses** without them, unchanged.
  - **Contract:** an address's `line1` may be empty and `postal_code` may be empty (a given ZIP is still 3–20 characters). Filing's paper rule now requires both on every address (page 1's "Street, City, State, Zip").
  - **The driver is told:** under the street and the ZIP, and under the employer's street, "If you do not remember it, leave it blank. The office will fill it in." (EN and ES).
  - **Changed tests, on purpose:** EM-3 ("will not add a job without its street") and the driver panel's address refusal are D-AM4's old rule; both now assert the save goes through.
  - **Proof:** shared rule and contract (+3); web driver checks (+1); API refusal, nothing minted, written or sent, org-scoped, and a complete draft sent (+2). Eight of eight mutants killed.
  - **Next:** 1b-3, the address walk on top of this; then 1b-4.
- 2026-11-13: **F4 PR 1b-3a merged** (#2354).
- 2026-11-14: **Q-AM22 (b): the other names are keyed rows in the draft** (`claude/other-names-keyed`, no migration). The owner ruled (b) on 2026-11-13.
  - **The draft row is `{ name, key }`** (`draftOtherNames.ts`, shared). The draft schema takes a keyed row or a plain string, because a draft saved before holds strings for as long as its link is open; the driver's next load (`fromDraftPayload`) and the office's first write (`withRowKeys`) key them.
  - **Every row list is keyed now** (`KEYED_ROW_LISTS` is `APPLICATION_ROW_LISTS`). A correction to an other name is `["other_names", "<key>", "name"]`, so it stays on its own name when the driver deletes or reorders one on their phone.
  - **The key is never filed.** Wherever a draft becomes an application the names are handed on as plain names: the driver's send (`toApplication`), the office preview and the Send for signing check (`otherNamesAsFiled`). The certified shape, the packet's three places, the employer inquiry and `drivers.other_names` are unchanged.
  - **The walk's names screen** edits and removes a name by its key, and a new box takes the cursor. Its two buttons are full touch size.
  - **The office card** shows each name at `[list, i, "name"]`, and its add form mints the new row's key, as the other lists do.
  - **Proof:** shared (row edits, row keys), web (draft, card rows, row lists, labels, review summary, walk), API (the preview prints keyed names as names). Nine of nine mutants killed; the first run left two alive (blank names dropped at filing, and Remove taking the right name), and each got its test.
  - **Next:** the applicant page in English only (owner 2026-11-13), then 1b-3, the address walk.
- 2026-11-14: **The applicant's page is English only, for now** (owner 2026-11-12 and again 2026-11-13: "English only for now"; `claude/apply-english-only`, no migration).
  - **This overrules U7's Spanish half and SCREEN-MAP §1's "the language switch in the header"** until the owner reviews the Spanish draft. D-MT8 already ruled the hiring messages English only.
  - **What changed:** `APPLY_LANGUAGES_OFFERED` is `["en"]` (`language.ts`). The header's switch is drawn only while more than one language is offered, and a phone set to Spanish, or one that chose Spanish before, opens in English.
  - **What did not:** the Spanish words, their type (`Localized`, which fails `vue-tsc` on a missing key), the U7 gate on literal strings and the rule that shared code returns a message key. New screens still get their Spanish twin, because the type requires it. Offering Spanish again is adding `"es"` to that list.
  - **Tests:** the language and layout tests pin both states (offered and not). The two browser specs that walked a Spanish page are gone; one now proves a phone that chose Spanish opens in English with no switch. The Spanish wording itself stays covered by the unit tests that set the language directly.
  - **For the remaining F4 work:** the timed walk and the owner's phone walk are English only.
- 2026-11-14: **F4 PR 1b-3: "Where you have lived", one question to a screen** (`claude/application-wizard-addresses`, no migration; SCREEN-MAP 2.5–2.6a).
  - **The walk:**
    1. The home Part 1 holds is shown, with "Something wrong? Tell us", and asked one thing: the month the driver moved in (D-AM5).
    2. Each earlier home is its address typed together (D-AM3), then its two months. The month they moved out is already filled in: it is the month the home after it began.
    3. Continue asks for the home before until the three years are covered, then closes the task. A meter counts the years as the months are typed and names the months still missing.
  - **The engine, two additions:**
    - **A screen may be asked of one kind of row** (`FactAsk.rows`, `WizardBinding.rowKind`). The addresses hold the home lived in now and the earlier ones; the first is Part 1's and only shown.
    - **A list with no gate ends on the task's own check.** While `validateSection` still has a complaint about the list itself (`["addresses"]`, a month nobody accounted for), Continue adds the next row. The walk counts no months of its own. A list with a gate still ends on "Any other?".
  - **Found in the build, fixed:**
    - **A blank row passed Continue.** The task's check drops a row nothing was typed in, so the screen in front of the driver was never judged. The row on show is now checked by its own schema too (`rowIssues`).
    - **A second address with no end month printed the current home twice.** Composition lays Part 1's street over every such row. New filing rule `address_moved_out` (v2): one home is lived in now, and any other is asked when the driver moved out.
    - **A draft with no current home filed without it.** The old address panel let every address take an end month. `applyPartOne` now puts the current home on such a draft, with its month blank and asked.
    - **A message stayed under a box after it was filled** (seen in the 390 px screenshot). It now goes as its answer is given (U4); only Continue raises a new one.
  - **The catalogue says what the contract says:** an earlier home's state is any jurisdiction and its postal code is free text of 3 to 20 characters, as the driver's form always allowed. The office card gives the CURRENT home Part 1's own controls (a US state, a five-digit ZIP), because that row is Part 1's.
  - **Still US-only, recorded and not worked around:** the home lived in now. F1's unified rules (a non-US ZIP and state, the CLP class, any phone) are Part 1's and need 0376's CHECKs widened by a migration first. They are not built.
  - **Not built here:** "Question n of m" counts the screens known so far, so it grows as homes are added. U1's three-stage bar replaces it.
  - **Proof:** shared (the rule, the meter's arithmetic, the grouped screens); web walk (+7), drawing (+3), Part 1 composition (+2), the card's controls; 13 of 13 mutants killed; new `addressWalk.spec.ts` in a real browser, and the tap-target sweep passes at 390 and 320 px. Screens looked at in 390 px screenshots.
  - **Next:** 1b-4, "Where you have worked".
- 2026-11-14: **F4 PR 1b-3 merged** (#2362).
- 2026-11-14: **F4 PR 1b-4: "Where you have worked", one question to a screen** (`claude/application-wizard-employment`, no migration; SCREEN-MAP 2.8–2.17).
  - **The walk:**
    1. "Have you had a job in the last 3 years, or driven a truck for anyone in the last 10?", with nothing chosen.
    2. Each job: the company's name; where it was (optional, D-AM4); when (the exact day, Q-AM11); "Did you drive a truck?"; the job's title only if not; the one DOT question; why they left, with quick picks; then "another job?", with how much of the three years is accounted for.
    3. Each gap the jobs leave, on a screen of its own, with quick picks.
    4. "What have you driven?", every kind tapped, then one screen for each kind picked; then the optional narrative.
    5. The carrier's question on this task ("May we contact your employers?") and the close.
  - **Q-AM9 (a), "Not sure":** the three DOT answers are one question, "Was it a DOT job?", with Yes, No and Not sure.
    - Yes or No sets all three (`dot_regulated`, `subject_to_fmcsr`, `safety_sensitive`).
    - Not sure leaves all three unanswered and stores `dot_not_sure` on the job (the draft's and the contract's; no migration).
    - The driver's own checks let it through. The office's **Send for signing refuses**, naming the job ("whether Old Carrier was a DOT job (the driver was not sure)"), and filing still refuses (`job_dot_unsure`, in `OFFICE_COMPLETES`).
    - The office answers it on the one employer form; answering the DOT question clears "Not sure". It is never a column of a hired driver's employment record.
  - **Departures from SCREEN-MAP, each for a reason:**
    - **2.12, the DOT question is asked of every job**, not only where the driver drove a truck. A mechanic's or a dispatcher's job can be DOT-regulated, and skipping the question would leave three answers on the application that nobody gave.
    - **2.13, "Why did you leave?" is asked of a current job too.** Filing requires a reason on every job (`job_reason_for_leaving`); the hint says what to write when they still work there.
    - **2.7, "May we contact your employers?" comes last**, with the carrier's other questions (the definition's place for it on this task), not first.
    - **2.14, the ten-year question is one question** ("another job in the last 3 years, or a truck-driving job in the last 10?") rather than two that change at the three-year line.
  - **The engine, three additions:** a yes/no with a third answer (`FactAsk.notSure`); a screen that picks which rows its list has (`FactAsk.picksRows`); and rows the answers derive (the gaps, `WizardBinding.settle`). A problem is matched to its screen by where it is REPORTED (`WizardBinding.path`): a gap's is keyed by its start date.
  - **Found in the build, fixed:**
    - **The office's form showed a pre-chosen Yes on a question nobody answered.** `employerFields` read a stored `null` as Yes for "drove a truck" and "DOT-regulated". Only a row that never had the key reads as Yes now.
    - **A new draft's blank job read as "Yes, I had a job".** Opening the task drops jobs nothing was typed in.
    - **A blank gap passed Continue**, because the task's check reaches the filing's rules only once the contract's are satisfied. The gap on show is judged by the filing's own rule.
    - **A driving job's "Driver" stayed after the answer changed to No.** It is cleared, and the title asked.
  - **The employer's state is any jurisdiction** in the catalogue now, as the one employer form always offered.
  - **Proof:** shared (the Not-sure rule, the generated screens); web walk (+9), the stored job row (+4), the hired record (+1); API (Send for signing names the job, and sends once answered); 18 of 18 mutants killed, one only after its test was tightened; new `employmentWalk.spec.ts` in a real browser. Screens looked at in 390 px screenshots.
  - **Next:** 1b-5, retire the legacy Part 2 path and the section components the walk replaced.
- 2026-11-14: **F4 PR 1b-4 merged** (#2365).
- 2026-11-14: **1b-5 (retiring the legacy Part 2 path) is moved after the driver-experience work, measured safe.**
  - **Measured, production, read-only, 2026-11-14:** 5 invitations; 0 open legacy links (no Part 1 row); the one legacy invitation ever made is revoked (2026-08-22, never submitted), and re-sending a revoked invitation starts a fresh application, which is minted with its Part 1 row. So no link can reach the legacy wizard.
  - **Why later:** it is the linear wizard, the legacy identity screen, six section components, their tests and three browser specs written on legacy links. Nothing a user sees changes, and the walk's own steps (U1–U8) do. It stays owed: two editors of one answer is the defect F1 exists to end, even when one is unreachable.
  - **Its scope, for whoever takes it:** `ApplySection`'s five section branches and their components (`ApplicantDetailsFields`, `AddressHistoryFields`, `AddressDrawer`, `AddressFields`, `ApplyEmploymentFields`, `SafetyHistoryFields`, and `QuestionnaireFields` once nothing reads it); `ApplyProgress` and the wizard's linear Next/Back; the phase router's legacy identity screen; what a legacy link shows instead (an "ask the office for a new link" card); `applicationLegacyFilingIssues`; and `requiredAnswers`, `employmentTimeline` and `offline` specs moved onto v2 links.
- 2026-11-14: **U1: the application is three stages, and every screen says which one the driver is in** (`claude/application-three-stages`, no migration).
  - **The first screen** said "8 screens, about 30 minutes": the middle visit's task list, to a driver whose first visit is the license and the permissions. It now names the three stages (Today, Your history, Signing), each with its estimate, what it holds and what it waits for.
  - **The bar** (`ApplyStages`) is on every screen of a live link: done, here, later. Read from the phases the link serves (`stages.ts`): Your history opens when the office sends the application, Signing when the office has read it. It is not a count of screens, which grows under a driver as they add jobs.
  - **Found and fixed: the first screen said the driver signs "in their office, when you come in for your road test".** D-AW14 (2026-09-26) put the signing on the driver's own phone, from a link the office sends; the sentence, and the test that pinned it, were seven weeks stale.
  - **The estimates are estimates.** `APPLICATION_STAGE_MINUTES`: Your history is the task list's own sum (30); Today (10) and Signing (5) are SCREEN-MAP's figures. Nobody has measured any of them; the timed walk replaces them.
  - **Proof:** stage logic and the bar (+5), the first screen (rewritten, 9), 6 of 6 mutants killed, new `stages.spec.ts` in a real browser, the tap-target sweep at 390 and 320 px, and both screens looked at in screenshots.
  - **Next:** U3 (the Yes/No that every question uses, and keyboards), then U6 (one review page with the office's changes).
- 2026-11-14: **U1 merged** (#2366).
- 2026-11-14: **U3: Yes and No are two big answers, and a tap moves on** (`claude/application-thumb-controls`, no migration; SCREEN-MAP §1).
  - **The answers** are 56 px blocks, side by side, the whole block the target, filled when chosen. Still radios underneath (`AppRadioGroup`'s new `cards` variant), so a keyboard and a screen reader read them as before. The office's forms keep the list.
  - **A tap on a screen that is one yes/no question moves on**, through the page's own Continue and its own check. That is the gates, "any other?", "did you drive a truck?", the DOT question's three answers, and the first visit's screening questions.
  - **Only a tap.** An answer arrowed to with a keyboard waits for Continue: a browser reports an arrow key as a click, so the control tells them apart (`pick`) and a keyboard user is never moved by passing over an answer. A screen of several fields, a typed answer, and the carrier's own questions (a different control, with a skip beside it) wait for Continue too.
  - **Keyboards:** a licence number is typed in capitals with autocorrect off; names, cities and company names capitalize each word.
  - **Not done here:** "errors on blur" (U4's second half). A message already goes as its answer is given (1b-3); raising one before Continue was not built.
  - **Proof:** the control (+5), the generated screen (+3), 7 of 7 mutants killed; the driving-record and employment browser walks now rely on the tap moving on, and pass twice in a row; the tap-target sweep passes at 390 and 320 px; looked at in a 390 px screenshot.
  - **Next:** U6, one review page with the office's changes.
- 2026-11-14: **U3 merged** (#2368).
- 2026-11-14: **U6 was already built; walked in a browser and closed, with one fix** (`claude/application-scan-confirm`, no migration).
  - **What exists:** `ReviewFields.vue` ("Before you send") lists every answer in the task list's groups, each group with "Go to this section", and counts what is missing with a link to each box. `SignOffFields.vue` (3.1) lists every office change as "You put / It now says", with the office's reason and "replaced" for a withheld answer, above the whole document and the signature.
  - **Walked 2026-11-14, Chromium, 390 px, the built app against the stubbed API:** the review of a complete draft; "Go to this section" lands on the task's first question; the sign-off with four office changes (a ZIP, a job's street, a job's DOT answer with a note, a withheld answer).
  - **Found and fixed: a corrected job was not named.** A job is named by its key, so 3.1 read "Employer · Street address" for every job; a driver with two jobs could not tell which the office corrected. It now reads "Old Carrier · Street address" (`describeField`'s `rowName`; the office's "What you changed" uses the same call in place of splitting a label).
  - **Not changed, recorded:** the way back is per group, not per answer, and opens the task at its first question. The §391.23(i) notice stands above the answers on the review, about one and a half screens of it; it is the regulation's own text and was left.
- 2026-11-14: **U2, first half: "Is this right?" — the scan is confirmed on one screen** (`claude/application-scan-confirm`, no migration; SCREEN-MAP 1.4, D-AM5).
  - **Before:** the barcode's answers were put in their boxes and the driver walked each screen to press Continue on what they had just photographed.
  - **Now:** after the CDL's two photographs, one screen reads back what was read: date of birth, home address, license state and number, expiration. Each has one button, "Change". "Yes, that's right" leaves out every confirmed screen: a full read is the phone, then the class and the endorsements (4 screens fewer, and the home-address page is passed through its own Continue).
  - **Rules:**
    - **Only a fact read whole is offered** (`scannedFacts`): a number with no issuing state is asked as before.
    - **Confirmed is not valid.** When a page's own check refuses a confirmed fact (an applicant under 18, a ZIP of the wrong length), the fact is taken back and its screen returns with the message under the box (`stillConfirmed`).
    - **Asked once.** What was confirmed is kept in Part 1's device copy, without bumping its version (a bump deletes every driver's held typing).
    - **Back** from the first question is the confirmation as it was left; Back from it is the photograph.
  - **Not built, each for a reason:**
    - **The name is not listed.** Part 1 has no name box; the name is the invitation's and is asked in "About you". The screen confirms what Part 1 would have asked.
    - **E13's phone pre-fill.** The bare link reads no answer back (D-APP16): serving the office's phone number on it would show a leaked link's holder a person's number. It stays typed.
    - **SCREEN-MAP 1.4a/1.4c's suffix, mononym and country** are Part 1's and wait on 0376's CHECKs (the migration recorded on 2026-11-14).
  - **Proof:** the walk (+11), the confirmation's drawing (+3), the device copy (+2), the sign-off's job name (+1); 14 of 14 mutants killed; `scanner.spec.ts` reads a real barcode in Chromium, changes one fact and lands on the class; looked at in a 390 px screenshot, where the four facts fit one phone screen.
  - **Next:** U2's second half, the date-of-birth unlock asked once per device. It needs a new table (a remembered-device token, stored hashed), so it is its own PR.
- 2026-11-14: **U2's first half merged** (#2370). Its first CI run failed on `matrices (3)`: `loads-mirror-columns` printed nothing at all in CI and passes 36 of 36 locally, so the job was re-run and passed. Not this work's; noted in case it recurs.
- 2026-11-14: **U2, second half: the date of birth is asked once per phone** (`claude/application-remembered-device`; **migration 0604**, a new table, so its writer ships in the same merge).
  - **Before:** the saved application asked the date of birth on every visit (D-APP16): for the history, and again for the signing — of the driver, on the phone that typed it.
  - **Now:** the gate has one tick, "This is my phone. Don't ask me again on it." A right answer (the date, or F0b's code) with it ticked leaves a random token on the phone. The next visit on that phone sends the token first; the driver sees "Opening your application…" and never the question. That covers the signing visit too.
  - **What keeps D-APP16 whole:**
    - **The token is never a way in by itself.** It is checked only on a link that resolves, and its hash is salted by the invitation. A forwarded or gateway-scanned link still gets nothing.
    - **Only a RIGHT answer mints one**, and only when asked. An unlock on a link with nothing gated yet mints nothing: a token from before a date of birth exists would open the application once one does.
    - **Never on a computer.** The tick is offered on a phone only. A computer is where a link is opened for somebody else (the desktop hand-off), and its history holds the link.
    - **Thirty days, five devices** (`TRUSTED_DEVICE_TTL_DAYS`, `TRUSTED_DEVICE_MAX`), the link's own expiry first. The phone sweeps its token at the same age.
  - **My decisions, each with its reason:**
    - **A wrong token is not one of a sent sign link's five tries** (D-AW14). It is not a guess at the date of birth, and a phone whose token ran out must fall back to the date with all five left. The unlock's own limiter (ten per link per ten minutes) bounds it.
    - **A dropped signal does not cost the token.** The phone forgets it only on the server's own "not known".
    - **Remembering never fails an unlock.** If the row cannot be written (the table not there yet in a deploy window, the cap reached), the application opens and the date is asked next time, as today.
    - **Not minted in Part 1.** The date typed on the first visit could remember the phone and spare even the first question. It is a second writer on the intake's first write (0376's three-call order) for one question saved; left out, and recorded here rather than built halfway.
  - **Not built:** the office cannot see or revoke a remembered phone. A new application (a re-sent, revoked invitation) starts with none, and that is the only reset. If the office needs one, it is a line on the review drawer and a delete by invitation.
  - **Registered:** `table-modules.json` (time growth, 90 days), `table-writers.json`, `RETENTION_RULES` (90 days from `created_at`), the RLS matrix's seed, the purge matrix's seed (it leaves with the invitation).
  - **Proof:** API (+15: the mint's four refusals, the cap, fail-soft, the three ways a token opens nothing, org scope); web (the gate +9, the device store +5); matrix `recruiting-trusted-devices` (14); 17 of 17 mutants killed; new `rememberedPhone.spec.ts` in a real browser with real IndexedDB across a reload; the tap-target sweep passes at 390 and 320 px with the tick; looked at in a 390 px screenshot.
  - **Next:** U8 (phone or email, "I'll bring my CDL"), which starts with the migration that widens 0376's CHECKs.
- 2026-11-14: **U2's second half merged** (#2373). U2 is closed.
- 2026-11-14: **U8, analysed before building. Three findings change its shape.** Read from the code and the database's own rules, not assumed.
  - **"I'll bring my CDL" needs a migration first.** `complete_applicant_intake` (0376) refuses to end the first visit (AI007) without both CDL photographs. So it is two merges: the answer in the database (below), then the screen.
  - **"Phone or email" has a cost the ruling did not weigh.** Med-Stop's new-applicant record requires `phone1` (`MEDSTOP_APPLICANT_REQUIRED`), and `applicantCreate.ts` skips an applicant with a required field missing **without a row and without a word to the office** (`result.skipped++`). Q-AM5 stands (phone **or** email), so it is built as ruled, and the same PR makes that skip say why on the drug-test step ("no phone number — add them in Med-Stop yourself"), as `medstopApplicantSkip` already does for a declined gender. Also to settle there: `partOneStatus.contact` is `phone !== null`, so a driver with no phone would resume on "About you" for ever; it becomes phone **or** the invitation's email.
  - **A permit (CLP) class is not an application change.** The class is the roster's `CDL_CLASSES` (A, B, C), written to `drivers.cdl_class`, and Med-Stop requires `licenseclass`. The paper asks "Cdl #" and no class at all. **Not built; needs the owner:** (a) a permit holder picks the class they are training for, and the office sees "permit" from the license kind (no schema change); (b) add CLP to the roster's class list (roster, Med-Stop and every class reader change). Recommendation: (a).
  - **A non-US home and a non-US phone stay out.** Med-Stop requires a US state and ZIP, the SMS provider is US-only (0376's own comment), and the drug-test site search reads a five-digit ZIP. Widening the CHECKs would let in answers three downstream readers refuse. Recorded as not built, with that reason, in place of "needs a migration".
- 2026-11-14: **U8, step 1: the database can hold "I don't have my CDL with me"** (`claude/application-cdl-photo-pending`; **migration 0605**, alone, no reader).
  - `application_intakes.cdl_photo_pending` (default false). `record_applicant_intake` takes the key, as it takes `medical_card_pending`; `complete_applicant_intake` lets Part 1 finish without the two CDL photographs when it is true.
  - **It stands in for both sides or neither:** one side photographed and nothing declared is still refused. It does not waive the medical card. An absent key is 0376's rule unchanged, so code on either side of the migration behaves as before.
  - Both functions are redefined from their current definitions (0588's and 0376's) with the same signatures; the bodies differ by the key only.
  - **Proof:** matrix `application-intake-v2` (+10, 85 of 85); 5 of 5 mutants of the migration killed.
  - **Next, in a second merge:** the screen's "I don't have it with me", the typed license in place of the scan, "CDL photo pending" on the office's drawer and the documents screen asking for it.
- 2026-11-14: **U8 step 1 merged** (#2375, migration 0605).
- 2026-11-14: **U8, step 2: "I don't have my CDL with me"** (`claude/application-bring-my-cdl`, no migration; the reader of 0605; SCREEN-MAP 1.2, Q-AM5).
  - **The screen:** both CDL photo screens have one tick, "I don't have my CDL with me". Ticked, Continue passes both and goes to the first question. There is no scan, so no "Is this right?": the license is typed as on any link whose barcode did not read.
  - **Where the answer travels:** nothing can be written before §40.25(j) (0376), and these screens come before it. So the answer is held, rides the first write, and until then lives in the phone's copy. On a link already begun it is written at once.
  - **The office** sees it on the Applicant facts card, in the driver's words, under Documents, and can change it (`part_one_answer`, as the medical card's). The Part 2 documents list already asks for the CDL's two sides when they are not on file.
  - **Found by the browser test, fixed:** the phone's copy is written 300 ms after a change. A tick, Continue and a reload inside that window lost the tick and sent the driver back to the photograph. The tick is now written at once, as a passed screen is.
  - **Not built:** the drawer does not say "CDL photo pending" as a status line of its own; it is a row of the card. The owner's wording was "the office sees CDL photo pending"; if a badge on the applicant's row in the list is wanted, that is the Recruiting list's column, not this form.
  - **Proof:** rules (+3), the walk (+6), the device copy (+2), the photo screen (+3); 12 of 12 mutants killed; new `noCdlAtHand.spec.ts` in a real browser across a reload; the tap-target sweep passes at 390 and 320 px. One of seven local browser runs failed two tests with this Mac at load 35 and was not reproduced in the next four; CI is the authority.
  - **Not looked at in a faithful screenshot:** Playwright's full-page capture flips the pointer media query and drew the computer's hand-off panel. The sweep measures the phone layout.
  - **Next:** phone or email (with the Med-Stop skip made visible), then F5.
- 2026-11-14: **U8 step 2 merged** (#2378).
- 2026-11-14: **Before phone-or-email: the office is told why an applicant was not sent to Med-Stop** (`claude/medstop-skip-visible`, no migration).
  - **What was found:** every skip was silent, not only a missing phone. `medstopApplicantSkip` held sentences for a declined gender and a non-US license, and its comment said "the step shows it". Nothing did: the sweep counted the skip, the hiring step read only `medstop_applicant_creates`, and the applicant simply never appeared in Med-Stop.
  - **Now:** the drug-test step says "Not sent to Med-Stop from Part 1." and the reason. The reason is derived on each read from the facts and the rule the sweep itself uses (`partOneSkipForMedstop`), never stored, so it goes when the office corrects the answer.
  - **A missing required answer is named**, all of them in one sentence ("Part 1 does not have their ZIP code, license class…"). One mapping (`medstopApplicantOurs`) feeds the create and the reason, and a test holds them to the same verdict.
  - **Not said** once Med-Stop holds the person, once a create was attempted (that line is Med-Stop's own answer), or while Med-Stop is not connected.
  - **Proof:** shared (+2), API (+7), the card (+2); 9 of 9 mutants killed, one only after its test was added (the reason was dropped exactly where Med-Stop holds nobody, the case the line exists for).
  - **Next:** phone or email (Q-AM5), now that a driver with no phone produces a line the office can read.
- 2026-11-14: **The Med-Stop reason merged** (#2381). **Phone-or-email is stopped on Q-AM23** (§5), and the permit class on Q-AM24: both are owner decisions about what the signed application requires, and neither is built.
- 2026-11-14: **F5, designed before building** (`claude/application-ask-again`). The plan held one line for it; this is the design.
  - **Today:** once the driver presses Send, their page is a wait screen until the office approves. The office can correct an answer itself, and cannot ask the driver anything.
  - **What "ask again" is:** the office marks one answer on the Applicant facts card and writes one line to the driver ("Which month did you leave Old Carrier?"). The driver's link then opens on "Silvicom has a question" instead of the wait screen, with the office's words and a button that opens that one question's screen. Their answer saves as any answer does; "Send my answer" closes the question and tells the office.
  - **The record:** a new table, one row per question asked: the answer's path (as `application_edits` names it), the office's words, who asked and when, and when it was answered or withdrawn. Audited both ways.
  - **Rules:**
    - **Window:** from the driver's Send until the office approves. Approval sends the document to signing, and waits on open questions.
    - **Approval waits:** the office cannot approve while a question is open; it withdraws it or waits.
    - **Part 2 answers only, at first.** Part 1's answers are frozen to the driver once the first visit ends (0376, AI008), so a question about one would open a screen that cannot save. The office corrects those itself, as today.
    - **The driver is told** by the same e-mail and text the application's other steps use.
  - **Stages:** (1) the table and the office's ask, withdraw and list, with approval's refusal; (2) the driver's screen and answer; (3) the e-mail and text.
- 2026-11-14: **F5, stage 1: the office can ask, take back and list; approval waits** (`claude/application-ask-again`; **migration 0607**, a new table, so its writer ships with it). Nothing is shown to anybody yet: no office button and no driver screen.
  - **The table** `application_ask_agains`: the answer's path, the office's words (1 to 500 characters), who and when, answered or taken back. One OPEN question per answer (a partial unique index), at most five open per application.
  - **The API** (`applicationAskAgain.ts`): `GET`, `POST …/ask-again`, `POST …/ask-again/:id/withdraw` on the office's review routes; view to read, manage to ask, as corrections are.
  - **What may be asked** is read from where Part 1's and the identity's keys are defined (`canAskAgain`), not listed again: those are frozen to the driver after the first visit, and the office corrects them itself.
  - **Approval refuses while a question is open** ("2 questions are still waiting for the applicant's answer…").
  - **Removed while building:** a "has signing started" check on asking. It could never be reached (a packet mark cannot exist before an approval, and approval already ends the window); a mutant of it survived for that reason.
  - **Registered:** `table-modules.json`, `table-writers.json`, the RLS and purge matrices' seeds. No retention rule: it is kept with the application, like `application_edits`.
  - **Proof:** API (+15), matrix `application-ask-agains` (18), 13 of 13 reachable mutants killed.
  - **Next:** stage 2, the driver's screen and answer, and the office's button on the facts card.

- 2026-11-14: **F5 stage 1 merged** (#2384).
- 2026-11-14: **F5, stage 2a: the driver's side** (`claude/application-ask-again-driver`, no migration). Still not reachable by a user: the office has no button yet, so no question can exist.
  - **The screen:** while a question is open, the handed-over application opens on "Silvicom has a question for you" in place of the wait screen: the office's words, and which answer they are about. It stands before the date-of-birth gate, like the wait screens, and prints none of the driver's answers.
  - **The loop:** "Open my answer" takes the driver into their application at the screen that asks that answer, with the office's words kept above it and "Done — back to the question". The date-of-birth gate is met on the way in when the draft is behind it. "Send my answer" is offered only for an answer that was opened; it puts everything typed on the server, tells the office, and the page is the wait screen again.
  - **The answer is the draft's.** Nothing is typed into the question. An answer left as it was is still an answer.
  - **Found by a test, fixed:** a job is named by its key, and the keyed-row helper does not place jobs (they were keyed earlier, by another rule). A question about a job opened no screen until the job is looked up in the driver's own list.
  - **v2 links only.** A legacy link shows the wait screen; none is open in production, and 1b-5 retires the path.
  - **Proof:** API (+4: what the driver is served, the answer's one stamp, a taken-back question, a filed application); web (+16: the composable, the screen, the router); 16 of 16 mutants killed; new `askAgain.spec.ts` walks the whole loop in a real browser and checks the answer reached the server before the office was told; both screens looked at in 390 px screenshots.
  - **A test seam, said plainly:** the composable takes its sender as an argument. With the module mocked instead, Vitest failed the two rejection tests on a rejection the code had handled; I did not find why.
  - **Next:** stage 2b, the office's "Ask the applicant" on the facts card and the list of what was asked. Then stage 3, the e-mail and text.
- 2026-11-14: **F5 stage 2a merged** (#2386).
- 2026-11-14: **F5, stage 2b: the office's "Ask the applicant"** (`claude/application-ask-again-office`, no migration). **This is the merge that makes ask-again usable.**
  - **Where:** under each of the applicant's own answers on the Applicant facts card, while the application waits for the office. Not under Part 1's answers or the identity: the applicant can no longer change those, and the Edit beside them is the way.
  - **What the office sees there:** "Ask the applicant" and a box for its own words; then "Waiting for the applicant's answer", its words and "Take it back"; then "The applicant answered your question on …". Approve refuses while one is waiting, in the API's own sentence.
  - **The row is named by its key**, as a correction is (`keyedEditPath`).
  - **Not built, each said where the office reads it or here:**
    - **The applicant is not told.** No e-mail or text goes yet (stage 3). The form's hint says so, and tells the office to text or call. That sentence leaves with stage 3.
    - **Jobs.** The jobs are a timeline of their own (`OfficeJobsSection`), not rows of this card, so there is no "Ask" on a job yet — and a job's dates are the likeliest thing to ask about. The driver's side already opens a job by its key. Next after stage 3.
    - **One list of everything asked.** Each question shows under its own answer; there is no summary at the top of the drawer.
  - **Met again:** the new line was first put between a row's `v-if` and its `v-else` chain, which rebinds the chain (the PR 2221 trap). Four drawer tests caught it; it sits after the chain, and a test now pins that the editor still opens.
  - **Proof:** the row component (+11), the drawer (+1); 11 of 11 mutants killed, one only after its fixture was reordered (the other row's question had been listed second, so "the first open question" passed).
  - **Next:** stage 3, the e-mail and text; then "Ask" on a job.
- 2026-11-14: **F5 stage 2b merged** (#2387). Ask-again is usable on staging.
- 2026-11-14: **F5, stage 3: the applicant is e-mailed that a question is waiting** (`claude/application-ask-again-notice`, no migration).
  - **What goes:** an e-mail to the invitation's address, "{carrier} has a question about your application", sending them to the application link they already have.
  - **What it does not carry, on purpose:**
    - **Not the office's words.** They are about one answer on a §391.21 application, and an e-mail is forwarded and read on shared screens. The words wait on the applicant's own link.
    - **Not a link.** Only a hash of the link is stored, and rotating it to mail a new one would break the link the applicant was told to keep (Q-AX4's reasoning for the approval notice). The e-mail says to ask the carrier to send it again if they cannot find it.
  - **One notice for a round:** sent when a question is asked and none was already waiting. Three questions in a minute are one e-mail.
  - **A refused send never loses the question.** It is stored and audited first; the office's row then says what became of the notice: e-mailed and to where, or not, and then to text or call. The hint that said the applicant was not told is gone.
  - **Not built: a text message.** A new kind of text needs its wording in the SMS programme's own catalogue and the consent it is sent under (SMS-OPT-IN-PLAN §6). The office's form says no text is sent.
  - **Proof:** API (+6), the row (+3), 8 of 8 mutants killed (one re-run after its first pattern did not apply).
  - **F5 is built except for the text message and "Ask" on a job.** Next: "Ask" on a job, then the documents-only link.
- 2026-11-14: **F5 stage 3 merged** (#2389).
- 2026-11-14: **F5: "Ask" on a job** (`claude/application-ask-again-jobs`, no migration).
  - **The office:** under the jobs timeline, one "Ask the applicant about {company}" per job. One question per job, named by the job's key; a job from before keys (AW1) cannot be named, so it is not offered, as it cannot be removed.
  - **Why below the timeline and not on each bar:** a job there is a bar and a badge, with no room for the office's words or the waiting state.
  - **The driver:** the question reads "About: Old Carrier" (the company, never "Employer 2"), and "Open my answer" opens that job at its first question, with the office's words above. Behind the date-of-birth gate the draft is not loaded, so the label is the plain noun.
  - **Proof:** web (+6); 5 of 5 mutants killed, one only after its test was added (a guard whose effect is one request not made); a second browser test in `askAgain.spec.ts` opens the SECOND of two jobs and finds its company in the box.
  - **F5 is built.** Left out, each recorded above: a text message; a question about a first-visit answer; one list of everything asked at the top of the drawer.
  - **Next:** the documents-only link and photo straightening (Q-AM19).
- 2026-11-14: **"Ask" on a job merged** (#2390). F5 is built.
- 2026-11-14: **The documents-only link (Q-AM19), designed before building** (`claude/application-documents-link`). The ruling was one sentence; this is what it meets in the code.
  - **Today:** a photograph reaches the office only through the application's own link, the whole of it; and a photograph is refused once the application is filed (`ALREADY_SUBMITTED`), after which only the office can add a document, by uploading it itself.
  - **The link:** a fourth token on the invitation, beside the e-mail's, the signing link's and the text's. Each send mints a new one, so only the last link sent works.
    - **Its own end, not the application's.** The office sends it weeks after the application's link lapsed. Extending the application's own expiry to carry it would re-open the link that reads back a date of birth and six signed permissions.
    - **It can be e-mailed WITH the link**, unlike the question and approval notices: a freshly minted token is known at the moment it is sent.
  - **What it opens:** the documents list and nothing else: no answers, so no date-of-birth question. The consent comes first if it was never given.
  - **Stages:**
    1. **Migration 0608** (this merge): the token and its end on the invitation, and the guarded rotation. No reader.
    2. The resolver accepts the fourth token; the office's "Send a documents link" (e-mail); the page opens on the documents list for that link.
    3. **After filing.** A photograph is refused then. The link must stage it and the office must file it from the drawer, because `documents` is an evidence table and an unauthenticated link must not write to it. Until this stage the link works up to filing, which is short of the ruling's "at any time", and the office's own upload covers the rest.
  - **My decisions:**
    - **The link's server-side reach is the text link's**, not narrower, at first: the page opens only the documents, and the answers stay behind the date of birth as on every link. Narrowing the routes the token may call is a hardening step, recorded, not skipped silently.
    - **No text message with the link yet**, for the reason the question's notice has none (the SMS programme's catalogue).
  - **Photos straightened and cropped** (the second half of Q-AM19) is a separate build after the link: it is image processing in the browser, and I have not yet read what the scanner already does to a frame.
- 2026-11-14: **Documents link, stage 1: migration 0608.** `docs_token_hash`, `docs_link_expires_at` (set together or not at all), one invitation per hash, and `rotate_invitation_docs_token`: this org's only, never a revoked invitation, and a lapsed or filed one is still given a link. **Proof:** matrix `invitation-docs-token` (15); 6 of 6 real mutants of the migration killed. A seventh, dropping the function's own revoke from client roles, changes nothing: 0412 already closes every new function to them, so that revoke only restates it and no test of this migration can tell. I first wrote "7 of 7" here and in the PR, and corrected both.
- 2026-11-14: **Documents link stage 1 merged** (#2391).
- 2026-11-14: **Documents link, stage 2a: the link's own resolver and the office's Send** (`claude/application-documents-link-send`, no migration; the first reader of 0608). No button and no page yet, so still not reachable by a user.
  - **A decision reversed, and why.** The design above said the link's reach would at first be the text link's. Reading the resolver showed that cannot be right: the application's resolver is what all 34 routes on the link call, and this link lives on its OWN end. A token that outlives the application and could do everything the application's link does would undo the reason the application's link lapses. So the link is **narrow by construction**: its token is known to a resolver of its own (`resolveDocumentsLink`), which only the photograph routes and the link's bundle call. It cannot read a draft, answer the date of birth, sign or mark, because no route that does those takes it.
  - **The bundle** for that token is its own small shape (`DocumentsLinkBundle`): the carrier, the list the carrier asks for, which slots are photographed. Nothing of the application.
  - **The office's Send** (`POST …/documents-link`): mints a new token each time, stores its hash with a 14-day end through 0608's guarded function, audits without the token, e-mails the link, and returns the link to the office's screen whether or not the e-mail went.
    - **Refused, each with its sentence:** before the applicant consented (a photograph is refused without the 7001(c) consent, and this link has no screen to collect it), once the application is filed (a photo staged then is promoted by nothing), and on a revoked invitation.
    - **Sent on a lapsed application**, which is the case it exists for.
  - **Proof:** API (+15). 13 of 13 behaviour-changing mutants killed. A fourteenth, adding the new column to the application resolver's database lookup, changes nothing by itself: the token is still refused by the constant-time match after the lookup. The real breach, that match accepting the documents token, fails two tests.
  - **Next:** stage 2b, the page that opens on the documents list for this link, and the office's button.
- 2026-11-14: **Documents link stage 2a merged** (#2392).
- 2026-11-14: **Documents link, stage 2b: the page and the office's button** (`claude/application-documents-link-page`, no migration). **This is the merge that makes the documents link usable.**
  - **The door** (`ApplyDoorPage`, now the route's page): the link answers with one of two bundles, and the page is chosen above the application's page, only once the link has answered. The application's page reads phases, releases and a draft from its first tick, and the documents bundle has none.
  - **The driver's screen:** "Photos for {carrier}", the carrier's document list, what is already photographed, and the day the link stops working. No stage bar, no date-of-birth question, no Send. The list is the application's own, so a photograph is gated, staged and kept on the phone as it is there.
  - **The office's button** on the review drawer: "Send a documents link". It reads back where the link was e-mailed, or that it was not and the link to read out or text by hand, and the day it ends. It says each send replaces the last. The API's own sentence is shown when it may not be sent.
  - **Found in the 390 px screenshot, fixed, and it was not this link's alone:** on the documents list a name was squeezed to nothing under its two buttons ("Medical examiner's certificate" read "Medi / exam / certi"). The row could wrap, but a name with no minimum width never forces it to. **The application's own "Your documents" had the same defect**, because it is the same component. Names now keep their width and the buttons sit below them on a phone; the browser test measures that no name overlaps its button.
  - **Also from the screenshot:** the list's introduction speaks of "sending the application", which this link cannot do. It is left out on this screen (`bare`).
  - **Proof:** the door (+5), the button (+6), 8 of 8 mutants killed; new `documentsLink.spec.ts` in a real browser checks the page asks the server for the link's bundle and nothing else; all applicant browser specs pass through the new door (45, with the three local-only `assistantDock` failures).
  - **Not built:** photos after filing (stage 3), a text message with the link, and photo straightening.
- 2026-11-14: **Documents link stage 2b merged** (#2393). The documents link is usable on staging.
- 2026-11-14: **Documents link, stage 3: photographs after filing, designed** (`claude/application-late-photos`).
  - **What is already there:** the office's list of an applicant's papers already shows a staged photograph beside the filed ones, marked as waiting (`applicantDocuments.ts`, `staged: true`). So a photograph that arrives after filing has somewhere to appear the moment the link is allowed to take it.
  - **What is missing:** the link refuses a photograph once the application is filed, because nothing would file it; and nothing lets the office file one.
  - **The design:** the documents link, and only it, takes a photograph after filing and stages it. The office files it from the applicant's record with one press. The link never writes the driver's file: `documents` is evidence, and after filing there is no act of the driver's that the carrier reviews.
  - **Steps:** (a) migration 0609, the function that files one staged photograph (this merge, no caller); (b) the link takes late photographs, the office's "File it", and the Send's "already filed" refusal goes.
- 2026-11-14: **Stage 3a: migration 0609, `file_application_capture`.** 0376's promotion, for one photograph: the document is the capture by id (a second call writes nothing), no uploader (the applicant took it; the office is named in the audit log by the caller), the capture stamped. Refuses a capture that is not this invitation's (FC001), an application not filed yet (FC002: filing itself promotes it, and two paths filing one photograph is the race this removes), and a selfie or a drawn mark (FC003). **Proof:** matrix `file-application-capture` (17); 6 of 6 real mutants killed. A seventh, loosening the invitation's own lookup, changes nothing: the capture's lookup already holds the org, the driver and the invitation.
- 2026-11-14: **Stage 3a merged** (#2394, migration 0609).
- 2026-11-14: **Documents link, stage 3b: a photograph after filing** (`claude/application-late-photos-file`, no migration; the caller of 0609). **With this the documents link works "at any time", as ruled.**
  - **The link:** the documents-only link, and only it, now takes a photograph on a filed application and stages it. The application's own links still refuse one: their page has no screen that says the office must file it.
  - **The office's record:** a photograph staged on a filed application reads "Sent after filing — waiting for you to file it" and has "File it" beside "View". Before, every staged photograph read "Filed when the applicant finishes", which is not true of these.
  - **Filing:** the bytes are copied into the driver's file first, then the row is written by 0609's function (copy, then file, as at filing). A failed copy files nothing. The kind and page come from the slot. The office member is named in the audit log; the document's own uploader stays empty, because the applicant took the photograph.
  - **The Send's "already filed" refusal is gone.** The link is sent on a filed application.
  - **One function for the copy.** The loop that promotes photographs at filing and the office's late filing both go through `copyCaptureIntoFile`.
  - **Proof:** API (+10), the office's section (+4); 12 of 12 mutants killed. One survived the first run and was real: without the driver filter on the lookup, another applicant's photograph could be copied into this driver's folder before the database refused to file it; a test now reads the filter off the query. **My first run of eleven of these mutants had no test command and proved nothing; they were run again.**
  - **Not built:** telling the office a photograph arrived (they see it when they open the record), and a text message with the link.
  - **Next:** photos cropped and straightened, the second half of Q-AM19.
- 2026-11-14: **Stage 3b merged** (#2395). The documents-only link works at any time. **Q-AM19's first half is built.**
- 2026-11-14: **Q-AM19's second half (photos cropped, straightened, evened) is stopped on Q-AM25, and why it is not built here.**
  - **What exists:** the in-page scanner crops to the document's outline, for the first visit's four photographs. The documents list's "Take photo" does not use it: it opens the phone's camera app and sends the whole frame.
  - **What straightening and evening are:** Phase 6 of the scanner programme, already designed, with rules this work must not break: the original photograph is never modified (D-SCAN6); the improved picture is a separate copy; nothing is binarised, because trucking paper carries stamps, signatures and highlighter; and no quality floor is set before recorded samples exist (D-SCAN10).
  - **Why not here:** a cropper and straightener inside the application would be a second implementation of that phase, in a second place, changing the photograph that is filed. That is the workaround the repo's rules name. The honest fix is Phase 6, and its order is an owner ruling (D-SCAN13).
  - **Recorded as Q-AM25** (§5) with three ways and a recommendation: use the scanner the page already has for every document now (cropped), and take straightening and evening from Phase 6 as a server-made copy.
  - **Next, not blocked:** 1b-5, retiring the legacy Part 2 path; then the timed walk.
- 2026-11-14: **1b-5 begun, in stages. Stage 0: the browser specs that sit on legacy links move to the links drivers are sent** (`claude/application-retire-legacy-part-two`, no product code).
  - **Why first:** the legacy wizard cannot be removed while three browser specs open a legacy link, and moving them changes no product code, so each can be checked on its own.
  - **`requiredAnswers.spec.ts`, rewritten.** On a legacy link the review could be reached with a required answer missing, and Send refused it. On a current link the task list will not open "Before you send" at all: the same rule, met one screen earlier. The spec now proves that, that the task stops on the question with the message under its box, and that Send then goes through once. Its legacy job-panel test is not carried over; `employmentWalk.spec.ts` walks a job on a current link. Passes three runs in a row.
  - **Still on legacy links:** `employmentTimeline.spec.ts` (the legacy wizard's own timeline; it goes with the wizard) and the Part 2 test of `offline.spec.ts` (an answer typed while saves fail is put back on the next visit; it must be rewritten on a current link, not dropped).
  - **Then:** what a legacy link shows in place of the wizard, the six section components and the linear navigation, and `applicationLegacyFilingIssues`.
- 2026-11-14: **1b-5 stage 0, first spec merged** (#2397).
- 2026-11-14: **1b-5 stage 0, second spec — and a defect it found on the links drivers are sent** (`claude/application-offline-spec-current-links`).
  - **`offline.spec.ts`'s Part 2 test, rewritten on a current link:** an answer typed while saves fail is put back on the next visit and sent on the revision it was typed on. Not dropped.
  - **Found by moving it: a driver inside a task was never told a save had failed.** "Not saved — check your signal. Your answers are still on this screen." was drawn on the task list and on the legacy wizard's bar, and nowhere inside a task, which is where a driver on a current link types. The answer was not lost (the phone keeps it and sends it later), but the driver was told nothing. The status line is now drawn inside a task too, in the danger colour when it is trouble. The legacy test had been passing on a screen no driver sees.
  - **Proof:** the rewritten test failed three times in a row before the line was added and passes three times after; all applicant browser specs pass (44, with the three local-only `assistantDock` failures); looked at in a 390 px screenshot.
  - **Left on a legacy link:** `employmentTimeline.spec.ts` only, which is the legacy wizard's own timeline and goes with it.
  - **Next:** what a legacy link shows in place of the wizard, then the removals.
- 2026-11-14: **1b-5 stage 0, second spec merged** (#2398).
- 2026-11-14: **1b-5 stage 1, measured before it is touched** (no code changed; a probe, reverted).
  - **The probe:** a placeholder card put in front of every legacy link (a bundle with no `partOne`), and the applicant suites run.
  - **What it showed:** 3 test files fail, and almost all of it is `apps/web/src/pages/ApplyPage.test.ts` (1,582 lines, 59 tests): **about 30 of its tests build a legacy link.** The browser specs no longer do, except `employmentTimeline.spec.ts`.
  - **Why this is the real work of 1b-5, and why it is not a deletion:** most of those 30 pin behaviour that is every link's, written on a legacy fixture because it was the only one at the time: the consent comes before anything is asked or written; the ceremony sits between the consent and the form; a draft wording stops the send and says so on the first screen; the draft's revision conflict stops saving and offers a reload; the phone's copy is put back, never over a newer server copy; the screen reports name the screen the driver is on. Deleting them with the wizard would remove the only tests of those rules.
  - **The order that keeps them:**
    1. Move those tests onto a current link, a few at a time, in test-only merges. A test that only makes sense on the linear wizard (stepping "Step n of 9", its Back and Next) is named and dropped with its reason.
    2. Then the card for a legacy link, with `employmentTimeline.spec.ts` dropped in the same merge.
    3. Then the removals: `ApplySection`'s five section branches and their components (`ApplicantDetailsFields`, `AddressHistoryFields`, `AddressDrawer`, `AddressFields`, `ApplyEmploymentFields`, `SafetyHistoryFields`, `QuestionnaireFields` once nothing reads it), `ApplyProgress` and the linear Next/Back, the legacy identity screen.
    4. Last, the server's `applicationLegacyFilingIssues`.
  - **Stage 0 already paid for itself:** moving one browser test found that a driver inside a task was never told a save had failed (#2398). The same is likely to be true of some of the 30.

- 2026-11-15: **1b-5 stage 1, first test-only merge: the page's tests are counted, and 14 move to current links** (`claude/application-page-tests-current-links-1`, no product code).
  - **The count is now exact, and kept by the file.** `ApplyPage.test.ts` counts every application bundle a test serves that names no Part 1, and checks it after each test against `LEGACY_LINK_TESTS`. Measured with the list empty: **45 of 59 tests opened a legacy link** (the earlier "about 30" and "41 of 56" were estimates). A new test written on a legacy link fails; a listed test that no longer opens one fails until it is taken off the list. The list goes when the wizard does.
  - **Moved (14), fixture only, every assertion kept:** the public request carries no session; the carrier's name on the first screen; the filed card, its road-test certificate and the driver's own copy (3); "They have your application"; what the carrier changed above the signature, and "changed nothing"; the final send refused by the rules; approved but signed in the office; the Social Security number asked only at signing; the handbook's and the filed page's screen reports.
  - **One assertion changed:** the handed-over screen proved the form was gone by "Step 1 of" being absent, which a current link never prints; it now reads the task list's heading.
  - **Proof:** 59 pass. 6 of 6 mutants of the page's rules fail the moved tests (the link's own filed state ignored; "signed in the office" read from a missing stamp; the hand-over ignored; the final send skipping the rules; the office's changes not passed to the signing screen; approval ignored).
  - **Left on legacy links: 31,** in two groups: what comes before the form (welcome, consent, permissions, the waits, the date-of-birth question), and the form itself (the draft-wording stop, required answers, hand-over, the phone's copy).
- 2026-11-15: **1b-5 stage 1, second test-only merge: what comes before the form** (`claude/application-page-tests-current-links-2`, no product code). 13 more tests on current links; **18 left**.
  - **Moved:** the welcome on an untouched link and its three "already started" cases; the consent first, not asked while its wording is draft, not asked twice; the permissions between the consent and the form; the wait for the office to send the form (its three cases, the older API's among them); straight to the form once the permissions are in; the date-of-birth question before a draft that holds one, and none before; the welcome's and the consent's screen reports.
  - **What "the form" is on a current link, in these tests:** the task list's heading where the test said "Step 1 of 9"; Part 1's first photograph where the consent hands on. Two tests that proved "nothing is asked yet" by the form's absence now check Part 1's first screen is absent too.
  - **One test opens a task:** a saved first name used to be read off the wizard's first page. It is read inside "About you" now, which is where a driver finds it.
  - **One title changed:** "goes straight to the form for a driver who already consented" is "does not ask a driver who already consented again, and goes on to Part 1".
  - **Proof:** 59 pass. 13 of 13 real mutants fail the moved tests. One was rerun: its first form crashed every test, which proves nothing. A fourteenth (Part 1 no longer waiting for the consent) changes nothing a driver sees, because the consent's screen is chosen ahead of Part 1's in the page's order; it is not counted.
  - **Left (18):** the form itself (the draft-wording stop and the instruments shown unsigned, required answers and where the cursor lands, the hand-over, the carrier's address, the phone's copy), and the tests that are the legacy wizard's own, which go with it.
- 2026-11-15: **1b-5 stage 1, third test-only merge: the form itself** (`claude/application-page-tests-current-links-3`, no product code). 12 more tests on current links; **6 left, and all six are the legacy wizard's own.** Stage 1 is done.
  - **Moved:** the draft instruments shown unsigned at the send, and the permissions skipped while they are draft; "cannot be sent yet" on the first screen and the Send disabled; an unanswered question refused in words, the cursor put in its box, the box itself marked; the hand-over with no body; the carrier's address; the four tests of the draft's revision and the phone's copy.
  - **How they reach the form now:** by opening a task from the list ("Before you send", "About you"), which is the only way a driver reaches it. A shut row is a disabled button, so a test that cannot open its task fails on what it looks for next.
  - **A fixture fact worth knowing:** on a current link the three years of work are counted back from the carrier's day, and the old fixture's one job ended before it. That leaves a gap to explain and keeps "Before you send" shut. The moved tests name the carrier's day and a job that covers the three years (`CURRENT_DRAFT`).
  - **Two assertions read a different thing:** "Check your answers" was the legacy bar's label for the last step, not words on the screen. The tests read the review's own first sentence. "Before you can go on" was the legacy summary above the form; inside a task the message is under its box, and the test checks the question stayed and its message appeared.
  - **Proof:** 59 pass; 13 of 13 mutants fail the moved tests.
  - **The six left, each dropped or cut with the legacy-link card (stage 2), not before:** the code they test is still live until that merge.
    - "walks one screen at a time…", "resumes on the screen the driver had reached", "names the screen the driver is on, from the first screen down to the form's section": the linear wizard's stepping. ⚠ The first also reads words off five screens (the position question on "About you", no citations shown, the other-licences wording, "May we contact your previous employers?", the carrier's four questions). Before it is dropped, each of those is checked to be pinned on a current link, and moved if it is not.
    - "asks for the licence before the first permission when it is not on file": the legacy identity screen. The rule itself is pinned on current links by "walks a v2 link through Part 1 instead of the identity screen, before any permission".
    - "shows the date of birth on the form and does not let it be retyped once on file": the legacy "About you" page's lock. On a current link Part 1's answers are shown read-only, pinned by "releases Part 1's facts with the unlock…".
    - "offers the Clearinghouse registration on a v2 link's permissions-received screen only": its second half opens a legacy link as the contrast; that half goes.
- 2026-11-15: **1b-5 stage 2, measured before it is built — and the card is not the right build** (no code changed; a server probe, reverted).
  - **Production, measured 2026-11-15 (counts only):** exactly **one** legacy invitation exists (an invitation with no `application_intakes` row). It was created 2026-08-22, never filed, and is **revoked**. So no legacy link can open in production, none can be sent again, and **no filed legacy application exists**. The header comment that says eight legacy links are in production is out of date.
  - **A trap found while checking the card's advice.** The card was to say "ask the office for a new link". The office's "Send the link again" re-sends the SAME invitation whenever it is not revoked and its handbook is not filed (`canResendApplicationLink`); its end date is not read, and it is moved forward. So a lapsed legacy invitation would come back as a legacy link, and the card would send the driver round in a circle. Production cannot reach this (its one legacy invitation is revoked). Staging can.
  - **My decision: no new card. The server answers a legacy invitation as a dead link.**
    - The bundle route reads Part 1's row first and answers `invalid_link` when there is none. The page already has that card ("This link is not valid. Ask the carrier who invited you for a new one"), so there is no new wording, no Spanish string, and one place that decides whether a link is alive: the server.
    - The page then never loads a legacy application, so it cannot save, report screens or restore a draft behind a card, which a card drawn by the page would have had to prevent separately.
    - "Send the link again" on a legacy invitation makes a NEW invitation (the empty-application path it already takes when the current one cannot be re-sent), so the dead card's advice is true on staging as well.
    - Nothing changes for any production link.
  - **Why the refusal is not built yet: the API's tests are where the web's were.** The probe (the refusal alone) fails **31 API tests in 5 files**, 24 of them in `routes/publicApplication.test.ts`; they read the bundle of an invitation with no Part 1 row. Giving that file's default fixture a Part 1 row changes 13 more tests, some because they then run the current link's rules (filing composes from Part 1; a permission is refused until Part 1 is finished). That is a move like stage 1's, to be done the same way: counted, a few at a time, each batch mutation-checked.
  - **The order from here:**
    1. **API tests onto current links** (test-only merges): `publicApplication.test.ts` (24), `applicantIdentity.test.ts` (3), `publicApplicationAdoption.test.ts` (2), `applicationSend.test.ts` (1), `applicationSendForSigning.test.ts` (1). A test that is about a legacy invitation itself stays until step 2.
    2. **The refusal** (one merge): the bundle's `invalid_link` for a legacy invitation, "Send the link again" making a new invitation for one, the legacy-only API tests dropped or turned into the refusal's tests, and on the web the six tests listed above with `e2e-apply/employmentTimeline.spec.ts`.
    3. **The web removals**, as listed on 2026-11-14 (the five section branches and their components, `ApplyProgress`, the linear Next/Back, the legacy identity screen), with `LEGACY_LINK_TESTS` and its counter.
    4. **The server's legacy filing path** (`applicationLegacyFilingIssues`), which needs its own count of the filing tests first.
  - **Kept for step 3:** the web tests' `PART_ONE_NEW` and `PART_ONE_DONE` fixtures lack `cdlPhotoPending`, which the server has sent since U8. No test reads it; add it when the file is next touched.
- 2026-11-15: **1b-5 stage 2, step 1, first merge: the four small API test files** (`claude/application-legacy-retire-measured`, tests only). 7 of the 31 moved; **24 left, all in `routes/publicApplication.test.ts`.**
  - **Moved:** what the link reports about identity (3, `applicantIdentity.test.ts`), the adoptions it serves (2), the "form has been sent" stamp (1), the "signing has been opened" stamp (1). Each now reads the bundle of an invitation with a Part 1 row.
  - **A test that would have passed on a link that did not open.** "answers with a boolean and never reads the date of birth back to the bare link" checks the response does not contain the date of birth. A refusal does not contain it either, so under the refusal it stayed green while testing nothing. The helper now asserts the link opened (200) before reading it.
  - **Two tests kept on a legacy invitation, named as such:** signing a permission is refused `identity_missing` on a legacy invitation; a current one is refused earlier, until Part 1 is finished (`intake_incomplete`). That rule is the server's legacy path and goes with it (step 4).
  - **Proof:** the refusal, applied as a probe and reverted, now fails 24 tests in one file (31 in five before). 6 of 6 mutants fail the moved tests, one of them a bundle that serves a date of birth.
- 2026-11-15: **1b-5 stage 2, step 1, second merge: `routes/publicApplication.test.ts`** (`claude/application-api-bundle-tests-current-links`, tests only). **Step 1 is done: the refusal, applied as a probe, now fails 2 tests, and both open a legacy invitation on purpose.**
  - **How:** the file's default link is a current one now (`PART_ONE_ROW` in both seeds and in the three fixtures built by hand). A legacy invitation is passed by name (`LEGACY_INVITATION`), so every remaining use of one can be found.
  - **What changed with the default, and what was done about each:**
    - Three permission tests met "finish Part 1 first" (`intake_incomplete`) before the rule they test. Their links have Part 1 finished now.
    - Two tests compare a current link with a legacy one (no Part 1 status served; the draft not locked). Their legacy half is named. These are the two the refusal will turn into its own tests.
    - **Two tests FILE an application and stay on a legacy invitation**, each with a comment: a current link's filing is composed from Part 1's answers, which this file's fixtures do not hold. What they pin is every link's (no credential needed, no org or driver id handed back; a carrier's one published instrument does not block filing). They MOVE in step 4, with the legacy filing path; they are not dropped with it.
  - **Proof:** 81 pass. The probe fails 2 (24 before). 16 of 16 mutants of the bundle fail a test, across the whole recruiting suite: a blank carrier name, the address, the carrier's day, the device key, a phase stamp, the consent, the office's edits, the road-test date, the handbook, the stamped questions, the carrier's questions, the offered documents, what is owed, the draft's lock after Part 1, the summary after Part 1, the adoptions.
  - **Next: step 2, the refusal itself** (one merge, the first product change of 1b-5): the bundle answers a legacy invitation `invalid_link`; "Send the link again" makes a new invitation for one; the two comparison tests become the refusal's; on the web the six listed tests go, with `e2e-apply/employmentTimeline.spec.ts`.
- 2026-11-15: **1b-5 stage 2, step 2: the server answers a legacy invitation as a dead link** (`claude/application-legacy-link-refused`, no migration). **The first product change of 1b-5.**
  - **The bundle** (`GET /api/public/application/:token`): Part 1's row is read first. With none, the answer is the dead link's own, word for word (`DEAD_LINK`, now one definition shared with the resolver), and nothing of the application is read: not the draft, the office's edits or the photographs. The page shows the card it already has.
  - **"Send the link again"** opens a new invitation for a legacy one and never re-sends it. Re-sending moved its end date forward and would have mailed the dead link.
  - **For production: nothing changes for any link.** Its one legacy invitation is revoked.
  - **A decision changed from this morning's order: the six web tests and `employmentTimeline.spec.ts` are NOT dropped here.** The page's legacy code is still in the bundle until step 3, and a test leaves with the code it tests. Dropping them a merge early would leave live code untested for no gain. Step 3 removes both together.
  - **Not closed by this merge, and why it is left:** the link's OTHER routes (save a draft, sign a permission, file) still accept a legacy token, because they go through the resolver and the server's legacy path is step 4. The page cannot reach them, since it never gets a bundle. Likewise the office's other sends on a legacy invitation (send the application, send for signing, the videos, the reminder) would still mail a link that opens the dead card. Neither can happen in production; on staging the remedy is "Send the link again".
  - **Tests changed:** the two that compared a current link with a legacy one are now the refusal's test and the lock's own. Two fixtures that had no Part 1 row and expected a re-send were given one (`applicationLink.test.ts`'s hand-built one, `applicationInvites.test.ts`'s seed); under the new rule they were legacy invitations by accident.
  - **Proof:** the recruiting and Med-Stop suites pass (2,257). 8 of 8 mutants killed: no refusal; the draft read before the refusal; a different sentence, a different code, or a 200 for a legacy link; a legacy invitation re-sent; the rule inverted; another invitation's row read.
  - **Next: step 3, the web removals**, with the six tests, `employmentTimeline.spec.ts` and `LEGACY_LINK_TESTS`. Then step 4, the server's legacy path: the resolver refusing a legacy token on every route, `applicationLegacyFilingIssues`, and the two filing tests in `publicApplication.test.ts` moved onto a current link.
- 2026-11-15: **Step 2 merged** (#2419). On staging a legacy invitation's link is a dead link.
- 2026-11-15: **1b-5 stage 2, step 3a: the page has one form, the task list** (`claude/application-legacy-wizard-removed`, no migration, web only).
  - **Why this is split from the component deletions (3b):** this merge removes every way to REACH the legacy screens. The next one deletes the components, which is then provably dead code and can be checked by "nothing imports it".
  - **Gone from the page:** the linear wizard's progress bar and its Next/Back, the legacy identity screen (`IdentityFields.vue`, deleted with its test), and the "is this a Part 1 link?" switch everywhere it was read: the stage bar, the task list, the office's questions, the Clearinghouse note, the carrier's day the form counts from. `useTaskHub` no longer takes an "enabled" flag.
  - **Kept:** `ApplyProgress.vue` itself. The office's hiring checklist card uses it.
  - **Tests dropped (5), each the linear wizard's or the legacy identity screen's own:** "walks one screen at a time and ends by handing it to the carrier", "resumes on the screen the driver had reached", "asks for the licence before the first permission when it is not on file", "shows the date of birth on the form and does not let it be retyped once on file", "names the screen the driver is on, from the first screen down to the form's section". With them `e2e-apply/employmentTimeline.spec.ts` (the legacy wizard's own timeline).
    - **Checked before dropping the first one:** the words it read off each screen are tested elsewhere on current code (the position question in `aboutYouWalk.spec.ts`; the carrier's questions in `servedForm.test.ts`, `applicantFactRows.test.ts`, `requiredAnswers.spec.ts`; "even if you gave it up" in `PartOneOtherLicences.test.ts`). Two are not, and are the legacy pages' own headings, which go in 3b: "Other licenses and permits, now or in the last 3 years" and the screen title above "May we contact your previous employers?" (the question itself is the carrier's, asked by the walk).
  - **One test trimmed:** the Clearinghouse test loses its legacy half.
  - **The counter stays, as a standing check:** `ApplyPage.test.ts` fails any test that serves an application bundle with no Part 1. `LEGACY_LINK_TESTS` is gone.
  - **A mistake caught by counting:** my script that dropped the fifth test also cut the test after it ("names the welcome and the consent on an untouched link"). Comparing every test title with the committed file showed six gone where five were meant; it was restored from git, unchanged.
  - **Two tests added, both found by mutation.** Nine mutants of the simplified page were run; two survived, and both were real gaps in the page's own tests (the browser specs covered them, the unit tests did not): the stage bar not being drawn, and an office question not opening its task when "Open my answer" is pressed from the wait screen. Each has a test now ("marks which of the three visits the driver is on, above the task list", "opens the task an office question is about, at that question, from the wait screen"). 10 of 10 after.
  - **Proof:** applicant and recruiting unit suites pass (2,788); the 43 applicant browser specs pass against a build (failing locally and not this work: the three `assistantDock` specs, and main's new `liveMap.spec.ts`); gates 45/45. For a current link nothing on screen changes, so there was no new screen to look at.
  - **`ApplyPage.vue` is 467 lines** (496 before; the budget is 500 and warns at 450).
  - **Next: 3b**, delete what nothing reaches now: `ApplySection`'s five section branches, `ApplicantDetailsFields`, `AddressHistoryFields`, `AddressDrawer`, `AddressFields`, `ApplyEmploymentFields`, `SafetyHistoryFields`, the wizard's `next`/`back`/`isFirst`, and `QuestionnaireFields` if nothing else reads it (the office's fact editor names it; to be read first). ⚠ `PartOneFactsCard` and `useTaskWalk` name `ApplicantDetailsFields`; read whether that is an import or a comment before deleting.
- 2026-11-15: **1b-5 step 3b, measured before anything is deleted: ten test files mount the old section screens.**
  - **The count (tests in the file / places it mounts an old screen):** `partOneFactsScreens.test.ts` 13/6, `ApplySection.test.ts` 4/4, `employment.test.ts` 22/1, `ApplyEmployerPanel.test.ts` 15/0 (imports `ApplyEmploymentFields`), `controls.test.ts` 8/4, `carrierQuestionsForm.test.ts` 12/1, `servedForm.test.ts` 7/2, `AddressHistoryFields.test.ts` 14/2, `SafetyHistoryFields.test.ts` 15/0, `QuestionnaireFields.test.ts` 2/1. About 112 tests.
  - **Why this is not a deletion yet:** it is stage 1's trap again, one layer down. Some of these pin a rule through an old screen that a driver now meets in the walk (the job panel's questions, the carrier's questions and their order, Part 1's answers shown read-only, the address months). Deleting the screens with their tests would delete the only test of any rule the walk's own tests do not hold.
  - **The order:** per file, read each test and sort it: (a) the rule is the walk's too and already tested there (name the test, drop this one); (b) the rule is the walk's and NOT tested there (move it onto `TaskWalk`/`WizardScreen`/`useTaskWalk`); (c) the rule is the old screen's alone (drop, with its reason). Then delete the five branches and the components in one merge. `ApplySection.test.ts` first: its notice test stays (the review screen stays), its two "carrier's day" tests are (a) ("tells a v2 link's job panel the carrier's day…" on the page), its question-order test needs checking against `useTaskWalk.test.ts`.
  - **Live components that share files with the dead ones and must be kept:** `LicenceFields` ("Your license" is still drawn whole), `DocumentCaptureFields`, `ReviewFields`, `ApplyEmployerPanel` and `QuestionField` if the walk draws them (to be read, not assumed).
- 2026-11-15: **Step 3a merged** (#2421). The page has one form.
- 2026-11-15: **1b-5 step 3b, first merge: the count is exact, and the question tests move** (`claude/application-legacy-sections-tests`, tests only).
  - **The exact count: 74 tests, in ten files, depend on the seven old screens** (the "about 112" above counted every test in those files). Measured by blanking the seven components and running the suites, then restoring them: 13 addresses, 14 job panel, 11 job list, 11 driving record, 9 Part 1's answers, 3 `ApplySection`, and 13 about the carrier's questions.
  - **The 13 question tests are MOVED, because what they test is live.** They mounted the old questions screen, but what they pin is `QuestionField` and `questionnaireAnswers`, which the walk uses for every carrier question: two buttons for a yes/no, the required mark, "If so, when?" forgotten on a no, a skip stored as its own answer, the carrier's own questions written under `carrier_answers`, Spanish, the stamp deciding what is required. They now mount a test-only harness (`questionListHarness.ts`) that lists a task's questions through `QuestionField`. `QuestionnaireFields.test.ts` is renamed `applyingAsQuestion.test.ts` for what it tests.
  - **Proof:** the four files pass (29). 7 of 7 mutants of the LIVE control and its answers fail them: the required mark dropped; the skip never offered; a skipped question still showing its box; a skip stored as blank; a dependent answer kept on a no; the carrier's answers written into, or refused under, the built-in questions.
  - **Sorted, to be dropped with the screens in the next merge (61):**
    - **Driving record (11) and addresses (13): the old screens' own controls.** The rules are the walk's and tested there: the four gates and nothing else, a Yes opening the first row, a No declaring none and clearing every row ("opens one blank row on Yes, and on No declares none and clears every row"), the months meter, an earlier home's street left for the office but not its city.
    - **§40.25(j) "not asked again when Part 1 answered it":** the walk never asks it at all (`TASK_FACTS_ASKED_ELSEWHERE`, and "asks the four gates of a clean record, and nothing else").
    - **Part 1's answers on "About you" and the current address (9):** on the walk by "ends on Part 1's answers, read-only…" and "shows the home Part 1 holds above the one question asked about it…". The two `LicenceFields` tests in that file STAY: "Your license" is still drawn whole.
    - **`ApplySection` (3):** the carrier's day reaches the walk ("tells a v2 link's job panel the carrier's day…"), and the order of the carrier's questions is the walk's ("…the carrier's own questions after the built-in ones").
    - **The job list and its panel (25): to be READ before the next merge, not assumed.** Two of them are about what each card on the jobs timeline says is missing, and the timeline is also the office's.
  - **A vacuous test found:** `controls.test.ts`'s "chooses the class of equipment with the forms' control" asserts only that something is ABSENT (no `<select>`, no raw token), so it passed against a blank component. It goes with the old screen; the walk's equipment picks have their own test.
- 2026-11-15: **1b-5 step 3b, second merge: the seven old section screens are deleted** (`claude/application-legacy-sections-deleted`, web only, no migration). **The legacy wizard is gone from the web app.**
  - **Deleted:** `ApplicantDetailsFields`, `AddressHistoryFields`, `AddressDrawer`, `AddressFields`, `ApplyEmploymentFields`, `SafetyHistoryFields`, `QuestionnaireFields`, and `ApplySection`'s five branches to them. 1,134 lines of components.
  - **Kept, because live:** `LicenceFields` ("Your license" is drawn whole), the documents and review screens, `QuestionField`, `PartOneFactsCard`, `CorrectionNote`, `SsnField`, and the jobs timeline and employer form (the office's).
  - **A defect that deleting would have made, caught by reading the chain:** `ApplySection` ended in a bare `v-else` that was the review. With the five legacy screens gone, a walked task that failed to open would have fallen through to "Before you send". Each remaining screen is named now, and a walked task with no walk draws nothing ("draws nothing for a walked task when there is no walk, and never the review in its place").
  - **The job list and its panel (25 tests), read as promised:** all the old panel's own. What each timeline card says is missing, "add a job here" and "unfinished" are tested on the live timeline (`EmploymentTimeline.test.ts`); which jobs owe the DOT answers is shared's rule ("asks the (iv) questions of (b)(10) employers only, not of the seven years before"); a job's own screens are the walk's.
  - **Tests, by title, against the previous merge: 69 gone, 4 new.**
    - **61 dropped** as sorted in the entry above.
    - **6 more dropped that had been passing against a BLANK component**, so they were never among the 74: each asserts only that something is absent, or loops over elements that were not there ("offers no Remove for an address never saved", "hides the list entirely when the driver declares no employment", "asks for the jobs first…", "shows no box when the three years are covered", "chooses a class of equipment with the forms control", "makes every choice a 56 px block…"). The 56 px rule is tested on the live screen (`WizardScreen.test.ts`).
    - **1 copy test dropped** (the old job list's introduction, EM-10): that sentence is drawn by nothing now.
    - **1 renamed** ("asks the license when the page holds no Part 1 answers yet").
    - **Kept and moved to its own file:** the three tests holding the driving-record questions against the regulation's text (`safetyQuestionsRegulation.test.ts`). Their wording is what the walk asks.
  - **Proof:** applicant and recruiting suites pass (2,723); 4 of 4 mutants of the section switch killed (the review as the fallback again; "Your license" not handed Part 1's facts; the notice off the review; the walk not drawn); the 43 applicant browser specs pass against a build; gates 45/45.
  - **Left for a small clean-up, recorded so it is not lost:** copy that only the deleted screens drew is still in `strings.history.ts` and its Spanish file (the old screens' introductions and panel labels). It is drawn by nothing; removing it needs a check of each key against the walk, which reads some of the same objects.
  - **Next: step 4, the server's legacy path** — the resolver refusing a legacy token on every route, `applicationLegacyFilingIssues`, the web's `v2AsOf`-is-null branches, and the two filing tests in `publicApplication.test.ts` moved onto a current-link fixture. Then the timed walk at 390×844.
- 2026-11-15: **1b-5 step 4 (the server's legacy path), measured — and put AFTER the timed walk. My decision, with the numbers.**
  - **The probe:** the resolver refusing an invitation with no Part 1 row, on every route (reverted). **321 API tests in 29 files fail**, because their fixtures build an invitation with no `application_intakes` row: `applicationIntake.test.ts` 44, `applicationPacketMarks.test.ts` 32, `applicationCapture.test.ts` 24, `publicApplicationAdoption.test.ts` 20, `publicApplication.test.ts` 17, `handbookCeremony.test.ts` 17, `publicApplicationSms.test.ts` 16, `applicationDraft.test.ts` 14, `permissionInstrument.test.ts` 13, `signLinkUnlock.test.ts` 12, and nineteen more files of 1 to 11.
  - **What step 4 buys:** the server stops accepting a legacy token on the routes behind the bundle, and `applicationLegacyFilingIssues` and the three "is this v2?" branches (`applicationReleases.ts`, `signatureAdoption.ts`, `applicationSubmit.ts`) go. No driver or office member sees a difference: production's only legacy invitation is revoked, and the page cannot reach those routes since step 2.
  - **What it costs:** a fixture move about eight times the size of step 1's API half (321 against 38), most of it one line per seed, some of it tests that then meet a current link's rules first (as the three permission tests did).
  - **So the order is: the timed walk, then the owner's phone walk, then step 4.** The walk is the proof the whole F4 batch has been waiting for and the only thing between this work and the owner's hands; step 4 is clean-up of code nothing reaches. Step 4 is not dropped: it is the next piece after the walk, in merges of a few files each, the probe re-run after every one.
  - **Until then, the open edge is exactly this, and only on staging:** a legacy token is refused by the bundle and still accepted by the other routes, and the office's other sends on a legacy invitation mail a link that opens the dead card. The remedy there is "Send the link again".
- 2026-11-15: **Step 3b merged** (#2424, #2426). The legacy wizard is gone from the web app.
- 2026-11-15: **The full walk at 390×844, and a defect it found** (`claude/application-timed-walk`, no migration).
  - **The walk** (`e2e-apply/fullWalk.spec.ts`): one ordinary driver, in a real browser against the built app, from opening the link (the date-of-birth question, which gives back the first visit's answers) through every task to "They have your application". Two homes in three years, one driving job with school before it, one kind of truck, a clean record, the carrier's required answers given and its three optional ones passed.
  - **What it measures: the work. 38 screens, 71 taps, 112 characters typed.** Those are exact, so the spec pins them: a change that adds a screen or a box to everybody's application changes a number on purpose.
  - **What it does not measure: minutes.** A script finishes in seconds. Real minutes come from `application_screen_events`. Production, the real fleet, read 2026-11-15 (aggregates only): the first visit, 3 applicants, median 11.0 minutes (5.8 to 19.8); the history form, 2 applicants, median 20.5 (5.8 to 35.3); signing, none yet. That does not contradict the 10 / 30 / 5 the welcome screen prints (`APPLICATION_STAGE_MINUTES`), and it is too few people to change them. They stay until the owner's phone walk and more applicants say otherwise.
  - **It also checks:** no screen is wider than the phone; every task closes Completed; "Before you send" names only the three optional answers; the answers are saved before the send; the send goes once.
  - **⚠ The defect: Send could hand over an application the server did not hold yet.**
    - The hand-over carries no answers; the office opens the SAVED draft. An answer is saved up to five seconds after it is typed (a two-second pause, and never more than one save in five seconds).
    - So a driver who corrected one answer from "Before you send" and pressed Send inside that window handed over the application without the correction, and was told the carrier had it. The late save still went out if the page stayed open. If the driver closed it, the office read the old answer.
    - The walk hit it every time, because a script is always inside the window: the hand-over went with no save before it at all.
    - **The fix:** Send first makes the server hold what is on the screen (`useApplicationDraft.settle`): it waits for a save on its way, sends what is left at once, and answers whether it is held. If it is not, nothing is handed over and the driver reads "Your last answers could not be saved, so nothing was sent. Check your signal and press Send again — they are still on this page." The button stays busy meanwhile.
    - **Not affected:** the final "Sign and send it", which sends the answers itself.
  - **Proof:** the walk fails twice on a build without the wiring and passes on a build with it (6 runs). Unit: 9 new tests; 9 of 10 mutants killed by them, and the tenth (the page not passing the save to the send) is the one the walk kills. All 44 applicant browser specs pass; gates 45/45. A first comparison run gave three failures on the fixed build that I could not explain, so the comparison was repeated from clean builds before it was believed.
  - **Seen on the walk, not changed, for the owner's eye:**
    1. A tap on one of the regulation's Yes/No questions moves on by itself (U3). A tap on one of the CARRIER's Yes/No questions ("Can you legally work in the USA?", "May we contact your previous employers?") does not: Continue is needed. Recommended: make them the same.
    2. "Before you send" prints the phone as `+13125550142`; "About you" prints the same number as (312) 555-0142.
    3. Q-AM23 is visible here: "Email — This is needed" stops a driver who has none.
  - **Next:** the owner's walk on a real phone (staging), with those three in hand; then step 4.
- 2026-11-15: **1b-5 step 4, first merge: five test files open the link a driver is sent** (`claude/application-legacy-server-1`, tests only, no migration).
  - **The probe, run again on main at 31bb338:** the resolver refusing an invitation with no Part 1 row on every route fails **321 tests in 29 files**, the same count as before. (Three more failed in that run and are not this work: one each in `outcomeFeed.sweep.test.ts`, `readingExtent.property.test.ts` and `efsCardWriteDeadline.test.ts`.)
  - **One definition of a current link's Part 1 row:** `apps/api/src/testing/partOneRow.ts` (`PART_ONE_ROW`). It was a constant inside `routes/publicApplication.test.ts`; that file reads the shared one now. Every fixture that stands for "the link a driver is sent" seeds it.
  - **The row is full-shaped: every answer column, null**, the way `mintIntakeRow`'s bare insert leaves it. The five-key row it replaces crashed the reading copy the first time it was seeded there (`composeFiledApplication` read `address_line1` as `undefined`, which no real row gives). A fixture with a column missing is a row that cannot exist.
  - **Moved (97 tests):** `applicationPacketMarks.test.ts` 32, `applicationCapture.test.ts` 24, `handbookCeremony.test.ts` 17, `routes/permissionInstrument.test.ts` 13, `applicationReadingCopy.test.ts` 11. One seeded line per fixture; no test title changed and no assertion changed.
  - **Proof:** the five files pass on main's code (124 tests) and pass with the probe applied (124). `routes/publicApplication.test.ts` passes on main's code with the shared row (82) and keeps its 17 under the probe; they are a later merge.
  - **Left: 224 tests in 24 files.** Next by size: `applicationIntake.test.ts` 44, `routes/publicApplicationAdoption.test.ts` 20, `routes/publicApplication.test.ts` 17, `routes/publicApplicationSms.test.ts` 16, `applicationDraft.test.ts` 14, `signLinkUnlock.test.ts` 12. Several of those seed `application_intakes: []` on purpose and must be read, not patched.
- 2026-11-15: **1b-5 step 4, second merge: six more test files** (`claude/application-legacy-server-2`, tests only, no migration).
  - **Moved (79 tests):** `routes/publicApplicationAdoption.test.ts` 20, `routes/publicApplicationSms.test.ts` 16, `signLinkUnlock.test.ts` 12, `applicationTrustedDevice.test.ts` 11, `routes/publicApplicationIntake.test.ts` 10 of its 11, `applicationUnlockCode.test.ts` 10. Four of them seeded `application_intakes: []`; read, none of those was a legacy test, the table was only declared empty.
  - **Two fixtures needed more than the row, because a current link has a rule a legacy one skipped:**
    - **Adopting a signature comes after Part 1** (`INTAKE_INCOMPLETE`, `signatureAdoption.ts`). The adoption file's default link now has Part 1 finished, and the rule's own test ("comes after Part 1 on a v2 link") overrides that. Checked by mutation: with the rule removed, that test and only that test fails. The fixture's `intakes` option and its local copy of the row are gone.
    - **One test is the legacy rule's own** and keeps a legacy fixture, said so in a comment: "lets a legacy link (no Part 1 row) past this check to its old rules" (`routes/publicApplicationIntake.test.ts`). It is the one test of these six files that still fails under the probe, and it is dropped in the merge that removes the rule.
  - **Proof:** the six files pass on main's code (100 tests); with the probe applied 99 pass and that one fails.
  - **Left: 145 tests in 19 files**, the largest `applicationIntake.test.ts` 44, `routes/publicApplication.test.ts` 17, `applicationDraft.test.ts` 14.
- 2026-11-15: **1b-5 step 4, third merge: eight small test files** (`claude/application-legacy-server-3`, tests only, no migration).
  - **Moved (43 tests):** `routes/publicApplicationTextLink.test.ts` 8, `applicationRoadTestCopy.test.ts` 7, `routes/publicApplicationScreenEvents.test.ts` 7, `applicationHandoff.test.ts` 6, `applicationCopy.test.ts` 5, `esignConsent.test.ts` 4, `routes/publicApplicationSsn.test.ts` 3, `routes/publicApplicationPolicy.test.ts` 3. One seeded line per fixture; no title and no assertion changed, and none of them met a rule a legacy link had skipped.
  - **Proof:** the eight files pass on main's code (65 tests) and with the probe applied (65).
  - **Left: 102 tests in 11 files:** `applicationIntake.test.ts` 44, `routes/publicApplication.test.ts` 17, `applicationDraft.test.ts` 14, `applicationFiling.test.ts` 8, `routes/applicationSendForSigning.test.ts` 5, `routes/applicationSend.test.ts` 4, `applicationAskAgain.test.ts` 3, `routes/orientationVideos.test.ts` 3, `routes/applicantIdentity.test.ts` 2, `applicationDocumentsLink.test.ts` 1, and the legacy rule's own test in `routes/publicApplicationIntake.test.ts`.
- 2026-11-15: **1b-5 step 4, fourth merge: the filing and signing tests file on a current link** (`claude/application-legacy-server-4`, tests only, no migration).
  - **This is the current-link filing fixture the plan said did not exist yet.** `applicationFiling.test.ts` had one of its own (Part 1 answered, an employer covering three years, the carrier's seven answers). It is now shared from `apps/api/src/testing/partOneRow.ts` (`PART_ONE_ANSWERED`, `CURRENT_LINK_EMPLOYER`, `CURRENT_LINK_APPLICATION`), and `applicationIntake.test.ts` (59 tests, 44 of them failing under the probe) files and signs on it. The two filing tests in `routes/publicApplication.test.ts` that still pass `LEGACY_INVITATION` can move onto it next.
  - **The default link in `applicationIntake.test.ts` has Part 1 finished** (`intake_completed_at`), because on a current link the permissions and the signature wait for it.
  - **Six tests needed their own input changed, because the shared application is a complete one. No assertion was weakened; each was checked by mutation:**
    - **Two packet tests** ("refuses a packet missing a single place…", "refuses the right number of marks made on the wrong places") left out the LAST place of the full list. That place, p31b, is the owner-operator's alone, and the shared application is a company driver's, so the packet they built was complete and filed. They now leave out the last of the company driver's places. Mutant "a missing place is accepted": both fail.
    - **Two §11 tests** expected a refusal for an unanswered carrier question, and the shared application answers all seven. One takes `heard_from` back out; the other sends no answers and no version, which is what its comment always said. Mutant "an unanswered required question files": both fail.
    - **The phase-stamp test** expected Part 1's stamp to be null "as on every legacy link"; it now expects the stamp the link carries. Mutant "Part 1's stamp is not handed to the page": it fails.
    - **The call-summary test** built an employer with two years and no address; it now uses the shared employer under its own key. Mutant "calls are never copied": it fails.
  - **`applicationFiling.test.ts`: the default link is a current one.** Two tests are the legacy filing rule's own and keep a legacy fixture, named `LEGACY_INVITATION` and said so: "asks a legacy invitation nothing new but §40.25(j), and files what it certified" and "refuses a legacy filing that never answered §40.25(j), and files nothing". They go when `applicationLegacyFilingIssues` goes. The question B test ("on either kind of link") now runs on a current link.
  - **Proof:** both files pass on main's code (75 tests). With the probe applied 72 pass: the two legacy tests above, and "files Part 1's phone, street, licence and §40.25(j) answer, org-scoped", which counts the reads of `application_intakes` and so sees the probe's own extra read. That count is settled in the merge that makes the refusal real. 54 test titles before, 54 after.
- 2026-11-15: **The probe after the fourth merge: 53 tests left in 10 files** (it moved 49). Run over the recruiting tests on `claude/application-legacy-server-4`.
- 2026-11-15: **1b-5 step 4, fifth merge: the last eight test files. Every test that stands for "the link a driver is sent" now opens one** (`claude/application-legacy-server-5`, tests only, no migration).
  - **Moved (48 tests):** `routes/publicApplication.test.ts` 17, `applicationDraft.test.ts` 13 of its 14, `routes/applicationSendForSigning.test.ts` 5, `routes/applicationSend.test.ts` 4, `applicationAskAgain.test.ts` 3, `routes/orientationVideos.test.ts` 3, `routes/applicantIdentity.test.ts` 2, `applicationDocumentsLink.test.ts` 1.
  - **The two filing tests the plan said must be moved and not dropped are moved:** "accepts a certified application without any credential" and the filing at the end of "takes an override for one instrument and the shipped catalogue for the rest" file on the shared current-link fixture. `LEGACY_INVITATION` in that file is left for one test only, the refusal's own ("answers a legacy invitation as a dead link…").
  - **The identity rule is NOT a legacy rule, and its two tests are moved, not kept as legacy.** "refuses identity_missing, before any signature is recorded" and "signs once identity is on file" were on a legacy fixture because a current link is stopped earlier, at "finish Part 1". With Part 1 finished the identity rule answers on a current link too (`applicationReleases.ts`), so that is where they run now. Mutant "a permission is signed with no identity on file": the first fails.
  - **One more permission test needed Part 1 finished** ("opens all four again once the driver has consented").
  - **The two fixture options that chose "legacy or current" are gone** (`partOne` in `applicationSend.test.ts`, the absent `intake` in `applicationSendForSigning.test.ts`): the default is a current link.
  - **Proof:** the eight files pass on main's code (237 tests; the same number of test titles per file before and after). With the probe applied 236 pass.
  - **What still fails under the probe, in the whole API suite: five tests, and that is the end state of the fixture move.**
    - Four are the legacy rules' own, each on a fixture marked legacy, each to be dropped in the merge that removes its rule: "gives a legacy link no Part 1 facts" (`applicationDraft.test.ts`), "lets a legacy link (no Part 1 row) past this check to its old rules" (`routes/publicApplicationIntake.test.ts`), "asks a legacy invitation nothing new but §40.25(j), and files what it certified" and "refuses a legacy filing that never answered §40.25(j), and files nothing" (`applicationFiling.test.ts`).
    - One counts the reads of `application_intakes` ("files Part 1's phone, street, licence and §40.25(j) answer, org-scoped") and sees the probe's own extra read. It is settled by how the real refusal reads the row.
  - **Next: the refusal itself, in shipped code.** The resolver refuses an invitation with no Part 1 row on every route; then `applicationLegacyFilingIssues` (server and `useApplicationWizard`), the three `intakeState(...).v2` branches, and the four legacy tests go. That merge changes what the server does, so it is its own pull request with its own proof.
- 2026-11-15: **1b-5 step 4, the change itself: an invitation from before Part 1 is a dead link on every route** (`claude/application-legacy-refused-every-route`, no migration). **The legacy application is gone from the server.**
  - **What changes for a driver or the office: nothing in production.** Production's one legacy invitation is revoked (measured 2026-11-15), so its link was dead already. On staging, a legacy link that was refused by the page's first read and still accepted behind it is now refused everywhere, in the same words.
  - **The refusal** is in `resolveInvitation`, the function every route on the link calls: after the token is found alive, it reads whether the invitation has an `application_intakes` row (scoped to the invitation's org) and answers the dead link's sentence if not. Read last, so a token dead for any other reason costs one query as before. A live link costs one more small read per request.
  - **Removed, because nothing can reach it now:**
    - `applicationLegacyFilingIssues`, its issue text in English and Spanish (`prior_test_answered`), and its use in the server's filing and in the web's `useApplicationWizard`. §40.25(j) is Part 1's question and the form has not asked it since the old screens went.
    - The filing's legacy branch (`applicationSubmit.ts`): every filing is the composed one. If Part 1's row is gone between the resolver's read and the filing's, the answer is the dead link's.
    - Two of the three "is this v2?" reads: a permission and a signature adoption now ask only whether Part 1 is finished (`applicationReleases.ts`, `signatureAdoption.ts`). One read fewer on each.
  - **Kept, on purpose:**
    - The third "is this v2?" read, in `sendApplicationLinkAgain`. It is the office's side and it is the remedy: "Send the link again" on a legacy invitation opens a new one.
    - The bundle's own check that Part 1 exists, before anything of the application is read.
    - `applicationAsFiled`'s null for "no Part 1" and the office readers that branch on it (the review, the office's completion, the preview, the jobs section's `v2` prop). They read rows, not links, and the legacy row is still in the table.
  - **Tests: four dropped, three added, two changed.**
    - Dropped, each the removed rule's own: "gives a legacy link no Part 1 facts", "lets a legacy link (no Part 1 row) past this check to its old rules", "asks a legacy invitation nothing new but §40.25(j), and files what it certified", "refuses a legacy filing that never answered §40.25(j), and files nothing". With them the shared rule's unit test ("asks §40.25(j) until it is answered, and takes No as an answer").
    - Added (`applicationIntake.test.ts`): "refuses a live invitation that has no Part 1, in the words of every dead link"; "signs nothing and files nothing on an invitation that has no Part 1"; "asks for the Part 1 of the invitation's own org, and only once the token is otherwise alive".
    - Changed: the filing test that counts reads of `application_intakes` expects two (the resolver's and the filing's). The web's "stops a legacy link's driving-record screen on an unanswered §40.25(j)…" becomes "does not stop the driving-record screen on §40.25(j), which Part 1 asks and this form does not", and now asserts the screen has no issue at all, where its second half only asserted one was absent.
  - **Proof:** all 2,130 recruiting server tests pass on the change (2,131 before: four dropped, three added). Shared 5,647 pass. Four mutants, each killed: the resolver lets a legacy invitation through (the two new tests fail); the Part 1 read is not scoped to the org (six fail, among them the new scoping test and `expectOrgScoped`'s); a permission no longer waits for Part 1; adopting a signature no longer waits for Part 1.
  - **The open edge, as it stands after this merge.** The link side is closed. The office side is not: "send the application", "send for signing", the videos and the reminder still act on a legacy invitation's row and would mail a link that opens the dead card. **Production has no live legacy invitation, so nobody can meet this there; it is a staging-only edge.** Recommended: build nothing for it. The remedy is "Send the link again", which gives that applicant a current invitation. If a live legacy invitation is ever found in production, the fix is one migration that revokes invitations with no Part 1 row, not a guard on four routes.
  - **Left from the handoff's list, small:** the web's `v2AsOf`-is-null wording in `useApplicationWizard.ts` comments (the office's jobs section still passes null on purpose, so the parameter stays nullable); dead copy in `strings.history.ts` and its Spanish file; the unused `partTwoLink` in `e2e-apply/stubApi.ts`; `cdlPhotoPending` missing from the page tests' Part 1 fixtures.
- 2026-11-15: **The small clean-ups recorded above, done** (`claude/application-cleanups`, web only, no migration, nothing a driver or the office sees).
  - **Fifteen strings nothing draws, removed from `strings.history.ts` and its Spanish file:** the old job list's and panel's (`jobNeedsAnswers`, `equipmentIntro`, `addEquipment`, `jobsHeading`, `addFirstJob`, `coverageHeading`, `coverageEmpty`, `gapExplanation`, `gapExplanationHint`), the old driving-record screen's (`violationStateHint`, `penaltyHint`, `addViolation`), and the legacy §40.25(j) question's (`priorTestIntro`, `priorTest`, `priorTestHint`).
    - **How "nothing draws it" was decided:** a key was removed only if its name appears NOWHERE as a whole word in `apps/web/src`, `packages/`, `apps/admin` or `apps/driver/src` outside the strings files, tests included. A name-based search cannot miss a key read through an alias or an index, and it leaves alone any key whose name is also used for something else. That is why 15 went and not more: the walk reads many of the same objects (`walk.*`, the review's labels), and anything with a single other mention stayed.
    - A first search reported 115 unused keys. It was wrong: the pattern used `\b`, which this machine's `git grep -E` does not support, so every search matched nothing. Caught because it listed the walk's own questions as unused.
    - `priorTestHeading` stays: the review and the office's card label Part 1's answer with it.
  - **`partTwoLink` removed from `e2e-apply/stubApi.ts`:** a legacy link's bundle, used by no spec since `employmentTimeline.spec.ts` went.
  - **`cdlPhotoPending: false` added to the Part 1 fixtures** of `ApplyPage.test.ts`, `stubApi.ts` and `adoption.spec.ts`: the server has served the key since 0605, and a fixture without it is a bundle no current server sends.
  - **Two comments in `useApplicationWizard.ts`** no longer describe a legacy link.
  - **Proof:** web typecheck passes; the applicant and recruiting unit suites pass (1,145); the web app builds and the 44 applicant browser specs pass against the build (failing locally and not this work: the three `assistantDock` specs and `liveMap.spec.ts`).
