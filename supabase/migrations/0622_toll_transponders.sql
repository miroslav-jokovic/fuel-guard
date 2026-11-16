-- 0622 — toll transponders, and which truck carried each one when (TOLLS-PER-TRUCK-PLAN.md TL1,
-- D-TL1..D-TL4). The first step of TRUCK-COST-ATTRIBUTION-PLAN.md's T4, unblocked by the owner's
-- 2026-11-16 answer to R3: the fleet's toll accounts are E-ZPass, K-TAG and ExpressToll, none of them
-- has an API, and each sends a weekly statement that lists every charge by transponder.
--
-- ── WHY A HISTORY, NOT A `transponder` COLUMN ON `vehicles` ──────────────────────────────────
-- A statement is uploaded a week (or a month) after the miles were driven, and tags move between
-- trucks: a truck goes to the shop, its tag goes to the spare; a truck is sold, its tag goes in the
-- drawer. A column holds only TODAY's truck, so every upload would charge last week's Ohio turnpike to
-- whichever truck holds the tag now — the exact improvisation the attribution plan forbids. So a
-- toll is attributed by the assignment that was in force WHEN IT WAS DRIVEN, and that needs dated
-- rows. `vehicles` is also written by the Samsara and McLeod syncs (0531's reasoning for `unit_tags`):
-- a fact the office types does not belong on a row the feeds own.
--
-- ── NOTHING ON THE TOLL ROW SAYS WHICH TRUCK ─────────────────────────────────────────────────
-- Attribution is derived at read time from these rows (D-TL3), never copied onto a toll line. A wrong
-- assignment is corrected by VOIDING it (`void_toll_transponder_assignment`, with a reason) and
-- entering the right one, and every toll it touched re-attributes by itself. A stored truck id would
-- need a re-stamping job nobody would remember to run — a copy is a workaround with a delay fuse.
--
-- ── NEVER OVERLAPPING, NEVER EDITED ──────────────────────────────────────────────────────────
-- A tag on two trucks at once would charge one toll twice; the guard refuses it (TL001), serialised
-- by a row lock on the transponder so two simultaneous moves cannot both pass. Rows are not edited:
-- the only changes are CLOSING an open row (valid_to null → a time) and VOIDING one (TL002). Moving a
-- tag is one function — close the old row and open the new one in the same transaction — because two
-- API writes would leave the tag on no truck when the second fails.
--
-- `vehicle_id` only, no trailer: a toll tag is classed by the tractor's axles and rides in its cab.
-- RLS on, no client policy: the API reads and writes with the service role and org-filters itself.
-- Measured 2026-11-16 (production `mcleod_gl_totals`, 40790000 + 40790002, AP): Jan 45,687.33,
-- Feb 38,969.04, Mar 39,508.49, Apr 56,175.74, May 112,193.74, Jun 72,928.44, Jul 62,615.96 — 25–56
-- lines a month. No rows to backfill: the office registers its tags (TL2).

create table if not exists toll_transponders (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  -- PrePass is NOT here: owner 2026-11-16, it is weigh-station bypass, not tolls, and McLeod already
  -- carries it. A new provider is a migration plus a statement reader, never a free-text value.
  provider        text not null check (provider in ('ezpass', 'ktag', 'expresstoll')),
  -- As printed on the tag, upper-cased with separators removed by the API (`normaliseTagNumber`).
  -- Matching uses `tollTagKey`, which also drops leading zeros — see tollTags.ts for why.
  tag_number      text not null check (tag_number ~ '^[0-9A-Z]{4,24}$'),
  -- E-ZPass is issued by one of ~40 agencies (NJ, PA, NY, IL I-PASS…) whose statements differ.
  issuer          text check (length(issuer) between 1 and 64),
  note            text check (length(note) <= 500),
  retired_at      timestamptz,
  retired_reason  text check (retired_reason in ('lost', 'returned', 'damaged', 'replaced')),
  created_at      timestamptz not null default now(),
  created_by      uuid,
  constraint toll_transponders_retired_pair check ((retired_at is null) = (retired_reason is null))
);

alter table toll_transponders enable row level security;

create unique index if not exists idx_toll_transponders_tag on toll_transponders (org_id, provider, tag_number);

create table if not exists toll_transponder_assignments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  transponder_id  uuid not null references toll_transponders(id) on delete restrict,
  -- `restrict`: vehicles are never deleted (0235), and a sold truck's tolls must still name it.
  vehicle_id      uuid not null references vehicles(id) on delete restrict,
  valid_from      timestamptz not null,
  valid_to        timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  voided_at       timestamptz,
  voided_by       uuid,
  void_reason     text check (length(void_reason) between 1 and 500),
  constraint toll_assignments_forward check (valid_to is null or valid_to > valid_from),
  constraint toll_assignments_void_pair check ((voided_at is null) = (void_reason is null))
);

