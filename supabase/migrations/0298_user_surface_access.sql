-- 0298 — user_surface_access: the per-PERSON answer to "may this member open this screen".
--
-- D-SURF6/D-SURF7, docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md step S4. The owner's request
-- was two sentences and this is the second one: "we should have default setups for each role, but we
-- should then have option for custom setup for each user … For example Technician shop should see
-- only annual inspection page and nothing else." 0296 answered the first half — an org can take a
-- screen away from a ROLE. This one answers the half that names a person.
--
-- ── THE THIRD LAYER OF ONE CHAIN, NOT A SECOND MECHANISM ───────────────────────────────────────
--
--     the surface's own gate  →  org_role_surface_access (0296)  →  user_surface_access (here)
--
-- Sparse at every layer, exactly as D-SURF6 defines and for D-PERM4's reason: a row is the answer, no
-- row is UNCHANGED — never a denial. A member with no rows behaves precisely as their role does, so
-- an org that never opens the permissions page is unaffected by this table existing.
--
-- ── THIS IS THE TABLE THAT EARNS 0296's `allowed` BOOLEAN ──────────────────────────────────────
-- At the role layer a `true` row is inert: the surface's own gate is checked FIRST, so an allow can
-- never lift a role past a section it lacks (D-SURF2), and `surfaceAccess.ts` therefore DELETES the
-- row rather than storing `true`. Here both values are load-bearing and neither is a reset:
--
--   · `allowed = false` — this member loses a screen their role keeps. The owner's example: every
--     other technician keeps Repair spend, this one does not.
--   · `allowed = true`  — this member keeps a screen their role has lost. An org denies Inspectors
--     to `technician` and then wants ONE technician, the shop lead, to keep it.
--
-- So "reset to default" cannot be expressed as a value at this layer; it is the ABSENCE of a row,
-- and the API's write endpoint takes `allowed: null` to mean "delete it". A three-valued write
-- against a two-valued column is unusual enough to be worth stating here, because a reader who
-- assumes 0296's delete-on-true convention holds would delete the wrong half of this table.
--
-- ── WHY THE ROLE LOCKS ARE *NOT* A CHECK CONSTRAINT HERE, UNLIKE 0296 ──────────────────────────
-- ⚠ This is the one real difference from 0296 and a reader comparing the two files WILL notice it,
-- so it is written down rather than left as a gap.
--
-- 0296 pins `role not in ('admin','driver')` in SQL, and that lock is a security boundary
-- (D-PERM7/D-PERM8): the `admin` role keeps every screen so an org can always dig itself out of a
-- configuration it regrets, and the `driver` role is locked because `router/index.ts` sends drivers
-- to the app before any surface check runs. This table is keyed by `user_id`, and **a row does not
-- know the user's role** — a person's role lives in `memberships` and can change after the row is
-- written. A CHECK cannot read another table, and a trigger that did would be enforcing a rule that
-- goes stale the moment somebody is promoted.
--
-- The lock is therefore enforced in the two places that CAN see the current role, and both are
-- required rather than one being a fallback:
--
--   · the WRITE — `surfaceAccess.ts` looks the member's `memberships.role` up in the caller's org
--     and refuses a write against `admin` or `driver`, so a row for a locked role is never created;
--   · the READ — `surfaceClaimFor` returns `{}` for a non-editable role BEFORE it reads either
--     table, so a row that exists anyway (a restore, a support action, a future writer) grants and
--     denies nothing. That check already stands first in the function and must stay there.
--
-- What SQL CAN enforce, it does: the composite foreign key below makes "this override belongs to a
-- member of this org" a database fact rather than an endpoint's good manners, and it is why there is
-- no separate `references organizations(id)` — deleting the org cascades through `memberships` to
-- here, and removing a member takes their overrides with them, which is the behaviour you want and
-- would otherwise have to remember to write.
--
-- ── NO CHECK ON `surface_key`, FOR 0296's REASON, WHICH HAS NOT CHANGED ────────────────────────
-- An unknown key grants nothing and denies nothing: the resolver looks it up in the catalogue
-- (`packages/shared/src/surfaces.ts`) and finds no screen, and `toSurfaceOverrides` drops it. Pinning
-- all 52 keys would mean a migration every time the product gains a page, paid for ever, to
-- constrain a column whose wrong values are inert. The API is the only writer and it validates
-- against `SURFACES`.
--
-- ── THE READER SHIPS IN THIS SAME MERGE, AND THAT IS A DEVIATION FROM D-SURF9 ──────────────────
-- ⚠ The plan says S4 splits in two merges — table first, reader second — because `/api/me` is
-- fetched on every page load and `docs/MIGRATION-DISCIPLINE.md` §the-deploy-window measures ~9
-- minutes between a merge being SERVED and its migration being APPLIED. That reasoning was written
-- before S3b shipped, and S3b makes it moot: `surfaceClaimFor` returns `{}` on ANY query error and
-- `app.ts` wraps the whole call in try/catch, so for those nine minutes the user layer simply does
-- not apply — a missing table IS a query error — and then it does. No bootstrap breaks, because the
-- fail-open already covers exactly the failure D-SURF9 exists to prevent.
--
-- That is a property, not a hope, and the PR relying on it extends the test that pins it: "returns
-- the role's answers unchanged when the USER table cannot be read" in
-- `apps/api/src/modules/org/routes/surfaceAccess.test.ts`, beside the older "returns no denials when
-- the table cannot be read, rather than denying everything". D-SURF9 still holds for a reader with
-- no such fallback; it is disapplied here because the fallback exists and is tested, and this
-- paragraph is the record of that decision rather than a rule quietly skipped.
--
-- Rollback: drop table public.user_surface_access;

