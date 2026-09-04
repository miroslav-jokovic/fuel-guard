-- Silvicom 360 — 0309 mcleod_gl_days: the ledger staged at the grain the SOURCE asserts (W1,
-- D-FLEET9, docs/plans/financial/FINANCE-FLEET-REPORT-PLAN.md §1.8.1).
--
-- What gap. `gl_ledger.transaction_date` is on every line McLeod holds, and our collector throws it
-- away: `GL_CONTROL_TOTALS` groups by `(post_module, glid)` over a window, and the agent calls it
-- once per calendar month. **The monthly grain is ours, not the source's** — a collector making a
-- reporting decision, which is exactly what D-FLEET9 forbids. Every later question about a
-- different period (a week, a quarter, a custom range) then becomes a schema change instead of a
-- different SUM.
--
-- Volume is not the reason it was monthly and is not a reason to keep it: July's whole expense side
-- is 10,254 ledger lines, so daily grain is bounded by that and lands near 2,000 rows a month
-- against the ~140 stored today.
--
-- Why a NEW TABLE rather than a date column on `mcleod_gl_totals`. Three reasons, in order of
-- weight. A new table is exempt from the deploy-window's two-merge rule (docs/MIGRATION-DISCIPLINE
-- §the-deploy-window) because its readers are new code paths, so nothing that is serving traffic
-- can break on it. Adding a nullable date to the existing table would leave two grains in one
-- table — month rows with no date beside day rows with one — and every reader would have to know
-- which it was looking at. And the monthly rows do not disappear here: they become a DERIVED
-- rollup of these (see 0310's function), so there is one assertion from the source and one
-- materialisation of it, rather than two sweeps that can disagree.
--
-- The unique key is (org, company, date, module, account), and `company_id` is NOT NULL with an
-- empty-string default rather than nullable. That is a deliberate correction, not a copy: the
-- monthly table's key is (org, period, module, account) with the company left out, so two legal
-- entities posting the same account in the same module in the same period collide and the second
-- sweep overwrites the first. 0304 works around it by scoping the stale DELETE to the company,
-- which stops one company erasing another's rows but does not stop the overwrite. The books are per
-- legal entity (D-FIN8), so the company belongs IN the identity — and a nullable column cannot
-- carry it, because Postgres treats NULLs as distinct in a unique index, so two "no company" rows
-- for the same day and account would both insert. This carrier stages one company today; the point
-- is that the second one does not have to be a migration.
--
-- No CHECK on the date beyond NOT NULL, deliberately. 0271 constrained `effective_from` to the
-- first of a month and the RLS matrix's generic seeder could not satisfy it, which cost that table
-- a hand-written seeder; a staging table should be seedable by anything that can write a row.
--
-- Deny-all RLS on purpose: the McLeod staging tables are service-role only and read through the
-- financial module's own interface (D-SEP1, D-SEP7).
--
-- raw-access-waiver: this file creates the mcleod raw staging table it names, on behalf of the
-- mcleod collector — the owning collector's own DDL, no cross-module read.
create table if not exists mcleod_gl_days (
  id           uuid        not null default gen_random_uuid() primary key,
  org_id       uuid        not null references organizations(id) on delete cascade,
  company_id   text        not null default '',
  txn_date     date        not null,
  post_module  text        not null,
  glid         text        not null,
  line_count   integer     not null default 0,
  net_amount   numeric(16,2) not null default 0,
  abs_amount   numeric(18,2) not null default 0,
  swept_at     timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The replace's own identity, and the read path's index: a period is a range of these dates.
create unique index if not exists mcleod_gl_days_identity
  on mcleod_gl_days (org_id, company_id, txn_date, post_module, glid);
create index if not exists idx_mcleod_gl_days_org_date
  on mcleod_gl_days (org_id, txn_date);

alter table mcleod_gl_days enable row level security;

comment on table mcleod_gl_days is
  'McLeod general ledger staged at DAILY grain — the grain gl_ledger.transaction_date asserts (W1, D-FLEET9). mcleod_gl_totals is a monthly rollup derived from these rows, not a second sweep. Service-role only.';
