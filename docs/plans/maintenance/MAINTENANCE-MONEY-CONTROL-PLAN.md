# Maintenance money control: every repair dollar in FleetPal and McLeod, matched · 2026-10-04

**Status: PLAN, nothing built.** Decision prefix **D-MMC**, question prefix **Q-MMC**, measurement
prefix **M-**. Sibling of `FLEETPAL-INTEGRATION-PLAN.md`; that plan's F9a/F9b coverage bound is the
first, partial version of what this plan finishes.

**Working rule for this plan, by the owner's instruction of 2026-10-04: no assumptions.** Every
number below says where it came from and when. Anything not yet measured is listed in §4 as a
measurement with the query or call that settles it, and **no step may start until the measurements
it names are recorded in §8**. A step whose inputs turn out different from what §4 expects stops
and comes back here. FLEETPAL-INTEGRATION-PLAN's F9 was labelled "no migration" and needed one,
because nobody checked its inputs existed. That's the failure this rule prevents.

---

## 0. The ruling this plan starts from

**Owner, 2026-10-04:** *"in McLeod we have numbers for total repairs, per month … in FleetPal we
should have all separated invoices and transactions. What we basically should do is to have both
resources in our collectors and compare this as some kind of money control … point is to have our
collectors to have all needed data."*

Read as two requirements, in this order:

1. **Collect everything.** Both collectors hold every record a repair dollar leaves behind, on
   both sides, at transaction grain. That covers the invoice, the payment, and the ledger line it
   was booked to. A comparison is only as complete as the thinner side.
2. **Compare them as a control.** Every month, every repair dollar lands in exactly one of four
   boxes (D-MMC3). The exceptions are the product.

**Not decided here: whether per-truck maintenance cost enters the finance reports.** D-FLEET2 /
D-FP3 (2026-09-03) keep FleetPal out of Finance, and this plan does not reverse that. It builds the
data a reversal would need. **Q-MMC1** asks the question.

---

## 1. Measured reality — 2026-10-04

Production via `supabase db query --linked`. FleetPal via read-only `GET` calls with the key in
`apps/api/.env`. Org `86d6b3ea-…`. July 2026 is the reference month because it is the last month
`mcleod_gl_totals` holds.

### 1.1 McLeod's July repair money is transactions, not a bank-statement total

The fifteen accounts of the maintenance family (`packages/shared/src/tmsCost/glFamilies.ts`,
key `maintenance`) for July 2026, by the module that posted them:

| `post_module` | Net | Lines | What it is |
|---|---:|---:|---|
| `AP` | $141,993.69 | 69 | Vendor invoices (vouchers) |
| `DRS` | $76,176.39 | 222 | Driver settlement: repairs paid by or for drivers, recovered or reimbursed through pay |
| `OFF` | $1,061.73 | 4 | Office lines |
| `RJ` | $716.93 | 2 | Journal |
| `FUEL` | $53.97 | 2 | Fuel module |
| `CASH` | −$701.23 | 1 | Cash |
| **Total** | **$219,301.48** | 300 | Matches F9b's measured family total |

**The owner's description, "input from the bank statement", does not match how the money is
booked.** 99.5% posted through AP and DRS, both transaction subledgers. Staff may well work from
the statement; the ledger records invoices and settlements. That makes a line-level control
possible.

By account, the largest lines: Tires `40160000` AP $71,162.50 (7 lines). Shop Parts `30230000` AP
$38,102.71 (47). OTR Repairs over $1000 `30240000` DRS $37,902.82 (26). Trailer Repair `30350000`
DRS $17,412.06 + AP $16,432.07. OTR Repairs under $1000 `30250000` DRS $13,808.11. Towing
`30290000` DRS $7,546.80. Repairs and Maintenance `40150000` DRS **−$9,878.88** (a net credit:
recoveries from drivers exceed charges).

### 1.2 What our McLeod copies hold

