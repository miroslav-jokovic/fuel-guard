-- FuelGuard — 0439 the detection reset: a start date for fill alerts, and the one audited act that
-- retires the old queue (D-CF9, Q-CF1 (a); docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md CF0;
-- F02-F04 PLAN.md chunk 7a, ordered before chunk 6 by Q-F9 (a), owner 2026-10-08).
--
-- THE GAP. Production holds 82 open fill alerts (2026-10-08), fills 01-01 → 09-30, none investigated, none
-- with a disposition. The owner ruled (Q-CF1 (a)) that they are RETIRED, not deleted: closed with their
-- own disposition, so the 2,030 earlier reviewer verdicts stay as the "before" measurement of the old
-- engine, and the pages read clean from the reset on. D-CF9 makes the reset "an explicit, audited
-- service-role act … never a side effect of a deploy". Q-F9 found chunk 6's re-score WOULD be that side
-- effect (it supersedes the 46 open alerts whose rules become notes), so this ships first.
--
-- WHY RETIRING ALONE IS NOT ENOUGH. A closed case does not stop its fill raising a new one: since 0158,
-- only `open` and `investigating` cases block `persist_scoring_outcome` from inserting. The boot rebuild
-- re-scores 180 days of fills 45 s after every deploy, so a retire without a start date is undone by the
-- next deploy for every retired fill whose rules still fire. `organizations.detection_epoch` is that start
-- date: chunk 7b makes scoring raise no case for a fill before it. Until 7b is served nothing reads it,
-- and until the act runs (chunk 7c) it is null everywhere, which means "no start date" — today's behaviour.
--
-- THE SHAPE.
--   • `organizations.detection_epoch` (null = never reset). On the org row because scoring already reads
--     that row (`loadOperatingHours`), and because the browser holds no UPDATE policy on it (checked on
--     production 2026-10-08), so it can only move through the act below. `anomaly_thresholds` was
--     rejected: it is the settings form's table, saved by a full-row upsert, and the epoch is not a
--     setting anybody edits.
--   • Disposition `retired_reset_2026_10` (the value Q-CF1 named), on `anomalies` and on
--     `anomaly_transitions`. It is not a verdict: the precision measure counts only the four reviewer
--     verdicts by name (`detectionMetrics.ts isDecided`, `entityRisk.ts`), so it falls outside them.
--   • `reset_fill_detection(p_org, p_actor, p_epoch)`, service role only, one transaction:
--       1. refuses a second reset (moving a start date is its own decision, not a retry), an epoch in
--          the future, and a missing actor (D-CF9 names who did it);
--       2. sets the epoch;
--       3. dismisses every OPEN case on a fill before the epoch with that disposition, exactly as
--          `transition_anomaly` closes one (version + 1, who and when, a note), and writes one
--          `anomaly_transitions` row each, so a case's history shows the reset like any other close;
--       4. writes ONE `audit_logs` row naming the actor, the epoch and the counts.
--     A case someone is INVESTIGATING is left as it is and counted: Q-CF1 says "open", and closing a case
--     a person is working would undo their work. Production has none today.
--
-- WHAT WAS REJECTED.
--   • Filtering every reader by the epoch instead of retiring (the dashboard RPC, the Alerts page, the
--     digest, askData, the detail pages …). A case closed once is closed for every reader; a filter has
--     to be restated in each, and one forgotten reader shows the old queue again.
--   • Deleting (Q-CF1 (b), rejected by the owner): irreversible, and it destroys the measurement.
--   • Running the retire inside this migration. The act needs the start date to be READ by scoring
--     first (7b), or the next deploy re-opens what it closed. It runs in chunk 7c, after 7b is served.
--
-- DEPLOY WINDOW. A new nullable column nothing reads yet, a widened CHECK (old code writes only the old
-- values), and a new function. Old code meets nothing it does not expect.
--
-- cross-module-waiver: the org module is touched twice, both for this act alone — one column on
-- `organizations` that only the act writes, and the act's one `audit_logs` summary row (as 0403).
--
-- Proven in supabase/tests/detection-reset.test.mjs.
--
-- Rollback (before 7c has run): drop function reset_fill_detection(uuid, uuid, timestamptz);
--   alter table organizations drop column detection_epoch; and restore the two CHECKs to 0034's list.

