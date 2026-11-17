# Finance — toll expenses per truck, from the toll providers' own statements

**Status:** IN BUILD — TL1–TL3 and TL4a built; TL4b and TL5 wait on the sample files (§6 Q-TL1). **Owner:**
Miki. **Written:** 2026-11-16, from the owner's request that day and a read-only measurement of
production Supabase taken the same afternoon.

**What this unblocks.** [TRUCK-COST-ATTRIBUTION-PLAN](./TRUCK-COST-ATTRIBUTION-PLAN.md) §T4 parked tolls
on ruling R3: *which transponder service, and does it export per unit?* The owner answered on
2026-11-16. The fleet's toll accounts are **E-ZPass, K-TAG and ExpressToll**. None has an API, and each
sends a weekly report that lists every charge by transponder. **PrePass is not a toll account.** It is
weigh-station bypass and McLeod already carries it, so it gets no reader. This plan supplies the tolls
row of [TRUCK-DRIVER-PNL-PLAN](./TRUCK-DRIVER-PNL-PLAN.md) §1.2. That row reads "none collected, 0%"
for July's $71,653.31 tolls/scales/unloading family. After this plan, the toll part of that family is
measured per truck.

The owner's bar is the attribution plan's: *precise numbers — no assuming, no improvising.* So no toll
is ever spread by miles. Spreading by miles would charge the Ohio turnpike to a truck that ran Texas.

---

## 1. Measured 2026-11-16

### 1.1 What the books say tolls cost

Production `mcleod_gl_totals`, accounts `40790000 Tolls` and `40790002 Tolls OO`:

| Month | AP (invoices) | lines | DRS (driver deductions) | Tolls OO |
|---|---:|---:|---:|---:|
| 2026-01 | 45,499.97 | 25 | −255.88 | 187.36 |
| 2026-02 | 38,817.46 | 28 | 25.42 | 151.58 |
| 2026-03 | 39,508.49 | 25 | −287.95 | — |
| 2026-04 | 55,906.96 | 28 | 25.00 | 268.78 |
| 2026-05 | 112,094.94 | 30 | 111.78 | 98.80 |
| 2026-06 | 72,644.54 | 30 | −31.35 | 283.90 |
| 2026-07 | 62,615.96 | 56 | 184.40 | — |
| 2026-08 | — | — | −219.43 | — |

- **"July's tolls are $184.40" was a measurement error, not an accounting one.** HANDOFF-2026-09-03
  §6 reported that figure as an anomaly. It is the DRS line alone; the AP side was $62,615.96. No
  reclassification is needed.
- **August has no AP lines yet.** The month was still open at the last McLeod restore. This is the
  open month that McLeod's `gl_control` reports (TRUCK-DRIVER-PNL-PLAN D4). The reconciliation in TL6 treats an open month as
  open and does not report it as cheap.
- **The swept AP voucher table names no toll vendor.** We searched `mcleod_ap_vouchers` for every toll
  brand: no match among 1,901 vouchers and 62 vendors. Tolls reach the GL another way, probably by card
  or a bank journal. The only usable control is the GL account total by month. Vendor-level matching is
  not available, and this plan does not need it.
- **Tolls OO is $100–$280 a month.** So owner-operators almost entirely pay their own tolls (§6 Q-TL3).

### 1.2 What already exists, and was reused rather than rebuilt

| Need | Already in the repo | Gap found |
|---|---|---|
| Read `.xlsx` | `lib/reportGrid.ts` (ExcelJS, lazy) | — |
| Read real Excel 97-2003 `.xls` | `reportGrid.ts` → vendored SheetJS 0.20.3 (`vendor/sheetjs`, digest-pinned) | — |
| Read an HTML table saved as `.xls` | `reportGrid.ts` | — |
| Read `.csv` | `reportGrid.ts` (Papa), and the API's RFC-4180 tokenizer | — |
| Read `.ods` (Google Sheets, LibreOffice) | — | **an ODS is a zip and went to ExcelJS, which fails.** Fixed in TL3 |
| Read a PDF statement | `lib/pdfWords.ts` → words with positions, shared pure parser (`parsePilotStatement` is the model) | — |
| Decide the format | magic bytes, never the extension | — |
| EFS import `.xls` | `lib/readFile.ts` | **sent every `.xls` to ExcelJS.** Fixed in TL3 |

So "support PDF, CSV, XLSX and XLS" is mostly a matter of routing through what exists. One thing
genuinely new is needed: a reader per provider that turns those grids or words into toll lines.

---

## 2. Decisions

- **D-TL1 — A transponder has a dated history, not a column on `vehicles`.** A statement arrives a week
  or a month after the driving, and tags move between trucks (shop, spare, sale). A column holds only
  today's truck. It would charge last month's tolls to whoever holds the tag now. `vehicles` is also
  written by the Samsara and McLeod syncs. The Vehicles page still shows tags as a column. The column
  is read from the history. Migration 0622: `toll_transponders` and `toll_transponder_assignments`.
