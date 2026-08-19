-- 0209 — make the PostgREST path agree with the `recruitment` section (2026-08-19).
--
-- 0208 shipped `driver_employment_history` with an org-wide SELECT policy, because at the time the
-- surface was gated on the `fleet` capability and every org member could already read the Fleet
-- section. `recruitment` is now its own section in packages/shared/src/auth.ts, and the reason it
-- exists is exactly this read: gated on `fleet`, a DISPATCHER could read every driver's former
-- employers, their dates and their contact details, because a dispatcher reads Fleet to see who is
-- on which truck. §391.53(a)(1) limits the investigation history to "those who are involved in the
-- hiring decision", and 0205 already drew that line for the inquiry RECORDS; this draws it for the
-- employer list the inquiries are about.
--
-- RESTRICTIVE, so it ANDs onto 0208's permissive org policy and can only narrow. The role list is
-- rolesThatCanView('recruitment') — admin, fleet_manager, safety_manager, auditor. `auditor` is in it
-- deliberately: a DOT audit is precisely the reader who asks for this file.
--
-- WHY 'driver' IS IN THE PREDICATE, even though the matrix says recruitment: none for drivers.
-- A section governs the OFFICE surfaces. Self-view is a separate axis and always has been —
-- `safety` and `fleet` are also "none" for a driver, yet 0129 lets a driver read their OWN
-- qualification_records. Without this clause the restrictive policy would silently overrule 0208's
-- driver-scope policy and a driver could not see what the office recorded about them. The
-- driver-scope policy from 0208 still ANDs on top, so a driver sees their own row and no other.
--
-- Defence in depth, not the enforcement: the API reads this table with the service role, which
-- bypasses RLS entirely, and routes/recruitment.ts guards on rolesThatCanView('recruitment').
create policy driver_employment_history_section_read on public.driver_employment_history
  as restrictive for select
  using (
    public.auth_role() = 'driver'
    or public.auth_role() in ('admin', 'fleet_manager', 'safety_manager', 'auditor')
  );
