-- FuelGuard — seed data (dev only)
-- docs/02-DATA-MODEL.md §8. Creates Silvicom Inc, thresholds, drivers, vehicles, and ~140 fuel
-- transactions over ~90 days: mostly clean, plus explicit fills engineered to trip every anomaly
-- type once the Phase-5 engine scores them. Idempotent: safe to re-run (clears prior seed first).
-- NOTE: memberships/users come from the invite flow (Phase 2), so none are seeded here.

set local client_min_messages = warning;

-- Fixed org id so re-running and referencing is deterministic.
do $$
declare
  v_org uuid := '00000000-0000-0000-0000-0000000000a1';
begin
  -- clean prior seed (cascades to vehicles/drivers/transactions/anomalies/thresholds)
  delete from organizations where id = v_org;

  insert into organizations (id, name, allowed_domains, operating_hours)
  values (v_org, 'Silvicom Inc.', array['silvicominc.com'],
          '{"start":"05:00","end":"20:00","tz":"America/Chicago"}');

  insert into anomaly_thresholds (org_id) values (v_org);

  -- drivers (6)
  insert into drivers (org_id, full_name, employee_id, phone) values
    (v_org, 'Marcus Reyes',   'D-1001', '555-0101'),
    (v_org, 'Dana Whitfield', 'D-1002', '555-0102'),
    (v_org, 'Sam Okafor',     'D-1003', '555-0103'),
    (v_org, 'Priya Nair',     'D-1004', '555-0104'),
    (v_org, 'Tomasz Kowalski','D-1005', '555-0105'),
    (v_org, 'Grace Liu',      'D-1006', '555-0106');

  -- vehicles (8): 6 diesel, 1 gasoline, 1 electric (no fueling)
  insert into vehicles (org_id, unit_number, make, model, year, plate, fuel_type,
                        tank_capacity_gal, baseline_mpg, current_odometer) values
    (v_org, 'T-101', 'Freightliner', 'Cascadia', 2021, 'SIL101', 'diesel',   120.00, 6.40, 184000),
    (v_org, 'T-102', 'Kenworth',     'T680',     2020, 'SIL102', 'diesel',   125.00, 6.10, 210500),
    (v_org, 'T-103', 'Volvo',        'VNL',      2022, 'SIL103', 'diesel',   150.00, 6.80, 132750),
    (v_org, 'T-104', 'Peterbilt',    '579',      2019, 'SIL104', 'diesel',   120.00, 5.90, 268200),
    (v_org, 'T-105', 'International', 'LT',       2021, 'SIL105', 'diesel',   100.00, 6.50, 156300),
    (v_org, 'V-201', 'Ford',         'F-250',    2022, 'SIL201', 'gasoline',  34.00, 14.20, 41200),
    (v_org, 'T-106', 'Mack',         'Anthem',   2020, 'SIL106', 'diesel',   130.00, 6.20, 198400),
    (v_org, 'E-301', 'Ford',         'E-Transit',2023, 'SIL301', 'electric',   0.00, null,   12800);
end $$;

-- ── clean transaction history per fueling vehicle ────────────────────────────
do $$
declare
  v_org uuid := '00000000-0000-0000-0000-0000000000a1';
  v record;
  d_ids uuid[];
  i int;
  n_fills int := 20;
  cur_odo numeric;
  cur_time timestamptz;
  g numeric;
  miles numeric;
  mpg numeric;
  price numeric;
  drv uuid;
begin
  perform setseed(0.42);
  select array_agg(id) into d_ids from drivers where org_id = v_org;

  for v in
    select id, tank_capacity_gal, baseline_mpg, current_odometer
    from vehicles
    where org_id = v_org and fuel_type in ('diesel', 'gasoline')
    order by unit_number
  loop
    cur_odo := v.current_odometer;
    cur_time := now() - interval '95 days';
    mpg := coalesce(v.baseline_mpg, 7.0);

    for i in 1..n_fills loop
      drv := d_ids[1 + floor(random() * array_length(d_ids, 1))::int];
      g := round((v.tank_capacity_gal * (0.60 + random() * 0.30))::numeric, 1);
      miles := round((g * mpg * (0.90 + random() * 0.20))::numeric, 0);
      price := round((3.50 + random() * 0.70)::numeric, 3);
      cur_time := cur_time + (interval '1 day' * (4 + floor(random() * 3)));
      cur_odo := cur_odo + miles;

      insert into fuel_transactions
        (org_id, vehicle_id, driver_id, fueled_at, odometer, gallons,
         price_per_gal, total_cost, location_text, source)
      values
        (v_org, v.id, drv, cur_time, cur_odo, g, price, round(g * price, 2),
         'Pilot Flying J', 'manual');
    end loop;

    -- keep the advisory current_odometer aligned with history
    update vehicles set current_odometer = cur_odo where id = v.id;
  end loop;
