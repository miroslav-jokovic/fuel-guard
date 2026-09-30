-- 0394: the truck's ENGINE STATE beside its position (LIVE-MAP-PLAN.md D-LM29, the 2026-09-30 audit).
--
-- ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
-- The live map tells `stopped` (engine on) from `parked` (engine off) by the AGE of the newest GPS
-- fix, on D-LM9b's premise that Samsara pings every ≤5 s while the engine runs. Production says the
-- premise is false for a STATIONARY truck. Measured 2026-09-30 17:05 UTC over the 190 non-retired
-- trucks: the not-moving trucks' fix ages spread evenly from 0 to ~350 s (17 / 11 / 12 / 10 / 4 / 8 /
-- 1 per 50-second band) — no cluster under 30 s, which a running engine pinging every 5 s would make.
-- Six snapshots 25 s apart then showed **29 trucks flipping between `stopped` and `parked`** with
-- nothing about them changing: the label described when we happened to look, not the truck. The
-- owner saw the result as "the counts do not match Samsara", and they cannot, because Samsara's
-- dashboard reads the ECU's own `engineStates` (On / Idle / Off) and we never asked for it.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- Two nullable columns on the one-row-per-truck table, not a second table: the engine state is a
-- CURRENT fact about the same truck with the same no-history ruling as its position (0341), and the
-- board reads both in one row. NULL means the feed has not reported an engine state for this truck
-- yet — it is NOT `Off`, the same absent-is-not-a-value rule 0341 applies to speed and heading.
--
-- The values are Samsara's own spelling, verbatim — `On` (running and moving), `Idle` (running,
-- stationary), `Off` — the same enum `idleSessions.ts` has parsed from `engineStates` history since
-- the idle module was written. Translating them here would put a second vocabulary between the
-- vendor and the one pure function (`deriveVehicleState`) whose job translation is.
--
-- ── WHY THE WRITER ADVANCES THE TWO FACTS SEPARATELY ─────────────────────────────────────────────
-- An engine state and a GPS fix are two stats with two clocks. A truck switched off in a yard emits
-- an `Off` and then possibly no GPS at all for hours; a truck on the highway emits a GPS ping every
-- few seconds and no engine event. Gating the engine columns behind the position's
-- `excluded.sampled_at > vp.sampled_at` would drop exactly the engine-off event this migration is
-- for. So each fact carries its own only-go-forward guard on its own timestamp — the same
-- at-least-once reasoning 0342 wrote down for the position, applied twice.
--
-- An engine-only row for a truck with NO position row is skipped rather than inserted: the table's
-- `lat`/`lng` are NOT NULL because a row here is a thing drawn on a map, and a truck we cannot place
-- is not one. Its engine state lands with its first fix.
--
-- ── THE DEPLOY WINDOW ────────────────────────────────────────────────────────────────────────────
-- This ships ALONE. `jsonb_to_recordset` ignores keys its column list does not name, so the collector
-- that sends `engine_state` (the next merge) is harmless against 0342's writer if it is ever served
-- before this applies — but the gate cannot see that, and the rule is cheaper to keep than argue.
-- The return value is unchanged (position rows written), so the current collector reads it as before.
--
-- Rollback: drop the two columns and re-run 0342's function body. No data is migrated.

alter table public.vehicle_positions
  add column if not exists engine_state    text check (engine_state in ('On', 'Idle', 'Off')),
  add column if not exists engine_state_at timestamptz;

-- A state without a time cannot be ordered against the next one, and a time without a state is not a
-- fact. Both or neither.
alter table public.vehicle_positions
  drop constraint if exists vehicle_positions_engine_state_pair;
alter table public.vehicle_positions
  add constraint vehicle_positions_engine_state_pair
  check ((engine_state is null) = (engine_state_at is null));

comment on column public.vehicle_positions.engine_state is
  'Samsara engineStates value, verbatim: On | Idle | Off. NULL = not reported yet, never "Off". D-LM29.';
comment on column public.vehicle_positions.engine_state_at is
  'Vendor time of engine_state. Advanced only by a strictly newer event, independently of sampled_at.';

