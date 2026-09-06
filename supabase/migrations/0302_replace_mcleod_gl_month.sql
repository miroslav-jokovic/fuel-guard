-- Silvicom 360 — 0302 replace_mcleod_gl_month: one month of GL control totals replaced in ONE
-- statement (D-FIN6, docs/plans/financial/FINANCE-GO-LIVE-PLAN.md §1.6).
--
-- What gap. `mcleod_gl_totals` (0269) is a replace-set: each sweep upserts the month's rows under a
-- fresh `swept_at`, then deletes the month's rows bearing an older stamp, so a reclassified entry's
-- abandoned (module, account) row goes away. The API did that as two PostgREST calls. Two things
-- were wrong with it, and the 2026-09-03 audit named both:
--
--   1. A sweep that returned ZERO rows upserted nothing and then deleted every row of the month —
--      a transient empty read (wrong company id, a month past the data edge, a query that ran
--      before McLeod posted) erased the month's control totals and the CPM page's fleet truth with
--      them. The API reader now refuses an empty payload; this function refuses it too, because a
--      guard that lives only in one caller is a convention, and conventions are what D-FS1 says
--      never to rely on.
--   2. The two steps were not atomic. A crash between them left the month over-complete (old and
--      new rows together) with nothing to say so; a reader in that window summed a reclassified
--      account twice.
--
-- Why this shape. Set-based, tenant-scoped by ARGUMENT (never by a value inside the payload), the
-- 0174/0175 posture. `jsonb_to_recordset` types the rows at the boundary so a malformed payload
-- fails the whole call rather than landing half of it. The upsert and the stale delete share one
-- transaction and one stamp: either the month is replaced whole or nothing changed.
--
-- What was rejected. A trigger-maintained "current" flag (a second source of truth beside the
-- stamp); soft-deleting stale rows (the coverage report must never see them at all).
--
-- Deploy window. This file ships the FUNCTION ONLY. The API keeps its two-call path until this has
-- applied and moves onto the RPC one merge later — `lint:migration-ordering` cannot see a function,
-- so the ordering is held by hand (docs/MIGRATION-DISCIPLINE.md §the-deploy-window).
--
-- Rollback: drop the function. No data is migrated by this file.
-- raw-access-waiver: this function writes the mcleod raw staging table it names on behalf of the
-- mcleod collector, which is its only caller — the owning collector's own DDL, no cross-module read.

create or replace function public.replace_mcleod_gl_month(
  p_org uuid,
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
  -- Zero rows is a measurement of the source, never an instruction to empty the month.
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return query select 0, 0;
    return;
  end if;

  insert into public.mcleod_gl_totals
    (org_id, period_start, period_end, post_module, glid, line_count, net_amount, abs_amount, swept_at)
  select p_org, p_period_start, p_period_end, r.post_module, r.glid,
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
     set period_end = excluded.period_end,
         line_count = excluded.line_count,
         net_amount = excluded.net_amount,
         abs_amount = excluded.abs_amount,
         swept_at   = excluded.swept_at;
  get diagnostics v_upserted = row_count;

  delete from public.mcleod_gl_totals t
   where t.org_id = p_org
     and t.period_start = p_period_start
     and t.swept_at < v_swept_at;
  get diagnostics v_removed = row_count;

  return query select v_upserted, v_removed;
end;
$$;

revoke all on function public.replace_mcleod_gl_month(uuid, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.replace_mcleod_gl_month(uuid, date, date, jsonb) to service_role;

comment on function public.replace_mcleod_gl_month(uuid, date, date, jsonb) is
  'Replaces one org-month of mcleod_gl_totals atomically: upsert every row under one stamp, then delete the month''s older-stamped rows. An empty p_rows writes and deletes NOTHING (D-FIN6) — zero rows is a measurement of the source, never an instruction to empty the month. Service-role only; the McLeod financial ingest is its caller.';
