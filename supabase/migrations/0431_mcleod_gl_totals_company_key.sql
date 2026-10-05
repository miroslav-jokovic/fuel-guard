-- 0431: `mcleod_gl_totals` is unique per COMPANY, as `mcleod_gl_days` already is (0309).
--
-- 0269 keyed the monthly rollup on (org_id, period_start, post_module, glid). 0303 added company_id
-- and 0304/0310 wrote it, but the conflict target stayed the old key and the update branch sets
-- `company_id = excluded.company_id`. So a second McLeod company sweeping the same month replaced the
-- first company's total for every account both post to, and the stale delete then had nothing of the
-- first company's left to keep. The readers already expect one row per company (`ledgerPeriod.ts`
-- takes the OLDEST sweep across a month's companies; `financialReads` sums every row of a period).
--
-- Latent today: every staged row is company 'TMS' (0303's measured backfill), McLeod holds four.
-- Proven by `supabase/tests/mcleod-gl-day-replace.test.mjs` §5, which fails before this migration.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────────────────────────────
-- 1. A unique index on (org_id, company_id, period_start, post_module, glid). It cannot fail on
--    existing rows: it is the old unique key plus a column.
-- 2. Both writers' conflict targets move to it. `replace_mcleod_gl_days` (0310) is the live one;
--    `replace_mcleod_gl_month` (0304) is unused but left standing (ledgerControlIngest.ts header), and
--    without this its ON CONFLICT would name a key that no longer exists. Bodies are otherwise 0310's
--    and 0304's verbatim; CREATE OR REPLACE keeps their grants and comments.
-- 3. The old unique index is dropped LAST, so there is no moment without a unique key.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md) ─────────────────────────────────────────────────
-- No application change: the RPC signatures are identical, so the build before and after this
-- migration call the same functions. One transaction. The CREATE UNIQUE INDEX blocks writes to a
-- table holding one row per (company, month, module, account), written by a nightly sweep.
--
-- Rollback: recreate `uq_mcleod_gl_totals_key` and restore 0304/0310's function bodies — only
-- possible while every (org, month, module, account) still has a single company.
--
-- raw-access-waiver: these functions write the mcleod raw staging tables they name on behalf of the
-- mcleod collector, their only caller (as in 0304 and 0310).

create unique index if not exists uq_mcleod_gl_totals_company_key
  on public.mcleod_gl_totals (org_id, company_id, period_start, post_module, glid);

