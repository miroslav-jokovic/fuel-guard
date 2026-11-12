-- 0594 — an office email correction moves the roster's email too, through the roster's own function
-- (APPLICATION-FIX-PLAN.md §5 Q-AM16, owner 2026-11-11: (a), "through a roster-owned RPC").
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- Since F3c part 2 (E3) an office correction of the applicant's email moves the invitation's email, so
-- every later message goes to the right address. `drivers.email` did not move: no application path has
-- ever written it, because the roster owns the row and a recruiter does not hold the roster section. So
-- the Recruiting list kept showing the old address, and a later re-invite started from it.
--
-- ── WHY A FUNCTION, AND WHY THE ROSTER'S ────────────────────────────────────────────────────────
-- The recruiting module may not write another module's table (`docs/ARCHITECTURE.md`, table ownership),
-- and the roster section's permission is not the recruiter's. So the roster states, in one place, the
-- only email change it accepts from an application. The rules are atomic here, not checks in the API
-- followed by a write:
--   · the row must be this org's, the invitation's own driver, and still an APPLICANT. Once hired, the
--     roster's email is the roster's business (corrected on the driver's page), never an application's;
--   · the row must still hold the address the correction replaced, or none. An email somebody set on
--     the roster in the meantime is theirs, and is never overwritten from an application. Compared
--     without case and spaces, as the invitation's own move is (`sameEmail`);
--   · the invitation must not be filed. After filing nothing the application says may change (Q-AM2).
-- It answers whether it moved, never why not: each "no" is a legitimate state, not an error.
--
-- ── DEPLOY WINDOW ───────────────────────────────────────────────────────────────────────────────
-- A new function only. The API calls it from the next merge.

create or replace function public.move_applicant_roster_email(
  p_org        uuid,
  p_invitation uuid,
  p_from       text,
  p_to         text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver uuid;
  v_moved  uuid;
begin
  if nullif(btrim(p_to), '') is null then
    raise exception 'roster_email_blank' using errcode = 'RE001';
  end if;

  select driver_id into v_driver
    from public.application_invitations
   where id = p_invitation and org_id = p_org and submitted_at is null;
  if v_driver is null then
    return false;
  end if;

  update public.drivers
     set email = btrim(p_to), updated_at = now()
   where id = v_driver
     and org_id = p_org
     and status = 'applicant'
     and (nullif(btrim(email), '') is null or lower(btrim(email)) = lower(btrim(coalesce(p_from, ''))))
  returning id into v_moved;
  return v_moved is not null;
end;
$$;

revoke all on function public.move_applicant_roster_email(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.move_applicant_roster_email(uuid, uuid, text, text) to service_role;

comment on function public.move_applicant_roster_email(uuid, uuid, text, text) is
  'Q-AM16 (0594): the roster''s one acceptance of an email from an application. Sets drivers.email to p_to for the invitation''s driver only while that driver is an applicant of this org, the invitation is unfiled, and the row holds p_from (case-insensitive) or no email. Returns whether it moved. RE001 for a blank p_to.';
