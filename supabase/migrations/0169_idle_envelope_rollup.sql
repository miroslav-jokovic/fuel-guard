-- 0169: preserve the temperature evidence used by the Optimized Idle verdict.
-- Raw idle_events remain the source of truth; this derived evidence prevents the browser from
-- silently treating missing or conflicting temperature telemetry as avoidable idle.
alter table idle_rollup_days
  add column if not exists optimized_envelope_inside_sec int not null default 0,
  add column if not exists optimized_envelope_outside_sec int not null default 0,
  add column if not exists optimized_envelope_unknown_sec int not null default 0,
  add column if not exists optimized_envelope_ambiguous_sec int not null default 0,
  add column if not exists optimized_envelope_status text not null default 'not_applicable',
  add column if not exists optimized_envelope_source text not null default 'none';

alter table idle_rollup_days
  drop constraint if exists idle_rollup_days_envelope_status_check,
  add constraint idle_rollup_days_envelope_status_check check (
    optimized_envelope_status in ('sufficient', 'insufficient', 'ambiguous', 'not_applicable', 'unavailable')
  ),
  drop constraint if exists idle_rollup_days_envelope_source_check,
  add constraint idle_rollup_days_envelope_source_check check (
    optimized_envelope_source in ('documented_default', 'learned_behavioral', 'none')
  ),
  drop constraint if exists idle_rollup_days_envelope_seconds_check,
  add constraint idle_rollup_days_envelope_seconds_check check (
    optimized_envelope_inside_sec >= 0 and
    optimized_envelope_outside_sec >= 0 and
    optimized_envelope_unknown_sec >= 0 and
    optimized_envelope_ambiguous_sec >= 0
  );

comment on column idle_rollup_days.optimized_envelope_inside_sec is
  'Continuous Optimized Idle seconds observed within the active documented or learned temperature envelope.';
comment on column idle_rollup_days.optimized_envelope_outside_sec is
  'Continuous Optimized Idle seconds observed outside the active temperature envelope; not blamed as avoidable.';
comment on column idle_rollup_days.optimized_envelope_unknown_sec is
  'Continuous Optimized Idle seconds with missing temperature coverage.';
comment on column idle_rollup_days.optimized_envelope_ambiguous_sec is
  'Continuous Optimized Idle seconds with conflicting overlapping temperature observations.';
