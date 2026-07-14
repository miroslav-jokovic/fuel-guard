-- 0055: frozen, settled weekly leaderboard + winners — the auditable rewards ledger. Written once a week's
-- data settles (~settle_hours after week end, to clear Samsara's 72h efficiency lag). driver_name is
-- denormalized so history survives roster edits; driver_id is nullable (set null on driver delete) so a
-- surrogate id is the PK and (org_id, week_start, driver_id) is the upsert key. Member-read; admin/fleet_manager
-- write. (docs/16-DRIVER-PERFORMANCE.md)
create table if not exists driver_performance_weeks (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  week_start        date not null,
  week_end          date not null,
  driver_id         uuid references drivers(id) on delete set null,
  driver_name       text,
  safety_score      numeric(5,1),
  efficiency_score  numeric(5,1),
  idle_score        numeric(5,1),
  safety_pct        numeric(5,1),
  efficiency_pct    numeric(5,1),
  idle_pct          numeric(5,1),
  week_final        numeric(5,1),
  trailing_final    numeric(5,1),
  drive_distance_mi numeric(10,1),
  drive_time_hours  numeric(8,2),
  eligible          boolean not null default false,
  ineligible_reason text,
  rank              int,
  is_winner         boolean not null default false,
  weights_used      jsonb,
  method_used       text,
  settled_at        timestamptz not null default now()
);
create unique index if not exists idx_dpw_org_week_driver on driver_performance_weeks (org_id, week_start, driver_id);
create index if not exists idx_dpw_org_week on driver_performance_weeks (org_id, week_start);
create index if not exists idx_dpw_org_winner on driver_performance_weeks (org_id, is_winner);

alter table driver_performance_weeks enable row level security;
drop policy if exists dpw_select on driver_performance_weeks;
create policy dpw_select on driver_performance_weeks for select using (org_id = auth_org_id());
drop policy if exists dpw_write on driver_performance_weeks;
create policy dpw_write on driver_performance_weeks for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));
