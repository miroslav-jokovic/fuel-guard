-- 0116: company-issued driver credentials (Samsara model — DRIVER-CREDENTIALS-PLAN.md).
--
-- The org creates each driver's app login (username + generated password) and controls the lifecycle
-- from the Drivers page. This migration adds the username + issue timestamps to the roster row
-- (`app_access_enabled` from 0098 remains the active/disabled flag; Supabase Auth stays the sole
-- holder of the password) and fixes a footgun the plan's audit found: drivers.user_id (0003) had a
-- bare FK to auth.users, so deleting an auth user (credential revoke) would be BLOCKED by the roster
-- row. D14 specified `on delete set null`; this applies it.

alter table drivers add column if not exists app_username text;
alter table drivers add column if not exists app_credential_created_at timestamptz;
alter table drivers add column if not exists app_credential_reset_at timestamptz;

-- One username per org (case-insensitive). Global auth uniqueness is additionally enforced by the
-- synthetic email in Supabase Auth.
create unique index if not exists idx_drivers_org_app_username
  on drivers (org_id, lower(app_username))
  where app_username is not null;

-- drivers.user_id: bare FK → on delete set null (revoking a credential deletes the auth user; the
-- roster row must survive with its link cleared, ready for a re-issue).
alter table drivers drop constraint if exists drivers_user_id_fkey;
alter table drivers
  add constraint drivers_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

comment on column drivers.app_username is
  'Company-issued driver-app login (lowercase). Backed by a synthetic non-deliverable auth email; password lives ONLY in Supabase Auth. Lifecycle managed from the Drivers page.';
comment on column drivers.app_credential_created_at is 'When the current app login was first issued.';
comment on column drivers.app_credential_reset_at is 'Last admin password reset for the app login.';
