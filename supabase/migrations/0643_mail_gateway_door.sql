-- Silvicom 360 — 0643 the broker-mail gateway's database door (BROKER-MAIL-READER-PLAN.md, P1 PR-a)
--
-- The gateway is a small program on AWS Lambda that reads the dispatchers' Outlook envelopes through
-- Microsoft Graph (D-BMR1–2). This migration is everything it may do in the database, and nothing
-- else: a login role with NO table privilege, five tables it never touches directly, and seven
-- `security definer` functions that are its only way in (D-BMR3). The API reads the tables with the
-- service role from P2; nothing reads them before then.
--
-- ── WHY A LOGIN WITH FUNCTIONS, NOT A LOGIN WITH TABLE GRANTS (A1, F3) ───────────────────────────
-- Every table here is RLS-on with no policy, and a login that is not `service_role` is refused on
-- every such table even WITH a grant — so table grants would not have worked, and they would have let
-- the gateway write any column of any row it could name. A function says exactly which row, which
-- columns, and refuses the rest. The table gates (F5) read `.from()` literals in app code; SQL over a
-- wire connection is invisible to them, and these function bodies are where they CAN see it.
--
-- ── WHY NO FUNCTION TAKES AN ORG (A8, D-BMR12) ───────────────────────────────────────────────────
-- The org is the single row of `mail_gateway_config`, written by a seed statement (P1) or an admin
-- act (P2) — never by the gateway. A gateway that could name a company could read another company's
-- loads. With one config row, one registration and one tenant (D-BMR12), "which company" is a fact of
-- the database, not a parameter. A second carrier is a second gateway.
--
-- ── WHY MATCHING IS INSIDE mailgw_record_messages (D-BMR8, changed at build) ─────────────────────
-- The plan drew a separate `mailgw_match_refs(text[])` that answered "which of these tokens is a
-- load". Folding the match into the write means the gateway cannot even ASK that question: it hands
-- over an envelope and its tokens, and learns nothing back about any load. The candidate rule's
-- "sender domain matched before" (D-BMR6) is a list of domains `mailgw_begin_cycle` returns — domains
-- the gateway's own envelopes already showed it.
--
-- ── WHAT IS STORED, AND WHAT IS NOT (D-BMR7, Q-BMR6) ─────────────────────────────────────────────
-- Envelope facts of EXTERNAL Inbox messages only. Internal mail (a colleague's note) serves as answer
-- proof inside the cycle (D-BMR9) and is never a row. No body, no preview, no attachment, no quoted
-- text, no unmatched token. Rows live 90 days (RETENTION_RULES), cycles 14.
--
-- ── WHO OWNS A ROW (D-BMR5, Q-BMR10, Q-BMR11) ────────────────────────────────────────────────────
-- A mailbox is DERIVED, every cycle, in `mailgw_derived_mailboxes`: a linked, active, non-system McLeod
-- dispatcher → a member of the org who is not suspended → their sign-in email → kept only if its
-- domain is in `mail_gateway_config.mail_domains` (Q-BMR10: the invite allowlist was measured empty
-- in production, and means something else) and the user is not in `excluded_user_ids` (Q-BMR11).
-- Empty `mail_domains` derives nobody: a missing setting fails closed. Nothing is typed.
--
-- ── WHY OLD CODE MEETS THIS SAFELY ───────────────────────────────────────────────────────────────
-- New tables, new functions, a new role: nothing existing reads or changes. The gateway that calls
-- these functions treats "function does not exist" as not-ready and ends its run (D-BMR3), so the
-- staging window where code arrives before this migration is quiet.
--
-- raw-access-waiver: `mailgw_derived_mailboxes` reads mcleod's raw `tms_dispatchers` (who is a
-- dispatcher, and which 360 user they are) in ONE statement, on purpose: the derived list must live in
-- the database so the gateway cannot widen it (D-BMR5). Read only; mcleod remains its only writer.
-- cross-module-waiver: broker-mail's functions READ org's `memberships`/`organizations`, loads'
-- `loads`/`load_stops` and mcleod's `tms_dispatchers`; they WRITE only broker-mail's own five tables.
--
-- Rollback: `drop function mailgw_*; drop table broker_mail_messages, mail_gateway_cursors,
-- mail_gateway_mailboxes, mail_gateway_cycles, mail_gateway_config; drop role mail_gateway;` —
-- nothing else depends on any of them.

