-- 0123: identity uniqueness guards (2026-08 duplication incident).
--
-- The fleet was found fully duplicated in production. The sync code was ALREADY written to handle
-- unique-violations gracefully (samsaraVehicleSync catches 23505 and links instead of inserting) —
-- but the unique indexes it assumed never existed in the database, so duplicate inserts silently
-- succeeded. These partial unique indexes make the entire class structurally impossible: a second
-- row for the same physical identity now fails loudly and the sync's existing recovery path links
-- it instead.
--
-- ⚠ ORDER: run scripts/find-duplicates.sql first and clean any rows it reports (dedupe/merge or
-- delete the stray org). These CREATEs will refuse to build over existing duplicates — deliberately.

-- One row per physical Samsara truck per org.
create unique index if not exists uq_vehicles_org_samsara
  on vehicles (org_id, samsara_vehicle_id) where samsara_vehicle_id is not null;

-- One row per VIN per org.
create unique index if not exists uq_vehicles_org_vin
  on vehicles (org_id, upper(vin)) where vin is not null and vin <> '';

-- One ACTIVE row per unit number per org (retired/renamed "— OLD" rows stay allowed).
create unique index if not exists uq_vehicles_org_unit_active
  on vehicles (org_id, unit_number) where status = 'active';

-- One driver row per Samsara driver / EFS driver identity per org.
create unique index if not exists uq_drivers_org_samsara
  on drivers (org_id, samsara_driver_id) where samsara_driver_id is not null;
create unique index if not exists uq_drivers_org_efs
  on drivers (org_id, efs_driver_id) where efs_driver_id is not null;

-- One fill per import identity per org (the EFS import dedup key, now enforced).
create unique index if not exists uq_ftxn_org_external_ref
  on fuel_transactions (org_id, external_ref) where external_ref is not null;

-- At most one OPEN anomaly per (transaction, rule) — the reconcile logic already assumes this.
create unique index if not exists uq_anomalies_open_txn_rule
  on anomalies (transaction_id, rule_id) where status = 'open' and transaction_id is not null;
