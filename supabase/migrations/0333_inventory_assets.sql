-- 0333: the half of the shop's inventory that has identities — asset types, assets, the ledger that
-- follows one, and the kit a unit is expected to hold.
--
-- INVENTORY-PLAN.md step I7 (D-INV3, D-INV12, D-INV18, D-INV19, D-INV24, D-INV27). 0331 built the
-- fungible half — a case of oil filters is eleven interchangeable things and the questions are "how
-- many" and "where". This is §2.1's other side: a tablet is A-0412, it is in truck 654 and was in
-- 611 before that, and when it goes missing the question is which one and from where.
--
-- ── TRUCK INVENTORY IS NOT A SECOND FEATURE ─────────────────────────────────────────────────────
-- There is no `truck_inventory` table here and there will not be one. A truck's kit is
-- `inventory_assets` with a VEHICLE as the holder — Snipe-IT's "check out to another asset" — which
-- is why one table serves the tool crib, the trailer and the tractor, and why I9's unit check is
-- I5's count session with a different holder rather than a second walk screen.
--
-- ── THE HOLDER IS A PLACE, NEVER A PERSON (D-INV3) ─────────────────────────────────────────────
-- Three holder columns, all of them equipment or a bay, and no `drivers` foreign key anywhere in
-- this migration. That is a legal position and not a modelling shortcut: deductions for unreturned
-- equipment are a live dispute area in trucking, and a signed handover is an instrument that invites
-- the argument it appears to settle. The driver is shown by INFERENCE from
-- `vehicles.assigned_driver_id` at read time. `asset_movements.actor_driver_id` is TEXT for the
-- same reason plus a second one — an FK there would drag every one of these rows into
-- `merge_driver_v2`'s cascade (0264), which has had to be re-issued eight times.
--
-- ── A HOLDER FOREIGN KEY DOES NOT CARRY THE ORG (IV012) ────────────────────────────────────────
-- ⚠ The third time in this programme that a guarantee assumed to come from a foreign key had to be
-- written out. `stock_locations`, `vehicles` and `trailers` have no `(id, org_id)` unique constraint
-- to point a composite key at, so all six holder references below name `id` ALONE — and a row in
-- org A naming org B's bay satisfies every FK and every CHECK above it. 0332's own matrix found
-- that on `stock_count_sessions`; `inventory_assets` has the same three columns, `asset_movements`
-- has six, and `kit_expectations` has two. So `inventory_holder_is_ours` below is written once and
-- called by all of them, and 0332's inline copy is re-issued to call it too — one spelling of the
-- question, `security definer` with an empty `search_path` on `record_part_movement`'s model,
-- because the answer must be the same for a technician's session and for the service role that
-- bypasses RLS.
--
-- ── ...AND A BEFORE TRIGGER RUNS AHEAD OF THE CHECK CONSTRAINTS ────────────────────────────────
-- The second thing 0332's matrix taught, and it decides the shape of every guard here. A BEFORE
-- trigger fires before the row's CHECKs are evaluated, so a guard that tries to answer "which
-- holder is this" for a malformed row answers about a null and reports the wrong fault. The CHECK
-- constraints own "at most one holder"; the triggers only ever answer "does the named thing belong
-- to us".
--
-- ── WHY THERE IS NO `display_no` COLUMN, AND A `display_seq` INSTEAD ────────────────────────────
-- A deviation from the step's column list, and the reason is the one `tagContract.ts`'s header
-- already states about the tag grammar: a second spelling of an identifier format is a class of bug
-- where a label prints fine and scans to nothing. `A-0412` is produced by `nextDisplayNo` in
-- `@silvicom/shared`, which owns the block-rolling rule that keeps the width fixed past 9999 — and
-- a `display_no text` column would need that same arithmetic written a second time in SQL to fill
-- it. So the database owns the thing only the database can do safely, which is ALLOCATING the
-- number under a lock, and TypeScript owns the format. `display_seq` is that allocation; the DTO
-- derives `displayNo` from it. It also sorts numerically, which is the defect `nextDisplayNo`'s own
-- comment warns about (`A-10000` sorts before `A-9999` in every list and printed sheet).
--
-- ── THE OPENING POSITION IS NOT A MOVEMENT ─────────────────────────────────────────────────────
-- An asset may be created already sitting somewhere, and that placement writes no `asset_movements`
-- row. `rebuild_asset_holders` therefore recomputes the holder only for assets that HAVE a
-- holder-moving movement and leaves the rest alone — exactly the semantics `rebuild_part_stock`
-- already has, where a stock line with no movements is not in its `truth` CTE and is not touched.
-- The alternative, forcing every asset through a `move_asset` call to be placed, makes creation two
-- statements that can half-fail and leaves an asset in the crib that nobody put anywhere.
--
-- ── THE SQLSTATES ──────────────────────────────────────────────────────────────────────────────
-- New here: `IV020 asset_already_held`, `IV021 asset_movements_append_only`, `IV022 tag_code`,
-- `IV023 asset_retired`, and `IV024 unknown_asset`, which the step text did not foresee. Reused
-- from 0331 rather than re-minted, because they name module-wide conditions that `httpStatus.ts`
-- already maps: `IV012` (a holder that is not ours or is closed), `IV014` (a device clock more than
-- a day out), `IV015` (a movement with no id), `IV016` (an identical movement already in flight).
-- The house rule that `countSessions.ts` states is that an `IV0xx` name must be a SQLSTATE some
-- migration actually raises; every code above is raised below.