- **D-TL2 — Identity is provider + number; matching drops leading zeros.** We store what is printed on
  the tag (`normaliseTagNumber`). We match on `tollTagKey`, because a statement opened in Excel turns
  `00812345678` into `812345678`. A masked or mistyped number (`****5678`) is refused, not cleaned up.
- **D-TL3 — Which truck a toll belongs to is derived at read time and never stored on the toll line.** A
  wrong assignment is voided with a reason and re-entered. Every toll it touched then re-attributes
  without a re-stamping job (`attributeToll`).
- **D-TL4 — A toll near a tag swap is not guessed.** Statements print the plaza's local time with no
  time zone. Read in the org's zone, that time is right only to within two hours. A toll within three
  hours of a swap goes to review with both trucks named (`near_swap`, `SWAP_MARGIN_MS`).
- **D-TL5 — Every format goes through one decoder.** The browser reads the bytes with `readReportGrid`
  (CSV, XLSX, XLS, HTML-as-XLS, ODS) or `readPdfWords` (PDF). Then a pure reader in `@silvicom/shared`
  turns the grid or words into toll lines and the statement's printed totals. This is the
  Pilot-statement pattern.
- **D-TL6 — A statement must tie to its own printed total, or it is refused.** Each provider prints a
  total. If the lines read do not add up to it to the cent, the upload is refused and the difference is
  shown. This is the only check that catches a misread PDF column. The API re-runs the tie on the lines
  it receives, so a browser bug cannot slip past it.
- **D-TL7 — A scanned PDF is refused, not read by OCR.** A PDF with no text layer produces no words. The
  message asks for the provider's CSV or Excel download. Character recognition is not precise enough
  for money.
- **D-TL8 — Every line is kept, once.** The key is the provider's transaction id. When a provider has no
  id, the key is tag + local time + plaza + amount. Overlapping weekly files and the PDF plus CSV of the
  same week therefore add nothing. Credits and reversals are kept as negative lines. The original file
  is stored with its upload, so any figure traces to a file and a line.
- **D-TL9 — A toll counts in the month it was driven.** The month is set by travel date, kept as local
  wall-clock time (`packages/shared/src/tmsCost/wallClock.ts`, D-FIN9). The posting date is kept beside it for the tie to
  the GL.
- **D-TL10 — Statements are checked against the books, never substituted for them.** Each month, the sum
  of uploaded statements is compared with GL `40790000` (AP + DRS) and the difference is printed. The
  GL stays the fleet total. The statements decide only the split per truck, and any unmatched
  remainder is shown as a spread line in the P&L. It is never hidden inside a truck.
- **D-TL11 — Permissions come from the existing matrix.** Registering and moving tags uses the
  `equipment` section, the one that gates Vehicles. Uploading statements and reading per-truck tolls
  uses the `accounting` section. No role list is written by hand.

---

## 3. Build order

| Step | What | Blocked on |
|---|---|---|
| **TL1** | Migration 0622 + `toll-transponders` matrix (49 checks, four guards mutation-tested). Shared `tolls/`: `tollTags`, `tollAttribution`, `tollContract` (17 tests) | — **done in PR 1** |
| **TL2** | API `modules/tolls/transponders.ts`: list, register, move, retire, void, all through 0622's functions, org-scoped. Web: a "Toll tags" column on Vehicles, and a tag card on the truck page with its history | — |
| **TL3** | Format layer: `.ods` routed to SheetJS, EFS `readFile` reads real `.xls`/`.ods`/HTML-as-xls (tests, mutation-checked) | — **done in PR 1** |
| **TL4a** | Migration 0626 `toll_statements`: one row per uploaded file (provider, file, format read from the bytes, size, SHA-256, uploader), private bucket `toll-statements`, kept as uploaded before any reader exists. Read columns (period, printed total, read at) nullable, filled by TL5. Tolls page under Finance: upload drawer, statements list, open file, remove with reason | — |
| **TL4b** | `toll_statement_lines` (D-TL8 key, tag, plate, local time, plaza in/out, class, amount, posted date) and the D-TL6 tie, run over the files TL4a kept | column set confirmed against Q-TL1 files |
| **TL5** | One reader per provider in `@silvicom/shared/tolls/readers/`, each tested on the real file in every format that provider offers. E-ZPass per issuing agency | **Q-TL1, Q-TL2** |
| **TL6** | Toll review page under Finance: unassigned, near-swap and plate-only lines; a provider × week grid of uploaded statements, so a missing week is visible; the monthly GL tie (D-TL10) | TL4 |
| **TL7** | P&L: tolls per truck per month and per mile in `computeTruckPnl` (TRUCK-DRIVER-PNL-PLAN P3), with the GL remainder as a labelled spread | TL6, P3 |
| **TL8** | Cross-checks: a toll whose plaza is far from where Samsara had the truck (a tag on the wrong truck); the same truck charged twice at one plaza within minutes | TL6 |

