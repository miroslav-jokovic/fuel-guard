-- Silvicom 360 — 0521 office chat: mentions, mute and Activity
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH6b-1; D-CHAT22, D-CHAT23, D-CHAT25, Q-CHAT17, Q-CHAT20)
--
-- Release 2 left three things a Teams user expects and nobody can do: name a person so they hear of
-- it, quieten a conversation, and see in one place what was said TO them. Measured before this file
-- (§9.2): `thread_participants.muted` has existed since 0511 and nothing writes it; there is no mention,
-- no Activity, and the bell hears nothing of office chat. This is the schema and the functions; the API
-- and the web are CH6b-2, the next merge.
--
--   1. A MENTION IS IN THE BODY (D-CHAT22), as `<@user-id>`. The body is already the one record of what
--      was said — hashed into the ledger, versioned on edit (0511) — so "who was named" is DERIVED from
--      it by trigger into `message_mentions`, on send, reply and edit, and can never disagree with it.
--      No ledger row of its own: the body's hash covers the token.
--      A token must name somebody IN the conversation now (Q-CHAT20, ruled 2026-10-26). The plan first
--      said a public channel could name any member of its team, but CH5a's rule is that a team member
--      reads a public channel only after joining it — so the bell would have pointed somebody at words
--      they may not read. Naming somebody who is not in it is refused (CH013) and writes no line; the
--      composer offers to add them first, which any channel member may already do. On an EDIT only the
--      tokens the edit adds are judged: a person named before they left stays named when the author
--      fixes a typo. Driver conversations (0096) and system lines are never read for tokens — a driver's
--      words are not office chat's syntax.
--
--   2. MUTE gets its first writer, `chat_set_mute` (`none` / `mentions` / `all`, 0511's CHECK). One
--      person's setting, like `read_seq`: not ledgered, never shown to anybody else (D-CHAT24).
--
--   3. ACTIVITY IS DERIVED, NOT STORED (D-CHAT25). Mentions of you, and replies to a post you wrote or
--      replied to (Q-CHAT17: this is what a per-post read boundary would have carried), in conversations
--      you are still in, newest first. One read instant per person, `chat_person_state.activity_read_at`:
--      an item after it is unread. Nothing to keep in step — a retracted line simply stops qualifying.
--      CH6c adds reactions to your lines as a third reason.
--
--   4. THE BELL (D-CHAT23). Two categories, `chat_mention` and `chat_reply`, widened here one merge
--      before their writer as 0503 did, the contract in the same PR (notificationCategoryCheck.test.ts).
--      WHO is told is `chat_notify_targets`, so the API asks rather than restating the rules: never the
--      author, never somebody who left, never a conversation muted `all`; `mentions` still rings for a
--      mention and nothing else. The dedupe key carries the person's read boundary, so five mentions
--      before they look are one bell item, and the first one after they read is a new one.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: no function the API calls today changes its arguments or its
-- answer. The one new refusal, CH013, needs a `<@uuid>` token in a body, which no client writes before
-- CH6b-2 (the API maps it in this same merge). Both tables are new. No line written before this file
-- carries a token (§9.2 measured none can), so nothing is backfilled.
--
-- Rollback: drop the triggers and functions below and the two tables; restore 0503's category CHECK.
-- CH6b-2's routes call them and must be reverted first.

-- ── 1. Mentions ─────────────────────────────────────────────────────────────────────────────────

create table if not exists message_mentions (
  -- Derived from the body; a message removed by a declared purge takes its index rows with it.
  message_id uuid not null references messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  thread_id  uuid not null references message_threads(id) on delete cascade,
  -- When the person was named: the send, or the edit that added the token. Activity orders by it, so a
  -- mention added by an edit arrives as new rather than hiding at the line's old time.
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists idx_message_mentions_user on message_mentions (user_id, org_id, created_at desc);

alter table message_mentions enable row level security;
-- No policies: written by the triggers below, read by 0521's functions with the service role.

-- Activity's "posts you wrote, and posts you replied to" — by sender, which nothing indexed before.
create index if not exists idx_messages_sender_posts on messages (sender_user_id)
  where parent_id is null and reply_count > 0;
create index if not exists idx_messages_sender_replies on messages (sender_user_id, parent_id)
  where parent_id is not null;

-- The people a body names, once each. A token is exactly `<@` + a uuid + `>`; anything else is text.
create or replace function chat_mention_ids(p_body text) returns uuid[]
language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(distinct lower(x[1])::uuid), '{}')
    from regexp_matches(coalesce(p_body, ''),
      '<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>', 'g') x;
$$;

-- Is this line office chat's, whose body may carry tokens? Not a driver conversation, not a system line.
create or replace function chat_mentions_apply(p_thread uuid, p_sender uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_sender is not null
     and exists (select 1 from public.message_threads t where t.id = p_thread and t.kind <> 'driver');
$$;

-- Refuse a token naming somebody who is not in the conversation now (Q-CHAT20). The refusal aborts the
-- statement, so the line, its sequence number and its ledger row are never written.
create or replace function messages_mentions_check() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_named uuid[];
  v_bad uuid;
begin
  if not public.chat_mentions_apply(new.thread_id, new.sender_user_id) then
    return new;
  end if;
  v_named := public.chat_mention_ids(new.body);
  if tg_op = 'UPDATE' then
    -- Only what the edit adds: somebody named before they left stays named.
    v_named := array(select unnest(v_named) except select unnest(public.chat_mention_ids(old.body)));
  end if;
  select u into v_bad from unnest(v_named) u
   where not exists (select 1 from public.thread_participants p
                      where p.thread_id = new.thread_id and p.user_id = u and p.left_at is null)
   limit 1;
  if v_bad is not null then
    raise exception 'that person is not in this conversation: add them first' using errcode = 'CH013';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_messages_mentions_check on messages;
create trigger trg_messages_mentions_check before insert or update of body on messages
  for each row execute function messages_mentions_check();

-- Keep the index equal to the body: add who it names now, remove who an edit took out. A row that
-- stays keeps its time.
create or replace function messages_mentions_index() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_named uuid[];
begin
  if not public.chat_mentions_apply(new.thread_id, new.sender_user_id) then
    return null;
  end if;
  v_named := public.chat_mention_ids(new.body);
  if tg_op = 'UPDATE' then
    if new.body is not distinct from old.body then
      return null;
    end if;
    delete from public.message_mentions mm where mm.message_id = new.id and mm.user_id <> all (v_named);
  end if;
  insert into public.message_mentions (message_id, user_id, org_id, thread_id)
  select new.id, u, new.org_id, new.thread_id from unnest(v_named) u
  on conflict (message_id, user_id) do nothing;
  return null;
end;
$$;

drop trigger if exists trg_messages_mentions_index on messages;
create trigger trg_messages_mentions_index after insert or update of body on messages
  for each row execute function messages_mentions_index();

-- ── 2. One person's chat state ──────────────────────────────────────────────────────────────────

create table if not exists chat_person_state (
  org_id           uuid not null references organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  -- Activity read up to here (D-CHAT25). Null: never opened, everything is unread.
  activity_read_at timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (org_id, user_id)
);

alter table chat_person_state enable row level security;
-- No policies: one person's bookmark, through the functions below with the service role.

-- ── 3. Functions ────────────────────────────────────────────────────────────────────────────────
-- Error codes, beside 0512's and 0519's (the API maps them in chat.ts):
--   CH013  a mention names somebody who is not in the conversation (→ 422)

-- Quieten a conversation for yourself: `none`, `mentions` (only a mention reaches you) or `all`.
create or replace function chat_set_mute(p_org uuid, p_user uuid, p_thread uuid, p_level text)
returns text
language plpgsql security definer set search_path = ''
as $$
begin
  if p_level is null or p_level not in ('none', 'mentions', 'all') then
    raise exception 'a mute is none, mentions or all' using errcode = 'CH006';
  end if;
  perform public.chat_member_thread(p_org, p_user, p_thread);
  update public.thread_participants p set muted = p_level
   where p.thread_id = p_thread and p.user_id = p_user and p.left_at is null;
  return p_level;
end;
$$;

-- Every Activity item of one person, unordered: the reason it is theirs and the instant it arrived.
-- Both readers below go through this, so the list and its unread count cannot disagree.
create or replace function chat_activity_items(p_org uuid, p_user uuid)
returns table (message_id uuid, reason text, at timestamptz)
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
  )
  select o.message_id, o.reason, o.at
    from one o
    join public.messages m on m.id = o.message_id and m.org_id = p_org
    join public.thread_participants p on p.thread_id = m.thread_id and p.user_id = p_user and p.left_at is null
   where m.deleted_at is null
     and m.sender_user_id is distinct from p_user;
$$;

-- Activity, newest first, keyset-paged on (at, message_id).
create or replace function chat_activity(
  p_org uuid, p_user uuid, p_before_at timestamptz, p_before_id uuid, p_limit integer
) returns table (
  message_id uuid, reason text, at timestamptz, unread boolean, thread_id uuid, kind text, subject text,
  space_id uuid, parent_id uuid, seq bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select i.message_id, i.reason, i.at,
         i.at > coalesce((select s.activity_read_at from public.chat_person_state s
                           where s.org_id = p_org and s.user_id = p_user), '-infinity'::timestamptz),
         t.id, t.kind, t.subject, t.space_id, m.parent_id, m.seq, m.sender_user_id,
         public.chat_display_name(p_org, m.sender_user_id), m.body, m.created_at
    from public.chat_activity_items(p_org, p_user) i
    join public.messages m on m.id = i.message_id
    join public.message_threads t on t.id = m.thread_id and t.org_id = p_org
   where p_before_at is null or (i.at, i.message_id) < (p_before_at, p_before_id)
   order by i.at desc, i.message_id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- The Activity tab's badge.
create or replace function chat_activity_unread(p_org uuid, p_user uuid)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select count(*)
    from public.chat_activity_items(p_org, p_user) i
   where i.at > coalesce((select s.activity_read_at from public.chat_person_state s
                           where s.org_id = p_org and s.user_id = p_user), '-infinity'::timestamptz);
$$;

-- Move the caller's Activity read instant forward to `p_at` (null = now), never back, never past now.
create or replace function chat_activity_mark_read(p_org uuid, p_user uuid, p_at timestamptz)
returns timestamptz
language sql security definer set search_path = ''
as $$
  insert into public.chat_person_state as s (org_id, user_id, activity_read_at)
  values (p_org, p_user, least(coalesce(p_at, now()), now()))
  on conflict (org_id, user_id) do update
     set activity_read_at = greatest(s.activity_read_at, excluded.activity_read_at), updated_at = now()
  returning s.activity_read_at;
$$;

-- Who the bell tells of one line (D-CHAT23), with the key that folds a stretch of them into one item.
-- The API calls it after a send, a reply or an edit and hands each row to notify(); org categories,
-- the person's muted categories and quiet hours stay notify()'s (0089, 0432).
create or replace function chat_notify_targets(p_org uuid, p_message uuid)
returns table (user_id uuid, category text, read_seq bigint, dedupe_key text)
language sql stable security definer set search_path = ''
as $$
  with m as (
    select x.* from public.messages x
      join public.message_threads t on t.id = x.thread_id and t.kind <> 'driver'
     where x.id = p_message and x.org_id = p_org and x.deleted_at is null and x.sender_user_id is not null
  ),
  wanted as (
    select mm.user_id, 'chat_mention'::text as category
      from public.message_mentions mm join m on mm.message_id = m.id
    union all
    -- A reply tells the post's author and everyone who replied to it before.
    select x.sender_user_id, 'chat_reply'
      from m join public.messages x on x.id = m.parent_id
    union all
    select x.sender_user_id, 'chat_reply'
      from m join public.messages x on x.parent_id = m.parent_id and x.seq < m.seq
  ),
  one as (
    select distinct on (w.user_id) w.user_id, w.category
      from wanted w where w.user_id is not null
     order by w.user_id, (w.category = 'chat_mention') desc
  )
  select o.user_id, o.category, p.read_seq, o.category || ':' || m.thread_id || ':' || p.read_seq
    from one o
    cross join m
    join public.thread_participants p on p.thread_id = m.thread_id and p.user_id = o.user_id and p.left_at is null
   where o.user_id <> m.sender_user_id
     and (p.muted = 'none' or (p.muted = 'mentions' and o.category = 'chat_mention'))
   order by o.user_id;
$$;

-- ── 4. The bell's two categories (D-CHAT23) ─────────────────────────────────────────────────────
-- Widened one merge before their writer (CH6b-2), with `NOTIFICATION_CATEGORIES` in the same PR.
alter table public.notification_events drop constraint if exists notification_events_category_check;
alter table public.notification_events add constraint notification_events_category_check check (category in (
  'load_offered', 'load_changed', 'load_canceled', 'message_received', 'duty_auto_closed',
  'performance_week', 'training_due', 'system', 'hazmat_review', 'hazmat_cleared', 'hazmat_rejected',
  'fuel_alert', 'declined_alert', 'efs_processing_failed', 'efs_feed_stale',
  'dq_expiring', 'dq_expired', 'dq_missing', 'dq_license_status', 'dq_mvr_received',
  'application_stalled', 'application_ready_to_screen', 'card_status_changed', 'drug_alcohol_result',
  'roadside_feed_stale', 'medstop_connection', 'roadside_repair_due', 'roadside_report_needs_review',
  'unit_file_expiring', 'unit_file_expired',
  'chat_mention', 'chat_reply'
));

-- ── Grants: service role only ───────────────────────────────────────────────────────────────────
revoke all on function chat_mention_ids(text) from public, anon, authenticated;
revoke all on function chat_mentions_apply(uuid, uuid) from public, anon, authenticated;
revoke all on function messages_mentions_check() from public, anon, authenticated;
revoke all on function messages_mentions_index() from public, anon, authenticated;
revoke all on function chat_set_mute(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function chat_activity_items(uuid, uuid) from public, anon, authenticated;
revoke all on function chat_activity(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function chat_activity_unread(uuid, uuid) from public, anon, authenticated;
revoke all on function chat_activity_mark_read(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function chat_notify_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function chat_set_mute(uuid, uuid, uuid, text) to service_role;
grant execute on function chat_activity(uuid, uuid, timestamptz, uuid, integer) to service_role;
grant execute on function chat_activity_unread(uuid, uuid) to service_role;
grant execute on function chat_activity_mark_read(uuid, uuid, timestamptz) to service_role;
grant execute on function chat_notify_targets(uuid, uuid) to service_role;