-- ── the question all three tables ask, asked once ───────────────────────────────────────────────
-- `p_active` is why this takes a flag rather than being three copies: a DESTINATION must be a place
-- that is open for business — `record_part_movement` refuses a movement into a closed bay, so
-- putting a tablet on a shelf that is shut is a placement nobody can act on — while a SOURCE is a
-- record of where the thing actually was, and a bay closing does not un-happen that.
--
-- Returns true for "no holder named", because unassigned is a legitimate holder and the CHECK
-- constraints, not this function, decide whether a row may have none.
create or replace function inventory_holder_is_ours(
  p_org uuid, p_location uuid, p_vehicle uuid, p_trailer uuid, p_active boolean default true
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_location is not null then
    return exists (
      select 1 from public.stock_locations l
       where l.id = p_location and l.org_id = p_org and (l.active or not p_active)
    );
  elsif p_vehicle is not null then
    return exists (select 1 from public.vehicles v where v.id = p_vehicle and v.org_id = p_org);
  elsif p_trailer is not null then
    return exists (select 1 from public.trailers t where t.id = p_trailer and t.org_id = p_org);
  end if;
  return true;
end;
$$;

revoke all on function inventory_holder_is_ours(uuid, uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function inventory_holder_is_ours(uuid, uuid, uuid, uuid, boolean) to service_role;

comment on function inventory_holder_is_ours(uuid, uuid, uuid, uuid, boolean) is
  'Does the named bay, truck or trailer belong to this org (IV012)? The guarantee the holder foreign keys cannot give, because none of those tables carries an (id, org_id) unique constraint.';

-- 0332's guard, re-issued to ask the question in the one place it is now written. Behaviour is
-- unchanged — same conditions, same SQLSTATE, same messages — and `supabase/tests/
-- count-sessions.test.mjs` is what says so, by "a session cannot be opened against another org's
-- bay", "...nor against another org's trailer, which is the same hole in the other holder" and
-- "...nor against a bay that has been closed". A correct applied function is re-issued here rather
-- than left as a second copy because the copy is the thing that goes stale: the next holder rule
-- would have been written in one of the two.
create or replace function guard_stock_count_session_holder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.inventory_holder_is_ours(new.org_id, new.location_id, new.vehicle_id, new.trailer_id, true) then
    if new.location_id is not null then
      raise exception 'stock location % is not this org''s, or is closed', new.location_id
        using errcode = 'IV012';
    elsif new.vehicle_id is not null then
      raise exception 'vehicle % is not this org''s', new.vehicle_id using errcode = 'IV012';
    else
      raise exception 'trailer % is not this org''s', new.trailer_id using errcode = 'IV012';
    end if;
  end if;
  -- A row naming NO holder still falls through deliberately: a BEFORE trigger runs ahead of the
  -- CHECK constraints, and the CHECK is the authority on "exactly one".
  return new;
end;
$$;

-- ── asset types ────────────────────────────────────────────────────────────────────────────────
-- A kind of thing: "tablet", "load bar", "ratchet strap".
--
-- `serialized` is the distinction that decides whether individual identity is worth tracking, and
-- it is a property of the TYPE rather than a setting on the org. A tablet is serialized: which
-- tablet matters, because it has a serial number, a warranty and a repair history. Ratchet straps
-- are not: four straps are four straps, and insisting on a tag per strap is how an inventory
-- discipline gets abandoned in week two. `IV020` below only fires for a serialized type.
--
-- `default_kit_quantity` is what a unit is expected to hold when no explicit expectation row exists,
-- which is what makes A4's "ship empty and let the first check populate it" survivable — the kit
-- screen has an answer on day one without anybody having filled in a matrix.
create table if not exists asset_types (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  name                 text not null check (length(name) between 1 and 120),
  category             text check (length(category) <= 64),
  serialized           boolean not null default true,
  default_kit_quantity integer not null default 0 check (default_kit_quantity >= 0),
  image_path           text check (length(image_path) <= 400),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists idx_asset_types_name on asset_types (org_id, lower(name));

alter table asset_types enable row level security;

drop policy if exists asset_types_select on asset_types;
create policy asset_types_select on asset_types for select
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'view',
    auth_role() = any (array['admin','fleet_manager','technician','auditor','accountant'])));

drop policy if exists asset_types_write on asset_types;
create policy asset_types_write on asset_types for all
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])))
  with check (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])));

