-- 0596 — unit notes v3: the author edits and removes a note, a holder of "Edit and remove anyone's note"
-- does both for every note, and a note that names a truck, trailer or driver (`@848`) shows on that unit's
-- Dispatch Board row until somebody resolves it (docs/plans/notes/UNIT-NOTES-PLAN.md §8, D-UN15..D-UN19).
--
-- ── WHAT CHANGED, AND WHO RULED IT ───────────────────────────────────────────────────────────────
-- 0592 made a note permanent (D-UN3) and left removal out (D-UN5: "we will see how it works and add it
-- later"). The owner ruled on 2026-11-12, a day after the office started writing: an author edits and
-- removes their own note, with no time limit, and an admin — or a role the admin switches on — edits and
-- removes anybody's (D-UN15, D-UN16). This migration is that ruling's database half. Who may act is the
-- api's named permission (`notes.manage_all`, packages/shared rolePermissions.ts); the functions below
-- take the api's answer as `p_any` and still refuse a stranger's note when it is false (UN025), so a
-- caller that forgot to ask the permission fails closed.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- · **An edit keeps the old words (D-UN15).** Office chat's rule (0511, D-CHAT13): a BEFORE UPDATE trigger
--   copies the previous body into `unit_note_versions`, so no code path, the service role included, can
--   change a note without leaving what it said. The row says `edited_at`; the versions are read by nobody in
--   this release (owner, Q-UN7 (a)) — they are the answer when somebody asks "what did it say before".
-- · **A removal hides, it does not delete (D-UN16).** `deleted_at` / `deleted_by` / `deleted_by_name`, set
--   once and never cleared (UN022). The note leaves every list, count, search, pin and board chip; the row and
--   its words stay, as chat's retraction does. DELETE is still refused (UN010) — notes are not evidence, but
--   a removed sentence about a person is exactly what somebody later asks to see.
-- · **Only the two functions change words or remove (UN011).** `edit_unit_note` and `remove_unit_note` set
--   `fuelguard.unit_note_act` for their own transaction, the way 0264's merge sets
--   `fuelguard.merging_driver`; a raw UPDATE of `body` or `deleted_at` without it is refused, so every
--   change carries its actor into the version row.
-- · **Mentions follow the words.** An edit re-derives both mention sets from the difference between the old
--   and the new body: a token added is checked (UN015 people, UN016 units) and indexed; a token taken out is
--   dropped. Only what the edit ADDS is checked — chat's rule (0521): somebody named before they left the
--   office stays named, and an edit to the rest of the note must not fail on them.
-- · **Units are named by token (D-UN17).** `<#vehicle:uuid>`, `<#trailer:uuid>`, `<#driver:uuid>` — the
--   people token's shape (`<@uuid>`, D-CHAT22) with its kind, so a label that changes (a renumbered truck, a
--   married name) never breaks the link. `unit_note_unit_mentions` is derived by trigger as
--   `unit_note_mentions` is, and carries the board's own state: `resolved_at` / `resolved_by` (D-UN18).
--   The unit must be this carrier's and a driver not an applicant (UN016), the insert guard's own test.
-- · **The board reads ONE value (M12).** `unit_note_open_unit_mentions` returns
--   `{ kind: { subject_id: [ up to 5 newest open mentions ] } }`, only unresolved mentions on notes not
--   removed — never rows and never an id list.
-- · **The driver merge moves a driver's mentions** (`DRIVER_REASSIGNMENTS` gains the line in this PR): a
--   mention row's `subject_id` moves only for kind `driver` and only to a driver of the carrier (UN012, the
--   notes' own rule); a note that named BOTH drivers keeps one row, the duplicate is skipped and the
--   leftover is cleared when the merged-away driver is deleted. The note's words keep the old token — a
--   note is the author's sentence, the merge does not rewrite it — and the screen reads such a token as
--   "a driver" (the drawer's lookup is by the mention rows, which moved).
--
-- ── DEPLOY WINDOW ────────────────────────────────────────────────────────────────────────────────
-- New columns on `unit_notes` and their first api reader ship in the NEXT merge (`lint:migration-ordering`).
-- Old code over this schema: it never names the new columns; `unit_notes_search` returns two more columns
-- (`edited_at`, `unit_mentions`) the old mapper ignores, and removed notes simply stop appearing. New tables
-- are new paths. So this merge is inert for users until the api and web merge lands.
--
-- cross-module-waiver: none — every object here is roster's (D-UN2); the board reads it through roster's index.
--
-- Rollback: drop the two new tables, the three new functions and triggers; restore 0592's guard, insert guard,
-- mention trigger, summary, search and pin functions; drop the four columns (no reader before the next merge).

-- ── 1. the columns ───────────────────────────────────────────────────────────────────────────────

alter table public.unit_notes add column if not exists edited_at timestamptz;
alter table public.unit_notes add column if not exists deleted_at timestamptz;
alter table public.unit_notes add column if not exists deleted_by uuid references auth.users(id) on delete set null;
alter table public.unit_notes add column if not exists deleted_by_name text;

alter table public.unit_notes drop constraint if exists unit_notes_removal_signed;
alter table public.unit_notes add constraint unit_notes_removal_signed
  check (deleted_at is null or length(btrim(coalesce(deleted_by_name, ''))) between 1 and 200);

comment on table public.unit_notes is
  'UNIT-NOTES-PLAN (0592, 0596): the office''s notes on a driver, truck or trailer. Words change only through edit_unit_note (old words kept in unit_note_versions) and a note is removed only by remove_unit_note (hidden, never deleted: UN010); raw changes are refused (UN011). Pinned, the driver merge''s subject_id (UN012) and author_id to null are the other moves. Subject checked on insert (UN012/UN013) and never deleted under its notes (UN014). Office-wide (D-UN4). Not evidence. Service-role only (RLS, no policies).';

-- ── 2. the old words ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.unit_note_versions (
  id             uuid primary key default gen_random_uuid(),
  note_id        uuid not null references public.unit_notes(id) on delete cascade,
  org_id         uuid not null references public.organizations(id) on delete cascade,
  body           text not null,
  edited_by      uuid references auth.users(id) on delete set null,
  edited_by_name text,
  replaced_at    timestamptz not null default now()
);
create index if not exists ix_unit_note_versions_note on public.unit_note_versions (note_id, replaced_at desc);
alter table public.unit_note_versions enable row level security;

comment on table public.unit_note_versions is
  'UNIT-NOTES-PLAN D-UN15 (0596): what a unit note said before each edit, written by guard_unit_notes in the same statement as the edit, with who made it. Append-only (UN024) except edited_by to null when that login is deleted. Read by nobody in this release (Q-UN7 (a)). Service-role only.';

create or replace function public.guard_unit_note_versions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'unit_note_versions are never deleted' using errcode = 'UN024';
  end if;
  if new.id <> old.id or new.note_id <> old.note_id or new.org_id <> old.org_id or new.body <> old.body
     or new.edited_by_name is distinct from old.edited_by_name or new.replaced_at <> old.replaced_at
     or (new.edited_by is distinct from old.edited_by and new.edited_by is not null) then
    raise exception 'unit_note_versions are never edited' using errcode = 'UN024';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_unit_note_versions on public.unit_note_versions;
create trigger trg_guard_unit_note_versions
  before update or delete on public.unit_note_versions
  for each row execute function public.guard_unit_note_versions();
drop trigger if exists trg_guard_unit_note_versions_truncate on public.unit_note_versions;
create trigger trg_guard_unit_note_versions_truncate
  before truncate on public.unit_note_versions
  for each statement execute function public.guard_unit_note_versions();

-- ── 3. the units a note names ────────────────────────────────────────────────────────────────────

create table if not exists public.unit_note_unit_mentions (
  note_id          uuid not null references public.unit_notes(id) on delete cascade,
  org_id           uuid not null references public.organizations(id) on delete cascade,
  subject_kind     text not null check (subject_kind in ('vehicle', 'driver', 'trailer')),
  subject_id       uuid not null,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid references auth.users(id) on delete set null,
  resolved_by_name text,
  primary key (note_id, subject_kind, subject_id),
  constraint unit_note_unit_mentions_resolution_signed
    check (resolved_at is null or length(btrim(coalesce(resolved_by_name, ''))) between 1 and 200)
);
-- The board's read: a unit's open mentions, newest first.
create index if not exists ix_unit_note_unit_mentions_open
  on public.unit_note_unit_mentions (org_id, subject_kind, subject_id, created_at desc) where resolved_at is null;
alter table public.unit_note_unit_mentions enable row level security;

comment on table public.unit_note_unit_mentions is
  'UNIT-NOTES-PLAN D-UN17/D-UN18 (0596): which truck, trailer or driver a unit note names, derived from the body''s <#kind:uuid> tokens on insert and on every edit; an open row is a chip in that unit''s Dispatch Board Warnings until somebody resolves it (resolved_at, set once). A driver row moves with the driver merge (UN012). Service-role only.';

-- `<#vehicle:uuid>` · `<#trailer:uuid>` · `<#driver:uuid>`, each once.
create or replace function public.unit_note_unit_tokens(p_body text)
returns table (kind text, id uuid)
language sql immutable set search_path = ''
as $$
  select distinct lower(x[1]), lower(x[2])::uuid
    from regexp_matches(coalesce(p_body, ''),
      '<#(vehicle|trailer|driver):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>', 'gi') x;
$$;

-- May this unit be named in this carrier? Its own carrier's, and a driver not an applicant (UN016).
create or replace function public.unit_note_unit_nameable(p_org uuid, p_kind text, p_subject uuid)
returns boolean
language sql stable set search_path = ''
as $$
  select public.unit_note_subject_exists(p_org, p_kind, p_subject)
     and not (p_kind = 'driver' and exists (
           select 1 from public.drivers d where d.id = p_subject and d.status = 'applicant'));
$$;

create or replace function public.guard_unit_note_unit_mentions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.note_id <> old.note_id or new.org_id <> old.org_id or new.subject_kind <> old.subject_kind
     or new.created_at <> old.created_at
     -- A resolution is set once; a later edit of the note never reopens it by itself.
     or (old.resolved_at is not null and (new.resolved_at is distinct from old.resolved_at
                                          or new.resolved_by_name is distinct from old.resolved_by_name
                                          or (new.resolved_by is distinct from old.resolved_by and new.resolved_by is not null))) then
    raise exception 'unit_note_unit_mentions: only the subject''s merge and one resolution move a row' using errcode = 'UN023';
  end if;
  if new.subject_id <> old.subject_id then
    -- The driver merge's move (0592's rule for the notes): drivers only, to a driver of this carrier.
    if old.subject_kind <> 'driver'
       or not public.unit_note_subject_exists(new.org_id, 'driver', new.subject_id) then
      raise exception 'unit_note_mention_move_refused: only a driver''s mention moves, to a driver of this carrier'
        using errcode = 'UN012';
    end if;
    -- A note that named both drivers keeps the surviving driver's row; this one stays behind and is
    -- cleared with the merged-away driver (`clear_unit_note_unit_mentions`).
    if exists (select 1 from public.unit_note_unit_mentions m
                where m.note_id = new.note_id and m.subject_kind = 'driver' and m.subject_id = new.subject_id) then
      return null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_unit_note_unit_mentions on public.unit_note_unit_mentions;
