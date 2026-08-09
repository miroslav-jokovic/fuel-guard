-- 0155: repair schema drift found by Supabase database lint
--
-- Two historical defects were safe to repair additively:
-- 1. duty RPCs already write duty_equipment_segments.updated_at, but one production schema lacked it.
-- 2. merge_driver still referenced driver_endorsements after 0147 retired that table. Certifications is
--    the surviving source of driver endorsements and is moved with collision-safe temporal semantics.

alter table public.duty_equipment_segments
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_duty_equipment_segment_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_duty_equipment_segments_updated on public.duty_equipment_segments;
create trigger trg_duty_equipment_segments_updated
  before update on public.duty_equipment_segments
  for each row execute function public.set_duty_equipment_segment_updated_at();

create or replace function public.merge_driver(p_org uuid, p_source uuid, p_canonical uuid)
returns void
language plpgsql
as $$
declare
  v_efs text;
  v_phone text;
  v_emp text;
begin
  if p_source is null or p_canonical is null or p_source = p_canonical then
    return;
  end if;
  if not exists (select 1 from public.drivers where id = p_source and org_id = p_org)
     or not exists (select 1 from public.drivers where id = p_canonical and org_id = p_org) then
    raise exception 'merge_driver: source % or canonical % not found in org %', p_source, p_canonical, p_org;
  end if;

  select efs_driver_id, phone, employee_id into v_efs, v_phone, v_emp
    from public.drivers where id = p_source;
  update public.drivers set efs_driver_id = null where id = p_source;
  update public.drivers
     set efs_driver_id = coalesce(efs_driver_id, v_efs),
         phone = coalesce(phone, v_phone),
         employee_id = coalesce(employee_id, v_emp)
   where id = p_canonical and org_id = p_org;

  update public.fuel_transactions set driver_id = p_canonical where driver_id = p_source;
  update public.fuel_cards set driver_id = p_canonical where driver_id = p_source;
  update public.declined_transactions set driver_id = p_canonical where driver_id = p_source;
  update public.idle_events set driver_id = p_canonical where driver_id = p_source;
  update public.hos_duty_segments set driver_id = p_canonical where driver_id = p_source;
  update public.driver_time_off set driver_id = p_canonical where driver_id = p_source;
  update public.loads set driver_id = p_canonical where driver_id = p_source;
  update public.load_stop_photos set driver_id = p_canonical where driver_id = p_source;
  update public.hazmat_loads set driver_id = p_canonical where driver_id = p_source;
  update public.invites set driver_id = p_canonical where driver_id = p_source;
  update public.vehicles set assigned_driver_id = p_canonical where assigned_driver_id = p_source;
  update public.vehicles set owner_driver_id = p_canonical where owner_driver_id = p_source;

  delete from public.driver_scores s
   where s.driver_id = p_source
     and exists (select 1 from public.driver_scores c
                  where c.driver_id = p_canonical and c.org_id = s.org_id and c.week_start = s.week_start);
  update public.driver_scores set driver_id = p_canonical where driver_id = p_source;

  delete from public.driver_performance_weeks s
   where s.driver_id = p_source
     and exists (select 1 from public.driver_performance_weeks c
                  where c.driver_id = p_canonical and c.org_id = s.org_id and c.week_start = s.week_start);
  update public.driver_performance_weeks set driver_id = p_canonical where driver_id = p_source;

  -- Certifications are temporal and append-only. When both drivers have a current row for the same
  -- kind/qualifier, preserve the source row as superseded history before moving it to the canonical id.
  update public.certifications s
     set superseded_by = c.id,
         superseded_at = coalesce(s.superseded_at, now()),
         updated_at = now()
    from public.certifications c
   where s.org_id = p_org
     and s.subject_type = 'driver'
     and s.subject_id = p_source
     and s.superseded_by is null
     and c.org_id = p_org
     and c.subject_type = 'driver'
     and c.subject_id = p_canonical
     and c.superseded_by is null
     and c.kind = s.kind
     and coalesce(c.qualifier, '') = coalesce(s.qualifier, '');
  update public.certifications
     set subject_id = p_canonical,
         updated_at = now()
   where org_id = p_org and subject_type = 'driver' and subject_id = p_source;

  delete from public.driver_duty_sessions s
   where s.driver_id = p_source and s.ended_at is null
     and exists (select 1 from public.driver_duty_sessions c
                  where c.driver_id = p_canonical and c.ended_at is null);
  update public.driver_duty_sessions set driver_id = p_canonical where driver_id = p_source;

  delete from public.drivers where id = p_source and org_id = p_org;
end;
$$;

comment on function public.merge_driver(uuid, uuid, uuid) is
  'Atomically folds a duplicate driver into the canonical driver. Retired driver_endorsements is not referenced; temporal certifications are collision-safe and preserved.';