end $$;

-- ── explicit anomaly examples (engine will flag these in Phase 5) ─────────────
do $$
declare
  v_org uuid := '00000000-0000-0000-0000-0000000000a1';
  v_id uuid;
  v_cap numeric;
  last_odo numeric;
  last_time timestamptz;
  drv uuid;
begin
  select id, tank_capacity_gal into v_id, v_cap
  from vehicles where org_id = v_org and unit_number = 'T-101';
  select max(odometer), max(fueled_at) into last_odo, last_time
  from fuel_transactions where vehicle_id = v_id;
  select id into drv from drivers where org_id = v_org and employee_id = 'D-1001';

  -- 1) exceeds tank capacity (critical): gallons 30% over tank
  insert into fuel_transactions (org_id, vehicle_id, driver_id, fueled_at, odometer, gallons,
    price_per_gal, total_cost, location_text, source)
  values (v_org, v_id, drv, last_time + interval '5 days', last_odo + 620,
    round(v_cap * 1.30, 1), 3.899, round(v_cap * 1.30 * 3.899, 2), 'Loves #221', 'manual');

  -- 2) odometer regression (high): odometer below previous
  insert into fuel_transactions (org_id, vehicle_id, driver_id, fueled_at, odometer, gallons,
    price_per_gal, total_cost, location_text, source)
  values (v_org, v_id, drv, last_time + interval '10 days', last_odo - 80,
    90.0, 3.799, round(90.0 * 3.799, 2), 'Loves #221', 'manual');

  -- 3) MPG deviation (high): big gallons, tiny miles since last
  insert into fuel_transactions (org_id, vehicle_id, driver_id, fueled_at, odometer, gallons,
    price_per_gal, total_cost, location_text, source)
  values (v_org, v_id, drv, last_time + interval '15 days', last_odo + 60,
    110.0, 3.950, round(110.0 * 3.950, 2), 'TA Express', 'manual');

  -- 4) rapid repeat fueling (high): two fills ~1h apart
  insert into fuel_transactions (org_id, vehicle_id, driver_id, fueled_at, odometer, gallons,
    price_per_gal, total_cost, location_text, source)
  values (v_org, v_id, drv, last_time + interval '20 days', last_odo + 700,
    100.0, 3.879, round(100.0 * 3.879, 2), 'Pilot #88', 'manual');
  insert into fuel_transactions (org_id, vehicle_id, driver_id, fueled_at, odometer, gallons,
    price_per_gal, total_cost, location_text, source)
  values (v_org, v_id, drv, last_time + interval '20 days 1 hour', last_odo + 705,
    95.0, 3.879, round(95.0 * 3.879, 2), 'Pilot #89', 'manual');

  -- 5) off-hours fueling (medium): 02:15 local-ish (UTC here; engine converts to org tz)
  insert into fuel_transactions (org_id, vehicle_id, driver_id, fueled_at, odometer, gallons,
    price_per_gal, total_cost, location_text, source)
  values (v_org, v_id, drv, date_trunc('day', last_time + interval '25 days') + interval '2 hours 15 minutes',
    last_odo + 1400, 105.0, 3.799, round(105.0 * 3.799, 2), '24/7 Fuel Depot', 'manual');

  -- 6) unattributed transaction (high): no vehicle, no driver
  insert into fuel_transactions (org_id, vehicle_id, driver_id, fueled_at, odometer, gallons,
    price_per_gal, total_cost, location_text, source)
  values (v_org, null, null, last_time + interval '26 days', null,
    88.0, 3.850, round(88.0 * 3.850, 2), 'Unknown card swipe', 'manual');
end $$;

-- summary
select
  (select count(*) from vehicles where org_id = '00000000-0000-0000-0000-0000000000a1') as vehicles,
  (select count(*) from drivers  where org_id = '00000000-0000-0000-0000-0000000000a1') as drivers,
  (select count(*) from fuel_transactions where org_id = '00000000-0000-0000-0000-0000000000a1') as transactions;
