-- Silvicom 360 — 0511 office chat: one messaging engine, sequenced, versioned and ledgered
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH1a; D-CHAT1, D-CHAT3, D-CHAT5, D-CHAT12, D-CHAT13)
--
-- The owner asked on 2026-10-23 for a Teams-style chat between the people in the office, sized for "more
-- and more users", enterprise grade, with "good audit logs and Admin to be able to audit messages".
-- 0096 already built office↔driver messaging with the right access model (participation, not role)
-- and it has carried 0 messages in production (measured the same day), so this EXTENDS it rather than
-- building a second engine beside it (D-CHAT1). What 0096 lacked at office scale, and what this adds:
--
--   1. KIND. A thread is `driver` (0096's office↔driver conversation, unchanged), `direct` (two
--      people, at most one per pair: `direct_key`), `group`, or `channel` (CH5). Existing rows are
--      `driver` by default, which is what every one of them is.
--
--   2. SEQUENCE AND REVISION (D-CHAT5). Each message gets `seq`, its ordinal in the conversation,
--      assigned by a BEFORE INSERT trigger that increments `message_threads.last_seq` — the row lock on
--      the thread serialises one conversation's writers, nobody else's. Unread becomes
--      `last_seq − read_seq` instead of a count over messages (0096's `listThreads` read EVERY message
--      of every thread on every poll, and PostgREST stops at 1,000 rows without saying so). `rev` is a
--      second counter that moves on ANY change — a new message, an edit, a retraction — so a client
--      that knows rev N asks "what changed since N" and gets edits too, which an ordinal cannot give.
--
--   3. VERSIONS (D-CHAT13). An edit used to overwrite the body; `edited_at` said it changed, not what
--      it said. A BEFORE UPDATE trigger now copies the previous body into `message_versions` — in the
--      database, so no code path (service role included) can edit without leaving the old words.
--      Messages also become immutable in everything but body/edited_at/deleted_at: a message cannot
--      move thread, change author or change time, and a retraction cannot be taken back.
--
--   4. THE LEDGER (D-CHAT12). `chat_ledger` is one append-only, hash-chained record per org of every
--      chat fact: a conversation created/renamed/archived, a member added/left/removed, a message sent
--      (with the SHA-256 of its body), edited (old and new hashes), retracted. It is written by
--      TRIGGERS on the three tables, so it is complete whatever wrote them. The chain is computed by
--      the ledger's own BEFORE INSERT trigger — `seq` gapless per org, `prev_hash`, `hash =
--      sha256(prev_hash || canonical row)` — under `pg_advisory_xact_lock` per org, so two writers can
--      never fork it and two orgs never wait on each other. UPDATE/DELETE/TRUNCATE are refused for
--      every caller, the service role included (CL001), with 0395's one exception: the schema owner in
--      a transaction that declared `set local silvicom.chat_retention` (CHA3's purge, reviewed). That is
--      what makes it TAMPER-EVIDENT rather than merely protected: `chat_ledger_verify()` (0512)
--      recomputes the chain and each live message's hash, so a person with raw database access who
--      disables the triggers and rewrites a row is caught by the nightly verifier (CHA1).
--      `audit_logs` was not the home: 5.07 M rows / 1.23 GB already (2026-10-23), and a chat line is
--      not an administrative act. Administrative acts (compliance access, exports, holds) go to BOTH.
--
--   5. ALL WRITES THROUGH THE API (D-CHAT3). 0096 gave the browser INSERT on `messages`, UPDATE on its
--      own messages and on its own read boundary, and INSERT on reports. Nothing uses any of them
--      (searched 2026-10-23: apps/web, apps/driver, apps/admin write through /api/messages), and each is
--      a path around the rate limit, the notification and the audit. Dropped. SELECT stays: the driver
--      app's Postgres Changes subscription is authorised by it.
--
--   6. LEAVING. `left_at` on a participant; `auth_in_thread()` now requires it to be null, so a person
--      who left reads nothing through RLS, and 0512's functions apply the same predicate.
--
-- WHY THE LEDGER HAS NO FOREIGN KEYS: it must outlive what it describes. A user deleted from
-- auth.users would `set null` the actor — an UPDATE the ledger refuses — and a cascade from a message
-- would delete the very evidence. Ids are plain uuids; `org_id` alone references organizations, and
-- deleting an org already needs the declared retention transaction (as `audit_logs` since 0395).
--
-- WHO THE ACTOR IS: a message's actor is its sender. For membership and thread changes the writer
-- declares itself with `set local silvicom.chat_actor = '<uuid>'` (0512's functions do); without it the
-- actor is null, which the ledger records honestly as "not declared" rather than guessing.
--
-- Rollback: drop the triggers and functions below, drop tables chat_ledger and message_versions, drop
-- the added columns, re-create 0096's four write policies and its `auth_in_thread()`. Nothing outside
-- the database reads any of this until CH1b, which must be reverted first.

-- ── 1. Columns ──────────────────────────────────────────────────────────────────────────────────

alter table message_threads
  add column if not exists kind        text   not null default 'driver',
  add column if not exists direct_key  text,
  add column if not exists last_seq    bigint not null default 0,
  add column if not exists rev         bigint not null default 0,
  add column if not exists archived_at timestamptz;

alter table message_threads
  add constraint message_threads_kind_check check (kind in ('driver', 'direct', 'group', 'channel')),
  -- A direct conversation is exactly the one with a pair key; nothing else may carry one.
  add constraint message_threads_direct_key_check check ((kind = 'direct') = (direct_key is not null));

create unique index if not exists uq_threads_direct_pair on message_threads (org_id, direct_key)
  where direct_key is not null;

alter table thread_participants
  add column if not exists member_role text   not null default 'member',
  add column if not exists read_seq    bigint not null default 0,
  add column if not exists left_at     timestamptz,
  add column if not exists muted       text   not null default 'none';

alter table thread_participants
  add constraint thread_participants_member_role_check check (member_role in ('owner', 'member')),
  add constraint thread_participants_muted_check check (muted in ('none', 'mentions', 'all'));

-- The inbox asks "every conversation this person is still in", newest first.
create index if not exists idx_participants_active on thread_participants (user_id, org_id)
  where left_at is null;

alter table messages
  add column if not exists seq bigint,
  add column if not exists rev bigint;

-- 0 rows in production (2026-10-23); staging and local may hold test rows, numbered here in time order.
with numbered as (
  select id, row_number() over (partition by thread_id order by created_at, id) as n
  from messages
)
update messages m set seq = numbered.n, rev = numbered.n from numbered where numbered.id = m.id;

update message_threads t
   set last_seq = coalesce((select max(m.seq) from messages m where m.thread_id = t.id), 0),
       rev      = coalesce((select max(m.rev) from messages m where m.thread_id = t.id), 0);

alter table messages
  alter column seq set not null,
  alter column rev set not null;

create unique index if not exists uq_messages_thread_seq on messages (thread_id, seq);
create index if not exists idx_messages_thread_rev on messages (thread_id, rev);

-- ── 2. message_versions: the words an edit replaced ────────────────────────────────────────────

create table if not exists message_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  -- No FK to messages: a message is never hard-deleted (MG001), and the version must not depend on
  -- that staying true.
  message_id  uuid not null,
  thread_id   uuid not null,
  version     integer not null,
  body        text not null,
  -- Who replaced these words (the message's sender, or the declared actor), and when.
  replaced_by uuid,
  replaced_at timestamptz not null default now(),
  unique (message_id, version)
);
create index if not exists idx_message_versions_message on message_versions (message_id, version);

alter table message_versions enable row level security;
-- No policies: written by trigger, read by the compliance console through the service role (CHA2).

-- ── 3. chat_ledger ──────────────────────────────────────────────────────────────────────────────

create table if not exists chat_ledger (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  -- seq, prev_hash and hash are always computed by trg_chat_ledger_chain; the defaults only let a
  -- writer leave them out, and the shape check runs after the trigger has filled them.
  seq             bigint not null default 0,
  occurred_at     timestamptz not null default now(),
  actor_user_id   uuid,
  action          text not null,
  thread_id       uuid,
  message_id      uuid,
  subject_user_id uuid,
  -- SHA-256 hex of the message body the row is about (sent: the body; edited: the NEW body, and
  -- `detail.previous_sha256` the old one). The verifier compares the live body against the latest.
  body_sha256     text,
  detail          jsonb not null default '{}',
  prev_hash       text not null default '',
  hash            text not null default '',
  unique (org_id, seq),
  constraint chat_ledger_action_check check (action in (
    'conversation_created', 'conversation_renamed', 'conversation_archived', 'conversation_restored',
    'member_added', 'member_left', 'member_rejoined', 'member_removed', 'member_role_changed',
    'message_sent', 'message_edited', 'message_retracted',
    'compliance_search', 'compliance_view', 'compliance_export',
    'hold_set', 'hold_released', 'retention_changed', 'retention_purged'
  )),
  constraint chat_ledger_hash_shape check (hash ~ '^[0-9a-f]{64}$' and prev_hash ~ '^[0-9a-f]{64}$')
);
create index if not exists idx_chat_ledger_thread on chat_ledger (org_id, thread_id, seq) where thread_id is not null;
create index if not exists idx_chat_ledger_message on chat_ledger (message_id, seq) where message_id is not null;

alter table chat_ledger enable row level security;
-- No policies (deny-all to clients): read by the compliance console and the verifier, service role.

-- The canonical text a row's hash covers. jsonb's text form is deterministic (keys ordered), and the
-- timestamp is rendered in UTC explicitly so the session TimeZone cannot change a hash.
create or replace function chat_ledger_canonical(
  p_org uuid, p_seq bigint, p_at timestamptz, p_actor uuid, p_action text, p_thread uuid,
  p_message uuid, p_subject uuid, p_body_sha256 text, p_detail jsonb
) returns text
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'org', p_org, 'seq', p_seq,
    'at', to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor', p_actor, 'action', p_action, 'thread', p_thread, 'message', p_message,
    'subject', p_subject, 'body', p_body_sha256, 'detail', coalesce(p_detail, '{}'::jsonb)
  )::text;
$$;

create or replace function chat_sha256(p_text text) returns text
language sql immutable set search_path = ''
as $$ select encode(sha256(convert_to(p_text, 'UTF8')), 'hex'); $$;

-- The append IS this trigger: whatever a caller puts in seq/prev_hash/hash/occurred_at is replaced,
-- so every path that reaches the table — the triggers below, 0512's functions, a hand-written insert —
-- produces a valid link.
create or replace function chat_ledger_chain() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_last record;
begin
  perform pg_advisory_xact_lock(hashtext('chat_ledger'), hashtext(new.org_id::text));
  select l.seq, l.hash into v_last
    from public.chat_ledger l where l.org_id = new.org_id order by l.seq desc limit 1;
  new.seq := coalesce(v_last.seq, 0) + 1;
  new.prev_hash := coalesce(v_last.hash, repeat('0', 64));
  new.occurred_at := now();
  new.detail := coalesce(new.detail, '{}'::jsonb);
  new.hash := public.chat_sha256(new.prev_hash || public.chat_ledger_canonical(
    new.org_id, new.seq, new.occurred_at, new.actor_user_id, new.action, new.thread_id,
    new.message_id, new.subject_user_id, new.body_sha256, new.detail));
  return new;
end;
$$;

drop trigger if exists trg_chat_ledger_chain on chat_ledger;
create trigger trg_chat_ledger_chain before insert on chat_ledger
  for each row execute function chat_ledger_chain();

-- Append-only for everyone, the 0395 shape: the one exception is the schema owner inside a transaction
-- that declared itself retention work.
create or replace function chat_records_append_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin')
     and coalesce(current_setting('silvicom.chat_retention', true), '') <> '' then
    return case tg_op when 'DELETE' then old when 'TRUNCATE' then null else new end;
  end if;
  raise exception '% is append-only: chat records are never changed or removed (D-CHAT12)', tg_table_name
    using errcode = 'CL001';
end;
$$;

drop trigger if exists trg_chat_ledger_append_only on chat_ledger;
create trigger trg_chat_ledger_append_only before update or delete on chat_ledger
  for each row execute function chat_records_append_only();
drop trigger if exists trg_chat_ledger_no_truncate on chat_ledger;
create trigger trg_chat_ledger_no_truncate before truncate on chat_ledger
  for each statement execute function chat_records_append_only();

drop trigger if exists trg_message_versions_append_only on message_versions;
create trigger trg_message_versions_append_only before update or delete on message_versions
  for each row execute function chat_records_append_only();
drop trigger if exists trg_message_versions_no_truncate on message_versions;
create trigger trg_message_versions_no_truncate before truncate on message_versions
  for each statement execute function chat_records_append_only();

-- The declared actor, or null.
create or replace function chat_declared_actor() returns uuid
language sql stable set search_path = ''
as $$ select nullif(current_setting('silvicom.chat_actor', true), '')::uuid; $$;

-- ── 4. Messages: sequence on insert, integrity and versions on update ───────────────────────────

create or replace function messages_sequence() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- A sender must be in the conversation now. Null is a system line (0096 allowed it; nothing writes one yet).
  if new.sender_user_id is not null and not exists (
    select 1 from public.thread_participants p
     where p.thread_id = new.thread_id and p.user_id = new.sender_user_id and p.left_at is null
  ) then
    raise exception 'sender is not in this conversation' using errcode = 'CH001';
  end if;

  update public.message_threads t
     set last_seq = t.last_seq + 1,
         rev = t.rev + 1,
         last_message_at = greatest(t.last_message_at, new.created_at)
   where t.id = new.thread_id and t.org_id = new.org_id
  returning t.last_seq, t.rev into new.seq, new.rev;
  if new.seq is null then
    raise exception 'conversation % not found in this organisation', new.thread_id using errcode = 'CH001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_messages_sequence on messages;
create trigger trg_messages_sequence before insert on messages
  for each row execute function messages_sequence();

-- 0096's recency trigger is folded into the one above (same transaction, same row lock).
drop trigger if exists trg_bump_thread_recency on messages;

create or replace function messages_guard_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_version integer;
begin
  if new.id <> old.id or new.thread_id <> old.thread_id or new.org_id <> old.org_id
     or new.created_at <> old.created_at or new.seq <> old.seq
     -- The one permitted change of author: the auth.users FK's `on delete set null`.
     or (new.sender_user_id is distinct from old.sender_user_id and new.sender_user_id is not null) then
    raise exception 'a message cannot change conversation, author, time or position' using errcode = 'CH003';
  end if;
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'a retracted message stays retracted' using errcode = 'CH004';
  end if;
  if new.body is distinct from old.body then
    if old.deleted_at is not null then
      raise exception 'a retracted message cannot be edited' using errcode = 'CH004';
    end if;
    select coalesce(max(v.version), 0) + 1 into v_version
      from public.message_versions v where v.message_id = old.id;
    insert into public.message_versions (org_id, message_id, thread_id, version, body, replaced_by)
    values (old.org_id, old.id, old.thread_id, v_version, old.body,
            coalesce(public.chat_declared_actor(), old.sender_user_id));
    new.edited_at := now();
  end if;
  if new.body is distinct from old.body or new.deleted_at is distinct from old.deleted_at then
    update public.message_threads t set rev = t.rev + 1 where t.id = old.thread_id
    returning t.rev into new.rev;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_messages_guard_update on messages;
create trigger trg_messages_guard_update before update on messages
  for each row execute function messages_guard_update();

-- ── 5. Ledger writers ───────────────────────────────────────────────────────────────────────────

create or replace function chat_ledger_messages() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Sending is reading: the author's boundary moves to their own message (Teams marks a
    -- conversation read when you reply), so unread = last_seq − read_seq never counts your own words.
    update public.thread_participants p
       set read_seq = greatest(p.read_seq, new.seq), last_read_at = now()
     where p.thread_id = new.thread_id and p.user_id = new.sender_user_id;
    insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, message_id, body_sha256, detail)
    values (new.org_id, new.sender_user_id, 'message_sent', new.thread_id, new.id,
            public.chat_sha256(new.body), jsonb_build_object('seq', new.seq));
  elsif new.deleted_at is not null and old.deleted_at is null then
    insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, message_id, body_sha256, detail)
    values (new.org_id, coalesce(public.chat_declared_actor(), new.sender_user_id), 'message_retracted',
            new.thread_id, new.id, public.chat_sha256(new.body), '{}'::jsonb);
  elsif new.body is distinct from old.body then
    insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, message_id, body_sha256, detail)
    values (new.org_id, coalesce(public.chat_declared_actor(), new.sender_user_id), 'message_edited',
            new.thread_id, new.id, public.chat_sha256(new.body),
            jsonb_build_object('previous_sha256', public.chat_sha256(old.body)));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_chat_ledger_messages on messages;
create trigger trg_chat_ledger_messages after insert or update on messages
  for each row execute function chat_ledger_messages();

create or replace function chat_ledger_threads() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'conversation_created';
  elsif new.archived_at is not null and old.archived_at is null then
    v_action := 'conversation_archived';
  elsif new.archived_at is null and old.archived_at is not null then
    v_action := 'conversation_restored';
  elsif new.subject is distinct from old.subject then
    v_action := 'conversation_renamed';
  else
    return null;
  end if;
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, detail)
  values (new.org_id, coalesce(public.chat_declared_actor(), new.created_by), v_action, new.id,
          jsonb_build_object('kind', new.kind, 'subject', new.subject, 'load_id', new.load_id));
  return null;
end;
$$;

drop trigger if exists trg_chat_ledger_threads on message_threads;
create trigger trg_chat_ledger_threads after insert or update of subject, archived_at on message_threads
  for each row execute function chat_ledger_threads();

create or replace function chat_ledger_participants() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.thread_participants;
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_row := new; v_action := 'member_added';
  elsif tg_op = 'DELETE' then
    v_row := old; v_action := 'member_removed';
  elsif new.left_at is not null and old.left_at is null then
    -- Taken out by somebody else is a removal; walking out yourself is leaving.
    v_row := new;
    v_action := case when public.chat_declared_actor() is distinct from new.user_id
                     and public.chat_declared_actor() is not null then 'member_removed' else 'member_left' end;
  elsif new.left_at is null and old.left_at is not null then
    v_row := new; v_action := 'member_rejoined';
  elsif new.member_role is distinct from old.member_role then
    v_row := new; v_action := 'member_role_changed';
  else
    return null;
  end if;
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, subject_user_id, detail)
  values (v_row.org_id, public.chat_declared_actor(), v_action, v_row.thread_id, v_row.user_id,
          jsonb_build_object('role', v_row.role, 'member_role', v_row.member_role));
  return null;
end;
$$;

drop trigger if exists trg_chat_ledger_participants on thread_participants;
create trigger trg_chat_ledger_participants after insert or delete or update of left_at, member_role on thread_participants
  for each row execute function chat_ledger_participants();

revoke all on function chat_ledger_canonical(uuid, bigint, timestamptz, uuid, text, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function chat_sha256(text) from public, anon, authenticated;
revoke all on function chat_declared_actor() from public, anon, authenticated;
revoke all on function chat_ledger_chain() from public, anon, authenticated;
revoke all on function chat_records_append_only() from public, anon, authenticated;
revoke all on function messages_sequence() from public, anon, authenticated;
revoke all on function messages_guard_update() from public, anon, authenticated;
revoke all on function chat_ledger_messages() from public, anon, authenticated;
revoke all on function chat_ledger_threads() from public, anon, authenticated;
revoke all on function chat_ledger_participants() from public, anon, authenticated;

-- ── 6. Access: a person who left reads nothing; the browser writes nothing ─────────────────────

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
      and p.left_at is null
  );
$$;

drop policy if exists messages_send on messages;
drop policy if exists messages_own_update on messages;
drop policy if exists participants_own_read on thread_participants;
drop policy if exists reports_own on message_reports;
-- 0096 widened the report read policy to the reporter for INSERT … RETURNING; with no client insert
-- left, the reporter half has nothing to serve, but it is a read of the caller's own rows and stays.

-- ── 7. The ledger starts complete ───────────────────────────────────────────────────────────────
-- Rows that existed before this migration (0 in production; test rows on staging and locally) enter
-- the ledger now, in time order, marked as backfilled, so the verifier's "every message has a ledger
-- entry" holds from the first night instead of failing on history it never saw.
insert into chat_ledger (org_id, action, thread_id, actor_user_id, detail)
select t.org_id, 'conversation_created', t.id, t.created_by,
       jsonb_build_object('kind', t.kind, 'subject', t.subject, 'load_id', t.load_id, 'backfilled', true)
  from message_threads t order by t.created_at, t.id;

insert into chat_ledger (org_id, action, thread_id, subject_user_id, detail)
select p.org_id, 'member_added', p.thread_id, p.user_id,
       jsonb_build_object('role', p.role, 'member_role', p.member_role, 'backfilled', true)
  from thread_participants p order by p.joined_at, p.thread_id, p.user_id;

insert into chat_ledger (org_id, action, thread_id, message_id, actor_user_id, body_sha256, detail)
select m.org_id, 'message_sent', m.thread_id, m.id, m.sender_user_id, chat_sha256(m.body),
       jsonb_build_object('seq', m.seq, 'backfilled', true)
  from messages m order by m.created_at, m.id;

-- ── 8. The office write budget (D-CHAT8) ───────────────────────────────────────────────────────
-- cross-module-waiver: driver-app's per-person write counter gains one bucket value for messaging's
-- office chat; the table, its function and its writer (driverWriteLimit.ts) stay driver-app's.
-- Office chat writes get their own daily counter, `chat_message` (60 a minute, 3,000 a day), in the
-- per-user counter 0149 built for D57: it is keyed on the person, not on being a driver, and a second
-- counter table would be the same table twice. The driver budget (`message`, 300 a day) stays the
-- driver's. Widened here, in the migration before the API that bumps it (CH1b), because a bump the
-- constraint refuses fails OPEN by design (driverWriteLimit.ts) — it would let every send through
-- silently instead of failing.
alter table driver_write_counters drop constraint if exists driver_write_counters_bucket_check;
alter table driver_write_counters add constraint driver_write_counters_bucket_check
  check (bucket in ('shift', 'load_action', 'stop_capture', 'message', 'chat_message'));
