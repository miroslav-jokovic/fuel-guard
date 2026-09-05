-- A processing run interrupted mid-scoring is stranded forever, and the auto-clear it owed never runs.
--
-- `claim_efs_processing_run` (0159) claims only `pending` / `failed`, and efsProcessingScheduler.ts
-- selects only those two. Nothing writes `running` back: processEfsProcessingRun sets `succeeded` or
-- `failed`, so a run whose process is interrupted between the claim and either write keeps `status =
-- 'running'`, `scoring_completed_at null`, `last_error null` — indistinguishable from a run that is
-- working, and invisible to every retry path there is. Measured on production 2026-09-05: 58 runs
-- stranded that way, the oldest since 2026-08-09.
--
-- The cost is not just the unscored import. `reconcileCardMultiForOrg` is the LAST statement of
-- `scoreImportWithCascade` — the auto-clear that dismisses "one card fueled two trucks" cases Samsara
-- explains as one driver changing trucks. A stranded run never reaches it, which is why 5 open
-- card_multi_vehicle cases satisfy the auto-clear's own condition today and are still open.
--
-- So: a lease. A `running` run whose scoring started longer ago than the lease is reclaimable. The
-- interval is measured, not guessed — across 4,260 successful runs on production, scoring took avg
-- 40s, p95 142s, max 519s, so 30 minutes is ~3.5x the worst observed run and cannot reclaim a run
-- that is merely slow. Reclaiming counts as an attempt, so the existing backoff ladder applies.
--
-- Ships in one merge with its TS reader by design (the deploy window in CLAUDE.md): both directions
-- degrade to today's behaviour. New scheduler + old function → the stale id is dispatched, the old
-- claim refuses it, the handler returns `skipped`. New function + old scheduler → nothing ever hands
-- it a stale id. Neither order can misbehave, so the two-merge dance buys nothing here.

create or replace function public.claim_efs_processing_run(p_id uuid)
returns setof public.efs_processing_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.efs_processing_runs;
begin
  select * into v_row
    from public.efs_processing_runs
   where id = p_id
     and (
       (status in ('pending', 'failed') and next_attempt_at <= now())
       -- Stranded mid-scoring: the worker that held it is gone. `scoring_started_at` is stamped by
       -- this same function on claim, so it is never null for a `running` row; coalesce to
       -- updated_at anyway rather than let a null silently make a row unreclaimable forever, which
       -- is the exact failure this migration exists to end.
       or (status = 'running'
           and coalesce(scoring_started_at, updated_at) < now() - interval '30 minutes')
     )
   for update skip locked;

  if v_row.id is null then
    return;
  end if;

  update public.efs_processing_runs
     set status = 'running',
         attempts = attempts + 1,
         scoring_started_at = now(),
         last_error = null,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  return next v_row;
end $$;

revoke all on function public.claim_efs_processing_run(uuid) from public;
grant execute on function public.claim_efs_processing_run(uuid) to service_role;

comment on function public.claim_efs_processing_run(uuid) is
  'Atomically claims one due EFS processing run with row locking; also reclaims a run stranded in running for over 30 minutes (its worker is gone). Concurrent workers receive no row.';
