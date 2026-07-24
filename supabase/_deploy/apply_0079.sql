-- FuelGuard — 0079 declines-pipeline hardening (WP1, docs/plans/WP1-DECLINES-SPEC.md)
-- 1) reason_category: the taxonomy classification of the decline reason (declineReason.ts) — written at
--    scoring so unknown phrasings are visible instead of silently scoring Clear (the 0851226257 failure).
-- 2) Optional EFS alert fields: card-assigned truck / proximity miles / truck-position time. The STANDARD
--    reject export does NOT carry them (verified — 15 columns); captured faithfully when a variant does.
-- 3) drivers.efs_driver_id: the stable EFS numeric driver identity (transaction "DriverId" == reject
--    "Driver ID") — attributes declines by identity and joins approvals ↔ declines across masked cards.
-- 4) fuel_cards.assignment_source: 'manual' rows are authoritative; the learner only writes 'learned'.
-- 5) efs_transactions faithful-store completeness for the 52-column export variant (DriverId,
--    TrailerNumber, Hubometer, Trip, SubFleet). trailer_number is the pump-keyed trailer — ground truth
--    for reefer pairing history (WP8).

alter table declined_transactions add column if not exists reason_category       text;
alter table declined_transactions add column if not exists card_assigned_unit    text;
alter table declined_transactions add column if not exists efs_proximity_miles   numeric(8,2);
alter table declined_transactions add column if not exists efs_truck_position_at text;  -- faithful capture; format varies by export variant
create index if not exists idx_declined_reason_category on declined_transactions (org_id, reason_category);

alter table drivers add column if not exists efs_driver_id text;
create unique index if not exists idx_drivers_efs_driver_id
  on drivers (org_id, efs_driver_id) where efs_driver_id is not null;

alter table fuel_cards add column if not exists assignment_source text not null default 'manual';
create index if not exists idx_fuel_cards_last4 on fuel_cards (org_id, card_last4);

alter table efs_transactions add column if not exists driver_ext_id  text;
alter table efs_transactions add column if not exists trailer_number text;
alter table efs_transactions add column if not exists hubometer      numeric;
alter table efs_transactions add column if not exists trip           text;
alter table efs_transactions add column if not exists subfleet       text;
