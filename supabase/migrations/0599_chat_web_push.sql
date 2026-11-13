-- Silvicom 360 — 0599 office chat on the phone: Web Push subscriptions and who a line is pushed to
-- (docs/plans/messaging/CHAT-WEB-PUSH-PLAN.md WP1; D-WP1, D-WP2, D-WP3; OFFICE-CHAT-PLAN CH10, Q-CHAT4 (b))
--
-- The office reads chat in a browser, not in an app, and a browser tab closed — or an iPhone, where a
-- Safari tab has no notifications at all — hears nothing today (CH6d rings only an open tab). Web Push is
-- the browser's own channel to the phone's notification tray: the browser hands the page an endpoint on
-- its vendor's push service (Google, Apple, Mozilla, Microsoft) and the server posts an encrypted message
-- there. This file is the schema half; the API and the web are WP2, the next merge.
--
-- 1. ONE ROW PER ENDPOINT (D-WP1). An endpoint is one browser profile on one device, so "every device I am
--    signed in on" is every live row of that person in that organisation. The endpoint is UNIQUE: when a
--    second person turns notifications on in the same browser, the row moves to them — a shared PC never
--    carries two people's messages. A row stops when the person turns it off or signs out there (that
--    device only), when the push service says the browser dropped it, or when the person is offboarded
--    (`revoke_push_tokens`, extended below, is what members.ts already calls).
--
-- 2. WHO A LINE IS PUSHED TO (D-WP2) is `chat_push_targets`, the rule Q-CHAT18 (a) ruled for CH6d's
--    desktop alerts, so a mute means the same on the PC, the bell and the phone: every other participant
--    of a direct or group conversation who has not muted it; in a channel only a mention or a reply to a
--    post you wrote or answered — 0521's `chat_notify_targets`, CALLED, not restated. Never the author,
--    never somebody who left, never a suspended or removed member, never a driver conversation.
--
-- 3. ONLY IF STILL UNREAD (D-WP3). The API asks 15 s after the line, and the function answers only with
--    people whose read boundary is still before it: an open, visible conversation has marked it read by
--    then, on whichever device. An edit's newly named person (`p_mentioned`) is judged by Activity's read
--    instant instead, because the line itself may have been read before it named them.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: one new table nothing reads yet, two new functions nothing calls
-- yet, and `revoke_push_tokens` keeps its signature and its answer's meaning (rows revoked — now Expo
-- tokens plus web subscriptions; members.ts and driverCredentials.ts only log it).
--
-- Rollback: drop the three new functions and the table; restore 0414's `revoke_push_tokens` body.
-- WP2's routes and delivery must be reverted first.

-- ── 1. Subscriptions ──────────────────────────────────────────────────────────────────────────────
create table if not exists web_push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- The push service URL. The API accepts only the four push services' hosts (D-WP7): the server
  -- POSTs here, so an arbitrary URL would be a request forgery through the subscription.
  endpoint        text not null unique check (endpoint like 'https://%' and length(endpoint) <= 2048),
  -- The browser's P-256 public key (65 bytes) and auth secret (16 bytes), base64url, unpadded.
  p256dh          text not null check (p256dh ~ '^[A-Za-z0-9_-]{86,88}$'),
  auth            text not null check (auth ~ '^[A-Za-z0-9_-]{22,24}$'),
  -- Where the notification opens: the page origin it was turned on from (one of ALLOWED_ORIGINS).
  origin          text not null check (origin ~ '^https?://[^/]+$'),
  -- "Chrome on Android" — so a person can tell their devices apart. Never used to decide anything.
  device_label    text check (length(device_label) <= 120),
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure    text check (length(last_failure) <= 500),
  last_failure_at timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text check (revoked_reason in ('turned_off', 'signed_out', 'gone', 'revoked_all')),
  constraint web_push_revoked_has_reason check ((revoked_at is null) = (revoked_reason is null))
);

create index if not exists idx_web_push_live on web_push_subscriptions (org_id, user_id) where revoked_at is null;

alter table web_push_subscriptions enable row level security;
-- No policies: the browser never reads or writes a subscription; the API does, through the functions
-- below and org-filtered reads, with the service role.

comment on table web_push_subscriptions is 'module=messaging; layer=infra (0599, CHAT-WEB-PUSH-PLAN D-WP1).';

-- ── 2. Turn on, turn off ──────────────────────────────────────────────────────────────────────────
-- Error codes, beside chat's (CH0xx):
--   WP001  the person is not an active office member of the organisation (→ 403)