-- ── the assets ─────────────────────────────────────────────────────────────────────────────────
-- `tag_code` is null until a label is printed (I10), exactly as `part_stock.tag_code` is. An asset
-- works perfectly well without one — the tag is what makes a scan land on this row, not what makes
-- the row exist — and issuing an id needs randomness plus a uniqueness check against this table,
-- which `tagContract.ts` deliberately does not carry.
--
-- The holder CHECK is `<= 1` and not `= 1`, which is the opposite of `stock_count_sessions`, and
-- the difference is real rather than an oversight: a count session is always ABOUT somewhere, while
-- an asset that has just been unpacked, or has just come off a truck, is genuinely nowhere. Three
-- nulls is the unassigned state the DTO renders as `unassigned`.
--
-- `in_repair` does not clear the holder (D-INV24). A tablet at the repair shop is still unit 654's
-- tablet and is still missing FROM unit 654, which is exactly what a driver doing a kit check needs
-- to be told; modelling repair as "unassigned" would make the truck look correctly equipped while
-- the equipment sat in a box across town.
create table if not exists inventory_assets (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  tag_code             text check (length(tag_code) <= 16),
  -- Allocated by `assign_asset_display_seq` below; `nextDisplayNo` turns it into `A-0412`.
  display_seq          integer not null check (display_seq >= 1),
  asset_type_id        uuid not null references asset_types(id) on delete restrict,
  name                 text not null check (length(name) between 1 and 120),
  serial_number        text check (length(serial_number) <= 64),
  model                text check (length(model) <= 64),
  manufacturer         text check (length(manufacturer) <= 120),
  status               text not null default 'in_service'
    check (status in ('in_service','in_repair','spare','lost','retired')),
  condition            text not null default 'good' check (condition in ('good','worn','damaged')),
  -- All three `restrict`, on 0331's reasoning: a fleet that retires a trailer has not un-equipped
  -- it, and the roster has no hard delete anyway (0235).
  location_id          uuid references stock_locations(id) on delete restrict,
  vehicle_id           uuid references vehicles(id) on delete restrict,
  trailer_id           uuid references trailers(id) on delete restrict,
  purchased_at         date,
  purchase_cost        numeric(12,2) check (purchase_cost >= 0),
  warranty_expires_at  date,
  image_path           text check (length(image_path) <= 400),
  notes                text check (length(notes) <= 2000),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint inventory_assets_one_holder
    check (num_nonnulls(location_id, vehicle_id, trailer_id) <= 1)
);
create unique index if not exists idx_inventory_assets_tag on inventory_assets (org_id, tag_code)
  where tag_code is not null;
create unique index if not exists idx_inventory_assets_display on inventory_assets (org_id, display_seq);
create index if not exists idx_inventory_assets_type on inventory_assets (org_id, asset_type_id);
-- The two questions a kit check asks, one index each: what does this truck hold, what does this
-- trailer hold. Partial, because most assets are held by neither.
create index if not exists idx_inventory_assets_vehicle on inventory_assets (org_id, vehicle_id)
  where vehicle_id is not null;
create index if not exists idx_inventory_assets_trailer on inventory_assets (org_id, trailer_id)
  where trailer_id is not null;
create index if not exists idx_inventory_assets_location on inventory_assets (org_id, location_id)
  where location_id is not null;
create index if not exists idx_inventory_assets_serial on inventory_assets (org_id, serial_number)
  where serial_number is not null;

alter table inventory_assets enable row level security;

drop policy if exists inventory_assets_select on inventory_assets;
create policy inventory_assets_select on inventory_assets for select
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'view',
    auth_role() = any (array['admin','fleet_manager','technician','auditor','accountant'])));

drop policy if exists inventory_assets_write on inventory_assets;
create policy inventory_assets_write on inventory_assets for all
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])))
  with check (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])));

