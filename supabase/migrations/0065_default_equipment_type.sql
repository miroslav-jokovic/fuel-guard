-- 0065: per-org default equipment/trailer type (Fuel Planning). Pre-fills the plan form so hazmat is
-- never presumed and each company's usual load is the default; a per-plan selection still overrides.
alter table route_fuel_settings add column if not exists default_equipment_type text not null default 'dry_van';
