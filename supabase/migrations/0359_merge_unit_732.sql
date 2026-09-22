-- 0359 — unit 732 is one truck in two rows; make it one (FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md F4, Q-9).
--
-- ── WHAT HAPPENED ───────────────────────────────────────────────────────────────────────────────
-- Unit 732's Samsara gateway was replaced on 2026-08-24 (owner-stated; `732 - OLD` in Samsara is the
-- pulled device, `gateway: {serial: "", model: "none"}` — §1.7a). The new gateway arrived named by
-- its serial, so Samsara created a second vehicle, and we a second row:
--
--   de57e742  `732`           retired  samsara  no link   the pulled device   102 fills, tank 240 gal learned
--   698c08f1  `G6AA-5HS-XTC`  active   mcleod   link 732  the live device     telemetry since the swap
--
-- McLeod's matcher linked tractor 732 by VIN to the serial-named row, D-MR11 rightly refused to
-- rename a unit number as a sync side effect, and the truck has been on the map under its gateway
-- serial ever since, with its fuel history on a row marked retired.
--
-- ── WHICH ROW SURVIVES (Q-9, decided (a) 2026-09-22, delegated by the owner) ───────────────────
-- The HISTORY row. Every piece of EVIDENCE is already on it — 102 fuel transactions, 347 financial
-- entries, 12 declines, the fuel card, the learned 240-gal tank the fills were scored against — and
-- none of it moves. What moves is the newer row's TELEMETRY: engine days, idle events, park
-- sessions, odometer readings, IFTA miles, the position. Keeping the other row would re-parent 102
-- fills onto a tank of 0 and re-score them; this way nothing already judged is judged again.
-- The plan measured "59 derived rows"; the full measurement is ~650 across ten tables, because it
-- counted only the two day rollups. None of the ~650 is evidence.
--
-- ── HOW EACH TABLE IS JOINED, WHERE THE TWO ROWS COLLIDE ────────────────────────────────────────
-- Measured on production 2026-09-22. Everything not listed moves with a plain re-parent, and the
-- generic loop below does that for EVERY foreign key into `vehicles`, including any added after this
-- file was written — a missed table fails the zero-reference check at the end, it is not skipped.
--   · fuel_spend_days     30 of 30 of the newer row's days collide: fills stayed on one row and
--                         telemetry moved to the other, so each day is half a truth on each side.
--                         A spend-day is DERIVED (0244), so the newer row's copies are dropped and
--                         the day is rebuilt: the nightly rollup covers the last 14 days, and
--                         `POST /api/fuel/spend-rollup` rebuilds 2026-08-24 onward in one call.
--   · vehicle_engine_days 1 collision, the swap day. Seconds from two devices covering disjoint parts
--                         of one day ADD; coverage is capped at a day.
--   · idle_rollup_days    1 collision, the swap day. Seconds add; the per-day verdict columns come
--                         from whichever device covered more of the day.
--   · samsara_odometer_readings  collisions on (source, day): the LATER reading is kept, because a
--                         day's reading is its last and the new gateway read after the old one died.
--   · idle_telemetry_windows, vehicle_positions — one row per truck: the LIVE device's wins.
--   · vehicle_idle_learned, vehicle_tank_learned — mirrors of `vehicles` columns kept by 0262's
--                         trigger, so they follow the merged row by themselves; the retired row's
--                         copies are dropped last.
--   · samsara_ifta_jurisdiction_miles — every row moves, both devices' August included, which is
--                         what 0357/0358 made possible. Without them the next re-fetch of August
--                         would have overwritten twenty-four days of one truck's miles with eight.
--
-- ── WHAT THE SURVIVOR TAKES FROM THE NEWER ROW ──────────────────────────────────────────────────
-- McLeod's identity and link (it is McLeod-mastered now, `identity_source = 'mcleod'`), the live
-- Samsara device and its readings, the idle learning (86 sessions, `sufficient`, against the
-- history row's 3), and the status McLeod gave it. It KEEPS its own unit number, tank, baseline MPG,
-- odometer offset and equipment flags — the fuel-side facts learned from the fills it holds.
-- 0241's claim trigger exempts a write with no JWT role, so this migration claims nothing for the
-- office; the audit trigger records every row change as usual.
--
-- ── WHAT HAPPENS TO THE NEWER ROW ───────────────────────────────────────────────────────────────
-- Retired and renamed, not deleted. The plan rejected a vehicle delete path on the FK graph (13
-- CASCADE edges, §1.8a) and this file does not reopen that; the row is left with no link, no device,
-- no VIN and no dependents, so nothing can match it again. Its unit number stops being a gateway
-- serial (D-FC5).
--
-- ── WHEN IT DOES NOTHING ────────────────────────────────────────────────────────────────────────
-- Anywhere the two rows are not both present in the measured shape — every fresh database, and
-- production after this has run once — it raises a NOTICE and returns. Checked after deploy against
-- production by hand, since a skip is silent by design.
--
-- Proved by `supabase/tests/merge-unit-732.test.mjs` against production's shapes.

do $merge$
declare
  h constant uuid := 'de57e742-22bd-4b93-887f-fb538fce4cf1';   -- `732`, the history row: survives
  n constant uuid := '698c08f1-4a30-4567-bc67-e20427120ddf';   -- `G6AA-5HS-XTC`: merged into it
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
    raise notice '0359: unit 732 rows not present — nothing to merge';
    return;
  end if;
  if hv.org_id <> nv.org_id
     or hv.unit_number <> '732'
     or hv.mcleod_tractor_id is not null
     or nv.mcleod_tractor_id is distinct from '732' then
    raise notice '0359: unit 732 rows are not in the measured shape (already merged, or changed since 2026-09-22) — nothing done';
    return;
  end if;

  -- ── 1. Free the newer row's unique keys: VIN, McLeod link, Samsara device ─────────────────────
  update public.vehicles
     set vin = null, mcleod_tractor_id = null, mcleod_company_id = null, samsara_vehicle_id = null
   where id = n;

  -- ── 2. The survivor takes McLeod's identity, the live device and the idle learning ───────────
  update public.vehicles set
    identity_source                      = 'mcleod',
    status                               = nv.status,
    mcleod_tractor_id                    = nv.mcleod_tractor_id,
    mcleod_company_id                    = nv.mcleod_company_id,
    vin                                  = nv.vin,
    make                                 = coalesce(nv.make, hv.make),
    model                                = coalesce(nv.model, hv.model),
    year                                 = coalesce(nv.year, hv.year),
    plate                                = coalesce(nv.plate, hv.plate),
    plate_state                          = coalesce(nv.plate_state, hv.plate_state),
    registration_expires_at              = coalesce(nv.registration_expires_at, hv.registration_expires_at),
    dot_annual_inspection_expires_at     = coalesce(nv.dot_annual_inspection_expires_at, hv.dot_annual_inspection_expires_at),
    dot_annual_inspection_source         = coalesce(nv.dot_annual_inspection_source, hv.dot_annual_inspection_source),
    purchased_at                         = coalesce(nv.purchased_at, hv.purchased_at),
    samsara_vehicle_id                   = nv.samsara_vehicle_id,
    samsara_fuel_percent                 = nv.samsara_fuel_percent,
    samsara_fuel_at                      = nv.samsara_fuel_at,
    samsara_missing_since                = null,
    current_odometer                     = greatest(hv.current_odometer, nv.current_odometer),
    idle_capability                      = nv.idle_capability,
    idle_optimized_pct                   = nv.idle_optimized_pct,
    idle_observed_mode                   = nv.idle_observed_mode,
    idle_states_sec                      = nv.idle_states_sec,
    idle_states_window_days              = nv.idle_states_window_days,
    idle_states_at                       = nv.idle_states_at,
    idle_evidence_status                 = nv.idle_evidence_status,
    idle_evidence_sessions               = nv.idle_evidence_sessions,
    idle_evidence_parked_sec             = nv.idle_evidence_parked_sec,
    idle_evidence_state_samples          = nv.idle_evidence_state_samples,
    idle_evidence_gps_state_samples      = nv.idle_evidence_gps_state_samples,
    idle_evidence_confidence             = nv.idle_evidence_confidence,
    idle_evidence_version                = nv.idle_evidence_version,
    idle_evidence_at                     = nv.idle_evidence_at,
    idle_learned_envelope_status         = nv.idle_learned_envelope_status,
    idle_learned_envelope_low_f          = nv.idle_learned_envelope_low_f,
    idle_learned_envelope_high_f         = nv.idle_learned_envelope_high_f,
    idle_learned_envelope_sessions       = nv.idle_learned_envelope_sessions,
    idle_learned_envelope_known_idle_sec = nv.idle_learned_envelope_known_idle_sec,
    idle_learned_envelope_cycling_sec    = nv.idle_learned_envelope_cycling_sec,
    idle_learned_envelope_continuous_sec = nv.idle_learned_envelope_continuous_sec,
    idle_learned_envelope_temperature_bins = nv.idle_learned_envelope_temperature_bins,
    idle_learned_envelope_version        = nv.idle_learned_envelope_version,
    idle_learned_envelope_at             = nv.idle_learned_envelope_at,
    eld_id                               = coalesce(nv.eld_id, hv.eld_id)
  where id = h;

  -- ── 3. Tables where the two rows collide ─────────────────────────────────────────────────────
  -- fuel_spend_days: derived; the newer row's half-days are dropped and rebuilt on the survivor.
  delete from public.fuel_spend_days where vehicle_id = n;
  get diagnostics cnt = row_count; dropped := dropped || jsonb_build_object('fuel_spend_days', cnt);

  -- vehicle_engine_days: seconds add across the swap day.
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

  -- idle_rollup_days: seconds add; the verdicts come from the device that covered more of the day.
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

  -- samsara_odometer_readings: on (source, day) the later reading is the day's reading.
  delete from public.samsara_odometer_readings hd
   using public.samsara_odometer_readings nd
   where hd.vehicle_id = h and nd.vehicle_id = n and nd.source = hd.source and nd.day = hd.day
     and nd.reading_at > hd.reading_at;
  get diagnostics cnt = row_count; dropped := dropped || jsonb_build_object('samsara_odometer_readings_superseded', cnt);
  delete from public.samsara_odometer_readings nd
   where nd.vehicle_id = n
     and exists (select 1 from public.samsara_odometer_readings hd
                  where hd.vehicle_id = h and hd.source = nd.source and hd.day = nd.day);

  -- idle_park_sessions: a session is a start instant on one truck; none collide today, guarded anyway.
  delete from public.idle_park_sessions nd
   where nd.vehicle_id = n
     and exists (select 1 from public.idle_park_sessions hd where hd.vehicle_id = h and hd.started_at = nd.started_at);

  -- One row per truck: the live device's is the current one.
  delete from public.idle_telemetry_windows where vehicle_id = h and exists (select 1 from public.idle_telemetry_windows where vehicle_id = n);
  delete from public.vehicle_positions      where vehicle_id = h and exists (select 1 from public.vehicle_positions where vehicle_id = n);

  -- ── 4. Everything else re-parents, for EVERY foreign key into vehicles ───────────────────────
  -- The learned satellites are skipped: 0262's trigger rewrote the survivor's in step 2, and the
  -- retired row's are dropped in step 6.
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

  -- ── 5. Retire the newer row under a name that is not a gateway serial ─────────────────────────
  update public.vehicles
     set status = 'retired', unit_number = '732-merged-' || left(n::text, 8)
   where id = n;

  -- ── 6. Its learned-satellite mirrors, rewritten by 0262's trigger on every update above ──────
  delete from public.vehicle_idle_learned where vehicle_id = n;
  delete from public.vehicle_tank_learned where vehicle_id = n;

  -- ── 7. Nothing may still point at it. A table this file missed is a failure, not a skip ─────
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.vehicles'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', fk.tbl, fk.col) into remaining using n;
    if remaining > 0 then
      raise exception '0359: % rows in %.% still reference the merged row', remaining, fk.tbl, fk.col;
    end if;
  end loop;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (hv.org_id, null, 'roster.vehicle_merged', 'vehicles', h, jsonb_build_object(
    'unit_number', '732',
    'merged_from', n,
    'merged_from_unit_number', nv.unit_number,
    'survivor_samsara_vehicle_id', nv.samsara_vehicle_id,
    'retired_samsara_vehicle_id', hv.samsara_vehicle_id,
    'moved', moved,
    'dropped', dropped,
    'reason', 'one truck in two rows after a Samsara gateway swap on 2026-08-24; history row kept (Q-9 option a)',
    'measured_at', '2026-09-22',
    'migration', '0359',
    'plan', 'FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md F4 / Q-9'
  ));
end
$merge$;
