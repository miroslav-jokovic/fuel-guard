-- Silvicom 360 — 0656 broker mail P4 starts in the database: what a broker asks, the reply draft's
-- road to Outlook, and a person's two closes (BROKER-MAIL-READER-PLAN §9 P4, D-BMR4, D-BMR11).
--
-- ── 1. WHAT A BROKER ASKS: `broker_mail_messages.ask_kinds` (D-BMR11) ────────────────────────────
-- A closed list the GATEWAY finds by fixed word rules on the subject (and the body while it is held in
-- memory, when body reading is on). An enum, never text: the draft is composed in the API from 360's
-- own load facts plus these words, and nothing a broker wrote ever reaches the model. Written by
-- `mailgw_record_messages`, whose body is replaced here with the same signature (D-BMR3: a signature
-- never changes in place); a gateway that sends no `ask_kinds` key stores `{}`, so the old gateway
-- meets this function safely, and this function meets the old gateway's envelopes safely.
--
-- ── 2. A PERSON'S TWO CLOSES: `closed_not_for_us`, `closed_by_phone` ────────────────────────────
-- Two more thread states, set by the API when the mailbox's owner says so (the mockup's "Not for us"
-- and "Handled by phone"). They do not contradict the gateway's next read, which the P3 note feared:
-- `mailgw_mark_threads` only ever moves a `waiting` row and `mailgw_record_messages` never rewrites a
-- row, so a closed row stays closed, and a broker's NEW email is a new row whose clock starts again
-- (the ruling). `answered_at` carries the moment of the close, so `(thread_state = 'waiting') =
-- (answered_at is null)` holds unchanged; `closed_by` says who.
--
-- ── 3. THE DRAFT'S ROAD: `broker_mail_drafts` (D-BMR11 "the road to Outlook") ───────────────────
-- The API queues a row with the text the dispatcher approved; the gateway claims it, makes the reply
-- in the owner's own Outlook (createReply, D-BMR4 shape 7), and `mailgw_complete_draft` CLEARS THE
-- TEXT, keeping only the draft's Graph id and the text's SHA-256. These are our words, not a broker's,
-- and they sit in the database for the minute between a click and the next run. The CHECK below makes
-- "text only while queued or claimed" a property of the table, not of the code.
--   · Never step on a human (analysis, ruled 2026-11-24): a draft whose email was answered before it
--     reached Outlook ends `answered_first`; one whose conversation already holds a person's draft ends
--     `person_draft_found` (the gateway looks in Drafts first).
--   · The remove-own-draft rule: when the OWNER answers in their own words, the draft 360 made is
--     deleted again — only a draft whose id 360 recorded. `mailgw_claim_drafts` hands those back as
--     `remove`; Graph's 404 means it was sent or deleted by hand (`sent_or_gone`).
--   · One open draft per email (the partial unique index): a second click is a 409, not two drafts.
--
-- ── 4. WHAT A DRAFT COST: `broker_mail_compose_usage` + `broker_mail_record_compose` ────────────
-- 0584's argument for the fifth time: the ledger row (tokens, the outcome, the text's SHA-256 — never
-- the words) and the carrier's monthly token counter `org_usage_month` move in ONE call, so the
-- "Monthly AI usage limit" sees broker-mail drafts like every other AI spender. `user_id` and
-- `message_id` carry no foreign key: what a draft cost outlives the 90-day envelope row.
--
-- raw-access-waiver: none — no raw-layer table is read.
-- cross-module-waiver: `broker_mail_record_compose` increments org's `org_usage_month`, the org-wide
-- token counter, exactly as 0130/0451/0549/0584 do; everything else here is broker-mail's own.
--
-- ADDITIVE, and old code meets it safely: two new columns no old reader selects, a widened CHECK whose
-- new words only the next merge's API writes, a new table and three new functions nobody calls yet,
-- and `mailgw_record_messages` answering exactly as before when `ask_kinds` is absent.
-- Rollback: drop the three functions, the two tables, the two columns; restore 0643's thread_state
-- CHECK and its `mailgw_record_messages` body.

-- ── 1. ask_kinds and the person's closes ────────────────────────────────────────────────────────
alter table public.broker_mail_messages
  add column if not exists ask_kinds text[] not null default '{}'
    check (ask_kinds <@ array['eta', 'location', 'tracking_link', 'appointment', 'pod', 'delay_reason', 'other']::text[]),
  add column if not exists closed_by uuid references auth.users(id) on delete set null;

