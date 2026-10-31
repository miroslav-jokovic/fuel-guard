# Hiring workflow audit — 2026-10-31

**Asked by the owner, 2026-10-31.** In his words: the software dictates the workflow and blocks steps
that should be free; the step drawers have visual and logic bugs (the road test "completely
broken", warnings written for developers); previous employment is confusing and hard to edit,
especially by a recruiter on the phone; applicants skip questions ("2/3 empty" on the first real
test); only the CDL is offered for upload; nothing suggests employment history from PSP / MVR /
Clearinghouse; training and orientation are missing.

Read-only audit of `main` `e07046d` plus production (`supabase db query --linked`, read-only,
counts and field NAMES only — no applicant values were read out). Every finding below carries the
call site it was measured at. §5 is the build queue; §6 the questions only the owner can answer.

**This plan REPLACES, if the owner accepts §6's recommendations:** D-HB5 (handbook blocks the hire),
the travel refusal (`TRAVEL_REFUSES_WITHOUT`), and the AI005 / AI006 / DR032 / DR036 / HB022 / HB023
ordering refusals. Each is named again where it is replaced.

---

## 0. The answer in one page

1. **One rule replaces every ordering rule: _the checklist advises, the law refuses._** Of the ~12
   hard refusals the hire walks through today, **three are law** (the federal checks before the
   person drives; signed consent before the MVR and before the PSP). The other nine are the
   order someone once expected things to happen in. They become warnings with the reason, and the
   step's button works.
2. **The road test is not broken in its plumbing — it is broken in its refusals.** The client,
   contract and API agree. What the office meets is a pass refused for a missing licence number
   it was never warned about, a "Record another" button that can only ever 409, an examiner error
   pointing at a screen that does not exist, raw validator text in toasts, and trucks in the shop
   missing from the list. Ten concrete fixes, no schema.
3. **"2/3 empty" is measured, and it has two causes.** The real applicant of 10/21 reached the
   review step with **2 of 11 carrier questions answered** and **an employer row that is entirely
   blank** (no name, no dates, no address — only the default yes/no flags). Every carrier question
   is optional by design (`questionnaireContract.ts:116` "THERE IS NO `required` FLAG"), the task
   is labelled *Optional* in the hub, and an untouched optional task counts as passed.
4. **Previous employment lives in three stores and four forms.** The office cannot fill an empty
   field, delete a row, or record a gap before filing; after filing it can edit rows, but gaps have
   no home at all. The fix is **one timeline editor**, the same component for applicant and office,
   writing to the draft until the applicant signs and to the office record after.
5. **Employment suggestions from PSP are 70% built and switched off.** `crossMatchEmployment()`
   (`packages/shared/src/psp/employment.ts:114`) already returns *carriers the driver was inspected
   or crashed with that are not on the application* — with DOT number, carrier name and first/last
   seen dates. Nothing calls it. MVR and Clearinghouse carry no employer data at all.
6. **Documents: the storage exists, the offer does not.** Medical card and SSN card slots exist
   (production holds one of each); TWIC, passport, work authorisation and "other" do not; the
   documents task is labelled optional and re-asks for the CDL already taken; **the office cannot
   upload anything to an applicant**.
7. **Training and orientation are two checklist rows with nothing behind them**
   (`hiringStepDrawers.ts:145-146` → `"unbuilt"`). The plans exist (`DRIVER-TRAINING-PLAN.md`,
   `ORIENTATION-PLAN.md`); none of it is built. §4.7 proposes a small first version: a video list
   sent by text before travel, and an in-office orientation checklist signed by the instructor.

---

## 1. What production says (measured 2026-10-31)

| Table | Rows |
|---|---|
| `application_invitations` | 5 |
| `application_drafts` | 4 (one test org from 08-22, two empty 10-01 starts, **one real applicant 10-21**) |
| `application_intakes` | 4 |
| `application_captures` | 10 — selfie 2, cdl_front 3, cdl_back 3, medical_card 1, ssn_card 1 |
| `driver_applications` (filed) | **0** |
| `application_edits` (office corrections) | **0** |

The real applicant's draft (`bc17a450…`, furthest section `review`):

- **Carrier questionnaire: 2 keys present** — `position`, `heard_from`. Nine of eleven unanswered.
- **Employers: 2 rows.** Row 1 has **13 of 16 fields empty** — `employer_name`, `started_on`,
  `ended_on`, address, phone, reason, position, DOT number, both §391.21(b)(10)(iv) answers; only
  `key`, `dot_regulated` and `operated_cmv` (the defaults) are set. Row 2 is complete except phone,
  email, position, DOT number.
- **One explained gap** — so the gap mechanism worked for the applicant.
- `application_edits` is 0: the office has never used the correction list, which matches §3.4.

A row with no employer name and no start date fails `applicationEmployerContract.ts:25-76` — so it
would have been refused at SEND. It reached `review` because the draft accepts anything and the
drawer saves a row on open (§3.4 A3). The applicant would have met that refusal at the very end,
on a phone, with no idea which row it meant.

---

## 2. Gating — the software dictating the order

### 2.1 What is gated today

The checklist has 19 steps (`packages/shared/src/hiringSteps.ts:38-302`). A `requires` edge only
paints a row "Blocked · Needs X" (`hiringChecklist.ts:365-376`) and the drawer still works — **except
where one of these refuses**:

| # | Refusal | Where | What it requires | Law or preference |
|---|---|---|---|---|
| G1 | Hire | `hireApplicant.ts:94-104` | MVR, Clearinghouse, drug test, application filled, medical, road test **+ handbook** | **Six are law** (§391.51, §382.301(a), §382.701(a), §391.21, §391.41, §391.31/.33) — before the person **drives**. Handbook is D-HB5, preference. |
| G2 | Travel booking | `applicantTravel.ts:104-111`, **form hidden** `TravelPanel.vue:61` | all ten `beforeTravel` steps incl. PSP | **Preference.** No rule covers a plane ticket; PSP is voluntary. |
| G3 | Send the application | `applicationSend.ts:105-109`, SQL AI005 `0365:229` | every permission signed | **Preference** — the code says so itself, `hiringSteps.ts:116-118`. |
| G4 | Open signing | `applicationSendForSigning.ts:56-59`, SQL AI006 `0369:191`, **button hidden** `SendForSigningPanel.vue:141` | office approved | Preference. |
| G5 | Packet marks | `applicationPacketMarks.ts:285,287`, SQL DR032/DR036 | approved + signing opened | Preference. |
| G6 | Handbook | `handbookSigning.ts:161`, SQL HB022/HB023 (latest `0385:78,83`), **hidden** `HandbookPanel.vue:92` | packet filed | Preference. |
| G7 | Permissions before Part 1 | `applicationReleases.ts:115`, `signatureAdoption.ts:119` | Part 1 complete | Preference. |
| G8 | Record an MVR | `hiringEvidence.ts:104-124` | `mvr` + `fcra_disclosure` signed | **Law** (FCRA §604(b)(2)). ⚠ Also stops uploading an MVR the office got another way — still law, but the error must say "upload a signed paper consent" (`PaperAuthorizationForm` exists). |
| G9 | Order PSP | `pspOrder.ts:201-208` | `psp` + `fcra_disclosure` | **Law** (49 USC 31150 + FCRA). |

Two copy defects ride with these:

- `ApplicantRecordPage.vue:135` tells the office *"Steps are blocked only by law or by a rule the
  database enforces."* G2, G3–G7 and the handbook half of G1 are neither. The page is wrong
  about itself.
- The hire button is always live (`RecruitmentPage.vue:407`, `HireDrawer.vue:115`); the six-gate
  refusal arrives only **after** pressing Hire.

### 2.2 What it should be

**One rule:** a step's button always works. If a predecessor is open, the drawer says so in one
plain sentence ("The drug test result isn't in yet — most carriers wait for it before the road
test") and the office can carry on. Only G1's six federal checks, G8 and G9 stay as refusals, and
each shows **before** the press, as a list of what is missing with a link to each.

This is removing rules, not adding them: G2–G7 become `warns` entries beside
`APPLICATION_SEND_WARNS_ON` / `OPEN_SIGNING_WARNS_ON` (`hiringSteps.ts:357,371`), which already
exist and already render as a caution callout. The SQL refusals need one migration that redefines
the functions without the check — relaxing a check is safe in the deploy window (old code meeting
new schema still works; new code never depends on the refusal).

⚠ Two of G5/G6 are **not** purely order. A packet cannot be marked before the office has filled
its own half (approval writes the carrier's answers into it), and the handbook's countersignature
cannot precede the driver's. Those are "nothing to sign yet" states and keep their explanation,
reworded as what to do, not as a refusal.

---

## 3. Findings by area

### 3.1 Road test (`RoadTestPanel.vue`, `useRoadTest.ts`, `api/.../roadTest.ts`)

The chain was traced end to end: endpoint, field names, enums and the pass rule all agree; the
`["compliance"]` invalidation covers the record list. "Completely broken" is these:

| ID | Defect | Where |
|---|---|---|
| RT-A1 | A **pass is refused** when the driver has no licence number on file — after all nine items are rated. The drawer already holds `identity.cdl_number` and does not pass it to the panel; the fix lives in a different drawer (permissions) and the message doesn't say so. | `roadTest.ts:287-291`, `HiringStepDrawer.vue:66,256` |
| RT-A2 | **"Record another" can only fail.** After a pass, any second pass is 409 `already_passed`; the form also reopens with the previous answers still filled. | `RoadTestPanel.vue:204`, `roadTest.ts:149-152`; form never reset `:112-122` |
| RT-A3 | Examiner signature error says *"Add their signature again under Examiners"* — no such place; the register is Settings → Recruiting and recruiters can't reach it (`ROAD_TEST_EXAMINER_SECTION = "admin"`). | `roadTest.ts:282`, `roadTestContract.ts:131` |
| RT-A4 | Raw Zod text in toasts: miles `12.5` or `1500` pass the client (`> 0`) and fail the contract (whole number ≤ 1000). Future dates caught only on the server. | `RoadTestPanel.vue:128,214,223`, `roadTestContract.ts:64` |
| RT-A5 | **A failed test vanishes.** Only passes write `qualification_records`; after a fail the panel still says "No road test passed yet" and the failed form PDF is nowhere on screen. | `RoadTestPanel.vue:159,167` |
| RT-A6 | **Trucks in the shop can't be chosen**: filters `status === "active"` instead of the shared `IN_SERVICE_VEHICLE_STATUSES` (which includes `maintenance`). Empty or failed vehicle list → empty combo, no reason. | `RoadTestPanel.vue:77`, `shared/constants.ts:136` |
| RT-A7 | Every `road_test` row is labelled "Passed", including legacy rows the checklist refuses to count; a step done by CDL equivalency shows Done beside "No road test passed yet". | `RoadTestPanel.vue:171`, `hiringChecklist.ts:153,269` |
| RT-A8 | Record is disabled with no hint which of 14 inputs is missing; no "all satisfactory" shortcut. | `RoadTestPanel.vue` |
| RT-A9 | Label points at a div (`id` on `AppSegmentedControl`); "Needs Training" title case. | `:247`, `roadTestContract.ts:39` |
| RT-A10 | Drawer says "Needs: Drug test" while the form accepts the test — inconsistent (see Q-WF2). | `hiringSteps.ts:240` |

### 3.2 Drawers — dead states and developer wording

**Dead or empty drawers**

- **D-1 — The "Hired" row opens an empty drawer.** `hiringStepDrawers.ts:142` maps `hired: "hire"`;
  `HiringStepDrawer.vue` has no `'hire'` branch, so it falls through to line 292: *"This step has
  nothing in the schema to prove it yet, so there is nothing to show."* The hire drawer exists
  (`HireDrawer.vue`) and is opened from elsewhere.
- **D-2** — `send_application` / `packet` without a live invitation fall into the same sentence.
- **D-3** — "Open the driver's qualification file" on the medical step sends a recruiter to a page
  where their role can only view (`auth.ts:158`).
- **D-4** — Clearinghouse panel shows non-safety roles an explanation of a role rule and no action.
- **D-5** — "Add another examiner" sits inside the road-test form; it is an admin settings act.

**Developer wording shown to the office** (quote → where). Each is replaced by what to do, or deleted:

| Shown today | Where |
|---|---|
| "This step has nothing in the schema to prove it yet…" | `HiringStepDrawer.vue:292` |
| "Recorded rather than fetched: a record pulled anywhere else still counts, and files the same way." (twice on one drawer) | `HiringStepDrawer.vue:271`, `RecordedActPanel.vue:4` |
| "A link sent before Part 1 existed counts it done once…" | `HiringStepDrawer.vue:160-163` |
| "There is no live invitation to open signing on." | `HiringStepDrawer.vue:268` |
| "Proved by: Certificate" | `HiringStepDrawer.vue:276` |
| "Notifying an applicant when a bought report costs them the job is a separate piece of work that has not been built." | `DispositionSection.vue:171` |
| "The PDF satisfies the qualification file; it carries no structured inspection data…" | `PspRecordsSection.vue:243` |
| "Entered before employers carried a reference, so a call can't be recorded against it until filing…" | `EmployerCallsPanel.vue:33` |
| "The office's order is the result first, then the query — you can still run it." | `ClearinghouseConsentPanel.vue:73` |
| "…carries the safety-history inquiries … into it as dated evidence." / "…filed under a date nobody recorded." | `HireDrawer.vue:62,83` |
| monospace `date_of_birth`; "nothing here guesses between 03/04 and…" | `DobImportCard.vue:7-9` |
| "The pretrip inspection required by § 392.7." (section numbers without words) | `roadTestContract.ts:20` |
| "Steps are blocked only by law or by a rule the database enforces." (also false, §2.1) | `ApplicantRecordPage.vue:135` |

**Visual**: raw ISO dates in `RecordedActPanel` (~168), `PspRecordsSection:36`,
`EmployerInquirySection:46,54` (bypass `formatDisplayDate`, against
[MM/DD/YYYY from one definition]); four heading styles across panels, none `font-semibold`; nested
bordered boxes (`SignatoryAddForm.vue:106` in a drawer form); warning colour on plain paragraphs
instead of `AppCallout` (`ClearinghouseConsentPanel.vue:72`, `SelfieCheckPanel.vue:43`);
2–4-sentence process paragraphs above the controls in five panels.

### 3.3 The applicant form — why answers come back empty

| ID | Finding | Where |
|---|---|---|
| AF-1 | **All 11 carrier questions are optional, on client and server.** `questionnaireAnswersSchema` is imported by nothing outside its test; the API takes `questionnaire_answers` as `z.record(z.string(), z.unknown())`. | `questionnaireContract.ts:116,372,400`, `applicationContract.ts:308` |
| AF-2 | The hub labels the task **"The carrier's own questions · Optional"** and an untouched optional task passes, so "Before you send" unlocks without opening it. | `applicationSections.ts:72`, `taskHub.ts:46,96` |
| AF-3 | The intro tells the applicant these *"are not part of the federal application"* — an invitation to skip, and half untrue since five of them moved to the identity screen. | `questionnaireContract.ts:170-173` |
| AF-4 | **A blank employer row survives into the draft** (measured, §1). Errors show only on "Save this job"; closing the drawer on a new unnamed job deletes it silently, but a half-saved one stays. | `EmployerDrawer.vue:139-148`, `ApplyEmploymentFields.vue:148-154` |
| AF-5 | The review lists "Not answered" in grey and nothing else — no count, no list of what's missing, no jump to it. | `reviewSummary.ts`, `strings.ts:361` |
| AF-6 | "If so, when?" (military) always shows; yes/no questions are dropdowns, not Yes/No buttons; nothing marks required vs optional. | `QuestionnaireFields.vue:122-128` |
| AF-7 | "The federal minimum age is 21. Silvicom's own policy is 23." as the hint on a yes/no. | `questionnaireContract.ts:212` |
| AF-8 | Also optional on the federal part: `cdl_class`, employer phone/email/position, `experience` (one of two). | `applicationContract.ts` |

### 3.4 Previous employment

**Three stores**: the applicant's draft (`application_drafts.payload`, editable) → the filed
application (`driver_applications.payload`, frozen — gap explanations live ONLY here after filing,
`0220:43`) → `driver_employment_history` rows (office working copy, filled only at submission,
`0376:1279-1292`). Plus `employer_verification_calls` (pre-filing, keyed by draft `key`) and
`employer_inquiries` (§391.23, post-filing).

**Four forms with different fields and defaults**: `EmployerDrawer` (applicant), `AddEmployerForm`
(office, pre-filing), `EmploymentForm` (office, post-filing), and the generic field-path correction
list in `ApplicationReviewDrawer`.

| ID | What the office can't do / what is wrong | Where |
|---|---|---|
| EM-1 | **Before the applicant sends: nothing.** No office access to the draft — a recruiter on the phone can't type the jobs in. | — |
| EM-2 | After send, before approval: **fill a field the applicant left empty — no** (null cells are skipped by the correction list); **delete a row — no** (edits address rows by index, Q-AX7); **add or explain a gap — no** (no gap form at all). | `editableFields.ts:12-22,137-144`, `AddEmployerForm.vue:26-32` |
| EM-3 | Office "Add an employer" **has no street field and hard-codes `address_line1: ""`**, which the v2 filing then refuses (`applicationFilingRules.ts:81`). The office's own add makes the application unfileable. | `AddEmployerForm.vue:86` |
| EM-4 | After approval, before filing: nothing editable at all. | `applicationReview.ts:55,212` |
| EM-5 | After filing: rows editable, **"Remove" has no confirm**; office adds are saved as `source: "application"` (not `manual`); `operated_cmv` defaults **false** (applicant side defaults **true**); street, email and both (iv) answers missing. | `EmploymentHistorySection.vue:233`, `EmploymentForm.vue:42,86` |
| EM-6 | `EmploymentForm` lets the office **type** inquiry status and dates, which `syncInquiryStatus` derives from the attempts — every save overwrites the derived value. | `EmploymentForm.vue:155-166`, `employerInquiry.ts:197` |
| EM-7 | **Gaps after filing have no home** — no table, no UI. A gap found on a call can't be recorded. The office view lists gaps as text and doesn't show the applicant's explanations beside them; its window ends at hire date/today, not the application date, so its gaps differ from the applicant's. | `EmploymentHistorySection.vue:50-52,140-195` |
| EM-8 | Call results ("dates were different") are stored as free text and **never applied**; the recruiter re-types them. | `EmployerCallsPanel.vue`, `0376:1294-1320` |
| EM-9 | **No timeline anywhere** — a % bar for the applicant, counts and ISO dates for the office. The 10-year CMV coverage is computed and never shown. | `employmentCoverage.ts:160-217` |
| EM-10 | Applicant drawer: form changes shape mid-entry (the two (iv) questions appear once dates fall in 3 years); "More about this job (optional)" hides the DOT-regulated box that decides the §391.23 inquiry; intro says *"Time you were not driving is not a gap you need to explain"* while the gap boxes ask exactly that. | `EmployerDrawer.vue`, `strings.history.ts` |

### 3.5 Documents

- Slots: `cdl_front`, `cdl_back`, `medical_card`, `ssn_card`, `signature_mark`, `initials_mark`,
  `selfie`, `other` (`applicationCaptureContract.ts:24-62`, CHECK `0376:207-210`). **None
  required** (`APPLICATION_CAPTURE_REQUIRED = []`).
- Part 1 asks CDL front/back, medical (with *"I don't have one yet"*), selfie. Part 2's documents
  task asks CDL front/back **again**, medical, SSN card — labelled Optional, with copy that invites
  skipping: *"…or skip them and send them to the carrier later."* (`strings.ts:320-321`). SSN card
  refused until sent (`applicationCapture.ts:91`). That is why the owner sees "only the CDL".
- **Not offered at all**: TWIC, passport, green card / work authorisation, hazmat endorsement,
  previous road-test certificate, training certificates, a labelled "other".
- Images only (jpeg/png/webp) — a driver with a PDF medical certificate cannot send it.
- One row per slot (`unique (invitation_id, slot)`) — two training certificates cannot coexist.
- **The office has no upload on the applicant record.** `useUploadDocument`
  (`composables/useCompliance.ts:124`) exists and is mounted only on `DriverDetailPage`.
- Document kinds already include `cdl`, `medical_card`, `twic`, `endorsement`, `hazmat_training`,
  `road_test`, `eldt`; **no** `passport`, `ssn_card`, `work_authorization`.

### 3.6 Employment suggested from PSP / MVR / Clearinghouse

- **PSP** — every inspection (3 yrs) and crash (5 yrs) carries carrier name, USDOT and date
  (`psp/parse.ts:32-71`). The full vendor response is kept in `psp_requests.response_raw`; the
  record keeps only counts (`pspOrder.ts:302-307`).
- **`crossMatchEmployment()` exists, is tested, and has no caller** (`psp/employment.ts:114`). It
  returns `unlisted[]` — `{ usdotNumber, carrierName, firstSeen, lastSeen, inspections, crashes,
  owedTo: "b10"|"b11"|"outside" }`, own DOT excluded — plus `corroborated` / `no_psp_activity` per
  declared employer and `undeclaredCrashes`. `driver_employment_history.source` already allows
  `'psp_discovery'` ("Found in a PSP record", `recruitmentContract.ts:38-43`). The design rules are
  in `PSP-PLAN.md` §5b: PSP **corroborates or discovers, never refutes**; match on DOT number.
- **Limits, stated plainly**: PSP only sees carriers whose truck the driver was inspected or crashed
  in — a clean driver with few inspections yields little. Dates are *activity*, not hire/leave.
  No carrier address or phone — needs FMCSA's QCMobile lookup (free `webKey`, probed 2026-08-19,
  `PSP-PLAN.md:728`; **no client in the code**). PSP PDFs imported from the portal are never read.
- **MVR**: no integration, no parsing; state records carry no employer. **Clearinghouse**: a
  yes/no record status; no employer. Neither can suggest employment.
- **The source that does carry employment** is a consumer-report employment history (e.g. the
  DAC Employment History file, where carriers report their drivers' hire/leave dates and reasons).
  That is a paid subscription and a separate FCRA consent — Q-WF7.

### 3.7 Training and orientation

- `orientation_videos` and `live_orientation` are checklist steps with `evidence: null`
  (`hiringSteps.ts:212-246`) and drawer body `"unbuilt"` (`hiringStepDrawers.ts:145-146`) — which is
  what renders the "nothing in the schema" sentence.
- `DRIVER-TRAINING-PLAN.md` (a whole micro-LMS, D1–D7 locked 2026-07-23): **phases 0–6 not started**;
  its planned migration numbers were taken long ago.
- `ORIENTATION-PLAN.md`: only OR0 (kinds `orientation`, `handbook`, `0373`) built; OR1–OR3 wait on
  Q-OR7 (the drug-and-alcohol policy document is not on file) and Q-OR8 (how page 24 is signed).
  Ruled: Q-OR2 (an `orientation` qualification record), Q-OR4 (done once all seven areas are covered,
  across one or more sessions). The carrier's own seven areas are on packet page 24
  (DOT FMCSR, 1-2-3 techniques, emergency manoeuvres, speed & space, air brakes, accident/breakdown…).
- Handbook signing **is** built (HB1–HB5, QH0–QH2).
- The tutorial recorder (`apps/web/tutorials/`) can produce narrated walkthroughs of *our screens*
  (driver portal, apply flow) — not pre-trip or safety content, which has to be filmed.

---

## 4. Solutions

### 4.1 Free order (§2)

- G2–G7 and the handbook half of G1 become **warnings**: `warns` lists on the step, rendered by the
  existing caution callout, one sentence each, in office words.
- Travel form never hidden; booking with open steps shows "Still open: PSP, drug test — book anyway?"
- Hire keeps the six federal checks (Q-WF1) and shows them **before** the press: the Hire button
  opens a list of the six with a tick or a link to each. The hired row opens `HireDrawer` (D-1).
- MVR without signed consent: the refusal names the paper-consent route and links to it.
- `ApplicantRecordPage.vue:135` reads: *"Every step can be done in any order. Hiring waits for the
  six federal checks; the MVR and PSP wait for the applicant's consent."*
- The board's `next` suggestion stays (it is advice) but no longer skips "blocked" steps.

### 4.2 Road test (§3.1) — no schema

Pass `cdl_number` to the panel and show "Add the licence number first" with a button that opens the
identity correction in place (RT-A1); hide "Record another" after a pass, reset the form after any
record (RT-A2); point examiner errors at Settings → Recruiting, link for admins, "ask an
administrator" for others, refetch on `not_found` (RT-A3); `step="1" max="1000"` + `maxDate` today +
map server issues to field errors (RT-A4); list failed attempts with their PDF under "Attempts"
(RT-A5); use `IN_SERVICE_VEHICLE_STATUSES`, empty/error state for the truck list (RT-A6); label
rows by what counted (RT-A7); "Mark all satisfactory" + a one-line "Still needed: …" under the
button (RT-A8); group the nine items as *Before driving* (pre-trip, coupling, placing in operation)
and *On the road* (the rest); fix label/case (RT-A9).

### 4.3 Drawers (§3.2) — no schema

One copy pass over every string in §3.2's table: each sentence either tells the office what to do
next or is deleted. Section numbers always come with their words ("road test certificate
(§391.31)"). Dates through `formatDisplayDate`. One heading style (`text-sm font-semibold`), one
callout component, no box inside a drawer. Process paragraphs move behind a "Why?" disclosure.
Unbuilt steps show what to do today ("Record that orientation happened — upload the signed page")
until §4.7 lands.

### 4.4 Applicant form (§3.3)

- **Required questions**: the carrier's questions get a `required` set (Q-WF3 picks which), enforced
  through `APPLICATION_CROSS_FIELD_RULES` (`applicationRules.ts`) — the route the contract comment
  itself names — so client and server refuse the same thing. `questionnaire_answers` is parsed by
  `questionnaireAnswersSchema` on the API.
- "questions" leaves `OPTIONAL_TASKS`; the hub shows *"3 of 9 answered"*, not *Optional*.
- Every unanswered optional question shows a **"I'd rather not say"** / **"Doesn't apply"** choice,
  so "skipped" and "answered no" become different states and the office can see which.
- **A job is saved only with a name and a start date**; a half-filled drawer keeps its draft but is
  listed as "Unfinished — finish or remove" with the row named, never silently blank (AF-4).
- **Review shows a checklist of what is missing**, each line a link to the field, with a count
  ("4 answers missing") at the top. Send stays possible for genuinely optional fields; required
  ones block with the same list.
- Military "when" appears only after "yes"; yes/no as two buttons; required fields marked.
- Rewrite the questionnaire intro: *"A few more questions about you. They help us place you on the
  right truck."*

### 4.5 Previous employment — one timeline, one form (§3.4)

**The model** (Q-WF5): until the applicant **signs** the application (office day), the draft is the
one place the job list lives, and **both** the applicant and the office edit it. Every office edit is
logged in `application_edits` with who and when (today's mechanism, extended to add, delete, fill a
blank, and gaps). The applicant signs what is on the screen that day — so what the recruiter typed
on the phone is in front of the driver before it is signed. That is §391.21 working as intended:
the driver certifies the history, whoever typed it.

After signing, the filed application is frozen (as today) and corrections go to the office record
(`driver_employment_history` + a new `driver_employment_gaps` table), each row marked
"added by {name} on {date}, after signing". The DQ file shows both.

**The screen** — one component, `EmploymentTimeline`, used by the applicant link, the review drawer
and the applicant record:

- A vertical timeline, newest first, 3-year and 10-year marks drawn on it.
- Each job is a card: name, dates, CMV / DOT tags, a ✓ when complete, "2 details missing" when not.
- Each **gap** is drawn as a gap, with two buttons: **Add a job here** (dates pre-filled) and
  **Explain** (one line: unemployed, school, family, other driving…).
- PSP suggestions (§4.6) appear in the timeline at their dates as dashed cards: *"Inspected in a
  truck of ABC Trucking (DOT 123456), 03/2024 – 07/2024. Add this job?"*
- **One employer form** for everyone, same fields and defaults: name (with FMCSA lookup by name or
  DOT — fills address and phone), from / to, position, reason for leaving, "did you drive a truck
  here", "was it DOT-regulated" (asked, not hidden), and the two (iv) questions only when it is
  DOT-regulated and within three years — always visible once those are answered, so the form never
  changes shape behind the cursor.
- Delete with confirm, everywhere. Fill any blank field. No index-addressed edits (rows by `key`,
  which every row already carries).
- Call results: "dates differ — the employer said 02/2023–11/2024" carries an **Apply** button that
  writes the dates (logged as an office edit).
- Inquiry status is never typed — EM-6's fields come out of the form.

### 4.6 Employment suggested from PSP (§3.6)

1. An API route that parses the stored `response_raw` with `parsePspReport` and runs
   `crossMatchEmployment` against the current job list and the org's DOT number. No new table for
   the first version (P12's per-record tables wait on PSP-PLAN Q10, retention).
2. The suggestions render in the timeline (§4.5). **Add** fills a job from the suggestion with
   `source = 'psp_discovery'`; the recruiter confirms the dates with the driver. **Dismiss** records
   that the recruiter looked.
3. Declared employers get a small "seen in PSP" tick when corroborated.
4. A QCMobile client (cached, env `FMCSA_WEBKEY`) resolves DOT → legal name, address, phone — used by
   the suggestion **and** by the employer form's name/DOT lookup, so the recruiter types four
   characters instead of an address.
5. Honest copy: "PSP only shows trucks you were inspected in. Most drivers have more jobs than this."

### 4.7 Documents (§3.5)

- One **"Your documents"** list, all optional but all offered: CDL (already taken → shows the
  thumbnail, never re-asks), medical card, TWIC, passport, green card / work permit, SSN card,
  hazmat endorsement, previous road-test certificate, training certificates (several), other (with
  a name). Each can be a photo or a PDF.
- The copy stops inviting the skip: *"Send what you have now — you can bring the rest to the office."*
- **Office upload on the applicant record**: a "Documents" section with the same list, drag-drop or
  phone camera, filing straight to `documents` for the applicant's `driver_id` (the uploader exists,
  `useUploadDocument`).
- Schema: widen the slot CHECK and `documents` kinds (`passport`, `ssn_card`, `work_authorization`,
  `training_certificate`, `road_test_certificate`), allow `application/pdf`, and replace
  `unique (invitation_id, slot)` with a per-slot limit so certificates can be several. SSN card and
  passport images are as sensitive as the SSN itself: viewing gated by Q-WF4.

### 4.8 Training and orientation (§3.7) — first version, small on purpose

- **Before the office day — videos.** Settings → Recruiting holds a list of orientation videos
  (title, link or uploaded file, minutes, required yes/no). Sending them is one button on the
  step (and optional in the travel text message): the driver gets a link, watches on the phone,
  each video records *opened / watched to the end*, and one tick at the end — "I watched these" —
  with name and date. The step is done when every required video is watched. Not an LMS: no quizzes,
  no scoring, no certificates in v1 (the micro-LMS of `DRIVER-TRAINING-PLAN.md` stays the later
  version, and v1's tables are shaped so it can grow into it).
- **On the office day — orientation.** A checklist of the carrier's seven areas from packet page 24
  (Q-OR4: done once all seven are covered, across one or more sessions), each ticked with instructor
  and date; then the driver and the instructor sign — the same signing walk the handbook uses. It
  files the `orientation` qualification record (Q-OR2). Q-OR8 (how page 24 is signed) is answered
  by this: on screen, pre-filled, both parties.
- The tutorial recorder makes the "how to use the driver app" video for free; safety content is the
  owner's to film or license.
- Neither step blocks the hire unless the owner says so (Q-WF6).

---

## 5. Build queue

One step, one PR, branch off `origin/main`. A column and its first reader in two merges. Ordered by
what the office feels soonest.

| Step | What | Schema | Size |
|---|---|---|---|
| **HW1** | Road test RT-A1…A10 | none | S |
| **HW2** | Drawers: Hired row → HireDrawer (D-1/D-2), copy pass (§3.2 table), dates, headings, callouts | none | M |
| **HW3a** | Free order, API + UI: travel / send / signing / handbook → warnings; hire shows its six before the press; record-page sentence | none | M |
| **HW3b** | Free order, SQL: one migration redefining AI005 / AI006 / DR032 / DR036 / HB022 / HB023 without the order check | migration | S |
| **HW4** | Applicant: required carrier questions (after Q-WF3), "rather not say", no blank job rows, missing-answers review list, intro copy | none (contract only) | M |
| **HW5a** | Employment: office edits the draft fully before signing (fill blank, delete, add with address, gaps), rows by `key` | none | M |
| **HW5b** | `EmploymentTimeline` + one employer form, replacing `EmployerDrawer` / `AddEmployerForm` / `EmploymentForm` | none | L |
| **HW5c** | `driver_employment_gaps` table + post-signing corrections; EM-5/EM-6 fixes | migration → reader | M |
| **HW5d** | Call results "Apply" | none | S |
| **HW6a** | QCMobile client + employer lookup in the form | none (env var) | S |
| **HW6b** | PSP suggestions in the timeline | none | M |
| **HW7a** | Documents schema: slots, kinds, PDF, multiple per slot | migration | S |
| **HW7b** | Applicant documents list + office upload on the record | reader | M |
| **HW8a** | Orientation videos: settings list, send, watch tracking | migration → reader | M |
| **HW8b** | In-office orientation checklist + signing | migration → reader | M |

HW1, HW2 and HW3a can start today — none of them waits on a question.

---

## 6. Questions for the owner

Each has a recommendation; none is mine to rule.

- **Q-WF1 — What stays a hard block?** (a) only the six federal checks, at hire *(recommended:
  "hired" makes the person dispatchable in this system, and the law wants these before the first
  drive)*; (b) the six, but at first dispatch instead of at hire — hire freely, block the truck
  assignment; (c) nothing hard, warnings only. Consent before MVR/PSP stays in every option (law).
- **Q-WF2 — Road test before the drug test result?** The code calls the strict reading an open
  question (`hiringSteps.ts:229-235`, Q-HM1/Q-REC5). (a) warn and allow *(recommended — FMCSA has
  said the Clearinghouse query may follow the road test; the drug half is an inference and
  industry practice, and §382.301(b) exceptions exist)*; (b) refuse.
- **Q-WF3 — Which carrier questions are required?** Recommendation: position, applying as, how did
  you hear about us, legally able to work, proof of age, may we contact employers, education — all
  others optional with "rather not say". *This replaces the contract's deliberate "THERE IS NO `required` FLAG" design (`questionnaireContract.ts:116`).*
- **Q-WF4 — Who may view SSN card and passport images?** (a) the roles that can see the full SSN
  today *(recommended)*; (b) every recruiter.
- **Q-WF5 — The employment model in §4.5** (office edits the draft until the applicant signs; after
  signing, office corrections are separate rows marked "after signing"). Recommend (a) accept.
- **Q-WF6 — Do videos or orientation block the hire?** Recommend neither blocks; they show on the
  checklist and in the DQ file. *Replaces D-HB5 for the handbook too, if he agrees the handbook
  should not block either.*
- **Q-WF7 — DAC employment history report?** It is the only source that actually lists past
  employers with dates (paid, per report, separate consent). Recommend: price it after HW6b shows
  how much PSP finds on our own applicants.
- **Q-WF8 — The videos themselves.** Which exist today, who films the rest, and are any required
  before travel?
- **Carried, still open:** Q-OR7 (the drug-and-alcohol policy document is not on file — page 28's
  receipt points at nothing); PSP-PLAN Q10 (may PSP-derived data be kept after the hiring decision —
  governs whether suggestions may be stored or only shown).

---

## 7. Progress log

- **2026-10-31** — Audit written. Measured on production: 0 filed applications, 4 drafts, 1 real
  applicant (2/11 carrier questions, one wholly blank employer row), 0 office corrections ever.
  Findings verified on `origin/main` `e07046d` at the cited lines: D-1 (`hiringStepDrawers.ts:142`
  vs no `'hire'` branch), RT-A2 (`RoadTestPanel.vue:204` / `roadTest.ts:150`), RT-A6
  (`RoadTestPanel.vue:77`), EM-3 (`AddEmployerForm.vue:86`), EM-5 (`EmploymentForm.vue:42,86`).
  Nothing built.
