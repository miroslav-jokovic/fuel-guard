# IFTA precision — the right trucks, all of their fuel, and a state page that can be worked

Opened 2026-10-05 after the jurisdiction drill-down shipped (#1293 miles per truck, #1296 fills per
truck). The owner's request, in one message: hide trucks that did not fuel in a state, page and filter
the list, bring in the cash and manual fuel receipts typed into McLeod, and make sure owner-operators
who are not under our IFTA account are not in our return. This plan is the order that work happens in
and the questions that block it. Its parent is `docs/plans/SAMSARA-IFTA-MILEAGE-PLAN.md` (S0–S5,
Q-IF1..6); nothing here changes a decision made there.

---

## 0. Ground truth (measured 2026-10-05 on production, read-only; none recalled)

| Fact | Measured |
|---|---|
| Fleet taxable miles, 2026 Q3 (`samsara_ifta_jurisdiction_miles`) | **4,806,959** |
| Fleet tractor gallons bought, 2026 Q3 (`fuel_transactions`) | **694,936** in **5,823** fills, every one `is_canonical` |
| `fuel_transactions.source` this year | **`fuel_card` 18,274 — and nothing else.** Zero manual, zero cash, zero McLeod. |
| McLeod fuel at FILL grain in our database | **None.** `financial_entries` holds McLeod fuel only as **301 AP vouchers** (no truck). `fuel_detail_hist` (65,847 rows, tractor + state + gallons) is read by the agent's `FUEL_PURCHASES` for money tie-outs and stored nowhere per fill. |
| `vehicles.ownership_type` / `owner_driver_id` / `ifta_account` (0099) | **NULL on all 272 rows.** The columns exist; nothing has ever written them. |
| Units paid as `payee_type = 'owner_operator'` in `mcleod_settlements` since 2026-06-01 | **16** |
| Their 2026 Q3 share | **377,069 mi (7.8%)** and **45,365 gal (6.5%)** — all inside our IFTA totals today |
| Owner-operator units with Q3 miles and **zero** fills on our cards | **718** (22,300 mi) and **512** (21,858 mi); **777** has 2 fills on 19,480 mi |
| Q3 fills with no truck | **87** of 5,823 (12 in Texas) |
| Drill-down vs ledger, Texas 2026 Q3 | **684 fills / 83,763.1 gal both ways** — `readJurisdictionFills` and 0256's `fuel_business_date` predicate agree exactly |

⚠ `mcleod_settlements` is swept from `lme_analytics`, the FROZEN restore (D-PREC12), so "since June"
means "up to whatever was restored" — the newest owner-operator settlement is 2026-09-01. Good enough to
size the problem; not good enough to decide a filing.

---

## 1. Decisions

**D-IP1 — The state page rests on the trucks that BOUGHT fuel there.** The owner's ruling, 2026-10-05.
`?show=` is `""` (bought fuel here), `drove` (drove here, bought none) or `all`. The trucks that drove
and bought nothing are one choice away, never removed: their miles are what make a jurisdiction OWED tax,
so the cards above the table keep the whole jurisdiction and the page says "Listing N of M trucks"
whenever the list is narrower than the cards. Shipped in step IP1.

**D-IP2 — "Owner-operator" is not the filter; "covered by our IFTA account" is.** A leased-on
owner-operator may report under the carrier's IFTA licence or under their own — the lease decides, per
truck. Excluding every owner-operator would be as wrong as excluding none. The fact the return needs is
per truck and per PERIOD: whose IFTA account carried this truck's miles in this quarter.

**D-IP3 — Coverage is dated.** A truck that leases on in August is ours from August. A flag on
`vehicles` holds one instant (see `updated-at-cannot-answer-did-it-happen`), and a re-filed Q2 must use
Q2's coverage, not today's. So coverage is its own history table with `effective_from`/`effective_to`,
not a column.

