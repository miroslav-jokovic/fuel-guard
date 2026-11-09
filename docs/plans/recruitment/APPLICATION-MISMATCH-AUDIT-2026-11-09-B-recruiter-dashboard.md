# B — Recruiter dashboard: applicant-data editability inventory

Read-only audit of origin/main checkout at `scratchpad/main`, 2026-11-09. All paths are relative to
that checkout. "Manage" = `requireSection("recruitment")` (route) / `session.can("recruitment")`
(client); "view" = `requireSection("recruitment","view")`.

Owner's complaint: *"Not all fields are editable on our Dashboard."* Short answer: **correct.** There
are **four separate correction doors**, each covering a different, partly overlapping slice of the
applicant's facts, scattered over three different drawers. Several facts have **no door at all**, two
doors **silently lose** their edit at filing, and two doors **are not shown to the applicant before
they sign** and leave no trace in the drawer's change list or the activity feed.

---

## 0. The four correction doors (reference for everything below)

| # | Door (UI) | Where it lives | Endpoint | Gate | Writes | Correction trail |
|---|---|---|---|---|---|---|
| D1 | "Correct an answer" list — `ApplicationAnswerList.vue` | Application review drawer (`ApplicationReviewDrawer.vue:328-342`) | `PATCH /api/recruitment/applications/:inv/answer` (`routes/applicationReview.ts:153`) | Route: manage. **Client: none** (only the phase flag `editable`) | `application_drafts.payload` via `save_application_draft` RPC with revision check (`applicationReview.ts:267`) | `application_edits` row (before/after/path/edited_by) + `audit_log` `application_answer_edited` (`applicationReview.ts:280-297`). Shown to applicant before signing (`applicationHandoff.ts:59`), in drawer "What you changed", in Activity. |
| D2 | Jobs timeline + `EmployerFormDrawer` — `OfficeJobsSection.vue` | Same drawer (`ApplicationReviewDrawer.vue:347-356`) | same `PATCH …/answer` with ops `set` / `add_employer` / `remove_employer` / `explain_gap` (`packages/shared/src/applicationReviewContract.ts:57-80`) | Route: manage. **Client: none** (`editable` only) | draft payload `employers[]`, `employment_gaps[]` | Same as D1. |
| D3 | "Correct these" (Part 1) — `PartOneCorrection.vue` | Same drawer (`ApplicationReviewDrawer.vue:290-294`), v2 links only | `POST /api/recruitment/applications/:inv/part-one` (`routes/applicationReview.ts:211`) | Route: manage. Client: `session.can("recruitment")` (`PartOneCorrection.vue:45`) | `record_applicant_intake(p_overwrite=true)` → `application_intakes`, `application_intake_licences` (replaced whole), `drivers` contact/CDL class/expiry, and via identity writer `drivers` + draft DOB/CDL no./state (`applicantPartOneCorrection.ts:111-170`) | **`audit_log` only** (`application_part_one_corrected`, field names, no values). **No `application_edits` row.** |
| D4 | "Date of birth and licence → Correct" — `ApplicantIdentityCorrection.vue` | **Permissions-signed step drawer** (`HiringStepBody.vue:189-194`) and **Road-test step drawer** (`RoadTestPanel.vue:35`) — NOT in the application drawer | `POST /api/recruitment/applications/:inv/identity` (`routes/applicationReview.ts:184`) | Route: manage. Client: `session.can("recruitment")` (`ApplicantIdentityCorrection.vue:47`) | `record_applicant_identity(p_overwrite=true)` → `drivers.date_of_birth/cdl_number/cdl_state` + draft; on v2 also Part 1 licence list position 0 (`applicantIdentity.ts:185-230`) | **`audit_log` only** (`application_identity_corrected`). **No `application_edits` row.** |

Plus post-filing doors on non-evidence tables: `EmploymentHistorySection` (PATCH/DELETE
`driver_employment_history`), `RecordGapBox` (append/withdraw gap rows), `CallCorrectionApply`
(pre-filing only, routes through D1/D2).

