# The carrier's application packet — what our PDF has to become

**Created 2026-08-22.** Child plan of `RECRUITING-SYSTEM-PLAN.md`; sibling of the completed
`APPLICATION-SYSTEM-PLAN.md`, whose A6 built the PDF this plan replaces. Executes under
`RECRUITING-SYSTEM-PLAN.md` §4 without exception — this document adds steps, never a second protocol.

> **STATUS: PLANNING ONLY. No code has been written for any step below.** The fork was put to the
> owner on 2026-08-22 and they chose **(b)** — reproduce the fillable pages, attach the policy and
> agreement pages as static documents. That decision is recorded as **D-PKT1** and the inventory in
> §2 is what it now has to be executed against.

---

## 0. Why this document exists

`apps/api/src/services/applicationPdf/render.ts` prints a §391.21-shaped summary under headings
`(b)(1)` … `(b)(12)`. It is a correct rendering of the regulation and it is **not the carrier's
application**. `docs/plans/recruitment/APPLICATION.xlsx` is: one sheet, 910 populated rows,
**31 pages**, letterhead on every page and `THIS IS NOT AN EMPLOYMENT APPLICATION` in every footer.

The owner's instruction was "don't change the final application". Taken at face value, that is a
statement about the *packet*, not about §391.21 — and our PDF is not a version of the packet at all,
it is a different document that happens to collect overlapping information.

⚠ **The good news is in the data, and it is better than expected.** Almost everything the fillable
pages ask for is already collected, certified and stored. What is missing is mostly *shape*: the
packet asks for the same facts in a different arrangement, with far more signatures.

---

## 1. Ground truth — established 2026-08-22 by parsing the workbook, not by reading a summary

The `.xlsx` was unzipped and `sheet1.xml` parsed against `sharedStrings.xml`. Page boundaries were
taken from the footer row that carries the page number, so the page numbering below is the carrier's
own, not a reader's count.

| Fact | Value |
|---|---|
| Sheets | 1 |
| Populated rows | 910 (775 with text) |
| Shared strings | 697 |
| Pages, by the packet's own footer numbering | **31** |
| Explicit row page-breaks in the file | **0** — pagination is print-area/scaling, not stored breaks |
| Signature / initial points | **21 across 17 pages** (§2.3) |
| Signature points our ceremony currently collects | **5 instruments + 1 certification** |

⚠ **The zero page-breaks matter for execution.** The pagination is a property of Excel's print
settings, not data in the file, so "page 12" is not recoverable from the workbook by a program — it is
recoverable only from the footer text, which is exactly how the table below was built. Any future
re-derivation must use the same anchor.

---

## 2. The inventory — every page, classified

### 2.1 The four classes

- **FILL** — the page takes applicant data. We must reproduce it and fill it.
- **SIGN** — static text the applicant signs or initials. We must reproduce it and place a signature.
- **STATIC** — policy or contract text with nothing to fill. Attach, do not re-render per applicant.
- **NOT OURS** — the page is not part of the applicant's document at all (§2.4).

### 2.2 The table

