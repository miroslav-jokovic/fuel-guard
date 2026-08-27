# The financial store — every earning and expense, from every source, counted once

**Status:** schema shipped 2026-08-26 (migration 0257); ingest and reporting to follow
**Supersedes in emphasis:** `MCLEOD-CPM-DATA-SOURCE-SPEC.md` §8 C5

## The goal, in the owner's words

> All earnings and expenses this company has, collected into our database from all sources, and then
> a reporting harness that gives precise reports on whatever we want. Cost per mile per truck is one
> of those reports, not the point of the exercise. Payments must be individually visible, separated
> and easily searchable.

This reframes C1–C5. Those built extraction plus an in-memory harness — a proof that the arithmetic
works. What is actually wanted is **extraction → a persisted financial fact store → reporting on
top**, with equipment, driver and load data following behind the money.

## 1. The problem the schema has to solve

One payment genuinely exists many times across the sources, and every copy looks like a legitimate
row. This is measured, not assumed:

| Duplication | Evidence |
|---|---|
| **Within McLeod, across lifecycle** | A settlement is an accrual (`SET`), a payment (`DRS`), a `drs_check` row and GL lines. Four records, one payment. |
| **Within McLeod, across tables** | June 2026 fuel is **$1,017,601.81** in `fuel_detail_hist`, in GL account `20550000`, and in the `PILOKNTN` AP invoices — three representations agreeing to the cent. |
| **Across sources** | That same fuel is what EFS already writes into `fuel_transactions`. |

So one fuel purchase can present as **four defensible rows**. A convention — "remember to filter" —
fails the first time somebody writes a report without reading the docs.

> **D-FS1:** The no-double-counting guarantee is **structural, not procedural**. Entries that
> represent the same money share a `dedup_key`, and a partial unique index permits exactly one
> canonical row per key. A report reading `where is_canonical and not is_void` cannot double-count,
> because the database will not hold the second row that would let it.

## 2. Shape: detail tables plus a canonical fact

Per-source detail tables keep each system's own shape, keys and reconciliation — that is what lets
`mcleod_settlements` prove itself against GL module `SET` to the cent, and what makes each table
reusable for questions this store was not designed for. `financial_entries` is the projection:
narrow, uniform, searchable, and the only thing a report needs to sum. Drill-down runs the other way.

Standard warehouse shape — staging plus fact. Flatten it and the reconciliation is lost; keep only
the detail tables and every report re-implements the dedup rules, which is where double-counting
comes back.

### Shipped in 0257

| Table | Role |
|---|---|
| `financial_entries` | The canonical fact. One row per economic event, deduped and lifecycle-tagged. |
| `mcleod_settlements` | Driver and owner-operator pay. Reconciles to `SET` on `accrual_key`. |
| `mcleod_ap_vouchers` | Non-fuel payables. Structurally unattributed. |
| `mcleod_billing` | The earnings side. **Carries `tractor_id`** — revenue per truck needs no allocation rule. |

`financial_entries` carries `direction` (earning/expense), `category`, `amount`, `occurred_at`
(economic) and `settled_at` (cash), nullable `vehicle_id`/`driver_id`/`load_id`, full provenance
(`source`, `source_table`, `source_row_id`, `external_id`), the double-count controls
(`lifecycle_stage`, `dedup_key`, `is_canonical`, `is_void`), and the ledger keys that let any entry
be proved against the carrier's books.

## 3. Decisions taken

> **D-FS2 — EFS stays authoritative for fuel.** The same purchase exists in EFS and McLeod. EFS
> remains the spend record and keeps its existing product surface; McLeod fuel is retained for
> reconciliation and for the reefer/DEF split EFS does not provide, and lands as a non-canonical
> entry. Chosen over making McLeod authoritative because the blast radius of re-sourcing every
> existing fuel-spend page is large and the benefit is a tie-out we already have.
>
> **D-FS3 — history begins 2024-01-01.** That is where `gl_ledger`'s live table starts, so GL
> reconciliation works without touching `gl_ledger_hist` (2016–2023), whose quality has never been
> checked. Roughly 2.5 years — enough for year-over-year comparison.
>
> **D-FS4 — `amount` is always positive and `direction` carries the meaning.** Not a sign
> convention: a report cannot mistake a credit memo for revenue by reading a minus sign. A refund is
> an expense with a negative amount, which is a different thing from an earning.
>
> **D-FS5 — the store asserts no attribution McLeod does not.** `vehicle_id` is null on every AP
> voucher and every office-settlement line because the source carries no tractor there —
> `gl_ledger.tractor` is populated on 0 of 188,179 lines and `voucher_dist.tractor` on 0 of 397.
> Allocation is the reporting harness's job, with finance's sign-off, and a store that guessed would
> make the guess permanent and untraceable.
>
> **D-FS6 — `occurred_at` is the economic date, not the cash date.** Settlement uses `accrual_date`,
> billing the bill date, fuel the transaction time. Reporting periods key off it. Mixing the two
> silently compares different months — the mistake that made the first settlement reconciliation miss
> by roughly $135,000.

