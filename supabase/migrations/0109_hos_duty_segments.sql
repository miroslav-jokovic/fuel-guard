-- 0109: HOS duty-status segments — one row per driver duty-status interval, from Samsara ELD
-- (GET /fleet/hos/logs). This is the "why was the truck parked" signal: Sleeper Berth / Off Duty = rest-period
-- hotel-load idle (the APU-replaceable target), On Duty = work (loading / dock / inspection). Overlaid onto
-- park sessions it splits idle by duty so avoidable-idle can be duty-aware. See docs/plans/IDLE-AVOIDABLE-HOS.md.
--
-- A "segment" runs from one duty-status log's start until the driver's next log start. The final open segment
-- has ended_at = null and is closed on a later sync when the next status arrives (upsert refreshes ended_at).
create table if not exists hos_duty_segments (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  driver_id          uuid references drivers(id) on delete set null,
  samsara_driver_id  text not null,
  status             text not null,
  started_at         timestamptz not null,
  ended_at           timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists idx_hos_seg_org_driver_start on hos_duty_segments (org_id, samsara_driver_id, started_at);
create index        if not exists idx_hos_seg_driver_time      on hos_duty_segments (org_id, driver_id, started_at);
create index        if not exists idx_hos_seg_org_time         on hos_duty_segments (org_id, started_at);

alter table hos_duty_segments enable row level security;
drop policy if exists hos_duty_segments_select on hos_duty_segments;
create policy hos_duty_segments_select on hos_duty_segments for select using (org_id = auth_org_id());
drop policy if exists hos_duty_segments_write on hos_duty_segments;
create policy hos_duty_segments_write on hos_duty_segments for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

comment on table hos_duty_segments is
  'Driver HOS duty-status intervals from Samsara ELD (GET /fleet/hos/logs). Overlaid on park sessions to make avoidable-idle duty-aware (rest vs work). See docs/plans/IDLE-AVOIDABLE-HOS.md.';
