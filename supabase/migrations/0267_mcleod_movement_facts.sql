-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_movements — settled movements with miles and equipment attribution, as McLeod recorded them
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- The gap this closes: the movement-facts extraction (tools/mcleod-agent/movements.mjs, C1 in
-- docs/plans/mcleod/MCLEOD-CPM-DATA-SOURCE-SPEC.md) has been a validated dry-run since 2026-08-26 —
-- it reads, it reconciles (`loaded_miles` matches the carrier's own operations report for the same
-- window), and then it prints and exits. Nothing stores the miles, so `financial_entries` can price a
-- truck's costs but nothing can divide them by distance. This table is the denominator's staging.
--
-- Why McLeod's miles at all, when Samsara is the fleet's source of truth for routes and mileage
-- (owner ruling 2026-08-27): because this is the RAW layer, and the raw layer stores what the source
-- asserted, verbatim — `move_distance` is also the figure McLeod's own settlement pay and the
-- carrier's operations reports are built on, so reconciling those needs McLeod's number even where a
-- report ultimately prefers Samsara's. Which mileage basis a given report divides by is the harness's
-- decision, recorded per report — never a substitution made silently at ingest (same posture as
-- D-FS2: the non-authoritative copy is stored and marked, not discarded).
--
-- Stops ride along as JSONB rather than a second table, and that is a deliberate rejection of the
-- normalised shape: the only consumer of stops is `inferDeadheadLegs` (movementFact.ts), which reads
-- a movement's stops as one ordered array to chain deliveries to next pickups — there is no query
-- that wants a stop without its movement, so a `mcleod_movement_stops` table would add a second
-- writer surface, a join, and a partial-failure mode (movement landed, stops didn't) for no reader.
-- The payload shape IS the storage shape; `tmsMovementFactSchema` re-validates it on the way out.
--
-- Full-row idempotent upsert on (org_id, external_id), same as the other 0257-family staging tables:
-- a re-swept window REPLACES rows wholesale, because McLeod owns the truth of its own staging.
--
-- raw-access-waiver: this migration CREATES the mcleod raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
create table if not exists mcleod_movements (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  external_id         text not null,                     -- movement.id

  -- Resolved through equipment_item ('T'/'L'); movement has no tractor column of its own, and
  -- movement.carrier_tractor is purchased transportation, never the company truck (movementFact.ts).
  tractor_unit        text,
  trailer_unit        text,
  -- An array because team driving is real (176 of 21,215 movements carry two 'D' rows); a scalar
  -- would drop the co-driver or, joined naively, double-count the movement's miles (D-MC contract).
  driver_external_ids text[] not null default '{}',
  order_ids           text[] not null default '{}',

  -- move_distance: loaded miles ONLY — McLeod stores no empty miles anywhere (both manifest distance
  -- columns sum to exactly zero across all 21,547 movements settled in 2026). Deadhead is inferred
  -- by the harness from the stops payload, never stored as if McLeod asserted it (D-MC16).
  loaded_miles        numeric(10,1),
  -- fuel_distance: a cross-check running ~0.36% above move_distance fleet-wide; divergence beyond
  -- ~2% on a window is a data-quality alarm, not an alternative denominator (D-MC15).
  fuel_miles          numeric(10,1),
  distance_unit       text not null default 'MI'
                        constraint mcleod_movements_distance_unit_check
                        check (distance_unit in ('MI', 'KM')),

  external_status     text,
  movement_type       text,
  -- xfer2settle_date — when the trip closed into settlement. Batch-shared to the second on 70.3% of
  -- consecutive same-tractor pairs, so it orders SWEEP WINDOWS, never trips (D-MC29).
  settled_at          timestamptz,

  -- The ordered stop array, exactly as tmsStopFactSchema shapes it (seq, kind, city, state, lat,
  -- lon, arrived_at, departed_at, distance_from_previous). 46,384 of 46,384 stops measured in 2026
  -- carry coordinates, and the agent fails a sweep that loses them.
  stops               jsonb not null default '[]',

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists uq_mcleod_movements_external
  on mcleod_movements (org_id, external_id);
-- The CPM read path: one tractor's settled movements over a window.
create index if not exists idx_mcleod_movements_tractor
  on mcleod_movements (org_id, tractor_unit, settled_at desc);
create index if not exists idx_mcleod_movements_settled
  on mcleod_movements (org_id, settled_at desc);

create trigger trg_mcleod_movements_updated before update on mcleod_movements
  for each row execute function set_updated_at();

-- Service-role only, like every mcleod staging table: no client policies on purpose — the browser
-- never reads raw collector staging (ARCHITECTURE §6 raw-layer seal).
alter table mcleod_movements enable row level security;
