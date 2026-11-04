-- 0564 — org_role_permissions: named permissions a carrier switches per role (IDP1).
--
-- HIRING-WORKFLOW-AUDIT-2026-10-31 §15.1, D-IDP1..D-IDP4. Owner ruling Q-WF4b, 2026-11-04: who may see a
-- photograph of an applicant's Social Security card or passport is "basically safety and recruiting, but
-- in Settings → Permissions we should add a permission setting for this".
--
-- ── WHY A TABLE OF ITS OWN, AND NOT A SECTION CELL ──────────────────────────────────────────────────
-- 0291's `org_section_access` answers "what may this role do on that PAGE"; a picture of an identity
-- number is not a page, and a recruiter who may manage recruitment may still be refused it. So the unit
-- is a NAMED permission, one switch per role. The catalogue of permissions (their keys, labels and shipped
-- defaults) is `EDITABLE_PERMISSIONS` in packages/shared — so the key is checked for its SHAPE here and
-- never listed (§10 D-CE3's rule: a CHECK naming keys would be a second catalogue to drift from the first).
-- A stored key the catalogue does not know is ignored on read.
--
-- ── SPARSE, LIKE 0291 (D-PERM4) ─────────────────────────────────────────────────────────────────────
-- No row = the shipped default, never "denied". `allowed` is stored in both directions because an org
-- switching a default-on role OFF is the common case, and absence already means "unchanged".
--
-- ── NOT D-PERM9 ─────────────────────────────────────────────────────────────────────────────────────
-- The restricted readers (drug and alcohol results, Clearinghouse, PSP, employer inquiries) stay bare role
-- tests: a regulation names who reads them. Nothing names who sees an SSN card's picture — that is the
-- carrier's privacy choice — and only permissions of that kind belong in this table.
--
-- ── THE LOCKS ARE CHECKS ────────────────────────────────────────────────────────────────────────────
-- `admin` and `driver` are not editable roles (D-PERM7/D-PERM8, 0291's same two exclusions): the admin
-- holds every permission permanently, and a driver never reaches the office screens. Stated in SQL so a
-- second writer that never read the plan cannot store them.
--
-- RLS on, NO policy at all: unlike 0291 nothing in the browser reads this table (the API answers both the
-- settings page and every image decision), and every change must carry an audit row, which only the API
-- writes. Deny-all from PostgREST is the point.
--
-- Rollback: drop table public.org_role_permissions; re-run 0395's `write_access_cell` definition.

create table if not exists org_role_permissions (
  org_id uuid not null references organizations(id) on delete cascade,
  -- 7 of 9 USER_ROLES; mirrors 0291's list, which `lint:section-policies` keeps honest.
  role text not null check (role in (
    'fleet_manager', 'dispatcher', 'safety_manager', 'auditor', 'recruiter', 'accountant', 'technician'
  )),
  -- `area.name`, lower case: `recruitment.identity_number_images`.
  permission text not null check (permission ~ '^[a-z][a-z_]{1,40}\.[a-z][a-z_]{1,60}$'),
  allowed boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, role, permission)
);

alter table org_role_permissions enable row level security;

-- A row never walks into another tenant (0161's invariant).
drop trigger if exists trg_org_role_permissions_org_immutable on org_role_permissions;
create trigger trg_org_role_permissions_org_immutable
  before update on org_role_permissions
  for each row execute function forbid_org_change();

-- ── ONE WRITE PATH, AUDITED IN THE SAME TRANSACTION (SP8, Q-SET7 (a)) ───────────────────────────────
-- `write_access_cell` (0395) is how every change to who may do what is written: the before-state read
-- under a row lock, the change, and the audit row with `from`/`to`, in one transaction. It refuses any
-- table it does not know (22023), so it is redefined here with a fifth case and nothing else changed —
-- the four existing calls resolve exactly as before. Signature unchanged, so `create or replace` keeps
-- 0395's grants (service_role only).

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
    -- 0564 (§15.1, D-IDP1): a carrier's switch for a NAMED permission, one per role.
    when 'org_role_permissions'    then v_subject_col := 'role';    v_subject_typ := 'text'; v_key_col := 'permission';  v_val_col := 'allowed'; v_val_typ := 'boolean';
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

comment on table org_role_permissions is
  'Per-org switches for NAMED permissions (HIRING-WORKFLOW-AUDIT §15.1, D-IDP1). SPARSE: no row = the shipped default in EDITABLE_PERMISSIONS (packages/shared). API-only: RLS on, no policies.';
