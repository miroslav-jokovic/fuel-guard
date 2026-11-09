# Applicant flow (`/apply/:token`): every field, and the defects found by reading the code

Read-only audit of `origin/main` @ `ac44b6b` (checkout at `scratchpad/main`). Unless a path says otherwise,
it is relative to `apps/web/src/features/apply/`. Shared code is `packages/shared/src/`, written `shared/…`.
English text is quoted exactly. Spanish has the same keys, because `es/strings.es*.ts` is typed against
`APPLY_COPY_EN` (`strings.ts:86`, `strings.ts:437-440`). So a "missing Spanish" defect below means text
that never goes through `APPLY_COPY`.

---

## 0. How the screen is chosen

`pages/ApplyPage.vue` works out every condition. `ApplyPhaseRouter.vue:115-254` picks the screen with a
`v-if` chain, and the first branch that matches wins:

| # | Branch (router line) | Condition (computed in ApplyPage) | Screen |
|---|---|---|---|
| a | `:116` | invitation loading | "Opening your application…" |
| b | `:122` | bundle 404/410 | Dead-link card (`linkMemo.ts`) |
| c | `:130` | `submitted` (`phases.submittedAt` or just sent) | `ApplicationFiledCard` (+ handbook walk) |
| d | `:143` | handed over, not approved (`ApplyPage.vue:98-103`) | Wait: "They have your application" |
| e | `:153` | `expectationsNeeded`: not begun AND link unused (`ApplyPage.vue:216`) | **Screen 1: What this involves** |
| f | `:164` | `consentNeeded && esignConsent` | **Screen 2: 7001(c) consent** |
| g | `:175` | `partOneNeeded && partOneInputs`, only on a v2 link (`usePartOneStep`) | **Part 1, 10 steps** |
| h | `:181` | `identityNeeded`: legacy link only (`ApplyPage.vue:267-269`) | Legacy identity step |
| i | `:189` | `ceremonyNeeded`: releases published, not completed (`ApplyPage.vue:248-254`) | **Signature adoption + 6 permissions** |
| j | `:203` | `waitingForApplication`: `applicationSentAt === null` and releases done | Wait: "We have your permissions" (+ Clearinghouse on v2, + SMS opt-in) |
| k | `:214` | approved and `signingOpenedAt === null` | Wait: "Your application is approved" (sign in the office) |
| l | `:222` | `locked`: draft holds a DOB and has not been unlocked | **Unlock: date of birth** |
| m | `:234` | approved, signing opened | **Second visit: sign-off and packet walk** |
| n | `:252` | otherwise | **The form (Part 2)**: a task list on v2, a linear wizard on legacy |

A v2 applicant in practice walks this: 1 → 2 → Part 1 (10) → signature adoption → 6 permission
documents → wait → (email) → unlock DOB → Part 2 hub (7 tasks + "Before you send") → wait → approved →
(in the office) unlock DOB → sign-off and packet → filed.

---

## 1. Screen 1: "What this involves" (`ApplyExpectations.vue:70-122`)

There are no inputs. It shows `"{n} screens, about {m} minutes in all."` (`strings.ts:150-151`), with n and
m taken from the 8 Part 2 sections (`ApplyExpectations.vue:61-65`, `shared/applicationSections.ts:106-131`).
It lists what to have on hand (`strings.ts:154-158`) and every capture slot except `other`. There is one
button, **"Start"**, which sets only the in-tab `begun` flag (`ApplyPage.vue:338`). Nothing is persisted.

## 2. Screen 2: "Before you start", the 7001(c) consent (`EsignConsentGate.vue:23-49`)

| Label | Key | Type | Req | Validation | Persisted |
|---|---|---|---|---|---|
| "I agree — continue" (`strings.flow.ts:209`) | none (an act) | button | yes, to go on | none | `POST /:token/consent` → `esignConsent.ts:100` rpc `record_esign_consent` |

The consent body is served text (`consent.body`) and is English-only (Q-AW11).

---

## 3. Part 1, "Get started": a 10-step linear stepper (v2 links)

Container: `partOne/PartOneFlow.vue:142-197`. Order: `shared/applicationScreens.ts:35-46`:
`cdl_front, cdl_back, about, address, licence, otherLicences, screening, medical_card, selfie, rights`.
The header reads "Step n of 10" (`strings.partOne.ts:23`, `usePartOne.ts:296`). Buttons are "Back" (from
step 2 on) and "Continue", or "I have read this" on the last step.

**Persistence.** Screens 3–6 are held in the page, and on the device (`partOneLocal.ts`), until screen 7.
Then `firstWrite` posts three calls (`partOneScreens.ts:261-270`):
1. `POST /:token/intake` (contact, address, CDL class and endorsements, screening)
2. `POST /:token/intake/licences` (the whole licence list)
3. `POST /:token/intake` with `{date_of_birth}`

The routes are in `apps/api/src/modules/recruiting/routes/publicApplicationIntake.ts:50,68`, and both reach
rpc `record_applicant_intake` (`applicantIntake.ts:145`), which writes tables `application_intakes` and
`application_intake_licences` (migration 0376). The DOB is written onto `drivers` through
`record_applicant_identity` and is fill-only (`shared/applicationScreens.ts:30-31`). The last Continue
calls `POST /:token/intake/complete` → rpc `complete_applicant_intake` (`applicantIntake.ts:196`).
Validators run on the client in `partOne/partOneScreens.ts`, and on the server with
`applicantIntakeSchema` and `applicantIntakeLicenceSchema` (`shared/applicantScreeningContract.ts:119-178`).

### Step 1: "Photo of the front of your CDL", and Step 2: "Photo of the back of your CDL" (`partOne/PartOnePhoto.vue:142-222`)

