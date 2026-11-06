# Driver paper intake — scan the paper DQ files in bulk (2026-11-06)

**Status:** ruled 2026-11-06 (§5), building. PI1 built.

**The ask (owner, 2026-11-06):** *"add some bulk upload function for drivers, so we can scan and upload
multiple driver files. Because we only have this DQF printed on physical paper."*

## 1. Measured reality

- **183 of 183 Silvicom drivers have no scanned paper** (DQ-INTO-DRIVERS-PLAN §2, 2026-11-05). Their file
  states come from synced CDL/medical dates; since #2092 each such row reads "Date on file, no scan".
- **A paper DQ file is ~16 papers.** The driver catalogue (`dqCatalogue.ts`) has 2 certification items
  (CDL, medical card) and ~14 dated-record items (application, pre-employment MVR, previous-employer
  inquiry/response, road test, drug test, Clearinghouse full/limited, annual MVR review, registry
  verification, ELDT, PSP …). Estimate 15–40 pages per driver → **~3,000–7,000 pages** for the fleet.
- **Half of a bulk intake already exists** — built for trucks in UNIT-FILES-PLAN UF7 and stopped there:
  - `file_intake_items` (0505): the review queue — batch, source file, page range, proposed driver/unit,
    kind, dates, `status` pending/filed/discarded/duplicate, who decided, whether they changed anything.
  - `fileSubjectMatch.ts`: proposes the owner of a paper from what it prints (CDL number, unique full name,
    VIN, plate, unit number); more than one candidate → no proposal.
  - The `compliance_paper` reader profile (0508, `compliancePaperContract.ts`): one AI read per file lists
    the papers in it (page range, kind, title, issuer, driver name, licence number, dates). It reads no
    DOB, address, SSN, medical finding or drug result.
  - **Not built:** UF7b3 (upload + filing routes) and UF7c (review page). Nothing calls the reader yet.
- **What the reader and the doors refuse today, which a paper DQF needs:**
  - The reader's kind list describes vehicle papers plus CDL/medical card only.
  - The reader takes **≤ 10 pages and ≤ 25 MB per file** (`INTAKE_LIMITS`).
  - UF7's own rule: dated records are "never filed from intake" — that excludes ~14 of 16 DQ items.
  - `CEREMONY_OWNED_KINDS`: an **employment application** and a **road test** may only be written by the
    hiring e-sign flow. A driver hired years ago on paper therefore has **no way at all** to have those
    two filed, by hand or in bulk. The database does not refuse them (0376/0388 only index the ceremony's
    own `detail.source` values); only the contract's generic door does.
- **Tools already in the repo:** PDF rendering (`pdfjs-dist` + `@napi-rs/canvas`) and OCR in the API's
  document-reading module; `zxing-wasm` (QR/barcode) in the web app; the `SIL1:` tag grammar, whose
  comment already plans a "document / DQ binder cover" kind (`tagContract.ts`); `pdf-lib` for splitting.

## 2. Proposed solution

**Print a cover sheet per driver → scan the whole stack → the system splits it per driver and proposes
each paper → a person confirms → it is filed.** Nothing is filed without a person (D-UF8).

### 2.1 Cover sheets (the separator)
- Drivers page: select drivers (the DD2 checkboxes) → **"Print scan cover sheets"** → a PDF, one letter
  page per driver: name in large type, employee id, and a QR code naming that driver.
- The office puts each sheet on top of that driver's folder and feeds folders through the scanner one
  after another. A cover sheet is a hard boundary: the system never has to guess whose page is whose.
- Why not read names instead: an application, an MVR and a drug-test form all print the driver's name
  differently (or not at all on page 3 of an inquiry), and a wrong owner on a DQ paper is the worst
  failure this feature can have. Name/CDL matching stays as the fallback for a file with no cover sheet.

