-- Silvicom 360 — 0517 office chat: legal holds and exports, each one a ledgered act
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md CHA3a; D-CHAT12, D-CHAT15, D-CHAT20; Q-CHAT15)
--
-- 0516 let a compliance holder READ the org's chat with a reason. What a lawyer or an HR case needs
-- next is the two things §5.2 of the plan named and release 1 did not build:
--
--   1. A LEGAL HOLD, per person and per conversation (D-CHAT15). Slack's holds are per person only,
--      so a conversation in which no held person speaks falls outside the hold; a per-conversation
--      hold closes that gap. A hold is set with a matter ("Grievance HR-14") and a reason, and it is
--      RELEASED, never deleted: the row stays, gaining who released it, when and why. "Holds beat
--      retention" is the rule a purge must keep — and there is no purge (Q-CHAT15: Q-CHAT5 keeps
--      everything forever until counsel names a period), so today a hold is the RECORD that the
--      company was told to keep these words and did. That record is what a court asks for, and it
--      must exist from the day of the instruction, not from the day a purge is written.
--
--   2. AN EXPORT that proves itself (D-CHAT20). `chat_compliance_export_rows` returns one
--      conversation, or one messages search, whole: every line with its words — retracted or not —
--      every earlier version, and each body's SHA-256, the same hash the ledger stored when the line
--      was sent or edited. It folds those hashes into one `content_sha256` and appends the
--      `compliance_export` ledger row CARRYING it, before a word is returned. So the export is tied
--      into the chain at a position: its own ledger row's `seq` and `hash` are "the ledger head at the
--      instant of the export", and a court-side check is to recompute the line hashes from the JSONL,
--      fold them the documented way (below), and find that number in the ledger row whose hash the
--      manifest names. The API turns the rows into JSONL + PDF + manifest.json (CHA3b).
--
-- `chat_exports` is the export's own record, the `dq_exports` shape (0152): the row outlives its
-- bytes. The files live in the private `compliance-exports` bucket under `<org>/chat/<export>/` for
-- seven days, then the sweep clears the paths and stamps `purged_at`; the row, the hashes and the
-- ledger entry stay. Regenerating is one click, and the new export is a new ledgered act.
--
-- WHY NEITHER TABLE HAS FOREIGN KEYS to users, conversations or the ledger: both describe facts that
-- must outlive what they name, as `chat_ledger` (0511) does. `org_id` alone references organizations.
--
-- WHAT A ROW MAY CHANGE. A hold changes once, from active to released, and nothing else about it ever
-- changes. An export changes only along building → ready | failed, and ready → purged (the sweep).
-- Both are guarded by triggers that refuse everything else for every caller, service role included
-- (CL001), with 0511's one exception for the schema owner in a declared retention transaction —
-- needed only so that deleting a whole organisation can cascade.
--
-- THE FOLD (documented here because the manifest points here): for the lines in export order
-- (conversation, then seq), `content_sha256 = sha256( join(id || ':' || sha256(body), '\n') )`, UTF-8,
-- lower-case hex. Earlier versions are listed in the manifest with their own hashes; they are NOT in
-- the fold, because the ledger's `message_edited` rows already chain them.
--
-- Error codes (the API maps them in chatCompliance.ts):
--   CH001  that conversation is not in this organisation (→ 404)
--   CH009  the reason is missing or malformed (→ 422)
--   CH010  a hold's matter is missing, or the hold is already released, or an export is too large (→ 422/409)
--
-- Rollback: drop the functions, then the two tables (both are empty until CHA3b's routes call these).
-- The `compliance_export`, `hold_set` and `hold_released` ledger actions already exist in 0511.

-- ── 1. chat_holds ───────────────────────────────────────────────────────────────────────────────
create table if not exists chat_holds (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  scope          text not null check (scope in ('person', 'conversation')),
  -- The person (a user id) or the conversation (a thread id) the hold is on, as `scope` says. One
  -- column, so a hold always has exactly one target and no constraint has to say so.
  target_id      uuid not null,
  -- The matter the hold belongs to, as the lawyer or HR names it ("Grievance HR-14").
  matter         text not null check (length(btrim(matter)) between 3 and 120),
  reason         jsonb not null,
  set_by         uuid not null,
  set_at         timestamptz not null default now(),
  released_at    timestamptz,
  released_by    uuid,
  release_reason jsonb,
  constraint chat_holds_release_shape check (
    (released_at is null) = (released_by is null) and (released_at is null) = (release_reason is null))
);
create index if not exists idx_chat_holds_org on chat_holds (org_id, set_at desc);
create index if not exists idx_chat_holds_active on chat_holds (org_id, scope) where released_at is null;

alter table chat_holds enable row level security;
-- No policies: written and read by the compliance console through the service role.

create or replace function chat_holds_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.released_at is null and new.released_at is not null
     and (new.id, new.org_id, new.scope, new.target_id, new.matter, new.reason, new.set_by, new.set_at)
         is not distinct from
         (old.id, old.org_id, old.scope, old.target_id, old.matter, old.reason, old.set_by, old.set_at) then
    return new;
  end if;
  raise exception 'a hold is only ever released, once; nothing else about it changes (D-CHAT15)' using errcode = 'CL001';
end;
$$;

drop trigger if exists trg_chat_holds_guard on chat_holds;
create trigger trg_chat_holds_guard before update on chat_holds
  for each row execute function chat_holds_guard();
drop trigger if exists trg_chat_holds_no_delete on chat_holds;
create trigger trg_chat_holds_no_delete before delete on chat_holds
  for each row execute function chat_records_append_only();
drop trigger if exists trg_chat_holds_no_truncate on chat_holds;
create trigger trg_chat_holds_no_truncate before truncate on chat_holds
  for each statement execute function chat_records_append_only();

-- The ledger hears of every hold whatever wrote it, as 0511's triggers hear of every message.
create or replace function chat_ledger_holds() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, subject_user_id, detail)
  values (new.org_id,
          case when tg_op = 'INSERT' then new.set_by else new.released_by end,
          case when tg_op = 'INSERT' then 'hold_set' else 'hold_released' end,
          case when new.scope = 'conversation' then new.target_id end,
          case when new.scope = 'person' then new.target_id end,
          jsonb_build_object('hold_id', new.id, 'scope', new.scope, 'matter', new.matter,
                             'reason', case when tg_op = 'INSERT' then new.reason else new.release_reason end));
  return null;