| Label | Key | Type | Req | Validation | Persisted |
|---|---|---|---|---|---|
| "Take photo" → live scanner, or "Use the camera app instead" | capture slot `cdl_front` / `cdl_back` | camera/file | **yes, no skip** | Continue asks `photoDone()`, which needs a capture on file (`partOneScreens.ts:284-293`). In-browser quality gate (`strings.documents.ts:46-64`) | `POST /:token/capture` → rpc `stage_application_capture` / `confirm_application_capture` (`applicationCapture.ts:214,236`) → table `application_captures` + staging bucket |
| "Upload a photo instead" | same | file | alternative to the above | same | same |
| "Use this photo" / "Retake" | sends the held photo | button | must press before Continue (`PartOneFlow.vue:132-139`) | — | — |

- On a computer a QR code comes first: "Easier on your phone" (`PartOneHandoff.vue`). There is also an
  optional SMS opt-in card, or "Text me the link" when consent is already given.
- When the back of the CDL is sent, its PDF417 barcode is read and pre-fills DOB, address and licence
  number/state/expiry, but only into boxes that are still blank (`partOneScreens.ts:344-368`).

### Step 3: "About you" (`partOne/PartOneAnswerFields.vue:37-48`)

The intro reads "{Carrier} uses these to check your driving record and to reach you about your application."

| Label | Key | Type | Req | Validation (source) | Persisted |
|---|---|---|---|---|---|
| "Mobile phone number". Hint: "A US number. We will only text you if you agree to it later." | `phone` | text `type=tel inputmode=tel autocomplete=tel-national` | **yes** | `usMobilePhoneSchema`: normalised to `+1[2-9]\d{9}` (`shared/applicantScreeningContract.ts:70-82`). Blank → "Enter your mobile phone number."; bad → "Enter a US mobile number, ten digits." (`partOneScreens.ts:119-122`) | `application_intakes.phone` |
| "Date of birth". Hint: "For example, 3 7 1985. Your driving record is looked up with it." | `date_of_birth` | 3 boxes Month/Day/Year (`AppMemorableDate`, `autocomplete=bday`) | **yes** | `requiredDateOfBirthSchema`: ISO date, real date, age 18–120 (`shared/rosterContract.ts:56-75,88-108,146`) | `drivers.date_of_birth` through `record_applicant_identity` (fill-only) |

### Step 4: "Where you live now" (`PartOneAnswerFields.vue:50-70`)

The intro reads "We use this to find a drug-test site near you."

| Label | Key | Type | Req | Validation | Persisted |
|---|---|---|---|---|---|
| "Street address" | `address_line1` | text `autocomplete=address-line1` | yes | 1–200 characters (`applicantScreeningContract.ts:123`) | `application_intakes.address_line1` |
| "Apartment, suite or unit (optional)" | `address_line2` | text | no | ≤200 | `…address_line2` |
| "City" | `city` | text | yes | 1–120 | `…city` |
| "State" | `state` | combobox, **US states and DC only** (`PartOneAnswerFields.vue:26,62`) | yes | `usStateSchema`: "Choose a US state" (`:84-88`) | `…state` |
| "ZIP code" | `postal_code` | text `inputmode=numeric maxlength=5` | yes | `/^\d{5}$/`: "A ZIP code is five digits" (`:127`) | `…postal_code` |

### Step 5: "Your CDL" (`PartOneAnswerFields.vue:72-102`)

The intro reads "Enter it as it appears on your licence."

| Label | Key | Type | Req | Validation | Persisted |
|---|---|---|---|---|---|
| "Issuing state". Hint: "Start typing to find it." | `cdl.state_code` | combobox (68 US and Canadian jurisdictions) | yes | `jurisdictionCodeSchema` (`applicantScreeningContract.ts:90-94`) | `application_intake_licences[0].state_code` |
| "Licence number" | `cdl.licence_number` | text `autocomplete=off` | yes | 1–40 after trim (`:52,168`) | `…[0].licence_number` |
| "Class" | `cdl.cdl_class` | radio: A / B / C | **yes** | must be in `CDL_CLASSES` (`partOneScreens.ts:150`, `shared/rosterContract.ts:53`) | `application_intakes.cdl_class` |
| "Expiry date" | `cdl.expires_on` | 3 boxes (`AppMemorableDate`) | yes | ISO date (`applicantScreeningContract.ts:176`). Expired dates are **not** refused | `…[0].expires_on` |
| "Endorsements (tick any you have)": "H — Hazardous materials", "N — Tank vehicle", "X — Tank and hazardous materials", "T — Double and triple trailers", "P — Passenger", "S — School bus" | `cdl.endorsements[]` | checkboxes | no | enum (`:151`) | `application_intakes.endorsements` |

### Step 6: "Other licences in the past 3 years" (`partOne/PartOneOtherLicences.vue:53-95`)

| Label | Key | Type | Req | Validation | Persisted |
|---|---|---|---|---|---|
| "In the past 3 years, have you held a driver's licence other than this CDL — from another state, or another country?" Hint: "Include licences that have expired…" | `otherHeld` (page-only) | Yes/No | yes | null → "Answer Yes or No."; Yes with none added → "Add the licence, or answer No." (`partOneScreens.ts:186-190`) | not stored as such |
| Per licence, shown on Yes after "Add a licence": "State or province" | `others[].state_code` | combobox (US and CA only) | yes | "Choose the state or province that issued it." | `application_intake_licences[n]` |
| "Issuing authority (only if it is not a US state)" | `others[].agency` | text | no | 1–`LICENSING_AUTHORITY_MAX_LENGTH` | `…agency` |
| "Licence number" | `others[].licence_number` | text | yes | 1–40; no duplicate state and number (`partOneScreens.ts:165-184`) | `…licence_number` |
| "Expiry date". Hint: "The date printed on it — even if you gave it up." | `others[].expires_on` | 3 boxes | yes | ISO date | `…expires_on` |
| "Add this licence" / "Cancel" / "Remove" | — | buttons | — | — | — |