-- ── the display number is allocated here, and formatted nowhere near here ───────────────────────
-- `coalesce(max) + 1` is only safe under a lock, and the lock has to be held by the SAME
-- transaction that does the insert or two concurrent creates read the same maximum and one of them
-- dies on `idx_inventory_assets_display`. A trigger is where that is true for every caller,
-- including a matrix inserting rows directly; an "allocate, then insert" pair of round trips from
-- the service would not be, because the lock would be gone by the time the row was written.
--
-- The number is never reused. An asset that is retired keeps its `A-0412` forever, because a work
-- order from two years ago names it and a label on a shelf still carries it.
create or replace function assign_asset_display_seq()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.display_seq is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory_assets:' || new.org_id::text, 0));
  select coalesce(max(a.display_seq), 0) + 1 into new.display_seq
    from public.inventory_assets a where a.org_id = new.org_id;
  return new;
end;
$$;

drop trigger if exists trg_inventory_assets_display_seq on inventory_assets;
create trigger trg_inventory_assets_display_seq
  before insert on inventory_assets
  for each row
  execute function assign_asset_display_seq();

-- ── the holder must be this org's, and the tag is assigned once (IV012, IV022) ──────────────────
-- `idx_inventory_assets_tag` is the uniqueness GUARANTEE and this trigger is the readable error in
-- front of it: two concurrent inserts of one tag both pass the check here and the loser dies on the
-- index with a bare 23505, which the service maps to the same sentence. Re-checking inside the
-- trigger is not a second source of truth — it is the difference between "that tag is already on
-- A-0007" and "duplicate key value violates unique constraint".
--
-- The immutability half is D-INV18 and is the one that cannot be recovered from: a `tag_code` is
-- printed onto polyester and stuck to a tablet, so reprinting it is how two objects end up
-- answering to one code. Changing or clearing it is refused for everybody, service role included.
create or replace function guard_inventory_asset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.inventory_holder_is_ours(new.org_id, new.location_id, new.vehicle_id, new.trailer_id, true) then
    raise exception 'that bay, truck or trailer is not this org''s, or is closed'
      using errcode = 'IV012';
  end if;

  if tg_op = 'UPDATE' and old.tag_code is not null and new.tag_code is distinct from old.tag_code then
    raise exception 'asset % already carries tag %: a tag is assigned once and never reprinted',
      old.id, old.tag_code using errcode = 'IV022';
  end if;

  if new.tag_code is not null and exists (
    select 1 from public.inventory_assets a
     where a.org_id = new.org_id and a.tag_code = new.tag_code and a.id <> new.id
  ) then
    raise exception 'tag % is already on another asset', new.tag_code using errcode = 'IV022';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_inventory_assets_guard on inventory_assets;
create trigger trg_inventory_assets_guard
  before insert or update on inventory_assets
  for each row
  execute function guard_inventory_asset();

-- ── the movement ledger ────────────────────────────────────────────────────────────────────────
-- Append-only (`IV021`), client-keyed (D-INV27), and six holder columns rather than three because
-- "where was it before" is the question a missing tablet is actually answered with.
--
-- `id` has NO default, exactly as `part_movements.id` has none: the client generates it, so the
-- same UUID arriving twice is the same movement. The unit check that writes these runs on the same
-- phone in the same dead bay as the shelf count that writes those.
--
-- The `reported_*` reasons carry no destination, enforced by CHECK rather than by the RPC alone.
-- A report is a person's claim about a thing, not a move of it (D-INV24), and a row that was both
-- would leave whichever half the RPC honoured as a surprise to the caller who wrote the other.
create table if not exists asset_movements (
  id                uuid primary key,
  org_id            uuid not null references organizations(id) on delete cascade,
  asset_id          uuid not null references inventory_assets(id) on delete restrict,
  reason            text not null check (reason in
    ('assigned','removed','transferred','reported_missing','reported_damaged','found','retired')),
  from_location_id  uuid references stock_locations(id) on delete restrict,
  from_vehicle_id   uuid references vehicles(id) on delete restrict,
  from_trailer_id   uuid references trailers(id) on delete restrict,
  to_location_id    uuid references stock_locations(id) on delete restrict,
  to_vehicle_id     uuid references vehicles(id) on delete restrict,
  to_trailer_id     uuid references trailers(id) on delete restrict,
  condition         text check (condition in ('good','worn','damaged')),
  note              text check (length(note) <= 2000),
  -- Not an FK, on `part_movements.actor_user_id`'s reasoning: auth users live outside this schema's
  -- referential reach and a departed technician must not take the history with them.
  actor_user_id     uuid,
  -- Text and NOT an FK, on purpose — see the header on D-INV3 and `merge_driver_v2`.
  actor_driver_id   text check (length(actor_driver_id) <= 64),
  count_session_id  uuid references stock_count_sessions(id) on delete restrict,
  occurred_at       timestamptz not null,
  received_at       timestamptz not null default now(),
  constraint asset_movements_one_source
    check (num_nonnulls(from_location_id, from_vehicle_id, from_trailer_id) <= 1),
  constraint asset_movements_one_destination
    check (num_nonnulls(to_location_id, to_vehicle_id, to_trailer_id) <= 1),
  constraint asset_movements_report_moves_nothing
    check (reason not in ('reported_missing','reported_damaged')
           or num_nonnulls(to_location_id, to_vehicle_id, to_trailer_id) = 0)
);
create index if not exists idx_asset_movements_asset on asset_movements (org_id, asset_id, occurred_at desc);
create index if not exists idx_asset_movements_recent on asset_movements (org_id, occurred_at desc);
create index if not exists idx_asset_movements_session on asset_movements (org_id, count_session_id)
  where count_session_id is not null;

