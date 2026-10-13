-- 0463: the Med-Stop collector, read-only half (MEDSTOP-PLAN.md §6 F-1/F-2, batch MS1).
--
-- ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────────────────────────
-- Med-Stop is the carrier's C/TPA: it holds the random pools, selects, orders and closes every DOT
-- drug and alcohol test (O-2). The 2026-10-13 live read (§5A) measured what nobody here could see:
-- one active driver outside the random pool (§382.305), one person we let go still in it, thirteen
-- licences Med-Stop holds and our roster lacks, and a drug pool at 42.58 % of a 53 % target in
-- October. Every one of those is a comparison between Med-Stop's roster and ours, so the first
-- batch stages Med-Stop's side and nothing else. No write goes to Med-Stop from this migration's
-- code, and no test RESULT is stored by it — results are testing records (`canReadTestingRecords`)
-- and arrive with MS2 under their own visibility rule.
--
-- ── 1. `medstop_credentials` — FleetPal's posture, unchanged (D-MS2) ─────────────────────────────
-- One row per org; the key `secretBox`-sealed with org+purpose AAD; refused at write when the
-- sealing key is absent. `key_expires_on` because Med-Stop keys die after at most 180 days and the
-- symptom of a dead key is a 401 indistinguishable from a wrong one (§2) — the Settings page warns
-- before that day rather than after it.
create table if not exists medstop_credentials (
  org_id           uuid primary key references organizations(id) on delete cascade,
  api_key_sealed   text,
  base_url         text not null default 'https://api.med-stop.com'
                     check (length(btrim(base_url)) > 0),
  key_expires_on   date,
  enabled          boolean not null default false,
  last_synced_at   timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table medstop_credentials is
  'Per-org Med-Stop API key, sealed with secretBox (org+purpose AAD). Service-role only, no client policies.';

create trigger trg_medstop_credentials_updated
  before update on medstop_credentials
  for each row execute function set_updated_at();

create trigger trg_medstop_credentials_org_immutable
  before update on medstop_credentials
  for each row execute function forbid_org_change();

alter table medstop_credentials enable row level security;
-- No client policies → deny-all → the API is the only reader and writer of a credential.

-- ── 2. The mirror: a SNAPSHOT, replaced whole on every sweep ──────────────────────────────────────
-- Med-Stop is the system of record for its roster, pools and selections; these tables are what it
-- said at `synced_at`, nothing more. A sweep replaces an org's rows of one kind in one transaction
-- (`medstop_replace_snapshot` below) rather than upserting row by row: there is no history here to
-- keep, a person Med-Stop REMOVED must disappear from the mirror (an upsert would keep them for
-- ever), and ~900 employee rows per sweep is one statement instead of ~1,800 round trips.
--
-- `driver_id` is OUR match (licence+state, then name+DOB — `matchMedstopPerson` in shared), not
-- Med-Stop's. A merge moves it to the canonical driver (`DRIVER_REASSIGNMENTS`); `on delete set null`
-- rather than cascade is the backstop for any other path that removes a driver row — the mirror row
-- stays and the next sweep re-matches it, where a cascade would drop a Med-Stop person from the
-- reconciliation until then (merge-driver cascade trap).
create table if not exists medstop_employees (
  org_id             uuid not null references organizations(id) on delete cascade,
  medstop_id         text not null check (length(btrim(medstop_id)) > 0),
  -- Med-Stop's list the row came from: 'active' (/Employee/list), 'applicant', 'terminated'.
  roster             text not null check (roster in ('active', 'applicant', 'terminated')),
  status             text,
  first_name         text,
  last_name          text,
  birth_date         date,
  license_number     text,
  license_state      text,
  dot_regulated      boolean,
  application_date   date,
  hire_date          date,
  termination_date   date,
  last_drug_test     date,
  last_alcohol_test  date,
  medical_expires_on date,
  driver_id          uuid references drivers(id) on delete set null,
  match_rule         text check (match_rule in ('licence', 'name_dob', 'name')),
  synced_at          timestamptz not null default now(),
  primary key (org_id, medstop_id)
);

create index if not exists medstop_employees_driver on medstop_employees (org_id, driver_id)
  where driver_id is not null;

alter table medstop_employees enable row level security;

-- Pools: one row per pool per year (drug and alcohol, quarterly, DOT). The percentages are
-- Med-Stop's own arithmetic, stored verbatim — the pace line (F-2) is computed from them and the
-- pool's dates, never re-derived from selections we may only partly see.
create table if not exists medstop_pools (
  org_id            uuid not null references organizations(id) on delete cascade,
  medstop_id        text not null check (length(btrim(medstop_id)) > 0),
  name              text,
  service           text not null,
  category          text,
  dot_regulated     boolean,
  pool_year         integer not null,
  starts_on         date,
  ends_on           date,
  frequency         text,
  target_percent    numeric,
  current_percent   numeric,
  members           integer,
  -- The average membership over the year so far — the DENOMINATOR Med-Stop divides by
  -- (`current_percent` = completed / members_avg; 66 / 155 = 42.58 % measured 2026-10-13).
  members_avg       numeric,
  completed_tests   integer,
  scheduled_tests   integer,
  status            text,
  synced_at         timestamptz not null default now(),
  primary key (org_id, medstop_id)
);

alter table medstop_pools enable row level security;

-- Selections: who Med-Stop's draw picked, when, and whether a request and a test followed. The
-- employee is Med-Stop's id; the person is reached through `medstop_employees` so a re-match moves
-- every selection with it.
create table if not exists medstop_selections (
  org_id               uuid not null references organizations(id) on delete cascade,
  medstop_id           text not null check (length(btrim(medstop_id)) > 0),
  pool_medstop_id      text,
  employee_medstop_id  text,
  service              text,
  -- Days, not instants: Med-Stop sends a zoneless local stamp ('2026-12-21T17:00:00'), and the
  -- question every reader asks is "which day was this person selected", never "at what moment".
  selected_on          date,
  request_medstop_id   text,
  requested_on         date,
  test_medstop_id      text,
  tested_on            date,
  status               text,
  synced_at            timestamptz not null default now(),
  primary key (org_id, medstop_id)
);

create index if not exists medstop_selections_employee on medstop_selections (org_id, employee_medstop_id);

alter table medstop_selections enable row level security;

-- ── 3. The one writer of the mirror ───────────────────────────────────────────────────────────────
-- raw-access-waiver: this is the medstop collector's own writer of its own three staging tables, called only from modules/medstop/sync.ts.
-- Replaces an org's rows of one kind with `p_rows` in one transaction. A sweep that fetched
-- NOTHING must not empty the mirror — that is a failed read, not an empty roster — so an empty
-- array is refused (MS001) and the caller records the failure instead.
create or replace function public.medstop_replace_snapshot(p_org uuid, p_kind text, p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'a Med-Stop snapshot of % must carry at least one row', p_kind using errcode = 'MS001';
  end if;

  if p_kind = 'employees' then
    delete from public.medstop_employees where org_id = p_org;
    insert into public.medstop_employees
      select (jsonb_populate_record(null::public.medstop_employees, r || jsonb_build_object('org_id', p_org, 'synced_at', now()))).*
        from jsonb_array_elements(p_rows) r;
  elsif p_kind = 'pools' then
    delete from public.medstop_pools where org_id = p_org;
    insert into public.medstop_pools
      select (jsonb_populate_record(null::public.medstop_pools, r || jsonb_build_object('org_id', p_org, 'synced_at', now()))).*
        from jsonb_array_elements(p_rows) r;
  elsif p_kind = 'selections' then
    delete from public.medstop_selections where org_id = p_org;
    insert into public.medstop_selections
      select (jsonb_populate_record(null::public.medstop_selections, r || jsonb_build_object('org_id', p_org, 'synced_at', now()))).*
        from jsonb_array_elements(p_rows) r;
  else
    raise exception 'unknown Med-Stop snapshot kind %', p_kind using errcode = 'MS002';
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.medstop_replace_snapshot(uuid, text, jsonb) from public, anon, authenticated;