### Step 7: "Questions about drug and alcohol testing" (`PartOneAnswerFields.vue:104-127`)

| Label | Key | Type | Req | Cond. | Persisted |
|---|---|---|---|---|---|
| "In the past 2 years, did you test positive, or refuse to test, on a pre-employment drug or alcohol test for a driving job you applied for and did not get?" | `prior_positive_2y` | Yes/No | yes | — | `application_intakes.prior_positive_2y` (the server refuses any write without it: AI009) |
| "In the past 30 days, were you in a DOT drug and alcohol testing program?" | `dot_program_30d` | Yes/No | yes | — | `…dot_program_30d` |
| "In the past 6 months, did you take a DOT drug test?" | `dot_tested_6m` | Yes/No | yes when shown | only if the 30-day answer is Yes | `…dot_tested_6m` |
| "For the past 12 months, were you in a DOT random testing program?" | `dot_random_12m` | Yes/No | yes when shown | only if the 30-day answer is Yes | `…dot_random_12m` |
| "Gender, for your drug test": "Male" / "Female" / "I'd rather not say" | `donor_gender` | radio | yes ("Choose one…") | — | `application_intakes.donor_gender` |

Rules: `partOneScreens.ts:192-203`.

### Step 8: "Photo of your medical card" (`PartOnePhoto.vue`)

| Label | Key | Type | Req | Persisted |
|---|---|---|---|---|
| "Take photo" / "Upload a photo instead" (a PDF is accepted) | slot `medical_card` | camera/file | photo **or** the tick below | `application_captures` |
| "I don't have a medical card yet" | `medical_card_pending` | checkbox | — | `application_intakes.medical_card_pending` |

### Step 9: "A photo of you" (selfie)

| Label | Key | Type | Req | Persisted |
|---|---|---|---|---|
| "Take photo" (front camera) / "Upload a photo instead" | slot `selfie` | camera/file | photo **or** the tick | `application_captures` (never promoted, kept 90 days) |
| "I can't take a photo of myself" | `selfie_skipped` | checkbox | — | **not stored at all** (`partOneScreens.ts:80-86`) |

### Step 10: "Your rights" (`partOne/PartOneRights.vue`)

The served FCRA summary is read-only. The button is **"I have read this"**, which posts
`fcra_summary_version` and stamps `fcra_summary_shown_at`. Then `/intake/complete` runs.

---

## 3L. Legacy link only: "Your driver's licence" (`IdentityFields.vue:87-127`)

| Label | Key | Type | Req | Validation | Persisted |
|---|---|---|---|---|---|
| "Date of birth" | `date_of_birth` | calendar picker `AppDateField` | yes | `requiredDateOfBirthSchema` | `POST /:token/identity` → `applicantIdentity.ts` → `drivers` + `application_drafts` |
| "Licence number" | `cdl_number` | text | yes | 1–60 (`shared/applicantIdentity.ts:32-36`) | same |
| "Issuing state" | `cdl_state` | combobox | yes | 2–10 | same |
| Photos "Front/Back of your licence" | slots | camera | no | — | `application_captures` |

---

## 4. The permissions ceremony (`signing/SigningCeremony.vue`, `signing/PacketAdoption.vue`)

### 4a. Signature adoption, done once (`PacketAdoption.vue:60-196`)

| Label | Key | Type | Req | Notes |
|---|---|---|---|---|
| "How would you like to sign?": "Choose a style" / "Draw it" / "Upload" | `style` | segmented control | yes | `strings.packet.ts:45-48` |
| "Type your full name". Hint: "Type it as it appears on your licence…" | `adoptedName`, which becomes `signed_name` | text `autocomplete=name` | yes | Disabled once pinned (DR035) |
| "Type your initials" | `adoptedInitials` | text | yes when a page needs initials | |
| Style picker / "Draw your signature" pad / upload picker; a second set for initials | slots `signature_mark`, `initials_mark` | picker/canvas/file | yes for the chosen style | `application_captures` |
| A confirm screen ("Change" / confirm), then "Use this and start" | — | buttons | — | `POST /:token/adoption` |

### 4b. Six documents, one per screen ("Document n of 6")

The PDF is rendered with a **"Sign here"** tag. If it fails to render, the text is shown with **"I agree —
sign this"** (`SigningCeremony.vue:13-68`). There are no other inputs. Each sign is `POST /:token/release`
→ rpc `record_driver_release` (`applicationReleases.ts:148`) → table `driver_authorizations`.

### 4c. Wait: "We have your permissions" (`ApplyWaitScreen.vue`)

There are no required inputs. The **optional SMS card** (`SmsOptInCard.vue:119-152`) has:
- "Phone number" (`type=tel`, US-only rule `normaliseUsPhone`)
- a consent checkbox labelled with the served intent
- a button that posts to `POST /:token/sms-consent`

On v2 the Clearinghouse instructions are shown as well (`PartOneClearinghouse.vue`).

---

## 5. Unlock: "Pick up where you left off" (`DraftUnlockGate.vue:61-83`)

| Label | Key | Type | Req | Validation | Persisted |
|---|---|---|---|---|---|
| "Your date of birth" | (request body) | **calendar picker** `AppDateField` (MM/dd/yyyy) | yes | Server compares with the stored DOB. Counts tries only on an office-sent signing link (5 → 410) | `POST /:token/unlock` (nothing written) |

---

## 6. Part 2, the application form

