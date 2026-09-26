# MVR release as a permission, and printable templates

Status: **MV0–MV3 LIVE** (#1054, #1055, #1056, all merged 2026-09-25; both services on `ef4f023`). **D-PKT19 + the document audit (§6) in the next PR.** Opened 2026-09-25 from the owner's review of
the permissions after the handbook shipped (#1051, #1053).

## 1. What the owner saw

Two gaps, both confirmed against the code before anything was built:

1. **There is no MVR permission.** The applicant signs five: `fcra_disclosure`, `psp`,
   `previous_employer`, `drug_alcohol`, `clearinghouse` (`APPLICATION_RELEASE_ORDER`). The MVR step
   is gated on `SCREENING_PREREQUISITES.mvr_order = ["fcra_disclosure"]`. The carrier's own release —
   packet page 19, `AUTHORIZATION FOR DRIVING RECORD CHECK` — IS signed by the driver, but as two
   packet marks (`p19a`, `p19b`) inside the 31-page application, after the permissions, where the MVR
   step cannot see it. `WORDING-REVIEW-2026-09-13.md` §2 and `CHECKLIST-TO-LIVE.md` B2 had recorded
   it as "an MVR authorization with nowhere to go", waiting on a vendor. The release does not depend
   on a vendor: the office pulls records from state portals and uploads them, and that needs consent.
2. **There are no templates to preview and print.** A blank instrument exists only for the applicant,
   behind their token (`applicationPermissionInstrument.ts`). The office can print documents ABOUT an
   applicant — the draft application (F6), the signed permissions (B2), the road test, the handbook —
   and nothing blank. And the API has accepted a paper-signed permission since 0215
   (`POST /authorizations`, `method: "wet_signature"`, `evidence_document_id`), but no screen calls it
   (Q-HUI6).

## 2. Rulings (owner, 2026-09-25)

- **D-MVR1 — the MVR release is a sixth permission, moved out of the application.** Signed on the
  link the same way as the other five, with the carrier's page 19 wording. Page 19's two driver lines
  are withdrawn from packet signing (`PACKET_WITHDRAWALS`, the L-1 mechanism), so nobody signs the
  same release twice.
- **D-MVR2 — templates exist for when the electronic path fails.** Every document the office uses can
  be previewed and printed BLANK, for a driver to sign by hand, and the office records the paper
  signature back with its scan.

And two decisions of ours, stated so they can be overruled:

- **D-MVR3 — the MVR step requires BOTH `fcra_disclosure` and `mvr`**, not `mvr` instead of FCRA.
  The recommendation the owner approved said "instead"; this builds "both", which is stricter and
  costs nothing because the ceremony always collects both — raised with the owner so it can be
  reversed. An MVR bought through a consumer reporting agency is a consumer report (FCRA
  §603(d)); one pulled from a state portal is not. We do not know, per pull, which route the office
  took, so the gate holds the release that covers both.
- **D-MVR4 — the blank templates carry no "paper copy" band**, reversing this plan's first draft of
  MV2. FMCSA's PSP form must be used *"in whole, exactly as provided … the language may NOT be
  included with other consent forms or any other language"*, and FCRA §604(b)(2) requires a document
  that *"consists solely of the disclosure"*: a band on those two is the addition the law forbids, and
  a band on only the other seven is a rule nobody could state. What records that a signature was on
  paper is the row — `method = 'wet_signature'` plus the scan it must cite (MV3).

## 3. Steps

| Step | What | Merge |
| ---- | ---- | ----- |
| **MV0** | `0375`: `driver_authorizations.purpose` admits `mvr`. Nothing else in the schema — `record_driver_release` counts against `p_expected_count` from the API (0228). Matrix: `release-ceremony.test.mjs`. | 1 |
| **MV1** | `mvr` in `AUTHORIZATION_PURPOSES`, labels, catalogue; the carrier's page 19 text in `PACKET_INSTRUMENTS`; `defaultWording` serves it under `packet-2026-08-21`; `APPLICATION_RELEASE_ORDER` gains it after `psp`; `SCREENING_PREREQUISITES.mvr_order` becomes both (D-MVR3); `p19a`/`p19b` withdrawn with a notice on the line. | 2 |
| **MV2** | Recruitment → **Templates**: every document blank, Preview and Print — the six permissions, the application packet, the handbook, the road-test form. Drawn by the SAME renderers as the signed copies (A2's lesson, `instrumentPages.ts`), **not banded** — D-MVR4. | 3 |
| **MV3** | **Record a paper signature** on the Permissions drawer: pick the permission, type the name as signed, the date, upload the scan → `POST /authorizations` `wet_signature` with the document. Closes Q-HUI6. | 3 |

### Deploy note for MV1

Two open links finished their five releases before this ruling (production, 2026-09-25: 2 of 4 open
invitations have `releases_completed_at`, 1 has filed). `record_driver_release` refuses a signature
on a closed ceremony (DR022), and 0336/0365 build later phases on that stamp, so reopening it is not
free. Instead their MVR step reads **"MVR release missing"** until the office records a paper
signature (MV3). That is the fallback working as designed, on two people. Until MV3 ships, those two
cannot have an MVR recorded — which is correct, because nobody holds their consent.

## 4. Open questions

- **Q-MVR1 — page 19's sentence stops mid-clause.** *"I hereby release you from any liability which
  might be the result of providing this"* — the workbook and the carrier's PDF both end there. Left
  exactly as written (D-PKT11) and recorded in `WORDING_LEFT_ALONE`. For the counsel memorandum
  (`COUNSEL-REVIEW-PACKAGE.md`): the missing word is almost certainly `information`.
- **Q-MVR2 — page 19's identity block is not on the electronic release.** The paper asks for driver
  name, address, city/state/zip, CDL number, state and expiry. The permissions are signed BEFORE the
  application form (D-APP4), so none of it is known yet; the release carries the signed name only.
  Candidates: (a) leave it — the office holds the licence on the application; (b) print the block on
  the office's copy from the filed application, marked as such; (c) ask for licence details on the
  release screen. Recommendation: (a) until a state asks for more.
- **Q-MVR3 — state forms.** PA (DL-503), WA, NH and PR require their own signed release, and
  California is a program (Employer Pull Notice), not a form (`RECRUITING-SYSTEM-PLAN.md` R3).
  Unchanged by this plan.
- **Q-MVR4 — paper fallback for the packet, handbook and road test.** MV2 prints them blank; MV3
  records paper signatures for the PERMISSIONS only, because a permission is one row. Each of the
  others is a step with its own gate (the handbook's blocks the hire), and "a scan was uploaded" would
  have to satisfy it. Candidates: (a) upload a scanned signed copy as the filed document, marking the
  step done with `method = paper`; (b) keep the electronic path mandatory and treat the printout as a
  reading copy. Recommendation: (a), built as its own step once the owner confirms.

- **Q-MVR5 — the date on a paper signature.** `accepted_at` is when the office RECORDED it, not the
  day the driver signed; the scan carries the real date. Candidates: (a) leave it, the scan is the
  evidence; (b) add a `signed_on` the office types, which needs a column (a migration, and its own
  merge). Recommendation: (a) unless an auditor asks.

## 5. Progress log

- 2026-09-25 — MV0 built: `0375_mvr_release_purpose.sql`; `release-ceremony.test.mjs` +3 (an `mvr`
  row is accepted, filed under its own purpose, an unknown purpose still refused). Proven by running
  the matrix without 0375: the two MVR assertions fail with 23514.
- 2026-09-25 — MV1 built: `mvr` is the sixth permission (after `psp`), served from the carrier's page 19
  under `packet-2026-08-21`; the MVR step needs `mvr` + `fcra_disclosure` (D-MVR3); `p19a`/`p19b`
  withdrawn, so the packet walk is 19 stops (18 for a company driver). Page 19 rasterised: both lines
  carry *"Not signed here. Signed electronically as its own permission."*, no name, no date. Five
  mutants, five killed: FCRA-only gate, MVR-only gate, `mvr` dropped from the order, `mvr` dropped
  from the default wording, `p19b` un-withdrawn.
- 2026-09-25 — MV2 + MV3 built. `GET /api/recruitment/templates/:key.pdf` (recruitment: view) draws
  each of `RECRUITMENT_TEMPLATES` blank with the renderer the electronic copy uses; the road test got
  a blank mode of the same drawing (`roadTestBlankFormPdf`). Rasterised: blank road test (both
  pages), blank handbook, packet p19. Recruitment gains a fourth tab, **Templates**. The Permissions
  drawer gains **Record a paper signature**: `POST /drivers/:id/authorizations/document` registers
  the scan (kind `other`), and `POST /authorizations` now REFUSES `wet_signature` without a scan, or
  with a scan filed against another driver — two mutants, both killed.
- 2026-09-25 — D-PKT19 built (owner: *"we dont need duplicate pages"*): packet pages 15, 20 and 22
  withdrawn from signing, as page 19 was — each is a permission signed on the link. Walk 19 → 16
  stops (company driver 18 → 15). Three defects found by rasterising every template and a filled
  packet, none visible to a text assertion, all fixed: page 15's notice printed cut
  (*"Signed electronically…"*) and now breaks onto two lines; page 15 would have printed the
  certification date as its signing date; the handbook's second signature block opened page 9 alone.
  Seven mutants, seven killed (each of the three withdrawals, the page-15 date, page 22's name and
  date, the notice wrap, the handbook keep-with).

## 6. Document audit (2026-09-25)

The owner asked for no duplicate pages, and every page precise in text and layout. Rendered: the
six blank permissions, the blank packet, a filled packet (long names, pre-ruling marks on every
withdrawn line), the handbook and the road test; every page looked at.

### 6.1 What is signed where, after D-PKT19

| Act | Signed | Packet page |
| --- | --- | --- |
| FCRA disclosure | permission 1 | p20 — withdrawn (D-PKT19) |
| PSP | permission 2 | not in the packet |
| MVR release | permission 3 | p19 — withdrawn (D-MVR1) |
| Previous-employer release | permission 4 | p15 — withdrawn (D-PKT19) |
| Drug and alcohol testing consent | permission 5 | p22 — withdrawn (D-PKT19) |
| Clearinghouse limited-query consent | permission 6 | not in the packet |
| Page 4 consumer-report release | nowhere | p04 — withdrawn (L-1, counsel Q1) |

### 6.2 Text

The packet prints the carrier's words exactly, typos included — **D-PKT11 is the owner's ruling**
(*"these are created by lawyers, keep texts like this"*), and nothing here reverses it. Correcting
them is counsel's redraft (memorandum Q3(b), Q15). The permissions, handbook and road test are
pinned word for word to their sources by tests (`packetWording.test.ts`, `handbookText.test.ts`,
`roadTest.test.ts`). The road test's three extra items and its `breaking` are deliberate
(`ROAD-TEST-PLAN.md` §2).

### 6.3 Open — each needs a ruling, none is built

- **Q-MVR6 — the packet and the handbook fine the same offence differently, and the driver signs
  both.** Packet pages 7–10 (initialled p05/p06/p09, signed p10) against the handbook's fine list
  (signed h2, h3):

  | Offence | Packet | Handbook |
  | --- | --- | --- |
  | Late logs | $10/day after 25 days | $5/day after 15 days |
  | Roadside inspection not turned in | $150 | $50 |
  | CDL suspension not reported | $1,500 | $100 + termination |
  | Unqualified / unauthorised driver | $1,500 | $500 + termination |
  | Accident needing a drug test not reported | $1,000 + termination (p9 r7) | $500 + termination |
  | Unauthorised riders | $150 + possible termination | $500 + termination |
  | Missing fuel receipt | $20 | $25 |
  | Driver/truck change not notified in 24h | $150/day | $25/day |
  | Trailer inspection not turned in | $100/week | $50/week |

  A signed contract with two prices for one offence is a dispute waiting for a settlement statement.
  Not ours to resolve: the owner says which governs, and the other is corrected by counsel or
  withdrawn. **Recommendation:** the handbook governs (it is the document the hire gate
  requires, D-HB5; neither is dated as a whole), and packet pages 7–10 go to counsel with this table.
- **Q-MVR7 — page 25 is a handbook receipt signed before the handbook is shown.** The packet walk
  (p25) comes before the handbook step (D-HB1), and the handbook carries its own receipt (h5).
  p25 also names the FMCSR *Interstate Truck Driver's Handbook*, which nothing hands over (Q-OR3).
  **Recommendation:** withdraw p25 like the permissions, once the owner confirms the FMCSR book is
  handed over on paper at orientation.
- **Q-MVR8 — the packet certifies itself three times** (p11b, p13, p17: "the application is true")
  and authorises investigation three times (p11a, p13, p17). None duplicates a permission; the
  carrier's paper repeats itself. Removing any is memorandum Q2's question. **Recommendation:** leave
  until counsel answers Q2.
- **Q-MVR9 — the road test form has lost the driver's signature.** The carrier's form has
  `Driver's Signature:` under `Phone:`; ours prints neither blank nor filled, and the office-recorded
  road test has no way for a driver to sign. The blank template also omits the third section, the
  §391.31(e) *Certificate of Road Test*. **Recommendation:** print the line (blank on paper; the
  electronic path needs the driver to sign at the desk, as the packet does), and add the certificate
  to the template.
- **Q-MVR10 — pages 29–30 leave the contract's party names blank** (`(Owner Operator - Independent
  Contractor)`, `a.k.a Driver`); only page 31's are filled. Waits on memorandum Q15 (whether pages
  29–31 stay in the packet at all).
- **Q-MVR11 — page 12 cuts an ordinary company name.** One-line cells in ~34pt rows:
  `Long Haul Transportation Logistics LLC` prints `Long Haul Transportation…` and the row moves to
  a continuation sheet. AUD-5 measured 11 of 15 rows continued on its fixture. Two lines per cell
  would keep most rows on the carrier's page. **Recommendation:** build as its own step; it changes
  how every packet filed after it prints.


## 7. Spelling corrected (D-PKT20), and what was deliberately not (2026-09-25)

The owner: *"my secretary retyped this application so lets fix spelling mistakes"*. Every page was
read and dictionary-checked; the corrections are one register, `packetSpelling.ts`, applied to the
printed packet and to the four permissions transcribed from it (`APPLICATION-PACKET-PLAN.md` D-PKT20).
Served permission wording moved to version `packet-2026-09-25`.

**Not corrected, because each needs a word supplied or a sentence rewritten — drafting, not
spelling.** For the owner, or counsel where it is an instrument:

| Page | As printed | Question |
| --- | --- | --- |
| 4 | *"name and dates or previous employers"*, *"may be others from such agencies"*, *"upon proper information"*, *"preceding by request"* | Page 4 is withdrawn (L-1) and with counsel (Q1); garbled, not misspelled. |
| 5 | *"completed the staring classes"* | `starting`? `training`? Two readings. |
| 9 | *"what so ever for none reported tardy"*, *"notify company of for a suspended license"*, *"a $150 fined"*, rule 9 ends *"a fine and possible"* | Rule 9 is missing its last word (`termination`). |
| 10 | *"amend, change or review"*, *"or added at any writing shall"* | `revise`, `addition in writing`? |
| 15 | *"at any including when applying"*, *"within 30 days SILVICOM INC making"* | Missing `time`, `of` (were already on the list). |
| 17 | *"make such in to my employment history"*, *"Shell \| be given a fuel card"*, *"F.M.C.A."* | `such inquiry into`? `I shall be given`? `F.M.C.S.A.`? |
| 18 | *"a driver int a given time"* | `at`? `in`? |
| 19 | *"…the result of providing this"* | Sentence unfinished (Q-MVR1). |
| 21 | *"Regulations decide that"*, *"total time on duty / on duty"* | `require`? A repeated phrase across a line break. |
| 23 | *"of which she Individuals were convicted"* | Garbled. |
| 24 | *"available throught to company"*, *"FMCR Handbook"* | `throughout the company`? `FMCSR`? |
| 27 | The first paragraph repeats a half-sentence: *"…will result immediate medical attention. I understand that the transportation of unauthorized passengers will result in the termination…"* | A duplicated fragment to delete. |
| 29 | *"hours following and such accident"* | `any such`? |
| 30 | *"either of either of the parties"*; the severability clause *"If any one or more of the provisions contained in the Agreement but the Agreement will be enforceable…"* is missing its middle | Counsel memorandum Q15. |

Punctuation (full stops mid-sentence on pages 20–22, `SILVICOM. INC`, `Operator&`) is left as printed.
The handbook (`DRIVER HANDBOOK.docx`, D-HB4) was NOT part of this ruling and still prints its own
typos (`COMPNAY`, `THA`, `TEMINATION`, `FLASIFICATION`) — ask whether it was retyped too.
