-- FuelGuard — 0174 idle park-session evidence writes (incident 2026-08-10)
--
-- WHY. `syncIdleDutyEvidence` and `syncIdleEquipmentEvidence` each own a DISJOINT group of columns on
-- idle_park_sessions (hos_* and equipment_*/ambient_*/envelope_* respectively); the capability sync owns
-- the base columns (vehicle_id, started_at, ended_at, duration_sec, idle_sec, off_sec, cycles, mode).
-- Both evidence syncs expressed "write only my columns" as a PostgREST upsert carrying only those
-- columns. That does not work, and it is why sync_hos and sync_idle were both failing:
--
--     INSERT INTO idle_park_sessions (id, org_id, hos_*) VALUES (…) ON CONFLICT (id) DO UPDATE …
--     ERROR:  null value in column "vehicle_id" of relation "idle_park_sessions"
--             violates not-null constraint
--
-- Postgres evaluates NOT NULL on the proposed tuple BEFORE conflict arbitration, so ON CONFLICT DO
-- UPDATE cannot rescue an insert that omits a NOT NULL column — even when the row already exists. The
-- correct write for "update my columns on rows that already exist" is an UPDATE, and the correct way to
-- do it in one round trip for a chunk of rows is a set-based UPDATE … FROM jsonb_to_recordset. These two
-- RPCs are that. They are also strictly safer than the upsert they replace: an UPDATE can never create a
-- half-populated session row, and a session deleted by capability reconciliation between the read and
-- the write simply does not match instead of being resurrected.
--
-- The functions return the number of rows actually updated, so job stats stop reporting the size of the
-- payload as if it were the number of rows written.
--
-- SECOND FAILURE, same table. 0166 declares `check (hos_covered_sec <= duration_sec)` and 0167 declares
-- `check (envelope_inside_sec + envelope_outside_sec + envelope_ambiguous_sec <= duration_sec)`. Those
-- span two independently-written column groups: the capability sync re-derives duration_sec from engine
-- states on every run, and millisecond rounding routinely moves it by a second. When it shrinks below an
-- already-stored evidence value the CAPABILITY upsert fails:
--
--     ERROR:  new row for relation "idle_park_sessions" violates check constraint
--             "idle_park_sessions_hos_counts_check"
--
-- Clamping at write time in one service cannot fix that, because the violation is introduced by the
-- OTHER service later. The invariant therefore belongs in the database: a BEFORE trigger clamps the
-- derived evidence seconds to whatever duration_sec the row is being given. Losing a rounded second of
-- covered/envelope time is immaterial — the next evidence pass recomputes it — and it is strictly better
-- than failing the whole sync.
--
-- Rollback: drop the trigger, its function, and the two RPCs. No data is migrated by this file.

-- ---------------------------------------------------------------------------------------------------
-- Derived-evidence clamp. BEFORE INSERT OR UPDATE so it applies no matter which service writes, and no
-- matter whether duration_sec or the evidence column is the value that moved.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.idle_park_sessions_clamp_evidence()
returns trigger language plpgsql set search_path = '' as $$
declare
  remaining int;
begin
  if new.duration_sec is null or new.duration_sec < 0 then
    return new;
  end if;

  -- 0166: hos_covered_sec <= duration_sec
  if new.hos_covered_sec is not null and new.hos_covered_sec > new.duration_sec then
    new.hos_covered_sec := new.duration_sec;
  end if;

  -- 0167: envelope_inside_sec + envelope_outside_sec + envelope_ambiguous_sec <= duration_sec.
  -- Clamped in declared order so the sum is bounded without redistributing between the three.
  remaining := new.duration_sec;
  if new.envelope_inside_sec is not null then
    new.envelope_inside_sec := least(new.envelope_inside_sec, remaining);
    remaining := remaining - new.envelope_inside_sec;
  end if;
  if new.envelope_outside_sec is not null then
    new.envelope_outside_sec := least(new.envelope_outside_sec, remaining);
    remaining := remaining - new.envelope_outside_sec;
  end if;
  if new.envelope_ambiguous_sec is not null then
    new.envelope_ambiguous_sec := least(new.envelope_ambiguous_sec, remaining);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_idle_park_sessions_clamp_evidence on public.idle_park_sessions;
