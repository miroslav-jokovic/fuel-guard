# Pilot weekly invoice — new format, mailbox pull, rebuilt old-column report (analysis, 2026-11-24)

Status: owner ruled 2026-11-24 — the PDF arrives attached in `Pilot-Bills` (Q-PIF2), keep Vehicle ID and Driver ID
(Q-PIF6). Step 1 built; steps 2–3 next.

## 1. What changed (measured on `Standard_Invoice_Gen_Template_INV-59656.pdf`)

The new invoice is a different document, not a tweak of the old one:

| | Old `StatementDBS_US` (`db139445F.pdf`) | New `INV-59656` |
|---|---|---|
| Made by | Pilot Receivables' Reporting Services | Microsoft Word template, run through DocuSign (author: a Pilot employee) |
| Invoice no | `809276960` (digits) | `INV-59656` |
| Period | "Beginning 11/02/26, Ending 11/08/26" | **not printed** — only "Cycle: Weekly - Mon", Billing 11/23/2026, Due 11/25/2026 |
| Columns | 21: Card, Unit, Loc., City, State, Ticket, Auth, P.O., Date, Odometer, Prod (code), Units, **Fuel Cost**, Amount, Qts, Oil Amount, Cash Advance, **Misc./Disc.**, Sales Tax, Invoice Total, Retail Total | 14: Card#, Unit Number, Date (4-digit year), Transaction #, Store Location ("475 Moriarty NM"), **Vehicle ID**, **Driver ID**, Odometer, Product (name, not code), Qty, Sales Tax, Retail $, Invoice $ |
| Printed totals | per-product Customer Total, `** Customer Total`, Retail Total, **Savings Total** | only Amount Purchased / USD Total / Transaction Tax / Amount Due |
| Merchandise | Misc./Disc. column on the line | separate lines with product `Miscellaneous` / `Tax` |

Why every upload fails since 11/09: `parsePilotStatement` finds the table by the old 21-word header line and reads
columns at fixed x positions, then requires the old printed totals. The new file has none of those, so the Reconcile
page says "That PDF isn't a Pilot statement". Last good upload in production: 2026-11-09 (week 11/02–11/08).

What the new file DOES give (parsed with a throwaway script over all 88 pages):

- **960 lines; sum of Invoice $ = $341,127.06 = the printed Amount Purchased, to the cent.** So it can be gated on
  its own total, as the old one was. Two lines carry a `DB` suffix on the Transaction # (`0929800378DB`); a
  parser that expects digits only drops them and misses the total by $787.77. The total check catches it.
- Retail $ is printed per line, so the discount per line IS derivable: retail − invoice. What is gone is the
  printed per-gallon price, the discount column and Pilot's own Savings Total.
- Week 11/16–11/22 (+2 lines dated 11/23). Truck Diesel 494 lines / 63,008 gal / billed $317,786 / retail $370,177;
  Reefer 43 lines (retail − invoice $668); DEF 394 + 3 lines, no discount; Diesel 4; Misc 10; Tax 10.
- Retail − invoice over the whole file = **$53,628** (an estimate of savings; see §3 on what "retail" means here).

## 2. Fix the upload (Issue 1)

- Add a second layout to the reader: detect the new header by its column NAMES ("Card#", "Transaction #",
  "Store Location", "Invoice $"), bind columns from the header's own x positions on each page (Word layouts
  move; fixed points would break again), split Store Location into site / city / state (site = first token,
  state = last, wrapped city lines joined).
- Gate: sum of Invoice $ = Amount Purchased, and Sales Tax = Transaction Tax. No retail or savings gate — the
  file prints none.
- Period: from the earliest and latest line date (11/16–11/23 here), shown as such. The old one is unchanged.
- Product names → the existing codes (`Truck Diesel`→020, `Reefer`→033, `Diesel Exhaust (Fluid)`→140, `Diesel`→019?,
  `Miscellaneous`/`Tax`→merchandise). An unknown name is reported, never counted as diesel (same rule as today).
- Fits the current tables: `invoice_no` is text, `printed_retail`/`printed_savings` are nullable, `source_format`
  stays `pdf_statement`. Vehicle ID and Driver ID have no column; carry them only if wanted (Q-PIF6).
- Old files keep their own reader and tests. Fixture: this PDF, its words saved as a test file (not the PDF —
  it holds card numbers; repo is public, so the fixture must be cut down and masked).

## 3. Rebuild the old columns from Pilot's price files (Issue 3)

Measured: every Truck Diesel line on a day we have Pilot's quote, compared with `fuel_prices` (source
`pilot_email`) for the same site + state + day:

- **Billed price per gallon (Invoice $ / Qty) = that day's "Your Price" on 346 of 348 lines (to ½¢).** The two
  exceptions were billed above the quote: site 4599 TN 11/18 (+$0.13/gal, $20.03) and 372 CA 11/18 (+$0.19/gal,
  $9.55). So the price file reproduces the old `Fuel Cost` column, and catches overbilling — exactly.