alter table toll_transponder_assignments enable row level security;

create index if not exists idx_toll_assignments_transponder on toll_transponder_assignments (transponder_id, valid_from);
create index if not exists idx_toll_assignments_vehicle on toll_transponder_assignments (org_id, vehicle_id);
-- At most one OPEN row per tag. The overlap guard below covers the closed history too; this index is
-- the cheap answer to "where is this tag now?".
create unique index if not exists idx_toll_assignments_open on toll_transponder_assignments (transponder_id)
  where valid_to is null and voided_at is null;

create or replace function guard_toll_transponder_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tag public.toll_transponders%rowtype;
begin
  if tg_op = 'UPDATE' then
    if old.voided_at is not null then
      raise exception 'a voided assignment is history and is not changed' using errcode = 'TL002';
    end if;
    -- The two permitted changes, each touching only its own columns.
    if (new.org_id, new.transponder_id, new.vehicle_id, new.valid_from, new.created_at, new.created_by)
       is distinct from
       (old.org_id, old.transponder_id, old.vehicle_id, old.valid_from, old.created_at, old.created_by)
       or (old.valid_to is not null and new.valid_to is distinct from old.valid_to)
    then
      raise exception 'an assignment is closed or voided, never edited: void it and enter the right one'
        using errcode = 'TL002';
    end if;
    if new.voided_at is not null then
      return new; -- voiding removes the row from every overlap question; nothing more to check
    end if;
  end if;

  -- A backwards row is `toll_assignments_forward`'s to refuse (23514); building a range from it here
  -- would raise 22000 first and hide which rule it broke.
  if new.valid_to is not null and new.valid_to <= new.valid_from then
    return new;
  end if;

  -- Serialise every write for this tag, then check it against the tag's whole history.
  select * into v_tag from public.toll_transponders t where t.id = new.transponder_id for update;
  if v_tag.org_id is distinct from new.org_id
     or not exists (select 1 from public.vehicles v where v.id = new.vehicle_id and v.org_id = new.org_id)
  then
    raise exception 'transponder % or vehicle % is not this org''s', new.transponder_id, new.vehicle_id
      using errcode = 'TL003';
  end if;
  if tg_op = 'INSERT' and v_tag.retired_at is not null and new.valid_from >= v_tag.retired_at then
    raise exception 'transponder % was retired at %', v_tag.tag_number, v_tag.retired_at using errcode = 'TL004';
  end if;
  if exists (
    select 1 from public.toll_transponder_assignments a
    where a.transponder_id = new.transponder_id
      and a.id <> new.id
      and a.voided_at is null
      and tstzrange(a.valid_from, a.valid_to) && tstzrange(new.valid_from, new.valid_to)
  ) then
    raise exception 'transponder % is already on a truck for part of that time', v_tag.tag_number
      using errcode = 'TL001';
  end if;
  return new;
end;
$$;

revoke all on function guard_toll_transponder_assignment() from public, anon, authenticated;

drop trigger if exists trg_toll_assignments_guard on toll_transponder_assignments;
create trigger trg_toll_assignments_guard
  before insert or update on toll_transponder_assignments
  for each row execute function guard_toll_transponder_assignment();

-- ── the writers ───────────────────────────────────────────────────────────────────────────────
-- Three functions, each one transaction. The API (`modules/tolls/transponders.ts`) calls only these.