### 2.2 Upload
- Drivers page: **"Upload scanned files"** (roster: manage) → drop one or many PDFs.
- The server renders each page, finds cover-sheet QR codes, and cuts the file into one page range per
  driver. Blank pages (duplex backs) are dropped. Pages before the first cover sheet, or a file with
  none, go to the name/CDL matcher or to "Assign a driver" in review.
- Dropping a file on one driver's File cell (FileCell, DD1) scopes it to that driver, no sheet needed.

### 2.3 Reading
- Each driver's pages are read in chunks of ≤ 10 pages (the reader's limit stays). The reader names
  each paper (kind from the DQ catalogue, page range) and the dates printed on it (test date, review date,
  expiry). Drug and alcohol pages: kind and date only, never the result (unchanged rule).
- Cost, estimated: ~5,000 pages on Sonnet 5.5 ($2 / $10 per million tokens) is roughly **$50–150, one
  time**. The reader's monthly budget gate applies.

### 2.4 Review (one screen per batch)
- One row per proposed paper: page thumbnail (opens the viewer), driver, kind, date(s), and a note when
  the reader was unsure. Each row: **Confirm**, change any field, **Not a DQ paper**, **Discard**.
- Per driver, the file's missing items show beside the rows ("still missing: road test, annual review"),
  so the reviewer sees what the folder lacked, not only what it had.
- "File all confirmed" files the batch. Measured as it goes: how often review changed a proposal.

### 2.5 Filing
- Each paper becomes its own document (its pages split out), then:
  - CDL / medical card → a certification, through the existing supersede chain.
  - every other DQ item → a qualification record with `detail.source = "paper_intake"`, the reviewer
    named, the date confirmed, and the scan required (no record from intake without its document).
  - **application and road test of an already-hired driver** → filed the same way (Q-PI3 below); the
    hiring ceremony stays the only path for an applicant, so the hire gate is untouched.
  - a paper already filed for that driver (same SHA-256) → `duplicate`, nothing written.
- Restricted papers (drug/alcohol tests, Clearinghouse) are filed restricted, and only by a reviewer who
  may read them; for anyone else the row says it needs a testing-record reader.
- The same intake serves truck and trailer papers (UF7c) with no second build.

## 3. Decisions taken while building

**D-PI1 · The cover sheet's QR carries the driver's id (`SILDQF1:<uuid>`), not a `DRV` tag code.** The steps table first
said a `DRV` tag kind with a code table, as trucks have (`unit_tags`, 0531). A tag is a label that lives on
a truck for years and is read aloud when scuffed, so it needs a short permanent code; a cover sheet is a
separator printed for one scan. A full id on a letter page reads as easily, and a table keyed to
`drivers(id)` must join `merge_driver`'s list in the same migration or a merge destroys it silently
(memory `merge-driver-cascade-trap`, twice so far). No table, no migration, no list to forget; nothing in
the shop scans a driver. A sheet naming a driver a merge has folded away is reported as such and the
pages are assigned by hand. `parseTag` refuses the payload and the sheet parser refuses a tag
(`driverCoverSheet.test.ts`).

**D-PI2 · A stack is split before anything is read, and pieces are stored, not read, in PI2.** The plan had
PI2 queue the reads. The reader's prompt still describes vehicle papers until PI3; a piece read now would
be paid for and then read again. So PI2 stops at stored pieces (`paper_intake_parts`, a ≤ 10-page PDF each
in the `paper-intake` bucket) and PI3 hands each to the reader (`intakeStoredBytes`). The stack keeps its
own bucket: at up to 50 MB and hundreds of pages it is neither a reader source (25 MB, 10 pages) nor a
filed paper, and PI5 cuts filed papers out of the original stack, never out of a re-encoded piece.
A cover sheet naming a driver not on this roster still ENDS the previous driver's pages — they become
nobody's, never the previous driver's.

**D-PI3 · The review page ships read-only; correcting and filing are one step (PI5).** The plan put
confirm/correct/discard in PI4. A confirm that files nothing is a click with no consequence, and an edit
saved onto the row would overwrite the reader's proposal, losing D-UF8's measurement of how often a
person changed it. So a correction travels in the FILE request (PI5) and the row keeps what the reader
proposed. PI4 is useful on its own: an office can scan, upload and check what was found against the
pages before PI5 lands.

