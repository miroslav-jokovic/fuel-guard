-- 0341: where each truck is RIGHT NOW (LIVE-MAP-PLAN.md LM2, D-LM16).
--
-- ── ONE ROW PER VEHICLE. NO HISTORY, EVER ────────────────────────────────────────────────────────
-- Owner ruling, 2026-09-15: "We dont need to have history here, Samsara have history." The primary
-- key is `(org_id, vehicle_id)` and the writer UPDATEs in place, so this table holds the CURRENT fix
-- and nothing else. That is a one-way door and it is chosen deliberately: a current-only table cannot
-- be given a past retroactively, and the first person who wants a breadcrumb trail will propose
-- widening this one.
--
-- The answer to that person is that the trail already exists, at the vendor:
-- `GET /fleet/vehicles/stats/history` over a time range, which is also Samsara's own documented
-- gap-recovery path. Storing a second copy of it here would buy a slower version of a query they
-- already answer, plus a retention policy, plus a growth curve of 205 trucks x 12 fixes a minute.
-- Widening this table is a NEW DECISION with its own migration, not an implementation detail.
--
-- ── WHY NOT COLUMNS ON `vehicles` ────────────────────────────────────────────────────────────────
-- Because `roster` owns that table and this feed writes every 5 seconds. A per-tick UPDATE on a core
-- roster row would contend with every other writer of it — the Samsara vehicle sync, the McLeod
-- roster ingest, the shop's own edits — and it would make a position write capable of failing a
-- roster write. Positions are `layer=raw`, owned by `samsara`, and they stay in their own table so a
-- stale or missing fix can never be confused with a fact about the truck itself.
--
-- ── WHY THE COMPOSITE FOREIGN KEY, AND THE UNIQUE THAT HAD TO COME FIRST ─────────────────────────
-- `(vehicle_id, org_id)` references `vehicles (id, org_id)` so a position's org can never drift from
-- its vehicle's. ⚠ LIVE-MAP-PLAN.md LM2 asserted that composite unique "already exists" on
-- `vehicles`. It does not — measured 2026-09-15, the uniques are `(org_id, unit_number)` plus partial
-- indexes on the mcleod, samsara and vin keys. Postgres requires a unique on the REFERENCED columns,
-- so the constraint is added here first, exactly as 0148 did for `loads` (`loads_id_org_key`). It is
-- redundant with the primary key on `id` alone and that is fine: its job is to be a legal FK target.
--
-- ── RLS: ENABLED, NO POLICY, DENY-ALL ON PURPOSE ─────────────────────────────────────────────────
-- D-LM11: the live map reads through `GET /api/livemap/...`, not through PostgREST from the browser.
-- That view joins positions, vehicles, drivers, loads and dispatchers and applies a scope derived
-- from the caller's identity; shipping six table shapes and the scoping rule into a browser bundle is
-- the thing that decision exists to prevent. The API reads with the service role, which BYPASSES RLS,
-- so the org filter is the service's job and `expectOrgScoped` is what proves it.
--
-- ── NOT EVIDENCE ─────────────────────────────────────────────────────────────────────────────────
-- A position is operational state, not a record of what happened. Losing this table costs one poll
-- cycle and no history, so it is deliberately NOT in RETENTION_FORBIDDEN and carries no append-only
-- trigger — the same class as `samsara_feed_cursors`, not the class `fuel_recon_runs` is in.

-- raw-access-waiver: this migration CREATES the samsara raw table it names — the owning collector's
-- own DDL, no cross-module read.
-- cross-module-waiver: samsara's new positions table needs a legal FK target on roster's `vehicles`,
-- and Postgres requires a UNIQUE on the referenced columns. The touch on roster is one additive
-- constraint that changes no column, no row and no other module's behaviour — it exists so the
-- composite FK can enforce that a position never names another org's truck. The alternative was a
-- single-column FK plus a trigger to keep `org_id` honest, which is more code guarding a weaker
-- guarantee. Precedent: 0148 added `loads_id_org_key` for exactly this reason.
-- The FK target. Redundant with the primary key by design; see the header.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vehicles_id_org_key'
  ) then
    alter table public.vehicles add constraint vehicles_id_org_key unique (id, org_id);
  end if;
