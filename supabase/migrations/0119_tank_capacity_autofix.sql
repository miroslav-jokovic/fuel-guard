-- 0119: tank-capacity provenance + self-healing record (WP-CAP part 2).
--
-- 0118 added the sensor-MEASURED capacity (vehicles.sensor_capacity_gal). Detection already trusts it;
-- this migration lets the RECORD heal itself: when the measurement is rock-solid (≥ 8 clustered
-- observations) and the entered tank_capacity_gal is missing or contradicts it beyond the divergence
-- threshold, the per-vehicle learner (learnVehicleValues → decideCapacityAutoFix) rewrites
-- tank_capacity_gal to the measured value, stamps tank_capacity_source = 'auto', and appends an
-- audit_logs row ('vehicle.capacity_autofix', meta = before/after/samples). Human edits through the
-- app set tank_capacity_source = 'manual' — pure provenance/transparency (physics still wins on the
-- next solid divergence; the audit trail shows every correction).

alter table vehicles add column if not exists tank_capacity_source text;

-- Existing entered capacities predate the learner → they are human entries.
update vehicles set tank_capacity_source = 'manual'
where tank_capacity_gal > 0 and tank_capacity_source is null;

comment on column vehicles.tank_capacity_source is
  'Provenance of tank_capacity_gal: ''manual'' = human-entered (form / setup import), ''auto'' = self-healed from the sensor-measured capacity (WP-CAP decideCapacityAutoFix; audit_logs action vehicle.capacity_autofix). Null = never set.';