create or replace function public.replace_mcleod_gl_days(
  p_org uuid,
  p_company_id text,
  p_period_start date,
  p_period_end date,
  p_rows jsonb
)
returns table (day_upserted integer, day_stale_removed integer, month_upserted integer, month_stale_removed integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_swept_at timestamptz := clock_timestamp();
  v_company  text := coalesce(p_company_id, '');
  v_day_up   int := 0;
  v_day_rm   int := 0;
  v_mon_up   int := 0;
  v_mon_rm   int := 0;
begin
  -- Zero rows is a measurement of the source, never an instruction to empty the month (D-FIN6).
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return query select 0, 0, 0, 0;
    return;
  end if;

  -- ── The source's own grain ──────────────────────────────────────────────────────────────────
  -- Rows outside the month being replaced are refused rather than written: the stale delete below
  -- is scoped to [p_period_start, p_period_end), so a row dated outside it would be inserted and
  -- then never cleaned up by any later sweep of its own month.
  insert into public.mcleod_gl_days
    (org_id, company_id, txn_date, post_module, glid, line_count, net_amount, abs_amount, swept_at)
  select p_org, v_company, r.txn_date, r.post_module, r.glid,
         coalesce(r.lines, 0), coalesce(r.net_amount, 0), coalesce(r.abs_amount, 0), v_swept_at
    from jsonb_to_recordset(p_rows) as r(
           txn_date    date,
           post_module text,
           glid        text,
           lines       integer,
           net_amount  numeric(16,2),
           abs_amount  numeric(18,2)
         )
   where r.post_module is not null
     and r.glid is not null
     and r.txn_date is not null
     and r.txn_date >= p_period_start
     and r.txn_date <  p_period_end
  on conflict (org_id, company_id, txn_date, post_module, glid) do update
     set line_count = excluded.line_count,
         net_amount = excluded.net_amount,
         abs_amount = excluded.abs_amount,
         swept_at   = excluded.swept_at,
         updated_at = now();
  get diagnostics v_day_up = row_count;

  delete from public.mcleod_gl_days d
   where d.org_id = p_org
     and d.company_id = v_company
     and d.txn_date >= p_period_start
     and d.txn_date <  p_period_end
     and d.swept_at < v_swept_at;
  get diagnostics v_day_rm = row_count;

  -- ── The monthly rollup, derived from exactly those rows ─────────────────────────────────────
  -- Summed from the table rather than from p_rows so that what the month says is what the days
  -- hold: if the insert above refused a row, the rollup refuses it too, and the two grains cannot
  -- drift apart within a single sweep.
  insert into public.mcleod_gl_totals
    (org_id, company_id, period_start, period_end, post_module, glid, line_count, net_amount, abs_amount, swept_at)
  select p_org, v_company, p_period_start, p_period_end, d.post_module, d.glid,
         sum(d.line_count), sum(d.net_amount), sum(d.abs_amount), v_swept_at
    from public.mcleod_gl_days d
   where d.org_id = p_org
     and d.company_id = v_company
     and d.txn_date >= p_period_start
     and d.txn_date <  p_period_end
   group by d.post_module, d.glid
  on conflict (org_id, company_id, period_start, post_module, glid) do update
     set company_id = excluded.company_id,
         period_end = excluded.period_end,
         line_count = excluded.line_count,
         net_amount = excluded.net_amount,
         abs_amount = excluded.abs_amount,
         swept_at   = excluded.swept_at;
  get diagnostics v_mon_up = row_count;

  -- The same rule 0304 carries: keep this company's rows and the rows with NO company (written by
  -- an older build during a deploy window), never another company's.
  delete from public.mcleod_gl_totals t
   where t.org_id = p_org
     and t.period_start = p_period_start
     and (t.company_id = v_company or t.company_id is null)
     and t.swept_at < v_swept_at;
  get diagnostics v_mon_rm = row_count;

  return query select v_day_up, v_day_rm, v_mon_up, v_mon_rm;
end;
$$;

create or replace function public.replace_mcleod_gl_month(
  p_org uuid,
  p_company_id text,
  p_period_start date,
  p_period_end date,
  p_rows jsonb
)
returns table (upserted integer, stale_removed integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_swept_at timestamptz := clock_timestamp();
  v_upserted int := 0;
  v_removed  int := 0;
begin
  -- Zero rows is a measurement of the source, never an instruction to empty the month (D-FIN6).
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return query select 0, 0;
    return;
  end if;

  insert into public.mcleod_gl_totals
    (org_id, company_id, period_start, period_end, post_module, glid, line_count, net_amount, abs_amount, swept_at)
  select p_org, p_company_id, p_period_start, p_period_end, r.post_module, r.glid,
         coalesce(r.lines, 0), coalesce(r.net_amount, 0), coalesce(r.abs_amount, 0), v_swept_at
    from jsonb_to_recordset(p_rows) as r(
           post_module text,
           glid        text,
           lines       integer,
           net_amount  numeric(16,2),
           abs_amount  numeric(18,2)
         )
   where r.post_module is not null and r.glid is not null
  on conflict (org_id, company_id, period_start, post_module, glid) do update
     set company_id = excluded.company_id,
         period_end = excluded.period_end,
         line_count = excluded.line_count,
         net_amount = excluded.net_amount,
         abs_amount = excluded.abs_amount,
         swept_at   = excluded.swept_at;
  get diagnostics v_upserted = row_count;

  delete from public.mcleod_gl_totals t
   where t.org_id = p_org
     and t.period_start = p_period_start
     and (t.company_id = p_company_id or t.company_id is null)
     and t.swept_at < v_swept_at;
  get diagnostics v_removed = row_count;

  return query select v_upserted, v_removed;
end;
$$;

drop index if exists public.uq_mcleod_gl_totals_key;
