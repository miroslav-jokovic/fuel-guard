-- 0043: learned per-truck idle capability, from the engineStates park-session analysis (see
-- learnIdleCapability). Lets the driver idle score be FAIR — a driver on a truck with no APU / optimized idle
-- can't shut the engine off during a wait, so we don't penalize idle the truck couldn't avoid.
--   idle_capability   : apu | ecu_optimized | continuous_only | unknown
--   idle_optimized_pct: share (0–100) of parked time this truck spent in a good mode (APU/off or ECU cycling)
alter table vehicles add column if not exists idle_capability     text;
alter table vehicles add column if not exists idle_optimized_pct  numeric(4,1);

comment on column vehicles.idle_capability is
  'Learned from engineStates park sessions: apu | ecu_optimized | continuous_only | unknown.';
