-- Silvicom 360 — 0516 office chat: the compliance console's reads, each one a ledgered act
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md CHA2; D-CHAT12, D-CHAT14; Q-CHAT2, Q-CHAT11, Q-CHAT12)
--
-- The owner's requirement: "good audit logs and Admin to be able to audit messages". Release 1 built
-- the record (0511: every chat fact in a hash-chained, append-only ledger) and the audit of release 1
-- (2026-10-23) named what was still missing: nobody could READ it in the product. The only reader was
-- a person with database access, and that path leaves no trace — the exact defect §5 of the plan set
-- out to remove. These functions are that reader, and the rule they all keep is the plan's:
-- **auditing is a capability that is itself audited.** Every call that returns another person's words
-- appends a `compliance_search` or `compliance_view` row to the org's ledger, in the same transaction,
-- with the caller, the reason they gave and what they asked for — BEFORE a word is returned. The
-- Access log (`chat_compliance_access_log`) reads those rows back, so one holder of the permission
-- watches another (Q-CHAT11: no four-eyes step; the log is the control).
--
-- WHO MAY CALL: the API, with the service role, after `requireSurface("chat.compliance")` (a
-- Permissions-page grant, admins by default — Q-CHAT2) and step-up re-authentication. EXECUTE is
-- revoked from anon and authenticated, as for every 0512 function: a browser that could call one
-- could name anybody as the actor.
--
-- WHAT THE CONSOLE SEES (§5.2, §5.3): every conversation of the org, driver threads included — they are
-- company records under the same rule; every message including RETRACTED ones with their words, and
-- every prior VERSION of an edited message (`message_versions`), each marked as such. It changes
-- nothing: there is no write here but the ledger row.
--
-- THE REASON: `{category, text}` — category one of hr, legal, safety_incident, customer_dispute,
-- security; text 10–500 characters. Checked once (`chat_compliance_reason`) so a malformed reason is a
-- refusal (CH009) and never a ledger row with an empty one.
--
-- SEARCH is `ilike` over the current body and every prior version, with the term's wildcards escaped,
-- so "100%" finds the words and not everything. CH8 brings full text search for the chat itself; the
-- console moves onto it then. Pages are keyset (created_at, id) newest first, 100 at most, as 0512.
--
-- Error codes (the API maps them in chatCompliance.ts):
--   CH001  that conversation is not in this organisation (→ 404)
--   CH009  the reason is missing or malformed (→ 422)
--
-- Rollback: drop the functions below. CHA2's routes call them and must be reverted first.

-- ── The reason ──────────────────────────────────────────────────────────────────────────────────
create or replace function chat_compliance_reason(p_reason jsonb) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v_cat text := p_reason ->> 'category';
  v_text text := btrim(coalesce(p_reason ->> 'text', ''));
begin
  if v_cat is null or v_cat not in ('hr', 'legal', 'safety_incident', 'customer_dispute', 'security') then
    raise exception 'a compliance reason needs a category' using errcode = 'CH009';
  end if;
  if length(v_text) < 10 or length(v_text) > 500 then
    raise exception 'a compliance reason is 10 to 500 characters' using errcode = 'CH009';
  end if;
  return jsonb_build_object('category', v_cat, 'text', v_text);
end;
$$;

