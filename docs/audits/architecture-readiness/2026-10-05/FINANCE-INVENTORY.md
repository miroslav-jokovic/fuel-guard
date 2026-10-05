# APR0.1 — finance data-path inventory, 2026-10-05

The machine-readable half is `finance-inventory.json`, produced by `inventory.mjs finance` in this folder
(16 tables: modules `financial` and `mcleod` in `scripts/table-modules.json`). Same fields and limits as
the fuel pilot (see `FUEL-PILOT-INVENTORY.md` and the generator header).

Cross-check: `git grep` finds 3 non-test files with `.from("mcleod_ap_vouchers")`; the inventory has
1 writer + 2 API readers = 3. Grandfather totals are 29 raw-access and **59** writer sites, which equal
what `lint:table-access` and `lint:table-modules` print on this commit (the +1 since 10-03 is
`platform_alert_recipients`, 0427, outside this scope).

## The path

| Stage              | Where                                                                                                                                                                             | Evidence                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Source             | McLeod SQL Server, read by the on-prem agent (no McLeod HTTP API). `financial` nightly 02:00, trailing 75 d, plus the two prior months on days 1–3; `loads` 60 s; `roster` 15 min | `tools/mcleod-agent/schedule.mjs:19-24`, `windows.mjs:45-58`, `agent.mjs:688-739`                           |
| Collector          | `POST /api/tms/{settlements,vouchers,deductions,movement-facts,ledger-totals,gl-accounts,office-lines,billing}`, ingest-token auth                                                | `mcleod/routes/tmsFinancial.ts:28-168`                                                                      |
| Source evidence    | `mcleod_settlements`, `_ap_vouchers`, `_deductions`, `_billing`, `_office_lines`, `_movements`, `_gl_accounts`, `_dispatch_movements/_stops`, `tms_*`, `load_external_payloads`   | `mcleod/financialIngest.ts`, `movementFactIngest.ts`, `ledgerControlIngest.ts`, `dispatchMovementIngest.ts` |
| Derived (ledger)   | `mcleod_gl_days` → `mcleod_gl_totals`, one plpgsql transaction                                                                                                                    | `replace_mcleod_gl_days` (0310), called from `ledgerControlIngest.ts:66`                                    |
| Canonical          | `financial_entries` from settlements, AP vouchers, billing **and EFS `fuel_transactions`**; key `(org_id, source, source_table, external_id)`                                     | `financial/projection.ts:195-310`, 0257:141                                                                 |
| Projection trigger | in-process daily, trailing 75 d; or the `financial_projection` job                                                                                                                | `projectionScheduler.ts:19`, `queue/handlers/financial.ts`                                                  |
| Harness            | `packages/shared/src/tmsCost/*` (`computeFleetReport`, `planMonthClose`) — no clock, I/O or vendor import                                                                         | `financial/fleetReport.ts:137`, `monthClose.ts:84`                                                          |
| Derived (close)    | `finance_month_closes`, upsert on `(org_id, company_id, period_start)`, from the 6-hourly freshness scheduler                                                                     | `monthClose.ts:151-153`, `financialFreshness.ts`                                                            |
| Readers            | `GET /api/accounting/*`; web `FleetReportPage`                                                                                                                                    | `accounting/routes/index.ts`, `apps/web/src/features/accounting/useFleetReport.ts`                          |

Not projected: deductions, office lines and movement facts are staged only. Nothing writes the `fleetpal`
or `manual` sources that 0257's check allows.

## Against the plan's invariants

1. **`mcleod_gl_totals` is not keyed by company (defect, latent).** The unique key is
   `(org_id, period_start, post_module, glid)` (0269:49) and the 0310 conflict branch sets
   `company_id = excluded.company_id`. A second McLeod company's month would overwrite the first one's
   totals. `financial/ledgerPeriod.ts:113` says the table "is keyed per company"; it is not. Latent
   because every staged row is company `TMS` (0303:53); McLeod holds four companies.
2. **The fleet report does not read the canonical record (D-APR2, APR4.3).** `/fleet-report` reads
   McLeod staging (settlements, billing, deductions, GL totals) and Samsara miles through readers
   (`fleetReport.ts:115-123`). Only `searchEntries`, `summarizeByCategory`, `apSpendByAccount` read
   `financial_entries`. Two money views come from different layers.
3. **The manual projection job uses 50 days, not 75 (D-FIN7).** The handler ignores the payload and
   hardcodes `50 * 86_400_000`; its comment says the window "arrives in the payload". The scheduler
   itself calls `projectFinancialWindow` with 75 and does not go through the job.
4. **Corrections overwrite; removals and some voids never reach the canonical record (D-APR4, Q4).**
   Staging upserts replace the whole row on `(org_id, external_id)`, so a McLeod correction lands and
   no prior value is kept. Settlement, deduction and movement voids arrive and flip the row (D-FIN5).
   AP vouchers arrive void-filtered (F5b), so a voucher voided after its first sweep stays in staging,
   and its projection is hardcoded `is_void: false` (`projection.ts:114`). Projection only upserts, in
   chunks of 500, and never deletes or un-canonicalises, so a row dropped upstream stays canonical.
   (Read from source; not reproduced with data.)
5. **A closed month freezes nothing.** A newer GL sweep recomputes the close; if a hardened month moved,
   office users get one critical notification per org per day (`monthClose.ts:156-178`). No version of
   the earlier close is kept.
6. **No generation or version on derived output (D-APR5, APR5.1).** `financial_entries`, the closes and
   the fleet report carry no engine version or input cutoff; projection is not atomic across chunks.
   `replace_mcleod_gl_days` is the one atomic derived write here.
7. **Time and money units.** Amounts are `numeric(14,2)`; `currency` exists only on `financial_entries`
   and is never set. `occurred_at` is org-local wall clock stored with a UTC label (0305); a missing
   `operating_hours.tz` falls back to `"UTC"` silently (`projection.ts:210`).
8. **No retention policy.** None of the 16 tables is in `RETENTION_RULES` or `RETENTION_FORBIDDEN`
   (DATA-LIFECYCLE-PLAN has not classified finance).
9. **Cross-module access.** `mcleod` writes the `loads`-owned `loads`, `load_stops`, `load_events`
   (`tmsLoadIngestWriters.ts`); `financial` reads fuel's `fuel_transactions` directly
   (`projection.ts:252`); `anomalies` reads `tms_movements` (`scoring/context.ts:434`).

## Not covered yet

- Whether settlement / voucher / billing `external_id`s are unique across McLeod companies (the
  staging keys assume so; 0303 states it only for the GL ledger).
- Fixtures for corrections, voids after first sweep, and multi-company months (APR0.2).
