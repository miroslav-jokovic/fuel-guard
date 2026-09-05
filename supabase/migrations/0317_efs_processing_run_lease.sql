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
-- So: a lease, and reclaiming counts as an attempt so the existing backoff ladder applies.
--
-- The lease is on LAST WRITE, not on start time, because there is no honest ceiling on how long a
-- legitimate run takes. Measured 2026-09-05 on the April re-fetch: 1,074 fills scored at ~16 fills a
-- minute, ~64 minutes end to end — an ordinary poll of ~260 rows finishes in 40s, and across 4,260
-- successful runs the max was 519s. A bulk historical re-fetch is a different workload from the
-- polls that produced those numbers, and it is precisely the workload that strands, so any fixed
-- start-time ceiling is either too tight for the big run or useless for the small one. Instead
-- `processEfsProcessingRun` touches the row every 2 minutes for as long as it is working, the
-- `set_updated_at` trigger (0154) stamps `updated_at`, and a run that has not written for 20 minutes
-- has missed ten consecutive heartbeats. That distinguishes "working" from "dead" by evidence
-- instead of by guessing a duration.
--
-- Erring long is the safe direction and erring short is not: a lease that is too long only delays
-- retrying a run that is already dead (these sat for a month), while a lease that is too short
-- reclaims a LIVE run and starts a second scoring pass concurrently with the first.
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
       -- Stranded mid-scoring: the worker that held it has stopped writing. `updated_at` is
       -- maintained by trg_efs_processing_runs_updated (0154) on EVERY update, so the heartbeat
       -- needs no column of its own and any future writer to this row also counts as liveness.
       or (status = 'running' and updated_at < now() - interval '20 minutes')
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
  'Atomically claims one due EFS processing run with row locking; also reclaims a run that has sat in running for 20 minutes without a write, i.e. has missed ten of its 2-minute heartbeats. Concurrent workers receive no row.';
