-- Silvicom 360 — 0544 office chat: the compliance console and its export carry a line's files
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md §9.3 "Open after CH7"; D-CHAT28, CHA2, CHA3b)
--
-- CH7 (0540) let a line carry files, ledgered `file_attached` with each file's SHA-256. The compliance
-- console (0516) and its export (0517) were written before files existed, so a holder reviewing a
-- conversation saw "Truck 702 is loaded" and not the two photos under it, and an export proved the words
-- but neither listed nor carried the files. An export without them is incomplete. This file is the
-- reading side; the API and the console are the next merge.
--
--   1. EVERY LINE'S FILES, AS EVIDENCE. `chat_compliance_line_files` lists a line's files in the order
--      they were sent — name, kind, size, SHA-256, who uploaded them, when — for a RETRACTED line too,
--      as the console already shows a retracted line's words (a person's chat drops them; compliance
--      never does). Never the storage key: the console asks for a file through `chat_compliance_file`.
--   2. THE THREE READERS GAIN THEM. `chat_compliance_thread` and `chat_compliance_export_rows` return
--      JSON, so each line gains an `attachments` key in place; `chat_compliance_messages` returns a
--      table, so it is dropped and made again with an `attachments` column, its grants restated.
--   3. OPENING ONE IS A COMPLIANCE ACT. `chat_compliance_file` writes a `compliance_view` ledger row
--      naming the file and the reason before it answers the storage key the API signs for five minutes,
--      the same way a view of a conversation is ledgered (0516).
--   4. THE EXPORT CARRIES THE BYTES. `chat_compliance_export_rows` counts the export's files and refuses
--      past one gigabyte (CH010, narrow it by date), and its header and ledger row say how many files and
--      bytes. `chat_compliance_file_keys` hands the API the storage keys of those files only, so it can
--      copy each one beside the JSONL; the manifest lists each with its SHA-256 (the API's side). The
--      fold — ids and body hashes — is unchanged: each file's hash is already in the ledger, in its own
--      `file_attached` row.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: the API parses each of these with Zod objects, which drop a key
-- or a column they do not know, so the API serving today reads every answer as before. The export's new
-- refusal needs more than a gigabyte of files, which staging and production do not hold (0540 is days
-- old). New functions are called by no code yet.
--
-- Rollback: drop the three new functions; restore 0516's `chat_compliance_thread` and
-- `chat_compliance_messages` and 0517's `chat_compliance_export_rows` with their grants.

-- A line's files, in the order sent — retracted or not. Never the storage key.
create or replace function chat_compliance_line_files(p_message uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'position', f.position, 'file_name', f.file_name, 'mime', f.mime, 'byte_size', f.byte_size,
           'sha256', f.sha256, 'uploaded_by', f.uploaded_by, 'created_at', f.created_at)
           order by f.position), '[]'::jsonb)
    from public.chat_attachments f where f.message_id = p_message;
$$;

-- Open one file for review: ledgered with its reason, then the key the API signs. Another
-- organisation's file, or none, is CH001 and writes nothing.
create or replace function chat_compliance_file(p_org uuid, p_actor uuid, p_reason jsonb, p_file uuid)
returns table (storage_path text, file_name text, mime text, byte_size bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason jsonb := public.chat_compliance_reason(p_reason);
  f public.chat_attachments;
begin
  select a.* into f from public.chat_attachments a where a.id = p_file and a.org_id = p_org;
  if f.id is null then
    raise exception 'no such file in this organisation' using errcode = 'CH001';
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, message_id, body_sha256, detail)
  values (p_org, p_actor, 'compliance_view', f.thread_id, f.message_id, f.sha256,
          jsonb_build_object('reason', v_reason, 'file_id', f.id, 'file_name', f.file_name));
  return query select f.storage_path, f.file_name, f.mime, f.byte_size;
end;
$$;

-- The storage keys of the files an export carries: only files of lines that export holds, in this
-- organisation — the API names the export, not the files, so it cannot be asked for anything else.
create or replace function chat_compliance_file_keys(p_org uuid, p_export uuid, p_files uuid[])
returns table (id uuid, storage_path text, sha256 text, byte_size bigint)
language sql stable security definer set search_path = ''
as $$
  select f.id, f.storage_path, f.sha256, f.byte_size
    from public.chat_attachments f
    join public.messages m on m.id = f.message_id
    join public.chat_exports e on e.id = p_export and e.org_id = p_org and e.status = 'building'
   where f.org_id = p_org and f.id = any (coalesce(p_files, '{}'::uuid[]))
   order by m.thread_id, m.seq, f.position;  -- the export's own order: conversation, then line, then file
$$;

drop function if exists chat_compliance_messages(uuid, uuid, jsonb, uuid, uuid, timestamptz, timestamptz, text, timestamptz, uuid, integer);

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
                      'versions', public.chat_compliance_versions(m.id),
                      'attachments', public.chat_compliance_line_files(m.id)) order by m.seq desc)
               from (select * from public.messages m2
                      where m2.thread_id = p_thread and m2.org_id = p_org
                        and (p_before_seq is null or m2.seq < p_before_seq)
                      order by m2.seq desc
                      limit least(greatest(coalesce(p_limit, 50), 1), 100)) m
           ), '[]'::jsonb);
end;
$$;


create function chat_compliance_messages(
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
           m.body, m.created_at, m.edited_at, m.deleted_at, public.chat_compliance_versions(m.id),
           public.chat_compliance_line_files(m.id)
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


create or replace function chat_compliance_export_rows(
  p_org uuid, p_actor uuid, p_reason jsonb, p_export_id uuid, p_scope text,
  p_thread uuid, p_person uuid, p_from timestamptz, p_to timestamptz, p_q text
) returns table (export jsonb, conversations jsonb, lines jsonb)
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason jsonb := public.chat_compliance_reason(p_reason);
  v_like text := public.chat_compliance_like(p_q);
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
       and (v_like is null or m.body ilike v_like
            or exists (select 1 from public.message_versions v where v.message_id = m.id and v.body ilike v_like))));
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

revoke all on function chat_compliance_line_files(uuid) from public, anon, authenticated;
revoke all on function chat_compliance_file(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function chat_compliance_file_keys(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function chat_compliance_thread(uuid, uuid, jsonb, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function chat_compliance_messages(uuid, uuid, jsonb, uuid, uuid, timestamptz, timestamptz, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function chat_compliance_export_rows(uuid, uuid, jsonb, uuid, text, uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function chat_compliance_file(uuid, uuid, jsonb, uuid) to service_role;
grant execute on function chat_compliance_file_keys(uuid, uuid, uuid[]) to service_role;
grant execute on function chat_compliance_thread(uuid, uuid, jsonb, uuid, bigint, integer) to service_role;
grant execute on function chat_compliance_messages(uuid, uuid, jsonb, uuid, uuid, timestamptz, timestamptz, text, timestamptz, uuid, integer) to service_role;
grant execute on function chat_compliance_export_rows(uuid, uuid, jsonb, uuid, text, uuid, uuid, timestamptz, timestamptz, text) to service_role;