---

## 1. Surface map

```
/recruitment (RecruitmentPage.vue)            board: name · stage · next action · waiting on · days waiting  (no edits; kebab Hire/Archive/Purge)
/recruitment/:id (ApplicantRecordPage.vue)
 ├─ PageHeader  — drivers.full_name only (:191-194)
 ├─ ApplicantNotesPanel        (append-only notes)
 ├─ ApplicantActivityList      (timeline)
 ├─ HiringChecklistCard        (rows → step drawers)
 │    └─ HiringStepDrawer → HiringStepBody.vue (body chosen by hiringStepDrawers.ts:134-158)
 │         invitation_sent      → ApplicationInviteCard
 │         intake_completed     → ApplicationInviteCard + SelfieCheckPanel + ApplicantPhotoStrip
 │         permissions_signed   → AuthorizationsPanel + ApplicantIdentityCorrection (D4)
 │         application_sent     → SendApplicationPanel
 │         application_filled   → [Open the application] button + EmploymentHistorySection
 │         office_approved      → [Review and approve] button
 │         mvr / clearinghouse / drug_test → VendorPortalCard + RecordedActPanel (+DrugTest/Medstop/ClearinghouseConsent)
 │         psp                  → PspRecordsSection
 │         medical_certificate  → link to driver's DQ file (roster permission)
 │         travel_booked        → TravelPanel
 │         road_test            → RoadTestPanel (+ ApplicantIdentityCorrection D4 again)
 │         application_signed   → SendForSigningPanel
 │         employment_investigation → EmployerCallsPanel (+CallCorrectionApply) + EmployerInquirySection
 │         hired                → HireDrawer (first day only)
 │         handbook / orientation_videos → HandbookPanel / OrientationVideosPanel
 ├─ ApplicantDocumentsSection  (list + office upload)
 ├─ DispositionSection         (append-only outcome rows)
 └─ ApplicationReviewDrawer (features/apply) — opened from the step drawers via `review` emit
      ├─ state badge + callouts
      ├─ applicant's correction note
      ├─ PartOneCorrection (D3)
      ├─ read-only summary (buildReviewSummary, 7 sections)
      ├─ "Correct an answer" (D1, ApplicationAnswerList)
      ├─ OfficeJobsSection (D2)
      ├─ "What you changed" (application_edits)
      └─ footer: Close · Open as a PDF · Approve and send for signing
```

---

## 2. ApplicantRecordPage.vue (`apps/web/src/pages/ApplicantRecordPage.vue`)

Data: `supabase.from("drivers").select("*")` directly from the browser (`:82`) — RLS-scoped read of the
whole `drivers` row.

| Label | Source | Editable? |
|---|---|---|
| Page title = applicant name | `drivers.full_name` (`:192`) | **Read-only here.** The draft's first/middle/last are editable via D1, but `drivers.first_name/last_name` are only patched at filing (`packages/shared/src/applicationIntake.ts:386-393`), so the header/board keep showing the invite-time name until the application is filed. Roster edit at `/drivers/:id` needs `roster` section (recruiter normally lacks it). |
| (nothing else) | — | — |

**Fetched but never displayed on this page:** every other `drivers` column — email, phone, address,
DOB, CDL number/state/class/expiry, emergency contact, hire date. Only `status`, `full_name` and the
three identity keys (passed down to D4) are used. There is **no applicant profile/contact card**: to
see an applicant's phone or address the recruiter must open the application drawer.

## 3. ApplicationReviewDrawer.vue (`apps/web/src/features/apply/ApplicationReviewDrawer.vue`)

Data: `GET /api/recruitment/applications/:inv/review` (view) → `applicationForReview`
(`apps/api/src/modules/recruiting/applicationReview.ts:140-178`):
`application_invitations` (phases, carrier_questions) · `application_drafts.payload, revision` ·
`application_edits` · `partOneFactsView` (`application_intakes` phone/address/prior_positive_2y,
`drivers.cdl_class`, `application_intake_licences`; `applicantIntake.ts:248-287`).