-- ── 1. the role ─────────────────────────────────────────────────────────────────────────────────
-- NOLOGIN here, and no password in any migration (D-BMR3): `infra/mail-gateway/db-login.sh login`
-- turns login on with a generated password that lives only in Parameter Store. Guarded because the
-- matrices and the snapshot generator build a fresh cluster every run, and a role is cluster-wide.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mail_gateway') then
    create role mail_gateway nologin noinherit;
  end if;
end $$;
-- Three connections is two cycles overlapping by a minute and one spare; the lease refuses the second.
alter role mail_gateway connection limit 3;
alter role mail_gateway set statement_timeout = '15s';
alter role mail_gateway set idle_in_transaction_session_timeout = '30s';
-- USAGE lets it NAME things in public; every EXECUTE is granted one function at a time below.
grant usage on schema public to mail_gateway;

-- ── 2. the tables ───────────────────────────────────────────────────────────────────────────────
-- The single config row: the org, the switch, and the two lists (D-BMR3, Q-BMR10, Q-BMR11). The
-- unique index on a constant is the "one gateway per database" rule (D-BMR12), not a convention.
create table if not exists mail_gateway_config (
  org_id              uuid primary key references organizations(id) on delete cascade,
  enabled             boolean not null default false,
  body_reading        boolean not null default false,
  mail_domains        text[] not null default '{}',
  excluded_user_ids   uuid[] not null default '{}',
  lease_cycle_id      uuid,
  lease_until         timestamptz,
  canary_checked_at   timestamptz,
  canary_result       text check (canary_result in ('refused', 'opened', 'not_found', 'error')),
  disabled_reason     text check (length(disabled_reason) <= 200),
  updated_at          timestamptz not null default now()
);
alter table mail_gateway_config enable row level security;
create unique index if not exists mail_gateway_config_one_row on mail_gateway_config ((true));
comment on table mail_gateway_config is
  '0643 (BROKER-MAIL-READER-PLAN D-BMR3/12, Q-BMR10/11): the ONE row naming the org the mail gateway serves, its on switch, body reading, our mail domains and the users left out on purpose. The gateway reads it through mailgw_begin_cycle and can change only `enabled` (off, when the canary opens) and its own lease. Service-role only.';

create table if not exists mail_gateway_mailboxes (
  org_id          uuid not null references organizations(id) on delete cascade,
  mailbox         text not null check (mailbox = lower(mailbox) and length(mailbox) between 3 and 320),
  owner_user_id   uuid references auth.users(id) on delete set null,
  state           text not null default 'connected'
                  check (state in ('connected', 'not_connected', 'over_quota', 'still_connected_after_unlink')),
  state_at        timestamptz not null default now(),
  last_read_at    timestamptz,
  -- Set when the mailbox left the derived list; probed once a day for 30 days after (D-BMR14).
  unlinked_at     timestamptz,
  last_probe_at   timestamptz,
  primary key (org_id, mailbox)
);
alter table mail_gateway_mailboxes enable row level security;
comment on table mail_gateway_mailboxes is
  '0643 (D-BMR14): every mailbox the derived list has ever held, with what Graph last said about it — the admin''s mailbox list from P2. Written only by mailgw_* functions. Service-role only.';

