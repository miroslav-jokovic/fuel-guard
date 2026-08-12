-- FuelGuard — 0184 vehicle replacement lifecycle (identity check 2026-08-12)
--
-- When a truck is physically replaced, its Samsara vehicle record disappears — but nothing marked the
-- FuelGuard record, so five "… - OLD" ghosts sat active for weeks: they can never sync again, they
-- drag down fleet coverage statistics, and the active-truck count no longer reconciles to Samsara's.
--
-- `samsara_missing_since` is stamped by the fleet identity sync when the mapped samsara_vehicle_id
-- stops existing at Samsara, and CLEARED if it reappears. It deliberately does NOT auto-retire the
-- vehicle: a gateway swap or a device fault can make a live truck vanish from the API temporarily
-- (four such trucks were found the same day this shipped), so retirement stays a human decision —
-- the UI surfaces "Samsara link lost since …" and the admin retires the truck when it is really gone.
--
-- Rollback: drop the column. No data is migrated by this file.

alter table vehicles add column if not exists samsara_missing_since timestamptz;

comment on column vehicles.samsara_missing_since is
  'Set by the fleet identity sync when the mapped Samsara vehicle no longer exists at Samsara; cleared if it reappears. Never auto-retires — surfaces a "likely replaced" prompt for a human decision.';