end;
$$;

drop trigger if exists trg_chat_ledger_holds on chat_holds;
create trigger trg_chat_ledger_holds after insert or update of released_at on chat_holds
  for each row execute function chat_ledger_holds();

-- ── 2. chat_exports ─────────────────────────────────────────────────────────────────────────────
create table if not exists chat_exports (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  scope           text not null check (scope in ('conversation', 'search')),
  thread_id       uuid,
  filters         jsonb not null default '{}',
  reason          jsonb not null,
  requested_by    uuid not null,
  created_at      timestamptz not null default now(),
  message_count   integer not null check (message_count >= 0),
  -- The export's own `compliance_export` ledger row: the chain position it is tied to.
  ledger_seq      bigint not null,
  ledger_hash     text not null check (ledger_hash ~ '^[0-9a-f]{64}$'),
  content_sha256  text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  status          text not null default 'building' check (status in ('building', 'ready', 'failed')),
  -- Keys in `compliance-exports`: `<org>/chat/<export>/{export.jsonl, export.pdf, manifest.json}`.
  storage_paths   text[],
  bytes           bigint check (bytes is null or bytes > 0),
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  error           text,
  completed_at    timestamptz,
  expires_at      timestamptz,
  purged_at       timestamptz,
  constraint chat_exports_scope_shape check (scope = 'search' or thread_id is not null),
  constraint chat_exports_ready_shape check (
    status <> 'ready' or (storage_paths is not null or purged_at is not null) and manifest_sha256 is not null and expires_at is not null)
);
create index if not exists idx_chat_exports_org on chat_exports (org_id, created_at desc);
create index if not exists idx_chat_exports_sweep on chat_exports (expires_at)
  where storage_paths is not null and purged_at is null;