create table if not exists mail_gateway_cursors (
  org_id        uuid not null,
  mailbox       text not null,
  folder_id     text not null check (length(folder_id) between 1 and 512),
  folder_role   text not null check (folder_role in ('inbox', 'inbox_child', 'sent')),
  delta_link    text not null check (length(delta_link) between 1 and 4096),
  saved_at      timestamptz not null default now(),
  primary key (org_id, mailbox, folder_id),
  foreign key (org_id, mailbox) references mail_gateway_mailboxes (org_id, mailbox) on delete cascade
);
alter table mail_gateway_cursors enable row level security;
comment on table mail_gateway_cursors is
  '0643 (D-BMR6, §7): one Graph message-delta position per folder of a mailbox, saved after every page so a long first read resumes the next minute. Written only by mailgw_save_cursor. Service-role only.';

create table if not exists mail_gateway_cycles (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  -- The gateway's own commit, so /api/version can say what runs (§6 Verify) without AWS access.
  commit        text check (commit ~ '^[0-9a-f]{7,40}$'),
  counts        jsonb not null default '{}'::jsonb
);
alter table mail_gateway_cycles enable row level security;
create index if not exists mail_gateway_cycles_started_idx on mail_gateway_cycles (org_id, started_at desc);
comment on table mail_gateway_cycles is
  '0643 (§6, §8): one row per gateway run — the heartbeat (commit, last start) and the measure week''s counts. 1,440 a day, kept 14 days. Written only by mailgw_begin_cycle/mailgw_end_cycle. Service-role only.';

create table if not exists broker_mail_messages (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  -- The receiving mailbox's 360 user: each row belongs to the dispatcher whose mailbox got it (Q-BM9).
  owner_user_id         uuid not null references auth.users(id) on delete cascade,
  mailbox               text not null check (mailbox = lower(mailbox)),
  internet_message_id   text not null check (length(internet_message_id) between 1 and 998),
  -- Per mailbox (V6): compared only with other rows of the SAME mailbox (D-BMR9).
  conversation_id       text check (length(conversation_id) <= 512),
  from_address          text check (from_address = lower(from_address)),
  from_domain           text check (from_domain = lower(from_domain)),
  received_at           timestamptz not null,
  subject               text check (length(subject) <= 255),
  addressed_directly    boolean not null,
  was_candidate         boolean not null,
  body_was_read         boolean not null,
  matched_refs          text[] not null default '{}',
  match_state           text not null check (match_state in ('one', 'several', 'none', 'not_tried')),
  load_id               uuid references loads(id) on delete set null,
  thread_state          text not null default 'waiting'
                        check (thread_state in ('waiting', 'answered_by_owner', 'answered_by_colleague')),
  answered_at           timestamptz,
  thread_checked_at     timestamptz,
  recorded_at           timestamptz not null default now(),
  unique (org_id, mailbox, internet_message_id),
  check ((thread_state = 'waiting') = (answered_at is null)),
  check ((match_state = 'one') = (load_id is not null) or load_id is null)
);
alter table broker_mail_messages enable row level security;
create index if not exists broker_mail_messages_waiting_idx
  on broker_mail_messages (org_id, mailbox, conversation_id) where thread_state = 'waiting';
create index if not exists broker_mail_messages_received_idx on broker_mail_messages (received_at);
comment on table broker_mail_messages is
  '0643 (D-BMR7): envelope facts of external Inbox mail in a dispatcher''s mailbox — sender, time, subject (<=255), whether it named a load, whether the owner''s mailbox shows an answer. NEVER a body, preview, attachment or quoted text. Kept 90 days (Q-BMR6). Written only by mailgw_record_messages/mailgw_mark_threads. Service-role only.';

-- ── 3. helpers (callable by no one but the functions below) ─────────────────────────────────────
-- The one config row, or a refusal. Every door function starts here.
create or replace function mailgw_config()
returns public.mail_gateway_config
language plpgsql stable security definer set search_path = ''
as $$
declare c public.mail_gateway_config;
begin
  select * into c from public.mail_gateway_config;
  if not found then raise exception 'mail gateway: no config row' using errcode = 'P0002'; end if;
  return c;
end $$;

-- The cycle's lease must be the one this call names, and still running (D-BMR3: one runner).
create or replace function mailgw_require_lease(p_cycle uuid)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare c public.mail_gateway_config := public.mailgw_config();
begin
  if p_cycle is null or c.lease_cycle_id is distinct from p_cycle or c.lease_until < now() then
    raise exception 'mail gateway: cycle % does not hold the lease', p_cycle using errcode = '55P03';
  end if;
  return c.org_id;
