# C — Applicant data layer map (contract → storage → PDF → recruiter)

Checkout audited: `scratchpad/main` (origin/main). All paths below are relative to that checkout.
Read-only audit, 2026-11-09.

## 0. Orientation: there are TWO capture surfaces and TWO filed renderers

**Capture (v2 invitation, i.e. every new applicant since 0376):**
- **Part 1** ("screening", phone-first) — `applicantIntakeSchema` / `applicantIntakeLicencesSchema`
  (`packages/shared/src/applicantScreeningContract.ts:119-206`) → `POST /api/public/application/:token/intake`,
  `/intake/licences`, `/intake/complete` (`apps/api/src/modules/recruiting/routes/publicApplicationIntake.ts:50,68,89`)
  → RPC `record_applicant_intake` (latest body `supabase/migrations/0469_applicant_donor_gender.sql:41`)
  → tables `application_intakes` + `application_intake_licences` (0376:93,146) **and** fill-only onto `drivers`.
- **Part 2** (the §391.21 form, task hub) — `ApplicationDraft` (`apps/web/src/features/apply/draftShape.ts`)
  autosaved via `POST /:token/draft` → RPC `save_application_draft` → `application_drafts.payload` (jsonb, 0226);
  submitted via `POST /:token` with `applicationSubmitSchema` (`packages/shared/src/applicationIntake.ts:85`)
  → `apps/api/src/modules/recruiting/applicationSubmit.ts:309-369` → RPC `submit_driver_application` (0376:1189)
  → `driver_applications.payload` (jsonb, append-only, 0220) + `drivers` (coalesce patch) + `driver_employment_history` rows.
- At filing, Part 1 facts are LAID OVER the Part 2 payload by `composeFiledApplication`
  (`packages/shared/src/applicationComposition.ts:78-144`), then `identityOnRecord` overlays DOB / cdl_number /
  cdl_state from `drivers` (`applicationSubmit.ts:322-324`, `apps/api/src/modules/recruiting/applicantIdentity.ts:74`).

**Filed PDF (`apps/api/src/modules/recruiting/applicationPdf/file.ts:91-117`):** the MARKS decide.
- Application with `application_packet_marks` (every application since D-PKT15 — the ceremony is mandatory) →
  **the carrier's own 31-page paper packet** (`packet/assets/application-11.pdf`) with values overlaid by
  `packet/packetFieldValues.ts` + `packet/packetSigningFields.ts` + `packet/packetFieldQuestionnaire.ts`,
  plus a continuation sheet for overflow and a carrier-questions sheet (`packet/packetOverlay.ts:371-378`).
  **This is the document the owner calls "the application".**
- Legacy application with no marks → pdfkit §391.21 summary `applicationPdf/render.ts:200-394`.
- The office preview (`applicationPdf/preview.ts:183`) also renders the PACKET over the draft.

So "what prints on the PDF" in practice = the packet overlay. The summary renderer prints far more of the
contract than the packet does (see §3).

---

## 1. Canonical field list (packages/shared/src)

### 1a. `driverApplicationObject` — the certified §391.21 document (`applicationContract.ts:196-346`, `.strict()`)