alter table chat_exports enable row level security;
-- No policies: the record of who took the org's words out of the system is the console's alone.

create or replace function chat_exports_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (new.id, new.org_id, new.scope, new.thread_id, new.filters, new.reason, new.requested_by, new.created_at,
      new.message_count, new.ledger_seq, new.ledger_hash, new.content_sha256)
     is distinct from
     (old.id, old.org_id, old.scope, old.thread_id, old.filters, old.reason, old.requested_by, old.created_at,
      old.message_count, old.ledger_seq, old.ledger_hash, old.content_sha256) then
    raise exception 'an export''s record never changes what was exported (D-CHAT20)' using errcode = 'CL001';
  end if;
  -- building → ready | failed, once.
  if old.status = 'building' and new.status in ('ready', 'failed') and old.purged_at is null and new.purged_at is null then
    return new;
  end if;
  -- ready → purged: the bytes go, the record stays.
  if old.status = 'ready' and new.status = 'ready' and old.purged_at is null and new.purged_at is not null
     and new.storage_paths is null
     and (new.bytes, new.manifest_sha256, new.completed_at, new.expires_at, new.error)
         is not distinct from (old.bytes, old.manifest_sha256, old.completed_at, old.expires_at, old.error) then
    return new;
  end if;
  raise exception 'an export moves building → ready | failed, then ready → purged, and no other way' using errcode = 'CL001';
end;
$$;

drop trigger if exists trg_chat_exports_guard on chat_exports;
create trigger trg_chat_exports_guard before update on chat_exports
  for each row execute function chat_exports_guard();
drop trigger if exists trg_chat_exports_no_delete on chat_exports;
create trigger trg_chat_exports_no_delete before delete on chat_exports
  for each row execute function chat_records_append_only();
drop trigger if exists trg_chat_exports_no_truncate on chat_exports;
create trigger trg_chat_exports_no_truncate before truncate on chat_exports
  for each statement execute function chat_records_append_only();