The summary composes `fromDraftPayload(payload)` + `applyPartOne` (Part 1 overlaid, `:79-81`) and
renders `buildReviewSummary` (`reviewSummary.ts:136-318`). **It does NOT apply `identityOnRecord`**
(the `drivers` DOB/CDL overlay filing applies at `applicationSubmit.ts:321-324`), so the summary can
differ from what will be filed when DOB/CDL was edited via D1.

### 3a. Summary fields and editability

"v2" = invitation has a Part 1 row (`partOne` non-null). "Legacy" = no Part 1.

| Section · Label (as shown) | Data source (draft path / table) | Editable — v2 | Editable — legacy |
|---|---|---|---|
| Identity · Name | draft `first_name/middle_name/last_name` | D1 (three text rows) | D1 |
| Identity · Other names | draft `other_names[i]` | D1 only for existing entries; **cannot add or remove** a name | same |
| Identity · Date of birth | draft `date_of_birth` | **D1 offers it but the edit is lost** (see Gap G1); real door is D4 (other drawer) or D3 indirectly | same (D1 lost; D4 works) |
| Identity · Email | draft `email` | D1 (draft only — **does not update `drivers.email` or `application_invitations.email`**, which is where approval / signing mail goes) | same |
| Identity · Phone | Part 1 `application_intakes.phone` overlaid | D3 (hidden from D1, `editableFields.ts:161`) | D1 (draft `phone`) |
| Addresses · Address N street/city/state/ZIP | current address: Part 1 intake; history: draft `addresses[i]` | current: D3. History rows: D1 per cell (raw `line1`, `state` code, `postal_code`) | D1 |
| Addresses · Lived there (from–to) | draft `addresses[i].from/to` (`YYYY-MM`) | D1, as raw text `2024-03` | D1 |
| Addresses · **add/remove an address** | — | **No door** (D1 never creates rows, `editableFields.ts:13-23`) | **No door** |
| Licence · Number / State / Expires | Part 1 licence position 0 | D3 (or D4 for number/state + DOB) | D1 for `cdl_number/cdl_state/cdl_expires_at` — **number/state edits lost at filing** (G1); D4 works |
| Licence · Class | `drivers.cdl_class` (via Part 1) | D3 (`cdl_class` select) | D1 (`cdl_class` text) |
| Licence · Licence N (authority/number/expires/kind) | v2: Part 1 licences 1..n, cut to unexpired (`applicationComposition.ts:123-138`); legacy: draft `additional_licences[i]` | D3 (add/remove/edit licences; `kind` not editable, always null) | D1 cells only; **cannot add/remove** |
| Employment · Employer N (name, position, worked there, where, phone, reason, operated CMV, DOT-regulated, FMCSR, safety-sensitive) | draft `employers[]` | D2 (full form, add, remove w/ confirm) — excluded from D1 (`ApplicationReviewDrawer.vue:97-99`) | D2 |
| Employment · Gaps (date range → explanation) | draft `employment_gaps[]` | D2 `explain_gap` (replace) | D2 |
| Employment · Experience | draft `experience` | D1 | D1 |
| Employment · Equipment N | draft `equipment_experience[i]` | D1 per cell (`equipment_class` enum typed as raw text); **cannot add/remove rows** | same |
| Safety · Accidents (date · nature · fatalities · injuries · hazmat) | draft `accidents[i]`, `declares_no_accidents` | D1 per cell of EXISTING rows and the "no accidents" boolean. **Cannot add a missed accident or remove one** | same |
| Safety · Convictions (date · offence · state · penalty) | draft `violations[i]`, `declares_no_violations` | same as accidents — **no add/remove** | same |
| Safety · Licence ever denied/suspended/revoked + detail | draft `licence_ever_denied`, `licence_denial_detail` | D1 — but `licence_ever_denied` is only offered if answered; `toDraftPayload` omits it while null (`draft.ts:262`), so an **unanswered** one has no row to fill | same |
| Safety · Prior failed pre-employment test (§40.25(j)) | Part 1 `application_intakes.prior_positive_2y` | **No door, by design** ("the applicant's statement", `applicantScreeningContract.ts:219-224`); hidden from D1 (`PART_ONE_COMPOSED_KEYS`) and excluded from D3 | D1 (draft `prior_failed_pre_employment_test`) — inconsistent with the v2 rule |
| Questions · carrier questionnaire (scalar answers) | draft `questionnaire.{id}` | D1 (labelled by **live** questionnaire, `:84,98`) | D1 |
| Questions · carrier questionnaire (table answers) | draft `questionnaire.{id}` arrays | **No door** (path depth limit, `editableFields.ts:80-87`) | same |
| Questions · carrier's own questions (§15.3) | draft `carrier_answers` labelled by invitation stamp | **No door** — "they go back to the applicant" (`editableFields.ts:59-62`), but **no send-back act exists** (see G5) | same |
| Documents · CDL front/back, medical card, … | `captures` | **Always shows "None declared"** — the drawer passes `captures: []` (`:87`), so every document row reads as none, even when photos were sent (UI bug U1) | same |
| Applicant's correction note (callout) | draft `correction_note` | Read-only (theirs) | — |
| SSN | never in draft; sealed at filing (`applicationSubmit.ts:327`) | Not shown, **no door** | same |

