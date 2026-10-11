-- 0457: FMCSA's public record of our roadside inspections, stored as FMCSA served it
-- (INSPECTION-CHALLENGE-PLAN.md IC1, D-IC1, D-IC2; scope D-S360-8).
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
-- Measured 2026-10-10: data.transportation.gov holds 1,390 roadside inspections for USDOT 1864495
-- (2023-10-11 → 2026-10-07), 1,422 violations, 2,763 inspected units, 21 court results and the 741
-- violations FMCSA's current SMS scores us on. Nothing in the product reads any of it. Every later
-- step of the challenge engine — the SMS impact (IC3), the adjudicated-citation cases (IC4), the
-- rules (IC6) — stands on these rows, so they are kept exactly as received before anything derives
-- from them (D-S360-2, collect first).
--
-- ── TWO TABLES, BOTH APPEND-ONLY ─────────────────────────────────────────────────────────────────
-- `fmcsa_fetch_runs` is one row per dataset per successful or failed fetch: what was asked, what came
-- back, and what changed. `fmcsa_raw_rows` is one row per VERSION of an FMCSA record: a record seen
-- for the first time is version 1; a record whose payload hash differs from its latest version gets a
-- new version; a record missing from a COMPLETE snapshot gets a `vanished` version with no payload;
-- one that comes back after vanishing gets a `present` version again. Nothing is ever updated.
--
-- D-IC2 is why: **a disappearance is the outcome signal.** A violation that vanishes after a DataQs
-- request was granted is how the engine learns the request worked, without trusting anyone's note —
-- and an overwrite would have erased the before. The age-out of a record past FMCSA's three-year
-- window also vanishes it; telling the two apart is the projector's job (IC1b), from the inspection
-- date, not this table's.
--
-- ── WHY A FULL SNAPSHOT, NOT A `change_date` WATERMARK ───────────────────────────────────────────
-- The plan said "change_date > watermark". Building it showed a watermark can never see a vanish —
-- a deleted row has no change_date to be newer than — and D-IC2 needs exactly that. Our whole record
-- is ~7,000 rows across the six datasets, ~2 MB, so every run asks for all of it and the database
-- compares. `max_change_date` is still recorded per run, for freshness, not for paging.
--
-- ── ONE DOOR: fmcsa_snapshot_record ──────────────────────────────────────────────────────────────
-- The run row and its row versions are written in ONE statement by the function below, so a run
-- either lands with every version it found or not at all. The comparison is in SQL because the
-- latest version of every key is here, and reading it back over PostgREST would meet the 1,000-row
-- response cap on the unit file alone. It refuses (FM001) a complete snapshot that is EMPTY when
-- the dataset has present rows: an outage that answers `[]` must not vanish our whole record.
-- Failed runs are written by the caller directly (no rows ride with them).
--
-- ── RETENTION_FORBIDDEN, RLS DENY-ALL ────────────────────────────────────────────────────────────
-- Both tables are pinned in RETENTION_FORBIDDEN: a pruned version is a before that a filing's outcome
-- can no longer be read against. RLS is enabled with no policy: the API's service role writes and
-- reads, and every query filters `org_id` itself.
--
-- New tables, so the writer (`apps/api/src/modules/inspections/feed/`) ships in this same merge
-- (`lint:migration-ordering` exempts new tables).

create table if not exists public.fmcsa_fetch_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  dataset text not null
    check (dataset in ('fx4q-ay7w', '876r-jsdb', 'wt8s-2hbx', 'qbt8-7vic', 'rbkj-cgst', '8mt8-2mdr')),
  -- The USDOT number the request asked for, as it stood at the run: `organizations.dot_number` can be
  -- corrected later, and a run must say whose record it fetched.
  dot_number text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  outcome text not null check (outcome in ('succeeded', 'failed')),
  -- True when the rows are the dataset's whole answer for us. Only a complete snapshot may vanish rows.
  complete boolean not null,
  -- Socrata's own `rowsUpdatedAt` for the dataset: when FMCSA last published, not when we asked.
  source_rows_updated_at timestamptz,
  request_count integer not null default 0 check (request_count >= 0),
  rows_seen integer not null default 0 check (rows_seen >= 0),
  rows_new integer not null default 0 check (rows_new >= 0),
  rows_changed integer not null default 0 check (rows_changed >= 0),
  rows_reappeared integer not null default 0 check (rows_reappeared >= 0),
  rows_vanished integer not null default 0 check (rows_vanished >= 0),
  -- FMCSA's `change_date` is text, `YYYYMMDD HHMM`, so the greatest one is a string max.
  max_change_date text,
  error text,
  duration_ms integer check (duration_ms >= 0),
  -- A failure says why; a success says nothing.
  constraint fmcsa_fetch_runs_error_iff_failed check ((outcome = 'failed') = (error is not null)),
  unique (id, org_id)
);