-- Register a tag, optionally already on a truck from `p_at`. A tag already registered raises 23505,
-- which the API answers with the existing row rather than a second one.
create or replace function register_toll_transponder(
  p_org_id uuid, p_provider text, p_tag_number text, p_issuer text, p_note text,
  p_vehicle_id uuid, p_at timestamptz, p_actor uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.toll_transponders (org_id, provider, tag_number, issuer, note, created_by)
  values (p_org_id, p_provider, p_tag_number, p_issuer, p_note, p_actor)
  returning id into v_id;
  if p_vehicle_id is not null then
    insert into public.toll_transponder_assignments (org_id, transponder_id, vehicle_id, valid_from, created_by)
    values (p_org_id, v_id, p_vehicle_id, p_at, p_actor);
  end if;
  return v_id;
end;
$$;

-- Put a tag on a truck from `p_at`, or take it off (`p_vehicle_id` null). The open row closes at
-- `p_at`; a move dated at or before the open row's own start is refused (TL005) — that is a wrong
-- entry, and the honest fix is to void it, not to slide history under it. Moving a tag to the truck
-- it is already on is a no-op returning that row, so a double-click changes nothing.
create or replace function move_toll_transponder(
  p_org_id uuid, p_transponder_id uuid, p_vehicle_id uuid, p_at timestamptz, p_actor uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tag public.toll_transponders%rowtype;
  v_open public.toll_transponder_assignments%rowtype;
  v_id uuid;
begin
  select * into v_tag from public.toll_transponders t
  where t.id = p_transponder_id and t.org_id = p_org_id for update;
  if not found then
    raise exception 'transponder % is not this org''s', p_transponder_id using errcode = 'TL003';
  end if;
  if v_tag.retired_at is not null then
    raise exception 'transponder % was retired at %', v_tag.tag_number, v_tag.retired_at using errcode = 'TL004';
  end if;

  select * into v_open from public.toll_transponder_assignments a
  where a.transponder_id = p_transponder_id and a.valid_to is null and a.voided_at is null;
  if found then
    if v_open.vehicle_id = p_vehicle_id then
      return v_open.id;
    end if;
    if p_at <= v_open.valid_from then
      raise exception 'that move is dated before the tag''s current truck got it (%)', v_open.valid_from
        using errcode = 'TL005';
    end if;
    update public.toll_transponder_assignments set valid_to = p_at where id = v_open.id;
  end if;

  if p_vehicle_id is null then
    return null;
  end if;
  insert into public.toll_transponder_assignments (org_id, transponder_id, vehicle_id, valid_from, created_by)
  values (p_org_id, p_transponder_id, p_vehicle_id, p_at, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- Retire a lost, returned, damaged or replaced tag: its open row closes at `p_at`, and nothing can be
-- assigned after it. A toll that still arrives on it afterwards is exactly what the office must see.
create or replace function retire_toll_transponder(
  p_org_id uuid, p_transponder_id uuid, p_at timestamptz, p_reason text, p_actor uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform public.move_toll_transponder(p_org_id, p_transponder_id, null, p_at, p_actor);
  update public.toll_transponders set retired_at = p_at, retired_reason = p_reason
  where id = p_transponder_id and org_id = p_org_id;
end;
$$;

-- Void a wrong assignment. History stays readable (who, when, why); attribution stops using it.
create or replace function void_toll_transponder_assignment(
  p_org_id uuid, p_assignment_id uuid, p_reason text, p_actor uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.toll_transponder_assignments
  set voided_at = now(), voided_by = p_actor, void_reason = p_reason
  where id = p_assignment_id and org_id = p_org_id and voided_at is null;
  if not found then
    raise exception 'assignment % is not this org''s, or is already voided', p_assignment_id using errcode = 'TL003';
  end if;
end;
$$;

revoke all on function register_toll_transponder(uuid, text, text, text, text, uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function move_toll_transponder(uuid, uuid, uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function retire_toll_transponder(uuid, uuid, timestamptz, text, uuid) from public, anon, authenticated;
revoke all on function void_toll_transponder_assignment(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function register_toll_transponder(uuid, text, text, text, text, uuid, timestamptz, uuid) to service_role;
grant execute on function move_toll_transponder(uuid, uuid, uuid, timestamptz, uuid) to service_role;
grant execute on function retire_toll_transponder(uuid, uuid, timestamptz, text, uuid) to service_role;
grant execute on function void_toll_transponder_assignment(uuid, uuid, text, uuid) to service_role;

comment on table toll_transponders is
  'A toll tag (E-ZPass, K-TAG, ExpressToll) the fleet holds (0622, TOLLS-PER-TRUCK-PLAN TL1). Which truck carried it is toll_transponder_assignments, never a column here or on vehicles.';
comment on table toll_transponder_assignments is
  'Which truck carried a toll tag, and when (0622, D-TL1..D-TL4). Never overlapping (TL001), never edited (TL002): closed by a move, corrected by voiding. Tolls are attributed from these rows at read time.';
