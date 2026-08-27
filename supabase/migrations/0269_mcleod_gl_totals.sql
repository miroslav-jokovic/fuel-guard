-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_gl_totals — per-month general-ledger control totals, by posting module and account
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- The gap this closes: the owner's standing suspicion that entries are missing from the books
-- ("there is some missing entries", 2026-08-27) has had no instrument. The GL control sweep
-- (ledger.mjs) computes exactly the right evidence — lines, net and absolute amount per
-- (post_module, glid) — and then prints it to a terminal and exits. Staged per calendar month, the
-- totals become the thing every subledger extraction is CHECKED AGAINST, month by month, account by
-- account: if the SET module moved more than mcleod_settlements holds for the same month, rows are
-- missing, and only the books can say so (D-MC12: the ledger is the control total, never a cost input
-- — gl_ledger.tractor is populated on 0 of 188,179 lines, so nothing here attributes to trucks).
--
-- Month-grained on purpose, where the row-level staging sweeps use rolling day windows: control
-- totals are AGGREGATES over a period, so the period must be a stable unit or every re-sweep mints
-- overlapping windows nothing reconciles against. The month is the carrier's own close unit. A
-- month is re-swept while McLeod's late manual entry (~1 month of lag, owner-stated) is still
-- landing, and each re-sweep REPLACES the month wholesale — including deleting rows whose
-- (post_module, glid) vanished, because a reclassified entry moves money BETWEEN accounts and a
-- pure upsert would leave the old account's stale total standing next to the new one's.
--
-- `net_amount` for a complete module is zero BY CONSTRUCTION (double-entry); `abs_amount / 2` is
-- the module's one-sided value. Both are stored so a nonzero net can flag a period swept
-- mid-posting. The lifecycle warning travels with the data: modules are views of the SAME dollars
-- (SET accrues what DRS pays; AP contains the invoices FUEL already booked), so these rows must
-- never be summed across modules into "total spend" (D-MC13).
create table if not exists mcleod_gl_totals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,

  period_start  date not null,                       -- first day of month
  period_end    date not null,                       -- first day of NEXT month, half-open

  post_module   text not null,                       -- BILL, AP, SET, DRS, FUEL, CASH, GJ, OFF, …
  glid          text not null,                       -- the account within the module

  line_count    integer not null default 0,
  net_amount    numeric(16,2) not null default 0,
  abs_amount    numeric(18,2) not null default 0,

  -- The replace-set clock: each sweep stamps its batch, then deletes the month's rows bearing an
  -- older stamp (the discountRules upsert-then-delete-stale pattern, keyed by time instead of a
  -- composite keep-list).
  swept_at      timestamptz not null default now(),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists uq_mcleod_gl_totals_key
  on mcleod_gl_totals (org_id, period_start, post_module, glid);
create index if not exists idx_mcleod_gl_totals_period
  on mcleod_gl_totals (org_id, period_start desc, post_module);

create trigger trg_mcleod_gl_totals_updated before update on mcleod_gl_totals
  for each row execute function set_updated_at();

-- Service-role only, like every mcleod staging table (ARCHITECTURE §6 raw-layer seal); the
-- coverage report reaches clients through the accounting section's role-gated API, never directly.
alter table mcleod_gl_totals enable row level security;

-- raw-access-waiver: this migration CREATES the mcleod raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
