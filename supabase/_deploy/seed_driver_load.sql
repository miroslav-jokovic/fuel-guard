-- ═══════════════════════════════════════════════════════════════════════════════
-- FuelGuard — seed one driver load (manual dispatch, until a TMS feed or a web
-- dispatch UI writes these rows).
--
-- Creates a 3-stop load assigned to a driver, with per-stop photo checklists, so the driver app's
-- Loads → accept → per-stop capture flow is demoable end-to-end against real data.
--
-- HOW TO USE
--   1. Edit the v_* values in the "EDIT THIS" block below.
--   2. Run the whole file in the Supabase SQL editor (service role — bypasses RLS, which is correct
--      for seeding; drivers are read-only on these tables by design, migration 0085).
--   3. Re-running creates ANOTHER load unless you change v_ref — the ref is not unique by design
--      (a carrier may legitimately reuse one), so the script guards on it explicitly.
--
-- Requires migration 0085_driver_loads.sql (see _deploy/apply_driver_app.sql).
-- ═══════════════════════════════════════════════════════════════════════════════

do $$
declare
  -- ─────────────────────────── EDIT THIS ───────────────────────────
  v_driver_email  text := 'driver@example.com';  -- the driver's LOGIN email (drivers.user_id → auth.users)
  v_unit_number   text := null;                  -- vehicle unit to attach, or null to use their assigned truck
  v_ref           text := 'LD-20481';            -- load number shown in the app
  v_equipment     text := 'Dry van';
  v_commodity     text := 'General freight';
  v_hazmat        boolean := false;
  v_total_miles   numeric := 361.0;
  -- ──────────────────────────────────────────────────────────────────

  v_org_id    uuid;
  v_driver_id uuid;
  v_vehicle   uuid;
  v_load_id   uuid;
  v_stop_id   uuid;
begin
  -- Resolve the driver from their login email.
  select d.id, d.org_id
    into v_driver_id, v_org_id
  from drivers d
  join auth.users u on u.id = d.user_id
  where lower(u.email) = lower(v_driver_email)
  limit 1;

  if v_driver_id is null then
    raise exception
      'No driver is linked to the login %. Invite them from the dashboard first (the invite links drivers.user_id on accept).',
      v_driver_email;
  end if;

  if exists (select 1 from loads where org_id = v_org_id and ref = v_ref) then
    raise exception 'A load with ref % already exists in this org — change v_ref to seed another.', v_ref;
  end if;

  -- Vehicle: the named unit, else whatever is already assigned to this driver.
  if v_unit_number is not null then
    select id into v_vehicle from vehicles where org_id = v_org_id and unit_number = v_unit_number;
    if v_vehicle is null then
      raise exception 'No vehicle with unit_number % in this org.', v_unit_number;
    end if;
  else
    select id into v_vehicle from vehicles
    where org_id = v_org_id and assigned_driver_id = v_driver_id
    order by unit_number limit 1;
  end if;

  -- The load itself. 'offered' so the driver sees it under Upcoming with an Accept action.
  insert into loads (org_id, driver_id, vehicle_id, ref, status, equipment, commodity, hazmat, total_miles, source)
  values (v_org_id, v_driver_id, v_vehicle, v_ref, 'offered', v_equipment, v_commodity, v_hazmat, v_total_miles, 'manual')
  returning id into v_load_id;

  -- Stop 1 — pickup. Photo checklist proves what left the shipper.
  insert into load_stops (org_id, load_id, seq, kind, name, address_line, city, state, postal_code,
                          appointment_start, appointment_end, required_photos)
  values (v_org_id, v_load_id, 1, 'pickup', 'Midwest Distribution Center',
          '1400 Rockwell Ave', 'Joliet', 'IL', '60433',
          now() + interval '2 hours', now() + interval '4 hours',
          array['trailer', 'seal', 'bol']);

  -- Stop 2 — intermediate drop (this is what makes it a multi-stop run).
  insert into load_stops (org_id, load_id, seq, kind, name, address_line, city, state, postal_code,
                          appointment_start, appointment_end, required_photos)
  values (v_org_id, v_load_id, 2, 'dropoff', 'Indianapolis Cross-Dock',
          '3050 W Morris St', 'Indianapolis', 'IN', '46241',
          now() + interval '1 day' + interval '4 hours',
          now() + interval '1 day' + interval '6 hours',
          array['bol', 'load_secured']);

  -- Stop 3 — final delivery.
  insert into load_stops (org_id, load_id, seq, kind, name, address_line, city, state, postal_code,
                          appointment_start, appointment_end, required_photos)
  values (v_org_id, v_load_id, 3, 'dropoff', 'Columbus Regional Warehouse',
          '2400 Fairwood Ave', 'Columbus', 'OH', '43207',
          now() + interval '1 day' + interval '10 hours',
          now() + interval '1 day' + interval '12 hours',
          array['bol', 'damage'])
  returning id into v_stop_id;

  raise notice 'Seeded load % (%) for driver % with 3 stops. Load id: %',
    v_ref, v_equipment, v_driver_email, v_load_id;
end $$;

-- Verify what the driver will see (run as service role; RLS is bypassed here on purpose).
select l.ref, l.status, l.equipment, l.hazmat, l.total_miles,
       s.seq, s.kind, s.name, s.city, s.state, s.status as stop_status, s.required_photos
from loads l
join load_stops s on s.load_id = l.id
order by l.created_at desc, s.seq;
