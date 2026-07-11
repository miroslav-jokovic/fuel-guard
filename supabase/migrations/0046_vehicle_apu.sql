-- 0046: manual APU / idle-reduction attribute (idle Phase B, audit A1.2).
--
-- A diesel APU is a separate, EPA-certified engine that is NOT a node on the truck's J1939 bus, so its runtime
-- and fuel burn are invisible to the truck ECU/telematics — APU presence cannot be reliably inferred and must
-- be a MANUAL asset attribute. This is the source of truth for the idle "avoidable" logic: an APU-equipped
-- truck idling the main engine overnight is avoidable (the driver could have run the APU); a truck with no
-- idle-reduction option can't. The learned idle_capability (0043) becomes a cross-check, not the authority.
--
--   has_apu  : true = has APU / battery-HVAC / shore power; false = none; null = unknown/unset (default).
--   apu_type : optional richer classification (diesel_apu | battery_hvac | fuel_heater | shore_power | none).
alter table vehicles add column if not exists has_apu  boolean;
alter table vehicles add column if not exists apu_type text;

comment on column vehicles.has_apu is
  'Manual source of truth: does this truck have an APU / optimized-idle option? null = unknown.';
