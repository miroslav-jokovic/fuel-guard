-- 0395 — every change to who may do what is written together with its audit row, records what it
-- was before, and the audit log can no longer be edited or deleted by the application.
--
-- SP8 of docs/plans/permissions/SETTINGS-PERMISSIONS-PLAN.md §4b (gaps 4 and 5), ruled by the owner
-- 2026-09-30: Q-SET7 (a) — an access change with no audit row does not happen; Q-SET9 (a) — the log is
-- append-only in the database, with one named retention path.
--
-- ── WHAT WAS WRONG, MEASURED AT 6e1a26d ───────────────────────────────────────────────────────
-- Each permission write in the API was two or three separate PostgREST calls: delete the cell, insert
-- the cell, then `writeAudit()` — which returns false on failure, and no caller in sectionAccess.ts,
-- surfaceAccess.ts, members.ts or invites.ts ever read it. So a crash or a failed insert between them
-- could leave a change nobody can account for, or an audit row for a change that never landed. And the
-- rows that did land could not answer "what was it before": the matrix audits carried the new value and
-- the shipped default, never the override they replaced; `member.removed` did not say which role the
-- person held; `invite.revoked` carried no meta at all.
--
-- ── WHAT THIS FILE ADDS ───────────────────────────────────────────────────────────────────────
-- Functions, each ONE transaction that reads the before-state under a row lock, makes the change, and
-- inserts the audit row with `from` and `to` merged into the meta the API supplies. If any part fails
-- the whole call rolls back — Q-SET7 (a) is the transaction, not a check after it.
--
--   · write_access_cell      — one cell of any of the four access tables (role × section, person ×
--                              section, role × screen, person × screen). NULL value = remove the row,
--                              which is how D-PERM4's "back to the default" and the per-person "follow
--                              the role" are both written.
--   · member_change_role     — the Users page's role change; 0392's deferred trigger still refuses the
--                              last admin, at the commit of this same call.
--   · member_remove          — remove and revoke (the action name says which); records the role held.
--   · member_set_suspended   — Q-SET12 (0393).
--   · invite_create / invite_revoke / invite_delete / invite_reissue — the invite is the grant of a
--                              role to an email address, so it is an access change like the others.
--                              Delivery happens after the transaction (it is an email), so its outcome
--                              is a second, separate row (`invite.delivered`) the API writes.
--
-- Status rules (which invites may be deleted or resent, which roles are roster-issued, the last-admin
-- wording) stay in the API where the sentences live; each function still re-checks under its lock the
-- one fact it needs so a race cannot slip between the API's read and this write. Every function is
-- SECURITY DEFINER with an empty search path and executable by `service_role` only: the browser cannot
-- reach any of them (0392 closed its direct path to these tables too).
--
-- ── APPEND-ONLY, IN THE DATABASE (Q-SET9) ─────────────────────────────────────────────────────
-- `RETENTION_FORBIDDEN` (dataRetentionPolicy.ts) already says audit_logs is never pruned, and nothing
-- in the repository UPDATEs or DELETEs it (searched 2026-09-30: migrations, apps/api, apps/admin-api).
-- The rule now holds whoever asks: a row trigger refuses UPDATE and DELETE and a statement trigger
-- refuses TRUNCATE — for `service_role`, for every client role, and for the owner too — with ONE named
-- exception: the schema owner inside a transaction that has declared itself retention work,
--
--     set local silvicom.audit_retention = 'L7';
--
-- which is how the lifecycle plan's L7 (archive the 5.06 M pre-0352 rows, then drop them — Q1 re-ruled
-- (b) 2026-09-30) will run: as a reviewed migration or a definer function owned by `postgres`. A
-- `service_role` caller cannot use it even by setting the same GUC, because the owner check is on
-- `current_user`. Deleting an organisation, which cascades its audit rows, now needs the same
-- declaration — deliberately: the record of what an organisation did is the last thing that should
-- disappear as a side effect.
--
-- Rollback: drop the two triggers and their functions; drop the eight write functions. The API's
-- SP8b callers must be reverted first.

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Append-only
-- ═════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.audit_logs_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin')
     and coalesce(current_setting('silvicom.audit_retention', true), '') <> '' then
    return case tg_op when 'DELETE' then old when 'TRUNCATE' then null else new end;
  end if;
  raise exception
    'audit_logs is append-only: % is refused (Q-SET9). Retention runs as the schema owner after "set local silvicom.audit_retention"',
    tg_op
    using errcode = 'AU010';