end $$;

create table if not exists vehicle_positions (
  org_id             uuid not null references organizations(id) on delete cascade,
  vehicle_id         uuid not null,

  -- WGS84, already corrected to signed longitude by the collector. Samsara reports a real signed
  -- value; the west-positive convention that needs negating is McLeod's, and McLeod does not feed
  -- this table (D-LM2).
  --
  -- ⚠ These bounds are a RANGE check and deliberately NOT a hemisphere check. An earlier draft of
  -- this header claimed a west-positive `+88` would be "refused rather than drawn in Asia"; it is
  -- not, because +88 is a perfectly legal longitude and a carrier operating east of Greenwich would
  -- have a fleet full of them. Encoding "western hemisphere" here would be a true fact about ONE
  -- customer written into the schema of all of them. Sign correction belongs to the collector, where
  -- `toWesternLongitude` already does it for McLeod under a unit test that can fail.
  lat                double precision not null check (lat between -90 and 90),
  lng                double precision not null check (lng between -180 and 180),

  -- Degrees clockwise from true north. `[0, 360)` and not `[0, 360]`: 360 and 0 are the same bearing,
  -- and allowing both would let two writers disagree about a truck pointing north.
  heading_degrees    double precision check (heading_degrees >= 0 and heading_degrees < 360),
  speed_mph          double precision check (speed_mph >= 0),
  -- Samsara's own flag for whether the speed came from the ECU rather than from GPS. Nullable because
  -- a fix may carry no speed at all; absent is not the same as "not from the ECU" (the D-LM12 lesson).
  is_ecu_speed       boolean,

  -- Samsara's `reverseGeo.formattedLocation`, verbatim. Stored rather than re-derived so the map can
  -- name a place without an external geocoder, and so the string a dispatcher reads is the one the
  -- vendor actually returned.
  formatted_location text,

  -- WHEN THE TRUCK WAS THERE (vendor `gps.time`), not when we heard about it. The map shows the age
  -- of this, per truck, and calls a vehicle `offline` against it (D-LM10) — a position drawn without
  -- its age is a lie about three of every hundred trucks, measured.
  sampled_at         timestamptz not null,
  -- When WE stored it. The pair is what separates "the truck has not moved" from "the feed has
  -- stopped", which look identical if you only keep one of them.
  received_at        timestamptz not null default now(),

  -- Which feed produced it. Vocabulary today: 'samsara'. Text with a non-empty check rather than an
  -- enum: a second source is a new collector tier, which is application work, and making it also a
  -- migration would buy nothing.
  source             text not null default 'samsara' check (length(trim(source)) > 0),

  primary key (org_id, vehicle_id),
  constraint vehicle_positions_vehicle_fkey
    foreign key (vehicle_id, org_id) references public.vehicles (id, org_id) on delete cascade
);

-- The live map's read: every current position for one org, newest first. The PK already covers
-- `org_id`, so this exists for the staleness scan that decides which trucks render as `offline`.
create index if not exists idx_vehicle_positions_org_sampled
  on vehicle_positions (org_id, sampled_at desc);

alter table vehicle_positions enable row level security;

comment on table vehicle_positions is
  'module=samsara; layer=raw (0341, D-LM16; scripts/table-modules.json is the machine-read source). '
  'The CURRENT position of each vehicle — one row per truck, updated in place, no history. '
  'History lives at the vendor (GET /fleet/vehicles/stats/history); widening this table is a new decision.';
comment on column vehicle_positions.sampled_at is
  'Vendor gps.time — when the truck was THERE. The map shows this age per truck and derives `offline` from it.';
comment on column vehicle_positions.received_at is
  'When we stored the fix. With sampled_at it separates "has not moved" from "feed has stopped".';
comment on column vehicle_positions.formatted_location is
  'Samsara reverseGeo.formattedLocation, verbatim — no external geocoder involved.';
