-- FuelGuard — 0137 enforce the core.app feature invariant
--
-- `core.app` is the operational update-policy channel, not a visibility toggle. The resolver always
-- keeps it enabled and reads its config (currently minVersion). Keep the database invariant aligned
-- with the API so a service-role path cannot persist a misleading disabled row.

update public.driver_app_features
set enabled = true,
    updated_at = now()
where feature_key = 'core.app'
  and enabled = false;

alter table public.driver_app_features
  drop constraint if exists driver_app_features_core_app_enabled_check;

alter table public.driver_app_features
  add constraint driver_app_features_core_app_enabled_check
  check (feature_key <> 'core.app' or enabled);
