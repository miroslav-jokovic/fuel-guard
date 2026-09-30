# Settings as permissions — plan and queue

**Owner's request, 2026-09-29:** *"we need to have proper permissions, Settings also need to be included
as permissions for all people and roles."* This plan makes every Settings screen a permission the admin
can give or take away, per role and per person, on the existing Permissions page. It builds on
`EDITABLE-PERMISSIONS-PLAN.md` (sections, D-PERM*) and `SURFACE-ENTITLEMENTS-PLAN.md` (screens,
D-SURF*), and adds no third permission system.

Status: **SP1–SP4 live (0391). SP5 next; SP5–SP11 ruled and queued from the enterprise audit (§4b).**

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

## 3. Steps (ruled 2026-09-30; built in order, one PR each)

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

## 4b. The enterprise audit (2026-09-30, at `origin/main` `6e1a26d`, after SP4 went live)

**Owner, 2026-09-30:** *"our goal is to have permissions and settings part really professional and
enterprise grade so we have full control."* SP5 as written in §3 is four defects. This section asks the
larger question — is there any path left where the matrix is not the answer, or where a change to it is
not controlled, recorded and immediate — and records what three sweeps (every API route, every web
gate and link, every permission write) and production's `pg_policies` found. Each finding was checked
at its call site before being written here.

### 4b.1 What already holds (so nobody re-audits it)
- **Every API route is gated or pinned open with a reason.** `routeGateLedger.test.ts` builds the real
  app, walks every route, and fails on one with no gate unless it is in the shrink-only `OPEN_ROUTES` /
  `AUTH_ONLY_MOUNTS` (`testing/routeLedger.ts`). `feed-pulse` is there on purpose: six screens mount its
  freshness strip, so it is not `settings: view`. **§3's SP5 item on `feed-pulse` is closed by reading,
  not by a change.**
- **Every service-role permission write is org-scoped** and asserted with `expectOrgScoped`; per-person
  targets are checked against the caller's org (`lookupMemberRole`) and a composite FK.
- **An admin cannot lock themselves out through the matrix** (admin and driver are not editable, the
  hook never grants `admin`), cannot remove themselves, and the last admin cannot be demoted by the API.
- **The four matrix tables have no client write policy**; the API is their only writer, and every
  change to them writes an audit row.
- **Production RLS: 206 of 224 policies** read the matrix, scope by org, or scope by driver. Of the other
  18, seven are ruled role tests — the five federal readers (D-PERM9) and the two hazmat review policies
  (D-PERM10).

### 4b.2 Gaps, in the order they matter
1. **A browser can bypass the Users page.** `memberships_write` and `invites_admin_all` (0004, `FOR ALL`,
   `auth_role() = 'admin'`) were never dropped; both are live. With them, an admin's own token can change a
   role, delete a member or mint an admin invite through PostgREST — **with no audit row, no last-admin
   guard and no allowed-domains check**. No client uses them (searched web, driver and admin: zero
   `from("memberships"|"invites")`), so closing them costs nothing. This is SP3's argument, on the two
   tables that grant access itself.
2. **The last-admin rule is a count in the handler**, not an invariant: two concurrent demotions can
   leave zero admins, and gap 1 skips it entirely. Nothing in the database refuses it.
3. **Taking access away is not immediate.** Removing, revoking or demoting a user ends none of their
   sessions (`revoke_user_sessions` exists, 0363, and only password reset calls it). Sections live in
   the JWT, so the old access runs until the token refreshes — up to an hour — in the API and in RLS.
   Screens (`requireSurface`) are read from the database per request and are immediate in the API.
   **Office users have no suspended state**: the only verbs are delete and revoke. Drivers do (a Supabase
   ban).
4. **The audit trail cannot answer "what was it before".** The four matrix audits record the new value
   and the shipped default, not the previous override; `member.removed` omits the role held;
   `invite.revoked` has no meta. And **no caller checks `writeAudit`'s result** — a failed audit leaves
   the change committed and the response `ok`. The matrix writes are a delete then an insert with no
   transaction, and the audit is a third statement.
