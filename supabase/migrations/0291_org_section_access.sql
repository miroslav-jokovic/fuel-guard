-- 0291 — org_section_access: the per-org overrides that make the permission matrix editable.
--
-- D-PERM1/4/7/8, docs/plans/permissions/EDITABLE-PERMISSIONS-PLAN.md step P1. Owner ruling
-- 2026-09-02, from the report "we dont have permissions page where we can set permissions for users".
-- The argument lives in the plan; this file is only the part the database has to be told.
--
-- ── A SPARSE DELTA, NOT A MATRIX (D-PERM4) ──────────────────────────────────────────────────────
-- A row here means "this org has overridden this role's access to this section". A role × section
-- pair with NO row is not denied — it is unchanged, and its answer is the shipped default.
--
-- That is why there is no `role_section_defaults` table beside this one, and the reasoning is worth
-- keeping because the obvious design has it. A complete matrix would need the database to know the
-- defaults, which means seeding them from `packages/shared/src/auth.ts`, which means codegen and a
-- drift gate to keep the copy equal to the original. Every consumer already holds the defaults in
-- the form it uses: the API and the web hold `SECTION_ACCESS` at compile time, and SQL holds them as
-- the `auth_role() = ANY (ARRAY[...])` list already written into each policy — lists that
-- `lint:section-policies` (D-SEP10) has checked against that same matrix since 0260. Storing them
-- again would be a second home for a fact, which is the failure the no-workarounds rule names.
--
-- The consequence that makes this safe: a token minted before P2 ships carries no `sections` claim,
-- so every policy takes its default branch and behaves exactly as it does today. There is no window
-- in which a live session loses access to anything.
--
-- ── WHAT THE CHECKS ENFORCE, AND WHY THEY ARE HERE RATHER THAN ONLY IN THE ENDPOINT ─────────────
-- D-PERM7 and D-PERM8 are security boundaries, and a boundary stated only in the service that
-- happens to write today is a boundary the next writer does not know about:
--
--   · `section <> 'admin'` — the `admin` SECTION carries user management. Granting it to another
--     role is a privilege-escalation path the product does not have today, and an editable matrix
--     must not invent one. An org that wants a second administrator promotes a member to the
--     `admin` ROLE on the Users page, which is audited and already exists.
--   · `role not in ('admin','driver')` — the `admin` ROLE holds `manage` everywhere permanently, so
--     an org that edits itself into a corner always has a way back. The `driver` ROLE is locked
--     because `router/index.ts` redirects drivers to the app before any section check runs: a
--     section granted to a driver would be a permission that visibly does nothing.
--
-- The vocabularies are pinned as literals rather than derived, because SQL cannot read the TypeScript
-- constant. `lint:section-policies` is what keeps them honest; a section added to APP_SECTIONS
-- without a matching migration here is caught there.
--
-- Rollback: drop table public.org_section_access;

create table if not exists org_section_access (
  org_id     uuid        not null references organizations(id) on delete cascade,
  -- The role whose access is being changed. 7 of the 9 in USER_ROLES — see the header for the two
  -- exclusions, both of which are rulings rather than omissions.
  role       text        not null check (role in (
                           'fleet_manager', 'dispatcher', 'safety_manager', 'auditor',
                           'recruiter', 'accountant', 'technician'
                         )),
  -- 11 of the 12 in APP_SECTIONS; `admin` is excluded by D-PERM7.
  section    text        not null check (section in (
                           'fuel', 'dispatch', 'safety', 'hazmat', 'roster', 'equipment',
                           'recruitment', 'settings', 'accounting', 'billing', 'maintenance'
                         )),
  -- Mirrors `SectionAccess` in packages/shared/src/auth.ts. 'none' is a real, storable value: an org
  -- narrowing a role below its default is the common case, and it must be a row rather than the
  -- absence of one, because absence already means "unchanged".
  access     text        not null check (access in ('none', 'view', 'manage')),
  updated_at timestamptz not null default now(),
  -- Who last changed it. Nullable so a future backfill or a support action is not forced to invent
  -- an actor; the audit row written beside every change is the record of record.
  updated_by uuid        references auth.users(id) on delete set null,
  primary key (org_id, role, section)
);

alter table org_section_access enable row level security;

-- READ is org-wide on purpose. Every member of an org may already see the shipped matrix — it is
-- compiled into the web bundle they download — so the overrides are not a secret from them, and the
-- permissions page shows a member what their own access is.
drop policy if exists org_section_access_read on org_section_access;
create policy org_section_access_read on org_section_access for select
  using (org_id = auth_org_id());

-- NO write policy, deliberately: PostgREST cannot write this table at all. Changing what a role may
-- do is exactly the kind of act that must carry an audit row, and the API is the only path that
-- writes one. This is 0235's arrangement for `archived_at` read the same way — one path in, so the
-- rule exists in one place instead of two that can disagree.

-- A row cannot be walked into another tenant by an update (0161's invariant, applied here too).
drop trigger if exists trg_org_section_access_org_immutable on org_section_access;
create trigger trg_org_section_access_org_immutable
  before update on org_section_access
  for each row execute function forbid_org_change();

comment on table org_section_access is
  'Per-org overrides of the shipped role x section matrix (D-PERM1). SPARSE: no row = shipped default, not denied.';
