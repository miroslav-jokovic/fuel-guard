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

**Second opinion and the two-day build are §8 and §9 (2026-10-31 evening).** §9 is the operative
queue; §5 is the full one it was cut from. §8 corrects two things §0–§4 get wrong or miss.

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

> ⚠ **Superseded as the working order by §9** (2026-10-31). This table is the full queue; §9 says
> which rows ship in the two days and which wait, and why.

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
- **Q-WF4b — Q-WF4 (a)'s premise does not hold: no role sees the full SSN today** (found building
  §9 P9, 2026-11-01). `driver_applications.ssn_sealed` is written by `sealSsn` and opened by
  nothing; every screen and document carries the last four at most (D-HIRE6). So "the roles that see
  the full SSN" is the empty set, and an SSN card or passport image readable by nobody — not even an
  admin checking work authorization — cannot be what (a) meant. Candidates: (a) admin and safety
  manager — the narrowest read the matrix already grants, both restricted halves
  (`canReadAllRestricted`) *(recommended; what P9 ships, provisionally, in `canSeeIdentityNumberImages`)*;
  (b) admin only; (c) every role that manages recruitment (the recruiter included — Q-WF4 (b)).
  Whichever is chosen is one line in `packages/shared/src/auth.ts`; every service-role path that
  signs a paper's URL already asks `canSeePaperImage`.
  **Ruled by the owner, 2026-11-04: safety and recruiting, as a setting in Settings → Permissions** — §15.1.
- **Carried, still open:** Q-OR7 (the drug-and-alcohol policy document is not on file — page 28's
  receipt points at nothing); PSP-PLAN Q10 (may PSP-derived data be kept after the hiring decision —
  governs whether suggestions may be stored or only shown).
  **Q-OR7: the owner, 2026-11-04, "analyze and solve this properly"** — §15.2 (the policy text itself is
  still the owner's to supply, Q-DAP1).

---

## 8. Second opinion — what the audit gets right, what it misses (2026-10-31)

A second read of the system against the audit, every claim checked at `origin/main` `fde9a56`.
The findings in §1–§4 held; two things below correct the audit, the rest is what it did not look at.

### 8.1 Corrections to §2 and §4

- **§4.1 relaxes six SQL refusals; only three are order.** AI005 (`send_application_invitation`,
  `0365:229`), AI006 (`open_packet_signing`, `0369:191`) and HB022 (`handbook_marks_guard`,
  `0385:78`) are preference and go. **DR032 stays**: approval writes the carrier's half into the
  packet (§2.2 ⚠), so a mark before it has nothing to sign — it is reworded, not removed. **DR036
  and HB023 are mechanical**: opening signing is what issues the token the mark is made with; without
  it there is no mark to refuse. §9's migration touches three functions, not six.
- **The draft is NOT unguarded.** `application_drafts.revision` exists since `0376:1488`, the
  6-argument `save_application_draft` refuses DA041 on a stale revision, the API maps it to a 409
  (`applicationDraft.ts:193`) and the phone shows a conflict callout with a reload button
  (`DraftNotice.vue:22`). So §4.5's "office edits the draft until the applicant signs" is safe on
  the applicant's side already. **The hole is the office's side**: `editApplication` reads the
  payload and writes it back with a bare `.update({ payload })` (`applicationReview.ts:212,247`),
  outside the revision check. A recruiter typing a job while the phone autosaves can overwrite the
  phone's save. §9 P5 routes the office write through the same RPC with the revision it read.

### 8.2 What the audit does not look at

- **There is no human layer on the applicant record.** No notes table, no activity feed, no assigned
  recruiter, no follow-up date (`git grep applicant_notes` → nothing; `ApplicantTextsStatus.vue` is
  SMS consent only). A recruiter on the phone has nowhere to write *"called 10/30, sends the SSN
  card Monday"*. Every hiring tool has this; this one does not. §9 P7/P10 add an append-only
  `applicant_notes` table and an activity feed **derived** from the evidence rows that already exist
  (invitation, Part 1, releases, each `qualification_records` kind, `psp_requests`, SMS, edits,
  travel) — derived, because a stored feed is the second copy `applicantPipeline.ts:8` refuses.
- **The recruiter cannot press Hire, and the fix is a setting, not code.** `canHire` is
  `session.can("roster")` (`RecruitmentPage.vue:231`) and the API gate is
  `requireSection("roster")` read from the ORG's editable matrix (SP5). So the owner can grant the
  recruiter role `roster: manage` in Settings → Permissions today. What is unverified is whether
  0213's trigger (which refuses a recruiter's `drivers.status` change) reads the role or the grant
  — §9 P11 is that check on staging, with the recruiter test member.
- **The process is a TypeScript array.** `hiringSteps.ts`'s header says carrier steps "are insertable
  anywhere"; nothing lets anyone insert one. A hair test, fingerprinting, ELD training, fuel card
  issued, equipment issued — each is a release today. The honest home is a per-org checklist editor
  in Settings → Recruiting: the six federal rows and the two consent gates locked with their
  regulation shown; every other row the carrier's to add, rename, reorder, hide, choose what proves
  it (tick + note, signed document, upload, date) and whether it blocks the hire. **Not two-day
  work** — it is a table, a reader and a fold change — but every §9 step is shaped so that it can
  follow (`warns` lists, the `HIRE_REFUSES_WITHOUT` base, the hire-policy toggles of P12).
- **Settings → Recruiting holds four things** (link lifetime, reminder, representatives, examiners;
  `SettingsRecruitingPage.vue:39-58`) and the Templates tab is blank paper forms only
  (`RecruitmentTemplatesPage.vue:54`). Missing, in the order they matter: hire-policy toggles (which
  non-federal steps block the hire — Q-WF1/Q-WF6 should be a switch per carrier, not a ruling in a
  plan), the required set of carrier questions (Q-WF3 as a setting served by one endpoint and read by
  both validators keeps the client/server agreement the contract comment defends), the documents
  offered, message templates (invitation, reminder, travel, videos), auto-archive after N days
  without a response. P12 ships the first; the rest wait.
- **After Send the applicant sees a wait screen** (`ApplyWaitScreen.vue`). A status page that shows
  the office's stages in plain words and the one thing the applicant owes next removes the "what is
  happening with my application" calls. Waits.
- **Dispositions are three outcomes** (`applicantDisposition.ts:23`: declined, withdrawn,
  no response). No on-hold, no rehire-eligible / do-not-rehire, no reactivate. Waits.
- **§4.8's "watched to the end"** needs a player we host. First version is a link list and an
  attestation tick. The DAC report (Q-WF7) waits, as the audit says.

### 8.3 Rulings §9 assumes (the owner's to overturn, by Saturday evening)

| Q | Assumed | Why |
|---|---|---|
| Q-WF1 | (a) the six federal checks, at hire | "hired" makes the person dispatchable |
| Q-WF2 | (a) warn and allow the road test before the drug result | §382.301(b) exceptions; the strict reading is an inference |
| Q-WF3 | required: position, applying as, heard from, legally able to work, proof of age, may we contact employers, education | the audit's recommendation |
| Q-WF4 | (a) the roles that see the full SSN today | same sensitivity |
| Q-WF5 | (a) accept the model; the office write goes through the revision RPC | §8.1 |
| Q-WF6 | neither videos nor orientation block; **the handbook stops blocking too** (D-HB5 replaced) | the owner's complaint is the ruling; P12 makes it a switch |

---

## 9. The two-day build — Saturday 2026-10-31 and Sunday 2026-11-01

**What "production ready" means here, said plainly.** After these two days the hire the office runs
today works end to end without a developer sentence, a dead button or a refusal the law does not
require; the office can fix an application on the phone; the applicant cannot send a blank job or
skip the questions the carrier needs; every document can be offered and the office can upload one;
the record has notes and a history; and the owner decides what blocks a hire. **The employment
timeline (HW5b/c/d), PSP suggestions (HW6), orientation (HW8), the checklist editor, the applicant
status page and the other settings of §8.2 are not two-day work and are not in this list.** They
are the next week, in that order.

**Calendar.** Today is Saturday. The release train runs Sunday–Thursday nights at 01:07 CT
(`RELEASE-TRAIN-PLAN.md`), so everything merged by Sunday evening is on production **Monday
2026-11-02 at 01:07 CT** once the owner approves the open `main → production` PR. A merge is on
staging in minutes, so the owner can walk each step as it lands. Migrations 0533–0536 are applied
to staging on merge and to production first in the train; each has its reader in a later PR
(`lint:migration-ordering`), and both halves ride the same train.

**How every PR is made.** Its own worktree and branch off `origin/main` (parallel sessions share one
tree — never work on the main checkout); one PR per row; body under the four template headings; every
gate run locally with `$?` checked and `CI=true` for vitest; migration numbers re-checked by NAME
against `origin/main` right before merge (a parallel chat may have taken one); merge when CI is
green; nothing pushed during a rebase. Four lanes run in parallel; a lane's rows are sequential.

### 9.1 Saturday — the defects