-- `%`, `_` and `\` in what somebody typed are letters, not wildcards.
create or replace function chat_compliance_like(p_q text) returns text
language sql immutable set search_path = ''
as $$
  select case when nullif(btrim(p_q), '') is null then null
              else '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
$$;

-- The conversation, if it is this org's (any kind, archived or not); CH001 otherwise.
create or replace function chat_compliance_thread_row(p_org uuid, p_thread uuid)
returns public.message_threads
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.message_threads;
begin
  select t.* into v from public.message_threads t where t.id = p_thread and t.org_id = p_org;
  if v.id is null then
    raise exception 'not in that conversation' using errcode = 'CH001';
  end if;
  return v;
end;
$$;

-- Everyone who is or was in a conversation, with when they joined and left.
create or replace function chat_compliance_members(p_org uuid, p_thread uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', p.user_id, 'name', public.chat_display_name(p_org, p.user_id), 'role', p.role,
           'member_role', p.member_role, 'joined_at', p.joined_at, 'left_at', p.left_at)
           order by p.joined_at, p.user_id), '[]'::jsonb)
    from public.thread_participants p where p.thread_id = p_thread and p.org_id = p_org;
$$;

-- The words an edit replaced, oldest first.
create or replace function chat_compliance_versions(p_message uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'version', v.version, 'body', v.body, 'replaced_at', v.replaced_at, 'replaced_by', v.replaced_by)
           order by v.version), '[]'::jsonb)
    from public.message_versions v where v.message_id = p_message;
$$;

-- ── Conversations ───────────────────────────────────────────────────────────────────────────────
-- Every conversation of the org, newest activity first; narrowed to one person's (member now or
-- before) and to those with a message in a date range. One `compliance_search` ledger row per call.
create or replace function chat_compliance_conversations(
  p_org uuid, p_actor uuid, p_reason jsonb, p_person uuid, p_from timestamptz, p_to timestamptz,
  p_before_at timestamptz, p_before_id uuid, p_limit integer
) returns table (
  thread_id uuid, kind text, subject text, load_id uuid, created_at timestamptz, archived_at timestamptz,
  last_message_at timestamptz, message_count bigint, members jsonb
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason jsonb := public.chat_compliance_reason(p_reason);
begin
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  insert into public.chat_ledger (org_id, actor_user_id, action, subject_user_id, detail)
  values (p_org, p_actor, 'compliance_search', p_person,
          jsonb_build_object('scope', 'conversations', 'reason', v_reason,
                             'filters', jsonb_strip_nulls(jsonb_build_object('person', p_person, 'from', p_from, 'to', p_to)),
                             'before_at', p_before_at));
  return query
    select t.id, t.kind, t.subject, t.load_id, t.created_at, t.archived_at, t.last_message_at,
           (select count(*) from public.messages m where m.thread_id = t.id),
           public.chat_compliance_members(p_org, t.id)
      from public.message_threads t
     where t.org_id = p_org
       and (p_person is null or exists (select 1 from public.thread_participants p where p.thread_id = t.id and p.user_id = p_person))
       and (p_from is null or exists (select 1 from public.messages m where m.thread_id = t.id and m.created_at >= p_from))
       and (p_to is null or exists (select 1 from public.messages m where m.thread_id = t.id and m.created_at < p_to))
       and (p_before_at is null or (t.last_message_at, t.id) < (p_before_at, p_before_id))
     order by t.last_message_at desc, t.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- ── Messages ────────────────────────────────────────────────────────────────────────────────────
-- Messages across the org, newest first, by conversation, person, date range and words (current or
-- any earlier version). Retracted messages come with their words and `deleted_at`. One
-- `compliance_search` ledger row per call.
create or replace function chat_compliance_messages(
  p_org uuid, p_actor uuid, p_reason jsonb, p_thread uuid, p_person uuid, p_from timestamptz, p_to timestamptz,
  p_q text, p_before_at timestamptz, p_before_id uuid, p_limit integer
) returns table (
  id uuid, thread_id uuid, thread_kind text, thread_subject text, seq bigint, sender_user_id uuid, sender_name text,
  body text, created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, versions jsonb
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason jsonb := public.chat_compliance_reason(p_reason);
  v_like text := public.chat_compliance_like(p_q);
begin
  if p_thread is not null then
    perform public.chat_compliance_thread_row(p_org, p_thread);
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, subject_user_id, detail)
  values (p_org, p_actor, 'compliance_search', p_thread, p_person,
          jsonb_build_object('scope', 'messages', 'reason', v_reason,
                             'filters', jsonb_strip_nulls(jsonb_build_object(
                               'thread', p_thread, 'person', p_person, 'from', p_from, 'to', p_to, 'q', nullif(btrim(coalesce(p_q, '')), ''))),
                             'before_at', p_before_at));
  return query
    select m.id, m.thread_id, t.kind, t.subject, m.seq, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           m.body, m.created_at, m.edited_at, m.deleted_at, public.chat_compliance_versions(m.id)
      from public.messages m
      join public.message_threads t on t.id = m.thread_id
     where m.org_id = p_org
       and (p_thread is null or m.thread_id = p_thread)
       and (p_person is null or m.sender_user_id = p_person)
       and (p_from is null or m.created_at >= p_from)
       and (p_to is null or m.created_at < p_to)
       and (v_like is null or m.body ilike v_like
            or exists (select 1 from public.message_versions v where v.message_id = m.id and v.body ilike v_like))
       and (p_before_at is null or (m.created_at, m.id) < (p_before_at, p_before_id))
     order by m.created_at desc, m.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- ── One conversation ────────────────────────────────────────────────────────────────────────────
-- The header, everyone who was ever in it, and one page of its lines (newest first, before
-- `p_before_seq`), every line with its words — retracted or not — and its earlier versions. One
-- `compliance_view` ledger row per call, naming the page.
create or replace function chat_compliance_thread(
  p_org uuid, p_actor uuid, p_reason jsonb, p_thread uuid, p_before_seq bigint, p_limit integer
) returns table (conversation jsonb, messages jsonb)
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason jsonb := public.chat_compliance_reason(p_reason);
  v public.message_threads := public.chat_compliance_thread_row(p_org, p_thread);
begin
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, detail)
  values (p_org, p_actor, 'compliance_view', p_thread,
          jsonb_build_object('reason', v_reason, 'before_seq', p_before_seq));
  return query
    select jsonb_build_object(
             'thread_id', v.id, 'kind', v.kind, 'subject', v.subject, 'load_id', v.load_id, 'created_at', v.created_at,
             'created_by', v.created_by, 'archived_at', v.archived_at, 'last_message_at', v.last_message_at,
             'last_seq', v.last_seq, 'members', public.chat_compliance_members(p_org, v.id)),
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', m.id, 'seq', m.seq, 'sender_user_id', m.sender_user_id,
                      'sender_name', public.chat_display_name(p_org, m.sender_user_id), 'body', m.body,
                      'created_at', m.created_at, 'edited_at', m.edited_at, 'deleted_at', m.deleted_at,
                      'versions', public.chat_compliance_versions(m.id)) order by m.seq desc)
               from (select * from public.messages m2
                      where m2.thread_id = p_thread and m2.org_id = p_org
                        and (p_before_seq is null or m2.seq < p_before_seq)
                      order by m2.seq desc
                      limit least(greatest(coalesce(p_limit, 50), 1), 100)) m
           ), '[]'::jsonb);
end;
$$;

-- ── The Access log ──────────────────────────────────────────────────────────────────────────────
-- Every compliance act in the org's ledger, newest first, keyset on seq: who looked, when, why, at
-- what. Read by every holder of the permission; reading it is not itself ledgered, because the log
-- that records its own reads fills with itself and hides the acts it exists to show.
create or replace function chat_compliance_access_log(p_org uuid, p_before_seq bigint, p_limit integer)
returns table (
  seq bigint, occurred_at timestamptz, actor_user_id uuid, actor_name text, action text,
  thread_id uuid, subject_user_id uuid, subject_name text, detail jsonb
)
language sql stable security definer set search_path = ''
as $$
  select l.seq, l.occurred_at, l.actor_user_id, public.chat_display_name(p_org, l.actor_user_id), l.action,
         l.thread_id, l.subject_user_id, public.chat_display_name(p_org, l.subject_user_id), l.detail
    from public.chat_ledger l
   where l.org_id = p_org
     and l.action in ('compliance_search', 'compliance_view', 'compliance_export',
                      'hold_set', 'hold_released', 'retention_changed', 'retention_purged')
     and (p_before_seq is null or l.seq < p_before_seq)
   order by l.seq desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- ── Grants: service role only ───────────────────────────────────────────────────────────────────
revoke all on function chat_compliance_reason(jsonb) from public, anon, authenticated;
revoke all on function chat_compliance_like(text) from public, anon, authenticated;
revoke all on function chat_compliance_thread_row(uuid, uuid) from public, anon, authenticated;
revoke all on function chat_compliance_members(uuid, uuid) from public, anon, authenticated;
revoke all on function chat_compliance_versions(uuid) from public, anon, authenticated;
revoke all on function chat_compliance_conversations(uuid, uuid, jsonb, uuid, timestamptz, timestamptz, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function chat_compliance_messages(uuid, uuid, jsonb, uuid, uuid, timestamptz, timestamptz, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function chat_compliance_thread(uuid, uuid, jsonb, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function chat_compliance_access_log(uuid, bigint, integer) from public, anon, authenticated;
grant execute on function chat_compliance_conversations(uuid, uuid, jsonb, uuid, timestamptz, timestamptz, timestamptz, uuid, integer) to service_role;
grant execute on function chat_compliance_messages(uuid, uuid, jsonb, uuid, uuid, timestamptz, timestamptz, text, timestamptz, uuid, integer) to service_role;
grant execute on function chat_compliance_thread(uuid, uuid, jsonb, uuid, bigint, integer) to service_role;
grant execute on function chat_compliance_access_log(uuid, bigint, integer) to service_role;
