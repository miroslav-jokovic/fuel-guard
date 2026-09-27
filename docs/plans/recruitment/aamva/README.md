# AAMVA sources for the licence-barcode reader (AW5, C3b1)

`packages/shared/src/aamvaBarcode.ts` reads the PDF417 on the back of a US/Canadian licence. Its
element IDs, header layout and the one worked example are taken from these files, not from memory,
and `aamvaBarcode.test.ts` reads them to prove it.

| File | What | Source | Fetched |
|---|---|---|---|
| `annex-d-12-13.txt` | Annex D §D.12 (header, subfile designator, Tables D.3/D.4) and §D.13 (the example raw PDF417 data), extracted with `pdftotext -layout` | AAMVA DL/ID Card Design Standard (2020), <https://www.aamva.org/getmedia/99ac7057-0f4d-4461-b0a2-3a5532e1b35c/AAMVA-2020-DLID-Card-Design-Standard.pdf>, sha256 `4d85f8033a39c6d8f9339b7a94621dde5aff4f59e4b1983c0b573fb0d6f7eb4a`, pages 49–61 | 2026-09-27 |
| `iin.tsv` | The Issuer Identification Number table, as published (header row kept) | <https://www.aamva.org/identity/issuer-identification-numbers-(iin)> — the list the standard's §D.12.3 footnote 10 points to | 2026-09-27 |

The PDF itself is not committed (2.1 MB; `.git` is already large) — the hash above pins which one
was read.

## What is known and what is not

- **Only the 2020 edition (AAMVA version `10`) is published.** Versions `01`–`09` are named in
  §D.12.3's version field but their element tables are not on aamva.org. The parser therefore reads
  the §D.12 STRUCTURE (header, designators, `ID` + value lines) for any version and takes only the
  elements Table D.3/D.4 define. A pre-2009 barcode whose elements differ simply yields fewer fields —
  an unread field is not prefilled, which costs the driver nothing (§6.6.4).
- **Dates** are `MMDDCCYY` for the U.S. and `CCYYMMDD` for Canada (Table D.3). The parser does not
  trust `DCG` to choose: a `CCYYMMDD` date read as `MMDDCCYY` has a month of 19 or 20, and a
  `MMDDCCYY` date read as `CCYYMMDD` has a year before 1300, so at most one reading is a real date.
- **The IIN table has a typo at the source**: Colorado (636020) is listed with the abbreviation `GM`.
  The parser maps IIN → jurisdiction NAME from this table and derives the code from the product's own
  catalogue (`jurisdictions.ts`), so the typo is never read, and a name the catalogue does not hold
  (e.g. AAMVA's "Newfoundland" against the catalogue's "Newfoundland and Labrador") yields no state
  rather than a guessed one.
