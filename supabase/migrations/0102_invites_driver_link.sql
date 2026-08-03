-- FuelGuard — 0102 invite → driver link (Master Data & Identity, M2 · plan §2.6, §3)
--
-- THE ONE COLUMN THAT FIXES THE DRIVER APP.
--
-- Today the invite flow is email + role and nothing else. An invited driver gets an auth user and a
-- membership, and that is where identity stops — `drivers.user_id` is never set by any code path
-- (it is only ever CLEARED, on offboarding). So the roster and the login are two disconnected
-- worlds: `auth_driver_id()` (0083) returns null, `GET /api/me/driver` 404s `no_driver_record`, and
-- the driver app sits on a screen with no profile behind it.
--
-- `invites.driver_id` carries the intent from "invite THIS person on the roster" through the email
-- round-trip to the moment they accept, where routes/invites.ts POST /accept binds
-- drivers.user_id = the accepting auth user and flips app_access_enabled (plan §3.2).
--
-- ON DELETE CASCADE: if the roster row is deleted, a pending invite pointing at it is meaningless.
-- Generic (non-driver) invites leave this null and are completely unaffected.

alter table invites add column if not exists driver_id uuid references drivers(id) on delete cascade;

create index if not exists idx_invites_driver on invites(driver_id) where driver_id is not null;

comment on column invites.driver_id is
  'Roster driver this invite enrolls for app access. On /accept the API sets drivers.user_id to the
   accepting auth user — the link auth_driver_id() and GET /api/me/driver depend on. Null = a plain
   office invite (unchanged behavior).';
