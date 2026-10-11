Repo: ~/Projects/FuelGuard (Silvicom 360). Read CLAUDE.md first, then:
- docs/plans/permissions/SETTINGS-PERMISSIONS-PLAN.md (on branch `claude/settings-permissions`, PR #1138,
  docs only, CI green, NOT merged yet). Worktree: ../FuelGuard-perm.
- docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md: D-SURF2 (a screen only narrows within its
  section), D-SURF4 (surfaces are not in the JWT), D-SURF5 (`requireSurface` on endpoints only one
  screen uses), D-SURF8 (a child screen shares its parent's grant).
- docs/plans/permissions/EDITABLE-PERMISSIONS-PLAN.md: D-PERM7 (the `admin` section is never grantable),
  D-PERM8 (drivers are locked).
- memory: settings-permissions-position.md, surface-entitlements-position.md,
  editable-permissions-position.md.

## Where it stands (main `37f5c86`, 2026-09-30)
Both Railway services are at `37f5c86`. Highest migration is 0388. Merged 2026-09-29, all verified live:
- **#1136 G-10**: the road-test step shows, for each certificate, whether the driver has had their copy
  (downloaded from their link, or the office's new "Handed a paper copy" press, recorded as an audit row).
  §391.33 equivalency stays OFF (owner, Q-AW19).
- **#1137**: only the admin adds or retires a road-test examiner.
  `ROAD_TEST_EXAMINER_SECTION = "admin"` in `packages/shared/src/roadTestContract.ts`; the API,
  Settings → Recruiting's register and the road-test panel all read it.
- The owner set the counsel review package aside for now. Don't work on it.

## NEXT: Settings as permissions, as recommended
**Owner, 2026-09-30: "proceed as recommended". Q-SET1 (a), Q-SET2 (a) and Q-SET3 (a) are ruled:**
- **Q-SET1 (a):** Users, Permissions, Card control and EFS integration stay admin-only and are never
  offered to anyone. Everything else in Settings becomes grantable, Organization included.
- **Q-SET2 (a):** nobody gains or loses access on the day it ships. Every screen that is admin-only today
  starts "off" for every other role, and the admin turns it on per role or per person.
- **Q-SET3 (a):** the Audit log becomes a normal permission (`settings: view` plus its own screen)
  instead of a role check (admin + auditor).

**First:** record the three rulings in the plan (§5 as ruled, plus a dated line at the END of §6). Push
that to PR #1138, wait for CI to go green, then merge it (`gh pr merge 1138 --merge`). Then build the steps in
order, one PR each:
- **SP1 · catalogue + directory (shared + web, no migration, NO behaviour change).**
  - Each Settings screen gets its own surface key, where today every one is a child of `admin.settings`.
  - Add a per-screen "default off for these roles" in the catalogue (Q-SET2). Decide the shape by
    reading `surfaces.ts` `surfaceAllowed`: today a missing override means allowed, so "off by default"
    is a new default layer, and the per-role and per-person overrides must still be able to turn it on.
  - The ruled admin-only list becomes one named list (e.g. `ADMIN_ONLY_SURFACES`).
  - Remove `requiresAdmin` / `requiresAuditAccess` from every screen that becomes grantable, and drop
    their `UNCATALOGUED_WAIVERS` in `scripts/check-surfaces.mjs`.
  - Build the Settings directory's cards (`apps/web/src/pages/SettingsPage.vue`, today hand-written
    `session.admin` / `session.can(...)` expressions) from the catalogue.
  - The Permissions page's Screens tab must list the new rows in a "Settings" group.
  - Tests: for every role, each screen resolves exactly as it does today, driven by the shared matrix.
- **SP2 · API endpoints for the browser's direct writes (no migration).**
  - Today the browser writes `organizations` (Organization and Notifications), `anomaly_thresholds`,
    `driver_performance_settings`, `route_fuel_settings` and `fuel_discount_rules` straight to the database.
  - Replace each with an endpoint on `requireSection` + `requireSurface`, and switch the web to them.
  - Move the existing admin-only API gates (`requireSection("admin")` on thresholds, driver performance
    and discount rules) to section + surface.
  - ⚠ Planned fueling's table RLS says `dispatch` manage while its page says admin. The plan's target is
    `dispatch` manage + its own screen, starting off for everybody but the admin per Q-SET2.
- **SP3 · migration, its OWN merge after SP2 is live in production:** drop the client write policies
  `organizations_update`, `thresholds_write`, `dps_write`, `route_fuel_settings_write` and
  `fuel_discount_write`. `anomaly_thresholds`' RESTRICTIVE driver-deny policies stay; they only narrow.
  Matrices assert each client write is now refused.
- **SP4 · Audit log through the API, then a migration.**
  - A `settings: view` + surface endpoint replaces the page's direct read of `audit_logs`.
  - After it is live, a migration narrows `audit_select` (today `auth_role() in ('admin','auditor')`,
    0004).
- **SP5 · three small defects:**
  - Data & sync's three `/api/transactions/*` buttons have no `v-if` and are gated on `fuel` manage.
  - The Driver App comments say `rolesThatManage("roster")`; the code is `requireSection("roster")`,
    and the per-driver overrides are gated on `dispatch`.
  - `GET /api/integrations/samsara/feed-pulse` (called by /coverage) has only `requireOrg`.

## Measured 2026-09-29 (production, read-only)
- Members: 7 admin, 3 dispatcher, 1 safety_manager, 1 technician, 1 driver. No fleet_manager, recruiter,
  auditor or accountant.
- `org_section_access` has 1 row and `org_role_surface_access` has 1 row. Read both before SP1: an
  existing row must keep meaning the same thing after the keys split.
- ⚠ A surface key is the key overrides are stored against. Renaming one resets every org's answer
  (`surfaceCatalogue.ts` header). Only ADD keys. Check whether the 1 stored surface row names
  `admin.settings`.

## Working rules (each one has bitten)
- **Worktrees:** one per PR, off origin/main: `git fetch && git worktree add ../FuelGuard-<topic> -b
  claude/<topic> origin/main`, then `pnpm install --frozen-lockfile`, then
  `pnpm --filter @silvicom/shared build:rn`, then copy `../FuelGuard/apps/{web,api}/.env` in. The main
  checkout is detached, so work only in worktrees. Remove the worktree once merged.
- **Gates (zsh):** `git add` first, then
  `for g in $(grep -oE 'pnpm (run )?lint:[a-z0-9-]+(:[a-z0-9-]+)?' .github/workflows/ci.yml | sed -E 's/pnpm (run )?//' | sort -u); do pnpm run -s $g || echo FAIL $g; done`,
  plus `pnpm --filter ./apps/web lint:tokens`, `pnpm lint` and `pnpm typecheck`. `lint:surfaces` checks
  the catalogue against the route snapshot, so read `scripts/check-surfaces.mjs` before SP1.
- **Tests:** shared, api, web (`CI=true`), plus the touched `supabase/tests/*.test.mjs` matrices.
  - Role cases put a role in the session from the shared matrix (`sectionAccess`), never a hand-written
    boolean (`SettingsRecruitingPage.test.ts` shows the idiom).
  - API tests use `postgrestFixture` with another org's rows present, and `expectOrgScoped`.
- **Prove tests by mutation** with a script that restores the bytes and checks the hash. A survivor is
  usually a fixture with no partial case (last session: a loading state nobody tested).
- **UI:** build with `VITE_DEV_BYPASS=true` (env from `apps/web/.env`), run `vite preview --port <fixed>`,
  and drive it with Playwright from `apps/web` (`npx tsx script.mts`). Stub `**/api/**` with a catch-all
  registered FIRST, and answer with raw JSON, not `{ok, data}`. Look at the screenshots.
- **Merge flow:** PR, CI green on the current head, then `gh pr merge N --merge`. After that, poll
  `/api/version` on `fleetguardapi-production.up.railway.app` and `fleetguardweb-production.up.railway.app`
  until both show the merge commit. A migration merge: check `pg_policies` in production
  (`supabase db query --linked`) before its follow-up ships.
- **Commits:** one descriptive sentence, the `git log` narrative style.
- **No workarounds:** no `role === "admin"` beside the matrix. If something can't be derived, stop and
  record it in the plan's §5 with a recommendation.

Start: confirm both services show `37f5c86`, read the plan and `surfaces.ts` / `surfaceCatalogue.ts`,
record the rulings in #1138, merge it, then build SP1.
