-- Silvicom 360 — 0539 office chat: files (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH7; D-CHAT27–D-CHAT30)
--
-- A line can carry files: a photo of a damaged trailer, a signed rate confirmation, a spreadsheet. Measured
-- before this file: `messages.attachment_path` (0096) is the driver thread's single photo and office chat
-- never wrote it; there is no table, bucket or function for a line's files. CHAT-REDESIGN-PLAN Q-CHATUI5
-- held the composer's `+` until this existed rather than drawing a menu of nothing.
--
--   1. A FILE BELONGS TO A LINE (D-CHAT27). `chat_attachments` is one row per file, written in the same
--      transaction as its line by `chat_send_files` — never before it, so there is no "uploaded but not
--      sent" row to tidy. The bytes go to the private `chat-files` bucket first, through a signed upload
--      URL the API hands out after `chat_file_can_upload` says the person may write here; an object that
--      no line ever claims is swept by `reconcileBucketOrphans` after its 24 h grace, the way every other
--      evidence bucket is (the sweep reads this table's `storage_path`).
--
--   2. A FILE IS EVIDENCE, LIKE ITS LINE (D-CHAT28). Append-only: no UPDATE ever, and no DELETE while its
--      line exists — the same rule MG001 gives the line. Each one is ledgered by trigger as
--      `file_attached`, with its SHA-256, size and name in the detail, so the chain covers WHAT was sent,
--      not only that something was. The API hashes the stored bytes before it calls the function (it
--      never takes the browser's word for the hash). A retracted line stops showing its files, as it stops
--      showing its words and reactions; the rows and bytes stay.
--
--   3. A LINE MAY BE ONLY FILES (D-CHAT29). `messages_body_check` required words. It now limits length
--      only, and a deferred constraint trigger refuses an empty body unless the line carries a file at
--      commit (CH014). A driver thread never carries a file this way, so it still needs words.
--
--   4. LIMITS (D-CHAT30): ten files a line, 25 MB a file (the bucket's own cap, as `document-intake`'s),
--      a name of 1–200 characters with no path in it. Which TYPES are allowed is the shared contract's
--      (`CHAT_FILE_TYPES`), checked by the API against the sniffed bytes; the table holds what was checked.
--
--   5. THE FOUR READERS CARRY THEM: `chat_history`, `chat_sync`, `chat_channel_posts`, `chat_replies` gain
--      `attachments` (`[{id, file_name, mime, byte_size}]`, in the order sent), dropped and re-created by
--      full signature as 0523 did. `chat_files` lists a conversation's files, newest first;
--      `chat_file_for` answers where one file's bytes are, for a person in its conversation.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: no function the API calls today changes its arguments; the readers
-- gain one column, which the API's row schema strips (and, from CH7's API, defaults to `[]`). The body
-- CHECK only widens, and only for a line that has a file, which only `chat_send_files` writes. The ledger
-- CHECK only widens.
--
-- Rollback: drop the trigger, functions and table below and the bucket (after moving its objects);
-- restore 0096's `messages_body_check` (every row still satisfies it unless a file-only line was sent),
-- 0523's ledger CHECK and its four readers. CH7's routes call these and must be reverted first.

-- ── 1. The bucket ───────────────────────────────────────────────────────────────────────────────
-- Private, no storage.objects policy: deny-all to every client session; bytes only through the API's
-- short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', false, 25 * 1024 * 1024)
on conflict (id) do nothing;

-- ── 2. The table ────────────────────────────────────────────────────────────────────────────────
create table if not exists chat_attachments (
  -- Chosen by the API when it signs the upload, so the object's key exists before the row does.
  id           uuid primary key,
  -- A declared purge (CHA3) of the line takes its files' rows; the ledger keeps the facts.
  message_id   uuid not null references messages(id) on delete cascade,
  -- Copied from the line by the BEFORE trigger, never from the caller.
  org_id       uuid not null references organizations(id) on delete cascade,
  thread_id    uuid not null references message_threads(id) on delete cascade,
  uploaded_by  uuid references auth.users(id) on delete set null,
  position     smallint not null,
  file_name    text not null,
  mime         text not null,
  byte_size    bigint not null,
  sha256       text not null,
  -- `<org>/<thread>/<id>` — set by the trigger from the three ids, so it cannot point elsewhere.
  storage_path text not null unique,
  created_at   timestamptz not null default now(),
  constraint chat_attachments_position_check check (position between 1 and 10),
  constraint chat_attachments_name_check check (length(btrim(file_name)) between 1 and 200 and file_name !~ '[/\\]'),
  constraint chat_attachments_size_check check (byte_size between 1 and 25 * 1024 * 1024),
  constraint chat_attachments_sha_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint chat_attachments_mime_check check (mime ~ '^[a-z]+/[a-z0-9.+-]+$'),
  unique (message_id, position)
);
create index if not exists idx_chat_attachments_thread on chat_attachments (thread_id, created_at desc);

alter table chat_attachments enable row level security;
-- No policies: written and read by the functions below with the service role.

-- ── 3. Triggers ─────────────────────────────────────────────────────────────────────────────────

-- Place: org and conversation from the line; a retracted line takes no file (CH004); the key from the ids.
create or replace function chat_attachment_place() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v public.messages;
begin
  select m.* into v from public.messages m where m.id = new.message_id;
  if v.id is null then
    raise exception 'no such message' using errcode = 'CH001';
  end if;
  if v.deleted_at is not null then
    raise exception 'a retracted message takes no file' using errcode = 'CH004';
  end if;
  new.org_id := v.org_id;
  new.thread_id := v.thread_id;
  new.storage_path := v.org_id::text || '/' || v.thread_id::text || '/' || new.id::text;
  return new;
end;
$$;
drop trigger if exists trg_chat_attachments_place on chat_attachments;
create trigger trg_chat_attachments_place before insert on chat_attachments
  for each row execute function chat_attachment_place();

-- Append-only (D-CHAT28): never changed; removed only with its line (the cascade of a declared purge).
create or replace function chat_attachment_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'a chat file is never changed' using errcode = 'CH003';
  end if;
  if exists (select 1 from public.messages m where m.id = old.message_id) then
    raise exception 'a chat file is removed only with its message' using errcode = 'CH003';
  end if;
  return old;
end;
$$;
drop trigger if exists trg_chat_attachments_guard on chat_attachments;
create trigger trg_chat_attachments_guard before update or delete on chat_attachments
  for each row execute function chat_attachment_guard();

-- Ledgered (D-CHAT28): what was sent, by its hash.
create or replace function chat_ledger_files() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, message_id, detail)
  values (new.org_id, new.uploaded_by, 'file_attached', new.thread_id, new.message_id,
          jsonb_build_object('file_id', new.id, 'file_name', new.file_name, 'mime', new.mime,
                             'byte_size', new.byte_size, 'sha256', new.sha256));
  return null;