end $$;

-- D-BMR5 in one statement. Two McLeod logins of one person are one mailbox (distinct on user).
create or replace function mailgw_derived_mailboxes(p_org uuid)
returns table (mailbox text, owner_user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select distinct on (u.id) lower(u.email)::text, u.id
    from public.tms_dispatchers t
    join public.memberships m on m.user_id = t.user_id and m.org_id = t.org_id
    join auth.users u on u.id = t.user_id
    join public.mail_gateway_config c on c.org_id = t.org_id
   where t.org_id = p_org
     and t.user_id is not null and t.is_active and not t.is_system
     and m.suspended_at is null
     and u.email is not null
     and split_part(lower(u.email), '@', 2) = any (select lower(d) from unnest(c.mail_domains) d)
     and not (u.id = any (c.excluded_user_ids))
   order by u.id;
$$;

-- The token rule both sides share (normaliseBrokerMailToken in brokerMailContract.ts).
create or replace function mailgw_norm_token(p text)
returns text
language sql immutable set search_path = ''
as $$
  select case when length(x) between 4 and 64 then x end
    from (select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) as x) s;
$$;

-- ── 4. the door ─────────────────────────────────────────────────────────────────────────────────
-- Start a run: take the lease, refresh the derived list, open a cycle row, and hand back everything
-- the run may know. A held lease or a switched-off gateway returns cycle_id null and nothing else.
create or replace function mailgw_begin_cycle(p_commit text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  c public.mail_gateway_config := public.mailgw_config();
  v_cycle uuid := gen_random_uuid();
  v_taken int;
begin
  if not c.enabled then
    return jsonb_build_object('cycle_id', null, 'enabled', false, 'body_reading', c.body_reading,
      'mail_domains', '[]'::jsonb, 'mailboxes', '[]'::jsonb, 'cursors', '[]'::jsonb,
      'probe_unlinked', '[]'::jsonb, 'known_sender_domains', '[]'::jsonb, 'canary_due', false);
  end if;
  -- 55 s: Lambda's 50 s timeout plus margin. A crashed run's lease simply lapses.
  update public.mail_gateway_config
     set lease_cycle_id = v_cycle, lease_until = now() + interval '55 seconds'
   where org_id = c.org_id and (lease_until is null or lease_until < now());
  get diagnostics v_taken = row_count;
  if v_taken = 0 then
    return jsonb_build_object('cycle_id', null, 'enabled', true, 'body_reading', c.body_reading,
      'mail_domains', '[]'::jsonb, 'mailboxes', '[]'::jsonb, 'cursors', '[]'::jsonb,
      'probe_unlinked', '[]'::jsonb, 'known_sender_domains', '[]'::jsonb, 'canary_due', false);
  end if;

  insert into public.mail_gateway_cycles (id, org_id, commit)
  values (v_cycle, c.org_id, case when p_commit ~ '^[0-9a-f]{7,40}$' then p_commit end);

  -- Derived now → linked (owner refreshed, unlink cleared); held before but not now → unlinked once.
  insert into public.mail_gateway_mailboxes as mb (org_id, mailbox, owner_user_id)
  select c.org_id, d.mailbox, d.owner_user_id from public.mailgw_derived_mailboxes(c.org_id) d
  on conflict (org_id, mailbox) do update
     set owner_user_id = excluded.owner_user_id, unlinked_at = null,
         state = case when mb.state = 'still_connected_after_unlink' then 'connected' else mb.state end;
  update public.mail_gateway_mailboxes mb
     set unlinked_at = now()
   where mb.org_id = c.org_id and mb.unlinked_at is null
     and mb.mailbox not in (select d.mailbox from public.mailgw_derived_mailboxes(c.org_id) d);

  return jsonb_build_object(
    'cycle_id', v_cycle,
    'enabled', true,
    'body_reading', c.body_reading,
    'mail_domains', to_jsonb(c.mail_domains),
    'mailboxes', coalesce((select jsonb_agg(jsonb_build_object('mailbox', d.mailbox, 'owner_user_id', d.owner_user_id) order by d.mailbox)
                             from public.mailgw_derived_mailboxes(c.org_id) d), '[]'::jsonb),
    'cursors', coalesce((select jsonb_agg(jsonb_build_object('mailbox', k.mailbox, 'folder_id', k.folder_id,
                                   'folder_role', k.folder_role, 'delta_link', k.delta_link))
                           from public.mail_gateway_cursors k
                           join public.mail_gateway_mailboxes mb on mb.org_id = k.org_id and mb.mailbox = k.mailbox
                          where k.org_id = c.org_id and mb.unlinked_at is null), '[]'::jsonb),
    'probe_unlinked', coalesce((select jsonb_agg(mb.mailbox order by mb.mailbox)
                                  from public.mail_gateway_mailboxes mb
                                 where mb.org_id = c.org_id and mb.unlinked_at > now() - interval '30 days'
                                   and (mb.last_probe_at is null or mb.last_probe_at < now() - interval '1 day')), '[]'::jsonb),
    'known_sender_domains', coalesce((select jsonb_agg(distinct m.from_domain)
                                        from public.broker_mail_messages m
                                       where m.org_id = c.org_id and m.match_state = 'one' and m.from_domain is not null
                                         and m.received_at > now() - interval '45 days'), '[]'::jsonb),
    'canary_due', c.canary_checked_at is null or c.canary_checked_at < now() - interval '1 day');
end $$;

-- A folder's delta position; null forgets it (a cursor Graph reset, D-BMR6). Only a mailbox still on
-- the derived list may have one.
create or replace function mailgw_save_cursor(p_cycle uuid, p_mailbox text, p_folder_id text, p_folder_role text, p_delta_link text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_org uuid := public.mailgw_require_lease(p_cycle);
begin
  if not exists (select 1 from public.mail_gateway_mailboxes
                  where org_id = v_org and mailbox = lower(p_mailbox) and unlinked_at is null) then
    raise exception 'mail gateway: mailbox not on the derived list' using errcode = '42501';
  end if;
  if p_delta_link is null then
    delete from public.mail_gateway_cursors where org_id = v_org and mailbox = lower(p_mailbox) and folder_id = p_folder_id;
  else
    insert into public.mail_gateway_cursors (org_id, mailbox, folder_id, folder_role, delta_link)
    values (v_org, lower(p_mailbox), p_folder_id, p_folder_role, p_delta_link)
    on conflict (org_id, mailbox, folder_id) do update
       set folder_role = excluded.folder_role, delta_link = excluded.delta_link, saved_at = now();
  end if;
end $$;

-- Envelopes in (D-BMR7/8). Refuses the whole batch if any names a mailbox off the derived list;
-- skips internal senders (they are never rows); matches tokens against the org's recent loads; a
-- re-read of the same message is a no-op. Returns how many rows were new.
create or replace function mailgw_record_messages(p_cycle uuid, p_envelopes jsonb)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_org uuid := public.mailgw_require_lease(p_cycle);
  c public.mail_gateway_config := public.mailgw_config();
  e jsonb;
  v_mailbox text; v_owner uuid; v_from text; v_domain text;
  v_tokens text[]; v_loads uuid[]; v_hits text[];
  v_new int := 0; v_ins int;
begin
  if jsonb_typeof(p_envelopes) is distinct from 'array' or jsonb_array_length(p_envelopes) > 500 then
    raise exception 'mail gateway: envelopes must be an array of at most 500' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_envelopes) loop
    v_mailbox := lower(e->>'mailbox');
    select mb.owner_user_id into v_owner from public.mail_gateway_mailboxes mb
     where mb.org_id = v_org and mb.mailbox = v_mailbox and mb.unlinked_at is null;
    if v_owner is null then
      raise exception 'mail gateway: mailbox not on the derived list' using errcode = '42501';
    end if;
    v_from := lower(nullif(e->>'from_address', ''));
    v_domain := nullif(split_part(coalesce(v_from, ''), '@', 2), '');
    if v_domain = any (select lower(d) from unnest(c.mail_domains) d) then continue; end if;

    select coalesce(array_agg(distinct t) filter (where t is not null), '{}') into v_tokens
      from (select public.mailgw_norm_token(x) t
              from jsonb_array_elements_text(coalesce(e->'tokens', '[]'::jsonb)) x limit 50) s;
    -- P1: exact match only, on the reference columns that sit on the load itself, for loads touched
    -- in the last 45 days (D-BMR8; F14 corrected — `loads` has no po_number, and nothing joins a McLeod
    -- movement to a load, so movement columns wait for that join).
    select coalesce(array_agg(distinct l.id), '{}'), coalesce(array_agg(distinct r.tok), '{}')
      into v_loads, v_hits
      from public.loads l
      join lateral (
        select public.mailgw_norm_token(l.ref) union all select public.mailgw_norm_token(l.pickup_number)
        union all select public.mailgw_norm_token(l.consignee_ref)
        union all select public.mailgw_norm_token(s.po_number) from public.load_stops s where s.load_id = l.id and s.org_id = l.org_id
      ) r(tok) on r.tok = any (v_tokens)
     where l.org_id = v_org and l.updated_at > now() - interval '45 days' and cardinality(v_tokens) > 0;

    insert into public.broker_mail_messages
      (org_id, owner_user_id, mailbox, internet_message_id, conversation_id, from_address, from_domain,
       received_at, subject, addressed_directly, was_candidate, body_was_read, matched_refs, match_state, load_id)
    values
      (v_org, v_owner, v_mailbox, e->>'internet_message_id', nullif(e->>'conversation_id', ''), v_from, v_domain,
       (e->>'received_at')::timestamptz, left(nullif(e->>'subject', ''), 255),
       coalesce((e->>'addressed_directly')::boolean, false), coalesce((e->>'was_candidate')::boolean, false),
       coalesce((e->>'body_was_read')::boolean, false), v_hits,
       case when cardinality(v_tokens) = 0 then 'not_tried'
            when cardinality(v_loads) = 0 then 'none'
            when cardinality(v_loads) = 1 then 'one' else 'several' end,
       case when cardinality(v_loads) = 1 then v_loads[1] end)
    on conflict (org_id, mailbox, internet_message_id) do nothing;
    get diagnostics v_ins = row_count;
    v_new := v_new + v_ins;
  end loop;
  return v_new;
end $$;

-- Answers seen in the owner's own mailbox (D-BMR9), then the freshness stamp. A waiting row closes
-- only when the answer is later than it, in the same mailbox and conversation, and the row's sender
-- (address, or domain) is among the answer's recipients. `p_checked` = mailboxes this cycle read to
-- the end: only their waiting rows get `thread_checked_at`, which is what 360's text door trusts (D-BMR10).
create or replace function mailgw_mark_threads(p_cycle uuid, p_answers jsonb, p_checked text[])
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_org uuid := public.mailgw_require_lease(p_cycle);
  a jsonb; v_rcpt text[]; v_closed int := 0; v_n int;
begin
  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) > 2000 then
    raise exception 'mail gateway: answers must be an array of at most 2000' using errcode = '22023';
  end if;
  for a in select * from jsonb_array_elements(p_answers) loop
    if a->>'by' not in ('owner', 'colleague') then
      raise exception 'mail gateway: answer.by must be owner or colleague' using errcode = '22023';
    end if;
    select coalesce(array_agg(lower(x)), '{}') into v_rcpt from jsonb_array_elements_text(coalesce(a->'recipients', '[]'::jsonb)) x;
    update public.broker_mail_messages m
       set thread_state = case when a->>'by' = 'owner' then 'answered_by_owner' else 'answered_by_colleague' end,
           answered_at = (a->>'answered_at')::timestamptz
     where m.org_id = v_org and m.mailbox = lower(a->>'mailbox')
       and m.conversation_id = a->>'conversation_id'
       and m.thread_state = 'waiting'
       and m.received_at < (a->>'answered_at')::timestamptz
       and (m.from_address = any (v_rcpt)
            or m.from_domain = any (select split_part(r, '@', 2) from unnest(v_rcpt) r));
    get diagnostics v_n = row_count;
    v_closed := v_closed + v_n;
  end loop;
  update public.broker_mail_messages m
     set thread_checked_at = now()
   where m.org_id = v_org and m.thread_state = 'waiting'
     and m.mailbox in (select lower(x) from unnest(coalesce(p_checked, '{}')) x)
     and m.mailbox in (select mb.mailbox from public.mail_gateway_mailboxes mb where mb.org_id = v_org and mb.unlinked_at is null);
  update public.mail_gateway_mailboxes mb
     set last_read_at = now(),
         state = case when mb.state in ('not_connected', 'over_quota') then 'connected' else mb.state end,
         state_at = case when mb.state in ('not_connected', 'over_quota') then now() else mb.state_at end
   where mb.org_id = v_org and mb.mailbox in (select lower(x) from unnest(coalesce(p_checked, '{}')) x);
  return v_closed;