On a v2 link this is the task list "Your application" (`ApplyTaskHub.vue`, `taskHub.ts:102-125`). Rows:
"About you", "Where you have lived", "Your licence", "Where you have worked", "Your driving record",
"The carrier's own questions" ("n of m answered"), "Your documents" ("Optional"), then **"Before you
send"**, which reads "Cannot start yet — Finish the tasks above first." until every task passes
`validateSection`. Inside a task the buttons are "Back to your application" / "Save and continue"
(`ApplyPage.vue:426-454`). Legacy links get a linear wizard instead ("Back" / "Next" / "Check my answers").

**Persistence for all of section 6:** autosave `PUT /:token/draft` (validator `applicationDraftSaveSchema`)
→ `applicationDraft.ts:184` rpc `save_application_draft` → table `application_drafts.payload` (jsonb,
keys = contract keys, pruned at 90 days) plus `furthest_section`. Validation is the server's own
`driverApplicationObject` (`shared/applicationContract.ts:196-346`), checked per section, plus the
cross-field rules (`shared/applicationRules.ts:72-110`) and, on v2, `applicationV2FilingIssues`
(`shared/applicationFilingRules.ts:69-126`). "Send it to {carrier}" calls `POST /:token/review`
(`applicationHandoff.ts`).

### 6.1 "About you" (`ApplicantDetailsFields.vue:47-107`)

| Label | Key | Type | Req | Validation | Cond. |
|---|---|---|---|---|---|
| "First name" | `first_name` | text `autocomplete=given-name` | yes | 1–100 (`applicationContract.ts:201`) | |
| "Middle name". Hint: "Optional." | `middle_name` | text | no | ≤100 | |
| "Last name" | `last_name` | text `family-name` | yes | 1–100 | |
| "Any other names you have been known by" (paragraph, not a label), then "Add a name" | `other_names[]` | text rows **without a label** | no | each 1–120 | |
| "Email" | `email` | `type=email` | **yes** | `z.email()` (`:234`) | |
| "Date of birth" | `date_of_birth` | calendar picker | yes | `requiredDateOfBirthSchema` | **legacy only**; disabled once on file |
| "Phone" | `phone` | `type=tel` | yes | 7–40 characters (`:235`) | **legacy only** |
| Read-only "From the start of your application": Date of birth, Mobile phone, plus "Something wrong? Tell us" → "What is wrong, and what it should be" | `correction_note` | textarea ≤1000 | no | | **v2 only** (`PartOneFactsCard.vue`, `CorrectionNote.vue`) |
| "Position you are applying for" | `questionnaire.position` | text | **yes** (marked) | `shared/questionnaireContract.ts:369` | |
| "Are you applying as a company driver or as an owner-operator?": "Company driver" / "Owner-operator" | `questionnaire.applying_as` | combobox | **yes** | `:370` | |
| "How did you hear about this company?" | `questionnaire.heard_from` | text | **yes** | `:371` | |
| "Can you legally work in the USA?" | `questionnaire.legally_work` | Yes/No segmented | **yes** | `:372` | |
| "Do you have proof of age?" Hint: "Silvicom hires drivers who are 23 or older…" | `questionnaire.proof_of_age` | Yes/No | **yes** | `:373-377` | |

### 6.2 "Where you have lived" (`AddressHistoryFields.vue`, `AddressFields.vue`, `AddressDrawer.vue`)

The intro reads "Every address you have lived at in the last 3 years. Leave the end month blank for where
you live now." On v2 there is a list with "Add where you live now" / "Add another address" and a panel
per address ("Save this address" / "Cancel" / "Remove"). The current address's street is Part 1's and is
locked (`AddressDrawer.vue:46-52`).

| Label | Key | Type | Req | Validation |
|---|---|---|---|---|
| "Street address" | `addresses[i].line1` | text | yes | 1–200 (`applicationContract.ts:110`) |
| "Apartment, unit". Hint "Optional." and placeholder "Optional" | `addresses[i].line2` | text | no | ≤200 |
| "City" | `.city` | text | yes | 1–120 |
| "State" | `.state` | combobox (US and CA) | yes | 2–40 characters |
| "ZIP" | `.postal_code` | text `inputmode=numeric` | yes | 3–20 characters |
| "From". Hint "Month and year." | `.from` | month picker (MM/yyyy) | yes | `YYYY-MM` |
| "Until". Hint "Blank if you live here now." | `.to` | month picker | no | `YYYY-MM` or blank |

The coverage meter, "The last three years", lists gaps: "No address from X to Y. Add where you lived
then." A v2 filing refuses any gap ("Tell us where you lived from …"), per `applicationFilingRules.ts:106-113`.

### 6.3 "Your licence" (`LicenceFields.vue`)

- **v2:** read-only Part 1 licences (`partOneFacts.ts:82-100`) plus "Something wrong? Tell us".
- **Legacy:**

| Label | Key | Type | Req | Validation |
|---|---|---|---|---|
| "Licence number" | `cdl_number` | text | yes | 1–60 |
| "Issuing state" | `cdl_state` | combobox | yes | 2–10 |
| "Class". Hint "Optional." | `cdl_class` | **free text** maxlength 10 | no | ≤10 |
| "Expires" | `cdl_expires_at` | calendar | no (nullish) | ISO date |
| Under "Other licences and permits…": "Issuing authority" | `additional_licences[i].issuing_authority` | text | yes | 2–max |
| "Number" | `.number` | text | yes | 1–60 |
| "Expires" | `.expires_at` | calendar | yes | ISO date |
| "What it is" (placeholder "Optional") | `.kind` | text | no | ≤80 |

### 6.4 "Where you have worked" (`ApplyEmploymentFields.vue:214-367`, `components/employment/EmployerForm.vue:97-196`)