alter table public.organizations add column if not exists detection_epoch timestamptz;

comment on column public.organizations.detection_epoch is
  '0439 (D-CF9): fill alerts start here. Scoring raises no case for a fill before it; null = never '
  'reset. Set only by reset_fill_detection, which also retires the open cases before it.';

alter table public.anomalies drop constraint if exists anomalies_disposition_check;
alter table public.anomalies add constraint anomalies_disposition_check
  check (disposition in ('confirmed', 'false_positive', 'benign_explained', 'inconclusive', 'retired_reset_2026_10'));

alter table public.anomaly_transitions drop constraint if exists anomaly_transitions_disposition_check;
alter table public.anomaly_transitions add constraint anomaly_transitions_disposition_check
  check (disposition in ('confirmed', 'false_positive', 'benign_explained', 'inconclusive', 'retired_reset_2026_10'));

create or replace function public.reset_fill_detection(
  p_org    uuid,
  p_actor  uuid,
  p_epoch  timestamptz
)
returns table (retired int, kept_investigating int, epoch timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_existing  timestamptz;
  v_now       timestamptz := now();
  v_note      constant text :=
    'Retired by the detection reset (D-CF9, Q-CF1): the old engine''s open alerts were closed in one act; '
    'alerts start again from the reset.';
  v_retired   int;
  v_kept      int;
begin
  if p_actor is null then
    raise exception 'reset_fill_detection: an actor is required (D-CF9)' using errcode = '22023';
  end if;
  if p_epoch is null or p_epoch > v_now then
    raise exception 'reset_fill_detection: the start date must be given and not in the future' using errcode = '22023';
  end if;

  select o.detection_epoch into v_existing from public.organizations o where o.id = p_org for update;
  if not found then
    raise exception 'reset_fill_detection: organization % does not exist', p_org using errcode = '22023';
  end if;
  if v_existing is not null then
    raise exception 'reset_fill_detection: organization % was already reset at %', p_org, v_existing
      using errcode = '22023';
  end if;

  update public.organizations o set detection_epoch = p_epoch where o.id = p_org;

  with retired as (
    update public.anomalies a
       set status         = 'dismissed',
           version        = a.version + 1,
           resolution_note = v_note,
           resolved_by    = p_actor,
           resolved_at    = v_now,
           disposition    = 'retired_reset_2026_10',
           disposition_by = p_actor,
           disposition_at = v_now
     where a.org_id = p_org
       and a.status = 'open'
       and coalesce(a.fueled_at, a.created_at) < p_epoch
    returning a.id, a.version
  ), history as (
    insert into public.anomaly_transitions
      (org_id, anomaly_id, from_status, to_status, from_version, to_version, note, disposition, actor_id, created_at)
    select p_org, r.id, 'open', 'dismissed', r.version - 1, r.version, v_note, 'retired_reset_2026_10', p_actor, v_now
      from retired r
    returning 1
  )
  select count(*) into v_retired from history;

  select count(*) into v_kept from public.anomalies a
   where a.org_id = p_org and a.status = 'investigating' and coalesce(a.fueled_at, a.created_at) < p_epoch;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (p_org, p_actor, 'anomalies.detection_reset', 'organizations', p_org, jsonb_build_object(
    'epoch', p_epoch,
    'retired', v_retired,
    'kept_investigating', v_kept,
    'disposition', 'retired_reset_2026_10'
  ));

  return query select v_retired, v_kept, p_epoch;
end;
$$;

comment on function public.reset_fill_detection(uuid, uuid, timestamptz) is
  '0439 (D-CF9, Q-CF1 (a)): set the org''s fill-detection start date and retire every open case before '
  'it, with one transition each and one audit row. Once per org. Service role only.';

revoke all on function public.reset_fill_detection(uuid, uuid, timestamptz) from public, anon, authenticated;
-- Explicit, as 0438: the revoke from PUBLIC also takes the grant service_role would inherit.
grant execute on function public.reset_fill_detection(uuid, uuid, timestamptz) to service_role;