| Staged table | Holds | Gap for a control |
|---|---|---|
| `mcleod_gl_totals` / `mcleod_gl_days` | Sums per account × module × month / day | Not transactions. **No row after July 2026** (FLEETPAL plan §8) |
| `mcleod_ap_vouchers` | One row per vendor invoice: number, vendor, amount, dates, `check_number`, `post_key` | **No expense account.** `ap_glid` is the payable control account (D-FP17), so an invoice cannot be classed as a repair. **`is_paid` is false on every row, every month Dec 2025–Sep 2026** (M-3). Rows run to **September** while the GL stops at July |
| `mcleod_deductions` | Driver deductions/reimbursements with `glid` | July on maintenance accounts (`transacted_at` in July): **200 lines, $88,139.89 summed as stored, 17 account × type pairs, 9 voided, `tractor_unit` filled on 9**. **No description or reference column staged.** ⚠ **$88,139.89 ≠ the GL's DRS $76,176.39.** Sign convention (R vs D types), voids and date basis are unexplained (M-11) |
| `mcleod_settlements` | Settlement pay per movement | Not repair lines |

July `mcleod_ap_vouchers`: 235 rows, $1,562,239.73 (all spend, not only repairs). **`check_number`
on 71**, `post_key` on 229. Monthly check-number fill Dec–Sep: 7, 30, 45, 31, 41, 41, 42, 71, 46, 26.

### 1.3 What FleetPal holds (live account, read 2026-10-04)

**Payments**, `GET /v1/purchase-order-payments/` (not collected today):

- July 2026 (`paid_after=2026-07-01&paid_before=2026-07-31`): **169 payments**.
- **One is `ON_ACCOUNT`, $9,146,990,499.00, dated 2026-07-27**, which is a data-entry error in
  FleetPal. Excluding it: **$188,982.52**.

| `method` | n | Amount |
|---|---:|---:|
| `CHECK` | 47 | $123,736.86 |
| `EFS_CHECK` | 107 | $55,935.89 |
| `ON_ACCOUNT` | 5 (+1 error) | $4,705.51 |
| `CARD` | 4 | $2,060.78 |
| `CASH` | 1 | $1,100.00 |
| `PERSONAL_CREDIT_CARD` | 2 | $131.94 |
| null | 2 | $1,311.54 |

- Wider window (`paid_after=2026-06-30&paid_before=2026-08-01`): 191 payments; **`number` filled
  on 154**; **`invoices[]` filled on 188, never more than one invoice per payment**. Numbers look
  like `009326` (company checks) and `1434296225` (EFS check numbers, 10–11 digits).
- **The date filters are inclusive at both ends.** `paid_after=2026-06-30` returned rows dated
  2026-06-30, and `paid_before=2026-07-31` returned rows dated 2026-07-31. A monthly window must be
  `paid_after=<first day>&paid_before=<last day>`, not `<first of next month>`.
- All-time: **2,840 payments**, earliest **2025-01-02**.

**Order lines**, `GET /v1/purchase-order-items/` (not collected): 476 updated since 2026-07-01
(PART 437, TAX 29, FEE 10). Fields include `component`, `quantity`, `price`, `total`, `part`.

**Already collected** (FLEETPAL F6–F9a; **production tables are empty until the first sweep**,
see FLEETPAL §8 2026-10-04): purchase orders, PO invoices ($215,782.05 for July, measured live at
F9b), service history (per unit, five-way split), work orders, jobs, job items, vendors.

**Not yet read on the live account:** receipts and receipt items (F13), estimates, payment terms.

### 1.4 EFS checks: a third source we already hold credentials for

107 of July's FleetPal payments (**$55,935.89**) are `EFS_CHECK`. Those are checks drawn on the
fuel-card account, which the EFS SOAP collector already connects to. The vendor WSDL
(`docs/efs/CardManagementWS.wsdl`) exposes `getMoneyCodes`, `getMoneyCodesV2`, `getMoneyCodeUse`,
`getMoneyCodeUseV2` and `getRegisteredChecks`. **Nothing in this repo calls any of them, and no
table stores EFS checks or money codes** (`efs_*` tables: cards, transactions, mutations, proofs,
credentials, certs, run state).

