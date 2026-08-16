-- FuelGuard — 0196 efs_soap_credentials.updated_at means "configuration changed", and only that
-- (docs/28-EFS-EXECUTION-PLAN.md Step 5.7)
--
-- THE DEFECT. One column carried two unrelated events. Every poll bumped
-- efs_soap_credentials.updated_at, and so did a credential rotation. The column therefore could not
-- answer "when was this credential last changed" — the question asked after a security incident —
-- because a poller overwrote the answer within the hour. Same disease as `sync_error` in Phase 7's
-- findings: one column, two meanings, and the frequent writer wins.
--
-- WHY A MIGRATION AND NOT ONLY THE CODE CHANGE. Step 5.7 prescribes dropping `updated_at` from
-- `recordFeedSuccess` / `recordFeedFailure`, and that alone does not work. Migration 0091 puts a
-- `before update` trigger on this table running the generic `set_updated_at()` (0002), whose body is
-- an unconditional `new.updated_at = now()`. The database re-stamps the column on EVERY update no
-- matter what the patch contains, so removing the field application-side would have left the
-- behaviour identical and the step's Verify — "a poll does not move updated_at" — failing. Found by
-- reading the trigger before believing the prescription.
--
-- THE RULE. A write that touches ONLY poll bookkeeping leaves `updated_at` where it was. A write
-- that changes any configuration column — endpoint, environment, username, password, account_id,
-- enabled — moves it. Enforced here rather than in the service so that a future writer cannot
-- reintroduce the ambiguity by forgetting; the feed columns already carry poll timing
-- (`*_last_polled_at`, `*_last_success_at`) and are the right place to ask about it.
--
-- Rollback:
--   drop trigger trg_efs_soap_credentials_updated on efs_soap_credentials;
--   create trigger trg_efs_soap_credentials_updated
--     before update on efs_soap_credentials
--     for each row execute function set_updated_at();
--   drop function efs_soap_credentials_touch_updated_at();

create or replace function efs_soap_credentials_touch_updated_at()
returns trigger
language plpgsql
as $$
declare
  -- Poll bookkeeping. Changes confined to these columns are not configuration changes.
  -- `updated_at` itself is excluded so its own value never counts as a difference.
  feed_columns constant text[] := array[
    'posted_last_cursor',
    'rejected_last_cursor',
    'posted_last_polled_at',
    'rejected_last_polled_at',
    'posted_last_success_at',
    'rejected_last_success_at',
    'posted_last_error',
    'rejected_last_error',
    'updated_at'
  ];
begin
  if (to_jsonb(new) - feed_columns) is distinct from (to_jsonb(old) - feed_columns) then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

comment on function efs_soap_credentials_touch_updated_at() is
  'Step 5.7: efs_soap_credentials.updated_at tracks CONFIGURATION changes only. A poll writing '
  'cursors/last_polled_at/last_success_at/last_error leaves it untouched, so the column can still '
  'answer "when was this credential last changed" after an incident.';

drop trigger if exists trg_efs_soap_credentials_updated on efs_soap_credentials;

create trigger trg_efs_soap_credentials_updated
  before update on efs_soap_credentials
  for each row execute function efs_soap_credentials_touch_updated_at();