| p | What it is | Class | Data we already hold |
|---|---|---|---|
| 1 | Commercial driver information — identity, 3-year residency, CDL #, phone | **FILL** | ✅ all of it |
| 2 | Licences held · driving-experience grid · accidents · convictions · licence denials | **FILL** | ✅ all of it (⚠ see §3.1) |
| 3 | Orientation & drug-test acknowledgement | **SIGN** | signature + printed name + date |
| 4 | Independent Contractor Notification & Release (consumer report) | **SIGN** | ⚠ **defective — §3.3** |
| 5 | Minimum qualifications | **SIGN** (initials) | — |
| 6 | Documents required · criminal history | **SIGN** (initials) | — |
| 7–8 | Rules and Regulations, parts 1–2 | **STATIC** | — |
| 9 | Rules and Regulations, part 3 | **SIGN** (initials) | — |
| 10 | Rules and Regulations, part 4 | **SIGN** | printed name + signature + date |
| 11 | Employment-record instructions + investigation release + certification | **SIGN ×2** (⚠ §3.4) | — |
| 12 | 10-year employment history verification log — **3 rows** | **FILL** | ✅ incl. aliases (`other_names`) |
| 13 | Acknowledgement and authorization (45-day validity) | **SIGN** | — |
| 14 | Previous-employer verification request form | **NOT OURS** — §2.4 | — |
| 15 | Past employment verification release | **SIGN** | name, DOB, SSN |
| 16 | Education · military · training · three references | **FILL** | ✅ `silvicom_driver` |
| 17 | Interview / disposition record | **NOT OURS** — §2.4 | — |
| 18 | CDL certification of compliance | **SIGN** | CDL #, state, expiry |
| 19 | Authorization for driving record check | **SIGN** | CDL #, state, expiry |
| 20 | Fair Credit Reporting Act disclosure | **SIGN** | — |
| 21 | Seven Day Work Statement | **FILL + SIGN** | ❌ **nothing — §3.2** |
| 22 | Urinalysis notification | **SIGN** | — |
| 23 | Annual/quarterly violation review | **NOT OURS** — §2.4 | — |
| 24 | Driver safety training | **STATIC** | — |
| 25 | Interstate Truck Driver's Handbook receipt | **SIGN** | — |
| 26 | §40.25(j) two-year pre-employment test question | **FILL + SIGN** | ✅ already asked |
| 27 | Authorized passengers · off-duty authorization | **SIGN** | — |
| 28 | Alcohol and drug abuse policy | **SIGN** | — |
| 29–30 | Owner Operator & Leased Driver Agreement, parts 1–2 | **STATIC** | — |
| 31 | Owner Operator & Leased Driver Agreement, part 3 | **SIGN** | — |

**Totals: 5 FILL · 18 SIGN · 5 STATIC · 3 NOT OURS.**

### 2.3 ⚠ The signature count is the finding, not the page count

The packet asks for a signature or a set of initials **21 times across 17 pages**. Our ceremony
collects **five** instruments plus the §391.21(b)(12) certification. Fork (b) does not reduce this
number at all — a page that is static text plus a signature is still a page somebody has to sign, and
"attach it as a static document" is only honest for the five pages nobody signs.

**This is the single largest piece of work in the plan, and it is not PDF rendering.** It is the
signing ceremony growing from six placements to twenty-one, on a phone, without becoming a form
somebody abandons.

**ANSWERED 2026-08-22 by the owner — D-PKT6.** All twenty-one, each in its own place, on the DocuSign
model: *"we can make 1 signature and then driver will review all things and apply same signature to
all places one by one … driver will be moved to next place where signature is needed on next button
and he will be able to reuse same signature and initials."*

⚠ **That mechanism already exists, and finding so changes the size of this step.**
`useSigningCeremony.ts` is adopt-once-then-step-through today: `adoptedName` is typed once
(`adoptAction: "Use this as my signature"`), `outstanding` is the queue, and `position`/`total` walk
it one item at a time — `strings.ts` already promises *"Type your name once — each document is then
one tap"*. P5 is therefore **not a new interaction model**. It is three concrete extensions of one
that ships:

1. The queue grows from 5 instruments to 21 **placements**, and a placement is a position on a page
   rather than a whole document — several of them land on the same page (p11 has two, p21 has two).
2. **Initials become a second adopted mark** beside the signature. Four pages take initials (5, 6, 9)
   and the packet treats them as a distinct mark, not an abbreviation of the signature.
3. `SignaturePad`'s optional drawn mark (A8b/D-APP8) has to be re-applied at each placement rather
   than captured once, or the drawn version appears on the first page and nowhere else.

⚠ **One placement can never join the "same signature everywhere" flow: page 20's FCRA authorization.**
§604(b)(2) requires the disclosure to be its own document, and `SigningCeremony`'s existing
one-instrument-per-screen rule is what implements that. It stays a separate stop even in a
walk-me-through queue, and the queue must not be allowed to render it alongside anything else.

