-- Silvicom 360 — 0548 office chat: the compliance console searches with the search index
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH8, 0542's open item; CHA2, CHA3b)
--
-- 0516 searched the console's messages with `ilike` over the current words and every earlier version:
-- a sequential read of every line the organisation ever wrote, which at the plan's own estimate (§3: 3 M
-- lines a year) stops answering. 0542 built the index for a person's own search and recorded that the
-- console would move onto it once the earlier versions were indexed too. This file does that.
--
--   1. EARLIER VERSIONS ARE INDEXED, by the same expression as the lines (`chat_search_vector`), so a
--      line is found by words an edit removed — which is the console's point (D-CHAT13).
--   2. THE CONSOLE MATCHES AS A PERSON'S SEARCH DOES: every word, each as the beginning of a word, load
--      numbers whole or by their digits. What changes for a reviewer, said plainly: a search finds words,
--      not fragments inside them — "night" finds "night shift" and "nights", not "midnight" — the trade
--      every e-discovery word index makes. Retracted lines are found as before: the index covers every
--      line, and the console never filtered them out.
--   3. A SEARCH OF ONLY SYMBOLS FINDS NOTHING rather than everything: "!!!" has no words to match, and an
--      unfiltered answer to a filtered question would put every line in front of a reviewer who asked
--      for a few. That is the predicate's own arithmetic, not a branch: such a search is not blank, so
--      `v_words` is set, and its tsquery is null, against which every `@@` is null — no row qualifies.
--      An empty search is still no filter, as in 0516.
--   `chat_compliance_like` has no caller left and is dropped.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: both functions keep their arguments and their answer's shape;
-- what they answer for a search changes as described, which no deploy order can make inconsistent.
--
-- Rollback: restore 0544's two functions with their grants and 0516's `chat_compliance_like`; drop the
-- index.

create index if not exists idx_message_versions_search on message_versions using gin (public.chat_search_vector(body));