alter table asset_movements enable row level security;

drop policy if exists asset_movements_select on asset_movements;
create policy asset_movements_select on asset_movements for select
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'view',
    auth_role() = any (array['admin','fleet_manager','technician','auditor','accountant'])));

-- INSERT only, and no UPDATE or DELETE policy at all — belt to the trigger's braces, 0331's shape.
drop policy if exists asset_movements_insert on asset_movements;
create policy asset_movements_insert on asset_movements for insert
  with check (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])));

-- ── append-only, for the role that actually writes (IV021) ──────────────────────────────────────
create or replace function guard_asset_movements_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'asset_movements is append-only: a correction is a new movement'
    using errcode = 'IV021';
end;
$$;

drop trigger if exists trg_asset_movements_append_only on asset_movements;
create trigger trg_asset_movements_append_only
  before update or delete on asset_movements
  for each row
  execute function guard_asset_movements_append_only();

-- ── the holders on a movement must be ours too (IV012) ──────────────────────────────────────────
-- The destination must be open for business; the source is history and only has to be ours. See
-- `inventory_holder_is_ours` for why that asymmetry is a parameter rather than two functions.
create or replace function guard_asset_movement_holders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.inventory_holder_is_ours(
       new.org_id, new.from_location_id, new.from_vehicle_id, new.from_trailer_id, false) then
    raise exception 'the place this movement came from is not this org''s' using errcode = 'IV012';
  end if;
  if not public.inventory_holder_is_ours(
       new.org_id, new.to_location_id, new.to_vehicle_id, new.to_trailer_id, true) then
    raise exception 'the place this movement goes to is not this org''s, or is closed'
      using errcode = 'IV012';
  end if;
  if not exists (select 1 from public.inventory_assets a
                  where a.id = new.asset_id and a.org_id = new.org_id) then
    raise exception 'asset % is not this org''s', new.asset_id using errcode = 'IV024';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_asset_movements_holders on asset_movements;
create trigger trg_asset_movements_holders
  before insert on asset_movements
  for each row
  execute function guard_asset_movement_holders();

-- ── what a unit is expected to hold (D-INV12) ──────────────────────────────────────────────────
-- Two layers and no third: an org-wide default per asset type per unit kind, and per-unit override
-- rows. Held-against-expected is DERIVED by `deriveKitStatus` and stored nowhere, because a stored
-- kit status is a second source of truth that goes stale the moment an asset moves — which is the
-- dual-source defect this repo has already paid for once in CDL and medical expiry.
--
-- `reefer_trailer` is its own kind rather than a flag because a reefer's kit genuinely differs, and
-- because 234 active trailers against 207 tractors makes trailers the majority of the fleet: their
-- kits are the larger error.
create table if not exists kit_expectations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  asset_type_id uuid not null references asset_types(id) on delete cascade,
  unit_kind     text not null check (unit_kind in ('tractor','trailer','reefer_trailer')),
  -- `cascade`, unlike every other unit reference in this migration, and the difference is what the
  -- row MEANS: a movement is evidence that something happened and survives the truck, while an
  -- expectation is a rule about a truck that still exists. A retired trailer's kit rule is noise.
  vehicle_id    uuid references vehicles(id) on delete cascade,
  trailer_id    uuid references trailers(id) on delete cascade,
  quantity      integer not null check (quantity >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint kit_expectations_one_unit
    check (num_nonnulls(vehicle_id, trailer_id) <= 1),
  -- The kind cannot lie about the unit it names: a vehicle override is a tractor's, and a trailer
  -- override is one of the two trailer kinds. 0332's `kind_matches_holder` reasoning.
  constraint kit_expectations_kind_matches_unit
    check ((vehicle_id is null or unit_kind = 'tractor')
       and (trailer_id is null or unit_kind in ('trailer','reefer_trailer')))
);
-- One fleet default per (type, kind), and one override per (type, unit). Three partial unique
-- indexes rather than one, because "no unit" is not a value a unique index can group on.
create unique index if not exists idx_kit_expectations_default
  on kit_expectations (org_id, asset_type_id, unit_kind)
  where vehicle_id is null and trailer_id is null;