**D-IP4 — A truck outside our IFTA leaves BOTH halves.** Its miles and its fills leave the ledger, the
fleet MPG and the drill-down together. Removing one side moves the fleet MPG every liability scales with
(the 2026 Q2 10.5 mpg lesson, run in reverse).

**D-IP5 — Cash and manual receipts come from McLeod before they come from an upload.** The office already
keys them into McLeod's fuel entry. A second entry point in our app is the same receipt typed twice and a
duplicate waiting to happen. An upload is built only for receipts that provably never reach McLeod, and
then it stores the image (`fuel_transactions.receipt_path` already exists), because a tax-paid credit
without its receipt is a credit an auditor can refuse.

**D-IP6 — From McLeod, only the lines no card produced.** `fuel_detail_hist` also carries the card fills
EFS already gives us. Importing them would double-count fuel. Which column separates a hand-keyed
receipt from a card import is a MEASUREMENT (Q-IP1), not a guess.

---

## 2. Steps

### IP1 · State page: rests on "bought fuel here", search, pages, filters in the link — BUILT 2026-10-05

Web only, no migration. `IftaJurisdictionPage.vue`: `?show=` and `?search=` live in the URL so a
filtered view can be sent; 25 trucks a page through `TablePagination`; the empty list says whether the
jurisdiction or the filter emptied it.

### IP2 · Measure how a manual receipt looks in McLeod — WAITS on Q-IP1

The probe is §4. One run answers which column(s) separate hand-keyed receipts from card imports, how
many there are per quarter, and whether they carry tractor, state and gallons.

### IP3 · Carrier confirms the ownership codes — WAITS on Q-IP2

