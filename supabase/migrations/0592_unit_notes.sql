-- 0592 — notes on drivers, trucks and trailers: the office's notes on the units it runs
-- (docs/plans/notes/UNIT-NOTES-PLAN.md §4.1, step UN1).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- Measured on 2026-11-11 (plan M1): `drivers`, `vehicles` and `trailers` have no notes column and no notes
-- table. The only notes in 360 are `applicant_notes` (0535), keyed to an applicant and purged with them, so
-- "trailer 5310's door seal leaks, shop knows" or "Marcus prefers no NYC loads" has nowhere to live that the
-- dispatcher, billing and safety all read.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- `unit_notes`: one table for the three subjects (D-UN1), `subject_kind` + `subject_id`, owned by roster
-- (D-UN2: the subjects are roster's tables). `unit_note_mentions`: who a note names, derived by trigger from
-- the body's `<@uuid>` tokens (D-UN8, chat's own token, 0521).
--
--   · **Permanent and signed (D-UN3).** No edit and no removal in this release (D-UN5): the guard refuses
--     every DELETE (UN010) and every UPDATE (UN011) except three moves that are not edits — `pinned`
--     (D-UN6), the driver merge's `subject_id` move (inside the carrier, drivers only, UN012), and
--     `author_id` going to null when the author's login is deleted (`on delete set null`; the stored
--     `author_name` keeps the signature). 0535 refuses that last one, which means a person who ever wrote an
--     applicant note can never be deleted from `auth.users`; every office person will write unit notes, so
--     this table must not inherit that.
--   · **The subject is checked, not referenced.** One column cannot carry three foreign keys, so the insert
--     guard checks the id exists in this carrier in the table the kind names (UN012), and refuses a driver
--     still in `applicant` status (UN013: an applicant's notes are `applicant_notes`, on the applicant
--     record, D-UN11). The `on delete restrict` the column cannot declare is a `before delete` trigger on
--     each subject table (UN014): a unit with notes is never deleted out from under them. Nothing deletes a
--     truck or a trailer today (measured: no `delete from vehicles|trailers` in migrations or the api) and
--     drivers already refuse (DR010) outside the merge, which moves the notes first.
--   · **Mentions name office members only (UN015).** Every office member of the carrier reads notes (D-UN4),
--     so any of them may be named: a membership in this org, not the `driver` role, not suspended. A token
--     naming anybody else aborts the insert, so the note is never written. UN3's `/people` lists the same set.
--   · **One pin per unit (D-UN6)**: a partial unique index, and `set_unit_note_pinned`, which unpins the
--     unit's other note under a per-unit advisory lock (two people pinning at once queue, not 23505). A merge
--     that brings a pinned note onto a driver who has one keeps the surviving driver's pin.
--   · **Search (D-UN7)** reuses chat's word search exactly (0542): `chat_search_vector` for the expression
--     index and `chat_search_query` for the words, so "L-20481" and "702" split here as they do in chat and
--     nothing is written twice. When the words find nothing in scope, a second pass matches by trigram word
--     similarity (`pg_trgm`, enabled since 0163, in `public` on production — measured 2026-11-11), and each
--     row says `fuzzy`. Threshold 0.4, set on the function, not 0.6 (the extension's default): measured on
--     the matrix's rows, a one-letter slip in a short word ("brakse" for "brakes") scores 0.57.
--   · **Counts as one value (M12).** `unit_note_summary` returns one jsonb, never rows and never an id list:
--     PostgREST caps a response at 1,000 rows and a long `.in()` overflows Node 22's headers.
--   · **RLS on, no client policies** — deny-all from a browser; the api reads and writes with the service
--     role and filters on `org_id` itself. Every function here is SECURITY INVOKER, service role only.
--   · **Not evidence.** Working notes, not a §391.51 record: not in RETENTION_FORBIDDEN, no purge job.
--
-- ⚠ DEPLOY WINDOW: two new tables (exempt from the two-merge rule), new functions nothing calls yet, a
-- widened CHECK nothing writes yet, and three delete triggers that fire only where a note exists. The one
-- code line in this PR is the merge list (`mergeDriver.ts`), which updates this table; a merge run in the
-- minutes between the code serving and `migrate-staging` applying this would fail loudly on the missing
-- table (MD020) and is an admin act nobody runs on a release night — 0535's reasoning, unchanged.
--
-- cross-module-waiver: roster's notes restate messaging's `notification_events` category CHECK to add
-- `unit_note_mention`, as every new category has (0521 … 0587), and call messaging's `chat_search_vector`
-- / `chat_search_query` so a note and a chat line are searched by one definition (plan U2).
--
-- Rollback: drop the three subject triggers, the functions and both tables; restore 0587's CHECK.

-- ── 1. the notes ─────────────────────────────────────────────────────────────────────────────────

create table if not exists public.unit_notes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('vehicle', 'driver', 'trailer')),
  subject_id   uuid not null,
  body         text not null check (length(btrim(body)) between 1 and 4000),
  author_id    uuid references auth.users(id) on delete set null,
  author_name  text not null check (length(btrim(author_name)) between 1 and 200),
  pinned       boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table public.unit_notes enable row level security;