### 3b. Other drawer elements

| Element | Source | Notes |
|---|---|---|
| State badge | `state` from phases | — |
| "What you changed" list | `edits[]` (`application_edits`) | Shows path/before/after/time. **`editedBy` is returned but never displayed** (`:374-391`). D3/D4 corrections **never appear here** (no edits row). |
| Approve and send for signing | `POST …/approve` | Shown when `editable && awaiting_review`, **no client permission check** (`:411-419`). Doesn't invalidate the checklist query (`useApplicationReview.ts`, `useApproveApplication` invalidates only the review key). |
| Open as a PDF | `GET …/preview.pdf` | hidden once certified (by design). |

### 3c. API returns but UI never shows
- `edits[].editedBy` (who made each correction).
- `partOne.asOf` used only for expiry wording.
- Part 1 columns never served at all, so never shown anywhere on the recruiter side:
  `application_intakes.dot_program_30d`, `dot_tested_6m`, `dot_random_12m` (§382.301(b) answers),
  `endorsements` (declared H/N/X/T/P/S), `medical_card_pending`, `fcra_summary_version/_shown_at`
  (`supabase/migrations/0376_applicant_flow_v2.sql:93-130`). `rg` finds no API reader for the first
  four outside the applicant's own Part 1 write path.

## 4. ApplicationAnswerList.vue (D1)

- Every field is a plain `BaseInput` or a Yes/No select (`:82-98`). `EditableField.kind` is only
  `text|boolean` (`editableFields.ts:38`). Dates (`1980-04-01`, `2024-03`), state codes, phone (E.164
  `+1…`), equipment class enum, numbers (fatalities) are typed as raw strings; a wrong format comes
  back as `"That is not a valid answer for this field: <zod message>"` (`applicationReview.ts:258-261`).
- On Save the typed value is discarded before the server answers (`:54-59`); a refusal loses what the
  recruiter typed.
- Labels "Address 2 · Line 1" etc. come from `describeField`; search box filters by label.

## 5. PartOneCorrection.vue (D3)

Fields: Mobile phone, CDL class, Street, Apt, City, State (US only), ZIP, and licence rows (state/
province, number, issuing authority, expiry; add/remove). **Not included:** name, email, DOB (D4),
endorsements, §40.25(j), §382.301(b) answers, medical-card-pending (`PartOneCorrection.vue:22-36`,
`applicantScreeningContract.ts:219-224`).
- All-or-nothing: every field required (`partOneCorrectionSchema`, `applicantScreeningContract.ts:226-239`);
  a Part 1 with a non-mobile/blank value cannot be saved partially.
