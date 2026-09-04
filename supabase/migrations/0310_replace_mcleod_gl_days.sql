-- Silvicom 360 — 0310 replace_mcleod_gl_days: one statement stages a month at DAILY grain and
-- derives the monthly rollup from it (W1, D-FLEET9). FUNCTION ONLY — the caller follows one merge
-- later, as 0304's did.
--
-- What it does, and why in one function. The sweep still fetches a calendar month whole, because a
-- month is the unit the carrier's close uses and re-sweeping a month whole is how McLeod's ~1-month
-- entry lag flows through (D-FIN6). What changes is what lands: every (date, module, account) row
-- the source asserts, plus the SAME rows summed into `mcleod_gl_totals` so the month keeps its
-- meaning for every reader that has not moved yet.
--
-- Deriving the rollup here rather than sweeping it twice is the whole point. Two sweeps of the same
-- ledger at two grains are two assertions that can disagree — a reclassified entry landing in one
-- and not the other, a partial write between them — and reconciling them would be a job nobody
-- asked for. One transaction, one stamp, one assertion from the source: the daily rows. The monthly
-- table becomes a materialisation of them.
--
-- The stale delete is the same rule 0302 introduced and 0304 scoped to the company: a reclassified
-- entry MOVES money between accounts, so an upsert alone would leave the old account's total
-- standing beside the new one's. Both grains get the same treatment under the same stamp.
--
-- ZERO ROWS NEVER DELETE (D-FIN6). An empty read is a measurement of the source — a wrong company
-- id, a month past the sandbox's data edge, a query that ran before the ledger posted — and it once
-- erased a month's control totals and took the report's fleet truth with them. It writes and
-- deletes nothing, and returns zeros for the caller to surface.
--
-- Rollback: drop this function. `mcleod_gl_days` keeps whatever it holds and no reader depends on
-- it yet; `replace_mcleod_gl_month` is untouched and still the live path.
--
-- raw-access-waiver: this function writes the two mcleod raw staging tables it names on behalf of
-- the mcleod collector, which is its only caller — the owning collector's own DDL, no cross-module
-- read.

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
  on conflict (org_id, period_start, post_module, glid) do update
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

revoke all on function public.replace_mcleod_gl_days(uuid, text, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.replace_mcleod_gl_days(uuid, text, date, date, jsonb) to service_role;

comment on function public.replace_mcleod_gl_days(uuid, text, date, date, jsonb) is
  'Replaces one org-company-month of mcleod_gl_days at daily grain and derives the mcleod_gl_totals rollup from the same rows, in one transaction under one stamp. Rows dated outside the month are refused. An empty p_rows writes and deletes NOTHING (D-FIN6). Service-role only; the McLeod financial ingest is its caller.';
