# Handoff 2026-09-30: SP1 (Settings as permissions) is part-built and uncommitted

Repo: ~/Projects/FuelGuard (Silvicom 360). Read CLAUDE.md first, then:
- `docs/plans/permissions/SETTINGS-PERMISSIONS-PLAN.md`, **on main since #1138 (`90059d7`)**. The rulings
  Q-SET1 (a), Q-SET2 (a) and Q-SET3 (a) are recorded in §5 and in §6's log.
- `docs/plans/permissions/HANDOFF-2026-09-30-SETTINGS-PERMISSIONS.md`: the whole SP1–SP5 queue and the
  working rules (worktrees, gates, tests, mutation proofs, UI checks, merge flow). **Those rules still apply.**
- memory: settings-permissions-position.md, surface-entitlements-position.md.

## State
- Main is `90059d7` (#1138 merged, docs only). Nobody checked `/api/version` after that merge. Both services
  were at `37f5c86` before it.
- **SP1 is in worktree `../FuelGuard-sp1`, branch `claude/settings-permissions-sp1`, based on `37f5c86`.
  Nothing is committed or pushed.** Rebase onto origin/main before pushing. #1138 only touched the plan
  doc, so the rebase should be clean.
- Production (read 2026-09-30): there are 4 stored screen answers (`fleet.odometer` ×2, `fuel.exceptions`,
  `dispatch.loads`) and 1 section answer (dispatcher `fuel: none`). **None names an `admin.*` key**, so the
  key split reinterprets nothing.

## Design, as built
- **`reachedFrom?: string`** on `Surface` (`packages/shared/src/surfaces.ts`). The screen is its own permission,
  out of the sidebar, and reached from a directory. It replaces `parent: "admin.settings"`, because a
  `parent` shares its parent's permission (D-SURF8). `NAV_SURFACES` now leaves out both `parent` and
  `reachedFrom` screens.
- **`startsOnFor?: readonly UserRole[]`**: Q-SET2's starting default. It lists the roles the screen starts
  ON for; every other editable role starts off. It lists who starts on, not who starts off, so a role added
  to `USER_ROLES` later starts without the screen. `admin` and `driver` are never subject to it (nobody
  can answer for them).
- **`surfaceStartsOn(s, role)`**. `surfaceAllowed` now ends
  `surfaces?.[key] ?? surfaceStartsOn(s, role)` instead of `?? true`. So the `{}` fail-open in
  `surfaceClaimFor` still leaves such a screen off.
- **`surfaceCatalogue.ts`** exports:
  - `GRANTABLE_SURFACES`: section gate and no parent. The contract's `answerableSurfaceKey`, the API's
    `KNOWN_KEYS` and `EDITABLE_CATALOGUE` all read it.
  - `ADMIN_ONLY_SURFACES`: worked out from the `ADMIN` gate. It is Users, Permissions, Card control and EFS.
  - `directoryScreens(key)`.
- **The 16 Settings-directory screens** (the block after the "non-nav screens" comment). New keys:
  - Starting off for everyone but the admin: `admin.settings.org`, `.notifications`, `.thresholds`,
    `.driver-performance` (all `manage("settings")`) and `.fuel-planning` (`manage("dispatch")`), each
    with `startsOnFor: []`.
  - `admin.settings.audit`: `section("settings")` with `startsOnFor: ["auditor"]`.
  - Admin gate: `.permissions`, `.efs`, `.card-control`.
  - Kept keys: `admin.settings.data`, `admin.settings.driver-app`, `admin.recruiting` and the four
    reports keys.
  - `admin.users` stays a sidebar entry.
- **API** (`surfaceAccess.ts`):
  - A role-level PUT stores a row only when `allowed !== surfaceStartsOn(...)`. Turning on a screen that
    starts off stores `true`; answering with the starting value deletes the row. The audit record's
    `resetToDefault` means `allowed === startsOn`.
  - `EDITABLE_CATALOGUE` also sends `reachedFrom` and `startsOnFor`.
- **Bug fixed:** `requireSurface.ts` called `surfaceClaimFor(admin, orgId, role)` without the user id, so
  per-person answers never reached the API. It now passes `req.auth.userId`. New test:
  `apps/api/src/middleware/requireSurface.test.ts`.
- **Web:**
  - Routes: `requiresAdmin` is removed from org, notifications, thresholds, driver-performance and
    fuel-planning. `requiresAuditAccess` is removed from `/settings/audit` and from the guard and the
    `RouteMeta` type. The route snapshot lost exactly those 6 lines.
  - `apps/web/src/lib/settingsCards.ts` (new) holds each card's key, icon, description and block ("config"
    or "reports"). `SettingsPage.vue` shows a card exactly when `surfaceAllowed(...)` allows it, and takes
    the label and path from the catalogue. The card order is unchanged.
  - `routeReachability.test.ts` counts the card paths as linked.
  - Permissions page:
    - `SurfaceCatalogueEntry` gains `reachedFrom` and `startsOnFor`.
    - `layers.ts`: `surfaceCell(role, user, startsOn = true)` and `entryStartsOn(entry, role)`.
    - `rows.ts` `groupScreens` adds one group per directory after its sidebar group, labelled with the
      directory's name ("Settings").
    - RolesTab's cell default, reset and resetRole use `startsOn`.
    - PeopleTab's cell and its "Follow role (...)" label use `startsOn`.
