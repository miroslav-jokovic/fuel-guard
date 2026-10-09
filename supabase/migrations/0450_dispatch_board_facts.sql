-- 0450: the three facts the dispatch board needs and does not have (DISPATCH-BOARD-PLAN.md DB1–DB3).
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
-- The owner, 2026-10-09: "Vinnie has 8 trucks in his fleet — are we getting this from McLeod?" McLeod
-- has it (`tractor.fleet_id = 'VINNIEV'` on exactly those eight, measured on live `lme` the same day);
-- we did not, because the roster sweep never read the column. From the loads alone the board would
-- show Vinnie ONE truck — the one he happens to be moving — and hide the three of his sitting on
-- uncovered loads. D-DB1 rules two axes, never merged: the truck's home FLEET (who owns it) and the
-- load's DISPATCHER (who is moving it today; D-LM3, unchanged). This migration gives the first a home.
--
-- ── 1. `vehicles.mcleod_fleet_code` ──────────────────────────────────────────────────────────────
-- The TMS's fleet code, verbatim ('VINNIEV', 'KANE', '1'). Nullable: 43 McLeod tractors carry none,
-- and an absent code is "the TMS put this truck in no fleet", not the empty string. Named for its
-- source because it IS the source's code — fleet codes are not logins ('IVO' is dispatched by 'ivok'),
-- so the code means nothing until `tms_fleets` below says whose it is. Not identity: the roster's
-- "office owns the identity" rule does not apply to it, for the same reason it does not apply to the
-- fuel-tax exclusion (0433) — the office editing a plate does not make McLeod wrong about the fleet.
--
-- ── 2. `tms_fleets` — whose fleet a code is ──────────────────────────────────────────────────────
-- One row per fleet code the feed has seen, and the McLeod dispatcher login that runs it. The link is
-- an OFFICE act, like `tms_dispatchers.user_id` (D-LM4): a prefill may propose 'VINNIEV' → 'vinniev'
-- where the names match (10 of 14 did on 2026-10-09), but a person confirms it, and a re-sync never
-- overwrites it. So "my fleet" is derived through two confirmed links — fleet → McLeod login → our
-- user — and nothing here stores a user id a second time. No FK to `tms_dispatchers`, for 0344's
-- reason: the two arrive in separate pushes.
--
-- ── 3. `driver_hos_clocks` — the remaining drive / shift / cycle / break time, per driver ─────────
-- Samsara's `/fleet/hos/clocks` answers for the whole fleet in one call, and today only fuel planning
-- asks it — live, and then forgets. `drivers.current_hos_status` comes from the same endpoint but in
-- the six-hour driver-scores tier, so the Assignments page shows a duty badge up to six hours old.
-- This is current state: one row per Samsara driver, overwritten on every poll (DB3, every 5 min).
--
-- Keyed by `samsara_driver_id`, deliberately WITHOUT a foreign key to `drivers`: a cascade from
-- `drivers` would have to be listed in `merge_driver` (the 0203/0234 trap), and a row that is
-- rewritten every five minutes has nothing worth carrying through a merge. The reader resolves the
-- driver through `drivers.samsara_driver_id` at read time, the way the map resolves a position.
-- `duty_status` carries no CHECK: its vocabulary is `normalizeHosStatus`'s in `@silvicom/shared`, and
-- a closed list restated here would be a copy of it.
--
-- ── RLS: ENABLED, NO POLICY, DENY-ALL ON PURPOSE ─────────────────────────────────────────────────
-- All three are read through the API with the service role, which bypasses RLS; the org filter is
-- the service's job and `expectOrgScoped` is what proves it.
--
-- ── NOT EVIDENCE ─────────────────────────────────────────────────────────────────────────────────
-- A fleet code and a clock are current state, re-derivable on the next sweep or poll. Only the
-- office's `tms_fleets` links would cost anything to lose, and they are re-confirmable in a minute.
--
-- ── SCHEMA ONLY. NO READER, NO WRITER ────────────────────────────────────────────────────────────
-- `vehicles.mcleod_fleet_code` is a new COLUMN on a table the deployed code already reads, and Railway
-- serves a merge before `migrate` applies its schema, so its first writer and reader ship in the next
-- merge (`lint:migration-ordering`). The two new tables are exempt; they wait with it anyway, so the
-- whole board arrives in one reviewable code change.

-- raw-access-waiver: this migration CREATES the two raw tables it names — each collector's own DDL
-- (mcleod's `tms_fleets`, samsara's `driver_hos_clocks`), no cross-module read.
-- cross-module-waiver: one nullable column on roster's `vehicles` (the truck's TMS fleet code, written
-- by mcleod's roster sweep beside the fuel-tax fact it already writes), mcleod's own `tms_fleets`, and
-- samsara's own `driver_hos_clocks`. The three are the dispatch board's inputs and ship together so the
-- plan's DB1–DB3 land as one schema step; no existing column, row or behaviour of any module changes.
alter table vehicles add column if not exists mcleod_fleet_code text;

create table if not exists tms_fleets (
  org_id                 uuid not null references organizations(id) on delete cascade,
  -- 'mcleod' today; part of the key for 0344's reason (two TMS instances must not collide).
  provider               text not null,
  -- The TMS's fleet code, verbatim and trimmed by the agent: 'VINNIEV', 'KANE', '1'.
  code                   text not null,
  -- The McLeod login that runs this fleet ('vinniev'), once an office confirms it. Null = unlinked,
  -- the normal state for a pool like '1' (parked and shop trucks) that nobody dispatches.
  dispatcher_external_id text,
  -- Who confirmed the link, for the audit row's sake; null until somebody does.
  linked_by              uuid references auth.users(id) on delete set null,
  linked_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (org_id, provider, code)
);

alter table tms_fleets enable row level security;

create table if not exists driver_hos_clocks (
  org_id              uuid not null references organizations(id) on delete cascade,
  samsara_driver_id   text not null,
  -- The truck Samsara says the driver is logged into; null when they are logged into none.
  samsara_vehicle_id  text,
  duty_status         text not null,
  -- Milliseconds remaining, verbatim from Samsara. Null = Samsara sent no such clock (not zero: a
  -- driver with 0 ms of drive left is a different fact from one Samsara did not report).
  drive_remaining_ms  bigint,
  shift_remaining_ms  bigint,
  cycle_remaining_ms  bigint,
  break_remaining_ms  bigint,
  -- When our poll read it. The board says "HOS as of …" from this, and calls a row older than two
  -- polls stale rather than presenting it as now.
  fetched_at          timestamptz not null,
  primary key (org_id, samsara_driver_id)
);

alter table driver_hos_clocks enable row level security;