| Label | Key | Type | Req | Validation (source) | Cond. |
|---|---|---|---|---|---|
| "May we contact your previous employers?" | `questionnaire.may_contact_employers` | Yes/No | **yes** | `questionnaireContract.ts:378` | |
| "I have not been employed during this period" | `declares_no_employment` | checkbox | one of this or ≥1 employer | `applicationRules.ts:83-87` | |
| Timeline "Your jobs, newest first". Per gap over 30 days: "What were you doing then?" | `employment_gaps[{from,to,explanation}]` | textarea maxlength 500 | yes for each gap (v2) | `applicationFilingRules.ts:115-124` | shown per gap |
| **Job panel** ("Add your first job" / "Change"): "Employer". Hint "The name as you remember it is fine…" | `employers[i].employer_name` | text | yes | 1–200 (`applicationEmployerContract.ts:40`) | |
| "From" | `.started_on` | **calendar, full day** | yes | `YYYY-MM-DD` (`:53`) | |
| "Until". Hint "Blank if you work there now." | `.ended_on` | calendar | no | ≥ started_on (`:74-77`) | |
| "Position" | `.position_held` | text | no | ≤120 | |
| "Street address". Hint "We have to record where we wrote to." | `.address_line1` | text | **v2: yes** | `applicationFilingRules.ts:81-83` | |
| "City" / "State" | `.city` / `.state` | text / combobox | **v2: yes** | same | |
| "Reason for leaving". Hint "Why you moved on." | `.reason_for_leaving` | text | **v2: yes** ("Say why you left this job") | `:85-87` | |
| "Did you drive a truck in this job?" | `.operated_cmv` | Yes/No (defaults to Yes) | yes | boolean | |
| "Was this employer regulated by the DOT?" Hint "…Leave Yes if you are not sure." | `.dot_regulated` | Yes/No (defaults to Yes) | yes | boolean | |
| "In this job, did the Federal Motor Carrier Safety Regulations apply to you?" | `.subject_to_fmcsr` | Yes/No | v2 yes for a 3-year job | `:89-98` | job within 3 years, sticky once shown |
| "Was this a safety-sensitive job that required DOT drug and alcohol testing?" | `.safety_sensitive` | Yes/No | same | same | same |
| Collapsed "Phone, email and USDOT number (optional)": "Phone" / "Email" / "USDOT number" | `.phone` / `.email` / `.usdot_number` | tel / email / numeric | no | ≤40 / email / `usdotNumberSchema` | |
| "Driving experience". Hint "Optional — equipment, routes, years." | `experience` | **single-line** text, ≤4000 | either this or ≥1 equipment row | `applicationRules.ts:88-101` | |
| "Equipment you have driven", then "Add equipment": "Class of equipment" | `equipment_experience[i].equipment_class` | combobox: Straight truck, Tractor and semi-trailer, Tractor and two trailers, Tractor and tanker, Bus, Other | yes | enum (`applicationContract.ts:73-90`) | |
| "Type". Hint "Van, tank, flat, and so on." | `.equipment_type` | text | no | ≤120 | |
| "From" / "Until" | `.from` / `.to` | month picker | from yes | `YYYY-MM` | |
| "Approximate total miles" | `.approx_miles` | text `inputmode=numeric` | no | int 0–100M | |

### 6.5 "Your driving record" (`SafetyHistoryFields.vue:77-193`)

| Label | Key | Type | Req | Cond. |
|---|---|---|---|---|
| "In the last 3 years, were you involved in any motor vehicle accident?" | derived: `declares_no_accidents` / `accidents.length` | Yes/No | yes (`applicationRules.ts:73-77`) | |
| Per accident: "Date" | `accidents[i].occurred_on` | calendar | yes | Yes |
| "What happened" | `.nature` | single-line text 1–500 | yes | Yes |
| "Fatalities" / "Injuries" | `.fatalities` / `.injuries` | text `inputmode=numeric` | defaults to 0 | Yes |
| "Hazardous material was spilled" | `.hazmat_spill` | checkbox | — | Yes |
| "In the last 3 years, were you convicted of breaking a traffic law, or did you forfeit bond or collateral for one?" Hint "Parking tickets do not count." | `declares_no_violations` / `violations` | Yes/No | yes | |
| Per conviction: "Date" / "Offence" / "Where it happened" (opt) / "Penalty" (opt) | `violations[i].occurred_on` / `.offence` (1–300) / `.state` / `.penalty` | calendar / text | date and offence yes | Yes |
| "Has any licence, permit or privilege of yours to drive a motor vehicle ever been denied, revoked or suspended?" | `licence_ever_denied` | Yes/No | yes | |
| "What happened". Hint "The reason it happened." | `licence_denial_detail` | single-line text ≤1000 | yes when Yes | Yes |
| "In the last two years, I applied for a driving job I did not get, and I tested positive or refused a test…" | `prior_failed_pre_employment_test` | **checkbox** | — | legacy only (v2 asked it in Part 1) |

### 6.6 "The carrier's own questions" (`QuestionnaireFields.vue`, `QuestionnaireTable.vue`)

The intro reads "A few more questions about you. They help us place you on the right truck."
(`questionnaireContract.ts:367`). Answers go to `draft.questionnaire.*` and are filed as `questionnaire_answers`.

| Label | Key | Type | Req |
|---|---|---|---|
| "Education and training" (hint "Most recent first."), then "Add one": "School or university", "Years completed" (number), "Field of study", "Graduated" (checkbox), "When" | `education[]` | table, max 6 | **yes: at least one row** (`questionnaireContract.ts:379`) |
| "Have you ever served in the military?" | `military_service` | Yes/No | no; skip "I'd rather not say" |
| "If so, when?" | `military_when` | text | no; only after Yes |
| "Any other training that would help you in this position" | `other_training` | textarea | no; skip "Doesn't apply" |
| "Three personal references" (hint "Not relatives, and not former supervisors."): "Full name", "Years known" (number), "Phone number" (text) | `references[]` | table, max 3 | no; skip "I'd rather not say" |
| The carrier's own stamped questions (dynamic) | `carrier_answers.*` | per kind | per stamp |

