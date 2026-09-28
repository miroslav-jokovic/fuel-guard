# Application flow v2 — intake before screening, a scanner wizard, a phone-first form — plan and queue

**Status: PROPOSED 2026-09-26, VERIFIED the same day, then AUDITED a second time (three adversarial passes: precision, consistency, regressions — §12). Nothing in §8 is built.**

Written from the owner's 14-step flow of 2026-09-26 (§1), the 2026-09-25 audit of that day's
recruiting work, and four research passes (the code's current flow, the form against federal and
Illinois law, document capture and identity vendors, mobile form UX). **Then verified line by line
by three independent passes**: every code claim re-read at its call site on `origin/main` `02e7b26`,
every production number re-measured (read-only, 2026-09-26), every legal claim read at its primary
source (eCFR versioner API, law.cornell.edu, ilga.gov, consumerfinance.gov), every vendor claim read
on the vendor's own page. Their corrections are folded in; nothing below rests on a reading that was
not checked.

Markers: **[V]** read at the source. **[I]** inferred or secondary — every [I] left in this file is
listed in §10 as something still to confirm, with who confirms it.

**Relationship to other plans.** Supersedes the screen ORDER of `APPLICANT-FLOW-PLAN.md` §3.1/§3.3.
Keeps D-AF1 (identity with the permissions) and D-AF2 (each permission its own PDF). **Amends** D-AF3/D-AF6/D-AF7 (D-AW14: the office's act of sending while the driver is present replaces signing on an office computer) and D-AF8 (D-AW3: the single identity writer becomes `record_applicant_intake`). **Out of scope, pending their own plans:** step 10 (training videos, D4) and step 12 (live orientation, OR1–OR3) — shown as "not built yet" and excluded from the hire gate per Q-AW23. `HIRING-MODULE-PLAN.md` §0's protocol applies, **except the one-step-one-PR
rule, which §8.1 replaces with batches** (owner, 2026-09-26). Training videos stay in
`docs/plans/DRIVER-TRAINING-PLAN.md`, live orientation in `ORIENTATION-PLAN.md`; this plan fixes only
where they sit in the order and what the hire gate reads from them.

---

## 1. The owner's flow

### 1.1 In the owner's words (2026-09-26)

> 1. We create Applicant · 2. We invite applicant · 3. Applicant fill form with basic informations
> about him (we need to split application form) because we need some basic informations in order to
> pull PSP, MVR, send Clearing house · 4. User sign permissions · 5. We receive this permissions signed
> and we pull MVR, PSP, we find a place near his address to do Pre-employment drug test · 6. after 1-2
> days when we receive drug test results we are sending request for clearing house · 7. After all
> this things are done and acceptable we are sending application link for driver to fill out the form
> for application · 8. We are buying plane ticket for driver to come to the office · 9. In a meantime
> we are checking application and with driver on phone call checking previous employment data he
> filled out to be sure that timelines and companies are correct · 10. We are sending training videos
> to drivers (still need to build these videos with tests) · 11. When driver arrive to the office we
> are doing Road test · 12. After Road test we are doing in-office orientations · 13. Then when driver
> is finished with all of this things we are sending Application and Handbook to sign · 14. after this
> we are finishing hiring and driver is ready to start driving
>
> In step 3 we need basic informations and driver to upload all the documents we need (we already
> have this in application form). […] what I am not sure is that our form we are sending is 100%
> covering application requirements. […] document uploading to be done with our scanner […] precise
> flow step by step wizard, also we want driver to take selfie image so we can compare this with ID.
> […] optimized for mobile phones screens and our scanner has to be well optimized.

And: "include assumptions, gaps and blocker fixes you reported previously into the plan" (→ §3), and
"when we finish this, be done with this module and feature so it is 100% production ready and
enterprise grade" (→ §9, the definition of done), and "larger batches" (→ §8.1).

### 1.2 What is actually new against 2026-09-24

The 09-24 flow (`APPLICANT-FLOW-PLAN.md` §1.1) is the same sequence and AF1–AF7 built most of it.
The identity screen before the permissions exists (AF3) but asks three fields — date of birth, CDL
number, CDL state — plus optional licence photos **[V]** (`record_applicant_identity`, 0365). Missing:

1. **Basic information beyond identity**: current address (the drug-test site is found from it; the
   SMS time zone too), phone, and **every licence held in the last 3 years** — today the extra states
   arrive only with the full form, after the MVR has been pulled (§2.3).
2. **The documents**: the medical card is refused before the full form is sent
   (`APPLICATION_ONLY_CAPTURE_SLOTS`, `packages/shared/src/applicationCaptureContract.ts:107`), and
   nothing is required anywhere (`APPLICATION_CAPTURE_REQUIRED = []`, `:126`) **[V]**.
3. **A selfie** — nothing exists **[V]**.
4. **Scanner-grade capture** — a hidden file input with a resolution check; the server checks nothing
   (§2.4).
5. **Office steps with no home**: drug-test site and appointment, travel, a phone-verification record
   before filing, training videos, live orientation (§2.2).
6. **The form's legal completeness** (§4).
7. **A wizard that is phone-first by measurement** (§6.8).

---

## 2. What exists today (`origin/main` `02e7b26`, re-verified 2026-09-26)

### 2.1 The link — one row, one token, several visits

`/apply/:token` picks its screen from the invitation's phase stamps (`ApplyPage.vue:287–491`) **[V]**:

| # | Screen | Gate / writer |
|---|---|---|
| 1 | Expectations (B7) | nothing written |
| 2 | E-sign consent | every later write refuses without it |
| 3 | Identity: DOB, CDL no., CDL state; licence photos optional | `record_applicant_identity` (0365) — the one writer of `drivers` + draft |
| 4 | Six permissions: `fcra_disclosure`, `psp`, `mvr`, `previous_employer`, `drug_alcohol`, `clearinghouse` (the LIMITED-query consent) | `APPLICATION_RELEASE_ORDER` (`packages/shared/src/applicationIntake.ts:209–216`); refuses without identity (`apps/api/.../applicationReleases.ts:108–109`) |
| 5 | "We have your permissions" wait | until the office's Send (`application_sent_at`) |
| 6 | Form wizard, 8 screens, ~30 min (`APPLICATION_SECTION_MINUTES`, `packages/shared/src/applicationSections.ts:105`) | draft save refuses before `application_sent_at` (`applicationDraft.ts:142`) |
| 7 | "Sent for review" → approved | `approveApplication`, `applicationReview.ts:274` |
| 8 | In-office packet signing + typed SSN + certification | `open_packet_signing` (0369); `submitted_at` set here |
| 9 | Filed card: handbook signing, road-test certificate | `handbookSigning.ts`, `applicationRoadTestCopy.ts` |

### 2.2 The office, per target step

| Target step | Today | Refs |
|---|---|---|
| 1 Create | name + optional email; duplicate trap open (Q-AX6) | `InviteApplicantDrawer.vue` |
| 2 Invite | exists | `routes/applicationInvites.ts:116` |
| 5 PSP | **real API** + manual import; refuses without DOB/CDL and without psp + fcra permissions | `modules/psp/pspOrder.ts:201` |
| 5 MVR | manual record per jurisdiction (Q-HM2: never an integration) | `packages/shared/src/hiringEvidence.ts`, `mvrJurisdictions.ts` |
| 5 Drug-test site | **missing** | — |
| 6 Drug result | manual record, no prerequisite | `packages/shared/src/hiringEvidence.ts:122` |
| 6 Clearinghouse | manual record of the full query; nothing records the driver's portal consent | `dqCatalogue.ts:81–82` |
| 7 Send application | exists; warns on mvr/psp/clearinghouse/drug_test, never refuses | `applicationSend.ts`; `APPLICATION_SEND_WARNS_ON`, `hiringSteps.ts:447` |
| 8 Travel | **missing** — only the `readyToTravel` predicate | `hiringChecklist.ts:413` |
| 9 Review | exists (edit, add employer, approve) | `ApplicationReviewDrawer.vue` |
| 9 Phone verification | `employer_inquiries` exists **but needs `employment_id NOT NULL`** → `driver_employment_history`, whose rows are created only by `submit_driver_application` at FILING (step 13) **[V]** (0223:31) — so nothing can be recorded at step 9 | `employerInquiryContract.ts:39` |
| 10 Training videos | **missing** (D4; `evidence: null`) | `DRIVER-TRAINING-PLAN.md` |
| 11 Road test | exists (D2) | `roadTest.ts`, `RoadTestPanel.vue` |
| 12 Live orientation | **missing** (`ORIENTATION-PLAN.md` proposed) | — |
| 13 Packet + handbook | exists; handbook only after the packet is filed (HB022) | 0369, 0374 |
| 14 Hire | `hireRefusal` (`hireApplicant.ts:94–104`) reads `HIRE_REFUSES_WITHOUT` (`hiringSteps.ts:473`) = federal gates + handbook | — |

### 2.3 Assumptions in today's code that the target order breaks **[V]**

1. **The MVR's states come from the draft** (`readDraftFacts`, `applicantChecklist.ts:318–337`). Before
   Part 2 only the CDL state is known, so the MVR step goes green on one state and reopens later.
2. **Retention**: `application_drafts` (by `updated_at`) and `application_captures` (by `captured_at`)
   are pruned at **90 days** (`dataRetentionPolicy.ts:199–214`, D-APP2/D-APP10); captures become
   `documents` only at filing. Under v2 the photos are taken in Part 1, weeks before filing — **a slow
   hire would lose them**, and the MVR rule would fall back to "any one MVR". So Part 1's facts cannot
   live in the draft, and Part 1's photos must be promoted to `documents` when Part 1 completes, not at
   filing (D-AW3, D-AW4).
3. **Medical card is Part-2-only** (`applicationCapture.ts:85`).
4. **`readyToTravel`** requires `office_approved`, `medical_certificate`, `orientation_videos`
   (`hiringSteps.ts:291/302/352`); the owner buys the ticket (8) before review (9) and videos (10).
   `medical_certificate` before travel is an owner ruling (Q-HM5, `HIRING-MODULE-PLAN.md:728`: "we will
   not even bring him if this not green") and **stays** (D-AW7).
5. **Nothing in Part 1 is nudged** (`packages/shared/src/applicationNudge.ts:124`).
6. **SMS send window is 19:00–24:00 UTC** whenever the zone is unknown (`smsQuietHours.ts:35–36,72`),
   and **no caller ever passes a zone** — all four `sendApplicationSms` callers use the default null.
   Its header comment (`:~81–86`) also claims the sweep reschedules held texts, which is false.

### 2.4 Capture today **[V]**

- `webImageIo.ts:101–142`: hidden `<input type=file accept="image/*" capture="environment">`, no
  `getUserMedia`. `webFileProvider.ts:47–96` decodes, strips EXIF, downsizes to 1568 px WebP (config
  `:212`), hashes in the browser, gates on **long edge only**; blur/glare are `na` (`:32–36`), relying
  on "the server's usability gate" — **never called for applicants**: `confirmCapture`
  (`applicationCapture.ts:162–213`) checks the object exists, measures bytes, stores the
  **client-sent** SHA-256 (`:197`).
- `packages/capture-engine` is pure TS. `computeMetrics(rgb: Uint8Array, w, h, analysisLongEdgePx,
  channels=3)` (`metrics.ts:259`) — a canvas `ImageData` needs `new Uint8Array(data.buffer)` with
  `channels=4`. The server already calls it for hazmat (`hazmat/.../image.ts:151`). Blur/glare/shadow
  thresholds are `null` by decision (D-SCAN10, `config.ts:177–189`).
- The driver app's native scanners (VisionKit, ML Kit) cannot be reached from a web page.
- `application_captures.slot` is a **CHECK** (0230:53, redefined 0346): `cdl_front`, `cdl_back`,
  `medical_card`, `ssn_card`, `signature_mark`, `initials_mark`, `other`. No selfie.
- `DocumentCaptureFields.vue` is a flat list. Web provenance is mislabelled
  `captureMode: "expo_camera"` (`webFileProvider.ts:91`).

### 2.5 Production, measured 2026-09-26 (read-only) **[V]**

- 8 applicants, 8 invitations: 1 revoked, 5 untouched, 2 mid-flight. Of the 5 untouched, 3 have
  expired (09-09, 09-12, 09-18); `6e03a1e5` lapses 09-27, `1a5f39db` 09-28.
- **`d61557dc`**: filed 09-14, **0 packet marks**, handbook signing opened 2026-09-25 20:08; link
  expires **2026-09-28 18:00 UTC**.
- **`f2b142e4`**: approved 09-17, **20 packet marks** from 09-17, signing never opened, unfiled; link
  expires 2026-10-01 22:14 UTC.
- Both mid-flight hold exactly `fcra_disclosure`, `psp`, `previous_employer`, `drug_alcohol` (e-sign,
  with `invitation_id`); **`mvr` and `clearinghouse` are missing**.
- 0 road-test examiners, 0 carrier representatives, 0 handbook marks, 0 handbook records.
- 0 hires: every driver is still `applicant`; no `%hire%` audit rows.
- Highest applied migration **0375**; the only open PR (#1059) adds none → **next is 0376**.

---

## 3. The 2026-09-25 audit, carried in (all re-verified 2026-09-26)

### 3.1 Blockers

| ID | Finding | Fix | Batch |
|---|---|---|---|
| **A-1** | **`d61557dc` can never be hired.** The handbook reuses the packet's adopted signature (`handbookCeremony.ts:91–92` → `handbook_no_adopted_signature`); `handbook_marks` has no other driver writer; a filed packet cannot be re-signed (DR033, 0339:157/0340:100); the handbook is a hire blocker. The capture path refuses after filing (`applicationCapture.ts:81`, TS only; the SQL stager 0230:131 has no phase check). `d61557dc` holds 0 `signature_mark` captures. | **C0b**: when an invitation is filed, its handbook open and unfiled, and it has no packet marks, the handbook screen asks for a signature (typed name + drawn/typed image). The image is staged in the `signature_mark` capture slot (a new branch of `openSession` allowed only in that state); the typed name is carried on the first `handbook_marks.signed_name` and read back from there. **Labelled in code as a workaround for the missing `signature_adoptions`, removed by C3s (D-AW15).** The office countersigns on the same visit, so the 90-day prune of the capture is harmless after filing. `canOpen` unchanged. | **C0b**
| **A-2** | **Opening the handbook does not extend the link, and re-pressing it does nothing** — `openHandbookSigning` returns early when already opened (`handbookSigning.ts:107`) before any update; `d61557dc` was opened 2026-09-25 20:08. 0374's trigger refuses every mark when `expires_at <= now()` (HB021), the office's countersign included (`carrierMark`), surfacing as `insert_failed` → 500 (`routes/handbook.ts:41`). All three existing extenders (0365:235, 0369:197, 0232:58) skip a filed invitation. | **C0a**: every press — including one on an already-opened, unfiled handbook — sets `expires_at = max(expires_at, now() + 14 days)` (TS update in `handbookSigning.ts`, audited `recruiting.handbook_link_extended` with invitation id + new expiry only); the early return moves below it. HB021 → 409 `link_expired` with words. **Fallback if C0a cannot merge before 2026-09-28 18:00 UTC:** a one-off audited SQL `update application_invitations set expires_at = now() + interval '14 days' where id = '<d61557dc…>'`, run by the owner. | **C0a**
| **A-3** | **MVR state field accepts 60 chars, the application 80** (`packages/shared/src/hiringEvidence.ts:169` vs `applicationContract.ts:212`) → a long authority can never be covered → never hired. | One shared constant. (Part 1's state picker removes the free-text case going forward, D-AW3.) | **C0c** |
| **A-4** | **Both mid-flight applicants stuck at 4 of 6 permissions**: `permissions_signed` shows "waiting on them" (`hiringChecklist.ts:229–238`) though their ceremony is closed; MVR recording refuses without `mvr` (`authorizationContract.ts:428`). Only a paper grant unsticks them; a comment names it (`:233–234`), the UI does not. | Checklist row names the paper door when the ceremony is closed and purposes are missing; A-7 first. | **C0c** |

### 3.2 Bugs

| ID | Finding | Fix | Batch |
|---|---|---|---|
| **A-5** | **#1059 changes fines above signatures already given.** `PACKET_VERSION = "packet-2026-09-25"` (`defaultWording.ts:71`) is identical on main and on the branch; `application_packet_marks` has no version column (production columns read); the packet renders only at filing (`renderFiledDocument`, `file.ts:165`). `f2b142e4`'s 20 marks would file under new fines. | `packet_version` on each mark (M1); filing compares; Q-AW2 decides what happens to older marks. **#1059 stays open until C2.** | M1 + C2 |
| **A-6** | **Handbook version not compared.** `handbook_marks.handbook_version` exists (0374:99, NOT NULL) but is stamped with the server's current `HANDBOOK_VERSION` at insert; countersign files the current text without comparing (`handbookSigning.ts:165–245`). `HANDBOOK_VERSION` is a content hash, so #1059 changes it. 0 marks in production. | Code only: the client sends the version it rendered; a mismatch is refused; countersign refuses when the marks' version ≠ current. | **C0c** |
| **A-7** | **A paper permission has no `invitation_id`** (`routes/authorizations.ts:141–157`) → the link still asks for it on screen, it is missing from the filed permissions, the checklist (by driver, `applicantChecklist.ts:261`) counts it. It stores the office's `req.ip` as the signer's attribution (`:152`). | Resolve the driver's live invitation and write it. The existing unique index `uq_driver_authorizations_invitation_purpose` (0228) then refuses duplicates — ⚠ it covers `revokes is null`, so a re-grant after a revocation hits 23505: refuse with words. `accepted_ip`/`_user_agent` null for paper. | **C0c** |
| **A-8** | **A failed road test recorded on the DQF page counts as passed** — `hasKind("road_test")` (`hiringChecklist.ts:283`); that writer's `result` is `z.string().max(400)` (`complianceContract.ts:211`). RT3's ceremony writes a record **only** on a pass (`roadTest.ts:250–265`). | Count a `road_test` record when `detail.source = 'road_test'` (ceremony) OR `detail.passed = true`; the DQF writer gains a pass/fail field. Existing ceremony rows keep counting. | **C0c** |
| **A-9** | **Hire-gate bypass.** `POST /compliance/qualification-records` (`evidence/routes/compliance.ts:166`) accepts `handbook`/`road_test` (only `psp_report` refused, `complianceContract.ts:230`). `PATCH /roster/drivers/:id` (`drivers.ts:193`) sets `status` with no hire check. **There is no database guard on applicant→active**: `guard_driver_lifecycle` (0213) checks only JWT roles and the service role bypasses it; `hire_applicant` (0218) checks inside its own RPC. | Refuse ceremony-owned kinds on the generic door; refuse `applicant → active` on the PATCH (route guard). A DB trigger is Q-AW21. | **C0c** (route) |
| **A-10** | **Double filing.** Countersign has no claim: two presses both file PDF + record before `handbook_filed_at` (`handbookSigning.ts:258`). Road test files form → certificate → record with no cleanup (`roadTest.ts:245–281`). Append-only → permanent. | M1: `application_invitations.handbook_filing_claimed_at` + partial unique indexes on `qualification_records` (§8.2). C2: claim first, then file. | M1 + C2 |
| **A-11** | **SMS.** Held texts are dropped (the nudge stamps and rotates before sending, `applicationNudgeSweep.ts:215–235`; `applicationSend.ts:57–58` says "nothing retries it"); the window is 19–24 UTC (§2.3.6); the public terms say "held until the next day" (`SmsTermsPage.vue:66`) — false; the webhook handles only `message.received` (`lib/sms.ts:139`), so accepted-then-failed reads "sent". | M1: `sms_outbox` + `sms_suppressions`. C2: zone derived from Part 1's state/ZIP (D-AW12); drain in the scheduler; delivery receipts; terms corrected; stale comment fixed. | M1 + C2 |
| **A-12** | Road-test certificate prints the examiner's **typed name, silently**, when the signature file is missing (`roadTest.ts:171–173`). Blank licence number and UTC date: reported by the audit, **not re-verified** (§10). | Refuse without a signature file; refuse a pass without a licence number; carrier-zone date — after confirming the last two. | **C0c** |
| **A-13** | Handbook place h1 still promises "receipts" (`handbookContract.ts:24`) after #1059 removes them. | Ships inside #1059's rebase. | C2 |

### 3.3 Gaps

- **G-1** Handbook receipt signed twice (packet p25 + handbook h5), p25 before the handbook is shown. → Q-AW18.
- **G-2** SMS consent endpoint accepts any E.164 incl. international (`smsConsentContract.ts:164`) and
  texts a confirmation for each new number (`publicApplicationSms.ts:101–106`); STOP matches
  "end/quit/cancel" anywhere (`smsConsentContract.ts:105–112`); a STOP on a new number leaves the old
  consent live; no START; no suppression list. → C2.
- **G-3** An MVR from an earlier application counts; §391.23(a) wants the inquiry within 30 days. → C2.
- **G-4** "Indiana BMV" and "IN" are two states. → Part 1's state picker (C3).
- **G-5** DQ binder footer uses `StandardFonts.Helvetica` (`dqBinder/merge.ts:112`); `pdfUnicodeText`
  (`pdfFonts.ts:74`) never NFC-normalises. → C0c.
- **G-6** `handbook_marks`, `application_packet_marks` not in `RETENTION_FORBIDDEN`
  (`dataRetentionPolicy.ts:250`). → C0c.
- **G-7** The checklist input is built twice (board + checklist); the board's draft read hits
  PostgREST's 1,000-row cap at scale. → C2.
- **G-8** Templates page shows the paper button to view-only users; the blank packet prints "Signed
  electronically" on withdrawn pages; template copy names pages 4 and 19 only
  (`recruitmentTemplatesContract.ts:63`). → C0c.
- **G-9** Paper grant: no signing-date field; the "scan" can be any document of the driver; no
  re-hash; `verbal_documented` needs no evidence but opens `mvr_order`; draft wording allowed. → C0c +
  Q-AW15.
- **G-10** Road test: no record the driver was handed the certificate; §391.33 equivalency counted but
  not recordable by a recruiter. → Q-AW19.
- **G-11** Three "ready to hire" definitions: `hired.requires` (`hiringSteps.ts:421–424`),
  `HIRE_REFUSES_WITHOUT` (`:473`), `readyToHire` (`hiringChecklist.ts:414`, no caller); `blockedBy`
  reads `requires` (`:376–380`). → C2.
- **G-12** Stale comments: "fourteen" steps (`hiringChecklist.ts:13/19/24/204`, there are 17); "handbook
  has no evidence table" (`packages/shared/src/hiringEvidence.ts:58`); `packetStatic.ts:68` still has
  the $20 receipts row; the `subject_to_fmcsr` JSDoc (`applicationContract.ts:155–159`) describes
  §40.25(j). → C0c.
- **G-13** **The signed permissions can print a different signature from the one signed.** "Print what
  they have signed" reads the applicant's CURRENT staged `signature_mark` at print time
  (`signatureMarkBytes`, `applicationPdf/permissions.ts:215`) **[V]**; that slot is replaceable ("a
  re-shoot replaces", 0230:87) and prunable at 90 days (`dataRetentionPolicy.ts:193`) **[V]**, and the
  office adoption re-stages it (`usePacketAdoption.ts:386–409`). → the adoption record, D-AW15.

### 3.4 Assumptions not yet ruled

- **Fines**: the packet contradicts itself ("& TERMINATION" p7 vs "possible termination" p9 rules 9,
  10, 15); late delivery priced two ways. **Illinois 820 ILCS 115/9(4)**: a deduction needs "express
  written consent of the employee, given freely at the time the deduction is made" **[V]** — a
  packet-time consent to future fines does not meet "at the time". Contractor status is separate. →
  Q-AW17, counsel.
- Paper signatures on placeholder (`v0-draft`) wording are allowed (`authorizations.ts:134–137`). → Q-AW15.
- Any recruiter can print the examiner's stored signature on any road test (Q-RT2 as ruled). → Q-AW19.
- SMS consent wording live before counsel's review (D-SMS10). Recorded, not reopened.

---

## 4. Is the form complete? — against the regulation (all rows [V] unless marked)

**Answer: every §391.21(b) item has a field, but four the regulation says "shall" are optional, one
coverage rule is missing, the (b)(12) wording is short, the FCRA summary of rights is absent, and the
federal Clearinghouse consent cannot be collected by us.**

| Requirement | Status | Fix |
|---|---|---|
| (b)(1) Carrier name + address | On the paper packet only; online form shows none | Header of Part 2 + review screen (C3) |
| (b)(2) Name, address, DOB, SSN | Covered; SSN typed at signing, never in the draft | — |
| (b)(3) Addresses, 3 years | **Not enforced**: `addresses … .min(1)` (`applicationContract.ts:273`); `applicationRules.ts` has no address rule | Coverage meter + refusal (C3) |
| (b)(4) Date | `certified_at` server-stamped | — |
| (b)(5) Licences | Covered; all held in 3 years (Q-AF4) | Moves to Part 1 |
| (b)(6)–(b)(9) | Covered | — |
| (b)(10)(i) Employer **address** | `address_line1/city/state` `.nullish()` (`:136–138`) | Required for new filings (C2, AW1 §8.4) |
| (b)(10)(iii) **Reason for leaving** | `.nullish()` (`:154`) | Required |
| (b)(10)(iv)(A) Subject to FMCSRs | `.nullish()` (`:160`); its JSDoc describes §40.25(j) | Required; fix the comment |
| (b)(10)(iv)(B) DOT safety-sensitive | `.nullish()` (`:161`) | Required |
| (b)(11) 7 more years of CMV employers | Covered | — |
| Employment gaps | Computed (`employmentCoverage()`, `employmentCoverage.ts:160–179`); no field to explain one; carrier's p5: "All time periods exceeding 59 days must be verifiable" | Gap-explanation loop (C3) |
| (b)(12) Certification | Online wording (`strings.ts:435`) lacks "was completed by me"; the legal certification is packet p11 (D-PKT15) | Add the words; counsel Q2 stays open |
| §40.25(j) prior positive/refusal, past 2 years | `.nullish()` (`:323`) for old filings | Required for new filings; asked in Part 1 |
| §391.21(d) notice before submission | **Delivered** at step 4 inside the `previous_employer` release (p15 text, `packetWording.ts:173–220`), before the application exists. Residual: buried inside a release. §391.23(i)(1)'s deadline is "prior to any hiring decision" | Also a standalone screen before Part 2's send (improvement, C3) |
| FCRA §604(b)(2)(B) — remote DOT applicant: notice + "a summary of the consumer's rights under section 1681m(a)(3)" before procurement | **Absent**: the summary text appears nowhere; the PSP form only mentions it (`pspDisclosure.ts:66,68`) | A Part-1 screen (C3). Which text — CFPB Appendix K, or a §615(a)(3) summary — is Q-AW13 (counsel) |
| §382.701(a)(2), §382.703(b),(d) — pre-employment **full** Clearinghouse query; consent "must be obtained electronically in the Clearinghouse" (FMCSA FAQ) | Cannot be collected by us; our sixth permission is the limited-query consent (`clearinghouseConsent.ts`, `fmcsa-sample-2026-09-13`) | Part 1 tells the driver to register; the office records the portal consent (C2) |
| §391.23(f)(1) → §40.321(b) specific consent per previous employer; "blanket releases… are prohibited"; needed for non-FMCSA DOT employers (§391.23(e)(4)(ii)) and follow-up plans (e)(4)(i) | `previous_employer` is one release | Q-AW14 (counsel Q4) |

**Packet page 6 and state law (counsel — not in the counsel package yet):**

- Page 6 is a **blanket disqualification policy** **[V]** (`pdftotext`): "No felony convictions within
  last seven years…", "Misdemenors involving dishonesty, theft, or fraud are disqualifying events",
  "No DWI, DUI… in the last three years", "Have not been incarccerated within last five years".
  - **JOQAA 820 ILCS 75/15(a)** **[V]**: no inquiry into criminal record until selected for an
    interview or a conditional offer (15+ employees). §15(c) allows **written notice** of disqualifying
    offences — so p6 may be SHOWN; it must never become a Part-1 question.
  - **IHRA 775 ILCS 5/2-103.1** **[V]**: a conviction may be used only with a "substantial
    relationship" or "unreasonable risk" after six factors, a written preliminary notice with the
    reasoning and the report, **at least 5 business days to respond**, and a written final notice
    naming the right to file a charge. Blanket bars sit poorly with that. → Q-AW16: rewrite p6's
    criteria, not just its timing.
  - Cook County Human Rights Ordinance §42-35: **[I]** — text not obtained (§10).
- Page 6 also demands "US Passport • Certified Copy of Birth Certificate • INS paperwork that shows US
  citizenship or that permanent alien resident has been established" **[V]**. 8 USC 1324b(a)(6): asking
  for more or different documents is unlawful "if made for the purpose or with the intent of
  discriminating" **[V]**; limiting to citizens/permanent residents also risks (a)(1)(B)
  citizenship-status discrimination **[V]**. I-9 documents are presented "at the time of hire" and the
  individual chooses them (8 CFR 274a.2(b)(1)(v)) **[V]**. → **No SSN card in Part 1** (D-AW4), Q-AW4.
- **Credit** — withdrawn p4's "credit, bankruptcy": 820 ILCS 70/10 bars inquiring about an applicant's
  credit history absent an exception **[V]**. The withdrawal stands.

---

## 5. Decisions this plan proposes (the owner rules; nothing is built until they do)

| ID | Decision | Why |
|---|---|---|
| **D-AW1** | **One link, three visits.** One invitation, one applicant token. New stamp `intake_completed_at`, distinct from `releases_completed_at`. | Two tokens would double rotation/revival/expiry and strand drafts (Q-AX5). |
| **D-AW2** | **Part 1** collects identity + phone + current address + CDL + every licence held in 3 years + documents + selfie + two screening questions, then the FCRA summary, then the six permissions. **Entirely remote.** | Screening inputs arrive before screening. The FCRA remote-applicant route holds only if "as of the time at which the person procures the report… the only interaction… has been by mail, telephone, computer" — §604(b)(2)(C)(ii)/(b)(3)(C)(ii) **[V]**. |
| **D-AW3** | **Part 1's facts live in their own tables** — `application_intakes` and `application_intake_licences` (§8.2), keyed on the invitation, never pruned, written by `record_applicant_intake`, which **replaces `record_applicant_identity` as the single identity writer (amends D-AF8)**; `record_applicant_identity` is dropped in M2 once no caller remains. MVR jurisdictions are read from the licences table. **At certification the filed payload is composed from the draft plus the intake tables** (the §391.21 document must carry them), and the packet renders from the composed payload. Legacy invitations (no intake row) keep reading the draft, and C2 copies the two mid-flight drafts' licence lists into `application_intake_licences` with `source = 'legacy_draft'` before the 90-day prune (mid-December). | §2.3.1–2; G-3, G-4, G-7. |
| **D-AW4** | **Required documents**: CDL front + back required to finish Part 1; medical card required or "I don't have one yet". **No SSN card in Part 1** (`ssn_card` stays in the CHECK; only `APPLICATION_CAPTURE_REQUESTED` changes). **Part 1's captures are promoted to `documents` when Part 1 completes**, not at filing. The selfie is **never** promoted to `documents` (append-only, conflicts with a retention promise); it keeps its own retention. | Owner asked for required documents; §4 1324b risk; §2.3.2 retention. |
| **D-AW5** | Clearinghouse after the drug result is a **warning**, not a `requires` edge (clearinghouse keeps `requires: []`). The driver's portal consent is its own recorded fact (`clearinghouse_portal_consent` qualification kind). | Law orders neither (§382.701(a)(1), §382.301(a) **[V]**); a carrier preference warns. §382.703 consent is a DQF fact. |
| **D-AW6** | Drug-test site/appointment is a manual record (`drug_test_appointments`) + a locator link; no lab integration now. Operational, not DQF evidence. | Tens of applicants a month; Q-AW7. |
| **D-AW7** | Travel gets a record (`applicant_travel`). **The travel writer REFUSES unless `readyToTravel`** (Q-HM5: "a hard gate on the invitation to come in"), expressed as `TRAVEL_REFUSES_WITHOUT` derived from `beforeTravel`, like `HIRE_REFUSES_WITHOUT` — not as a `requires` edge (`hiringSteps.ts:188`: requires are law or a constraint, never a preference). Before-travel = permissions, MVR, PSP, drug test, Clearinghouse, **medical certificate** (Q-HM5, kept), application filled. `office_approved`, `orientation_videos`, `employment_investigation` stop being before-travel. **Amends D-HM9/Q-HM3's seam**: videos are before ARRIVAL, not before the ticket; when D4 ships, `OPEN_SIGNING_WARNS_ON` and the road-test drawer warn on them. | The owner's order; Q-HM5 preserved. |
| **D-AW8** | **Phone verification before filing** is its own append-only record `employer_verification_calls` keyed on the invitation + the draft employer's stable key (dates, position, reason, CMV, DOT-tested — each confirmed/corrected/not confirmed; who called; who answered). At filing, `submit_driver_application` copies each call into `employer_inquiries` (method `phone`) against the new `driver_employment_history` row, so §391.23's record is one record after filing. | `employer_inquiries.employment_id` cannot exist before filing (§2.2). Needs a stable per-employer key in the draft (§8.4 AW12 AW1). |
| **D-AW9** | **Scanner** = native camera via the file input (D-APP11 stands) + in-browser metrics (advisory until thresholds exist; D-SCAN10 stands) + server re-hash and metrics + PDF417 autofill. No OpenCV. | §6.6. |
| **D-AW10** | **Selfie phase 1** = a photo compared by a person; phase 2 (vendor) only after counsel. | §6.7. |
| **D-AW11** | Part 1 is a linear stepper; Part 2 a task-list hub; one thing per page; add-another loops; check your answers; memorable-date boxes. | §6.4, §6.8. |
| **D-AW12** | SMS window uses the zone derived from Part 1's state (and ZIP where a state spans two zones: take the strictest); unknown stays strict; held messages go to `sms_outbox` and the scheduler drains them when the window opens. No `drivers.time_zone` column — derived, never stored. | A-11 at the root; deriving beats restating. |
| **D-AW13** | The four employer fields and a gap explanation become required **for new filings** through the certification refinement (`applicationBeforeCertificationSchema`, `applicationContract.ts:408`), not by changing `.nullish()` — the base schema must parse append-only history. **§40.25(j) is enforced by `record_applicant_intake` in Part 1**, not by the draft refinement. | §4; append-only filings. |
| **D-AW14** | **Signing happens on the driver's own phone, sent by the office while the driver is present.** "Send for signing" mints a fresh sign link (rotating any earlier one — `open_packet_signing` sets a new hash per call, 0369:210) and sends it by **email** always, and SMS where the driver consented (production has 0 consents today). **Supersedes D-AF6/D-AF7 and restates D-AF3**: "in person" is the office's act of sending while the driver is in the office, not the device. The link lives **72 hours** from sending. The signing screen stays behind the date-of-birth unlock (D-APP16), which gains a **per-link attempt counter: 5 wrong answers revoke the link** and the office re-sends (M1 column `unlock_failures`). A 6-digit code texted/emailed to the driver is **on by default** for the sign link (Q-AW25). | Owner, 2026-09-26: "we will send link to his phone and he will sign there". The DOB is printed on the CDL photographed in Part 1, so it cannot be the only secret once a link travels. |
| **D-AW15** | **Adopt once, click everywhere.** Part 1 has an **Adopt your signature and initials** screen (§6.2 screen 13, C3s) before the permissions; each is kept as an append-only `signature_adoptions` row with its image frozen in the evidence bucket (the row IS the registration; the orphan reconcile is extended to its `storage_path`). Every later place — permissions, packet, handbook — is one click that applies it, and every mark stores `adoption_id`. The office signing session opens with "This is your signature — use it" (a new adoption supersedes the old one via `superseded_by`). Legacy marks (`adoption_id` null) print from the staged capture as today; C3s back-fills one adoption row per legacy invitation from its capture before the capture's prune date. | Owner's DocuSign model. Fixes A-1 at the root and G-13; **also resolves ORIENTATION-PLAN Q-OR8** (a driver signature exists before orientation). |
| **D-AW16** | **One envelope at step 13, one link, place by place, two filings**: packet places → certification (files the packet) → handbook places → the office countersigns (files the handbook, under A-10's claim). "Place N of M" spans both; **handbook places are NOT in `record_packet_mark`'s `p_expected_count`**. HB022 becomes "refuse unless `signing_opened_at is not null OR submitted_at is not null`" (the OR keeps legacy filed invitations such as `d61557dc`, which predate 0369's stamp), shipped in **M2 after `d61557dc` is filed**, together with 0374's `application_invitations_handbook_order_check` (which must change the same way). Packet p25 is withdrawn — h5 is the receipt (closes Q-AW18, G-1 and MVR plan Q-MVR7); `f2b142e4` has already marked p25, and its filed PDF prints the withdrawal notice there, as D-PKT19 did for p15/p20/p22. | Owner: "move from section to section easy and smoothly". |
| **D-AW17** | **Everything is prefilled, and the office previews it before sending.** Permissions: printed name and date drawn on the unsigned copy (identity exists from Part 1). Packet: add p01 date and p22 printed name to the preview. Handbook: a preview with name and masked SSN. "Preview" sits on the row where "Send for signing" is, for packet and handbook. Carrier lines per Q-HB1. SSN stays off the packet (D-HIRE6). | Owner: "all places … prefilled properly. We can review these documents prefilled." |

---

## 6. The target

### 6.1 The applicant's link

`Welcome → Part 1 (linear) → wait for screening → Part 2 (task list) → wait for review/travel →
(in the office) packet → handbook → filed card`.

### 6.2 Part 1 — "Get started" (~9 minutes)

| # | Screen | Collects | Notes |
|---|---|---|---|
| 1 | Welcome | — | who the carrier is, what happens next, what to have ready (CDL, medical card), time, language |
| 2 | E-sign consent | consent | existing |
| 3 | About you | legal name (confirm/edit), mobile, DOB (3 boxes) | prefill from the invitation (WCAG 3.3.7) |
| 4 | Where you live now | current address, ZIP first → city/state | drug-test site; SMS zone |
| 5 | Your CDL | state (picker), number, class (A/B/C, `drivers.cdl_class`, 0098), expiry (3 boxes), endorsements (H/N/X/T/P/S) | prefilled from the barcode on screen 9 when read; the driver confirms — **which needs screens 8–9 walked BEFORE 3–5 (Q-AW31; built that way in C3b1)** |
| 6 | Other licences, last 3 years | yes/no gate, then one licence per screen: **state picker** + optional agency text + number | `application_intake_licences` |
| 7 | Two screening questions | §40.25(j) (past two years); §382.301(b): in a DOT testing program in the previous 30 days AND either tested in the past 6 months OR in a random program for the previous 12 months | **leads only** — the exception is the employer's to verify (§382.301(b)(3), (c)) |
| 8–10 | Photos, one per screen | CDL front → CDL back (barcode read) → medical card ("I don't have one yet") | §6.6 |
| 11 | Selfie | a photo | §6.7; built only once Q-AW5 is answered (AW6) |
| 12 | Your rights | the FCRA summary (Q-AW13 text) | **`complete_applicant_intake` runs on Continue**: stamps `intake_completed_at`, promotes the photos to `documents` |
| 13 | Adopt your signature and initials | typed name + image; initials | D-AW15 (C3s); until C3s ships the permissions adopt as today |
| 14–19 | Six permissions | one instrument per screen, prefilled (D-AW17) | `record_driver_release` refuses without `intake_completed_at` (legacy: identity, as today) |
| 20 | Done | what happens next; **Clearinghouse registration** (link + steps, why); SMS opt-in card | reads `releases_completed_at` |

### 6.3 The office's screening (target steps 5–7)

1. PSP — the existing API order.
2. MVR — one per Part-1 jurisdiction; fresh within 30 days of the application (G-3).
3. Drug-test appointment — site (name, address, phone), window, donor/registration id, arranged by;
   "send to driver" by SMS/email with a maps link; "Find a site near {ZIP}" opens the TPA's locator.
4. Drug result — existing.
5. Clearinghouse — "driver consented in the portal" (date), then the full-query result (existing).
6. Send the application — existing; warnings extended to all of the above.

### 6.4 Part 2 — "Your application" (task-list hub)

Statuses: Not started · In progress · Completed · Cannot start yet. Linear one-thing-per-page inside a
task; the hub opens on every return. Tasks:

1. **About you** — other names, email; Part-1 facts read-only with "Something wrong? Tell us".
2. **Where you have lived (3 years)** — one address per screen, ZIP → city/state, coverage meter.
3. **Your licences** — from Part 1, confirm only.
4. **Where you have worked (10 years)** — one employer per screen: name, from, to, address, reason
   for leaving, subject to FMCSRs?, DOT-tested?, operated a CMV?; coverage bar naming each gap, and a
   gap explanation for any gap over 30 days (59 per the carrier's p5 — Q-AW22).
5. **Equipment and experience** — short loop.
6. **Driving record** — yes/no gates first; loops only on "Yes".
7. **Carrier questions** — one or two per screen.
8. **Before you send** — the §391.21(d) notice and §391.23(i) rights as a standalone screen; check your
   answers; Send.

### 6.5 After the application (target steps 8–14)

- **Travel (8)** — `applicant_travel`: mode, depart/arrive, confirmation reference, booked by.
- **Phone verification (9)** — per employer, D-AW8.
- **Training videos (10)** — D4 in its own plan. This plan leaves `orientation_videos` with
  `evidence: null` and not before-travel, so it does not block anything until D4 ships (§9 says what
  "done" means for it).
- **Road test (11) → orientation (12) → packet + handbook in one envelope (13, D-AW16) → hire (14).** One
  "ready to hire" definition (G-11).

### 6.6 The scanner wizard

Behind the existing `CaptureProvider` seam, nothing replaced:

1. **One document per screen**: card outline, a two-line hint ("flat surface, no flash, all four
   corners"), one full-width "Take photo" opening the phone's **native camera** (the `capture` input:
   full resolution and autofocus, which iOS Safari's `getUserMedia` does not give — D-APP11), then a
   large preview with **Use this / Retake**.
2. **Measure in the browser**: `computeMetrics(new Uint8Array(imageData.data.buffer), w, h, 1568, 4)`.
   Blur/glare are **advisory** ("This looks blurry — retake?") until thresholds come from recorded
   samples (D-SCAN10).
3. **Server gate**: a new confirm RPC downloads the object, **re-hashes it**, decodes it and runs
   `computeMetrics`, storing `server_sha256`, `metrics`, `verified_at` on `application_captures`. The
   API decodes with `sharp`, already an API dependency (`apps/api/package.json:40`) imported by the
   hazmat path (`hazmat/hazmatExtraction/image.ts:2`) **[V]**; CPU per photo is measured in AW4.
4. **Barcode autofill**: on CDL-back, lazy-load `zxing-wasm/reader` (~1 MiB, PDF417 only) and decode
   the photo taken. A pure AAMVA parser in `packages/shared` (fixture-tested) pre-fills name, DOB,
   licence number, state, expiry, address for the driver to **confirm** — never overwriting typed
   input. An unreadable barcode costs nothing.
5. **No OpenCV/jscanify** (~8 MB [I], video-frame quality). Revisit only if the measured re-shoot rate
   says so.
6. **Fallbacks**: camera refused → "Upload a photo instead" on the same screen; desktop → QR code +
   "Text me the link" (existing Telnyx path, consent state honoured); the same token opens the same
   intake; the desktop page moves on when the slots fill.
7. Fix the `captureMode` provenance label.

### 6.7 The selfie

- 740 ILCS 14/10 **[V]**: "Biometric identifier means a retina or iris scan, fingerprint, voiceprint,
  or scan of hand or face geometry. Biometric identifiers do not include… photographs"; biometric
  information excludes what is derived from excluded items. §15(a)–(e) **[V]**: public retention
  schedule (destroy at the earlier of purpose satisfied or 3 years after last interaction); written
  notice + purpose + term + written release **first**; no profit; no disclosure; reasonable care.
  "Written release" includes an electronic signature and, in employment, a release as a condition of
  employment (P.A. 103-769) **[V]**. §20 **[V]**: $1,000 (negligent) / $5,000 (intentional or reckless)
  **per violation**; since P.A. 103-769 repeated same-method collection from the same person is one
  §15(b) violation. No employer exemption in §25 **[V]**. Selfie-ID vendors have been sued (*Davis v.
  Jumio*, N.D. Ill. No. 22-cv-00776, 2023, motion to dismiss denied) **[V, secondary]**; courts have
  treated face-geometry scans taken FROM photographs as covered **[I]**.
- **Phase 1 (recommended now)**: the selfie is a plain photo (front camera, oval guide) shown **side by
  side with the licence photo** in the review drawer; the recruiter records matches / does not match /
  unclear (`application_intakes.selfie_verdict`, `_by`, `_at`). No automated matching, no template. The
  `/apply` privacy statement gains its own line on the photo's purpose and retention (the
  `legalMeta.ts:151` list describes the **driver app**, not `/apply`). Counsel confirms (Q-AW5).
- **Phase 2 (only after counsel)**: Stripe Identity — "$1.50 per verification" for document + selfie,
  charged on completion, first 50 free, no minimums **[V]**; "enforce live capture" is a feature,
  separate liveness is not listed **[V]**; biometric identifiers removed "within one year", but images
  and document data kept "in the business' Stripe Dashboard for 7 years" unless deleted **[V]**; Stripe
  publishes nothing on BIPA, and recommends offering a non-biometric alternative **[V]**. A BIPA
  notice-and-release screen before the camera, a published retention schedule, deletion via API, and
  the vendor contract. Didit: "$0.33 per full KYC", 500 free a month, no minimum **[V]**.
- **Never a hard block**: a failed or impossible selfie falls back to the recruiter checking the driver
  in person on arrival.

### 6.8 Quality bars — measured

| Bar | Target | How |
|---|---|---|
| Part 1 completion | median ≤ 8 min, p75 ≤ 12 | `application_screen_events` |
| Part 2 completion | median ≤ 25 min | same |
| Inputs per screen | ≤ 5 visible; 1 decision on a yes/no gate | per-screen review |
| Tap targets on `/apply` | 100% ≥ 44×44 CSS px, none < 24 (WCAG 2.5.8) | Playwright sweep, 320 and 390 px |
| Apply-route JS | ≤ 200 KiB gzipped; barcode reader, PDF viewer, signature pad lazy | build report |
| Web vitals on a Galaxy-A24-class profile, Slow 4G | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; Lighthouse mobile perf ≥ 90, a11y 100 | Lighthouse CI in `typecheck-build` (the only job that builds), listed in CLAUDE.md |
| Network cut mid-screen | zero lost answers; a cut upload is retried from the kept photo, never re-taken (Q-AW38 (a) — was "an upload cut at 50% resumes") | Playwright offline test |
| Errors | inline, name the field and the fix; validate on leaving a field, clear on the fixing keystroke; summary kept | component tests |
| Real walk | an older Android + an iPhone, one real driver, end to end | §11 log |

**How the two completion bars are read (owner, 2026-09-28: time ON the screens, a SQL query run by
hand).** A visit ends when the screen changes and when the phone is put away (C3d3a), so the sum of a
link's `part1.*` visits is the time spent on Part 1, and a driver who finishes over two days is not
counted as taking two days. A visit still open (a phone that died on it) counts as nothing, and one
visit is capped at 30 minutes, for a screen left showing on a desk. Part 1 counts links whose Part 1 is
finished; Part 2, links whose application was handed to the office.

```sql
with visits as (
  select e.invitation_id,
         case when e.screen like 'part1.%' then 'part1' else 'part2' end as part,
         least(extract(epoch from (coalesce(e.left_at, e.entered_at) - e.entered_at)), 1800) / 60.0 as minutes
  from application_screen_events e
  where e.org_id = :org and (e.screen like 'part1.%' or e.screen like 'part2.%')
), per_link as (
  select v.invitation_id, v.part, sum(v.minutes) as minutes
  from visits v
  join application_invitations i on i.id = v.invitation_id
  where (v.part = 'part1' and i.intake_completed_at is not null)
     or (v.part = 'part2' and i.review_requested_at is not null)
  group by v.invitation_id, v.part
)
select part, count(*) as links,
       round(percentile_cont(0.5) within group (order by minutes)::numeric, 1) as median_min,
       round(percentile_cont(0.75) within group (order by minutes)::numeric, 1) as p75_min
from per_link group by part order by part;
```

A panel in the office is not built (owner, 2026-09-28): the query is enough until there are links to
read.

### 6.9 Signing — the owner's model (2026-09-26), against today **[V]**

| Owner's step | Today | Change |
|---|---|---|
| Every place prefilled | Packet mostly (`packetFieldValues.ts`, `packetSigningFields.ts`); handbook name + masked SSN (`handbookPdf.ts:247–253`); **permissions blank** until signed (`applicationPermissionInstrument.ts:17–19`) | D-AW17 |
| Office reviews the prefilled documents | Packet preview exists but only from the review drawer, and refuses once filed (`preview.ts`, `routes/applicationReview.ts:88–106`); **no handbook preview** (`HandbookPanel.vue`); permissions only as blank templates | D-AW17 |
| Sent with a new link to the phone | "Open signing" mints a new sign link (0369) and opens it **on the office computer**, never sent (`OpenSigningPanel.vue:16–20`, `applicationOpenSigning.ts:18–23`); the handbook mints no link | D-AW14 |
| Adopt signature + initials once | Once per ceremony, but **two adoptions**: permissions (signature only) and packet (signature + initials, again); the handbook adopts nothing and borrows the packet's name (A-1) | D-AW15 |
| Place by place, nothing missed, section to section | Permissions: yes ("Document N of 6"). Packet: yes (current stop, "Place N of 15/16", send blocked until done). **Handbook: a flat list of five buttons in any order**, a separate session after filing | D-AW16 |

The permissions stay in Part 1 (they must be signed before the MVR/PSP are pulled), prefilled from
Part 1; the office's review applies to the packet and handbook (Q-AW24).

---

## 7. What changes in the hiring state machine

**Legacy rule (stated once, used everywhere):** an invitation is *legacy* when it has no
`application_intakes` row and `created_at` is before C3's merge. For a legacy invitation,
`intake_completed` reads **done when `releases_completed_at` is set or identity is on file**
(0365's screen took the identity), and the MVR's jurisdictions come from `application_intake_licences`
rows with `source = 'legacy_draft'`, else the draft. Production today: 8 invitations, all legacy.

| Step | Change |
|---|---|
| `invitation_sent` | unchanged |
| **`intake_completed`** (new, "them", `phase: "screening"`, `federalGate: false`, `beforeTravel: true`) | done when `intake_completed_at` is set (legacy rule above) |
| `permissions_signed` | requires `intake_completed` |
| `mvr` | done when every jurisdiction has an MVR dated within 30 days of `intake_completed_at` (legacy: of the application) |
| `psp`, `drug_test` | unchanged |
| `clearinghouse` | done on the full-query record; the portal-consent fact shows as in-flight; `requires: []` kept; the drawer warns if recorded before `drug_test` (D-AW5) |
| `medical_certificate` | requires `intake_completed` (was `application_filled`); still federal and before-travel |
| `application_sent`, `application_filled` | unchanged |
| `office_approved` | no longer before-travel |
| **`travel_booked`** (new, "us", `phase: "screening"`, not before-travel) | done on a live `applicant_travel` row; its writer refuses on `TRAVEL_REFUSES_WITHOUT` (D-AW7) |
| `employment_investigation` | reads `employer_verification_calls` before filing, `employer_inquiries` after; not before-travel |
| `orientation_videos`, `live_orientation` | `evidence: null`, shown "not built yet", **excluded from `HIRE_REFUSES_WITHOUT` and `readyToHire`** (Q-AW23) |
| `road_test` | the A-8 pass rule |
| `application_signed`, `handbook`, `hired` | one "ready to hire" definition = `HIRE_REFUSES_WITHOUT`; `readyToHire` derives from it; `blockedBy` no longer marks an open step as blocked |

**Derived lists after the change:** `APPLICATION_SEND_WARNS_ON = [mvr, psp, clearinghouse, drug_test,
medical_certificate]`; `OPEN_SIGNING_WARNS_ON` unchanged in meaning (derived from `federalGate` +
`beforeTravel`, now including `intake_completed` only if it is marked federal — it is not);
`TRAVEL_REFUSES_WITHOUT` new. **Ordinals are derived from the array index**, not the hand-written
"1"…"17" strings (`hiringSteps.ts:209–420`), so inserting two steps renumbers nothing by hand.

**Also changes with it (C2, same PR):** `DRAWERS: Record<HiringStepKey,…>` gets entries for the two
new steps (`hiringStepDrawers.ts:114`); `inviteState()` learns "intake in progress / intake done"
(`useApplicationInvites.ts:141–188`); the "fourteen" comments (G-12); every test listed in §8.5.
`hiringSteps.ts` (494 lines) is split first (C1).

## 8. Execution — large batches (owner, 2026-09-26)

### 8.1 How we ship

- **One migration PR per wave, then large code PRs.** A migration and its first reader never share a
  merge (served ~3 min in, applied ~5 min in — `docs/MIGRATION-DISCIPLINE.md`). An applied migration
  cannot be edited, so M1 is specified completely in §8.2 before it is written.
- **Function overloads never take a DEFAULT on the new parameter** — PostgREST picks a function by the
  named keys in the call, and a defaulted parameter makes the old call ambiguous (PGRST203; this repo
  recorded it in 0258:30–35, 0312:38–44). Every new function signature carries its own
  `revoke all … from public, anon, authenticated; grant execute … to service_role` (0339:195–196) and
  a PGlite case asserting `anon` cannot execute it and that old-key and new-key calls each resolve to
  exactly one function. The old signature is dropped in a later migration once no caller remains.
- **Every new RPC is service-role only** (`lint:rpc-org-default` does not apply); every 1:1 write is
  UPDATE-first then INSERT … ON CONFLICT DO NOTHING (`lint:upserts`).
- Each PR: own worktree off `origin/main`; every CI gate locally once, `$?`-checked; PR; CI on the
  current head; **merge when green without asking**; verify it landed; one line in §12.
- A C-batch that reads M1 starts only after M1 is **verified applied in production** by hand
  (`pg_proc`, `information_schema.columns`, `pg_constraint`) — `lint:migration-ordering` cannot see
  functions, triggers or CHECK widenings.

### 8.2 M1 — migration 0376 (schema only, no reader)

**Before writing it:** re-check the next free number (0376 on 2026-09-26) and re-run the duplicate
check that the partial unique indexes need (0 duplicate `handbook`/`road_test` records org-wide,
measured 2026-09-26).

**Common to every new table:** `id uuid pk default gen_random_uuid()`, `org_id uuid not null
references organizations on delete cascade`, `created_at timestamptz not null default now()`, RLS
enabled with no policies, an `(org_id, invitation_id)` index, 0230's service-only guard-trigger
pattern with its own errcode, registered in `table-modules.json` (lifecycle/retention block),
`table-writers.json`, table-producer waivers pinned to this plan, seeded in `rls.test.mjs`,
`schema.generated.sql` regenerated. `invitation_id` FKs are `on delete cascade` (like 0230:46,
0339:44, 0374:94; invitations are never deleted — revoking sets `revoked_at`). Tables with `driver_id`
(`sms_outbox`, `sms_suppressions`) are added to `DRIVER_REASSIGNMENTS` (`mergeDriver.ts:23–75`) **and**
the `merge_driver` SQL cascade list; the others carry no `driver_id` and stay off it.
`qualification_records` belongs to the evidence module → a `cross-module-waiver` line.

**Free errcodes (grepped 2026-09-26):** AI007+, DR037+, HB025+, DA041+, SC012+; prefixes EV, SA, SO
unused.

| Object | Specification |
|---|---|
| `application_invitations` | + `intake_completed_at timestamptz`, + `handbook_filing_claimed_at timestamptz`, + `unlock_failures smallint not null default 0`, + `sign_link_expires_at timestamptz` (D-AW14's 72 h) |
| `application_intakes` (new) | `invitation_id uuid not null unique`; `phone text` CHECK `~ '^\+1[2-9][0-9]{9}$'`; `address_line1`, `address_line2`, `city text`; `state text` CHECK `~ '^[A-Z]{2}$'`; `postal_code text` CHECK `~ '^[0-9]{5}$'`; `prior_positive_2y`, `dot_program_30d`, `dot_tested_6m`, `dot_random_12m boolean`; `fcra_summary_version text`; `fcra_summary_shown_at timestamptz`; `medical_card_pending boolean not null default false`; `selfie_verdict text` CHECK in (`matches`,`does_not_match`,`unclear`), `selfie_verdict_by uuid references auth.users on delete set null`, `selfie_verdict_at timestamptz`, CHECK `(selfie_verdict is null) = (selfie_verdict_at is null)`; `updated_at`. A working record: UPDATE allowed. Never pruned |
| `application_intake_licences` (new) | `invitation_id`; `position smallint not null` (0 = current CDL); `state_code text not null` CHECK `~ '^[A-Z]{2}$'` (validated against `JURISDICTION_CODES`, `jurisdictions.ts:120`, in TS — 0339's reasoning for not enumerating in SQL); `agency text` (≤ the A-3 constant); `licence_number text not null` (1–40); `expires_on date`; `source text not null default 'intake'` CHECK in (`intake`,`legacy_draft`); unique `(invitation_id, position)`, unique `(invitation_id, state_code, licence_number)`. Never pruned |
| `record_applicant_intake(p_org uuid, p_invitation uuid, p_driver uuid, p_intake jsonb, p_licences jsonb, p_endorsements text[], p_overwrite boolean) returns jsonb` (new) | security definer, `search_path = ''`. Writes the intake row (UPDATE-first); replaces licence rows only while `intake_completed_at is null`, else AI008 `intake_frozen` for the applicant (the office, `p_overwrite`, may correct); writes `drivers.phone`, `address_line1/2`, `city`, `state`, `postal_code`, `cdl_class`, `cdl_expires_at` (0098:44–63) fill-only or overwrite per 0365's rule; `driver_endorsements` `on conflict (driver_id, code) do nothing` (0098:88–98); DOB/CDL no./state through `record_applicant_identity`'s body, called internally so the draft patch keeps one writer; refuses AI001–AI004 as 0365; AI009 `prior_positive_required` when the §40.25(j) answer is null (D-AW13) |
| `complete_applicant_intake(p_org uuid, p_invitation uuid, p_driver uuid, p_captures jsonb) returns timestamptz` (new) | under `for update` on the invitation: AI001/AI002/AI003; AI007 `intake_incomplete` unless the intake row has `fcra_summary_shown_at`, a `cdl_front` and `cdl_back` capture exist, and a `medical_card` capture exists or `medical_card_pending`; inserts `documents` rows for `p_captures` (0231's join shape) **excluding the `selfie` slot** and sets `promoted_document_id`; stamps `intake_completed_at = coalesce(intake_completed_at, now())`; **idempotent** (a second call inserts nothing) |
| `application_captures` | slot CHECK (0230:53, 0346) + `selfie`; + `promoted_document_id uuid references documents(id) on delete restrict`; + `server_sha256 text`, + `metrics jsonb`, + `verified_at timestamptz`; `confirm_application_capture(p_org, p_invitation, p_capture uuid, p_server_sha256 text, p_bytes bigint, p_metrics jsonb) returns void` (new) |
| `submit_driver_application` | **new overload** (no defaults on new params): skips captures whose `promoted_document_id` is set (0231:139–147 would otherwise hit a primary-key collision); takes the composed payload (D-AW3); copies `employer_verification_calls` → `employer_inquiries` (method `phone`, `wording_version = 'phone-call-v1'`, `body_sent` = a rendered summary — both NOT NULL, 0223:49–50) against the new `driver_employment_history` rows matched by the draft's stable employer `key`; sets `copied_inquiry_id` |
| `record_driver_release` | **new overload** + `p_adoption_id uuid` (DR038 rule below) |
| `record_packet_mark` | **one 13-argument overload** (11 existing + `p_packet_version text`, `p_adoption_id uuid`, no defaults): DR037 `packet_version_changed` when an earlier mark on the invitation has a non-null `packet_version <> p_packet_version`; DR038 `adoption_not_found` unless `p_adoption_id` is null or names a live `signature_adoptions` row of the same invitation whose `kind` matches the mark |
| `application_packet_marks`, `driver_authorizations`, `handbook_marks` | + `packet_version text` (marks only; nullable — 20 production marks predate it; **NULL means the pre-versioning text**, see A-5) and + `adoption_id uuid references signature_adoptions on delete restrict` (all three; nullable) |
| `signature_adoptions` (new, append-only) | `invitation_id`; `kind text not null` CHECK in (`signature`,`initials`); `typed_text text not null` (1–200); `storage_path text not null` = `documentStoragePath(org,'driver',driverId,id,'image/png')` (`complianceContract.ts:329`) in `DOCUMENTS_BUCKET`, no `documents` row; `sha256 text not null` (server-computed); `adopted_at`, `adopted_ip inet`, `adopted_user_agent text`; `superseded_by uuid references signature_adoptions on delete restrict`; guard SA010 (append-only, one allowed update: `superseded_by` null → value); partial unique `(invitation_id, kind) where superseded_by is null`; writer `record_signature_adoption(...)` |
| `qualification_records` | partial unique `(org_id, (detail->>'invitation_id')) where kind = 'handbook' and detail->>'source' = 'handbook_signing'` (written today, `handbookSigning.ts:247–255`); partial unique `(org_id, driver_id, (detail->>'invitation_id')) where kind = 'road_test' and detail->>'source' = 'road_test' and detail ? 'invitation_id'` (C2 starts writing `invitation_id` on road tests) |
| kinds | `clearinghouse_portal_consent` added to `qualification_records_kind_check` **and** `documents_kind_check` (lockstep since 0373), **and to both restrictive policies that enumerate testing kinds (0237:120–137)** — otherwise it is readable by everyone — and to `TESTING_RECORD_KINDS` (`auth.ts:295`), `QualificationKind`, `DocumentKind` in shared |
| `drug_test_appointments` (new) | `invitation_id`; `site_name`, `site_address text not null`; `site_phone text`; `window_start timestamptz not null`, `window_end timestamptz` CHECK `window_end is null or window_end > window_start`; `donor_reference text`; `arranged_by uuid not null`; `sent_to_driver_at`, `cancelled_at timestamptz`. The live one = latest uncancelled |
| `applicant_travel` (new) | `invitation_id`; `mode text not null` CHECK in (`air`,`bus`,`train`,`drive`,`other`); `depart_at`, `arrive_at timestamptz not null` CHECK `arrive_at >= depart_at`; `confirmation_ref text`; `booked_by uuid not null`; `cancelled_at` |
| `employer_verification_calls` (new, append-only) | `invitation_id`; `employer_key uuid not null`; `employer_name text not null`; `outcomes jsonb not null` (keys `dates`,`position`,`reason`,`cmv`,`dot_tested`, each `confirmed`/`corrected`/`not_confirmed`; CHECK `jsonb_typeof(outcomes) = 'object'`); `corrections jsonb`; `called_by uuid not null`; `answered_by text not null`; `called_at timestamptz not null`; `copied_inquiry_id uuid references employer_inquiries on delete restrict`; guard EV010 (one allowed update: `copied_inquiry_id` null → value) |
| `sms_outbox` (new) | `driver_id` → drivers cascade; `invitation_id` nullable; `phone text not null`; **`template text not null` + `params jsonb not null` — never a rendered body with a link in it** (the link is minted/rotated at drain time; a plaintext bearer token in the database is what 0232/Q-AX5 refused); `reason text not null` CHECK in (`nudge`,`application_sent`,`signing_link`,`drug_test_site`,`consent_confirm`,`other`); `not_before timestamptz not null`; `expires_at timestamptz not null` (a held text older than this is `cancelled`, never sent late); `status text not null default 'queued'` CHECK in (`queued`,`sending`,`sent`,`delivered`,`failed`,`suppressed`,`cancelled`); `attempts smallint not null default 0`; `last_error text`; `provider_message_id text unique`; `sent_at`, `delivered_at`, `failed_at`; drain index `(not_before) where status = 'queued'`. Retention 400 days |
| `sms_suppressions` (new) | `driver_id` nullable; `phone text not null`; `reason text not null` CHECK in (`stop`,`carrier_block`,`invalid`,`manual`); `lifted_at timestamptz`; partial unique `(org_id, phone) where lifted_at is null`. **In `RETENTION_FORBIDDEN`** (pruning a STOP re-opens texting) |
| `application_screen_events` (new) | `invitation_id`; `screen text not null` CHECK `~ '^[a-z0-9_.-]{1,60}$'`; `entered_at timestamptz not null`, `left_at timestamptz`; index `(org_id, entered_at)`. Retention 180 days |
| `application_drafts` | + `revision int not null default 0`; **new overload** `save_application_draft(p_org, p_invitation, p_driver, p_payload, p_section, p_expected_revision int)` (no default): DA041 `draft_revision_conflict` when stored ≠ expected; increments; returns `revision` |
| `RETENTION_FORBIDDEN` (TS, lands with the writers) | `application_intakes`, `application_intake_licences`, `employer_verification_calls`, `signature_adoptions`, `sms_suppressions` (the two marks tables go in C0, G-6) |

**Tests in the M1 PR:** `application-intake.test.mjs` (AI001–AI004, AI007–AI009, fill-only vs
overwrite, promotion idempotence, selfie never promoted); `signature-adoption.test.mjs` (append-only,
one live per kind, DR037/DR038 on the 13-argument mark function, both overloads resolve, anon cannot
execute); `submit-application-v2.test.mjs` (promoted captures skipped, verification calls copied);
`sms-outbox.test.mjs`; every new table in `rls.test.mjs`.

### 8.3 M2 — the next free migration number (after `d61557dc` is filed, after M1's readers exist)

(Planned as 0377; C3c3a took 0377 for Q-AW37 on 2026-09-27, since M2's preconditions are weeks away.)

- `handbook_marks_guard()` HB022 → `refuse unless (signing_opened_at is not null or submitted_at is not
  null)`, keeping its append-only branch (`trg_handbook_marks_append_only` calls the same function) —
  with a matrix case "filed, never opened, legacy" and "opened, not filed, v2".
- `application_invitations_handbook_order_check` (0374:82–88) re-added as
  `(handbook_signing_opened_at is null or signing_opened_at is not null or submitted_at is not null)
  and ((handbook_signing_opened_at is null) = (handbook_signing_opened_by is null)) and
  (handbook_filed_at is null or handbook_signing_opened_at is not null)`.
- Drop the old 11-argument `record_packet_mark`, 5-argument `save_application_draft`, the old
  `submit_driver_application` and `record_driver_release` signatures, and `record_applicant_identity`,
  **each only after `pg_stat_user_functions`/a grep shows no caller**.
  ⚠ Since C3d1b the 5-argument `save_application_draft` has exactly one caller: `saveDraft` when a
  page sends no `revision` (a page loaded before C3d1b deployed). The same merge makes
  `applicationDraftSaveSchema.revision` required and deletes that branch.
- Held until answered: versioned packet templates (Q-AW2 (b)); a `drivers` status trigger (Q-AW21).

### 8.4 The AW work items

| ID | Scope | Batch |
|---|---|---|
| AW1 | Contract: required employer address/reason/FMCSR/DOT-tested via the certification refinement; `employment_gaps[]`; every draft `employment[]` item gains `key: uuid` (client-minted, optional in the base schema, required for new filings); fix the §40.25(j) JSDoc; add `employment_gaps` to `APPLICATION_SECTION_KEYS` | C2 |
| AW2 | Intake writer + `complete_applicant_intake` caller + composed payload at certification | C2 |
| AW3 | Part 1 shell (linear stepper), screens 1–7, 12, 20; FCRA summary; Part-1 nudge; memorable-date primitive in `@silvicom/ui` | C3 |
| AW4 | Scanner wizard (§6.6 items 1–3, 6, 7) + server confirm (CPU per photo measured first) | C3 |
| AW5 | PDF417 reader + AAMVA parser (shared, fixture-tested) + prefill | C3 |
| AW6 | Selfie phase 1 + review drawer side by side + verdict | C3 **only after Q-AW5** |
| AW7 | MVR from intake; 30-day freshness; one checklist-input builder for board + checklist; legacy draft copy | C2 |
| AW8 | Drug-test appointments, portal-consent fact, send warnings | C2 |
| AW9 | Part 2 task-list hub, loops, coverage meters, notice screen, check your answers, (b)(1) header, (b)(12) wording | C3 |
| AW10 | Local draft replay (IndexedDB) with revision; uploads retried from the photo kept on the device (Q-AW38 (a) replaced Supabase TUS) | C3 |
| AW11 | §7 state machine + travel | C2 |
| AW12 | Phone verification per employer | C2 |
| AW13 | Spanish on `/apply` + `APPLY_COPY` key-parity test | C4 |
| AW14 | Screen events, Lighthouse CI in `typecheck-build` (listed in CLAUDE.md), 44 px sweep, offline test | C3 |

**Routes (C2/C3), all under `requireSection("recruitment")` (GET = view, writes = manage), contracts in
`packages/shared/src/applicantScreeningContract.ts`:** `POST/DELETE
/recruiting/applicants/:driverId/drug-test-appointments`, `POST /…/travel`, `POST /…/employer-calls`,
`POST /…/intake/selfie-verdict`, `POST /…/send-for-signing`, `POST /…/resend-link`. Public (per-link
bucket, `applicationLimits.ts`): `POST /apply/:token/intake`, `POST /apply/:token/intake/licences`,
`POST /apply/:token/intake/complete`, `POST /apply/:token/adoption`.

### 8.5 Batches, dependencies and the critical path

| Batch | Contents (precise) | Needs | Est. |
|---|---|---|---|
| **C0a — today, before 2026-09-28 18:00 UTC** | A-2 as fixed in §3.1; HB021 → 409. **Owner, same day:** add a carrier Representative (production has 0 — the countersign needs one) and confirm `d61557dc` still holds their link | — | 2 h |
| **C0b — inside the extended window** | A-1's self-adoption (workaround, labelled) | C0a | ½ day |
| **C0c** (parallel with M1) | A-3; A-4; A-6 (`handbookMarkRequestSchema` + `handbook_version`, mismatch → 409 `handbook_changed`, countersign compares the marks' distinct versions); A-7 (write `invitation_id`; 23505 on `uq_driver_authorizations_invitation_purpose` → 409 `already_granted_on_link`; `accepted_ip`/`_user_agent` null for paper); A-8 (`passed: z.boolean()` required for `road_test` on the DQF writer, stored in `detail.passed`; the fold counts `detail.source = 'road_test'` OR `detail.passed = true`); A-9 (`CEREMONY_OWNED_KINDS = ["handbook","road_test","employment_application","psp_report"]` exported from `complianceContract.ts`, refused by `compliance.ts:166`; PATCH `drivers.ts:193` `applicant → active` → 409 `use_hire`); A-12 (after re-reading the two unverified parts); G-5; G-6 (`handbook_marks`, `application_packet_marks` → `RETENTION_FORBIDDEN`); G-8; G-12; G-9 **only after Q-AW15** (else the default in §11) | — | 1 day |
| **C1** (now, parallel) | Behaviour-neutral splits, one file each named in the PR: `ApplyPage.vue` (491) → page + `ApplyPhaseRouter.vue`; `hiringSteps.ts` (494) → + `hiringStepGraph.ts`; `packetContinuation.ts` (489), `usePacketAdoption.ts` (490), `packetFieldValues.ts` (488), `draft.ts` (480), `applicationContract.ts` (473) → + `applicationEmployerContract.ts`; `strings.flow.ts` (467), `employment.ts` (464), `packetOverlay.ts` (456), `strings.ts` (449), `publicApplication.ts` (439), `applicantBoard.ts` (437) | — | 1 day |
| **M1** | §8.2 | this plan | 1½ days |
| **C2** (after M1 applied) | A-5 (filing refuses marks whose `packet_version` differs from current; NULL = pre-versioning, filed only per Q-AW2); A-10 (claim `handbook_filing_claimed_at` first, then file; road test writes `invitation_id` and claims before filing); A-11 + G-2 (enqueue-then-drain; `runSmsOutboxOnce` its own scheduler in `schedulers.ts`, **every 5 minutes, api service only**, claims `for update skip locked limit 50`; zone from `smsZoneFor(state, zip)` in `smsQuietHours.ts`, strictest zone for split states; Telnyx delivery receipts in the webhook; terms page corrected; US-only numbers; ≤ 3 numbers per link; exact-keyword STOP/START; STOP revokes every live consent of that link and writes a suppression); G-3; G-7; G-11; **Q-AX5 re-send link** (rotates the hash, audited: id + expiry only); **Q-AX6 duplicate applicant** ("invite them again" on the existing record); AW1, AW2, AW7, AW8, AW11, AW12. **#1059 merges here only after Q-AW2 and Q-AW17 are ruled** | M1 | 5–6 days |
| **C3** (after M1 applied; screens after C2's AW2) | AW3, AW4, AW5, AW9, AW10, AW14; AW6 only after Q-AW5 | M1, C1, C2 AW2 | 8–9 days |
| **C3s** (before any real step-13 signing) | D-AW14 (send-for-signing by email; SMS when C2 lands; 72 h; unlock counter; code); D-AW15 (adoption screen, one-click apply, legacy back-fill); D-AW16 (one envelope, p25 withdrawn — update the pinned counts listed below); D-AW17 (prefilled permissions; packet + handbook previews on the signing row); retire `OpenSigningPanel`'s new-tab path | M1, C1, C2 for SMS only | 4 days |
| **M2** | §8.3 | `d61557dc` filed; C3s merged | ½ day |
| **C4** | AW13; M2's readers | Q-AW11, M2 | 2 days + translation |
| **QA** | §9's walk | all; Q-AW23 | 1–2 days |

**Critical path ≈ 12–15 working days:** C0a → M1 → (applied) → C2 AW2 → C3 → C3s → QA. C0c and C1
run in parallel with M1; C2 in parallel with C3's non-screen work.

**Tests and gates that change in the same PR as the code (measured 2026-09-26):**
- p25 withdrawal (C3s): `applicationPacketMarks.test.ts` `p_expected_count` and "N unsigned" pins
  (lines 110, 349, 371, 377, 447, 451, 476) each −1; `packetOverlay`, `packetSigningFields`,
  `packetWithdrawals` tests listing withdrawn ids; web ceremony tests showing "Place N of 15/16".
- State machine (C2): `hiringChecklist.test.ts`, `hiringEvidence.test.ts`, `applicationIntake.test.ts`
  (shared); `applicantChecklist.test.ts`, `applicantBoard.test.ts`, `routes/routes.test.ts`,
  `routes/publicApplication.test.ts` (api); `HiringChecklistCard.test.ts`, `HiringStepDrawer.test.ts`,
  `ApplicantRecordPage.test.ts` (web); `supabase/tests/release-ceremony.test.mjs` (if
  `record_driver_release` gains the intake precondition).
- `lint:comment-claims` for any comment quoting a renamed test title; route-table and
  `ui-system-inventory` snapshots for new routes/components.

---

## 9. Definition of done — "100% production ready"

The module is done when **every** line below is true and recorded in §11 with its evidence:

1. Every A-* and G-* item in §3 is closed by a merged PR, or explicitly withdrawn by the owner.
2. Every §4 row is Covered, or its open item is a counsel question with the owner's ruling recorded.
3. §7's state machine is live: one "ready to hire" definition, no step that can never turn green
   except `orientation_videos`/`live_orientation`, which are shown as "not built yet" and excluded from
   the hire gate **by an owner ruling recorded here** until D4/orientation ship.
4. A real applicant (QA org) has walked Part 1 → screening → Part 2 → travel → road test → packet →
   handbook → hire on an older Android and an iPhone, and every screen met §6.8's bars.
5. Both production mid-flight applicants have a recorded outcome (Q-AW1, Q-AW2, A-4).
6. The office has added the examiner and at least one carrier representative (production had 0 of each on 2026-09-26), and recorded one QA road test and one QA handbook countersign.
   road test and one QA handbook countersign.
7. Every counsel question this plan raised (Q-AW5, Q-AW13, Q-AW14, Q-AW16, Q-AW17, Q-AW19) is in the counsel
   package with a recommendation.
8. No `[I]` in this file remains without a named owner in §10.

---

## 10. Still unverified, and who confirms

| Item | Why unverified | Who |
|---|---|---|
| A-12: blank licence number, UTC date on the road test | not re-read in the verification pass | first task of C0c |
| Cook County HRO §42-35 timing | text not obtainable (Municode renders by JavaScript) | counsel (Q-AW16) |
| Face-geometry scans taken from photographs held covered by BIPA | case law not fetched | counsel (Q-AW5) |
| Retroactivity of P.A. 103-769 (secondary: 7th Cir. 2026) | not read at source | counsel (Q-AW5) |
| OpenCV.js ~8 MB | general knowledge | irrelevant unless §6.6.5 is revisited |
| CPU per photo for the server confirm (`sharp` decode + metrics) | **measured 2026-09-27** on a dev machine (§12); a Railway vCPU's speed is not | AW4 (C3b2) re-reads it from the service's own logs once live |
| Stripe Identity phone handoff | secondary sources only | phase 2 only |

---

## 11. Open questions (candidates + a recommendation each)

| ID | Question | Candidates | Recommendation |
|---|---|---|---|
| **Q-AW1** | `d61557dc` has no packet signature, so the handbook can't be signed. | — | **Answered** by the owner's model (D-AW15). Until C3s: C0a extends the link, C0b lets the handbook screen take a signature (labelled workaround). |
| **Q-AW2** | `f2b142e4` signed 20 marks on 09-17; fines and spelling change under them. | (a) re-open the changed pages; (b) file under the old text (versioned templates, M2); (c) re-issue | (b). **RULED (b) by the owner 2026-09-27** — f2b142e4 files under the text it signed; versioned packet templates join M2. |
| **Q-AW3** | Required documents in Part 1? | — | CDL both sides; medical card or "I don't have one yet". |
| **Q-AW4** | SSN card photo? | Part 1 / Part 2 optional / after hire | After hire; SSN typed at signing. |
| **Q-AW5** | Selfie: photo + human, or automated match? | (a) / (b) Stripe / (c) none | (a) now; (b) after counsel. **Blocks only AW6**, nothing else in C3. **RULED (a) by the owner 2026-09-27** — a person compares the selfie with the licence photo; no automated match (Illinois BIPA would need counsel-approved written release and a retention policy first). AW6 is unblocked. |
| **Q-AW6** | No medical card yet? | block / allow and track | Allow; `medical_certificate` stays open and before-travel. |
| **Q-AW7** | Which TPA/lab? Integrate? | manual + locator / Quest / eScreen / FormFox | Manual + locator; owner names the TPA. |
| **Q-AW8** | Clearinghouse strictly after the drug result? | gate / warning | Warning (D-AW5). |
| **Q-AW9** | Ticket after the application is sent, filled, or reviewed? | — | Filled. |
| **Q-AW10** | Address autocomplete provider? | static ZIP table / Google / Smarty / Radar | Static ZIP table first. |
| **Q-AW11** | Languages on `/apply`? | EN / EN+ES / more | EN+ES; legal instruments stay English with a Spanish reading aid until counsel approves translations. |
| **Q-AW12** | Memorable dates as 3 boxes? | calendar / 3 boxes | 3 boxes (DOB, expiry); month+year for history. |
| **Q-AW13** | FCRA §604(b)(2)(B) summary: CFPB Appendix K or a §615(a)(3) summary? | — | Counsel; Appendix K meanwhile as the conservative choice. |
| **Q-AW14** | §40.321(b) per-employer D&A consent | build per-employer releases / one release | Counsel (Q4). |
| **Q-AW15** | Paper grants: signing date; scan for every method; placeholder wording | — | Date required; scan for `wet_signature` and `verbal_documented`; refuse on `v0-draft`. |
| **Q-AW16** | Packet p6 criteria under JOQAA / IHRA 2-103.1 / Cook County | keep / rewrite as case-by-case | Counsel; recommend rewrite. |
| **Q-AW17** | Fines: three contradictions; deductions under 820 ILCS 115/9(4) | — | Owner fixes the contradictions; counsel on deductions. **Owner accepted 2026-09-27:** the owner fixes the three contradictions; counsel rules on the deductions. Still open until both are done — #1059 stays held. |
| **Q-AW18** | Handbook receipt signed twice (p25 + h5) | — | **Resolved by D-AW16**: withdraw p25. |
| **Q-AW19** | Road test: examiner attestation; certificate handed over; §391.33 door | — | Record "handed over"; add the equivalency door; counsel note. |
| **Q-AW20** | 44 px targets: `/apply` only or product-wide? | — | `/apply` first. |
| **Q-AW21** | Applicant→active: route guard only, or also a DB trigger? | — | Route guard in C0c; trigger in M2 if the owner wants defence in depth. |
| **Q-AW22** | Gap explanation threshold: 30 days (our coverage rule) or 59 (carrier's p5)? | — | 30 — stricter, and the office can ignore short ones. |
| **Q-AW23** | Orientation videos/live orientation before D4 ships: excluded from the hire gate (§9.3)? | — | Excluded, shown as "not built yet". |
| **Q-AW24** | The owner said "permissions, application and handbook" are prefilled and reviewed before sending. The permissions must be signed in Part 1, before screening. | (a) permissions prefilled from Part 1, no office review before; (b) office reviews permissions too, delaying screening | (a). |
| **Q-AW25** | Signer check on the phone for the sign link. | DOB only / DOB + one-time code | **DOB + a 6-digit code by default** (D-AW14): once the link travels by SMS/email, the DOB — printed on the CDL photographed in Part 1 — cannot be the only secret. |
| **Q-AW26** | May a queued text hold a link? | rendered body / template + params, link minted at drain | Template + params (§8.2 `sms_outbox`); a plaintext bearer token never sits in the database. |
| **Q-AW27** | Legacy invitations (all 8 in production) under the new rules | — | The legacy rule in §7 and §8.3's (M2) `OR submitted_at`; stated, not left to each batch. |
| **Q-AX5** | Staff re-send of a lost link | (a) rotate on the same invitation / (b) new invitation | (a), audited, in C2 (one token now spans weeks and three visits). |
| **Q-AX6** | Re-inviting from the board duplicates the applicant | (a) "invite them again" on the existing record / (b) merge later | (a), in C2. |
| **Q-AW2 — C2c's blocker** (2026-09-26) | Filing now refuses a packet with any unversioned mark (`packet_signed_before_versioning`) — production's only such packet is `f2b142e4`'s 20 marks of 2026-09-17, which predate even D-PKT20's spelling. Filing it under today's text would be (c) chosen by nobody. (b) does **not** need M2's migration: the marks already say which text they were made under (NULL = the carrier's file with no register for every NULL mark in production on 2026-09-26, all of which predate #1058 — ⚠ a NULL mark made between #1058 and C2c's deploy was made under the corrected text, so re-measure `signed_at` before building), so the renderer can pick the text from the marks at render time. What it needs is a register per text version kept in code and `correctedPacketTemplate(version)`. | (b) in code: a `PACKET_TEXT_REGISTERS` map keyed by `packetTextVersion`, NULL → the empty register; ~½ day, a C2c follow-up once the owner rules | **(b)**, built the day the owner rules. Until then `f2b142e4` cannot file — its link lapses 2026-10-01 22:14 UTC and needs extending. |
| **Q-AW29** (C2d, 2026-09-26) | A text that carries the applicant's link (nudge, "application ready", the sign link) cannot wait in `sms_outbox`: 0376 refuses a URL in its params, and minting the link at drain time means rotating `token_hash`, which kills the link the office's Send and the nudge put on screen and in the email moments earlier (D-AF7). Today such a text goes at once or not at all, with the email carrying the link. | (a) a text-only token: `application_invitations.sms_token_hash`, accepted by `resolveInvitation` beside `token_hash` and `sign_token_hash` (A5b's pattern), rotated at drain without touching the email's link — a migration + one resolver change; (b) rotate at drain and accept that the email's link dies; (c) link-bearing texts stay send-now-or-never | **(a)**. (b) breaks D-AF7's "the screen is the delivery path that always works"; (c) is today's behaviour and A-11's defect for these three. ~1 day incl. M-migration; needs the owner's yes because it adds a third bearer token. **RULED (a) by the owner 2026-09-27** — a text-only token; migration + resolver, two merges. **BUILT 2026-09-28** (0378 #1092, then Q-AW29b): `application_sent` and `nudge` wait; `signing_link` waits for C3s; the desktop's "Text me the link" stays send-now by choice. |
| **Q-AW28** | A-10's road test: two presses in the same second can each file a form and a certificate; 0376's index lets only one record cite them. A claim before the form is filed needs a column, as the handbook has. | (a) `application_invitations.road_test_filing_claimed_at` (M2); (b) accept the orphan documents | (a) in M2; the read-before-filing C2c added closes every case but the same-second race. **RULED (a) by the owner 2026-09-27**, in M2. |
| **Q-AW32** (C3b2a, 2026-09-27) | §6.6.2's browser advisory ("This looks blurry — retake?") needs a number to compare against, and D-SCAN10 forbids inventing one: every blur/glare/shadow floor in `BUNDLED_DEFAULT_CONFIG` is `null` until recorded samples exist, and neither JS fallback (driver app, web) computes these metrics today. So the advisory is NOT built — a message fired by a guessed threshold would train drivers to ignore it, or refuse good photos. | (a) derive the floors from the server's recorded `application_captures.metrics` (C3b2a writes them on every photo from now on) against the recruiter's own "legible / not legible" on the same captures, then compute in the browser and advise; (b) borrow the hazmat pipeline's floors (they are also `null`, so there are none to borrow); (c) guess | **(a)**: ~50 real Part 1 photos with a recruiter verdict, one config bump, then a browser `computeMetrics` call on the encode canvas (the arithmetic is already shared, D-SCAN8). Needs a small "legible?" control in the review drawer to record the verdict — owed with AW6's drawer (Q-AW5) or on its own. **RULED (a) by the owner 2026-09-27** — floors from ~50 recruiter-judged captures, then the browser advisory. |
| **Q-AW31** (C3b1, 2026-09-27) | §6.2 puts the CDL photos at 8–9, after the typed screens 3–5, and says screen 5 is "prefilled from the barcode on screen 9". Both cannot hold: a prefill that never overwrites typed input (§6.6.4) finds 3–5 already typed, and a date of birth once written is fill-only for the applicant (0376 → `record_applicant_identity`), so a later correction from the barcode is dropped. | (a) the CDL's two photos first (screens 8–9 walked before 3), the medical card where it was; (b) the owner's order kept and the barcode only COMPARED with what was typed, the address and licence re-posted on "use the licence's", the date of birth shown as a mismatch for the office; (c) no prefill | **(a)**, built as the default in C3b1: the only order in which the prefill does anything, captures are open from consent onward (AF3), and "scan your ID, then check the details" is the order drivers meet elsewhere. (b) is a second write path per field and still cannot fix a date of birth. A one-array change (`PART_ONE_SCREENS`) reverts it. **RULED (a) by the owner 2026-09-27** — as built. |
| **Q-AW33** (C3c1, 2026-09-27) | §391.21(b)(10)(iv)(A)/(B) — "whether the applicant was subject to the FMCSRs" and "whether the job was designated as a safety sensitive function … subject to alcohol and controlled substances testing" — are never asked as questions. `AddEmployerForm.vue:79–80` DERIVES them (`subject_to_fmcsr` = the "DOT-regulated?" answer, `safety_sensitive` = the "drove a CMV?" answer), and the drawer's two checkboxes start unticked (`emptyEmployer`: `false`). So the page always sends a boolean, and v2 filing's `== null` rule (AW1) can never fire from the page: the filed answer is one the applicant was not asked. | (a) C3c2's one-employer-per-screen loop asks each as its own Yes/No with no default, the draft holding `null` until answered, so the rule that already exists refuses a blank; (b) keep the derivation and state it on the review screen; (c) counsel rules whether derived answers satisfy "whether" | **(a)**, in C3c2 — the loop is being rebuilt anyway, and a default on a "shall" question is the one kind of answer a filing rule cannot see. C3c1 prints both answers on the PDF and the review so whatever was sent is at least visible. **BUILT as (a) in C3c2b (2026-09-27)** — asked of a v2 link's (b)(10) jobs only, and of every job on a legacy link (optional there, as before). **Two things the owner should know, neither a change of the ruling:** the office's add-employer form asks both of EVERY row and refuses to add one without them, because `editableFields` offers no correction for a null cell — a blank added there could never be filled in and a v2 filing would refuse it for good; and the PDF's null wording moved from "Not asked" to "Not answered", since a legacy driver can now leave the question they were asked blank. **RULED (a) by the owner 2026-09-27** — as built. |
| **Q-AW34** (C3c2c, 2026-09-27) | §6.4 items 1 and 3 — Part 1's facts read-only on "About you" and "Your licences", with "Something wrong? Tell us" — **cannot be built: the page has no way to read Part 1's answers.** The bundle serves booleans only (`PartOneStatus`; D-APP16 keeps a date of birth off the bare link), which is why C3a made a returning applicant's Part 1 licence screens read-only and blank. What it costs today, on every v2 link: Part 2 asks again for the phone, the current address, the CDL's number, state and expiry, the other licences and §40.25(j); filing lays Part 1's values over them (`composeFiledApplication`), so what the driver types there is thrown away; and the review screen, the signing summary (`SignOffFields`) and the office's drawer all print the DRAFT's values, which can disagree with the filed document — worst for §40.25(j), where the draft's untouched "No" can sit beside a Part 1 "Yes". There is also no channel for "Tell us": no field or table holds an applicant's correction request. | (a) serve Part 1's facts behind the date-of-birth unlock — `unlockDraft` checks against `drivers.date_of_birth` on a v2 link (the draft stops holding one once "About you" stops asking it, so the draft's own lock would never engage) and returns the facts beside the draft; the page shows them read-only and stops asking them; the review, the signing summary and the office drawer compose with the shared `composeFiledApplication`, as filing does; "Tell us" is a free-text `correction_note` on the draft contract, shown on the office drawer — no migration; (b) serve the facts on the bare link — breaks D-APP16; (c) keep asking in Part 2 and drop the overlay — reverses D-AW3 | **(a)**, as **C3c2c2**, one PR (the unlock change is the security-relevant part; the rest is page work). Until it lands the Part 2 fields stay as they are: removing them without a read path would leave the review printing blanks and defaults in their place, and the dead §40.25(j) box is labelled so in `SafetyHistoryFields.vue`. | **RULED (a) by the owner 2026-09-27; BUILT in C3c2c2.** |
| **Q-AW35** (C3c2c2, 2026-09-27) | Part 1 lets an OTHER licence go without an expiry (`PartOneOtherLicences`: optional), and filing then refuses the whole v2 application — `composeFiledApplication` names it ("Give the expiry date of your OH licence", (b)(5) needs the date to know whether it is unexpired) — while no screen can supply it: Part 2 shows Part 1's licences read-only (C3c2c2), and before that its list was replaced by Part 1's anyway (C2c). So any v2 applicant who lists another licence without an expiry cannot be filed, by anyone short of SQL. Production has 0 v2 invitations (measured 2026-09-27), so nobody is stuck yet. Part 2's licence screen now says "no expiry date given" on such a licence. | (a) Part 1 REQUIRES the expiry for every licence, hint "the date printed on it — even if you gave it up"; no migration; (b) Part 1 asks "do you still hold it?" and requires the date only for a held one, composition skipping a surrendered one — needs a column (migration + reader, two merges); (c) an office writer for Part 1's licences (Q-AW36) | **(a)**, a few lines in Part 1 plus its test, before the first real v2 applicant — the driver is holding the question at the only moment anyone can answer it. (c) is still owed, for the licence the driver gets wrong anyway. **RULED (a) by the owner 2026-09-27; BUILT** — required on screen 6 AND in the contract the intake route parses, so no client can store a licence filing would refuse. |
| **Q-AW36** (C3c2c2, 2026-09-27) | The office has no way to CORRECT a Part 1 fact except the date of birth and the CDL's number and state (`correctApplicantIdentity`, `p_overwrite`). The phone, the current address, the CDL's class and expiry, the other licences and §40.25(j) are written only by the applicant's `record_applicant_intake` (fill-only). "Something wrong? Tell us" (C3c2c2) now reaches the office's drawer as a note — but the office can read it and cannot act on it; and C3c2c2 also, correctly, stopped the drawer offering the draft's copies of those answers, because filing overwrote any correction made there. | (a) an office "Correct Part 1" act: `record_applicant_intake` with `p_overwrite = true` (it already takes the flag), audited like the identity correction, reachable from the drawer beside the note; no migration; (b) send the applicant back to Part 1 — reopens screening | **(a)**, as its own PR; it is the other half of the "Tell us" path, and the function already exists. **RULED (a) by the owner 2026-09-27.** **BUILT 2026-09-28** — without §40.25(j) and §382.301(b): those are the applicant's statements, and an answer the office typed is not the answer to the question the regulation has the employer ask. |
| **Q-AW37** (C3c3, 2026-09-27) | An invitation may be nudged ONCE, ever (0232: `where nudged_at is null`, never cleared). C3c3's Part-1 reminder would spend it, and a driver who then stalls in Part 2 — the form with their work history in it — would never be asked back; the office alert shares one dedupe key per invitation too. | (a) one reminder shared by both parts, no migration; (b) one per part: the function allows a stamp that predates `application_sent_at` (a Part 1 reminder), derived rather than a second column — a migration, then its reader | **(b)**. **RULED (b) by the owner 2026-09-27; 0377 built in C3c3a**; the Part-1 sweep is C3c3b. |
| **Q-AW38** (C3d, 2026-09-28) | AW10 names Supabase TUS for "an upload cut at 50% resumes" (§6.8). Supabase's resumable uploads use a FIXED 6 MB chunk ("must be set to 6MB (for now) do not change it", Supabase docs, read 2026-09-28), and a capture is downscaled to 1568 px WebP q80 — "the low hundreds of kilobytes" (`APPLICATION_CAPTURE_MAX_BYTES`'s header). Every capture is therefore ONE chunk: a cut at 50% restarts from zero exactly as today's signed-URL PUT does, and `tus-js-client` would cost apply-route JS (§6.8's 200 KiB) for nothing. What a cut actually loses today is the PHOTO: the encoded bytes live only in the page (an object URL) until `confirm`. | (a) keep the encoded photo in IndexedDB until `confirm` and replay `stageCapture`'s three calls on reconnect — §6.8's bar reworded to "retried from the kept photo, never re-taken"; (b) build TUS anyway; (c) raise the capture size until chunks matter | **(a)** — the defect is a re-take, not a re-send. **RULED (a) by the owner 2026-09-28**; it is C3d2. |
| **Q-AW39** (C3d, 2026-09-28) | AW10's local replay puts screens 3–6's answers — the date of birth, the CDL number, the address — at rest on the device before screen 7, and the link may be opened on an office computer (the desktop handoff, C3b2b2). D-APP16 keeps a date of birth off the bare link; nothing yet says how long one may sit in a browser. | (a) screens 3–6 only, never screen 7's answers; deleted the moment screen 7's write lands, and at the EARLIER of 72 hours and the link's expiry, every read sweeping every expired copy on the device; (b) the same without the date of birth (retyped after a reload) | **(a)**. **RULED (a) by the owner 2026-09-28; BUILT in C3d1a.** |
| **Q-AW30** (C2d2, 2026-09-27) | G-2 and §8.5 say "exact-keyword STOP". Built instead: CANCEL, END and QUIT count only as the whole message (G-2's false positives — "I'll quit my job", "end of the week"); STOP, STOPALL, UNSUBSCRIBE, REVOKE and OPT OUT still count anywhere. Reason: the public terms page promises "please stop texting me" works, the existing test pinned "help me stop these texts" as an opt-out, the FCC's §64.1200(a)(10) standard is "any reasonable means", and a false positive is now undone by START. | (a) as built; (b) every keyword whole-message only, terms page loses the "plain request" sentence; (c) counsel rules | **(a)**; (b) is a one-line change in `isStopMessage` plus the terms page, if the owner prefers it. **RULED (a) by the owner 2026-09-27** — as built. |
| **Q-AW40** (2026-09-28) | The owner wants test applicants, and applicants generally, deleted outright by an admin: archiving (`drivers.archived_at`) leaves them in the database. Today nothing can: `trg_guard_driver_hard_delete` refuses DR010 ("archived, never deleted") except inside `merge_driver`, and `driver_applications`, `esign_consents`, `application_packet_marks`, `application_drafts` and `application_captures` each refuse a delete by trigger. Measured on production 2026-09-28: the two test applicants (`d61557dc`, `f2b142e4`, both in the real fleet's org) hold 1 filed application, 1 qualification record, 8 permissions, 2 e-sign consents, 20 packet marks, 2 drafts, 1 capture and 1 employment row. | (a) an admin-only "Delete applicant permanently": a migration adds `purge_applicant(p_org, p_driver, p_actor)`, which sets a session flag every one of those guards honours (the `merge_driver` pattern), deletes the applicant's rows and invitations, and refuses a driver who was ever hired; the api removes the Storage objects and writes one `audit_logs` row (`driver.purged`: ids and counts, no name); the screen asks for step-up and the typed name. Migration, then reader — two merges; (b) archive only | **RULED: hard delete, admin only (owner, 2026-09-28).** Built as (a). ⚠ **An applicant only, never a driver who was hired**: a hired driver's qualification file is §391.51 evidence kept for the length of employment plus three years, so the refusal is part of the ruling as built, not a detail — say if it should be otherwise. |
| **Q-AW41** (2026-09-28) | The link's lifetime (14 days, extended by 14 on every send, reminder and signing opened; `INVITE_TTL_DAYS_DEFAULT`) and the reminder (after 48 hours without progress, once per part; `STALE_DRAFT_HOURS`) are constants. The owner: drivers often finish over a couple of days, and the carrier wants control. | (a) Settings → Recruiting: the default link lifetime (1–60 days), the reminder delay in hours and an on/off switch; a per-invite override in the invite drawer (the api already takes `expires_in_days`). New columns: a migration, then the reader — two merges. The 72 hours a phone keeps unsent answers (Q-AW39) stays fixed: it is a privacy rule, not a convenience; (b) leave the constants | **(a). RULED by the owner 2026-09-28.** |
| **Q-AW42** (2026-09-28) | There is no place to add a carrier Representative or a road-test examiner ahead of time: each is added only inside one driver's panel, and only once that driver reaches the step (`HandbookPanel.vue`, `RoadTestPanel.vue`). So the owner could not add the Representative the countersign needs. | (a) a register under Settings, beside Q-AW41's settings, listing both with add and remove (the api exists: `/recruitment/representatives`, the examiners' routes); no migration; (b) keep them in the panels | **(a), under Settings. RULED by the owner 2026-09-28.** |
| **Q-AW43** (2026-09-28) | Q-AW17's fines. | — | **DEFERRED by the owner 2026-09-28**: the fines stay as they are until the hiring process works end to end. Counsel's question is written (`COUNSEL-REVIEW-PACKAGE.md` Q18, added 2026-09-28) and goes with the rest of the memo. **#1059 stays held.** |
| **Q-AW44** (2026-09-28, found building P1) | After a purge the applicant's **name and email survive in `audit_logs`**. Measured on the two test applicants: 16 audit rows, and `driver.created` (`meta.fullName`), `compliance.application_invited` (`meta.email`) and `driver.archived` (`meta.fullName`) carry them. `audit_logs` is append-only evidence, so 0380 leaves it alone rather than decide this by rewriting it. Separately, for **real** applicants rather than test ones: federal record-keeping (29 CFR §1602.14, for employers Title VII covers) generally keeps an application for a year after it was made or acted on. So "applicants generally" may be narrower than the ruling reads. | (a) keep the audit rows as they are; the purge removes the applicant from the product, and the trail of who did what stays; (b) the purge also blanks the name and email in that driver's audit `meta` (a second, named exception to append-only); (c) from now on audit rows carry ids, never names or emails, plus (b) for rows already written. Real applicants: (i) purge anyone never hired, as ruled; (ii) purge only after a year, or only test applicants, until counsel answers | **(a) now, and (c) as its own small step if the owner wants names gone.** For real applicants, **(ii)**, with the question going to counsel as the memo's Q19. P2 can ship either way; the test applicants are not covered by the record-keeping rule. |

---

## 12. Progress log

Append dated lines at the END.

- 2026-09-26 — Plan written, then verified by three independent passes (code, law/vendors,
  feasibility); every correction folded in. Nothing built. C0 has a deadline of 2026-09-28 18:00 UTC
  (`d61557dc`'s link). PR #1059 stays open until C2.
- 2026-09-26 — Owner ruled the signing model: prefilled documents, reviewed by the office, sent to the
  driver's phone with a new link, one adoption at the start, one click per place, section to section
  (D-AW14–D-AW17, §6.9, C3s). Resolves Q-AW1 and Q-AW18; adds G-13. Verified at the call sites:
  SMS consent is live (`sms-2026-09-25`), the signing screen sits behind the date-of-birth unlock.
- 2026-09-26 — Second audit (three adversarial passes: precision, consistency, regressions), every
  critical finding re-checked at the call site or in production. Corrections folded in: M1 fully
  specified (§8.2) incl. `complete_applicant_intake` (Part-1 promotion would otherwise collide with
  filing's `documents` insert, 0231:139–147), the `submit_driver_application` and
  `record_driver_release` overloads, no-default overloads with their own grants (PGRST203, 0258),
  `sms_outbox` holding no links, the 0237 restrictive policies for the new kind; the HB022 change moved
  to M2 with `OR submitted_at` (`d61557dc` has `signing_opened_at` NULL — measured); A-2's fix moved
  below the early return (`handbookSigning.ts:107`), with a SQL fallback; the intake stamp moved before
  the permissions; a stated legacy rule for all 8 invitations; D-AW14 now supersedes D-AF6/D-AF7,
  with a 72 h link, an unlock attempt counter and a one-time code (0 SMS consents in production —
  email is the channel); two filings in one envelope; AW1–AW14 defined (§8.4); C0 split into
  C0a/C0b/C0c; critical path stated. **Deadlines:** `d61557dc` 2026-09-28 18:00 UTC; `f2b142e4`
  2026-10-01 22:14 UTC.
- 2026-09-26 — **C0a built** (`claude/handbook-link-extend`): every "Open handbook signing" press on a filed,
  unfiled-handbook invitation sets `expires_at = max(expires_at, now + INVITE_TTL_DAYS_DEFAULT)` before the
  already-opened return, audited `recruiting.handbook_link_extended` (invitation id + `expiresAt` only);
  HB021 on the countersign → 409 `link_expired` with words. **Found at the call site, not in the plan:**
  `HandbookPanel.vue` hid its only button once signing was open, so an extension on "every press" had no
  press for an opened handbook such as `d61557dc` — the office's status now carries `linkExpiresAt`
  (`OfficeHandbookStatus`) and the opened state shows the expiry with **Extend the driver's link** (the same
  route). The driver's half is unchanged: `resolveInvitation` answers a lapsed link `invalid_link` on purpose
  (no existence probe), so HB021 there is only a race.
- 2026-09-26 — **C0a merged** (#1063, main `7c566bf`). **C0b built** (`claude/handbook-self-adopt`), labelled
  as the workaround D-AW15 removes: `handbookSelfAdoption.ts` names the one state (filed, handbook open and
  unfiled, 0 packet marks); in it `openSession` lets a `signature_mark` through after filing, the handbook
  screen runs the packet's own adoption screens (`useHandbookAdoption.ts`), and the first place carries the
  typed name, which every later place reads back from the first `handbook_marks.signed_name`. The first
  place is refused (`handbook_adopt_signature_first`) until a picture is staged. **Two guards the plan did
  not name, both G-13:** a picture the permissions ceremony staged before filing is never replaced (the
  capture branch refuses it), and `permissions.ts` no longer draws a picture staged after filing, since
  every permission was signed before it (`signatureMarkBytes(…, stagedBefore)`).
- 2026-09-26 — **C1 merged** (#1065, main `70bef16`): 13 files split, pure moves (every removed line re-added,
  only `export` keywords and import lists differ). **C0c built** (`claude/applicant-audit-fixes`): A-3 one
  `LICENSING_AUTHORITY_MAX_LENGTH` (80) on both doors; A-4 `paperOnlyPurposes` + "waiting on us" once
  `releases_completed_at` is set, named in the drawer (the checklist builder only — the board's twin is G-7's,
  C2); A-6 `handbook_version` on each mark (409 `handbook_changed`) and the countersign refuses marks under
  another text; A-7 paper grants carry the live `invitation_id`, no office IP/UA, 23505 → 409
  `already_granted_on_link`; A-8 `roadTestCounts` (`source = road_test` or `passed`); A-9
  `CEREMONY_OWNED_KINDS` refused on the generic DQ door (the drawer reads the same sentences) and PATCH
  `applicant → active` → 409 `use_hire`; A-12 re-read and confirmed: refuse a missing examiner signature and a
  pass with no licence number before anything is filed, and "today" is the carrier's day (`todayInZone`);
  G-5 binder footer on the embedded face, `pdfUnicodeText` composes NFC first (measured: a decomposed "ć"
  printed as "c"); G-6; G-8 withdrawn pages derived from `PACKET_WITHDRAWALS` (4, 15, 19, 20, 22), the blank
  packet prints no on-screen notices, the paper door and its advice need `session.can('recruitment')`; G-9 per
  Q-AW15's default — draft wording refused, `verbal_documented` needs its record; **the signing-date field
  needs a column** (`driver_authorizations.signed_on`, requested for M1), so its writer is owed by C2; G-12.
- 2026-09-26 — **C0c merged** (#1066, `a7cfc14`). **M1 merged** (#1067, `e5f9854`) and **verified applied in
  production** the same day (columns, tables, both overloads beside the old signatures, the four new functions, the
  kind CHECK). C2 may start. Handoff: `HANDOFF-2026-09-26-APPLICATION-FLOW-V2.md`.
- 2026-09-26 — **C2 split into four PRs** (C2a intake, C2b office screening + state machine, C2c filing, C2d SMS),
  in that order, because C2's 5–6 days in one diff would hide every change inside it. **C2a built**
  (`claude/applicant-flow-c2`): AW2 — `applicantIntake.ts` + `POST /apply/:token/intake`, `/intake/licences`
  (the list's order IS the positions, 0 = current CDL), `/intake/complete` (promotes `cdl_front`/`cdl_back`/
  `medical_card` only, idempotent, audited with a count); `applicantScreeningContract.ts` (US-only E.164 phone via
  `normalisePhone`, US-state address, `JURISDICTION_CODES` licences, 0376's 40-char number, the roster's
  `CDL_CLASSES`/`ENDORSEMENT_CODES` — **endorsements stay a declaration on the intake row**, the M1 reading
  decided: no certification without an `effective_from`); on a v2 link (an intake row) `recordRelease` refuses
  `intake_incomplete` BEFORE the identity rule; `intakeCompletedAt` on the link's phases; `medical_card` left
  `APPLICATION_ONLY_CAPTURE_SLOTS` (D-AW4). AW1 — employer `key` (uuid, optional in the base schema),
  `employment_gaps[]` (+ `APPLICATION_SECTION_KEYS`), and `applicationV2FilingIssues()` (address, reason,
  (iv)(A)/(B) on (b)(10) employers only, every gap > 30 days explained); it is enforced at filing for v2 invitations
  in C2c with the composed payload. `RETENTION_FORBIDDEN` + the five tables; the `sms_outbox` and screen-events
  RULES wait for their writers, as `table-modules.json` says. **Found:** C0c's merge had put
  `applicationContract.ts`'s employer code back inline, leaving C1's `applicationEmployerContract.ts` imported by
  nothing — restored. **Not here:** the FCRA summary acknowledgement (its text and version are AW3's, C3 — no
  version string for text the repo does not hold), so `/intake/complete` answers AI007 until C3 ships it.
- 2026-09-26 — **C2a merged** (#1069, main `feca844`). **C2b split again**, for the reason C2 was: C2b1 is G-7
  alone, so the §7 state machine (C2b2) lands on ONE builder instead of being added to two. **C2b1 built**
  (`claude/applicant-checklist-inputs`): `applicantChecklistInputs.ts` is the one builder of `hiringChecklist`'s
  input — the board calls it for every row, the drawer for one — over `applicantBoardReads.ts`'s set-based reads,
  now PAGED (`fetchAllPaged`, ordered by `id`) past PostgREST's 1,000 rows. **Measured drift it closes:** the
  board folded no `roadTestPassed` (A-8) and no `releasesCompletedAt` (A-4), so a failed road test read done on the
  board and not done in the drawer; the pipeline's draft read had no `.in()` and read every draft in the org. A-4
  is on the board as a consequence. Pinned by a parity test (both doors, one fixture) and a 1,001-row paging test,
  each proved by mutation.
- 2026-09-26 — **C2b2 built** (`claude/applicant-flow-c2b2`), and **C2b split once more** for the reason C2 was: C2b2
  is §7's state machine + AW11 (travel), C2b3 is AW8 (drug-test appointments, the portal-consent fact) + AW12 (employer
  phone checks) + AW7's remainder. **§7:** `intake_completed` (2nd) and `travel_booked` (after the medical certificate);
  ordinals derived from the index (`HiringStepDefinition` has none); `permissions_signed` and `medical_certificate`
  require Part 1; `office_approved` and `orientation_videos` left the travel range; `TRAVEL_REFUSES_WITHOUT` derived
  from `beforeTravel`; **G-11** — `hired.requires` and `readyToHire` both read `HIRE_REFUSES_WITHOUT`, so the hire row
  no longer reads "Blocked by Previous employers checked" while the hire goes through (the investigation warns, per
  Q-HM5); `unbuilt` names the orientation rows on the card ("Not built yet"); `APPLICATION_SEND_WARNS_ON` + the medical
  certificate. **Legacy rule** in the fold only (no Part 1 row → done on `releases_completed_at` or identity on the
  driver's row) — measured on production's 8: `d61557dc` and `f2b142e4` read done, the six untouched read theirs.
  **Found by a test:** the identity half made an UNINVITED driver read "Part 1 finished"; the rule now needs an
  invitation. **D-AW7 read:** `travel_booked.requires` IS `TRAVEL_REFUSES_WITHOUT`, stamped like `hired`'s — the row is
  blocked exactly when the writer refuses; no step before travel gains an edge, which is what D-AW7 refused. **AW11:**
  `applicantTravel.ts` + `GET/POST /recruitment/applicants/:driverId/travel`, `DELETE …/travel/:id` (cancel; a
  rebooking inserts first, then cancels the older live trip); times typed as the carrier's wall clock and converted
  with `wallClockToUtc` in `organizationTimezone`; audited without the booking reference; `TravelPanel.vue`; the
  producer waiver left. The invitation card reads "Part 1 in progress / finished" (`has_intake`). **Owed, named:** the
  MVR's jurisdictions from `application_intake_licences` and the 30-day freshness (AW7) go to C2b3 — no v2 link exists
  until C3; **C3 must mint the `application_intakes` row when a v2 invitation is created** (or state the cutover date),
  because "no row" is the whole legacy test and a new link that has not begun Part 1 would otherwise read legacy.
- 2026-09-26 — **#1059 (D-PKT21 fines, D-HB7 receipts) was merged by mistake** (`7824337`) against this plan's hold
  (§8.5 C2: "merges here only after Q-AW2 and Q-AW17 are ruled"), and **reverted** the same evening on the owner's
  word. `f2b142e4` (20 marks, unfiled) was never filed while it was live. It re-merges after Q-AW2 and Q-AW17 are
  ruled and A-5 (C2c) has landed.
- 2026-09-26 — **C2b3 built** (`claude/applicant-flow-c2b3`): AW7's remainder, AW8, AW12. **AW7:** the MVR is owed per
  licence from, in order, Part 1's list (`application_intake_licences`), else the live draft, else `drivers.cdl_state` —
  the first that has any, never a union. **The plan's legacy copy into `application_intake_licences` is NOT built:**
  measured on production, every draft names one state and no additional licence, so source 3 already holds what a copy
  would carry. **G-3:** an MVR counts only if `occurred_on` ≥ 30 carrier days before Part 1 finished (legacy: before the
  invitation) — `mvrFreshSince`, `MVR_FRESH_DAYS`; the fold's input `mvrJurisdictions` became `mvrs` (jurisdiction +
  date). Production held 0 MVR rows, so no row changed colour. **AW8:** `drug_test_appointments` writer
  (`applicantDrugTest.ts`, `GET/POST/DELETE …/drug-test-appointments`, `DrugTestPanel.vue`) — operational, never read by
  the fold (the step already rests on "them"); **not sent to the driver** — `sent_to_driver_at` is C2d's, through
  `sms_outbox`. **D-AW5:** `clearinghouse_portal_consent` in `QUALIFICATION_RECORD_KINDS` + `TESTING_RECORD_KINDS`;
  `POST …/clearinghouse-portal-consent` (safety manager/admin, same-day replay); the Clearinghouse row now reads
  **"waiting on them" until a consent is on file**, then "waiting on us"; the drawer warns (never refuses) when the drug
  result is not in. **AW12:** `employer_verification_calls` writer (`applicantEmployerCalls.ts`, `…/employer-calls`,
  `EmployerCallsPanel.vue`), keyed on the draft's employer `key`, name read from the draft, refused after filing;
  **filing copies the calls now, not in C2c** — `submitApplication` passes `p_call_summaries` (rendered by
  `verificationCallSummary`, `PHONE_CALL_WORDING_VERSION` pinned to 0376's `'phone-call-v1'`) and so selects 0376's
  thirteen-argument overload whenever a call is uncopied, because a call filed through the old overload would never be
  copied. The apply form mints employer keys (`newEmployerKey`; `fromDraftPayload` mints for a keyless entry;
  `AddEmployerForm`). `carrierClock.ts` holds the one wall-time reading (travel moved onto it). `expectOrgScoped` learned
  that `organizations` read by `id` = org is scoped. 13 mutants, all killed. **Owed, named:** an employer typed before keys
  (`f2b142e4`'s, unless its draft is saved again) cannot take a call before filing — after filing it is on the inquiry
  list; C2c still owes the composed payload, A-5, A-10; C2d the sends.
- 2026-09-26 — **C2c built** (`claude/applicant-flow-c2c`). **Item 5 checked first — none of it existed:** G-9's
  `signed_on` writer, Q-AX5 (re-send link) and Q-AX6 ("invite them again") are named **C2e** (office link management),
  after C2d. **D-AW3/AW2:** a v2 invitation (a Part 1 row) files `composeFiledApplication` — the certified application
  with Part 1's phone, current street (the move-in month kept), licence position 0, the unexpired others as (b)(5)'s
  list (replacing the draft's, never a union; a licence with no expiry is an issue, never a drop) and §40.25(j) — and
  `applicationV2FilingIssues()` is enforced on that composed document (`application_incomplete`, 409, each issue named);
  a legacy invitation files what it certified. **A-5:** `packetTextVersion()` is a hash of every printed run of
  `correctedPacketTemplate()`, so a register entry (#1059's fines) moves it by itself — `PACKET_VERSION` did not, and is
  the instruments' version only. **Found:** the mark writer still called the 11-argument `record_packet_mark`, so no mark
  carried a version; it now stamps one through 0376's 13-argument overload (DR037 → 409 `packet_text_changed`). Filing
  refuses a mark under another text, and any unversioned mark pending Q-AW2 (the blocker is in §11: (b) needs no
  migration). **A-10:** the countersign claims `handbook_filing_claimed_at` by conditional UPDATE before the carrier's mark,
  hands it back on any failure, and takes over a claim older than 10 minutes; the road test records the live invitation
  (`readLiveInvitation`), refuses a second pass on it before filing anything, and answers 0376's indexes (23505, now
  `duplicate` from `insertQualificationRecord`) in words — the same-second race is Q-AW28. `postgrestFixture` now
  evaluates JSON-path filters (it read `detail->>source` as a column no row had). 22 mutants, all killed.
- 2026-09-26 — **C2c merged** (#1074, main `048bead`). **Found in CI, not in code:** a local full web run had flaked, a
  vitest retry wrote a stray `… may not see money 2` snapshot, and `git add -A` committed it; CI refuses obsolete
  snapshots (`CI=true` reproduces it). Removed before merge. **C2d split, for the reason C2 was:** C2d1 the outbox, C2d2
  STOP/START + suppressions + G-2, **C2e** office link management (G-9's `signed_on` writer, Q-AX5, Q-AX6). **C2d1 built**
  (`claude/applicant-flow-c2d`): `sendOrQueueSms` writes every link-free text to `sms_outbox` — sent at once inside the
  recipient's window (the row is where a receipt lands), else queued at `nextSmsWindow`; `runSmsOutboxOnce` drains each
  org's due rows every 5 minutes (`startSmsOutboxScheduler`, api service, listed in WORKER-DEPLOYMENT), cancelling a row
  that expired, whose consent was withdrawn or moved, or whose drug-test appointment was cancelled while it waited, and
  deferring one whose window shut again; the claim is a conditional `queued → sending` UPDATE (one process fleet-wide,
  so no `for update skip locked` function — no migration). **D-AW12:** `smsZonesFor(state)` from Part 1's state, the
  dominant zone READ from the EFS table (`stateTimeZone`) plus the second zone of each split state, all of which must be
  open; no ZIP refinement; unknown = the all-US window. **Three texts moved:** the opt-in confirmation, the approval
  notice, and the drug-test site (`POST …/drug-test-appointments/:id/send`, "Text it to the driver", `sent_to_driver_at`
  stamped by the table's owner when the text actually leaves). **Receipts:** `message.finalized` → delivered/failed on
  the row. Terms page corrected (the window, and that a link is never sent late). **Not moved, on purpose:** the three
  link-bearing texts — Q-AW29. **Found:** `postgrestFixture` compared every filter for equality, so a range (`lte`)
  matched nothing — fixed by operator and pinned. 26 mutants, all killed.
- 2026-09-27 — **C2d2 built** (`claude/applicant-flow-c2d2`): STOP/START + suppressions + G-2.
  `smsSuppressions.ts` is `sms_suppressions`' writer (waiver removed from `check-table-producers.mjs`, entry in
  `table-writers.json`). **STOP** revokes every live consent of each applicant on the number (through
  `withdrawSmsConsent`, so an older number no longer becomes the live one) and suppresses the number in every org that
  ever held a consent on it, even where nothing was live. **START/UNSTOP** (whole message only) lifts `stop`
  suppressions and nothing else — revocation stays final (0233), so texts resume once the applicant agrees again.
  `sendApplicationSms`, `sendOrQueueSms` (new hold reason `suppressed`, nothing queued) and the drain (cancels) all
  refuse a suppressed number. **Agreeing** takes a dialable US number only (`normaliseUsPhone`, NANP; card and server
  share it), refuses a stopped number (`number_stopped`: "reply START first" — the page cannot undo a text), and at
  most `SMS_MAX_NUMBERS_PER_LINK` = 3 different numbers per link, revoked ones included, counted from the link's
  `created_at`. **Deviation, recorded as Q-AW30:** CANCEL/END/QUIT are whole-message only, the rest still match
  anywhere. Terms page corrected (whole-message words, START). 20 mutants, all killed.
- 2026-09-27 — **C2d2 merged** (#1076, main `d7b4356`); CI green on the merged head. Q-AW30 (STOP matching) awaits the
  owner.
- 2026-09-27 — **C2e built** (`claude/applicant-flow-c2e`): office link management. **G-9:** `POST /authorizations`
  takes `signed_on` (`YYYY-MM-DD`), required for `wet_signature`/`verbal_documented` and refused for `esign` (0376's
  CHECK), refused after the carrier's today, audited as `signedOn`; the paper form asks for "Date on the signed page"
  (never prefilled) and the panel reads "Signed on paper MM/DD/YYYY" instead of the recording instant. **Q-AX5 + Q-AX6,
  one action** (`applicationLink.ts`, owner 2026-09-27): `POST /recruitment/drivers/:driverId/application-invites/again`
  replaces the current invitation's token when `canResendApplicationLink` (shared: not revoked, handbook not filed —
  a FILED application's link is still re-sent, because D-AW1's third visit is the handbook), extending
  `expires_at` to `max(expires_at, now + 14 d)` by a conditional UPDATE, audited `compliance.application_link_resent`
  with the ids and expiry only, emailed with `renderApplicationLinkResentEmail` ("the earlier link no longer works");
  otherwise it opens a new, empty invitation (the owner's ruling). The create moved into the same module unchanged.
  The applicant's card offers "Send the link again" and hides "Create an application link" while the current link is
  re-sendable, so a lost link no longer strands a draft behind a second, empty application. **Q-AX6:** `GET
  /recruitment/applicant-matches` (applicants, archived included, same full name or email, case-insensitive,
  wildcards escaped); the board's drawer asks it before creating anybody and offers "Send them the link again" on the
  match, or "This is someone else — add them". `postgrestFixture` gained `ilike` (an unknown operator matched every
  row). 28 mutants, all killed. **Not built, named:** re-sending to an ARCHIVED applicant leaves them archived (the
  drawer labels them); changing the email on a re-send (the link is on screen to copy either way).
- 2026-09-27 — **C2e merged** (#1077, main `b166cb8`). The whole of C2 is done.
- 2026-09-27 — **C3 split into four PRs**, for the reason C2 was (8–9 days in one diff hides every change in it):
  **C3a** the Part 1 shell — AW3 (screens 1–10, 12, 20, the FCRA summary, the three-box date) + minting the Part 1
  row with every new invitation; **C3b** AW5 (PDF417 reader + AAMVA parser, shared, fixture-tested) then AW4 (the
  scanner wizard + server confirm, CPU per photo measured first), which replaces C3a's plain photo screens behind the
  same seam; **C3c** AW9 (the Part 2 task-list hub) + the Part-1 nudge; **C3d** AW10 (local draft replay, resumable
  uploads) + AW14 (screen events, Lighthouse CI, the 44 px sweep, the offline test). AW6 waits for Q-AW5.
- 2026-09-27 — **C3a built** (`claude/applicant-flow-c3a`). **The intake row, and no cutover date:**
  `createApplicationInvite` mints the new invitation's empty `application_intakes` row (`mintIntakeRow`, a direct
  INSERT — `record_applicant_intake` cannot write an empty row, AI009 — `on conflict` read as minted; a row that does
  not land revokes the invitation before its link is shown), so "has a row" stays the WHOLE legacy test and §7's
  "created before C3's merge" is true by construction. A re-sent link keeps its invitation and so its kind: the eight
  production links stay legacy. `applicantIntake.ts` is a new writer of `application_intakes` (table-writers.json). A
  row no longer means "begun": the office's list returns `intake_begun` (§40.25(j) answered) and the card reads an
  untouched v2 link "open". **FCRA summary (AW3, Q-AW13 default):** CFPB Appendix K, served in the bundle while Part 1
  is open (`fcraSummary.ts`), transcribed from the Bureau's PDF (committed with its extraction under
  `docs/plans/recruitment/fcra-summary/`, checked paragraph by paragraph and counted, `pspDisclosure.test.ts`'s bar).
  **Verified current:** the eCFR carries the model only as images (88 FR 58066); page 1 matches word for word, and
  the PDF already has both corrections of the only later amendment (88 FR 58065, effective 2023-09-25). Version
  `cfpb-appendix-k-2023-09-25`, pinned to a hash of the text; `POST /intake` takes `fcra_summary_version` and refuses
  any other (`fcra_summary_changed`, 409), so `/intake/complete` no longer answers AI007 for want of a summary. **The
  screens:** `partOne/` — a linear stepper, "Step N of 9", after the consent and in place of the legacy identity
  screen (a v2 link never sees it); screens 3–7 typed, 8–10 one photograph each (medical card or "I don't have one
  yet"), 12 the summary, whose Continue records the version and then ends Part 1; screen 20 is the
  permissions-received screen with the Clearinghouse registration added for v2 links. `AppMemorableDate` in
  `@silvicom/ui` (Q-AW12). **Found at the call site, not in the plan:** 0376 writes the date of birth only through
  `record_applicant_identity`, and only once licence position 0 exists — a date of birth sent first is dropped without
  an error — so screen 7's first write is three calls in one order (answers with §40.25(j), the licences, the date of
  birth), pinned by a test and two mutants. The licence list is replaced whole, so a RETURNING applicant's licence
  screens are read-only (the page cannot see the list it would overwrite; the office corrects it). 29 mutants, all
  killed. **Not built, named:** screen 3's legal-name confirm (no Part 1 writer for the name — it is asked in Part 2 as
  today); ZIP → city/state (Q-AW10's static table); a reload before screen 7 loses screens 3–6 until AW10's local replay
  (C3d) — the order is the owner's and §40.25(j) must come first, so it is recorded rather than reordered; the Part-1
  nudge (C3c); 44 px targets beyond the new date boxes (AW14, C3d); the scanner, "Upload a photo instead" and the desktop
  QR handoff (AW4, C3b).
- 2026-09-27 — **C3a merged** (#1078, main `5373f36`).
- 2026-09-27 — **CPU per photo measured** (§10, AW4's first task; before any server gate is built). The confirm's work —
  SHA-256 of the object, `sharp(buf, { failOn: "none" }).raw()`, `computeMetrics(…, 1024, channels)` exactly as
  `hazmatExtraction/image.ts` calls it — on an Apple M4 Pro, `sharp.concurrency(1)`, 15 runs after a warm-up, over a
  synthetic card-like photograph: **the web upload (1568 × 1045 WebP q80, 339 KiB) costs a median 34.7 ms of CPU
  (max 61.3), 26.6 ms of it sharp's decode**; portrait the same (34.7 ms); an unprocessed 12 MP phone JPEG (4032 × 3024,
  q90, 4.4 MiB — the bucket's 8 MiB cap bounds the worst case) 78.9 ms. So Part 1's three photographs cost ≈ 0.1 s of CPU
  per applicant: the confirm runs inline in its request, no queue. Not measured: a Railway vCPU (slower per core than
  this machine — C3b2 logs the figure from the service itself).
- 2026-09-27 — **C3b split in two**, for the reason C3 was: **C3b1** AW5 (the barcode), **C3b2** AW4 (the wizard, browser
  metrics, "Upload a photo instead", the desktop QR + "Text me the link", the `captureMode` label, the server confirm).
  **C3b1 built** (`claude/applicant-flow-c3b`). **Sources, committed, not remembered:** `docs/plans/recruitment/aamva/` —
  Annex D §D.12–§D.13 of the AAMVA 2020 standard (pdftotext, PDF pinned by sha256) and AAMVA's IIN table. Only the 2020
  edition (version 10) is published, so the parser reads §D.12's STRUCTURE for any version and only Table D.3/D.4's
  elements; a pre-2009 barcode yields fewer fields, never wrong ones. **Found in the sources:** (1) §D.13's example is
  one byte short of its own header's offsets as extracted — `DAK` is F11 and the text layer prints its two padding
  spaces as one; padded to its fixed width both numbers (0278, 0319) land to the byte, which the test pins; (2) AAMVA's
  IIN table lists Colorado as `GM` — the issuing state is derived by NAME through `jurisdictions.ts`, so the typo is
  never read. **Dates** take whichever of Table D.3's two orders is a real date (at most one can be), not `DCG`.
  `parseAamvaBarcode` (shared, pure) + `readLicenceBarcode` (web): `zxing-wasm/reader` 3.1.4 behind a dynamic `import()`,
  its 931 KiB binary served from OUR origin (the package defaults to jsDelivr, which the CSP refuses anyway), PDF417
  only, text mode `Plain` (the default `HRI` loses the separators — measured by mutation); the CSP gains
  `'wasm-unsafe-eval'` (WebAssembly compile only; no `eval`, no origin — pinned). The original photograph, not the
  1568-px upload, is decoded. Proved end to end: zxing's writer draws §D.13's example, the page's reader decodes it
  byte for byte. **Prefill:** blanks only; the address and the current licence fill as whole blocks or not at all;
  only while Part 1 is unbegun (after §40.25(j) the boxes are blank because they are on file, and the date of birth
  would be dropped as fill-only) — so a begun link does not download the decoder. Each prefilled screen says so; the
  CDL-back screen says once if the barcode could not be read. The first write's order (answers → licences → date of
  birth) is untouched: the barcode only changes what the boxes hold before it. **Q-AW31** (new): the CDL photos now
  come first, the only order in which the plan's own prefill can fill anything — default built, one array reverts it.
  **Not built, named:** the name (Part 1 has no name box — screen 3's confirm is still unbuilt); class and
  endorsements (`DCA`/`DCD` are jurisdiction-specific codes, not the plan's list). 25 mutants, all killed.
- 2026-09-27 — **C3b1 merged** (#1079, main `03de8e0`); CI green on the merged head.
- 2026-09-27 — **C3b2 split in two**, for the reason C3b was: **C3b2a** the server gate (§6.6.3), the browser metrics
  (§6.6.2) and the `captureMode` label (§6.6.7); **C3b2b** the wizard screen (§6.6.1: outline, Use this / Retake) and the
  fallbacks (§6.6.6: "Upload a photo instead", the desktop QR + "Text me the link"). **C3b2a built**
  (`claude/applicant-flow-c3b2`). **Server gate (D-AW9):** `confirmCapture` now downloads the object BEFORE the row
  (`captureVerification.ts`): SHA-256 compared with the browser's claim (case-insensitively), decoded by `sharp`,
  measured by `computeMetrics` at the config's analysis scale — then `stage_application_capture`, then 0376's
  `confirm_application_capture` (`server_sha256`, `bytes`, `metrics` + `configVersion`, `verified_at`). Bytes that are
  not the ones sent, or that are not a picture, stage nothing, are removed, and answer 422 `capture_not_intact` ("That
  photo did not arrive intact. Take it again."). The drawn marks are hashed and decoded but not measured (`metrics`
  null). A failed `confirm_application_capture` after a good check is logged, not refused — the photo was checked and
  is staged; the row reads unverified like every capture before this. `statObject`'s listing is gone: the download
  answers "is it there" and its byte count is the object's own. Each verification logs `[capture-verify]` with its CPU
  time, so the §10 figure can be read on Railway's vCPU. **`captureMode`:** `web_file_input` joins the engine's union
  and the web provider says it (it said `expo_camera`); the hazmat API's `z.enum` and 0133's CHECK are untouched (only
  the driver app registers hazmat documents). **Browser metrics NOT built — Q-AW32:** the advisory has no threshold to
  compare against (D-SCAN10), and computing a number nobody reads costs the driver's phone for nothing; the server's
  recorded metrics from this PR are the samples (a) needs. 12 mutants, all killed.
- 2026-09-27 — **C3b2a merged** (#1080, main `dcb66a9`).
- 2026-09-27 — **C3b2b split in two**, for the reason C3b2 was: **C3b2b1** the scanner screen (§6.6.1) + "Upload a photo
  instead" (§6.6.6, first half); **C3b2b2** the desktop QR + "Text me the link" (§6.6.6, second half). **C3b2b1 built**
  (`claude/applicant-flow-c3b2b`). `useApplicationCaptures` splits the press: `take(slot, source)` holds the photograph
  and shows it large (state `review`), and only `use` ("Use this photo") runs start → PUT → confirm — **nothing crosses the
  wire before it**, and `onStaged` (the barcode read, AW5) fires after `use`, never on a preview. `capture` keeps the
  one-press form for the documents list and the legacy identity step. **Failures split by what the driver does next:** a
  lost signal keeps the photograph held so "Use this photo" works again; 422 `capture_not_intact` (D-AW9) lets it go and
  offers only a retake (the documents list now says so too — it said "check your signal"). A Retake the driver closes
  leaves the held photograph on screen. "Upload a photo instead" is the same provider and gate with `pickImageFile("image/*")`
  (no `capture`); its retake reopens the file picker ("Choose another photo"). `PartOnePhoto` no longer wraps
  `DocumentCaptureFields`: an outline shaped to the document (ID-1 card for the CDL, a letter page for the certificate),
  the two-line hint, full-width buttons. **44 px:** `AppButton` gained `size="touch"` (`h-11`) rather than an `!h-11` at
  the call site. **Found at the call site:** Continue with a photograph held and not sent would ask the server, find the
  slot empty and say "Take the photo" to a driver looking at it — the flow now names "Use this photo" and asks nothing.
  No blur advisory (Q-AW32). 18 mutants, all killed — one ("take sends at once") first written as a `use` call under
  `take`'s own busy lock changed nothing, and was rewritten as a real one before it counted.
- 2026-09-27 — **C3b2b1 merged** (#1081, main `dd29b9c`); CI green on the merged head.
- 2026-09-27 — **C3b2b2 built** (`claude/applicant-flow-c3b2b2`): §6.6.6's desktop half. **"Desktop"** is
  `(hover: hover) and (pointer: fine)` (`useIsDesktop`), never the user agent; no `matchMedia` reads as a phone. On a
  desktop photo screen whose slot is empty, `PartOneHandoff` comes first: a QR code of THIS link drawn in the page from
  the route's token by `@silvicom/qr` (the link is a bearer credential — never sent to a QR service), black on white,
  `crispEdges`, pinned `scheme-light` — **found in CI:** hex fills fail `apps/web`'s own `lint:tokens` (ci.yml runs it by
  filter, so a root `lint:*` sweep misses it), and the tokens that replace them are `light-dark()` pairs under a LIVE
  dark-mode toggle, which would have drawn an inverted code. **"Text me the link", the owner-accepted default:** offered only on a LIVE consent; otherwise the
  existing optional `SmsOptInCard` sits beside the code (never a step, §64.1200(f)(9)(i)(B)), and agreeing there turns
  the button on. `POST /apply/:token/text-link` takes an empty body, composes the link from its own `:token`
  (`smsApplicationPhoneLink`, no "earlier link" line — nothing rotates), stores it nowhere, and goes through
  `sendApplicationSms` **directly — send-now-or-never, never `sms_outbox`** (Q-AW29's default); every hold answers
  `{ outcome: "held", held }` and the page says so, each ending at the QR code (quiet hours → "use the QR code"). The
  zone is the strict all-US window (Part 1 asks the address after the photos). **Its own limiter**, 3 per link per 10
  minutes (`textLinkLimiter`, keyed like the ceremony's): the intake's 20 a minute protects the server, not the
  applicant's phone. **The desktop moves on by itself:** `useHandoffPoll` re-reads the bundle every 10 s (6 a minute
  against the intake's 20), not while the tab is hidden, and advances through `next` (so `photoDone` decides).
  **Found by a test:** "waiting" read from `inputs` live turned itself off in the tick that found the photo — the
  poll's own refresh is what puts it there — so the page never moved; it is now decided on arrival at the screen. A
  screen reached by that automatic move with its photo already there moves on again (the phone took both sides);
  one reached by Back waits. No new realtime channel, no migration. 25 mutants, all killed — three survived the first
  pass and each was closed: an unused-constant mutant rewritten as a real one, a poll-interval test that read the
  constant back now uses the literal, and a missing "Back to a filled screen stays put" test. **Not built, named:** the
  new text is a new sample under the toll-free verification submitted 2026-09-25 (`14c37df3…`) — same programme and
  purpose as the reminder, which already carries the link, so no re-submission is assumed; the owner should say if
  Telnyx wants the sample set updated.
- 2026-09-27 — **C3b2b2 merged** (#1082, main `18b459e`) — AW4 is done. **C3c split in three**, for the reason C3 was:
  **C3c1** the §391.21 completeness a v2 filing already enforces (below); **C3c2** the Part 2 task-list hub (statuses, Part 1
  facts read-only, one-per-screen loops, check your answers, and the §391.21(d)/§391.23(i) notice as its "Before you send"
  screen — moved there from C3c1, its natural home); **C3c3** the Part-1 nudge. **C3c1 built** (`claude/applicant-flow-c3c`).
  **Found, and why it went first:** C2c's filing enforces `applicationV2FilingIssues` on every v2 link — every gap over 30
  days explained, the (b)(10) employer answers — but the page never collected `employment_gaps` (not in the draft shape,
  the autosave, the resume or the payload) and never ran those rules. So the first v2 applicant with a gap would reach the
  office, be approved, and be refused at filing, in the office, over an answer no screen asked for. Production held **0** v2
  invitations (measured), so nobody was stuck yet. **Built:** the draft carries `employment_gaps`; the employment screen shows
  one box per gap FILING computes (`applicationEmploymentGaps`, exported from shared so the boxes and the refusal are one
  list, over the jobs as they would be filed; a declared-unemployed driver gets the whole three years as one box);
  `reconcileGapExplanations` carries words to a gap that moved and drops them from one that closed. The wizard runs
  `v2FilingIssues` on each screen (only once the contract passes, filtered to the screen that owns the rule) and both acts
  run them before handing over and before certifying; the issue path names the gap (`employment_gaps.<start>`) so the
  message lands on its box. **(b)(3):** `addressCoverage` (shared, whole months, no tolerance, the window's first month must
  be covered) is a new v2 filing rule and a meter on the address screen. **The day:** the bundle serves `carrierToday`
  (`todayInZone` on `carrierZone`), the day filing judges against — the employment screen had used
  `new Date().toISOString()`, the UTC day. **(b)(1):** the bundle serves the carrier's `legal_address` (what the PDF already
  prints) and the form names the employing carrier. **(b)(12):** the certify box now reads the regulation's sentence word for
  word ("this application was completed by me" was missing); §391.21 committed from the eCFR (as of 2026-09-24,
  `docs/plans/recruitment/cfr-391-21/`) and tested against. **Found at the call sites:** the filed PDF printed neither
  (b)(10)(iv) answer nor any gap explanation, and the review screen (which the office's drawer reuses) neither — all four now
  print (a pre-AW1 row says "Not asked" rather than inventing a No); rasterised with a long fixture, no overprint. An empty
  gap box is never autosaved: the office's correction path parses the whole saved draft with the contract, where an empty
  explanation is invalid, so one saved empty box would have refused every office correction. **Recorded as Q-AW33:** the two
  (b)(10)(iv) answers are derived or defaulted, never asked — for C3c2's employer loop. 30 mutants, all killed — two
  survived the first pass (nothing pinned that filing's rules wait for the contract, or the review's (iv) rows) and each
  gained its test.
- 2026-09-27 — **C3c1 merged** (#1083, main `0c14ecd`); CI green on the merged head. **C3c2 split in three**, for the
  reason C3 was: **C3c2a** the task-list hub + the notice before sending; **C3c2b** one employer per screen with the two
  (b)(10)(iv) questions asked Yes/No with no default (Q-AW33's recommendation); **C3c2c** the other loops (one address per
  screen, the driving record's yes/no gates) and Part 1's facts read-only on "About you" and "Your licences". **C3c2a built**
  (`claude/applicant-flow-c3c2`). **The hub (§6.4, D-AW11):** a v2 link's Part 2 opens on its task list on every return
  (`useTaskHub`, a layer over the wizard — same screens, validation and high-water mark); a legacy link keeps the linear
  wizard. Statuses are DERIVED (`taskHub.ts`): Not started = nothing on it would be filed (`toApplication`, so an accidental
  blank row does not count); Completed = its screen's own check passes, v2 filing rules included (`validateSection`, C3c1),
  so a gap left unexplained keeps employment In progress; "Before you send" reads Cannot start yet until every REQUIRED task
  passes — the carrier's questions and the photographs are marked optional and never hold it. "Save and continue" closes a
  task only when it passes; "Back to your application" is never gated. Rows are 44 px. **The notice (§4's (d) row):**
  `EmployerCheckNotice` opens the review screen for every link — §391.21(d) and §391.23(i), both fetched from the eCFR and
  committed (`cfr-391-21/391.23.txt` is new); the three rights are (i)(1)(i)–(iii) in the second person and the test turns
  each back into the third and finds it in the source word for word; (i)(2)'s four limits kept. It was delivered only inside
  Part 1's previous-employer release, weeks before the application exists. `ApplySection.vue` holds the section switch,
  moved out of `ApplyPage.vue` (421 → 424 lines with the hub added). 19 of 19 real mutants killed; six survived the first
  pass — five were test gaps (the notice's rights matched as substrings, so a shortened right passed; no test mounted the
  review screen or pressed "Save and continue"), each closed; the sixth, exempting the optional tasks from the gate, is a
  no-op (neither optional screen can fail today), so the exemption was removed as a rule that would one day open the row
  onto a refusal.
- 2026-09-27 — **C3c2a merged** (#1084, main `61ba17e`).
- 2026-09-27 — **C3c2b built** (`claude/applicant-flow-c3c2b`): one employer per screen on a v2 link (§6.4 item 4) and
  **Q-AW33 built as (a)**. **The panel was reworked, not replaced:** `EmployerDrawer` (a `SlideOver`) already was one job per
  screen with the list as the loop's hub, so what changed is what it asks. On a v2 link it asks, in §6.4's order, name,
  from, to, address, reason for leaving, the two (b)(10)(iv) questions, drove a CMV — and Save runs the row schema, then
  `applicationV2FilingIssues` for that job alone, so a job cannot return to the list in a state the filing refuses; a saved
  job reopened shows at once what it still owes, and its row on the list says "Some answers are missing" when the page has
  refused something inside it (`hasIssueWithin`, by id prefix). A legacy link keeps the owner's 2026-09-11 panel: three
  fields, the rest under "(optional)". **Q-AW33:** (iv)(A)/(B) are asked Yes/No with nothing chosen (`YesNoField`, which
  is Part 1's `PartOneYesNo` moved up a level so both parts share one control), only of a v2 job whose dates put it in
  (b)(10) (`employmentSegments`, the filing's own test); `emptyEmployer` holds `null`, and null survives the draft,
  autosave, resume (`fromDraftPayload` keeps a saved boolean — the 9 legacy rows in production's 6 drafts, all `false`,
  measured — and reads anything else as unanswered), the payload and the contract, so the rule that already existed
  fires on the page for the first time. The wording is plain words for the regulation's, held against
  `cfr-391-21/391.21.txt` phrase by phrase (`EmployerQuestions.test.ts`); filing's (iv)(A) message lost "FMCSRs". **Found
  at the call sites:** the office's `AddEmployerForm` DERIVED both answers too, and `editableFields` offers no correction
  for a null cell — so it now asks both, of every row, and will not add a row without them (§11's Q-AW33 row says why).
  The review showed a null as "No"; it and the PDF now say "Not answered" (the PDF said "Not asked", which a legacy driver
  who skips an asked question would make false). **44 px:** `AppRadioGroup` and `AppCheckbox` gained `size="touch"`
  (padding to 44, first-line alignment kept — `min-h-11` alone left each radio at the top of its row, seen at 390px); the
  list's Change/Add and the panel's footer use `AppButton size="touch"`. 38 mutants, 37 killed; the survivor is `submit`'s
  own `unanswered` guard, a no-op behind the button's `:disabled` on the same condition (killed separately). No migration.
- 2026-09-27 — **C3c2b merged** (#1085, main `b807381`); CI green on the merged head.
- 2026-09-27 — **C3c2c split in two**, because one of its three parts needs a capability that does not exist: **C3c2c1**
  the address loop and the driving record's gates (built, below); **C3c2c2** Part 1's facts read-only on "About you" and
  "Your licences" with "Something wrong? Tell us" — **blocked, recorded as Q-AW34**: the page cannot read Part 1's answers
  (the bundle serves booleans only, D-APP16), so a v2 Part 2 still asks for them again, filing throws the retyped values
  away, and the review, the signing summary and the office drawer print the draft's, which can disagree with the filed
  document (§40.25(j) worst). Recommendation (a): serve them behind the date-of-birth unlock. **C3c2c1 built**
  (`claude/applicant-flow-c3c2c`). **One address per screen (§6.4 item 2), v2 only:** `AddressHistoryFields` is a list +
  `AddressDrawer` (a `SlideOver`, the job loop's shape: edits a copy, checks the row against `applicationAddressSchema` on
  Save — `toAddressPayload`, lifted out of `toApplication` — focuses the first refusal), rows flag "Something here is
  missing" (`hasIssueWithin`), the meter stays and now carries the `addresses` id, so a (b)(3) refusal lands on it; a new
  address reuses the empty draft's blank row, and removing the last leaves one blank row (what a reload floors to). A
  legacy link keeps its inline cards; both render `AddressFields`. ZIP → city/state NOT built (Q-AW10's static table does
  not exist in the repo). **Driving record (§6.4 item 6), both link kinds:** (b)(7), (b)(8), (b)(9) are Yes/No gates with
  nothing chosen, the lists open only on Yes (the first row with the answer), plain words tested against
  `cfr-391-21/391.21.txt`. (b)(7)/(b)(8) storage is unchanged (the gate is derived from `declares_no_*` and the rows);
  **(b)(9) was defaulted `false`** — the "no such denial has occurred" statement made for the driver, Q-AW33's defect on
  another paragraph — and is now `null` until answered, left OUT of autosave while null (the office's `.partial()` parse
  allows absent, not null), kept when saved, "Not answered" on the review. **"No" clears the list it closes:** the old
  checkbox hid rows it kept, so an accident typed and then "none" ticked filed both. An old draft holding both reads as
  No, and Yes brings the kept rows back. §40.25(j)'s Part 2 box stays, labelled dead on a v2 link (Q-AW34 removes it).
  44 px throughout. 38 mutants, all killed — two survived the first pass (a "second Yes" test that clicked a radio already
  checked, and nothing pinned that "Add" stays hidden before Yes); each gained its test. No migration. **Found on the way,
  on main:** three `publicApplicationSms` tests (C2d2) ran on the real clock with a send mock that returns nothing, so
  from 18:00 to 01:00 UTC — the all-US window open — the confirmation was sent, `transmit` threw and they answered 500;
  CI had only ever run them outside that window. The file now gives every test a default successful send.
- 2026-09-27 — **C3c2c1 merged** (#1086, main `bb669ac`); CI green on the merged head. **Q-AW34 ruled (a)** by the owner.
- 2026-09-27 — **C3c2c2 built** (`claude/applicant-flow-c3c2c2`): Part 1's facts read-only in Part 2 (§6.4 items 1 and 3),
  as Q-AW34 (a). **The read path:** `unlockDraft` releases a v2 link's Part 1 facts (`partOneFactsView`: the intake row,
  the licences, `drivers.cdl_class`, the carrier's day) on the same date-of-birth answer that opens the draft — the
  draft's DOB, or with no draft the one Part 1 recorded on `drivers`; a wrong answer releases nothing. The bundle reads a
  v2 link's draft locked once Part 1 is finished, so the page always meets the gate (D-APP16 unchanged: the bare link
  still serves booleans). **Found:** `record_applicant_identity` already writes the DOB into the draft, so every v2
  Part 2 visit met the gate anyway; the lock rule covers a pruned draft. **The page** lays the facts into the draft once,
  at the unlock, through filing's own `composeFiledApplication` (`applyPartOne`, draft-shaped nulls back to ""), so every
  screen, the task statuses, the review, the sign-off summary and the send read what filing will file — a copy, re-laid on
  each unlock and overlaid again by filing, as `identityOnRecord` has done for the identity since AF3. "About you" shows
  the DOB and phone and asks the name and email (Part 1 has no name writer); "Your licences" is Part 1's list, every
  licence with whether the application lists it (expired, or "no expiry date given"); the current address's street is
  Part 1's, shown in the panel, only its months asked (`partOneStreet` derives it by composing a probe address); the
  §40.25(j) box is gone on a v2 link. **"Something wrong? Tell us"** is `correction_note` on the draft contract only
  (never filed — the certified contract is strict), autosaved, shown on the office's drawer, never offered as a
  correctable answer. **The office's drawer** composes the same way (the review endpoint serves the facts) and no longer
  offers the draft's copies of Part 1's answers for correction — filing overwrote any correction made there
  (`PART_ONE_COMPOSED_KEYS`, derived from composition's own keys). **Composition now carries the CDL class** (Part 1
  writes it to `drivers.cdl_class`; nothing filed it once Part 2 stopped asking). **Recorded, not routed around:**
  **Q-AW35** — Part 1 lets another licence go without an expiry, and filing then refuses the application with nothing on
  any screen able to supply it (0 v2 invitations in production, so nobody stuck); **Q-AW36** — the office can read the
  note but correct only the DOB and CDL number/state. 43 mutants, all killed — one survived the first pass (an unlock
  answering "unlocked, no body" would have held the driver at the gate as a wrong date) and gained its test. No migration.
- 2026-09-27 — **C3c2c2 merged** (#1087, main `67677d5`); CI green on the merged head.
- 2026-09-27 — **Q-AW35 ruled (a)** by the owner, and **built** (`claude/applicant-flow-aw35`): every licence Part 1
  takes needs its expiry date. Screen 6 refuses "Add this licence" without one ("Enter the expiry date printed on the
  licence."), the label loses "(if you know it)", and the hint is the ruling's "The date printed on it — even if you
  gave it up."; a past date is accepted, since a licence given up on moving is still one the MVR is ordered for. The
  rule is also in `applicantIntakeLicenceSchema` — absent, null or blank refused, 400 before any write — because the
  page is not the only client the route will ever have, and a stored blank is exactly the application no screen can
  repair. Composition's refusal stays as the last line. Part 2's "no expiry date given" stays for a row written any
  other way. 10 mutants, all killed — two survived the first pass (an untrimmed check the contract caught in its own
  words, and an emptied hint a `toContain("")` accepted); both tests now pin the exact words. No migration.
- 2026-09-27 — **Q-AW35 merged** (#1088, main `ea79dc2`); CI green on the merged head.
- 2026-09-27 — **The owner ruled every open question** (rows in §11): Q-AW2 (b), Q-AW5 (a) — a person matches the
  selfie, no automated match — Q-AW28 (a), Q-AW29 (a), Q-AW30–33 (a), Q-AW36 (a), and the new **Q-AW37 (b)**, one
  reminder per part. Q-AW17 is accepted as recommended but is still open until the owner fixes the three
  contradictions and counsel rules on deductions, so **#1059 stays held**.
- 2026-09-27 — **C3c3a built** (`claude/applicant-flow-c3c3`): migration **0377** replaces
  `nudge_application_invitation` so a stamp EARLIER than `application_sent_at` (a Part 1 reminder) leaves the Part 2
  one open, and a stamp after it closes the invitation. The part is derived from the two timestamps, not stored.
  That holds because `application_sent_at` is written once (0365's `coalesce`). Measured first: 0 production
  invitations have `nudged_at < application_sent_at`, so nobody reopens. It ships alone, and today's sweep, which
  reads only unstamped rows, behaves exactly as before. M2 moves to the next free number. The session matrix gained
  4 cases (26 passed); 5 mutants, all killed — one fixture put the send in the future and failed the first run, a
  test fault fixed before the count. Next: **C3c3b**, the Part-1 sweep, after 0377 is verified applied.
- 2026-09-27 — **C3c3a merged** (#1089, main `156714a`); CI green on the merged head; **0377 verified applied** in
  production (`nudge_application_invitation`'s body reads `application_sent_at`).
- 2026-09-28 — **C3c3b built** (`claude/applicant-flow-c3c3b`): the Part-1 reminder, on 0377. `planApplicationNudges`
  now answers WHICH part a driver stopped in:
  - **Part 1** is consented, with the permissions not finished, and no reminder stamp yet.
  - **Part 2** is the form sent, and no stamp later than the send.
  - Never consented (nothing begun) and permissions finished with the form unsent (the office's screening) are
    still never reminded. Legacy links count as well, since both link kinds' first visit ends with the permissions.

  Part 1's idle clock is the latest of the consent, the draft, and — read by the sweep, paged and org-scoped, for
  every candidate so a narrower read can never hand the fold a false "nothing written" — the intake row, the
  photographs and the signed permissions. Each part has its own office alert (`application_stalled_part_one:<id>`,
  "stopped before finishing getting started"). Part 2 keeps its key, so no alert is raised twice. Part 1's email
  promises only "we will not remind you about this step again", and the text is the existing reminder, so no new
  Telnyx sample is needed. The sweep no longer filters `nudged_at` out: the fold decides.

  **Found and fixed:** Part 2's clock read only the draft, and AF3 writes the draft on the first visit, so a form
  sent days after Part 1 was reminded AT ONCE, rotating away the link the office had just sent. The clock now
  starts at the later of the draft and the Send.

  Measured first: one live invitation lacks its permissions, and it never consented, so the first run reminds
  nobody. No migration and no new scheduler: the sweep still runs inside the DQ alert scheduler on the api
  service. 25 mutants, all killed. Two survived the first pass — the 48-hour edge, and a min-for-max over
  Part 1's writes — and each gained its test.
- 2026-09-28 — **C3c3b merged** (#1090, main `180003e`); CI green on the merged head.
- 2026-09-28 — **Q-AW36 built** (`claude/applicant-flow-aw36`): the office's "Correct Part 1".
  - **Route:** `POST /api/recruitment/applications/:id/part-one` (`canManage`), taking `partOneCorrectionSchema`:
    the whole set (phone, address, CDL class, every licence with its expiry, current CDL first), prefilled
    from Part 1.
  - **Writer:** `record_applicant_intake` with `p_overwrite = true`, audited as `application_part_one_corrected`
    with field names and never values.
  - **Refused:** once approved (the draft's own window), on a legacy link (no Part 1), and where the function
    refuses (revoked, filed, not begun, a duplicate licence).
  - **In the drawer:** `PartOneCorrection.vue`, under the applicant's note, on a v2 application until approval.
  - **Deliberately not correctable:** §40.25(j) and §382.301(b) (the applicant's own statements; see the §11
    row), the FCRA acknowledgement, "no medical card yet", and the declared endorsements. The date of birth
    stays beside the permissions.

  **Found and fixed:** on a v2 link the existing identity correction (`record_applicant_identity` alone) left
  Part 1's list holding the OLD licence at position 0. Filing still filed the right one (`identityOnRecord`
  overlays `drivers` last), but the list is what the MVR checklist picks the state from and what the drawer
  and the applicant's page show. It now goes through `record_applicant_intake` with the current licence
  replaced, so the list, `drivers` and the draft move together. That is proven against real Postgres by a new
  `application-intake-v2` case (60 passed).

  **Checks:** 29 mutants, all killed. **Not looked at in a browser:** the drawer opens only from the recruiter
  page, which has no preview harness; the component's layout uses the same primitives and grid as
  `ApplicantIdentityCorrection`. No migration.
- 2026-09-28 — **Q-AW36 merged** (#1091, main `c8462d1`); CI green on the merged head.
- 2026-09-28 — **Q-AW29a built** (`claude/applicant-flow-aw29`): migration **0378**, the text's own token, merged
  alone before its reader.
  - **The column:** `application_invitations.sms_token_hash`, nullable, with a partial unique index (0345's
    reasoning).
  - **The writer:** `rotate_invitation_sms_token(org, invitation, hash)` sets it in one guarded statement and
    touches nothing else. `token_hash` (the email's and the office's link), `sign_token_hash` and `expires_at`
    all stand. It refuses a revoked, lapsed or other-org invitation and anything but a SHA-256 hex digest. It
    allows a submitted one, because the sign link is texted after submission. service_role only.
  - **Tests:** the session test gained 10 cases (36 passed). 10 mutants, all killed.
  - **Next, Q-AW29b:** the resolver accepts the new hash as a third door. The outbox gains the link-bearing
    templates, whose link is minted at send time through this function. The office's Send and the reminder
    queue their texts instead of dropping them in quiet hours.
- 2026-09-28 — **Q-AW29a merged** (#1092, main `4c9c65d`); CI green; **0378 verified applied** (column and function
  both present in production about 6 minutes after the merge).
- 2026-09-28 — **Q-AW29b built** (`claude/applicant-flow-aw29b`), 0378's reader.
  - **Resolver:** `resolveInvitation` accepts `sms_token_hash` as a third door, with the same constant-time
    compare and the same "a missing or null hash matches nothing" rule. Revocation still closes every door.
  - **Outbox:** gains `application_sent` and `nudge` (`LINK_TEMPLATES`). They hold no link. `transmit` mints one
    at the moment of sending (at once, or from the drain in the morning) through `rotate_invitation_sms_token`,
    rotate first then send. A rotation the function refuses (revoked, lapsed) cancels the row and sends
    nothing. The drain also cancels one whose application was handed over, approved or filed while it waited.
  - **Senders:** the office's Send and the reminder now go through `sendOrQueueSms`, so after hours their text
    waits instead of being dropped. The Send panel says "it will be texted to them in the morning".
  - **Unchanged:** no wording changed, so no new Telnyx sample. The desktop's "Text me the link" stays
    send-now, by choice now rather than by limit (its header says why).
  - **Tests:** 21 mutants, all killed.
- 2026-09-28 — **Q-AW29b merged** (#1093, main `ac4aa5e`); CI green on the merged head.
- 2026-09-28 — **C3d split** (owner, 2026-09-28): **C3d1a** Part 1's held screens kept on the device; **C3d1b**
  Part 2's draft on 0376's revision (`save_application_draft`'s 6-argument overload, DA041 → reload the
  server's copy) with a device copy of a failed save; **C3d2** uploads retried from the kept photo (Q-AW38 (a),
  replacing TUS); **C3d3** screen events (0376's `application_screen_events`, its writer and 180-day retention),
  the 44 px sweep and the offline test, against built `dist` with a stubbed API in `typecheck-build` — the first
  browser tests CI runs; **C3d4** Lighthouse CI on the same harness, measured first. **No migration in any of
  them**: 0376 already holds the revision column, the 6-argument function and the events table, and all three
  were verified present in production on 2026-09-28. **Q-AW38 (a)** and **Q-AW39 (a)** ruled (rows in §11).
- 2026-09-28 — **C3d1a built** (`claude/applicant-flow-c3d1a`): a reload before screen 7 no longer loses
  screens 3–6.
  - **The copy:** `partOne/partOneLocal.ts` keeps screens 3–6's answers, the screens passed and what the
    barcode filled, in IndexedDB, written 300 ms after each change. It is never screen 7's answers, the
    medical card or a photo. It is deleted when screen 7's write lands (and on arrival at a link already
    begun), and it dies at the earlier of 72 hours and the link's expiry. Every read sweeps every expired
    copy on the device. With storage blocked, Part 1 works as before and cannot survive a reload.
  - **The key:** the bundle serves `localKey`, sha256 of a namespaced invitation id. **Found on the way:**
    keying by token would have missed the one return path this exists for, because the Part-1 reminder
    rotates the email's token and a text carries its own (Q-AW29). The key is the same on every door and
    is neither the token nor an id (the bundle's rule is that no internal id crosses).
  - **The walk:** a restore applies only to an untouched walk (typing or a barcode read that came first
    wins). It reopens on the first held screen not passed, but a walk still owed a photo stays on the
    photo. Restored screens count as `held`, so screen 7 writes them through `firstWrite` as typed ones.
  - **Dropped:** an operation queue, written first to order a write before screen 7's delete. Its mutant
    survived, because IndexedDB already orders them (the connection queue, and readwrite transactions
    started in creation order), so the queue was a no-op and the comment justifying it was wrong.
  - **Checks:** 32 mutants, all killed. One survived the first pass (a copy's expiry taken from the 72
    hours alone) and gained its test. Looked at in Chromium at 390 px: typed "About you" and a street,
    reloaded, reopened on "Where you live now" with both screens' answers back, and nothing sent.
    No migration.
- 2026-09-28 — **C3d1a merged** (#1094, main `9bcc5b3`); CI green on the merged head.
- 2026-09-28 — **C3d1b built** (`claude/applicant-flow-c3d1b`): Part 2's draft is saved against its revision,
  and what a visit could not send is kept on the phone.
  - **The revision (0376's reader):** every autosave names the revision it was typed on. The api calls
    `save_application_draft`'s 6-argument overload, and DA041 answers 409 `draft_revision_conflict`. The
    bundle and the unlock serve `revision` (also on a locked view: a count of saves reveals nothing). The
    page takes it with the body it restores, never from a later refetch.
  - **On a conflict** (another tab or device saved, or the office corrected an answer — both bump the
    revision through 0376's trigger): the tab stops saving for good, deletes its copy (it is the older
    one), and shows a callout with "Reload the page" (`DraftNotice.vue`). Anything typed in that tab since
    its last save is lost, and the callout says so. Before C3d1b the tab would have written over the newer
    save without a word.
  - **The copy on the phone** (`draftLocal.ts`): the payload autosave sends, written on every change and
    deleted once a save lands with nothing typed since it was SENT. On the next visit it is put back only
    when the server still holds the revision it was typed on ("We put back answers…", sent at once), and
    dropped with a notice when the server moved on. Never before the date-of-birth unlock (D-APP16).
    Q-AW39's lifetime applies (72 hours or the link, whichever is earlier).
  - **Deploy window:** a page loaded before this deploy sends no revision; the api keeps the 5-argument
    save for it, as 0376 anticipated. **M2 drops that signature and makes `revision` required in the same
    merge** (§8.3 now says so).
  - **One store:** C3d1a's copy moved into `deviceCopies.ts` (one database, a store per copy). Opening it
    deletes C3d1a's one-day-old database, whose rows would otherwise never be read or swept again.
  - **Found by the tests, before merge:** (1) `toDraftPayload` hands back the form's reactive arrays, and
    IndexedDB cannot clone a Proxy — the put threw, the store resolved as designed, and no copy would ever
    have been kept in production; the copy now goes through JSON. (2) A save landing deleted the copy even
    when the driver had typed while it was in flight; changes are now counted from the moment of sending.
  - **Found by looking** (Chromium, 390 px): the progress card showed a green dot and "You can close this
    page and open your link again later" beside "Not saved" — for a conflict, and already for a failed save
    since A2. It now takes `saveTrouble`: a red dot and no promise while the last save failed or was refused.
  - **Checks:** 43 mutants. 40 killed on the first pass. Of the three survivors, two were real gaps and now
    have tests: a page served no revision would have sent `revision: null`, which the contract refuses, so
    every save from a page loaded before this deploy would 400; and the route dropping the new revision
    from its answer would make the page's second save conflict with its first. The third was a no-op (a
    conflict guard in `schedule` that `flush` and `keepCopy` already make), and the guard was removed.
    Looked at in Chromium at 390 px, the API stubbed: a 409 shows the callout and "Reload the page" and
    stops saving after one PUT; a copy on revision 5 against a server at revision 5 is put back, announced
    and sent. No migration.
  - **Found in the full run:** `ApplyPage.test.ts` mounted the page 54 times and unmounted it 11, so 43
    pages kept real autosave timers running into later tests' `fetch` mock. "Sends nothing" failed under
    full-suite load and passed alone. The file now unmounts every page after its test (`enableAutoUnmount`).
- 2026-09-28 — **C3d1b merged** (#1095, main `7f63d80`); CI green on the merged head.
- 2026-09-28 — **C3d2 built** (`claude/applicant-flow-c3d2`): a photograph the driver chose is never taken
  twice (Q-AW38 (a), replacing TUS).
  - **Kept:** "Use this" writes the encoded photograph (the bytes the upload sends, with the gate's hash) to
    the phone BEFORE the first byte goes (`capture/photoLocal.ts`, store `photos`). `confirm`'s answer
    deletes it, and so does `capture_not_intact` (sending the same bytes again changes nothing). A photograph
    still in review is never kept (§6.6.1's line). Q-AW39's lifetime is applied to photographs too.
  - **Sent again:** on the next visit a kept photograph goes back in its slot, is shown, and is sent with the
    same bytes and hash. If that fails too it stays held, "Use this" works, and the phone coming back online
    (`online`) resends it by itself.
  - **Not over a newer one:** a kept photograph is dropped, unsent, when the server's photograph for that
    slot is at or after it (`serverIsNewer`): it is the same photograph confirmed with the answer lost, or
    one taken since on another device (the desktop handoff, §6.6.6). ⚠ Two clocks are compared (server
    `capturedAt`, phone `keptAt`); a phone running slow can drop a kept photograph that should have gone.
    The bundle serves no hash that could decide it better.
  - **Not kept:** the camera's original. So a CDL back sent on a later visit is read for its barcode from the
    downscaled copy, which may not read. The driver then types the fields, as when any barcode is unread.
  - **Wiring:** `ApplyPage` provides the link's copy spec once (`provideLocalCopy`, as `issues.ts` provides
    the issue list). All three capture screens (Part 1's photo screen, the documents screen, the legacy
    identity step) pick it up without new props. `ApplyPage.vue` stays at 445 lines (the spec's derivation
    moved into `deviceCopies.ts`).
  - **Checks:** 25 mutants, 19 killed on the first pass. Of the six survivors, four were real gaps that now
    have tests:
    - **The database version.** A phone that ran C3d1b holds `silvicom-apply` at version 1, with no `photos`
      store. Without the bump to 2, every photograph put would throw, the store would resolve as designed,
      and nothing would ever be kept. No test had started from an old database.
    - One key for every slot, so the medical card would replace the licence.
    - Coming back online would send a photograph still in review.
    - A failed resend re-kept the copy, pushing its expiry forward on every visit.

    The fifth was a redundant early guard: it was removed, and the check after the read, which covers it,
    has its own test (a photograph taken while the phone was being read wins). The sixth is a no-op
    (`Date.parse(null)` is NaN, so the null check changes nothing); it stays for the reader.
  - **Looked at in Chromium at 390 px:** a real WebP from the browser's encoder, and real IndexedDB. With
    the upload cut, the screen said "That did not send". After a reload the same photograph was back on
    screen, sent once (start, upload, confirm with its original hash) and "Received", and the phone held
    no copy afterwards. No migration.
- 2026-09-28 — **C3d2 merged** (#1096, main `4608141`); CI green on the merged head.
- 2026-09-28 — **Owner rulings** (rows in §11):
  - **C3d3 split in three**, as proposed: **C3d3a** screen events (writer, retention, the page's
    reports); **C3d3b1** the first browser tests in CI — a Playwright config serving built `dist` with
    `/api/public/application/**` stubbed, Chromium in `typecheck-build` (its cost measured), the
    offline test, and `smoke.spec.ts`'s duplicate `getByLabel('Password')` fixed; **C3d3b2** the
    44 px sweep and whatever it finds.
  - **§6.8's completion bars are time ON the screens**, read by a SQL query run by hand (now under
    §6.8); no office panel.
  - **Q-AW40**: applicants can be deleted outright by an admin — never a driver who was hired.
  - **Q-AW41**: the link's lifetime and the reminder become settings, with a per-invite override.
  - **Q-AW42**: Representatives and examiners get a register under Settings.
  - **Q-AW43**: the fines (Q-AW17) are deferred until the hiring process works end to end; counsel's
    question is written as the memo's Q18. **#1059 stays held.**
  - **The two test applicants are not extended** (`d61557dc` lapses today, `f2b142e4` on 2026-10-01).
    They are deleted by Q-AW40 once it ships, and new test applicants are invited in a separate QA
    org. So **Q-AW1 and Q-AW2 are moot**, and **M2 no longer waits for `d61557dc` to be filed**
    (§8.3's heading) — it still waits for C3s.
  - **The queue from here:** C3d3a → C3d3b1 → C3d3b2 → R1 (Settings → Recruiting: Q-AW42's register,
    no migration) → S1/S2 (Q-AW41: migration, then reader) → P1/P2 (Q-AW40: migration, then purge)
    → C3d4 (Lighthouse) → AW6 (selfie) → C3s → M2 → C4 → QA walk.
- 2026-09-28 — **C3d3a built** (`claude/applicant-flow-c3d3`): the writer of 0376's `application_screen_events`.
  - **Names, derived.** `@silvicom/shared`'s `applicationScreens.ts` builds every name the page may report
    from the lists the screens already are — Part 1's `PART_ONE_SCREENS` (moved there from the web),
    Part 2's sections, the permissions — plus one per branch of the phase chain. The api refuses any other
    name, so a leaked link can write screen visits and never a value (D-APP16). **Found by a test:**
    Part 1's `otherLicences` would have failed 0376's lowercase CHECK and taken its whole report with it;
    reported names are snake-cased (`part1.other_licences`).
  - **Which screen** is the deepest one mounted: each branch of `ApplyPhaseRouter` carries an
    `ApplyScreenMark`, and Part 1, each permission, the handbook, the task list and each section name
    themselves inside it. No list restates the chain.
  - **Time on the screen** (the owner's ruling): a visit closes when the screen changes and when the phone
    is put away, and a new one opens when it comes back. A visit is reported open while showing, so a
    phone that dies on a screen still leaves it behind; the server keeps one row per visit (`id` minted by
    the page, insert-or-nothing, closed once).
  - **The rate budget:** reports go once a minute while something changed, when hidden and on `pagehide`
    (`fetch` with `keepalive`), at most 50 visits each, on their own per-link bucket
    (`screenEventsLimiter`, 6 a minute) that the intake's 20 skips — autosave keeps its 12.
  - **The phone's clock:** each report carries `sent_at`, and the api moves every time by the difference
    to its own clock; a visit still in the future after that is dropped.
  - **Retention:** 180 days (`RETENTION_RULES` and `table-modules.json`), as 0376 promised. The table left
    `check-table-producers.mjs`'s schema-only list — the last of M1's five. §6.8's query is written under
    §6.8 and runs on production (no rows yet).
  - **Found by the mutation pass:** during signature adoption the ceremony already points at the first
    permission, so the adoption would have been reported as `ceremony.fcra_disclosure`; it is `ceremony`.
  - **Checks:** 35 mutants. 25 killed on the first pass; of the ten survivors, seven were real gaps and now
    have tests (a visit reported closed then open in one report; one closed while its open copy was in
    flight — whose first test passed on `undefined` via `not.toBeNull()`; Part 1, a permission, the
    handbook, the task list and the permissions wait never checked on the real page), one was the adoption
    bug above, and two are no-ops: the batch cap's mutant changes a constant the test reads, and dropping
    closed visits from memory changes only memory (a clean visit is never resent). No migration.
- 2026-09-28 — **C3d3a merged** (#1098, main `752e8cc`); CI green on the merged head.
- 2026-09-28 — **C3d3b1 built** (`claude/applicant-flow-c3d3b1`): the first browser tests CI runs, and the defect
  they found on their first run.
  - **The harness:** `apps/web/playwright.apply.config.ts` serves the BUILT app (`vite preview`) to Chromium at
    390 px with touch; `e2e-apply/stubApi.ts` is a stateful fake of `/api/public/application/**` and the
    storage upload in raw JSON, refuses every other origin, and records what the page sent. Its own folder
    because `e2e/` is `smoke.yml`'s, run against production. Run in `typecheck-build` after the build, with
    Chromium cached (`e2e:apply`); listed in CLAUDE.md's CI section. The specs are typechecked.
  - **§6.8's network bar, end to end** (`e2e-apply/offline.spec.ts`): Part 1's screens 3–6 survive a cut at
    screen 7 and a reload, and the write that lands carries them (C3d1a); a Part 2 answer typed while saves
    fail is put back after a reload and saved on its revision (C3d1b); a photograph whose upload was cut is
    sent again after a reload with the same bytes and hash and no picker opened, and one held while offline
    goes by itself on `online` (C3d2).
  - **Found by the first run: both copies of typed answers could lose the last screen.** They were a plain
    300 ms trailing debounce, which a stream of changes each sooner than that never lets fire: the walk
    reached screen 7 with NOTHING on the phone, and the reload reopened Part 1 on its first screen, empty.
    A write on `pagehide` does not rescue it — measured, a write started as the page reloads does not
    commit. Fixed in `deviceCopies.ts`'s `debouncedCopy`: a screen passed (Part 1) or a section left
    (Part 2) is written at ONCE; typing within a screen keeps the pause; a pending write also runs on
    `visibilitychange` → hidden (the one event a phone reliably sends before dropping a background tab)
    and, best effort, on `pagehide`.
  - **Found on the way:** `page.route` answers above the network stack, so `setOffline(true)` does not cut
    a stubbed request (the first offline-photo test "went offline" and the photo was received). The specs
    cut with the stub and use `setOffline` only for the browser's `offline`/`online` events.
  - **The smoke test:** `getByLabel('Password')` also matched the "Show password" button and failed every
    production smoke run; `{ exact: true }` in `smoke.spec.ts` and `hazmat.spec.ts`.
  - **Checks:** 12 mutants, 11 killed on the first pass; the survivor (listeners left behind when a copy's
    scope ends) now has its test. Four of the mutants disable C3d1a's restore, C3d1b's replay, C3d2's replay
    and C3d2's `online` resend, and only the browser specs are run against them. 20 of 20 on `--repeat-each 5`.
    No migration.
- 2026-09-28 — **C3d3b1 merged** (#1099, main `dd6b356`); CI green on the merged head.
- 2026-09-28 — **C3d3b2 built** (`claude/applicant-flow-c3d3b2`): §6.8's tap-target bar, measured and met on every
  `/apply` screen at 390 and 320 px.
  - **What the first sweep found:** over a hundred controls under 44 px on nearly every screen, from ten causes.
    Five were the primitives' compact sizes (`AppButton` md/sm 36/32, `AppInput` 36, the combobox, `AppCheckbox`
    36, `AppSegmentedControl` 32). The others: the date field and its calendar (a 36×36 button, 35 px days,
    25×25 month arrows); the **Sign here** tag, sized off the PDF's 48 pt box (79×32 on a phone); the permission's
    "Read this document as text" disclosure (20 tall); the SMS card's two links (16 tall, on a line of their own,
    so WCAG 2.5.8's inline exemption does not cover them); and what the owner-approved split left unmeasured —
    the Part 2 drawers, the packet walk, the handbook.
  - **The fix is stated once, not a hundred times.** 20 call sites had asked for `size="touch"` and the rest had
    not, because "this route is pressed by a thumb" was being restated per control. `@silvicom/ui`'s
    `touchTargets.ts` now carries it: `ApplyLayout.vue` (the layout of `/apply/:token` and no other route) calls
    `provideTouchTargets()`, and `AppButton`, `AppInput`, `AppSelect`, `AppCombobox` (input and options),
    `AppCheckbox`, `AppRadioGroup`, `AppSegmentedControl`, `AppIconButton` and the date field raise their own
    compact sizes to 44. An inline link (`variant="link"`) is never boxed. The office keeps its 36 px density;
    `packages/ui/src/touchTargets.test.ts` pins both halves for every primitive. The existing `size="touch"`
    props stay — they are what a control asks for outside such a layout. The calendar is teleported out of the
    layout, so it takes the floor as a menu class (`app-date-touch`): 44 px days and arrows, and its sides come
    in from 8 to 4 px so a whole month fits a 320 px phone (it measured 326).
  - **What the bigger controls broke, found by the sweep's overflow check:** Part 2's Back/Save row (side by
    side it needed 380 px of a 342 px column — it already overflowed at 320 before this) now stacks on a phone,
    the forward act on top; the adoption's confirm row wraps (at 320 px "Change" was off the card).
  - **Found by looking, not by the sweep:** the 44 px Sign-here tag, bottom-aligned to an 18 px box, covered
    the intent sentence the driver signs to on a real permission PDF at 320 px. It now hangs from the box's top
    and grows down over the empty signature line; the spec asserts its top is the box's. And the packet's strip
    of sixteen place dots is 10 px each, but it is an indicator, not a control (its markup has no handler on a
    phone; the rail's buttons are `lg:` only), so it is not a target.
  - **The spec:** `e2e-apply/tapTargets.spec.ts`, on the C3d3b1 harness, at 390 and 320 px: expectations,
    consent, all nine Part 1 screens (with an open state list and an added licence), the adoption in its three
    ways, the confirm, both permissions with the disclosure open, the permissions wait, the unlock with its
    calendar open, the Part 2 task list, every task and every "Add…" it offers (the address and job drawers
    included), both office waits, the sign-off with the packet's adoption, confirm and first place, and the
    filed page with the handbook open. It measures every button, link, field, select, disclosure and
    interactive role (a radio or checkbox by its label), fails a target that is cut off by the screen's edge or
    a page that scrolls sideways, and exempts a link inside a sentence, decided from the page rather than
    listed. `stubApi.ts` gained the consent, Part 1's completion, the permissions and their PDFs (drawn by hand
    with the real `sign-here` destination, so the tag is its true size), the unlock, SMS consent, the packet,
    the handbook, a Part 2 v2 fixture, and a list of any request it had no answer for, which every check asserts
    is empty.
  - **Checks:** 22 mutants, all killed on the first pass — one per primitive's raised size, the provider
    removed, the calendar's four variables and its class, and each page-level fix. Three are killed only by
    the unit test (an inline link given a box, a 36 px select, a 36 px icon button): no `/apply` screen renders
    one today, so the walk cannot see them. 60 of 60 on `--repeat-each 5`. No migration.
- 2026-09-28 — **C3d3b2 merged** (#1101, main `4cbba9d`); CI green on the merged head.
- 2026-09-28 — **R1 built** (`claude/recruiting-register`): Settings → Recruiting, Q-AW42's register. No migration.
  - **The page:** `/settings/recruiting` lists the carrier's Representatives and its road-test examiners, each
    with its add form, a Representative's Remove (DELETE) and an examiner's Retire (the api's `/retire`,
    which nothing in the web called before — `useRetireRoadTestExaminer`). Both ask first. A Representative
    who has countersigned cannot be removed, and the api's sentence is what the toast shows. Each list is a
    `SettingsSection`, so Q-AW41's invitation settings (S2) arrive as a third without moving anything.
  - **Who:** a sidebar entry of its own, `admin.recruiting`, gated `section("recruitment")` — NOT a child of
    `admin.settings`, because a recruiter holds `settings: none` and `recruitment: manage` and is who the page
    is for. The writes are offered on `session.can("recruitment")`, what the api's routes ask. A Settings card
    shows on `canView("recruitment")` too. No `meta.parent`: the breadcrumb would have pointed the recruiter at
    a Settings page the guard bounces them from.
  - **One form, not three:** the panels' two add forms were the same form with different words, so they are
    now `SignatoryAddForm` (kind = representative | examiner), and the handbook panel's list is the register's
    `SignatoryRegister`. The panels keep their inline add. The handbook panel's Remove now asks first and
    shows only on `manage`, as the register's does; the road-test panel's heading reads "Add an examiner".
  - **Found by the mutation pass, a regression in the split itself:** the form is usually on screen BECAUSE the
    list is empty, and the add's own success refetches the list, which unmounted the form before its `await`
    returned — and Vue drops an emit from an unmounted component. So the handbook panel no longer selected the
    Representative just added, nor the road-test panel the examiner. Neither behaviour had a test before; the
    two tests written to close the survivors failed on the unmutated code. `onAdded` is a callback prop now.
  - **Checks:** 17 mutants, 17 killed after three survivors were closed (the two above and the Settings card's
    gate). Seen in a browser (built, dev bypass, as admin): both lists, the inline form on an empty list, a
    390 px phone, the Settings card and the sidebar entry, no page errors.
- 2026-09-28 — **R1 merged** (#1102, main `3f927c0`); CI green on the merged head.
- 2026-09-28 — **Owner ruling on R1: Recruiting lives under the Settings page, not in the sidebar's Admin group.**
  Built (`claude/recruiting-under-settings`): `admin.recruiting` is now a child of `admin.settings` (no nav
  entry, icon removed), the route takes `meta.parent: "/settings"`, and the Settings card is its way in. The
  gate is unchanged — `section("recruitment")`, what the api asks — so nothing is refused that was allowed.
  A recruiter and a safety manager hold `settings: none`, so they have no link to the register (the URL
  still works for them). **That is intended — the owner, same day: "admin will set this Representative and
  examiner and there is no need for recruiter to do anything with this."** No open question. A recruiter still
  adds one inline from the handbook and road-test panels when a hire needs it.
- 2026-09-28 — **Recruiting under Settings merged** (#1104, main `61e03a9`); CI green on the merged head.
- 2026-09-28 — **S1 built** (`claude/recruiting-settings-s1`): migration **0379** `recruiting_settings`, schema only — it
  merges alone and S2 is its reader (Q-AW41).
  - **Shape:** one row per org (`org_id` primary key, cascades with the org): `invite_ttl_days`, `reminders_enabled`,
    `reminder_after_hours`, `updated_by`, stamps. RLS on, no policies (service role only, as 0173).
  - **No row = the product's defaults,** and the three columns carry NO default: the defaults' one home is
    `INVITE_TTL_DAYS_DEFAULT`/`STALE_DRAFT_HOURS`, and only a saved org has a row, so a column default would never be
    the value in force. **S2 must** fall back to the constants on a missing row and write all three answers at once.
  - **Bounds:** link 1–60 days (the CHECK's 60 is `INVITE_TTL_DAYS_MAX`, read from source by the matrix); reminder
    24–1440 hours — ⚠ **24 is this migration's choice, not the owner's** (the ruling gave no range; the sweep is six-
    hourly, so a reminder lands up to 6 h late); a reminder that is ON must come before the link dies (the sweep skips
    an expired invitation), an OFF one keeps its number unchecked.
  - **Checks:** `supabase/tests/recruiting-settings.test.mjs` (23), the RLS matrix seeds it explicitly (its CHECKs
    refuse invented integers), `recruiting_settings` pinned in `check-table-producers.mjs` until S2's save writes it.
    12 of 12 migration mutants killed.
- 2026-09-28 — **S1 merged** (#1105, main `f9b043c`); CI green on the merged head. **0379 verified applied** in production
  ~6½ minutes after the merge: the table, RLS on with no policies, its six constraints, no rows.
- 2026-09-28 — **S2 built** (`claude/recruiting-settings-s2`): the reader of 0379 (Q-AW41). No migration.
  - **The screen:** Settings → Recruiting gains "Application links" above the two registers: the link's lifetime in
    days, "Remind a driver who stops" on/off, and the delay in hours. It validates with `recruitingSettingsSchema`,
    the contract the api's `PUT /api/recruitment/settings` uses (bounds, and a reminder that is on must come before
    the link dies), so both refuse in the same sentence; 0379 refuses a third time. `recruitment` view reads,
    manage writes; audited `recruitment.settings_updated` with from/to.
  - **The one reader:** `recruitingSettings.ts` — the org's row, else `RECRUITING_SETTINGS_DEFAULTS` (built from
    `INVITE_TTL_DAYS_DEFAULT`/`STALE_DRAFT_HOURS`); a failed read THROWS rather than fall back to a longer-lived
    default. The save is UPDATE-then-INSERT, a racing insert's 23505 answered by an update. Every place that
    extended a link by the constant now asks it: the invite, "send the link again", Send, open signing, the
    handbook's Open/Extend, and the reminder sweep; the Send email's "stops working in N days" is the same number.
  - **The reminder switch, as built:** OFF sends the driver nothing and neither rotates nor extends their link, but
    the office is still alerted once that they stopped — the path an invitation with no address already takes. The
    delay is also when the office alert fires. ⚠ If the owner meant OFF to silence the office too, it is one line.
  - **The per-invite override:** the invite drawer's "Link stays open for (days)", blank by default with the
    carrier's number as its placeholder; blank sends nothing and the api applies the carrier's setting, typed sends
    `expires_in_days`. It applies to a NEW invitation only — "Send them the link again" extends by the carrier's
    lifetime like every re-send. `applicationInviteCreateSchema.expires_in_days` lost its `.default(14)`, which would
    have silently overruled the carrier.
  - **The handbook's Extend toast** now states the date the server set, not "another 14 days".
  - `recruiting_settings` left `check-table-producers.mjs`'s waivers (0 remain); 0379's matrix now reads the hour
    bounds from the contract's source too.
  - **Checks:** 26 mutants, 25 killed; the survivor swaps `STALE_DRAFT_HOURS` for the literal 48 in the defaults — the
    same value, so a no-op no test can see. Seen in a browser (built, dev bypass, as admin): the defaults, the refusal
    under the delay when the link is shortened to 2 days, and the switched-off state at 390 px; no page errors.
- 2026-09-28 — **S2 merged** (#1108, main `6e8fc1f`); CI green on the merged head.
- 2026-09-28 — **P1 built** (`claude/purge-applicant-p1`): migration **0380** `purge_applicant(p_org, p_driver, p_actor)`, Q-AW40's
  migration half. It merges alone; P2 (the admin screen, Storage cleanup, the `driver.purged` audit) is its reader.
  - **Measured on production first:** 40 foreign keys into `drivers` (18 cascade, 5 restrict, 17 set null), the FK tree
    below them, and every trigger on it. **Six guards refuse a service-role delete:** `drivers` (DR010),
    `driver_applications` (DA010), `esign_consents` (EC010), `signature_adoptions` (SA010), `employer_verification_calls`
    (EV010), `handbook_marks` (HB011). The handoff's note that packet marks, drafts and captures "refuse a delete by
    trigger" is not so: `application_packet_marks` and `application_edits` have no trigger, and the rest refuse only a
    JWT-bearing writer. The two test applicants are drivers `16045e32` (invitation `d61557dc`) and `0c77fabb`
    (`f2b142e4`), both `applicant`, archived, and linked to nothing. Their rows: 2 invitations, 1 application,
    1 qualification record, 8 authorizations, 2 consents, 20 packet marks, 2 drafts, 1 capture, 1 employment row,
    1 document, and 16 audit rows.
  - **The flag:** new, `fuelguard.purging_applicant`. It holds the DRIVER'S ID, not 'on', so each guard is opened
    for that applicant's rows only. It is transaction-local and cleared before return. Why not reuse `merging_driver`:
    the guards' exemption would then read "a merge" when it was a purge. Each of the six guards is reproduced
    with one branch added, and the pre/post `pg_get_functiondef` diff shows nothing else changed. `merge_driver` is untouched.
  - **"Ever hired", PA010:** status past `applicant`, a `hire_date` or `termination_date`, or an audit row
    `compliance.applicant_hired` for the driver. The last is the durable one, because 0213 lets an admin edit
    status and dates back. **PA011:** a row in any drivers-referencing table the purge doesn't own, read from
    `pg_constraint` at call time rather than listed, so a new table refuses until somebody decides (the
    merge_driver cascade trap, inverted). Also PA011: a DQ export naming the driver. **PA012:** a driver-app account
    or a McLeod/Samsara/EFS id. **PA020:** another org, or missing. **PA030:** the actor isn't an admin of the org.
  - **Kept:** `sms_suppressions` (a STOP belongs to the number; the driver id is nulled), `audit_logs`, and
    `notification_events`. ⚠ The name and email survive in audit `meta`; that is **Q-AW44**.
  - **Storage:** the function RETURNS `{counts, storage}`, with storage keyed by table (`documents`,
    `application_captures`, `signature_adoptions`, `drivers` photo). If P2 read the paths first, it would race a
    capture confirmed in between.
  - **Checks:** `supabase/tests/purge-applicant.test.mjs` (65). The fixture fills every table that references
    `application_invitations`, read from the catalogue so a new one fails the matrix until it is seeded. 45
    migration mutants, 40 killed on the first pass. Of the survivors, one was a real gap and now has its test
    (the flag left set inside an explicit transaction: the old check read it after the implicit one had ended).
    Two showed my own two-step deletes were unneeded — RESTRICT is checked at the end of the statement — so both
    were removed along with their wrong comments. Two are no-ops: the audit read's `created_at` lower bound only
    bounds the index scan, and `for update` guards a race that a single PGlite connection cannot stage.
- 2026-09-28 — **P1 merged** (#1110, main `796d530`); CI green on the merged head. **0380 verified applied** in production
  ~8 minutes after the merge: highest migration 0380, `purge_applicant` executable by service_role only (not
  authenticated, not anon), all six guards carry the purge branch.
- 2026-09-28 — **P2 built** (`claude/purge-applicant-p2`): the reader of 0380 (Q-AW40). No migration.
  - **The route:** `POST /api/recruitment/applicants/:driverId/purge`, in the recruiting module (`routes/purge.ts`,
    `applicantPurge.ts`). Gates, in order: `canPurgeApplicant` (new in `@silvicom/shared`, `isAdmin` — the ruling,
    derived rather than hand-listed), `requireFreshAuth` (the password again, as the member password reset does), then
    the body's `confirm_name`. The service reads the driver org-scoped, refuses one that is **not archived**
    (`not_archived`), checks the typed name (`purgeNameMatches`: case and runs of spaces forgiven, nothing else), then
    calls 0380 and maps its refusals: PA010 → 409 `was_hired`, PA011 → 409 `has_records`, PA012 → 409 `linked`,
    PA020 → 404, PA030 → 403, anything else → 500 "nothing was deleted".
  - **Storage, after the commit:** each path 0380 returned is removed from its table's bucket — `documents` and
    `signature_adoptions` from the evidence bucket, captures from theirs. A file that cannot be removed is named in
    the answer and in the audit row. `drivers.photo_path` has no writer and no bucket anywhere in the product, so a
    path found there is reported as not removed rather than guessed at (none exists in production).
  - **The audit:** one `driver.purged` row — entity `drivers`, the id, `counts`, `storageRemoved`,
    `storageNotRemoved`; never the name (a test asserts the row does not contain it). If that write fails after the
    delete has committed, the answer says `audited: false` and the drawer says so; the database's own
    `driver.delete` trigger row remains either way.
  - **The screen:** the Recruitment board's **Archived** view gains "Delete permanently…" in the row menu, for an
    admin only (`kebab-item-danger`). It opens `PurgeApplicantDrawer`: what is removed, that a hired person cannot be,
    and a "Type their name to confirm" field; Delete stays disabled until the name matches. The password prompt
    replaces the body and the same delete re-runs once it is given. A delete that left a file behind or wrote no
    audit row is reported as "Deleted, with something left over", never as a clean success. Offering it only on the
    Archived view is the api's `not_archived` rule, not a second one. `ArchiveDriverModal`'s comment, which said
    there was no destructive version of archiving, now says where the one for applicants is.
  - **Checks:** 24 mutants over the route, service, contract, drawer and page; 23 killed on the first pass. The
    survivor was a redundant `!matches` guard inside the drawer's delete (the button is already disabled, and the
    api checks again); removed rather than kept as a no-op.
  - **Found by looking, not by a test: no danger menu item in the app was red.** `.kebab-item-danger` lives in
    `@layer components`, and a menu item is an `AppButton` whose variant sets `text-ink-secondary` as a utility, which
    outranks it — the loss `LiveMapControls.vue` already records for a brand tint. Measured in Chromium on this board:
    "Delete permanently…" computed `oklch(0.478 0.016 286)`, the same ink as "Restore"; with `!text-danger-600` in
    `packages/tokens/src/epilogue.css` it computes `oklch(0.589 0.240 27)`. One line, and it fixes the eight other
    danger items too (Users, Anomalies, Annual inspections, Vehicles, Trailers, the inspector register, plan history).
  - **Seen in a browser** (built, dev bypass, as admin, API stubbed): the Archived view's menu at 1280 and 390 px,
    the drawer with Delete disabled until the name was typed (it stayed disabled for the wrong applicant's name), the
    typed name sent as typed, and a `was_hired` refusal shown in 0380's sentence with the drawer left open. No page
    errors. The hint under the field now carries the name alone; a placeholder repeating it was removed.
  - **Next:** once merged, the owner deletes the two test applicants (drivers `16045e32` and `0c77fabb`, invitations
    `d61557dc` and `f2b142e4`) from the Archived view; new test applicants go in a QA org.