| key | type / Zod | required? | line |
|---|---|---|---|
| first_name | string min1 max100 | yes | 201 |
| middle_name | string max100 nullish | no | 202 |
| last_name | string min1 max100 | yes | 203 |
| date_of_birth | `requiredDateOfBirthSchema` (rosterContract.ts:146) | yes | 211 |
| other_names | string[] (each min1 max120), default [] | no | 233 |
| email | z.email max200 | **yes** | 234 |
| phone | string min7 max40 (no format) | yes | 235 |
| addresses[] | array min1 of `applicationAddressSchema` | yes (≥1) | 237 |
| ↳ line1 / line2 / city / state / postal_code / from / to | line1 min1 max200; line2 nullish; city min1 max120; state min2 max40; postal_code min3 max20; from `YYYY-MM`; to `YYYY-MM` nullish (null=current); `.strict()` | | 109-125 |
| cdl_number | string min1 max60 | yes | 241 |
| cdl_state | string min2 max10 | yes | 242 |
| cdl_class | string max10 nullish (free text) | no | 243 |
| cdl_expires_at | `isoDateSchema` (nullish!) | **no** (nullish) | 244 |
| additional_licences[] | `applicationLicenceSchema`, default [] | no | 248 |
| ↳ issuing_authority / number / expires_at / kind | authority min2 max80; number min1 max60; expires_at YYYY-MM-DD required; kind max80 nullish | | 174-182 |
| experience | string max4000 nullish | rule: experience OR equipment | 254 |
| equipment_experience[] | `applicationEquipmentSchema`, default [] | (see rule) | 255 |
| ↳ equipment_class / equipment_type / from / to / approx_miles | enum EQUIPMENT_CLASSES (straight_truck, tractor_semi_trailer, tractor_two_trailers, tractor_tanker, bus, other); type max120 nullish; from YYYY-MM; to YYYY-MM nullish; miles int 0..1e8 nullish | | 73-106 |
| accidents[] | `applicationAccidentSchema` | yes (array) | 258 |
| ↳ occurred_on / nature / fatalities / injuries / hazmat_spill | date YYYY-MM-DD; nature min1 max500; fatalities/injuries int 0..999 default 0; hazmat bool default false | | 137-143 |
| declares_no_accidents | boolean | yes | 259 |
| violations[] | `applicationViolationSchema` | yes (array) | 260 |
| ↳ occurred_on / offence / state / penalty | date; offence min1 max300; **state max40 nullish**; **penalty max200 nullish** | | 147-152 |
| declares_no_violations | boolean | yes | 261 |
| licence_ever_denied | boolean (ONE flag for denied/revoked/suspended) | yes | 263 |
| licence_denial_detail | string max1000 nullish | rule: required when denied | 264 |
| prior_failed_pre_employment_test | boolean nullish (§40.25(j)) | no | 287 |
| employers[] | `applicationEmployerSchema` | yes (array) | 289 |
| declares_no_employment | boolean | yes | 290 |
| employment_gaps[] | `{from,to: YYYY-MM-DD, explanation trim min1 max500}` strict, default [] | v2 filing rule | 296; applicationEmployerContract.ts:92-99 |
| questionnaire_version | string max120 nullish | no | 310 |
| questionnaire_required | string[] max60 nullish (server overwrites from invitation) | no | 318 |
| questionnaire_answers | `questionnaireAnswersSchema(v3)` nullish — **non-strict z.object → strips unknown ids** | per-question `required` | 327; questionnaireAnswers.ts:60-67 |
| carrier_questions | `carrierQuestionStampSchema` nullish (server overwrites) | no | 334 |
| carrier_answers | record<string, unknown> nullish, checked by `carrierAnswerIssues` | per stamped `required` | 340 |
| certified | literal(true) | yes | 343 |
| signed_name | string min1 max200 | yes | 344 |

Employer row `applicationEmployerSchema` (`applicationEmployerContract.ts:26-77`, `.strict()`):
key uuid nullish (39) · employer_name min1 max200 (40) · usdot_number `^\d{1,8}$` nullish (41; recruitmentContract.ts:87) ·
address_line1 max200 nullish (42) · city max120 nullish (43) · state max40 nullish (44) · phone max40 nullish (45) ·
email nullish|"" (51) · position_held max120 nullish (52) · started_on YYYY-MM-DD **required** (53) · ended_on nullish (54) ·
operated_cmv bool **required** (56) · dot_regulated bool **required** (58) · reason_for_leaving max500 nullish (60) ·
subject_to_fmcsr bool nullish (66) · safety_sensitive bool nullish (71) · refine ended_on ≥ started_on.
**No postal code, no address line 2, no fax, no contact person.**

Cross-field rules (`applicationRules.ts`, applied at `applicationContract.ts:394-405`): accidents listed or
declares_no_accidents; violations listed or declares_no; employers listed or declares_no_employment; experience
or equipment; denial detail when denied; each v3 `required` questionnaire question (v3 list:
questionnaireContract.ts:364-391).

v2 filing rules (`applicationFilingRules.ts:69-126`, run on the composed doc at `applicationSubmit.ts:316`):
every employer needs key, street+city+state, reason_for_leaving; every (b)(10)-window employer needs
subject_to_fmcsr and safety_sensitive; address history must cover 3 years; every employment gap >30 days needs
an explanation. **None of these are Zod-required** — they live only in the v2 filing path.

