-- Silvicom 360 — 0541 office chat: reactions to your lines join Activity
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH6c, D-CHAT25's third reason)
--
-- 0521 made Activity DERIVED (D-CHAT25): mentions of you and replies to posts you follow, read by
-- `chat_activity_items`, so the list and its badge cannot disagree. It named a third reason — somebody
-- reacted to a line of yours — and left it for CH6c, because reactions had no table yet. 0523 built
-- `message_reactions`; CH6c-2 (#1897) taught the contract the word `reaction` and gave an item who
-- reacted with what (`reaction`, `reactor_user_id`, `reactor_name`, all defaulted). This file is the
-- writer the reader was waiting for.
--
--   1. ONE ITEM PER LINE OF YOURS, NOT PER REACTION. Six people giving a 👍 to "Truck 12 is loaded" is one
--      thing that happened to you, and Activity keys and pages on the line (`message_id`, with `at`). The
--      item says the LATEST reaction — who and which — and arrives when it did, so a new reaction to an
--      old line lifts it to the top and makes it unread again. Your own reactions never count.
--   2. STILL DERIVED. Take the reaction back and, if it was the only one, the item goes; if it was the
--      latest, the one before it stands in. A retracted line, or a conversation you left, drops it, by
--      the same two conditions mentions and replies already meet.
--   3. NO BELL. A reaction is not a message (CH6c-2 rings nothing for it); Activity's badge is where it
--      shows, as Teams does.
--
-- WHY THE OLD CODE MEETS THIS SAFELY (MIGRATION-DISCIPLINE §the-deploy-window): the contract has parsed
-- `reason = 'reaction'` and the three reactor columns since #1897, which was RELEASED before this file
-- merged (checked against `origin/production`), so in a release, where migrations run first, the API
-- already serving reads every row this returns. The arguments of every function are unchanged.
-- `chat_activity` and `chat_activity_items` gain columns, which `create or replace` cannot do, so both are
-- dropped and made again — inside the migration's one transaction, so no call sees them missing — and
-- their grants restated as 0521 left them. `chat_activity_unread` reads the items function by name and
-- is untouched: it counts the new items with no change of its own.
--
-- Rollback: restore 0521's `chat_activity_items` and `chat_activity` (drop both, re-run their 0521
-- definitions and grants). Nothing is stored, so nothing is left behind.

drop function if exists chat_activity(uuid, uuid, timestamptz, uuid, integer);
drop function if exists chat_activity_items(uuid, uuid);

-- Every Activity item of one person, unordered: the reason it is theirs, the instant it arrived and,
-- for a reaction, the latest one and who gave it. Both readers go through this, as in 0521.
create function chat_activity_items(p_org uuid, p_user uuid)
returns table (message_id uuid, reason text, at timestamptz, reaction text, reactor_user_id uuid)
language sql stable security definer set search_path = ''
as $$
  with followed as (
    -- A post you wrote: every reply to it. A post you replied to: the replies after your first one.
    select m.id as post_id, 0::bigint as from_seq
      from public.messages m
     where m.sender_user_id = p_user and m.org_id = p_org and m.parent_id is null and m.reply_count > 0
    union all
    select m.parent_id, min(m.seq)
      from public.messages m
     where m.sender_user_id = p_user and m.org_id = p_org and m.parent_id is not null
     group by m.parent_id
  ),
  raw as (
    select mm.message_id, 'mention'::text as reason, mm.created_at as at
      from public.message_mentions mm
     where mm.user_id = p_user and mm.org_id = p_org
    union all
    select r.id, 'reply', r.created_at
      from (select f.post_id, min(f.from_seq) as from_seq from followed f group by f.post_id) f
      join public.messages r on r.parent_id = f.post_id and r.seq > f.from_seq
     where r.org_id = p_org
  ),
  -- A reply that also names you is one item, a mention.
  one as (
    select distinct on (x.message_id) x.message_id, x.reason, x.at
      from raw x order by x.message_id, (x.reason = 'mention') desc
  ),
  -- Your lines somebody else reacted to: one item each, the latest reaction speaking for it. The order's
  -- tail makes the choice total when two reactions share an instant.
  reacted as (
    select distinct on (r.message_id) r.message_id, r.reaction, r.user_id, r.created_at
      from public.messages m
      join public.message_reactions r on r.message_id = m.id  -- its org_id is the message's (0523 trigger)
     where m.sender_user_id = p_user and m.org_id = p_org and r.user_id <> p_user
     order by r.message_id, r.created_at desc, r.user_id desc, r.reaction desc
  ),
  items as (
    select o.message_id, o.reason, o.at, null::text as reaction, null::uuid as reactor_user_id from one o
    union all
    select x.message_id, 'reaction', x.created_at, x.reaction, x.user_id from reacted x
  )
  select i.message_id, i.reason, i.at, i.reaction, i.reactor_user_id
    from items i
    join public.messages m on m.id = i.message_id and m.org_id = p_org
    join public.thread_participants p on p.thread_id = m.thread_id and p.user_id = p_user and p.left_at is null
   where m.deleted_at is null
     -- A mention or a reply is somebody else's line; a reaction item is, by construction, yours.
     and (i.reason = 'reaction' or m.sender_user_id is distinct from p_user);
$$;

-- Activity, newest first, keyset-paged on (at, message_id) — still one item per line, so still a key.
create function chat_activity(
  p_org uuid, p_user uuid, p_before_at timestamptz, p_before_id uuid, p_limit integer
) returns table (
  message_id uuid, reason text, at timestamptz, unread boolean, thread_id uuid, kind text, subject text,
  space_id uuid, parent_id uuid, seq bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, reaction text, reactor_user_id uuid, reactor_name text
)
language sql stable security definer set search_path = ''
as $$
  select i.message_id, i.reason, i.at,
         i.at > coalesce((select s.activity_read_at from public.chat_person_state s
                           where s.org_id = p_org and s.user_id = p_user), '-infinity'::timestamptz),
         t.id, t.kind, t.subject, t.space_id, m.parent_id, m.seq, m.sender_user_id,
         public.chat_display_name(p_org, m.sender_user_id), m.body, m.created_at,
         i.reaction, i.reactor_user_id,
         case when i.reactor_user_id is not null then public.chat_display_name(p_org, i.reactor_user_id) end
    from public.chat_activity_items(p_org, p_user) i
    join public.messages m on m.id = i.message_id
    join public.message_threads t on t.id = m.thread_id and t.org_id = p_org
   where p_before_at is null or (i.at, i.message_id) < (p_before_at, p_before_id)
   order by i.at desc, i.message_id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function chat_activity_items(uuid, uuid) from public, anon, authenticated;
revoke all on function chat_activity(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function chat_activity(uuid, uuid, timestamptz, uuid, integer) to service_role;