alter table public.broker_mail_messages drop constraint if exists broker_mail_messages_thread_state_check;
alter table public.broker_mail_messages add constraint broker_mail_messages_thread_state_check
  check (thread_state in ('waiting', 'answered_by_owner', 'answered_by_colleague', 'closed_not_for_us', 'closed_by_phone'));
-- `closed_by` is not tied to the state by a CHECK on purpose: it is `on delete set null`, and a CHECK
-- would turn a departing user's deletion into an error on every row they ever closed.

-- ── 2. the drafts ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.broker_mail_drafts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  message_id       uuid not null references public.broker_mail_messages(id) on delete cascade,
  -- The receiving mailbox and its owner, copied from the message at queue time: whose Outlook gets it.
  mailbox          text not null check (mailbox = lower(mailbox)),
  owner_user_id    uuid not null references auth.users(id) on delete cascade,
  requested_by     uuid references auth.users(id) on delete set null,
  requested_at     timestamptz not null default now(),
  state            text not null default 'queued' check (state in
                     ('queued', 'claimed', 'in_outlook', 'answered_first', 'person_draft_found', 'not_found',
                      'refused', 'failed', 'expired', 'removed', 'sent_or_gone')),
  -- Our words, until Outlook has them (D-BMR11). Never a broker's text.
  draft_text       text check (length(draft_text) between 1 and 4000),
  text_sha256      text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  -- 'model' = sent as 360 wrote it; 'edited' = the dispatcher changed it first (a learning-note signal, P5).
  composed_by      text not null check (composed_by in ('model', 'edited')),
  -- Which load facts the draft stated (P5 compares the sent reply against these). A closed list.
  facts_included   text[] not null default '{}'
                     check (facts_included <@ array['status', 'accepted', 'truck', 'trailer', 'location', 'eta', 'miles_left', 'appointment', 'next_stop']::text[]),
  claimed_at       timestamptz,
  claim_cycle_id   uuid,
  graph_draft_id   text check (length(graph_draft_id) between 1 and 512),
  in_outlook_at    timestamptz,
  completed_at     timestamptz,
  check ((state in ('queued', 'claimed')) = (draft_text is not null)),
  check (state <> 'in_outlook' or graph_draft_id is not null)
);
alter table public.broker_mail_drafts enable row level security;
create unique index if not exists broker_mail_drafts_one_open
  on public.broker_mail_drafts (message_id) where state in ('queued', 'claimed', 'in_outlook');
create index if not exists broker_mail_drafts_work_idx
  on public.broker_mail_drafts (org_id, state, requested_at) where state in ('queued', 'claimed', 'in_outlook');
comment on table public.broker_mail_drafts is
  '0656 (D-BMR11): one reply draft 360 puts in a dispatcher''s own Outlook. The API queues it with the text the dispatcher approved; the gateway claims it (mailgw_claim_drafts), creates it in Outlook and mailgw_complete_draft clears the text, keeping the Graph id and the SHA-256. Never a broker''s words. Cascades with its envelope row (90 days). Service-role only; the gateway reaches it only through its two functions.';

-- ── 3. the compose ledger ───────────────────────────────────────────────────────────────────────
create table if not exists public.broker_mail_compose_usage (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  user_id        uuid,
  message_id     uuid,
  composed_at    timestamptz not null default now(),
  model          text not null check (length(model) between 1 and 100),
  input_tokens   integer not null default 0 check (input_tokens >= 0),
  output_tokens  integer not null default 0 check (output_tokens >= 0),
  outcome        text not null check (outcome in ('drafted', 'fact_check_refused', 'model_refused', 'off_schema', 'error')),
  text_sha256    text check (text_sha256 ~ '^[0-9a-f]{64}$')
);
alter table public.broker_mail_compose_usage enable row level security;
create index if not exists broker_mail_compose_usage_org_idx on public.broker_mail_compose_usage (org_id, composed_at desc);
comment on table public.broker_mail_compose_usage is
  '0656 (D-BMR11): what each broker-mail draft cost — model, tokens, outcome, the text''s SHA-256; never the words. Written only by broker_mail_record_compose, which adds the tokens to org_usage_month in the same call. No FK on user or message: the cost outlives both. Service-role only.';

