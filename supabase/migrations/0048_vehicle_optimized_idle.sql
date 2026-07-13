-- 0048: split idle-reduction into two INDEPENDENT attributes (idle Phase B follow-up).
--
-- 0046 added a single has_apu flag that CONFLATED two different pieces of equipment:
--   • a real APU / battery-HVAC / shore power → the main engine should be OFF at rest, and
--   • Freightliner Cascadia "Optimized Idle" → the OEM system runs the main engine in short cycles ON PURPOSE.
-- Scoring them the same wrongly flags an Optimized-Idle truck's normal engine cycling as driver waste, so they
-- must be recorded separately for the idle score to be fair.
--
--   apu_type            : richer idle-reduction equipment (added in 0046, now app-wired):
--                         diesel_apu | battery_hvac | fuel_heater | shore_power | none. null = unknown/unset.
--   has_optimized_idle  : true = truck has OEM optimized idle (engine auto start/stop for cab climate/battery);
--                         false = none; null = unknown/unset (default). DISTINCT from has_apu.
--
-- has_apu stays the "engine-off capable" source of truth (derived from apu_type in the app). Free-text columns
-- constrained in the app layer (matches the vehicle_status / classification convention) — no DB CHECK.
alter table vehicles add column if not exists has_optimized_idle boolean;

comment on column vehicles.has_optimized_idle is
  'Manual source of truth: does this truck have OEM optimized idle (e.g. Freightliner Cascadia)? null = unknown. Distinct from has_apu (engine-off capable).';
comment on column vehicles.apu_type is
  'Idle-reduction equipment: diesel_apu | battery_hvac | fuel_heater | shore_power | none. Refines has_apu.';