| PR | Lane | What | Files | Proof | Size |
|---|---|---|---|---|---|
| **P1** | A | **Road test** RT-A1…A10 exactly as §4.2. Pass `identity.cdl_number` into the panel; "Add the licence number first" opens the identity correction in place; hide "Record another" after a pass and reset the form after any record; examiner errors say Settings → Recruiting (link for admins, "ask an administrator" otherwise), refetch on `not_found`; `step="1" max="1000"`, `max` today on the date, server issues mapped to field errors; failed attempts listed with their PDF under "Attempts"; `IN_SERVICE_VEHICLE_STATUSES` with empty/error states; rows labelled by what counted; "Mark all satisfactory" + "Still needed: …"; *Before driving* / *On the road* groups; label on a real control; "Needs training". | `RoadTestPanel.vue`, `useRoadTest.ts`, `HiringStepDrawer.vue:66,256`, `api/.../roadTest.ts:282-291`, `roadTestContract.ts:20,39` | `RoadTestPanel.test.ts`: one case per RT id, each shown red first by reverting the one line it pins | S |
| **P2** | B | **Drawers.** `hired → HireDrawer` (D-1); `send_application`/`packet` without a live invitation say what to do ("Send the invitation first", with the button) (D-2); medical step's link hidden for roles that cannot write the DQ file (D-3); Clearinghouse panel shows non-safety roles "Ask {role} to run it" (D-4); "Add another examiner" leaves the form (D-5). The §3.2 copy table: every quoted sentence replaced by an instruction or deleted; section numbers always with words; `formatDisplayDate` everywhere; one heading style; `AppCallout` for every warning; no box inside a drawer; process paragraphs behind a "Why?" disclosure. | `hiringStepDrawers.ts:142-146`, `HiringStepDrawer.vue`, `RecordedActPanel.vue`, `DispositionSection.vue:171`, `PspRecordsSection.vue:36,243`, `EmployerCallsPanel.vue:33`, `ClearinghouseConsentPanel.vue:72-73`, `HireDrawer.vue:62,83`, `DobImportCard.vue`, `SignatoryAddForm.vue:106`, `SelfieCheckPanel.vue:43`, `EmployerInquirySection.vue:46,54`, `ApplicantRecordPage.vue:135` | existing panel tests updated to the new strings; `lint:comment-claims` green; a grep for each old sentence returns nothing | M |
| **P3** | C | **Migration 0533** — `send_application_invitation` without AI005, `open_packet_signing` without AI006, `handbook_marks_guard` without HB022. Each function's `comment on` rewritten to say the order is advised, not refused, and to cite this plan. DR032/DR036/HB023 untouched (§8.1). **Merge before P4.** | `supabase/migrations/0533_hiring_order_advises.sql` | the PGlite matrix for each function gains "sends/opens/marks with the predecessor open" and keeps the refusals that remain; `RESULT` line printed | S |
| **P4** | C, after P3 | **Free order in code.** `TRAVEL_REFUSES_WITHOUT` → `TRAVEL_WARNS_ON`; `REFUSAL_EDGES` keeps only `hired`; `HIRE_REFUSES_WITHOUT` loses `handbook` (Q-WF6 assumed; P12 makes it a switch); `applicantTravel.ts:104-111` returns warnings instead of 409; `TravelPanel.vue:61` always shows the form with a caution callout "Still open: PSP, drug test — book anyway?"; `applicationSend.ts:105-109`, `applicationSendForSigning.ts:56-59`, `handbookSigning.ts:161`, `applicationReleases.ts:115`, `signatureAdoption.ts:119` → warn; `SendForSigningPanel.vue:141` and `HandbookPanel.vue:92` always show their button; MVR refusal (`hiringEvidence.ts:104-124`) names the paper-consent route and links `PaperAuthorizationForm`. **Hire shows its six before the press**: `HireDrawer` opens with the six federal checks, a tick or a link each, from the existing `GET …/hire-preview`; the board's `next` no longer skips "blocked" rows; `ApplicantRecordPage.vue:135` reads *"Every step can be done in any order. Hiring waits for the six federal checks; the MVR and PSP wait for the applicant's consent."* | `hiringSteps.ts:166-240`, `hiringChecklist.ts:365-376`, the eight API/UI files named | `hiringChecklist.test.ts` (no step but `hired` has a refusal edge); API tests for each route: predecessor open → 200 with `warnings[]`, was 409; `HireDrawer.test.ts`: six rows, each a tick or a link; e2e-apply unchanged | M |
| **P5** | D | **The office edits the draft, fully, until filing.** `applicationIsEditable` → true from `application_sent_at` (and from `intake_completed_at` for the identity half) until `submitted_at`, closing EM-1 and EM-4; `editApplication` writes through `save_application_draft(…, p_expected_revision)` with the revision it read and maps DA041 to 409 *"The applicant changed this just now — reload and try again"* (§8.1); the correction list includes **null** cells (EM-2); employer rows addressed by `key`, never index (Q-AX7); **Remove row** with confirm; **Add a job** with a street field (EM-3, `address_line1` no longer `""`); **Explain a gap** writes the draft's gap list; every edit logged in `application_edits` as today. Both forms get the applicant's defaults (`operated_cmv` true). | `applicationReview.ts:200-260`, `editableFields.ts:12-22,137-144`, `ApplicationReviewDrawer.vue`, `AddEmployerForm.vue:26-32,86`, `applicationContract.ts` (edit op shape) | `applicationReview.test.ts`: edit before send 200; stale revision 409; null cell editable; delete by key; add with street files under `applicationFilingRules`; a mutation that drops the revision argument fails the stale test | M |
| **P6** | A, after P1 | **Migration 0534 — documents.** Slot CHECK adds `twic`, `passport`, `work_authorization`, `hazmat_endorsement`, `road_test_certificate`, `training_certificate`; `documents.kind` CHECK adds `passport`, `ssn_card`, `work_authorization`, `training_certificate`, `road_test_certificate`; `application/pdf` allowed; `unique (invitation_id, slot)` → `unique (invitation_id, slot, ordinal)` with `ordinal` default 0 and a per-slot limit of 5 in the CHECK. Reader is P9. | `supabase/migrations/0534_application_document_slots.sql` | matrix: each new slot inserts; a sixth ordinal refuses; old rows unchanged (`ordinal` 0) | S |
| **P7** | B, after P2 | **Migration 0535 — `applicant_notes`.** `id, org_id, driver_id (→ drivers, cascade), invitation_id null, body text, author_id, author_name, pinned bool, created_at`; RLS enabled, no client policies (deny-all); append-only — no `update`/`delete` grant, pinning through a one-column RPC. **Listed in `merge_driver`'s cascade** (the trap in `merge-driver-cascade-trap`), **added to the applicant purge** (`applicantPurgeContract.ts` — a purge that leaves notes leaves the applicant), and **not** in `RETENTION_FORBIDDEN` (notes are working papers, not evidence). Reader is P10. | `supabase/migrations/0535_applicant_notes.sql`, `check-rls.mjs` green | matrix: insert, pin, no update of body, cascades on merge, deleted by purge | S |

**Saturday evening (owner):** walk P1–P5 on staging as they land — the road test with a truck in
the shop and a fail before a pass; travel booked with PSP open; an application edited from the
office before the applicant sent it. Answer §8.3 if any assumed ruling is wrong.

### 9.2 Sunday — the applicant, the documents, the record, the switch

| PR | Lane | What | Files | Proof | Size |
|---|---|---|---|---|---|
| **P8** | A | **The applicant form** (§4.4). Q-WF3's seven questions become `APPLICATION_CROSS_FIELD_RULES` entries, so the wizard and the API refuse the same thing; `questionnaire_answers` parsed by `questionnaireAnswersSchema` on the API (AF-1); `"questions"` leaves `OPTIONAL_TASKS`, the hub says *"3 of 11 answered"* (AF-2); every optional question gets *"I'd rather not say"* / *"Doesn't apply"* as a stored choice; **a job saves only with a name and a start date**, a half-filled drawer is listed *"Unfinished — finish or remove"* with the row named (AF-4); the review shows *"4 answers missing"* with one link per field (AF-5); military "when" only after "yes", yes/no as two buttons, required marked (AF-6); AF-7 hint rewritten; new intro (§4.4). **Spanish strings in the same PR** — C4 is live. | `questionnaireContract.ts:116-173,212`, `applicationRules.ts`, `applicationContract.ts:308`, `applicationSections.ts:72`, `taskHub.ts:46,96`, `EmployerDrawer.vue:139-148`, `ApplyEmploymentFields.vue:148-154`, `reviewSummary.ts`, `QuestionnaireFields.vue:122-128`, `strings.ts`, `es/strings.es.*.ts` | contract tests: each required key refused with the same issue path on client and server; e2e-apply (`apps/web/e2e-apply/`, the only Playwright CI runs): send refused with the missing list, then accepted; blank job cannot be saved; Spanish walk still passes | M |
| **P9** | C | **Documents** (§4.7), reader of 0534. Part 2's task becomes **"Your documents"**: CDL shows the Part 1 thumbnails and never re-asks; every slot offered; photo or PDF; several training certificates; copy *"Send what you have now — you can bring the rest to the office."* **Office upload on the applicant record**: a Documents section with the same list, drag-drop or camera, filing to `documents` for the applicant's `driver_id` through `useUploadDocument`, each row badged *sent by applicant* / *added by {name}*. SSN card and passport images viewable only by the roles that see the full SSN (Q-WF4 (a)). | `DocumentCaptureFields.vue`, `applicationCaptureContract.ts:24-62`, `applicationCapture.ts:91`, `strings.ts:320-321` (+ es), `ApplicantRecordPage.vue`, new `ApplicantDocumentsSection.vue`, `useCompliance.ts:124` | capture contract tests for each slot and PDF; `ApplicantDocumentsSection.test.ts`: upload files with the driver id and org (`expectOrgScoped`); a recruiter sees the SSN card row and not its image | M |
| **P10** | B | **Notes and activity**, reader of 0535. On the applicant record, above the checklist: **Notes** (append-only list, newest first, pin one to the top, "Add a note" is one textarea) and **Activity**, a dated list derived at read time from the rows that exist — invitation sent, Part 1 finished, each permission signed, each `qualification_records` kind, PSP ordered/filed, every SMS in and out, each `application_edits` row ("{name} filled in the street for ABC Trucking"), travel booked, disposition — one API read, org-scoped. The board's row gets *"last note: 2 d ago · {name}"*. | new `applicant_notes` service + routes, `applicantActivity.ts`, `ApplicantNotesPanel.vue`, `ApplicantActivityList.vue`, `ApplicantRecordPage.vue`, `applicantBoardReads.ts` | API tests: note insert org-scoped; activity for a fixture applicant lists every kind in date order; purge removes notes; a mutation that drops `.eq("org_id")` fails `expectOrgScoped` | M |
| **P11** | D, **no code unless it fails** | **A recruiter hires.** On staging, grant the recruiter role `roster: manage` in Settings → Permissions; sign in as the recruiter test member (`staging-test-members`); hire a test applicant. **Pass** → write the outcome and the setting into §7 and `RECRUITER-ROLE-SCOPE.md`; the owner does the same on production after the release. **Fail on 0213's trigger** → migration 0536 makes the trigger read the org grant, reader Monday; written into §7 either way. | — | the staging act itself, recorded with the driver id and time | XS |
| **P12** | D, after P11 | **Hire policy is a switch.** `recruiting_settings` gains `handbook_blocks_hire`, `orientation_blocks_hire`, `videos_block_hire` (all default false) in **migration 0536** (0537 if P11 took 0536); reader in a **second PR** the same afternoon: Settings → Recruiting gets a *"Before we hire"* section — the six federal checks listed and locked with their regulation, then three switches; `HIRE_REFUSES_WITHOUT` = the base six + whatever is switched on, read by `hireApplicant.ts` and `HireDrawer`'s six-row list (which becomes six-to-nine). | `0536_hire_policy.sql`, `recruitingSettingsContract.ts`, `RecruitingSettingsForm.vue`, `hireApplicant.ts:94-104`, `HireDrawer.vue` | matrix: defaults false; API: with `handbook_blocks_hire` on and no handbook → 409 listing it, off → 200; settings PUT org-scoped. **Drops first if Sunday runs out** — the base six already work from P4 | S+S |

**Sunday evening — the pass and the release.**

1. **Three fixtures on staging** (`browser-pass-three-fixtures`): the failing API, the empty org,
   and the staging org, 9 s settle each, on the board, the record, every drawer, the applicant link
   in English and Spanish.
2. **The walk, as the office**: invite → Part 1 on a phone → permissions → office edits two jobs in
   and removes a blank row → send → applicant answers the required seven and is refused once with the
   missing list → office approves → travel booked with PSP open (warned) → office uploads a TWIC →
   road test on a truck in maintenance, one fail then one pass → signing → handbook → **hire by the
   recruiter** (P11) with the six shown green before the press → a note and the activity list read
   back the whole day.
3. **The release**: the owner approves the open `main → production` PR by 23:00 CT; the train runs
   01:07 CT Monday, migrations 0533–0536 first, then the code. Monday 08:00 `pnpm verify:live`
   confirms the commit and migration, and the owner flips the recruiter's roster grant on production.

### 9.3 After the release — the next week, in this order

HW5b (timeline + one employer form, L) → HW5c (`driver_employment_gaps`, post-signing corrections)
→ HW5d (call results **Apply**) → HW6a (QCMobile client + lookup) → HW6b (PSP suggestions) → the
checklist editor (§8.2) → required-questions and documents as settings → message templates → the
applicant status page → dispositions → HW8a/b orientation (link list + attestation first) → DAC
(Q-WF7, priced after HW6b).

---

## 10. The checklist editor — the carrier's own steps (2026-11-02)

