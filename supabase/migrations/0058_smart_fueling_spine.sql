-- 0058: Smart Fueling data spine (chain-agnostic; Pilot loaded as data in v1).
-- Stations are GLOBAL reference facts (public locations) shared across orgs; NET prices + discount rules +
-- planning settings are PER-ORG (a carrier's deal/policy). Vehicle/trailer routing-profile columns are added
-- for HERE truck routing (audit GAP-1). No load-level hazmat/weight here — that is captured per plan request.

-- Station registry (global reference; any authenticated org member reads; service role writes) ----------
create table if not exists fuel_stations (
  id            uuid primary key default gen_random_uuid(),
  brand         text not null,                              -- 'pilot' | 'flying_j' | 'one9' | ... (chain-agnostic)
  store_number  text,
  name          text,
  lat           numeric(9,6) not null,
  lng           numeric(9,6) not null,
  state         text,                                       -- 2-letter; drives CA-avoidance
  exit          text,
  has_diesel    boolean not null default true,
  has_def       boolean not null default false,
  status        text not null default 'active',             -- active | closed (closures are safety-critical)
  source        text,                                       -- 'pilot_export' | 'osm' | ...
  updated_at    timestamptz not null default now()
);
create unique index if not exists idx_fuel_stations_brand_store on fuel_stations (brand, store_number);
create index if not exists idx_fuel_stations_state on fuel_stations (state);
create index if not exists idx_fuel_stations_geo on fuel_stations (lat, lng);
alter table fuel_stations enable row level security;
drop policy if exists fuel_stations_select on fuel_stations;
create policy fuel_stations_select on fuel_stations for select using (auth_org_id() is not null);
-- writes: service role only (bypasses RLS); no client write policy.

-- Per-org net/posted prices (net depends on the org's negotiated deal) ----------
create table if not exists fuel_prices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  station_id    uuid not null references fuel_stations(id) on delete cascade,
  product       text not null default 'diesel',             -- diesel | def
  posted_price  numeric(7,3),
  net_price     numeric(7,3),
  source        text not null,                              -- 'pilot_email' | 'efs'
  observed_at   timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_fuel_prices_lookup on fuel_prices (org_id, station_id, product, observed_at desc);
alter table fuel_prices enable row level security;
drop policy if exists fuel_prices_select on fuel_prices;
create policy fuel_prices_select on fuel_prices for select using (org_id = auth_org_id());
drop policy if exists fuel_prices_write on fuel_prices;
create policy fuel_prices_write on fuel_prices for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

-- Per-org discount model (one row per chain; flat for Silvicom v1, other models ready) ----------
create table if not exists fuel_discount_rules (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  brand         text not null,
  type          text not null default 'flat',               -- flat | retail_minus | cost_plus | per_site | none
  cents_off     numeric(6,3) not null default 0,
  updated_at    timestamptz not null default now()
);
create unique index if not exists idx_fuel_discount_org_brand on fuel_discount_rules (org_id, brand);
alter table fuel_discount_rules enable row level security;
drop policy if exists fuel_discount_select on fuel_discount_rules;
create policy fuel_discount_select on fuel_discount_rules for select using (org_id = auth_org_id());
drop policy if exists fuel_discount_write on fuel_discount_rules;
create policy fuel_discount_write on fuel_discount_rules for all
  using (org_id = auth_org_id() and auth_role() = 'admin')
  with check (org_id = auth_org_id() and auth_role() = 'admin');

-- Per-org planning settings (one row; mirrors driver_performance_settings) ----------
create table if not exists route_fuel_settings (
  org_id                  uuid primary key references organizations(id) on delete cascade,
  reserve_pct             numeric not null default 20,       -- % of USABLE tank never crossed (safety floor)
  corridor_miles          numeric not null default 2.5,      -- station search buffer around the route
  min_purchase_gal        numeric not null default 50,       -- loyalty/min fill
  mpg_safety_factor       numeric not null default 0.90,     -- derate baseline_mpg for range feasibility
  deviation_threshold_mi  numeric not null default 3,        -- off-route recompute trigger
  price_ttl_hours         int     not null default 30,       -- prices older than this are stale (visible warning)
  always_fill_full        boolean not null default true,
  avoid_states            text[]  not null default '{CA}',
  avoid_brands            text[]  not null default '{one9}',
  preferred_brands        text[]  not null default '{pilot,flying_j}',
  emergency_brands        text[]  not null default '{one9}',
  emergency_fill_gallons  numeric not null default 50,       -- SOFT cost target; subordinate to reserve (safety)
  plan_def                boolean not null default false,    -- v1: DEF is the driver's responsibility
  -- Truck combination routing-profile DEFAULTS (used when a vehicle's own value is null) — US customary in, lb.
  default_height_in       numeric not null default 162,      -- 13'6"
  default_length_in       numeric not null default 840,      -- ~70' combination
  default_width_in        numeric not null default 102,      -- 8'6"
  default_axle_count      int     not null default 5,
  default_gross_weight_lb numeric not null default 80000,
  updated_at              timestamptz not null default now()
);
alter table route_fuel_settings enable row level security;
drop policy if exists route_fuel_settings_select on route_fuel_settings;
create policy route_fuel_settings_select on route_fuel_settings for select using (org_id = auth_org_id());
drop policy if exists route_fuel_settings_write on route_fuel_settings;
create policy route_fuel_settings_write on route_fuel_settings for all
  using (org_id = auth_org_id() and auth_role() = 'admin')
  with check (org_id = auth_org_id() and auth_role() = 'admin');

-- Per-truck routing profile overrides (HERE truck routing needs dims/axles; hazmat+gross come per-load) --
alter table vehicles add column if not exists height_in     numeric;
alter table vehicles add column if not exists length_in     numeric;
alter table vehicles add column if not exists width_in      numeric;
alter table vehicles add column if not exists axle_count    int;
alter table vehicles add column if not exists tare_weight_lb numeric;
alter table trailers add column if not exists length_in     numeric;