create unique index if not exists idx_kit_expectations_vehicle
  on kit_expectations (org_id, asset_type_id, vehicle_id) where vehicle_id is not null;
create unique index if not exists idx_kit_expectations_trailer
  on kit_expectations (org_id, asset_type_id, trailer_id) where trailer_id is not null;

alter table kit_expectations enable row level security;

drop policy if exists kit_expectations_select on kit_expectations;
create policy kit_expectations_select on kit_expectations for select
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'view',
    auth_role() = any (array['admin','fleet_manager','technician','auditor','accountant'])));

drop policy if exists kit_expectations_write on kit_expectations;
create policy kit_expectations_write on kit_expectations for all
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])))
  with check (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])));

create or replace function guard_kit_expectation_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.inventory_holder_is_ours(new.org_id, null, new.vehicle_id, new.trailer_id, true) then
    raise exception 'that truck or trailer is not this org''s' using errcode = 'IV012';
  end if;
  if not exists (select 1 from public.asset_types t
                  where t.id = new.asset_type_id and t.org_id = new.org_id) then
    raise exception 'asset type % is not this org''s', new.asset_type_id using errcode = 'IV012';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_kit_expectations_unit on kit_expectations;
create trigger trg_kit_expectations_unit
  before insert or update on kit_expectations
  for each row
  execute function guard_kit_expectation_unit();

-- ── the one door an asset's holder moves through ───────────────────────────────────────────────
-- `security definer` + `set search_path = ''`, service_role only, on `record_part_movement`'s
-- model. Everything is schema-qualified because the empty search_path means nothing resolves
-- implicitly, which is the point of setting it.
--
-- ── WHY THE HOLDER IS WRITTEN HERE AND NOT BY THE CALLER ───────────────────────────────────────
-- A move is a ledger row AND a holder change, and the two disagreeing is the only failure this
-- design exists to prevent. Doing it from the API would be two round trips with no transaction
-- around them; a network blip between them leaves a tablet whose history says it went into 654 and
-- whose row says it is still in 611.
--
-- ── AND WHY `reported_*` DOES NOT WRITE ONE ────────────────────────────────────────────────────
-- `movesHolder` in `inventoryAssetContract.ts` is the shared spelling of this rule and the CHECK
-- above makes a report-with-a-destination unconstructable; this function is the third place it has
-- to hold, because the holder columns are written here. A driver reporting the fridge missing is
-- making a claim about unit 654's fridge — it is still unit 654's fridge, and it is still missing
-- from it, which is precisely what the next kit check needs to be told.
create or replace function move_asset(p_org uuid, p_actor uuid, p_row jsonb)
returns public.asset_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid := (p_row->>'id')::uuid;
  v_asset     uuid := (p_row->>'assetId')::uuid;
  v_reason    text := p_row->>'reason';
  v_occurred  timestamptz := coalesce((p_row->>'occurredAt')::timestamptz, now());
  v_to_loc    uuid := nullif(p_row->>'toLocationId', '')::uuid;
  v_to_veh    uuid := nullif(p_row->>'toVehicleId', '')::uuid;
  v_to_tr     uuid := nullif(p_row->>'toTrailerId', '')::uuid;
  v_condition text := nullif(p_row->>'condition', '');
  v_moves     boolean;
  v_a         public.inventory_assets;
  v_existing  public.asset_movements;
  v_out       public.asset_movements;
  v_kind      text;
  v_serial    boolean;
  v_expected  integer;
  v_holds     integer;
