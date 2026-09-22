-- A retry that has never once succeeded in 235 tries is not a retry, and nothing here could stop it.
--
-- ── WHAT THIS COSTS TODAY (measured on production 2026-09-22, DATA-LIFECYCLE-PLAN Q6/Q6b) ───────
-- Three `efs_processing_runs` rows have been claimed, restarted and reclaimed since 2026-08-28 and
-- 2026-09-05 without ever completing: `7516924d` (import `d184c165`, 2,151 fills), `6f0c6a6c`
-- (`187127b6`, 853) and `b9f1f710` (`57317aa4`, 1,172), at 233, 235 and 235 attempts. Every other
-- run in the table — 7,566 of them — is `succeeded`. Those three are:
--
--   * **47,522 scoring attempts in 24 hours across their 4,176 fills** — 11.4 complete passes per
--     fill per day — against 97,182 attempts fleet-wide. 48.9% of all scoring in the product.
--   * a live Samsara reconciliation on each of those attempts, because `scoreImport` passes no
--     `skipRecon`, against fills that are four to nine months old. The receipt is on the rows:
--     `samsara_recon_evidence_version` averages 85.2 / 116.7 / 132.5 across the three imports and
--     reaches 235, and that column increments only on a SUCCESSFUL live refresh.
--
-- ── WHY THEY CANNOT FINISH, SO THAT ABANDONING IS THE HONEST ANSWER ─────────────────────────────
-- Not a lease that is too short. Observed lifetimes of the `jobs` rows driving them are 28, 29, 36,
-- 50, 72, 74, 190 and 374 minutes; two overnight runs got 3.2 h and 6.2 h uninterrupted and still
-- did not reach the end. A pass is ~2,151 live reconciliations plus a full-history cascade over
-- 139–155 vehicles, and the daytime attempts are cut short by ordinary deploys (38–50 commits a day
-- on `main`). No lease value makes a pass of that shape fit between two restarts, which is why
-- raising the lease was recommended for Q6 and then withdrawn.
--
-- The work is also redundant rather than pending: these fills have been scored 11 times a day for
-- 25 days. Abandoning records what is true — this run will not complete on these terms — instead of
-- asserting `succeeded`, which would be a false entry in an operational table, or leaving `running`,
-- which is what it has been doing for 25 days while looking like work in progress.
--
-- ── WHY 100, AND WHY NOT 5 ──────────────────────────────────────────────────────────────────────
-- The instinct is a small ceiling. The data refuses it: among the 7,566 runs that DID succeed the
-- maximum attempt count is **66**, with 56, 54, 53, 46, 46 and 45 behind it. A ceiling of 5 or 10
-- would abandon runs that go on to complete, and silently — the worst failure this change could
-- introduce. 100 is ~1.5x the worst observed success.
--
-- The asymmetry is the same one migration 0317 states for the lease and it points the same way:
-- erring LONG only delays abandoning a run that is already dead, while erring SHORT throws away work
-- that would have finished. So this is a backstop against a permanent loop, not a tuning knob, and
-- it is deliberately generous. If a legitimate run ever reaches it, that is a defect to investigate
-- and the abandoned row is the evidence — which is the point.
--
-- ── WHY IN THE CLAIM FUNCTION, AND NOT IN TYPESCRIPT ────────────────────────────────────────────
-- `processEfsProcessingRun`'s catch block already writes `failed` with the backoff ladder, and these
-- three runs never reach it: the process DIES mid-pass, so no TypeScript runs at all. They advance
-- only through the stranded-reclaim branch of this function (0317), which is why `attempts` climbs
-- while `last_error` stays null. This function is the single choke point every attempt passes
-- through, including that one. A ceiling anywhere else would be a ceiling the actual failure mode
-- walks around.
--
-- Both halves ship in ONE migration on purpose: the CHECK must already permit 'abandoned' before
-- anything writes it, and applying the two in one file is what guarantees that ordering. Nothing in
-- TypeScript writes or reads the new value in this merge — `dueRunIds` selects
-- `pending`/`failed`/`running` and so stops offering an abandoned run for free, which is the whole
-- behaviour change. Surfacing it (so an abandoned run is loud rather than merely quiet) is a
-- separate merge, by which time the value already exists.
--
-- Expected effect on deploy: all three runs are at or past 100, so each self-abandons on its next
-- claim — within ~20 minutes of the migration applying, without a manual data write. That answers
-- Q6a as a consequence of Q6b rather than as an owner's UPDATE.

alter table public.efs_processing_runs
  drop constraint efs_processing_runs_status_check;

alter table public.efs_processing_runs
  add constraint efs_processing_runs_status_check
  check (status = any (array['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'abandoned'::text]));

comment on column public.efs_processing_runs.attempts is
  'Claim count, incremented by claim_efs_processing_run on every attempt including a stranded reclaim. Read by the attempt ceiling in that function (0354) and by the retry ladder in efsProcessing.ts; before 0354 it was incremented and never read.';

create or replace function public.claim_efs_processing_run(p_id uuid)
returns setof public.efs_processing_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.efs_processing_runs;
  -- See the header: 66 is the highest attempt count among 7,566 SUCCEEDED runs, so a ceiling below
  -- that abandons work that would have completed. This is a backstop against a permanent loop.
  c_max_attempts constant integer := 100;
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

  -- The ceiling is tested on the CLAIMED row, under its lock, before `attempts` is incremented — so
  -- the run is abandoned on the attempt that would have been number 101 rather than after it, and
  -- two workers racing the same row cannot both spend it. Returning no row means the caller behaves
  -- exactly as it does for a row another worker holds: `processEfsProcessingRun` returns `skipped`.
  if v_row.attempts >= c_max_attempts then
    update public.efs_processing_runs
       set status = 'abandoned',
           -- Written only when it is empty: a run that recorded a real error on its way here has
           -- said something more useful than this sentence, and that diagnosis must survive. The
           -- three runs this migration exists for have `last_error` null precisely because their
           -- process died before any handler could write one.
           last_error = coalesce(
             last_error,
             format('abandoned after %s attempts without completing (attempt ceiling, migration 0354)', v_row.attempts)
           ),
           updated_at = now()
     where id = v_row.id;
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
  'Atomically claims one due EFS processing run with row locking; also reclaims a run that has sat in running for 20 minutes without a write, i.e. has missed ten of its 2-minute heartbeats. A run that has already been claimed 100 times without completing is moved to the terminal status abandoned instead of being claimed again (0354). Concurrent workers receive no row.';
