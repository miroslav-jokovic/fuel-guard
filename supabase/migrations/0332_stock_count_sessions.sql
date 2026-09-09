-- 0332: a count session — one walk of one place.
--
-- INVENTORY-PLAN.md step I5, PR 1 (D-INV19, D-INV20, D-INV21). `part_movements.count_session_id`
-- has existed since 0331 as a nullable, unconstrained column, because a column and its first reader
-- ship in two merges and a table that does not exist cannot be referenced by one that does. This
-- migration creates the table and closes that reference.
--
-- ── ONE SESSION SHAPE FOR THE SHELF AND FOR THE TRUCK (D-INV19) ─────────────────────────────────
-- A shelf count (I5) and a unit kit check (I9) are the same activity against different holders:
-- walk a place, say what is actually there, and get a variance at the end. Two tables would mean
-- two review screens, and two review screens drift — one grows a "recount" badge and the other does
-- not, and neither author ever sees the difference.
--
-- ── A SESSION IS ABOUT ONE PLACE, NOT A PARALLEL REGISTRY ───────────────────────────────────────
-- Exactly one of `location_id` / `vehicle_id` / `trailer_id` is set, enforced by `num_nonnulls` —
-- the shape `0092:137` used for a cargo tank that belongs to either a trailer or a straight truck.
-- And `0153:1-7` is why the constraint matters more than it looks: `hazmat_cargo_tank_profiles` was
-- a 1:1 child table with its own page, API, service and picker — a parallel equipment registry for
-- what was simply a property of the trailer — and it was dropped after the audit found the picker
-- offered dry vans and nothing read the data. A session row that could name two holders, or none,
-- is that table's first step: it stops being "this walk of this bay" and becomes a registry of
-- counting, which somebody then has to keep in step with the places themselves.
--
-- ── THERE IS DELIBERATELY NO "ONE OPEN SESSION PER PLACE" UNIQUE INDEX ──────────────────────────
-- The obvious safeguard, and it is not taken, because the two failures it trades between are not
-- symmetric.
--
-- Two overlapping sessions on one bay cannot corrupt anything: `record_part_movement` takes a
-- count's delta AT COMMIT TIME against the row it locked, so the second session's count lands
-- against whatever the first one left, exactly as a receipt landing mid-count does. That is pinned
-- in `supabase/tests/inventory-stock.test.mjs` by "a count records its variance as the delta" and
-- "...and the shelf is the counted figure, taken against the receipt". The cost of overlap is a
-- confusing review screen, not a wrong shelf.
--
-- A unique index costs something worse: one session left open — a technician who walked away, a
-- phone that died — locks that bay out of ever being counted again, and the only way out is a
-- database edit. Closing is irreversible by design (below), so there is no "reopen and abandon"
-- escape either. A confusing review beats a bay nobody can count.
--
-- ── CLOSING IS IRREVERSIBLE, AND THE DATABASE IS WHERE THAT IS TRUE ─────────────────────────────
-- The review screen says so, but a screen saying so is a convention. A closed session's variances
-- are what the shop acted on — what was ordered, what was written off — and reopening one to "fix"
-- a number would rewrite the reason those things happened. Corrections are a new count, which is a
-- new session and new `counted` rows, the same way a correction to the ledger is a new movement.
--
-- ── WHAT IS NOT HERE ───────────────────────────────────────────────────────────────────────────
-- No per-entry table. A count entry IS a `counted` movement carrying this session's id (D-INV19),
-- which is why the ledger's variance and the review screen's variance cannot disagree — there is
-- one number and one row. And no `expected_quantity` snapshot: the expected figure is the shelf at
-- the moment the technician types, not at the moment the session opened, or a delivery received
-- mid-count would be reported as a shortage.

create table if not exists stock_count_sessions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  kind        text not null check (kind in ('location', 'unit')),
  -- `restrict` on all three: a session is evidence of a walk that happened, and a fleet that retires
  -- a trailer has not un-counted it. The roster has no hard delete anyway (0235).
  location_id uuid references stock_locations(id) on delete restrict,
  vehicle_id  uuid references vehicles(id) on delete restrict,
  trailer_id  uuid references trailers(id) on delete restrict,
  -- Not an FK: `actor_user_id` on `part_movements` is not one either, and for the same reason —
  -- auth users live outside this schema's referential reach and a departed counter must not take
  -- their session with them.
  started_by  uuid,
  -- D-INV20: counts are blind by DEFAULT, and the mode is recorded on the row rather than inferred,
  -- because "was the expected figure on screen when this was typed" is the first question anybody
  -- asks about a variance they do not believe.
  blind       boolean not null default true,
  status      text not null default 'open' check (status in ('open', 'closed')),
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  note        text check (length(note) <= 2000),
  -- 0092:137's shape. Exactly one holder — see the header for why "at least one" is the failure.
  constraint stock_count_sessions_one_holder
    check (num_nonnulls(location_id, vehicle_id, trailer_id) = 1),
  -- …and `kind` agrees with which one it is, so the discriminator cannot lie about the row it is on.
  constraint stock_count_sessions_kind_matches_holder
    check ((kind = 'location') = (location_id is not null)),
  -- A closed session has a closing time and an open one has none. Two columns saying one thing is
  -- how "closed with no closed_at" gets into a report as a session that never ended.
  constraint stock_count_sessions_closed_has_time
    check ((status = 'closed') = (closed_at is not null))
);

create index if not exists idx_stock_count_sessions_org on stock_count_sessions (org_id, opened_at desc);
-- The screen that matters is "is there a count open on this bay right now", asked on arrival.
create index if not exists idx_stock_count_sessions_open on stock_count_sessions (org_id, status, kind)
  where status = 'open';