create trigger trg_guard_unit_note_unit_mentions
  before update on public.unit_note_unit_mentions
  for each row execute function public.guard_unit_note_unit_mentions();

-- A unit that is deleted takes its mention rows with it (the merge's leftover, above). Trucks and trailers
-- are never deleted in practice and a unit with notes cannot be (UN014); a unit only NAMED by a note can.
create or replace function public.clear_unit_note_unit_mentions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.unit_note_unit_mentions m
   where m.org_id = old.org_id and m.subject_kind = tg_argv[0] and m.subject_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_unit_note_unit_mentions_clear on public.drivers;
create trigger trg_unit_note_unit_mentions_clear
  after delete on public.drivers
  for each row execute function public.clear_unit_note_unit_mentions('driver');
drop trigger if exists trg_unit_note_unit_mentions_clear on public.vehicles;
create trigger trg_unit_note_unit_mentions_clear
  after delete on public.vehicles
  for each row execute function public.clear_unit_note_unit_mentions('vehicle');
drop trigger if exists trg_unit_note_unit_mentions_clear on public.trailers;
create trigger trg_unit_note_unit_mentions_clear
  after delete on public.trailers
  for each row execute function public.clear_unit_note_unit_mentions('trailer');

-- ── 4. the guards, restated ──────────────────────────────────────────────────────────────────────

create or replace function public.guard_unit_notes_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bad uuid;
  v_unit record;
begin
  if not public.unit_note_subject_exists(new.org_id, new.subject_kind, new.subject_id) then
    raise exception 'unit_note_subject_not_in_org: no % % in this carrier', new.subject_kind, new.subject_id
      using errcode = 'UN012';
  end if;
  if new.subject_kind = 'driver' and exists (
       select 1 from public.drivers d where d.id = new.subject_id and d.status = 'applicant') then
    raise exception 'unit_note_subject_is_applicant: an applicant''s notes are written on the applicant'
      using errcode = 'UN013';
  end if;
  -- A note is born unpinned, unedited and not removed; those are the functions' to set.
  new.pinned := false;
  new.edited_at := null;
  new.deleted_at := null;
  new.deleted_by := null;
  new.deleted_by_name := null;
  -- D-UN8: only an office member of this carrier can be named.
  select u into v_bad from unnest(public.chat_mention_ids(new.body)) u
   where not exists (select 1 from public.memberships m
                      where m.org_id = new.org_id and m.user_id = u
                        and m.role <> 'driver' and m.suspended_at is null)
   limit 1;
  if v_bad is not null then
    raise exception 'unit_note_mention_not_office_member: % is not an office member of this carrier', v_bad
      using errcode = 'UN015';
  end if;
  -- D-UN17: only this carrier's units, and no applicant.
  select t.kind, t.id into v_unit from public.unit_note_unit_tokens(new.body) t
   where not public.unit_note_unit_nameable(new.org_id, t.kind, t.id) limit 1;
  if v_unit.id is not null then
    raise exception 'unit_note_unit_not_nameable: no % % to name in this carrier', v_unit.kind, v_unit.id
      using errcode = 'UN016';
  end if;
  return new;
end;
$$;

create or replace function public.guard_unit_notes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_act boolean := coalesce(current_setting('fuelguard.unit_note_act', true), '') = 'on';
  v_bad uuid;
  v_unit record;
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'unit_notes are never deleted — remove_unit_note hides one' using errcode = 'UN010';
  end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.subject_kind <> old.subject_kind
     or new.author_name <> old.author_name or new.created_at <> old.created_at
     -- The author's login may go (on delete set null); the note never changes hands.
     or (new.author_id is distinct from old.author_id and new.author_id is not null) then
    raise exception 'unit_notes never change author, unit kind or time' using errcode = 'UN011';
  end if;
  -- A removed note is finished: its words, its removal and its pin stay as they are.
  if old.deleted_at is not null and (new.body <> old.body or new.deleted_at is distinct from old.deleted_at
       or new.deleted_by_name is distinct from old.deleted_by_name or new.pinned
       or (new.deleted_by is distinct from old.deleted_by and new.deleted_by is not null)) then
    raise exception 'unit_note_removed: a removed note is not changed' using errcode = 'UN022';
  end if;
  -- Words and removal change only through edit_unit_note / remove_unit_note (UN011).
  if (new.body <> old.body or new.deleted_at is distinct from old.deleted_at
      or new.deleted_by_name is distinct from old.deleted_by_name
      or (new.deleted_by is distinct from old.deleted_by and new.deleted_by is not null)) and not v_act then
    raise exception 'unit_notes are edited and removed only through edit_unit_note and remove_unit_note'
      using errcode = 'UN011';
  end if;
  -- `edited_at` is the trigger's, never the caller's.
  new.edited_at := old.edited_at;
  if new.body <> old.body then
    select u into v_bad
      from (select unnest(public.chat_mention_ids(new.body)) except select unnest(public.chat_mention_ids(old.body))) a(u)
     where not exists (select 1 from public.memberships m
                        where m.org_id = new.org_id and m.user_id = a.u
                          and m.role <> 'driver' and m.suspended_at is null)
     limit 1;
    if v_bad is not null then
      raise exception 'unit_note_mention_not_office_member: % is not an office member of this carrier', v_bad
        using errcode = 'UN015';
    end if;
    select a.kind, a.id into v_unit
      from (select * from public.unit_note_unit_tokens(new.body) except select * from public.unit_note_unit_tokens(old.body)) a
     where not public.unit_note_unit_nameable(new.org_id, a.kind, a.id) limit 1;
    if v_unit.id is not null then
      raise exception 'unit_note_unit_not_nameable: no % % to name in this carrier', v_unit.kind, v_unit.id
        using errcode = 'UN016';
    end if;
    insert into public.unit_note_versions (note_id, org_id, body, edited_by, edited_by_name)
    values (old.id, old.org_id, old.body,
            nullif(current_setting('fuelguard.unit_note_actor', true), '')::uuid,
            nullif(current_setting('fuelguard.unit_note_actor_name', true), ''));
    new.edited_at := now();
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    new.pinned := false;
  end if;
  if new.subject_id <> old.subject_id then
    -- Only the driver merge moves a note, and only to a driver of the same carrier. A truck's or trailer's
    -- note never moves: the merge's update matches on subject_id alone, so a vehicle sharing the merged
    -- driver's uuid would land here and stop the merge rather than be re-pointed at a driver.
    if old.subject_kind <> 'driver'
       or not public.unit_note_subject_exists(new.org_id, 'driver', new.subject_id) then
      raise exception 'unit_note_subject_move_refused: only a driver''s note moves, to a driver of this carrier'
        using errcode = 'UN012';
    end if;
    -- The surviving driver's pin wins; the moved note arrives unpinned (rows the same UPDATE moved earlier
    -- are visible here, so two moved pins cannot collide either).
    if new.pinned and exists (
         select 1 from public.unit_notes n
          where n.org_id = new.org_id and n.subject_kind = 'driver' and n.subject_id = new.subject_id
            and n.pinned and n.id <> new.id) then
      new.pinned := false;
    end if;
  end if;
  return new;
