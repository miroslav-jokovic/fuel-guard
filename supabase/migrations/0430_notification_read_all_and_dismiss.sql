-- 0430 — "Mark all read" marks ALL of them, and the office can clear its inbox.
--
-- ── THE DEFECT (measured in production, 2026-10-05) ──────────────────────────────────────────────
-- `POST /api/me/notifications/read` with no ids selected the caller's event ids with `.limit(500)`
-- and NO order, then upserted a read row for each. Once an inbox passed 500 rows, Postgres was free
-- to hand back any 500 — in practice the oldest, already-read ones. The owner's inbox held 590
-- events (146 `card_status_changed`, all from the 09-30 status poll fanning out to ~6 fuel managers);
-- a 16:02 UTC click wrote 11 read rows and left 33 unread, every one of them from that day, 29 of
-- them card status changes. Five more fuel-manager inboxes sat at 274–590 rows on the same path.
--
-- A bigger limit is the same defect with a later date. The read-all is one set-based INSERT here:
-- every unread event addressed to the caller, no limit, no order to get wrong, one round trip.
--
-- ── CLEARING THE INBOX: A STAMP, NOT A DELETE ────────────────────────────────────────────────────
-- The bell had no way to empty itself. A DELETE of `notification_events` is ruled out on two counts:
--   • 0380 names the table append-only history of acts.
--   • The rows ARE the dedupe ledger. `dqAlertScheduler.sentKeys`, `fuelSweepFreshness.alreadySent`
--     and `financialFreshness` read past `dedupe_key`s to decide what is new; deleting a row re-arms
--     its alert, so a user clearing their inbox would be re-sent the same expiry next run.
-- So clearing is per-user read state, on the row that already holds it: `notification_reads`
-- gains `dismissed_at`. The event stays; the bell stops listing it for that one user.
-- `notification_reads` is per-user state, not evidence — it is not in RETENTION_FORBIDDEN, and a
-- user re-stamping their own row is the same kind of write as marking it read.
--
-- ── WHY TWO FUNCTIONS, NOT AN UPSERT FROM THE API ────────────────────────────────────────────────
-- `on conflict do nothing` for read-all and `on conflict … do update set dismissed_at` for clear
-- are conflict behaviours PostgREST's upsert cannot express per call (lint:upserts would refuse
-- the partial payload in any case). Both take the org and user as ARGUMENTS from the verified JWT,
-- never from a payload, and both filter `notification_events` on `org_id` AND `audience_user_id` —
-- the service role bypasses RLS, so the function is the tenant boundary (migrations 0174/0175 are
-- the pattern). Service-role only: no browser calls them (0412 default; revoked explicitly anyway).
--
-- ── DEPLOY WINDOW ────────────────────────────────────────────────────────────────────────────────
-- Additive. A nullable column with no default and two new functions; nothing reads either until the
-- api change that follows in a SEPARATE merge (lint:migration-ordering sees the column; it is blind
-- to functions, so that PR's body carries the pg_proc check).
--
-- Rollback: drop both functions, then the column.

alter table public.notification_reads add column if not exists dismissed_at timestamptz;

comment on column public.notification_reads.dismissed_at is
  'When this user cleared the notification from their bell. The event row stays — it is the dedupe ledger (0430).';

create or replace function public.mark_notifications_read(p_org uuid, p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  marked int;
begin
  insert into public.notification_reads (event_id, user_id)
  select e.id, p_user
    from public.notification_events e
   where e.org_id = p_org
     and e.audience_user_id = p_user
  on conflict (event_id, user_id) do nothing;
  get diagnostics marked = row_count;
  return marked;
end;
$$;

revoke all on function public.mark_notifications_read(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_notifications_read(uuid, uuid) to service_role;
comment on function public.mark_notifications_read(uuid, uuid) is
  'Mark every notification addressed to one user in one org read. Set-based, no limit — replaces a 500-row unordered select that skipped the newest (0430). Returns rows newly marked.';

-- Clearing also marks read: an item you swept away is not one you still owe a look. A row read
-- earlier keeps its read_at; a row already dismissed keeps its first dismissed_at.
create or replace function public.dismiss_notifications(p_org uuid, p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  dismissed int;
begin
  insert into public.notification_reads (event_id, user_id, dismissed_at)
  select e.id, p_user, now()
    from public.notification_events e
   where e.org_id = p_org
     and e.audience_user_id = p_user
  on conflict (event_id, user_id) do update
    set dismissed_at = now()
    where public.notification_reads.dismissed_at is null;
  get diagnostics dismissed = row_count;
  return dismissed;
end;
$$;

revoke all on function public.dismiss_notifications(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dismiss_notifications(uuid, uuid) to service_role;
comment on function public.dismiss_notifications(uuid, uuid) is
  'Clear every notification from one user''s bell in one org: stamps notification_reads.dismissed_at (and read_at if unread). Never deletes the event — it is the dedupe ledger (0430). Returns rows newly dismissed.';
