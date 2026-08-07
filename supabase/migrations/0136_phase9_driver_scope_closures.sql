-- FuelGuard — 0136 close two driver-scope leaks + one duty invariant (Phase 9 release gate)
--
-- HOW THESE WERE FOUND. Repairing the offline RLS matrix (see 0135's header) let its full set of
-- assertions execute for the first time. Three of them failed against reality:
--
--   FAIL  driver reads only own time-off (1)        saw 2
--   FAIL  driver cannot read TMS movements (0)      saw 1
--   FAIL  an ended shift must say why               (the UPDATE succeeded; no error raised)
--
-- WHAT WAS OPEN. The 0086 ledger entry records "the three F4 leaks closed (trailers,
-- driver_time_off, tms_movements)". Only `trailers` actually shipped a policy
-- (`trailers_driver_scope`, 0086 L213). `driver_time_off` and `tms_movements` still carry ONLY the
-- org-wide read from 0068:
--
--     create policy driver_time_off_select on driver_time_off for select using (org_id = auth_org_id());
--     create policy tms_movements_select   on tms_movements   for select using (org_id = auth_org_id());
--
-- Under those, any driver JWT reads EVERY colleague's time-off calendar (who is on home time, PTO,
-- medical leave — personal schedule data about other people) and the org's whole TMS movement feed
-- (dispatch/telematics operational data the driver app never renders). RLS is this product's
-- authorization boundary (§1), so "the app does not show it" is not a control.
--
-- THE FIX. The same RESTRICTIVE, driver-only shape 0083/0084/0086 already use — AND-combined with
-- the existing PERMISSIVE org read, a no-op for every non-driver role:
--   * driver_time_off → a driver reads their OWN rows (their leave is theirs to see).
--   * tms_movements   → denied outright; there is no driver-facing TMS surface, and 0084's stated
--                       pattern for a pathless table is to deny rather than gate.
--
-- THE THIRD ITEM. `driver_duty_sessions` documents that an auto-close must stay distinguishable
-- from a real sign-off ("never quietly pollutes attribution analysis", 0086) — but only the VALUE
-- of `ended_reason` was constrained, never its PRESENCE, so a shift could be ended with no reason
-- at all. Added as NOT VALID: it enforces every future insert/update immediately while grandfathering
-- any historical row, which is the safe pattern for a live table. Validate it later with:
--     alter table driver_duty_sessions validate constraint duty_ended_needs_reason;
-- after confirming `select count(*) from driver_duty_sessions where ended_at is not null and ended_reason is null` is 0.

-- ── driver_time_off: own rows only ────────────────────────────────────────────
drop policy if exists driver_time_off_driver_scope on driver_time_off;
create policy driver_time_off_driver_scope on driver_time_off
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or driver_id = auth_driver_id()
  );

-- ── tms_movements: no driver-facing surface exists → deny ─────────────────────
drop policy if exists tms_movements_driver_scope on tms_movements;
create policy tms_movements_driver_scope on tms_movements
  as restrictive for select
  using (
    auth_role() <> 'driver'
  );

-- ── an ended shift must say why ───────────────────────────────────────────────
alter table driver_duty_sessions
  drop constraint if exists duty_ended_needs_reason;
alter table driver_duty_sessions
  add constraint duty_ended_needs_reason
  check (ended_at is null or ended_reason is not null)
  not valid;
