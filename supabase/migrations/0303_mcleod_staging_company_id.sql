-- Silvicom 360 — 0303 company_id on the McLeod financial staging tables (D-FIN8,
-- docs/plans/financial/FINANCE-GO-LIVE-PLAN.md §1.8). COLUMN ONLY — the writers follow one merge later.
--
-- What gap. Every financial payload row the agent posts carries McLeod's `company_id` (the agent's
-- SQL filters on it), and every staging table dropped it at the door: tenant identity came from the
-- ingest token alone. The books are per legal entity — `dbo.company` holds four (TMS Silvicom, Inc.;
-- TMS2 Silvicom Logistics; TMS3 JVM Freight Group; TMS4 VIP Equipment Holding) — so a per-entity
-- tie-out (D-FIN14) had nothing to group by, and the monthly close could only ever be one blended
-- number.
--
-- What was measured before deciding the shape (sandbox, 2026-09-03):
--   · `drs_settle_hist`, `drs_deduct_hist`, `voucher`, `voucher_hist`, `billing_history` and
--     `gl_ledger` ids are unique per INSTANCE — distinct id = row count across all companies — so
--     the existing (org_id, external_id) keys on those tables cannot collide between entities.
--   · `movement.id` is NOT: 296,242 rows, 277,481 distinct ids, 18,761 repeat across companies.
--     A sweep of a second company would overwrite the first's trips under the current key.
--     The key change is therefore movements-only and comes AFTER every row carries a company
--     (a later migration; this file adds the column the key will need).
--   · Every staged row in production belongs to one tenant and, sampled 400 rows per table
--     against the sandbox, to company TMS (400/400 movements — plus one id that also exists as a
--     TMS2 trip, the collision class above — 400/400 settlements, 400/400 billing). The backfill
--     below writes that measured value onto rows that predate the column; it is a fact about
--     this deployment's data, not a default for future rows, which the agent supplies.
--
-- Why nullable and no default. A row inserted by the previous build during the deploy window
-- (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) arrives without the column; NULL is the honest
-- value for "the writer did not say", and the next sweep of that window replaces the row whole
-- (full-row upsert) with the company set. A default would label a row the source never labelled.
--
-- What was rejected. Deriving company from the token (a token is an org, an org has several
-- companies); a per-company ingest token (four agents for one carrier).
--
-- Rollback: drop the seven columns. No other data is migrated by this file.
-- raw-access-waiver: this migration widens the mcleod raw staging tables it names — the owning
-- collector's own DDL, no cross-module read.

alter table mcleod_settlements  add column if not exists company_id text;
alter table mcleod_deductions   add column if not exists company_id text;
alter table mcleod_ap_vouchers  add column if not exists company_id text;
alter table mcleod_movements    add column if not exists company_id text;
alter table mcleod_billing      add column if not exists company_id text;
alter table mcleod_gl_totals    add column if not exists company_id text;
alter table mcleod_office_lines add column if not exists company_id text;

comment on column mcleod_settlements.company_id  is 'McLeod company_id of the row (0303, D-FIN8): the legal entity whose books it belongs to. NULL only for a row written by a build that predates the writer.';
comment on column mcleod_deductions.company_id   is 'McLeod company_id of the row (0303, D-FIN8).';
comment on column mcleod_ap_vouchers.company_id  is 'McLeod company_id of the row (0303, D-FIN8).';
comment on column mcleod_movements.company_id    is 'McLeod company_id of the row (0303, D-FIN8). movement.id repeats across companies, so this column will join the unique key once every row carries it.';
comment on column mcleod_billing.company_id      is 'McLeod company_id of the row (0303, D-FIN8).';
comment on column mcleod_gl_totals.company_id    is 'McLeod company_id the month totals were swept for (0303, D-FIN8).';
comment on column mcleod_office_lines.company_id is 'McLeod company_id of the payroll line (0303, D-FIN8).';

-- The measured backfill (see header): every pre-existing staged row is company TMS.
update mcleod_settlements  set company_id = 'TMS' where company_id is null;
update mcleod_deductions   set company_id = 'TMS' where company_id is null;
update mcleod_ap_vouchers  set company_id = 'TMS' where company_id is null;
update mcleod_movements    set company_id = 'TMS' where company_id is null;
update mcleod_billing      set company_id = 'TMS' where company_id is null;
update mcleod_gl_totals    set company_id = 'TMS' where company_id is null;
update mcleod_office_lines set company_id = 'TMS' where company_id is null;

-- The per-entity read the tie-out will make: one org, one company, one month.
create index if not exists idx_mcleod_gl_totals_company
  on mcleod_gl_totals (org_id, company_id, period_start desc);
