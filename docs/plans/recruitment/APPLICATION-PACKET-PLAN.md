# The carrier's application packet — what our PDF has to become

**Created 2026-08-22.** Child plan of `RECRUITING-SYSTEM-PLAN.md`; sibling of the completed
`APPLICATION-SYSTEM-PLAN.md`, whose A6 built the PDF this plan replaces. Executes under
`RECRUITING-SYSTEM-PLAN.md` §4 without exception — this document adds steps, never a second protocol.

> **STATUS (corrected 2026-08-26 truth pass): BUILDING — P3, P4, P7, P8, P9 shipped; P1 packaged
> awaiting counsel; P5 blocked on P1; P6 unstarted.** The "PLANNING ONLY" line that stood here was
> written on 2026-08-22 and was never updated as steps landed: P3 and P4 went DONE on 2026-08-23
> (`apps/api/src/services/applicationPdf/packet/packetStatic.ts`, `packetText.ts`, and
> `packages/shared/src/packetPlacements.ts` exist), P7 shipped with migration 0236, P8 with no
> migration, and P9 with migration 0237 — each is marked DONE in its own section below. The
> original decision record stands unchanged: the fork was put to the owner on 2026-08-22 and they
> chose **(b)** — reproduce the fillable pages, attach the policy and agreement pages as static
> documents. That decision is recorded as **D-PKT1** and the inventory in §2 is what it is being
> executed against.

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
| 21 | Seven Day Work Statement | **NOT OURS** — moves to the hire (§2.4, owner 2026-08-23) | ❌ nothing — §3.2 |
| 22 | Urinalysis notification | **SIGN** | — |
| 23 | Annual/quarterly violation review | **NOT OURS** — §2.4 | — |
| 24 | Driver safety training | **NOT OURS** — §2.4, owner 2026-08-23 | — |
| 25 | Interstate Truck Driver's Handbook receipt | **SIGN** | — |
| 26 | §40.25(j) two-year pre-employment test question | **FILL + SIGN** | ✅ since P8 — §3.7 |
| 27 | Authorized passengers · off-duty authorization | **SIGN** | — |
| 28 | Alcohol and drug abuse policy | **SIGN** | — |
| 29–30 | Owner Operator & Leased Driver Agreement, parts 1–2 | **STATIC** | — |
| 31 | Owner Operator & Leased Driver Agreement, part 3 | **SIGN** | — |

**Totals: 4 FILL · 18 SIGN · 4 STATIC · 5 NOT OURS.** (p21 and p24 both moved out of the application
on 2026-08-23 — p21 to the hire, p24 to training.)
⚠ All 4 FILL render as of 2026-08-23 — p26 needed a contract field we turned out never to have (§3.7, P8).

### 2.3 ⚠ The signature count is the finding, not the page count

⚠ **CORRECTED 2026-08-23 by measurement (Q-PKT6): the driver signs or initials 21 times across
EIGHTEEN pages, and six further marks on the paper are not the driver's.** The paragraph below was
written from a reading of the pages; `packages/shared/src/packetPlacements.ts` is the measurement,
and `packetPlacements.test.ts` checks it against the workbook on every run. The total was right and
its composition was not — company countersignature lines were counted in, and page 26 was counted
out.

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

### 2.4 ⚠ Four pages are not the applicant's document, and one is half theirs

Three were found while classifying — each would have been reproduced by mistake under a naive "print
all 31 pages" reading of fork (a) — and two more were moved here by the owner on 2026-08-23, the
second of them **after it had already shipped as a static page** (Q-PKT5).