Variants: `applicationDraftPayloadSchema` = partial + `questionnaire`, `correction_note` (applicationContract.ts:376-385);
`applicationBeforeCertificationSchema` widens certified/signed_name (421-438).
`applicationSubmitSchema` = `{application, ssn: /^\d{9}$/ nullish}` (applicationIntake.ts:80,85-88) — **SSN optional**.
`applicantIdentitySchema` = `{date_of_birth, cdl_number trim min1 max60, cdl_state trim min2 max10}` non-strict
(applicantIdentity.ts:32-36), used by `POST /:token/identity` and the office's `/applications/:id/identity`.

### 1b. Part 1 — `applicantIntakeSchema` (`applicantScreeningContract.ts:119-156`, `.strict()`, every key optional per screen)

| key | Zod | note |
|---|---|---|
| date_of_birth | requiredDateOfBirthSchema optional | written to `drivers.date_of_birth` (0469:211) |
| phone | `usMobilePhoneSchema` → E.164 `+1[2-9]\d{9}` | US mobile only (70-82) |
| address_line1 / address_line2 / city | min1 max200 / max200 nullable / min1 max120 | |
| state | US jurisdiction code, uppercased | US only (84-88) |
| postal_code | `^\d{5}$` | 5-digit ZIP only |
| cdl_class | enum CDL_CLASSES = A,B,C (rosterContract.ts:172) | |
| prior_positive_2y | boolean | = contract `prior_failed_pre_employment_test` |
| dot_program_30d / dot_tested_6m / dot_random_12m | boolean | §382.301(b) leads |
| medical_card_pending | boolean | |
| donor_gender | enum male/female/declined | never shown to hirer (106-116) |
| endorsements | enum[] H,N,X,T,P,S (rosterContract.ts:176) | declaration only |
| fcra_summary_version | string min1 max80 | |