create index if not exists fmcsa_fetch_runs_latest_idx
  on public.fmcsa_fetch_runs (org_id, dataset, finished_at desc);

create table if not exists public.fmcsa_raw_rows (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  fetch_run_id uuid not null,
  dataset text not null
    check (dataset in ('fx4q-ay7w', '876r-jsdb', 'wt8s-2hbx', 'qbt8-7vic', 'rbkj-cgst', '8mt8-2mdr')),
  -- FMCSA's own id for the record (`fmcsaNaturalKeys`, packages/shared/src/fmcsaDatasets.ts).
  natural_key text not null check (natural_key <> ''),
  version integer not null check (version >= 1),
  kind text not null check (kind in ('present', 'vanished')),
  -- The row exactly as Socrata returned it. jsonb normalises key order, so the hash below is stable
  -- across runs for an unchanged record.
  payload jsonb,
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  change_date text,
  observed_at timestamptz not null default now(),
  constraint fmcsa_raw_rows_payload_iff_present
    check ((kind = 'present') = (payload is not null and sha256 is not null)),
  constraint fmcsa_raw_rows_run_fk
    foreign key (fetch_run_id, org_id) references public.fmcsa_fetch_runs (id, org_id),
  unique (org_id, dataset, natural_key, version)
);

create index if not exists fmcsa_raw_rows_run_idx on public.fmcsa_raw_rows (fetch_run_id);

create or replace function public.fmcsa_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is refused (FMCSA''s record is versioned, never edited)', tg_table_name, tg_op
    using errcode = 'FM010';
end;
$$;

drop trigger if exists trg_fmcsa_fetch_runs_append_only on public.fmcsa_fetch_runs;
create trigger trg_fmcsa_fetch_runs_append_only
  before update or delete on public.fmcsa_fetch_runs
  for each row execute function public.fmcsa_append_only();

drop trigger if exists trg_fmcsa_raw_rows_append_only on public.fmcsa_raw_rows;
create trigger trg_fmcsa_raw_rows_append_only
  before update or delete on public.fmcsa_raw_rows
  for each row execute function public.fmcsa_append_only();

alter table public.fmcsa_fetch_runs enable row level security;
alter table public.fmcsa_raw_rows enable row level security;

