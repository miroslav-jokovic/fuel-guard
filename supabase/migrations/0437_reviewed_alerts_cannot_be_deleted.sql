-- FuelGuard — 0437 an alert somebody has reviewed cannot be deleted.
--
-- THE GAP (F02-F04 AUDIT A3; owner's ruling Q-F8 (a), 2026-10-07). `anomalies` is pinned in
-- RETENTION_FORBIDDEN, which bars a prune RULE and nothing else. Measured on production, read-only,
-- 2026-10-07: 416 alerts carry a human status change in `audit_logs`. All 311 reviewed between 07-01
-- and 08-05 are gone; all 105 reviewed from 08-06 on still exist. The old scoring path deleted and
-- re-created cases on every re-score, and 0156/0158 (early August) replaced it with one that only
-- supersedes OPEN rule cases. The verdicts were lost with the rows, and their history with them
-- (`anomaly_transitions ... on delete cascade`, 0158). The audit log still says who changed each one.
--
-- So no code path deletes a reviewed alert TODAY. What is left is the door: nothing in the database
-- refuses it. The live route through it is a fill delete — `anomalies.transaction_id ... on delete
-- cascade` (0003) — and the browser holds a delete policy on fills (`ftxn_delete`), which Q-F6 rules
-- out and chunk 12 removes. Any future rebuild that reaches for `delete` would walk through it too.
--
-- THE SHAPE. A BEFORE DELETE trigger on `anomalies` refuses the row when a person has touched it:
--   • its status is `investigating`, `resolved` or `dismissed`, or
--   • it carries a disposition (0034), or
--   • it has a transition (0158) — which also covers a case re-opened to `open`.
-- An `open` or `superseded` case nobody touched holds no verdict and may still go with its fill.
-- The refusal raises, so a fill delete that would cascade onto a reviewed alert fails whole: the fill
-- stays, the alert stays, its history stays. Production holds 2,041 rows this protects (10 resolved,
-- 2,031 dismissed) and 250 it does not (81 open, 169 superseded).
--
-- ONE EXCEPTION: deleting the ORGANIZATION. 0361 rejected exactly this trigger on its ledger because it
-- would refuse the org cascade, which is the one sanctioned way an org's rows disappear. Here the
-- trigger lets a row through when its organization no longer exists: the org's own DELETE runs before
-- its cascade reaches this table, so inside the cascade the org row is already gone, while any other
-- delete sees it. The matrix proves both directions.
--
-- WHAT WAS REJECTED.
--   • A bypass setting for an "audited delete", as `fuelguard.purging_applicant` is (0380). Nothing
--     needs one: the card-fraud reset RETIRES cases rather than deleting them (Q-CF1 (a)). A setting
--     nobody sets is a door nobody watches; if a delete is ever needed, a migration that says why is
--     the audited act.
--   • Changing `anomalies.transaction_id` to RESTRICT. It would refuse deleting a fill under ANY
--     alert, including an open one nobody saw, and it would refuse the org cascade the way 0361
--     describes. The question is whether a person touched the alert, which a foreign key cannot ask.
--   • Guarding `anomaly_transitions` too. Its rows go only by cascade from `anomalies`, which this
--     refuses for any alert that has one.
--
-- Proven in supabase/tests/reviewed-alerts-guard.test.mjs.
--
-- Rollback:
--   drop trigger anomalies_reviewed_cannot_be_deleted on anomalies;
--   drop function anomalies_reviewed_cannot_be_deleted();
--
-- raw-access-waiver: the scoring module's own integrity rule on its own table; it reads the row being
-- deleted, its transitions and whether its org still exists, for nobody but itself.

create or replace function public.anomalies_reviewed_cannot_be_deleted()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The org is being deleted: its cascade is the sanctioned way these rows go (0361's reasoning).
  if not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return old;
  end if;

  if old.status in ('investigating', 'resolved', 'dismissed')
     or old.disposition is not null
     or exists (select 1 from public.anomaly_transitions t where t.anomaly_id = old.id)
  then
    raise exception
      'reviewed_alert: alert % has been reviewed and cannot be deleted — close or retire it instead (Q-F8)', old.id
      using errcode = 'FG013';
  end if;

  return old;
end;
$$;

comment on function public.anomalies_reviewed_cannot_be_deleted() is
  '0437 (F02-F04 AUDIT A3, Q-F8): refuses deleting an alert a person has touched — status '
  'investigating/resolved/dismissed, a disposition, or any transition — including by cascade from its '
  'fill. Deleting the organization still cascades.';

revoke all on function public.anomalies_reviewed_cannot_be_deleted() from public, anon, authenticated;

drop trigger if exists anomalies_reviewed_cannot_be_deleted on public.anomalies;
create trigger anomalies_reviewed_cannot_be_deleted
  before delete on public.anomalies
  for each row execute function public.anomalies_reviewed_cannot_be_deleted();
