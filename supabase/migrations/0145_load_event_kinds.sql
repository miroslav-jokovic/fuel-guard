-- FuelGuard — 0145 two load-event kinds the plan specified and nothing could emit
--
-- `load_changed` (D-L8). A released load whose driver-visible facts change is silently divergent from
-- the copy on a driver's phone — the failure D53 exists to prevent. The decision scopes it tightly:
-- emitted only for a RELEASED load, only for facts a driver can see (stops, appointment windows,
-- addresses, equipment), never for dispatch-internal edits like notes or billing references. Emitting
-- on every field would train drivers to ignore the category, which is worse than not emitting at all.
--
-- `exception_resolved` (D-L2). The exceptions feed is built from events, so an exception is open until
-- something says otherwise. Without a resolving event the only way to close one would be to mutate or
-- delete history, and `load_events` is append-only for good reason. The payload names the event being
-- resolved and the action taken, so "who cleared this and on what basis" is answerable later.
--
-- Both were already declared in `LOAD_EVENT_KINDS` in the shared package's intent but neither could be
-- written: this CHECK constraint would have rejected them.

alter table load_events
  drop constraint if exists load_events_kind_check;

alter table load_events
  add constraint load_events_kind_check check (kind in (
    'created', 'submitted', 'approved', 'rejected',
    'assigned', 'reassigned', 'released',
    'accepted', 'declined', 'started',
    'stop_arrived', 'stop_completed', 'stop_skipped',
    'equipment_mismatch', 'amended', 'canceled', 'completed',
    'load_changed', 'exception_resolved'
  ));

-- The exceptions feed reads recent events by kind across the whole org, which the existing
-- (load_id, occurred_at) index cannot serve.
create index if not exists idx_load_events_org_kind_time
  on load_events (org_id, kind, occurred_at desc);
