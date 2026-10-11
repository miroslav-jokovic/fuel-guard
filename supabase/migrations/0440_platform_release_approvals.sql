-- Silvicom 360 — 0440 platform_release_approvals: the owner's go signal for tonight's release, given
-- in the console. RELEASE-TRAIN-PLAN D-REL14 (owner, 2026-10-08).
--
-- D-REL5 made a GitHub review on the `main → production` release PR the only go signal. On 10/08 the
-- night shipped nothing because nobody opened GitHub before bed. The console's Settings now offers
-- the same approval, and this table is where it lands: one row per approval, pinned to the commit
-- the release notes describe, never to main's moving head — what the owner read is what ships.
--
-- A withdrawal is a stamp, not a DELETE: "who said yes to this release, and who took it back, when"
-- is the first question after a bad night, and the platform audit trail records both acts besides.
--
-- Reader: .github/workflows/release.yml (scripts/release-train.mjs `console-approval`), from GitHub
-- Actions through Supabase's management API, joined to platform_admins so an approval counts only
-- while its approver is still an active platform_owner. Writer: apps/admin-api (lib/releaseApproval.ts).

create table if not exists platform_release_approvals (
  id            uuid primary key default gen_random_uuid(),
  -- The release PR (main → production) the approval answers. Its number, not its title: the
  -- 18:00 refresh rewrites the title and body of the same PR every evening it stays open.
  pr_number     integer not null check (pr_number > 0),
  -- The full commit, as release.yml compares it with `git merge-base --is-ancestor`. A short SHA
  -- could name two commits a year from now; the check refuses one.
  commit_sha    text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  approved_by   uuid references platform_admins(id) on delete set null,
  approved_at   timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references platform_admins(id) on delete set null,
  -- revoked_by may be null on a revoked row (that admin was later deleted), never set on a live one.
  check (revoked_by is null or revoked_at is not null)
);

-- release.yml's read: the newest live approval for one PR.
create index if not exists idx_platform_release_approvals_pr
  on platform_release_approvals (pr_number, approved_at desc) where revoked_at is null;

alter table platform_release_approvals enable row level security;
-- No client policies: only the service role (admin-api writes, the release workflow reads) reaches it,
-- like platform_admins (0070) and platform_alert_recipients (0427).

comment on table platform_release_approvals is
  'org: the owner''s console approval of a release PR (D-REL14). Written by admin-api; read by release.yml. Withdrawn by stamping revoked_at, never deleted.';