end;
$$;
drop trigger if exists trg_chat_ledger_files on chat_attachments;
create trigger trg_chat_ledger_files after insert on chat_attachments
  for each row execute function chat_ledger_files();

alter table chat_ledger drop constraint if exists chat_ledger_action_check;
alter table chat_ledger add constraint chat_ledger_action_check check (action in (
  'conversation_created', 'conversation_renamed', 'conversation_archived', 'conversation_restored',
  'member_added', 'member_left', 'member_rejoined', 'member_removed', 'member_role_changed',
  'message_sent', 'message_edited', 'message_retracted',
  'compliance_search', 'compliance_view', 'compliance_export',
  'hold_set', 'hold_released', 'retention_changed', 'retention_purged',
  'team_created', 'team_renamed', 'team_archived',
  'team_member_added', 'team_member_left', 'team_member_removed', 'team_member_rejoined', 'team_role_changed',
  'reaction_added', 'reaction_removed', 'message_pinned', 'message_unpinned',
  'file_attached'
));

-- A line may be only files (D-CHAT29): words OR a file, judged at commit, when the files exist too.
alter table messages drop constraint if exists messages_body_check;
alter table messages add constraint messages_body_check check (length(body) <= 4000);

create or replace function messages_words_or_files() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if length(btrim(new.body)) = 0
     and not exists (select 1 from public.chat_attachments a where a.message_id = new.id) then
    raise exception 'a message needs words or a file' using errcode = 'CH014';
  end if;
  return null;
end;
$$;
drop trigger if exists trg_messages_words_or_files on messages;
create constraint trigger trg_messages_words_or_files after insert or update of body on messages
  deferrable initially deferred
  for each row execute function messages_words_or_files();

-- ── 4. Functions ────────────────────────────────────────────────────────────────────────────────
-- Error codes beside 0512's–0523's (chat.ts maps them):
--   CH014  a line with no words and no file (→ 422)
--   CH015  a file the line names is not in storage, or a file list that is not 1–10 files (→ 422)

