-- Silvicom 360 — 0518 office chat: teams, channels and replies — the schema
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH5a; D-CHAT1, D-CHAT17, D-CHAT18, D-CHAT19)
--
-- Release 1 gave the office direct and group chat. "Like Teams" also means TEAMS — Dispatch, Safety,
-- Shop, Accounting — each holding CHANNELS, and channel posts that carry their own REPLIES. This is
-- the schema for all three; 0519 is the functions that are its only writers.
--
--   1. A TEAM is `chat_spaces`, its people `chat_space_members` (owner or member, `left_at` when they
--      leave — a row is never deleted, so the ledger and the console always know who was in a team).
--      Teams are made by holders of the `chat.teams` permission (D-CHAT17, a Permissions-page
--      surface); the API asks it, the functions record who did it.
--
--   2. A CHANNEL is a conversation (D-CHAT18): a `message_threads` row of kind `channel` with a
--      `space_id` and a `visibility`. Joining one is becoming a participant, so everything release 1
--      built — `auth_in_thread()`, sync, the realtime signals, the ledger triggers, the compliance
--      console — works on a channel unchanged. Every team has exactly one public `general` channel,
--      which every team member is in and cannot leave.
--
--   3. A REPLY is a message (D-CHAT19) with `parent_id` naming a top-level post in the same channel,
--      one level deep. It takes the conversation's next `seq` and `rev`, so the log stays one ordered
--      sequence; the post keeps `reply_count` and `last_reply_at` so the channel view can show
--      "4 replies, last 2:10 PM" without counting. A post's reply counters are maintained by trigger
--      and move nothing else: no `rev`, no signal, no ledger row (0511's update guard and 0513's
--      signal look only at the body and the retraction).
--
-- THE LEDGER hears of teams as it hears of conversations: by trigger, whatever wrote them. Seven new
-- actions; a team fact has no `thread_id`, and names its team in `detail.space_id`. A channel's
-- creation, rename and archive are the existing conversation actions, now carrying the team and the
-- visibility in their detail.
--
-- NOTHING READS THESE COLUMNS outside the database until CH5b; the API keeps calling the same
-- functions with the same arguments (`chat_history` and `chat_sync` gain three output columns in 0519,
-- which the API's schemas drop), so the old code meets this schema safely in the deploy window.
--
-- Rollback: drop 0519's functions, the triggers and columns below, the two tables, and restore the
-- ledger's action check and `chat_ledger_threads()` from 0511. Empty until CH5b writes them.

-- ── 1. Teams ────────────────────────────────────────────────────────────────────────────────────
create table if not exists chat_spaces (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 500),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
-- One live team of a name per org ("Dispatch" twice is a mistake, not a choice); an archived team's
-- name is free again.
create unique index if not exists uq_chat_spaces_name on chat_spaces (org_id, lower(btrim(name))) where archived_at is null;
create index if not exists idx_chat_spaces_org on chat_spaces (org_id, created_at);

create table if not exists chat_space_members (
  space_id   uuid not null references chat_spaces(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  space_role text not null default 'member' check (space_role in ('owner', 'member')),
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  primary key (space_id, user_id)
);
create index if not exists idx_chat_space_members_user on chat_space_members (user_id, org_id) where left_at is null;

alter table chat_spaces enable row level security;
alter table chat_space_members enable row level security;
-- No policies: read and written through 0519's functions with the service role, as every chat table.

-- A team and its membership rows are never deleted, only archived or left — except by the declared
-- retention transaction (0511), which is what deleting a whole organisation needs.
drop trigger if exists trg_chat_spaces_no_delete on chat_spaces;
create trigger trg_chat_spaces_no_delete before delete on chat_spaces
  for each row execute function chat_records_append_only();
drop trigger if exists trg_chat_space_members_no_delete on chat_space_members;
create trigger trg_chat_space_members_no_delete before delete on chat_space_members
  for each row execute function chat_records_append_only();

-- ── 2. Channels ─────────────────────────────────────────────────────────────────────────────────
alter table message_threads
  add column if not exists space_id   uuid references chat_spaces(id) on delete cascade,
  add column if not exists visibility text,
  add column if not exists general    boolean not null default false;

alter table message_threads
  add constraint message_threads_visibility_check check (visibility is null or visibility in ('public', 'private')),
  -- General is a public channel.
  add constraint message_threads_general_shape check (not general or (kind = 'channel' and visibility = 'public'));

-- A channel is exactly a thread in a team, with a visibility; nothing else carries either.
-- NOT VALID, so it binds every row written from here on but does not judge the rows already there.
-- Staging holds kind = 'channel' rows with no team: scripts/chat-load-test.mjs once inserted its
-- 300-member "Load test channel" straight into message_threads, before any function could make a
-- channel, and the first staging run of this file (2026-10-24, run 40118890753) failed on them with
-- SQLSTATE 23514. Production has no channel rows. Validating would mean rewriting the kind of a
-- conversation chat_ledger has already recorded, which is a history edit (D-CHAT12), so the old rows
-- stay as they were written and the load test now makes its channel through chat_team_create.
alter table message_threads
  add constraint message_threads_channel_shape check (
    (kind = 'channel') = (space_id is not null) and (kind = 'channel') = (visibility is not null)) not valid;

create unique index if not exists uq_threads_space_general on message_threads (space_id) where general;
-- One live channel of a name per team.
create unique index if not exists uq_threads_channel_name on message_threads (space_id, lower(btrim(subject)))
  where kind = 'channel' and archived_at is null;
create index if not exists idx_threads_space on message_threads (space_id, last_message_at desc) where space_id is not null;

-- ── 3. Replies ──────────────────────────────────────────────────────────────────────────────────
alter table messages
  add column if not exists parent_id     uuid references messages(id),
  add column if not exists reply_count   integer not null default 0 check (reply_count >= 0),
  add column if not exists last_reply_at timestamptz;

-- The channel view pages top-level posts; the reply pane pages one post's replies.
create index if not exists idx_messages_top_level on messages (thread_id, seq) where parent_id is null;
create index if not exists idx_messages_replies on messages (parent_id, seq) where parent_id is not null;

-- A reply answers a top-level post of the same channel, one level deep, and never a retracted one.
-- Named to sort before `trg_messages_sequence`, so a refused reply never takes a sequence number.
create or replace function messages_reply_check() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_parent public.messages;
  v_kind text;
begin
  if new.parent_id is null then
    return new;
  end if;
  select m.* into v_parent from public.messages m where m.id = new.parent_id;
  if v_parent.id is null or v_parent.thread_id <> new.thread_id then
    raise exception 'a reply answers a post in the same conversation' using errcode = 'CH011';
  end if;
  if v_parent.parent_id is not null then
    raise exception 'replies do not nest: answer the post' using errcode = 'CH011';
  end if;
  if v_parent.deleted_at is not null then
    raise exception 'that post was retracted' using errcode = 'CH011';
  end if;
  select t.kind into v_kind from public.message_threads t where t.id = new.thread_id;
  if v_kind is distinct from 'channel' then
    raise exception 'replies are for channel posts' using errcode = 'CH011';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_messages_reply_check on messages;
create trigger trg_messages_reply_check before insert on messages
  for each row execute function messages_reply_check();

create or replace function messages_reply_counters() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.parent_id is not null then
    update public.messages m
       set reply_count = m.reply_count + 1, last_reply_at = greatest(m.last_reply_at, new.created_at)
     where m.id = new.parent_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_messages_reply_counters on messages;
create trigger trg_messages_reply_counters after insert on messages
  for each row execute function messages_reply_counters();

-- `parent_id` is part of what a message IS: 0511's guard keeps conversation, author, time and position,
-- and this keeps the post a reply answers.
create or replace function messages_parent_immutable() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.parent_id is distinct from old.parent_id then
    raise exception 'a reply cannot move to another post' using errcode = 'CH003';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_messages_parent_immutable on messages;
create trigger trg_messages_parent_immutable before update of parent_id on messages
  for each row execute function messages_parent_immutable();

-- ── 4. The ledger ───────────────────────────────────────────────────────────────────────────────
alter table chat_ledger drop constraint if exists chat_ledger_action_check;
alter table chat_ledger add constraint chat_ledger_action_check check (action in (
  'conversation_created', 'conversation_renamed', 'conversation_archived', 'conversation_restored',
  'member_added', 'member_left', 'member_rejoined', 'member_removed', 'member_role_changed',
  'message_sent', 'message_edited', 'message_retracted',
  'compliance_search', 'compliance_view', 'compliance_export',
  'hold_set', 'hold_released', 'retention_changed', 'retention_purged',
  'team_created', 'team_renamed', 'team_archived',
  'team_member_added', 'team_member_left', 'team_member_removed', 'team_member_rejoined', 'team_role_changed'
));

-- 0511's conversation writer, now naming a channel's team, visibility and whether it is General. Other
-- conversations' rows keep exactly 0511's shape; the canonical row hashes `detail` as stored, so every
-- older row verifies as it was written.
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
          jsonb_build_object('kind', new.kind, 'subject', new.subject, 'load_id', new.load_id)
          || case when new.kind = 'channel'
                  then jsonb_build_object('space_id', new.space_id, 'visibility', new.visibility, 'general', new.general)
                  else '{}'::jsonb end);
  return null;
end;
$$;

create or replace function chat_ledger_spaces() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'team_created';
  elsif new.archived_at is not null and old.archived_at is null then
    v_action := 'team_archived';
  elsif new.name is distinct from old.name or new.description is distinct from old.description then
    v_action := 'team_renamed';
  else
    return null;
  end if;
  insert into public.chat_ledger (org_id, actor_user_id, action, detail)
  values (new.org_id, coalesce(public.chat_declared_actor(), new.created_by), v_action,
          jsonb_strip_nulls(jsonb_build_object('space_id', new.id, 'name', new.name, 'description', new.description)));
  return null;
end;
$$;

drop trigger if exists trg_chat_ledger_spaces on chat_spaces;
create trigger trg_chat_ledger_spaces after insert or update of name, description, archived_at on chat_spaces
  for each row execute function chat_ledger_spaces();

create or replace function chat_ledger_space_members() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'team_member_added';
  elsif new.left_at is not null and old.left_at is null then
    v_action := case when public.chat_declared_actor() is distinct from new.user_id
                     and public.chat_declared_actor() is not null then 'team_member_removed' else 'team_member_left' end;
  elsif new.left_at is null and old.left_at is not null then
    v_action := 'team_member_rejoined';
  elsif new.space_role is distinct from old.space_role then
    v_action := 'team_role_changed';
  else
    return null;
  end if;
  insert into public.chat_ledger (org_id, actor_user_id, action, subject_user_id, detail)
  values (new.org_id, public.chat_declared_actor(), v_action, new.user_id,
          jsonb_build_object('space_id', new.space_id, 'space_role', new.space_role));
  return null;
end;
$$;

drop trigger if exists trg_chat_ledger_space_members on chat_space_members;
create trigger trg_chat_ledger_space_members after insert or update of left_at, space_role on chat_space_members
  for each row execute function chat_ledger_space_members();

revoke all on function messages_reply_check() from public, anon, authenticated;
revoke all on function messages_reply_counters() from public, anon, authenticated;
revoke all on function messages_parent_immutable() from public, anon, authenticated;
revoke all on function chat_ledger_threads() from public, anon, authenticated;
revoke all on function chat_ledger_spaces() from public, anon, authenticated;
revoke all on function chat_ledger_space_members() from public, anon, authenticated;
