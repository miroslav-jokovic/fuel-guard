-- 0221 — bulk date-of-birth import (PSP-PLAN P0b).
--
-- Production on 2026-08-20 held 201 drivers who could be screened and a date of birth for none of
-- them, so nothing could be screened at all. The value usually already exists in the carrier's
-- payroll export; what was missing was a way in that is not 201 page visits.
--
-- ── WHY A FUNCTION AND NOT 201 PATCHES ─────────────────────────────────────────────────────────
-- Not speed. The rule that matters is NEVER OVERWRITE, and this is the only place it can be
-- enforced rather than merely observed. `packages/shared/src/driverDobCsv.ts` also refuses a row for
-- a driver who already has a date, but it decides that from a roster it read a moment earlier — and
-- between that read and this write somebody may have typed one in on the driver's own page. The
-- `date_of_birth is null` predicate below closes that window: a stale plan cannot clobber a fresh
-- value, it simply updates nothing.
--
-- A date of birth is not a preference. It selects which human being a PSP or MVR request is about,
-- so a silent overwrite redirects a screening to a different person, bills for it (§8), and can file
-- a record against somebody whose job depends on it. Corrections stay a deliberate single-driver
-- edit on that driver's page, where one person is looking at one file.
--
-- Set-based UPDATE from jsonb, on the 0174/0175 pattern — never an upsert, which would check NOT
-- NULL before conflict arbitration and cannot express "only if the column is still empty" anyway.
--
-- Service role only (0174/0178/0183 convention): the function takes a tenant id and acts on it, so
-- it must never be reachable from a session where `p_org` would be the caller's to choose.

create or replace function public.apply_driver_dob(
  p_org   uuid,
  p_rows  jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
  update public.drivers d
     set date_of_birth = r.date_of_birth,
         updated_at = now()
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           driver_id     uuid,
           date_of_birth date
         )
   where d.id = r.driver_id
     and d.org_id = p_org
     -- The window the shared planner cannot close. See the header.
     and d.date_of_birth is null
     and r.date_of_birth is not null;
  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function public.apply_driver_dob(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_driver_dob(uuid, jsonb) to service_role;

comment on function public.apply_driver_dob(uuid, jsonb) is
  'P0b: set drivers.date_of_birth in bulk for one org, ONLY where it is still null. Never overwrites — a correction is a deliberate single-driver edit. Returns rows updated.';