---

## 4. What this plan refuses to do

- Spread a toll by miles, or by anything else, when a statement names its tag.
- Store a truck on a toll line (D-TL3).
- Read money from an image (D-TL7).
- Accept a statement that does not tie to its own total (D-TL6).
- Build a PrePass reader. Owner 2026-11-16: it is not tolls.

## 5. Done when

June 2026 statements from all three providers are uploaded. Each June toll is attributed to a truck or
listed in review with a reason. The June total ties to GL `40790000` ($72,644.54 AP − $31.35 DRS), with
the remainder stated. The P&L shows tolls per mile for every truck that ran in June.

---

## 6. Open questions — each names the step it blocks, with a recommendation

- **Q-TL1 (blocks TL4's column set and TL5)** — One recent statement from **each** provider, in every
  format that provider offers (PDF and CSV/Excel). Recommend: export June 2026, so the first
  reconciliation has a known answer.
- **Q-TL2 (blocks TL5 for E-ZPass)** — Which E-ZPass agency issues the account (NJ, PA, NY, IL I-PASS,
  …)? Each agency's statement layout differs, and a fleet can hold tags from more than one.
- **Q-TL3 (blocks TL7's scope)** — Do owner-operator trucks carry company tags? Tolls OO is $100–$280 a
  month, so recommend: register company tags only. Owner-operator tolls stay out of company cost
  per mile, as their fuel does.
- **Q-TL4 (blocks TL6's history)** — How far back should statements be loaded? Recommend June 2026
  onward, the month §5 checks against. Earlier months add history but no check we don't already have.
  **Answered 2026-11-17 (owner): load the last six months**, about mid-May 2026 onward, which covers June for §5. So tags must be entered with the dates they really went on each truck, or the earlier tolls reach no truck; the Tolls page says so.
- **Q-TL5 (blocks nothing; sharpens TL6)** — Video / pay-by-plate tolls carry a plate, not a tag.
  Recommend: match by plate only when exactly one active truck has that plate (`vehicles.plate`, from
  the sync); otherwise send it to review. The plate's history is not tracked, so an old plate on a new
  truck must not be matched silently.

## 7. Progress log — append one dated line per step

- 2026-11-16 · plan written. Owner ruled the three providers, PrePass out, all of PDF/CSV/XLSX/XLS
  accepted. Measured the GL toll months (§1.1) and corrected the 09-03 "$184.40" figure. TL1 (0622,
  matrix, shared tolls module) and TL3 (ODS, EFS `.xls`) built in the first PR.
- 2026-11-17 TL2 built. API `apps/api/src/modules/tolls/` mounted at `/api/tolls`: `GET /transponders` (whole fleet, or `?vehicleId=` for every tag that truck ever carried), `POST /transponders`, `/transponders/:id/move`, `/transponders/:id/retire`, `/assignments/:id/void`. Reads gate on `equipment: view`, writes on `equipment: manage`, and every write is audited (`tolls.*`). Each write is one of 0622's functions; TL001–TL005 come back as the office's sentence under 409 or 422, and a tag already on file comes back as 409 `already_registered` with that tag attached. Web: a "Toll tags" column on Vehicles, and the list search now matches tag numbers. On the truck page, a Toll tags card in the File section shows the tag on the truck since when, tags it carried before, and the full history with voided entries crossed out; it can add, move or take off, retire, and void a wrong entry. Times are typed on the company's clock and sent as instants (`fieldValueToInstant` in `calendarDay.ts`). `traced` was promoted to `apps/api/src/lib/serviceError.ts` so a second module could use it without crossing a module boundary. The `tolls` dirs belong to the Finance release area.
- 2026-11-17 · TL4a built. The owner wanted to hand the statements over through the product rather than by file share, so TL4 split: TL4a keeps each file as uploaded, TL4b reads lines from the kept files once Q-TL1's samples settle the columns. Migration 0626 `toll_statements` + private bucket `toll-statements` (25 MB a file); a file is never changed or deleted (TS001–TS003), a wrong one is removed with who and why, and the same bytes count once per org while kept. API `/api/tolls/statements` (accounting: view to list and open, manage to upload and remove; both audited `tolls.statement_*`): signed upload, then the stored bytes are held to the declared size and SHA-256 and their format read from the bytes (`tollStatementFormatOf`: PDF, xlsx, ods, xls, HTML table, CSV), refused bytes deleted. Web: Finance › Tolls page (statements list, "Not read yet" in words until TL5, an explainer on back-dating tag history) with an upload drawer (provider chosen, never defaulted; many files, one outcome line each) and a statement drawer (open file, remove with reason). Found on the way: 0601's `lumper_case_files_removed_together` admits a removal with a NULL reason, because `length(btrim(NULL)) between 3 and 300` is NULL and a CHECK passes NULL; 0626 spells out `remove_reason is not null`. The lumper API always sends a reason, so nothing wrong is stored today; a later lumper migration should close it.