Whether an EFS check number in FleetPal equals a money-code or registered-check reference in EFS,
and how McLeod books those checks, is **not measured**. See M-5 and M-6.

---

## 2. The findings that decide the shape

### 2.1 The two sides meet on the PAYMENT, not the invoice number

F9b joins FleetPal invoices to McLeod vouchers on **invoice number alone**. That's a free-text
field ("CHK955 and 400167", "RECEIPT: 9086"), and it proved "at least 58.2%". Two stronger keys
exist and neither is used:

- **Company checks.** FleetPal `payment.number` (`009326`) vs McLeod `voucher.check_number`.
- **EFS checks.** FleetPal `payment.number` (10–11 digits) vs EFS's own money-code/check records,
  and from there to how McLeod booked them.

Whether these keys actually agree is M-4 and M-5. **Neither is a decision until measured.**

### 2.2 A third of McLeod's repair money never touches AP

$76,176 of July (35%) posted through `DRS`. F9b's bridge only looks at AP vouchers, so this
money **can never match**, however good the invoice-number join gets. It's part of why the bound
sits at 58%. FleetPal's $55,936 of EFS checks has a similar size and may well be the same money
(an EFS check written at a roadside shop, recovered through the driver's settlement). **That is
a hypothesis.** M-6 tests it before anything is built on it.

### 2.3 McLeod's vouchers can't be classed as repairs without their expense lines

D-FP17: `mcleod_ap_vouchers.ap_glid` is the payable control account (`20000000`), never the
expense. The expense lives on the voucher's other GL lines, presumably reached through the voucher's
`post_key` in `gl_ledger` / `gl_ledger_hist`, or through `voucher_dist` (397 rows when measured
2026-08-28, `tractor` empty). **Which is the real source is M-1**, and it decides step C2's shape.

### 2.4 Per truck: what each side can attribute

Recorded for Q-MMC1, not acted on:

- McLeod names the equipment type on 4 of 15 maintenance accounts. 81.5% of July is
  equipment-blind (FLEETPAL D-FP19). `gl_ledger` populates no tractor/trailer column at this
  carrier (measured 2026-08-26: 0 of 188,179 lines in 2026). `mcleod_deductions.tractor_unit` is filled on 9 of 200
  July repair lines.
- FleetPal attributes 100% of July service history to a tractor or trailer, but its total
  includes $100,883.60 of shop labour that McLeod books as payroll (D-FP18).

---

## 3. Decisions (proposed; each becomes binding when the owner accepts the plan)

- **D-MMC1. Collection before comparison.** Steps C1–C4 (collect) all land and are verified
  against §1's July figures before step K1 (control) starts. A control built on a partial
  collector reports its own gaps as discrepancies.
- **D-MMC2. Byte-exact keys.** Check numbers, invoice numbers and payment numbers are stored as
  the vendor sends them (D-FP16). Normalisation happens only inside the matcher, as named rules
  that each have their own test, and every match records **which rule** produced it. Leading
  zeros (`009326`) are the first rule to test, because they are where a silent mismatch would start.
- **D-MMC3. Four boxes, every dollar in exactly one.** Each month:
  (1) **matched**: same money on both sides, amounts agree;
  (2) **FleetPal only**: invoiced/paid in FleetPal, not found in McLeod;
  (3) **McLeod only**: booked to a maintenance account, not found in FleetPal;
  (4) **disagree**: matched by key, amounts differ.
  The four box totals must sum to each side's own total, to the cent. That identity is the
  control's own test, and a month where it fails is not printed.
- **D-MMC4. No match is inferred.** One key, one candidate, or it is unmatched. Two candidates
  for one key goes to an "ambiguous" list, never into box 1 (D-FP15's rule, kept).
- **D-MMC5. Outliers are findings, not filters.** The $9,146,990,499 payment stays in the data and
  appears as a box-2 exception. Nothing is dropped for being implausible; it is flagged.
- **D-MMC6. Evidence is append-only.** A control run's result is stored per month and never
  rewritten. A re-run is a new row, so last month's exceptions list stays what the office saw.
- **D-MMC7. No financial projection.** Nothing here writes `financial_entries` or the fleet
  report until Q-MMC1 is ruled.

---

## 4. Measurements: each one gates the step named

Each is a query or call that answers one question. Results go in §8 with the date. **"Not yet"
is a valid entry; a guess is not.**

| # | Question | How | Gates |
|---|---|---|---|
| **M-1** | Where does a McLeod voucher's **expense** account live: `gl_ledger(_hist)` lines sharing the voucher's `post_key`, or `voucher_dist`? For July, does the sum of those lines on the 15 maintenance accounts equal the GL's AP total of $141,993.69 to the cent? | Live `lme` / `lme_analytics` (VPN). Join `voucher_hist.post_key` → `gl_ledger_hist` and compare to `mcleod_gl_totals` AP | C2 |
| **M-2** | Which column on `drs_deduct_hist` (or a sibling table) carries the description/reference of a repair deduction or reimbursement, and how often is it filled for July's 200 maintenance-account lines? | Column list + fill counts on the McLeod source (VPN) | C3 |
| **M-3** | Why is `is_paid` false on all 1,658 staged vouchers? What values does `voucher_hist.is_paid` actually hold? Is `check_number` filled only on paid vouchers? | `select is_paid, count(*) … group by` on the source (VPN); compare with `expenses.mjs:85`'s `=== "Y"` | C2 |
| **M-4** | For July, how many FleetPal `CHECK` payment numbers equal a McLeod `voucher.check_number`, exactly and with leading zeros stripped? How many collide (one number, several vouchers)? | FleetPal payments (C1) × `mcleod_ap_vouchers` | K1 |
| **M-5** | Does a FleetPal `EFS_CHECK` number equal anything `getMoneyCodes` / `getRegisteredChecks` / `getMoneyCodeUse` returns for the same dates? Which field? Can our EFS credentials call these operations at all? | One read-only call per operation from the WEX-whitelisted api host, through the existing SOAP client | C4 |
| **M-6** | How does McLeod book an EFS check written for a repair: as a `DRS` deduction, a `FUEL`-module line, or an AP voucher to EFS? What does the EFS-check total for July correspond to in §1.1? | Follow 5 July EFS-check payments by date and amount through `drs_deduct_hist`, `fuel_detail_hist` and `voucher_hist` (VPN) | K1 |
| **M-7** | Is the ON_ACCOUNT $9,146,990,499 payment the only outlier across the 2,840 payments? What do ON_ACCOUNT payments represent (they carry no number)? | Full payment walk after C1 | K1 |
| **M-8** | Do FleetPal invoices ($215,782.05) and payments ($188,982.52) for July differ only by timing (invoiced in July, paid in August or June)? | `invoices[]` on each payment × `fleetpal_po_invoices` dates, after C1 and the first sweep | K1 |
| **M-9** | Are the FleetPal `/v1/purchase-order-payments` and `/v1/purchase-order-items` fields exactly the spec's (`lint:fleetpal-contract` holds the manifest)? Does `updated_after` behave as a watermark on both? | Generate manifest; live pages compared field by field (F4's method) | C1 |
| **M-10** | Why do staged vouchers run to September while `mcleod_gl_totals` stops at July? Which sweep advanced and which did not? | `mcleod_financial` / sync stamps vs `max(distribution_date)` | C2, K1 |
| **M-11** | Why do July's 200 staged maintenance-account deductions sum to $88,139.89 while the GL's DRS figure is $76,176.39? Candidates to test, not to pick: R/D sign convention, the 9 voided rows, `transacted_at` vs the GL posting date, DRS lines that are not deductions | Sum by `deduction_type` and `is_void` in production first; then the source's posting date (VPN) | C3 |

M-1, M-2, M-3 and M-6 need the carrier VPN (down on 2026-10-04 when this was written). The
financial tables are readable only through the sandbox credential, which reads the **frozen
restore** `lme_analytics`, whose age is set by whoever last restored it. **Before trusting a result, record the
restore date from `msdb.dbo.restorehistory`.**

---

## 5. Steps

### C1: FleetPal payments and order lines collected · *next-numbered migration*

`fleetpal_po_payments` (one row per payment; `number`, `method`, `date`, `amount`, `payable_to`,
`notes`, and the invoice ids it settles) and `fleetpal_po_items`. Added to the existing hourly
sweep with the F7 watermark pattern. Contracts in `packages/shared/src/fleetpal/purchasing.ts` and
manifest entries (`POPayment`, `POItem`). RLS on, no client policies. Byte-exact `number` (D-MMC2).

**Done when:** M-9 recorded. A walk of July stages **169** payments (`paid_after=2026-07-01&
paid_before=2026-07-31`), including the $9,146,990,499 one. A second sweep stages zero new rows.
A payment with an empty `invoices[]` (3 of 191 in the wider window) stages rather than fails.

### C2: McLeod voucher expense lines collected · *migration + agent change*

Shape decided by M-1, not here. Whatever it is, the result is **one row per voucher × expense
account × amount**, so a voucher can be classed as maintenance by its own lines. Fix `is_paid`
per M-3 in the same step.

**Done when:** for July, the staged expense lines on the 15 maintenance accounts sum to the GL's
AP figure, **$141,993.69, to the cent**. A residual is investigated, not accepted.

### C3: McLeod repair deductions carry their reference · *agent change, maybe a column*

Per M-2: the description/reference on driver repair deductions and reimbursements, staged
byte-exact.

**Done when:** M-11 is answered, and with its rule applied the staged maintenance-account
deductions reproduce the GL's DRS figure, **$76,176.39**, to the cent. If M-11 shows DRS holds
repair lines that are not deductions, this step collects those too before it can be done. The
fill rate of the new reference column is recorded in §8.

### C4: EFS checks and money codes collected · *migration; only if M-5 says the API can*

The EFS operation M-5 names, on the EFS collector's existing schedule, into a new append-only
table. **Read-only.** `issueMoneyCode` is a write and is out of scope.

**Done when:** July's EFS checks total is recorded beside FleetPal's $55,935.89, and the
difference is explained in §8.

### K1: the monthly control · *migration for the result table*

The four boxes (D-MMC3), computed in SQL as measurements and judged in TS
(SQL returns the sums and candidates; TypeScript decides the box). Matching order: company check number (M-4) → EFS
check (M-5/M-6) → invoice number (F9b's rule, kept as the last resort). Every match carries the
rule that made it. Results stored append-only per month (D-MMC6).

**Done when:** July 2026 runs. Both sides' box totals reproduce §1's figures to the cent. The
outlier payment shows as a box-2 exception. The share in box 1 is reported against F9b's 58.2%,
with the reason for any change written in §8.

### K2: the screen · *no migration*

The exceptions list, month by month, in the maintenance section beside FLEETPAL F10's unit file.
Raw-JSON route mocks, `preview:local`, screenshots in the PR. Wording to be written with the
owner, plain word first and accounting term in the hover (the office readers are not native English speakers).

---

## 6. Questions

| # | Question | Candidates | Recommendation |
|---|---|---|---|
| **Q-MMC1** | Should per-truck maintenance cost reach the finance reports? | (a) no, D-FP3 stands; (b) McLeod stays the money, FleetPal attributes it to trucks: per-truck external cost (labour out, D-FP18) with labour shown separately, and the company total stays McLeod's with K1's matched share beside it; (c) FleetPal's totals replace McLeod's for maintenance | **(b), after K1 runs.** K1 is what shows how much of McLeod's money FleetPal can actually account for, and that share is what decides whether per-truck figures are honest. Ruling now would be ruling on 58% |
| **Q-MMC2** | Who acts on an exception: shop, accounting, or both? Does the control send anything (email, alert)? | — | Owner to say. Shapes K2, not the collectors |
| **Q-MMC3** | The $9,146,990,499 payment: does the owner want it corrected in FleetPal now? | — | Yes. It's FleetPal's data. Silvicom flags it (D-MMC5) and never edits the vendor's record |

---

## 7. Out of scope

- Writing anything to FleetPal, McLeod or EFS. `issueMoneyCode` and every other EFS write stays out.
- Projecting into `financial_entries` (D-MMC7, until Q-MMC1).
- Parsing truck numbers out of McLeod free text (D-MC12).
- Shop labour reconciliation against payroll. Real, but a payroll question.

---

## 8. Log

- **2026-10-04 · Plan written.** The measurements in §1 were taken on this date; the VPN was
  down, so M-1, M-2, M-3 and M-6 are open, and M-11 was opened when the staged deductions ($88,139.89) failed to tie to the GL's DRS
  figure ($76,176.39). FleetPal's collector flag `FLEETPAL_SYNC_ENABLED=true`
  was set on `@fleetguard/api` the same day; the first sweep waits on the owner pasting the key in
  Settings → FleetPal integration (FLEETPAL §8).

- **2026-10-04 · M-9 measured; C1 built (migration 0424).** Every live payment (2,840) and order
  line (2,106) was read and parsed with the new contracts: **0 failures**. What the spec did not say:
  - `number` is `""` (never null) on **615** payments, so it is stored as `''`.
  - `method` is null on **20**.
  - `invoices` is empty on **43**, and holds **two** ids on some payments. July alone had none with
    two, so a one-month sample would have missed it.
  - Amounts carry up to **three** decimals: 1 payment, 64 item prices, 36 item totals. 0424's money
    columns are `numeric(14,3)`.
  - **`updated_after` is exclusive** on both endpoints. Asked with the newest `updated`, each answers
    0 rows; one second earlier, 1.
  - A **second** absurd amount exists beside July's: **$4,007,362,959, EFS_CHECK, 2025-07-24**.
    Both look like a check number typed into the amount field. Both are staged as sent (D-MMC5).

  Built:
  - `fleetpal_po_payments` and `fleetpal_po_items`, with two set-based `stage_*` functions.
  - Both run in the hourly sweep after the invoices they point at.
  - The contracts plus their `POPayment`/`POItem`/`PaymentMethodEnum` manifest entries.
  - Recorded fixtures: one live row per edge case above, free-text notes redacted.
  - Matrix assertions in `fleetpal-repair-record.test.mjs`.

  Mutation-checked:
  - Rounding the amount to (14,2) is caught.
  - `nullif(number,'')` is caught.
  - Mapping `number || null` is caught.
  - Keeping only the first invoice id is caught.
  - Removing the function's explicit revoke changes nothing, because 0412 already closes new
    functions to clients. That's an equivalent mutant, and 0424's comment says so.

  Two findings outside C1, recorded rather than fixed here:
  - **`check-fleetpal-contract.mjs` skipped a manifest vocabulary that had no const mapped**
    (`continue`). Fixed in this PR: an unmapped vocabulary now fails, like an unmapped resource,
    proved by deleting the new mapping.
  - **0351's `fleetpal_po_invoices.amount` is numeric(14,2), and 2 of 4,095 live invoices have
    three decimals** (`108.489`, `188.774`). Widening it (column and `stage_fleetpal_po_invoices`'
    recordset type) is a follow-up, **C1b**. Production holds no rows yet, so it is cheap now and
    not later.

  **C1's last done-when ("a July walk stages 169 payments") waits on the first production sweep.**
  The walk itself returns 169 with the inclusive window and every row parses; staging in production
  needs the key pasted in Settings → FleetPal integration.
