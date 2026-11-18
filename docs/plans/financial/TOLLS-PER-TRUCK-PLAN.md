# Finance — toll expenses per truck, from the toll providers' own statements

**Status:** IN BUILD — TL1–TL3, TL2b and TL4a built; sample files in (§1.3), plan reviewed 2026-11-18; TL4c and TL5 next, then TL4b, TL8a–b, TL6. **Owner:**
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

### 1.3 Measured 2026-11-18, from the real statements (Q-TL1 answered)

The owner downloaded 18 statements and two lists into a local folder (never the repo: they carry
account numbers). Read on the owner's machine only. Production held 0 statements and 0 tags that day.

**The statements.** Every file is a PDF with a text layer, so none needs OCR (D-TL7). Each one prints
totals that the lines can be held to:

| Provider | Files | Billed on | Lines a month | Printed control the lines tie to |
|---|---|---|---:|---|
| **E-ZPass**, NJ service centre (answers Q-TL2) | 5 monthly, 04/27 → 09/26 | 11-digit tag (97% of $), `ILP<plate>` pay-by-plate (3%) | 2,300–3,130 | "Tolls, Non-Tolls and Fees" plus a running BALANCE on every line. The April file: $45,489.91 tolls + $1.00 fee = $45,490.91 printed |
| **K-TAG**, DriveKS / Kansas Turnpike | 7 monthly, Apr → Oct | `KTA.<8 digits>` transponder (99.8%), `IL-P<plate>` | 1,570–2,130 | "Tolls" in the Billing Period Summary. All seven months tie to the cent |
| **ExpressToll**, Colorado | 6 monthly, 04/28 → 10/27 | Device + plate, but 98% of lines are camera (`VTOLL`/`IOPVTOLL`) by **plate** | 100–160 | "Grand Total" and "Total Tolls". The per-device "Total:" lines sum to twice the tolls, because the grand total is printed in the same form |

E-ZPass also prints lines that are not tolls: `Prepaid Payment` (account top-ups, $208,000 over 5
months), `Tagsale`, `Service Fee`, `Adjustment`. Tolls ran $33k–$45k a month on E-ZPass, ~$12k on
K-TAG and $1.3k–$1.8k on ExpressToll.

**The identifiers.** No VIN appears in any statement. The owner supplied two lists: the
"truck physical list" (230 truck → E-ZPass tag lines, a "for sale" section of 37 trucks, no dates)
and a DriveKS vehicle inventory export (215 vehicles, 206 K-TAGs, as of 2026-11-18). The second is an
`.xlsx` that ExcelJS cannot open (`reading 'sheets'`): a non-standard package that only a
tolerant reader handles.

**Matched by the lists alone.** E-ZPass matches 90.1–95.6% of each month's dollars. K-TAG matches 96.6%
in October, falling to 62.7% in April. ExpressToll matches 88% by plate. The lists are today's
snapshot, and the statements reach back to April.

**Why the rest does not match.** Each unmatched line was put to Samsara's location history, which
reaches back to April 2026 and still carries sold trucks (`556 - SOLD`). Plaza positions were learned
from the tolls whose truck the list already knew: 236 plazas, 172 placed within 3 km. Each unmatched
tag's tolls were checked against the truck within ~2 km of the plaza at that minute, with a majority
over up to 8 tolls on different days.

- **Control first:** 40 tags the lists do know were put through the same check. 38 agreed, 1 had too
  few tolls, and 1 disagreed. The disagreement was the list being stale: tag `02210699936` is listed
  on for-sale truck 604, and GPS puts it on new truck 842.
- **K-TAG:** $21,597.62 not matched by the list. GPS names one truck for $19,864.44 (67 tags), and
  $1,733.18 (12 tags, most with 1–2 tolls) is left open.
