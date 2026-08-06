-- 0132 — harden record_hazmat_run (independent audit, 2026-08-06). Replaces the 0130 body;
-- signature unchanged, so this is a safe `create or replace` (0130 must already be applied).
--
-- Fix 1 (abort-path duplicate-run collision): the run insert is now `on conflict (id) do nothing`,
-- and the counter is incremented ONLY when a row was actually inserted (GET DIAGNOSTICS row_count).
-- A replay of an already-recorded runId (e.g. the extraction catch re-calling finish() after the
-- main insert committed) now returns cleanly instead of raising a PK violation — so the caller does
-- not throw inside its catch and can safely retry the load transition + reviewer notification, and
-- the monthly counter is never double-counted.
--
-- Fix 2 (timezone-sensitive budget bucket): the month bucket is pinned to UTC
-- (`now() at time zone 'UTC'`) so it can never split from the app's UTC read key
-- (`new Date().toISOString().slice(0,7)`), regardless of the DB session TimeZone.

create or replace function public.record_hazmat_run(
  p_id              uuid,
  p_org_id          uuid,
  p_load_id         uuid,
  p_engine_version  text,
  p_dataset_version text,
  p_verdict         jsonb,
  p_outcome         text,
  p_flags           jsonb,
  p_advisories      jsonb,
  p_extraction      jsonb,
  p_models          jsonb,
  p_input_hash      text,
  p_input_tokens    bigint  default 0,
  p_output_tokens   bigint  default 0,
  p_qualification   jsonb   default null
) returns void
language plpgsql
as $$
declare
  v_rows integer;
begin
  insert into public.hazmat_runs
    (id, org_id, load_id, engine_version, dataset_version, verdict, outcome, flags,
     advisories, extraction, models, input_hash, qualification)
  values
    (p_id, p_org_id, p_load_id, p_engine_version, p_dataset_version, p_verdict, p_outcome,
     coalesce(p_flags, '[]'::jsonb), coalesce(p_advisories, '[]'::jsonb), p_extraction, p_models,
     p_input_hash, p_qualification)
  on conflict (id) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- runId already recorded (abort-path replay): do NOT double-count the counter; return success so
    -- the caller does not throw and can retry the transition/notification it was mid-way through.
    return;
  end if;

  insert into public.org_usage_month (org_id, yyyymm, input_tokens, output_tokens, runs)
  values (p_org_id, to_char((now() at time zone 'UTC'), 'YYYY-MM'),
          coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0), 1)
  on conflict (org_id, yyyymm) do update
    set input_tokens  = org_usage_month.input_tokens  + excluded.input_tokens,
        output_tokens = org_usage_month.output_tokens + excluded.output_tokens,
        runs          = org_usage_month.runs + 1,
        updated_at    = now();
end;
$$;