### 2.4 ⚠ Three pages are not the applicant's document, and must not be in this PDF

Discovered while classifying; each would have been reproduced by mistake under a naive "print all 31
pages" reading of fork (a).

- **p14 — previous-employer verification request.** This is the form the carrier **sends to a former
  employer**, with `Sent to`, `Requested by Silvicom Inc`, and the §391.23 / Part 40 questions the
  employer answers. We already own this act: `employer_inquiries` (0223) and `EmployerInquirySection`.
  It belongs to that surface, and putting it in the applicant's packet would produce a blank form in
  a signed document.
- **p17 — interview / disposition record.** `Contracted or Rejected?`, `Interviewer`, `Date to start`,
  `Termination date`, `Why?` — carrier-filled, after the application, by somebody else.
- **p23 — annual/quarterly violation review.** Two halves, both post-hire: the driver's §391.27
  certification of violations for the preceding twelve months, and the motor carrier's review of it.
  This is the **annual round**, which `RECRUITING-SYSTEM-PLAN.md` R7 owns. An applicant has no twelve
  months with this carrier to certify.

---

## 3. Five things that have to be decided or built before any page renders

### 3.1 The equipment grid is fixed rows, and ours is a free list

Packet p2 prints four fixed rows — `STRAIGHT TRUCK`, `TRACTOR — SEMI TRAILER`,
`TRACTOR — TWO TRAILERS`, `OTHER` — each with class, type (`VAN, TANK, FLAT, ETC`), from/to dates and
approximate total miles. `equipment_experience` is an unbounded list the driver adds rows to.

Both satisfy §391.21(b)(6). They do not print the same. The renderer must map our list onto those
four rows, and the mapping is lossy in one direction: two tractor-semi entries with different date
ranges collapse into one row.

⚠ **This is also the question the design canvas already answers.** Its fourth artboard is a
redesigned equipment question, and the packet's four fixed rows are almost certainly why. Deciding
the wire format here without looking at that artboard would build the mapping twice.

⚠ **And it needs icons the barrel does not have.** `packages/ui/src/icons.ts` has no distinct
straight-truck, doubles, tanker or bus glyph. Adding them means editing `icons.ts` first (contract
§1.3) — never importing from `@hugeicons/core-free-icons` directly.

### 3.2 The Seven Day Work Statement asks for data we do not collect at all

p21 wants: driver name, address, CDL, **seven dates with hours worked on each**, the date and time
the driver was **last relieved from duty**, and two signatures. Nothing in
`driverApplicationSchema` or `questionnaireContract` collects any of it.

⚠ It is also the one page whose answer **expires**. §395.8(j)(2) asks for the seven days preceding
the day the driver begins work, so a statement filled in during an application is stale by the time
somebody is hired. **This page probably does not belong in the application at all** — it belongs to
the hire, beside the hire date. Recorded as an open question (§6 Q-PKT2) rather than assumed.

### 3.3 ⚠ Page 4 is legally defective and must not be adopted verbatim

Already flagged in `HANDOFF-2026-08-21-NIGHT.md`, confirmed here against the text:

- It **bundles a consumer-report disclosure with a liability release** — "I AUTHORIZE, WITHOUT
  RESERVATION ANY PARTY OR AGENCY CONTACTED BY…". FCRA §604(b)(2) requires the disclosure to be *in a
  document that consists solely of the disclosure*. `DisclosurePanel.vue` already carries that rule in
  a comment, and `SigningCeremony` is built around it.
