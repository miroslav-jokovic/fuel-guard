-- 0167: Phase 5 equipment/temperature evidence for parked-idle sessions.
-- Evidence only. No avoidable-idle score or classification is changed by this migration.

alter table idle_park_sessions add column if not exists equipment_profile text not null default 'unknown';
alter table idle_park_sessions add column if not exists equipment_evidence_status text not null default 'unknown';
alter table idle_park_sessions add column if not exists ambient_sample_count int not null default 0;
alter table idle_park_sessions add column if not exists ambient_known_idle_sec int not null default 0;
alter table idle_park_sessions add column if not exists ambient_unknown_idle_sec int not null default 0;
alter table idle_park_sessions add column if not exists ambient_min_f numeric(6,1);
alter table idle_park_sessions add column if not exists ambient_max_f numeric(6,1);
alter table idle_park_sessions add column if not exists ambient_avg_f numeric(6,1);
alter table idle_park_sessions add column if not exists envelope_inside_sec int not null default 0;
alter table idle_park_sessions add column if not exists envelope_outside_sec int not null default 0;
alter table idle_park_sessions add column if not exists envelope_ambiguous_sec int not null default 0;
alter table idle_park_sessions add column if not exists equipment_evidence_version text;
alter table idle_park_sessions add column if not exists equipment_evidence_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'idle_park_sessions_equipment_profile_check') then
    alter table idle_park_sessions add constraint idle_park_sessions_equipment_profile_check
      check (equipment_profile in (
        'optimized_idle_documented_default',
        'apu_unprofiled',
        'diesel_apu_unprofiled',
        'battery_hvac_unprofiled',
        'fuel_heater_unprofiled',
        'shore_power_unprofiled',
        'none',
        'unknown'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'idle_park_sessions_equipment_status_check') then
    alter table idle_park_sessions add constraint idle_park_sessions_equipment_status_check
      check (equipment_evidence_status in (
        'inside_documented_default',
        'outside_documented_default',
        'mixed_documented_default',
        'insufficient',
        'ambiguous',
        'not_applicable',
        'unknown'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'idle_park_sessions_equipment_counts_check') then
    alter table idle_park_sessions add constraint idle_park_sessions_equipment_counts_check
      check (
        ambient_sample_count >= 0 and
        ambient_known_idle_sec >= 0 and
        ambient_unknown_idle_sec >= 0 and
        envelope_inside_sec >= 0 and
        envelope_outside_sec >= 0 and
        envelope_ambiguous_sec >= 0 and
        envelope_inside_sec + envelope_outside_sec + envelope_ambiguous_sec <= duration_sec
      );
  end if;
end $$;

comment on column idle_park_sessions.equipment_profile is
  'Configured equipment profile. APU profiles are intentionally unprofiled until model-specific limits are verified.';
comment on column idle_park_sessions.equipment_evidence_status is
  'Temperature comparison status. The documented default applies only to the explicitly named Optimized Idle profile.';
comment on column idle_park_sessions.ambient_unknown_idle_sec is
  'Engine-idle seconds without usable ambient temperature evidence; gaps are not assumed to be inside or outside the envelope.';