5. **`audit_logs` is append-only by convention only.** The service role can UPDATE or DELETE any row;
   there is no trigger. (The lifecycle plan's L7 must delete 5.06 M pre-0352 rows, so a trigger needs a
   named retention path — see Q-SET9.)
6. **Changing who can do what needs no fresh sign-in.** `requireFreshAuth` guards card control, EFS,
   the admin password reset and the applicant purge — not section access, screen access, members or
   invites.
7. **No reverse view.** The Permissions page answers "what can this person do"; nothing answers "who can
   open Card control" or produces the list an access review needs.
8. **The web asks the shipped matrix where the org's answer exists.** Eleven recruitment write
   affordances test `rolesThatManage("recruitment").includes(session.role)` and RecruitmentPage's
   hire actions test `canWriteDriverLifecycle(role)` — the shipped matrix, not `session.can(...)`. An
   admin who grants a role `recruitment: manage` gets an API that accepts and buttons that stay hidden;
   one who narrows it gets buttons that 403.
9. **Links and buttons that bounce** (SP5's content, now measured in full):
   - With the shipped matrix and no overrides, beyond §6's four:
     - The dashboard sends people to screens their role can't open: the Gallons/Fuel spend tiles for
       dispatcher, safety manager, auditor and accountant; the KPI hero's Driver performance, Idling and
       Anomalies links, the severity widget's "View all" and the Fuel Log's anomaly row click for
       dispatcher and accountant; the top drivers/vehicles lists for the accountant.
     - The hazmat load's "← Loads" link and breadcrumb bounce for a safety manager.
   - Buttons whose endpoint is stricter than their page:
     - "Send digest now" on Reports, and "Clean"/"Missed" on Recall audit, need `settings: manage` on
       pages that only need `settings: view`.
     - The Dashboard's Export menu uses `can('settings') || readOnly` where the API asks
       `settings: view`.
     - Data & sync's three `/api/transactions/*` buttons have no gate at all.
   - Under org overrides, about fifteen more — every in-page link to a sibling screen that has its own
     key (Reports → Recall audit, Organization → Notifications, Maintenance home → its five screens,
     notification deep links).
   - `pathOpens` cannot fix these as it stands: it matches the catalogue path exactly, so
     `/vehicles/abc` or `/fuel-log?tab=x` answer **false**. The router's own match has to be used.
10. **Role literals beside the matrix that nobody has ruled on.**
    - API: Samsara sync and diagnostics, the fuel-card mileage override, posted-price networks, the
      McLeod/Samsara/performance integration routes and `PUT /api/hazmat/policy` are `requireRole("admin")`;
      `POST /api/ai/ask` hand-lists five roles; driver credentials, reconcile and merge are
      `[admin, fleet_manager]` with a comment.
    - RLS: eleven pre-0260 policies that `lint:section-policies` grandfathers wholesale —
      `driver_duty_sessions` ×2, `duty_equipment_segments` ×2, `hos_duty_segments_write`,
      `load_events_insert`, `load_external_payloads_select`, `message_reports.reports_admin_read`,
      `hazmat_policies_admin_write`, plus gap 1's two.
    - Each is either a Q-SET1-style "admin only, never offered" (then it belongs on a named list that is
      derived, like `ADMIN_ONLY_SURFACES`) or a section (then it reads the matrix). Today it is neither,
      and the Permissions page cannot show it.

### 4b.3 The queue (one PR each; every migration ships alone after the code that stops needing it)
- **SP5 · Links and buttons agree with where they lead (web only).**
  - `session.opens(path)` resolves the path through the router (`router.resolve(...).matched[0]`) and
    asks `surfaceAllowed` plus the module. It replaces `pathOpens` at its two callers and gates every
    link in 4b.2 item 9.
  - The item 8 affordances move to `session.can(...)`.
  - Data & sync's buttons, the digest, Recall audit's marks and the Export menu each ask their
    endpoint's own section.
  - The Driver App comments are made true.
  - A test pins every catalogued link: a role-matrix walk renders each page and fails on a visible link
    whose target the same caller cannot open.
- **SP6 · Access is granted in one place (migration).**
  - Drop `memberships_write` and `invites_admin_all`; their SELECT policies stay.
  - Add a database invariant that an org keeps at least one admin (a constraint trigger on
    `memberships`).
  - Matrices assert every client write refused and the last admin undeletable, even by the service role.
- **SP7 · Taking access away is immediate** (Q-SET6).
  - Remove, revoke and demote end the person's sessions.
  - Office users get a suspended state that blocks login, API and RLS at once and can be undone.
- **SP8 · The trail is complete** (Q-SET7, Q-SET9).
  - The matrix, member and invite writes become one RPC each: change and audit in one transaction,
    with before and after recorded.
  - `audit_logs` gets an append-only trigger with the retention path named.
- **SP9 · Changing access needs a fresh sign-in** (Q-SET8). `requireFreshAuth` on section access, screen
  access, members and invites.
- **SP10 · Who has access** (Q-SET10).
  - The reverse view: per screen and section, every person with the answering layer.
  - A CSV an access review can file.
- **SP11 · The unruled role literals** (Q-SET11). Each API gate and RLS policy in 4b.2 item 10 becomes a
  section read, or is added to a derived admin-only list the Permissions page shows as "Admin only".
  `lint:section-policies` loses its pre-0260 grandfathering for those tables.

---

## 5. Questions (all five ruled by the owner, 2026-09-30)

- **Q-SET1 · Which Settings screens stay admin-only, never offered to anyone?**
  - *(a)* Users, Permissions, Card control, EFS integration.
  - *(b)* (a) plus Organization. It holds the carrier's legal name and address that print on every
    signed document.
  - *(c)* only Users and Permissions.
  - *Recommendation: **(a)**.* **Ruled (a), 2026-09-30.** Users, Permissions, Card control and EFS
    integration stay admin-only and are never offered. Everything else in Settings becomes grantable,
    Organization included.
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
  - **Ruled (a), 2026-09-30.** Every screen that is admin-only today starts "off" for every role that
    cannot open it today, and the admin turns it on per role or per person.
  - **Revised the same day, after SP1 shipped (#1139).** Owner: *"make all admin only by default, hide
    Settings too."* EVERY grantable Settings screen now starts off for every role but the admin,
    including the ones a role could open before: Recruiting, Driver App, Data & sync, the four reports
    and the auditor's Audit log. The Settings entry is no longer a switch of its own. It is shown
    exactly when at least one screen behind it is (`directory()` gate), so granting one screen also
    brings its door, and nobody gets an empty directory. Production had no fleet_manager, recruiter
    or auditor. The one safety_manager loses Recruiting and Driver App until the admin turns them on.
- **Q-SET3 · The Audit log.** Today it is admin + auditor, by role.
  - *(a)* `settings: view` + its own screen. It then follows Q-SET2's answer like everything else.
  - *(b)* Keep it by role.
  - *Recommendation: **(a)**.* (b) is the one role test left, and the reason this plan exists.
  - **Ruled (a), 2026-09-30.** Under Q-SET2 (a) its starting default is "off" for every role except
    admin and auditor, the two that can open it today. Under Q-SET2 as revised, it starts off for the
    auditor too.

- **Q-SET4 · "Allowed domains" on the Organization page has never saved.** OPEN, found building SP2
  (2026-09-30). The field shows `organizations.allowed_domains` and accepts edits, but no save has ever
  written it, back to the initial commit. The column is not inert: invitations refuse an email outside
  the list when the list is non-empty (`isEmailDomainAllowed`, `invites.ts`). Production's two orgs
  both hold `{}`, so nobody is restricted today.
  - *(a)* Make it save, through SP2's Organization endpoint. The first save with a domain typed in then
    starts refusing invitations to other domains. That is the field's stated purpose, but nobody has
    ever seen it do that.
  - *(b)* Take the field off the page, and leave the column for platform admins (`apps/admin`).
  - *(c)* Leave it as it is. It's a control that silently does nothing.
  - *Recommendation: **(a)**,* with the page saying plainly that it restricts invitations. That is
    what the hint text already promises. SP2 shipped with it still unsaved and labelled, so that
    SP2 changes no behaviour.
  - **Ruled (a), 2026-09-30** (owner: *"as recommended"*). It saves through `PUT
    /api/org-settings/profile`, behind the Organization screen, and the hint now reads as a warning:
    invitations to any other domain are refused, even ones already sent (acceptance re-checks). An
    emptied field saves `[]`, which means any domain. Built with one addition: each entry must be a
    bare domain (`example.com`). A stored entry is compared to the email's domain part exactly, so a
    typed `@example.com` would have matched nobody and refused every invitation.

- **Q-SET5 · Does the Audit log keep its exact total?** OPEN, found building SP4 (2026-09-30). The page
  shows "N events" and "of N", which PostgREST computes with `count: "exact"` on every load and every
  keystroke of the search. Measured in production the same day: `audit_logs` holds 5,064,662 rows for
  one org (242 for the other), 1.2 GB. The count is a parallel sequential scan of the whole table,
  3.2 s warm and **36.9 s cold** (127 k buffers read from disk; the database is Micro and swapping).
  Under `authenticated` it already runs into the 8 s `statement_timeout`. Through the API it would run
  as the service role, which has **no** timeout.
  - *(a)* Keep the exact count. That is a 1.2 GB scan per page load, with no timeout to stop it.
  - *(b)* Drop it. The pager says "Showing 51–100" and pages on `hasNext`, the way it already decides
    whether there is a next page (one row over the page size).
  - *(c)* An estimate (`count: "planned"`), labelled "about". It is cheap, but it is the planner's guess
    for the whole org and says nothing true once a search is typed.
  - *Recommendation: **(b)**.* Nobody acts on the number, and it is the most expensive thing the page
    does. SP4's PR 1 is built as (b), and waits on this ruling before it merges.
  - **Ruled (b), 2026-09-30** (owner: *"proceed as proposed"*). The same ruling reopened the
    lifecycle plan's Q1 on the 5.06 M rows behind the count (DATA-LIFECYCLE-PLAN.md §7).

### Questions from the enterprise audit (§4b) — all ruled as recommended by the owner, 2026-09-30

Owner: *"As recommended and lets finish this properly so after we are done this part is production
ready and enterprise grade."* Q-SET6 (a), Q-SET7 (a), Q-SET8 (a), Q-SET9 (a), Q-SET10 build now,
Q-SET11 (a), Q-SET12 (a).
- **Q-SET6 · When is taken-away access gone?**
  - *(a)* Immediately for remove, revoke, demote and suspend: end every session (`revoke_user_sessions`).
    Matrix changes keep "within an hour", as the page says today.
  - *(b)* (a), and a matrix change also ends the sessions of everyone it narrows.
  - *(c)* Keep the hour everywhere.
  - *Recommendation: **(a)**.* Removing a person is the moment an access control is audited, and an
    hour of a fired dispatcher's token is the finding. A matrix narrowing is a policy edit that can touch
    every dispatcher at once; logging them all out mid-shift is worse than the hour. The per-request
    `requireSurface` read already makes screen changes immediate in the API.
- **Q-SET7 · If the audit row cannot be written, does the change happen?**
  - *(a)* No: change and audit commit together in one RPC, or neither does.
  - *(b)* Yes, and alert.
  - *Recommendation: **(a)** for permission, member and invite writes.* An access change nobody can
    account for is the one thing an access log exists to prevent. Other audited writes stay as they are.
- **Q-SET8 · Does changing access need a fresh password?**
  - *(a)* Yes, the same five-minute step-up card control uses, for every write on the Permissions and
    Users pages and on invites.
  - *(b)* Only for granting admin and for removing a person.
  - *(c)* No.
  - *Recommendation: **(a)**.* One prompt per five minutes of editing, and a stolen session can no longer
    hand itself or anyone else more access.
- **Q-SET9 · Is `audit_logs` enforced append-only in the database?**
  - *(a)* Yes: a trigger refuses UPDATE and DELETE for everyone except one named retention function
    (L7's archive-then-drop).
  - *(b)* Convention only, as today.
  - *Recommendation: **(a)**.* `RETENTION_FORBIDDEN` already says it; the database should too.
- **Q-SET10 · Who-has-access view and export: build it now or later?**
  - *Recommendation: build it now (SP10).* It is the report an auditor asks for first, and a customer's
    security questionnaire asks whether it exists.
- **Q-SET11 · The unruled role literals (§4b.2 item 10).**
  - *(a)* Rule each one here: an integration's setup and credentials (Samsara sync and diagnostics,
    McLeod, performance, posted-price networks, fuel-card mileage, hazmat policy) go to the admin-only
    list with Users, Permissions, Card control and EFS. The rest (duty sessions and segments, HOS
    segments, load events, external payloads, message reports, AI ask) read their section.
  - *(b)* Everything becomes a section.
  - *Recommendation: **(a)**,* item by item in the PR, with each moved one's behaviour pinned first.
- **Q-SET12 · Office users get a suspended state?**
  - *(a)* Yes: `memberships.suspended_at`. The hook stops issuing `org_id`, sessions end, and the Users
    page shows and reverses it. It is audited.
  - *(b)* No: remove and re-invite.
  - *Recommendation: **(a)**.* Leave, investigation and seasonal staff are ordinary. Re-inviting loses
    every per-person override, and those overrides are the control.

### Questions found building SP11 (2026-09-30) — OPEN

Q-SET11 (a) says the rest "read their section". For two of them no section's derived set equals the
list, so reading a section would change who has access. SP11 left both as they are and asks.
- **Q-SET13 · Who reads the message-report queue?** `reports_admin_read` lets `[admin, safety_manager]`
  read every report in the org (and a reporter their own). That is no section's set: safety `manage`
  adds `fleet_manager`, safety `view` adds `fleet_manager` and `auditor`. Nothing reads the queue.
  No client selects `message_reports`, and the API only inserts (`messaging/routes/messages.ts`). The
  review queue 0096's comment describes was never built.
  - *(a)* Wrap it at safety `view`: the fleet manager and the auditor gain a read that no screen uses.
  - *(b)* A named list in `namedGrants.ts` (`MESSAGE_MODERATION_ROLES`), waived by name like D-PERM10.
  - *(c)* Drop the role half and keep `reported_by = auth_user_id()`. When the queue is built, it
    reads through the API behind a section gate, the SP4 pattern.
  - *Recommendation: **(c)**.* It is a client read that no product surface uses, the same argument
    that closed `audit_select` (0391). Choosing the queue's section waits until the queue exists.
- **Q-SET14 · Which section does Ask AI read?** `POST /api/ai/ask` hand-lists
  `[admin, fleet_manager, auditor, dispatcher, safety_manager]`. That equals `rolesThatCanView("hazmat")`
  **by coincidence** (Q-SURF7), and SP11 did not take it: an org granting a recruiter HazmatGuard would
  then have given them Ask AI. `askData` reads `fuel_transactions`, fuel anomalies, declines and fuel
  events for almost every answer, plus `driver_scores` and `idle_events`.
  - *(a)* Keep the named list, moved to `namedGrants.ts` beside its reason (Q-SURF7 (a)).
  - *(b)* `requireSection("fuel", "view")`. That is the list plus the `accountant`, who already reads
    fuel spend. **It adds one role.**
  - *(c)* `hazmat: view`. Equal today, but only by coincidence. Rejected.
  - *Recommendation: **(b)**.* The assistant's answers are fuel data. An org narrowing Fuel then
    narrows Ask AI with it, and the one role it adds already reads the same rows on its own pages.

---

## 6. Progress log

Append a dated line per step. Never edit §3.

- **2026-09-29** — Plan written from a sweep of every Settings route, card, API gate and RLS policy.
  Nothing built. Waiting on Q-SET1..Q-SET3. Same day, #1137 (examiners admin-only) shipped separately
  under Q-AW19.
- **2026-09-30** — Owner: *"proceed as recommended."* Q-SET1 (a), Q-SET2 (a) and Q-SET3 (a) ruled
  (§5). SP1 is next.
- **2026-09-30** — SP1 built (catalogue + directory, no migration). Each Settings screen has its own key
  with `reachedFrom: "admin.settings"` in place of `parent`; `startsOnFor` carries Q-SET2 (Organization,
  Notifications, Anomaly thresholds, Driver performance and Planned fueling start off for every role but
  the admin; the Audit log starts on only for the auditor, Q-SET3); `ADMIN_ONLY_SURFACES` is derived from
  the `ADMIN` gate (Q-SET1). The directory's cards and the Permissions page's new Settings group read the
  catalogue. `requireSurface` now passes the caller's id — per-person answers never reached the API
  before. Equivalence tested for every office role against the pre-SP1 route gates; 11 mutants, all
  killed. ⚠ Until SP2, a screen turned on for a non-admin opens a page whose saves are still refused
  (admin-only RLS and API gates), e.g. Organization's `organizations_update`.
- **2026-09-30** — Q-SET2 revised by the owner (§5): every Settings screen is admin-only by default,
  and the Settings entry is hidden unless a screen behind it is on. Built in its own PR before SP2. The
  account menu's Settings link now asks the same catalogue question (it was `can("settings")`).
  ⚠ Links elsewhere still go to Settings screens on the role's section alone, and now bounce for a
  role nobody has turned the screen on for: the dashboard's coverage tiles (`/coverage`,
  `/reefer-coverage`), the Anomalies page's `/settings/data` button (`can("safety")`), and the
  Odometer and Coverage pages' text links. Nothing is exposed (the guard refuses them), but they are
  dead links. They are SP5 material.
- **2026-09-30** — SP2 built. Organization and Notifications save through `PUT /api/org-settings/profile`
  and `/notifications`. Planned fueling saves through `PUT /api/fueling/settings`. Each asks its
  screen's section and then the screen (`requireSurface`). Thresholds, Driver performance and discount
  rules moved from `requireSection("admin")` to the same pair. After this, a Settings screen the admin
  grants can save, where before it opened and refused. On the way: the Notifications page's save had
  been writing the DOT number and address as null, because each page wrote the whole row. Now each
  endpoint writes only its own columns. The two web writers came off the table-writers ratchet.
  Q-SET4 (allowed domains never saved) is open. **SP3 may go once this is live:** drop
  `organizations_update`, `thresholds_write`, `dps_write`, `route_fuel_settings_write`,
  `fuel_discount_write`.
- **2026-09-30** — Owner ruled Q-SET4 (a), "as recommended" (§5). Allowed domains now saves with the
  rest of Organization, lower-cased and shape-checked; blank saves `[]`. The hint warns that other
  domains' invitations are refused. `settingsWrites.test.ts` rewritten to expect it saved, plus an
  empty-list case and a malformed-domain case; 5 mutants, all killed. No migration. SP3 is next.
- **2026-09-30** — SP3 built: migration 0389 drops `organizations_update`, `thresholds_write`,
  `dps_write`, `route_fuel_settings_write` and `fuel_discount_write`. Production's predicates were
  re-read first and matched 0004/0053/0300. Every `*_select` policy and anomaly_thresholds'
  restrictive driver policies stay. No client writer is left in apps/web, apps/driver or apps/admin.
  `rls.test.mjs` now expects the admin's client UPDATE and INSERT refused on all five tables, and a
  fleet manager's read still answering. `org-section-access.test.mjs`'s dispatch cases now expect
  every client write refused, the admin's and a dispatch: manage grant's included, and the
  dispatcher's read kept. Re-creating each policy fails its cases (5 of 5).
- **2026-09-30** — Q-SET4 merged (#1142, `e3be0dc`) and SP3 merged (#1143, `2247fba`). GitHub never
  delivered `2247fba`'s push event: no Actions run and no Railway deploy started, so 0389 was not
  applied. This line's own merge re-triggers the pipeline on a head that contains SP3. Railway's web
  deploy of `e3be0dc` had also failed ("failed to fetch snapshot", Railway's builders), leaving web on
  `15e875a`; the next deploy replaces it. SP4 (Audit log through the API) is next —
  HANDOFF-2026-09-30-SP4.md.
- **2026-09-30** — SP3 live: both services on `247ba66` with schema 0389 `current`. Production
  `pg_policies` on the five tables holds only the `*_select` policies and anomaly_thresholds' three
  restrictive driver policies (re-read 15:05 UTC). Still owed: one real Organization save as the admin,
  which needs the owner (no admin login here). No save has reached `organizations` since 0389.
- **2026-09-30** — SP4 PR 1 built (no migration): `GET /api/audit/log` on the org module's
  `auditRouter`, behind `requireSection("settings", "view")` and `requireSurface("admin.settings.audit")`.
  It is a service-role read filtered on the caller's org. `auditLogContract.ts` holds the row, the query
  and the page. The cursor is parsed to a timestamp and a uuid before it reaches the `or=` filter, and a
  typed `%` or `_` in the search is escaped. `useAudit.ts` calls `apiFetch`. Built as Q-SET5 (b): no
  total, and `TablePagination` gained an uncounted mode (`total: null` plus `hasNext`); its 75 counted
  callers are unchanged. `auditLog.test.ts` covers the admin; each `settings` holder refused until
  granted and then reading; each outsider refused by the section gate; paging, the exact-page edge,
  the prefix and escaping; and four malformed cursors. `AuditPage.test.ts` covers the empty, refused
  and next-page states. 15 API mutants and 7 web mutants killed. One more web mutant was a no-op: a
  guard behind a button that was already disabled. The guard was deleted.
- **2026-09-30** — Owner ruled Q-SET5 (b) (§5). Researching the count's cost found that 5,059,909 of
  the table's 5,064,904 rows are pre-0352 `vehicle.update`/`driver.update` rows with no actor and
  `meta = '{}'`. The owner reopened the lifecycle plan's Q1 and ruled (b): archive those rows, then
  drop them with L7. See DATA-LIFECYCLE-PLAN.md. SP4 PR 2 (drop `audit_select`) is unaffected.
- **2026-09-30** — SP4 PR 1 merged (#1145, `1de0ea1`). SP4 PR 2 built: migration 0391 drops
  `audit_select`, the table's only policy. Production was re-read first and matched 0004. No client
  reader is left: the only `from("audit_logs")` readers are service-role, no view reads the table, and
  `purge_applicant` is security definer. `rls.test.mjs` now expects every role in the `user_role` enum
  refused, read from the enum rather than listed, so the auditor and the admin are included. Recreating
  0004's policy, keeping it undropped, and an org-wide read policy each fail the cases (3 of 3).
- **2026-09-30** — **SP4 live.** #1145 (`1de0ea1`, the Audit log through `GET /api/audit/log`), #1146
  (`a975fb5`, 0390: audited updates record `meta.changed`) and #1147 (`033fa2a`, 0391) are all merged.
  Both services are on `033fa2a` with schema 0391 `current`. Production `pg_policies` on `audit_logs`:
  **0** (RLS still enabled, so every client role is denied). The first two `*.update` rows after 0390
  applied both carry `changed`. Verify deployment timed out once on `1de0ea1`: the web deploy outran the
  check's wait and was superseded by `a975fb5`. Nothing was broken. Still owed by the owner: open the
  Audit log as the admin in production, and SP3's one Organization save. **SP5 is next** (§6's dead
  links and gate mismatches).
- **2026-09-30** — Enterprise audit (§4b) after the owner asked for "enterprise grade ... full control".
  Three sweeps (API routes, web gates and links, permission writes) plus production `pg_policies`.
  Nothing built. SP5 is re-scoped to §4b.3 (web only, no ruling needed). SP6–SP11 are queued, and
  Q-SET6..Q-SET12 are open.
- **2026-09-30** — Owner ruled Q-SET6..Q-SET12 as recommended (§5). SP5–SP11 all proceed.
- **2026-09-30** — **SP10 built** (branch `claude/settings-sp10-who-has-access`, not yet merged). A "Who
  has access" tab on Permissions: pick a section or screen (every grantable screen plus Q-SET1's four
  admin-only ones) and every office member is listed with their answer and the layer that gave it —
  Default / Role / Personal, or Fixed by role, Admin only, No section access, Module off. `GET
  /api/access-review` returns the org's layers in one response (paged past PostgREST's 1,000 cap);
  `whoHasAccess` in shared resolves them through `resolveSectionAccess` / `surfaceAllowed`, and the
  People tab's precedence (`sectionCell`, `surfaceCell`) moved to shared so the file and the page share
  it. `GET /api/access-review/export.csv` renders the CSV server-side from the same function, dated on
  the carrier's calendar, and writes `permissions.exported` before it sends the file. If that audit
  write fails, no file is sent. Driver-app logins are left out, as on the Users page. Suspended members
  are listed apart and never counted as holders. No migration.
- **2026-09-30** — **SP9 built** (branch `claude/settings-sp9-step-up`, stacked on SP7b/SP8b; not
  merged). `requireFreshAuth()` sits after `requireRole("admin")` on all 15 writes: section-access and
  surface-access PUT (role + user), members DELETE / revoke / PATCH / suspend / reinstate, invites create
  / resend / revoke / delete. A name-only PATCH asks too: it is the same route, and a body-dependent
  gate is one the ledger cannot see. Left open on purpose: every GET, `POST /api/invites/accept`, the
  public redeem route, and `POST /api/invites/mail-test` (it changes no access). Each route file has a
  refusal test (403 `step_up_required`, no rpc, no write, no audit). Web: one `StepUpPrompt` per page
  (Permissions, Users) through `useStepUpRetry`; the rename drawer moved into `MemberRenameDrawer.vue`
  and owns its prompt like `MemberPasswordResetDrawer`. A retry does not re-ask `confirm()`.
- **2026-09-30** — SP11 built (Q-SET11 (a)), migration 0396. **Admin only:** Samsara, McLeod, EFS
  (connection and card control), fuel-card odometer correction, price-network feeds, the rewards
  freeze and the hazmat policy moved from `requireRole("admin")` to `requireAdminOnly(<key>)`. The keys
  are in `ADMIN_ONLY_CAPABILITIES` (`packages/shared/src/namedGrants.ts`). The Permissions page lists
  them under "Admin only", beside `ADMIN_ONLY_SURFACES`. `routeGateLedger.test.ts` fails if a key
  guards no route, if a route names an unlisted key, or if a bare admin gate appears outside Users,
  Permissions and two named record acts. **Named grant:** driver credentials, reconcile and merge read
  `DRIVER_IDENTITY_ROLES`. The web's App-login item and Reconcile button now ask the same list, so a
  safety manager is no longer offered buttons that 403. **Section reads (API):** the §391.23 inquiry
  routes are `requireSection("recruitment")` plus the reader test, as PSP is. The driver create/edit
  gate is `requireAnySection(roster, recruitment)`, and its lifecycle check reads the org's roster
  answer. **RLS (0396):** production was re-read first. It holds three policies no migration created
  (`duty_sessions_write`, `duty_segments_write`, `load_events_insert`), each a duplicate of a migrated
  twin, and 0396 drops them. The duty sessions/segments writes and `load_external_payloads_select`
  are wrapped at dispatch. `hos_duty_segments_write` is wrapped at settings: its list equals fuel,
  equipment and settings manage, and D-PERM11 picks Data & sync, the page whose sync writes it. The
  hazmat policy write stays admin-only with a named waiver. `lint:section-policies` checks these six
  tables from 0001 (`CHECKED_FROM_START`) and requires each list to be wrapped in its section.
  **Not done, and asked:** Ask AI and `reports_admin_read` equal no section's set honestly
  (Q-SET13, Q-SET14). ⚠ Re-read production `pg_policies` on the seven tables before merging.
- **2026-09-30** — Owner ruled SP11's three open questions "as recommended": **Q-SET13 (c)** — the
  message-report queue loses its role half and keeps only "a reporter reads their own" (`reports_own`
  insert and the `reported_by` read); **Q-SET14 (b)** — `POST /api/ai/ask` becomes
  `requireSection("fuel","view")` (adds the accountant); **the HOS table** stays wrapped at
  `settings: manage` as built. Not yet applied to the SP11 branch — the next session builds them into
  0396 before it is pushed.