### 6.7 "Your documents" (`DocumentCaptureFields.vue:69-133`), all optional

The intro reads "Send what you have now — you can bring the rest to the office."

| Item | Notes |
|---|---|
| Front/Back of your licence | Shown as "Received with your licence" |
| Medical examiner's certificate, TWIC card, Passport, Green card or work permit, Social Security card, Hazmat endorsement | |
| Road test certificate from a past job, Training certificate, Anything else | Up to 5 each |

Each has "Take photo" / "Upload a file", and photo or PDF up to 8 MB. Each goes to `POST /:token/capture`
→ `application_captures`.

### 6.8 "Before you send" / review (`ApplySection.vue:59-68`)

This shows the §391.21(d) notice (`EmployerCheckNotice`), then a read-only summary with "Fix" links. The
button is "Send it to {carrier}", which is disabled while the wording is still a draft.

---

## 7. Second visit: "Ready for your signature" (`SignOffScreen.vue`, `SignOffFields.vue`)

This screen comes after the DOB unlock gate.
1. "What the carrier changed": "You put" / "It now says".
2. The whole document, read-only.

| Label | Key | Type | Req | Validation | Persisted |
|---|---|---|---|---|---|
| "Social Security number". Hint: "Optional. It is on the application because some driving-record checks match on it…" | `ssn` (never in the draft) | text `inputmode=numeric autocomplete=off` | no | **server only**: `/^\d{9}$/` "A Social Security number is nine digits" (`shared/applicationIntake.ts:80,87`) | `POST /:token` → rpc `submit_driver_application` → `driver_applications.ssn_last4`, `ssn_sealed` (`applicationSubmit.ts:327,355-364`) |

3. The packet walk (`PacketCeremony`): each place is "Sign here" ("Place n of N") → `POST /:token/mark` →
   `application_packet_marks`. Finishing the walk sets `certified=true` and `signed_name` (`SignOffScreen.vue:104-108`).
4. "Sign and send it" → `POST /:token` → `driver_applications.payload`. The button is disabled until the
   packet is walked.

After filing, `ApplicationFiledCard` and `HandbookSigning` (handbook places, signed with the adopted mark).

---

# UI/UX defects found by reading the code

Each item is cited. **[guess]** marks an inference about impact that the code does not prove.

## A. Validation that blocks real people

1. **Foreign addresses are impossible in Part 1, and Mexico is impossible everywhere.**
   - Part 1's state list is US-only (`PartOneAnswerFields.vue:26,62`, `shared/applicantScreeningContract.ts:43-45,84-88`).
   - The ZIP is `maxlength=5` and must match `/^\d{5}$/` (`PartOneAnswerFields.vue:66`, `applicantScreeningContract.ts:127`).
   - The whole jurisdiction catalogue is only `"US" | "CA"` (`shared/jurisdictions.ts:43`, 68 entries).
   - So a driver living in Canada or Mexico cannot finish Part 1, and a Mexican address or licence cannot
     be entered anywhere.
2. **A non-US/CA licence cannot be added**, although the question explicitly asks about "another country".
   - The question is at `strings.partOne.ts:90`.
   - "State or province" is required and must be in the US/CA catalogue (`partOneScreens.ts:168`,
     `applicantScreeningContract.ts:90-94`).
   - So "Issuing authority (only if it is not a US state)" (`strings.partOne.ts:99`) can never be used
     on its own.
3. **The phone must be a US mobile number** (`applicantScreeningContract.ts:70-82`) and it is required to
   leave step 3 (`partOneScreens.ts:121-122`). A driver with a Canadian or Mexican number, or none, is
   stuck. §391.21(b) does not ask for a phone.
4. **Email is required** (`shared/applicationContract.ts:234`, `z.email()`). §391.21(b)(2) is "name,
   address, date of birth, and social security number". A driver without email cannot send the
   application.
5. **The CDL class must be A, B or C in Part 1** (`partOneScreens.ts:150`, `shared/rosterContract.ts:53`).
   There is no option for a CLP or permit holder, or for someone with no CDL yet. Part 2 legacy makes
   class optional free text (`LicenceFields.vue:74-76`). The two disagree.
6. **The CDL photos (front and back) are mandatory, with no skip** (`partOneScreens.ts:284-293`,
   `resumeScreen` `:306-308`).
   - The medical card and selfie both have an "instead" tick; the CDL does not.
   - The legacy identity step said the photos were optional (`strings.identity.ts:26`).
   - A driver whose licence is not in hand (seized, mailed for renewal) cannot start Part 1.
   - The upload path exists, but needs a picture they already have. [guess: a real trap]
7. **"Education and training" is a required table** (`questionnaireContract.ts:379`), and
   `isAnswered([])` is false (`shared/questionnaireAnswers.ts:118-123`). A driver with no schooling to
   list must invent a row to unlock "Before you send". §391.21 does not ask for it.
8. **A last name is required** (`applicationContract.ts:203`), so single-name (mononym) applicants are blocked.
   There is no suffix field (Jr./Sr./III), although names are "matched against your driving record"
   (`strings.ts:216`).
9. **The SSN is checked only on the server, at the very last act.**
   - The field has no maxlength, no format hint and no client check (`SignOffFields.vue:116-123`).
   - The server refuses anything except 9 bare digits (`shared/applicationIntake.ts:80`), so
     "123-45-6789" fails at "Sign and send it" in the office.
   - The refusal lands in the top callout (`SignOffScreen.vue:127`), not under the field.
   - Separately, §391.21(b)(2) requires the SSN, and the form marks it "Optional" (`strings.ts:235`).

## B. Silent data corruption and misleading validation

