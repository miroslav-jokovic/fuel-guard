-- 0150 — what the driver was ACTUALLY in, and what the TMS actually said (loads plan LD5).
--
-- Two unrelated gaps that both end at the same page.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. THE EQUIPMENT TIMELINE
--
-- D43 made the duty segment the truth about equipment and `loads.vehicle_id` merely dispatch's plan.
-- Every consumer since has had to re-derive "which truck was this driver in at 14:20" by hand, and
-- each one has to get the same three things right:
--
--   · a segment with no `to_at` is only open if its SESSION is also open — a shift that ended closed
--     every segment under it, whether or not anyone wrote the timestamp;
--   · a segment cannot start before its session did;
--   · the driver is on the session, not the segment, so every lookup is a join.
--
-- Two implementations of that rule will disagree, and the one that disagrees quietly is the one that
-- mis-attributes a week of fuel. So it is expressed once, here.
--
-- `security_invoker = on` is not optional. A view defaults to running with its OWNER's rights, which
-- would hand every caller an unfiltered read of two RLS-protected tables. With it on, the policies on
-- `driver_duty_sessions` and `duty_equipment_segments` (0086 / 0136) apply exactly as they do to a
-- direct read — including the driver scope that stops one driver seeing another's shift.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

drop view if exists public.driver_equipment_timeline;

create view public.driver_equipment_timeline
with (security_invoker = on)
as
select
  s.org_id,
  s.driver_id,
  s.id           as session_id,
  seg.id         as segment_id,
  seg.vehicle_id,
  seg.trailer_id,
  seg.seat,
  seg.confirmed_by,
  s.source       as session_source,
  -- A segment cannot predate its own shift, whatever a replayed offline record claims.
  greatest(seg.from_at, s.started_at) as from_at,
  -- Open only while BOTH are open; otherwise the earlier of the two ends it.
  case
    when seg.to_at is null and s.ended_at is null then null
    when seg.to_at is null                        then s.ended_at
    when s.ended_at is null                       then seg.to_at
    else least(seg.to_at, s.ended_at)
  end as to_at
from public.duty_equipment_segments seg
join public.driver_duty_sessions s on s.id = seg.session_id;

comment on view public.driver_equipment_timeline is
  'Flattened duty attribution (LD5): which vehicle and trailer a driver held over which interval.
   THE lookup for "what were they actually in at time t" — `from_at <= t and (to_at is null or
   to_at > t)`. security_invoker, so 0086''s driver scope still applies.';

-- The lookup every consumer performs. Without it, attribution over a busy fleet scans every segment.
create index if not exists idx_duty_segments_session_from
  on public.duty_equipment_segments (session_id, from_at desc);
create index if not exists idx_duty_sessions_driver_started
  on public.driver_duty_sessions (org_id, driver_id, started_at desc);

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. TMS PROVENANCE
--
-- `tmsLoadInputSchema` has accepted `external_status` and `raw` since 3E and neither was ever
-- written: the contract promised the office could see what McLeod said, and the office could not.
-- `external_status` is the field the cancellation path conceptually reads, and dispatch asking "the
-- TMS says what?" is the first question in every mapping dispute.
--
-- THE RAW PAYLOAD IS NOT ON `loads`, AND THAT IS THE POINT. `loads_driver_scope` (0085/0087) lets a
-- driver read the loads assigned to them. A McLeod order payload routinely carries customer names,
-- rates and pay — none of which a driver may see. RLS is row-level, so a jsonb column on `loads`
-- would be readable by anyone who can read the row. It gets its own table with its own policies and
-- no driver access at all.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

alter table public.loads add column if not exists external_status text;
alter table public.loads add column if not exists external_synced_at timestamptz;

comment on column public.loads.external_status is
  'The status word the source TMS last reported for this load (LD5). Not FuelGuard''s lifecycle —
   `status` is. Safe for a driver to see; the payload behind it is not, and lives in
   load_external_payloads.';

create table if not exists public.load_external_payloads (
  load_id    uuid primary key references public.loads(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  provider   text not null,
  -- The LAST payload, not a history: each sync overwrites. A history belongs in its own table with
  -- its own retention, and inventing one here would grow unbounded on every poll.
  raw        jsonb not null default '{}',
  synced_at  timestamptz not null default now()
);

create index if not exists idx_load_external_payloads_org on public.load_external_payloads (org_id);

alter table public.load_external_payloads enable row level security;

-- Office roles only. `dispatcher` is included because reconciling a feed against a load IS the
-- dispatcher's job; `driver` is absent because the payload can contain the carrier's rates.
drop policy if exists load_external_payloads_select on public.load_external_payloads;
create policy load_external_payloads_select on public.load_external_payloads for select using (
  org_id = public.auth_org_id()
  and public.auth_role() = any (array['admin', 'fleet_manager', 'dispatcher', 'auditor'])
);

-- No INSERT/UPDATE/DELETE policy: the ingest writes with the service role. A payload a human can
-- edit is not provenance.

comment on table public.load_external_payloads is
  'The last raw payload a TMS sent for a load (LD5). Deliberately NOT a column on `loads`: drivers
   can read their own load rows and this can contain rates and customer data.';
