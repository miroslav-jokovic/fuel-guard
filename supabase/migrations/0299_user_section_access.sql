-- 0299 — user_section_access: the per-PERSON answer to "which ROWS may this member touch".
--
-- D-SURF7, docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md step S5. The owner asked for "custom
-- setup for each user", and that applies to both permission vocabularies this product has. 0298
-- answered it for SCREENS. This one answers it for DATA — the security boundary, the one RLS
-- enforces — and so it is the more careful of the two.
--
-- ── WHY THE TABLE AND THE HOOK CHANGE ARE IN ONE FILE, WHERE 0298 SPLIT NOTHING ────────────────
-- D-SURF9 makes a TypeScript reader ship one merge behind its table, because a merge is SERVED ~3
-- minutes in and its migration APPLIED ~12 (docs/MIGRATION-DISCIPLINE.md §the-deploy-window). That
-- rule is about TypeScript. `custom_access_token_hook` is SQL in this very file: the table and the
-- function that reads it apply in the same instant, and there is no window in which one exists
-- without the other. Nothing else changes — `sections` already flows from the claim through
-- `claimsToContext` (packages/shared/src/auth.ts) into `stores/session.ts`, and every consumer
-- already reads it, so S5's whole READ path is the eleven lines below.
--
-- ── SPARSE, MERGED OVER THE ROLE'S ANSWER (D-PERM4, D-SURF6) ───────────────────────────────────
-- A row means "this org has answered for this person and this section". No row is not a denial — it
-- is UNCHANGED, and the answer falls back to the role's override and then to the shipped matrix in
-- `packages/shared/src/auth.ts`. The hook merges with `||`, whose right operand wins, so the
-- person's answer beats their role's and both stay absent when nobody has answered.
--
-- The consequence that makes this safe to apply to a live project: an org that has never opened the
-- permissions page mints exactly the token it does today, byte for byte, and a token minted before
-- this migration carries no extra claim at all — `auth_section()` returns null, every policy takes
-- its default role-list branch, and every live session behaves precisely as it did. 0291 and 0292
-- made the same argument and it has not weakened.
--
-- ── THE LOCKS ARE RE-APPLIED IN THE HOOK, AND THAT IS NOT BELT-AND-BRACES ──────────────────────
-- ⚠ 0292's header says it plainly and this migration is the reason to say it again: this function is
-- the one that turns a row into AUTHORITY. If a row for the `admin` section, or for a member holding
-- the `admin` or `driver` role, ever existed — a restore, a support action, a future writer — the
-- hook is the last place that can decline to honour it, and the only place whose failure hands out
-- access rather than merely storing something wrong. So `and section <> 'admin'` is on the new read
-- as well as the old, and both reads stay inside the existing `if v_role not in ('admin','driver')`.
--
-- ── `section` DOES GET A CHECK CONSTRAINT, WHERE 0298's `surface_key` DID NOT ──────────────────
-- The asymmetry is deliberate and it is 0291's argument, unchanged: D-PERM7 is a SECURITY boundary,
-- so the `admin` section must be UNSTORABLE — a bad row must not be able to become authority. A bad
-- `surface_key` is inert by contrast (the resolver looks it up in a catalogue and finds no screen),
-- which is why pinning 52 keys there would have bought nothing and cost a migration per page. Here
-- the vocabulary is 11 long, it changes about once a year, and one of its members is the boundary.
-- The literal list is copied from 0291 rather than derived, because SQL cannot read the TypeScript
-- constant; `lint:section-policies` is what keeps the two honest.
--
-- ⚠ The ROLE lock, by contrast, cannot be a CHECK here for exactly the reason 0298 records: this
-- table is keyed by `user_id` and a row does not know its member's role, which lives in `memberships`
-- and can change after the row is written. It is enforced by the write endpoint (an org-scoped
-- membership lookup) and by the hook's own `v_role not in ('admin','driver')` guard, which is the
-- layer that actually matters because it is the one standing between a row and a claim.
--
-- ── D-SURF2 EXPRESSED AT THE MINT ─────────────────────────────────────────────────────────────
-- A per-user override may narrow or widen WITHIN the vocabulary an org can already grant a role; it
-- can never produce the one section that is not an org's to grant. That is what the `admin`
-- exclusion above enforces, and it is why widening a person to `manage` on a section they hold is a
-- permission edit rather than an escalation path: the same edit is available on the role, on the
-- page P4 already built, where it is visible as what it is.
--
-- Rollback: drop table public.user_section_access; and restore 0292's hook body verbatim.

