# Application flow v2 — intake before screening, a scanner wizard, a phone-first form — plan and queue

**Status: PROPOSED 2026-09-26, VERIFIED the same day. Nothing in §8 is built.**

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
Keeps D-AF1 (identity with the permissions), D-AF2 (each permission its own PDF), D-AF3 (the packet
opens only in the office). `HIRING-MODULE-PLAN.md` §0's protocol applies, **except the one-step-one-PR
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
| **A-1** | **`d61557dc` can never be hired.** The handbook reuses the packet's adopted signature (`handbookCeremony.ts:91–92` → `handbook_no_adopted_signature`); `handbook_marks` has no other driver writer; a filed packet cannot be re-signed (DR033, 0339:157/0340:100); the handbook is a hire blocker. `canOpen` checks only `submittedAt` (`handbookContract.ts:139`; `openHandbookSigning`, `handbookSigning.ts:103–107`). | Q-AW1 (ruling), then `canOpen` also requires an adopted signature and the drawer says why. | **C0 — by 2026-09-28 18:00 UTC** |
| **A-2** | **Opening the handbook does not extend the link** — `openHandbookSigning` is plain TypeScript updating two stamps (`handbookSigning.ts:109–114`); there is **no SQL function** for it. 0374's trigger (`:146`) refuses every mark when `expires_at <= now()` (HB021), the office's countersign included (`carrierMark`, `:165`), which surfaces as `insert_failed` → 500 "Could not record the carrier's signature" (`routes/handbook.ts:41`). All three existing extenders — send (0365:235), `open_packet_signing` (0369:197), nudge (0232:58) — skip a filed invitation. | Code only: `openHandbookSigning` also sets `expires_at = greatest(expires_at, now() + 14 days)`; map HB021 to a 409 with words. | **C0** |
| **A-3** | **MVR state field accepts 60 chars, the application 80** (`packages/shared/src/hiringEvidence.ts:169` vs `applicationContract.ts:212`) → a long authority can never be covered → never hired. | One shared constant. (Part 1's state picker removes the free-text case going forward, D-AW3.) | **C0** |
| **A-4** | **Both mid-flight applicants stuck at 4 of 6 permissions**: `permissions_signed` shows "waiting on them" (`hiringChecklist.ts:229–238`) though their ceremony is closed; MVR recording refuses without `mvr` (`authorizationContract.ts:428`). Only a paper grant unsticks them; a comment names it (`:233–234`), the UI does not. | Checklist row names the paper door when the ceremony is closed and purposes are missing; A-7 first. | **C0** |

### 3.2 Bugs

| ID | Finding | Fix | Batch |
|---|---|---|---|
| **A-5** | **#1059 changes fines above signatures already given.** `PACKET_VERSION = "packet-2026-09-25"` (`defaultWording.ts:71`) is identical on main and on the branch; `application_packet_marks` has no version column (production columns read); the packet renders only at filing (`renderFiledDocument`, `file.ts:165`). `f2b142e4`'s 20 marks would file under new fines. | `packet_version` on each mark (M1); filing compares; Q-AW2 decides what happens to older marks. **#1059 stays open until C2.** | M1 + C2 |
| **A-6** | **Handbook version not compared.** `handbook_marks.handbook_version` exists (0374:99, NOT NULL) but is stamped with the server's current `HANDBOOK_VERSION` at insert; countersign files the current text without comparing (`handbookSigning.ts:165–245`). `HANDBOOK_VERSION` is a content hash, so #1059 changes it. 0 marks in production. | Code only: the client sends the version it rendered; a mismatch is refused; countersign refuses when the marks' version ≠ current. | **C0** |
| **A-7** | **A paper permission has no `invitation_id`** (`routes/authorizations.ts:141–157`) → the link still asks for it on screen, it is missing from the filed permissions, the checklist (by driver, `applicantChecklist.ts:261`) counts it. It stores the office's `req.ip` as the signer's attribution (`:152`). | Resolve the driver's live invitation and write it. The existing unique index `uq_driver_authorizations_invitation_purpose` (0228) then refuses duplicates — ⚠ it covers `revokes is null`, so a re-grant after a revocation hits 23505: refuse with words. `accepted_ip`/`_user_agent` null for paper. | **C0** |
| **A-8** | **A failed road test recorded on the DQF page counts as passed** — `hasKind("road_test")` (`hiringChecklist.ts:283`); that writer's `result` is `z.string().max(400)` (`complianceContract.ts:211`). RT3's ceremony writes a record **only** on a pass (`roadTest.ts:250–265`). | Count a `road_test` record when `detail.source = 'road_test'` (ceremony) OR `detail.passed = true`; the DQF writer gains a pass/fail field. Existing ceremony rows keep counting. | **C0** |
| **A-9** | **Hire-gate bypass.** `POST /compliance/qualification-records` (`evidence/routes/compliance.ts:166`) accepts `handbook`/`road_test` (only `psp_report` refused, `complianceContract.ts:230`). `PATCH /roster/drivers/:id` (`drivers.ts:193`) sets `status` with no hire check. **There is no database guard on applicant→active**: `guard_driver_lifecycle` (0213) checks only JWT roles and the service role bypasses it; `hire_applicant` (0218) checks inside its own RPC. | Refuse ceremony-owned kinds on the generic door; refuse `applicant → active` on the PATCH (route guard). A DB trigger is Q-AW21. | **C0** (route) |
| **A-10** | **Double filing.** Countersign has no claim: two presses both file PDF + record before `handbook_filed_at` (`handbookSigning.ts:258`). Road test files form → certificate → record with no cleanup (`roadTest.ts:245–281`). Append-only → permanent. | M1: `application_invitations.handbook_filing_claimed_at` + partial unique indexes on `qualification_records` (§8.2). C2: claim first, then file. | M1 + C2 |
| **A-11** | **SMS.** Held texts are dropped (the nudge stamps and rotates before sending, `applicationNudgeSweep.ts:215–235`; `applicationSend.ts:57–58` says "nothing retries it"); the window is 19–24 UTC (§2.3.6); the public terms say "held until the next day" (`SmsTermsPage.vue:66`) — false; the webhook handles only `message.received` (`lib/sms.ts:139`), so accepted-then-failed reads "sent". | M1: `sms_outbox` + `sms_suppressions`. C2: zone derived from Part 1's state/ZIP (D-AW12); drain in the scheduler; delivery receipts; terms corrected; stale comment fixed. | M1 + C2 |
| **A-12** | Road-test certificate prints the examiner's **typed name, silently**, when the signature file is missing (`roadTest.ts:171–173`). Blank licence number and UTC date: reported by the audit, **not re-verified** (§10). | Refuse without a signature file; refuse a pass without a licence number; carrier-zone date — after confirming the last two. | **C0** |
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
  (`pdfFonts.ts:74`) never NFC-normalises. → C0.
- **G-6** `handbook_marks`, `application_packet_marks` not in `RETENTION_FORBIDDEN`
  (`dataRetentionPolicy.ts:250`). → C0.
- **G-7** The checklist input is built twice (board + checklist); the board's draft read hits
  PostgREST's 1,000-row cap at scale. → C2.
- **G-8** Templates page shows the paper button to view-only users; the blank packet prints "Signed
  electronically" on withdrawn pages; template copy names pages 4 and 19 only
  (`recruitmentTemplatesContract.ts:63`). → C0.
- **G-9** Paper grant: no signing-date field; the "scan" can be any document of the driver; no
  re-hash; `verbal_documented` needs no evidence but opens `mvr_order`; draft wording allowed. → C0 +
  Q-AW15.
- **G-10** Road test: no record the driver was handed the certificate; §391.33 equivalency counted but
  not recordable by a recruiter. → Q-AW19.
- **G-11** Three "ready to hire" definitions: `hired.requires` (`hiringSteps.ts:421–424`),
  `HIRE_REFUSES_WITHOUT` (`:473`), `readyToHire` (`hiringChecklist.ts:414`, no caller); `blockedBy`
  reads `requires` (`:376–380`). → C2.
- **G-12** Stale comments: "fourteen" steps (`hiringChecklist.ts:13/19/24/204`, there are 17); "handbook
  has no evidence table" (`packages/shared/src/hiringEvidence.ts:58`); `packetStatic.ts:68` still has
  the $20 receipts row; the `subject_to_fmcsr` JSDoc (`applicationContract.ts:155–159`) describes
  §40.25(j). → C0.

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
| (b)(10)(i) Employer **address** | `address_line1/city/state` `.nullish()` (`:136–138`) | Required for new filings (C2, §8.3 AW1) |
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
| **D-AW3** | **Part 1's facts live in their own tables** — `application_intakes` (1:1 with the invitation) and `application_intake_licences` — keyed on the INVITATION (like packet marks, so off `merge_driver`), never pruned, and written by a new `record_applicant_intake` RPC that also writes `drivers`. The MVR's jurisdictions are read from `application_intake_licences`. Part 2 shows them read-only. Legacy invitations (the two mid-flight) fall back to the draft, labelled as legacy. | §2.3.1–2; fixes G-3's fall-back, G-4, G-7's source. |
| **D-AW4** | **Required documents**: CDL front + back required to finish Part 1; medical card required or "I don't have one yet". **No SSN card in Part 1** (`ssn_card` stays in the CHECK; only `APPLICATION_CAPTURE_REQUESTED` changes). **Part 1's captures are promoted to `documents` when Part 1 completes**, not at filing. The selfie is **never** promoted to `documents` (append-only, conflicts with a retention promise); it keeps its own retention. | Owner asked for required documents; §4 1324b risk; §2.3.2 retention. |
| **D-AW5** | Clearinghouse after the drug result is a **warning**, not a `requires` edge (clearinghouse keeps `requires: []`). The driver's portal consent is its own recorded fact (`clearinghouse_portal_consent` qualification kind). | Law orders neither (§382.701(a)(1), §382.301(a) **[V]**); a carrier preference warns. §382.703 consent is a DQF fact. |
| **D-AW6** | Drug-test site/appointment is a manual record (`drug_test_appointments`) + a locator link; no lab integration now. Operational, not DQF evidence. | Tens of applicants a month; Q-AW7. |
| **D-AW7** | Travel gets a record (`applicant_travel`, keyed on the invitation). **"Ready to travel"** = permissions, MVR (every jurisdiction), PSP, drug test, Clearinghouse, **medical certificate** (kept — Q-HM5), application filled (Q-AW9). `medical_certificate.requires` moves from `application_filled` to the intake stamp. `office_approved`, `orientation_videos`, `employment_investigation` stop being before-travel. | The owner's order; Q-HM5 preserved. |
| **D-AW8** | **Phone verification before filing** is its own append-only record `employer_verification_calls` keyed on the invitation + the draft employer's stable key (dates, position, reason, CMV, DOT-tested — each confirmed/corrected/not confirmed; who called; who answered). At filing, `submit_driver_application` copies each call into `employer_inquiries` (method `phone`) against the new `driver_employment_history` row, so §391.23's record is one record after filing. | `employer_inquiries.employment_id` cannot exist before filing (§2.2). Needs a stable per-employer key in the draft (§8.3 AW1). |
| **D-AW9** | **Scanner** = native camera via the file input (D-APP11 stands) + in-browser metrics (advisory until thresholds exist; D-SCAN10 stands) + server re-hash and metrics + PDF417 autofill. No OpenCV. | §6.6. |
| **D-AW10** | **Selfie phase 1** = a photo compared by a person; phase 2 (vendor) only after counsel. | §6.7. |
| **D-AW11** | Part 1 is a linear stepper; Part 2 a task-list hub; one thing per page; add-another loops; check your answers; memorable-date boxes. | §6.4, §6.8. |
| **D-AW12** | SMS window uses the zone derived from Part 1's state (and ZIP where a state spans two zones: take the strictest); unknown stays strict; held messages go to `sms_outbox` and the scheduler drains them when the window opens. No `drivers.time_zone` column — derived, never stored. | A-11 at the root; deriving beats restating. |
| **D-AW13** | The four employer fields, §40.25(j), and a gap explanation become required **for new filings** through the certification/send refinement (`applicationBeforeCertificationSchema`, `applicationContract.ts:408`), **not** by changing `.nullish()` — the base schema must still parse append-only history, and there is no contract version constant. | §4; append-only filings. |

---

## 6. The target

### 6.1 The applicant's link

`Welcome → Part 1 (linear) → wait for screening → Part 2 (task list) → wait for review/travel →
(in the office) packet → handbook → filed card`.

### 6.2 Part 1 — "Get started" (~8 minutes)

| # | Screen | Collects | Notes |
|---|---|---|---|
| 1 | Welcome | — | who the carrier is, what happens next, what to have ready (CDL, medical card), time, language |
| 2 | E-sign consent | consent | existing |
| 3 | About you | legal name (confirm/edit), mobile, DOB (3 boxes) | prefill from the invitation (WCAG 3.3.7) |
| 4 | Where you live now | current address, ZIP first → city/state | drug-test site; SMS zone |
| 5 | Your CDL | state (picker), number, class (A/B/C, `drivers.cdl_class` CHECK 0098), expiry (3 boxes), endorsements (H/N/X/T/P/S) | prefilled from the barcode on screen 8 when read; the driver confirms |
| 6 | Other licences, last 3 years | yes/no gate, then one licence per screen: **state picker** + optional agency text + number | `application_intake_licences` |
| 7 | Two screening questions | §40.25(j) (past two years); §382.301(b) facts: in a DOT testing program in the previous 30 days AND either tested in the past 6 months OR in a random program for the previous 12 months | **Leads only** — the exception is the employer's to verify (§382.301(b)(3), (c)) **[V]** |
| 8–10 | Photos, one per screen | CDL front → CDL back (barcode read) → medical card ("I don't have one yet") | §6.6 |
| 11 | Selfie | a photo | §6.7 |
| 12 | Your rights | the FCRA summary (Q-AW13 text) | read, Continue |
| 13–18 | Six permissions | one instrument per screen, DocuSign-style (AF6) | existing |
| 19 | Done | what happens next; **Clearinghouse registration** (link + steps, why); SMS opt-in card | `intake_completed_at`; captures promoted |

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
- **Road test (11) → orientation (12) → packet + handbook (13) → hire (14)** — existing gates; handbook
  after the packet (HB022). One "ready to hire" definition (G-11).

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

---

## 7. What changes in the hiring state machine

| Step | Change |
|---|---|
| `invitation_sent` | unchanged |
| **`intake_completed`** (new, "them") | done when `intake_completed_at` is set |
| `permissions_signed` | requires `intake_completed` |
| `mvr` | done when every `application_intake_licences` jurisdiction (legacy: draft) has an MVR within 30 days |
| `psp`, `drug_test` | unchanged |
| `clearinghouse` | done on the full-query record; the portal-consent fact shows as in-flight; warns if before `drug_test` |
| `medical_certificate` | requires `intake_completed` (was `application_filled`); still federal and before-travel |
| `application_sent`, `application_filled`, `office_approved` | `office_approved` no longer before-travel |
| **`travel_booked`** (new, "us") | done on an `applicant_travel` row; requires every before-travel step |
| `employment_investigation` | reads `employer_verification_calls` before filing, `employer_inquiries` after |
| `orientation_videos`, `live_orientation` | unchanged (`evidence: null`) until D4/orientation ship |
| `road_test` | the A-8 pass rule |
| `application_signed`, `handbook`, `hired` | one "ready to hire" definition = `HIRE_REFUSES_WITHOUT`; `blockedBy` no longer shows an open step as blocked |

`hiringSteps.ts` is 494 lines: split before editing (C1).

---

## 8. Execution — large batches (owner, 2026-09-26)

### 8.1 How we ship

- **One migration PR per wave (M), then large code PRs (C).** A migration and its first reader never
  share a merge (a merge is served ~3 min in, the migration applies ~5 min in —
  `docs/MIGRATION-DISCIPLINE.md`). An applied migration cannot be edited, so **M1 is designed
  completely in §8.2 before it is written.**
- Each PR: branch off `origin/main` into its own worktree, run every CI gate locally once
  (`$?`-checked), open the PR, wait for CI on the current head, **merge when green without asking**,
  verify the merge landed, append one line to §11.
- Tests are written with the code in the same batch; mutation-proving is done for new gates and
  refusals, not for every line.
- **C-batches start only after M1 is verified applied in production** (`GET /api/version` schema +
  `pg_proc`/`information_schema` check by hand — `lint:migration-ordering` cannot see functions or
  CHECK widenings).

### 8.2 M1 — migration 0376 (schema only, no reader)

All with RLS enabled (no client policies = deny-all), registered in `table-modules.json` (with a
lifecycle/retention block), `table-writers.json`, table-producer waivers pinned to this plan (the
producer ships in C2/C3), `schema.generated.sql` regenerated, seeded in `rls.test.mjs`, and a PGlite
matrix per new function that prints a `RESULT` line. Any `driver_id` foreign key is listed in
`mergeDriver.ts` DRIVER_REASSIGNMENTS (or `check-driver-references` fails). `qualification_records` is
the evidence module's table → a `cross-module-waiver` line.

| Object | Change |
|---|---|
| `application_invitations` | `intake_completed_at timestamptz`, `handbook_filing_claimed_at timestamptz` |
| `application_intakes` (new) | 1:1 invitation; phone, address, screening answers (§40.25(j), §382.301(b) leads), `fcra_summary_shown_at`, `medical_card_pending bool`, `selfie_verdict` CHECK (matches/does_not_match/unclear) + `_by` + `_at`; never pruned |
| `application_intake_licences` (new) | invitation, state code (CHECK against the jurisdiction codes), agency text, number, expiry; never pruned |
| `record_applicant_intake` (new function) | the single writer of intake + `drivers` (phone, address, `cdl_class`, `cdl_expires_at`) + `driver_endorsements`; fill-only for the applicant, overwrite for the office (0365's rule); refuses an expired link for the applicant. `record_applicant_identity` stays until its caller moves |
| `application_captures` | slot CHECK widened with `selfie`; `server_sha256`, `metrics jsonb`, `verified_at`; a confirm RPC that writes them |
| `application_packet_marks` | `packet_version text` (nullable — 20 production marks have none); `record_packet_mark` **12-argument overload** beside the 11-argument one, so the old caller keeps working through the deploy window |
| `qualification_records` | partial unique indexes: one handbook record per invitation (`kind='handbook' and detail->>'source'='handbook_signing'`), one road-test record per idempotency key |
| `qualification_records` + `documents` kind CHECKs | add `clearinghouse_portal_consent` to both (kept in lockstep since 0373) + `QualificationKind`/`DocumentKind` in shared |
| `drug_test_appointments` (new) | invitation, site name/address/phone, window, donor id, arranged_by, sent_at |
| `applicant_travel` (new) | invitation, mode, depart/arrive, confirmation ref, booked_by |
| `employer_verification_calls` (new, append-only) | invitation, employer key, field outcomes, called_by, answered_by, called_at |
| `sms_outbox` (new) | org, driver, body, reason, not_before, status, provider_message_id, sent_at, delivered_at |
| `sms_suppressions` (new) | org, phone E.164, reason, created_at |
| `application_screen_events` (new, prunable) | invitation, screen, entered_at, left_at |
| `application_drafts` | `revision int`; `save_application_draft` overload with an expected revision |
| `RETENTION_FORBIDDEN` | `handbook_marks`, `application_packet_marks`, `application_intakes`, `application_intake_licences`, `employer_verification_calls` |

**Held out of M1 → M2**, because an owner or counsel answer changes the shape: packet-template
versioning for Q-AW2 (b); a `drivers` status trigger (Q-AW21); anything Q-AW5 phase 2 needs.

### 8.3 Code batches

| Batch | Contents | Needs | Est. |
|---|---|---|---|
| **C0** (now, no migration; by 2026-09-28 18:00 UTC) | A-1 (after Q-AW1), A-2, A-3, A-4, A-6, A-7, A-8, A-9 (route guard + generic-door refusal), A-12 (verified parts), G-5, G-6, G-8, G-9 (date field, scan must be an `other` document registered via `/authorizations/document`, re-hash), G-12 | Q-AW1, Q-AW15 | 1½ days |
| **M1** | §8.2 | this plan approved | 1 day |
| **C1** (splits only, behaviour-neutral) | files the batches below would push past 500: `ApplyPage.vue` 491, `hiringSteps.ts` 494, `packetContinuation.ts` 489, `usePacketAdoption.ts` 490, `packetFieldValues.ts` 488, `draft.ts` 480, `applicationContract.ts` 473, `strings.flow.ts` 467, `employment.ts` 464, `packetOverlay.ts` 456, `strings.ts` 449, `publicApplication.ts` 439, `applicantBoard.ts` 437 | — | 1 day |
| **C2** (after M1 applied) | A-5 (versions on marks; filing compares) → rebase and merge #1059 with A-13; A-10; A-11 + G-2 (outbox, suppressions, zone, receipts, terms, US-only numbers, per-link number cap, exact-keyword STOP, START, STOP revokes every live consent of that link); G-3; G-7 (one checklist-input builder); G-11; AW1 (required-for-new-filings refinement, `employment_gaps[]`, a stable employer key in the draft); AW2 writer; AW7 (MVR from intake); AW8 (drug-test appointments, portal consent, warnings); AW11 (travel, state machine §7); AW12 (phone verification + copy at filing) | M1, Q-AW7, Q-AW9 | 5 days |
| **C3** (after M1 applied) | AW3 Part 1 shell + screens + FCRA summary + Part-1 nudge + memorable-date primitive in `@silvicom/ui`; AW4 scanner wizard + server confirm; AW5 barcode; AW6 selfie phase 1; AW9 Part 2 hub, loops, coverage meters, notice screen, check your answers, (b)(1) header, (b)(12) wording; AW10 local draft replay + resumable uploads (Supabase TUS on `application-captures`); AW14 screen events, Lighthouse CI, 44 px sweep, offline test | M1, C1, Q-AW3–6, Q-AW10, Q-AW12, Q-AW20 | 8–9 days |
| **C4** | AW13 Spanish on `/apply` + key-parity test; M2's readers | Q-AW11, M2 | 2 days + translation |
| **QA** | §9's walk, fixes from it | all | 1–2 days |

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
6. The office has added the examiner and at least one carrier representative, and recorded one QA
   road test and one QA handbook countersign.
7. Every counsel question this plan raised (Q-AW5, Q-AW13, Q-AW14, Q-AW16, Q-AW17) is in the counsel
   package with a recommendation.
8. No `[I]` in this file remains without a named owner in §10.

---

## 10. Still unverified, and who confirms

| Item | Why unverified | Who |
|---|---|---|
| A-12: blank licence number, UTC date on the road test | not re-read in the verification pass | first task of C0 |
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
| **Q-AW1** ⚠ 09-28 18:00 UTC | `d61557dc` has no packet signature, so the handbook can't be signed. | (a) re-issue a new application; (b) paper handbook (needs a paper-handbook door, Q-MVR4); (c) the handbook screen adopts a signature itself when there is none | (c) — a driver can reach the handbook without a packet signature again; (a) for this driver if (c) can't land by the deadline. |
| **Q-AW2** | `f2b142e4` signed 20 marks on 09-17; fines and spelling change under them. | (a) re-open the changed pages; (b) file under the old text (versioned templates, M2); (c) re-issue | (b). |
| **Q-AW3** | Required documents in Part 1? | — | CDL both sides; medical card or "I don't have one yet". |
| **Q-AW4** | SSN card photo? | Part 1 / Part 2 optional / after hire | After hire; SSN typed at signing. |
| **Q-AW5** | Selfie: photo + human, or automated match? | (a) / (b) Stripe / (c) none | (a) now; (b) after counsel. |
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
| **Q-AW18** | Handbook receipt signed twice (p25 + h5) | withdraw p25 / keep | Withdraw p25 (D-PKT19 mechanism). |
| **Q-AW19** | Road test: examiner attestation; certificate handed over; §391.33 door | — | Record "handed over"; add the equivalency door; counsel note. |
| **Q-AW20** | 44 px targets: `/apply` only or product-wide? | — | `/apply` first. |
| **Q-AW21** | Applicant→active: route guard only, or also a DB trigger? | — | Route guard in C0; trigger in M2 if the owner wants defence in depth. |
| **Q-AW22** | Gap explanation threshold: 30 days (our coverage rule) or 59 (carrier's p5)? | — | 30 — stricter, and the office can ignore short ones. |
| **Q-AW23** | Orientation videos/live orientation before D4 ships: excluded from the hire gate (§9.3)? | — | Excluded, shown as "not built yet". |

---

## 12. Progress log

Append dated lines at the END.

- 2026-09-26 — Plan written, then verified by three independent passes (code, law/vendors,
  feasibility); every correction folded in. Nothing built. C0 has a deadline of 2026-09-28 18:00 UTC
  (`d61557dc`'s link). PR #1059 stays open until C2.
