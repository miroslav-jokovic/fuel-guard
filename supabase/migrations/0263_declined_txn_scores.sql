-- The declined_transactions raw/derived split (D-SEP3,
-- docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md P2.3; the 0261/0262 pattern, third and
-- smallest of the mixed tables the 2026-08-27 audit named).
--
-- `declined_transactions` is the raw EFS reject feed (0011's own header: "This table is NOT
-- transformed") that 0022 fused with scoring output: two layers, one table, two writers from
-- two modules (efs ingest, anomalies scoring). The scoring half moves to a satellite; the raw
-- half — including the vendor-carried card_assigned_unit / efs_proximity_miles and the
-- driver-identity resolution fuel performs on it — stays where it is, because identity
-- resolution on a raw row is attribution, not derivation (same call as fuel_transactions'
-- driver_id).
--
--   declined_txn_scores — the decline-scoring outputs (anomalies-owned, derived): suspicion
--     level/reasons, the parsed reason category, the Samsara location check, scored_at.
--
-- Same strangler mechanics as 0261/0262: row trigger mirrors every legacy write, backfill
-- carries history, legacy columns stay with DEPRECATED comments until the scorer migrates.
-- Deny-all RLS. Trigger DML schema-qualified; no `set search_path` (the 46x inlining incident).
--
-- cross-module-waiver: fuel's raw reject table sheds scoring columns into anomalies' satellite
-- — the split is the cross-module act.

create table declined_txn_scores (
  declined_id                 uuid primary key references declined_transactions(id) on delete cascade,
  org_id                      uuid not null references organizations(id) on delete cascade,
  suspicion_level             text,
  suspicion_reasons           jsonb,
  reason_category             text,
  samsara_location_matched    boolean,
  samsara_location_confidence text,
  station_lat                 numeric(9,6),
  station_lng                 numeric(9,6),
  scored_at                   timestamptz,
  updated_at                  timestamptz not null default now()
);
alter table declined_txn_scores enable row level security;
create index idx_declined_txn_scores_org on declined_txn_scores (org_id);
comment on table declined_txn_scores is
  'module=anomalies; layer=derived; rebuild=scoreDeclinedOrg re-derives from the raw reject rows. '
  'Decline-scoring outputs, mirrored from declined_transactions'' legacy scoring columns by '
  'trg_declined_txn_scores since 0263 (D-SEP3).';

create or replace function sync_declined_txn_scores() returns trigger
language plpgsql as $$
begin
  -- suspicion_reasons defaults to '[]'::jsonb on the base table, so presence is not meaning.
  if new.suspicion_level is not null or new.scored_at is not null
     or new.reason_category is not null or new.samsara_location_matched is not null
     or new.samsara_location_confidence is not null
     or new.station_lat is not null or new.station_lng is not null
     or coalesce(new.suspicion_reasons, '[]'::jsonb) <> '[]'::jsonb then
    insert into public.declined_txn_scores (
      declined_id, org_id, suspicion_level, suspicion_reasons, reason_category,
      samsara_location_matched, samsara_location_confidence, station_lat, station_lng,
      scored_at, updated_at
    ) values (
      new.id, new.org_id, new.suspicion_level, new.suspicion_reasons, new.reason_category,
      new.samsara_location_matched, new.samsara_location_confidence, new.station_lat,
      new.station_lng, new.scored_at, now()
    )
    on conflict (declined_id) do update set
      org_id = excluded.org_id,
      suspicion_level = excluded.suspicion_level,
      suspicion_reasons = excluded.suspicion_reasons,
      reason_category = excluded.reason_category,
      samsara_location_matched = excluded.samsara_location_matched,
      samsara_location_confidence = excluded.samsara_location_confidence,
      station_lat = excluded.station_lat,
      station_lng = excluded.station_lng,
      scored_at = excluded.scored_at,
      updated_at = now();
  end if;
  return new;
end;
$$;

create trigger trg_declined_txn_scores
  after insert or update on declined_transactions
  for each row execute function sync_declined_txn_scores();

insert into declined_txn_scores (
  declined_id, org_id, suspicion_level, suspicion_reasons, reason_category,
  samsara_location_matched, samsara_location_confidence, station_lat, station_lng, scored_at
)
select id, org_id, suspicion_level, suspicion_reasons, reason_category,
       samsara_location_matched, samsara_location_confidence, station_lat, station_lng, scored_at
from declined_transactions
where suspicion_level is not null or scored_at is not null or reason_category is not null
   or samsara_location_matched is not null or samsara_location_confidence is not null
   or station_lat is not null or station_lng is not null
   or coalesce(suspicion_reasons, '[]'::jsonb) <> '[]'::jsonb
on conflict (declined_id) do nothing;

do $$
declare c text;
begin
  foreach c in array array[
    'suspicion_level','suspicion_reasons','reason_category','samsara_location_matched',
    'samsara_location_confidence','station_lat','station_lng','scored_at'
  ] loop
    execute format('comment on column declined_transactions.%I is %L', c,
      'DEPRECATED 0263 (D-SEP3): lives in declined_txn_scores; mirrored by trg_declined_txn_scores until the scorer migrates.');
  end loop;
end $$;
