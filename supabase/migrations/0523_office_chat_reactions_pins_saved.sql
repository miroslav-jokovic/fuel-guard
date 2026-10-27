-- Silvicom 360 — 0523 office chat: reactions, pins and saved lines
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH6c-1; D-CHAT24, D-CHAT26)
--
-- The last three things CH6 owes a Teams user: answer a line without writing one (👍 on "truck 12 is
-- loaded"), keep the line everybody needs at the top of a conversation, and keep a line for yourself to
-- come back to. Measured before this file (§9.2): none of them has a table, a column or a line of code.
-- This is the schema and the functions; the API and the web are CH6c-2, the next merge.
--
--   1. REACTIONS ARE SIX, FIXED (D-CHAT26): 👍 ❤️ 😂 😮 😢 ✅. Stored as keys, not as emoji, so the CHECK
--      below and `CHAT_REACTIONS` in the shared contract can be held together by a parity test, as the
--      notification categories are. One of a kind per person per line — the primary key — so pressing
--      👍 twice is one 👍. A free picker later widens one list, not the table.
--
--   2. A PIN IS THE CONVERSATION'S, NOT A PERSON'S: one row per line, set and taken off by anybody in
--      it, as in a Teams chat.
--
--   3. REACTIONS AND PINS ARE CONVERSATION ACTS (D-CHAT24). Everybody in it sees them, so each one is
--      ledgered — four new actions, `reaction_added`/`reaction_removed`/`message_pinned`/
--      `message_unpinned` — and each one bumps the line's `rev`, so `/sync` re-delivers the line to every
--      open tab through the log it already reads (0511), with no new transport. Both are written by
--      TRIGGERS on the two tables, like every other chat fact (0511 §5), so they are complete whatever
--      wrote the row. The realtime signal now also fires on a change of `rev` alone, or a reaction would
--      reach other tabs only at the next poll.
--
--   4. SAVED IS ONE PERSON'S BOOKMARK (D-CHAT24), like `read_seq` and mute: no ledger row, no `rev`, and
--      nobody else — the console included — is ever shown it.
--
--   5. A RETRACTED LINE TAKES NO REACTION AND NO PIN (CH004, the code an edit of one already gets). What it
--      had stays in the tables and the ledger, but the readers stop showing it: a retracted line is drawn
--      as removed, and its 👍 should not outlive its words on screen.
--
--   6. THE FOUR READERS CARRY IT. `chat_history`, `chat_sync`, `chat_channel_posts` and `chat_replies`
--      gain `reactions`, `pinned_at` and `saved` (the caller's own), dropped and re-created by full
--      signature as 0519 did. `chat_pins` lists a conversation's pins; `chat_saved` lists a person's
--      saved lines, newest first, keyset-paged.
--
-- NOT HERE: reactions to your lines in Activity (D-CHAT25's third reason). The API parses Activity's
-- `reason` against `CHAT_ACTIVITY_REASONS` (`mention`, `reply`), so a migration that emits a third
-- reason before the API knows it would fail every Activity request for the deploy minutes. CH6c-2 widens
-- the contract first; the function follows it.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: no function the API calls today changes its arguments; the four
-- readers gain three columns, which the API's row schemas strip (as 0519's three were). The new tables
-- are new; nothing is backfilled. The ledger's CHECK only widens.
--
-- Rollback: drop the triggers and functions below and the three tables; restore 0518's ledger CHECK and
-- 0519's four readers, and 0513's signal trigger column list. CH6c-2's routes call them and must be
-- reverted first.

-- ── 1. Tables ───────────────────────────────────────────────────────────────────────────────────

create table if not exists message_reactions (
  -- A message removed by a declared purge takes its reactions with it; the ledger keeps the facts.
  message_id uuid not null references messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  reaction   text not null,
  -- Copied from the message by the BEFORE trigger, never from the caller, so they cannot disagree.
  org_id     uuid not null references organizations(id) on delete cascade,
  thread_id  uuid not null references message_threads(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, reaction),
  -- D-CHAT26, in `CHAT_REACTIONS`' order; chatReactionCheck.test.ts holds the two together.
  constraint message_reactions_reaction_check check (reaction in (
    'thumbs_up', 'heart', 'laugh', 'surprised', 'sad', 'done'
  ))
);
-- CH6c-2's "reactions to your lines" (D-CHAT25) reads by message; the primary key already leads with it.
create index if not exists idx_message_reactions_thread on message_reactions (thread_id);

alter table message_reactions enable row level security;
-- No policies: written and read by 0523's functions with the service role.

create table if not exists chat_pins (
  message_id uuid primary key references messages(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  thread_id  uuid not null references message_threads(id) on delete cascade,
  pinned_by  uuid references auth.users(id) on delete set null,
  pinned_at  timestamptz not null default now()
);
create index if not exists idx_chat_pins_thread on chat_pins (thread_id, pinned_at desc);

alter table chat_pins enable row level security;
-- No policies: as above.

create table if not exists chat_saved (
  user_id    uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  saved_at   timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index if not exists idx_chat_saved_user on chat_saved (user_id, org_id, saved_at desc);

alter table chat_saved enable row level security;
-- No policies: one person's bookmark, through the functions below with the service role.

-- ── 2. The ledger's four new actions (D-CHAT24) ─────────────────────────────────────────────────

alter table chat_ledger drop constraint if exists chat_ledger_action_check;
alter table chat_ledger add constraint chat_ledger_action_check check (action in (
  'conversation_created', 'conversation_renamed', 'conversation_archived', 'conversation_restored',
  'member_added', 'member_left', 'member_rejoined', 'member_removed', 'member_role_changed',
  'message_sent', 'message_edited', 'message_retracted',
  'compliance_search', 'compliance_view', 'compliance_export',
  'hold_set', 'hold_released', 'retention_changed', 'retention_purged',
  'team_created', 'team_renamed', 'team_archived',
  'team_member_added', 'team_member_left', 'team_member_removed', 'team_member_rejoined', 'team_role_changed',
  'reaction_added', 'reaction_removed', 'message_pinned', 'message_unpinned'
));

-- ── 3. Triggers: the row takes its place from its message, refuses a retracted one, and every
--       add or remove moves the line's `rev` and writes its ledger row ────────────────────────────

-- Shared by reactions and pins: org and conversation come from the message; a retracted line is CH004.
create or replace function chat_line_act_place() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v public.messages;
begin
  select m.* into v from public.messages m where m.id = new.message_id;
  if v.id is null then
    raise exception 'no such message' using errcode = 'CH001';
  end if;
  if v.deleted_at is not null then
    raise exception 'a retracted message takes no reaction or pin' using errcode = 'CH004';
  end if;
  new.org_id := v.org_id;
  new.thread_id := v.thread_id;
  return new;
end;
$$;

drop trigger if exists trg_message_reactions_place on message_reactions;
create trigger trg_message_reactions_place before insert on message_reactions
  for each row execute function chat_line_act_place();
drop trigger if exists trg_chat_pins_place on chat_pins;
create trigger trg_chat_pins_place before insert on chat_pins
  for each row execute function chat_line_act_place();

-- The line's `rev` becomes the conversation's next one (the thread's row lock orders it against every
-- other change there), so `/sync?since_rev=` returns the line once more. 0511's guard lets `rev` move.
-- False when the line itself is gone: a declared purge (CHA3) deleting a message cascades to its
-- reactions and pin, and records that act itself as `retention_purged` — those rows are not taken back
-- one by one, and there is no line left to re-deliver.
create or replace function chat_bump_line(p_message uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_rev bigint;
begin
  update public.message_threads t set rev = t.rev + 1
    from public.messages m
   where m.id = p_message and t.id = m.thread_id
  returning t.rev into v_rev;
  if v_rev is null then
    return false;
  end if;
  update public.messages m set rev = v_rev where m.id = p_message;
  return true;
end;
$$;

create or replace function chat_ledger_reactions() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.message_reactions;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if not public.chat_bump_line(v_row.message_id) then
    return null;
  end if;
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, message_id, subject_user_id, detail)
  values (v_row.org_id,
          case when tg_op = 'DELETE' then coalesce(public.chat_declared_actor(), v_row.user_id) else v_row.user_id end,
          case when tg_op = 'DELETE' then 'reaction_removed' else 'reaction_added' end,
          v_row.thread_id, v_row.message_id, v_row.user_id, jsonb_build_object('reaction', v_row.reaction));
  return null;
end;
$$;

drop trigger if exists trg_chat_ledger_reactions on message_reactions;
create trigger trg_chat_ledger_reactions after insert or delete on message_reactions
  for each row execute function chat_ledger_reactions();

create or replace function chat_ledger_pins() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.chat_pins;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if not public.chat_bump_line(v_row.message_id) then
    return null;
  end if;
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, message_id)
  values (v_row.org_id,
          case when tg_op = 'DELETE' then public.chat_declared_actor() else v_row.pinned_by end,
          case when tg_op = 'DELETE' then 'message_unpinned' else 'message_pinned' end,
          v_row.thread_id, v_row.message_id);
  return null;
end;
$$;

drop trigger if exists trg_chat_ledger_pins on chat_pins;
create trigger trg_chat_ledger_pins after insert or delete on chat_pins
  for each row execute function chat_ledger_pins();

-- 0513/0515's signal, same function, now also on a change of `rev` alone (a reaction, a pin). An edit or
-- a retraction sets `rev` too, and a trigger fires once per row however many listed columns changed.
do $do$
begin
  if not exists (select 1 from pg_namespace where nspname = 'realtime') then
    raise notice '0523: no realtime schema here (PGlite) — chat signal trigger unchanged';
    return;
  end if;
  execute 'drop trigger if exists trg_chat_signal on public.messages';
  execute 'create trigger trg_chat_signal after insert or update of body, deleted_at, rev on public.messages
             for each row execute function public.chat_signal()';
end;
$do$;

-- ── 4. Functions ────────────────────────────────────────────────────────────────────────────────
-- Error codes, beside 0512's, 0519's and 0521's (the API maps them in chat.ts):
--   CH004  the line is retracted (→ 409, as for an edit)
--   CH005  the conversation is archived (→ 409)
--   CH006  not a reaction of the six, or a driver conversation (→ 422)

-- The line, if the caller is in its conversation now and it is office chat's; CH001 / CH006 otherwise.
create or replace function chat_line_for(p_org uuid, p_user uuid, p_message uuid, p_writing boolean)
returns public.messages
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.messages;
  v_thread public.message_threads;
begin
  select m.* into v from public.messages m where m.id = p_message and m.org_id = p_org;
  if v.id is null then
    raise exception 'not in that conversation' using errcode = 'CH001';
  end if;
  v_thread := public.chat_member_thread(p_org, p_user, v.thread_id);
  if v_thread.kind = 'driver' then
    raise exception 'driver conversations have no reactions, pins or saved lines' using errcode = 'CH006';
  end if;
  if p_writing and v_thread.archived_at is not null then
    raise exception 'the conversation is archived' using errcode = 'CH005';
  end if;
  return v;
end;
$$;

-- Add (`p_on`) or take back one of your reactions. Idempotent both ways: the answer is the line's `rev`,
-- moved only when something changed.
create or replace function chat_react(p_org uuid, p_actor uuid, p_message uuid, p_reaction text, p_on boolean)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v public.messages;
begin
  if p_reaction is null or p_reaction not in ('thumbs_up', 'heart', 'laugh', 'surprised', 'sad', 'done') then
    raise exception 'not one of the six reactions' using errcode = 'CH006';
  end if;
  v := public.chat_line_for(p_org, p_actor, p_message, true);
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  if coalesce(p_on, true) then
    insert into public.message_reactions (message_id, user_id, reaction, org_id, thread_id)
    values (p_message, p_actor, p_reaction, p_org, v.thread_id)
    on conflict (message_id, user_id, reaction) do nothing;
  else
    delete from public.message_reactions r
     where r.message_id = p_message and r.user_id = p_actor and r.reaction = p_reaction;
  end if;
  return (select m.rev from public.messages m where m.id = p_message);
end;
$$;

-- Pin (`p_on`) or unpin a line of a conversation you are in. Idempotent, as above.
create or replace function chat_pin(p_org uuid, p_actor uuid, p_message uuid, p_on boolean)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v public.messages;
begin
  v := public.chat_line_for(p_org, p_actor, p_message, true);
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  if coalesce(p_on, true) then
    insert into public.chat_pins (message_id, org_id, thread_id, pinned_by)
    values (p_message, p_org, v.thread_id, p_actor)
    on conflict (message_id) do nothing;
  else
    delete from public.chat_pins x where x.message_id = p_message;
  end if;
  return (select m.rev from public.messages m where m.id = p_message);
end;
$$;

-- Save (`p_on`) or unsave a line for yourself. A retracted line can still be unsaved, not saved.
create or replace function chat_save(p_org uuid, p_user uuid, p_message uuid, p_on boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v public.messages;
begin
  v := public.chat_line_for(p_org, p_user, p_message, false);
  if coalesce(p_on, true) then
    if v.deleted_at is not null then
      raise exception 'a retracted message cannot be saved' using errcode = 'CH004';
    end if;
    insert into public.chat_saved (user_id, message_id, org_id) values (p_user, p_message, p_org)
    on conflict (user_id, message_id) do nothing;
  else
    delete from public.chat_saved s where s.user_id = p_user and s.message_id = p_message;
  end if;
  return coalesce(p_on, true);
end;
$$;

-- A line's reactions as the readers return them: `[{reaction, users}]` in D-CHAT26's order, each
-- kind's people in the order they reacted. None for a retracted line.
create or replace function chat_line_reactions(p_message uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('reaction', k.reaction, 'users', k.users)
                            order by array_position(array['thumbs_up', 'heart', 'laugh', 'surprised', 'sad', 'done'], k.reaction)),
                  '[]'::jsonb)
    from (select r.reaction, jsonb_agg(r.user_id order by r.created_at, r.user_id) as users
            from public.message_reactions r
            join public.messages m on m.id = r.message_id and m.deleted_at is null
           where r.message_id = p_message
           group by r.reaction) k;
$$;

-- A conversation's pinned lines, the latest pin first. A retracted line drops out.
create or replace function chat_pins(p_org uuid, p_user uuid, p_thread uuid)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, parent_id uuid, pinned_at timestamptz, pinned_by uuid,
  pinned_by_name text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           m.body, m.created_at, m.edited_at, m.parent_id, x.pinned_at, x.pinned_by,
           public.chat_display_name(p_org, x.pinned_by)
      from public.chat_pins x
      join public.messages m on m.id = x.message_id and m.org_id = p_org and m.deleted_at is null
     where x.thread_id = p_thread and x.org_id = p_org
     order by x.pinned_at desc, m.id desc
     limit 100;
end;
$$;

-- The caller's saved lines, newest save first, keyset-paged on (saved_at, message_id); only in
-- conversations they are still in, and never a retracted line.
create or replace function chat_saved(
  p_org uuid, p_user uuid, p_before_at timestamptz, p_before_id uuid, p_limit integer
) returns table (
  message_id uuid, saved_at timestamptz, thread_id uuid, kind text, subject text, space_id uuid,
  parent_id uuid, seq bigint, sender_user_id uuid, sender_name text, body text, created_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select s.message_id, s.saved_at, t.id, t.kind, t.subject, t.space_id, m.parent_id, m.seq,
         m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id), m.body, m.created_at
    from public.chat_saved s
    join public.messages m on m.id = s.message_id and m.org_id = p_org and m.deleted_at is null
    join public.message_threads t on t.id = m.thread_id and t.org_id = p_org
    join public.thread_participants p on p.thread_id = t.id and p.user_id = p_user and p.left_at is null
   where s.user_id = p_user and s.org_id = p_org
     and (p_before_at is null or (s.saved_at, s.message_id) < (p_before_at, p_before_id))
   order by s.saved_at desc, s.message_id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- ── 5. The four readers carry reactions, the pin and the caller's own save ──────────────────────
-- 0519's shapes plus three columns at the end. Same arguments.

drop function if exists chat_history(uuid, uuid, uuid, bigint, integer);
create function chat_history(p_org uuid, p_user uuid, p_thread uuid, p_before_seq bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, parent_id uuid, reply_count integer,
  last_reply_at timestamptz, reactions jsonb, pinned_at timestamptz, saved boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at,
           m.parent_id, m.reply_count, m.last_reply_at, public.chat_line_reactions(m.id),
           (select x.pinned_at from public.chat_pins x where x.message_id = m.id and m.deleted_at is null),
           exists (select 1 from public.chat_saved s where s.user_id = p_user and s.message_id = m.id)
      from public.messages m
     where m.thread_id = p_thread and m.org_id = p_org
       and (p_before_seq is null or m.seq < p_before_seq)
     order by m.seq desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

drop function if exists chat_sync(uuid, uuid, uuid, bigint, integer);
create function chat_sync(p_org uuid, p_user uuid, p_thread uuid, p_since_rev bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, parent_id uuid, reply_count integer,
  last_reply_at timestamptz, reactions jsonb, pinned_at timestamptz, saved boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at,
           m.parent_id, m.reply_count, m.last_reply_at, public.chat_line_reactions(m.id),
           (select x.pinned_at from public.chat_pins x where x.message_id = m.id and m.deleted_at is null),
           exists (select 1 from public.chat_saved s where s.user_id = p_user and s.message_id = m.id)
      from public.messages m
     where m.thread_id = p_thread and m.org_id = p_org and m.rev > coalesce(p_since_rev, 0)
     order by m.rev
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

drop function if exists chat_channel_posts(uuid, uuid, uuid, bigint, integer);
create function chat_channel_posts(p_org uuid, p_user uuid, p_thread uuid, p_before_seq bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, parent_id uuid, reply_count integer,
  last_reply_at timestamptz, reactions jsonb, pinned_at timestamptz, saved boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at,
           m.parent_id, m.reply_count, m.last_reply_at, public.chat_line_reactions(m.id),
           (select x.pinned_at from public.chat_pins x where x.message_id = m.id and m.deleted_at is null),
           exists (select 1 from public.chat_saved s where s.user_id = p_user and s.message_id = m.id)
      from public.messages m
     where m.thread_id = p_thread and m.org_id = p_org and m.parent_id is null
       and (p_before_seq is null or m.seq < p_before_seq)
     order by m.seq desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

drop function if exists chat_replies(uuid, uuid, uuid, bigint, integer);
create function chat_replies(p_org uuid, p_user uuid, p_parent uuid, p_before_seq bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, parent_id uuid, reply_count integer,
  last_reply_at timestamptz, reactions jsonb, pinned_at timestamptz, saved boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_thread uuid;
begin
  select m.thread_id into v_thread from public.messages m where m.id = p_parent and m.org_id = p_org;
  if v_thread is null then
    raise exception 'no such post' using errcode = 'CH001';
  end if;
  perform public.chat_member_thread(p_org, p_user, v_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at,
           m.parent_id, m.reply_count, m.last_reply_at, public.chat_line_reactions(m.id),
           (select x.pinned_at from public.chat_pins x where x.message_id = m.id and m.deleted_at is null),
           exists (select 1 from public.chat_saved s where s.user_id = p_user and s.message_id = m.id)
      from public.messages m
     where m.parent_id = p_parent and m.org_id = p_org
       and (p_before_seq is null or m.seq < p_before_seq)
     order by m.seq desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- ── Grants: service role only ───────────────────────────────────────────────────────────────────
revoke all on function chat_line_act_place() from public, anon, authenticated;
revoke all on function chat_bump_line(uuid) from public, anon, authenticated;
revoke all on function chat_ledger_reactions() from public, anon, authenticated;
revoke all on function chat_ledger_pins() from public, anon, authenticated;
revoke all on function chat_line_for(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function chat_react(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function chat_pin(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function chat_save(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function chat_line_reactions(uuid) from public, anon, authenticated;
revoke all on function chat_pins(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function chat_saved(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function chat_history(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function chat_sync(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function chat_channel_posts(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function chat_replies(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
grant execute on function chat_react(uuid, uuid, uuid, text, boolean) to service_role;
grant execute on function chat_pin(uuid, uuid, uuid, boolean) to service_role;
grant execute on function chat_save(uuid, uuid, uuid, boolean) to service_role;
grant execute on function chat_pins(uuid, uuid, uuid) to service_role;
grant execute on function chat_saved(uuid, uuid, timestamptz, uuid, integer) to service_role;
grant execute on function chat_history(uuid, uuid, uuid, bigint, integer) to service_role;
grant execute on function chat_sync(uuid, uuid, uuid, bigint, integer) to service_role;
grant execute on function chat_channel_posts(uuid, uuid, uuid, bigint, integer) to service_role;
grant execute on function chat_replies(uuid, uuid, uuid, bigint, integer) to service_role;
