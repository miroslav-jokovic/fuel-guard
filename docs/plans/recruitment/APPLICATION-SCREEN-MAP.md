# Driver application: screen map, one question per screen (2026-11-09)

Part of `APPLICATION-FIX-PLAN.md` (this replaces its U3a). It is built from the field inventory in
`APPLICATION-MISMATCH-AUDIT-2026-11-09-A-applicant-form.md`, where every current input is listed with its file:line.

## 1. Rules (owner, 2026-11-09)

- **D-AM2: one independent question per screen.** If an answer doesn't depend on its neighbours, it gets its own screen.
- **D-AM3: a grouped screen only when the fields are ONE fact that is typed together.** Examples: a name (first, middle, last, suffix); an address (street, city, state, ZIP); a licence card (state plus number); a date range (from, until); "how many hurt / how many died". Every grouped screen below says which fact it is.
- **D-AM4: the employer section is simplified, and employer addresses are optional for the driver.**
  - Drivers usually don't know a former employer's street address; the office completes it on the dashboard.
  - The driver gives the company name and, if they know it, the city and state.
  - ⚠ §391.21(b)(11) still needs the address ON the application, and §391.23 needs it to send the inquiry. The requirement therefore **moves from the driver's "Send" to the office's "Send for signing"**: the office can't open signing while an employer address is missing. The driver then sees the office-added address on the change screen (S-3.1) before signing, which is what makes it part of what they certify.
- **D-AM5: never ask what we already know.**
  - Anything scanned from the CDL, typed by the office at invite, or carried by the job opening is shown for confirmation, not asked again.
  - A question whose answer can be derived from another answer is dropped (see §4).
- **Every screen:**
  - a big **Continue**;
  - **Back**;
  - a three-stage progress bar ("Today · Your history · Signing");
  - autosave on every Continue;
  - the language switch in the header;
  - Yes/No as two big buttons that also advance;
  - quick-pick answers where answers repeat, with "Other" opening a text box.

Key: **1Q** = single-question screen. **G** = grouped screen (one fact). **i** = no question (information or action).
**IF** = shown only when the condition holds. **Loop** = repeated per row, ending with "Add another?" (1Q).

## 2. Stage 1: "Today — about 10 minutes, have your CDL in hand"