- Shows no current values until "Correct these" is pressed (values are only visible composed into the
  summary above/below).
- Shown whenever `state !== 'certified'` (`ApplicationReviewDrawer.vue:291`) and the server only
  refuses on `submitted_at` (`applicantPartOneCorrection.ts:145-150`) — **it does not check
  `signingStarted`**, unlike D1 (`applicationReview.ts:230`). See G3.
- After save invalidates only the review query (`useApplicationReview.ts`, `useCorrectPartOne`), not
  `driver-detail` or the checklist, though it rewrites `drivers` and the MVR jurisdictions.

## 6. HiringStepBody drawers

| Drawer | Fields displayed | Editable? |
|---|---|---|
| invitation_sent / intake_completed → `ApplicationInviteCard` | invitations table (created, To/email, expires, state); filed "Certified by {signed_name} on {date}" | Create link (email optional), resend (same email), revoke. **Invitation email cannot be changed** except revoke + new link. |
| intake → `SelfieCheckPanel`, `ApplicantPhotoStrip` | selfie vs licence photo; all captures | Verdict (matches/doesn't/unclear) — manage. Photos read-only. |
| permissions_signed → `AuthorizationsPanel` | five releases + wording version | Record paper release (manage). Signed releases append-only. |
| permissions_signed → `ApplicantIdentityCorrection` (D4) | DOB, licence number, state (from `drivers`) | D4 — manage. |
| application_filled → `EmploymentHistorySection` | `driver_employment_history` (post-filing transcription), inquiry status badge, source, "seen in PSP", gaps incl. after-signing gaps | PATCH/DELETE employer (`routes/employment.ts:134-221`, manage, audited `compliance.employment_updated/removed`); gaps append + withdraw (`RecordGapBox`). Drawer says "The signed application is not changed." |
| office_approved | text + button | — |
| mvr / clearinghouse / drug_test → `RecordedActPanel` | `qualification_records` (date, result, performed by, reference, scan) | Append-only; correction = "Record another" new row (`RecordedActPanel.vue:40-44`). Gated by `canReadKind`. |
| psp → `PspRecordsSection` | PSP orders/reports | Order / import a new report (append). |
| medical_certificate | link to DQ file | **Not editable here**; needs `roster`; recruiter told "Ask a safety manager" (`HiringStepBody.vue:293-305`). |
| travel → `TravelPanel` | mode, depart, arrive, confirmation | Book / change (replace) / cancel — manage. |
| road_test → `RoadTestPanel` | attempts, examiner, truck, trailer, miles, checklist, ratings | New attempt; also hosts D4 again. |
| packet → `SendForSigningPanel` | — | Send link. |
| investigation → `EmployerCallsPanel` + `CallCorrectionApply` | calls per employer and outcomes | "Apply" a corrected answer (dates/position/reason/CMV/DOT-tested) into the draft through D1/D2 (`applyCallCorrection.ts`), only before filing; after filing says "correct the job on the employment list instead". |
| investigation → `EmployerInquirySection` | §391.23 inquiries | Record answer (append). |
| hired → `HireDrawer` | First day | Set at hire. |

## 7. ApplicantDocumentsSection.vue

Displays: label (slot), source ("Sent by applicant" / "Added by …"), date, PDF, "Filed when the
applicant finishes", view. Office can **add** a document for the application slots
(`APPLICANT_DOCUMENT_SLOTS` = capture slots) — `POST /api/recruitment/applicants/:id/documents`
(manage). **No replace, retire, re-label, or wrong-slot fix**, and no metadata (expiry, number) — by
the evidence-table rule a correction should be a superseding row, but no supersede act exists here.

## 8. DispositionSection, ApplicantNotesPanel
Append-only by design; a change is a new row ("Current" = newest). Correct per repo rules.

---

## 9. Editability gaps (the owner's complaint, fact by fact)

Rule from repo CLAUDE.md: filed evidence (`driver_applications`, documents, qualification records)
is append-only; corrections must be new rows. Before filing the draft is mutable (with
`application_edits` as the correction ledger). So the question per fact is "is there a correction
mechanism", before and after filing.

| Fact | Before filing (draft/Part 1) | After filing | Verdict |
|---|---|---|---|
| Name (first/middle/last) | D1 | No amendment mechanism for the filed application; `drivers` name via roster page only | Partially — header/board stale until filing |
| Other names / aliases | D1 edit existing only; no add/remove | none | **Gap** |
| Date of birth | D4 (Permissions/Road-test drawer). D1 offers it **and the edit is silently overwritten** by `identityOnRecord` on the next applicant autosave (`applicationDraft.ts:175-180`) and at filing (`applicationSubmit.ts:321-324`) | roster page (`drivers`) | **G1 (misleading)** |
| SSN | none (never in draft, entered at signing) | none | **Gap** (no office path; only last4 used in PDFs) |
| Phone | v2: D3; legacy: D1 | roster | OK pre-filing |
| Email | D1 changes draft only; invitation/drivers email not updated; resend uses old address | none | **G2** |
| Current address | v2: D3; legacy: D1 | roster | OK |
| Address history (3 yrs) | D1 edit existing cells; **cannot add a missed address or remove one** | none | **Gap** |
| CDL number/state | v2: D3 or D4; legacy: D4 (D1 offered but lost, G1) | roster (does NOT update Part 1 licence list) | OK-ish, two doors in two drawers |
| CDL class | D3 / D1 legacy | roster | OK |
| CDL expiry | D3 / D1 legacy | roster | OK |
| Other licences | D3 (v2); legacy D1 existing cells only | none | partial |
| Endorsements | **Not displayed, not editable** (stored in `application_intakes.endorsements`, read by nobody) | — | **Gap (invisible)** |
| Restrictions | not collected in application | roster | n/a |
| Medical card (expiry/examiner) | Only a photo slot + `medical_card_pending` flag (not displayed); no fields | DQ file via roster permission; recruiter can't | **Gap for recruiters** |
| Employment history | D2 (full), CallCorrectionApply | `driver_employment_history` PATCH/DELETE + gap rows | OK — the best-served fact |
| Equipment experience | D1 existing cells only, raw enum text | none | partial |
| Accidents | D1 existing cells; **cannot add/remove**; flipping "no accidents" to false leaves nothing to fill | none | **Gap** |
| Convictions/violations | same as accidents | none | **Gap** |
| Licence denied/suspended/revoked | D1 only if answered (null omitted from payload) | none | partial |
| §40.25(j) prior positive | v2: none (by rule — applicant's statement); legacy: D1 | none | by design, but inconsistent v2 vs legacy |
| §382.301(b) DOT program/tested/random | **Not displayed anywhere, not editable** | none | **Gap (invisible)** |
| Carrier questions (§15.3) | none — "go back to applicant", but no send-back act | none | **G5** |
| Questionnaire table answers | none | none | Gap |
| Emergency contact | not in the application at all; `drivers.emergency_contact_*` via roster only | roster | **Gap for recruiters** |
| Work authorization | not collected (no slot, no field) | — | Not modelled |
| Documents | add only | add only | **No supersede/retire** |
| Drug/alcohol tests, MVR, Clearinghouse, PSP | append-only records, "record another" | same | OK by design |

### Key non-propagation / consistency findings

- **G1 — D1 offers DOB (all links) and CDL number/state (legacy links) but the value never sticks.**
  `editableFields` excludes only `NOT_AN_ANSWER` and Part 1 composed keys (`editableFields.ts:49-63,
  109-114`); `date_of_birth` is in neither. The applicant's next autosave lays `drivers`' identity over
  the payload (`applicationDraft.ts:175-180`) and filing does the same (`applicationSubmit.ts:321-324`).
  The drawer then shows the edited value in "What you changed" and the summary, while the filed PDF
  shows the `drivers` value. The drawer's own comment says DOB is "corrected beside the permissions"
  (`ApplicationReviewDrawer.vue:91-93`) — but the list still offers it and nothing links to D4.
- **G2 — email.** D1 edits draft `email`; approval and signing notices use
  `application_invitations.email` (`applicationReview.ts:85`), unchanged. `ApplicationInviteCard`
  resends to the stored address with no way to change it (`ApplicationInviteCard.vue:154-163`).
- **G3 — D3 and D4 skip the signing freeze.** D1 refuses once the applicant has made a packet mark
  (`applicationReview.ts:198-206,230`). D3 (`applicantPartOneCorrection.ts:138-170`) and D4
  (`applicantIdentity.ts:185-230`) check only `submitted_at`, so phone/address/licences/DOB can move
  under a driver mid-signing.
- **G4 — D3/D4 corrections are invisible to the applicant and to the office's history.** Only D1/D2
  write `application_edits`. The applicant's pre-signing "what the office changed" reads
  `application_edits` only (`applicationHandoff.ts:59-75`); so does the drawer's "What you changed"
  and the Activity feed (`applicantActivity.ts:103-104`). D3/D4 leave only an `audit_log` row with
  field names and no values. That contradicts the drawer's own promise "they are shown every change
  first" (`ApplicationReviewDrawer.vue:272-275`).
- **G5 — No "send back to applicant" act.** Carrier answers, table answers and the §40.25(j) answer
  are declared "the applicant's to give", and the approved-and-signing callout says "ask them for a
  new application" (`:276-279`) — but the only mechanisms are revoke + new invitation. There is no
  office → applicant correction request (only applicant → office "Something wrong? Tell us").
- **G6 — Rows cannot be added** for addresses, accidents, convictions, equipment, other names,
  additional licences (legacy) — only employers have add/remove ops (`applicationReviewContract.ts:57-80`).
  This is the most likely concrete form of "not all fields are editable".
- **G7 — After filing, only employment has a correction path.** The filed `driver_applications` row
  has no amendment/addendum mechanism; employment has `driver_employment_history` (mutable
  transcription) + after-signing gap rows. Every other fact (accidents, convictions, addresses,
  licences) has no post-filing correction row type.
- **G8 — Identity correction lives in the wrong drawer.** DOB/licence correction (D4) is in the
  Permissions and Road-test drawers, not in the application drawer where the recruiter is reading
  the application.
- **G9 — Two employment surfaces** (`OfficeJobsSection` on the draft, `EmploymentHistorySection` on
  the filed transcription) render the same `EmploymentTimeline` in adjacent drawers; edits to the
  latter "do not change the signed application" (by design, but the recruiter cannot tell which one
  they are editing except by the drawer description line).
- **Roster edits after filing** change `drivers` (and so future `identityOnRecord` overlays) but not
  the Part 1 licence list — the drift `correctIdentityThroughPartOne` was written to prevent
  (`applicantPartOneCorrection.ts:174-201`).

---

## 10. UI/UX issues found by reading the code

1. **U1 — Documents always "None declared" in the review drawer.** `buildReviewSummary({ …,
   captures: [] })` at `ApplicationReviewDrawer.vue:87`; `reviewSummary.ts:290-302` maps 0 → `copy.none`.
2. **U2 — Edit controls and Approve button shown to view-only users.** `ApplicationAnswerList`,
   `OfficeJobsSection` and the Approve button key only on `editable` (phase), no `session.can`
   (`ApplicationReviewDrawer.vue:328,347-356,411-419`; `OfficeJobsSection.vue:205-239`). The routes
   require manage, so a viewer types, presses Save, gets a 403 toast. (D3/D4 do gate correctly.)
3. **U3 — "The applicant has started signing" callout is unreachable.** `editable` =
   `applicationIsEditable(phases)` (`applicationReviewContract.ts:163-164`), which ignores packet marks;
   so `approved && !editable` (`ApplicationReviewDrawer.vue:276`) never happens before filing. After a
   mark the drawer still says "You can still correct it" and the save fails with
   `SIGNING_STARTED` (`applicationReview.ts:193-196`).
4. **U4 — Raw storage formats in the correction list**: ISO dates, `YYYY-MM`, state codes, E.164
   phones and enum keys as free text, no pickers (`ApplicationAnswerList.vue:82-98`), unlike
   PartOneCorrection/D4 which use date and jurisdiction pickers.
5. **U5 — Typed value discarded on save before the server answers** (`ApplicationAnswerList.vue:54-59`);
   a refusal loses the recruiter's input.
6. **U6 — No applicant profile on the record page.** The page title is the only applicant fact
   (`ApplicantRecordPage.vue:191-194`); phone, email, CDL, DOB require opening a drawer. The full
   `drivers` row is fetched (`:82`) and thrown away.
7. **U7 — "What you changed" omits who changed it** (`editedBy` returned, not rendered,
   `ApplicationReviewDrawer.vue:374-391`).
8. **U8 — Questionnaire labelled with the live version** (`questionnaireForApplicant()` at `:84,98`),
   whereas the applicant's own review uses `applicantQuestionnaire(draft.questionnaire_version)`
   (`ReviewFields.vue:48`) — an office reading an older application may see re-worded or missing
   questions.
9. **U9 — PartOneCorrection shows no current values** until "Correct these" is pressed, and the
   button shows even when nothing was flagged; it is placed above the summary, so the recruiter
   compares across the scroll.
10. **U10 — Cache invalidation gaps:** `useCorrectPartOne` and `useApproveApplication` invalidate only
    the review query, not `driver-detail` / checklist; `useCorrectApplicantIdentity` invalidates
    `driver-detail` and checklist but not the review query (`useApplicantIdentity.ts:23-26`), so an
    open application drawer shows the old DOB/licence until refetch.
11. **U11 — Drawer-in-drawer:** `OfficeJobsSection` opens `EmployerFormDrawer` (a `SlideOver`) from
    inside `ApplicationReviewDrawer` (a `SlideOver`); same pattern the page header warns against
    (`ApplicantRecordPage.vue:54-59`) — Escape ownership may close both (cf. the B8 fix for
    `DocumentPreview`, `ApplicationReviewDrawer.vue:358-364`). Not verified in a browser.
12. **U12 — Invitation email cannot be changed** — resend reuses the stored one
    (`ApplicationInviteCard.vue:154-163`); create-form email only before the first link.
13. **U13 — Medical certificate step is a dead end for recruiters**: link to the DQ file requires
    `roster`; otherwise "Ask a safety manager" (`HiringStepBody.vue:293-305`).
14. **U14 — DOB correction offered in two places** (D1 row in application drawer — non-working; D4 in
    Permissions and Road-test drawers — working), with no cross-link.

---

## 11. Recommendation sketch (for the plan's open questions, not implemented)

- One "Applicant facts" card on `/recruitment/:id` showing name, DOB, phone, email, current address,
  licences, medical card status, endorsements, with a single Correct action that routes each fact to
  its one writer (D3/D4/D1) — removes G8/U6/U14.
- Make D3/D4 write `application_edits` rows (or a sibling ledger the applicant-visible-edits reader
  also reads) and check `signingStarted` — closes G3/G4.
- Remove `date_of_birth` (and legacy `cdl_number/cdl_state`) from `editableFields` — closes G1.
- Add `add_row`/`remove_row` edit ops for addresses, accidents, violations, equipment, other names
  (generalising `add_employer`) — closes G6.
- Decide G5 (office → applicant correction request) and G7 (post-filing addendum row for the filed
  application) as owner questions; both need a new table/act, so they are out of scope for a quick fix.
- Fix U1 (pass the captures the drawer already can fetch) and U2 (gate on `session.can("recruitment")`).
