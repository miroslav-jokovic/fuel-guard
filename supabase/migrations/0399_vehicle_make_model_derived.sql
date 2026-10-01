-- 0399 — a truck's make and model are DERIVED from one catalogue, the reported spelling kept beside
-- them (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md FL1, D-FL1, Q-FL3).
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────────────────────────
-- Measured on production 2026-10-01, org 86d6b3ea. One fleet of two makes and two models is stored
-- under eleven spellings, because every writer stores what its source happened to type:
--   make   FRHT ×122 · FREIGHTLINER ×7 · INTERNATIONAL ×85 · NULL ×58
--   model  CA ×98 · CA126 ×7 · CA126SLP ×8 · PJ126 ×5 · CASCADIA ×10 · LT625 ×79 · LT 625 · lt625 ·
--          LT-625 ×4 · LT62F · NULL ×58
-- and three groups of rows are wrong or empty: 787 says LT625 (a Samsara typo; its VIN `3AKJHHDR…` is a
-- Freightliner with the body code of every Cascadia here), 784–788 carry no model in McLeod at all,
-- and the 51 `ordered` units 814–864 have a VIN and nothing else. A batch key (IE1), a parity check
-- (FL2) or a "trucks" filter (FS2) built on those columns would split one batch into six.
--
-- ── THE RULE (D-FL1) ────────────────────────────────────────────────────────────────────────────
-- The VIN is a physical fact stamped on the frame; a spelling is what somebody typed. So:
--   1. VIN positions 1–8 (manufacturer + body code) name the make AND model when catalogued;
--   2. else VIN positions 1–3 (the manufacturer code) name the make;
--   3. else the reported spelling, keyed with case, spaces and punctuation stripped, is looked up;
--   4. else the reported value is kept as it is — an uncatalogued truck is never blanked, and FL2's
--      parity check is where it gets noticed.
-- What the writer sent is kept in `make_reported` / `model_reported` and never overwritten by the
-- derivation (D-FL1: "McLeod's raw spelling is kept beside it").
--
-- ── WHY A TRIGGER, NOT A FUNCTION EVERY WRITER CALLS ───────────────────────────────────────────
-- Four writers set these columns: the McLeod roster sweep (`rosterFields.vehiclePatch`), the Samsara
-- vehicle sync when no TMS masters the roster, the office form and the CSV import. A TypeScript
-- normaliser would need calling from all four and a copy of its table in SQL for the backfill — a
-- second source of truth with a delay fuse. Here there is ONE table and every write passes through
-- it, including Samsara re-sending `LT625` for 787 (Q-FL3's warning): the VIN wins on every write.
--
-- ── TRIGGER ORDER ───────────────────────────────────────────────────────────────────────────────
-- Postgres fires BEFORE triggers by name. `trg_claim_vehicle_identity` (0241/0242) sorts first, so it
-- still sees what an office user TYPED against the stored value and claims the row exactly as before;
-- this one then derives. A sweep re-sending `FRHT` over the stored `Freightliner` is a service-role
-- write, which the claim trigger exempts, and derives back to the value already stored.
--
-- ── WHAT IS CATALOGUED, AND HOW IT WAS CHECKED ──────────────────────────────────────────────────
-- Only what production contains (2026-10-01). Every McLeod `CA`/`CA126`/`CA126SLP` truck has body code
-- `JHHDR`; the five `PJ126` (764–768, MY 2027, Freightliner's model code for the 2025-on Cascadia) are
-- `JJHDR`; every International is `DZAPR` and every LT625 spelling sits on it. `LT62F` is NOT
-- catalogued as a spelling — nothing confirms what it names — but its one row (752, retired) has a
-- `DZAPR` VIN, so it reads LT625 by rule 1. Dry run against production 2026-10-01: 265 rows derive to
-- exactly two pairs (Freightliner Cascadia 129, International LT625 136); the 7 retired Samsara rows
-- with no VIN, make or model stay empty.
-- A new body code arrives with a new purchase batch; it is one INSERT into this table.
--
-- cross-module-waiver: the only write outside roster is ONE audit_logs row per org recording the
-- backfill, the same audited-data-change pattern 0359 used; no module's data changes shape.

create table public.vehicle_make_model_catalog (
  id        bigint generated always as identity primary key,
  match_on  text not null check (match_on in ('vin_body', 'vin_wmi', 'make_spelling', 'model_spelling')),
  match_key text not null,
  make      text,
  model     text,
  note      text not null,
  unique (match_on, match_key),
  check (
    (match_on = 'vin_body' and make is not null and model is not null)
    or (match_on in ('vin_wmi', 'make_spelling') and make is not null and model is null)
    or (match_on = 'model_spelling' and make is null and model is not null)
  )
);
alter table public.vehicle_make_model_catalog enable row level security;
-- No policies: deny-all to clients on purpose. Nothing outside this trigger reads it.

comment on table public.vehicle_make_model_catalog is
  'D-FL1: the one table vehicles.make/model are derived from (VIN body code > VIN manufacturer > reported spelling). 0399.';

insert into public.vehicle_make_model_catalog (match_on, match_key, make, model, note) values
  ('vin_body', '3AKJHHDR', 'Freightliner',  'Cascadia', 'every McLeod CA/CA126/CA126SLP tractor; 784-788 (Q-FL3)'),
  ('vin_body', '3AKJJHDR', 'Freightliner',  'Cascadia', '764-768, McLeod PJ126 (2025-on Cascadia), MY 2027'),
  ('vin_body', '3HSDZAPR', 'International', 'LT625',    'every International here; LT625 / LT 625 / lt625 / LT-625 in McLeod'),
  ('vin_wmi',  '3AK',      'Freightliner',  null,       'Freightliner (Daimler Truck, Mexico)'),
  ('vin_wmi',  '3HS',      'International', null,       'International (Navistar, Mexico)'),
  ('make_spelling', 'FRHT',          'Freightliner',  null, 'McLeod'),
  ('make_spelling', 'FREIGHTLINER',  'Freightliner',  null, 'Samsara'),
  ('make_spelling', 'INTERNATIONAL', 'International', null, 'McLeod, Samsara'),
  ('make_spelling', 'INTL',          'International', null, 'common abbreviation'),
  ('model_spelling', 'CA',                       null, 'Cascadia', 'McLeod'),
  ('model_spelling', 'CA126',                    null, 'Cascadia', 'McLeod 672-678'),
  ('model_spelling', 'CA126SLP',                 null, 'Cascadia', 'McLeod 664-671'),
  ('model_spelling', 'PJ126',                    null, 'Cascadia', 'McLeod 764-768'),
  ('model_spelling', 'CASCADIA',                 null, 'Cascadia', 'Samsara'),
  ('model_spelling', 'NEWCASCADIA126SLEEPERCAB', null, 'Cascadia', 'Samsara'),
  ('model_spelling', 'LT625',                    null, 'LT625',    'McLeod LT625 / LT 625 / lt625 / LT-625, Samsara');

alter table public.vehicles add column make_reported text;
alter table public.vehicles add column model_reported text;
comment on column public.vehicles.make_reported is
  'D-FL1: make exactly as the last writer sent it (McLeod, Samsara, office). vehicles.make is derived from it and the VIN.';
comment on column public.vehicles.model_reported is
  'D-FL1: model exactly as the last writer sent it. vehicles.model is derived from it and the VIN.';

-- Case, spaces and punctuation are not information: `LT 625`, `lt625` and `LT-625` are one key.
create function public.vehicle_catalog_key(p text) returns text
language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

create function public.derive_vehicle_make_model() returns trigger
language plpgsql as $$
declare
  vin_key text := public.vehicle_catalog_key(new.vin);
  c public.vehicle_make_model_catalog;
begin
  -- A write that changed make or model REPORTED a value; a write that left it alone did not, and the
  -- stored report stands. (An UPDATE that sets the column to what is already stored — the office form
  -- re-saving `Freightliner` — is not a new report either.)
  if tg_op = 'INSERT' or new.make is distinct from old.make then
    new.make_reported := new.make;
  end if;
  if tg_op = 'INSERT' or new.model is distinct from old.model then
    new.model_reported := new.model;
  end if;

  select * into c from public.vehicle_make_model_catalog
   where match_on = 'vin_body' and match_key = left(vin_key, 8) and length(vin_key) >= 8;
  if found then
    new.make := c.make;
    new.model := c.model;
    return new;
  end if;

  new.make := coalesce(
    (select make from public.vehicle_make_model_catalog
      where match_on = 'vin_wmi' and match_key = left(vin_key, 3)),
    (select make from public.vehicle_make_model_catalog
      where match_on = 'make_spelling' and match_key = public.vehicle_catalog_key(new.make_reported)),
    nullif(btrim(new.make_reported), ''));
  new.model := coalesce(
    (select model from public.vehicle_make_model_catalog
      where match_on = 'model_spelling' and match_key = public.vehicle_catalog_key(new.model_reported)),
    nullif(btrim(new.model_reported), ''));
  return new;
end
$$;

create trigger trg_vehicle_make_model_derived
  before insert or update of vin, make, model on public.vehicles
  for each row execute function public.derive_vehicle_make_model();

-- ── Backfill ────────────────────────────────────────────────────────────────────────────────────
-- First record what is stored as the report (this UPDATE names neither make, model nor vin, so the
-- trigger does not fire), then touch make so it fires on every row and derives from that report.
-- No JWT is present, so the claim trigger exempts both statements and no row changes owner.
do $backfill$
declare
  org record;
begin
  update public.vehicles set make_reported = make, model_reported = model;
  update public.vehicles set make = make;
  for org in
    select org_id,
           count(*) filter (where make is distinct from make_reported or model is distinct from model_reported) as n,
           count(*) as total
      from public.vehicles group by org_id
  loop
    if org.n > 0 then
      insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
      values (org.org_id, null, 'roster.vehicle_make_model_derived', 'vehicles', null, jsonb_build_object(
        'rows_now_differing_from_report', org.n,
        'rows', org.total,
        'reason', 'make/model derived from VIN body code, VIN manufacturer, then reported spelling (D-FL1)',
        'migration', '0399',
        'plan', 'FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md FL1'));
    end if;
  end loop;
end
$backfill$;