- The invoice's Retail $ is NOT the quote's Retail Price: median 4¢/gal below it, up to 20¢. It is the pump price
  at the time of the fill; the quote is Pilot's 8:24 PM snapshot the evening before. So for the old `Retail Total`
  column the invoice's own Retail $ is the better number; the quote's retail is the cross-check.
- 146 of 494 diesel lines (11/16–11/17) have no quote — the 11/11–11/17 price gap (Q-PIF4). 4 lines at sites the
  quote does not list.
- No quote exists for Reefer or DEF (the price file is Truck Diesel only); those lines carry invoice figures only.

Rebuilt report, old column order (Card, Unit, Loc., City, State, Ticket, Auth, P.O., Date, Odometer, Prod, Units,
Fuel Cost, Amount, Qts, Oil Amount, Cash Advance, Misc./Disc., Sales Tax, Invoice Total, Retail Total), filled as:

| Old column | From |
|---|---|
| Card, Unit, Date, Odometer, Units, Sales Tax | invoice line as printed |
| Loc. / City / State | Store Location split |
| Ticket | Transaction # (Auth, P.O. — not on the new invoice; left blank) |
| Prod | code from the product name |
| Fuel Cost | Invoice $ / Qty, shown next to the quote's "Your Price" (flag when billed > quote) |
| Amount / Invoice Total | Invoice $ |
| Misc./Disc. | Miscellaneous + Tax lines folded onto their ticket, as the old file printed them |
| Retail Total | Retail $ |
| Qts, Oil Amount, Cash Advance | not on the new invoice; 0 |

Plus, at the bottom, the totals the old file printed and the new one does not: per-product Customer Total,
Retail Total, **Savings Total** (retail − invoice) and a "Billed above Pilot's quote" list. Shown on the Reconcile
page for the week, downloadable as Excel. Works for old and new invoices alike.

## 4. Pull invoices from Pilot-Bills automatically (Issue 2)

The owner moves the new invoices to miki@ `Pilot-Bills` by an Outlook rule. Same design as the price pull
(`pilotPriceMail.ts`): scheduler in lane `general`, reads the folder with `lib/graphFolder.ts`, own ledger table
(new migration, `pilot_bill_mails`: message id, received, sha-256, state, invoice no, error) because every message is
already read, sha-256 dedupe (the same PDF arrives forwarded more than once), server reads the PDF with
`pdfjs-dist` (already in apps/api) and records it through the same `ingestFuelStatement` the page uses. Every hour is
plenty — one invoice a week. Failure stays visible as `failed` + reason on the Reconcile page.

Unknown until someone looks at the folder: **is the PDF attached, or is it a DocuSign "Review document" link?** The
file was produced by DocuSign. An attachment is straightforward. A DocuSign link needs a sign-in, which the
server cannot do — then the pull only works if Pilot (or the rule) puts the PDF itself in the folder (Q-PIF2).

Dependencies: the mail-app lockdown with Simo must keep read access to `Pilot-Bills`. The invoice is 4.3 MB; a Graph
attachment read is fine at that size.

## Open questions for the owner

- **Q-PIF2 — how does the invoice arrive in Pilot-Bills?** PDF attached, or a DocuSign link? From whom?
- **Q-PIF3 — is this format permanent?** A Word template through DocuSign looks like a stopgap (Pilot billing system
  change?). Ask Pilot's credit department (800-562-6210 x3550) whether the old statement is coming back, and
  whether they can still send the old file. The build supports both either way.
- **Q-PIF4 — 11/11–11/17 price gap.** Download those quotes from Pilot's portal and upload them, or accept no quote
  check for 11/16–11/17. Recommendation: download, if the portal keeps them.
- **Q-PIF5 — retail.** Use the invoice's Retail $ for Retail Total and Savings (recommended), with the quote only
  as the price check.
- **Q-PIF6 — Vehicle ID / Driver ID.** New on the invoice (reefer lines show trailer-like numbers). Keep them on the
  line (one migration adding two columns) or ignore? Recommendation: keep — they help match a reefer fill to its
  trailer.
- **Q-PIF7 — the 11/09–11/15 invoice.** Is it in Pilot-Bills too? The pull would load it; otherwise upload by hand.

## Build order (when approved)

1. New-layout reader + gate + tests (masked fixture). Unblocks the weekly upload. Small, no migration.
2. Rebuilt old-column report on Reconcile + Excel download, with the quote price check. Medium, no migration.
3. Pilot-Bills pull: migration for the ledger, scheduler, server-side PDF read, card on Reconcile. Medium; after Q-PIF2
   and the mail lockdown.

## Progress log

- 2026-11-24 — owner: invoices are moved to `Pilot-Bills` automatically, PDF attached; keep Vehicle/Driver ID; build
  step 1. Built `packages/shared/src/reconcile/pilotInvoice.ts` (`parsePilotInvoice` + `parsePilotWeeklyBill`, which
  the upload, the server re-parse and the reconciliation now all call). Verified on the real files through the same
  pdfjs decode the browser uses: INV-59656 → 960 lines, $341,127.06 = Amount Purchased, tie-out ok; the 8 old
  statements in Downloads parse exactly as before. Vehicle/Driver ID are parsed but not yet stored — the columns
  need their own migration, merged before their first writer (`lint:migration-ordering`).