end $$;

-- A daily probe's result (D-BMR14). An opened canary switches the gateway OFF in this same call — the
-- gateway does not get to decide whether to stop. The canary's address is not stored: it is in
-- Parameter Store, and the result is a fact about the scope, not about a mailbox.
create or replace function mailgw_record_probe(p_cycle uuid, p_kind text, p_mailbox text, p_result text)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare v_org uuid := public.mailgw_require_lease(p_cycle);
begin
  if p_result not in ('refused', 'opened', 'not_found', 'error') then
    raise exception 'mail gateway: unknown probe result' using errcode = '22023';
  end if;
  if p_kind = 'canary' then
    update public.mail_gateway_config
       set canary_checked_at = now(), canary_result = p_result,
           enabled = case when p_result = 'opened' then false else enabled end,
           disabled_reason = case when p_result = 'opened'
                                  then 'canary mailbox opened ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC — the mail scope is wrong'
                                  else disabled_reason end,
           updated_at = now()
     where org_id = v_org;
    return p_result <> 'opened';
  elsif p_kind = 'unlinked' then
    update public.mail_gateway_mailboxes
       set last_probe_at = now(),
           state = case when p_result = 'opened' then 'still_connected_after_unlink' else 'not_connected' end,
           state_at = now()
     where org_id = v_org and mailbox = lower(p_mailbox) and unlinked_at is not null;
    return true;
  end if;
  raise exception 'mail gateway: unknown probe kind' using errcode = '22023';
