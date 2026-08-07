-- FuelGuard — 0138 reconcile the legacy duplicate 0016 vehicle fuel-level migration
--
-- The repository historically contained two files with version 0016. Supabase can record only one
-- migration per version, and the remote ledger records 0016_driver_samsara_idx. The schema already
-- contains these columns, so this idempotent reconciliation preserves fresh installs and lets the
-- canonical migration ledger represent the legacy change without replaying a non-idempotent ALTER.

alter table if exists public.vehicles
  add column if not exists samsara_fuel_percent numeric(5,1),
  add column if not exists samsara_fuel_at timestamptz;
