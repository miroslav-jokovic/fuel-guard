-- FuelGuard — 0090 messages (Phase 5M, decision D54)
--
-- Office↔driver communication, and the FIRST surface in this stack that needs inbound realtime: the
-- Phase-2 offline model (D4) is write-only — an outbox that pushes. A message arriving is the
-- opposite direction, so this migration also puts `messages` in the realtime publication.
--
-- FOUR TABLES:
--   message_threads      the conversation, optionally BOUND TO A LOAD
--   thread_participants  who is in it, and how far each has read
--   messages             the content — client-UUID PK, soft-delete only
--   message_reports      the report affordance Apple 1.2 expects of in-app UGC
--
-- THE DETAIL THAT MAKES THIS USEFUL RATHER THAN A SECOND INBOX NOBODY READS: `threads.load_id`. A
-- conversation that carries its load means dispatch and driver are provably talking about the same
-- run, and the thread surfaces on the load detail on both sides. Messaging detached from the work is
-- how you end up with a chat app people ignore.
--
-- Gated on the `messages` module (D55/0088).

create table if not exists message_threads (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  subject         text,
  /** The run this conversation is about. Null = a general thread. */
  load_id         uuid references loads(id) on delete set null,
  created_by      uuid references auth.users(id) on delete set null,
  last_message_at timestamptz not null default now(),
  status          text not null default 'open',
  created_at      timestamptz not null default now(),
  constraint message_threads_status_check check (status in ('open', 'closed'))
);
create index if not exists idx_threads_org_recent on message_threads (org_id, last_message_at desc);
create index if not exists idx_threads_load on message_threads (load_id) where load_id is not null;