-- May this person put a file in this conversation now? The API asks before it signs an upload URL.
create or replace function chat_file_can_upload(p_org uuid, p_user uuid, p_thread uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_thread public.message_threads;
begin
  v_thread := public.chat_member_thread(p_org, p_user, p_thread);
  if v_thread.kind = 'driver' then
    raise exception 'driver conversations take files through dispatch messages' using errcode = 'CH006';
  end if;
  if v_thread.archived_at is not null then
    raise exception 'the conversation is archived' using errcode = 'CH005';
  end if;
  return true;
end;
$$;

-- Send a line WITH files, in one transaction: the line (a post, or a reply when `p_parent` is given),
-- then its files in the order listed. A retry of the same line id answers the first send and adds
-- nothing. `p_files` = `[{id, file_name, mime, byte_size, sha256}]`; each object must already be stored.
create or replace function chat_send_files(
  p_org uuid, p_actor uuid, p_thread uuid, p_message_id uuid, p_parent uuid, p_body text, p_files jsonb
) returns table (message_id uuid, seq bigint, rev bigint, created_at timestamptz, duplicate boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_sent record;
  v_file jsonb;
  v_pos smallint := 0;
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) not between 1 and 10 then
    raise exception 'a line carries one to ten files' using errcode = 'CH015';
  end if;
  if p_parent is null then
    select * into v_sent from public.chat_send(p_org, p_actor, p_thread, p_message_id, coalesce(p_body, ''));
  else
    select * into v_sent from public.chat_send_reply(p_org, p_actor, p_thread, p_message_id, p_parent, coalesce(p_body, ''));
  end if;
  if not v_sent.duplicate then
    for v_file in select * from jsonb_array_elements(p_files) loop
      v_pos := v_pos + 1;
      if not exists (
        select 1 from storage.objects o
         where o.bucket_id = 'chat-files'
           and o.name = p_org::text || '/' || p_thread::text || '/' || (v_file->>'id')
      ) then
        raise exception 'a file was not uploaded' using errcode = 'CH015';
      end if;
      insert into public.chat_attachments (id, message_id, org_id, thread_id, uploaded_by, position, file_name, mime, byte_size, sha256, storage_path)
      values ((v_file->>'id')::uuid, p_message_id, p_org, p_thread, p_actor, v_pos, v_file->>'file_name',
              v_file->>'mime', (v_file->>'byte_size')::bigint, lower(v_file->>'sha256'), '');
    end loop;
  end if;
  return query select v_sent.message_id, v_sent.seq, v_sent.rev, v_sent.created_at, v_sent.duplicate;
end;
$$;

-- A line's files as the readers return them, in the order sent; none for a retracted line.
create or replace function chat_line_files(p_message uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime', a.mime, 'byte_size', a.byte_size)
                            order by a.position), '[]'::jsonb)
    from public.chat_attachments a
    join public.messages m on m.id = a.message_id and m.deleted_at is null
   where a.message_id = p_message;
$$;