begin
  if v_id is null then
    raise exception 'a movement needs a client-generated id' using errcode = 'IV015';
  end if;

  -- 1. IDEMPOTENCY BEFORE ANYTHING ELSE (D-INV27). A replay must not re-validate or re-move
  --    anything — it must hand back the row it already produced. It cannot be the second step:
  --    `IV023` would refuse the replay of the very movement that retired the asset.
  select * into v_existing from public.asset_movements m where m.id = v_id and m.org_id = p_org;
  if found then
    return v_existing;
  end if;

  -- 2. The clock, on 0331's window. A phone whose date is wrong files today's kit check under 2019.
  if v_occurred > now() + interval '24 hours' or v_occurred < now() - interval '24 hours' then
    raise exception 'occurred_at % is more than 24 hours from now', v_occurred using errcode = 'IV014';
  end if;

  -- 3. The asset, locked. `for update` because the holder read below and the holder write at the
  --    end must see the same row: two technicians scanning one tablet into two trucks otherwise
  --    both read "in 611" and both write a movement out of it.
  select * into v_a from public.inventory_assets a
   where a.id = v_asset and a.org_id = p_org for update;
  if not found then
    raise exception 'unknown asset %', v_asset using errcode = 'IV024';
  end if;

  -- 4. Retired is terminal (IV023). `lost` is not: an unresolved fact, and the whole point of it is
  --    that the thing may still turn up and be `found`.
  if v_a.status = 'retired' then
    raise exception 'asset % is retired', v_asset using errcode = 'IV023';
  end if;

  v_moves := v_reason not in ('reported_missing', 'reported_damaged');

  -- 5. IV020 — one unit, one of a thing that only comes one to a unit.
  --    Three conditions, and all three are load-bearing. The type must be SERIALIZED, because four
  --    ratchet straps in a truck are four straps and refusing the fourth is how the discipline gets
  --    abandoned. The expectation must be exactly ONE, resolved per-unit first, then the fleet
  --    default for that unit kind, then the type's own default — a truck expected to carry two
  --    tablets may hold two. And the unit must already hold a DIFFERENT asset of that type.
  if v_moves and (v_to_veh is not null or v_to_tr is not null) then
    select t.serialized into v_serial
      from public.asset_types t where t.id = v_a.asset_type_id;

    if v_to_veh is not null then
      v_kind := 'tractor';
    else
      select case when tr.is_reefer then 'reefer_trailer' else 'trailer' end into v_kind
        from public.trailers tr where tr.id = v_to_tr;
    end if;

    if coalesce(v_serial, false) then
      select k.quantity into v_expected
        from public.kit_expectations k
       where k.org_id = p_org and k.asset_type_id = v_a.asset_type_id
         and (k.vehicle_id = v_to_veh or k.trailer_id = v_to_tr);
      if v_expected is null then
        select k.quantity into v_expected
          from public.kit_expectations k
         where k.org_id = p_org and k.asset_type_id = v_a.asset_type_id and k.unit_kind = v_kind
           and k.vehicle_id is null and k.trailer_id is null;
      end if;
      if v_expected is null then
        select t.default_kit_quantity into v_expected
          from public.asset_types t where t.id = v_a.asset_type_id;
      end if;

      if v_expected = 1 then
        select count(*)::integer into v_holds
          from public.inventory_assets a
         where a.org_id = p_org and a.asset_type_id = v_a.asset_type_id and a.id <> v_asset
           and ((v_to_veh is not null and a.vehicle_id = v_to_veh)
             or (v_to_tr  is not null and a.trailer_id = v_to_tr));
        if v_holds > 0 then
          raise exception 'that unit already holds a % and is expected to carry one',
            (select t.name from public.asset_types t where t.id = v_a.asset_type_id)
            using errcode = 'IV020';
        end if;
      end if;
    end if;
  end if;

  -- 6. The ledger row. `from_*` is where the asset stands RIGHT NOW rather than anything the caller
  --    supplied — a caller that had to say where the thing was would eventually say it wrongly, and
  --    the history is the only evidence a missing tablet ever gets.
  insert into public.asset_movements (
    id, org_id, asset_id, reason,
    from_location_id, from_vehicle_id, from_trailer_id,
    to_location_id, to_vehicle_id, to_trailer_id,
    condition, note, actor_user_id, actor_driver_id, count_session_id, occurred_at
  ) values (
    v_id, p_org, v_asset, v_reason,
    v_a.location_id, v_a.vehicle_id, v_a.trailer_id,
    case when v_moves then v_to_loc end,
    case when v_moves then v_to_veh end,
    case when v_moves then v_to_tr  end,
    v_condition, nullif(p_row->>'note', ''), p_actor,
    nullif(p_row->>'actorDriverId', ''), nullif(p_row->>'countSessionId', '')::uuid,
    v_occurred
  )
  on conflict (id) do nothing
  returning * into v_out;

  -- The half of D-INV27 a single-threaded test never reaches, and 0331's words for it: step 1
  -- catches a replay that arrives after the first one committed, which is every replay the offline
  -- queue actually produces. It does not catch two copies in flight at once, because neither
  -- transaction can see the other's uncommitted row. `IV016` is the one error here that means "ask
  -- again", and the API says so rather than reporting a failure for a movement that is about to
  -- exist.
  if v_out is null then
    select * into v_existing from public.asset_movements m where m.id = v_id and m.org_id = p_org;
    if found then
      return v_existing;
    end if;
    raise exception 'movement % is already being recorded', v_id using errcode = 'IV016';
  end if;

  -- 7. The holder, and only what this movement actually decided.
  --    `condition` moves when the movement carries one; `status` moves ONLY for `retired`. Every
  --    other status in the vocabulary — spare, in_repair, lost — is a person's judgement about the
  --    thing rather than a consequence of moving it, and inferring one here would be this schema
  --    deciding that a tablet handed back to the crib is now spare when it is in fact broken.
  update public.inventory_assets a
     set location_id = case when v_moves then (case when v_reason = 'retired' then null else v_to_loc end) else a.location_id end,
         vehicle_id  = case when v_moves then (case when v_reason = 'retired' then null else v_to_veh end) else a.vehicle_id end,
         trailer_id  = case when v_moves then (case when v_reason = 'retired' then null else v_to_tr  end) else a.trailer_id end,
         status      = case when v_reason = 'retired' then 'retired' else a.status end,
         condition   = coalesce(v_condition, a.condition),
         updated_at  = now()
   where a.id = v_asset and a.org_id = p_org;

  return v_out;
