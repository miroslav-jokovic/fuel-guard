-- The fuel_transactions raw/derived split — forward, never backward (D-SEP3,
-- docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md P2.1; D-ARC3).
--
-- The 2026-08-27 audit measured what this table had become: 46 ALTER-added columns across 20
-- migrations, written by five modules and one browser file — simultaneously collector output,
-- canonical entity, harness scoreboard and human case file. The cost is not aesthetic: a wipe-
-- and-rederive of scoring would DESTROY human audit verdicts because they share rows (which is
-- why 0117 and the nightly flag reconciler had to exist), and every new writer got the whole
-- row as its blast radius.
--
-- The split, in three satellites keyed on the transaction id:
--   fuel_txn_recon        — Samsara reconciliation evidence (samsara-owned, derived)
--   fuel_txn_scores       — the scoring engine's outputs (anomalies-owned, derived)
--   fuel_txn_dispositions — human verdicts + dedupe identity (fuel-owned; human-authored = core)
--
-- STRANGLER MECHANICS, because eleven writers cannot flip in one PR: a row trigger mirrors
-- every legacy-column write into the satellites, and this migration backfills history once.
-- From this migration on the satellites are complete and consistent no matter who writes —
-- app code, the 0156/0158 scoring RPCs, or the browser — so readers can migrate at leisure
-- and writers flip one module per PR. The legacy columns stay (applied migrations are never
-- edited; readers still select them) and are marked deprecated below; each retires when its
-- last writer migrates, tracked by the program plan's P2.1 follow-ups.
--
-- No client policies on any satellite: deny-all, API-only — the house default. The web keeps
-- reading the legacy columns through fuel_transactions' existing policies until the owning
-- modules expose satellite reads through their interfaces.
--
-- cross-module-waiver: the split itself is the cross-module act — fuel's canonical table sheds
-- columns into samsara's and anomalies' satellites; single-module migrations cannot express it.

-- ── satellites ─────────────────────────────────────────────────────────────────────────────────

create table fuel_txn_recon (
  txn_id                        uuid primary key references fuel_transactions(id) on delete cascade,
  org_id                        uuid not null references organizations(id) on delete cascade,
  samsara_odometer              numeric(10,1),
  samsara_odometer_at           timestamptz,
  samsara_odometer_source       text,
  samsara_location_matched      boolean,
  samsara_location_confidence   text,
  samsara_nearest_station_miles numeric(7,1),
  samsara_fuel_pct_before       numeric(5,1),
  samsara_fuel_pct_after        numeric(5,1),
  samsara_tank_observed_gal     numeric(10,1),
  samsara_tank_short_gal        numeric(10,1),
  samsara_observed_state        text,
  samsara_observed_city         text,
  samsara_observed_address      text,
  samsara_observed_lat          numeric(9,6),
  samsara_observed_lng          numeric(9,6),
  fueling_time_basis            text,
  samsara_recon_at              timestamptz,
  samsara_recon_checked_at      timestamptz,
  samsara_recon_status          text,
  samsara_recon_error           text,
  samsara_recon_evidence_version int,
  updated_at                    timestamptz not null default now()
);
alter table fuel_txn_recon enable row level security;
create index idx_fuel_txn_recon_org on fuel_txn_recon (org_id);
comment on table fuel_txn_recon is
  'module=samsara; layer=derived; rebuild=modules/anomalies/scoring backfill (skipRecon reuses these values). '
  'Samsara reconciliation evidence for one fill, mirrored from fuel_transactions'' legacy samsara_* columns '
  'by trg_fuel_txn_satellites since 0261 (D-SEP3).';

create table fuel_txn_scores (
  txn_id           uuid primary key references fuel_transactions(id) on delete cascade,
  org_id           uuid not null references organizations(id) on delete cascade,
  miles_since_last numeric(10,1),
  computed_mpg     numeric(6,2),
  has_anomaly      boolean not null default false,
  max_severity     anomaly_severity,
  ai_risk_level    anomaly_severity,
  case_level       text,
  case_score       numeric,
  case_signals     jsonb,
  case_gates       jsonb,
  updated_at       timestamptz not null default now()
);
alter table fuel_txn_scores enable row level security;
create index idx_fuel_txn_scores_org on fuel_txn_scores (org_id);
comment on table fuel_txn_scores is
  'module=anomalies; layer=derived; rebuild=the rebuild job (persist_scoring_outcome supersedes, never deletes). '
  'The scoring engine''s outputs for one fill, mirrored from fuel_transactions'' legacy case/anomaly columns '
  'by trg_fuel_txn_satellites since 0261 (D-SEP3).';