end;
$$;

-- The mention sets follow the words: on insert all of them, on an edit the difference.
create or replace function public.unit_notes_mentions_index()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.body = old.body then
      return null;
    end if;
    delete from public.unit_note_mentions m
     where m.note_id = new.id
       and m.user_id in (select unnest(public.chat_mention_ids(old.body)) except select unnest(public.chat_mention_ids(new.body)));
    delete from public.unit_note_unit_mentions m
     where m.note_id = new.id
       and (m.subject_kind, m.subject_id) in (select * from public.unit_note_unit_tokens(old.body)
                                              except select * from public.unit_note_unit_tokens(new.body));
  end if;
  insert into public.unit_note_mentions (note_id, user_id, org_id, created_at)
  select new.id, u, new.org_id, coalesce(new.edited_at, new.created_at) from unnest(public.chat_mention_ids(new.body)) u
  on conflict (note_id, user_id) do nothing;
  insert into public.unit_note_unit_mentions (note_id, org_id, subject_kind, subject_id, created_at)
  select new.id, new.org_id, t.kind, t.id, coalesce(new.edited_at, new.created_at) from public.unit_note_unit_tokens(new.body) t
  on conflict (note_id, subject_kind, subject_id) do nothing;
  return null;
end;
$$;

drop trigger if exists trg_unit_notes_mentions_index on public.unit_notes;
create trigger trg_unit_notes_mentions_index
  after insert or update of body on public.unit_notes
  for each row execute function public.unit_notes_mentions_index();