⚠ **One of the five came back out on 2026-09-14 (D-PKT12).** p17 is half the applicant's, and the
classification had read only its other half. **That is the second page in this plan classified by one
of its halves**, after p24 — and the lesson §2.2 drew from p24 (*"no test in this repository can check
a classification"*) is now measurably wrong in one specific way, which §2.5 records.

- **p14 — previous-employer verification request.** This is the form the carrier **sends to a former
  employer**, with `Sent to`, `Requested by Silvicom Inc`, and the §391.23 / Part 40 questions the
  employer answers. We already own this act: `employer_inquiries` (0223) and `EmployerInquirySection`.
  It belongs to that surface, and putting it in the applicant's packet would produce a blank form in
  a signed document.
- **p17 — ⚠ NOT EXCLUDED. RECLASSIFIED 2026-09-14 (D-PKT12) as the packet's first SPLIT page.**
  The description below was written from the page's bottom half and was true of it: `INTERVIEW NOTES`,
  `APPLICATION RESULTS`, `Contracted or Rejected?`, `Interviewer`, `Date to start`,
  `Termination date`, `Why?` — carrier-filled, after the application, by somebody else. **That half
  stays out.**
  ⚠ **Its TOP half is the applicant's, and excluding the page dropped it.** Workbook lines 3–19:
  *"CAREFULLY READ THE FOLLOWING AND SIGN BELOW — By signing this statement, I certify that this
  application has been completed by me, and all of the entries provided are true, and accurate… I
  also authorize this company to make such in[quiries] to my employment history. financial, personal,
  or medical history as might be needed to make a decision"*, plus the contractor, tax and fuel-card
  acknowledgements, over `Signature of applicant | Date`. That is the certification the whole packet
  exists to carry, and an authorization with FCRA reach.
  **So the page is reproduced from line 3 to line 19 and stops.** The split is at the `INTERVIEW
  NOTES` heading, which is a line in the workbook and therefore checkable.
- **p21 — Seven Day Work Statement. ⚠ MOVED HERE 2026-08-23 by the owner** (Q-PKT2), and it is the
  one page that left the application rather than never having belonged to it. §395.8(j)(2) asks for
  the seven days preceding the day the driver **begins work**, so an answer given during an
  application is stale before anybody reads it — a driver hired three weeks later has a statement
  about the wrong week. It belongs beside the hire date, which is where the window is already
  measured from (`HireDrawer`'s own hint: *"The three-year employment window is measured back from
  this date"*). Its own step is **P7**.
- **p23 — annual/quarterly violation review.** Two halves, both post-hire: the driver's §391.27
  certification of violations for the preceding twelve months, and the motor carrier's review of it.
  This is the **annual round**, which `RECRUITING-SYSTEM-PLAN.md` R7 owns. An applicant has no twelve
  months with this carrier to certify.
- **p24 — Driver Safety Training. ⚠ MOVED HERE 2026-08-23** (Q-PKT5 → D-PKT10), and it is the only
  page that had already **shipped** under the wrong classification. §2.2 called it STATIC and P3 filed
  it in the versioned policy pack, which is rendered **once per version, identical for everybody** —
  so its `DRIVER -PRINT`, `Driver signatrure | Date` and `Instructor's signatrure` were three
  signature lines drawn as inert labels inside a document nobody signs. The page affirms a training
  the signer has **completed** (`On this day, ____________, 20___, I have completed training of log
  preparation`) and creates a liability (`I am also aware and have been informend of all company
  fines which will be enforced`). An applicant cannot truthfully affirm training they have not had.
  It is R7 / `DRIVER-TRAINING-PLAN.md`'s page.
  ⚠ **The transcription was never wrong** — `packetStatic.test.ts` proved it verbatim against the
  workbook every time it ran. **The classification was wrong, and no test in this repository can
  check a classification.** That is the finding worth more than the page.

### 2.5 ⚠ The check that DOES catch a wrong classification, found 2026-09-14

p24's lesson was "no test in this repository can check a classification". True of the tests that
existed. **Not true in general**, and the method that found p17 is cheap enough to keep:

1. Rasterise each page of the carrier's PDF at 72dpi, where one pixel is one point.
2. Find its ruled lines as contiguous dark runs, and pair each with the label to its left.
3. Diff that measured inventory against `packetPlacements.ts`.

Any page carrying a signature or initial line that the constant does not claim comes out. On
2026-09-14 exactly one did: **p17**. Every other difference was a page excluded on purpose (14, 21,
23, 24), and each of those re-checked as correctly excluded.

⚠ **`packetPlacements.test.ts` already had an assertion for this — *"leaves no mark line on a rendered
page unclaimed"* — and it could not see p17, because a page excluded from the render is not a rendered
page.** A guard scoped to the output cannot catch an error in deciding what the output contains. That
is the general shape of the p24/p17 failure, and it is why the scan above runs against the CARRIER'S
paper rather than against ours.

---

---

## 3. Eight things that have to be decided or built before any page renders

### 3.1 The equipment grid is fixed rows, and ours is a free list

Packet p2 prints four fixed rows — `STRAIGHT TRUCK`, `TRACTOR — SEMI TRAILER`,
`TRACTOR — TWO TRAILERS`, `OTHER` — each with class, type (`VAN, TANK, FLAT, ETC`), from/to dates and
approximate total miles. `equipment_experience` is an unbounded list the driver adds rows to.

Both satisfy §391.21(b)(6). They do not print the same. `EQUIPMENT_CLASSES` has **six** values against
the packet's four, so the mapping is:

| Ours | Packet row |
|---|---|
| `straight_truck` | STRAIGHT TRUCK |
| `tractor_semi_trailer` | TRACTOR — SEMI TRAILER |
| `tractor_two_trailers` | TRACTOR — TWO TRAILERS |
| `tractor_tanker` · `bus` · `other` | OTHER |

⚠ **The fold is not information loss, and that is worth stating because it looks like it.** The
packet's own second column is `TYPE OF EQUIPMENT (VAN, TANK, FLAT, ETC)` — free text, which is exactly
where "tanker" or "bus" survives. A tanker prints as class OTHER, type "Tanker", and the reader learns
the same fact the driver entered. What IS lossy is multiplicity: two `tractor_semi_trailer` entries
with different date ranges have one printed row between them, and that is §3.4's continuation problem
rather than a mapping problem.

⚠ **This mapping is PRINT-SIDE ONLY and does not touch the wizard.** The design canvas's fourth
artboard redesigns the equipment *question*, which is input; nothing here changes what a driver is
asked or what is stored. The two can be built in either order without building anything twice — which
is the opposite of what an earlier draft of this section claimed, and the correction matters because
it is what unblocks P4.

⚠ **And it needs icons the barrel does not have.** `packages/ui/src/icons.ts` has no distinct
straight-truck, doubles, tanker or bus glyph. Adding them means editing `icons.ts` first (contract
§1.3) — never importing from `@hugeicons/core-free-icons` directly.

### 3.2 The Seven Day Work Statement asks for data we do not collect at all

p21 wants: driver name, address, CDL, **seven dates with hours worked on each**, the date and time
the driver was **last relieved from duty**, and two signatures. Nothing in
`driverApplicationSchema` or `questionnaireContract` collects any of it.

⚠ It is also the one page whose answer **expires**. §395.8(j)(2) asks for the seven days preceding
the day the driver begins work, so a statement filled in during an application is stale by the time
somebody is hired.

**ANSWERED 2026-08-23 by the owner — D-PKT7: it goes with the hire.** So this page leaves the
application entirely (§2.4) and becomes **P7**, beside the hire date, where the seven days it names
are the seven days the regulation means. ⚠ **P4 does not have to collect any of the data above**,
which is the second thing that unblocked it.

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

### 3.6 The letterhead is per-org, and the plumbing for it already exists

**D-PKT8.** Every packet page carries `SILVICOM INC / 1301 ARMITAGE AVE / MELROSE PARK IL 60160`, and
FuelGuard is multi-tenant, so a second carrier must never be handed a document with Silvicom's name on
it.

⚠ **Nothing has to be built for this.** `organizations.legal_address` shipped with **0229**, and
`ApplicationPdfInput.carrier` is already `{ name: string; address: string | null }` — the current
renderer takes both and the packet renderer inherits them. What the decision actually creates is a
**data** obligation, and it is the one already standing in `APPLICATION-SYSTEM-PLAN.md`'s open list:
one production `update organizations set legal_address = …` per carrier.

⚠ **`address` is nullable, so decide what a missing one prints.** The current renderer can fall back
to the name alone; a packet page cannot silently print a blank line where a legal address belongs.
P4 renders the name and, when the address is null, says so in the document rather than leaving white
space — a letterhead with a hole in it is worse than one that admits the field is unset, because only
the second is noticeable.

⚠ The **footer** is a different thing and is NOT per-org: `THIS IS NOT AN EMPLOYMENT APPLICATION` and
`FOR DEPARTMENT OF TRANSPORTATION VERIFICATION PURPOSE ONLY` are statements about what the document
is, not about who issued it. They are reproduced verbatim on every page.

### 3.7 ⚠ Page 26 asks a question we do not collect — the inventory was wrong

**Found while building P4, 2026-08-23.** §2.2 recorded p26's data as "✅ already asked". It is not.

The packet asks: *did you test positive or refuse a pre-employment drug or alcohol test for a job you
**applied for but did not obtain**, in the past two years?* What the wizard collects is two
**per-employer** booleans, `safety_sensitive` and `subject_to_fmcsr`, which are questions about a job
the driver **actually held**. `ApplyEmploymentFields.vue`'s own comment cites §40.25(j) beside them,
which is how the inventory got it wrong — the citation is right, the field is a different one, and
there is no field for p26's question anywhere in `driverApplicationSchema`.

⚠ **So p26 was not rendered by P4, and was not rendered blank either.** An unanswered mandatory
question inside a document somebody signs is the same defect as silently truncating a table (§3.4):
the page would look complete and would not be. **Closed by P8 (2026-08-23)** — one contract field, one
control, one page. The `null` case survives on purpose and renders as "not asked" rather than "no".

The transcription is kept in `packetText.ts` under `P26` with a note, because reviewing it twice
would be waste.

### 3.8 ⚠ The Owner-Operator Agreement is broken in ways spelling cannot fix

**Found while transcribing for P3, 2026-08-23.** Pages 29–30 are a contract the driver signs on page
31. Its text is not merely misspelled:

| The packet says | The problem |
|---|---|
| `shall not he appeasable` | "be appealable" — a mangled arbitration term |
| `each party shall appoint one arbitration` | "one arbitrator" |
| `select a natural arbitrator` | "neutral" — and the same sentence later says *neutral* |
| `If any one or more of the provisions contained in the Agreement but the Agreement will be enforceable to the extend applicable.` | ⚠ **a severability clause with its middle missing** — no spelling repair completes this sentence |
| `whether or not signed for)` | an unmatched bracket in the service-of-process clause |
| `has red and understood this contract` | "read" |

⚠ **So D-PKT9 was NOT applied to pages 29–30** — and since **D-PKT11 (2026-09-14)** it is not applied
to any page: every page now behaves the way these two already did. Correcting a contract is drafting one, and the gap
between *natural* and *neutral* arbitrator is the gap between two different agreements. The pages are
reproduced exactly as the carrier wrote them, the defects travel with them, and counsel resolves them
alongside P1's disclosure review. `packetStatic.test.ts` pins this in both directions: no correction
may be registered against those pages, and the two worst clauses are asserted to survive `correct()`
so a well-meaning tidy-up fails the build.

Pages 7 and 8 ARE spell-corrected — they are policy statements, not instruments.

⚠ **Page 24 was in that sentence until 2026-08-23, and it is the sentence that caught it.** "Policy
statements, not instruments" is exactly the test page 24 fails: it carries a driver signature, an
instructor signature and an affirmation of completed training. The rule was right and the page was
on the wrong side of it — see D-PKT10.

### 3.9 ⚠ The fourteen repairs D-PKT9 used to make, and why they are gone (2026-09-14)

**D-PKT11 reverses D-PKT9.** The register that held these and the `correct()` applier that applied
them are **deleted from the code**, not emptied — a register applied to nothing is something the
next reader has to work out is inert. They are recorded here instead, because "what did you change
on our form" must stay answerable after the constant is gone. The answer is now: *nothing.*

| page | the carrier writes | D-PKT9 used to print | now |
| --- | --- | --- | --- |
| 1 | `Previous Three years reisdency` | Previous three years residency | as written |
| 1 | `maritial status` | marital status | as written |
| 2 | `FORFEITTURES` | FORFEITURES | as written |
| 7 | `IMPOREPER` | IMPROPER | as written |
| 7 | `OVERWIGHT` | OVERWEIGHT | as written |
| 8 | `YOU WIL INSPECT` | YOU WILL INSPECT | as written |
| 8 | `SAME CONDTION` | SAME CONDITION | as written |
| 8 | `WHEN RECIVED` | WHEN RECEIVED | as written |
| 8 | `TEAR EXEPTED` | TEAR EXCEPTED | as written |
| 8 | `EQUIPMENT MANGER` | EQUIPMENT MANAGER | as written |
| 12 | `BACKFROUNG` | BACKGROUND | as written |
| 16 | `benfit` | benefit | as written |
| 16 | `This references should not be people` | These references… | as written |
| 26 | `administrated by an` | administered by an | as written |

All fourteen were verified on 2026-09-14 against the carrier's own two PDF exports: thirteen appear
in both, and `benfit` appears in the Excel print and is absent from the Numbers one **only because
Numbers ate its `fi`**. So every one of them is the carrier's text, not an artefact.

⚠ **The carve-out, which is not spelling.** The Numbers export drops `fi`/`ti`/`ffi` ligatures:
`quali ed applicants`, `disquali ed from`, `certi ed copy`, `noti ed dispatcher`, `remain on le`,
`Un ll`, `no ca on`. Measured the same day: **~65 distinct broken fragments in the Numbers export,
zero in the same document printed from Excel.** Those words are not in the carrier's document — they
are damage done on the way out — so transcribing them would put a defect INTO an instrument, which
is the opposite of what "as is" asks for.

**Therefore: `Application 11.pdf` (Excel print) is the TEXT authority. `APPLICATION.pdf` (Numbers) is
consulted for CONTENT only.** Pinned by *"never prints a word broken by the Numbers export's dropped
ligatures"*.

### 3.5 ⚠ Citations stay in print — task B does not reach this document

The packet cites regulations **on its own pages**: §383.21 on p2, §391.23(d)/(e) on p11, Part 40 and
§391.21(b)(10) on p15, Part 391 on p23. B (U8 / D-UI9) removed citations from **screens** and left
them in print for exactly this reason. Nothing in this plan strips a citation from a rendered page.

---

## 4. Decisions

| ID | Decision |
|---|---|
| **D-PKT1** | **Fork (b), chosen by the owner 2026-08-22.** Reproduce the pages that take applicant data or a signature; attach Rules & Regulations (7–8) and the Owner-Operator Agreement (29–30) as **static documents**. A page that is policy text *plus a signature* is NOT static — it is reproduced (§2.3). ⚠ **Amended 2026-08-23 by D-PKT10:** Driver Safety Training (24) was in that list and is not static at all. |
| **D-PKT2** | The three NOT-OURS pages (14, 17, 23) are never rendered into the applicant's PDF. Each already has, or will have, its own surface. |
| **D-PKT3** | The static attachments are **one filed artifact per version**, not per applicant. They are identical for everybody; rendering them per submission would put 5 unchanging pages into every stored document and make a wording change invisible. Version them the way `DISCLOSURES` are versioned. |
| **D-PKT4** | ⚠ **No packet wording is adopted verbatim without counsel.** §3.3 is the worked example, and it is not the only page with the problem — the packet is full of typographical corruption ("BACKFROUNG", "maritial", "whcihc", "typyes"), which is harmless in a scan and is *not* harmless in a document we generate and a person signs. Transcription is a review pass, not a copy. |
| **D-PKT6** | **Twenty-one placements, one adopted mark, DocuSign-style** (owner, 2026-08-22). The driver types their name once and their initials once, then a Next button walks them to each place a mark is needed. ⚠ The FCRA authorization (p20) stays a screen of its own regardless — §604(b)(2), and it is the rule `SigningCeremony` was built around. ⚠ This is an extension of `useSigningCeremony`, not a replacement: see §2.3. |
| **D-PKT9** | ~~The packet's typos are corrected in print (owner, 2026-08-23).~~ ⚠ **SUPERSEDED 2026-09-14 by D-PKT11 — do not re-apply.** The register and its applier are deleted, not emptied. Kept here because the reasoning it was narrowed by (spelling of WORDS only; never the Owner-Operator Agreement, because correcting a contract is drafting one) is the reasoning D-PKT11 generalises. |
| **D-PKT7** | **The Seven Day Work Statement belongs to the HIRE, not the application** (owner, 2026-08-23). §395.8(j)(2) counts the seven days before work begins, so an application-time answer is stale on arrival. It leaves the packet PDF and becomes P7. |
| **D-PKT8** | **The letterhead is per-org** (owner, 2026-08-23). ⚠ Already supported: `organizations.legal_address` shipped with 0229 and `ApplicationPdfInput.carrier` is already `{ name, address }` — the existing renderer takes both. This decision costs a data question, not a code one (§3.6). |
| **D-PKT10** | **Page 24 is not a static page and is not the applicant's document** (Q-PKT5, 2026-08-23). Driver Safety Training is a post-hire training record carrying a driver signature, an instructor signature and a fill-in date. It leaves the packet the way p21 did under D-PKT7 and p23 never entered, and R7 owns it. ⚠ **It had already shipped** in P3's pack; the removal is a correction, not a scope change. The static pack goes 5 pages → 4 (128 transcribed lines → 101) and `CORRECTIONS` loses six entries. ⚠ `packetStatic.test.ts` now asserts the page's **absence** and names the three marks that gave it away, because the page LOOKS static and the mistake is re-makeable. |
| **D-PKT11** | **The carrier's text prints exactly as written — typos included** (owner, 2026-09-14). Reverses D-PKT9. The owner's words, holding the carrier's own PDFs: *"use texts that we have on applications I have provided as is — these are created by lawyers and we will keep texts from this."* The packet is counsel's work product; a spelling that reads as wrong to an engineer may be the word that was negotiated, and the form a driver signs should be the form the carrier's lawyers wrote. The fourteen strings D-PKT9 repaired are listed in §3.9 so the history stays auditable after the code that held them is gone. ⚠ **One carve-out, and it is not spelling:** the carrier's Numbers export drops `fi`/`ti`/`ffi` ligatures (`quali ed`, `certi ed`, `remain on le`, `no ca on`) — measured 2026-09-14 as ~65 broken fragments in that export and **zero** in the same document printed from Excel. Those words are not in the carrier's document; reproducing them would put a defect INTO an instrument. The Excel print is the text authority; the Numbers export is consulted for content only. |
| **D-PKT12** | **Page 17 is a SPLIT page: its top half is the applicant's, its bottom half the carrier's** (owner, 2026-09-14). §2.4 had excluded the whole page as the "interview / disposition record", which describes only `INTERVIEW NOTES` / `APPLICATION RESULTS` below the fold. Above it sits the applicant's certification that the application is true and complete and an authorization to inquire into employment, financial, personal and medical history, over `Signature of applicant | Date`. The packet reproduces workbook lines 3–19 and stops at the `INTERVIEW NOTES` heading. ⚠ **The driver's mark count moves 21 → 22, across 19 pages not 18**, and `driverPlacements()` — the ceremony's queue — gains a stop. ⚠ **Second page classified by one of its halves, after p24 (D-PKT10).** Found by the §2.5 scan, not by a test; the existing "no unclaimed mark line" assertion could not see it, because an excluded page is not a rendered page. |
| **D-PKT5** | The current §391.21-shaped PDF is **not deleted** when the packet PDF ships. It is what `qualification_records` points at today, it is regulation-correct, and an already-filed document must keep rendering. The packet becomes the document produced for NEW submissions. |

---

## 5. Steps

⚠ **P1 and P2 are blocked on people, not on code.** Everything after them is buildable.

### P1 · Counsel settles the wording — no code · **PACKAGED 2026-08-23, awaiting counsel**

⚠ **The scope written here was wrong in both directions and is corrected below.** It said "the five
`v0-draft` disclosures **and** packet pages 4, 18, 19, 20, 22". It is **eight instruments and
eighteen packet pages**:

- **Eight, not five.** The count predates the ESIGN consent (A4, `ESIGN_CONSENT`), the SMS consent
  (A11b, `SMS_CONSENT`) and the §40.25 letter (`EMPLOYER_INQUIRIES.drug_alcohol`). Each shipped
  `v0-draft` for the same reason and each is blocked by the same predicate — `grep '"v0-draft"'`
  over `packages/shared/src` returns eight.
- **Eighteen pages, not five.** D-PKT4 puts *all* adopted wording with counsel, and eighteen of the
  31 pages are static text under a signature. The five named were the ones with defects already
  found; the other thirteen were unreviewed, not clean.

**The review itself is written: `COUNSEL-REVIEW-PACKAGE.md` (2026-08-23).** It reproduces all eight
instruments verbatim, names the defect in each of pages 4, 18, 19, 20 and 22 with the sentence it
lives in, asks four questions that are not about wording (§4 there — the missing FCRA adverse-action
process, the §40.25(j) obligation nothing acts on, the employment-vs-contract contradiction, and
§391.23(i)), and states what has to come back.

**Done when:** every instrument has reviewed text and a real version string, and
`isDraftDisclosure()` stops refusing. ⚠ **Order of value if the review is staged: A6 (the ESIGN
consent) first** — it gates every other write path, including the other seven.

### P2 · The owner answers §6 — no code

~~Q-PKT1~~ **answered 2026-08-22 → D-PKT6.** ~~Q-PKT2~~ and ~~Q-PKT3~~ **answered 2026-08-23 →
D-PKT7 and D-PKT8; ~~Q-PKT4~~ **answered 2026-08-23 → D-PKT9, reversed 2026-09-14 → D-PKT11.** **Every §6 question is now answered.**
What remains blocking is P1 (counsel), which gates P5 and nothing else.

### P3 · The static attachments (D-PKT3) — DONE 2026-08-23 (no migrations)

Pages 7–8, 24, 29–30 as one versioned PDF artifact, filed once per version and referenced by every
application. **Done when:** a submitted application's document set includes the policy pack, and
changing its wording produces a new version rather than editing the filed one.

**What shipped.** `packetStatic.ts` and `renderStatic.ts`, which draws them as one document carrying
a caller-supplied `version`. ⚠ **It shipped as five pages / 128 lines and is four pages / 101 lines**
— page 24 was reclassified out on 2026-08-23 (D-PKT10) before anything referenced the pack. ⚠ The version is an INPUT, not a hash of the file: a
hash changes when a comment moves, and what must change is the version when the **carrier's words**
change — only a person can say that.

⚠ **The text was EXTRACTED, not retyped, and a test proves it.** The owner chose to transcribe now
rather than wait for a supplied PDF (2026-08-23), and the one weakness of that choice is that counsel
would then be reviewing an engineer's typing rather than the carrier's document.
`packetStatic.test.ts` closes it: it re-reads `APPLICATION.xlsx` **at test time** — a zip of XML,
opened with `zlib.inflateRawSync` and no dependency — and fails if any transcribed line is not in the
workbook. Verified to fail: corrupting one line produces `p8: FUEL POLICY (edited)`. A second
assertion pins the line COUNT at 128, because a transcription that quietly dropped a clause would
otherwise still pass — everything remaining would still be found in the source.

⚠ **The agreement pages are reproduced verbatim** and their defects are counsel's — see §3.8.

**Verified by:** `pnpm test` (all unit suites + 19 PGlite matrices; 7 new assertions) ·
`pnpm typecheck` · `pnpm lint` (zero in the tracked tree) · `lint:filesize` · `lint:funcsize` ·
`lint:comment-claims` · `lint:boundaries` · `lint:tests` — all green. No migration.

⚠ **Nothing references the pack yet.** Filing it against a submission is P6's cutover, which waits on
P5 and therefore on counsel.

### P4 · The fillable pages — DONE 2026-08-23 (no migrations)

Pages 1, 2, 12, 16 rendered from data we already hold, in the packet's layout, with the **per-org**
letterhead (D-PKT8) and the verbatim footer. §3.1's equipment mapping is settled (six classes onto
four rows, the type column carrying the difference) and §3.4's continuation convention is decided here
and applied to all five fixed-height tables.

**Done when:** a submitted application renders those pages with the applicant's own answers, and a
test pins the content so a renderer change cannot silently alter a signed document.

**What shipped.** `packet/` — `packetText.ts` (every transcribed word plus the `CORRECTIONS`
register), `packetDraw.ts` (the primitives `pdfDraw` has no reason to own: a letterhead block, the two
verbatim footer lines carrying the CARRIER'S page number, and a fixed-height table), and
`packetPages.ts` (one function per page, split at the page because a page is what a reviewer holding
the paper checks). Pages **1, 2, 12, 16** — ⚠ **not 26**, see §3.7.

⚠ **A test caught a silent truncation in the very function written to prevent silent truncation.**
The first `fixedTable` sliced the first three rows and then overwrote the third with the "see
continuation" marker — so row three vanished from the document entirely while rows four onward
appeared in the continuation. It looked complete and was not, which is exactly the failure §3.4
describes. Caught by "prints every row, not the first three"; the marker now takes the last line and
the continuation starts with the row it displaced.

⚠ **A test also caught two bad entries in the CORRECTIONS register**, which is why the register is a
tested constant rather than a habit. One "correction" was pure whitespace trimming — the assertion
that no packet string reaches the page failed, because the trimmed form is what we print. The other
pluralised `VIOLATION` → `VIOLATIONS`, a wording change wearing a spelling change's clothes. Both were
removed and D-PKT9 was narrowed to say so. (D-PKT9 itself was reversed by D-PKT11.)

⚠ **Not verified against the carrier's paper.** The tests prove the pages carry the right data, the
right letterhead and no corrupt strings; only somebody holding the printed packet can say whether the
layout reads as the same form.

**Verified by:** `pnpm test` (all unit suites + 19 PGlite matrices; 14 new assertions) ·
`pnpm typecheck` · `pnpm lint` (zero in the tracked tree) · `lint:filesize` (the renderer crossed 500
lines and was split into three modules rather than waived) · `lint:funcsize` · `lint:boundaries` ·
`lint:comment-claims` · `lint:tests` — all green. No migration.

### P5 · The signature pages

The 18 SIGN pages and the 21 placements on them, as three extensions of `useSigningCeremony` (§2.3):
a placement queue, initials as a second adopted mark, and the drawn mark re-applied per placement.

⚠ **Q-PKT6 is DONE and P5 no longer has to derive anything.** `packages/shared/src/packetPlacements.ts`
is the measured inventory — 28 placements, each labelled `driver` / `carrier` / `witness`, each
anchored to the workbook line it sits on and pinned by a test that re-reads the file.
`driverPlacements()` IS the queue: 21 stops, in the packet's own page order, and
`adoptedMarkKinds()` says there are exactly two marks to adopt. What is left for P5 is the
interaction, not the arithmetic.
**Blocked on P1 only** — D-PKT6 settled the interaction, but building 21 placements against `v0-draft`
wording would mean building them twice, and `isDraftDisclosure()` refuses the signature anyway.

**Done when:** a driver adopts one signature and one set of initials, is walked to all 21 placements
by a Next button, and the FCRA authorization is still the only thing on its own screen when they
reach it.

### P8 · Page 26's question, which we never asked — DONE 2026-08-23 (no migrations)

**Done when:** the wizard asks §40.25(j)'s two-year question and p26 renders with the answer on it.

**What shipped.** `prior_failed_pre_employment_test` on `driverApplicationSchema`, a home for it in
`APPLICATION_SECTION_KEYS.safety`, a control at the foot of the driving-record screen, and packet
page 26.

⚠ **Nullish in the contract, and that is the load-bearing decision.** Every application filed before
today has no answer, and `driver_applications` is append-only — those payloads can never be
back-filled. A required boolean would make every historical row fail to re-parse, which is exactly the
§390.32(d) reproducibility failure the renderer exists to prevent. So `null` means **"the form never
asked"**, which is a different fact from "they said no", and page 26 renders it as a different thing:
neither box marked, plus a line saying the application predates the question. A document showing an
unticked NO for a question nobody was asked would be asserting something the applicant never said.
Pinned by "marks NEITHER box on an application filed before the question existed, and says why".

⚠ **On the driving-record screen, not a screen of its own.** The carrier's packet gives it a whole
page; an eighth wizard step for one checkbox is a step somebody abandons on, and
`RECRUITING-UI-SURFACE-PLAN` §2.8 defends the current seven as the regulation's shape and no more.

⚠ **The copy names no regulation** (D-UI9) and states what a yes MEANS before the box is offered:
*"a yes does not end your application. It means we have to see the paperwork showing you finished the
return-to-duty process before you can drive."* This is the most resented question on the form, and a
driver who reads "yes ends this" answers no.

⚠ **Recording the answer was the first half only** — **the second half shipped 2026-08-23 as P9.**

**Verified by:** `pnpm test` (all unit suites + 19 PGlite matrices; 3 new assertions) ·
`pnpm typecheck` · `pnpm lint` (zero in the tracked tree) · `lint:ui-adoption` ·
`pnpm --filter web lint:tokens` · `lint:filesize` · `lint:funcsize` · `lint:comment-claims` ·
`lint:boundaries` · `lint:tests` — all green. No migration: the payload is jsonb.

### P9 · A `yes` on page 26's question stops the driver being dispatched — DONE 2026-08-23 (migration 0237)

P8 collected §40.25(j)'s answer and nothing acted on it. §40.25(j) does not stop at asking: an
admission forbids the carrier to **use the driver for a safety-sensitive function** until they
document completion of the return-to-duty process (§40.305). Recording the admission and doing
nothing is arguably worse than never asking, because the file now proves the carrier knew.

**Done when:** an applicant who answered yes can be hired and cannot be put on a load, and the
paperwork that lifts the block is a filed record rather than somebody's memory.

**What shipped.** Migration **0237**, `packages/shared/src/returnToDuty.ts` (the predicate and the
copy), `apps/api/src/services/returnToDuty.ts` (the read), the gate in
`dispatchLoads/mutations.ts`, the warning in `previewHire`/`HireDrawer`, and a callout on the driver
page.

⚠ **The gate is at the ASSIGNMENT, not the hire, and that is the whole design decision.** The
regulation bars performing a safety-sensitive function; it does not bar employment. A carrier may
lawfully hire somebody mid-process and give them an office job. A gate on `hire_applicant` would have
been stricter than the rule **and** would have left the thing the rule actually forbids — putting them
behind the wheel — wide open.

⚠ **Three call sites, not one.** `assignLoad` is the obvious door and it is not the only one:
`createLoad` takes a `driver_id` on the new load and `updateLoad` takes one in its patch, which is
the request the board already sends. A gate on the action named "assign" would have been walked
around by a PATCH. `returnToDutyGate.test.ts` asserts all three, because the one that gets forgotten
is the one that ships.

⚠ **The obligation is projected by a TRIGGER, not by the API.** There is exactly one way a
`driver_applications` row comes into existence and a trigger cannot forget; a service that remembered
today is a service somebody adds a second write path around. Only a literal `true` counts — `null`
means the form never asked, which is a different fact from "they said no" and is why the contract
field is nullish.

⚠ **Set-only.** A driver who applies twice and answers no the second time has not unsigned the first
statement. §40.25(j)'s obligation attaches to the admission; only the documentation discharges it.

⚠ **The discharge is evidence, not a second boolean.** A `return_to_duty` qualification record with
the SAP's paperwork attached. "The obligation is discharged" and "here is the document that
discharges it" are the same fact, and storing it twice is how they come to disagree.

⚠ **It is a §382.401(a) TESTING record — the recruiter cannot read it.** The same call 0211 made for
the Clearinghouse kinds and the opposite of the one 0217 made for `psp_report`. The asymmetry is
deliberate and is pinned: the recruiter is **told** the driver is blocked (the flag is a column on
`drivers`) and cannot open the document that says why.

⚠ **`merge_driver` needed no change, and that is proved rather than assumed.** 0234's standing lesson
says check on the day. Checked: the flag can only be set by an insert into `driver_applications`, and
MD010 already refuses to merge any source driver holding one. The matrix asserts the refusal.

⚠ **The matrix found a harness bug on the way in.** `tenantIsolation.mjs` read a column's allowed
value from the FIRST CHECK constraint mentioning it, so recreating the kind check reordered
`pg_constraint` and the seeder started seeding `psp_report` — the one kind 0219's conditional
constraint forbids without a `detail.source`. The schema was right and the reader was guessing. It
now takes candidates from the enumerating check and drops any another check excludes; every future
table with a conditional constraint on an enumerated column inherits that.

⚠ **The block shipped before the FILE knew about it, and that was a defect, not a deferral** —
corrected 2026-08-23 in the same day's follow-up. `return_to_duty` had no `DQ_KIND_LABELS` entry, so
it rendered as a raw slug in the history drawer and in the binder PDF an auditor reads; and no
`DQ_ITEMS` entry, so `RequirementDrawer` never offered it and **no screen could file the one document
that lifts the block**. A gate with no way to lift it is worse than no gate.

Fixed by making it a CONDITIONAL catalogue item — `appliesWhen: "return_to_duty"`, beside the
`no_cdl` precedent — so it appears in the file only for a driver who owes it. ⚠ Listing it
unconditionally would have told every clean carrier that every driver's file is missing
return-to-duty paperwork, which is D-PSP1's "reporting a lawful file as incomplete" failure. The two
filters that could drift (`buildDqFile` and `dqCapturableSpecs`) now share one `applies()`;
`hiringGapsAfterHire` excludes conditional items outright because from (records held, records
planned) it cannot evaluate a condition about the DRIVER. The flag is threaded through all three
`buildDqFile` callers — the driver page, the fleet overview and the binder — so none of them can
disagree about whether the requirement exists. Access is unchanged and was verified rather than
assumed: `safety_manager` holds `fleet: "manage"` and passes `canReadRestrictedKind`, so the two
roles that may read the document are exactly the two that may file it.

⚠ **A coverage guard came with it:** `every qualification-record kind has a name` walks
`QUALIFICATION_RECORD_KINDS` against `DQ_KIND_LABELS`. Nothing failed when the label was missing —
the kind simply printed as its slug — which is how it shipped, and is now impossible.

⚠ **What is still owed:** counsel's open question about page 26's third state (Q-C2b in
`COUNSEL-REVIEW-PACKAGE.md` §4.2).

**Verified by:** `pnpm test` (all unit suites + **21** PGlite matrices — `return-to-duty` is new, 21
assertions) · `pnpm typecheck` · `pnpm lint` (zero in the tracked tree) · `lint:migrations` ·
`lint:rls` · `lint:upserts` · `lint:filesize` · `lint:funcsize` · `lint:boundaries` ·
`lint:comment-claims` · `lint:tests` · `lint:ui-adoption` · `pnpm --filter web lint:tokens` — all green.

⚠ **Not verified in a browser** (the standing vite crash). Worth an eye during U7.

### P7 · The Seven Day Work Statement, at the hire (D-PKT7) — DONE 2026-08-23 (migration 0236)

**Done when:** hiring a driver captures their seven-day statement, and the driver's file holds it as a
dated record.

**What shipped.** Migration **0236** (`seven_day_statements`), `packages/shared/src/sevenDayStatement.ts`
(contract + the window arithmetic), `routes/roster/sevenDay.ts`, and a section under the driver page's
**Employment** tab — not a seventh tab, because U6 already flagged six as possibly one too many.

**The evidence line, declared** (§4's requirement): **immutable on UPDATE, prunable on DELETE.**
- The driver signs it, so the content can never be rewritten — SD010, for everybody, service role
  included. A correction is a new statement and the list is newest-first.
- It is **deliberately NOT in `RETENTION_FORBIDDEN`**, unlike `drivers` or `driver_applications`.
  §395.8(k)(1) asks the carrier to keep a supporting document for **six months**; holding a record of
  somebody's working hours for ever, when the rule asks for six months, is over-retention of personal
  data dressed up as diligence. `dataRetention.ts` gets a rule at **400 days** — a year's audit margin
  over the statutory floor, and then it ages out.

⚠ **The matrix caught this migration reproducing the exact bug 0234 was written about.** The first
draft of the immutability trigger raised on EVERY update, so `merge_driver`'s reassignment of
`driver_id` was refused and a driver holding a statement could not be merged at all — the
`sms_consents` failure mode, one migration after it was documented. The trigger is a **column list**
now, on `employer_inquiries`' EI010 model: guard the CONTENT, leave `driver_id` free. The guard exists
to stop somebody rewriting what the driver signed; carrying the record to the surviving row of a merge
is not that.

⚠ **`merge_driver` learned about the table in the same migration**, rather than two years later. That
is 0234's standing lesson applied on the day the table was created, and the matrix asserts it — the
one assertion that would fail if a future table were added without doing the same.

⚠ **The window is derived, never typed.** The form asks for the statement date and computes the seven
days before it, because a form that let somebody enter eight dates by hand produces a lawful-looking
total measured over the wrong week — the one failure of this record nobody would notice. The API
re-checks it and answers `window_mismatch` naming the week it wanted; the tenant-isolation seeder in
`supabase/tests/lib/tenantIsolation.mjs` learned to satisfy a jsonb array-shape CHECK along the way,
which is a harness improvement every future fixed-shape table inherits.

⚠ **The office transcribes; it does not sign.** `signed_name` is the driver's own name as they wrote
it on the paper, and `recorded_by` is stamped server-side with whoever typed it in. A form that let an
office user sign on a driver's behalf would be manufacturing the evidence.

**Verified by:** `pnpm test` (all unit suites + **20** PGlite matrices — `seven-day-statements` is new,
14 assertions; `rls` went 401 → 403 as the new table joined tenant isolation) · `pnpm typecheck` ·
`pnpm lint` (zero in the tracked tree) · `lint:migrations` · `lint:rls` · `lint:upserts` ·
`lint:filesize` · `lint:funcsize` · `lint:boundaries` · `lint:comment-claims` · `lint:tests` ·
`lint:ui-adoption` · `pnpm --filter web lint:tokens` — all green.

⚠ **Not verified in a browser** (the standing vite crash), and the seven-hour-input form is the most
fiddly thing this plan has shipped. Worth an eye during U7.

### P6 · Cutover (D-PKT5)

New submissions produce the packet; existing filed documents keep rendering as they were.

---

## 6. Open questions — owner and counsel

1. ~~**Q-PKT1 — twenty signatures on a phone?**~~ **ANSWERED 2026-08-22 → D-PKT6:** all 21, each in
   its own place, with one adopted signature and one set of initials reused across them on the
   DocuSign model. ⚠ The legal half of the question survives the answer and is folded into D-PKT6:
   FCRA §604(b)(2) keeps p20 on a screen of its own.
2. ~~**Q-PKT2 — Seven Day Work Statement: application or hire?**~~ **ANSWERED 2026-08-23 → D-PKT7:
   the hire.** It leaves the packet PDF and becomes P7.
3. ~~**Q-PKT3 — whose letterhead?**~~ **ANSWERED 2026-08-23 → D-PKT8: per-org.** ⚠ Already plumbed —
   `legal_address` (0229) and `ApplicationPdfInput.carrier`. See §3.6. Original question: Every page carries `SILVICOM INC / 1301 ARMITAGE AVE / MELROSE PARK
   IL 60160`. FuelGuard is multi-tenant. Is the letterhead per-org configuration, or is this packet
   Silvicom's alone? ⚠ The QA org is **FuelGuard EFS QA**, so this is answerable today by asking what
   its packet should say.
4. ~~**Q-PKT4 — the typos.**~~ ⚠ **RE-ANSWERED 2026-09-14 → D-PKT11: NOT corrected — printed as the
   carrier wrote them.** The 2026-08-23 answer was D-PKT9: corrected, and every correction
   listed.** ⚠ Narrowed during execution to spelling of WORDS only — see D-PKT9. Original question: D-PKT4 says transcription is a review pass. Does the owner want the errors
   corrected, or the packet reproduced exactly as the carrier's paper reads?
5. ~~**Q-PKT5 — page 24 is classified STATIC and it is a signed post-hire training record.**~~
   **ANSWERED 2026-08-23 → D-PKT10: reclassified NOT OURS and moved to R7.** Shipped the same day it
   was raised; §2.4 carries the page and `packetStatic.test.ts` carries the pin. Original finding,
   raised while packaging P1: §2.2 calls it "policy or contract text with nothing to
   fill", and P3 shipped it into the versioned static pack on that basis — filed **once per version,
   identical for everybody**, so no applicant's mark can ever land on it. The page reads
   `On this day, ____________, 20___, I have completed training of log preparation`, carries
   `DRIVER -PRINT`, `Driver signatrure | Date` and `Instructor's signatrure`, and creates a
   liability (`I am also aware and have been informend of all company fines which will be
   enforced`). `packetStatic.ts` lines 126–128 reproduce those three marks as inert labels.
   **On this reading page 24 is an instrument, and a post-hire one** — an applicant cannot truthfully
   affirm training they have not had, which is the argument that moved pages 21 and 23 out.
   **Proposed: reclassify NOT OURS and move it to training (R7 / `DRIVER-TRAINING-PLAN.md`)**, the
   way D-PKT7 moved the Seven Day Work Statement to the hire. That drops the static pack to four
   pages and the corrections register by six entries. Owner's call — it amends D-PKT1's inventory.
6. ~~**Q-PKT6 — the 21 placements were never split into driver marks and carrier marks.**~~
   **ANSWERED 2026-08-23 by MEASUREMENT — `packages/shared/src/packetPlacements.ts`.**
   ⚠ **The number was right by coincidence and its composition was wrong.** Re-derived line by line
   against the workbook: **22 marks are the driver's, across NINETEEN pages, and six more are not** —
   four the carrier's countersignature and two a witness's. The plan's "21 across 17" counted company
   lines as the driver's AND predated page 26 being known to take a mark (§3.7); two errors of the
   same size in opposite directions, which is the most expensive kind of correct number because
   nothing about it looks wrong. `packetPlacements.test.ts` re-reads `APPLICATION.xlsx` and pins every
   anchor, the repeat counts (p19 has two identical driver lines, p31 three), and a one-directional
   sweep proving no mark line on a rendered page is unclaimed.
   ⚠ **A third party appears that the fork never contemplated:** p31's `Witness Name`, and p22's
   `Witness by`. Neither the applicant nor the carrier, so `party` has three values.
   ⚠ **p31 takes THREE marks from potentially two people** — `Driver name`, `Owner Operator Name`
   and `Witness Name`. Usually the first two are the same person; the packet does not assume it and
   nor does the inventory.
   Original finding, raised while packaging P1: §2.3's count found signature lines; it did not ask *whose*. At least these are
   the carrier's: p18 `Silvicom Inc Representative:`, p19 the same **twice**, p22
   `Company reprsentative's signature` and `Witness by`, and one of p31's three `Signature | Date`
   lines. A queue built from the raw count walks a driver to a line where the company signs.
   **P5 must re-derive the inventory with each placement labelled `driver` or `carrier`.**
   ⚠ **And it cannot be re-derived by searching for "signature":** the packet spells it `signatrure`
   on pages 22, 23 and 24, so a grep misses three pages — which is very likely how 21 was reached.

---

## 7. What this plan deliberately does not do

- **No migration is proposed for the PACKET.** Every FILL page maps to data that already exists.
  ⚠ P7 is the exception and it is no longer part of the packet: D-PKT7 moved the Seven Day Work
  Statement to the hire, where it will need a table of its own.
- **No change to `ApplyPage`'s seven screens.** The packet is an output format. The one place it
  reaches back into the form is §3.1's equipment grid, and the design canvas already owns that.
- **No deletion of the existing PDF** (D-PKT5).
- **No wording adopted from the packet without review** (D-PKT4), and none at all before P1.

---

## 8. Progress log

Dated lines, appended. ⚠ Not table rows: parallel PRs marking adjacent rows BUILT conflict every
time, and the conflict is always in the one column that says whether something shipped.

**2026-09-14 — owner rules on the ceremony's two open questions, and P5's server half ships.**

- **D-PKT13 — the driver adopts ONE mark, drawn or typed, and it is applied at every stop** (owner).
  His words: *"Driver can draw or type name once, but he needs to be directed to each spot and apply
  saved signature form beginning at each place where needed."* So the choice between typing and
  drawing is the DRIVER'S and is made once; what the ceremony then does at each of the twenty-two
  places is apply what they already gave, not ask again.
  ⚠ **This does not reverse D-APP8**, and the distinction is worth stating because it looks like it
  might. D-APP8 says the typed name is the signature of RECORD and the drawn mark is decoration that
  must never block a signature — a driver on a cracked screen who cannot draw must still be able to
  sign. That stays true: `application_packet_marks.signed_name` is the record on every row, and
  `signature_mark` (A8a's capture slot, already plumbed end to end) is what gets drawn onto the page
  when the driver chose to draw. What D-PKT13 adds is that the driver picks which one appears on the
  paper, and that the pick happens once.
  ⚠ **"Adopted once" is now a database fact rather than a UI promise.** `record_packet_mark` refuses
  (DR035) any mark whose name differs from the one the first stop on that link recorded — so a second
  tab, a replayed request or a rebuilt client cannot produce a packet carrying two different
  signatures on pages meant to carry one person's.
- **D-PKT14 — page 16's empty education and reference lines print a filler, not blank paper**
  (owner). Education and three references are collected and are deliberately optional
  (`questionnaireContract.ts` gives neither a `required` flag), so an applicant may leave them blank
  — Marija did. The owner's ruling is that they stay optional and the PRINT fills the lines:
  *"leave them optional but in print we should add something like N/A or something that will fill
  there so we dont have empty lines printed."*
  ⚠ **Not built yet, and deliberately.** The only code that draws page 16 is `packetPages.ts`'s
  `page16()`, inside the PDFKit renderer that §3's overlay architecture replaces and that has no
  production importer. Applying the filler there is work thrown away. It lands with the page fill
  (queue item 4), against the carrier's own page.
- **Order: the ceremony before the overlay** (owner), with the coordinates not yet in the tree.

**What shipped — P5's server half** (migration 0339, no web surface yet):

- `packetPlacements.ts` gains a stable `id` per placement (`p03`, `p11a`, `p19b`), plus
  `packetDriverMarkCount()`, `packetPlacementById()` and `driverPlacementIds()`.
  ⚠ **Written out rather than derived from array position.** The array has already gained an entry in
  the middle once (p17, D-PKT12) and will again if counsel rules on p19's duplicate; derived ids
  would silently re-point every signature filed before that merge at a different line of the
  carrier's paper.
  ⚠ **The id is the only thing telling p19's two driver stops apart** — they share page, party, mark,
  anchor AND sentence, because the carrier's page really does carry its heading and its signature
  line twice.
- `application_packet_marks` + `record_packet_mark` (0339). Append-only, keyed on the INVITATION
  rather than the driver (0337's reasoning: a rehire signs their own packet), carrying its own copy
  of the page, the anchor and the sentence so §390.32(d) reproduction does not depend on today's
  constant.
  ⚠ **No phase column.** The releases stamp `releases_completed_at`; this does not. "Complete" is a
  count against `driverPlacements().length`, passed in as `p_expected_count` — so counsel ruling on
  p19 moves one array rather than an array and a column that has to agree with it.
  ⚠ **The signing window is `approved_at` → `submitted_at`.** Six of the twenty-two stops certify
  that the answers are true, and D-AX11 split the signing precisely because *"a certification of
  answers the office has since corrected certifies something else."*
- `POST /api/public/application/:token/mark`, and the queue served on `GET /:token` as `packet`.
- ⚠ **The server refuses a stop that is not the driver's** (`p18c`, `p19ac`, `p19bc`, `p22c`, `p22w`,
  `p31w`). The transaction takes the page and the anchor as arguments and would file the carrier's
  countersignature under the applicant's name without complaint, so the refusal exists in
  `applicationPacketMarks.ts` or nowhere.

**Still open on P5:** the web ceremony — adoption, the walk, progress, resume. And the marks reach
no PDF until the overlay lands, because there are still no coordinates in the tree.

**2026-09-14 — `packetWording.ts` sent counsel to the wrong page, and its test agreed with it.**

Every page number in that file was one too low: the three published instruments recorded at 14/19/21
are on **15/20/22**, and so were nineteen spelling repairs, four typography repairs, seven
left-alone entries and three prose references. Thirty-three numbers. Measured with `pdftotext
-layout` over `Application 11.pdf`, reading the number printed in each page's own footer — which
equals the PDF page index on all 31 pages, so both readings agree and this was a transcription slip
rather than a disagreement about numbering. `packetPlacements.ts` was right throughout.

⚠ **The test asserted the constant against itself** (`expect(page).toBe(19)`) and passed for as long
as the constant was wrong. Replaced by a cross-check against `PACKET_PLACEMENTS`, which was measured
separately: a published instrument must sit on a page that inventory says carries a driver signature.
That catches 14 and 21, which carry none. ⚠ **It does not catch 19, which carries two** — the check
that would reads the footers out of the carrier's PDF and needs that PDF in the repository. This is
§2.5 a third time, after p24 and p17: a guard scoped to our own files cannot check a fact about the
carrier's paper.

**2026-09-14 — P5's web half: the driver is walked to all twenty-two places.**

`PacketCeremony.vue` + `usePacketCeremony.ts`, inside a new `SignOffScreen.vue` that owns the whole
approved phase. Adoption is one screen — a segmented control for D-PKT13's choice, the typed name
always, the pad when the driver picks drawn — then one place per screen: the carrier's page number,
their own sentence for that place, the mark about to be applied, one button.

- ⚠ **The order of the approved screen is forced, and by two rules pulling the same way.** D-AX12
  puts the office's corrections above anything the driver affirms; `record_packet_mark` refuses a
  mark once `submitted_at` is set (0339). Corrections → the document → the packet → Send, and there
  is no "sign it afterwards" available even if somebody wanted one.
- ⚠ **Progress counts the PACKET, not the work left.** "Place 3 of 22" for a driver who signed two
  yesterday. Counting only what is outstanding would renumber the places under somebody watching the
  number, which is how a progress indicator stops being believed.
- ⚠ **Completion is the server's count, never the end of the client's array.** A place collected in
  another tab means the list this tab holds is not the document's.
- ⚠ **`ApplyPage.vue` hit 528 lines and was SPLIT, not waived** (`lint:filesize`). The seam is real:
  everything in `SignOffScreen` belongs to one phase of the link and is unreachable in any other.

**Two defects the browser found that no test could, and one that was not a defect:**

- ⚠ **`SignaturePad` carried its own copy, and it contradicted the screen.** Written for A5, where
  drawing is decoration, it says *"Draw it too, if you like"* / *"Optional."* — while the packet's
  adopt button stayed disabled until a drawing existed. **The control was fixed, not forked**: its
  `label` and `hint` are now props defaulting to A5's words. ⚠ Overriding the words does not make the
  pad required; whether a drawing is needed stays the caller's rule, and D-APP8 still says a PNG that
  will not upload may never block a signature.
- ⚠ **The first screenshot said "21 places".** Not a product defect — the screenshot script built its
  fixture from `packages/shared/dist`, which is produced only by `build:rn` for the React Native app
  and was four commits stale (no p17, no `id` field). The package's own `exports` points at
  `./src/index.ts`, which is what apps/web compiles against. **A fixture read from `dist` is a
  fixture from a different commit**; generate it with `tsx` from `src`.
- The `@/api` mocks must be raw JSON, and Playwright matches the LAST registered route — catch-alls
  go first. Both already recorded; both bit again.

### ⚠ Q-PKT7 — is the certification tick still the driver's second one? **OWNER / COUNSEL**

`CertifyFields` sits directly above the walk on the same screen: *"I certify that all entries on this
application are true and complete"*, plus a second "Your full name". The driver therefore types their
name twice in a row and certifies twice — because **packet pages 11, 13 and 17 are certifications of
the same fact, in the carrier's own words** (`p11b` *"That everything on this application is true"*,
`p13`, `p17` *"That this application is true, and that we may check your history"*).

Two sources of truth for one act is the shape the no-workarounds rule names. It is **not** resolved
here, and deliberately: removing a certification from a regulated filing path is not a UI tidy-up.

Candidates: **(a)** the walk replaces the tick, since the carrier's own pages carry the certification
— fewest acts, and the one the packet's own design implies; **(b)** the tick stays as OUR §391.21(b)(12)
record and the walk is the carrier's paper, with the duplicate name field removed at least;
**(c)** leave both. **Recommendation: (a)**, subject to counsel confirming the packet's own
certification language satisfies §391.21(b)(12).

⚠ **Related and also open: nothing in `submitApplication` counts marks.** The Send button is held in
the UI until every place is signed, and the SERVER would accept a submission with none of them — so a
packet can still be filed with blank signature lines by anything that is not this screen. Fixing that
is the same decision as Q-PKT7, because both change what a filing requires.

**2026-09-14 — Q-PKT7 ANSWERED. D-PKT15: the walk IS the certification.**

The owner ruled the duplication out: *"proceed with updates as recommended"*, against the
recommendation in Q-PKT7 — **(a)**, the walk replaces the tick.

`CertifyFields` is gone from the applicant's screen. It asked the driver to tick §391.21(b)(12) and
type their name, directly above a walk that asked for the name again and then took their signature
onto packet pages 11, 13 and 17 — each of which certifies the same fact in the carrier's own words.
Two acts, one obligation, and a driver typing their name twice in a row on one screen.

⚠ **`certified` and `signed_name` are still written into the filed payload, and must be.** They are
`driverApplicationSchema` fields on an append-only table: every application filed before today
carries them, and a payload that stopped doing so would stop re-parsing — the §390.32(d)
reproducibility failure the renderer exists to prevent. What changed is that the driver no longer
TYPES them. They are derived from the adopted mark.

⚠ **And the server checks rather than accepts.** `packetIsSignedThrough` refuses a submission that
does not carry a mark at every one of the twenty-two places, and refuses one whose `signed_name`
disagrees with the name `application_packet_marks` recorded. The name on the filed document and the
name on the pages are now the same fact, and the database is what says so.

- ⚠ **It asks for the SET of places, not a count.** The right number of marks made on the wrong
  places — a client walking one stop twice — passes a count and fails this. Proved by mutation.
- ⚠ **It lives in `applicationIntake.ts`, not in `applicationPacketMarks.ts`.** That module imports
  this one, and `applicationReleases.ts` states the rule its own split was made under: the ceremony
  knows about the session, the session knows nothing about the ceremony. "May this be filed" is the
  session's question.
- ⚠ **This closes the hole named in the same breath as Q-PKT7**: nothing in `submitApplication`
  counted marks, so a packet with blank signature lines was reachable by anything that was not the
  one screen holding the button — a replayed request, a second tab on an older bundle, curl.

⚠ **Still counsel's to confirm**, and recorded as such rather than treated as settled: whether the
packet's own certification language (pages 11, 13, 17) satisfies §391.21(b)(12) on its own. The owner
ruled on the DUPLICATION; the sufficiency of the carrier's wording is a legal question, and if the
answer is no, the tick comes back as OUR record beside the walk rather than above it.

**2026-09-14 — the coordinate system is resolved; the PLACEMENT MAP is not, and a heuristic will not do it.**

`packetTemplate.ts` now returns page coordinates (#786). Each page opens with exactly one
`0.75 0 0 -0.75 0 792 cm` and never touches the matrix again, so `pageX = 0.75·x`,
`pageY = 792 − 0.75·y`. Read off the stream, not assumed; the reader refuses to guess when a page
carries none, more than one, or any rotation. Proved by landmarks rather than arithmetic, because an
inverted flip still lands inside the page.

⚠ **The earlier note that "no single consistent axis explains" the document drew the wrong conclusion
from a correct reading.** The letterhead really is at raw 88 and `FOR DEPARTMENT OF TRANSPORTATION`
really is at raw 149 — **that line is printed TWICE on page 1**, as a sub-header and again in the
footer, so a search answered with whichever came first. The mistake was reaching for "the model is
wrong" when the data was unremarkable and the SEARCH was ambiguous.

### ⚠ What the pairing experiment established, and why it is NOT shipped

Pairing each placement with its ruled line looked derivable. It is not — measured, with pictures.

**The model, which is real and worth keeping.** For each placement: find the label run whose text
carries the anchor's signature word; take the horizontal rules within 30pt; `dy` is cleanly bimodal.

| style | `dy` | shape |
|---|---|---|
| **underline** | **−3.0** | the label sits above its own short rule; the signing line is the next segment to its right |
| **caption** | **+11.0** | the label sits below the rule; the rule above IS the signing line |

⚠ **Duplicates need an ORDINAL, not a search.** `p11a`/`p11b`, `p19a`/`p19b` and `p31a`/`p31b` all
resolve to the same rule if you take the first matching label. Sorting the matches down the page and
indexing by the placement's ordinal among same-anchor placements on that page separates them
correctly — p11a at y 204.8 and p11b at 113.4, and so on.

**And why it still cannot ship.** Applied to all 22 it produces implausible geometry on several:
`p04`, `p13`, `p31a` and `p31b` land on 21pt-wide segments, which is a date box and not a signature
line. Rendering the computed points onto the carrier's pages and rasterising them settles it:

- **p20 is exactly right** — the marker sits on the signature line after `Driver signature:` and stops
  before `Date:`.
- **p04 is wrong** — its signing line is the long full-width rule ABOVE the captions
  `Applicant's Signature` / `Date`, and the model classified the page as underline-style and put the
  marker **on the word "Date"**.

One right and one wrong out of two sampled is not a basis for placing twenty-two signatures on a
document somebody signs. ⚠ **This is §2.5 in a new form: a measurement that looks right.** The
heuristic is recorded here and deliberately not committed.

**What the next step actually is:** a per-placement coordinate table, each entry verified by drawing a
marker and LOOKING at the rasterised page — `pdftoppm -r 80` over a marked copy is the loop, and it
takes minutes per page, not seconds. The tooling for it all exists now: the template asset, the reader
in page coordinates, and `pdf-lib` to draw with. What does not exist is the table, and it should not
be generated by a rule.

⚠ **Until it does, `renderPacket.ts` still has no production importer and a filed application is still
our §391.21 summary rather than the carrier's form.**
