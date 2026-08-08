-- 0151 — end the shift dispatch actually looked at (loads plan L5).
--
-- THE DRIFT. `POST /api/dispatch/assignments/:driverId/end` closes "whatever session this driver has
-- open", but the board it is clicked from is a snapshot refetched every sixty seconds. A driver who
-- signs off and checks into a different truck inside that window turns dispatch's click on a stale
-- row into a close of the session that just STARTED — silently, and reported as success. The board
-- already carries `session_id` on every row; the endpoint simply never used it.
--
-- Ending by session id makes the action target the thing dispatch saw. Two consequences, both wanted:
-- a session that has since closed is a no-op rather than a mis-fire, and a session that has since
-- been replaced is refused rather than closed by accident.
--
-- `end_duty_session(p_org, p_driver, …)` is kept: the DRIVER app legitimately means "close my open
-- shift" and has no stale snapshot to be wrong about. Two callers, two different questions, two
-- functions — which is the point.

create or replace function public.end_duty_session_by_id(
  p_org        uuid,
  p_session_id uuid,
  p_ended_at   timestamptz default null,
  p_odometer   numeric     default null,
  p_reason     text        default 'dispatch'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := coalesce(p_ended_at, now());
  v_ended   timestamptz;
begin
  select ended_at into v_ended
    from public.driver_duty_sessions
   where id = p_session_id and org_id = p_org;

  -- Cross-tenant or nonexistent: indistinguishable, on purpose.
  if not found then
    raise exception 'Duty session not found' using errcode = 'DG010';
  end if;

  -- Already closed — by the driver, by the sweeper, or by a replayed click. Idempotent, not an error:
  -- the caller's intent ("this shift should be closed") is satisfied.
  if v_ended is not null then
    return p_session_id;
  end if;

  update public.driver_duty_sessions
     set ended_at = v_now, ended_reason = p_reason, end_odometer = coalesce(p_odometer, end_odometer)
   where id = p_session_id and org_id = p_org;

  -- Close every segment still open under it, so the equipment timeline (0150) does not hold a truck
  -- against a driver who has signed off. The view derives this too; writing it keeps the table honest
  -- for anything reading segments directly.
  update public.duty_equipment_segments
     set to_at = v_now
   where session_id = p_session_id and org_id = p_org and to_at is null;

  return p_session_id;
end;
$$;

comment on function public.end_duty_session_by_id(uuid, uuid, timestamptz, numeric, text) is
  'Close ONE named duty session (L5). Ending by driver id closes whatever is open now, which on a
   60-second board snapshot can be a shift that started after the page rendered.';

revoke all on function public.end_duty_session_by_id(uuid, uuid, timestamptz, numeric, text) from public;
grant execute on function public.end_duty_session_by_id(uuid, uuid, timestamptz, numeric, text) to service_role;
