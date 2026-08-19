-- 0212 — what a recruiter may write. The PostgREST half of the section matrix.
--
-- Two grants, and the boundary between them is the whole design (RECRUITER-ROLE-SCOPE.md §2).
--
-- 1. `driver_employment_history` (0208/0209) — the recruiter's own surface. `recruitment: manage`.
--
-- 2. `drivers` — the narrow one, granted BY NAME rather than by widening a section. An applicant is
--    a `drivers` row (driver_employment_history.driver_id references it), so a recruiter cannot work
--    without writing that table. But `fleet: manage` is also vehicles, trailers and terminals through
--    seventeen other policies, and handing those over to close this gap would recreate in miniature
--    the leak the `recruitment` section was introduced to fix. So the matrix keeps the recruiter at
--    `fleet: view` and this policy names them on the one table they need.
--
-- The API mirrors this: routes/roster/drivers.ts admits rolesThatManage("recruitment") on create and
-- update alongside rolesThatManage("fleet"), and admits nothing else.
--
-- Termination is NOT carved out here and deliberately stays available to the recruiter through the
-- same UPDATE. `resolveDriverUpdate` stamps the §391.51(c) retention clock on a status change, which
-- reads as a fleet action rather than a hiring one — but expressing that in RLS would need a
-- column-level rule Postgres does not give us on this shape, and a policy that pretended to enforce
-- it would be worse than one that does not claim to. Recorded as RECRUITER-ROLE-SCOPE.md Q3.

drop policy if exists drivers_write on drivers;
create policy drivers_write on drivers for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager', 'recruiter'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager', 'recruiter'));

drop policy if exists driver_employment_history_write on public.driver_employment_history;
create policy driver_employment_history_write on public.driver_employment_history
  for all using (
    org_id = public.auth_org_id()
    and public.auth_role() = any (array['admin','fleet_manager','safety_manager','recruiter'])
  ) with check (
    org_id = public.auth_org_id()
    and public.auth_role() = any (array['admin','fleet_manager','safety_manager','recruiter'])
  );

drop policy if exists driver_employment_history_section_read on public.driver_employment_history;
create policy driver_employment_history_section_read on public.driver_employment_history
  as restrictive for select
  using (
    public.auth_role() = 'driver'
    or public.auth_role() in ('admin', 'fleet_manager', 'safety_manager', 'auditor', 'recruiter')
  );
