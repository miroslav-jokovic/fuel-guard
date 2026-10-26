-- Silvicom 360 — 0513 office chat: instant delivery by signal (OFFICE-CHAT-PLAN CH3a, D-CHAT2)
--
-- Until now an office chat message reached the other person on the next poll (30 s for the inbox,
-- 10 s for an open conversation, CH2). This migration makes the database ANNOUNCE each change the
-- moment it commits, through Supabase Realtime Broadcast on PRIVATE topics:
--
--   chat:conv:<thread id>   everyone with the conversation open: "it is now at seq N / rev R"
--   chat:user:<user id>     each member's own topic, for their inbox and badge — conversations of at
--                           most 50 people only (D-CHAT2: a large channel's unread dot rides the poll,
--                           as Teams and Slack treat big channels; one message to 1,000 people must not
--                           be 1,000 broadcasts)
--
-- ── SIGNALS, NEVER CONTENT (D-CHAT2, §7 of the plan) ────────────────────────────────────────────
-- The payload is `{thread_id, seq, rev, kind, op}` — no body, no sender name. A client that hears a
-- signal asks `/api/chat/:id/sync?since_rev=` and the API authorises THAT request. This is what makes
-- Supabase's documented gap harmless here: a channel's permission is checked when the tab JOINS and is
-- then cached for the connection, so a person removed from a conversation keeps an open subscription
-- until their token refreshes (Supabase Realtime Authorization, read 2026-10-23). They would hear "the
-- conversation moved"; they cannot read what was said, because the sync refuses them (0512, CH001).
-- It also keeps message text out of Realtime's own logs, and Realtime bills per recipient, so a small
-- payload is the cheap one (plan §6).
--
-- ── A FAILED ANNOUNCEMENT NEVER LOSES A MESSAGE ─────────────────────────────────────────────────
-- `realtime.send` runs INSIDE the insert's transaction (so a rolled-back message is never announced —
-- the outbox ChatGPT's proposal asked for, for free). If it raised, it would roll the message back with
-- it. Supabase documents one way it can fail — the day's `realtime.messages` partition not existing —
-- and the call is wrapped so ANY failure is swallowed: the poll is the guarantee, the signal is the
-- speed (D-CHAT2). Driver threads (0096) are skipped; the driver app keeps its Postgres Changes.
--
-- ── WHO MAY JOIN A TOPIC ────────────────────────────────────────────────────────────────────────
-- RLS on `realtime.messages`, the mechanism Supabase provides. `chat:user:<id>` only by that user;
-- `chat:conv:<id>` only by a current member (`auth_in_thread`, which since 0511 excludes people who
-- left). SELECT only — the browser receives; it never broadcasts (no INSERT policy), so no client can
-- forge a signal. Presence and typing (CH9) will need their own policies then.
-- ⚠ RLS is already enabled on `realtime.messages` by Supabase, and `alter table … enable row level
-- security` there fails ("must be owner") and aborts the transaction — so this file never runs it.
--
-- ── WHERE THIS DOES NOTHING ──────────────────────────────────────────────────────────────────────
-- The trigger and the policies are created only where the `realtime` schema exists (a real Supabase
-- project), the 0096 precedent. Bare PGlite has none; `office-chat-realtime.test.mjs` installs a shim
-- of `realtime.send`, `realtime.topic()` and `realtime.messages` first, so the matrix executes all of it.
--
-- ⚠ Owner action, not code: in the Supabase dashboard, Realtime Settings → turn OFF "Allow public
-- access" on staging and production, so a client that forgets `private: true` is refused rather than
-- joining an unauthorised public channel of the same name (CH3b's staging check).
--
-- Rollback: drop trigger trg_chat_signal on messages; drop function chat_signal(); drop policy
-- chat_topics_receive on realtime.messages; drop function auth_chat_topic(text). CH3b's client first.

-- The rule for a topic, stated once and readable by the policy AND by the matrix without a shim of
-- the policy machinery. `auth_user_id()` is 0096's JWT `sub`; a malformed id is simply not allowed.
create or replace function auth_chat_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_topic is null then
    return false;
  end if;
  if p_topic like 'chat:user:%' then
    return substr(p_topic, 11) = public.auth_user_id()::text;
  end if;
  if p_topic like 'chat:conv:%' then
    begin
      v_id := substr(p_topic, 11)::uuid;
    exception when invalid_text_representation then
      return false;
    end;
    return exists (
      select 1 from public.message_threads t
       where t.id = v_id and t.kind <> 'driver' and t.org_id = public.auth_org_id()
    ) and public.auth_in_thread(v_id);
  end if;
  return false;
end;
$$;

revoke all on function auth_chat_topic(text) from public, anon;
-- The policy below calls it as the joining user, so `authenticated` must hold EXECUTE (0412).
grant execute on function auth_chat_topic(text) to authenticated;

do $do$
begin
  if not exists (select 1 from pg_namespace where nspname = 'realtime') then
    raise notice '0513: no realtime schema here (PGlite) — chat signals not installed';
    return;
  end if;

  -- ── The announcement ─────────────────────────────────────────────────────────────────────────
  execute $fn$
    create or replace function public.chat_signal()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      v_kind text;
      v_count integer;
      v_payload jsonb;
      v_user uuid;
    begin
      select t.kind into v_kind from public.message_threads t where t.id = new.thread_id;
      if v_kind is null or v_kind = 'driver' then
        return null;
      end if;
      v_payload := jsonb_build_object(
        'thread_id', new.thread_id, 'seq', new.seq, 'rev', new.rev, 'kind', v_kind,
        'op', case when tg_op = 'INSERT' then 'message' else 'change' end);
      begin
        perform realtime.send(v_payload, 'chat', 'chat:conv:' || new.thread_id::text, true);
        select count(*) into v_count from public.thread_participants p
         where p.thread_id = new.thread_id and p.left_at is null;
        if v_count <= 50 then
          for v_user in
            select p.user_id from public.thread_participants p
             where p.thread_id = new.thread_id and p.left_at is null
          loop
            perform realtime.send(v_payload, 'chat', 'chat:user:' || v_user::text, true);
          end loop;
        end if;
      exception when others then
        -- The poll delivers it anyway (D-CHAT2). Never roll a message back for a missed signal.
        raise warning 'chat signal for % not sent: %', new.thread_id, sqlerrm;
      end;
      return null;
    end;
    $body$
  $fn$;

  execute 'revoke all on function public.chat_signal() from public, anon, authenticated';
  execute 'drop trigger if exists trg_chat_signal on public.messages';
  execute 'create trigger trg_chat_signal after insert or update of body, deleted_at on public.messages
             for each row execute function public.chat_signal()';

  -- ── Who may join ─────────────────────────────────────────────────────────────────────────────
  execute 'drop policy if exists chat_topics_receive on realtime.messages';
  execute $p$
    create policy chat_topics_receive on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and (select public.auth_chat_topic((select realtime.topic())))
      )
  $p$;
end;
$do$;