| # | Screen (title the driver sees) | Kind | Fields → key | Notes / change from today |
|---|---|---|---|---|
| 1.0 | What this involves | i | — | Three honest stages with times (U1). Replaces "8 screens, 30 minutes". |
| 1.1 | Before you start | 1Q | e-sign consent | Unchanged (7001(c)). |
| 1.2 | Photo of the front of your CDL | 1Q | capture `cdl_front` | **New:** "I don't have it with me" → continue, and the office sees "CDL photo pending" (Q-AM5). |
| 1.3 | Photo of the back of your CDL | 1Q | capture `cdl_back` | The barcode read pre-fills 1.4. |
| 1.4 | Is this right? | G (confirmation of the scan) | name, DOB, home address, licence state + number, expiration | **New.** One "Yes, that's right" or "Fix something". Only the facts that weren't read, or that the driver taps to fix, become the screens 1.4a–e. |
| 1.4a | Your name | G (name) | first, middle (optional), last, **suffix (new)** | Pre-filled from the invite. Allow a single name with a "I only have one name" tick (fixes the mononym block). |
| 1.4b | Your date of birth | 1Q | `date_of_birth` | One date component everywhere. A 2-digit year gets "Use 4 digits for the year". |
| 1.4c | Where you live now | G (address) | street, unit, city, state/province, ZIP/postal code, **country (new)** | US, CA and MX, with postal rules per country (F1). |
| 1.4d | Your CDL | G (licence card) | issuing state, licence number | `autocapitalize=characters`, `autocorrect=off`. |
| 1.4e | When does your CDL expire? | 1Q | `cdl_expires_on` | — |
| 1.5 | What class is your CDL? | 1Q | `cdl_class` | A / B / C / **Learner's permit (CLP)**. Today A/B/C only. |
| 1.6 | Which endorsements do you have? | 1Q (multi-pick) | `endorsements[]` | H, N, X, T, P, S, plus **"None"**. |
| 1.7 | Your mobile phone | 1Q | `phone` | Pre-filled from the invite. Non-US numbers allowed. Required only if there is no email (Q-AM5). |
| 1.8 | Your email | 1Q | `email` | **Moved here from Part 2.** Pre-filled. "I don't have email" is allowed if there is a phone. |
| 1.9 | In the last 3 years, did you have any other driver's license? | 1Q | `other_licences_held` | — |
| 1.9a | Loop: The other license | G (licence card) | country, state/province or authority, number | IF 1.9 = Yes. Foreign licences are allowed. |
| 1.9b | Loop: What kind of license was it? | 1Q | `kind` | CDL / CLP / regular / other. **New**: today it is never asked, so the packet's TYPE column is blank (P3). |
| 1.9c | Loop: When did (or does) it expire? | 1Q | `expires_on` | — |
| 1.9d | Any other license? | 1Q | — | Loop end. |
| 1.10 | In the past 2 years, did you test positive or refuse a pre-employment drug or alcohol test for a job you didn't get? | 1Q | `prior_positive_2y` | Asked once only: the legacy duplicate in Part 2 is removed. |
| 1.11 | In the past 30 days, were you in a DOT drug and alcohol testing program? | 1Q | `dot_program_30d` | — |
| 1.12 | In the past 6 months, did you take a DOT drug test? | 1Q | `dot_tested_6m` | IF 1.11 = Yes |
| 1.13 | For the past 12 months, were you in a DOT random testing program? | 1Q | `dot_random_12m` | IF 1.11 = Yes |
| 1.14 | Gender, for your drug test | 1Q | `donor_gender` | — |
| 1.15 | Photo of your medical card | 1Q | capture `medical_card` | "I don't have one yet" → `medical_card_pending` |
| 1.16 | A photo of you | 1Q | capture `selfie` | "I can't" is now **stored** (today it is discarded). |
| 1.17 | Your rights | i | FCRA summary | "I have read this". |
| 1.18 | How do you want to sign? | G (signature) | typed full name, style or drawn | Unchanged. |
| 1.19 | Your initials | 1Q | initials | Unchanged. |
| 1.20–1.25 | Permission 1 of 6 … 6 of 6 | i (sign) | one document each | Unchanged. |
| 1.26 | Done for today | i | — | Says exactly what is next, with the optional SMS opt-in. |

## 3. Stage 2: "Your history — about 20 minutes, any time this week"

The DOB unlock is asked once per device; after that a remembered-device token is used, with a texted-code fallback (F0).

**About you**

| # | Screen | Kind | Key | Notes |
|---|---|---|---|---|
| 2.1 | Have you used any other name? | 1Q | `other_names` | Yes → 2.1a |
| 2.1a | Other names | 1Q (list) | `other_names[]` | Now labelled; "Add another name" on the same screen. |
| 2.2 | Can you legally work in the USA? | 1Q | `legally_work` | — |
| 2.3 | Company driver or owner-operator? | 1Q | `applying_as` | Skipped when the opening says which. |
| 2.4 | How did you hear about us? | 1Q | `heard_from` | Quick picks: Indeed, Facebook, a friend or a driver, our website, other. Skipped when the lead's source is known. |

**Where you have lived**, the 3-year history (§391.21(b)(3))

| # | Screen | Kind | Key | Notes |
|---|---|---|---|---|
| 2.5 | When did you move to {current address}? | 1Q | `addresses[0].from` | Month and year. If it is 3 years ago or more, the section ends here. |
| 2.6 | Loop: Where did you live before that? | G (address) | city, state, country (required); **street and ZIP optional** | Same principle as D-AM4: the office can complete it. → Q-AM8 |
| 2.6a | Loop: When did you live there? | G (date range) | from, until | Month and year. The coverage meter shows "2 years 4 months of 3 covered". The loop ends when 3 years are covered. |

**Where you have worked**: simplified (D-AM4)