`tractor.pay_owner` (D ×174, B ×9, O ×7) and `tractor.owner` (SILVMEIL ×174, SCORELIL ×9, six singles)
are unmapped by D-FG12 until the carrier says what they mean
(`docs/plans/mcleod/CARRIER-CODE-QUESTIONS.md` #2, #3). Once answered, the roster sync fills
`vehicles.ownership_type` and IP4 has a suggestion to show.

### IP4 · IFTA coverage, dated, confirmed by a person

New table (next migration number; RLS on; owner module `ifta`): `vehicle_ifta_coverage (org_id,
vehicle_id, covered_by 'carrier' | 'own_account', ifta_account, effective_from, effective_to,
decided_by, decided_at, note)`. An office screen lists trucks needing a decision, with the evidence
beside each: the McLeod ownership code (IP3) and "drove N miles here with no fills on our cards" (718,
512, 777 today). A person decides; the decision is the row. Corrections are new rows, never edits.

### IP5 · The ledger, the MPG and the drill-down respect coverage

`ifta_period_jurisdictions` gains the coverage join in a NEW function version (applied migrations are
never edited); its reader ships a merge later (`lint:migration-ordering`). Both halves leave together
(D-IP4). The page says how many trucks and miles were excluded and why, beside the totals.

### IP6 · McLeod manual fuel lines into `fuel_transactions` — WAITS on IP2 and Q-IP3

McLeod-owned staging (`mcleod_fuel_lines`, raw, verbatim) filled by the existing agent's
`FUEL_PURCHASES`; a projection writes ONLY the non-card lines into `fuel_transactions` with
`source = 'mcleod_manual'` and the McLeod id as `external_ref`, so a re-sweep is idempotent. They then
reach the ledger, the drill-down and fuel costs with no further change.

### IP7 · The 87 fills with no truck

Separate and small: why they have no `vehicle_id` (card not assigned? unit unknown?) and attribute what
can be attributed. They are kept on their own row until then, so no total is wrong — only unexplained.

---

## 3. Open questions

| # | Question | Who | Candidate answers · recommendation | Blocks |
|---|---|---|---|---|
| **Q-IP1** | **How does a hand-keyed or cash receipt look in `fuel_detail_hist`?** | Miki (runs §4) | (a) `fuel_card_id` NULL; (b) a vendor or source code; (c) both. **Measure, don't pick.** | IP2, IP6 |
| **Q-IP2** | **What do `tractor.pay_owner` D/B/O and `tractor.owner` codes mean?** | Carrier (Alex) | Likely D = company, O = owner-operator, B = ?; SILVMEIL = Silvicom. **One email; D-FG12 forbids guessing.** | IP3 |
| **Q-IP3** | **Can the agent's login read `fuel_detail_hist` on LIVE `lme`?** The financial sweep reads the frozen `lme_analytics` restore (D-PREC12), which would make cash fuel only as fresh as somebody's restore. | Carrier DBA | Grant `SELECT` on `fuel_detail`, `fuel_detail_hist` to the live login. **Recommended** — a stale quarter is a wrong return. | IP6 |
| **Q-IP4** | **Which of the 16 owner-operator units file under their OWN IFTA account?** Start with 718 and 512 (miles, no fills on our cards). | Miki / safety | Read from each lease. Recorded as IP4 rows once IP4 exists. | IP5 |
| **Q-IP5** | **Do receipts that never reach McLeod exist?** | Miki | If yes, an upload with the image (D-IP5). If no, no upload. **Ask the office before building one.** | an upload |

---

## 4. The McLeod probe for Q-IP1 (read-only; run against live `lme`, or `lme_analytics` if the live login cannot read it)

```sql
-- Q-IP1: how do hand-keyed / cash receipts differ from card imports? 2026 Q3, all four companies.
SELECT
  f.company_id,
  CASE WHEN NULLIF(LTRIM(RTRIM(f.fuel_card_id)), '') IS NULL THEN 'no card' ELSE 'card' END AS card,
  NULLIF(LTRIM(RTRIM(f.vendor_id)), '')                  AS vendor_id,
  COUNT(*)                                               AS lines,
  SUM(f.tractor_gals)                                    AS tractor_gals,
  SUM(CASE WHEN NULLIF(LTRIM(RTRIM(f.tractor_id)), '') IS NULL THEN 1 ELSE 0 END)       AS no_tractor,
  SUM(CASE WHEN NULLIF(LTRIM(RTRIM(f.truck_stop_state)), '') IS NULL THEN 1 ELSE 0 END) AS no_state,
  MIN(f.trans_date_time) AS first_at,
  MAX(f.trans_date_time) AS last_at
FROM dbo.fuel_detail_hist AS f
WHERE f.trans_date_time >= '2026-07-01' AND f.trans_date_time < '2026-10-01'
GROUP BY f.company_id,
         CASE WHEN NULLIF(LTRIM(RTRIM(f.fuel_card_id)), '') IS NULL THEN 'no card' ELSE 'card' END,
         NULLIF(LTRIM(RTRIM(f.vendor_id)), '')
ORDER BY lines DESC;

-- And ten example no-card lines, to see what a person actually typed.
SELECT TOP 10 f.id, f.company_id, f.tractor_id, f.trans_date_time, f.truck_stop_name, f.truck_stop_city,
       f.truck_stop_state, f.tractor_gals, f.tractor_cost, f.total_amount, f.vendor_id
FROM dbo.fuel_detail_hist AS f
WHERE f.trans_date_time >= '2026-07-01' AND f.trans_date_time < '2026-10-01'
  AND NULLIF(LTRIM(RTRIM(f.fuel_card_id)), '') IS NULL
ORDER BY f.trans_date_time DESC;
```

⚠ `vendor_id` is assumed to exist on `fuel_detail_hist` (212 columns, measured 2026-08-26) but is not one
of the columns the agent already selects. If SQL Server answers "Invalid column name", drop that column
and run the rest — run each statement on its own, since one bad column kills the whole batch.

---

## 5. Progress log

- 2026-10-05 — Plan opened. IP1 built on `claude/ifta-state-filters`.