-- A unit's notes, newest first, keyset on (created_at, id): the drawer, its "newer than I hold" refresh
-- (D-UN10) and the summary's per-unit count.
create index if not exists ix_unit_notes_subject
  on public.unit_notes (org_id, subject_kind, subject_id, created_at desc, id desc);
-- The wall (D-UN13): every note of the carrier, newest first.
create index if not exists ix_unit_notes_org_recent
  on public.unit_notes (org_id, created_at desc, id desc);
-- At most one pinned note per unit (D-UN6).
create unique index if not exists ux_unit_notes_one_pinned
  on public.unit_notes (org_id, subject_kind, subject_id) where pinned;
-- Word search: the same expression chat's index and query use (0542), so the planner's match cannot drift.
create index if not exists ix_unit_notes_search
  on public.unit_notes using gin (public.chat_search_vector(body));
-- The typo pass (D-UN7).
create index if not exists ix_unit_notes_trgm
  on public.unit_notes using gin (body public.gin_trgm_ops);

comment on table public.unit_notes is
  'UNIT-NOTES-PLAN (0592): the office''s notes on a driver, truck or trailer. Permanent (UN010/UN011) except pinned, the driver merge''s subject_id (UN012) and author_id to null; subject checked on insert (UN012/UN013) and never deleted under its notes (UN014). Office-wide (D-UN4). Not evidence. Service-role only (RLS, no policies).';

-- ── 2. who a note names ──────────────────────────────────────────────────────────────────────────

create table if not exists public.unit_note_mentions (
  note_id    uuid not null references public.unit_notes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, user_id)
);
-- "Notes that name me", newest first — the bell's own reads go through `notification_events`; this is the
-- reverse lookup for a later "mentioned" filter and for the API to return a note's mentions.
create index if not exists ix_unit_note_mentions_user
  on public.unit_note_mentions (user_id, org_id, created_at desc);

alter table public.unit_note_mentions enable row level security;

comment on table public.unit_note_mentions is
  'UNIT-NOTES-PLAN D-UN8 (0592): who a unit note names, derived on insert from the body''s <@uuid> tokens (chat_mention_ids, 0521). A note is never edited, so the set never changes after the insert. Service-role only.';

-- ── 3. the guards ────────────────────────────────────────────────────────────────────────────────

-- Does this unit exist in this carrier, in the table its kind names? One definition for the insert guard and
-- the merge move.
create or replace function public.unit_note_subject_exists(p_org uuid, p_kind text, p_subject uuid)
returns boolean
language sql stable set search_path = ''
as $$
  select case p_kind
    when 'driver'  then exists (select 1 from public.drivers d  where d.id = p_subject and d.org_id = p_org)
    when 'vehicle' then exists (select 1 from public.vehicles v where v.id = p_subject and v.org_id = p_org)
    when 'trailer' then exists (select 1 from public.trailers t where t.id = p_subject and t.org_id = p_org)
    else false
  end;