| # | Screen | Kind | Key | Notes |
|---|---|---|---|---|
| 2.7 | May we contact your previous employers? | 1Q | `may_contact_employers` | — |
| 2.8 | Loop: What was the company's name? (first pass: "your current or most recent job") | 1Q | `employer_name` | First pass also offers "I haven't worked in the last 3 years", which sets `declares_no_employment`. → Q-AM10: FMCSA name search. |
| 2.9 | Loop: Where was {company} based? | G (place) | city, state | **Optional.** "I don't know" is fine. Street, ZIP, phone and USDOT are **no longer asked**; the office completes them (D-AM4). |
| 2.10 | Loop: When did you work at {company}? | G (date range) | from, until, or "I still work here" | **Month and year**, not exact days (today: an exact day). The contract stores `YYYY-MM`; F1 migrates it. |
| 2.11 | Loop: Did you drive a truck at {company}? | 1Q | `operated_cmv` | **No default** (today it defaults to Yes). |
| 2.11a | Loop: What was your job there? | 1Q | `position_held` | IF 2.11 = No. When Yes, the position is filed as "Driver". |
| 2.12 | Loop: Was it a DOT job — DOT drug tests, logbook or ELD, DOT medical card? | 1Q | → `subject_to_fmcsr` + `safety_sensitive` (+ `dot_regulated`) | IF 2.11 = Yes. **Merges three questions into one** (Q-AM9). Yes/No/Not sure; "Not sure" goes to the office to resolve. |
| 2.13 | Loop: Why did you leave {company}? | 1Q | `reason_for_leaving` | Skipped if they still work there. Quick picks: better pay or miles, laid off, company closed, home time or family, moved, let go, other. "Other" opens a text box. |
| 2.14 | Loop: Did you work anywhere before {company}? | 1Q | — | Yes → back to 2.8 for the previous job. The coverage meter is shown. It goes back 3 years, then **10 years for truck-driving jobs** (§391.21(b)(11)): after 3 years the question becomes "Did you drive a truck for anyone before {company}?" |
| 2.15 | Per gap over 30 days: What were you doing from {month} to {month}? | 1Q | `employment_gaps[].explanation` | Quick picks: looking for work, school or training, family, health, own business, other. |

So an employer is **5 screens, 4 of them one tap** (today a 12-field panel). Removed from the driver:
`address_line1`, `postal_code`, `phone`, `email`, `usdot_number`, the separate `dot_regulated`, and the free-text position for drivers.

**Your experience** (§391.21(b)(6))

