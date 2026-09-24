-- 0364: the dispatch board as McLeod states it, verbatim (LOADS-MIRROR-PLAN.md LR1, D-LMR3).
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
-- The collector's only raw copy of a load today is `load_external_payloads` (0150): one JSON blob per
-- load, overwritten on every sync, holding only what the agent had ALREADY mapped. Stops the agent
-- drops (VA, SP) are not in it, nothing in it can be queried by column, and it forgets. So a mapping
-- change — naming `VA`, projecting a status differently — can only be answered by re-pulling McLeod
-- and hoping the board still looks the same. D-LMR4 inverts that: the collector keeps what McLeod
-- said, a projection owned by `loads` turns it into the product's model, and core becomes rebuildable
-- from raw at any time. These are the two raw tables; the projection is LR4.
--
-- ── WHY `mcleod_dispatch_*` AND NOT `mcleod_movements` ───────────────────────────────────────────
-- `mcleod_movements` (0267) exists and is the FINANCE sweep's table of CLOSED trips, keyed for cost.
-- A movement appears in both — here while it is worked, there once it settles — written by different
-- feeds with different payloads. One table for both would force each feed to upsert a partial row
-- over the other's, which `lint:upserts` forbids for the NOT NULL reason 0174 records.
--
-- ── THE KEY CARRIES `company_id` ─────────────────────────────────────────────────────────────────
-- McLeod ids are unique within a company, not across them: `orders.id` collides 16,948 times across
-- companies in this database, and `movement.id` does the same (the finance company_id fix, #1000).
-- The agent sweeps one company today; the key is composite so a second company is a new row, not a
-- silent overwrite of the first.
--
-- ── COLUMNS ARE NAMED AND TYPED AS McLEOD DECLARES THEM ──────────────────────────────────────────
-- Read from lme's INFORMATION_SCHEMA on 2026-09-24, not guessed: `char(n)` ids and codes become
-- `text` (the agent trims the padding); `decimal` becomes unbounded `numeric`, deliberately wider
-- than McLeod's `decimal(7,1)` weight or `decimal(12,1)` distance, because a raw store that rejects
-- a sync when a vendor widens a column has lost the one thing it exists to keep; `int` stays
-- `integer`. Names follow McLeod (`pallets_how_many`, `city_name`, `ponum`) so a reader can hold this
-- table beside McLeod's screen without a glossary. `loaded` stays McLeod's own 'L'/'E' char — on
-- 2026-09-24 the open board held 157 'L' and 1 'E' — and becomes a boolean only in core (LR2/LR4),
-- because a raw copy that already interpreted the value could not show what it interpreted.
--
-- ── TIMES ARE CENTRAL WALL-CLOCK UPSTREAM, AND `timestamptz` HERE ────────────────────────────────
-- McLeod's `datetime` carries no offset; it is Central wall-clock time. The collector converts with
-- `America/Chicago` in ONE function tested across the 2026-11-01 DST change (LR3) and stores an
-- instant. Never by appending "Z" — `weather_cache` did that and read NaN for every row it held.
--
-- ── `longitude` IS STORED ALREADY NEGATED, AND THE DATABASE CHECKS IT ────────────────────────────
-- McLeod stores longitude WEST-POSITIVE at this carrier (0 negative values across 119,962 stops,
-- range 68.39–123.39). The agent negates it where a unit test pins the line (`loads.mjs`); the CHECK
-- below is the second witness. A sign bug puts every truck in western China — the check turns that
-- from a map nobody believes into a sync that fails and says why.
--
-- ── STOPS ARE A TABLE HERE, NOT 0267's JSONB ARRAY — AND THAT IS NOT A CONTRADICTION ─────────────
-- 0267 rejected a stop table because its only reader wanted a movement's stops as one ordered array.
-- Here the readers want stops on their own: the projection maps each stop to a `load_stops` row, and
-- the page asks "every stop arriving today" across movements. `stop_id` is McLeod's `stop.id` and is
-- stable across syncs, so a stop's arrival can be followed from the ETA to the actual.
-- The FK to the movement cascades: a stop never outlives its movement, so retention (Q-LMR8) deletes
-- movements and nothing else. A stop REMOVED from a movement in McLeod is the writer's job to delete
-- (LR3 replaces a movement's stop set), never inferred here.
--
-- ── BOOKKEEPING IS OURS, AND ONLY THREE COLUMNS ──────────────────────────────────────────────────
-- `first_seen_at` is written once, `last_seen_at` on every sync (the page's "McLeod as of <time>" is
-- `max(last_seen_at)`, never an implied "live"), `closed_at` when McLeod STATES D or V in the close
-- read (LR5) — never on absence from the board. The plan's fourth column, `source_version`, is NOT
-- added: it was the change-tracking version for L6, and L6 was withdrawn when the owner ruled
-- COLLECTOR-AUDIT Q-CA1 on 2026-09-24 (D-CA2, no change detection). A column no feed will ever
-- write is schema that promises something nobody is keeping.
--
-- ── RLS: ENABLED, NO POLICY, DENY-ALL ON PURPOSE ─────────────────────────────────────────────────
-- Raw collector staging is never read by a browser (ARCHITECTURE §6 raw-layer seal), and
-- `lint:table-access` refuses a harness file that reads it. The API writes it with the service role.
--
-- ── NOT EVIDENCE ─────────────────────────────────────────────────────────────────────────────────
-- Re-derivable from McLeod on the next sweep for as long as McLeod keeps the movement. Not in
-- RETENTION_FORBIDDEN, no append-only trigger. Retention is unruled (Q-LMR8, DATA-LIFECYCLE L9).
--
-- ── SCHEMA ONLY ──────────────────────────────────────────────────────────────────────────────────
-- Two new tables, exempt from the deploy-window rule. The writer is LR3, in a later merge;
-- check-table-producers.mjs carries the waiver naming it until then.
--
-- raw-access-waiver: this migration CREATES the two mcleod raw tables it names — the owning
-- collector's own DDL, no cross-module read.

create table if not exists mcleod_dispatch_movements (
  org_id              uuid not null references organizations(id) on delete cascade,
  company_id          text not null,                 -- movement.company_id, char(4)
  movement_id         text not null,                 -- movement.id, char(32)

  -- One order per movement: 0 movements with two orders and 0 orders on two movements on the board
  -- measured 2026-09-24, which is why one load row per movement is correct. `order_id` is scalar for
  -- the same reason; LR3's writer must refuse a movement that arrives with two, not keep either.
  order_id            text,                          -- orders.id, char(8)
  blnum               text,                          -- orders.blnum — collides 2,020 times; search, never key
  movement_status     text,                          -- movement.status: A, P, D, V … verbatim
  loaded              text,                          -- movement.loaded: 'L' / 'E'
  dispatcher_user_id  text,                          -- movement.dispatcher_user_id → tms_dispatchers (0344)
  -- An array because teams are real (4 team movements on the 2026-09-17 board; 176 of 21,215 in 0267),
  -- ordered by code as the agent's STUFF/FOR XML aggregation already orders them.
  driver_codes        text[] not null default '{}',  -- continuity 'D' rows
  tractor_id          text,                          -- continuity 'T'.equipment_id
  trailer_id          text,                          -- continuity 'L'.equipment_id
  trailer_type        text,                          -- trailer.trailer_type — reefer lives here (D-LM13)
  commodity           text,                          -- orders.commodity
  customer_id         text,                          -- orders.customer_id — a code; the name awaits a grant (Q-LMR5)
  weight              numeric,                       -- orders.weight — null is "not recorded", never 0
  pieces              integer,                       -- orders.pieces
  pallets_how_many    integer,                       -- orders.pallets_how_many
  consignee_refno     text,                          -- orders.consignee_refno
  move_distance       numeric,                       -- movement.move_distance — the only usable distance (D-MC15)

  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  closed_at           timestamptz,

  primary key (org_id, company_id, movement_id)
);

alter table mcleod_dispatch_movements enable row level security;

create table if not exists mcleod_dispatch_stops (
  org_id              uuid not null,
  company_id          text not null,                 -- stop.company_id
  stop_id             text not null,                 -- stop.id, char(32)
  movement_id         text not null,                 -- stop.movement_id

  movement_sequence   integer,                       -- stop.movement_sequence — up to 12 per movement measured
  stop_type           text,                          -- stop.stop_type, VERBATIM: PU, SO, SP, VA … (Q-GL1)
  status              text,                          -- stop.status: A open / D done
  location_id         text,                          -- stop.location_id — the shipper's own code
  location_name       text,                          -- stop.location_name — "BATTERY SOLUTIONS"
  address             text,
  city_name           text,
  state               text,
  zip_code            text,
  latitude            numeric,
  -- Negated by the agent from McLeod's west-positive value; see the header.
  longitude           numeric
                        constraint mcleod_dispatch_stops_longitude_west_check
                        check (longitude is null or longitude between -180 and 0),
  sched_arrive_early  timestamptz,
  sched_arrive_late   timestamptz,
  actual_arrival      timestamptz,
  actual_departure    timestamptz,
  eta                 timestamptz,
  contact_name        text,
  phone               text,
  ponum               text,

  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),

  primary key (org_id, company_id, stop_id),
  foreign key (org_id, company_id, movement_id)
    references mcleod_dispatch_movements (org_id, company_id, movement_id) on delete cascade
);

alter table mcleod_dispatch_stops enable row level security;

-- The projection reads a movement's stops in order; the FK's referencing side needs an index anyway.
create index if not exists mcleod_dispatch_stops_movement_idx
  on mcleod_dispatch_stops (org_id, company_id, movement_id, movement_sequence);