end $$;

-- End a run: counts on the cycle row, Graph's word on each mailbox it could not read, lease released.
create or replace function mailgw_end_cycle(p_cycle uuid, p_counts jsonb, p_mailbox_states jsonb)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_org uuid := public.mailgw_require_lease(p_cycle); s jsonb;
begin
  if jsonb_typeof(p_counts) is distinct from 'object' then
    raise exception 'mail gateway: counts must be an object' using errcode = '22023';
  end if;
  update public.mail_gateway_cycles
     set ended_at = now(),
         counts = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p_counts) kv(k, v)
                    where jsonb_typeof(v) = 'number' and k ~ '^[a-z_]{1,40}$')
   where id = p_cycle and org_id = v_org;
  for s in select * from jsonb_array_elements(coalesce(p_mailbox_states, '[]'::jsonb)) loop
    if s->>'state' not in ('not_connected', 'over_quota') then
      raise exception 'mail gateway: a cycle may report only not_connected or over_quota' using errcode = '22023';
    end if;
    update public.mail_gateway_mailboxes
       set state = s->>'state', state_at = now()
     where org_id = v_org and mailbox = lower(s->>'mailbox') and unlinked_at is null and state <> s->>'state';
  end loop;
  update public.mail_gateway_config set lease_cycle_id = null, lease_until = null
   where org_id = v_org and lease_cycle_id = p_cycle;