-- ── the reference 0331 left open ───────────────────────────────────────────────────────────────
-- `restrict`: the session is what a `counted` row means. A ledger row pointing at a session that
-- was deleted is a variance with no walk behind it.
alter table part_movements drop constraint if exists part_movements_count_session_fk;
alter table part_movements
  add constraint part_movements_count_session_fk
  foreign key (count_session_id) references stock_count_sessions(id) on delete restrict;

alter table stock_count_sessions enable row level security;

-- Same section gates as the ledger it belongs to (0331): view to read, manage to open one.
drop policy if exists stock_count_sessions_select on stock_count_sessions;
create policy stock_count_sessions_select on stock_count_sessions for select
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'view',
    auth_role() = any (array['admin','fleet_manager','technician','auditor','accountant'])));

drop policy if exists stock_count_sessions_insert on stock_count_sessions;
create policy stock_count_sessions_insert on stock_count_sessions for insert
  with check (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])));

-- UPDATE is granted because closing a session IS an update — and the trigger below is what makes
-- that the only update anybody can make. There is no DELETE policy: a walk that happened happened.
drop policy if exists stock_count_sessions_update on stock_count_sessions;
create policy stock_count_sessions_update on stock_count_sessions for update
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])))
  with check (org_id = auth_org_id());

-- ── closing is one-way, for everybody, service role included (IV017) ────────────────────────────
-- 0331's `guard_part_movements_append_only` shape and the same reasoning: the API holds the service
-- key and bypasses RLS, so a policy alone would leave this editable by the one caller that matters.
--
-- What is allowed is exactly the close: `open` → `closed`. Everything else about a session is fixed
-- once it exists — which place it was about, who started it, and whether it was blind, because a
-- variance is only readable against the conditions it was recorded under.
create or replace function guard_stock_count_session_close()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'closed' then
    raise exception 'count session % is closed: a correction is a new count', old.id
      using errcode = 'IV017';
  end if;
  if new.org_id <> old.org_id
     or new.kind <> old.kind
     or new.location_id is distinct from old.location_id
     or new.vehicle_id is distinct from old.vehicle_id
     or new.trailer_id is distinct from old.trailer_id
     or new.blind <> old.blind
     or new.opened_at <> old.opened_at then
    raise exception 'a count session records the walk it was: only its status, note and closing time may change'
      using errcode = 'IV017';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stock_count_sessions_close_once on stock_count_sessions;
create trigger trg_stock_count_sessions_close_once
  before update on stock_count_sessions
  for each row
  execute function guard_stock_count_session_close();

-- ── the holder must be THIS org's, and no foreign key can say so (IV012) ───────────────────────
-- ⚠ Found by this migration's own matrix, not by review. The three holder FKs reference `id` alone,
-- because `stock_locations`, `vehicles` and `trailers` have no `(id, org_id)` unique constraint to
-- point a composite key at — so a row in org A naming org B's bay satisfies every FK and every
-- CHECK above it. `part_movements` has exactly the same shape and is saved by `record_part_movement`
-- checking the location's org in SQL (`IV012`); a session has no RPC in front of it, so without this
-- the API — which holds the service key and bypasses RLS — could open a walk of somebody else's bay.
--
-- `security definer` with an empty `search_path`, on `record_part_movement`'s model: the check must
-- be the same for a technician's session and for the service role, and it is asking a question about
-- ownership rather than granting access to an answer.
--
-- A location must also be ACTIVE. Not tidiness: `record_part_movement` refuses a movement into a
-- closed location, so a session opened on one is a walk where every count would be rejected — a
-- screen that lets you start it is a screen that wastes somebody's afternoon. Units are checked for
-- org only; what makes a truck countable is I9's question, not this migration's.
create or replace function guard_stock_count_session_holder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if new.location_id is not null then
    select exists (
      select 1 from public.stock_locations
      where id = new.location_id and org_id = new.org_id and active
    ) into v_ok;
    if not v_ok then
      raise exception 'stock location % is not this org''s, or is closed', new.location_id
        using errcode = 'IV012';
    end if;
  elsif new.vehicle_id is not null then
    select exists (
      select 1 from public.vehicles where id = new.vehicle_id and org_id = new.org_id
    ) into v_ok;
    if not v_ok then
      raise exception 'vehicle % is not this org''s', new.vehicle_id using errcode = 'IV012';
    end if;
  elsif new.trailer_id is not null then
    select exists (
      select 1 from public.trailers where id = new.trailer_id and org_id = new.org_id
    ) into v_ok;
    if not v_ok then
      raise exception 'trailer % is not this org''s', new.trailer_id using errcode = 'IV012';
    end if;
  end if;
  -- A row naming NO holder falls through deliberately. A BEFORE trigger runs ahead of the CHECK
  -- constraints, so an `else` branch here would answer "is this null trailer ours" — and report
  -- `IV012` for a row whose actual fault is that it names no place at all. The CHECK is the
  -- authority on "exactly one"; this trigger only answers "does the named thing belong to us".
  return new;
end;
$$;

drop trigger if exists trg_stock_count_sessions_holder on stock_count_sessions;
create trigger trg_stock_count_sessions_holder
  before insert on stock_count_sessions
  for each row
  execute function guard_stock_count_session_holder();

comment on table stock_count_sessions is
  'One walk of one place (D-INV19) — a shelf count (I5) or a unit kit check (I9). Entries are counted movements carrying this id; closing is irreversible (IV017).';
comment on column stock_count_sessions.blind is
  'D-INV20: the expected figure was hidden while this count was typed. Recorded, not inferred — it is the first question asked about a variance nobody believes.';