create table if not exists thread_participants (
  thread_id    uuid not null references message_threads(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade,
  /** 'driver' | 'office' — drives who a reply notifies, and the dispatch "seen it" column. */
  role         text not null default 'office',
  joined_at    timestamptz not null default now(),
  /** The unread boundary. Dispatch reads this as "has the driver seen it", which is most of why
      they asked for messaging in the first place. */
  last_read_at timestamptz,
  primary key (thread_id, user_id),
  constraint thread_participants_role_check check (role in ('driver', 'office'))
);
create index if not exists idx_participants_user on thread_participants (user_id, thread_id);

-- `id` is the CLIENT-generated UUID from the outbox: a message written in a dead zone is queued, and
-- a replayed drain collides on the primary key instead of double-posting (the same contract as duty
-- sessions and stop photos).
create table if not exists messages (
  id              uuid primary key,
  thread_id       uuid not null references message_threads(id) on delete cascade,
  org_id          uuid not null references organizations(id) on delete cascade,
  sender_user_id  uuid references auth.users(id) on delete set null,
  body            text not null,
  attachment_path text,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  /** Soft delete only — see the trigger below. */
  deleted_at      timestamptz,
  constraint messages_body_check check (length(btrim(body)) > 0 and length(body) <= 4000)
);
create index if not exists idx_messages_thread on messages (thread_id, created_at desc);

-- Apple treats in-app user-generated content as needing report/block affordances even for an
-- internal-only app (1.2). This is the smallest honest implementation: a driver or an office user
-- can report a message, and an admin can see it — no moderation machinery a fleet does not need.
create table if not exists message_reports (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  message_id  uuid not null references messages(id) on delete cascade,
  reported_by uuid references auth.users(id) on delete set null,
  reason      text not null,
  created_at  timestamptz not null default now(),
  constraint message_reports_reason_check check (reason in ('abusive', 'inappropriate', 'spam', 'other'))
);
create index if not exists idx_message_reports_org on message_reports (org_id, created_at desc);

-- ── auth helpers ──────────────────────────────────────────────────────────────
-- Mirrors auth_org_id() / auth_role() from 0002_functions.sql.
-- Returns the authenticated user's UUID from the JWT `sub` claim (= auth.uid()).
create or replace function auth_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

-- ── the visibility predicate ──────────────────────────────────────────────────
-- One helper, used by every policy below, so "can this person see this thread" is defined once.
-- SECURITY DEFINER for the usual reason (0084): the internal read must bypass RLS or the policy on
-- `thread_participants` would recurse through itself.
create or replace function auth_in_thread(p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.thread_participants p
    where p.thread_id = p_thread
      and p.user_id = public.auth_user_id()
  );
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table message_threads enable row level security;
alter table thread_participants enable row level security;
alter table messages enable row level security;
alter table message_reports enable row level security;

-- Participation, not org membership, is what grants access. A manager who is not in the thread does
-- not read it — the same reasoning as notifications: this is correspondence, not fleet data.
drop policy if exists threads_participant on message_threads;
create policy threads_participant on message_threads for select
  using (org_id = auth_org_id() and auth_in_thread(id));

drop policy if exists participants_visible on thread_participants;
create policy participants_visible on thread_participants for select
  using (org_id = auth_org_id() and auth_in_thread(thread_id));

-- A participant may move THEIR OWN read boundary and nobody else's.
drop policy if exists participants_own_read on thread_participants;
create policy participants_own_read on thread_participants for update
  using (org_id = auth_org_id() and user_id = auth_user_id())
  with check (org_id = auth_org_id() and user_id = auth_user_id());

-- Nobody adds themselves to a conversation. Threads and their membership are created by the API,
-- which decides the audience — otherwise any user could join any thread by inserting a row.
-- There is deliberately no INSERT or DELETE policy on thread_participants.

drop policy if exists messages_in_thread on messages;
create policy messages_in_thread on messages for select
  using (org_id = auth_org_id() and auth_in_thread(thread_id));

-- Write only as yourself, and only into a thread you are in.
drop policy if exists messages_send on messages;
create policy messages_send on messages for insert
  with check (
    org_id = auth_org_id()
    and sender_user_id = auth_user_id()
    and auth_in_thread(thread_id)
  );

-- Edit or soft-delete only your OWN message. The trigger below stops the soft-delete becoming a hard
-- one, and stops anybody rewriting somebody else's words.
drop policy if exists messages_own_update on messages;
create policy messages_own_update on messages for update
  using (org_id = auth_org_id() and sender_user_id = auth_user_id())
  with check (org_id = auth_org_id() and sender_user_id = auth_user_id());

drop policy if exists reports_own on message_reports;
create policy reports_own on message_reports for insert
  with check (org_id = auth_org_id() and reported_by = auth_user_id());
-- Admins review the queue; a reporter sees their OWN reports and nobody else's.
--
-- The "own" half is not just courtesy: under RLS an `INSERT … RETURNING` must satisfy the SELECT
-- policy too, so without it the reporting call fails the moment a client asks for the new row back.
-- It also lets the app show "you reported this" instead of silently swallowing the action.
drop policy if exists reports_admin_read on message_reports;
create policy reports_admin_read on message_reports for select
  using (
    org_id = auth_org_id()
    and (auth_role() in ('admin', 'safety_manager') or reported_by = auth_user_id())
  );

-- ── message content is evidence ───────────────────────────────────────────────
-- A dispute about "dispatch told me to" is settled by the message log. A driver may retract their
-- own message (it stops rendering), but the row and its body survive for the audit trail, and a hard
-- DELETE is refused outright — RLS alone would still let a service-role bug erase history.
create or replace function messages_no_hard_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'messages are soft-deleted (set deleted_at), never removed' using errcode = 'MG001';
end;
$$;
drop trigger if exists trg_messages_no_hard_delete on messages;
create trigger trg_messages_no_hard_delete
  before delete on messages
  for each row execute function messages_no_hard_delete();

/** Keep the thread's recency in sync so an inbox sorts without a subquery per row. */
create or replace function bump_thread_recency()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.message_threads
     set last_message_at = new.created_at
   where id = new.thread_id and last_message_at < new.created_at;
  return new;
end;
$$;
drop trigger if exists trg_bump_thread_recency on messages;
create trigger trg_bump_thread_recency
  after insert on messages
  for each row execute function bump_thread_recency();

/** Unread count for one participant — the badge, computed where the data is. */
create or replace function thread_unread_count(p_thread uuid, p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.messages m
  join public.thread_participants p
    on p.thread_id = m.thread_id and p.user_id = p_user
  where m.thread_id = p_thread
    and m.deleted_at is null
    and m.sender_user_id is distinct from p_user
    and (p.last_read_at is null or m.created_at > p.last_read_at);
$$;

-- ── realtime ──────────────────────────────────────────────────────────────────
-- The inbound half of D54. Guarded because the publication only exists on a real Supabase project —
-- the offline RLS matrix runs on bare PGlite, where this is a no-op rather than a failure.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table messages;
  end if;
exception
  when duplicate_object then null;
end $$;
