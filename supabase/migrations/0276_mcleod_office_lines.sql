-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_office_lines — office payroll at the grain McLeod actually keeps it: per person
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- The owner asked on 2026-08-28 for the Fixed costs page to show what the company actually spends,
-- naming office employees specifically. That cost is $194,407.20 a month (June 2026, account
-- "Subcontracted Labor: Office") and until now the store could only ever show it as one number,
-- because `mcleod_gl_totals` (0269) is an AGGREGATE — month × posting module × account — and there
-- is no table anywhere holding an individual ledger line.
--
-- The detail exists and we were already reading it. `OFFICE_SETTLEMENT_LINES` has been in the
-- agent since C4, fetched on every `--financial` pass for the ledger-control report, and then
-- discarded. Measured June 2026: 318 lines, **318 of them carrying a payee**, 31 distinct people.
-- So this migration persists a query we already run rather than opening a new seam into McLeod.
--
-- Why the OFF module specifically. Of the twelve modules that post expense, four already reach the
-- store at payee grain through their own subledger — SET and DRS through settlements and
-- deductions, AP through vouchers with a vendor. OFF is the one that does NOT have a subledger:
-- 0257 recorded that office payroll posts STRAIGHT TO THE LEDGER, so the GL line is the record and
-- there is nothing else to collect it from. GJ and RJ carry no payee at all ($609,465 and $131,941
-- in June), so lease, insurance and officer salaries stay company-level facts — that is McLeod's
-- limit, not ours, and the page says so rather than inventing a split.
--
-- `descr` is stored verbatim and must NOT be parsed. It reads like "ARKADZIO, Office Payroll" — a
-- payee code and a label in 40 truncated characters — and D-MC12 forbids the extraction layer from
-- inventing an attribution McLeod does not assert. `payee_id` is the assertion; `descr` is context
-- for a human reading a row.
create table if not exists mcleod_office_lines (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  -- gl_ledger.id — the line's own key, so a re-swept window updates rather than duplicates.
  external_id    text not null,
  payee_id       text,
  glid           text,
  descr          text,
  amount         numeric(14,2) not null default 0,
  transacted_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The sweep re-reads a rolling window and upserts on the line's own identity.
create unique index if not exists uq_mcleod_office_lines
  on mcleod_office_lines (org_id, external_id);

-- The page groups a month's office cost by person; without this it scans every line ever swept.
create index if not exists idx_mcleod_office_lines_payee
  on mcleod_office_lines (org_id, transacted_at, payee_id);

alter table mcleod_office_lines enable row level security;

-- No client policies: deny-all on purpose. The finance surface reads with the service role through
-- `modules/financial` like every other money table (D-SEP7), and payroll per named person is not a
-- thing a browser session should be able to select directly.

-- raw-access-waiver: this migration CREATES the mcleod raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
