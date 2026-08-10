-- 0168: Phase 6 per-vehicle learned Optimized Idle envelopes.
-- Evidence only. The learned result is not automatically applied to scoring by this migration.

alter table vehicles add column if not exists idle_learned_envelope_status text not null default 'not_applicable';
alter table vehicles add column if not exists idle_learned_envelope_low_f numeric(6,1);
alter table vehicles add column if not exists idle_learned_envelope_high_f numeric(6,1);
alter table vehicles add column if not exists idle_learned_envelope_sessions int not null default 0;
alter table vehicles add column if not exists idle_learned_envelope_known_idle_sec int not null default 0;
alter table vehicles add column if not exists idle_learned_envelope_cycling_sec int not null default 0;
alter table vehicles add column if not exists idle_learned_envelope_continuous_sec int not null default 0;
alter table vehicles add column if not exists idle_learned_envelope_temperature_bins int not null default 0;
alter table vehicles add column if not exists idle_learned_envelope_version text;
alter table vehicles add column if not exists idle_learned_envelope_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_idle_learned_envelope_status_check') then
    alter table vehicles add constraint vehicles_idle_learned_envelope_status_check
      check (idle_learned_envelope_status in ('sufficient', 'insufficient', 'not_applicable'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_idle_learned_envelope_counts_check') then
    alter table vehicles add constraint vehicles_idle_learned_envelope_counts_check
      check (
        idle_learned_envelope_sessions >= 0 and
        idle_learned_envelope_known_idle_sec >= 0 and
        idle_learned_envelope_cycling_sec >= 0 and
        idle_learned_envelope_continuous_sec >= 0 and
        idle_learned_envelope_temperature_bins >= 0
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_idle_learned_envelope_bounds_check') then
    alter table vehicles add constraint vehicles_idle_learned_envelope_bounds_check
      check (
        (idle_learned_envelope_low_f is null and idle_learned_envelope_high_f is null) or
        (idle_learned_envelope_low_f is not null and idle_learned_envelope_high_f is not null and idle_learned_envelope_low_f < idle_learned_envelope_high_f)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_idle_learned_envelope_sufficient_check') then
    alter table vehicles add constraint vehicles_idle_learned_envelope_sufficient_check
      check (
        idle_learned_envelope_status <> 'sufficient' or
        (idle_learned_envelope_low_f is not null and idle_learned_envelope_high_f is not null)
      );
  end if;
end $$;

comment on column vehicles.idle_learned_envelope_status is
  'Per-vehicle Optimized Idle envelope learning status; APU engine-off behavior is not learned from engine states.';
comment on column vehicles.idle_learned_envelope_low_f is
  'Learned lower temperature boundary in Fahrenheit, populated only when the seasonal evidence is sufficient.';
comment on column vehicles.idle_learned_envelope_high_f is
  'Learned upper temperature boundary in Fahrenheit, populated only when the seasonal evidence is sufficient.';