## 4. Steps (one PR each)

| Step | What | Migration |
| --- | --- | --- |
| PI1 | Driver cover sheets: "Print scan cover sheets" on Drivers; the QR names the driver's id (D-PI1); the server-side sheet finder | no (D-PI1) |
| PI2 | Upload + split: a stack is registered, PUT to Storage, split on the worker at its cover sheets, blank pages dropped, cut into ≤ 10-page pieces (D-PI2) | yes, 0572 (new tables, exempt from ordering) |
| PI3 | Reader learns the DQ papers (profile 1.1.0); each piece queued for reading at split; finished reads → `file_intake_items`, every page in exactly one row | yes, 0573 (an index) |
| PI4 | Drivers › Upload scanned files: drop PDFs, watch them split and read, see each proposed paper on the scan's page numbers with its pages one click away (read-only, D-PI3) | no |
| PI5 | Review actions and filing: correct driver/kind/dates, confirm, discard, "review without reading" for a stuck piece, "still missing" per driver; filing cuts the paper from the stack → document + certification or `paper_intake` record, application/road test for hired drivers, restricted handling, duplicates | possibly (a CHECK on `detail.source` for the two ceremony kinds) |
| PI6 | Office trial: 5 real folders end to end, measure pages/driver, read accuracy, review minutes; then the fleet | no |

## 5. What the office does (once built)

1. Drivers → select ~5–10 drivers → Print scan cover sheets.
2. Put each sheet on its driver's folder, remove staples, stack.
3. Scan the stack: **PDF, 300 dpi, grayscale, duplex, one file per stack** (keep a file under 25 MB:
   roughly 5–10 folders).
4. Drivers → Upload scanned files → drop the PDF(s).
5. Review and file (estimate 2–4 minutes per driver → ~6–12 office hours for 183 drivers).

## 6. Open questions — answered 2026-11-06

- **Q-PI1 — ANSWERED 2026-11-06:** a **Brother scanner with a document feeder that saves PDF** — option (a). Original question kept below.
- **Q-PI1 — What scanner does the office have?** It needs a document feeder (and ideally duplex) that
  saves to PDF. Candidates: (a) the office copier/MFP, if it scans to email/USB/folder; (b) buy a
  desktop feeder scanner (Brother ADS / Epson DS / Ricoh fi class, roughly $300–1,200).
  **Recommendation: (a) if it has a feeder; otherwise (b).** Phone photos work but not for 5,000 pages.
- **Q-PI2 — ANSWERED 2026-11-06: (a) cover sheets**, as recommended.
- **Q-PI2 — Cover sheets, or no separators?** (a) a printed QR cover sheet per driver; (b) one file per
  driver, named by the office; (c) one big stack, the AI decides whose page is whose.
  **Recommendation: (a)** — deterministic, and (b)'s file naming is the error-prone step it removes.
- **Q-PI3 — ANSWERED 2026-11-06: (a)**, as recommended: from intake only, marked "filed from paper scan", scan required, never for an applicant.
- **Q-PI3 — May a hired driver's paper application and road test certificate be filed from a scan?**
  Today nothing can file them (§1). (a) yes, from intake only, marked "filed from paper scan", the scan
  required, never for an applicant; (b) no, those two items stay "missing" for every legacy driver.
  **Recommendation: (a)** — the signed paper is the evidence §391.21/§391.31 ask for.
- **Q-PI4 — ANSWERED 2026-11-06:** the paper is kept "until we polish and ensure this as 100% reliable and precise and safe". Nothing in this plan destroys or asks to destroy an original.
- **Q-PI4 — Keep the paper after scanning?** Electronic DQ records are allowed (§390.32) if accurate and
  legible; whether to destroy originals is a policy/counsel call. **Recommendation:** keep the paper
  until the fleet is scanned and an audit has been passed on the electronic file.