create table fuel_txn_dispositions (
  txn_id        uuid primary key references fuel_transactions(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,
  audit_verdict text,
  audit_note    text,
  audit_by      uuid,
  audit_at      timestamptz,
  is_canonical  boolean not null default true,
  duplicate_of  uuid references fuel_transactions(id),
  updated_at    timestamptz not null default now()
);
alter table fuel_txn_dispositions enable row level security;
create index idx_fuel_txn_dispositions_org on fuel_txn_dispositions (org_id);
comment on table fuel_txn_dispositions is
  'module=fuel; layer=core; human-authored — a rebuild of recon or scores must NEVER touch this table '
  '(the invariant 0117 existed to repair is structural here). Verdicts + dedupe identity, mirrored from '
  'fuel_transactions'' legacy audit_*/is_canonical/duplicate_of columns by trg_fuel_txn_satellites since 0261.';

-- ── the mirror ────────────────────────────────────────────────────────────────────────────────
-- Row-level, WHEN-guarded so a plain raw insert (no derived values) touches nothing: the matrix
-- pins that. Full-payload ON CONFLICT updates — the satellite row always reflects the whole
-- family, never a partial patch.

create or replace function sync_fuel_txn_satellites() returns trigger
language plpgsql as $$
begin
  if new.samsara_odometer is not null or new.samsara_odometer_at is not null
     or new.samsara_odometer_source is not null or new.samsara_location_matched is not null
     or new.samsara_location_confidence is not null or new.samsara_nearest_station_miles is not null
     or new.samsara_fuel_pct_before is not null or new.samsara_fuel_pct_after is not null
     or new.samsara_tank_observed_gal is not null or new.samsara_tank_short_gal is not null
     or new.samsara_observed_state is not null or new.samsara_observed_city is not null
     or new.samsara_observed_address is not null or new.samsara_observed_lat is not null
     or new.samsara_observed_lng is not null or new.fueling_time_basis is not null
     or new.samsara_recon_at is not null or new.samsara_recon_checked_at is not null
     or new.samsara_recon_status is not null or new.samsara_recon_error is not null then
    insert into public.fuel_txn_recon (
      txn_id, org_id, samsara_odometer, samsara_odometer_at, samsara_odometer_source,
      samsara_location_matched, samsara_location_confidence, samsara_nearest_station_miles,
      samsara_fuel_pct_before, samsara_fuel_pct_after, samsara_tank_observed_gal,
      samsara_tank_short_gal, samsara_observed_state, samsara_observed_city,
      samsara_observed_address, samsara_observed_lat, samsara_observed_lng, fueling_time_basis,
      samsara_recon_at, samsara_recon_checked_at, samsara_recon_status, samsara_recon_error,
      samsara_recon_evidence_version, updated_at
    ) values (
      new.id, new.org_id, new.samsara_odometer, new.samsara_odometer_at, new.samsara_odometer_source,
      new.samsara_location_matched, new.samsara_location_confidence, new.samsara_nearest_station_miles,
      new.samsara_fuel_pct_before, new.samsara_fuel_pct_after, new.samsara_tank_observed_gal,
      new.samsara_tank_short_gal, new.samsara_observed_state, new.samsara_observed_city,
      new.samsara_observed_address, new.samsara_observed_lat, new.samsara_observed_lng, new.fueling_time_basis,
      new.samsara_recon_at, new.samsara_recon_checked_at, new.samsara_recon_status, new.samsara_recon_error,
      new.samsara_recon_evidence_version, now()
    )
    on conflict (txn_id) do update set
      org_id = excluded.org_id,
      samsara_odometer = excluded.samsara_odometer,
      samsara_odometer_at = excluded.samsara_odometer_at,
      samsara_odometer_source = excluded.samsara_odometer_source,
      samsara_location_matched = excluded.samsara_location_matched,
      samsara_location_confidence = excluded.samsara_location_confidence,
      samsara_nearest_station_miles = excluded.samsara_nearest_station_miles,
      samsara_fuel_pct_before = excluded.samsara_fuel_pct_before,
      samsara_fuel_pct_after = excluded.samsara_fuel_pct_after,
      samsara_tank_observed_gal = excluded.samsara_tank_observed_gal,
      samsara_tank_short_gal = excluded.samsara_tank_short_gal,
      samsara_observed_state = excluded.samsara_observed_state,
      samsara_observed_city = excluded.samsara_observed_city,
      samsara_observed_address = excluded.samsara_observed_address,
      samsara_observed_lat = excluded.samsara_observed_lat,
      samsara_observed_lng = excluded.samsara_observed_lng,
      fueling_time_basis = excluded.fueling_time_basis,
      samsara_recon_at = excluded.samsara_recon_at,
      samsara_recon_checked_at = excluded.samsara_recon_checked_at,
      samsara_recon_status = excluded.samsara_recon_status,
      samsara_recon_error = excluded.samsara_recon_error,
      samsara_recon_evidence_version = excluded.samsara_recon_evidence_version,
      updated_at = now();
  end if;

  if new.has_anomaly or new.miles_since_last is not null or new.computed_mpg is not null
     or new.max_severity is not null or new.ai_risk_level is not null
     or new.case_level is not null or new.case_score is not null
     or new.case_signals is not null or new.case_gates is not null then
    insert into public.fuel_txn_scores (
      txn_id, org_id, miles_since_last, computed_mpg, has_anomaly, max_severity, ai_risk_level,
      case_level, case_score, case_signals, case_gates, updated_at
    ) values (
      new.id, new.org_id, new.miles_since_last, new.computed_mpg, new.has_anomaly, new.max_severity,
      new.ai_risk_level, new.case_level, new.case_score, new.case_signals, new.case_gates, now()
    )
    on conflict (txn_id) do update set
      org_id = excluded.org_id,
      miles_since_last = excluded.miles_since_last,
      computed_mpg = excluded.computed_mpg,
      has_anomaly = excluded.has_anomaly,
      max_severity = excluded.max_severity,
      ai_risk_level = excluded.ai_risk_level,
      case_level = excluded.case_level,
      case_score = excluded.case_score,
      case_signals = excluded.case_signals,
      case_gates = excluded.case_gates,
      updated_at = now();
  end if;

  if new.audit_verdict is not null or new.audit_note is not null or new.audit_by is not null
     or new.audit_at is not null or not new.is_canonical or new.duplicate_of is not null then
    insert into public.fuel_txn_dispositions (
      txn_id, org_id, audit_verdict, audit_note, audit_by, audit_at, is_canonical, duplicate_of, updated_at
    ) values (
      new.id, new.org_id, new.audit_verdict, new.audit_note, new.audit_by, new.audit_at,
      new.is_canonical, new.duplicate_of, now()
    )
    on conflict (txn_id) do update set
      org_id = excluded.org_id,
      audit_verdict = excluded.audit_verdict,
      audit_note = excluded.audit_note,
      audit_by = excluded.audit_by,
      audit_at = excluded.audit_at,
      is_canonical = excluded.is_canonical,
      duplicate_of = excluded.duplicate_of,
      updated_at = now();
  end if;

  return new;
end;
$$;

create trigger trg_fuel_txn_satellites
  after insert or update on fuel_transactions
  for each row execute function sync_fuel_txn_satellites();

-- ── backfill: history mirrors once, with the same predicates the trigger uses ─────────────────

insert into public.fuel_txn_recon (
  txn_id, org_id, samsara_odometer, samsara_odometer_at, samsara_odometer_source,
  samsara_location_matched, samsara_location_confidence, samsara_nearest_station_miles,
  samsara_fuel_pct_before, samsara_fuel_pct_after, samsara_tank_observed_gal,
  samsara_tank_short_gal, samsara_observed_state, samsara_observed_city, samsara_observed_address,
  samsara_observed_lat, samsara_observed_lng, fueling_time_basis, samsara_recon_at,
  samsara_recon_checked_at, samsara_recon_status, samsara_recon_error, samsara_recon_evidence_version
)
select id, org_id, samsara_odometer, samsara_odometer_at, samsara_odometer_source,
       samsara_location_matched, samsara_location_confidence, samsara_nearest_station_miles,
       samsara_fuel_pct_before, samsara_fuel_pct_after, samsara_tank_observed_gal,
       samsara_tank_short_gal, samsara_observed_state, samsara_observed_city, samsara_observed_address,
       samsara_observed_lat, samsara_observed_lng, fueling_time_basis, samsara_recon_at,
       samsara_recon_checked_at, samsara_recon_status, samsara_recon_error, samsara_recon_evidence_version
from fuel_transactions
where samsara_odometer is not null or samsara_odometer_at is not null or samsara_odometer_source is not null
   or samsara_location_matched is not null or samsara_location_confidence is not null
   or samsara_nearest_station_miles is not null or samsara_fuel_pct_before is not null
   or samsara_fuel_pct_after is not null or samsara_tank_observed_gal is not null
   or samsara_tank_short_gal is not null or samsara_observed_state is not null
   or samsara_observed_city is not null or samsara_observed_address is not null
   or samsara_observed_lat is not null or samsara_observed_lng is not null
   or fueling_time_basis is not null or samsara_recon_at is not null
   or samsara_recon_checked_at is not null or samsara_recon_status is not null
   or samsara_recon_error is not null
on conflict (txn_id) do nothing;

insert into public.fuel_txn_scores (
  txn_id, org_id, miles_since_last, computed_mpg, has_anomaly, max_severity, ai_risk_level,
  case_level, case_score, case_signals, case_gates
)
select id, org_id, miles_since_last, computed_mpg, has_anomaly, max_severity, ai_risk_level,
       case_level, case_score, case_signals, case_gates
from fuel_transactions
where has_anomaly or miles_since_last is not null or computed_mpg is not null
   or max_severity is not null or ai_risk_level is not null or case_level is not null
   or case_score is not null or case_signals is not null or case_gates is not null
on conflict (txn_id) do nothing;

insert into public.fuel_txn_dispositions (
  txn_id, org_id, audit_verdict, audit_note, audit_by, audit_at, is_canonical, duplicate_of
)
select id, org_id, audit_verdict, audit_note, audit_by, audit_at, is_canonical, duplicate_of
from fuel_transactions
where audit_verdict is not null or audit_note is not null or audit_by is not null
   or audit_at is not null or not is_canonical or duplicate_of is not null
on conflict (txn_id) do nothing;

-- ── deprecation record on the legacy columns ─────────────────────────────────────────────────
-- Each retires when its last writer migrates to the satellite's owner interface (program plan
-- P2.1 follow-ups); until then the trigger keeps both in step.

