# Settings as permissions — plan and queue

**Owner's request, 2026-09-29:** *"we need to have proper permissions, Settings also need to be included
as permissions for all people and roles."* This plan makes every Settings screen a permission the admin
can give or take away, per role and per person, on the existing Permissions page. It builds on
`EDITABLE-PERMISSIONS-PLAN.md` (sections, D-PERM*) and `SURFACE-ENTITLEMENTS-PLAN.md` (screens,
D-SURF*), and adds no third permission system.

Status: **proposed, nothing built.** Owner questions are in §5.

---

## 1. What exists today (measured at `origin/main` `2bf5330`, 2026-09-29)

### 1.1 Production
- Members: 7 admin, 3 dispatcher, 1 safety_manager, 1 technician, 1 driver. No fleet_manager, recruiter,
  auditor or accountant.
- `org_section_access` holds 1 row and `org_role_surface_access` 1 row, so the Permissions page has been used.

### 1.2 The eighteen Settings screens, and what gates each one

| Screen | Web route | Settings card shows on | API writes gated on | Direct table writes (RLS) | On the Permissions page? |
|---|---|---|---|---|---|
| Users | `requiresAdmin` | `session.admin` | `requireRole("admin")` | — | No (`ADMIN` gate) |
| Permissions | `requiresAdmin` | `session.admin` | `requireRole("admin")` | — | No (waived) |
| Card control | `requiresAdmin` | `session.admin` | `requireRole("admin")` + step-up | — | No (waived) |
| EFS integration | `requiresAdmin` | `session.admin` | `requireRole("admin")` (+ step-up) | — | No (waived) |
| Organization | `requiresAdmin` | `session.admin` | — | `organizations_update`: `auth_role() = 'admin'` | No (waived) |
| Notifications | `requiresAdmin` | `session.admin` | — | same `organizations_update` | No (waived) |
| Anomaly thresholds | `requiresAdmin` | `session.admin` | `requireSection("admin")` | `thresholds_write`: `auth_role() = 'admin'` | No (waived) |
| Driver performance | `requiresAdmin` | `session.admin` | `requireSection("admin")` | `dps_write`: `auth_role() = 'admin'` | No (waived) |
| Planned fueling | `requiresAdmin` | `session.admin` | `requireSection("admin")` | `route_fuel_settings_write`: **dispatch manage** | No (waived) |
| Audit log | `requiresAuditAccess` | `admin \|\| readOnly` | — (read only) | `audit_select`: `auth_role() in (admin, auditor)` | No (waived) |
| Data & sync | surface `manage("settings")` | `can("settings")` | mixed: `settings`, `fuel`, `requireRole("admin")` | — | Only as part of Settings |
| Recruiting | surface `section("recruitment")` | `canView("recruitment")` | `recruitment` (examiners: `admin`, #1137) | — | Only as part of Settings |
| Driver App | surface `manage("roster")` | `can("roster")` | `roster`; per-driver overrides `dispatch` | — | Only as part of Settings |
| Reports, Detection coverage, Reefer coverage, Recall audit | surface `section("settings")` | `can("settings") \|\| readOnly` | `settings` | — | Only as part of Settings |
| Settings (the directory) | surface `section("settings")` | — | — | — | **Yes**, one row |

**What the table says:**
- **Ten screens are decided by `role === "admin"`**, written four times each: the route meta, the card, the
  API gate and the RLS policy. None of them reads the matrix, so the Permissions page cannot show or change
  them. `check-surfaces.mjs` waives nine of them as *"role test, no section to read"*.
- **The other screens are all one row.** Every Settings sub-page is a child of `admin.settings`
  (D-SURF8), so an admin can take away "Settings" as a whole, not Thresholds alone.
- **Planned fueling disagrees with itself:** the route says admin, RLS says dispatch managers may write it.
- Three smaller defects, found in the same sweep:
  - The three Data & sync fuel buttons are shown to anybody on the page but gated on `fuel` manage.
  - The Driver App comments say `rolesThatManage("roster")`, but the per-driver overrides are gated on `dispatch`.
  - `/coverage` calls `samsara/feed-pulse`, which has no section gate.

### 1.3 The mechanism already exists
- **A screen that can be switched off per role and per person** is a catalogue surface
  (`surfaceCatalogue.ts`) with a section gate. The Permissions page lists it by itself (`isEditableSurface`).
- **An endpoint only that screen uses** also declares `requireSurface(key)` beside its `requireSection`
  (D-SURF5), so switching the screen off stops the API as well as the menu. `maintenance.inspectors` is
  the worked example.
- **A screen only narrows within its section** (D-SURF2). Widening is a section change on the same page.

Nothing new has to be invented. The Settings screens just have to be put into that system.

---

## 2. The target

1. **Every Settings screen is its own row on the Permissions page** (Screens tab, a "Settings" group).
   Per role and per person, with the answering layer marked, as every other screen already is.
2. **Each row's gate is a section read from the matrix**, never `role === "admin"`:
   - `settings` (manage): Organization, Notifications, Anomaly thresholds, Driver performance, Data & sync.
   - `settings` (view): the directory, Audit log, and the four reports.
   - `dispatch` (manage): Planned fueling, the section its table's RLS already names.
   - `recruitment`: Recruiting. `roster` (manage): Driver App. Both unchanged.
3. **A short, named list stays admin-only and is never offered** (§5 Q-SET1). It gets its own ruled
   list beside `UNEDITABLE_SECTIONS`, not four hand-written checks per page.
4. **The Settings directory's cards come from the catalogue** (`surfaceAllowed`), not hand-written
   expressions. A card shows exactly when its screen opens.
5. **Every write a Settings screen makes goes through the API** with `requireSection` + `requireSurface`.
   Surfaces are not in the JWT (D-SURF4), so RLS cannot see a per-person "off". The browser's direct
   writes to `organizations`, `anomaly_thresholds`, `driver_performance_settings`, `route_fuel_settings`
   and `fuel_discount_rules` therefore move behind endpoints, and their client write policies are dropped
   afterwards. Reads stay where they are.
6. **Nobody gains or loses access on the day it ships** (§5 Q-SET2). The matrix gives `settings: manage`
   to fleet_manager, so point 2 alone would hand a fleet manager Organization, Notifications, Thresholds
   and Driver performance. The catalogue therefore carries a per-screen default of "off" for the roles
   that do not have the screen today, which the admin can turn on.

---

## 3. Steps (proposed; waiting on §5)

- **SP1 · Catalogue + directory (web + shared, no migration, no behaviour change).**
  - Each Settings screen gets its own surface key and `defaultOffFor` (Q-SET2). The ruled admin-only
    list becomes `ADMIN_ONLY_SURFACES`.
  - `requiresAdmin` / `requiresAuditAccess` leave every screen that becomes grantable.
  - `check-surfaces.mjs` drops those waivers.
  - The directory's cards derive from the catalogue.
  - Tests: every role reaches exactly what it reaches today, pinned per screen from the shared matrix.
- **SP2 · Endpoints for the direct writes (api + web, no migration).**
  - `PATCH /api/org/settings` (Organization and Notifications, split by field) plus thresholds, driver
    performance and route-fuel settings: each on `requireSection` + `requireSurface`.
  - The web switches to them. The existing admin-only API gates move to the section + surface.
- **SP3 · Drop the client write policies (migration, its own merge after SP2 is live).**
  - `organizations_update`, `thresholds_write` (its RESTRICTIVE driver-deny policies stay — they only narrow),
    `dps_write`, `route_fuel_settings_write`, `fuel_discount_write`.
  - The API reads with the service role, so the endpoints are unaffected. Matrices assert that each
    client write is refused.
- **SP4 · Audit log through the API (api + web, then a migration).**
  - The page reads `audit_logs` directly under a role-only policy, which is why it cannot be a
    permission today.
  - A `settings: view` + surface endpoint replaces the read; then `audit_select` narrows to deny-all
    for clients.
- **SP5 · The three defects in §1.2** — the Data & sync buttons, the Driver App comments, and
  `feed-pulse`'s gate.

Each step is one PR. SP3 and SP4's migrations each ship alone, after the code that stops needing the
policy is live (`lint:migration-ordering`).

---

## 4. Deliberately not in this plan
- Making the `admin` section itself editable. D-PERM7 stands: granting user management is a
  privilege-escalation path. A second administrator is a role change on the Users page.
- Giving drivers any Settings screen. D-PERM8 stands: drivers are sent to the app before any gate runs.
- Anything outside Settings. Every other sidebar screen is already a permission.

---

## 5. Open questions (the owner rules; nothing is built until then)

- **Q-SET1 · Which Settings screens stay admin-only, never offered to anyone?**
  - *(a)* Users, Permissions, Card control, EFS integration.
  - *(b)* (a) plus Organization. It holds the carrier's legal name and address that print on every
    signed document.
  - *(c)* only Users and Permissions.
  - *Recommendation: **(a)**.*
    - Users and Permissions are how access is given, so granting them is D-PERM7's escalation.
    - Card control and EFS integration write to real fuel cards and hold the EFS certificate. Both
      already demand a fresh sign-in, and both belong to whoever answers for the money.
    - Organization is ordinary configuration. Its danger is a typo, and the audit log records every change.
- **Q-SET2 · What does a role get on the day this ships?**
  - *(a)* Exactly what it has today. Every screen that is admin-only now starts "off" for every other
    role, and the admin turns it on per role or per person.
  - *(b)* Whatever the section says. fleet_manager (`settings: manage`) would gain Organization,
    Notifications, Thresholds and Driver performance, and the auditor would keep the Audit log.
  - *Recommendation: **(a)**.* A permission change should be something an admin does, not something
    a deploy does. Production has no fleet_manager today, so (b) would change nothing visible now,
    but it would decide for every future one.
- **Q-SET3 · The Audit log.** Today it is admin + auditor, by role.
  - *(a)* `settings: view` + its own screen. It then follows Q-SET2's answer like everything else.
  - *(b)* Keep it by role.
  - *Recommendation: **(a)**.* (b) is the one role test left, and the reason this plan exists.

---

## 6. Progress log

Append a dated line per step. Never edit §3.

- **2026-09-29** — Plan written from a sweep of every Settings route, card, API gate and RLS policy.
  Nothing built. Waiting on Q-SET1..Q-SET3. Same day, #1137 (examiners admin-only) shipped separately
  under Q-AW19.