Licences (`applicantIntakeLicenceSchema`, 163-178): state_code (any jurisdiction code) · agency min1 max80 nullish ·
licence_number min1 **max40** · expires_on required date. List min1 max10, position 0 = current CDL, no duplicates.
**No class/kind/type per licence** (only the CDL's class, on the intake call).

Office correction `partOneCorrectionSchema` (226-240): phone, address×5, cdl_class, licences — all required.

### 1c. Carrier-configurable

- Built-in questionnaire `SILVICOM_DRIVER_V3` (`questionnaireContract.ts:364-391`), served by
  `questionnaireForApplicant()` (406): position* (text, screen identity), applying_as* (select company_driver /
  owner_operator), heard_from*, legally_work* (bool), proof_of_age* (bool), may_contact_employers* (bool, screen
  employment), education* (table: school, years_completed, field_of_study, graduated, graduated_when; max 6),
  military_service (bool, skip "I'd rather not say"), military_when (text, askedWhen military=yes), other_training
  (longtext, skip "Doesn't apply"), references (table: full_name, years_known, phone; max 3, skip). * = required in v3.
  Reserved never-rendered key `eeo` (164).
- Per-carrier override of which built-ins are required: `recruitingSettingsSchema.required_questions`
  (`recruitingSettingsContract.ts:63`; `applicationFormSettings.ts:95`), stamped on the invitation as
  `application_invitations.required_questions` (0550:71) → `questionnaire_required`.
- Document slots offered: `offered_document_slots` (recruitingSettingsContract.ts:64; applicationFormSettings.ts:143).
- Carrier-written questions: `carrierQuestionCreateSchema` (`carrierQuestionsContract.ts:74-93`; kinds text,
  longtext, boolean, select, date, number — no table; wording ≤300, hint ≤300, 2-20 choices ≤80, ≤20 live),
  table `recruiting_carrier_questions` (0567), stamped on `application_invitations.carrier_questions` jsonb (0567:143)
  at the first Send, answered into `carrier_answers`.
- Hidden hiring steps `hidden_hiring_steps` (recruitingSettingsContract.ts:59) — not applicant fields.

### 1d. Sections / screens (form structure, not data)
`APPLICATION_SECTION_KEYS` (applicationSections.ts:174-211): identity, addresses, licence, employment, safety, questions,
documents, review, certify. `PART_ONE_SCREENS` (applicationScreens.ts:35-46): cdl_front, cdl_back, about, address,
licence, otherLicences, screening, medical_card, selfie, rights.

---

## 2. Persistence per field

| field(s) | where it lands | write path |
|---|---|---|
| everything in 1a while typing | `application_drafts.payload` jsonb (+ `furthest_section`, `revision` 0376:1488) — prunable | `toDraftPayload` (web draft.ts:240-300) → `POST /:token/draft` → `save_application_draft` (applicationDraft.ts:184); identity overlay applied first (applicationDraft.ts:175-179) |
| everything in 1a at submit (composed) | `driver_applications.payload` jsonb (0220), `signed_name`, `certified_at` (server clock), `applicant_ip`, `applicant_user_agent` | `submit_driver_application` (applicationSubmit.ts:355-369; 0376:1189) |
| ssn | `driver_applications.ssn_last4` (`^[0-9]{4}$`) + `ssn_sealed` (secretBox; **null if secret box unconfigured**) | `sealSsn` applicantIntake.ts:332-338. Never in drafts (applicationIntake.ts:163-166 refuses) |
| first_name, last_name, date_of_birth, cdl_number, cdl_state, other_names | also `drivers.*` — **coalesce (fill-only)** | 0376:1250-1262 (`planApplicationIntake`, applicationIntake.ts:381-396) |
| employers[] | also `driver_employment_history` (employer_name, usdot_number, employer_address_line1 [0222], employer_city, employer_state, employer_phone, employer_email, position_held, started_on, ended_on, dot_regulated, operated_cmv [0214], subject_to_fmcsr, safety_sensitive, reason_for_leaving, inquiry_status, source='application') | 0376:1269-1290; key renames via `employmentRow` applicationIntake.ts:347-367 |
| Part 1 phone / address×5 / prior_positive_2y / dot_* / fcra_summary_version(+shown_at) / medical_card_pending / endorsements / donor_gender (0469:32) | `application_intakes` (0376:93-130) | `record_applicant_intake` (applicantIntake.ts:145; 0469:41) |
| Part 1 licences | `application_intake_licences` (position, state_code `^[A-Z]{2}$`, agency, licence_number ≤40, **expires_on nullable in DB**, source) | same RPC |
| Part 1 phone/address/cdl_class/cdl_expires_at | also `drivers.*` — fill-only unless office `p_overwrite` (0469:180-196) | same RPC |
| Part 1 DOB | `drivers.date_of_birth` (0469:211) | same RPC |
| cdl_class (v2) | **`drivers.cdl_class` only** (not on the intake row); read back for filing (applicationComposition.ts:34-40) | |
| identity step (DOB, cdl_number, cdl_state) | `drivers` via `record_applicant_identity` (0365) | `POST /:token/identity` |
| office invite (first, last, email, mobile) | `drivers` row status='applicant' (`POST /api/roster/drivers`, web useCreateApplicant.ts) + `application_invitations.email` (0220) | InviteApplicantDrawer.vue:204-222 |
| questionnaire_answers / carrier_answers | only inside `driver_applications.payload` — projected nowhere (D-APP12) | |
| `correction_note` | draft only, never filed | |

No separate `applicant*` / `application_addresses` / `application_employers` tables exist; the §391.21 answers
other than employers live ONLY in jsonb (`application_drafts.payload`, `driver_applications.payload`).

---

## 3. Filed PDF — what prints and from where

### 3a. Carrier packet (current filings) — `packetFieldValues.ts` / `packetSigningFields.ts` / `packetFieldQuestionnaire.ts`

| packet place | prints | source key |
|---|---|---|
| p1 Date | certified date | `certifiedAt` (packetFieldValues.ts:91) |
| p1 DOB | | `date_of_birth` (92) |
| p1 Position | | questionnaire `position` (93) |
| **p1 Social Security number** | **never drawn** (D-HIRE6) | — (94-95) |
| p1 Cdl # | "number (state)" | cdl_number, cdl_state (96) |
| p1 Phone # | | phone (97) — on v2 = Part 1 phone |
| p1 legally work / proof of age / contact employers / heard from | | questionnaire legally_work, proof_of_age, may_contact_employers, heard_from (98-101) |
| p1 Name Last/First/Middle | | last/first/middle_name (103-113) |
| p1 Address + 3 "Previous Three years residency" rows | Street(+line2)/City/State/Zip — **no from/to dates** | addresses[0..3] (115-140); 5th+ → continuation |
| p2 licence grid STATE / LICENSE NO. / TYPE / EXPIRATION (1 printed row) | primary + extras | cdl_state, cdl_number, cdl_class, cdl_expires_at; additional_licences issuing_authority, number, **kind**, expires_at (146-165) |
| p2 DRIVING EXPERIENCE (4 printed class rows) | type, from, to, miles | equipment_experience; tractor_tanker & bus fold into OTHER (167-218; packetDraw.ts:113-120) |
| p2 ACCIDENT RECORD (3 rows) | date, nature, fatalities, injuries, chemical spill | accidents[] (220-236) |
| p2 TRAFFIC CONVICTIONS (3 rows) | date, violation, state, penalty | violations[] (238-253) |
| p2 A denied? / B suspended or revoked? + explain | **same answer marked on both A and B**; detail under A only | licence_ever_denied, licence_denial_detail (255-265) |
| p3, p4, p10, p26, p28, p31 printed name lines | full name | first/middle/last (packetSigningFields.ts:47-57) |
| p4 Social Security Number | **blank** | — |
| p11 (Employment record heading + 2 signature dates) | **no employer grid exists on the paper**; only dates | marks |
| p12 identity row Last/First/Aliases/DOB/**SS #** | SS # always "" | last_name, first_name, other_names, date_of_birth (packetFieldValues.ts:268-278) |
| p12 10-yr log Date from/to / Company / Address / Position / Phone | | employers[] started_on, ended_on, employer_name, address_line1+city+state, position_held, phone (279-295) |
| p14 previous-employer inquiry (Sent to, Fax/email, hire/termination, etc.) | **nothing** ("Sent to" deliberately blank, Q-PKT11) | — |
| p15 date / Name / DOB / **SSN** / Sent to | name, DOB; SSN blank; date only if p15 not withdrawn | (298-313) |
| p16 Education / military / when / training (3 lines) / references | | questionnaire education, military_service, military_when, other_training, references (packetFieldQuestionnaire.ts) |
| p18 & p19 single-licence block (name, address, city, state, zip, CDL, state, exp) | | addresses[0], cdl_* (packetSigningFields.ts:126-141; geometry SINGLE_LICENCE_BLOCK_PAGES=[18,19]) |
| **p21 Seven-day statement block (Driver name, Address, City/State/Zip, CDL/State/Exp, 7 dates, hours)** | **not filled** (no geometry) | — |
| **p23 annual-review block (Driver name, CDL/State/Exp, Social Security number)** | not filled (carrier's page) | — |
| p22 reason "contracting" | "yes" for owner-operators | questionnaire applying_as (packetSigningFields.ts:92-94) |
| p26 §40.25(j) YES/NO | X | prior_failed_pre_employment_test (packetSigningFields.ts:154-158) |
| date beside each signature | mark's signed_at | `application_packet_marks` |
| carrier-questions sheet (appended) | wording + answer | carrier_questions, carrier_answers (packetOverlay.ts:376-378) |
| continuation sheet | overflow rows of any grid | |

### 3b. Legacy summary (`render.ts`) prints in addition: carrier name + `organizations.legal_address` (b)(1) (223-228),
email (240), address from/to months (253-258), date submitted (262-265), experience narrative + equipment (275-298),
every employer field incl. USDOT, CMV, DOT-regulated, reason for leaving, FMCSR, drug-testing (178-198),
employment gaps (333-335), certification text + signature + IP (339-361), consent + one page per authorization,
questionnaire section, certificate. It does NOT print SSN, prior_failed_pre_employment_test, or Part 1 extras.

### 3c. Collected but NEVER printed on the filed packet (current filings)
- `email` (applicant's)
- address-history `from`/`to` months (3-year coverage not visible on paper)
- `experience` narrative (b)(6) first half
- employer `reason_for_leaving` (§391.21(b)(10) — required by the v2 filing rule, yet not on the filed packet)
- employer `subject_to_fmcsr`, `safety_sensitive` (§391.21(b)(10)(iv)(A)/(B))
- employer `operated_cmv`, `dot_regulated`, `usdot_number`, `email`
- `employment_gaps` explanations
- `middle_name` on p12 identity row; `other_names` only on p12
- `questionnaire` `applying_as` (used only to choose pages), `education.graduated_when` prints; fine
- Part 1: `endorsements`, `dot_program_30d/dot_tested_6m/dot_random_12m`, `medical_card_pending`, `donor_gender` (last two by design)
- expired licences from Part 1 (composition drops `expires_on < asOf`, applicationComposition.ts:130)
- `ssn` (deliberate, D-HIRE6) — prints blank in 5 places (p1, p4, p12 SS #, p15, p23)

### 3d. Printed on the packet but never collected by the form (prints blank or derived)
- SSN boxes (collected optionally, never drawn — owner will see blanks)
- p2 licence TYPE for every licence other than the CDL on v2: Part 1 has no per-licence type, composition sets `kind: null` (applicationComposition.ts:135) → **always blank**
- p14 previous-employer inquiry fields (Sent to, Fax/email, hire date, job title, termination, etc.) — not applicant data, but never filled from employers[] either
- p21 seven-day work statement (name/address/CDL block + 7 days' hours + last relieved date/time) — no contract field (a `sevenDayStatement.ts` exists in shared but is not wired to the packet)
- p2 "B. suspended or revoked" distinct answer — not collected (one boolean drives A and B)
- p1/p2 equipment class rows: `tractor_tanker` / `bus` have no printed row → OTHER
- Employer zip (p14/§391.23(c)(2) address) — not collected
- p17 interview notes / application results; p22 witness/company — office/carrier fields

---

## 4. Recruiter-side invite / add forms vs applicant form

| office form | collects | how it reaches the applicant |
|---|---|---|
| `InviteApplicantDrawer.vue` | first name, last name (248-252), email optional (257-260), mobile optional + "asked to be texted" (265-273), link days (278-286) | creates `drivers` (status applicant, first/last/email/phone) via `POST /api/roster/drivers` (useCreateApplicant.ts), then invitation (`application_invitations.email`, text_invite.phone) |
| `AddLeadDrawer.vue` | channel, full_name (single field), phone, email, opening, note (74-92) | lead; `LeadConvertForm.vue` puts name/phone/email on the board as a new applicant |
| `SendApplicationPanel.vue` | no fields — `POST /applications/:id/send-application` with `{}` (useSendApplication.ts:35) | stamps required_questions / carrier_questions |

**Pre-fill into the applicant form: NONE of the office's values.** The draft starts from `emptyDraft()`
(draftShape.ts:198-218). The only server overlay is `identityOnRecord` = DOB, cdl_number, cdl_state from `drivers`
(applicantIdentity.ts:74-86; applicantIdentity keys applicantIdentity.ts:21) — not first/last name, email or phone.
Part 1 pre-fills only from the scanned licence (`PREFILL_FIELDS` partOneScreens.ts:322-326: DOB, address, CDL).
So the applicant RE-TYPES name and email in Part 2 identity (ApplicantDetailsFields.vue:52-80) and phone in Part 1
(PartOneAnswerFields.vue:40). Consequences:
- names: `drivers.first_name/last_name` are fill-only (0376:1251-1252) — the office's spelling stays on the roster, the applicant's spelling goes on the filed PDF. Divergence is silent.
- phone: `drivers.phone` keeps the office's mobile (coalesce, 0469:181) while the PDF prints the applicant's Part 1 phone (composition, applicationComposition.ts:87). 0469:183 records a conflict list but only for the office overwrite path.
- email: the invitation email and the application `email` are independent; nothing compares them.

---

## 5. 49 CFR §391.21(b) checklist

Legend: C = collected (key), S = stored, R = shown to recruiter (review summary `apps/web/src/features/apply/reviewSummary.ts`, used by ApplicationReviewDrawer / ApplicantRecordPage; employment rows via employmentRecord.ts), P = printed on the filed packet.

| element | C | S | R | P | verdict |
|---|---|---|---|---|---|
| (b)(1) carrier name & address | n/a (server) | `organizations.name/legal_address` | — | letterhead hard-printed in the template asset (SILVICOM INC, 1301 Armitage) | Present on packet (static, not per-org) |
| (b)(2) name | first/middle/last_name | payload + drivers (fill-only) | yes | p1, p12, many name lines | Present |
| (b)(2) address | addresses[0] / Part 1 address | payload; application_intakes; drivers | yes | p1, p18, p19 | Present |
| (b)(2) DOB | date_of_birth | payload; drivers | yes | p1, p12, p15 | Present |
| (b)(2) SSN | `ssn` at sign-off, **optional** (applicationIntake.ts:87; hint "Optional", strings.ts:234-235) | ssn_last4 + ssn_sealed (sealed null if box unconfigured) | not in summary | **never printed** (5 blank SSN boxes) | **Partial** — optional, unprinted |
| (b)(3) addresses for 3 yrs | addresses[] with from/to months; filing rule covers 3 yrs (applicationFilingRules.ts:106-113) | payload only | yes | p1 4 rows, **no dates**; extra → continuation | Partial (dates not on paper) |
| (b)(4) date of application | server `certified_at` | driver_applications.certified_at | yes | p1 Date | Present |
| (b)(5) each licence: authority/state, number, expiry | CDL: cdl_state/number/expires_at; others: Part 1 licences | intake_licences; payload | yes (partOneFacts licenceRows) | p2 grid | Present |
| (b)(5) licence type | CDL: cdl_class (A/B/C on Part 1); others: **not asked on v2** | drivers.cdl_class; none for others | CDL only | TYPE blank for others | **Partial** |
| (b)(5) contract `cdl_expires_at` | Part 1 requires expiry | | | | contract itself nullish (applicationContract.ts:244) — Partial at Zod |
| (b)(6) nature & extent | experience (text) | payload | yes | **not printed** | Partial |
| (b)(6) equipment type | equipment_experience | payload | yes | p2 grid (tanker/bus → OTHER) | Present |
| (b)(7) accidents 3 yrs: date, nature, fatalities, injuries | accidents[] + declares_no_accidents | payload | yes | p2 (3 rows + continuation) | Present (+hazmat spill) |
| (b)(8) convictions/forfeitures 3 yrs: location, date, charge, penalty | violations[]: occurred_on, offence, **state nullish**, **penalty nullish** | payload | yes | p2 | **Partial** — location only as state, optional; penalty optional; "forfeitures" not asked separately |
| (b)(9) denial/suspension/revocation + statement | licence_ever_denied (one flag) + detail (rule-required) | payload | yes | p2 A and B both marked from one flag | **Partial** — B (suspended/revoked) not separately answered; packet can assert "denied: Yes" for a suspension |
| (b)(10) employers 3 yrs: name, address | employers[] name, address_line1/city/state (no zip) | payload + driver_employment_history | yes | p12 log | Present (no zip) |
| (b)(10) dates | started_on / ended_on | both | yes | p12 | Present |
| (b)(10) reason for leaving | reason_for_leaving (v2 filing rule; Zod nullish) | both | yes | **not printed** | **Partial** |
| (b)(10)(iv)(A) subject to FMCSRs | subject_to_fmcsr (v2 filing rule for b10 window) | both | yes | **not printed** | **Partial** |
| (b)(10)(iv)(B) DOT drug/alcohol safety-sensitive | safety_sensitive (same) | both | yes | **not printed** | **Partial** |
| (b)(11) 7 further yrs CMV employers | same list, `operated_cmv` sorts (applicationEmployerContract.ts:117-133) | both | yes | p12 log (no CMV flag shown) | Present |
| employment gaps | employment_gaps (v2 filing rule >30 days) | payload | yes | **not printed** | Partial |
| (b)(12) certification & signature | certified, signed_name + packet marks | driver_applications; application_packet_marks | yes | p11b/p13/p17 signatures; certification sentence is on the paper | Present |
| §40.25(j) prior pre-employment test | Part 1 prior_positive_2y → prior_failed_pre_employment_test | intake + payload | yes | p26 | Present |
| previous-employer inquiry consent (§391.23) | packet p15 release (now a separate permission) | authorizations | | p15 name/DOB only | Present (outside 391.21) |

(Note: the task's "§391.21(b)(11) and (12)" — (b)(11) is the 10-yr CMV employment and (b)(12) the certification; both covered above.)

---

## 6. Mismatches between layers

### Key names differ
1. Part 1 `prior_positive_2y` ↔ contract `prior_failed_pre_employment_test` ↔ packet `p26.prior_test` (applicantScreeningContract.ts:131; applicationContract.ts:287; composition 141).
2. Part 1 licence `state_code / agency / licence_number / expires_on` ↔ contract `cdl_state / cdl_number / cdl_expires_at` (primary) and `issuing_authority / number / expires_at / kind` (others) (applicationComposition.ts:107-137).
3. Contract employer `address_line1 / city / state / phone / email` ↔ `driver_employment_history.employer_address_line1 / employer_city / employer_state / employer_phone / employer_email` (applicationIntake.ts:347-367; recruitmentContract.ts:58-62).
4. Draft `questionnaire` ↔ filed `questionnaire_answers` (applicationContract.ts:356-365).
5. Packet reads references with fallbacks `r.full_name ?? r.name`, `r.phone ?? r.phone_number` (packetFieldQuestionnaire.ts page16) — the definition's column ids are `full_name`, `phone`; the fallbacks imply an older/other shape.
6. Packet row "DATES" for accidents vs contract `occurred_on` single date; "DATE CONVICTED" vs `occurred_on` (violation date, not conviction date — semantically different).

### Enum / vocabulary mismatches
7. `cdl_class`: Part 1 enum A/B/C (applicantScreeningContract.ts:129) vs Part 2/contract free text max10 (applicationContract.ts:243) vs office correction enum (234). Legacy flow can file "CDL-A", "Class A" etc.
8. `cdl_state`: contract min2 max10 free; Part 1 any jurisdiction code (incl. CA/MX provinces); intake table `^[A-Z]{2}$`; identity schema trim min2 max10.
9. Address `state`: contract min2 max40 free; Part 1 US-only code. `postal_code`: contract min3 max20 vs Part 1 `^\d{5}$` (no ZIP+4, no Canadian).
10. `phone`: contract any 7-40 chars vs Part 1 US-mobile E.164; packet prints whatever survived composition.
11. Licence number: contract max60 (cdl_number, additional) vs intake max40 (INTAKE_LICENCE_NUMBER_MAX_LENGTH) vs DB check ≤40.
12. Equipment: 6 contract classes vs 4 printed rows; `tractor_tanker` and `bus` print as OTHER with type text (packetDraw.ts:113-120). Applicant's form shows 6 choices; paper shows 4.
13. Licence denial: contract 1 boolean vs packet 2 questions (packetFieldValues.ts:255-261) vs FMCSA asks both.
14. Endorsements: Part 1 H/N/X/T/P/S declared, stored on intake, never shown to recruiter and never printed (no reader outside PartOneCorrection comment).
15. `expires_on`: required by Zod (applicantScreeningContract.ts:176) but nullable in DB (0376:156) — legacy_draft rows can be null; composition then raises a filing issue.

### Contract defines it, no UI renders it (v2 flow)
16. `cdl_number / cdl_state / cdl_class / cdl_expires_at / additional_licences` inputs exist in LicenceFields.vue only on the LEGACY path (`v-if="partOne"` shows a read-only card, LicenceFields.vue:60). Fine by design, but `additional_licences.kind` has no v2 source at all.
17. `phone` / `date_of_birth` in Part 2 only on legacy (ApplicantDetailsFields.vue:78-93).
18. `prior_failed_pre_employment_test` hidden in Part 2 on v2 (`askPriorTest`, SafetyHistoryFields.vue:186).
19. Employer `usdot_number` and `email` are rendered (EmployerForm.vue:183-191, behind a disclosure) but NOT shown in the review summary the office reads (reviewSummary.ts:186-203) and not printed on the packet — only visible in the employment-history record (employmentRecord.ts).
20. reviewSummary.ts:199 comment says FMCSR/safety-sensitive are "now printed on the PDF" — true only for the legacy summary renderer, not the packet that every current application files.

### Silently lost / stripped
21. `questionnaire_answers` uses a NON-strict `z.object(...).partial()` (questionnaireAnswers.ts:64-67): any answer key not in the v3 definition is **stripped** on submit (Zod default), contrary to the comment's "the extra key is displayed beside nothing". Low impact today (v3 ⊇ v1/v2), but any client-side key drift loses data silently.
22. `applicantIdentitySchema` (non-strict) strips unknown keys; `applicationSubmitSchema` (non-strict) strips anything beside `application` / `ssn`.
23. The regulated contract is `.strict()` — unknown keys are REFUSED, not stripped (no silent loss there).
24. Part 2 values that Part 1 overrides at filing (phone, current street, CDL, class, other licences, §40.25(j)) — a legacy-draft applicant's typed values are replaced without notice (composition, by design D-AW3).
25. Expired other licences recorded in Part 1 are dropped from the filed document (applicationComposition.ts:130) — (b)(5) asks unexpired, but the owner's "what we have" may list them.
26. Office's invite name/email/phone never pre-fill and are never reconciled with the applicant's retyped values (§4).
27. `employment_gaps` with empty explanations are filtered client-side (draft.ts:158-160) — by design.
