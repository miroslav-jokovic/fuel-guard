-- 0153 — H-C2 (D-H3/D-H4): a tank is a trailer. Cargo-tank capacity + compartments move onto the
-- equipment rows; `hazmat_cargo_tank_profiles` (0092) is dropped.
--
-- WHY: the profile table was a 1:1 foreign-key child of trailers/vehicles with its own page, API,
-- service and picker — a parallel equipment registry for what is simply a property of the trailer.
-- The IA audit (docs/plans/hazmat-consolidation) found the picker offered dry vans, nothing read the
-- data, and entering it only blocked auto-clear. The columns land where the equipment lives; the
-- analysis paths read them via readEquipmentKind; writes ride the existing fleet RLS on
-- trailers/vehicles (admin/fleet_manager per 0030/0032 policies — equipment config is fleet work).
--
-- NOTE: vehicles.tank_capacity_gal / trailers.reefer_tank_capacity_gal are FUEL tanks — never cargo.

alter table trailers
  add column if not exists cargo_capacity_gal numeric(8,1),
  add column if not exists cargo_compartments jsonb not null default '[]';

alter table vehicles
  add column if not exists cargo_capacity_gal numeric(8,1),
  add column if not exists cargo_compartments jsonb not null default '[]';

comment on column trailers.cargo_capacity_gal  is 'Cargo-tank capacity (gal), H-C2. null = unknown → engine conservative path. CARGO, not fuel.';
comment on column trailers.cargo_compartments  is 'Cargo-tank compartment plan [{index, capacityGal}], H-C2. [] = single tank / not a tank.';
comment on column vehicles.cargo_capacity_gal  is 'Cargo-tank capacity (gal) for straight trucks/bobtails, H-C2. CARGO, not fuel.';
comment on column vehicles.cargo_compartments  is 'Cargo-tank compartment plan [{index, capacityGal}], H-C2.';

-- Backfill from the profile table before it goes. Exactly one of trailer_id/vehicle_id is non-null
-- (0092 check constraint), so the two updates cover every row without overlap.
update trailers t
   set cargo_capacity_gal = p.cargo_capacity_gal,
       cargo_compartments = coalesce(p.compartments, '[]'::jsonb)
  from hazmat_cargo_tank_profiles p
 where p.trailer_id = t.id
   and p.org_id = t.org_id;

update vehicles v
   set cargo_capacity_gal = p.cargo_capacity_gal,
       cargo_compartments = coalesce(p.compartments, '[]'::jsonb)
  from hazmat_cargo_tank_profiles p
 where p.vehicle_id = v.id
   and p.org_id = v.org_id;

-- Drop the table (policies, triggers and the 0103 module-gate policy go with it).
drop table hazmat_cargo_tank_profiles;
