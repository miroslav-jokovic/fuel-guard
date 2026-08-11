-- FuelGuard — 0175 idle learned-envelope writes (incident 2026-08-10, third instance)
--
-- Same defect as 0174, third occurrence, this time against `vehicles`. `syncIdleLearnedEnvelopes` owns
-- only the idle_learned_envelope_* columns and expressed that as a PostgREST upsert carrying just those
-- columns plus id/org_id. Postgres evaluates NOT NULL on the proposed tuple before conflict
-- arbitration, and `vehicles` requires `unit_number` (0003) and `tank_capacity_gal` (0003) with no
-- defaults, so the write fails on rows that already exist. Observed in production:
--
--     Idle learned envelope learned-envelope upsert failed: null value in column "unit_number"
--     of relation "vehicles" violates not-null constraint
--
-- It surfaced only after 0174 unblocked the earlier stages — sync_idle now reaches stage 6 of 6 and
-- dies there, 26 minutes into the run. Same remedy: a set-based UPDATE, tenant-scoped by argument.
--
-- This one is more than a durability nicety. `vehicles` is the fleet identity table; an upsert on it
-- that Postgres DID accept would create or overwrite vehicle rows from an evidence job that has no
-- business doing either. An UPDATE cannot.
--
-- Rollback: drop the function. No data is migrated by this file.

create or replace function public.apply_idle_learned_envelope(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  updated int;
begin
  update public.vehicles v
     set idle_learned_envelope_status          = r.idle_learned_envelope_status,
         idle_learned_envelope_low_f           = r.idle_learned_envelope_low_f,
         idle_learned_envelope_high_f          = r.idle_learned_envelope_high_f,
         idle_learned_envelope_sessions        = r.idle_learned_envelope_sessions,
         idle_learned_envelope_known_idle_sec  = r.idle_learned_envelope_known_idle_sec,
         idle_learned_envelope_cycling_sec     = r.idle_learned_envelope_cycling_sec,
         idle_learned_envelope_continuous_sec  = r.idle_learned_envelope_continuous_sec,
         idle_learned_envelope_temperature_bins = r.idle_learned_envelope_temperature_bins,
         idle_learned_envelope_version         = r.idle_learned_envelope_version,
         idle_learned_envelope_at              = r.idle_learned_envelope_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           id                                     uuid,
           idle_learned_envelope_status           text,
           idle_learned_envelope_low_f            numeric(6,1),
           idle_learned_envelope_high_f           numeric(6,1),
           idle_learned_envelope_sessions         int,
           idle_learned_envelope_known_idle_sec   int,
           idle_learned_envelope_cycling_sec      int,
           idle_learned_envelope_continuous_sec   int,
           idle_learned_envelope_temperature_bins int,
           idle_learned_envelope_version          text,
           idle_learned_envelope_at               timestamptz
         )
   where v.id = r.id
     and v.org_id = p_org;   -- tenant scope is the caller's org, never a value inside the payload
  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function public.apply_idle_learned_envelope(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_idle_learned_envelope(uuid, jsonb) to service_role;

comment on function public.apply_idle_learned_envelope(uuid, jsonb) is
  'Set-based UPDATE of the idle_learned_envelope_* columns on vehicles for one org. Replaces a partial upsert that violated the vehicles NOT NULL constraints and could otherwise have created fleet rows from an evidence job (incident 2026-08-10). Returns rows updated.';