-- ── 3. Holds: set, release, list ────────────────────────────────────────────────────────────────
create or replace function chat_hold_set(
  p_org uuid, p_actor uuid, p_reason jsonb, p_scope text, p_target uuid, p_matter text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason jsonb := public.chat_compliance_reason(p_reason);
  v_id uuid;
begin
  if nullif(btrim(coalesce(p_matter, '')), '') is null or length(btrim(p_matter)) not between 3 and 120 then
    raise exception 'a hold names its matter in 3 to 120 characters' using errcode = 'CH010';
  end if;
  if p_scope = 'conversation' then
    perform public.chat_compliance_thread_row(p_org, p_target);
  elsif p_scope = 'person' then
    -- A person is held if they are, or were, a member of this org: a hold on somebody who has left
    -- the company is the common case, so suspension does not refuse it.
    if not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_target) then
      raise exception 'that person is not in this organisation' using errcode = 'CH001';
    end if;
  else
    raise exception 'a hold is on a person or a conversation' using errcode = 'CH010';
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  insert into public.chat_holds (org_id, scope, target_id, matter, reason, set_by)
  values (p_org, p_scope, p_target, btrim(p_matter), v_reason, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function chat_hold_release(p_org uuid, p_actor uuid, p_reason jsonb, p_hold uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason jsonb := public.chat_compliance_reason(p_reason);
  v public.chat_holds;
begin
  select h.* into v from public.chat_holds h where h.id = p_hold and h.org_id = p_org for update;
  if v.id is null then
    raise exception 'no such hold in this organisation' using errcode = 'CH001';
  end if;
  if v.released_at is not null then
    raise exception 'that hold is already released' using errcode = 'CH010';
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  update public.chat_holds
     set released_at = now(), released_by = p_actor, release_reason = v_reason
   where id = p_hold;
end;
$$;

-- Every hold, active first then newest, with names. Not ledgered: like the Access log, it is the
-- console's own record and the acts that made it are already in the ledger.
create or replace function chat_holds_list(p_org uuid, p_include_released boolean)
returns table (
  id uuid, scope text, user_id uuid, user_name text, thread_id uuid, thread_kind text, thread_subject text,
  matter text, reason jsonb, set_by uuid, set_by_name text, set_at timestamptz,
  released_at timestamptz, released_by uuid, released_by_name text, release_reason jsonb
)
language sql stable security definer set search_path = ''
as $$
  select h.id, h.scope,
         case when h.scope = 'person' then h.target_id end,
         case when h.scope = 'person' then public.chat_display_name(p_org, h.target_id) end,
         case when h.scope = 'conversation' then h.target_id end, t.kind, t.subject,
         h.matter, h.reason, h.set_by, public.chat_display_name(p_org, h.set_by), h.set_at,
         h.released_at, h.released_by, public.chat_display_name(p_org, h.released_by), h.release_reason
    from public.chat_holds h
    left join public.message_threads t on h.scope = 'conversation' and t.id = h.target_id and t.org_id = p_org
   where h.org_id = p_org and (p_include_released or h.released_at is null)
   order by (h.released_at is null) desc, h.set_at desc, h.id
   limit 500;
$$;

-- ── 4. Export ───────────────────────────────────────────────────────────────────────────────────
-- One conversation (p_thread, no other filter) or one messages search (0516's filters, unpaged),
-- whole, oldest first by conversation then seq. Ledgered and recorded before it returns.
-- 10,000 lines is the ceiling of one export: past it the request is refused (CH010) and the holder
-- narrows by date — a file a reviewer cannot open is not an export.
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

  -- THE FOLD (header): ids and body hashes, in export order, newline-joined.
  select coalesce(string_agg(m.id::text || ':' || public.chat_sha256(m.body), E'\n' order by x.ord), '')
    into v_content
    from unnest(coalesce(v_ids, '{}'::uuid[])) with ordinality x(id, ord)
    join public.messages m on m.id = x.id;

  perform set_config('silvicom.chat_actor', p_actor::text, true);
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, subject_user_id, body_sha256, detail)
  values (p_org, p_actor, 'compliance_export', p_thread, p_person, public.chat_sha256(v_content),
          jsonb_build_object('export_id', p_export_id, 'scope', p_scope, 'reason', v_reason,
                             'filters', v_filters, 'message_count', v_count))
  returning * into v_ledger;

  insert into public.chat_exports (id, org_id, scope, thread_id, filters, reason, requested_by, message_count,
                                   ledger_seq, ledger_hash, content_sha256)
  values (p_export_id, p_org, p_scope, p_thread, v_filters, v_reason, p_actor, v_count,
          v_ledger.seq, v_ledger.hash, v_ledger.body_sha256);

  return query
    select jsonb_build_object(
             'id', p_export_id, 'scope', p_scope, 'filters', v_filters, 'reason', v_reason,
             'requested_by', p_actor, 'requested_by_name', public.chat_display_name(p_org, p_actor),
             'created_at', v_ledger.occurred_at, 'message_count', v_count,
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
                          from public.message_versions v where v.message_id = m.id), '[]'::jsonb))
                    order by x.ord)
               from unnest(coalesce(v_ids, '{}'::uuid[])) with ordinality x(id, ord)
               join public.messages m on m.id = x.id
           ), '[]'::jsonb);
end;
$$;