> **D-FS7 — movement facts stage with their stops as one JSONB row (0267, 2026-08-27).** The
> cents-per-mile denominator lands in `mcleod_movements`: miles, equipment attribution, and the
> ordered stop array in a single row keyed `(org_id, external_id)`. Stops are JSONB rather than a
> child table because their only consumer — `inferDeadheadLegs` — reads a movement's stops whole to
> chain deliveries to next pickups; no query wants a stop without its movement, and a child table
> would add a second writer surface and a landed-movement/missing-stops partial-failure mode for no
> reader. The same decision records the mileage-basis rule: the raw layer stores McLeod's
> `move_distance` verbatim because settlements and the carrier's operations reports are built on it,
> while the owner's 2026-08-27 ruling makes Samsara the fleet's mileage source of truth — so WHICH
> basis a report divides by is a per-report harness decision, stated on the report, never a silent
> substitution at ingest (the D-FS2 posture, applied to miles).

> **D-FS8 — GL control totals stage month-grained, and the coverage report claims only what is
> proven (0269, 2026-08-27).** `mcleod_gl_totals` holds per-(module, account) totals per CALENDAR
> MONTH — aggregates need a stable period, and the month is the carrier's own close unit; the
> agent re-sweeps every month its rolling window touches and the ingest REPLACES the month
> (upsert under a batch stamp, then delete older stamps), because a reclassified entry moves money
> between accounts and a pure upsert would leave the old account's stale total standing. The
> `/api/accounting/ledger-coverage` report states subledger claims ONLY where the tie-out is
> proven — SET via `posted_pay` on the accrual side (D-MC23/D-MC24) — and reports AP/BILL/everything
> else as named uncovered modules rather than fabricating drift. OFFICE lines (`OFF` module) are
> deliberately NOT staged yet: the extraction pulls no stable row key for `gl_ledger`, and inventing
> idempotency for an append-heavy line table is how duplicates ship — enumerating `gl_ledger`'s key
> column is a recon question before that sweep exists.

## 4. What the matrix proves

`supabase/tests/financial-entries.test.mjs`, 29 assertions:

- The same money from a second source is **refused** as canonical, and the refusal names the index.
- The second copy is **retained** as non-canonical, so drill-down still reaches it.
- A report reading the canonical predicate totals **$100.00, not $200.00**.
- The **payment leg** of an accrued settlement cannot also be canonical.
- A **void** is retained for audit, excluded from reports, and does not block a canonical replacement.
- **Re-sweeping** the same source row is refused rather than duplicated.
- Two carriers may hold the same `dedup_key`; neither sees the other's entries.
- Unknown `direction`, `category` or `payee_type` are refused rather than silently stored.

`rls.test.mjs` picks all four tables up automatically and asserts cross-tenant isolation and anon
lockout on each.

## 5. What comes next

1. **Ingest** — project the four McLeod sweeps and the existing `fuel_transactions` into
   `financial_entries`, computing `dedup_key` and choosing canonical. This is where D-FS2's fuel
   policy is implemented, and where the AP-contains-fuel overlap collapses.
2. **Backfill** 2024-01-01 to present, then verify each domain still reconciles from the STORE rather
   than from the sweep output — the reconciliation must survive persistence.
3. **Reporting harness** — rebuild `computeCpm` to read `financial_entries` rather than in-memory
   sweep output, and generalise: cost per mile is one query over this table, margin per truck is
   another, spend by vendor or account a third.
4. **Equipment, drivers, loads** — the roster contract already exists
   (`MCLEOD-READ-ONLY-INTEGRATION-HANDOFF.md`); `loads` carries no money today and would gain revenue
   through `mcleod_billing.order_external_id`.

## 6. Open, and worth deciding before the harness

- **Allocation rules.** §5.7's module table and the `ap_glid` inventory are most of the artifact
  finance needs in order to rule on how office and AP overhead spread across trucks. Until they do,
  `computeCpm` assigns none and says so.
- **Maintenance is arriving twice.** FleetPal is the planned source, but repair spend is already
  flowing through McLeod AP with unit numbers in free text ("754 Repair", "Bumper"). Both will need a
  shared `dedup_key` or the fleet will be billed twice for the same wrench.
