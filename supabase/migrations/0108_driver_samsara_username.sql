-- FuelGuard — 0108 store the Samsara driver login (the alpha-code "Driver ID")
--
-- Samsara drivers carry a `username` (a login handle like "aaron") separate from the numeric fleet id
-- already stored in `samsara_driver_id` (e.g. 54516182). Operators identify drivers by this handle, so
-- the roster needs it. It is telematics-owned identity, synced alongside name/phone; never entered by
-- an admin, so no uniqueness constraint (Samsara guarantees its own).
--
-- Rollback: alter table drivers drop column if exists samsara_username;

alter table drivers add column if not exists samsara_username text;

comment on column drivers.samsara_username is
  'Samsara driver login / alpha-code Driver ID (e.g. "aaron"). Synced from Samsara; distinct from the numeric samsara_driver_id.';