create table if not exists user_section_access (
  org_id     uuid        not null,
  -- The member whose access is being changed. Composite FK below, not a plain auth.users reference:
  -- an override for somebody who is not in this org is a row that can never apply, and 0298 settled
  -- this shape. `memberships` carries UNIQUE (org_id, user_id), which is what makes it legal.
  user_id    uuid        not null,
  -- 11 of the 12 in APP_SECTIONS; `admin` is excluded by D-PERM7. See the header for why this
  -- column is constrained where 0298's `surface_key` deliberately is not.
  section    text        not null check (section in (
                           'fuel', 'dispatch', 'safety', 'hazmat', 'roster', 'equipment',
                           'recruitment', 'settings', 'accounting', 'billing', 'maintenance'
                         )),
  -- Mirrors `SectionAccess` in packages/shared/src/auth.ts. 'none' is a real, storable value: a
  -- person narrowed below their role's access must be a row, because absence already means
  -- "unchanged".
  access     text        not null check (access in ('none', 'view', 'manage')),
  updated_at timestamptz not null default now(),
  -- Nullable so a future backfill or a support action is not forced to invent an actor; the audit
  -- row written beside every change is the record of record.
  updated_by uuid        references auth.users(id) on delete set null,
  primary key (org_id, user_id, section),
  foreign key (org_id, user_id) references memberships (org_id, user_id) on delete cascade
);

alter table user_section_access enable row level security;

-- READ is org-wide, on 0291's argument: every member already holds the shipped matrix in the web
-- bundle they download, so this org's overrides of it are not a secret from them, and the
-- permissions page shows a member what their own access is.
drop policy if exists user_section_access_read on user_section_access;
create policy user_section_access_read on user_section_access for select
  using (org_id = auth_org_id());

-- NO write policy, deliberately: PostgREST cannot write this table at all. Changing what a person
-- may reach in the DATA is the single most audit-worthy act in this programme, and the API is the
-- only path that writes an audit row. 0291, 0296 and 0298 all made this arrangement.

-- A row cannot be walked into another tenant by an update (0161's invariant, applied here too).
drop trigger if exists trg_user_section_access_org_immutable on user_section_access;
create trigger trg_user_section_access_org_immutable
  before update on user_section_access
  for each row execute function forbid_org_change();

drop trigger if exists trg_user_section_access_updated on user_section_access;
create trigger trg_user_section_access_updated
  before update on user_section_access
  for each row execute function set_updated_at();

comment on table user_section_access is
  'Per-MEMBER overrides of the role x section matrix, merged OVER org_section_access at token mint
   (D-PERM4/D-SURF7). SPARSE: no row = the role''s answer, not denied. The `admin` section is
   unstorable (D-PERM7) and the admin/driver ROLE lock lives in custom_access_token_hook and in the
   API, because a user-keyed row cannot know its member''s role. Service-role writes only.';

-- ── The hook, with one more sparse read merged over the org's ───────────────────────────────────
-- 0292's body verbatim except for the `v_user_sections` block and the `||` that merges it. The
-- membership lookup, the defensive `order by created_at asc limit 1` for the one-org-per-user
-- invariant (audit M1), and the two locks are unchanged — this migration is not the place to revisit
-- any of them.
--
-- ⚠ `jsonb_object_agg` over an empty set returns NULL, not `'{}'`, which is why each half is guarded
-- rather than merged blind: `'{"fuel":"none"}'::jsonb || null` is NULL in Postgres, and a NULL
-- written into `{sections}` would erase the org's answer instead of leaving it alone. That is the
-- three-valued-logic trap 0292 already paid for once in `auth_section_view` (a bare
-- `using (auth_section_view('fuel'))` would have denied every token in existence); the shape here is
-- different but the lesson is the same, so the merge is written out rather than made clever.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims          jsonb;
  v_org           uuid;
  v_role          text;
  v_sections      jsonb;
  v_user_sections jsonb;
begin
  -- A user belongs to exactly one org in v1 (audit M1); pick the earliest membership defensively.
  select m.org_id, m.role::text
    into v_org, v_role
  from public.memberships m
  where m.user_id = (event->>'user_id')::uuid
  order by m.created_at asc
  limit 1;

  claims := coalesce(event->'claims', '{}'::jsonb);

  if v_org is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(v_org::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));

    -- The sparse delta for THIS user's role in THIS org, then the one for THIS PERSON. `admin` and
    -- `driver` can never match, and the `admin` section can never be returned, whatever rows exist.
    if v_role not in ('admin', 'driver') then
      select jsonb_object_agg(a.section, a.access)
        into v_sections
      from public.org_section_access a
      where a.org_id = v_org
        and a.role = v_role
        and a.section <> 'admin';

      select jsonb_object_agg(u.section, u.access)
        into v_user_sections
      from public.user_section_access u
      where u.org_id = v_org
        and u.user_id = (event->>'user_id')::uuid
        and u.section <> 'admin';

      -- The person's answers win over their role's (D-SURF6); either half alone is used as it is.
      if v_sections is not null and v_user_sections is not null then
        v_sections := v_sections || v_user_sections;
      elsif v_user_sections is not null then
        v_sections := v_user_sections;
      end if;

      if v_sections is not null then
        claims := jsonb_set(claims, '{sections}', v_sections);
      end if;
    end if;
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- The hook is SECURITY DEFINER, so it reads the table regardless; this mirrors what 0292 did for
-- `org_section_access` and 0006 for `memberships`, so all three reads have the same posture.
grant select on public.user_section_access to supabase_auth_admin;
drop policy if exists user_section_access_auth_admin_read on public.user_section_access;
create policy user_section_access_auth_admin_read on public.user_section_access
  for select to supabase_auth_admin using (true);