-- Register this device for this person, or refresh it. Takes the endpoint over from whoever held it.
create or replace function web_push_subscribe(
  p_org uuid, p_user uuid, p_endpoint text, p_p256dh text, p_auth text, p_origin text, p_label text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.memberships mb
     where mb.org_id = p_org and mb.user_id = p_user and mb.suspended_at is null and mb.role <> 'driver'
  ) then
    raise exception 'not an active office member of this organisation' using errcode = 'WP001';
  end if;

  insert into public.web_push_subscriptions as s (org_id, user_id, endpoint, p256dh, auth, origin, device_label)
  values (p_org, p_user, p_endpoint, p_p256dh, p_auth, p_origin, left(p_label, 120))
  on conflict (endpoint) do update
     set org_id = excluded.org_id,
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         origin = excluded.origin,
         device_label = excluded.device_label,
         -- A device that changed hands is a new device: its history was somebody else's.
         created_at = case when s.user_id = excluded.user_id and s.org_id = excluded.org_id then s.created_at else now() end,
         last_success_at = case when s.user_id = excluded.user_id and s.org_id = excluded.org_id then s.last_success_at end,
         last_seen_at = now(),
         last_failure = null,
         last_failure_at = null,
         revoked_at = null,
         revoked_reason = null
  returning s.id into v_id;
  return v_id;
end;
$$;

-- This device, this person: off. Another person's row with the same endpoint is not theirs to touch.
create or replace function web_push_unsubscribe(p_org uuid, p_user uuid, p_endpoint text, p_reason text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_reason is null or p_reason not in ('turned_off', 'signed_out') then
    raise exception 'a person turns a device off or signs out of it' using errcode = '22023';
  end if;
  update public.web_push_subscriptions
     set revoked_at = now(), revoked_reason = p_reason
   where endpoint = p_endpoint and user_id = p_user and org_id = p_org and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── 3. Who a line is pushed to (D-WP2, D-WP3) ─────────────────────────────────────────────────────
-- `p_mentioned` null: a new line or reply — everyone the rule names whose read boundary is before it.
-- `p_mentioned` set: an edit — only those of them it newly names, judged by Activity's read instant.
create or replace function chat_push_targets(p_org uuid, p_message uuid, p_mentioned uuid[])
returns table (user_id uuid, reason text)
language sql stable security definer set search_path = ''
as $$
  with m as (
    select x.id, x.thread_id, x.seq, x.sender_user_id, t.kind
      from public.messages x
      join public.message_threads t on t.id = x.thread_id and t.org_id = p_org
     where x.id = p_message and x.org_id = p_org and x.deleted_at is null and x.sender_user_id is not null
       and t.kind in ('direct', 'group', 'channel')
  ),
  -- The bell's targets (0521): mentions anywhere, replies to followed posts; mutes already applied.
  named as (
    select n.user_id, case n.category when 'chat_mention' then 'mention' else 'reply' end as reason
      from public.chat_notify_targets(p_org, p_message) n
  ),
  -- Every line of a direct or group conversation, to whoever has not muted it.
  lines as (
    select p.user_id, 'line'::text as reason
      from m join public.thread_participants p on p.thread_id = m.thread_id
     where m.kind in ('direct', 'group') and p.left_at is null and p.muted = 'none'
  ),
  wanted as (
    select w.user_id, w.reason from named w
     where p_mentioned is null or (w.reason = 'mention' and w.user_id = any (p_mentioned))
    union all
    select l.user_id, l.reason from lines l where p_mentioned is null
  ),
  one as (
    select distinct on (w.user_id) w.user_id, w.reason
      from wanted w
     order by w.user_id, case w.reason when 'mention' then 0 when 'reply' then 1 else 2 end
  )
  select o.user_id, o.reason
    from one o
    cross join m
    join public.thread_participants p on p.thread_id = m.thread_id and p.user_id = o.user_id and p.left_at is null
    join public.memberships mb on mb.org_id = p_org and mb.user_id = o.user_id
                              and mb.suspended_at is null and mb.role <> 'driver'
   where o.user_id <> m.sender_user_id
     and case
           when p_mentioned is null then p.read_seq < m.seq
           else coalesce((select s.activity_read_at from public.chat_person_state s
                           where s.org_id = p_org and s.user_id = o.user_id), '-infinity'::timestamptz)
                < (select mm.created_at from public.message_mentions mm
                    where mm.message_id = m.id and mm.user_id = o.user_id)
         end
   order by o.user_id;
$$;

-- ── 4. Offboarding and "sign out everywhere" reach the browser too ────────────────────────────────
-- 0414's body, character for character, plus the second update. Called by members.ts (access revoked),
-- driverCredentials.ts and `/api/me/notifications/token/revoke`; all three mean "this person's devices
-- must stop", which is now true of a browser as much as an Expo phone.
create or replace function public.revoke_push_tokens(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_web integer;
begin
  update public.device_push_tokens
     set revoked_at = now()
   where user_id = p_user and revoked_at is null;
  get diagnostics v_count = row_count;
  update public.web_push_subscriptions
     set revoked_at = now(), revoked_reason = 'revoked_all'
   where user_id = p_user and revoked_at is null;
  get diagnostics v_web = row_count;
  return v_count + v_web;
end;
$$;

-- ── Grants: service role only ─────────────────────────────────────────────────────────────────────
revoke all on function web_push_subscribe(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function web_push_unsubscribe(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function chat_push_targets(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.revoke_push_tokens(uuid) from public, anon, authenticated;
grant execute on function web_push_subscribe(uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function web_push_unsubscribe(uuid, uuid, text, text) to service_role;
grant execute on function chat_push_targets(uuid, uuid, uuid[]) to service_role;
grant execute on function public.revoke_push_tokens(uuid) to service_role;
