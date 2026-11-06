# Driver paper intake — scan the paper DQ files in bulk (2026-11-06)

**Status:** proposal, waiting on the owner's rulings (§5). Nothing here is built.

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

## 3. Steps (one PR each)

| Step | What | Migration |
| --- | --- | --- |
| PI1 | Driver cover sheets: a `DRV` tag kind + resolver (as trucks got `VEH`), "Print scan cover sheets" on Drivers | yes (driver tag codes, as 0531 did for units) |
| PI2 | Intake API (UF7b3): upload, page render, cover-sheet split, blank-page drop, chunked reads → `file_intake_items` | no |
| PI3 | Reader learns the DQ papers: kinds, dates, the "never read the result" rule tested | profile version bump |
| PI4 | Review page (UF7c) for drivers and units: rows, viewer, "still missing", confirm/correct/discard | no |
| PI5 | Filing: documents per paper, certifications, `paper_intake` qualification records, application/road test for hired drivers, restricted handling, duplicates | possibly (a CHECK on `detail.source` for the two ceremony kinds) |
| PI6 | Office trial: 5 real folders end to end, measure pages/driver, read accuracy, review minutes; then the fleet | no |

## 4. What the office does (once built)

1. Drivers → select ~5–10 drivers → Print scan cover sheets.
2. Put each sheet on its driver's folder, remove staples, stack.
3. Scan the stack: **PDF, 300 dpi, grayscale, duplex, one file per stack** (keep a file under 25 MB:
   roughly 5–10 folders).
4. Drivers → Upload scanned files → drop the PDF(s).
5. Review and file (estimate 2–4 minutes per driver → ~6–12 office hours for 183 drivers).

## 5. Open questions — need the owner

- **Q-PI1 — What scanner does the office have?** It needs a document feeder (and ideally duplex) that
  saves to PDF. Candidates: (a) the office copier/MFP, if it scans to email/USB/folder; (b) buy a
  desktop feeder scanner (Brother ADS / Epson DS / Ricoh fi class, roughly $300–1,200).
  **Recommendation: (a) if it has a feeder; otherwise (b).** Phone photos work but not for 5,000 pages.
- **Q-PI2 — Cover sheets, or no separators?** (a) a printed QR cover sheet per driver; (b) one file per
  driver, named by the office; (c) one big stack, the AI decides whose page is whose.
  **Recommendation: (a)** — deterministic, and (b)'s file naming is the error-prone step it removes.
- **Q-PI3 — May a hired driver's paper application and road test certificate be filed from a scan?**
  Today nothing can file them (§1). (a) yes, from intake only, marked "filed from paper scan", the scan
  required, never for an applicant; (b) no, those two items stay "missing" for every legacy driver.
  **Recommendation: (a)** — the signed paper is the evidence §391.21/§391.31 ask for.
- **Q-PI4 — Keep the paper after scanning?** Electronic DQ records are allowed (§390.32) if accurate and
  legible; whether to destroy originals is a policy/counsel call. **Recommendation:** keep the paper
  until the fleet is scanned and an audit has been passed on the electronic file.
- **Q-PI5 — Who reviews?** **Recommendation:** the safety manager (roster: manage), with drug/alcohol and
  Clearinghouse pages filed only by someone holding the testing-record read.

## 6. Progress log

- 2026-11-06: proposal written from the code on `main` (e5d4642) and production facts above. Waiting on
  Q-PI1–Q-PI5.
