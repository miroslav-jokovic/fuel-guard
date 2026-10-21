-- Silvicom 360 — 0509 mcleod_gl_key_lines: the ledger staged per POSTING KEY for the four modules a
-- sub-ledger we stage posts through, so each tie-out is a join (TRUCK-DRIVER-PNL-PLAN §3 P0c).
--
-- What gap. Every tie between a sub-ledger and the general ledger is checked today as TWO TOTALS:
-- `mcleod_gl_days` holds (date, module, account) sums, and the ledger coverage report compares a
-- month's module total with the sum of the staged rows behind it. Two totals can agree while the rows
-- under them do not — a missing $900 bill and an extra $900 credit cancel — and when they disagree,
-- a total cannot say WHICH bill, settlement or fill is off. The per-truck P&L (P3) refuses a month
-- whose families do not tie, so the tie has to be able to name its exceptions.
--
-- McLeod already keys every posting. A sub-ledger row carries the `post_key` of the ledger posting
-- it made (`billing_history.post_key`, `drs_settle_hist.accrual_key` for SET and `.post_key` for
-- SETV, `fuel_detail_hist.post_key`), and the ledger lines of that posting carry it too. Measured on
-- the sandbox 2026-10-21 (company TMS, July 2026): no posting key in these four modules spans more
-- than one transaction date, and each key posts exactly ONE line to its control account —
--
--   module   lines   keys   control-account lines
--   BILL     3,364   1,522  12000000 receivable          1,522
--   SET      5,446   2,723  205000xx settlement payable  2,723 (2,654 company + 69 owner-operator)
--   SETV        92      46  20500010                       46
--   FUEL     8,200   2,274  20550000 fuel payable        2,274
--
-- — so a join on (module, key) is exact by construction, not by coincidence.
--
-- ── SHAPE ────────────────────────────────────────────────────────────────────────────────────────
-- One row per (org, company, module, key, account, date): the lines of one posting to one account,
-- summed. Every account of the posting is kept, not only the control account — which account is the
-- receivable or the payable is this carrier's chart of accounts, and choosing it is the reader's
-- decision (the collector makes no reporting decisions, D-FLEET9). July is 15,183 rows across the
-- four modules (BILL 3,326, SET 5,446, SETV 92, FUEL 6,319 key-account pairs); `mcleod_gl_days`
-- stays the whole-ledger control and is not replaced by this.
--
-- Only these four modules, deliberately. They are the modules with a sub-ledger staged beside them
-- (FUEL's, `fuel_detail`, is collector step C1 — FINANCE-GO-LIVE-PLAN; until it lands the FUEL key
-- lines wait for their join and the fuel tie stays the account-level F12). A module with no
-- sub-ledger has nothing to join a key to, and staging its keys would be volume with no reader.
--
-- `company_id` NOT NULL with an empty-string default, as in 0309: the books are per legal entity
-- (D-FIN8), and a nullable column cannot carry identity in a unique index.
--
-- Replaced a calendar month at a time by `replace_mcleod_gl_key_lines`, in one transaction under one
-- stamp, by the rules 0310 carries: rows dated outside the month are refused, the month's rows from
-- an older sweep are deleted, and ZERO ROWS NEVER DELETE (D-FIN6). Its caller ships one merge after
-- this has applied in production (`pnpm verify:live`): `lint:migration-ordering` cannot see a
-- function, and the deploy window would otherwise serve a caller of an RPC that does not exist yet.
--
-- Deny-all RLS on purpose: McLeod staging is service-role only and read through the financial
-- module's interface (D-SEP1, D-SEP7).
--
-- Rollback: drop the function, then the table. Nothing reads either until the caller merges.
--
-- raw-access-waiver: this file creates the mcleod raw staging table it names, and the function that
-- writes it, on behalf of the mcleod collector — the owning collector's own DDL, no cross-module read.
create table if not exists mcleod_gl_key_lines (
  id           uuid          not null default gen_random_uuid() primary key,
  org_id       uuid          not null references organizations(id) on delete cascade,
  company_id   text          not null default '',
  txn_date     date          not null,
  post_module  text          not null,
  post_key     text          not null,
  glid         text          not null,
  line_count   integer       not null default 0,
  net_amount   numeric(16,2) not null default 0,
  swept_at     timestamptz   not null default now(),
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now()
);