end;
$$;

revoke all on function move_asset(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function move_asset(uuid, uuid, jsonb) to service_role;

comment on function move_asset(uuid, uuid, jsonb) is
  'The only writer of an asset''s holder columns (D-INV3). Idempotent on the client-generated movement id (D-INV27); a report does not move anything (D-INV24); IV020 when a unit already holds the one it is expected to carry; IV023 once retired.';

-- ── the holder is rebuildable, which is what makes it a projection ─────────────────────────────
-- If this ever returns a changed row, the ledger and the asset have disagreed and the ledger wins.
--
-- Only assets with a holder-MOVING movement are considered: an asset created already sitting
-- somewhere has an opening position that no ledger row explains, exactly as a `part_stock` line with
-- no movements is absent from `rebuild_part_stock`'s `truth` CTE and is left alone. The ordering is
-- `occurred_at` then `received_at` then `id`, because two movements can share a phone's clock to the
-- millisecond and a tie broken arbitrarily would make this function's answer depend on the plan.
create or replace function rebuild_asset_holders(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  with last_move as (
    select distinct on (m.asset_id)
           m.asset_id, m.to_location_id, m.to_vehicle_id, m.to_trailer_id
      from public.asset_movements m
     where m.org_id = p_org
       and m.reason not in ('reported_missing', 'reported_damaged')
     order by m.asset_id, m.occurred_at desc, m.received_at desc, m.id desc
  )
  update public.inventory_assets a
     set location_id = l.to_location_id,
         vehicle_id  = l.to_vehicle_id,
         trailer_id  = l.to_trailer_id,
         updated_at  = now()
    from last_move l
   where a.org_id = p_org
     and a.id = l.asset_id
     and (a.location_id is distinct from l.to_location_id
       or a.vehicle_id  is distinct from l.to_vehicle_id
       or a.trailer_id  is distinct from l.to_trailer_id);
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function rebuild_asset_holders(uuid) from public, anon, authenticated;
grant execute on function rebuild_asset_holders(uuid) to service_role;

comment on function rebuild_asset_holders(uuid) is
  'Recomputes inventory_assets'' holder columns from the asset_movements ledger. Returns the number of rows it had to change — a non-zero result is a defect report, not a repair.';

comment on table asset_types is
  'A kind of thing (INVENTORY-PLAN.md I7). `serialized` decides whether individual identity is tracked; `default_kit_quantity` is what a unit holds when no expectation row says otherwise.';
comment on table inventory_assets is
  'One thing with an identity (D-INV18). Holder is a bay, a truck or a trailer and never a person (D-INV3); the holder columns are a projection of asset_movements, written only by move_asset.';
comment on table asset_movements is
  'The asset ledger. Append-only (IV021); every row is one move of one asset, or one person''s claim about it (D-INV24).';
comment on table kit_expectations is
  'What a unit is expected to hold (D-INV12). Fleet default per (type, unit kind), overridden per unit; held-against-expected is derived by deriveKitStatus and stored nowhere.';
comment on column inventory_assets.display_seq is
  'The allocation behind A-0412 (D-INV18). The database allocates the number under a lock; `nextDisplayNo` in @silvicom/shared owns the format, so it has exactly one spelling.';