10. **Numbers with commas are silently truncated.** `num()` is `Number.parseInt` (`draft.ts:68-71`), used
    for `approx_miles`, `fatalities` and `injuries` (`draft.ts:134,140`).
    - "100,000" miles is filed as **100**.
    - "1 or 2" is filed as 1.
    - A blank fatalities box is filed as **0**, an answer the driver never gave.
11. **A partly typed date reads as "missing".** `AppMemorableDate` emits `""` until all three boxes fit,
    including a 4-digit year (`packages/ui/src/components/AppMemorableDate.vue` `compose()`). A driver who
    typed `3 / 7 / 85` is told "Enter your date of birth." (`partOneScreens.ts:114,123`), which names the
    wrong problem.
12. **"Driving experience" is labelled "Optional"** ("Optional — equipment, routes, years.",
    `strings.history.ts:34`, plus `placeholder="Optional"`, `ApplyEmploymentFields.vue:284`). But one of
    it or an equipment row is **required** (`applicationRules.ts:88-101`). It is also a single-line
    input for a field allowed 4000 characters (`applicationContract.ts:254`).
13. **The legacy §40.25(j) question is a pre-unticked checkbox**, so no tick files as "No"
    (`SafetyHistoryFields.vue:189`). That is exactly the default-answer defect this file's own header says
    it fixed for (b)(9) (`:23-34`). On v2 it is a Yes/No in Part 1, so the two link types differ.
14. **"Hazardous material was spilled" is a checkbox defaulting to false** (`SafetyHistoryFields.vue:112`,
    `applicationContract.ts:142`). No answer becomes "no spill".
15. **"Was this employer regulated by the DOT?" and "Did you drive a truck…?" default to Yes**
    (`EmployerForm.vue:86-93`, `employmentCopy.ts:47-56`). The answer is never explicitly given, yet it
    decides which jobs are owed a §391.23 inquiry.
16. **Dates have no bounds.** Nothing passes `minDate`/`maxDate` to any applicant `AppDateField`/`AppMonthField`
    (a grep finds no use under `features/apply` or `components/employment`). Accidents and convictions can
    be dated in the future or outside the 3 years, and legacy DOB uses an unbounded calendar.

## C. Answers that cannot be corrected

17. **A typo in the Part 1 date of birth can lock the driver out of their own application.**
    - The DOB is fill-only for the applicant (`shared/applicationScreens.ts:30-31`).
    - The unlock gate then asks for the DOB to read the draft back (`DraftUnlockGate.vue:42-58`).
    - On an office-sent signing link, 5 misses stop the link (`strings.flow.ts:228-232`).
    - The only recovery is the office (`CorrectionNote.vue:19-21`). [guess: a driver who typed the wrong
      year cannot recover by themselves]
18. **Part 1 facts are read-only for the rest of the application.**
    - On v2, DOB, phone, current address and all licences are shown read-only. The only remedy is the
      free-text "Something wrong? Tell us" (`PartOneFactsCard.vue`, `LicenceFields.vue:60-62`,
      `AddressDrawer.vue:99-104`).
    - Going Back in Part 1 to an already-saved screen shows **empty boxes**: "You have already given
      these. Leave them blank to keep them…" (`strings.partOne.ts:29`, `usePartOne.ts:36-40`).
    - The licence screens are fully locked: "To change this, contact {carrier}."
      (`usePartOne.ts:139-141`, `PartOneFlow.vue:151`).
19. **The selfie skip is not stored**, so a returning driver meets the selfie screen again every visit
    (`partOneScreens.ts:313-315`).

## D. Screens that can trap the applicant

20. **"Sign and send it" can fail silently.**
    - `send()` runs `accept()`, which puts issues into `wizard.setIssues` and scrolls to the top
      (`useApplicationSending.ts:77-82,106-111`).
    - `ApplyIssueList` is rendered only in the form branch (`ApplyPage.vue:389-394`), not in the sign-off
      branch (`ApplyPhaseRouter.vue:234-249`, `SignOffScreen.vue:127` shows only `error`).
    - So a document that fails its own check at signing (an office edit, or a v2 gap rule judged on a
      later `carrierToday`) shows nothing. The button simply does nothing.
21. **The expectations screen understates the work on a v2 link.**
    - It says "8 screens, about 30 minutes" and lists only the Part 2 sections
      (`ApplyExpectations.vue:61-65,79`, `applicationSections.ts:106-131`).
    - The driver then meets the consent, 10 Part 1 steps, signature adoption, 6 permission documents, a
      wait of days, an unlock, 7 tasks, another wait, then the packet walk.
22. **The first Part 1 screen is a camera prompt with no intro** (`PartOneFlow.vue:60-69` returns `null`
    for photo screens). On a computer it is a QR handoff (`PartOnePhoto.vue:152`).

## E. Spanish and hardcoded English

23. **The date boxes' sub-labels "Month" / "Day" / "Year" are English** on a Spanish page.
    - The defaults are at `AppMemorableDate.vue` `labels` and are never overridden.
    - Callers: `PartOneAnswerFields.vue:45,89`, `PartOneOtherLicences.vue:83`.
    - The calendar picker's placeholder "mm/dd/yyyy" / "mm/yyyy" and its aria-labels "Clear date" /
      "Choose a date" are English too (`packages/ui/src/components/DatePickerBase.vue:113-115,210,223`).
24. **The `placeholder="Optional"` literals are English:** `AddressFields.vue:32`, `LicenceFields.vue:104`,
    `SafetyHistoryFields.vue:147,150`, `ApplyEmploymentFields.vue:284`.