create table if not exists user_surface_access (
  org_id      uuid        not null,
  -- The member whose screens are being changed. Composite FK below, not a plain auth.users
  -- reference: an override for somebody who is not in this org would be a row that can never apply.
  user_id     uuid        not null,
  -- A `Surface.key` from packages/shared/src/surfaces.ts — "maintenance.inspectors". Deliberately
  -- unconstrained; see the header for why a literal list here would be a migration per page.
  surface_key text        not null check (length(btrim(surface_key)) > 0),
  -- BOTH values are answers here, and neither is a reset — see the header. false = this member loses
  -- a screen their role keeps; true = this member keeps a screen their role has lost.
  allowed     boolean     not null,
  updated_at  timestamptz not null default now(),
  -- Nullable so a future backfill or a support action is not forced to invent an actor; the audit
  -- row written beside every change is the record of record.
  updated_by  uuid        references auth.users(id) on delete set null,
  primary key (org_id, user_id, surface_key),
  -- `memberships` carries UNIQUE (org_id, user_id), which is what makes this reference legal. It
  -- buys three things at once: an override cannot name a non-member, deleting the org cascades here
  -- through the membership, and removing a member takes their overrides with them.
  foreign key (org_id, user_id) references memberships (org_id, user_id) on delete cascade
);

alter table user_surface_access enable row level security;

-- READ is org-wide, on 0291's and 0296's argument: every member already downloads the shipped
-- catalogue in the web bundle, so this org's overrides of it are not a secret from them, and the
-- permissions page shows a member what their own access is.
drop policy if exists user_surface_access_read on user_surface_access;
create policy user_surface_access_read on user_surface_access for select
  using (org_id = auth_org_id());

-- NO write policy, deliberately: PostgREST cannot write this table at all. Changing what a PERSON
-- may reach is the most audit-worthy act in this programme, and the API is the only path that writes
-- an audit row. 0291 and 0296 made the same arrangement for the same reason.

-- A row cannot be walked into another tenant by an update (0161's invariant, applied here too).
drop trigger if exists trg_user_surface_access_org_immutable on user_surface_access;
create trigger trg_user_surface_access_org_immutable
  before update on user_surface_access
  for each row execute function forbid_org_change();

drop trigger if exists trg_user_surface_access_updated on user_surface_access;
create trigger trg_user_surface_access_updated
  before update on user_surface_access
  for each row execute function set_updated_at();

comment on table user_surface_access is
  'Per-MEMBER overrides of which SCREENS they may reach, resolved OVER org_role_surface_access
   (D-SURF6/D-SURF7). SPARSE: no row = whatever the role''s answer was, not denied. Unlike the role
   layer, `allowed = true` is a real answer here — it is how one member keeps a screen their role has
   lost. Narrows only within the section (D-SURF2). Service-role writes only, so every change carries
   an audit row. The admin/driver locks cannot be a CHECK on a user-keyed table and live in the API''s
   write path and in surfaceClaimFor; see this migration''s header.';