$$;

create or replace function public.guard_unit_notes_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bad uuid;
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
  -- A note is born unpinned; pinning is `set_unit_note_pinned`'s, which unpins the other note.
  new.pinned := false;
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
  return new;
end;
$$;

drop trigger if exists trg_guard_unit_notes_insert on public.unit_notes;
create trigger trg_guard_unit_notes_insert
  before insert on public.unit_notes
  for each row execute function public.guard_unit_notes_insert();

create or replace function public.guard_unit_notes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'unit_notes are never deleted — write a new note instead' using errcode = 'UN010';
  end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.subject_kind <> old.subject_kind
     or new.body <> old.body or new.author_name <> old.author_name or new.created_at <> old.created_at
     -- The author's login may go (on delete set null); the note never changes hands.
     or (new.author_id is distinct from old.author_id and new.author_id is not null) then
    raise exception 'unit_notes are never edited — write a new note instead' using errcode = 'UN011';
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

drop trigger if exists trg_guard_unit_notes on public.unit_notes;
create trigger trg_guard_unit_notes
  before update or delete on public.unit_notes
  for each row execute function public.guard_unit_notes();

-- TRUNCATE skips row triggers; refuse it as a statement.
drop trigger if exists trg_guard_unit_notes_truncate on public.unit_notes;
create trigger trg_guard_unit_notes_truncate
  before truncate on public.unit_notes
  for each statement execute function public.guard_unit_notes();

-- Derive the mentions. After insert: the guard above has already refused anybody who may not be named.
create or replace function public.unit_notes_mentions_index()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.unit_note_mentions (note_id, user_id, org_id, created_at)
  select new.id, u, new.org_id, new.created_at from unnest(public.chat_mention_ids(new.body)) u
  on conflict (note_id, user_id) do nothing;
  return null;
end;
$$;

drop trigger if exists trg_unit_notes_mentions_index on public.unit_notes;
create trigger trg_unit_notes_mentions_index
  after insert on public.unit_notes
  for each row execute function public.unit_notes_mentions_index();

-- UN014: a unit with notes is never deleted out from under them — the `on delete restrict` a polymorphic
-- column cannot declare. One function, the kind read from the trigger's argument.
create or replace function public.guard_unit_note_subject_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.unit_notes n
              where n.org_id = old.org_id and n.subject_kind = tg_argv[0] and n.subject_id = old.id) then
    raise exception 'unit_note_subject_has_notes: this % has notes; it cannot be deleted', tg_argv[0]
      using errcode = 'UN014';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_unit_notes_restrict on public.drivers;
create trigger trg_unit_notes_restrict
  before delete on public.drivers
  for each row execute function public.guard_unit_note_subject_delete('driver');
drop trigger if exists trg_unit_notes_restrict on public.vehicles;
create trigger trg_unit_notes_restrict
  before delete on public.vehicles
  for each row execute function public.guard_unit_note_subject_delete('vehicle');
drop trigger if exists trg_unit_notes_restrict on public.trailers;
create trigger trg_unit_notes_restrict
  before delete on public.trailers
  for each row execute function public.guard_unit_note_subject_delete('trailer');

-- ── 4. pinning ───────────────────────────────────────────────────────────────────────────────────

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
    from public.unit_notes where id = p_note and org_id = p_org;
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
  'UNIT-NOTES-PLAN D-UN6 (0592): pin (unpinning the unit''s other note) or unpin one note. UN020 not this carrier''s note.';

-- ── 5. the Notes column's counts ─────────────────────────────────────────────────────────────────

