-- 0110: merge_driver(org, source, canonical) — atomically fold a duplicate/name-only driver (source, e.g. an
-- EFS-provisioned "ANGEL CORA COMP") into the canonical Samsara driver, moving ALL history so nothing is
-- orphaned, then deleting the source. Runs in a single transaction (one function call), so it either fully
-- reassigns or not at all. Used by the driver reconcile + the manual "Link to Samsara driver" action.
--
-- Every table that references drivers(id) is handled (16 columns). Tables with a per-driver unique key
-- (scores/perf-weeks/endorsements per week/code, one open duty session) drop the source's colliding rows
-- first — the source is a name-only EFS row that essentially never has these, but correctness demands it.
create or replace function merge_driver(p_org uuid, p_source uuid, p_canonical uuid)
returns void
language plpgsql
as $$
declare
  v_efs   text;
  v_phone text;
  v_emp   text;
begin
  if p_source is null or p_canonical is null or p_source = p_canonical then
    return;
  end if;
  -- Both must be real drivers in this org (guards against cross-tenant / bad ids).
  if not exists (select 1 from drivers where id = p_source and org_id = p_org)
     or not exists (select 1 from drivers where id = p_canonical and org_id = p_org) then
    raise exception 'merge_driver: source % or canonical % not found in org %', p_source, p_canonical, p_org;
  end if;

  -- Carry identity the canonical row is missing, then release the source's efs id BEFORE writing it onto the
  -- canonical (avoids a transient unique clash if efs_driver_id is ever uniquely indexed).
  select efs_driver_id, phone, employee_id into v_efs, v_phone, v_emp from drivers where id = p_source;
  update drivers set efs_driver_id = null where id = p_source;
  update drivers
     set efs_driver_id = coalesce(efs_driver_id, v_efs),
         phone         = coalesce(phone, v_phone),
         employee_id   = coalesce(employee_id, v_emp)
   where id = p_canonical and org_id = p_org;

  -- ── straightforward history / references (no per-driver uniqueness) ─────────────────────────────
  update fuel_transactions     set driver_id = p_canonical where driver_id = p_source;
  update fuel_cards            set driver_id = p_canonical where driver_id = p_source;
  update declined_transactions set driver_id = p_canonical where driver_id = p_source;
  update idle_events           set driver_id = p_canonical where driver_id = p_source;
  update hos_duty_segments     set driver_id = p_canonical where driver_id = p_source;
  update driver_time_off       set driver_id = p_canonical where driver_id = p_source;
  update loads                 set driver_id = p_canonical where driver_id = p_source;
  update load_stop_photos      set driver_id = p_canonical where driver_id = p_source;
  update hazmat_loads          set driver_id = p_canonical where driver_id = p_source;
  update invites               set driver_id = p_canonical where driver_id = p_source;
  update vehicles set assigned_driver_id = p_canonical where assigned_driver_id = p_source;
  update vehicles set owner_driver_id    = p_canonical where owner_driver_id    = p_source;

  -- ── unique-keyed children: drop source's colliding rows, then reassign the rest ────────────────
  delete from driver_scores s
   where s.driver_id = p_source
     and exists (select 1 from driver_scores c
                  where c.driver_id = p_canonical and c.org_id = s.org_id and c.week_start = s.week_start);
  update driver_scores set driver_id = p_canonical where driver_id = p_source;

  delete from driver_performance_weeks s
   where s.driver_id = p_source
     and exists (select 1 from driver_performance_weeks c
                  where c.driver_id = p_canonical and c.org_id = s.org_id and c.week_start = s.week_start);
  update driver_performance_weeks set driver_id = p_canonical where driver_id = p_source;

  delete from driver_endorsements s
   where s.driver_id = p_source
     and exists (select 1 from driver_endorsements c
                  where c.driver_id = p_canonical and c.code = s.code);
  update driver_endorsements set driver_id = p_canonical where driver_id = p_source;

  -- one OPEN duty session per driver (partial unique where ended_at is null)
  delete from driver_duty_sessions s
   where s.driver_id = p_source and s.ended_at is null
     and exists (select 1 from driver_duty_sessions c where c.driver_id = p_canonical and c.ended_at is null);
  update driver_duty_sessions set driver_id = p_canonical where driver_id = p_source;

  -- ── finally, remove the now-empty source driver ────────────────────────────────────────────────
  delete from drivers where id = p_source and org_id = p_org;
end;
$$;

comment on function merge_driver(uuid, uuid, uuid) is
  'Atomically fold a duplicate/name-only driver (source) into the canonical driver: reassign every drivers(id) reference, drop the source''s colliding unique rows, carry missing identity, delete source. See docs/plans / driver reconcile.';