-- Where one file's bytes are, for a person in its conversation now. CH001 otherwise; CH004 once its line
-- is retracted (the bytes stay for the record; the conversation stops serving them).
create or replace function chat_file_for(p_org uuid, p_user uuid, p_file uuid)
returns table (storage_path text, file_name text, mime text, byte_size bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.chat_attachments;
begin
  select a.* into v from public.chat_attachments a where a.id = p_file and a.org_id = p_org;
  if v.id is null then
    raise exception 'not in that conversation' using errcode = 'CH001';
  end if;
  perform public.chat_member_thread(p_org, p_user, v.thread_id);
  if exists (select 1 from public.messages m where m.id = v.message_id and m.deleted_at is not null) then
    raise exception 'that message was removed' using errcode = 'CH004';
  end if;
  return query select v.storage_path, v.file_name, v.mime, v.byte_size;
end;
$$;

-- A conversation's files, newest first, keyset-paged on (created_at, id). Never a retracted line's.
create or replace function chat_files(
  p_org uuid, p_user uuid, p_thread uuid, p_before_at timestamptz, p_before_id uuid, p_limit integer
) returns table (
  id uuid, message_id uuid, parent_id uuid, seq bigint, file_name text, mime text, byte_size bigint,
  uploaded_by uuid, uploaded_by_name text, created_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select a.id, a.message_id, m.parent_id, m.seq, a.file_name, a.mime, a.byte_size, a.uploaded_by,
           public.chat_display_name(p_org, a.uploaded_by), a.created_at
      from public.chat_attachments a
      join public.messages m on m.id = a.message_id and m.deleted_at is null
     where a.thread_id = p_thread and a.org_id = p_org
       and (p_before_at is null or (a.created_at, a.id) < (p_before_at, p_before_id))
     order by a.created_at desc, a.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- ── 5. The four readers carry the files ─────────────────────────────────────────────────────────
-- 0523's shapes plus `attachments` at the end. Same arguments.

drop function if exists chat_history(uuid, uuid, uuid, bigint, integer);
create function chat_history(p_org uuid, p_user uuid, p_thread uuid, p_before_seq bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, parent_id uuid, reply_count integer,
  last_reply_at timestamptz, reactions jsonb, pinned_at timestamptz, saved boolean, attachments jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at,
           m.parent_id, m.reply_count, m.last_reply_at, public.chat_line_reactions(m.id),
           (select x.pinned_at from public.chat_pins x where x.message_id = m.id and m.deleted_at is null),
           exists (select 1 from public.chat_saved s where s.user_id = p_user and s.message_id = m.id),
           public.chat_line_files(m.id)
      from public.messages m
     where m.thread_id = p_thread and m.org_id = p_org
       and (p_before_seq is null or m.seq < p_before_seq)
     order by m.seq desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

drop function if exists chat_sync(uuid, uuid, uuid, bigint, integer);
create function chat_sync(p_org uuid, p_user uuid, p_thread uuid, p_since_rev bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, parent_id uuid, reply_count integer,
  last_reply_at timestamptz, reactions jsonb, pinned_at timestamptz, saved boolean, attachments jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at,
           m.parent_id, m.reply_count, m.last_reply_at, public.chat_line_reactions(m.id),
           (select x.pinned_at from public.chat_pins x where x.message_id = m.id and m.deleted_at is null),
           exists (select 1 from public.chat_saved s where s.user_id = p_user and s.message_id = m.id),
           public.chat_line_files(m.id)
      from public.messages m
     where m.thread_id = p_thread and m.org_id = p_org and m.rev > coalesce(p_since_rev, 0)
     order by m.rev
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

drop function if exists chat_channel_posts(uuid, uuid, uuid, bigint, integer);
create function chat_channel_posts(p_org uuid, p_user uuid, p_thread uuid, p_before_seq bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, parent_id uuid, reply_count integer,
  last_reply_at timestamptz, reactions jsonb, pinned_at timestamptz, saved boolean, attachments jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at,
           m.parent_id, m.reply_count, m.last_reply_at, public.chat_line_reactions(m.id),
           (select x.pinned_at from public.chat_pins x where x.message_id = m.id and m.deleted_at is null),
           exists (select 1 from public.chat_saved s where s.user_id = p_user and s.message_id = m.id),
           public.chat_line_files(m.id)
      from public.messages m
     where m.thread_id = p_thread and m.org_id = p_org and m.parent_id is null
       and (p_before_seq is null or m.seq < p_before_seq)
     order by m.seq desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

drop function if exists chat_replies(uuid, uuid, uuid, bigint, integer);
create function chat_replies(p_org uuid, p_user uuid, p_parent uuid, p_before_seq bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, parent_id uuid, reply_count integer,
  last_reply_at timestamptz, reactions jsonb, pinned_at timestamptz, saved boolean, attachments jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_thread uuid;
begin
  select m.thread_id into v_thread from public.messages m where m.id = p_parent and m.org_id = p_org;
  if v_thread is null then
    raise exception 'no such post' using errcode = 'CH001';
  end if;
  perform public.chat_member_thread(p_org, p_user, v_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at,
           m.parent_id, m.reply_count, m.last_reply_at, public.chat_line_reactions(m.id),
           (select x.pinned_at from public.chat_pins x where x.message_id = m.id and m.deleted_at is null),
           exists (select 1 from public.chat_saved s where s.user_id = p_user and s.message_id = m.id),
           public.chat_line_files(m.id)
      from public.messages m
     where m.parent_id = p_parent and m.org_id = p_org
       and (p_before_seq is null or m.seq < p_before_seq)
     order by m.seq desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- ── Grants: service role only ───────────────────────────────────────────────────────────────────
revoke all on function chat_attachment_place() from public, anon, authenticated;
revoke all on function chat_attachment_guard() from public, anon, authenticated;
revoke all on function chat_ledger_files() from public, anon, authenticated;
revoke all on function messages_words_or_files() from public, anon, authenticated;
revoke all on function chat_file_can_upload(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function chat_send_files(uuid, uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function chat_line_files(uuid) from public, anon, authenticated;
revoke all on function chat_file_for(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function chat_files(uuid, uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function chat_history(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function chat_sync(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function chat_channel_posts(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function chat_replies(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
grant execute on function chat_file_can_upload(uuid, uuid, uuid) to service_role;
grant execute on function chat_send_files(uuid, uuid, uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function chat_file_for(uuid, uuid, uuid) to service_role;
grant execute on function chat_files(uuid, uuid, uuid, timestamptz, uuid, integer) to service_role;
grant execute on function chat_history(uuid, uuid, uuid, bigint, integer) to service_role;
grant execute on function chat_sync(uuid, uuid, uuid, bigint, integer) to service_role;
grant execute on function chat_channel_posts(uuid, uuid, uuid, bigint, integer) to service_role;
grant execute on function chat_replies(uuid, uuid, uuid, bigint, integer) to service_role;
