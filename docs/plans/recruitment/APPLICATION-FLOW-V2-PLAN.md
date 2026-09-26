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
| 5 | Your CDL | state (picker), number, class (A/B/C, `drivers.cdl_class`, 0098), expiry (3 boxes), endorsements (H/N/X/T/P/S) | prefilled from the barcode on screen 9 when read; the driver confirms |
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
| Network cut mid-screen | zero lost answers; an upload cut at 50% resumes | Playwright offline test |
| Errors | inline, name the field and the fix; validate on leaving a field, clear on the fixing keystroke; summary kept | component tests |
| Real walk | an older Android + an iPhone, one real driver, end to end | §11 log |

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

### 8.3 M2 — migration 0377 (after `d61557dc` is filed, after M1's readers exist)

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
| AW10 | Local draft replay (IndexedDB) with revision; resumable uploads (Supabase TUS on `application-captures`) | C3 |
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
| CPU per photo for the server confirm (`sharp` decode + metrics) | not measured | AW4, first task |
| Stripe Identity phone handoff | secondary sources only | phase 2 only |

---

## 11. Open questions (candidates + a recommendation each)

| ID | Question | Candidates | Recommendation |
|---|---|---|---|
| **Q-AW1** | `d61557dc` has no packet signature, so the handbook can't be signed. | — | **Answered** by the owner's model (D-AW15). Until C3s: C0a extends the link, C0b lets the handbook screen take a signature (labelled workaround). |
| **Q-AW2** | `f2b142e4` signed 20 marks on 09-17; fines and spelling change under them. | (a) re-open the changed pages; (b) file under the old text (versioned templates, M2); (c) re-issue | (b). |
| **Q-AW3** | Required documents in Part 1? | — | CDL both sides; medical card or "I don't have one yet". |
| **Q-AW4** | SSN card photo? | Part 1 / Part 2 optional / after hire | After hire; SSN typed at signing. |
| **Q-AW5** | Selfie: photo + human, or automated match? | (a) / (b) Stripe / (c) none | (a) now; (b) after counsel. **Blocks only AW6**, nothing else in C3. |
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
| **Q-AW17** | Fines: three contradictions; deductions under 820 ILCS 115/9(4) | — | Owner fixes the contradictions; counsel on deductions. |
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