-- The files are stored: the export becomes ready for seven days.
create or replace function chat_export_stored(
  p_org uuid, p_export uuid, p_paths text[], p_bytes bigint, p_manifest_sha256 text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.chat_exports
     set status = 'ready', storage_paths = p_paths, bytes = p_bytes, manifest_sha256 = p_manifest_sha256,
         completed_at = now(), expires_at = now() + interval '7 days'
   where id = p_export and org_id = p_org and status = 'building';
  if not found then
    raise exception 'no export being built with that id in this organisation' using errcode = 'CH001';
  end if;
end;
$$;

create or replace function chat_export_failed(p_org uuid, p_export uuid, p_error text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.chat_exports
     set status = 'failed', error = left(coalesce(p_error, 'unknown'), 500), completed_at = now()
   where id = p_export and org_id = p_org and status = 'building';
end;
$$;

-- The sweep: exports whose bytes have expired, oldest first, and the act of clearing them.
create or replace function chat_exports_expired(p_limit integer)
returns table (id uuid, org_id uuid, storage_paths text[])
language sql stable security definer set search_path = ''
as $$
  select e.id, e.org_id, e.storage_paths from public.chat_exports e
   where e.storage_paths is not null and e.purged_at is null and e.expires_at <= now()
   order by e.expires_at
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

create or replace function chat_export_purged(p_export uuid) returns void
language sql security definer set search_path = ''
as $$
  update public.chat_exports set storage_paths = null, purged_at = now()
   where id = p_export and status = 'ready' and purged_at is null;
$$;

-- The console's Exports list: who took what out, and whether the files are still there.
create or replace function chat_exports_list(p_org uuid, p_before_at timestamptz, p_limit integer)
returns table (
  id uuid, scope text, thread_id uuid, thread_subject text, filters jsonb, reason jsonb,
  requested_by uuid, requested_by_name text, created_at timestamptz, message_count integer,
  ledger_seq bigint, content_sha256 text, status text, bytes bigint, expires_at timestamptz, purged_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.scope, e.thread_id, t.subject, e.filters, e.reason, e.requested_by,
         public.chat_display_name(p_org, e.requested_by), e.created_at, e.message_count, e.ledger_seq,
         e.content_sha256, e.status, e.bytes, e.expires_at, e.purged_at
    from public.chat_exports e
    left join public.message_threads t on t.id = e.thread_id and t.org_id = p_org
   where e.org_id = p_org and (p_before_at is null or e.created_at < p_before_at)
   order by e.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- The one export, for a download link: its paths if the bytes are still there.
create or replace function chat_export_get(p_org uuid, p_export uuid)
returns table (id uuid, status text, storage_paths text[], expires_at timestamptz, purged_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.status, e.storage_paths, e.expires_at, e.purged_at
    from public.chat_exports e where e.id = p_export and e.org_id = p_org;
$$;

-- ── Grants: service role only ───────────────────────────────────────────────────────────────────
revoke all on function chat_holds_guard() from public, anon, authenticated;
revoke all on function chat_exports_guard() from public, anon, authenticated;
revoke all on function chat_ledger_holds() from public, anon, authenticated;
revoke all on function chat_hold_set(uuid, uuid, jsonb, text, uuid, text) from public, anon, authenticated;
revoke all on function chat_hold_release(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function chat_holds_list(uuid, boolean) from public, anon, authenticated;
revoke all on function chat_compliance_export_rows(uuid, uuid, jsonb, uuid, text, uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function chat_export_stored(uuid, uuid, text[], bigint, text) from public, anon, authenticated;
revoke all on function chat_export_failed(uuid, uuid, text) from public, anon, authenticated;
revoke all on function chat_exports_expired(integer) from public, anon, authenticated;
revoke all on function chat_export_purged(uuid) from public, anon, authenticated;
revoke all on function chat_exports_list(uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function chat_export_get(uuid, uuid) from public, anon, authenticated;
grant execute on function chat_hold_set(uuid, uuid, jsonb, text, uuid, text) to service_role;
grant execute on function chat_hold_release(uuid, uuid, jsonb, uuid) to service_role;
grant execute on function chat_holds_list(uuid, boolean) to service_role;
grant execute on function chat_compliance_export_rows(uuid, uuid, jsonb, uuid, text, uuid, uuid, timestamptz, timestamptz, text) to service_role;
grant execute on function chat_export_stored(uuid, uuid, text[], bigint, text) to service_role;
grant execute on function chat_export_failed(uuid, uuid, text) to service_role;
grant execute on function chat_exports_expired(integer) to service_role;
grant execute on function chat_export_purged(uuid) to service_role;
grant execute on function chat_exports_list(uuid, timestamptz, integer) to service_role;
grant execute on function chat_export_get(uuid, uuid) to service_role;