25. **"Yes"/"No" are hardcoded English** in the sign-off "What the carrier changed" list (`SignOffFields.vue:51`).
26. **Validation sentences from shared code reach Spanish users in English:**
    - Part 1 shows Zod messages verbatim (`partOneScreens.ts:113-117,136-140,153-156`): "A ZIP code is
      five digits", "Choose a US state", "Give the expiry date printed on the licence", "A driver must be
      at least 18 years old", "That is not a real date".
    - Part 2 passes every `custom` issue through unchanged (`fieldLabels.ts:290`). That covers the
      cross-field rules ("List every accident in the last 3 years, or confirm there were none",
      `applicationRules.ts:73-106`) and the v2 filing rules ("Say why you left this job", "Give this
      employer's street, city and state", "Tell us where you lived from …",
      `applicationFilingRules.ts:79-121`).
27. **The legal documents are English-only**, by ruling Q-AW11 (`strings.ts:417-418`). The page says so,
    but the consent, the permissions and the FCRA summary are not translated.

## F. Labels, wording and consistency

28. **British spelling throughout a US product.**
    - "Licence" / "licence number": `strings.partOne.ts:69`, `strings.ts:300-301`, `strings.identity.ts:22`.
    - "Expiry date": `strings.partOne.ts:71,101`.
    - "Offence": `strings.history.ts:105`.
    - "finalising": `strings.flow.ts:198`.
    - [guess: drivers read "Licence" as a typo]
29. **The same field is labelled differently in Part 1 and Part 2:**

    | Field | Part 1 | Part 2 |
    |---|---|---|
    | Phone | "Mobile phone number" | "Phone" (`strings.ts:224`) |
    | ZIP | "ZIP code" | "ZIP" (`:244`) |
    | Apartment | "Apartment, suite or unit (optional)" | "Apartment, unit" + hint "Optional." + placeholder "Optional" (`strings.ts:241`, `AddressFields.vue:31-32`) |
    | Licence expiry | "Expiry date" | "Expires" (`strings.ts:304`) |

30. **Two different screens are both titled "About you"** (Part 1 step 3, `strings.partOne.ts:37`, and the
    Part 2 task, `applicationSections.ts:68`). They ask different things.
31. **Duplicate labels on one screen:**
    - "What happened" is used for both the accident nature and the licence denial
      (`strings.history.ts:97,113`).
    - "Date" is used for both accidents and convictions (`:96,104`).
32. **The date pickers use three different granularities:** employer dates are full calendar dates
    (`EmployerForm.vue:104-108`, `applicationEmployerContract.ts:53`), while addresses and equipment are
    months (`AddressFields.vue:47-52`). Drivers rarely know the day they started a job from 2017 [guess],
    and §391.21(b)(10) does not ask for the day.
33. **The DOB uses the calendar picker in three places:** the unlock gate (`DraftUnlockGate.vue:71`), the
    legacy identity step (`IdentityFields.vue:97`) and the legacy "About you" (`ApplicantDetailsFields.vue:86`).
    Part 1 uses the "memorable date" boxes precisely because a calendar is wrong for a DOB
    (`AppMemorableDate.vue` header).
34. **Carrier-specific wording is hardcoded into the questionnaire:** "Silvicom hires drivers who are 23 or
    older" and "under contract with Silvicom" (`questionnaireContract.ts:335,376`). Silvicom is also the
    platform's name. This is wrong for any other carrier.

## G. Mobile input attributes and accessibility

35. **Licence-number inputs lack `autocapitalize="characters"` / `spellcheck="false"`**
    (`PartOneAnswerFields.vue:77`, `PartOneOtherLicences.vue:80`, `LicenceFields.vue:69,96`,
    `IdentityFields.vue:102`). Phone keyboards will auto-capitalise the first letter only and may
    autocorrect. [guess for the size of the impact]
36. **The Part 2 postal code has `inputmode="numeric"`** (`AddressFields.vue:43`), but the state list
    offers Canadian provinces. "A1A 1A1" cannot be typed on the numeric pad.
37. **The reference phone column is `kind: "text"`** (`questionnaireContract.ts:289`). `QuestionnaireTable`
    switches the keyboard only for `number` (`QuestionnaireTable.vue:75`), so there is no tel keypad. The
    employer "Phone" has `type=tel` but no autocomplete (`EmployerForm.vue:184`).
38. **The "other names" inputs have no label or `aria-label`** (`ApplicantDetailsFields.vue:68`). The
    visible paragraph (`:65`) is not associated with them.
39. **The certify checkbox `ApplyField` has no label** (`CertifyFields.vue:27-29`, legacy, still in the
    tree). The signature-mark preview images have `alt=""` even though they are the content being
    confirmed (`PacketAdoption.vue:42,231,252`).
40. **Required markers are almost absent.**
    - `ApplyField` supports `required`, but only `QuestionnaireFields.vue:156` passes it.
    - Nothing else marks required: first/last name, email, every address box, every employer box
      (including the v2-required street, city, state and reason), accident date and nature.
    - Optional fields are marked inconsistently: "Middle name" has "Optional." while "Position" and
      "Type" (equipment) have nothing.
41. **The free-text narratives are single-line inputs:** accident "What happened" (≤500,
    `SafetyHistoryFields.vue:101`), denial detail (≤1000, `:176`), "Reason for leaving"
    (`EmployerForm.vue:130`), "Driving experience" (≤4000). On a phone only one line is visible.

## H. Required beyond what §391.21 asks

42. Required in this form although §391.21(b) does not ask for them:
    - email (`applicationContract.ts:234`)
    - a US mobile phone (`partOneScreens.ts:121`)
    - a CDL class of A/B/C (`:150`)
    - donor gender, which can be declined (`:201`)
    - the CDL photos (`:306-308`)
    - the medical card, or the "pending" tick (`:290`)
    - the selfie, or the tick (`:291`)
    - 7 carrier questions, including education (`questionnaireContract.ts:369-379`)
    - every 30-day gap in employment (`applicationFilingRules.ts:115`)

    Several of these are defensible business rules, but none is labelled as the carrier's requirement
    rather than the law's.
