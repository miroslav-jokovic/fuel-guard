-- 0029: split reefer (ULSR) fuel from tractor fuel. A fuel event is now per (card, invoice, date, tank).
-- 'tractor' = the truck's propulsion tank (ULSD); 'reefer' = trailer refrigeration tank (ULSR, dyed).
-- Reefer events are scored separately so their gallons never inflate tractor tank/over-fuel/MPG checks.
-- Existing rows default to 'tractor'; re-deriving from the EFS store (sync-from-efs) splits history.
alter table fuel_transactions add column if not exists tank_type text not null default 'tractor';
create index if not exists idx_ftxn_vehicle_tank on fuel_transactions (org_id, vehicle_id, tank_type, fueled_at desc);
