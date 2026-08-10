-- 0166: Phase 4 HOS duty evidence for parked-idle sessions.
-- Evidence only: this records what HOS can prove about the parked interval. It does not change scoring.

alter table idle_park_sessions add column if not exists hos_evidence_status text not null default 'insufficient';
alter table idle_park_sessions add column if not exists hos_covered_sec int not null default 0;
alter table idle_park_sessions add column if not exists hos_rest_sec int not null default 0;
alter table idle_park_sessions add column if not exists hos_work_sec int not null default 0;
alter table idle_park_sessions add column if not exists hos_driving_sec int not null default 0;
alter table idle_park_sessions add column if not exists hos_excluded_sec int not null default 0;
alter table idle_park_sessions add column if not exists hos_unknown_sec int not null default 0;
alter table idle_park_sessions add column if not exists hos_ambiguous_sec int not null default 0;
alter table idle_park_sessions add column if not exists hos_evidence_version text not null default 'vehicle-hos-v1';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'idle_park_sessions_hos_status_check') then
    alter table idle_park_sessions add constraint idle_park_sessions_hos_status_check
      check (hos_evidence_status in ('sufficient', 'insufficient', 'ambiguous'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'idle_park_sessions_hos_counts_check') then
    alter table idle_park_sessions add constraint idle_park_sessions_hos_counts_check
      check (
        hos_covered_sec >= 0 and
        hos_rest_sec >= 0 and
        hos_work_sec >= 0 and
        hos_driving_sec >= 0 and
        hos_excluded_sec >= 0 and
        hos_unknown_sec >= 0 and
        hos_ambiguous_sec >= 0 and
        hos_covered_sec <= duration_sec
      );
  end if;
end $$;

comment on column idle_park_sessions.hos_evidence_status is
  'HOS coverage for this parked interval: sufficient, insufficient, or ambiguous due to conflicting linked driver logs.';
comment on column idle_park_sessions.hos_ambiguous_sec is
  'Seconds where multiple vehicle-linked HOS intervals reported conflicting duty kinds; never assigned to rest/work.';