create trigger trg_idle_park_sessions_clamp_evidence
  before insert or update on public.idle_park_sessions
  for each row execute function public.idle_park_sessions_clamp_evidence();

-- ---------------------------------------------------------------------------------------------------
-- HOS duty evidence — owns hos_* only.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.apply_idle_hos_evidence(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  updated int;
begin
  update public.idle_park_sessions s
     set hos_evidence_status  = r.hos_evidence_status,
         hos_covered_sec      = r.hos_covered_sec,
         hos_rest_sec         = r.hos_rest_sec,
         hos_work_sec         = r.hos_work_sec,
         hos_driving_sec      = r.hos_driving_sec,
         hos_excluded_sec     = r.hos_excluded_sec,
         hos_unknown_sec      = r.hos_unknown_sec,
         hos_ambiguous_sec    = r.hos_ambiguous_sec,
         hos_evidence_version = r.hos_evidence_version
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           id                   uuid,
           hos_evidence_status  text,
           hos_covered_sec      int,
           hos_rest_sec         int,
           hos_work_sec         int,
           hos_driving_sec      int,
           hos_excluded_sec     int,
           hos_unknown_sec      int,
           hos_ambiguous_sec    int,
           hos_evidence_version text
         )
   where s.id = r.id
     and s.org_id = p_org;   -- tenant scope is the caller's org, never a value inside the payload
  get diagnostics updated = row_count;
  return updated;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Equipment / ambient-envelope evidence — owns equipment_*, ambient_*, envelope_* only.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.apply_idle_equipment_evidence(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  updated int;
begin
  update public.idle_park_sessions s
     set equipment_profile          = r.equipment_profile,
         equipment_evidence_status  = r.equipment_evidence_status,
         ambient_sample_count       = r.ambient_sample_count,
         ambient_known_idle_sec     = r.ambient_known_idle_sec,
         ambient_unknown_idle_sec   = r.ambient_unknown_idle_sec,
         ambient_min_f              = r.ambient_min_f,
         ambient_max_f              = r.ambient_max_f,
         ambient_avg_f              = r.ambient_avg_f,
         envelope_inside_sec        = r.envelope_inside_sec,
         envelope_outside_sec       = r.envelope_outside_sec,
         envelope_ambiguous_sec     = r.envelope_ambiguous_sec,
         equipment_evidence_version = r.equipment_evidence_version,
         equipment_evidence_at      = r.equipment_evidence_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           id                         uuid,
           equipment_profile          text,
           equipment_evidence_status  text,
           ambient_sample_count       int,
           ambient_known_idle_sec     int,
           ambient_unknown_idle_sec   int,
           ambient_min_f              numeric(6,1),
           ambient_max_f              numeric(6,1),
           ambient_avg_f              numeric(6,1),
           envelope_inside_sec        int,
           envelope_outside_sec       int,
           envelope_ambiguous_sec     int,
           equipment_evidence_version text,
           equipment_evidence_at      timestamptz
         )
   where s.id = r.id
     and s.org_id = p_org;
  get diagnostics updated = row_count;
  return updated;
end;
$$;

-- Service role only — these take a tenant id as a parameter and act on it (same convention as 0095,
-- 0149, 0151, 0156-0159 and the 0162 closure sweep). Postgres grants EXECUTE to PUBLIC by default on
-- CREATE FUNCTION, so the revoke is not redundant.
revoke all on function public.apply_idle_hos_evidence(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.apply_idle_equipment_evidence(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_idle_hos_evidence(uuid, jsonb) to service_role;
grant execute on function public.apply_idle_equipment_evidence(uuid, jsonb) to service_role;

comment on function public.apply_idle_hos_evidence(uuid, jsonb) is
  'Set-based UPDATE of the hos_* evidence columns on idle_park_sessions for one org. Replaces a partial upsert that violated the table NOT NULL constraints (incident 2026-08-10). Returns rows updated.';
comment on function public.apply_idle_equipment_evidence(uuid, jsonb) is
  'Set-based UPDATE of the equipment/ambient/envelope evidence columns on idle_park_sessions for one org. Returns rows updated.';
comment on function public.idle_park_sessions_clamp_evidence() is
  'Clamps derived evidence seconds to duration_sec so a re-derived (rounded) duration cannot violate the 0166/0167 check constraints and fail an unrelated sync.';
