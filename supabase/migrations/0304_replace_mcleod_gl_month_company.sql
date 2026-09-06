-- Silvicom 360 — 0304 replace_mcleod_gl_month takes the company (D-FIN6 + D-FIN8,
-- docs/plans/financial/FINANCE-GO-LIVE-PLAN.md §1.6, §1.8). FUNCTION ONLY — the reader follows.
--
-- What gap. 0302 shipped the one-statement month replace before 0303 gave the staging tables a
-- `company_id`. Called as it stands, it would write GL month totals with no company (the writers
-- now send one) and its stale delete would remove EVERY row of the org-month bearing an older
-- stamp — a TMS sweep would erase TMS2's June. The books are per legal entity; so is the replace.
--
-- Why a new signature rather than `create or replace`. Postgres overloads by argument list, so
-- `create or replace` with a fifth parameter would leave the four-argument function standing
-- beside it, and a caller that forgot the company would silently keep working on the old one.
-- The old function is dropped in the same transaction; the reader that calls the new one ships
-- one merge after this has applied (`lint:migration-ordering` cannot see a function).
--
-- The stale delete keeps the company's rows and the rows with NO company: a row written by the
-- previous build during the deploy window carries none, and it is exactly the row a re-sweep must
-- replace. It never touches another company's rows.
--
-- Rollback: drop this function and re-create 0302's. No data is migrated by this file.
-- raw-access-waiver: this function writes the mcleod raw staging table it names on behalf of the
-- mcleod collector, which is its only caller — the owning collector's own DDL, no cross-module read.

drop function if exists public.replace_mcleod_gl_month(uuid, date, date, jsonb);

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
  on conflict (org_id, period_start, post_module, glid) do update
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

revoke all on function public.replace_mcleod_gl_month(uuid, text, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.replace_mcleod_gl_month(uuid, text, date, date, jsonb) to service_role;

comment on function public.replace_mcleod_gl_month(uuid, text, date, date, jsonb) is
  'Replaces one org-company-month of mcleod_gl_totals atomically: upsert every row under one stamp, then delete the month''s older-stamped rows for that company (and rows carrying no company). An empty p_rows writes and deletes NOTHING (D-FIN6). Service-role only; the McLeod financial ingest is its caller.';