-- The replace's identity. Module before key: McLeod's keys are per-module sequences, so the same key
-- string in two modules is two postings.
create unique index if not exists mcleod_gl_key_lines_identity
  on mcleod_gl_key_lines (org_id, company_id, post_module, post_key, glid, txn_date);
-- The read path: one module's keys over one period.
create index if not exists idx_mcleod_gl_key_lines_org_module_date
  on mcleod_gl_key_lines (org_id, post_module, txn_date);

alter table mcleod_gl_key_lines enable row level security;

comment on table mcleod_gl_key_lines is
  'McLeod general ledger per POSTING KEY for BILL, SET, SETV and FUEL (TRUCK-DRIVER-PNL-PLAN P0c): one row per (company, module, key, account, date), so a sub-ledger ties to the ledger by join rather than by total. Replaced a month at a time by replace_mcleod_gl_key_lines. Service-role only.';

create or replace function public.replace_mcleod_gl_key_lines(
  p_org          uuid,
  p_company_id   text,
  p_period_start date,
  p_period_end   date,
  p_rows         jsonb
)
returns table (upserted integer, stale_removed integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_swept_at timestamptz := clock_timestamp();
  v_company  text := coalesce(p_company_id, '');
  v_up       int := 0;
  v_rm       int := 0;
begin
  -- Zero rows is a measurement of the source, never an instruction to empty the month (D-FIN6).
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return query select 0, 0;
    return;
  end if;

  -- Rows outside the month being replaced are refused rather than written: the stale delete below is
  -- scoped to [p_period_start, p_period_end), so a row dated outside it would be inserted and then
  -- never cleaned up by any later sweep of its own month.
  insert into public.mcleod_gl_key_lines
    (org_id, company_id, txn_date, post_module, post_key, glid, line_count, net_amount, swept_at)
  select p_org, v_company, r.txn_date, r.post_module, r.post_key, r.glid,
         coalesce(r.lines, 0), coalesce(r.net_amount, 0), v_swept_at
    from jsonb_to_recordset(p_rows) as r(
           txn_date    date,
           post_module text,
           post_key    text,
           glid        text,
           lines       integer,
           net_amount  numeric(16,2)
         )
   where r.post_module is not null
     and r.post_key is not null
     and r.glid is not null
     and r.txn_date is not null
     and r.txn_date >= p_period_start
     and r.txn_date <  p_period_end
  on conflict (org_id, company_id, post_module, post_key, glid, txn_date) do update
     set line_count = excluded.line_count,
         net_amount = excluded.net_amount,
         swept_at   = excluded.swept_at,
         updated_at = now();
  get diagnostics v_up = row_count;

  -- The whole month for this company, every module: the sweep is the month's complete assertion, so
  -- a posting that was reversed out of existence, or a module that posted nothing this time, loses
  -- its old rows rather than keeping them beside the new ones.
  delete from public.mcleod_gl_key_lines k
   where k.org_id = p_org
     and k.company_id = v_company
     and k.txn_date >= p_period_start
     and k.txn_date <  p_period_end
     and k.swept_at < v_swept_at;
  get diagnostics v_rm = row_count;

  return query select v_up, v_rm;
end;
$$;

revoke all on function public.replace_mcleod_gl_key_lines(uuid, text, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.replace_mcleod_gl_key_lines(uuid, text, date, date, jsonb) to service_role;

comment on function public.replace_mcleod_gl_key_lines(uuid, text, date, date, jsonb) is
  'Replaces one org-company-month of mcleod_gl_key_lines in one transaction under one stamp. Rows dated outside the month are refused. An empty p_rows writes and deletes NOTHING (D-FIN6). Service-role only; the McLeod financial ingest is the caller.';