-- raw-access-waiver: this migration redefines the samsara collector's OWN writer for the samsara raw
-- table `vehicle_positions` (module=samsara, layer=raw in scripts/table-modules.json). There is no
-- cross-module read here.
create or replace function public.record_vehicle_positions(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  written int;
begin
  -- ── 1. The position, exactly as 0342 wrote it, plus the engine state on a FIRST insert ─────────
  insert into public.vehicle_positions as vp (
    org_id, vehicle_id, lat, lng, heading_degrees, speed_mph, is_ecu_speed,
    formatted_location, sampled_at, received_at, source, engine_state, engine_state_at
  )
  select p_org,            -- the caller's org, never r.org_id: there is no org_id in the payload
         r.vehicle_id, r.lat, r.lng, r.heading_degrees, r.speed_mph, r.is_ecu_speed,
         r.formatted_location, r.sampled_at, now(), 'samsara',
         -- Both or neither, matching the table's pair check, so one malformed half cannot fail the tick.
         case when r.engine_state in ('On', 'Idle', 'Off') and r.engine_state_at is not null
              then r.engine_state end,
         case when r.engine_state in ('On', 'Idle', 'Off') and r.engine_state_at is not null
              then r.engine_state_at end
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           vehicle_id         uuid,
           lat                double precision,
           lng                double precision,
           heading_degrees    double precision,
           speed_mph          double precision,
           is_ecu_speed       boolean,
           formatted_location text,
           sampled_at         timestamptz,
           engine_state       text,
           engine_state_at    timestamptz
         )
   where r.vehicle_id is not null
     and r.lat is not null
     and r.lng is not null
     and r.sampled_at is not null
  on conflict (org_id, vehicle_id) do update
     set lat                = excluded.lat,
         lng                = excluded.lng,
         heading_degrees    = excluded.heading_degrees,
         speed_mph          = excluded.speed_mph,
         is_ecu_speed       = excluded.is_ecu_speed,
         formatted_location = excluded.formatted_location,
         sampled_at         = excluded.sampled_at,
         received_at        = excluded.received_at,
         source             = excluded.source
   -- 0342's only-go-forward guard, unchanged. The engine columns are deliberately NOT in this SET:
   -- they advance in step 2 on their own clock, or an engine event riding with an older re-delivered
   -- fix would be dropped along with it.
   where excluded.sampled_at > vp.sampled_at;
  get diagnostics written = row_count;

  -- ── 2. The engine state, on its own clock ────────────────────────────────────────────────────────
  -- `distinct on` so a payload naming a truck twice advances it once, to its newest event, rather
  -- than leaving the winner to UPDATE … FROM's unspecified choice between duplicate source rows.
  update public.vehicle_positions vp
     set engine_state    = e.engine_state,
         engine_state_at = e.engine_state_at
    from (
      select distinct on (r.vehicle_id) r.vehicle_id, r.engine_state, r.engine_state_at
        from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
               vehicle_id      uuid,
               engine_state    text,
               engine_state_at timestamptz
             )
       where r.vehicle_id is not null
         and r.engine_state in ('On', 'Idle', 'Off')
         and r.engine_state_at is not null
       order by r.vehicle_id, r.engine_state_at desc
    ) e
   where vp.org_id = p_org          -- tenant scope is the ARGUMENT here too
     and vp.vehicle_id = e.vehicle_id
     and (vp.engine_state_at is null or e.engine_state_at > vp.engine_state_at);

  -- Position rows written, as before: the collector's tier log means "trucks that moved forward".
  return written;
end;
$$;

revoke all on function public.record_vehicle_positions(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_vehicle_positions(uuid, jsonb) to service_role;

comment on function public.record_vehicle_positions(uuid, jsonb) is
  'Set-based insert-or-advance of vehicle_positions for one org (LM4, D-LM29). Tenant scope is p_org, never a value in the payload. The position advances only on a STRICTLY NEWER sampled_at and the engine state only on a STRICTLY NEWER engine_state_at, independently, because the delta feed is at-least-once and this table keeps no history. Returns position rows written.';
