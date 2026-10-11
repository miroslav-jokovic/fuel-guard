-- 0458: our roadside inspections, violations, units and court results as typed rows, projected from
-- FMCSA's raw feed and matched to our trucks and trailers (INSPECTION-CHALLENGE-PLAN.md IC1b, D-IC7).
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
-- 0457 keeps FMCSA's rows exactly as served: every value a string, one jsonb per record version.
-- Nothing above it can ask "which of our trucks had an out-of-service violation in May" of that. These
-- four tables are the record a person and the later steps read: dates as dates, counts as integers,
-- each unit tied to the vehicle or trailer it was, each court result tied to the violation it decided.
--
-- ── DERIVED, REBUILT FROM THE RAW STORE ──────────────────────────────────────────────────────────
-- Every row is a projection of the CURRENT version of one FMCSA record in `fmcsa_raw_rows`, keyed by
-- FMCSA's own id. `roadside_project` recomputes all four for one org in one call, after each feed run.
-- It is idempotent — a second call with nothing new changes no row — and a row is only rewritten when
-- something in it differs, so `projected_at` says when the row last changed, not when the job last ran.
-- Because they can be rebuilt, these are not evidence and not in RETENTION_FORBIDDEN; the raw store is.
--
-- ── A VANISHED RECORD IS KEPT, MARKED ────────────────────────────────────────────────────────────
-- A record whose latest raw version is `vanished` keeps its typed row, with `vanished_at` (when the
-- feed first stopped serving it) and `vanish_reason`:
--   aged_out — its inspection is past FMCSA's three-year window (measured 2026-10-10: the feed's
--              oldest inspection was exactly three years old). Expected, and never a DataQs outcome.
--   removed  — it disappeared inside the window. After a DataQs request, that is the outcome (D-IC2);
--              without one, it is a question for a person. Fourteen days of slack go to aged_out, so a
--              late republish near the boundary is not mistaken for a removal.
-- A record that comes back clears both. Deleting the row instead would orphan every case (IC4) that
-- will point at it.
--
-- ── MATCHING A UNIT TO OURS (D-IC7) ──────────────────────────────────────────────────────────────
-- In order, each method recorded in `match_method`:
--   vin         the VIN, uppercased with non-alphanumerics removed, equal to exactly one vehicle or
--               trailer of this org. Measured 2026-10-11: 1,207 of 1,396 tractors, 1,263 of 1,367
--               trailers; no VIN repeats in the roster.
--   plate       plate + state, normalised the same way, equal to exactly one (23 tractors, 15 trailers).
--   unit_number the officer's "company number" equal to exactly one unit number of the RIGHT KIND — a
--               truck tractor (type 11) against vehicles, a semi-trailer (type 9) against trailers,
--               because our truck 701 and trailer 701 are different units (4 and 12 measured). The
--               weakest of the three; the case screens show the method beside the match.
--   ambiguous   a method found two or more candidates; nothing is matched, a person decides.
--   kind_mismatch  the only VIN or plate hit is the wrong kind of unit (a tractor's on a trailer record);
--               nothing is matched, a person decides. Tractors match vehicles and semi-trailers match
--               trailers by EVERY method; other unit types (8 of 2,763) match either table.
--   none        no method found one (162 tractors, 77 trailers — Q-IC8 asks who they are).
-- Matching is recomputed on every projection, so a VIN corrected in the roster corrects the match.
-- `vehicle_id` / `trailer_id` carry no FK: vehicles are never deleted (`vehicles.status` is the
-- retirement), and 0453 made the same call for the same reason.
--
-- ── CONVERSION NEVER FAILS THE RUN ───────────────────────────────────────────────────────────────
-- FMCSA's strings are converted with pattern guards: a value that does not parse becomes NULL, never an
-- exception, so one malformed record cannot stop the projection of the other ~5,600. The raw value is
-- always one join away (`raw_row_id`).
--
-- ── RLS: ENABLED, NO POLICY, DENY-ALL ON PURPOSE ─────────────────────────────────────────────────
-- Written and read by the API's service role only (`inspections` module); every query filters org_id.
--
-- New tables, so the writer ships in this same merge (`lint:migration-ordering` exempts new tables).

-- ── helpers ──────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fmcsa_int(p text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when btrim(p) ~ '^[0-9]{1,9}$' then btrim(p)::integer end;
$$;

create or replace function public.fmcsa_bigint(p text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when btrim(p) ~ '^[0-9]{1,18}$' then btrim(p)::bigint end;
$$;

create or replace function public.fmcsa_ymd(p text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  -- `YYYYMMDD`. An impossible date (20260231) is NULL, never an exception and never a rolled-over March.
  if btrim(p) !~ '^[0-9]{8}$' then return null; end if;
  return make_date(substr(btrim(p), 1, 4)::int, substr(btrim(p), 5, 2)::int, substr(btrim(p), 7, 2)::int);
exception when others then
  return null;
end;
$$;

create or replace function public.fmcsa_yn(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case upper(btrim(p)) when 'Y' then true when 'N' then false end;
$$;

create or replace function public.fmcsa_ident(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- VINs, plates and unit numbers compared without case, spaces or punctuation.
  select nullif(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g'), '');
$$;

-- raw-access-waiver: fmcsa_raw_rows is owned by the `inspections` collector; this reader is that
-- module's own, called only from roadside_project below.
--
-- The current state of every record of one dataset for one org: the latest PRESENT version's payload,
-- and, when the latest version of all is a vanish, when that vanish was observed.
create or replace function public.fmcsa_raw_current(p_org uuid, p_dataset text)
returns table (natural_key text, raw_row_id bigint, payload jsonb, vanished_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select p.natural_key, p.id, p.payload, case when l.kind = 'vanished' then l.observed_at end
  from (
    select distinct on (r.natural_key) r.natural_key, r.id, r.payload
    from public.fmcsa_raw_rows r
    where r.org_id = p_org and r.dataset = p_dataset and r.kind = 'present'
    order by r.natural_key, r.version desc
  ) p
  join (
    select distinct on (r.natural_key) r.natural_key, r.kind, r.observed_at
    from public.fmcsa_raw_rows r
    where r.org_id = p_org and r.dataset = p_dataset
    order by r.natural_key, r.version desc
  ) l on l.natural_key = p.natural_key;
$$;

-- ── tables ───────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.roadside_inspections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  fmcsa_inspection_id bigint not null,
  raw_row_id bigint not null references public.fmcsa_raw_rows(id),
  report_number text,
  report_state text,
  inspection_date date,
  -- Local clock time on the report, HHMM, in the inspection's own time zone — which the report does not
  -- name. Resolving it to an instant is D-IC8's job (IC5), from the truck's GPS position.
  start_hhmm text,
  end_hhmm text,
  level smallint,
  -- F = fixed site, R = roadside.
  facility text,
  location_desc text,
  county_code_state text,
  county_code text,
  post_accident boolean,
  hazmat_placard_required boolean,
  shipper_name text,
  gross_weight_lb integer,
  violations_total integer,
  oos_total integer,
  driver_oos_total integer,
  vehicle_oos_total integer,
  hazmat_oos_total integer,
  change_date text,
  vanished_at timestamptz,
  vanish_reason text check (vanish_reason in ('aged_out', 'removed')),
  first_projected_at timestamptz not null default now(),
  projected_at timestamptz not null default now(),
  constraint roadside_inspections_vanish_pair check ((vanished_at is null) = (vanish_reason is null)),
  unique (org_id, fmcsa_inspection_id),
  unique (id, org_id)
);
create index if not exists roadside_inspections_date_idx on public.roadside_inspections (org_id, inspection_date desc);

create table if not exists public.roadside_inspection_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  inspection_id uuid not null,
  fmcsa_unit_id bigint not null,
  raw_row_id bigint not null references public.fmcsa_raw_rows(id),
  -- The unit's position on the report: 1 is the power unit, 2 the first trailer.
  unit_seq smallint,
  -- FMCSA's unit type code: 11 truck tractor, 9 semi-trailer (the two our fleet is made of).
  unit_type_id text,
  make text,
  company_number text,
  plate text,
  plate_state text,
  vin text,
  decal boolean,
  vehicle_id uuid,
  trailer_id uuid,
  match_method text not null check (match_method in ('vin', 'plate', 'unit_number', 'ambiguous', 'kind_mismatch', 'none')),
  change_date text,
  vanished_at timestamptz,
  vanish_reason text check (vanish_reason in ('aged_out', 'removed')),
  first_projected_at timestamptz not null default now(),
  projected_at timestamptz not null default now(),
  constraint roadside_inspection_units_inspection_fk
    foreign key (inspection_id, org_id) references public.roadside_inspections (id, org_id) on delete cascade,
  constraint roadside_inspection_units_one_match check (vehicle_id is null or trailer_id is null),
  constraint roadside_inspection_units_matched_iff_method
    check ((vehicle_id is not null or trailer_id is not null) = (match_method in ('vin', 'plate', 'unit_number'))),
  constraint roadside_inspection_units_vanish_pair check ((vanished_at is null) = (vanish_reason is null)),
  unique (org_id, fmcsa_unit_id),
  unique (id, org_id)
);
create index if not exists roadside_inspection_units_inspection_idx on public.roadside_inspection_units (inspection_id);
create index if not exists roadside_inspection_units_vehicle_idx on public.roadside_inspection_units (org_id, vehicle_id) where vehicle_id is not null;
create index if not exists roadside_inspection_units_trailer_idx on public.roadside_inspection_units (org_id, trailer_id) where trailer_id is not null;

create table if not exists public.roadside_violations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  inspection_id uuid not null,
  fmcsa_violation_id bigint not null,
  raw_row_id bigint not null references public.fmcsa_raw_rows(id),
  seq_no integer,
  -- The code exactly as FMCSA wrote it (`393.75A3-TAOL`). Normalising it to the SMS Appendix A key is
  -- IC3's, against the versioned list, so it is not guessed here.
  viol_code text,
  part_no text,
  part_section text,
  -- Which unit the violation is against: the unit's seq (1, 2, …) or D for the driver.
  viol_unit text,
  unit_id uuid,
  category_id integer,
  out_of_service boolean,
  -- Undocumented in the dataset metadata (Q-IC5): kept verbatim, read by no rule until it is.
  defect_verification_id text,
  citation_number text,
  description text,
  change_date text,
  vanished_at timestamptz,
  vanish_reason text check (vanish_reason in ('aged_out', 'removed')),
  first_projected_at timestamptz not null default now(),
  projected_at timestamptz not null default now(),
  constraint roadside_violations_inspection_fk
    foreign key (inspection_id, org_id) references public.roadside_inspections (id, org_id) on delete cascade,
  constraint roadside_violations_unit_fk
    foreign key (unit_id, org_id) references public.roadside_inspection_units (id, org_id),
  constraint roadside_violations_vanish_pair check ((vanished_at is null) = (vanish_reason is null)),
  unique (org_id, fmcsa_violation_id),
  unique (id, org_id)
);
create index if not exists roadside_violations_inspection_idx on public.roadside_violations (inspection_id);

create table if not exists public.roadside_citations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  inspection_id uuid not null,
  -- The violation this result decided: same inspection, `seq_no = vioseqnum`. Null when the feed names
  -- a seq the violation file does not have (yet — the child files lag each other by a day, measured).
  violation_id uuid,
  natural_key text not null,
  raw_row_id bigint not null references public.fmcsa_raw_rows(id),
  vioseqnum integer,
  adjseq integer,
  -- FMCSA's adjudicated-citation code: 1 original charge, 2 different charge, 3 dismissed (job aid
  -- AdjudicatedCitations2025, docs/regulatory/fmcsa/), with its text beside it as served.
  citation_code smallint,
  citation_result text,
  change_date text,
  vanished_at timestamptz,
  vanish_reason text check (vanish_reason in ('aged_out', 'removed')),
  first_projected_at timestamptz not null default now(),
  projected_at timestamptz not null default now(),
  constraint roadside_citations_inspection_fk
    foreign key (inspection_id, org_id) references public.roadside_inspections (id, org_id) on delete cascade,
  constraint roadside_citations_violation_fk
    foreign key (violation_id, org_id) references public.roadside_violations (id, org_id),
  constraint roadside_citations_vanish_pair check ((vanished_at is null) = (vanish_reason is null)),
  unique (org_id, natural_key)
);
create index if not exists roadside_citations_inspection_idx on public.roadside_citations (inspection_id);

alter table public.roadside_inspections enable row level security;
alter table public.roadside_inspection_units enable row level security;
alter table public.roadside_violations enable row level security;
alter table public.roadside_citations enable row level security;

-- ── the projection ───────────────────────────────────────────────────────────────────────────────
-- Whether a roster row of kind v (vehicle) / t (trailer) can be FMCSA unit type p_type: a truck tractor
-- (11) is a vehicle, a semi-trailer (9) a trailer, anything else may be either.
create or replace function public.fmcsa_kind_fits(p_kind text, p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case btrim(coalesce(p_type, '')) when '11' then p_kind = 'v' when '9' then p_kind = 't' else true end;
$$;

create or replace function public.fmcsa_vanish_reason(p_vanished_at timestamptz, p_inspection_date date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_vanished_at is null then null
    when p_inspection_date is not null
     and p_inspection_date <= (p_vanished_at::date - interval '3 years' + interval '14 days')::date then 'aged_out'
    else 'removed'
  end;
$$;

-- raw-access-waiver: reads fmcsa_raw_rows only through fmcsa_raw_current, the `inspections` collector's
-- own reader; called only from apps/api/src/modules/inspections/feed/.
--
-- Recompute all four projections for one org. Returns how many rows each table gained or changed.
create or replace function public.roadside_project(p_org uuid)
returns table (inspections integer, units integer, violations integer, citations integer)
language plpgsql
set search_path = ''
as $$
declare
  v_i integer; v_u integer; v_v integer; v_c integer;
begin
  -- 1. inspections
  insert into public.roadside_inspections as t (
    org_id, fmcsa_inspection_id, raw_row_id, report_number, report_state, inspection_date, start_hhmm, end_hhmm,
    level, facility, location_desc, county_code_state, county_code, post_accident, hazmat_placard_required,
    shipper_name, gross_weight_lb, violations_total, oos_total, driver_oos_total, vehicle_oos_total,
    hazmat_oos_total, change_date, vanished_at, vanish_reason
  )
  select p_org, s.fid, s.raw_row_id, nullif(btrim(s.p->>'report_number'), ''), nullif(btrim(s.p->>'report_state'), ''),
         s.d, nullif(btrim(s.p->>'insp_start_time'), ''), nullif(btrim(s.p->>'insp_end_time'), ''),
         public.fmcsa_int(s.p->>'insp_level_id')::smallint, nullif(btrim(s.p->>'insp_facility'), ''),
         nullif(btrim(s.p->>'location_desc'), ''), nullif(btrim(s.p->>'county_code_state'), ''),
         nullif(btrim(s.p->>'county_code'), ''), public.fmcsa_yn(s.p->>'post_acc_ind'),
         public.fmcsa_yn(s.p->>'hazmat_placard_req'), nullif(btrim(s.p->>'shipper_name'), ''),
         public.fmcsa_int(s.p->>'gross_comb_veh_wt'), public.fmcsa_int(s.p->>'viol_total'),
         public.fmcsa_int(s.p->>'oos_total'), public.fmcsa_int(s.p->>'driver_oos_total'),
         public.fmcsa_int(s.p->>'vehicle_oos_total'), public.fmcsa_int(s.p->>'hazmat_oos_total'),
         s.p->>'change_date', s.vanished_at, public.fmcsa_vanish_reason(s.vanished_at, s.d)
  from (
    select public.fmcsa_bigint(c.payload->>'inspection_id') as fid, c.raw_row_id, c.payload as p, c.vanished_at,
           public.fmcsa_ymd(c.payload->>'insp_date') as d
    from public.fmcsa_raw_current(p_org, 'fx4q-ay7w') c
  ) s
  where s.fid is not null
  on conflict (org_id, fmcsa_inspection_id) do update set
    raw_row_id = excluded.raw_row_id, report_number = excluded.report_number, report_state = excluded.report_state,
    inspection_date = excluded.inspection_date, start_hhmm = excluded.start_hhmm, end_hhmm = excluded.end_hhmm,
    level = excluded.level, facility = excluded.facility, location_desc = excluded.location_desc,
    county_code_state = excluded.county_code_state, county_code = excluded.county_code,
    post_accident = excluded.post_accident, hazmat_placard_required = excluded.hazmat_placard_required,
    shipper_name = excluded.shipper_name, gross_weight_lb = excluded.gross_weight_lb,
    violations_total = excluded.violations_total, oos_total = excluded.oos_total,
    driver_oos_total = excluded.driver_oos_total, vehicle_oos_total = excluded.vehicle_oos_total,
    hazmat_oos_total = excluded.hazmat_oos_total, change_date = excluded.change_date,
    vanished_at = excluded.vanished_at, vanish_reason = excluded.vanish_reason, projected_at = now()
  where (t.raw_row_id, t.vanished_at, t.vanish_reason)
        is distinct from (excluded.raw_row_id, excluded.vanished_at, excluded.vanish_reason);
  get diagnostics v_i = row_count;

  -- 2. units, matched to this org's roster
  with roster as materialized (
    select 'v'::text as k, v.id, public.fmcsa_ident(v.vin) as vin, public.fmcsa_ident(v.plate) as plate,
           upper(btrim(v.plate_state)) as st, public.fmcsa_ident(v.unit_number) as unit
    from public.vehicles v where v.org_id = p_org
    union all
    select 't', r.id, public.fmcsa_ident(r.vin), public.fmcsa_ident(r.plate), upper(btrim(r.plate_state)),
           public.fmcsa_ident(r.unit_number)
    from public.trailers r where r.org_id = p_org
  ),
  src as (
    select public.fmcsa_bigint(c.payload->>'insp_unit_id') as fid, c.raw_row_id, c.payload as p, c.vanished_at,
           i.id as inspection_id, i.inspection_date as d,
           public.fmcsa_ident(c.payload->>'insp_unit_vehicle_id_number') as vin_n,
           public.fmcsa_ident(c.payload->>'insp_unit_license') as plate_n,
           upper(btrim(c.payload->>'insp_unit_license_state')) as st_n,
           public.fmcsa_ident(c.payload->>'insp_unit_company') as unit_n,
           btrim(c.payload->>'insp_unit_type_id') as type_id
    from public.fmcsa_raw_current(p_org, 'wt8s-2hbx') c
    join public.roadside_inspections i
      on i.org_id = p_org and i.fmcsa_inspection_id = public.fmcsa_bigint(c.payload->>'inspection_id')
  ),
  -- Hash joins, not a correlated scan per unit: ~2,800 units against ~500 roster rows, three ways.
  by_vin as (
    select s.fid, array_agg(array[r.k, r.id::text]) as a
    from src s join roster r on r.vin = s.vin_n and public.fmcsa_kind_fits(r.k, s.type_id) group by s.fid
  ),
  by_plate as (
    select s.fid, array_agg(array[r.k, r.id::text]) as a
    from src s join roster r on r.plate = s.plate_n and r.st = s.st_n and public.fmcsa_kind_fits(r.k, s.type_id)
    group by s.fid
  ),
  -- A VIN or plate that names a unit of the WRONG kind — a tractor's on a trailer record, or the other
  -- way round. Measured 2026-10-11: 4 of 2,763 (one tractor, three semi-trailers). An officer's typo or
  -- a roster row on the wrong table; either way a person decides, so it is recorded and never matched.
  wrong_kind as (
    select distinct s.fid
    from src s join roster r
      on ((r.vin = s.vin_n) or (r.plate = s.plate_n and r.st = s.st_n)) and not public.fmcsa_kind_fits(r.k, s.type_id)
  ),
  by_unit as (
    select s.fid, array_agg(array[r.k, r.id::text]) as a
    from src s join roster r
      on r.unit = s.unit_n and s.type_id in ('11', '9') and public.fmcsa_kind_fits(r.k, s.type_id)
    group by s.fid
  ),
  matched as (
    select s.*, bv.a as by_vin, bp.a as by_plate, bu.a as by_unit, (wk.fid is not null) as wrong_kind
    from src s
    left join by_vin bv on bv.fid = s.fid
    left join by_plate bp on bp.fid = s.fid
    left join by_unit bu on bu.fid = s.fid
    left join wrong_kind wk on wk.fid = s.fid
    where s.fid is not null
  ),
  decided as (
    select m.*,
      case
        when array_length(m.by_vin, 1) = 1 then 'vin'
        when array_length(m.by_vin, 1) > 1 then 'ambiguous'
        when array_length(m.by_plate, 1) = 1 then 'plate'
        when array_length(m.by_plate, 1) > 1 then 'ambiguous'
        when array_length(m.by_unit, 1) = 1 then 'unit_number'
        when array_length(m.by_unit, 1) > 1 then 'ambiguous'
        when m.wrong_kind then 'kind_mismatch'
        else 'none'
      end as method,
      coalesce(
        case when array_length(m.by_vin, 1) = 1 then m.by_vin end,
        case when m.by_vin is null and array_length(m.by_plate, 1) = 1 then m.by_plate end,
        case when m.by_vin is null and m.by_plate is null and array_length(m.by_unit, 1) = 1 then m.by_unit end
      ) as hit
    from matched m
  )
  insert into public.roadside_inspection_units as t (
    org_id, inspection_id, fmcsa_unit_id, raw_row_id, unit_seq, unit_type_id, make, company_number, plate,
    plate_state, vin, decal, vehicle_id, trailer_id, match_method, change_date, vanished_at, vanish_reason
  )
  select p_org, d.inspection_id, d.fid, d.raw_row_id, public.fmcsa_int(d.p->>'insp_unit_number')::smallint,
         nullif(d.type_id, ''), nullif(btrim(d.p->>'insp_unit_make'), ''), nullif(btrim(d.p->>'insp_unit_company'), ''),
         nullif(btrim(d.p->>'insp_unit_license'), ''), nullif(d.st_n, ''),
         nullif(btrim(d.p->>'insp_unit_vehicle_id_number'), ''), public.fmcsa_yn(d.p->>'insp_unit_decal'),
         case when d.hit[1][1] = 'v' then d.hit[1][2]::uuid end,
         case when d.hit[1][1] = 't' then d.hit[1][2]::uuid end,
         d.method, d.p->>'change_date', d.vanished_at, public.fmcsa_vanish_reason(d.vanished_at, d.d)
  from decided d
  on conflict (org_id, fmcsa_unit_id) do update set
    inspection_id = excluded.inspection_id, raw_row_id = excluded.raw_row_id, unit_seq = excluded.unit_seq,
    unit_type_id = excluded.unit_type_id, make = excluded.make, company_number = excluded.company_number,
    plate = excluded.plate, plate_state = excluded.plate_state, vin = excluded.vin, decal = excluded.decal,
    vehicle_id = excluded.vehicle_id, trailer_id = excluded.trailer_id, match_method = excluded.match_method,
    change_date = excluded.change_date, vanished_at = excluded.vanished_at, vanish_reason = excluded.vanish_reason,
    projected_at = now()
  where (t.raw_row_id, t.vehicle_id, t.trailer_id, t.match_method, t.vanished_at, t.vanish_reason)
        is distinct from (excluded.raw_row_id, excluded.vehicle_id, excluded.trailer_id, excluded.match_method,
                          excluded.vanished_at, excluded.vanish_reason);
  get diagnostics v_u = row_count;

  -- 3. violations, each tied to its unit: by FMCSA's unit id when the row carries one, else by the
  --    unit's seq on the same inspection. A driver violation (viol_unit D) has no unit.
  insert into public.roadside_violations as t (
    org_id, inspection_id, fmcsa_violation_id, raw_row_id, seq_no, viol_code, part_no, part_section, viol_unit,
    unit_id, category_id, out_of_service, defect_verification_id, citation_number, description, change_date,
    vanished_at, vanish_reason
  )
  select p_org, i.id, public.fmcsa_bigint(c.payload->>'insp_violation_id'), c.raw_row_id,
         public.fmcsa_int(c.payload->>'seq_no'), nullif(btrim(c.payload->>'viol_code'), ''),
         nullif(btrim(c.payload->>'part_no'), ''), nullif(btrim(c.payload->>'part_no_section'), ''),
         nullif(upper(btrim(c.payload->>'insp_viol_unit')), ''),
         coalesce(
           (select u.id from public.roadside_inspection_units u
             where u.org_id = p_org and u.fmcsa_unit_id = public.fmcsa_bigint(c.payload->>'insp_unit_id')),
           (select u.id from public.roadside_inspection_units u
             where u.org_id = p_org and u.inspection_id = i.id
               and u.unit_seq = public.fmcsa_int(c.payload->>'insp_viol_unit') limit 1)
         ),
         public.fmcsa_int(c.payload->>'insp_violation_category_id'), public.fmcsa_yn(c.payload->>'out_of_service_indicator'),
         nullif(btrim(c.payload->>'defect_verification_id'), ''), nullif(btrim(c.payload->>'citation_number'), ''),
         nullif(btrim(c.payload->>'viol_desc'), ''), c.payload->>'change_date', c.vanished_at,
         public.fmcsa_vanish_reason(c.vanished_at, i.inspection_date)
  from public.fmcsa_raw_current(p_org, '876r-jsdb') c
  join public.roadside_inspections i
    on i.org_id = p_org and i.fmcsa_inspection_id = public.fmcsa_bigint(c.payload->>'inspection_id')
  where public.fmcsa_bigint(c.payload->>'insp_violation_id') is not null
  on conflict (org_id, fmcsa_violation_id) do update set
    inspection_id = excluded.inspection_id, raw_row_id = excluded.raw_row_id, seq_no = excluded.seq_no,
    viol_code = excluded.viol_code, part_no = excluded.part_no, part_section = excluded.part_section,
    viol_unit = excluded.viol_unit, unit_id = excluded.unit_id, category_id = excluded.category_id,
    out_of_service = excluded.out_of_service, defect_verification_id = excluded.defect_verification_id,
    citation_number = excluded.citation_number, description = excluded.description,
    change_date = excluded.change_date, vanished_at = excluded.vanished_at, vanish_reason = excluded.vanish_reason,
    projected_at = now()
  where (t.raw_row_id, t.unit_id, t.vanished_at, t.vanish_reason)
        is distinct from (excluded.raw_row_id, excluded.unit_id, excluded.vanished_at, excluded.vanish_reason);
  get diagnostics v_v = row_count;

  -- 4. court results, each tied to the violation it decided
  insert into public.roadside_citations as t (
    org_id, inspection_id, violation_id, natural_key, raw_row_id, vioseqnum, adjseq, citation_code,
    citation_result, change_date, vanished_at, vanish_reason
  )
  select p_org, i.id,
         (select v.id from public.roadside_violations v
           where v.org_id = p_org and v.inspection_id = i.id and v.seq_no = public.fmcsa_int(c.payload->>'vioseqnum')
           limit 1),
         c.natural_key, c.raw_row_id, public.fmcsa_int(c.payload->>'vioseqnum'), public.fmcsa_int(c.payload->>'adjseq'),
         public.fmcsa_int(c.payload->>'citation_code')::smallint, nullif(btrim(c.payload->>'citation_result'), ''),
         c.payload->>'change_date', c.vanished_at, public.fmcsa_vanish_reason(c.vanished_at, i.inspection_date)
  from public.fmcsa_raw_current(p_org, 'qbt8-7vic') c
  join public.roadside_inspections i
    on i.org_id = p_org and i.fmcsa_inspection_id = public.fmcsa_bigint(c.payload->>'inspection_id')
  on conflict (org_id, natural_key) do update set
    inspection_id = excluded.inspection_id, violation_id = excluded.violation_id, raw_row_id = excluded.raw_row_id,
    vioseqnum = excluded.vioseqnum, adjseq = excluded.adjseq, citation_code = excluded.citation_code,
    citation_result = excluded.citation_result, change_date = excluded.change_date,
    vanished_at = excluded.vanished_at, vanish_reason = excluded.vanish_reason, projected_at = now()
  where (t.raw_row_id, t.violation_id, t.vanished_at, t.vanish_reason)
        is distinct from (excluded.raw_row_id, excluded.violation_id, excluded.vanished_at, excluded.vanish_reason);
  get diagnostics v_c = row_count;

  return query select v_i, v_u, v_v, v_c;
end;
$$;

comment on function public.roadside_project(uuid) is
  'IC1b (0458): recompute roadside_inspections / _units / _violations / _citations for one org from the current fmcsa_raw_rows versions, matching units to vehicles and trailers. Idempotent. Service role only.';

revoke all on function public.roadside_project(uuid) from public, anon, authenticated;
revoke all on function public.fmcsa_raw_current(uuid, text) from public, anon, authenticated;
revoke all on function public.fmcsa_kind_fits(text, text) from public, anon, authenticated;
revoke all on function public.fmcsa_vanish_reason(timestamptz, date) from public, anon, authenticated;
revoke all on function public.fmcsa_int(text) from public, anon, authenticated;
revoke all on function public.fmcsa_bigint(text) from public, anon, authenticated;
revoke all on function public.fmcsa_ymd(text) from public, anon, authenticated;
revoke all on function public.fmcsa_yn(text) from public, anon, authenticated;
revoke all on function public.fmcsa_ident(text) from public, anon, authenticated;