-- `{ "<kind>": { "<subject_id>": { "count": n, "last_at": "<instant>" } } }` for each kind asked, `{}` for a
-- kind with no notes; a unit with none is absent. One value, never rows (M12).
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
               where n.org_id = p_org and n.subject_kind = k.kind
               group by n.subject_id) g
    ) s on true
   where k.kind in ('vehicle', 'driver', 'trailer');
$$;

-- ── 6. the list, the search and the wall ─────────────────────────────────────────────────────────

-- One reader for the drawer (p_subjects = up to 8 `{kind, id}`), the drawer's search (p_q) and the Notes page
-- (no p_subjects: every note of the carrier, narrowed by p_kinds). Filters: p_author, and p_from (inclusive)
-- / p_to (exclusive) as instants — the api turns calendar days into that half-open interval. Keyset on
-- (created_at, id): p_before_* pages older (newest first); p_after_* returns the OLDEST p_limit notes newer
-- than the cursor, newest first, so a drawer asking "anything after the newest I hold" never skips one;
-- both at once is UN030. Limit clamped to 1..50 (UNIT_NOTE_PAGE_LIMIT).
--
-- Search: every word of p_q as a prefix, all required (chat's query, 0542). When that finds nothing in the
-- whole scope (cursors aside), the rows are trigram close matches instead and `fuzzy` is true on each.
create or replace function public.unit_notes_search(
  p_org uuid, p_kinds text[], p_subjects jsonb, p_q text, p_author uuid,
  p_from timestamptz, p_to timestamptz,
  p_before_at timestamptz, p_before_id uuid, p_after_at timestamptz, p_after_id uuid,
  p_limit integer
) returns table (
  id uuid, subject_kind text, subject_id uuid, subject_label text, body text,
  author_id uuid, author_name text, pinned boolean, created_at timestamptz,
  mentions uuid[], fuzzy boolean
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
        where n.org_id = p_org
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
     where n.org_id = p_org
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
         v_fuzzy
    from hits h
   order by h.created_at desc, h.id desc;
end;
$$;

revoke all on function public.unit_note_subject_exists(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.set_unit_note_pinned(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.unit_note_summary(uuid, text[]) from public, anon, authenticated;
revoke all on function public.unit_notes_search(uuid, text[], jsonb, text, uuid, timestamptz, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.set_unit_note_pinned(uuid, uuid, boolean) to service_role;
grant execute on function public.unit_note_summary(uuid, text[]) to service_role;
grant execute on function public.unit_notes_search(uuid, text[], jsonb, text, uuid, timestamptz, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) to service_role;

-- ── 7. the bell's category (D-UN8) ───────────────────────────────────────────────────────────────
-- 0587's list restated whole, `unit_note_mention` added; NOTIFICATION_CATEGORIES moves in this PR and
-- nothing writes the value until UN3.
alter table public.notification_events drop constraint if exists notification_events_category_check;
alter table public.notification_events add constraint notification_events_category_check check (category in (
  'load_offered', 'load_changed', 'load_canceled', 'message_received', 'duty_auto_closed',
  'performance_week', 'training_due', 'system', 'hazmat_review', 'hazmat_cleared', 'hazmat_rejected',
  'fuel_alert', 'declined_alert', 'efs_processing_failed', 'efs_feed_stale',
  'dq_expiring', 'dq_expired', 'dq_missing', 'dq_license_status', 'dq_mvr_received',
  'application_stalled', 'application_ready_to_screen', 'card_status_changed', 'drug_alcohol_result',
  'roadside_feed_stale', 'medstop_connection', 'roadside_repair_due', 'roadside_report_needs_review',
  'unit_file_expiring', 'unit_file_expired',
  'chat_mention', 'chat_reply',
  'ads_overspend', 'ads_rejected', 'ads_no_leads', 'ads_external_change', 'ads_token_expiring', 'ads_brief', 'ads_pause_failed',
  'lead_new', 'lead_uncontacted', 'lead_intake_failing',
  'ads_lead_quality',
  'ads_creative_retired',
  'ai_assistant_budget',
  'ads_creative_refresh',
  'unit_note_mention'
));
