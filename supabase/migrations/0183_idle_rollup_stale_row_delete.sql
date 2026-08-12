-- 0183: set-based, tenant-scoped deletion for idle rollup rows absent from the fresh derivation.
--
-- WHY (idle precision incident 2026-08-12). vehicle_engine_days and idle_park_sessions reconcile their
-- source rows when Samsara no longer returns a truck-day. idle_rollup_days is derived state, so an old
-- row must be removed when its source key disappears; otherwise the page renders a historical orphan.
-- The service passes only (vehicle_id, day) keys and the tenant is supplied separately, so a stale-row
-- cleanup cannot cross an organization boundary or resurrect/partially write a row.
create or replace function public.delete_idle_rollup_rows(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  deleted integer;
begin
  delete from public.idle_rollup_days r
   using jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as stale(vehicle_id uuid, day date)
   where r.org_id = p_org
     and r.vehicle_id = stale.vehicle_id
     and r.day = stale.day;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.delete_idle_rollup_rows(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.delete_idle_rollup_rows(uuid, jsonb) to service_role;

comment on function public.delete_idle_rollup_rows(uuid, jsonb) is
  'Delete derived idle rollup keys absent from a fresh tenant-scoped derivation; used by idle precision convergence cleanup.';
