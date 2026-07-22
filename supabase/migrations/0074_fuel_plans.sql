-- 0074: Saved fuel plans (planned-route history). Each plan a dispatcher generates on the Fuel Planning page is
-- recorded with a summary + the full plan JSON + who created it, so the page can show a "History" tab. Written by
-- the API (service role); org members read their org's rows. Best-effort — a history write never blocks a plan.
create table if not exists fuel_plans (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  created_by         uuid references auth.users(id) on delete set null,
  created_by_label   text,                                   -- denormalized creator email at creation time
  vehicle_id         uuid references vehicles(id) on delete set null,
  unit_number        text,                                   -- denormalized truck label for the list
  origin_label       text,
  destination_label  text,
  distance_miles     numeric(8,1),
  duration_hours     numeric(6,1),
  status             text not null,                          -- ok | emergency_used | infeasible | no_stations | ...
  stop_count         integer not null default 0,
  total_gallons      numeric(8,1),
  total_cost         numeric(10,2),
  arrival_fuel_pct   numeric(5,1),
  plan               jsonb,                                  -- full plan result (for a future re-open/detail view)
  created_at         timestamptz not null default now()
);
create index if not exists idx_fuel_plans_org_created on fuel_plans (org_id, created_at desc);

alter table fuel_plans enable row level security;
drop policy if exists fuel_plans_select on fuel_plans;
create policy fuel_plans_select on fuel_plans for select using (org_id = auth_org_id());
-- writes: service role only (the API inserts with the service key, which bypasses RLS); no client write policy.