-- raw-access-waiver: fmcsa_raw_rows is owned by the `inspections` collector, and this function is
-- that collector's own write door, called only from apps/api/src/modules/inspections/feed/.
--
-- p_rows: a jsonb array of {"k": natural key, "p": payload}. p_run: {"started_at", "complete",
-- "source_rows_updated_at", "request_count", "duration_ms"}. Returns the run id and its counts.
create or replace function public.fmcsa_snapshot_record(
  p_org uuid,
  p_dataset text,
  p_dot_number text,
  p_rows jsonb,
  p_run jsonb
)
returns table (
  run_id uuid,
  rows_seen integer,
  rows_new integer,
  rows_changed integer,
  rows_reappeared integer,
  rows_vanished integer
)
language plpgsql
set search_path = ''
as $$
declare
  v_complete boolean := coalesce((p_run->>'complete')::boolean, false);
  v_run uuid := gen_random_uuid();
  v_present integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a jsonb array' using errcode = 'FM002';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    where coalesce(e->>'k', '') = '' or jsonb_typeof(e->'p') is distinct from 'object'
  ) then
    raise exception 'every row needs a natural key "k" and an object payload "p"' using errcode = 'FM002';
  end if;
  if (select count(*) from jsonb_array_elements(p_rows)) <> (select count(distinct e->>'k') from jsonb_array_elements(p_rows) e) then
    raise exception 'a snapshot names each natural key once' using errcode = 'FM003';
  end if;

  if v_complete and jsonb_array_length(p_rows) = 0 then
    select count(*) into v_present from (
      select distinct on (r.natural_key) r.kind
      from public.fmcsa_raw_rows r
      where r.org_id = p_org and r.dataset = p_dataset
      order by r.natural_key, r.version desc
    ) l where l.kind = 'present';
    if v_present > 0 then
      raise exception 'an empty complete snapshot of % would vanish % present rows; refused', p_dataset, v_present
        using errcode = 'FM001';
    end if;
  end if;

  return query
  with incoming as (
    select e->>'k' as natural_key,
           e->'p' as payload,
           encode(sha256(convert_to((e->'p')::text, 'UTF8')), 'hex') as sha256,
           e->'p'->>'change_date' as change_date
    from jsonb_array_elements(p_rows) e
  ),
  latest as (
    select distinct on (r.natural_key) r.natural_key, r.version, r.kind, r.sha256
    from public.fmcsa_raw_rows r
    where r.org_id = p_org and r.dataset = p_dataset
    order by r.natural_key, r.version desc
  ),
  diff as (
    select i.natural_key, i.payload, i.sha256, i.change_date, 'present'::text as kind,
           coalesce(l.version, 0) + 1 as version,
           case when l.natural_key is null then 'new' when l.kind = 'vanished' then 'reappeared' else 'changed' end as change
    from incoming i
    left join latest l on l.natural_key = i.natural_key
    where l.natural_key is null or l.kind = 'vanished' or l.sha256 <> i.sha256
    union all
    select l.natural_key, null::jsonb, null::text, null::text, 'vanished'::text, l.version + 1, 'vanished'
    from latest l
    where v_complete and l.kind = 'present'
      and not exists (select 1 from incoming i where i.natural_key = l.natural_key)
  ),
  run as (
    insert into public.fmcsa_fetch_runs (
      id, org_id, dataset, dot_number, started_at, outcome, complete, source_rows_updated_at,
      request_count, rows_seen, rows_new, rows_changed, rows_reappeared, rows_vanished,
      max_change_date, duration_ms
    )
    select v_run, p_org, p_dataset, p_dot_number, (p_run->>'started_at')::timestamptz, 'succeeded', v_complete,
           (p_run->>'source_rows_updated_at')::timestamptz,
           coalesce((p_run->>'request_count')::integer, 0),
           (select count(*)::integer from incoming),
           (select count(*)::integer from diff where change = 'new'),
           (select count(*)::integer from diff where change = 'changed'),
           (select count(*)::integer from diff where change = 'reappeared'),
           (select count(*)::integer from diff where change = 'vanished'),
           (select max(change_date) from incoming),
           (p_run->>'duration_ms')::integer
    returning id, fmcsa_fetch_runs.rows_seen, fmcsa_fetch_runs.rows_new, fmcsa_fetch_runs.rows_changed,
              fmcsa_fetch_runs.rows_reappeared, fmcsa_fetch_runs.rows_vanished
  ),
  written as (
    insert into public.fmcsa_raw_rows (org_id, fetch_run_id, dataset, natural_key, version, kind, payload, sha256, change_date)
    select p_org, run.id, p_dataset, d.natural_key, d.version, d.kind, d.payload, d.sha256, d.change_date
    from diff d cross join run
    returning 1
  )
  select run.id, run.rows_seen, run.rows_new, run.rows_changed, run.rows_reappeared, run.rows_vanished
  from run
  -- Joining `written` forces the row insert to run before the function returns its counts.
  where (select count(*) from written) >= 0;
end;
$$;

comment on function public.fmcsa_snapshot_record(uuid, text, text, jsonb, jsonb) is
  'IC1 (0457): record one fetched FMCSA dataset snapshot — the run row and every new, changed, reappeared or vanished record version, in one statement. Service role only.';

revoke all on function public.fmcsa_snapshot_record(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
