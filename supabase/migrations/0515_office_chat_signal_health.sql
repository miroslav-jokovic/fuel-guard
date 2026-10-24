-- Silvicom 360 — 0515 office chat: the realtime signal path gets a health record
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md CHA4; audit of release 1, 2026-10-23)
--
-- ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
-- 0513 made the database announce every chat change by `realtime.send`, and made the poll the
-- guarantee: a failed announcement is swallowed with `raise warning` so that a message is never rolled
-- back for a missed signal. That is the right failure mode for one message. It is the wrong one for a
-- WEEK of them: the warning goes to the Postgres log, which nobody in this repo reads, and every tab
-- falls back to its 10 s / 60 s poll without a word. The staging load test of 2026-10-23 met the real
-- case — `MissingPartition`, every join refused, because Realtime had been idle and had made no
-- partition for the day — and nothing but the test script could have said so. "Instant" that
-- silently becomes "within a minute" is a promise the product cannot see itself breaking.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- One platform table, `platform_realtime_health`, holding two kinds of row:
--   · `chat_send_failed` — written by `chat_signal()` itself, inside the exception handler that used
--     to only warn. The message is still committed and still polled; the failure is now ALSO a row.
--   · `probe` — written every fifteen minutes by the api's `realtime-probe` scheduler (general lane):
--     it joins the private topic `platform:realtime-probe`, asks `realtime_probe_send()` to announce
--     a nonce, and records whether and how fast the announcement came back through the real Realtime
--     service and a real websocket. That is the END-TO-END check: the trigger firing, the Realtime
--     server reading `realtime.messages`, and delivery to a subscriber. A send failure only sees the
--     first link.
-- `GET /api/version` publishes the latest probe (`realtime.state`) and the day's send-failure count,
-- folded into `ok`, so `platform-health.yml` pages on a Realtime that has stopped delivering the way
-- it pages on a stopped scheduler lane or a stale storage backup. Platform infrastructure, no tenant:
-- the rows carry no org, no conversation and no text — a failure's `detail` is Postgres's own error
-- sentence, a probe's is the nonce.
--
-- The probe's topic has no `realtime.messages` policy on purpose: the probe joins with the service
-- role, which bypasses RLS, and nobody else has a reason to hear it. A browser (authenticated) asking
-- for `platform:realtime-probe` is refused by the absence of a policy (0513 and 0514 grant only the
-- chat and driver topics).
--
-- Rollback: drop trigger trg_chat_signal on messages and re-create 0513's `chat_signal()`; drop function
-- realtime_probe_send(text); drop table platform_realtime_health. The api's probe scheduler and the
-- version endpoint's reader first.

-- ── 1. The health record ────────────────────────────────────────────────────────────────────────

create table if not exists platform_realtime_health (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  kind        text not null check (kind in ('chat_send_failed', 'probe')),
  ok          boolean not null,
  -- Probe only: how long the announcement took to come back through Realtime. Null when it did not.
  latency_ms  integer check (latency_ms is null or latency_ms >= 0),
  -- A failure's error sentence, or a probe's nonce. Never message text, never an org or a person.
  detail      text,
  check (kind <> 'chat_send_failed' or ok = false)
);
create index if not exists idx_platform_realtime_health_kind_at on platform_realtime_health (kind, at desc);

alter table platform_realtime_health enable row level security;
-- No client policies: written by the trigger and the probe, read by `/api/version` — service role only,
-- the platform_scheduler_leases shape (0506).

comment on table platform_realtime_health is
  'org: platform telemetry, no tenant. One row per failed chat signal (written by chat_signal) and one per realtime probe (written by the api''s realtime-probe scheduler). Read by GET /api/version → realtime (0515).';

-- ── 2. The probe's announcement, and the trigger that records its own failures ──────────────────
-- Only where the `realtime` schema exists, the 0513 rule: bare PGlite has none, and
-- `office-chat-realtime.test.mjs` installs a shim first so the matrix executes all of it.

do $do$
begin
  if not exists (select 1 from pg_namespace where nspname = 'realtime') then
    raise notice '0515: no realtime schema here (PGlite) — probe and failure recording not installed';
    return;
  end if;

  -- The probe. Service-role only: it is a platform act, and a browser that could call it could make
  -- the api's health reader believe Realtime is fine.
  execute $fn$
    create or replace function public.realtime_probe_send(p_nonce text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    begin
      if p_nonce is null or p_nonce !~ '^[0-9a-f-]{8,64}$' then
        raise exception 'a probe nonce is a short hex id' using errcode = '22023';
      end if;
      perform realtime.send(jsonb_build_object('nonce', p_nonce, 'at', now()), 'probe', 'platform:realtime-probe', true);
    end;
    $body$
  $fn$;
  execute 'revoke all on function public.realtime_probe_send(text) from public, anon, authenticated';
  execute 'grant execute on function public.realtime_probe_send(text) to service_role';

  -- 0513's announcement, unchanged in what it sends; changed in what it does when it cannot.
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
        -- The poll delivers it anyway (D-CHAT2). Never roll a message back for a missed signal — but
        -- never lose the fact that one was missed, either (0515): the row below is what
        -- `/api/version` counts. The error sentence names the cause (a missing partition, a
        -- refused call); it never carries the message.
        raise warning 'chat signal for % not sent: %', new.thread_id, sqlerrm;
        begin
          insert into public.platform_realtime_health (kind, ok, detail)
          values ('chat_send_failed', false, left(sqlerrm, 500));
        exception when others then
          -- A health row that cannot be written must not fail the message either.
          raise warning 'chat signal failure not recorded: %', sqlerrm;
        end;
      end;
      return null;
    end;
    $body$
  $fn$;
end;
$do$;