do $$
declare c text;
begin
  foreach c in array array[
    'samsara_odometer','samsara_odometer_at','samsara_odometer_source','samsara_location_matched',
    'samsara_location_confidence','samsara_nearest_station_miles','samsara_fuel_pct_before',
    'samsara_fuel_pct_after','samsara_tank_observed_gal','samsara_tank_short_gal',
    'samsara_observed_state','samsara_observed_city','samsara_observed_address',
    'samsara_observed_lat','samsara_observed_lng','fueling_time_basis','samsara_recon_at',
    'samsara_recon_checked_at','samsara_recon_status','samsara_recon_error',
    'samsara_recon_evidence_version'
  ] loop
    execute format('comment on column fuel_transactions.%I is %L', c,
      'DEPRECATED 0261 (D-SEP3): lives in fuel_txn_recon; mirrored by trg_fuel_txn_satellites until the last writer migrates.');
  end loop;
  foreach c in array array[
    'miles_since_last','computed_mpg','has_anomaly','max_severity','ai_risk_level',
    'case_level','case_score','case_signals','case_gates'
  ] loop
    execute format('comment on column fuel_transactions.%I is %L', c,
      'DEPRECATED 0261 (D-SEP3): lives in fuel_txn_scores; mirrored by trg_fuel_txn_satellites until the last writer migrates.');
  end loop;
  foreach c in array array[
    'audit_verdict','audit_note','audit_by','audit_at','is_canonical','duplicate_of'
  ] loop
    execute format('comment on column fuel_transactions.%I is %L', c,
      'DEPRECATED 0261 (D-SEP3): lives in fuel_txn_dispositions; mirrored by trg_fuel_txn_satellites until the last writer migrates.');
  end loop;
end $$;