create or replace function chat_compliance_messages(
  p_org uuid, p_actor uuid, p_reason jsonb, p_thread uuid, p_person uuid, p_from timestamptz, p_to timestamptz,
  p_q text, p_before_at timestamptz, p_before_id uuid, p_limit integer
) returns table (
  id uuid, thread_id uuid, thread_kind text, thread_subject text, seq bigint, sender_user_id uuid, sender_name text,
  body text, created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, versions jsonb,
  attachments jsonb
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason jsonb := public.chat_compliance_reason(p_reason);
  -- 0548: the words of the search, as CH8's search reads them; null when the search holds none.
  v_words text := nullif(btrim(coalesce(p_q, '')), '');
  v_q tsquery := public.chat_search_query(p_q);
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
           m.body, m.created_at, m.edited_at, m.deleted_at, public.chat_compliance_versions(m.id),
           public.chat_compliance_line_files(m.id)
      from public.messages m
      join public.message_threads t on t.id = m.thread_id
     where m.org_id = p_org
       and (p_thread is null or m.thread_id = p_thread)
       and (p_person is null or m.sender_user_id = p_person)
       and (p_from is null or m.created_at >= p_from)
       and (p_to is null or m.created_at < p_to)
       and (v_words is null or public.chat_search_vector(m.body) @@ v_q
            or exists (select 1 from public.message_versions v where v.message_id = m.id and public.chat_search_vector(v.body) @@ v_q))
       and (p_before_at is null or (m.created_at, m.id) < (p_before_at, p_before_id))
     order by m.created_at desc, m.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;


create or replace function chat_compliance_export_rows(
  p_org uuid, p_actor uuid, p_reason jsonb, p_export_id uuid, p_scope text,
  p_thread uuid, p_person uuid, p_from timestamptz, p_to timestamptz, p_q text
) returns table (export jsonb, conversations jsonb, lines jsonb)
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason jsonb := public.chat_compliance_reason(p_reason);
  -- 0548: the words of the search, as CH8's search reads them; null when the search holds none.
  v_words text := nullif(btrim(coalesce(p_q, '')), '');
  v_q tsquery := public.chat_search_query(p_q);
  v_filters jsonb;
  v_ids uuid[];
  v_count integer;
  v_content text;
  v_ledger public.chat_ledger;
  v_files integer;
  v_file_bytes bigint;
begin
  if p_scope not in ('conversation', 'search') then
    raise exception 'an export is of a conversation or a search' using errcode = 'CH010';
  end if;
  if p_scope = 'conversation' and p_thread is null then
    raise exception 'a conversation export names its conversation' using errcode = 'CH010';
  end if;
  if p_thread is not null then
    perform public.chat_compliance_thread_row(p_org, p_thread);
  end if;
  if exists (select 1 from public.chat_exports e where e.id = p_export_id) then
    raise exception 'that id already belongs to another export' using errcode = 'CH010';
  end if;

  v_filters := case when p_scope = 'conversation' then jsonb_build_object('thread', p_thread)
                    else jsonb_strip_nulls(jsonb_build_object('thread', p_thread, 'person', p_person, 'from', p_from,
                                                              'to', p_to, 'q', nullif(btrim(coalesce(p_q, '')), ''))) end;

  select array_agg(m.id order by m.thread_id, m.seq) into v_ids
    from public.messages m
   where m.org_id = p_org
     and (p_thread is null or m.thread_id = p_thread)
     and (p_scope = 'conversation' or (
           (p_person is null or m.sender_user_id = p_person)
       and (p_from is null or m.created_at >= p_from)
       and (p_to is null or m.created_at < p_to)
       and (v_words is null or public.chat_search_vector(m.body) @@ v_q
            or exists (select 1 from public.message_versions v where v.message_id = m.id and public.chat_search_vector(v.body) @@ v_q))));
  v_count := coalesce(cardinality(v_ids), 0);
  if v_count > 10000 then
    raise exception 'an export holds at most 10,000 lines; this one has %, narrow it by date', v_count using errcode = 'CH010';
  end if;
  -- CH7's files go into the export beside the lines (0544): one gigabyte at most, for the reason the
  -- 10,000 lines are a ceiling — a copy the API cannot finish building in one request is not an export.
  select count(*), coalesce(sum(f.byte_size), 0) into v_files, v_file_bytes
    from public.chat_attachments f where f.message_id = any (coalesce(v_ids, '{}'::uuid[])) and f.org_id = p_org;
  if v_file_bytes > 1073741824 then
    raise exception 'an export carries at most 1 GB of files; this one has % MB, narrow it by date', v_file_bytes / 1048576 using errcode = 'CH010';
  end if;

  -- THE FOLD (header): ids and body hashes, in export order, newline-joined.
  select coalesce(string_agg(m.id::text || ':' || public.chat_sha256(m.body), E'\n' order by x.ord), '')
    into v_content
    from unnest(coalesce(v_ids, '{}'::uuid[])) with ordinality x(id, ord)
    join public.messages m on m.id = x.id;

  perform set_config('silvicom.chat_actor', p_actor::text, true);
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, subject_user_id, body_sha256, detail)
  values (p_org, p_actor, 'compliance_export', p_thread, p_person, public.chat_sha256(v_content),
          jsonb_build_object('export_id', p_export_id, 'scope', p_scope, 'reason', v_reason,
                             'filters', v_filters, 'message_count', v_count,
                             'file_count', v_files, 'file_bytes', v_file_bytes))
  returning * into v_ledger;

  insert into public.chat_exports (id, org_id, scope, thread_id, filters, reason, requested_by, message_count,
                                   ledger_seq, ledger_hash, content_sha256)
  values (p_export_id, p_org, p_scope, p_thread, v_filters, v_reason, p_actor, v_count,
          v_ledger.seq, v_ledger.hash, v_ledger.body_sha256);

  return query
    select jsonb_build_object(
             'id', p_export_id, 'scope', p_scope, 'filters', v_filters, 'reason', v_reason,
             'requested_by', p_actor, 'requested_by_name', public.chat_display_name(p_org, p_actor),
             'created_at', v_ledger.occurred_at, 'message_count', v_count, 'file_count', v_files, 'file_bytes', v_file_bytes,
             'ledger_seq', v_ledger.seq, 'ledger_hash', v_ledger.hash, 'content_sha256', v_ledger.body_sha256),
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'thread_id', t.id, 'kind', t.kind, 'subject', t.subject, 'load_id', t.load_id,
                      'created_at', t.created_at, 'archived_at', t.archived_at,
                      'members', public.chat_compliance_members(p_org, t.id)) order by t.id)
               from public.message_threads t
              where t.org_id = p_org
                and t.id in (select m.thread_id from public.messages m where m.id = any (coalesce(v_ids, '{}'::uuid[]))
                             union select p_thread where p_thread is not null)
           ), '[]'::jsonb),
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', m.id, 'thread_id', m.thread_id, 'seq', m.seq, 'sender_user_id', m.sender_user_id,
                      'sender_name', public.chat_display_name(p_org, m.sender_user_id), 'body', m.body,
                      'body_sha256', public.chat_sha256(m.body),
                      'created_at', m.created_at, 'edited_at', m.edited_at, 'deleted_at', m.deleted_at,
                      'versions', coalesce((
                        select jsonb_agg(jsonb_build_object(
                                 'version', v.version, 'body', v.body, 'body_sha256', public.chat_sha256(v.body),
                                 'replaced_at', v.replaced_at, 'replaced_by', v.replaced_by) order by v.version)
                          from public.message_versions v where v.message_id = m.id), '[]'::jsonb),
                      'attachments', public.chat_compliance_line_files(m.id))
                    order by x.ord)
               from unnest(coalesce(v_ids, '{}'::uuid[])) with ordinality x(id, ord)
               join public.messages m on m.id = x.id
           ), '[]'::jsonb);
end;
$$;

drop function if exists chat_compliance_like(text);

revoke all on function chat_compliance_messages(uuid, uuid, jsonb, uuid, uuid, timestamptz, timestamptz, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function chat_compliance_export_rows(uuid, uuid, jsonb, uuid, text, uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function chat_compliance_messages(uuid, uuid, jsonb, uuid, uuid, timestamptz, timestamptz, text, timestamptz, uuid, integer) to service_role;
grant execute on function chat_compliance_export_rows(uuid, uuid, jsonb, uuid, text, uuid, uuid, timestamptz, timestamptz, text) to service_role;
