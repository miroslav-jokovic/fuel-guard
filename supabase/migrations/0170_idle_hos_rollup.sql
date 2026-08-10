-- 0170: preserve direct HOS overlap used by the Phase 8 parked-idle verdict.
-- This is derived from idle_events × hos_duty_segments. Raw HOS/session evidence remains the source of truth.
alter table idle_rollup_days
  add column if not exists hos_rest_sec int not null default 0,
  add column if not exists hos_work_sec int not null default 0,
  add column if not exists hos_unknown_sec int not null default 0,
  add column if not exists hos_ambiguous_sec int not null default 0,
  add column if not exists hos_grace_sec int not null default 0,
  add column if not exists hos_evidence_status text not null default 'not_applicable';

alter table idle_rollup_days
  drop constraint if exists idle_rollup_days_hos_status_check,
  add constraint idle_rollup_days_hos_status_check check (
    hos_evidence_status in ('sufficient', 'insufficient', 'ambiguous', 'not_applicable', 'unavailable')
  ),
  drop constraint if exists idle_rollup_days_hos_seconds_check,
  add constraint idle_rollup_days_hos_seconds_check check (
    hos_rest_sec >= 0 and
    hos_work_sec >= 0 and
    hos_unknown_sec >= 0 and
    hos_ambiguous_sec >= 0 and
    hos_grace_sec >= 0
  );

comment on column idle_rollup_days.hos_rest_sec is
  'Continuous parked-idle seconds directly overlapping Sleeper Berth or Off Duty HOS.';
comment on column idle_rollup_days.hos_work_sec is
  'Continuous parked-idle seconds directly overlapping On Duty HOS.';
comment on column idle_rollup_days.hos_unknown_sec is
  'Continuous parked-idle seconds without a usable linked HOS interval.';
comment on column idle_rollup_days.hos_ambiguous_sec is
  'Continuous parked-idle seconds with conflicting linked HOS evidence.';
comment on column idle_rollup_days.hos_grace_sec is
  'Direct On Duty idle seconds covered by the bounded 15-minute operational grace.';