- It names **DOT Service, Chicago, IL** as the consumer-reporting agency. That is not who we query.
  Our screening runs through **PSP** (FMCSA's Pre-Employment Screening Program) and the MVR vendor.
  A disclosure naming the wrong agency does not disclose anything.

**Adopting the packet verbatim would import both defects into a document a person signs.** This is
A0/counsel work, not a code task. Our own `DISCLOSURES` are `v0-draft` placeholder text waiting on
the same review; the two should be settled together, and `isDraftDisclosure()` already refuses to put
a signature under unreviewed wording on every write path.

### 3.4 ⚠ The packet's tables are FIXED HEIGHT, and our data is unbounded

Counted from the workbook by looking for styled-but-empty cells, which is what a bordered blank line
is in a spreadsheet:

| Table | Rows the packet gives it |
|---|---|
| Driving experience (p2) | **4**, and they are *named*: straight truck · tractor-semi · tractor-two-trailers · other |
| Accident record, 3 years (p2) | **3** |
| Traffic convictions, 3 years (p2) | **3** |
| Previous three years' residency (p1) | **3** |
| 10-year employment log (p12) | **3** |
| Employment record (p11) | **0** — it is instructions and a release; the log on p12 is where the data goes |

`driverApplicationSchema` bounds none of these. A driver with four accidents, or five employers in ten
years — which is ordinary in this industry — **overflows every one of them**. The packet's own answer
is printed on p11: *"ATTACH SHEET IF MORE SPACE IS NEEDED"*.

So the renderer needs a continuation convention, decided once and applied to all five tables: fill the
printed rows, and when there are more, print "see attached" in the last row and render an overflow
page in the packet's own layout. ⚠ **The alternative — silently truncating at three — would produce a
document that is signed, filed, and materially false**, because §391.21(b)(7)–(9) asks for *all*
accidents and convictions in the period. Truncation is not a rendering shortcut here; it is a
misrepresentation on a certified form.

⚠ This also corrects a first reading of the packet: **p11 is not a fillable page.** It looked like one
from its heading, `EMPLOYMENT RECORD (ATTACH SHEET IF MORE SPACE IS NEEDED)`, and it holds no grid at
all — one blank styled row, which is the signature line. The employment data goes on p12.

### 3.5 ⚠ Citations stay in print — task B does not reach this document

The packet cites regulations **on its own pages**: §383.21 on p2, §391.23(d)/(e) on p11, Part 40 and
§391.21(b)(10) on p15, Part 391 on p23. B (U8 / D-UI9) removed citations from **screens** and left
them in print for exactly this reason. Nothing in this plan strips a citation from a rendered page.

---

## 4. Decisions

| ID | Decision |
|---|---|
| **D-PKT1** | **Fork (b), chosen by the owner 2026-08-22.** Reproduce the pages that take applicant data or a signature; attach Rules & Regulations (7–8), Driver Safety Training (24) and the Owner-Operator Agreement (29–30) as **static documents**. A page that is policy text *plus a signature* is NOT static — it is reproduced (§2.3). |
| **D-PKT2** | The three NOT-OURS pages (14, 17, 23) are never rendered into the applicant's PDF. Each already has, or will have, its own surface. |
| **D-PKT3** | The static attachments are **one filed artifact per version**, not per applicant. They are identical for everybody; rendering them per submission would put 5 unchanging pages into every stored document and make a wording change invisible. Version them the way `DISCLOSURES` are versioned. |
| **D-PKT4** | ⚠ **No packet wording is adopted verbatim without counsel.** §3.3 is the worked example, and it is not the only page with the problem — the packet is full of typographical corruption ("BACKFROUNG", "maritial", "whcihc", "typyes"), which is harmless in a scan and is *not* harmless in a document we generate and a person signs. Transcription is a review pass, not a copy. |
| **D-PKT6** | **Twenty-one placements, one adopted mark, DocuSign-style** (owner, 2026-08-22). The driver types their name once and their initials once, then a Next button walks them to each place a mark is needed. ⚠ The FCRA authorization (p20) stays a screen of its own regardless — §604(b)(2), and it is the rule `SigningCeremony` was built around. ⚠ This is an extension of `useSigningCeremony`, not a replacement: see §2.3. |
| **D-PKT5** | The current §391.21-shaped PDF is **not deleted** when the packet PDF ships. It is what `qualification_records` points at today, it is regulation-correct, and an already-filed document must keep rendering. The packet becomes the document produced for NEW submissions. |

---

## 5. Steps

⚠ **P1 and P2 are blocked on people, not on code.** Everything after them is buildable.

### P1 · Counsel settles the wording — no code

The five `v0-draft` disclosures **and** packet pages 4, 18, 19, 20, 22 go to counsel as one review,
with §3.3's two defects named. **Done when:** every instrument has reviewed text and a real version
string, and `isDraftDisclosure()` stops refusing.

### P2 · The owner answers §6 — no code

~~Q-PKT1~~ **answered 2026-08-22 → D-PKT6.** ⚠ **Q-PKT2 (Seven Day Work Statement: application or
hire?) and Q-PKT3 (whose letterhead?) are still open** — they were asked on the same day and the
answers that came back in their place both described the signing mechanism, so neither question has
actually been answered. They block P4, not P5.

### P3 · The static attachments (D-PKT3)

Pages 7–8, 24, 29–30 as one versioned PDF artifact, filed once per version and referenced by every
application. **Done when:** a submitted application's document set includes the policy pack, and
changing its wording produces a new version rather than editing the filed one.

### P4 · The fillable pages

Pages 1, 2, 12, 16, 26 rendered from data we already hold, in the packet's layout and with its
letterhead and footer. §3.1's equipment mapping is decided here, against the design canvas.
§3.4's continuation convention is decided here too, and applied to all five fixed-height tables.
**Done when:** a submitted application renders those five pages with the applicant's own answers, and
a golden-file test pins the layout so a renderer change cannot silently reflow a signed document.

### P5 · The signature pages

The 18 SIGN pages and the 21 placements on them, as three extensions of `useSigningCeremony` (§2.3):
a placement queue, initials as a second adopted mark, and the drawn mark re-applied per placement.
**Blocked on P1 only** — D-PKT6 settled the interaction, but building 21 placements against `v0-draft`
wording would mean building them twice, and `isDraftDisclosure()` refuses the signature anyway.

**Done when:** a driver adopts one signature and one set of initials, is walked to all 21 placements
by a Next button, and the FCRA authorization is still the only thing on its own screen when they
reach it.

### P6 · Cutover (D-PKT5)

New submissions produce the packet; existing filed documents keep rendering as they were.

---

## 6. Open questions — owner and counsel

1. ~~**Q-PKT1 — twenty signatures on a phone?**~~ **ANSWERED 2026-08-22 → D-PKT6:** all 21, each in
   its own place, with one adopted signature and one set of initials reused across them on the
   DocuSign model. ⚠ The legal half of the question survives the answer and is folded into D-PKT6:
   FCRA §604(b)(2) keeps p20 on a screen of its own.
2. ⚠ **STILL OPEN. Q-PKT2 — Seven Day Work Statement: application or hire?** §3.2. Its answer expires, which argues
   for the hire.
3. ⚠ **STILL OPEN. Q-PKT3 — whose letterhead?** Every page carries `SILVICOM INC / 1301 ARMITAGE AVE / MELROSE PARK
   IL 60160`. FuelGuard is multi-tenant. Is the letterhead per-org configuration, or is this packet
   Silvicom's alone? ⚠ The QA org is **FuelGuard EFS QA**, so this is answerable today by asking what
   its packet should say.
4. **Q-PKT4 — the typos.** D-PKT4 says transcription is a review pass. Does the owner want the errors
   corrected, or the packet reproduced exactly as the carrier's paper reads?

---

## 7. What this plan deliberately does not do

- **No migration is proposed.** Every FILL page maps to data that already exists, except §3.2's
  Seven Day Work Statement — and Q-PKT2 may move that out of the application entirely.
- **No change to `ApplyPage`'s seven screens.** The packet is an output format. The one place it
  reaches back into the form is §3.1's equipment grid, and the design canvas already owns that.
- **No deletion of the existing PDF** (D-PKT5).
- **No wording adopted from the packet without review** (D-PKT4), and none at all before P1.