§8.2's third bullet, next in §9.3's order after HW5b–d (all merged 2026-11-01; HW6a waits on the
FMCSA QCMobile key). The owner said build it as proposed (2026-11-02). §8.2 proposed more than one
first version should carry; this section says what CE1/CE2 build, what they leave, and why.

**What it is for.** A hair test, fingerprinting, ELD training, the fuel card, the tablet issued: each is
a step this carrier runs and the checklist cannot show, so it lives on paper and can never hold the
hire. After CE2 the office adds it in Settings → Recruiting, the record shows it among the built-in
steps, someone ticks it (or files its paper), and the hire waits for it when the carrier says so.

**Decisions** (assumed as §8.3 assumed its rulings; the owner's to overturn):

| ID | Decision | Why |
|---|---|---|
| D-CE1 | A carrier ADDS its own steps: a name, what to do, where it goes (after which built-in step), who owes it (the office, or the applicant), what proves it, and whether the hire waits for it. | The bullet's core; every example in it is an added step. |
| D-CE2 | Proof is one of two: **a tick** (who, when, an optional note) or **a filed document** (the paper on the applicant's record, through P9's door). "Date" and "signed form" from §8.2 are not in the first version. | A date is a tick's own timestamp or its note; a signed form is a signing ceremony per step — the handbook's whole plan. Two proofs cover every example in §8.2. |
| D-CE3 | A carrier may HIDE a built-in step it does not run — PSP, the trip, the handbook, the orientation videos, the live orientation day. Never the six federal checks, the consents, the application, the investigation (§391.23) or the hire. The hideable set is **derived** from the catalogue in TypeScript (`hiringSteps.ts`), not listed in SQL. | Deriving beats restating; a CHECK with keys would be a second catalogue. The reader ignores a locked key in the column, fail-safe. |
| D-CE4 | The built-in steps keep their names and order. A carrier step sits AFTER a built-in step, ordered among its siblings by `position`. | The order is the owner's ruling and its edges are advice the drawers read (`advisedFirst`); renaming a built-in would change the words on every drawer, the PDF and the board at once. |
| D-CE5 | A step is **retired, never deleted**; **its proof never changes** (a different proof is a different step). Each act on an applicant is an append-only record — `done`, or `undone` with a reason — and the latest act is the answer. | A record names its step; a step that could vanish or change meaning would leave the record pointing at nothing, or certify what it never checked. |
| D-CE6 | A step that holds the hire (`blocks_hire`) joins `hireRefusesWithout` beside the six and the handbook switch, and the hire drawer lists it ("· your company's rule"). A retired step holds nothing. | One refusal list, read by the fold, the API and the drawer — P12b's shape. |
| D-CE7 | The records are evidence (`RETENTION_FORBIDDEN`), moved by the roster merge, deleted only by the applicant purge. | 0535/0539's discipline. |

**Open questions** (each has a recommendation; none blocks CE1/CE2):

- **Q-CE1 — Rename or reorder the built-in steps?** (a) never — a carrier step placed after one is the
  only way to change the order *(recommended for now, D-CE4)*; (b) a label override per carrier, words
  only, the order kept; (c) full reorder (breaks the advised-order edges).
  **Ruled by the owner, 2026-11-04: as proposed — (a).** The built-in steps keep their names and
  order (D-CE4); a carrier step placed after one is the way to change the order. Nothing to build.
- **Q-CE2 — More proofs?** A date ("hair test collected on"), a signed form, a value ("fuel card
  number"). Recommend waiting until a carrier asks for one; each is a column, not a redesign.
  **Ruled by the owner, 2026-11-04: as proposed.** Two proofs (a tick, a filed document) until a carrier
  asks for a third; each is then a column on `hiring_carrier_steps` and a branch in the step's drawer.
- **Q-CE3 — Who edits the list?** CE2 uses the gate Settings → Recruiting already uses. Recommend
  keeping it; a separate permission is a matrix row nobody has asked for.

**The build.** One step, one PR, a migration and its reader in two merges:

| PR | What | Schema |
|---|---|---|
| **CE1** | Migration **0545**: `hiring_carrier_steps` (CS010–CS012), `hiring_carrier_step_records` (CS020–CS028), `recruiting_settings.hidden_hiring_steps`; `purge_applicant` redefined from 0539 with the record table; merge list, retention list, table manifests. | migration |
| **CE2** | The reader: a contract in `packages/shared`; Settings → Recruiting's "Your hiring steps" (add, edit, place, retire; hide a built-in); the fold emits carrier rows among the built-ins and the hire's list reads `blocks_hire`; one drawer for a carrier step (tick or file the paper, undo with a reason); API routes org-scoped. | none |

---

## 11. Required questions and documents offered — two more settings (2026-11-02)

§8.2's fourth and fifth items, next in §9.3's order after the checklist editor. The owner said build
as proposed (2026-11-02).

**What it is for.** Today the seven questions an applicant must answer are a flag on `SILVICOM_DRIVER_V3`
(§9 P8), and Part 2's "Your documents" offers every slot (§9 P9). A carrier that does not care how a
driver heard about it, or that never wants a passport photo, cannot say so; a carrier that wants the
references answered cannot either. After S2 both are lists of checkboxes in Settings → Recruiting.

**The hard part is the draft in flight.** A question made required on Tuesday must not refuse, on
Thursday, an applicant who answered the form on Monday without being asked for it — the reason a draft
carries its `questionnaire_version` (§9 P8). A carrier's setting is not a new version of the questions
(the words are unchanged), so it cannot ride that mechanism; it needs its own snapshot, taken at the
moment the applicant is served the form.

**Decisions** (assumed as §8.3 assumed its rulings; the owner's to overturn):

| ID | Decision | Why |
|---|---|---|
| D-RS1 | `recruiting_settings.required_questions text[]`, **null = the product default** (the served definition's own `required` flags — today Q-WF3's seven). Non-null is exactly the set required; empty means nothing is. | Null keeps every carrier on what it has today without a backfill, and keeps "has this carrier decided?" answerable. |
| D-RS2 | **Which questions MAY be required is derived in TypeScript** from the served definition: every question except one asked only after another's answer (`askedWhen`: "If so, when?") and the reserved EEO key. Not listed in SQL; a stored id the definition does not have is ignored on read. | §10 D-CE3's rule: a CHECK naming question ids would be a second questionnaire. A conditional question required would refuse an applicant who was never asked it. |
| D-RS3 | **The set is stamped on the invitation once, at the office's first Send** (`application_invitations.required_questions`, written by `send_application_invitation`'s new `p_required_questions`, only while `application_sent_at` is still null). The API resolves the set in TypeScript (the setting, or the default from D-RS1) and passes it; SQL only stores it. A resend never restamps. **Null on an invitation = sent before S2**, and reads exactly as today: the flags of the draft's own `questionnaire_version`. | The Send is when the applicant is first served the questions; stamping there is the version mechanism's twin. Resolving in TS keeps the default derived (D-RS2), not copied into SQL. |
| D-RS4 | **The rule reads the stamp from the payload**: `questionnaire_required` (nullish, ≤ 60 ids) beside `questionnaire_version` in the application contract. The applicant's bundle serves the invitation's stamp and the wizard lays it on the candidate, so the per-screen check, the send check and the review's missing list read one function (`requiredQuestionIds(definition, stamp)`). **The API never believes the client's copy**: `submitApplication` overwrites it with the invitation's stamp and re-runs the rules before filing. | One function, two validators, one answer (the contract comment's promise). The filed payload then records which questions were required of this applicant. |
| D-RS5 | **A required question loses its skip.** "I'd rather not say" on a question the carrier requires is not an answer: the screen does not offer it and the rule counts the stored skip as unanswered. | Otherwise requiring `references` would be satisfied by the one-tap way out of it. |
| D-RS6 | `recruiting_settings.offered_document_slots text[]`, **null = every slot** (P9's behaviour). Non-null is the set Part 2 offers. **The licence (Part 1's `cdl_front`/`cdl_back`) and the medical card (§391.41/§391.43, a DQ-file item) are always offered**; which slots may be withheld is derived from the capture catalogue in TypeScript. Not stamped: offering fewer documents refuses nothing (`APPLICATION_CAPTURE_REQUIRED` is empty), so the live setting is read. A capture already staged in a withheld slot is kept and filed — nothing the applicant sent is dropped. | Same derivation rule as D-RS2. A withheld slot is a hidden button, not a refusal. |
| D-RS7 | Both fields are **optional on the PUT, absent = keep what is stored**, as every field added to the settings since 0536. Settings → Recruiting gets two checkbox lists, each with "Use the standard set" (writes null). | A screen served before S2 must not clear them. |

**Open questions** (each has a recommendation; none blocks S1/S2):

- **Q-RS1 — Should the office see, on the applicant record, which questions were required of this
  applicant?** Recommend no for now: the filed payload records it (D-RS4); a screen for it waits for
  somebody to ask.
- **Q-RS2 — Carrier-written questions** (a question the carrier types itself)? Not in this step: that is
  a per-carrier questionnaire definition — `questionnaireForApplicant`'s header already names it as an
  `organizations` column and an argument. Recommend waiting for a second carrier whose form differs.
  **Ruled by the owner, 2026-11-04: add it in Settings as an option** — §15.3.
- **Q-RS3 — Should the applicant's existing hole close too?** The client sends `questionnaire_version`
  and the API believes it, so a hand-made body naming v2 skips v3's required flags. D-RS4 closes it for
  every invitation stamped after S2 (the stamp decides, whatever version is named); invitations stamped
  null keep today's behaviour. Recommend no further change.

**The build.** A migration and its reader in two merges:

| PR | What | Schema |
|---|---|---|
| **S1** | Migration **0550** (0547–0549 are the office chat's): `recruiting_settings.required_questions`, `recruiting_settings.offered_document_slots`, `application_invitations.required_questions`; `send_application_invitation` widened with `p_required_questions text[] default null` (the 4-argument call still resolves, so code served before S2 keeps working) and stamping once. | migration |
| **S2** | The reader: `requiredQuestionIds` / `offeredDocumentSlots` in `packages/shared`; the contract's `questionnaire_required`; the rule, the skip, the bundle, the wizard, `submitApplication`'s overwrite and re-check; `applicationSend.ts` passes the resolved set; the capture route and "Your documents" read the offered slots; Settings → Recruiting's two lists; Spanish for every applicant-facing string. | none |

---

## 12. Message templates — the carrier's own words (2026-11-02)

§8.2's "message templates (invitation, reminder, travel, videos)", next in §9.3's order after §11. The
owner said build as proposed (2026-11-02).

**What it is for.** Every email and text an applicant gets is a TypeScript function. A carrier that
wants to greet its drivers by name, say "call Dana at 555-0100 with any question", or name its yard,
cannot; and the trip the office books (`applicant_travel`, 0376) is never sent to the applicant at all —
`applicantTravel.ts` writes a row and nothing else, so the recruiter reads the flight out on the phone.
After MT2 each message has an "Edit the wording" in Settings → Recruiting with a preview; after MT3 the
travel panel sends the booked trip.

**What exists, measured at `origin/main` `4e2d845`.** Emails: `renderApplicationInviteEmail` (the
first link, `applicationLink.ts`), `renderApplicationSentEmail` (the office's Send), `nudgeEmail` (the
reminder, `applicationNudgeSweep.ts`), `renderOrientationVideosEmail`; each is a subject, a heading, a
paragraph, a button, the link pasted out and a footer with the expiry. Texts: `smsApplicationInvite`,
`smsApplicationReady`, `smsApplicationReminder`, `smsOrientationVideos` — `{carrier}: <lead> {link}
<fixed tail>`, the tail carrying the expiry, "your earlier link no longer works", rates, HELP and STOP.
`sms_outbox` (0376) stores a template and its params, **never** a rendered body, and renders at send
time (`smsOutbox.ts` `render`). Nothing records an email's words. Every applicant message is English;
the Spanish (C4) is the page's only.

**Decisions** (assumed as §8.3 assumed its rulings; the owner's to overturn):

| ID | Decision | Why |
|---|---|---|
| D-MT1 | **Five messages**, a catalogue in `packages/shared` (`RECRUITING_MESSAGES`): `invitation` (the first link), `application_ready` (the office's Send), `reminder` (the 48-hour nudge), `videos` (the orientation videos) and `travel` (the booked trip, new in MT3). Each covers its email AND its text. **Not covered:** the opt-in confirmation and HELP reply (CTIA's required contents), the sign link (72 hours, sent with the driver in the office), the drug-test site (§40.61 photo ID), the approval notice, the resent link and "text me the link". | The four §8.2 names, plus `application_ready`: it is the second invitation, and leaving it out would leave a carrier's greeting on the first email and the product's on the next. The rest either carry rules or are not where a carrier's voice is asked for (Q-MT2). |
| D-MT2 | A carrier writes **four parts** of a message, each optional: the email's subject, its heading, its paragraph, and the text's lead sentence. **Never** the link, the button, the pasted-out link, the expiry sentence, "your earlier link no longer works", the text's leading carrier name, or its rates / HELP / STOP — those stay in code, outside every part. A part left empty is the product's words for that part. | The handoff's shape. Every fixed piece is either a rule (CTIA, the rotation that kills the old link) or what makes the message work. |
| D-MT3 | **Placeholders from a closed list per message**, declared in the catalogue: `{first_name}` and `{carrier}` everywhere; `{days}` where the message has an expiry (`invitation`, `application_ready`, `videos`). Any other `{…}` is refused on save. `{first_name}` is `drivers.first_name`, then the first word of `full_name`, then "there". | Checked in TypeScript, so a misspelt placeholder is a save error, never a literal `{frist_name}` in a driver's inbox. |
| D-MT4 | **Limits**: subject and heading ≤ 120 characters, one line; paragraph ≤ 1,000, plain text (the sender escapes it; line breaks kept); text lead ≤ 120, one line, **GSM-7 characters only**. Lengths and line breaks are checked in SQL too (0551); GSM-7 in TypeScript only. | A subject with a newline is a header injection whoever wrote the row, so the database refuses it. One curly quote or emoji turns a text into UCS-2 at 70 characters a part — a cost rule, so TypeScript's. |
| D-MT5 | **Storage: one append-only table, `recruiting_message_wording`** (0551): one row per save — org, message key, the four parts, who saved it and when. The newest row per (org, key) is the wording; "Use the standard wording" saves four nulls. Message keys are **not** a CHECK list (§10 D-CE3's rule; the CHECK is the key's shape). No `driver_id`, so no merge or purge work; not evidence (not in `RETENTION_FORBIDDEN`); deleted only with the organization. RLS on, no client policies. | Five messages × four parts would be twenty columns on `recruiting_settings` with no history, and the history is what answers D-MT6. |
| D-MT6 | **What a message said is derived, not stored.** A sent message is never re-rendered, and its words are not copied beside it: the wording in force for a send is the newest row saved at or before the send instant the product already records (`created_at`, `application_sent_at`, the nudge stamps, `orientation_videos_sent_at`, `sms_outbox.sent_at`, MT3's audit row). A queued text renders at drain time with the wording in force then — the instant `sent_at` records. | Deriving beats restating; a rendered copy per send would be a second record of the code plus the setting. |
| D-MT7 | **The preview is the sender's own function.** Settings → Recruiting's "Messages" renders each message, email and text, through the same shared render function the API sends with, on a sample link and the signed-in person's first name, and shows the text's length in parts. | A preview drawn by a second function is a second copy of the wording that can disagree. |
| D-MT8 | **English only.** No `language` column; a Spanish message is its own step (Q-MT1). | No applicant message is in Spanish today; a column for a language nothing sends is a promise nothing keeps. |
| D-MT9 | **The trip message (MT3)**: "Send the trip to {first name}" on the travel panel, for the newest live booking — the mode, departure and arrival in the carrier's zone (as the panel shows them) and the confirmation reference — by email to the invitation's address and by text through the outbox (reason `travel`, added to 0376's CHECK by 0551), worth sending until the departure. No link: there is nothing to do on the application about a ticket. Sent on the office's press, never on booking; an audit row records the send. | The office may book before it is ready to tell the applicant, and a moved trip is a new booking (`applicantTravel.ts`), so "send" is an act, not a side effect. |
| D-MT10 | **Who edits**: the gate Settings → Recruiting already uses. | Q-CE3's reasoning. |

**Open questions** (each has a recommendation; none blocks MT1–MT3):

- **Q-MT1 — Spanish messages?** An applicant who read the page in Spanish still gets English email and
  texts. Recommend: a later step that stamps the page's language on the invitation and sends the C4
  translations, with a Spanish wording per message (then a `language` column). Waits for the owner.
  **Ruled by the owner, 2026-11-04: no Spanish messages for now; maybe later.** D-MT8 stands. The
  capture errors served in English only (S2's departure) stay as they are under the same ruling.
- **Q-MT2 — More messages in the catalogue?** The approval notice is the likeliest next one; the sign
  link and the drug-test site carry rules. Recommend adding a message when a carrier asks — each is a
  catalogue entry and a reader, no migration.
- **Q-MT3 — Send the trip automatically on booking?** Recommend no (D-MT9); a "send on booking" switch is
  one setting if the office asks.
- **Q-MT4 — A ticket attached to the trip email?** Recommend later: the trip has no file today.

**The build.** A migration and its reader in two merges, then the trip:

| PR | What | Schema |
|---|---|---|
| **MT1** | Migration **0551**: `recruiting_message_wording` (MW010 never edited, MW011 never deleted but with the org; lengths and line breaks checked); `sms_outbox`'s reason CHECK gains `travel`. | migration |
| **MT2** | The reader: `RECRUITING_MESSAGES`, the wording schema and placeholder check in `packages/shared`; the four existing render functions take the carrier's wording; `applicationLink.ts`, `applicationSend.ts`, the nudge sweep, the videos send and the outbox's `render` read it; Settings → Recruiting's "Messages" with the preview and "Use the standard wording". | none |
| **MT3** | The trip: `renderTravelEmail` / `smsTravel` in the catalogue; `POST …/travel/send`; the travel panel's button. | none |

---

## 13. The applicant status page (2026-11-02)

§8.2's "after Send the applicant sees a wait screen", next in §9.3's order after §12. Built as proposed.

**What it is for.** Between the permissions and the office visit the applicant's link shows one of three wait
screens (`ApplyWaitScreen.vue`: permissions received, handed over, approved) — a heading and two sentences, and
the note "nothing more to do", even when the office has booked a drug test, sent videos or booked a trip. The
office takes the "what is happening with my application" call. After SP1 the same three screens show where the
application stands, in four stages, and what the applicant still owes.

**Decisions** (assumed as §8.3 assumed its rulings; the owner's to overturn):

| ID | Decision | Why |
|---|---|---|
| D-SP1 | **Four stages, in the applicant's words**: the permissions, the application (filled in and handed over), the company's review, the office visit (road test, orientation, signing). Each is done, current, or later — **derived from the phases the link already serves** (`phasesOf`: `releasesCompletedAt`, `reviewRequestedAt`, `approvedAt`, `submittedAt`), never stored. | The office's checklist has twenty rows; an applicant needs to know which of four places they are in. Deriving keeps the page and the office from disagreeing. |
| D-SP2 | **What the applicant owes** is a list of at most three kinds, served on the bundle as `owes`: **the drug test** (a live appointment on this invitation whose window has not passed), **the orientation videos** (sent, and a required video not yet ticked — `readOrientationVideoFacts`, the checklist's own facts), **the trip** (a live booking that has not left). In that order: the drug test is time-bound, the videos are done before coming in, the trip is information. With nothing owed the screen keeps its "nothing more to do" note. | The "one thing you owe next" of §8.2, read from the rows the office's acts already write. |
| D-SP3 | **Kinds, never details, on the bare link.** The status says a drug test is booked, never where or when; a trip is booked, never the times or confirmation. The details travel the way they already do — the drug-test text, MT3's trip message — and the item says so ("call the office if you have not had them"). The videos item links to the videos page, which the same token already opens. | D-APP16: an application link is forwarded and read on shared phones. A site address and a collection window are not for whoever holds the link. |
| D-SP4 | **A failed read of what is owed serves an empty list** rather than failing the page. | The page must open; a missing "to do" costs less than a blank screen. |
| D-SP5 | **No migration, no new table.** | Everything shown already exists. |

**Open questions** (none blocks SP1):

- **Q-SP1 — Show the drug test's day on the link?** Recommend no (D-SP3); the text carries it.
- **Q-SP2 — Show the status page after filing too** (handbook, hire)? `ApplicationFiledCard` already says what
  happened; recommend leaving it.

**The build.** One PR: **SP1** — `owes` on the bundle (`applicantOwes.ts`), the stages fold
(`applicantStages.ts`), `ApplicantStatusPanel.vue` inside the three wait screens, English and Spanish.

---

## 14. The owner's sixteen steps — the checklist as the office works it (2026-11-03)

**What for.** On 2026-11-03 the owner wrote the hire out step by step, as the office actually works it,
and asked whether the plan matched. It did not: the checklist showed rows that are halves of one act
(Part 1 and its permissions; the application and its approval; the driving record and the medical
card), a row the office does by hand outside the product (previous employers), a row nothing can tick
(live orientation), and a last row called "Hired" for a hire that happens in McLeod. The owner's list:

1 invite (email or phone) · 2 Part 1 finished — with every photo and the permissions · 3 driving
record (Samba, uploaded, read by AI) with the medical card · 4 PSP (bought, $10) · 5 Clearinghouse ·
6 drug test (ordered from here, result here) · 7 application sent · 8 application received, reviewed,
edited — and approved · *training videos* · 11 travel (booked through a travel API) · 13 road test
(checklist, phone and tablet) · 14 application signing · 15 handbook · 16 **close application**.
Removed: 9 office approved (duplicate of 8), 10 medical certificate (part of 3), 12 previous employers
(manual for now), "How this checklist is worked out" (unnecessary).

**Decisions** (the owner said "proceed as proposed" on 2026-11-03; each is his to overturn):

| ID | Decision | Why |
|---|---|---|
| D-OF1 | **Rows are what the office reads; steps are what the law measures — two lists.** The catalogue keeps every step and the fold keeps folding every one (hire refusal, travel and send warnings and the API read them by key). A step with `shownIn` is drawn INSIDE its host's row; a step with `listed: false` is drawn nowhere. `hiringChecklistRows()` (shared) is the one grouping, and `done`/`total` count rows. | Deleting `permissions_signed` or `medical_certificate` from the catalogue would delete a check from the hire's refusal list — the medical card is one of §5's six federal gates. Merging the *display* removes the duplicate without removing a gate. |
| D-OF2 | **Part 1 row = Part 1 + permissions; driving-record row = MVR + medical card; application row = filled in + approved.** A merged row is done when every member is; otherwise it waits on the office if any member does, else on the applicant, else it is blocked. Its drawer shows each member's own body under its own heading. | Each of the owner's three "duplicates" is one act seen twice. "Waiting on you" whenever the office can move on any half is D-HUI4's rule — the loud state means *you*. |
| D-OF3 | **Previous employers and live orientation are not listed.** The fold still measures the investigation (never a gate — §391.23(c)(1)'s 30 days run from the first day), and the DQ file still lists the §391.51(b)(3) items, so a missing one shows there. `next` never nominates an unlisted step. | Manual work stays possible without a row that nags. Live orientation has no evidence (HW8b) and the owner's flow does not name it. |
| D-OF4 | **The order follows the owner's list**: the medical card beside the MVR; the orientation videos (his "training videos") after the application and before travel. | The list is the order the office works (`hiringSteps.ts` header). |
| D-OF5 | **"Hired" becomes "Close application", and stays a real act.** The McLeod roster sweep HOLDS an applicant it matches by CDL or name (`rosterMatch.ts`, RL1) until the row stops being an applicant; closing does that, so McLeod's driver links to the same row and the PSP, MVR, scans and signed papers stay with it. | Deleting the act would let McLeod create a second, empty driver beside the applicant's file — the two-rows-for-one-person failure RL1 was written against. |
| D-OF6 | **Part 1's photographs show in the Part 1 drawer, in the vehicles' and trailers' gallery** (`components/files/FileGallery.vue`). | One viewer for every file. |
| D-OF7 | **The explainer panel on the applicant record goes.** | Owner: unnecessary. |
| D-OF8 | **Vendor portals open in a new tab, never inside our window.** Samba's portal and FMCSA's Clearinghouse (login.gov) refuse to be framed. The drawer is: open the portal, drop the PDF it gives, our reader proposes what it says, the recruiter confirms. | A framed login page is blocked by the vendor's own headers; a modal that cannot load is a dead end. |

**Open questions** (each with a recommendation):

- ~~**Q-OF1 — Samba: a portal account, or the API?**~~ **Ruled by the owner, 2026-11-03: "we will use samba as
  external link to obtain MVRs for now", as the first message said.** Built (D-OF8, #1960 + #1962/#1965): the
  driving-record drawer opens SambaSafety's portal in a new tab; the PDF is dropped back, read by the AI check,
  and recorded by the recruiter; a filed scan opens in the vehicles' and trailers' gallery. No Samba API.
- **Q-OF2 — "$10 per PSP": the carrier's own FMCSA bill, or Silvicom charging other carriers?** What is built
  is the first (order, a confirmation showing the price, FMCSA bills the account). The second needs a billing
  system. Recommend the first; the price is `PSP_UNIT_PRICE_USD` on each deployment.
- **Q-OF3 — the travel vendor.** **Owner, 2026-11-03: Ignev is withdrawn; the owner is researching another
  solution.** Until he names it, the trip is recorded by hand (`TravelPanel`) and nothing is built (OF8 waits).
- **Q-OF4 — Drug-test ordering from the applicant page.** Q-MS7 was fixed by Med-Stop on 2026-10-13 and the
  owner confirms the keys (2026-11-03). Ordering itself is BUILT (MEDSTOP-PLAN UX3–UX5) but has never been
  switched on. **Measured against the office's real orders in MEDSTOP-PLAN §7A.21** — gaps G1–G6, proposal
  MSO1–MSO3, decisions Q-MSO1–Q-MSO4 for the owner.
- **Q-OF5 — The AI checking layer.** PSP arrives as structured data, so rules read it; the MVR arrives as a
  PDF and needs a reader. Recommend an MVR reader on the document-reading pipeline that proposes violations,
  suspensions and the medical status for the recruiter to confirm — never filing on its own.

**The build, in order:** OF1 rows + order + close + explainer (shared + web, no schema) → OF2 Part 1 gallery
→ OF3 road test on phone, tablet and wide screens → OF4 PSP production check → OF5 MVR and Clearinghouse
drawers (portal + upload) → OF6 AI MVR reader → OF7 drug-test ordering (MEDSTOP-PLAN §7A.21, after Q-MSO1–4)
→ OF8 travel booking (after Q-OF3: the owner's new vendor).

### 14.1 The owner's first message, step by step — where each stands (re-checked 2026-11-03)

The owner (2026-11-03): *"make sure that you have updated plan and follow my instructions from this first
message."* Each step in his words, and what the product does now:

| # | The owner's step | Now | State |
|---|---|---|---|
| 1 | Send invite (e-mail or phone); the applicant gets our form | Unchanged — already right | Done |
| 2 | Part 1 finished — missing the applicant's images; permissions signed belong in it | One row (D-OF2); every photo in the vehicles' gallery (#1958) | Done |
| 3 | Driving record — open our Samba account, pull the MVR, upload it; same viewer as vehicles and trailers | Samba portal in a new tab (D-OF8, the portal cannot be framed); drop the PDF → AI check → record; the filed scan opens in the vehicles' gallery (this merge) | Done |
| 4 | PSP — production-ready, $10, secure | Every guard in place; production switched off; the 10/13 token verified (expires ~12/12); four settings to go live (§7, OF4) | **Owner's settings** |
| 5 | Clearinghouse — open the login, send the request to the applicant | Clearinghouse in a new tab (login.gov refuses framing) with the steps; the consent request is sent from FMCSA's portal; result PDF dropped back | Done |
| 6 | Drug test — order it from the applicant page, results there, upload if needed | Order, results and upload built; ordering never switched on; measured gaps in MEDSTOP-PLAN §7A.21 | **Owner's decisions Q-MSO1–4** |
| 7 | Send the application | Unchanged — already right | Done |
| 8 | Receive, review and edit the application | Plus the approval in the same row (D-OF2) | Done |
| 9 | "Office approved" is a duplicate — instead, send the training videos | Approval folded into 8; orientation videos sit here (D-OF4); the videos themselves come later | Done (videos to come) |
| 10 | Medical certificate is part of the MVR step | Drawn inside the driving-record row; still a federal check | Done |
| 11 | Travel — search a ticket (Ignev) | Ignev withdrawn; recorded by hand until the new vendor (Q-OF3) | **Owner researching** |
| 12 | Previous employers — leave manual, off the list | Unlisted (D-OF3); still on the DQ file | Done |
| 13 | Road test — checklist, easy on phone/tablet, broken in the drawer on large screens | Lays out by the drawer's width, wide drawer, 48 px targets on touch (#1958) | Done |
| 14 | Safety, admin or recruiter send the application for signing | Already: `recruitment` manage | Done |
| 15 | Same, the handbook | Already: `recruitment` manage | Done |
| 16 | "Hire" is wrong — Close application | "Application closed" (D-OF5); still links McLeod's driver to this file | Done |
| — | AI as the checking layer for PSP and MVR | MVR: AI read + rules (#1962, #1965). PSP: structured data, read by rules on the PSP drawer | Done |
| — | Remove "How this is calculated" | Removed (D-OF7) | Done |
| — | Leads page | The parallel chat's | Theirs |

---

## 15. The owner's rulings of 2026-11-04 — identity images, the drug-and-alcohol policy, carrier questions

On 2026-11-04 the owner answered the open questions: **Q-WF4b** "basically safety and recruiting, but in
Settings → Permissions we should add a permission setting for this"; **Q-MT1** no Spanish messages for now;
**Q-OR7** "analyze and solve this properly"; **Q-CE1/CE2** as proposed; **Q-RS2** "we can add this in
settings as an option". Q-MT1, Q-CE1 and Q-CE2 need nothing built (recorded at each question). The other
three are §15.1–§15.3, each a migration and its reader in two merges.

### 15.1 Who sees SSN-card and passport pictures — a permission the carrier sets (Q-WF4b)

**Measured at `origin/main` `85ac2bc`.** The rule is `canSeeIdentityNumberImages(role)` =
`canReadAllRestricted(role)` (`identityPaperImages.ts:25`), a bare role test: admin + safety manager.
Callers take `req.auth.role` only (`evidence/routes/compliance.ts:269,368,400`,
`recruiting/applicantDocuments.ts:134-150`); the web renders the API's `imageWithheld`. Settings →
Permissions edits section cells (0291) and screens (0296) and nothing else — no capability is editable.

**Why this is not D-PERM9's territory.** D-PERM9 keeps the RESTRICTED readers (drug and alcohol results,
Clearinghouse, PSP, employer inquiries — §40.321, §382.401, §391.53) bare role tests for ever, because the
regulation names who reads them. No regulation names who may see a photograph of a Social Security card or a
passport: that is the carrier's privacy choice, which is why the owner wants it a setting. The restricted
readers stay as they are; Q-WF4b's provisional derivation from them is what goes.

| ID | Decision | Why |
|---|---|---|
| D-IDP1 | A **named permission** "See SSN-card and passport pictures", one switch per role in Settings → Permissions, in its own card under the sections. Stored in a new table `org_role_permissions (org_id, role, permission, allowed, updated_by, updated_at)`, primary key `(org_id, role, permission)`; the permission key is shape-checked, not listed (§10 D-CE3's rule; the catalogue is `EDITABLE_PERMISSIONS` in `packages/shared`). RLS on, no client policies. | A section cell is the wrong unit (it is not a page), and a column per permission on another table is a schema change per switch. One table, sparse like 0291: no row = the shipped default. |
| D-IDP2 | **Shipped default = the owner's ruling: admin, safety manager, recruiter.** Admin is locked on (the admin role is not editable, D-PERM7); every other role starts off and may be switched on. | "Basically safety and recruiting." |
| D-IDP3 | **Read at request time from the table, not from the JWT.** The two readers (compliance documents, the applicant's Documents section) load the org's rows once per request. ~~A failed read answers the shipped default.~~ **A failed read answers CLOSED — every editable role off, the admin on** (changed building IDP2: the default includes the recruiter, so a failed read would override an org that had switched the recruiter off). | A claim would wait for the next token refresh; a picture withheld or shown a minute late is a privacy bug either way, and the read is one indexed row set. |
| D-IDP4 | The admin edits it (the Permissions page is admin-only today); every change writes an audit row naming the role, the permission and the new value. | Same gate as every other cell on that page. |

**Build.** **IDP1** — migration: `org_role_permissions`. **IDP2** — the reader: `EDITABLE_PERMISSIONS`,
`effectivePermission(role, key, rows)` in shared, `canSeePaperImage(kind, allowed)`, `GET/PUT
/api/role-permissions`, the card on Settings → Permissions, both readers switched.

### 15.2 The drug-and-alcohol policy the driver signs for (Q-OR7)

**Measured.** Page 28 of the carrier's packet (`packet/assets/application-11.pdf`) is a header, the title
"ALCOHOL AND DRUG ABUSE POLICY", a "sample only … obtain legal counsel" disclaimer, and Name / Signature /
Date. The driver signs `p28` ("The alcohol and drug abuse policy") on that page in the packet walk
(`PacketCeremony.vue`); the walk shows the page and nothing else. **The policy itself is nowhere** — not in
the packet, not in the handbook (ORIENTATION-PLAN Q-OR7), not on file.

**What the law asks** (49 CFR §382.601): (a) the carrier gives every driver, before the first test and on
hire, materials explaining Part 382 and its own policy; (b) eleven required contents, first among them the
person designated to answer drivers' questions; (c) any stricter company rule marked as the carrier's own
authority; (d) **each driver signs a statement certifying that he or she received a copy**, and the carrier
keeps the original. So today the file holds a §382.601(d) certificate for materials the product cannot
show were given — the receipt an auditor reads first and the one thing it cannot prove.

| ID | Decision | Why |
|---|---|---|
| D-DAP1 | ~~The carrier uploads its policy as a PDF in Settings → Recruiting, versioned in a `drug_alcohol_policies` table.~~ **Revised 2026-11-04** after the owner supplied the policy ("add it properly as document in our system … same design and layout as other documents"): **the policy is the handbook's kind of document** — the carrier's text in code (`applicationPdf/drugAlcoholPolicy/drugAlcoholPolicyText.json`, transcribed from the 18-page scan, which has no text layer), drawn by the handbook's renderer (now shared as `flowedDocumentPdf`), versioned by a hash of what prints (`dap-…`, as the handbook is `hb-…`). No upload, no table. | One look for the carrier's papers; one versioning rule; the text is reviewed in a PR like the handbook. |
| D-DAP2 | **The driver is given the policy on p28's screen**: "Read the drug and alcohol policy" opens it on the applicant's own token, and Sign stays off until it has been opened. | §382.601(a) "provide", (d) "received a copy". |
| D-DAP3 | **The p28 mark records the policy version** (`application_packet_marks.policy_version`, 0565): required on p28 (DR039), refused on every other mark (DR041). The policy's own "DRIVER SIGNATURE / DATE" place is placement `p28`, so the one act signs both the packet's receipt page and the policy's last page. The signed policy files on the driver as `documents.kind = 'drug_alcohol_policy'` with the packet. | A receipt that names its text is the only kind an auditor can check. |
| D-DAP4 | Which version is current is the code's to say (the API stamps the one it serves); SQL checks the shape. A 14-argument `record_packet_mark` sits beside the 13-argument one for the deploy window; the 13 is dropped once DAP2 is its only caller. | `packet_version`'s arrangement. |
| D-DAP5 | A p28 mark made before DAP2 keeps its null version; nothing filed is rewritten. | A filed mark is never rewritten. |
| D-DAP6 | **What prints is corrected, on record.** The transcription keeps the scan's words; `DRUG_ALCOHOL_POLICY_CORRECTIONS` (spelling, punctuation, regulation citations, and drafting — a clause typed twice, a double negative that said the opposite of 49 CFR 382.505, a "however" clause copied from the paragraph above) is applied on top and fails at import if an entry stops fitting. No rule, number, period, cost or consequence changes. Owner, 2026-11-04: "yes correct this, we have to make sure all documents are really professional and precise". The cover's clip-art and the per-page INITIALS boxes are not drawn. | The handbook's register (D-HB6), widened to drafting by the owner's ruling. |

**Open, the owner's:**
- **Q-DAP2 — proofread.** The transcription is from a scan; the owner reads the rendered proof against the paper.
- **Q-DAP3 — the representative's name.** The policy names the Designated Employer Representative "Marija **Vermeda**"; the product's applicant records spell "Marija **Varmeda**". One is wrong.

**Build.** **DAP1** (#2018) — migration 0565 (kind, `policy_version`, the 14-argument function), the policy text, its corrections and the shared renderer. **DAP2** — the reader: the token-served policy, p28's gate and stamp, the filed copy, the office preview.

### 15.3 Questions the carrier writes itself (Q-RS2)

**Measured.** The questionnaire is code (`SILVICOM_DRIVER_V3`); a definition is immutable once answered and
versioned by `id@version`; the API's checks are built at start-up from v3; the filed PDF skips a
questionnaire it cannot look up (`questionnairePage.ts:83`); the office drawer reads the served definition,
not the application's.

| ID | Decision | Why |
|---|---|---|
| D-CQ1 | Settings → Recruiting → "The application form" gets **"Your own questions"**: a carrier adds a question with its wording, an optional hint, a kind (short answer, long answer, yes/no, one of a list, date, number) and its choices, and whether it is required. Stored in `recruiting_carrier_questions`, ordered by `position`, **retired, never deleted**; wording, kind and choices are **frozen** once saved (a different question is a new row). | §10's pattern (D-CE5): an answer must stay readable beside exactly the question asked. |
| D-CQ2 | **The set is stamped on the invitation at the first Send** (`application_invitations.carrier_questions jsonb`: id, wording, hint, kind, choices, required) — the twin of D-RS3. The applicant answers the stamp; the API validates against the stamp, never the client's copy; the filed PDF, the office drawer and the review print the stamp. | A question added on Tuesday must not refuse Monday's applicant, and a question retired later must still print on the application that asked it. |
| D-CQ3 | Answers live in the payload as `carrier_answers` (question id → answer), validated per kind from the stamp; a required one has no skip; an optional one offers "I'd rather not say". | Same rules as the built-in questions (D-RS5). |
| D-CQ4 | Shown on the questions screen after the built-in ones, **in the carrier's words on the Spanish page too** (Q-MT1's ruling: no translation now); the page marks them neither. | The carrier wrote them in one language. |
| D-CQ5 | At most 20 live questions, wording ≤ 300, hint ≤ 300, ≤ 20 choices of ≤ 80. | Bounded like every other carrier list. |

**Build.** **CQ1** — migration: `recruiting_carrier_questions` (CQ010 never deleted, CQ011 frozen columns),
`application_invitations.carrier_questions`, `send_application_invitation` widened with a defaulted
`p_carrier_questions`. **CQ2** — the reader: contract, settings list, stamp at Send, the wizard, validation
at submit, the review, the office drawer and the filed PDF.

---

## 7. Progress log

- **2026-10-31** — Audit written. Measured on production: 0 filed applications, 4 drafts, 1 real
  applicant (2/11 carrier questions, one wholly blank employer row), 0 office corrections ever.
  Findings verified on `origin/main` `e07046d` at the cited lines: D-1 (`hiringStepDrawers.ts:142`
  vs no `'hire'` branch), RT-A2 (`RoadTestPanel.vue:204` / `roadTest.ts:150`), RT-A6
  (`RoadTestPanel.vue:77`), EM-3 (`AddEmployerForm.vue:86`), EM-5 (`EmploymentForm.vue:42,86`).
  Nothing built.
- **2026-10-31 (evening)** — Second opinion (§8) and the two-day build (§9) written after a second
  read at `origin/main` `fde9a56`. Corrected: only AI005 / AI006 / HB022 are order refusals
  (DR032 is "nothing to sign yet", DR036 / HB023 are mechanical); the draft IS revision-guarded
  (0376 DA041) and the hole is the office's bare `.update` in `applicationReview.ts:247`. Added: no
  notes / activity on the record; the recruiter's hire is an org grant (SP5) pending the 0213 check;
  the process is an array with no editor; Settings → Recruiting has four things. §9 is twelve PRs
  over Saturday and Sunday, release Monday 2026-11-02 01:07 CT. Nothing built yet.
- **2026-10-31** — **P3 merged (#1871, `3144925`), migration `0533_hiring_order_advises`.**
  `send_application_invitation` without AI005, `open_packet_signing` without AI006,
  `handbook_marks_guard` without HB022; DR032 / DR036 / HB023 / PC030 kept (§8.1). Three matrices
  gained the "with the predecessor open" cases; with 0533 removed each went red (2 failures each).
  The API still refuses on its own until P4.
- **2026-10-31** — **P1 merged (#1872, `5a74cb0`), no migration.** Road test RT-A1…A10 and D-5:
  licence added in place before a pass, form reset after every record and no second pass offered,
  failed attempts listed with their form, in-service trucks (shop included), contract-worded field
  errors, Mark all satisfactory + Still needed, grouped items, examiner problems → Settings →
  Recruiting (new 409 `examiner_unavailable`), drug test open = a caution. 13/13 mutants killed.
  Kept: the §392.7 item text, which prints on the carrier's form.
- **2026-10-31** — **P5 merged (#1873, `2556eb4`), no migration.** The office edits the draft from
  its own send until the driver's FIRST PACKET MARK (not "until filing": once signing starts the
  document stays put — the one point where the old "closes at approval" reason is real). Every write
  goes through `save_application_draft` with the revision the office read (§8.1's hole closed); DA041
  → "The applicant changed this just now". Null cells offered, jobs by `key` (keyless legacy rows are
  given one on the first office write), remove with confirm, add with a street, gaps explained.
  Part 1 corrections follow to filing. 10/10 mutants killed. Gates caught two (adoption, table-writer
  ratchet), fixed in the PR.
- **2026-10-31** — **P2 merged (#1874, `f35027f`), no migration.** D-1 (record page opens
  `HireDrawer` for `roster: manage`, the step drawer says who hires otherwise), D-2, D-3, D-4; all
  twelve §3.2 sentences gone; `formatDisplayDate` in four panels; one heading style; callouts.
  7/7 mutants killed. The record-page sentence and the Travel/Send/Signing paragraphs went with P4.
- **2026-10-31** — **P4 merged (#1875, `8666e0c`), no migration.** Travel books with "Still open: …"
  (G2); send (G3) and send-for-signing (G4) warn on the permissions / approval; only `hired`, `mvr`
  and `psp` block (`REFUSING_STEPS` — the six federal checks, and consent, which is law); every other
  edge reads "Usually after: …" (`advisedFirst`); the hire is the six (handbook out, Q-WF6) and the
  hire drawer lists them before the press with an Open link (`?step=`); the MVR refusal names the
  paper-consent route (G8). 9/9 mutants killed. **Deferred, with reasons:** G6 (handbook signable
  before filing — the applicant link, its status and PDF are keyed on the filed application and it
  signs with the packet's adopted mark; a signing-flow change, not a refusal to delete; next week)
  and G7 (permissions before Part 1 — an applicant-link order, SQL AI007; not an office refusal).
- **2026-10-31** — **P6 merged (#1876, `a2ea571`), migration `0534_application_document_slots`.**
  Six new capture slots (TWIC, passport, work authorization, hazmat endorsement, road-test and
  training certificates); PDFs except the selfie and the two marks; `ordinal` with up to five of the
  multi-document slots and the one-row rule kept for the rest; a 10-argument
  `stage_application_capture` beside the unchanged 9-argument one; five new `documents.kind`s
  (`APPLICANT_PAPER_KINDS`). 27-case matrix, red without 0534. Reader: P9.
- **2026-10-31** — **P7 merged (#1877, `e18a545`), migration `0535_applicant_notes`.** Append-only
  notes (AN010–AN013), one pinned (`set_applicant_note_pinned`, AN020), `driver_id on delete
  restrict` and listed in `DRIVER_REASSIGNMENTS` so a roster merge moves them, deleted by the
  redefined `purge_applicant`; not in `RETENTION_FORBIDDEN` (working papers, not evidence). 15-case
  matrix; purge matrix fixture extended. Reader: P10.
- **2026-11-01** — **P11, desk half.** A recruiter's hire is not stopped by 0213: the hire writes
  through `hire_applicant` with the service role, where `auth_role()` is null and
  `guard_driver_lifecycle` passes (`routes/hire.ts` header); 0386's `guard_applicant_hire` reads
  only the hire's own session flag. So the one gate is `requireSection("roster")` over the org's
  editable matrix — granting the recruiter role `roster: manage` in Settings → Permissions is the
  whole change, and no migration is needed. The staging act (sign in as a recruiter, hire a test
  applicant) is the owner's: there is no recruiter test member on staging yet, and creating one
  needs the staging service key.
- **2026-11-01** — **P12a (this PR), migration `0536_hire_policy`.** `recruiting_settings.
  handbook_blocks_hire` (default false, Q-WF6). **Departure from §9 P12:** `orientation_blocks_hire`
  and `videos_block_hire` are NOT added — both steps have `evidence: null`, so switching either on
  would refuse every hire forever. They come with HW8's evidence tables. Reader: P12b.
- **2026-11-01** — **P12a merged (#1878, `6acfd07`), migration `0536_hire_policy`.** As above: the
  handbook switch only.
- **2026-11-01** — **P10 merged (#1879, `35efe8d`), no migration.** Notes on the applicant record
  (one textarea, pinned first then newest, pin/unpin through 0535's RPC; recruitment view reads,
  manage writes; the audit row never carries the body) and an Activity list derived at read time
  from invitation phases, permissions, qualification records, PSP orders (through the psp module's
  `pspOrdersFor`), texts and consent, office corrections in the form's own words, travel,
  disposition and notes. The board row reads "Last note: 2 d ago · {name}" from one batched read.
  **Not shown, because nothing stores them:** inbound texts other than STOP/START, and the
  applicant's own "text me the link". 17/17 mutants killed, including each dropped `.eq("org_id")`.
- **2026-11-01** — **P12b (this PR), no migration.** Settings → Recruiting's "Before we hire": the
  six federal checks listed and locked ("Federal requirement"), and the handbook switch.
  `hireRefusesWithout(policy)` is the one list; the checklist fold stamps it on the `hired` row, and
  `hireBlockers`, `readyToHire`, the API's refusal and the hire drawer ("· your company's rule") all
  read that row. A save from a screen served before this one keeps the switch rather than turning it
  off. 10/10 mutants killed.
- **2026-11-01** — **P12b merged (#1883, `6a95f84`), no migration.** As above.
- **2026-11-01** — **P9 merged (#1887, `88f5df8`), no migration.** Part 2's "Your documents": every
  slot offered as a photo or a PDF (`%PDF-` signature and hash checked), up to five training,
  road-test and "other" papers (`p_ordinal`), the Part 1 licence never asked again; the SSN card now
  files as `ssn_card`. The applicant record's Documents section lists captures and filed papers
  ("Sent by applicant" / "Added by {name}") and uploads through a recruitment door
  (`/api/recruitment/applicants/:id/documents`, `requireSection("recruitment")`, kind composed from
  the slot, written through evidence's `registerDocument`) — not by widening `roster`. SSN-card and
  passport images: no signed URL for a role that may not see them, on every reader. **Q-WF4b
  opened** (§6): no role sees the full SSN today, so Q-WF4 (a) had nothing to derive from;
  provisionally admin + safety manager (`canReadAllRestricted`, `identityPaperImages.ts`). SSN
  cards filed before as `other` are left as they were (append-only evidence). 21/21 mutants killed.
- **2026-11-01** — **P8 merged (#1886, `e6f7f40`), no migration.** The served questionnaire is v3:
  Q-WF3's seven `required`, enforced through `APPLICATION_CROSS_FIELD_RULES` at
  `questionnaire_answers.<id>` on client and server, and `questionnaireAnswersSchema` on the API. A
  draft carries the questionnaire version it was answered against; a draft with no version reads as
  v2 (nothing required), so the one production draft in flight is not refused for a rule its
  applicant never saw. Skips ("I'd rather not say" / "Doesn't apply") stored and printed in words;
  a job saves only with a name and a start date and a half-filled one is listed "Unfinished — finish
  or remove"; the review lists "N answers missing" with a link each; yes/no as two buttons; military
  "when" only after yes; Spanish throughout. **Departures:** the hub says "0 of 4 answered" (four
  questions are on that screen, not eleven); AF-8 (optional federal fields) untouched. 16/16 mutants
  killed; e2e-apply 31 specs, three new.
- **2026-11-01** — **HW5c part 1 merged (#1892, `e54f117`), migration `0538_driver_employment_gaps`** —
  numbered 0538, not 0537: a parallel chat took 0537 (`ads_foundation`). The office's record of a gap
  after signing; append-only, merged with the driver, deleted by the purge.
- **2026-11-01** — **HW5b merged (#1899, `a707c73`), no migration.** One `EmploymentTimeline` and one
  employer form for the applicant and the office, with the 3- and 10-year marks, gaps, the DOT question
  asked, delete always confirmed. **Deferred:** the questions for non-DOT jobs inside three years (the
  filing rule requires them) — the owner's ruling.
- **2026-11-01** — **HW8a part 1 merged (#1896, `26d7687`), migration `0539_orientation_videos`.** The
  carrier's video links (retired never deleted, the link never edited), the applicant's "I watched
  these", the opens, `videos_block_hire`. Reader: #1901.
- **2026-11-01** — **HW5d merged (#1893, `b4c37bf`), no migration.** What a previous employer corrects
  on the phone is applied to the application with one press, checked by the office first.
- **2026-11-01** — **HW5c part 2 merged (#1902, `9915f3d`), no migration.** The timeline shows what
  explains each gap; the office explains one after signing or withdraws a mistaken explanation. All five
  shipped to production in the release of 2026-11-02 (#1907).
- **2026-11-02** — **§10 written; CE1 (this PR), migration `0545_hiring_carrier_steps`.** Numbered 0545, not 0543: the office chat took 0543 (`office_chat_about`) and 0544 (`office_chat_compliance_files`) while this was built. The carrier's
  own steps and the records on each applicant, as §10 D-CE1…D-CE7. 36-case matrix; with each of nine
  guards removed in turn the matrix went red (9/9). Reader: CE2.
- **2026-11-02** — **CE1 merged (#1922, `432411c`), migration `0545_hiring_carrier_steps`.** As above.
  Renumbered twice before merge (0543, then 0544, both taken by the office chat), checked by name.
- **2026-11-02** — **CE2 (this PR), no migration.** The reader. Settings → Recruiting gets "Your hiring
  steps": add a step (name, what to do, after which built-in step, who does it, a tick or a document,
  whether the hire waits), remove it after a confirm (retired), and untick the built-in steps the carrier
  does not run. Only `carrierMayHide` steps are offered (PSP, the trip, the orientation videos and day,
  the handbook), derived from the catalogue; the six federal checks are listed as always on, and a
  stored locked key is dropped on read and ignored by the fold. The fold leaves a hidden step out of
  the rows, both readiness ranges, the hire's list and "not built yet". It emits `carrierSteps` beside
  `steps`, each with `showAfter` (the nearest emitted step at or before its place, so a step placed
  after a hidden one still shows), and counts them in done/total. The hire refuses on a step that holds
  it and is not done, naming it (`missingCarrierSteps`). The step's drawer ticks a step done in one
  press, or with one of the applicant's FILED papers for a document step (a staged capture has no
  `documents` row), and takes it back with a reason. **Departure from §10:** the carrier rows are a list
  beside `steps`, not rows in it — every `steps` reader switches on the closed `HiringStepKey` union.
  25/25 mutants killed (10 shared, 10 API, 5 web); two survivors on the first pass (declining the
  confirm; the done count) got their tests.
- **2026-11-02** — **CE2 merged (#1929, `739213c`), no migration.** As above.
- **2026-11-02** — **§11 written; S1 (this PR), migration `0550_hiring_question_document_settings`.**
  Numbered 0550, not 0547: the office chat took 0547 (`office_chat_line_links`, #1932) before this
  started, then 0548 (`office_chat_compliance_search_index`) while it was in CI and 0549 in an open PR;
  renumbered by name before merge. Two carrier settings (required questions, documents offered), the required set stamped on
  the invitation at its first Send, `send_application_invitation` widened with a defaulted fifth
  argument. Reader: S2.
- **2026-11-02** — **S2 (this PR), no migration.** The reader of 0550. Settings → Recruiting gets "The
  application form": the questions an applicant must answer (ten offered, "If so, when?" never; the
  standard seven ticked until the carrier chooses) and the documents the application asks for (the
  licence and the medical card always). The office's Send stamps the resolved set on the invitation;
  the applicant's bundle serves the stamp, `withRequiredQuestions` lays it over the questionnaire every
  screen reads (marks, skips, the task hub, the review), and the candidate carries it, so the page's
  rules and the API's agree. `submitApplication` overwrites the page's copy with the invitation's and
  runs the carrier-question rules again (`questionnaireRequiredIssues`); a required question's skip is
  not an answer. Part 2 lists only the offered documents (plus any that already hold a paper), and the
  capture route refuses a withheld slot (409 `capture_slot_not_offered`). **Departure from §11:** the
  stamp's refusal message on a stale tab is English only — every capture error from the API is (no
  code-to-Spanish map exists for them); recorded rather than built. 26/26 mutants killed (10 shared, 9 API, 7 web); two survivors on the first pass (the order a list
  is written in; the stamp offered to the office as a correction) got their tests.
- **2026-11-02** — **S1 merged (#1935, `6c139d5`), migration `0550_hiring_question_document_settings`.** As above.
- **2026-11-02** — **S2 merged (#1941, `2ab0738`), no migration.** As above.
- **2026-11-02** — **§12 written; MT1 (this PR), migration `0551_recruiting_message_wording`.** The carrier's
  wording for five applicant messages, one append-only row per save (MW010/MW011), lengths and line breaks
  checked; `sms_outbox`'s reason CHECK gains `travel` for MT3. 25-case matrix; 14/14 mutants killed (each check, both guards, the org cascade, the reason, RLS). Reader: MT2.
- **2026-11-02** — **MT1 merged (#1944, `b01c4e6`), migration `0551_recruiting_message_wording`.** As above.
- **2026-11-02** — **MT2 (this PR), no migration.** The reader of 0551. `RECRUITING_MESSAGES` (invitation,
  application ready, reminder, videos) and the closed placeholder list in `packages/shared/src/recruitingMessages.ts`;
  one renderer (`applicantMessages.ts`) for the email and the text of each, which the API sends with and Settings
  previews with (D-MT7). The four old per-message functions are kept as its standard-wording calls, so their
  callers and tests did not move. The invite, the Send, the reminder sweep, the videos send and the outbox's text
  render (moved to `smsOutboxRender.ts` for the file budget) read the carrier's newest wording and the applicant's
  first name; a queued text is worded when it goes (D-MT6); a failed wording read sends the standard words.
  Settings → Recruiting's "Messages": each message with "Edit the wording" (four fields, the standard words as
  their placeholders, a preview and the text's part count) and "Use the standard wording". The audit row names the
  message and the parts written, never the words. **Departure from §12:** the GET also answers the carrier's
  name, so the preview's `{carrier}` is the one the senders write (the session holds no org name).
- **2026-11-02** — **MT2 merged (#1948, `f2a88f4`), no migration.** As above.
- **2026-11-02** — **MT3 (this PR), no migration.** "Send the trip to the applicant" on the travel panel, for a
  live trip that has not left: the email (to the invitation's address) and the text (outbox reason `travel`,
  0551) in the carrier's `travel` wording, with the trip's lines fixed below it — how, leaves, arrives on the
  carrier's clock with the zone named, and the confirmation. No link. The outbox row carries only the trip's
  id; the text re-reads the trip when it goes and is dropped if the trip was cancelled or has left
  (`stillWanted`). Refused: a cancelled trip (409 `trip_cancelled`), a departed one (409 `trip_departed`),
  another application's or carrier's (404). Audit `recruiting.travel_sent` without the confirmation; the
  activity list names the text ("the trip details"). The trip joins Settings → Recruiting → Messages as a
  fifth message (`{first_name}`, `{carrier}`; no `{days}`). 16 of 21 mutants killed on the first pass. Of the five
  survivors, the three real ones (the missing-trip refusal checked only as a throw, the carrier zone untested off a Chicago clock, the
  text's trip id) got their tests and were then killed; the other two were equivalent (an audit field that
  never holds the confirmation; a malformed id the read already answers 404).
- **2026-11-02** — **MT3 merged (#1951, `8d1d2ac`), no migration.** As above. §12 complete.
- **2026-11-02** — **§13 written; SP1 (this PR), no migration.** The three wait screens show "Where your
  application is" — the four stages from the served phases (`applicantStages.ts`) — and "For you to do": the drug
  test, the orientation videos (linked to the videos page on the same token), the trip, as kinds served on the
  bundle (`owes`, `applicantOwes.ts`, folded by `applicantOwed` in `@silvicom/shared`). The "nothing more to do"
  note shows only when nothing is owed. A test pins that the bundle carries no site, time or reference. English
  and Spanish. 19/19 mutants killed: on the first pass one did not apply and one broke the template (both rerun
  and killed), and one real survivor — the phase chain dropping the phases on its way to a wait screen — got
  `applicantStatusRouter.test.ts`, which also kills the owed list dropped the same way.
- **2026-11-03** — §14 written from the owner's sixteen steps. **OF1** built (no migration): rows over steps
  (`hiringChecklistRows.ts`, `shownIn`/`listed` on the catalogue); Part 1 + permissions, driving record +
  medical card, application + approval are one row each; previous employers and live orientation unlisted;
  medical card beside the MVR and videos before travel; "Hired" is "Application closed" (same act, D-OF5);
  the record page's explainer removed; the drawer opens a row and draws each half (`HiringStepBody.vue`).
  26/26 mutants killed (two survivors on the first pass — mixed us/them row state, a carrier step anchored
  on a merged half — each got a test).
- **2026-11-03** — OF1 merged (#1955, `8b5f039`), no migration. **OF2 + OF3** built (no migration): the Part 1
  drawer shows every picture the applicant sent (`ApplicantPhotoStrip.vue`) and opens it in `FileGallery`,
  given a `kinds` filter (`APPLICANT_DOCUMENT_KINDS`) — read through `/api/compliance/documents`, which a
  recruiter may read (`roster: view`) and which already withholds an SSN card's picture (Q-WF4). The road
  test's rows break on the drawer's width (`@container`, `@2xl:`), not the screen's — measured at 1440 and 820,
  `sm:` squeezed each item to one word per line inside a 448 px drawer — and it opens in the wide drawer.
  Seen in a browser at 1920/1440/820/390. 12/12 mutants killed (one survivor first: no test opened the Part 1
  drawer at all; it got one).
- **2026-11-03** — **OF4, PSP production check (no code).** The order path already holds every guard the owner
  asked for: the applicant's signed consent (refused before anything is built), the caller's password again
  (step-up) on every order, a monthly cap (`PSP_MONTHLY_LIMIT`, default 50), one order in flight per driver
  (unique index), the request body stored with the licence and birth date redacted, an audit line per order
  (`compliance.psp_record_ordered`), and a two-switch production interlock. Production's settings (read on
  Railway, values of secrets not printed; Parameter Store on AWS not readable from this machine):
  `PSP_ORDERS_ENABLED=false`, `PSP_ENVIRONMENT=uat`, `PSP_PRODUCTION_ACKNOWLEDGED=false`,
  `PSP_UNIT_PRICE_USD=10`, `PSP_MOTOR_CARRIER_ID` set; the carrier's DOT number is on its org row; 0 PSP
  orders ever placed. `pnpm psp:uat --verify-key` (GET /DayMonitored45 — neither mints nor bills): the
  August production token is **expired**; `docs/psp-docs/apitoken-new.txt` (10/13) **authenticates against
  production**. PSP tokens live 60 days, so it lapses about **2026-12-12**. Going live is four settings, the
  owner's to set on the production host: the new token as `PSP_API_KEY_PRODUCTION`, `PSP_ENVIRONMENT=production`,
  `PSP_PRODUCTION_ACKNOWLEDGED=true`, `PSP_ORDERS_ENABLED=true`.
- **2026-11-03** — **OF5** built (no migration): the MVR and Clearinghouse drawers open the vendor's portal in a
  new tab (`HIRING_VENDOR_PORTALS`, shared; `VendorPortalCard.vue`) with what to do there, above the form whose
  Scan drop files the PDF. Samba = the carrier's portal account (Q-OF1's recommendation), never the API.
- **2026-11-03** — OF2+OF3 merged (#1958, `dd9264e`). **OF6a** built, **migration 0555** (`mvr_report` in the
  `document_reads` profile CHECK; 0552 is the hiring chat's, 0554 #1959's — re-check by name before merging):
  the reader's fourth profile — `mvrReportContract.ts` (the licence, its status and class, the medical
  certification the state holds, every violation, crash and withdrawal; never a birth date or address), its
  prompt, `mvrReportEvidence` (one reader; the OCR witness on the licence, status, expiry and medical), and the
  gate `MVR_REPORT_READING` (default on). The checking layer is `mvrReportFindings` (shared, pure): **stop** —
  another licence number, a status that is not a valid word, expired, not medically certified, a withdrawal
  in force, no record found; **check** — another state or name, a violation or crash in three years (how many
  in a CMV), a withdrawal ended inside three years, anything it could not read. Nothing writes the profile yet:
  OF6b (the drawer's read) is its first writer. 19/19 mutants killed.
- **2026-11-03** — OF5 merged (#1960). **OF6b** built (no migration; the first writer of 0555's `mvr_report`):
  "Check it with AI" on the driving-record drawer. The dropped PDF is registered and uploaded ONCE as the
  driver's `mvr` scan through the hiring-evidence door (`uploadHiringEvidenceScan`), `POST …/mvr-check` hands
  those exact bytes (downloaded through evidence, hash-checked) to the reader (`intakeStoredBytes`, IC10's
  shape; boundary edge `recruiting -> document-reading`), and `GET …/mvr-check/:documentId` answers by the same
  sha256 with the read parsed through the profile and `mvrReportFindings` against the applicant — stops above
  checks, then "Use these values below" fills the form (date as a day, state as its code) and the record cites
  the checked document (`useRecordHiringAct`'s `documentId`) with no second upload. The poll ends after three
  minutes (`MVR_CHECK_WAIT_MS`) — a file intake refuses never produces a read. Audit
  `recruiting.mvr_check_started`. Seen in a browser at 1440. 18/18 mutants killed.
- **2026-11-03 (evening)** — OF6a #1962 (0555) and OF6b #1965 merged. Owner: Med-Stop keys fixed; Ignev withdrawn
  (researching another vendor); Samba stays an external link (Q-OF1 ruled). §14.1 checks the first message step
  by step. Step 3's "same viewer as vehicles and trailers" was still a new-tab link for a filed scan; it now opens
  in `FileGallery` (this merge). Drug-test ordering measured against the office's real orders: MEDSTOP-PLAN
  §7A.21 (never switched on; one order in three cancelled; the time is a 4 pm deadline; questions Q-MSO1–4).
- **2026-11-04** — The owner ruled Q-WF4b, Q-MT1, Q-OR7, Q-CE1/CE2 and Q-RS2. §15 written: identity pictures as
  a carrier permission (IDP1/2), the §382.601 policy filed, shown and named by the p28 receipt (DAP1/2), and the
  carrier's own questions stamped at Send (CQ1/2). Q-DAP1 (the policy text) is the owner's.
- **2026-11-04** — **IDP1 merged (#2009), migration `0564_org_role_permissions`** — numbered 0564, not 0563: the leads chat took
  0563 (`lead_intake_failing_alert`) while it was in CI; renumbered by name. It also gives `write_access_cell` (0395) the
  table, so a switch and its audit row land in one transaction. 22-case matrix, 6/6 mutants killed. **IDP2 (#2016)**: the
  Sensitive papers card on Settings → Permissions → Roles; both picture readers read the org's switches per request;
  **departure:** a failed read is closed, not the default (D-IDP3 amended). 9/9 mutants killed.
- **2026-11-04** — **§15.2 revised.** The owner supplied the policy (18-page scan) and asked for it as a document like the
  others: D-DAP1 now makes it the handbook's kind of document, not an upload. #2018 reworked to match (0565: `policy_version`
  on the mark, no table). Owner ruled the typos be corrected (D-DAP6): every correction on record, none changing a rule.
  Q-DAP2 (proofread) and Q-DAP3 (Vermeda vs Varmeda) are the owner's.
- **2026-11-04** — **DAP1 merged (#2018, `d122c0e`)**; 0565 checked free by name first; main's CI and `migrate-staging`
  green. **DAP2 (the reader, no migration):** `GET /api/public/application/:token/drug-alcohol-policy.pdf` on the
  ceremony's per-link bucket (any live link; the FILED copy once the packet is filed). `p28` now carries
  `gives: "drug_alcohol_policy"` in `PACKET_PLACEMENTS` — the one fact the API stamps from (`record_packet_mark`'s 14th
  argument: `DRUG_ALCOHOL_POLICY_VERSION` on p28, null elsewhere) and the walk gates on ("Read the drug and alcohol
  policy"; Sign off until opened; Spanish label says the policy is in English, Q-MT1). The policy's own sign place is
  derived to the same id and throws at import if they part. Filing: `ensureDriverFiledApplication` files it as
  `drug_alcohol_policy` through `fileGeneratedDocument` under `derivedUuid("drug-alcohol-policy:<application>")` —
  idempotent, and healed by the next call that finds the packet filed; best effort (D-APP9). Nothing is filed for a
  summary, a pre-0565 p28 (D-DAP5), or a p28 for another text (logged). Driver's file label "Drug and alcohol policy
  (signed)". **Departure:** the walk's link names no page count — a number in the web copy would restate the
  renderer's. 21/21 mutants killed. **Next:** once DAP2 has been in production a release, a migration drops the
  13-argument `record_packet_mark` (D-DAP4); Q-DAP3 still the owner's.
- **2026-11-04** — **CQ1, migration `0567_recruiting_carrier_questions`** (schema only; CQ2 is its reader) — numbered
  0567, not 0566: the ads chat merged `0566_ads_campaign_brand_kit` minutes after 0566 was checked free; renumbered by name.
  `recruiting_carrier_questions`: wording ≤300, hint ≤300, kind one of the questionnaire's own six (`QUESTION_KINDS`
  less `table`, so CQ2 reuses the questionnaire's fields, schema and PDF page), choices only on `select` (2..20 of 1..80,
  checked by an immutable helper), `required`, `position`. Never deleted (CQ010); wording, kind and choices frozen
  (CQ011) — hint, required and position stay editable; retiring one-way (CQ012); ≤20 live per carrier under an
  advisory lock (CQ013). `application_invitations.carrier_questions jsonb` (an array of ≤20), stamped by
  `send_application_invitation`'s new defaulted sixth argument on the first Send only; the 5-argument call still
  resolves and stamps nothing. 29-case matrix; 24/25 mutants killed — the survivor (dropping the REVOKE) is
  equivalent, because 0412 already closes new functions to clients. Producer waiver until CQ2.
