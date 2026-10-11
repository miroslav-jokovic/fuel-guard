-- 0400 — unit 568 is one truck in two rows; make it one (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md FL1b,
-- Q-FL2, Q-FL5, Q-FL6 (a)). The 0359 pattern (unit 732), applied to the second truck it fits.
--
-- ── WHAT HAPPENED ───────────────────────────────────────────────────────────────────────────────
-- Measured on production 2026-10-01. Samsara holds two vehicle records for unit 568, both with VIN
-- `3AKJHHDR5MSMS9642` and, today, neither with a gateway (`568 - OLD` = a retired gateway, Q-FL2;
-- the other is now named `568 - SOLD`). We hold one row per record, backwards:
--
--   759ef27a  `568`        retired  samsara  no link   device …145500   97 fills, 327 financial entries,
--                                                                       91 anomalies, the fuel card, a
--                                                                       trailer, tank 240 gal learned,
--                                                                       engine days 04/14 → 09/05
--   990128aa  `568 - OLD`  active   mcleod   link 568  device …689800   VIN, plate, inspection, purchase
--                                                                       date; engine days 08/05 → 08/30
--
-- ── WHICH ROW SURVIVES (Q-FL5, owner 2026-10-01: "as recommended") ─────────────────────────────
-- The HISTORY row, `568`, exactly as 0359 chose for 732: every piece of evidence is already on it and
-- none of it moves. It takes McLeod's identity, link and status from the other row (McLeod says active;
-- Q-FL4: it stays as McLeod has it). It KEEPS its own device, which is the later one (data to 09/05),
-- its own learned tank and baseline MPG, and its own idle learning (19 sessions, `sufficient`, against
-- the other row's 0).
--
-- ── WHY THE RETIRED ROW GIVES UP ITS DEVICE (Q-FL6 (a)) ─────────────────────────────────────────
-- The daily IFTA tier re-fetches the last three months and files each device's miles under the row
-- holding that device. A retired row still holding …689800 would collect its July/August miles again
-- beside the copies this file moves — already visible today: that device's June (17) and July (5)
-- rows sit on BOTH rows, re-fetched 09/30 onto whichever held it. So the retired row is left with no
-- device, as 0359 left 732's. The record still carries the truck's VIN, which used to mean the
-- vehicle sync would VIN-match it onto the survivor and the two records would re-link it in turn every
-- cycle; FL1b part 1 (merged and deployed BEFORE this file) holds such a match instead.
--
-- ── HOW EACH TABLE IS JOINED, WHERE THE TWO ROWS COLLIDE ────────────────────────────────────────
-- Measured on production 2026-10-01. Everything not listed re-parents in the generic loop below, which
-- covers EVERY foreign key into `vehicles`; a missed table fails the zero-reference check at the end.
--   · fuel_spend_days     7 of the other row's 9 days collide. Derived (0244): the other row's are
--                         dropped; `POST /api/fuel/spend-rollup` from 2026-08-02 rebuilds them.
--   · idle_rollup_days    1 collision (08/02). Seconds add; the per-day verdicts come from whichever
--                         device covered more of the day (0359's rule).
--   · vehicle_engine_days 0 collisions today; 0359's sum is kept so a late write cannot break the merge.
--   · samsara_odometer_readings  0 collisions today; on (source, day) the later reading wins (0359).
--   · samsara_ifta_jurisdiction_miles  22 collide on (device, month, jurisdiction) — the same device's
--                         June/July miles stored on both rows, identical values. The later fetch is
--                         kept; nothing is summed, because they are one set of miles, not two.
--   · idle_telemetry_windows, vehicle_positions — one row per truck: the survivor's (the later device).
--   · vehicle_idle_learned, vehicle_tank_learned — 0262's mirrors; the retired row's are dropped last.
--   · idle_events         keyed by (org, event_key) since 0398, which carries no vehicle: no collision.
--
-- ── WHEN IT DOES NOTHING ────────────────────────────────────────────────────────────────────────
-- Anywhere the two rows are not both present in the measured shape — every fresh database, and
-- production after this has run once — it raises a NOTICE and returns. Checked after deploy by hand.
--
-- Proved by `supabase/tests/merge-unit-568.test.mjs` against production's shapes.
--
-- cross-module-waiver: merging two rows of one truck is by definition every module that hangs data
-- off `vehicles` — fuel-spend, samsara, idle, anomalies, roster — and the re-parent is generic over
-- the FK graph so no module's table is left pointing at a retired row. Each row keeps its columns and
-- changes only its vehicle_id, except the named collisions above, resolved the way each rollup would.
-- raw-access-waiver: `samsara_odometer_readings`, `vehicle_positions`, `idle_telemetry_windows` and
-- `samsara_ifta_jurisdiction_miles` are raw telemetry of THIS truck, re-parented or de-duplicated on
-- collision, never re-derived; a one-off audited act (FL1b), not a reader or writer that recurs.

do $merge$
declare
  h constant uuid := '759ef27a-124d-4b22-8429-bca6a8b0c6cf';   -- `568`, the history row: survives
  n constant uuid := '990128aa-6994-49fe-800c-f3365bcdee64';   -- `568 - OLD`: merged into it
  hv public.vehicles;
  nv public.vehicles;
  moved jsonb := '{}'::jsonb;
  dropped jsonb := '{}'::jsonb;
  cnt integer;
  fk record;
  remaining integer;
begin
  select * into hv from public.vehicles where id = h;
  select * into nv from public.vehicles where id = n;

  if hv.id is null or nv.id is null then
    raise notice '0400: unit 568 rows not present — nothing to merge';
    return;
  end if;
  if hv.org_id <> nv.org_id
     or hv.unit_number <> '568'
     or hv.mcleod_tractor_id is not null
     or nv.unit_number <> '568 - OLD'
     or nv.mcleod_tractor_id is distinct from '568' then
    raise notice '0400: unit 568 rows are not in the measured shape (already merged, or changed since 2026-10-01) — nothing done';
    return;
  end if;

  -- ── 1. Free the other row's unique keys: VIN, McLeod link, Samsara device (Q-FL6 (a)) ───────
  update public.vehicles
     set vin = null, mcleod_tractor_id = null, mcleod_company_id = null, samsara_vehicle_id = null
   where id = n;

  -- ── 2. The survivor takes McLeod's identity, link and status; keeps its device and learning ──
  update public.vehicles set
    identity_source                  = 'mcleod',
    status                           = nv.status,
    mcleod_tractor_id                = nv.mcleod_tractor_id,
    mcleod_company_id                = nv.mcleod_company_id,
    vin                              = nv.vin,
    make                             = coalesce(nv.make, hv.make),
    model                            = coalesce(nv.model, hv.model),
    year                             = coalesce(nv.year, hv.year),
    plate                            = coalesce(nv.plate, hv.plate),
    plate_state                      = coalesce(nv.plate_state, hv.plate_state),
    registration_expires_at          = coalesce(nv.registration_expires_at, hv.registration_expires_at),
    dot_annual_inspection_expires_at = coalesce(nv.dot_annual_inspection_expires_at, hv.dot_annual_inspection_expires_at),
    dot_annual_inspection_source     = coalesce(nv.dot_annual_inspection_source, hv.dot_annual_inspection_source),
    purchased_at                     = coalesce(nv.purchased_at, hv.purchased_at),
    current_odometer                 = greatest(hv.current_odometer, nv.current_odometer),
    eld_id                           = coalesce(hv.eld_id, nv.eld_id)
  where id = h;

  -- ── 3. Tables where the two rows collide ─────────────────────────────────────────────────────
  delete from public.fuel_spend_days where vehicle_id = n;
  get diagnostics cnt = row_count; dropped := dropped || jsonb_build_object('fuel_spend_days', cnt);

  update public.vehicle_engine_days hd set
    drive_sec    = hd.drive_sec + nd.drive_sec,
    idle_sec     = hd.idle_sec + nd.idle_sec,
    off_sec      = hd.off_sec + nd.off_sec,
    coverage_sec = least(hd.coverage_sec + nd.coverage_sec, 86400),
    synced_at    = greatest(hd.synced_at, nd.synced_at)
  from public.vehicle_engine_days nd
  where hd.vehicle_id = h and nd.vehicle_id = n and nd.day = hd.day;
  get diagnostics cnt = row_count; moved := moved || jsonb_build_object('vehicle_engine_days_summed', cnt);
  delete from public.vehicle_engine_days nd
   where nd.vehicle_id = n and exists (select 1 from public.vehicle_engine_days hd where hd.vehicle_id = h and hd.day = nd.day);

  update public.idle_rollup_days hd set
    drive_sec           = hd.drive_sec + nd.drive_sec,
    idle_sec            = hd.idle_sec + nd.idle_sec,
    off_sec             = hd.off_sec + nd.off_sec,
    coverage_sec        = least(hd.coverage_sec + nd.coverage_sec, 86400),
    managed_idle_sec    = hd.managed_idle_sec + nd.managed_idle_sec,
    continuous_idle_sec = hd.continuous_idle_sec + nd.continuous_idle_sec,
    rest_idle_sec       = hd.rest_idle_sec + nd.rest_idle_sec,
    work_idle_sec       = hd.work_idle_sec + nd.work_idle_sec,
    other_idle_sec      = hd.other_idle_sec + nd.other_idle_sec,
    optimized_envelope_inside_sec    = coalesce(hd.optimized_envelope_inside_sec, 0) + coalesce(nd.optimized_envelope_inside_sec, 0),
    optimized_envelope_outside_sec   = coalesce(hd.optimized_envelope_outside_sec, 0) + coalesce(nd.optimized_envelope_outside_sec, 0),
    optimized_envelope_unknown_sec   = coalesce(hd.optimized_envelope_unknown_sec, 0) + coalesce(nd.optimized_envelope_unknown_sec, 0),
    optimized_envelope_ambiguous_sec = coalesce(hd.optimized_envelope_ambiguous_sec, 0) + coalesce(nd.optimized_envelope_ambiguous_sec, 0),
    hos_rest_sec        = coalesce(hd.hos_rest_sec, 0) + coalesce(nd.hos_rest_sec, 0),
    hos_work_sec        = coalesce(hd.hos_work_sec, 0) + coalesce(nd.hos_work_sec, 0),
    hos_unknown_sec     = coalesce(hd.hos_unknown_sec, 0) + coalesce(nd.hos_unknown_sec, 0),
    hos_ambiguous_sec   = coalesce(hd.hos_ambiguous_sec, 0) + coalesce(nd.hos_ambiguous_sec, 0),
    hos_grace_sec       = coalesce(hd.hos_grace_sec, 0) + coalesce(nd.hos_grace_sec, 0),
    optimized_envelope_status = case when nd.coverage_sec > hd.coverage_sec then nd.optimized_envelope_status else hd.optimized_envelope_status end,
    optimized_envelope_source = case when nd.coverage_sec > hd.coverage_sec then nd.optimized_envelope_source else hd.optimized_envelope_source end,
    hos_evidence_status       = case when nd.coverage_sec > hd.coverage_sec then nd.hos_evidence_status else hd.hos_evidence_status end,
    attributed_driver_id      = case when nd.coverage_sec > hd.coverage_sec then nd.attributed_driver_id else hd.attributed_driver_id end,
    updated_at          = now()
  from public.idle_rollup_days nd
  where hd.vehicle_id = h and nd.vehicle_id = n and nd.day = hd.day;
  get diagnostics cnt = row_count; moved := moved || jsonb_build_object('idle_rollup_days_summed', cnt);
  delete from public.idle_rollup_days nd
   where nd.vehicle_id = n and exists (select 1 from public.idle_rollup_days hd where hd.vehicle_id = h and hd.day = nd.day);

  delete from public.samsara_odometer_readings hd
   using public.samsara_odometer_readings nd
   where hd.vehicle_id = h and nd.vehicle_id = n and nd.source = hd.source and nd.day = hd.day
     and nd.reading_at > hd.reading_at;
  get diagnostics cnt = row_count; dropped := dropped || jsonb_build_object('samsara_odometer_readings_superseded', cnt);
  delete from public.samsara_odometer_readings nd
   where nd.vehicle_id = n
     and exists (select 1 from public.samsara_odometer_readings hd
                  where hd.vehicle_id = h and hd.source = nd.source and hd.day = nd.day);

  -- One device's miles stored twice: keep the later fetch, whichever row holds it.
  delete from public.samsara_ifta_jurisdiction_miles hd
   using public.samsara_ifta_jurisdiction_miles nd
   where hd.vehicle_id = h and nd.vehicle_id = n
     and nd.samsara_vehicle_id = hd.samsara_vehicle_id and nd.period_year = hd.period_year
     and nd.period_month = hd.period_month and nd.jurisdiction = hd.jurisdiction
     and nd.fetched_at >= hd.fetched_at;
  get diagnostics cnt = row_count; dropped := dropped || jsonb_build_object('samsara_ifta_jurisdiction_miles_superseded', cnt);
  delete from public.samsara_ifta_jurisdiction_miles nd
   where nd.vehicle_id = n
     and exists (select 1 from public.samsara_ifta_jurisdiction_miles hd
                  where hd.vehicle_id = h and hd.samsara_vehicle_id = nd.samsara_vehicle_id
                    and hd.period_year = nd.period_year and hd.period_month = nd.period_month
                    and hd.jurisdiction = nd.jurisdiction);

  delete from public.idle_park_sessions nd
   where nd.vehicle_id = n
     and exists (select 1 from public.idle_park_sessions hd where hd.vehicle_id = h and hd.started_at = nd.started_at);

  -- One row per truck: the survivor's device is the later one.
  delete from public.idle_telemetry_windows where vehicle_id = n and exists (select 1 from public.idle_telemetry_windows where vehicle_id = h);
  delete from public.vehicle_positions      where vehicle_id = n and exists (select 1 from public.vehicle_positions where vehicle_id = h);

  -- ── 4. Everything else re-parents, for EVERY foreign key into vehicles ───────────────────────
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.vehicles'::regclass
       and c.conrelid not in ('public.vehicle_idle_learned'::regclass, 'public.vehicle_tank_learned'::regclass)
  loop
    execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col) using h, n;
    get diagnostics cnt = row_count;
    if cnt > 0 then moved := moved || jsonb_build_object(fk.tbl::text || '.' || fk.col, cnt); end if;
  end loop;

  -- ── 5. Retire the other row under a name no matcher will reach ───────────────────────────────
  update public.vehicles
     set status = 'retired', unit_number = '568-merged-' || left(n::text, 8)
   where id = n;

  -- ── 6. Its learned-satellite mirrors ─────────────────────────────────────────────────────────
  delete from public.vehicle_idle_learned where vehicle_id = n;
  delete from public.vehicle_tank_learned where vehicle_id = n;

  -- ── 7. Nothing may still point at it ─────────────────────────────────────────────────────────
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.vehicles'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', fk.tbl, fk.col) into remaining using n;
    if remaining > 0 then
      raise exception '0400: % rows in %.% still reference the merged row', remaining, fk.tbl, fk.col;
    end if;
  end loop;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (hv.org_id, null, 'roster.vehicle_merged', 'vehicles', h, jsonb_build_object(
    'unit_number', '568',
    'merged_from', n,
    'merged_from_unit_number', nv.unit_number,
    'survivor_samsara_vehicle_id', hv.samsara_vehicle_id,
    'released_samsara_vehicle_id', nv.samsara_vehicle_id,
    'moved', moved,
    'dropped', dropped,
    'reason', 'one truck in two rows after a Samsara gateway swap; history row kept (Q-FL5), retired row releases its device (Q-FL6 (a))',
    'measured_at', '2026-10-01',
    'migration', '0400',
    'plan', 'FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md FL1b'
  ));
end
$merge$;