- **`scripts/check-surfaces.mjs`:**
  - The parser reads `reachedFrom` and `startsOnFor`.
  - `navKeys` leaves out `reachedFrom` screens.
  - 4 new checks: a `reachedFrom` target that isn't a sidebar screen; `parent` and `reachedFrom`
    together; `startsOnFor` on a child or a non-section gate; `startsOnFor` naming a role that doesn't exist.
  - The 9 `/settings/*` waivers are gone; only `/use-the-app` is left.
  - The stale-waiver self-test uses `authRoutes: ["/real"]`.
  - "all twenty-four detectors fire".

## Verified so far (in the worktree)
- `pnpm typecheck`: all packages pass.
- `node scripts/check-surfaces.mjs --self-test` passes, and the gate itself passes (67 surfaces: 33 sidebar,
  16 directory, 18 detail).
- Shared: the new `packages/shared/src/settingsSurfaces.test.ts` passes (17 tests). For every office role it
  checks each Settings screen against the route gate before SP1 (the `BEFORE` table), plus the Q-SET1 list
  and the no-escalation cases.
- API: `surfaceAccess.test.ts` passes (39 tests, 3 of them new) and `requireSurface.test.ts` passes (3).
- Web: `src/router/**` and `SettingsPage.test.ts` pass (70 tests). `SettingsPage.test.ts` was rewritten to
  check, for every role, exactly the cards that role saw before, in the same order, plus the card-for-every-
  screen check.

## Left to do for SP1
1. **`apps/web/src/pages/SettingsPermissionsPage.test.ts`:**
   - Its `catalogue` fixture (around line 47) still uses `NAV_SURFACES.filter(isEditableSurface)` without
     the new fields. Build it the way the API does:
     `GRANTABLE_SURFACES.map(s => ({ …, reachedFrom: s.reachedFrom ?? null, startsOnFor: s.startsOnFor ? [...s.startsOnFor] : null }))`.
   - Then run it. Existing tests will likely need adjusting: the text "Not listed: …" can now include
     "Settings", and a technician has no settings section, so that group is unlisted for them.
   - Add tests:
     - Roles tab: a fleet manager's "Organization" switch is off with no tag; clicking it sends
       `allowed: true`; its "Reset" sends `allowed: false`. The auditor's Audit log starts on.
     - The "Settings" group heading renders.
     - People tab: "Follow role (Hidden)" for a screen that starts off.
     - A dispatcher sees Planned fueling (`dispatch: manage`) as an off switch, not "Needs …".
2. **Check the surface-access API test** (`surfaceAccessRouter` "sends the catalogue alongside"). It still
   passes, but make sure `admin.settings.*` screens with a section gate are expected.
3. **Run the full suites:** shared, api, web (`CI=true`), all `lint:*` gates from ci.yml (the zsh loop in the
   first handoff), `pnpm --filter ./apps/web lint:tokens`, `pnpm lint`. Watch `lint:filesize`:
   `surfaceCatalogue.ts` is 416 lines (warns at 450) and `surfaces.ts` is 240.
   `lint:comment-claims`: any "pinned by" comment must quote a real test title.
4. **Mutation proofs** (a script that restores the bytes and checks the hash). Worth doing:
   - Change `?? surfaceStartsOn(...)` back to `?? true`.
   - Drop `startsOnFor: ["auditor"]`.
   - Make `allowed !== startsOn` into `!allowed`.
   - Remove the user id in `requireSurface`.
   - Remove `reachedFrom` from the `NAV_SURFACES` filter.
   - Make `entryStartsOn` return `true`.
   - Remove the `groupScreens` directory loop.
5. **Look at the UI:** a `VITE_DEV_BYPASS=true` build plus `vite preview`, driven with Playwright from
   `apps/web`. Stub `**/api/**` first with a catch-all and answer with raw JSON. Screenshot:
   - the Settings directory as admin, fleet_manager and auditor;
   - the Permissions Roles tab for fleet_manager (the Settings group, Organization off);
   - the People tab.
6. **Plan log:** add a dated SP1 line at the END of §6. Don't edit §3.
7. **Commit and ship:** one narrative sentence, the Co-Authored-By trailer, then PR, CI green, and
   `gh pr merge N --merge`. Poll `/api/version` on both services until they show the merge commit. Then
   remove the worktree and update the memory file.

## Notes for SP2 onward (learned while building SP1)
- Only Data & sync still checks `session.admin`/`can` inside a Settings page (DataSyncPage.vue lines
  ~267–458: three `session.admin` buttons and a `session.admin` card). These are SP2/SP5 material.
  Once a fleet manager is granted Data & sync, those admin-only controls remain a role test. Record it or
  fix it in SP5.
- A screen that starts off is only closed at the router and the card until SP2. Its API writes (and RLS
  direct writes) still use today's admin-only gates, so nothing widens in SP1. But **granting Organization
  to a fleet manager in SP1 opens a page whose save is refused** by `organizations_update` (admin-only RLS)
  until SP2 ships. Mention this in the SP1 PR description.
- New `requireSurface(key)` calls in SP2 now apply per-person answers correctly (fixed in SP1).