end $$;

-- ── 5. grants: the door is exactly these seven, for exactly this role ───────────────────────────
-- Revoked from service_role too: the API reads the TABLES (P2) and has no business opening a cycle,
-- so nothing but the gateway can take its lease or switch it off by a probe.
revoke all on function mailgw_config() from public, anon, authenticated, service_role;
revoke all on function mailgw_require_lease(uuid) from public, anon, authenticated, service_role;
revoke all on function mailgw_derived_mailboxes(uuid) from public, anon, authenticated, service_role;
revoke all on function mailgw_norm_token(text) from public, anon, authenticated, service_role;
revoke all on function mailgw_begin_cycle(text) from public, anon, authenticated, service_role;
revoke all on function mailgw_save_cursor(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function mailgw_record_messages(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function mailgw_mark_threads(uuid, jsonb, text[]) from public, anon, authenticated, service_role;
revoke all on function mailgw_record_probe(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function mailgw_end_cycle(uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function mailgw_begin_cycle(text) to mail_gateway;
grant execute on function mailgw_save_cursor(uuid, text, text, text, text) to mail_gateway;
grant execute on function mailgw_record_messages(uuid, jsonb) to mail_gateway;
grant execute on function mailgw_mark_threads(uuid, jsonb, text[]) to mail_gateway;
grant execute on function mailgw_record_probe(uuid, text, text, text) to mail_gateway;
grant execute on function mailgw_end_cycle(uuid, jsonb, jsonb) to mail_gateway;
-- The derived list is also what the admin's mailbox list (P2) shows as "should be in the mail group";
-- the API reads it through this one helper, so the rule exists once.
grant execute on function mailgw_derived_mailboxes(uuid) to service_role;

-- ── 6. what PUBLIC still holds ─────────────────────────────────────────────────────────────────
-- A role holds everything PUBLIC holds, and functions created before 0412 still carry PUBLIC execute
-- (measured 2026-11-24 by mail-gateway-door.test.mjs on the platform's default ACL: 38 definer
-- functions). 34 are trigger functions, which Postgres refuses to call directly. The other four are
-- the RLS helpers, which read only the caller's JWT claims — a direct login has none — and whose ACL
-- already names anon, authenticated and service_role one by one, so PUBLIC's entry adds nothing.
-- Revoked only where all three named grants are present: on a database whose ACL differs, the helper
-- is left exactly as it was (and the door matrix, run against the migrations, would say so).
do $$
declare f regprocedure;
begin
  foreach f in array array['public.auth_driver_id()', 'public.auth_dispatched_load_ids()',
                           'public.auth_in_thread(uuid)', 'public.auth_module_enabled(text)']::regprocedure[] loop
    if (select count(distinct a.grantee) from pg_proc p, aclexplode(p.proacl) a
         where p.oid = f and a.privilege_type = 'EXECUTE'
           and a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))) = 3 then
      execute format('revoke execute on function %s from public', f);
    end if;
  end loop;
end $$;

comment on function mailgw_begin_cycle(text) is
  '0643 (D-BMR3/5): the mail gateway''s first call each run — the lease, the config, the derived mailbox list, its cursors and probes. Executable only by mail_gateway.';
comment on function mailgw_record_messages(uuid, jsonb) is
  '0643 (D-BMR7/8): stores external Inbox envelopes of derived mailboxes and matches their tokens to loads in SQL; the gateway learns nothing about any load. Executable only by mail_gateway.';
comment on function mailgw_mark_threads(uuid, jsonb, text[]) is
  '0643 (D-BMR9): closes waiting rows on proof inside the owner''s own mailbox, and stamps thread_checked_at for mailboxes read to the end. Executable only by mail_gateway.';
comment on function mailgw_record_probe(uuid, text, text, text) is
  '0643 (D-BMR14): daily canary/unlinked probe results; an opened canary switches the gateway off in the same call. Executable only by mail_gateway.';
