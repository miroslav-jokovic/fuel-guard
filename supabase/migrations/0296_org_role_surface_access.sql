-- 0296 — org_role_surface_access: the per-org, per-role answer to "may this role open this screen".
--
-- D-SURF1/D-SURF2/D-SURF6, docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md step S3, part 1 of 2.
-- Owner ruling 2026-09-02, from "we should then have option for custom setup for each user … For
-- example Technician shop should see only annual inspection page and nothing else."
--
-- ── WHY A SECOND PERMISSION TABLE, WHEN 0291 ALREADY EXISTS ────────────────────────────────────
-- `org_section_access` answers which ROWS a role may touch. This answers which SCREENS it may reach.
-- They are different questions and the codebase measured the difference rather than assuming it:
-- `NewInspectionDrawer.vue:76` — a component of the Annual Inspections page — reads
-- `GET /api/maintenance/inspectors` to fill its inspector picker, and `inspections.ts:146` refuses a
-- submission without a qualified inspector. So the owner's example, "the technician sees Annual
-- Inspections but not Inspectors", is self-defeating as a DATA rule (revoke the rows and the page
-- you meant to keep stops working) and exactly right as a SCREEN rule.
--
-- Hence two vocabularies: `section` for rows, enforced here in RLS and in the API; `surface` for
-- screens, enforced at the router and at the endpoints only one screen uses. A surface can only ever
-- NARROW within its section (D-SURF2), which is what stops the screen layer becoming a place to
-- grant data the section refuses.
--
-- ── SPARSE, FOR 0291'S REASON ──────────────────────────────────────────────────────────────────
-- A row means "this org has answered for this role and this screen". No row is not a denial — it is
-- UNCHANGED, and the answer is the surface's own gate in `packages/shared/src/surfaces.ts`. That is
-- why an org that never opens the permissions page keeps behaving exactly as it does today, and why
-- there is no `role_surface_defaults` table beside this one: the defaults already have a home, and a
-- second copy is the failure D-SURF3 names.
--
-- ── WHY `surface_key` HAS NO CHECK CONSTRAINT, UNLIKE 0291's `section` ─────────────────────────
-- 0291 pinned its section list as a literal because D-PERM7 is a SECURITY boundary — the `admin`
-- section must be unstorable, so that a bad row cannot become authority. There is no equivalent here.
-- Storing an unknown `surface_key` grants nothing and denies nothing: the resolver looks a key up in
-- the catalogue, and one that is not there matches no screen. Pinning all 52 keys instead would mean
-- a migration every time the product gains a page — a cost paid for ever, to constrain a column whose
-- wrong values are inert. The API is the only writer and it validates against `SURFACES`.
--
-- The two locks that ARE security boundaries are pinned, exactly as 0291 pinned them:
--
--   · `role not in ('admin','driver')` — D-PERM7/D-PERM8. The `admin` role keeps every screen so an
--     org can always dig itself out of a configuration it regrets, and the `driver` role is locked
--     because `router/index.ts` redirects drivers to the app before any surface check runs.
--
-- `allowed` is a boolean rather than the presence of a row, and it is worth saying why, since
-- D-SURF2 means an org can only narrow. A `true` row is not a widening: a surface's gate is checked
-- FIRST and an allow cannot lift a role past the section it lacks, so `true` is inert at this layer.
-- It exists because S4 needs it one layer up — an org that denies a screen to `technician` and then
-- wants ONE technician to keep it writes `allowed = true` against that user, over this row.
--
-- ── NO READER IN THIS MIGRATION, AND THAT IS THE POINT (D-SURF9) ───────────────────────────────
-- `lint:migration-ordering` exempts a new table because "its readers are new code paths — during the
-- window a feature nobody is using yet" fails harmlessly. That reasoning does NOT cover this table's
-- reader: `/api/me` is fetched on every page load, so code deployed at ~3 minutes against a table
-- created at ~12 would break bootstrap for the whole org for nine minutes. The gate will not ask for
-- the split; the plan does. Part 2 adds the reader.
--
-- Rollback: drop table public.org_role_surface_access;

create table if not exists org_role_surface_access (
  org_id      uuid        not null references organizations(id) on delete cascade,
  -- 7 of the 9 in USER_ROLES; the two exclusions are the rulings above, not omissions.
  role        text        not null check (role in (
                            'fleet_manager', 'dispatcher', 'safety_manager', 'auditor',
                            'recruiter', 'accountant', 'technician'
                          )),
  -- A `Surface.key` from packages/shared/src/surfaces.ts — "maintenance.inspectors". Deliberately
  -- unconstrained; see the header for why a literal list here would be a migration per page.
  surface_key text        not null check (length(btrim(surface_key)) > 0),
  -- false = this org has taken the screen away from this role. true = it has given it back, which
  -- matters only as the row S4's per-user layer overrides.
  allowed     boolean     not null,
  updated_at  timestamptz not null default now(),
  -- Nullable so a future backfill or a support action is not forced to invent an actor; the audit
  -- row written beside every change is the record of record.
  updated_by  uuid        references auth.users(id) on delete set null,
  primary key (org_id, role, surface_key)
);

alter table org_role_surface_access enable row level security;

-- READ is org-wide, on 0291's argument: every member already downloads the shipped catalogue in the
-- web bundle, so the org's overrides of it are not a secret from them, and the permissions page shows
-- a member what their own access is.
drop policy if exists org_role_surface_access_read on org_role_surface_access;
create policy org_role_surface_access_read on org_role_surface_access for select
  using (org_id = auth_org_id());

-- NO write policy, deliberately: PostgREST cannot write this table at all. Changing what a role may
-- reach must carry an audit row, and the API is the only path that writes one. 0291 made the same
-- arrangement for the same reason.

-- A row cannot be walked into another tenant by an update (0161's invariant, applied here too).
drop trigger if exists trg_org_role_surface_access_org_immutable on org_role_surface_access;
create trigger trg_org_role_surface_access_org_immutable
  before update on org_role_surface_access
  for each row execute function forbid_org_change();

drop trigger if exists trg_org_role_surface_access_updated on org_role_surface_access;
create trigger trg_org_role_surface_access_updated
  before update on org_role_surface_access
  for each row execute function set_updated_at();

comment on table org_role_surface_access is
  'Per-org overrides of which SCREENS a role may reach (D-SURF1). SPARSE: no row = the surface''s own
   gate in packages/shared/src/surfaces.ts, not denied. Narrows only — a surface can never reach past
   the section it belongs to (D-SURF2). Service-role writes only, so every change carries an audit row.';