- **E-ZPass** (after the list's typos are corrected): $10,598.56 not matched. GPS names the truck for
  $10,288.39 (11 tags), and $310.17 (2 tags) is left open.
- **The causes, in order of dollars:** (1) **sold trucks.** None of the 37 for-sale trucks is on the
  K-TAG list, yet they drove through the summer. (2) **Tags moved or replaced.** About 20 current trucks
  carried a different K-TAG earlier in the year. (3) **Typos in the truck list:** a dropped `2`
  (`00216433472` for `02216433472`), extra digits (`003300025570`, `022164430651`), and one tag
  entered on two trucks (802/803, 552/833). (4) **Plates change too.** Truck 763 went from P1334063 to
  P1372671, so an E-ZPass plate toll on the old plate matched nothing. (5) **Trailer plates.**
  ExpressToll's camera read a trailer's `…ST` plate on 18 devices (~$900), and those trailer plates are
  in `trailers.plate`.
- **ExpressToll's line plate is the identity, not the group's.** 118 camera lines (`VTOLL`) are printed
  under one device's "Transactions For Device # … Plate # …" heading but carry a different plate on the
  line itself: the plate the camera read (Colorado E-470 bills video tolls to the account and files them
  under any device). The reader takes the line's plate. The group's plate counts only for transponder
  lines (`AVITOLL`). The 88% figure above used the group plate, and is re-measured by TL5.
- **The DriveKS account carries placeholder plates:** about 60 `IL-TEMP…`/`IL-SPG…` plates, a typo
  (707 shows `P123799` for `P1273799`), and 7 trucks listed twice. So a K-TAG is matched on the
  transponder number only, never on the plate the account shows.

The scripts that did this live outside the repo (session scratchpad). The rules they used are
D-TL14–D-TL16 below, and the product re-derives everything from the uploaded files and Samsara. Nothing
in the product depends on a figure in this section.


### 1.4 Measured 2026-11-18: what McLeod books for tolls, and whether every toll is ours

The owner's requirement: per-truck tolls must agree with the toll amounts entered into McLeod, every
mismatch must be caught and recorded, and no transaction that is not ours may be counted.

**McLeod side** (`lme_analytics`, restore 2026-10-09, `gl_ledger` + `gl_ledger_hist`, accounts 40790000 /
40790002, March–October: 216 lines, $343,141.02):

- **No McLeod toll line names a truck.** `tractor` is empty on 216 of 216. McLeod cannot give a per-truck
  toll figure to compare against. The only comparison is by account and by period.
- **McLeod books payments, not tolls.** The AP lines are card charges keyed from card statements
  (`AMER`, `CAPONE`, `CHASCHIL` batches): E-ZPass top-ups in $8,000–$10,000 amounts, K-TAG autopays
  (`KTA Autopay 11000.95` is exactly the April DriveKS statement's Previous Balance; `KTA toll 11371.28`
  is exactly the April statement's total), and ExpressToll replenishments ($494–$627). The
  `transaction_date` is the card statement's date, and posting runs 1–2 months behind it.
- **The toll account also holds what is not on our three statements:** PrePass ($11,728.58
  over three names, booked as tolls although it is weigh-station bypass; the owner ruled it is not
  tolls, 2026-11-16), other agencies paid by card (HCTRA, NTTA, FasTrak, SunPass, PlatePay OK, EZ TAG,
  E-ZPass OH/NY bills), toll violations by state, and driver deductions and reimbursements (DRS; some
  name a truck in free text, e.g. `ErrolWright725`).
- So **per-truck usage for a month will never equal McLeod's toll account for that month.** The
  difference is not an error but four things: top-ups versus usage (the prepaid balance moves), the
  card lag, PrePass, and tolls billed outside our three accounts. D-TL19 makes each of those a recorded,
  explained line, so that what is left over is a real mismatch.

**Statement side: is every toll ours?** All 18 statements, $299,701.38 of tolls over 28,226 toll
lines:

| Identified as ours by | Lines | Dollars |
|---|---:|---:|
| Tag on a list (E-ZPass truck list, DriveKS export) | 22,775 | $253,058.50 |
| Tag on one of our trucks by GPS (§1.3) | 3,888 | $30,152.83 |
| Plate of one of our trucks | 1,110 | $13,460.47 |
| Plate of one of our trailers | 58 | $670.99 |
| **Not identified** | **412** | **$2,360.93** |

The 412 lines are 20 identifiers, none above $559. Two are already explained: P1334063 is truck 763's
earlier plate (Samsara still holds it), and P848932 is a plate DriveKS bills for. The rest are tags GPS
could not settle (too few tolls, or two trucks at the plaza) and three plates that are on no truck or
trailer we hold (P973445, P1297493, P1358597), which may be sold units or not ours at all.

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
  it receives, so a browser bug cannot slip past it. **Raised 2026-11-18:** the tie is per kind, to every
  subtotal the statement prints (K-TAG's per-transponder "Sub-Total"; ExpressToll's per-device
  "Total:", "Grand Total" and "Total Tolls"; E-ZPass's "Tolls, Non-Tolls and Fees" and "Payments and
  Credits"). On E-ZPass every line is also held to the running BALANCE (previous − charge = this line's
  balance, from "Beginning" to "Ending"). The amount is printed unsigned, so its sign comes from that
  balance step, and a misread kind cannot hide inside the grand total.
- **D-TL7 — A scanned PDF is refused, not read by OCR.** A PDF with no text layer produces no words. The
  message asks for the provider's CSV or Excel download. Character recognition is not precise enough
  for money.
- **D-TL8 — Every line is kept, once.** The key is the provider's transaction id. When a provider has no
  id, the key is tag + local time + plaza + amount + the occurrence of that combination within the file
(a genuine double charge is two lines, not one). Overlapping weekly files and the PDF plus CSV of the
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

**Added 2026-11-18, from §1.3. The owner asked for "100% results and precision".** That phrase is
held to the two definitions below, so that it can be checked, not just claimed.

- **D-TL12 — "100%" means four checks, each of which can be run.** (1) **Complete:** every line of
  every statement is read, and the lines tie to the statement's printed total to the cent (D-TL6).
  (2) **Classified:** every line is a toll, or one of the named non-toll kinds (account payment, tag
  purchase, service fee, adjustment), so a $49,000 top-up is never charged to a truck. (3)
  **Attributed:** every toll names one truck, or sits in review with its reason in words. A month is
  **closed** only when review holds $0.00 for that month. (4) **Verified:** every attributed toll
  carries a GPS verdict (D-TL14), and none in a closed month is `contradicted`, `absent` or
  `ambiguous`. That alone does not make a month "100%". A toll can still be `no_evidence` (no Samsara on
  the payer, a gap) or `office`. So the page says **"closed — N% confirmed by GPS, M office
  decisions"**. The words "100% precise" appear only when every toll in the month is `confirmed`
  (review 2026-11-18, item 1).
- **D-TL13 — Every toll on a truck states its evidence.** One of `tag` (the tag's dated history),
  `plate` (the plate's dated history, D-TL16), `trailer` (a trailer plate, resolved to the truck
  pulling it, D-TL16), or `office` (a person's decision recorded with a reason). The evidence is
  derived at read time like the truck (D-TL3). The page shows it, and an `office` attribution is
  counted separately so it can never pass for measured evidence.
- **D-TL14 — GPS checks the attribution and never makes it. What is stored is the observation, and the
  verdict is derived.** Each plaza (provider, agency, plaza code, direction, and for E-ZPass entry or
  exit) gets a position and its zone in `toll_plazas`. The zone comes from the position (tz dataset),
  never from the agency. The position is learned from tolls whose truck is known, leaving out any tag
  whose own tolls GPS disputes (the stale list must not teach the plaza; 604 → 842). It is the median of
  the trucks' positions at those minutes, kept only when the spread is under 3 km over at least 3 tolls
  on 2 days. Each agency also gets a learned clock offset (posted time vs the moment the truck passed),
  not an assumed ±3 minutes. Per toll line the worker stores an **observation**: every company truck
  (and trailer gateway) within R km of the plaza at that minute, with distance and point time, plus
  the plaza version used. E-ZPass checks the exit plaza at exit time, and also the entry plaza when it
  is printed. The verdict is derived at read time against whatever truck the history gives (D-TL3):
  `confirmed` (that truck within 2 km, and it is the only company truck within 2R), `ambiguous`
  (another company truck was within 2R: convoys, yard exits), `absent` (that truck has points then and
  was more than X km away; goes to review whether or not another truck was there), `contradicted`
  (absent, and another truck was there), or `no_evidence` (plaza not placed, no points, no Samsara).
  Because the observation names every truck, moving a tag later needs no new Samsara call, and
  Samsara's retention cannot erase the evidence (Q-TL10). `SWAP_MARGIN_MS` narrows from 3 hours to
  the plaza's measured window only for a plaza that is placed and zoned. The repeated hour on the
  autumn clock change stays `near_swap`.
- **D-TL15 — Tag history from GPS is proposed, then recorded by a person.** When a tag's tolls reach no
  truck, or reach the wrong one, the system proposes "tag X on truck Y from <first toll> to <last
  toll>". It does so only when at least 3 tolls on 2 different days were checked, at least 90% of
  them name the same truck, and none names another truck. A toll counts as a vote only when exactly one
  company truck was within R and the next nearest was beyond 2R. A convoy toll is not a vote. The office accepts it, which writes the
  assignment through 0622's functions with `source: gps` and the evidence attached, or rejects it with
  a reason. GPS never writes history unseen. A proposal that fails the bar stays in review, labelled
  "not enough evidence" and showing the tolls it has.
- **D-TL16 — Plates have a dated history, and a trailer plate goes to the truck pulling it.** Plates
  change (763), so `vehicles.plate` (today only) is not evidence for April. Plate history is
  recorded the way tag history is: from today's plate going forward, plus GPS-proposed earlier plates
  under D-TL15's bar. A plate that belongs to a trailer (`trailers.plate`) is resolved by the trailer's own
  gateway position at the gantry (`fetchTrailerGpsHistory`, already used for reefer pairing), then the
  company truck co-located with it, with evidence `trailer`. Without a trailer gateway, it falls back to
  the truck at the plaza, and only under D-TL15's uniqueness rule. Plate history is its own table with
  0622-style guard functions (one plate on one unit at a time, voids with reasons). It is never attributed through a
  trailer↔truck link table, whose history is not precise.
- **D-TL17 — The lists are inputs to tag history, never to tolls.** The E-ZPass truck list and the
  DriveKS export are loaded through the TL2b import with the earliest provable start: the first toll
  the tag paid on that truck, confirmed by GPS. A list entry that GPS contradicts (604 → 842) is
  refused with that sentence. Typos are refused by the import, not corrected silently, and the
  statement's number is the one kept.
- **D-TL18 — Non-toll lines are kept, classified, and charged to no truck.** Account payments are cash
  movement, not cost. Tag purchases and service fees are fleet overhead. Q-TL8 asks whether a tag
  purchase should instead go to the truck that received the tag. Adjustments keep the sign and words
  the provider printed. A reversal or adjustment that names a toll (same tag or plate, plaza, date) goes
  to that toll's truck, not overhead. Violation and administrative fees get a named kind of their own.
  Office decisions (accept or reject a proposal, attribute by hand) go to an append-only decision
  table: who, when, the reason, and a snapshot of the evidence shown.

- **D-TL19 — The McLeod tie is a matching of lines, recorded both ways, never a single difference.**
  Each McLeod toll line (40790000 / 40790002, every module) gets exactly one outcome, stored and shown:
  `payment` matched to a statement's payment line (provider, amount, date within the card lag; K-TAG
  autopay = a statement's Previous Balance or total), `prepass` (not tolls, owner 2026-11-16, flagged to
  be reclassed in McLeod), `other_agency` (a toll bill outside our three accounts, kept with its words;
  per truck only when the office names the truck), `violation`, `driver` (DRS/OFF), or **`unmatched`**.
  Each statement payment line likewise is `booked` (matched to a McLeod line) or **`not_in_mcleod`**. Then
  per account and period, the balance roll is checked: McLeod payments − statement tolls = the
  statement's own change in prepaid balance. A difference there is a recorded mismatch with its amount.
  Mismatches are kept as rows (`toll_reconciliation_findings`: what, the amount, both sides' references,
  first seen, resolved by whom and how), not recomputed into a single number that silently changes.
  The month view shows: statement tolls per truck (sum = statements to the cent) → + prepaid balance
  change → + other agencies, violations and driver lines → = McLeod's toll account, with every
  unexplained cent listed.
- **D-TL20 — A toll is counted only when it is ours.** Every toll line must be identified as one of our
  units by tag history, plate history, trailer plate, or a GPS-confirmed proposal accepted by the office.
  A line identified by none is **`not_ours_or_unknown`**: it stays out of every truck's total, out of the
  fleet's usage, and in a list of its own with the dollars, so a stranger's toll can be disputed with
  the provider and is never absorbed. The office's decision on each one (ours: which truck; not ours:
  disputed on a date) is an append-only row. A tag or plate seen on a statement that is in none of our
  records triggers that list the day the statement is read, not at month end.

---

## 3. Build order

| Step | What | Blocked on |
|---|---|---|
| **TL1** | Migration 0622 + `toll-transponders` matrix (49 checks, four guards mutation-tested). Shared `tolls/`: `tollTags`, `tollAttribution`, `tollContract` (17 tests) | — **done in PR 1** |
| **TL2** | API `modules/tolls/transponders.ts`: list, register, move, retire, void, all through 0622's functions, org-scoped. Web: a "Toll tags" column on Vehicles, and a tag card on the truck page with its history | — |
| **TL2b** | Tolls page "Toll tags" tab (every tag, its truck and since when, a drawer with its history and the card's acts) and an Excel import: download a sheet of the trucks in service with the tags on file, fill it in, drop it back, see each line's act (add, move, start earlier, already right, fix) before anything is saved. `POST /api/tolls/transponders/import` re-plans on what is on file with the same shared planner | — |
| **TL3** | Format layer: `.ods` routed to SheetJS, EFS `readFile` reads real `.xls`/`.ods`/HTML-as-xls (tests, mutation-checked) | — **done in PR 1** |
| **TL4a** | Migration 0627 `toll_statements`: one row per uploaded file (provider, file, format read from the bytes, size, SHA-256, uploader), private bucket `toll-statements`, kept as uploaded before any reader exists. Read columns (period, printed total, read at) nullable, filled by TL5. Tolls page under Finance: upload drawer, statements list, open file, remove with reason | — |
| **TL4c** | First, because nothing can be learned without it: the DriveKS-style `.xlsx` that ExcelJS cannot open goes through SheetJS in `reportGrid.ts`, so the owner's K-TAG export loads in the TL2b import as it is | — |
| **TL5** | Three pure readers in `@silvicom/shared/tolls/readers/`, one file per provider plus a shared row/column layer (500-line budget), run on words from `readPdfWords`. NJ E-ZPass: tag and `ILP` plate lines, the non-toll kinds, the sign from the balance step, the running balance on every line, the printed "Tolls, Non-Tolls and Fees" and "Payments and Credits". DriveKS K-TAG: transponder/plate groups that continue across pages, every "Sub-Total", the "Tolls" summary. ExpressToll: device groups, each line's own plate, status codes, every "Total:", "Grand Total" and "Total Tolls". Each returns lines, period, account and printed totals, or refuses with the sentence. CI fixtures are word lists with the real layout and every account, tag and plate replaced. A local-only check (`pnpm tolls:check-real <folder>`, not in CI, files outside the repo) runs the readers on the owner's 18 statements and must tie every one, every subtotal and every balance step to the cent before TL5 merges | — (Q-TL1, Q-TL2 answered 11-18) |
| **TL4b** | Migration: `toll_statement_lines` (D-TL8 key with occurrence, kind (D-TL18, incl. violation/admin fee), tag or plate as printed, agency, plaza in/out with direction, local entry/exit times, class, signed amount, balance where printed, posted date, page and line in the file). 0627 already holds the statement's read columns. API `POST /api/tolls/statements/:id/lines`: the browser reads the kept file and sends lines, and the API re-runs every D-TL6 tie before storing anything, org-scoped (`expectOrgScoped`). Web: "Read" on each kept statement, and new uploads are read straight away | TL5 |
| **TL8a** | `toll_plazas` (org-scoped, RLS: position, spread, samples, zone from position, per-agency clock offset, version) and `toll_line_observations` (D-TL14: trucks and trailer gateways near the plaza at the toll minute). The worker groups tolls into ~10-minute windows and makes one paginated `/fleet/vehicles/stats/history` (and trailers) call per window for all assets, with 429 backoff, on the general lane. The backfill from April runs as soon as TL4b lands (Q-TL10: April sits at the edge of retention) | TL4b |
| **TL8b** | Verdicts derived at read time (D-TL14). Evidence per line (D-TL13). Plate history table with 0622-style guards, and trailer plates by trailer gateway (D-TL16). GPS proposals for unmatched, absent and contradicted tags and plates (D-TL15). An append-only decision table for accept, reject and office attribution | TL8a |
| **TL6** | Toll review page under Finance: per month and provider, the four D-TL12 checks as numbers, the D-TL19 McLeod tie with every finding listed, the D-TL20 not-ours list, the "closed — N% confirmed" line, the review queue with each line's reason, proposals to accept, the same truck charged twice at one plaza within minutes, a provider × month grid of statements so a missing month shows, and the GL tie on the side Q-TL11 measured. A month closes only at 60 days and $0.00 review | TL8b, Q-TL11 |
| **TL7** | P&L: tolls per truck per month and per mile in `computeTruckPnl` (TRUCK-DRIVER-PNL-PLAN P3), with the GL remainder as a labelled spread | TL6, P3 |
| **TL8c** | Ongoing: each new statement is verified on read, and a tag whose tolls stop matching its truck is raised the same day (a moved tag is caught before month end) | TL8b |

---

## 4. What this plan refuses to do

- Spread a toll by miles, or by anything else, when a statement names its tag.
- Store a truck on a toll line (D-TL3).
- Read money from an image (D-TL7).
- Accept a statement that does not tie to its own total (D-TL6).
- Build a PrePass reader. Owner 2026-11-16: it is not tolls.

## 5. Done when

June 2026 statements from all three providers are uploaded. Each June toll is attributed to a truck or
listed in review with a reason. The June total is compared with GL `40790000` ($72,644.54 AP − $31.35
DRS), with the remainder stated. **Caveat 2026-11-18 (review item 2):** E-ZPass is prepaid, with $208k of
top-ups over 5 months, and May's GL AP of $112k is about twice May's usage. So the GL may book
top-ups, not tolls. Which one it follows is measured first (Q-TL11), and the tie is then built on
that side: payments by posting month, or usage by travel month. The P&L shows tolls per mile for every truck that ran in June.

**Raised 2026-11-18 (D-TL12):** every statement from April to October is read and tied to the cent.
Each month from May to October is **closed** (review $0.00), and no toll in a closed month has a
contradicted, absent or ambiguous GPS verdict. The share of tolls `confirmed` by GPS is printed per
month, along with the count of `office` attributions. A month closes only once statements have posted
60 days past its end (E-ZPass posts out-of-state tolls weeks late). A later line for a closed month
reopens it, with that line named.

---

## 6. Open questions — each names the step it blocks, with a recommendation

- **Q-TL1 (blocks TL4's column set and TL5)** — One recent statement from **each** provider, in every
  format that provider offers (PDF and CSV/Excel). Recommend: export June 2026, so the first
  reconciliation has a known answer. **Answered 2026-11-18:** 18 monthly PDFs, April to October, all
  with a text layer (§1.3).
- **Q-TL2 (blocks TL5 for E-ZPass)** — Which E-ZPass agency issues the account (NJ, PA, NY, IL I-PASS,
  …)? Each agency's statement layout differs, and a fleet can hold tags from more than one.
  **Answered 2026-11-18 by the statements:** one account, New Jersey service centre.
- **Q-TL3 (blocks TL7's scope)** — Do owner-operator trucks carry company tags? Tolls OO is $100–$280 a
  month, so recommend: register company tags only. Owner-operator tolls stay out of company cost
  per mile, as their fuel does.
- **Q-TL4 (blocks TL6's history)** — How far back should statements be loaded? Recommend June 2026
  onward, the month §5 checks against. Earlier months add history but no check we don't already have.
  **Answered 2026-11-17 (owner): load the last six months**, about mid-May 2026 onward, which covers June for §5. So tags must be entered with the dates they really went on each truck, or the earlier tolls reach no truck; the Tolls page says so.
- **Q-TL5 (blocks nothing; sharpens TL6)** — Video / pay-by-plate tolls carry a plate, not a tag.
  Recommend: match by plate only when exactly one active truck has that plate (`vehicles.plate`, from
  the sync); otherwise send it to review. The plate's history is not tracked, so an old plate on a new
  truck must not be matched silently. **Superseded 2026-11-18 by D-TL16:** plates get a dated history,
  and every plate toll is GPS-checked like a tag toll.
- **Q-TL11 (blocks TL6's GL tie)** — Does GL `40790000` record toll usage, or account top-ups
  (E-ZPass prepaid; K-TAG and ExpressToll auto-pay)? Measure by matching each month's GL AP lines to
  the statements' payment lines (E-ZPass `Prepaid Payment`, ExpressToll `PAYMENT`, K-TAG's previous
  balance paid). Recommend measuring before TL6 is built. Owner question only if the measurement is
  mixed. **Measured 2026-11-18 (§1.4): payments, by card statement, 1–2 months late, with PrePass and
  other agencies in the same account.** The tie is D-TL19.
- **Q-TL12 (blocks nothing; the books)** — PrePass is booked into 40790000 Tolls ($11,728.58,
  March–October). Should accounting reclass it to its own account? Recommend yes. Until then, D-TL19
  labels it rather than counting it as a toll mismatch.
- **Q-TL13 (blocks D-TL20's list)** — Who disputes a toll that is not ours with the provider, and
  within what window? E-ZPass NJ and DriveKS accept disputes for a limited time after the statement.
  Recommend the office reviews the list weekly.
- **Q-TL7 (blocks TL6's "closed")** — Who closes a month that still holds review lines that GPS cannot
  settle (§1.3: $2,043 over 14 tags, mostly 1–2 tolls each)? Candidates: (a) the office attributes each
  one with a reason (`office` evidence, counted separately); (b) they stay in the month as a labelled
  "unattributed" line in the P&L spread. Recommend (a) for any line over $25, (b) below it. The
  candidates are listed with their tolls, so the decision takes minutes.
- **Q-TL8 (blocks nothing; D-TL18)** — Is a tag purchase (`Tagsale`, $360 over 5 months) fleet
  overhead, or a cost of the truck that received the tag? Recommend overhead: it is small and
  one-off.
- **Q-TL9 (blocks nothing; data hygiene)** — The DriveKS account carries ~60 placeholder plates and 7
  duplicate vehicles (§1.3). K-TAG falls back to the plate when a sticker is not read, so wrong plates
  there can turn into violations. Recommend the office update them in DriveKS. The product does not
  depend on them.
- **Q-TL10 (blocks TL8a's history)** — Does Samsara keep location history long enough for every
  statement we load? It reached April 2026 on 11-18. Recommend the worker fetch and store verdicts
  for every toll as soon as its statement is read, so a later retention cut cannot erase the
  evidence.
- **Q-TL6 (blocks nothing; who keeps the tags)** — The Toll tags tab lives on the Tolls page, which is a Finance screen gated on `accounting`, while tags gate on `equipment` (D-TL11). An admin has both. A fleet manager without accounting cannot reach the page, so cannot use the Excel import (the truck page card still works); an accountant without equipment sees statements only. A surface gate has no "either section" form today (`SurfaceGate` in `packages/shared/src/surfaces.ts`). Candidates: (a) leave it: whoever has both sections loads the fleet once; (b) grant the fleet managers who keep the tags `accounting: view` per person on the Permissions page; (c) add an any-of gate kind to the surface catalogue so `finance.tolls` admits `accounting` OR `equipment` (the tab rules already split per section). Recommend (a) until someone other than the owner needs to import; (c) if fleet managers will.

## 7. Progress log — append one dated line per step

- 2026-11-16 · plan written. Owner ruled the three providers, PrePass out, all of PDF/CSV/XLSX/XLS
  accepted. Measured the GL toll months (§1.1) and corrected the 09-03 "$184.40" figure. TL1 (0622,
  matrix, shared tolls module) and TL3 (ODS, EFS `.xls`) built in the first PR.
- 2026-11-17 TL2 built. API `apps/api/src/modules/tolls/` mounted at `/api/tolls`: `GET /transponders` (whole fleet, or `?vehicleId=` for every tag that truck ever carried), `POST /transponders`, `/transponders/:id/move`, `/transponders/:id/retire`, `/assignments/:id/void`. Reads gate on `equipment: view`, writes on `equipment: manage`, and every write is audited (`tolls.*`). Each write is one of 0622's functions; TL001–TL005 come back as the office's sentence under 409 or 422, and a tag already on file comes back as 409 `already_registered` with that tag attached. Web: a "Toll tags" column on Vehicles, and the list search now matches tag numbers. On the truck page, a Toll tags card in the File section shows the tag on the truck since when, tags it carried before, and the full history with voided entries crossed out; it can add, move or take off, retire, and void a wrong entry. Times are typed on the company's clock and sent as instants (`fieldValueToInstant` in `calendarDay.ts`). `traced` was promoted to `apps/api/src/lib/serviceError.ts` so a second module could use it without crossing a module boundary. The `tolls` dirs belong to the Finance release area.
- 2026-11-17 · TL4a built. The owner wanted to hand the statements over through the product rather than by file share, so TL4 split: TL4a keeps each file as uploaded, TL4b reads lines from the kept files once Q-TL1's samples settle the columns. Migration 0627 `toll_statements` + private bucket `toll-statements` (25 MB a file); a file is never changed or deleted (TS001–TS003), a wrong one is removed with who and why, and the same bytes count once per org while kept. API `/api/tolls/statements` (accounting: view to list and open, manage to upload and remove; both audited `tolls.statement_*`): signed upload, then the stored bytes are held to the declared size and SHA-256 and their format read from the bytes (`tollStatementFormatOf`: PDF, xlsx, ods, xls, HTML table, CSV), refused bytes deleted. Web: Finance › Tolls page (statements list, "Not read yet" in words until TL5, an explainer on back-dating tag history) with an upload drawer (provider chosen, never defaulted; many files, one outcome line each) and a statement drawer (open file, remove with reason). Found on the way: 0601's `lumper_case_files_removed_together` admits a removal with a NULL reason, because `length(btrim(NULL)) between 3 and 300` is NULL and a CHECK passes NULL; 0627 spells out `remove_reason is not null`. The lumper API always sends a reason, so nothing wrong is stored today; a later lumper migration should close it.
- 2026-11-17 · TL2b built. The owner asked for the fleet's tags on the Tolls page and a bulk add from Excel. The page is two tabs (`?view=tags`): Statements, and Toll tags, which shows to `equipment` viewers only, with Add tag and Import from Excel for `equipment` managers; the statements list moved into `TollStatementsList.vue` unchanged. The tag list derives the truck and the start day from the open entry, hides retired tags until asked, and searches by number with or without leading zeros. Its drawer shares `TollTagHistory.vue` with the truck card. The dialog asks for a truck when opened off a truck page. The import: `downloadTollTagSheet` writes an .xlsx of the trucks in service with their tags on file (the tag column is text so leading zeros survive; the provider column is a list); `readTollTagSheet` finds the columns by name in the first ten rows and refuses a line with no start day rather than defaulting it to today, which would lose the six months Q-TL4 loads; `planTollTagImport` (shared, run by the browser for the preview and again by the API on what is on file) turns each line into add, move, backdate (on this truck already, but from a later day: void that entry with the reason in words and put the tag on again from the sheet's day; if that is refused, the tag goes back on from its old start), unchanged, or refused with the sentence to fix it. A tag twice in a sheet is refused on both lines. Lines go 50 a request, each answered on its own and audited `via: "import"`. No migration. Q-TL6 records who can reach the import.
- 2026-11-18 · Samples measured (§1.3) and the plan raised to the owner's "100% results and precision" (D-TL12–D-TL18, Q-TL7–Q-TL10). Each list matches only today's tags: K-TAG reaches 62.7% of April's dollars and E-ZPass 90–96%. Samsara GPS names the truck for 92% of K-TAG's and 97% of E-ZPass's unmatched dollars, and agreed with the list on every tag in a 40-tag control except one, where the list was stale. So GPS became the check on every toll (D-TL14), and the source of proposed tag and plate history that the office accepts (D-TL15–16). The build order is re-cut: TL5 readers first, against the real files on the owner's machine, then TL4b, TL4c, TL8a–b, TL6.
- 2026-11-18 · Plan reviewed by an independent pass before any code, against the owner's "100%". Taken in: a verdict `absent`/`ambiguous` besides `contradicted`, and "100%" only when every toll is confirmed (else "closed — N% confirmed"); observations stored, verdicts derived (D-TL3, and retention-proof); convoy uniqueness for votes; trailer plates by trailer gateway; leave-one-tag-out plaza learning, per-agency clock offset, zone from position; per-kind and running-balance ties; occurrence in the dedupe key; reversals to the toll's truck; 60-day close; the GL may book top-ups not usage (Q-TL11); batched Samsara windows and an immediate backfill; TL4c first. Found while reading the words: ExpressToll's line plate differs from its group's plate on 118 camera lines, so the line's plate is the identity.
- 2026-11-18 · Owner: per-truck tolls must agree with what is entered in McLeod, every mismatch caught and recorded, and no transaction counted that is not ours. Measured (§1.4): McLeod's toll lines name no truck (0 of 216) and book card payments 1–2 months late, plus PrePass ($11.7k), other agencies, violations and driver lines, so the tie is line-to-line plus a balance roll (D-TL19), with findings stored as rows. Of $299,701.38 of statement tolls, 99.2% is identified as ours by list, GPS, truck plate or trailer plate; $2,360.93 on 20 identifiers is not yet, and is held out of every total until decided (D-TL20). Q-TL11 answered, Q-TL12 (PrePass in the toll account) and Q-TL13 (disputes) opened.
