-- FuelGuard — 0083 driver identity (Driver App, Phase 1)
-- Links a login user to a roster driver so a signed-in driver resolves to exactly one drivers row,
-- and lets an auth user be deleted (offboarding) without an FK violation. Additive; nothing above
-- is modified destructively. See docs/plans/drivers-app/DRIVER-APP-PLAN.md §12 (D3, D14).

-- Which roster driver an invite provisions (required at the app layer when role = 'driver').
alter table invites add column if not exists driver_id uuid references drivers(id) on delete set null;

-- One login per driver, one driver per login, within an org (auth_driver_id() must be single-valued).
create unique index if not exists uq_drivers_org_user
  on drivers (org_id, user_id) where user_id is not null;

-- Offboarding: deleting an auth user must null the link, not fail. The original FK had no on-delete
-- action, which would block auth.admin.deleteUser once a driver is linked (audit §21 SB3 / D14).
alter table drivers drop constraint if exists drivers_user_id_fkey;
alter table drivers
  add constraint drivers_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;