comment on table public.unit_note_mentions is
  'UNIT-NOTES-PLAN D-UN8 (0592, 0596): who a unit note names, derived from the body''s <@uuid> tokens (chat_mention_ids, 0521) on insert and re-derived on every edit (a name taken out is dropped). Service-role only.';

-- ── 5. edit, remove, resolve ─────────────────────────────────────────────────────────────────────

-- The note's id, unit and new edited_at; UN020 not this carrier's live note, UN025 not the caller's to edit.
create or replace function public.edit_unit_note(
  p_org uuid, p_note uuid, p_body text, p_actor uuid, p_actor_name text, p_any boolean
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_note public.unit_notes%rowtype;
begin
  select * into v_note from public.unit_notes where id = p_note and org_id = p_org and deleted_at is null for update;
  if v_note.id is null then
    raise exception 'unit_note_not_found' using errcode = 'UN020';
  end if;
  if not coalesce(p_any, false) and v_note.author_id is distinct from p_actor then
    raise exception 'unit_note_not_yours: only its author edits this note' using errcode = 'UN025';
  end if;
  perform set_config('fuelguard.unit_note_act', 'on', true);
  perform set_config('fuelguard.unit_note_actor', coalesce(p_actor::text, ''), true);
  perform set_config('fuelguard.unit_note_actor_name', coalesce(left(btrim(p_actor_name), 200), ''), true);
  update public.unit_notes set body = p_body where id = p_note returning * into v_note;
  perform set_config('fuelguard.unit_note_act', '', true);
  return jsonb_build_object('id', v_note.id, 'kind', v_note.subject_kind, 'subject_id', v_note.subject_id,
                            'edited_at', v_note.edited_at, 'author_id', v_note.author_id);
end;
$$;

comment on function public.edit_unit_note(uuid, uuid, text, uuid, text, boolean) is
  'UNIT-NOTES-PLAN D-UN15 (0596): replace a live note''s words, keeping the old ones in unit_note_versions. p_any is the api''s answer to notes.manage_all; false means the author only (UN025). UN020 not this carrier''s live note.';

-- Hide a note. Returns its unit so the api's audit row can name it; UN020 / UN025 as edit's.
create or replace function public.remove_unit_note(
  p_org uuid, p_note uuid, p_actor uuid, p_actor_name text, p_any boolean
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_note public.unit_notes%rowtype;
begin
  select * into v_note from public.unit_notes where id = p_note and org_id = p_org and deleted_at is null for update;
  if v_note.id is null then
    raise exception 'unit_note_not_found' using errcode = 'UN020';
  end if;
  if not coalesce(p_any, false) and v_note.author_id is distinct from p_actor then
    raise exception 'unit_note_not_yours: only its author removes this note' using errcode = 'UN025';
  end if;
  perform set_config('fuelguard.unit_note_act', 'on', true);
  update public.unit_notes
     set deleted_at = now(), deleted_by = p_actor, deleted_by_name = left(btrim(p_actor_name), 200)
   where id = p_note;
  perform set_config('fuelguard.unit_note_act', '', true);
  return jsonb_build_object('id', v_note.id, 'kind', v_note.subject_kind, 'subject_id', v_note.subject_id,
                            'author_id', v_note.author_id);
end;
$$;

comment on function public.remove_unit_note(uuid, uuid, uuid, text, boolean) is
  'UNIT-NOTES-PLAN D-UN16 (0596): hide a live note from every list, count, search, pin and board chip; the row and its words stay. p_any as edit_unit_note''s. UN020 not this carrier''s live note.';

-- Resolve one unit's mention on one note (D-UN18). True when it is resolved now or already was; UN020 when
-- the note is not this carrier's live note or does not name that unit.
create or replace function public.resolve_unit_note_unit_mention(
  p_org uuid, p_note uuid, p_kind text, p_subject uuid, p_actor uuid, p_actor_name text
) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.unit_note_unit_mentions m
                   join public.unit_notes n on n.id = m.note_id and n.org_id = p_org and n.deleted_at is null
                  where m.note_id = p_note and m.org_id = p_org and m.subject_kind = p_kind and m.subject_id = p_subject) then
    raise exception 'unit_note_mention_not_found' using errcode = 'UN020';
  end if;
  update public.unit_note_unit_mentions
     set resolved_at = now(), resolved_by = p_actor, resolved_by_name = left(btrim(p_actor_name), 200)
   where note_id = p_note and org_id = p_org and subject_kind = p_kind and subject_id = p_subject
     and resolved_at is null;
  return true;
end;
$$;

comment on function public.resolve_unit_note_unit_mention(uuid, uuid, text, uuid, uuid, text) is
  'UNIT-NOTES-PLAN D-UN18 (0596): take one unit''s chip for one note off the Dispatch Board, signed. Set once (UN023). UN020 no such live mention in this carrier.';

-- The board's chips: `{ "<kind>": { "<subject_id>": [ { note_id, at, author_name, note_kind, note_subject_id,
-- note_label } ] } }`, open mentions on live notes, newest first, five per unit at most. One value (M12).
create or replace function public.unit_note_open_unit_mentions(p_org uuid)
returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k.kind, k.units), '{}'::jsonb)
    from (
      select u.subject_kind as kind, jsonb_object_agg(u.subject_id, u.items) as units
        from (
          select m.subject_kind, m.subject_id,
                 jsonb_agg(jsonb_build_object(
                   'note_id', m.note_id, 'at', m.created_at, 'author_name', n.author_name,
                   'note_kind', n.subject_kind, 'note_subject_id', n.subject_id,
                   'note_label', case n.subject_kind
                     when 'driver'  then (select d.full_name   from public.drivers d  where d.id = n.subject_id and d.org_id = p_org)
                     when 'vehicle' then (select v.unit_number from public.vehicles v where v.id = n.subject_id and v.org_id = p_org)
                     when 'trailer' then (select t.unit_number from public.trailers t where t.id = n.subject_id and t.org_id = p_org)
                   end) order by m.created_at desc, m.note_id) as items
            from (select m.*, row_number() over (partition by m.subject_kind, m.subject_id order by m.created_at desc, m.note_id) as rn
                    from public.unit_note_unit_mentions m
                    join public.unit_notes n on n.id = m.note_id and n.org_id = p_org and n.deleted_at is null
                   where m.org_id = p_org and m.resolved_at is null) m
            join public.unit_notes n on n.id = m.note_id
           where m.rn <= 5
           group by m.subject_kind, m.subject_id
        ) u
       group by u.subject_kind
    ) k;
$$;

comment on function public.unit_note_open_unit_mentions(uuid) is
  'UNIT-NOTES-PLAN D-UN18 (0596): every open unit mention of the carrier for the Dispatch Board, as one jsonb keyed kind → unit id, newest five per unit; resolved mentions and removed notes are absent.';

-- ── 6. pin, counts and the list skip a removed note ──────────────────────────────────────────────

create or replace function public.set_unit_note_pinned(p_org uuid, p_note uuid, p_pinned boolean)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
  v_subject uuid;
begin
  select subject_kind, subject_id into v_kind, v_subject
    from public.unit_notes where id = p_note and org_id = p_org and deleted_at is null;
  if v_subject is null then
    raise exception 'unit_note_not_found' using errcode = 'UN020';
  end if;
  -- One pinner per unit at a time, so two people pinning at once queue instead of one getting 23505.
  perform pg_advisory_xact_lock(hashtextextended('unit_notes:' || p_org || ':' || v_kind || ':' || v_subject, 0));
  if p_pinned then
    update public.unit_notes set pinned = false
     where org_id = p_org and subject_kind = v_kind and subject_id = v_subject and pinned and id <> p_note;
  end if;
  update public.unit_notes set pinned = coalesce(p_pinned, false) where id = p_note and org_id = p_org;
  return coalesce(p_pinned, false);
end;
$$;

comment on function public.set_unit_note_pinned(uuid, uuid, boolean) is
  'UNIT-NOTES-PLAN D-UN6 (0592, 0596): pin (unpinning the unit''s other note) or unpin one live note. UN020 not this carrier''s live note.';

create or replace function public.unit_note_summary(p_org uuid, p_kinds text[])
returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k.kind, coalesce(s.units, '{}'::jsonb)), '{}'::jsonb)
    from (select distinct unnest(p_kinds) as kind) k
    left join lateral (
      select jsonb_object_agg(g.subject_id, jsonb_build_object('count', g.n, 'last_at', g.last_at)) as units
        from (select n.subject_id, count(*)::int as n, max(n.created_at) as last_at
                from public.unit_notes n
               where n.org_id = p_org and n.subject_kind = k.kind and n.deleted_at is null
               group by n.subject_id) g
    ) s on true
   where k.kind in ('vehicle', 'driver', 'trailer');
$$;

-- The return gains `edited_at` and `unit_mentions` (`[{ kind, id, label }]`, the units the note names), so
-- the function is dropped and made again; the arguments are 0592's.
-- ⚠ Load pg_trgm's library in THIS session before the function below names its setting. Measured on
-- staging, 2026-11-13 02:11 UTC: the first 0596 stopped here with "permission denied to set parameter
-- pg_trgm.word_similarity_threshold" (42501). Until the library is loaded the setting is only a
-- placeholder, and Postgres 15+ lets a non-superuser attach a placeholder to a function only if they could
-- set it as superuser. 0592 never met this because its trigram index, earlier in the same file, had already
-- loaded the library. Calling one pg_trgm function does the same here. The PGlite matrices run as superuser,
-- which is why none of them could see it. Nothing had applied 0596 (staging rolled it back, production
-- never ran it), so this file was corrected in place rather than followed by a migration that could never run.
select public.similarity('unit', 'notes');

drop function if exists public.unit_notes_search(uuid, text[], jsonb, text, uuid, timestamptz, timestamptz, timestamptz, uuid, timestamptz, uuid, integer);
create function public.unit_notes_search(
  p_org uuid, p_kinds text[], p_subjects jsonb, p_q text, p_author uuid,
  p_from timestamptz, p_to timestamptz,
  p_before_at timestamptz, p_before_id uuid, p_after_at timestamptz, p_after_id uuid,
  p_limit integer
) returns table (
  id uuid, subject_kind text, subject_id uuid, subject_label text, body text,
  author_id uuid, author_name text, pinned boolean, created_at timestamptz,
  mentions uuid[], fuzzy boolean, edited_at timestamptz, unit_mentions jsonb
)
language plpgsql stable
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.4
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_q text := nullif(btrim(left(coalesce(p_q, ''), 200)), '');
  v_tsq tsquery := public.chat_search_query(v_q);
  v_subjects jsonb := coalesce(p_subjects, '[]'::jsonb);
  v_kinds text[];
  v_ids uuid[];
  v_fuzzy boolean := false;
begin
  if p_org is null then
    raise exception 'unit_notes_search: an organisation is required' using errcode = 'UN030';
  end if;
  if p_before_at is not null and p_after_at is not null then
    raise exception 'unit_notes_search: ask for older or newer notes, not both' using errcode = 'UN030';
  end if;
  if jsonb_typeof(v_subjects) <> 'array' or jsonb_array_length(v_subjects) > 8 then
    raise exception 'unit_notes_search: at most 8 units' using errcode = 'UN030';
  end if;

  select coalesce(array_agg(s->>'kind'), '{}'), coalesce(array_agg((s->>'id')::uuid), '{}')
    into v_kinds, v_ids
    from jsonb_array_elements(v_subjects) s;

  if v_q is not null and not exists (
       select 1 from public.unit_notes n
        where n.org_id = p_org and n.deleted_at is null
          and (jsonb_array_length(v_subjects) = 0
               or exists (select 1 from unnest(v_kinds, v_ids) sc(k, i) where sc.k = n.subject_kind and sc.i = n.subject_id))
          and (jsonb_array_length(v_subjects) > 0 or p_kinds is null or n.subject_kind = any (p_kinds))
          and (p_author is null or n.author_id = p_author)
          and (p_from is null or n.created_at >= p_from)
          and (p_to is null or n.created_at < p_to)
          and public.chat_search_vector(n.body) @@ v_tsq) then
    v_fuzzy := true;
  end if;

  return query
  with hits as (
    select n.*
      from public.unit_notes n
     where n.org_id = p_org and n.deleted_at is null
       and (jsonb_array_length(v_subjects) = 0
            or exists (select 1 from unnest(v_kinds, v_ids) sc(k, i) where sc.k = n.subject_kind and sc.i = n.subject_id))
       and (jsonb_array_length(v_subjects) > 0 or p_kinds is null or n.subject_kind = any (p_kinds))
       and (p_author is null or n.author_id = p_author)
       and (p_from is null or n.created_at >= p_from)
       and (p_to is null or n.created_at < p_to)
       and (v_q is null
            or (not v_fuzzy and public.chat_search_vector(n.body) @@ v_tsq)
            or (v_fuzzy and v_q operator(public.<%) n.body))
       and (p_before_at is null or (n.created_at, n.id) < (p_before_at, p_before_id))
       and (p_after_at is null or (n.created_at, n.id) > (p_after_at, p_after_id))
     order by case when p_after_at is null then n.created_at end desc,
              case when p_after_at is null then n.id end desc,
              n.created_at asc, n.id asc
     limit v_limit
  )
  select h.id, h.subject_kind, h.subject_id,
         case h.subject_kind
           when 'driver'  then (select d.full_name   from public.drivers d  where d.id = h.subject_id and d.org_id = p_org)
           when 'vehicle' then (select v.unit_number from public.vehicles v where v.id = h.subject_id and v.org_id = p_org)
           when 'trailer' then (select t.unit_number from public.trailers t where t.id = h.subject_id and t.org_id = p_org)
         end,
         h.body, h.author_id, h.author_name, h.pinned, h.created_at,
         coalesce((select array_agg(m.user_id order by m.user_id) from public.unit_note_mentions m
                    where m.note_id = h.id), '{}'::uuid[]),
         v_fuzzy,
         h.edited_at,
         coalesce((select jsonb_agg(jsonb_build_object(
                      'kind', um.subject_kind, 'id', um.subject_id,
                      'label', case um.subject_kind
                        when 'driver'  then (select d.full_name   from public.drivers d  where d.id = um.subject_id and d.org_id = p_org)
                        when 'vehicle' then (select v.unit_number from public.vehicles v where v.id = um.subject_id and v.org_id = p_org)
                        when 'trailer' then (select t.unit_number from public.trailers t where t.id = um.subject_id and t.org_id = p_org)
                      end) order by um.subject_kind, um.subject_id)
                    from public.unit_note_unit_mentions um where um.note_id = h.id), '[]'::jsonb)
    from hits h
   order by h.created_at desc, h.id desc;
end;
$$;

-- ── 7. the api's only door ───────────────────────────────────────────────────────────────────────

revoke all on function public.unit_note_unit_tokens(text) from public, anon, authenticated;
revoke all on function public.unit_note_unit_nameable(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.edit_unit_note(uuid, uuid, text, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.remove_unit_note(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.resolve_unit_note_unit_mention(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.unit_note_open_unit_mentions(uuid) from public, anon, authenticated;
revoke all on function public.set_unit_note_pinned(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.unit_note_summary(uuid, text[]) from public, anon, authenticated;
revoke all on function public.unit_notes_search(uuid, text[], jsonb, text, uuid, timestamptz, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.edit_unit_note(uuid, uuid, text, uuid, text, boolean) to service_role;
grant execute on function public.remove_unit_note(uuid, uuid, uuid, text, boolean) to service_role;
grant execute on function public.resolve_unit_note_unit_mention(uuid, uuid, text, uuid, uuid, text) to service_role;
grant execute on function public.unit_note_open_unit_mentions(uuid) to service_role;
grant execute on function public.set_unit_note_pinned(uuid, uuid, boolean) to service_role;
grant execute on function public.unit_note_summary(uuid, text[]) to service_role;
grant execute on function public.unit_notes_search(uuid, text[], jsonb, text, uuid, timestamptz, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) to service_role;
