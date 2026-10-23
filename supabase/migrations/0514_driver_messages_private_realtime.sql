-- Silvicom 360 — 0514 driver messages on PRIVATE Realtime channels (OFFICE-CHAT-PLAN, "Allow public
-- access" off)
--
-- Supabase's Realtime setting "Allow public access" lets anybody holding the publishable key open a
-- PUBLIC channel and broadcast on it — free traffic billed to us, and a channel name a client forgets
-- to mark private silently joins without any check. 0513 asked the owner to switch it off. Turning it
-- off refuses every public channel, and the driver app's message channel (`useMessages.ts`, 0096's
-- Postgres Changes on `messages`) is public. Measured 2026-10-23: it is the only other `.channel(` in
-- the repo. So the setting waits for this migration and the driver build that uses it.
--
-- ── THE TOPICS ──────────────────────────────────────────────────────────────────────────────────
--   driver:inbox:<user id>     the signed-in person's own inbox — only that person
--   driver:thread:<thread id>  one conversation — only a current participant of it, in their own org
-- The public names they replace (`messages-inbox`, `messages-<thread>`) were one name shared by every
-- driver of every org. That was harmless while public, because Postgres Changes filters each change by
-- the table's RLS. As private channels they would need a policy granting a shared topic to everyone,
-- so each topic is now somebody's own.
--
-- ── WHY THE POLICY DOES NOT NAME AN EXTENSION ───────────────────────────────────────────────────
-- Realtime authorises a private join by inserting a probe row into `realtime.messages` for each
-- extension it reads and asking whether the joiner's SELECT sees it (`realtime.authorize`, read on
-- staging 2026-10-23). Supabase does not document which extensions a Postgres Changes join probes.
-- A policy that names one could refuse the driver's join and leave it on the poll without anybody
-- noticing. Granting every extension on these topics is safe:
--   · nobody else can join them (own user / current participant);
--   · nothing broadcasts on them, and the browser cannot (no INSERT policy, as in 0513);
--   · Presence is off for the project, and the app tracks none;
--   · Postgres Changes still filters each row through `messages`' own RLS (0096).
--
-- ⚠ ORDER: this policy, then a driver build that joins the new private topics, then the setting.
-- Until the setting is off, a driver app on the old build keeps its public channel. After it, that
-- app falls back to its poll, which the hook already treats as the guarantee ("the poll is the
-- guarantee, realtime is the speed").
--
-- Rollback: drop policy driver_message_topics_receive on realtime.messages; drop function
-- auth_driver_message_topic(text). Revert the driver build first.

-- The rule for a topic, stated once and readable by the matrix without a shim of the policy machinery
-- (the 0513 `auth_chat_topic` shape). A malformed id is simply not allowed.
create or replace function auth_driver_message_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_topic is null or public.auth_user_id() is null then
    return false;
  end if;
  if p_topic like 'driver:inbox:%' then
    return substr(p_topic, 14) = public.auth_user_id()::text;
  end if;
  if p_topic like 'driver:thread:%' then
    begin
      v_id := substr(p_topic, 15)::uuid;
    exception when invalid_text_representation then
      return false;
    end;
    return exists (
      select 1 from public.message_threads t
       where t.id = v_id and t.kind = 'driver' and t.org_id = public.auth_org_id()
    ) and public.auth_in_thread(v_id);
  end if;
  return false;
end;
$$;

revoke all on function auth_driver_message_topic(text) from public, anon;
-- The policy calls it as the joining user, so `authenticated` must hold EXECUTE (0412).
grant execute on function auth_driver_message_topic(text) to authenticated;

do $do$
begin
  if not exists (select 1 from pg_namespace where nspname = 'realtime') then
    raise notice '0514: no realtime schema here (PGlite) — driver topic policy not installed';
    return;
  end if;
  execute 'drop policy if exists driver_message_topics_receive on realtime.messages';
  execute $p$
    create policy driver_message_topics_receive on realtime.messages
      for select to authenticated
      using ((select public.auth_driver_message_topic((select realtime.topic()))))
  $p$;
end;
$do$;