- **Q-PI5 — ANSWERED 2026-11-06:** the **safety manager and the admin** review ("optional" — either may). Built as: review and filing are offered to whoever manages the roster section, which today is those two roles plus fleet manager; the restricted rule stands.
- **Q-PI5 — Who reviews?** **Recommendation:** the safety manager (roster: manage), with drug/alcohol and
  Clearinghouse pages filed only by someone holding the testing-record read.

## 7. Progress log

- 2026-11-06: proposal written from the code on `main` (e5d4642) and production facts above. Waiting on
  Q-PI1–Q-PI5.
- 2026-11-06: owner ruled Q-PI1–Q-PI5 (§6): Brother feeder scanner to PDF, cover sheets, legacy application
  and road test filed from scan, paper kept until the process is proven, safety manager and admin review.
- 2026-11-06: **PI1 built.** Drivers: "Print scan cover sheets" on the selection bar (same reader and cap as
  the binder, `roster: manage`, ≤ 25). `POST /api/compliance/cover-sheets` → one letter page per driver: name
  (Unicode), employee id, hire date, a 3½" ECC-H QR, instructions. `driverCoverSheet.ts` (shared) builds and
  parses the payload; `evidence/intake/findCoverSheets.ts` paints each page at 150 dpi and decodes it with
  `zxing-wasm` (added to the API, the web's pinned 3.1.4). Proved end to end, nothing stubbed: a stack of
  sheet, papers, sheet, paper is cut at pages 1 and 4 with the right drivers, and a sheet tilted 3°, blurred
  and saved as a 55 %-quality JPEG still reads. Deviation: D-PI1 (no tag table, no migration).
  ⚠ The sheet's step 4 names "Upload scanned files", which PI2–PI4 build; a stack scanned before then is
  only a PDF to keep and upload later.
- 2026-11-06: **PI2 built** (migration 0572). `paper_intake_stacks` (one per uploaded PDF; `unique (org_id,
  sha256)`, so a re-upload is a duplicate, except a failed or never-finished one, which is offered the upload
  again under its own id as its failure text promises) and `paper_intake_parts` (`driver_id` with no FK, D-PI1);
  bucket `paper-intake`, 50 MB, the project's per-file limit. Routes `POST /api/compliance/paper-intake/stacks`,
  `…/stacks/:id/complete`, `GET …/batches/:batchId`, all `roster: manage`, audited; job `paper_intake_split`
  (cap 1: a stack is held whole while it is cut). `planParts` (shared, pure) decides the pieces; `scanStack`
  paints each page once at 150 dpi for both questions, cover sheet and blank. Deviation: D-PI2 (no reads yet).
  Found on the way: **the blank-page threshold first written, 0.15 % dark pixels, would have dropped a lone
  signature, a page with one short line, and a one-line page** — measured on rendered pages it is 0.046 %,
  0.014 % and 0.12 %, against 0.0007 % for dust specks. It is 0.004 %, with the measurements in its comment and
  a test that keeps both the short line and the signature. Also: one of my own tests asserted "delete before
  insert" with `indexOf` and passed with the delete removed (−1 is less than anything); it now asserts the
  exact write sequence, and the mutation fails it.
- 2026-11-06: **PI3 built** (migration 0573). The `compliance_paper` profile is 1.1.0: its kind list names a paper
  DQ file's papers (application, MVR and annual review, road test and equivalency, employer inquiry and response,
  drug and alcohol tests, Clearinghouse queries, registry note, ELDT, PSP), `issuedOn` also carries the day a
  dated record happened, and the prompt forbids a test's RESULT as it already forbade DOB/SSN/medical findings.
  The split queues each piece (`intakeStoredBytes`, from the job handler, so evidence imports only the read-back:
  boundary edge `evidence -> document-reading`, IC10's shape). `paperIntakeItems.ts` turns each FINISHED read into
  review rows when the batch is asked for: a cover sheet's driver is the scope (basis `scope`); an unsheeted piece
  asks the matcher; dates are parsed in code (`printedDate.ts`, month first, two-digit years pivot at 50, an
  impossible day is null); **every page lands in exactly one row** — pages no paper covers become a row, a failed
  read becomes one row over the whole piece, an overlapping page stays with the first paper. 0573's unique index
  makes two tabs polling at once insert one set. For a record kind, `proposed_issued_on` is the day it happened —
  `file_intake_items` has no separate column, and adding one would take two merges (column, then reader).
  ⚠ **For PI4:** a piece whose reader intake is REFUSED (a page below the reader's minimum size) has no source,
  so `readOfBytes` answers `no_source` forever and the piece reads "still reading". PI4 offers "review without
  reading" for a piece pending past a few minutes, which writes the unread row by hand. Not built here.
- 2026-11-06: **PI4 built.** Drivers gains "Upload scanned files" (roster manage) → `/drivers/paper-intake?batch=`
  (surface `fleet.drivers.paper-intake`, `manage("roster")`). Drop PDFs: hash in the browser, register, PUT
  straight to Storage (`uploadToSignedUrl`; the register answer now carries `storagePath`/`token`), complete; a
  file over 50 MB is refused before anything is sent, a duplicate said as such. Each stack's line says what it
  became ("63 pages · 2 drivers · 21 blank pages left out · 2 pages with no cover sheet — Reading 4 of 6
  pieces…") or why it failed. The rows show driver and HOW it was named (cover sheet / licence number / name),
  the paper and its printed heading, the STACK's page numbers, the dates, and View, which opens the piece in
  the browser's PDF viewer at the row's first page. Polled every 4 s only while something is moving.
  `listBatch` moved to `paperIntakeBatch.ts` (read side). Deviation: D-PI3 (read-only until PI5).
  Found by the browser pass: the reading line counted pieces from the stack's list and the progress from the
  reader, which can disagree ("Reading 4 of 3"); it now counts both from the reading. The page test had pinned
  the wrong number ("2 of 2" with one still reading) and now expects "2 of 3".
- 2026-11-06: **PI5 built** (no migration). "Check and file" on each pending row opens a drawer on the reader's
  proposal — driver (the roster, applicants excluded by the shared list), paper (`PAPER_FILE_KINDS`, restricted
  kinds only for a role that may read them), its date(s) — with the driver's still-missing items beside it and
  View to compare. Filing (`paperIntakeFiling.ts`, `POST …/items/:id/file`): the paper's pages are cut from the
  ORIGINAL stack and filed on the driver (`fileGeneratedDocument`); then a certification (CDL, medical card,
  supersede chain) or a dated qualification record with `detail.source = "paper_intake"`, the intake row, stack
  and stack pages; or nothing more for an `other` paper. The row records `changed`. Every write takes the ROW's
  id, so a retried request files onto the same document/certification/record rather than a second copy. A paper
  already in that driver's file (same SHA-256) is marked `duplicate` and nothing is written. Refused, in words:
  a driver not on this roster; a dated paper with no date; an applicant's application or road test (Q-PI3: hired
  drivers only — their ceremonies own them); a restricted paper for a role that cannot read it (403); and the kinds
  with their own door (PSP report → Employment tab, whose CHECK requires `psp_api`/`portal_import` provenance;
  handbook, endorsement, hazmat training, return-to-duty → the qualification file). "Not a driver-file paper" sets
  a row aside, its reason kept in the audit row (the table has no reason column). Measured on the way: a mutation
  that dropped the DRIVER half of `changed` survived, because the only test that changed something also changed
  the kind and dates; a test now changes the driver alone. Not built, and why: "review without reading" for a
  piece whose intake was refused (a piece always comes from a 300 dpi scan re-saved unencrypted, so neither the
  reader's size nor its encryption refusal can occur; a 10-page piece over 25 MB would, and the stack's line would
  then keep saying "Reading…" — PI6 measures real piece sizes before that is worth a button).