end;
$$;

comment on function public.audit_logs_append_only() is
  'Q-SET9 (0395): refuses UPDATE, DELETE and TRUNCATE on audit_logs for every caller except the schema
   owner inside a transaction that has run "set local silvicom.audit_retention = <reason>" (the
   lifecycle plan''s L7). Raises AU010.';

drop trigger if exists trg_audit_logs_append_only on audit_logs;
create trigger trg_audit_logs_append_only
  before update or delete on audit_logs
  for each row execute function public.audit_logs_append_only();

drop trigger if exists trg_audit_logs_no_truncate on audit_logs;
create trigger trg_audit_logs_no_truncate
  before truncate on audit_logs
  for each statement execute function public.audit_logs_append_only();

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 2. One access cell
-- ═════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.write_access_cell(
  p_table   text,
  p_org_id  uuid,
  p_role    text,
  p_user_id uuid,
  p_key     text,
  p_value   text,
  p_actor   uuid,
  p_action  text,
  p_meta    jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_subject_col text;
  v_subject_typ text;
  v_key_col     text;
  v_val_col     text;
  v_val_typ     text;
  v_subject     text;
  v_before      text;
  v_from        jsonb;
  v_to          jsonb;
begin
  case p_table
    when 'org_section_access'      then v_subject_col := 'role';    v_subject_typ := 'text'; v_key_col := 'section';     v_val_col := 'access';  v_val_typ := 'text';
    when 'user_section_access'     then v_subject_col := 'user_id'; v_subject_typ := 'uuid'; v_key_col := 'section';     v_val_col := 'access';  v_val_typ := 'text';
    when 'org_role_surface_access' then v_subject_col := 'role';    v_subject_typ := 'text'; v_key_col := 'surface_key'; v_val_col := 'allowed'; v_val_typ := 'boolean';
    when 'user_surface_access'     then v_subject_col := 'user_id'; v_subject_typ := 'uuid'; v_key_col := 'surface_key'; v_val_col := 'allowed'; v_val_typ := 'boolean';
    else raise exception 'write_access_cell: % is not an access table', p_table using errcode = '22023';
  end case;

  v_subject := case v_subject_col when 'role' then p_role else p_user_id::text end;
  if v_subject is null or p_org_id is null or p_key is null or p_actor is null or p_action is null then
    raise exception 'write_access_cell: org, subject, key, actor and action are all required' using errcode = '22023';
  end if;

  -- The before-state, locked, so two admins editing the same cell serialise and each audit row's
  -- `from` is the value that row actually replaced.
  execute format(
    'select %I::text from public.%I where org_id = $1 and %I = $2::%s and %I = $3 for update',
    v_val_col, p_table, v_subject_col, v_subject_typ, v_key_col
  ) into v_before using p_org_id, v_subject, p_key;

  -- Delete-then-insert, never a partial upsert (lint:upserts; the 0174/0175 shape the API used).
  execute format(
    'delete from public.%I where org_id = $1 and %I = $2::%s and %I = $3',
    p_table, v_subject_col, v_subject_typ, v_key_col
  ) using p_org_id, v_subject, p_key;

  if p_value is not null then
    execute format(
      'insert into public.%I (org_id, %I, %I, %I, updated_by) values ($1, $2::%s, $3, $4::%s, $5)',
      p_table, v_subject_col, v_key_col, v_val_col, v_subject_typ, v_val_typ
    ) using p_org_id, v_subject, p_key, p_value, p_actor;
  end if;

  -- `from`/`to` in the value's own JSON type: a screen's answer is a boolean, a section's a word.
  -- null on either side means "no row" — the default (role) or "follows the role" (person).
  if v_val_typ = 'boolean' then
    v_from := to_jsonb(v_before::boolean);
    v_to   := to_jsonb(p_value::boolean);
  else
    v_from := to_jsonb(v_before);
    v_to   := to_jsonb(p_value);
  end if;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (
    p_org_id, p_actor, p_action, p_table, p_user_id,
    coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('from', coalesce(v_from, 'null'::jsonb), 'to', coalesce(v_to, 'null'::jsonb))
  );

  return jsonb_build_object('from', coalesce(v_from, 'null'::jsonb), 'to', coalesce(v_to, 'null'::jsonb));
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 3. Members
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Each returns the membership's role BEFORE the change, or null when the person is not a member of
-- this organisation (the API answers 404 on null; nothing is written and nothing is audited).

create or replace function public.member_change_role(
  p_org_id uuid, p_user_id uuid, p_role public.user_role, p_actor uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before text;
begin
  select m.role::text into v_before
    from public.memberships m
   where m.org_id = p_org_id and m.user_id = p_user_id
   for update;
  if v_before is null then
    return null;
  end if;
  if v_before = p_role::text then
    return v_before;
  end if;

  update public.memberships set role = p_role where org_id = p_org_id and user_id = p_user_id;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (p_org_id, p_actor, 'member.role_changed', 'memberships', p_user_id,
          jsonb_build_object('from', v_before, 'to', p_role::text));
  return v_before;
end;
$$;

create or replace function public.member_remove(
  p_org_id uuid, p_user_id uuid, p_actor uuid, p_action text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before text;
begin
  if p_action not in ('member.removed', 'member.access_revoked') then
    raise exception 'member_remove: % is not a removal action', p_action using errcode = '22023';
  end if;
  delete from public.memberships m
   where m.org_id = p_org_id and m.user_id = p_user_id
  returning m.role::text into v_before;
  if v_before is null then
    return null;
  end if;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (p_org_id, p_actor, p_action, 'memberships', p_user_id, jsonb_build_object('role', v_before));
  return v_before;
end;
$$;

create or replace function public.member_set_suspended(
  p_org_id uuid, p_user_id uuid, p_suspended boolean, p_actor uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_was  timestamptz;
begin
  select m.role::text, m.suspended_at into v_role, v_was
    from public.memberships m
   where m.org_id = p_org_id and m.user_id = p_user_id
   for update;
  if v_role is null then
    return null;
  end if;
  -- Already in the asked-for state: nothing changes, so nothing is recorded.
  if (v_was is not null) = p_suspended then
    return v_role;
  end if;

  update public.memberships
     set suspended_at = case when p_suspended then now() else null end,
         suspended_by = case when p_suspended then p_actor else null end
   where org_id = p_org_id and user_id = p_user_id;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (p_org_id, p_actor, case when p_suspended then 'member.suspended' else 'member.reinstated' end,
          'memberships', p_user_id,
          jsonb_build_object('role', v_role) || case when p_suspended then '{}'::jsonb else jsonb_build_object('suspendedAt', v_was) end);
  return v_role;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 4. Invites
-- ═════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.invite_create(
  p_org_id uuid, p_email text, p_role public.user_role, p_full_name text,
  p_token_hash text, p_expires_at timestamptz, p_actor uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- A duplicate (org_id, email) raises 23505 out of this insert, and the API answers invite_exists.
  insert into public.invites (org_id, email, role, full_name, invited_by, token, expires_at)
  values (p_org_id, p_email, p_role, p_full_name, p_actor, p_token_hash, p_expires_at)
  returning id into v_id;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (p_org_id, p_actor, 'invite.created', 'invites', v_id,
          jsonb_build_object('email', p_email, 'role', p_role::text, 'fullName', p_full_name));
  return v_id;
end;
$$;

-- Returns the status the invite held before, or null when there is no such invite in this org.
create or replace function public.invite_revoke(p_org_id uuid, p_invite_id uuid, p_actor uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before text;
  v_email  text;
  v_role   text;
begin
  select i.status::text, i.email, i.role::text into v_before, v_email, v_role
    from public.invites i
   where i.id = p_invite_id and i.org_id = p_org_id
   for update;
  if v_before is null then
    return null;
  end if;

  update public.invites set status = 'revoked' where id = p_invite_id and org_id = p_org_id;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (p_org_id, p_actor, 'invite.revoked', 'invites', p_invite_id,
          jsonb_build_object('email', v_email, 'role', v_role, 'from', v_before));
  return v_before;
end;
$$;

-- The audit row carries the whole invite: after this it is the only record the invite existed.
-- Re-checks the deletable statuses under the lock (the API words the refusal first).
create or replace function public.invite_delete(p_org_id uuid, p_invite_id uuid, p_actor uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.invites%rowtype;
begin
  select * into v_row from public.invites i where i.id = p_invite_id and i.org_id = p_org_id for update;
  if v_row.id is null then
    return null;
  end if;
  if v_row.status::text not in ('revoked', 'expired') then
    raise exception 'invite % is % — only a revoked or expired invite can be deleted', p_invite_id, v_row.status
      using errcode = 'AM020';
  end if;

  delete from public.invites where id = p_invite_id and org_id = p_org_id;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (p_org_id, p_actor, 'invite.deleted', 'invites', p_invite_id,
          jsonb_build_object('email', v_row.email, 'role', v_row.role::text, 'status', v_row.status::text,
                             'fullName', v_row.full_name, 'createdAt', v_row.created_at));
  return v_row.status::text;
end;
$$;

-- A resend mints a new link: the old token stops working, which is an access change in itself.
create or replace function public.invite_reissue(
  p_org_id uuid, p_invite_id uuid, p_token_hash text, p_expires_at timestamptz, p_actor uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before text;
  v_email  text;
begin
  select i.status::text, i.email into v_before, v_email
    from public.invites i
   where i.id = p_invite_id and i.org_id = p_org_id
   for update;
  if v_before is null then
    return null;
  end if;
  if v_before not in ('pending', 'revoked', 'expired') then
    raise exception 'invite % is % — only a pending, revoked or expired invite can be resent', p_invite_id, v_before
      using errcode = 'AM020';
  end if;

  update public.invites
     set status = 'pending', token = p_token_hash, expires_at = p_expires_at
   where id = p_invite_id and org_id = p_org_id;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (p_org_id, p_actor, 'invite.resent', 'invites', p_invite_id,
          jsonb_build_object('email', v_email, 'from', v_before));
  return v_before;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 5. Service role only
-- ═════════════════════════════════════════════════════════════════════════════════════════════
revoke all on function public.write_access_cell(text, uuid, text, uuid, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.member_change_role(uuid, uuid, public.user_role, uuid) from public, anon, authenticated;
revoke all on function public.member_remove(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.member_set_suspended(uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.invite_create(uuid, text, public.user_role, text, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.invite_revoke(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.invite_delete(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.invite_reissue(uuid, uuid, text, timestamptz, uuid) from public, anon, authenticated;

grant execute on function public.write_access_cell(text, uuid, text, uuid, text, text, uuid, text, jsonb) to service_role;
grant execute on function public.member_change_role(uuid, uuid, public.user_role, uuid) to service_role;
grant execute on function public.member_remove(uuid, uuid, uuid, text) to service_role;
grant execute on function public.member_set_suspended(uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.invite_create(uuid, text, public.user_role, text, text, timestamptz, uuid) to service_role;
grant execute on function public.invite_revoke(uuid, uuid, uuid) to service_role;
grant execute on function public.invite_delete(uuid, uuid, uuid) to service_role;
grant execute on function public.invite_reissue(uuid, uuid, text, timestamptz, uuid) to service_role;

comment on function public.write_access_cell(text, uuid, text, uuid, text, text, uuid, text, jsonb) is
  'SP8 (0395): one cell of org_section_access / user_section_access / org_role_surface_access /
   user_surface_access and its audit row, in one transaction, with the before and after values merged
   into the audit meta. NULL value removes the row (the default / follows the role).';