| # | Screen | Kind | Key | Notes |
|---|---|---|---|---|
| 2.16 | What have you driven? | 1Q (multi-pick) | `equipment_experience[].equipment_class` | Straight truck, tractor-semi, doubles/triples, tanker, bus, other. |
| 2.16a | Per pick: Your {class} experience | G (one class's experience) | from (month/year), until or "still", approximate miles | Miles accept "100,000" (F0). |
| 2.17 | Anything else about your driving we should know? | 1Q | `experience` | Optional, multi-line. Today it is labelled optional but is secretly required. |

**Your driving record**

| # | Screen | Kind | Key | Notes |
|---|---|---|---|---|
| 2.18 | In the last 3 years, were you in any accident while driving? | 1Q | `declares_no_accidents` | — |
| 2.18a | Loop: When was the accident? | 1Q | `occurred_on` | — |
| 2.18b | Loop: What happened? | 1Q | `nature` | Multi-line. |
| 2.18c | Loop: Was anyone hurt or killed? | G (casualties) | injuries, fatalities | Blank is not 0; it asks (F0). |
| 2.18d | Loop: Were hazardous materials spilled? | 1Q | `hazmat_spill` | — |
| 2.18e | Any other accident? | 1Q | — | — |
| 2.19 | In the last 3 years, were you convicted of a traffic violation, or did you forfeit bond for one? (Not parking tickets) | 1Q | `declares_no_violations` | — |
| 2.19a | Loop: When? | 1Q | `occurred_on` | — |
| 2.19b | Loop: What for? | 1Q | `offence` | Quick picks: speeding, logbook or HOS, equipment, lane or following, other. |
| 2.19c | Loop: Where? | G (place) | city, state | City is newly asked (§391.21(b)(8) "location"). |
| 2.19d | Loop: What was the penalty? | 1Q | `penalty` | Quick picks: fine, points, suspension, bond forfeited, other. Now required (P10). |
| 2.19e | Any other? | 1Q | — | — |
| 2.20 | Has any license or permit to drive ever been **denied**? | 1Q | `licence_denied` | **Split** from the single flag (P4). |
| 2.20a | What happened? | 1Q | `licence_denied_detail` | IF Yes |
| 2.21 | Has any license or permit to drive ever been **suspended or revoked**? | 1Q | `licence_suspended_revoked` | **Split** (P4). |
| 2.21a | What happened? | 1Q | `licence_suspended_detail` | IF Yes |

**Silvicom's questions**, each labelled "Silvicom asks this"

| # | Screen | Kind | Key | Notes |
|---|---|---|---|---|
| 2.22 | What is the highest school you finished? | 1Q | `education.level` | **Replaces the required table.** Quick picks: some high school, high school or GED, some college, college degree. |
| 2.23 | Did you go to truck-driving school? | 1Q | `education.cdl_school` | — |
| 2.23a | Which school, and when did you finish? | G (one school) | name, month/year | IF Yes |
| 2.24 | Have you served in the military? | 1Q | `military_service` | "I'd rather not say" kept. |
| 2.24a | When did you serve? | G (date range) | from, until | IF Yes. Today it is free text. |
| 2.25 | Any other training that would help in this job? | 1Q | `other_training` | Optional |
| 2.26 | Would you like to give references? | 1Q | — | Optional section |
| 2.26a | Loop (max 3): A reference | G (one person) | name, phone, years known | — |
| 2.27…n | Each of the carrier's own configured questions | 1Q each | `carrier_answers.*` | One per screen, generated from the stamp. |

**Your documents**

| # | Screen | Kind | Key | Notes |
|---|---|---|---|---|
| 2.30 | Which of these can you photograph now? | 1Q (multi-pick) | — | Medical certificate, TWIC, passport, green card or work permit, SS card, hazmat endorsement, road-test certificate, training certificate, other. Plus "None now — I'll bring them". |
| 2.30a | Per pick: Photo of your {document} | 1Q | capture | — |

**Check and send**

| # | Screen | Kind | Notes |
|---|---|---|---|
| 2.31 | Check your answers | i (review) | One scrolling page, grouped like the office card, each answer with "Change" (U6). Anything missing is listed with "Fix", and the button never fails silently. |
| 2.32 | Send it to Silvicom | 1Q | The §391.21(d) notice, then the button. |

## 4. Stage 3: "Signing — about 5 minutes, after we review"

| # | Screen | Kind | Notes |
|---|---|---|---|
| 3.1 | What we changed | i (accept) | Every office edit, as "You put / It now says". **Includes office-added employer and residence addresses** (D-AM4) and Part 1 corrections (today these are missing, E7). |
| 3.2 | Your Social Security number | 1Q | Format-free input (dashes are fine). Checked on blur, not at the last tap. Required or optional per Q-AM3. |
| 3.3 | Sign the application | i (packet walk) | Place n of N, unchanged. |
| 3.4 | Sign and send | 1Q | Problems are listed above the button with "Fix" (F0). |

## 5. Questions dropped or derived, and why

| Today | Becomes | Why |
|---|---|---|
| "Do you have proof of age?" | Dropped | The DOB plus the CDL scan already prove age 23+. Check it in the office from the DOB. |
| "Position you are applying for" | From the opening; asked only when the invite has no opening | The office already chose it. |
| Employer `dot_regulated`, `subject_to_fmcsr`, `safety_sensitive` | One question (2.12) | Three near-identical questions confuse drivers. The office can split them on the dashboard (Q-AM9). |
| Employer street, ZIP, phone, email, USDOT | Office completes them | Drivers don't know them (D-AM4). |
| Position for a driving job | "Driver" | Implied by 2.11 = Yes. |
| Legacy "failed pre-employment test" checkbox | Removed | Already asked in 1.10. |
| Education table (required, at least one row) | 2.22 + 2.23 | §391.21 doesn't ask for it; the table blocked people with nothing to list. |
| Email asked in Part 2 | Moved to 1.8 with the phone | One place for contact details. |

## 6. Count

| Driver | Stage 1 | Stage 2 | Stage 3 | Total | Typed answers |
|---|---|---|---|---|---|
| Clean record, scan read OK, 1 address, 3 jobs, 1 equipment class | 24 | about 32 | 4 | **about 60** | about 10 |
| 2 addresses, 5 jobs, 1 accident, 1 ticket | 24 | about 52 | 4 | **about 80** | about 20 |

Most screens are one tap. Today's form has fewer screens but 94 inputs on dense panels. The tap-to-advance Yes/No
buttons, and the scan confirmation replacing about 10 typed fields, are what keep this inside the promised 10 + 20 + 5 minutes.
Prove that with the timed Playwright walk in F4.

## 7. Engineering consequence

The wizard is **generated** from the fact catalogue (D-AM1). Each fact carries:
- `screen` (its screen id and group);
- `when` (its condition);
- `loop` (which loop it belongs to);
- `quickPicks`.

One `WizardScreen` component renders any 1Q or G screen. The office "Applicant facts" card (F3) and the packet map
(F2) read the same catalogue. This replaces these hand-written section components:
- `ApplicantDetailsFields`;
- `AddressHistoryFields`;
- `ApplyEmploymentFields`;
- `SafetyHistoryFields`;
- `QuestionnaireFields`;
- `PartOneAnswerFields`.

Stored drafts keep loading through the F1 adapter.

## 8. Open questions

| ID | Question | Options | Recommendation |
|---|---|---|---|
| Q-AM8 | Previous **home** addresses: is the street optional too? | ANSWERED 2026-11-11 (owner): **(a)**. The carrier's paper has Street, City, State and Zip on each residency line, so the street is still ASKED; the driver may leave it, and the office completes it before signing | — |
| Q-AM9 | Merge the three employer DOT questions into one (2.12)? | ANSWERED 2026-11-11 (owner, "as proposed"): **(a)**, one question with "Not sure" for the office | — |
| Q-AM10 | Company-name search against FMCSA (fills the address and USDOT automatically) | ANSWERED 2026-11-11 (owner, "as proposed"): **(a), later** | — |
| Q-AM11 | Employer dates by month instead of exact day | ANSWERED 2026-11-11 (owner): **(b) the exact day, MM/DD/YYYY**. "Dates are important and crossmatched." The form already asks the full date (`started_on`/`ended_on`); nothing changes | — |

## 9. Typing a date (D-AM6, owner 2026-11-09)

**What's wrong today:** the driver's form uses three different date controls.
- Three Month/Day/Year boxes (`AppMemorableDate`) for DOB and expiration.
- A calendar popover (`AppDateField` → `DatePickerBase`, VueDatePicker 14) for employer, accident and conviction dates. It only parses the exact `MM/dd/yyyy`, so typing `1001` or `10/1/85` does nothing.
- A month calendar (`AppMonthField`) for addresses and equipment.

On a phone none of these lets a driver just type the date they know.

**The rule:** one date box everywhere on the driver's form and in the office card.
- The driver types digits.
- The slashes appear by themselves.
- The date it understood is written out in words under the box, before Continue.

| Typed | Field kind | Understood as | Shown under the box |
|---|---|---|---|
| `1001` | any day field without year | **10/01/{this year}**, so `10/01/2026` | "October 1, 2026" |
| `10011985` | any | 10/01/1985 | "October 1, 1985" |
| `100185` | past (DOB, accident, conviction, hire date) | 10/01/1985: the 2-digit year goes to the century that makes the date valid for the field (DOB: age 18–99) | "October 1, 1985" |
| `100128` | future (expiration) | 10/01/2028 | "October 1, 2028" |
| `10/1/85`, `10-1-85`, `10.1.1985`, `10 1 85` | any | same as the digits | — |
| `1/5` | any | 01/05/{this year} | "January 5, 2026" |
| `0319` / `319` / `3/19` | month field (addresses, employers, equipment) | 03/2019 | "March 2019" |
| `1001` | **DOB** | not accepted: "Add the year you were born, e.g. 10011985" | — |
| `1301`, `0230` | any | not accepted: "There is no month 13" / "February has no 30th" | — |
| `1215` typed in Nov 2026 | past-only field (accident) | 12/15/**2025**: a date with no year that would land in the future goes to last year | "December 15, 2025" (the driver sees it) |

**Details:**
- `inputmode="numeric"`: the phone number pad has no slash key, which is why the slashes are automatic. A slash typed on a keyboard still works.
- The written-out date under the box is the safety net. The driver sees "October 1, 1985", never a guess they can't notice. In Spanish it reads "1 de octubre de 1985".
- Order is **MM/DD in both languages** (owner, Q-AM12). The spelled-out month under the box is what shows a driver who typed DD/MM what was understood.
- Range checks per field, from the catalogue (D-AM1):
  - DOB: age 18–99.
  - Expiration: up to 10 years ahead (past allowed, with "This is expired" as a warning).
  - Incident: within the asked window ("more than 3 years ago, you don't need to list it").
- The calendar stays only where a date is **chosen**, not remembered (appointments, scheduling), as a button beside the box. Never on the driver's form.
- **Build:**
  - one pure parser `parseTypedDate(text, { kind, today })` in `packages/shared/src/typedDate.ts`, unit-tested against every row of the table above;
  - one component `AppTypedDate` in `packages/ui`.

  `DatePickerBase` also passes the same parser to VueDatePicker's `text-input.format` (v14 accepts a function, `TextInputConfig.format`), so the office calendars accept the same typing. `AppMemorableDate` is retired. The wire value is unchanged (`yyyy-MM-dd` / `yyyy-MM`), so no contract moves.

## 10. Wizard = application = dashboard, 100% (D-AM7, owner 2026-11-09)

The owner ruled that the wizard and the application must match 100%, and that every fact can be edited on the dashboard. This is enforced by construction plus a gate, not by review:

1. **One catalogue** (D-AM1). Every fact has an entry with:
   - its schema;
   - its EN and ES label;
   - its input kind;
   - its wizard screen (§2–§4);
   - its packet place (or `notPrinted` with a reason);
   - its office editor kind.
2. **The wizard, the office "Applicant facts" card and the packet field map are all generated from it.** There is no hand-written list of fields anywhere else.
3. **Gate `lint:application-parity`, added to `ci.yml` in the same PR.** It fails when:
   - a contract key has no catalogue entry;
   - a catalogue entry has no wizard screen, no office editor, no packet place (or no `notPrinted` reason), or no ES label;
   - the packet has a field no entry fills.
4. **The same label wording on all three.** The office card shows the driver's question ("Did you drive a truck at {company}?") above the answer, so office and driver read the same thing.

**What the office can edit (everything the driver ANSWERED):**
- every fact in §2–§3, including adding and removing rows (addresses, licences, jobs, gaps, equipment, accidents, convictions, names, references);
- the documents (replace or add a photo);
- the SSN (replace; shown as •••-••-1234);
- the contact details (which also moves the invitation's email and phone).

Each edit:
- uses the same `AppTypedDate`, state list and quick picks as the wizard;
- writes an `application_edits` row and an audit row;
- is shown to the driver on screen 3.1 to accept before signing.

**What the office cannot edit (everything the driver SIGNED or AGREED):**
- the e-sign consent;
- the six permission documents;
- the adopted signature and initials;
- the packet marks;
- the certification.

Changing these would be signing for the driver. The office can instead **ask the driver to sign again**, which re-opens that one document on their link.

**After signing: no edits (owner ruling 2026-11-09, Q-AM2 → (b)).** The office edits anything until the driver makes their first packet mark. From then on, the application is what the driver certified, and no addendum mechanism is built. The existing post-filing employment corrections (`driver_employment_history`, which serve the §391.23 investigation file) are left as they are.

| ID | Question | Options | Recommendation |
|---|---|---|---|
| Q-AM12 | Spanish page date order | ANSWERED 2026-11-09: **(a)** MM/DD, the same as English (owner) | — |