create or replace function public.broker_mail_record_compose(
  p_org uuid, p_user uuid, p_message uuid, p_model text, p_input_tokens integer, p_output_tokens integer,
  p_outcome text, p_text_sha256 text, p_yyyymm text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  insert into public.broker_mail_compose_usage (org_id, user_id, message_id, model, input_tokens, output_tokens, outcome, text_sha256)
  values (p_org, p_user, p_message, p_model, greatest(coalesce(p_input_tokens, 0), 0), greatest(coalesce(p_output_tokens, 0), 0), p_outcome, p_text_sha256);
  -- A call that reached no model spent nothing: a ledger row, no counter row (0584's rule).
  if coalesce(p_input_tokens, 0) + coalesce(p_output_tokens, 0) > 0 then
    insert into public.org_usage_month (org_id, yyyymm, input_tokens, output_tokens)
    values (p_org, p_yyyymm, greatest(p_input_tokens, 0), greatest(p_output_tokens, 0))
    on conflict (org_id, yyyymm) do update
       set input_tokens = public.org_usage_month.input_tokens + excluded.input_tokens,
           output_tokens = public.org_usage_month.output_tokens + excluded.output_tokens,
           updated_at = now();
  end if;
end $$;
revoke all on function public.broker_mail_record_compose(uuid, uuid, uuid, text, integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.broker_mail_record_compose(uuid, uuid, uuid, text, integer, integer, text, text, text) to service_role;

-- ── 4. mailgw_record_messages, now storing ask_kinds (same signature, same answers otherwise) ───
create or replace function public.mailgw_record_messages(p_cycle uuid, p_envelopes jsonb)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_org uuid := public.mailgw_require_lease(p_cycle);
  c public.mail_gateway_config := public.mailgw_config();
  e jsonb;
  v_mailbox text; v_owner uuid; v_from text; v_domain text;
  v_tokens text[]; v_loads uuid[]; v_hits text[]; v_asks text[];
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
    -- Only words of the closed list survive; anything else a gateway sends is dropped, not refused, so
    -- a newer gateway's word cannot fail an older database's batch.
    select coalesce(array_agg(distinct k order by k), '{}') into v_asks
      from jsonb_array_elements_text(case when jsonb_typeof(e->'ask_kinds') = 'array' then e->'ask_kinds' else '[]'::jsonb end) k
     where k in ('eta', 'location', 'tracking_link', 'appointment', 'pod', 'delay_reason', 'other');
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
       received_at, subject, addressed_directly, was_candidate, body_was_read, matched_refs, match_state, load_id, ask_kinds)
    values
      (v_org, v_owner, v_mailbox, e->>'internet_message_id', nullif(e->>'conversation_id', ''), v_from, v_domain,
       (e->>'received_at')::timestamptz, left(nullif(e->>'subject', ''), 255),
       coalesce((e->>'addressed_directly')::boolean, false), coalesce((e->>'was_candidate')::boolean, false),
       coalesce((e->>'body_was_read')::boolean, false), v_hits,
       case when cardinality(v_tokens) = 0 then 'not_tried'
            when cardinality(v_loads) = 0 then 'none'
            when cardinality(v_loads) = 1 then 'one' else 'several' end,
       case when cardinality(v_loads) = 1 then v_loads[1] end,
       v_asks)
    on conflict (org_id, mailbox, internet_message_id) do nothing;
    get diagnostics v_ins = row_count;
    v_new := v_new + v_ins;
  end loop;
  return v_new;
end $$;

-- ── 5. the command side of the door (D-BMR3: P4's two functions) ────────────────────────────────
-- One run's draft work. First the drafts that can no longer be made: the email was answered or closed
-- before Outlook had the draft (`answered_first`), or the draft waited 30 minutes for a run that never
-- came (`expired` — the dispatcher may ask again). Both lose their text here. Then up to 20 drafts to
-- CREATE (queued, or claimed by a run that died 2 minutes ago), for mailboxes on the derived list only,
-- each with the text and the email's two ids. Then the drafts to REMOVE: in Outlook, and the owner has
-- since answered the email in their own words (the remove-own-draft rule).
create or replace function public.mailgw_claim_drafts(p_cycle uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_org uuid := public.mailgw_require_lease(p_cycle);
  v_create jsonb; v_remove jsonb;
begin
  update public.broker_mail_drafts d
     set state = 'answered_first', draft_text = null, completed_at = now()
    from public.broker_mail_messages m
   where d.org_id = v_org and m.id = d.message_id and m.org_id = v_org
     and d.state in ('queued', 'claimed') and m.thread_state <> 'waiting';
  update public.broker_mail_drafts d
     set state = 'expired', draft_text = null, completed_at = now()
   where d.org_id = v_org and d.state in ('queued', 'claimed') and d.requested_at < now() - interval '30 minutes';

  with picked as (
    select d.id from public.broker_mail_drafts d
      join public.mail_gateway_mailboxes mb on mb.org_id = d.org_id and mb.mailbox = d.mailbox and mb.unlinked_at is null
     where d.org_id = v_org
       and (d.state = 'queued' or (d.state = 'claimed' and d.claimed_at < now() - interval '2 minutes'))
     order by d.requested_at
     limit 20
     for update of d skip locked
  ), claimed as (
    update public.broker_mail_drafts d
       set state = 'claimed', claimed_at = now(), claim_cycle_id = p_cycle
      from picked where d.id = picked.id
    returning d.id, d.mailbox, d.message_id, d.draft_text
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'draft_id', c.id, 'mailbox', c.mailbox, 'text', c.draft_text,
           'internet_message_id', m.internet_message_id, 'conversation_id', m.conversation_id)), '[]'::jsonb)
    into v_create
    from claimed c join public.broker_mail_messages m on m.id = c.message_id and m.org_id = v_org;

  select coalesce(jsonb_agg(jsonb_build_object('draft_id', d.id, 'mailbox', d.mailbox, 'graph_draft_id', d.graph_draft_id)), '[]'::jsonb)
    into v_remove
    from (select d.* from public.broker_mail_drafts d
            join public.broker_mail_messages m on m.id = d.message_id and m.org_id = v_org
            join public.mail_gateway_mailboxes mb on mb.org_id = d.org_id and mb.mailbox = d.mailbox and mb.unlinked_at is null
           where d.org_id = v_org and d.state = 'in_outlook'
             and m.thread_state = 'answered_by_owner' and m.answered_at > d.in_outlook_at
           order by d.in_outlook_at limit 20) d;

  return jsonb_build_object('create', v_create, 'remove', v_remove);
end $$;

-- What became of one draft. From `claimed`: in_outlook (with Graph's id), answered_first,
-- person_draft_found, not_found, refused (Microsoft said no — the scope has no write yet), failed.
-- From `in_outlook`: removed, sent_or_gone. Every result clears the text. Anything else is refused.
create or replace function public.mailgw_complete_draft(p_cycle uuid, p_draft uuid, p_result text, p_graph_draft_id text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_org uuid := public.mailgw_require_lease(p_cycle);
  d public.broker_mail_drafts;
begin
  select * into d from public.broker_mail_drafts where id = p_draft and org_id = v_org for update;
  if not found then raise exception 'mail gateway: no such draft' using errcode = '22023'; end if;
  if not exists (select 1 from public.mail_gateway_mailboxes mb
                  where mb.org_id = v_org and mb.mailbox = d.mailbox and mb.unlinked_at is null) then
    raise exception 'mail gateway: mailbox not on the derived list' using errcode = '42501';
  end if;
  if d.state = 'claimed' and d.claim_cycle_id = p_cycle
     and p_result in ('in_outlook', 'answered_first', 'person_draft_found', 'not_found', 'refused', 'failed') then
    if p_result = 'in_outlook' and (p_graph_draft_id is null or length(p_graph_draft_id) not between 1 and 512) then
      raise exception 'mail gateway: a draft in Outlook needs its id' using errcode = '22023';
    end if;
    update public.broker_mail_drafts
       set state = p_result, draft_text = null,
           graph_draft_id = case when p_result = 'in_outlook' then p_graph_draft_id end,
           in_outlook_at = case when p_result = 'in_outlook' then now() end,
           completed_at = case when p_result = 'in_outlook' then null else now() end
     where id = p_draft;
  elsif d.state = 'in_outlook' and p_result in ('removed', 'sent_or_gone') then
    update public.broker_mail_drafts set state = p_result, completed_at = now() where id = p_draft;
  else
    raise exception 'mail gateway: draft % cannot go from % to %', p_draft, d.state, p_result using errcode = '22023';
  end if;
end $$;

revoke all on function public.mailgw_claim_drafts(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mailgw_complete_draft(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.mailgw_claim_drafts(uuid) to mail_gateway;
grant execute on function public.mailgw_complete_draft(uuid, uuid, text, text) to mail_gateway;

comment on function public.mailgw_claim_drafts(uuid) is
  '0656 (D-BMR11): the gateway''s draft work for one run — drafts to create (text + the email''s ids, derived mailboxes only) and drafts 360 made that the owner answered past (to remove). Drops drafts that can no longer be made. Executable only by mail_gateway.';
comment on function public.mailgw_complete_draft(uuid, uuid, text, text) is
  '0656 (D-BMR11): records what became of one draft and clears its text. Executable only by mail_gateway.';
comment on function public.broker_mail_record_compose(uuid, uuid, uuid, text, integer, integer, text, text, text) is
  '0656 (D-BMR11): one ledger row per draft composition, and its tokens into org_usage_month in the same call. Service role only.';
