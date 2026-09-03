# Surface entitlements — a permission per screen, per user, that the product actually enforces

Companion to `EDITABLE-PERMISSIONS-PLAN.md`, which is **complete through P4**: an org can re-answer
the 7 × 11 role × section matrix, and the API and the database both honour it. This plan is the next
question the owner asked on 2026-09-02, and it is a different one:

> "we should have default setups for each role, but we should then have option for custom setup for
> each user … For example Technician shop should see only annual inspection page and nothing else."

Two things in that sentence are not expressible today: **per user** (every override is keyed to a
role), and **per page** (every override is keyed to a section, and one section drives up to seven
menu items).

---

## §0 Ground truth, measured 2026-09-02 at `origin/main` = f266448 (live: schema 0295)

### The four layers that decide what a person can reach, and what each actually covers

| layer | file / mechanism | unit | measured coverage |
| --- | --- | --- | --- |
| sidebar | `apps/web/src/lib/nav.ts` | section | 37 items; **31** section-gated, 6 outside the matrix. Cosmetic — `show` hides an entry, nothing more |
| web router | `router/routes/*.ts` + `index.ts` guard | section | 81 route records → 11 redirects, **70 real routes**. Gated beyond `requiresAuth`: **16** (`requiresManage` 6, `requiresAdmin` 9, `requiresAuditAccess` 1). 9 are public/`allowNoOrg`; **45 are authenticated and ungated**. **There is no `requiresView` meta at all** |
| API | `requireSection` / `requireRole` middleware | section × level | ~312 endpoints: **141** section-gated, **106** `requireRole`, **65** with nothing beyond `requireAuth` |
| database | RLS policies | section × table × command | **44** policies section-wrapped by 0293/0294/0295 |

⚠ **Method, so the next reader knows what to re-run rather than trusting a number.** The route figures
are read from `apps/web/src/router/__snapshots__/routeTable.test.ts.snap` — a committed snapshot
generated from the *live* router, meta included. That is ground truth. Three hand-written regex
parsers were tried first and each was wrong in a different way (one swallowed `/hazmat/calculator`
into the preceding redirect's object, one counted comment mentions of `requiresManage` as route
metas, one dropped `/compliance/:id`). The API figures are still a static parse of 312 of 321 raw
`router.<verb>(` call sites — the nine skipped are multi-line forms — so treat them as ±10 and as a
shape rather than a census. **Do not re-derive any of this by grep.**

Of the 106 `requireRole` endpoints, **56 are `requireRole("admin")`** and correct as they stand —
D-PERM7 makes the `admin` section ungrantable, so an admin-only gate is not something an org's
permissions page should reach. Roughly **24** are hard-coded multi-role lists derived from nothing
(`"admin", "fleet_manager"`, `"admin", "fleet_manager", "dispatcher"`, …); those are the API twin of
Q-PERM10 and are registered as **Q-SURF1** below. The rest derive properly
(`...rolesThatManage("fuel")`, `...USER_ROLES.filter(canReadInvestigationHistory)`).

The 65 with no authorization beyond `requireAuth` are mostly correct by design — provider webhooks,
`/api/version`, the public application-token routes, the driver app's own `/api/me/*` surfaces,
participation-scoped messaging, map tile proxies. They are listed in Q-SURF1 rather than assumed
safe, because "mostly" is not a measurement.

### The gap that makes "not just visually" the right instinct

Joining every route to its sidebar entry produces **28 routes whose nav entry knows a section and
whose route does not gate on it**. Put the other way round: of the 31 section-gated sidebar items,
**exactly 3** have a route that gates on anything — `/import`, `/fuel-spend` and `/settings`. For the
other 28, hiding the menu item hides nothing: the URL is typed, the page mounts, and only the API
refuses the data, so the user gets a broken page rather than a closed door.

```
/messages  /assignments  /loads  /truck-stops        dispatch:view
/fuel-planning                                       dispatch:manage
/drivers  /compliance                                roster:view
/accounting  /cpm  /cost-schedule                    accounting:view
/billing                                             billing:view
/shop  /shop/inspections  /shop/inspectors           maintenance:view
/vehicles  /trailers  /odometer                      equipment:view
/idling  /anomalies  /driver-performance             safety:view
/transactions  /rejections  /fuel-cards
  /fuel-spend/exceptions  /ifta                      fuel:view
/recruitment  /recruitment/screening
  /recruitment/inquiries                             recruitment:view
```

A further seven detail routes have neither a gate nor a nav entry, and inherit nothing today:
`/loads/:id`, `/drivers/:id`, `/compliance/:id`, `/vehicles/:id`, `/fuel-cards/:id`,
`/recruitment/:id`, `/shop/inspections/:id`.

### A live defect the same join exposed

`/settings` is one of the three routes that IS gated — and it is gated at the wrong level. The
sidebar shows it on `canViewSection("settings")`; the route demands `requiresManage: "settings"`.
`auditor` is the only role holding `settings: "view"` without `manage`, so **an auditor saw a
Settings menu item that bounced them to the dashboard.** ~~Recorded as Q-SURF5~~ — **fixed
2026-09-02** by dropping the route to `view` (option (a)); the account stays here because it is the
exact failure mode this plan exists to make impossible, found in production by this plan's own
review rather than by a report, and because the remaining 27 are the same defect unfixed.

**This is fixable without any of the machinery below** — see S2, which closes all 28 plus the seven
detail routes in one change once S1's catalogue exists.

### The measurement that decides the architecture

The owner's example was tested against the code rather than reasoned about.
`apps/web/src/features/maintenance/NewInspectionDrawer.vue:76` — a component of the **Annual
Inspections** page — calls `useInspectorsQuery()` → `GET /api/maintenance/inspectors`, to fill the
inspector picker. Starting a §396.17 inspection *requires reading the inspector register*.

So "the technician sees Annual Inspections but not Inspectors" cannot be one permission:

- as a **data** rule it is self-defeating — revoke inspector rows and Annual Inspections breaks,
  because there is no inspector to name and `inspections.ts:146` rejects the submission;
- as a **screen** rule it works exactly as asked.

The endpoint split is already clean in the code, which is what makes the rule below mechanical
rather than a matter of taste:

| endpoint | called by | correct unit |
| --- | --- | --- |
| `GET /api/maintenance/inspectors` | `InspectorRegisterPage` **and** `NewInspectionDrawer` | section — a shared read |
| `POST` / `PATCH` / `DELETE .../inspectors` | `InspectorRegisterPage` + `InspectorDrawer` only | surface — exclusive to that screen |

### Facts about the existing machinery this plan is bound by

- `org_section_access` is keyed **(org_id, role, section)** — primary key included. There is no user
  dimension anywhere in the permissions path.
- `custom_access_token_hook` (0292) resolves the sparse `sections` claim from that table at token
  mint. It applies D-PERM7/D-PERM8 itself as a third layer.
- `jwt_expiry = 3600` (`supabase/config.toml:165`). A section change therefore lands within an hour,
  which D-PERM6 ruled acceptable and which the UI is required to say.
- `auth_section()` is deliberately inlinable — `language sql`, `stable`, no `security definer`, no
  `set search_path`. The 128× per-row cost of breaking that is measured and took the fuel-spend page
  down once. **Nothing in this plan may put a table lookup on the RLS path.**
- `/api/me` exists (`app.ts:379`) and returns `userId, email, orgId, role`. **The web does not call
  it** — the session store reads org and role out of the JWT.
- **The router guard is already async** and already awaits the session:
  `if (!session.initialized) await session.init();` (`router/index.ts:89`). Entitlements can therefore
  be fetched inside `session.init()` and read synchronously by the guard — there is no
  guard-runs-before-data problem to solve. Verified, because the obvious design has one.
- **`session.canView(section)` already exists** (`stores/session.ts:95`), beside `can()` for manage.
  A view-level route gate is one guard line, not new plumbing.
- `check-capabilities.mjs` already parses web files for `requiresManage` and fails one that does not
  NAME a section (D-ROS7), with `--self-test` proving the detector fires. Extending it to a second
  meta is a known shape, not a new gate.
- **`packages/shared` depends on `zod` and nothing else, and is compiled for React Native**
  (`build:rn` → `tsc -p tsconfig.build.json`, consumed by `apps/driver`). `packages/ui` does not
  depend on it. So the catalogue may hold permission FACTS in shared but **must not hold the sidebar
  icon** — a Vue component import would break the driver build. See D-SURF3.
- **`lint:migration-ordering` exempts a new table** on the stated grounds that "its readers are new
  code paths — during the window a feature nobody is using yet". That reasoning does **not** cover a
  reader on the auth or bootstrap path, which every request uses on the first deploy. See D-SURF9.

---

## §1 The architecture — two resource kinds, deliberately separate

**Data authorization. Unit: `section`.** Which rows a principal may read and write. Enforced by RLS
and by the API. Stays coarse because it keys on *tables*, and 44 policies plus 141 endpoints already
speak it fluently. This is the security boundary and it does not move.

**Surface entitlement. Unit: `surface` (one screen).** Which screens a principal may reach, and
which endpoints *only that screen* uses. Enforced at the router and at those exclusive endpoints.
This is the layer the owner's request needs, and it is new.

The relationship between them is one-way and is the whole safety argument: **a surface can only
narrow within its section.** A surface is never a way to reach data the section refuses.

---

## §2 Decisions

### D-SURF1 — A screen and a table are different questions, and get different permissions
Ruled from §0's measurement, not from preference. A page reads across tables; a table is read by
several pages. Collapsing the two into one unit breaks working pages (the inspector picker) or
invents a data path RLS cannot express. So the product has two permission vocabularies, and each is
enforced at the layer that can actually enforce it.

### D-SURF2 — A surface only narrows within its section (owner ruling, 2026-09-02)
An admin may take pages away from a role or a user inside a section they hold. An admin may **not**
grant a page whose section the principal lacks — that option is not offered in the UI and is refused
by the resolver. Rationale: the section is what RLS enforces, so a cross-section page grant would
either be a lie (the page loads empty) or would have to silently widen the data boundary underneath,
which is a privilege escalation disguised as a menu setting. Widening remains a section edit, on the
page P4 already built, where it is visible as what it is.

### D-SURF3 — One catalogue, three consumers, zero restatements — and the icon stays behind
A single typed `SURFACES` registry in `packages/shared` is the source of truth for the permission
facts: key, label, path, section, level, parent. The sidebar, the router guard and the API's surface
middleware all **derive** from it. Today the same fact — "Cards belongs to fuel:view" — is written
once in `nav.ts` and nowhere else, which is why the 28-route gap exists at all.

⚠ **The sidebar icon does NOT go in the catalogue.** `packages/shared` carries one dependency (zod)
and is compiled for React Native for `apps/driver`; importing `@silvicom/ui/icons` there would break
that build, and `packages/ui` does not depend on shared either. The web keeps a thin
`Record<surfaceKey, Icon>` beside `nav.ts`. That is not a second home for a permission — an icon is
not a permission — but it is the exact point where an author who has not read this paragraph will
conclude the catalogue "can't live in shared" and duplicate it web-side. `lint:surfaces` asserts the
icon map's keys are exactly the catalogue's, so the split cannot drift.

### D-SURF4 — Surface entitlements do NOT travel in the JWT
Sections must, because RLS reads them per row and `auth_section()` has to inline. Surfaces must not,
for the mirror reason: **nothing in RLS needs them.** Only the router and the API middleware read
them, once per request. Serving them from an endpoint instead of the token buys two things — the
1-hour staleness of D-PERM6 does not apply to the page layer (a change lands on next page load), and
the token does not grow with a per-user list. The cost is one bootstrap fetch the web does not make
today; `/api/me` is the natural home and already exists.

### D-SURF5 — A surface owns only the endpoints exclusive to it
An endpoint that more than one surface calls stays gated at the section level, never at the surface
level. `GET /api/maintenance/inspectors` is the worked example: it backs both the register and the
inspection drawer, so denying the register must not deny it. The exclusive writes
(`POST`/`PATCH`/`DELETE`) do belong to the register and are gated with it. **Where that fact is written matters, and the first draft of this plan got it wrong.** The catalogue
does NOT list exclusive endpoints. The endpoint declares its own surface — `requireSurface("maintenance.inspectors")`,
beside the `requireSection` it keeps — because that is where the enforcement is and a list in the
catalogue would be a second copy of it, drifting the first time an endpoint moves (D-SURF3 applied to
this plan's own design). `lint:surfaces` reads the middleware calls and fails on a `requireSurface`
naming a key the catalogue does not define. Claiming an endpoint is exclusive when it is not takes a
working page down, so the check runs in that direction too: a `requireSurface` on an endpoint that
more than one surface's code path calls is a finding, not a preference.

### D-SURF6 — Resolution order, and deny wins
```
shipped role default  →  org role override  →  user override
```
Each layer is a **sparse delta** over the one before, exactly as D-PERM4 defines for sections, and
for the same reason: absence means "unchanged", never "denied", so a principal with no rows behaves
exactly as they do today. Where an explicit grant and an explicit deny meet at the same layer, deny
wins. The `admin` role and the `admin` section stay immune at every layer (D-PERM7/D-PERM8), so an
org always has a way back out of a configuration it regrets.

### D-SURF7 — Per-user overrides exist for BOTH kinds
The owner asked for per-user custom setup; that applies to sections as well as surfaces. A per-user
section override goes in the JWT beside the role's (D-PERM2's mechanism, one extra table read in the
hook); a per-user surface override is served by the API (D-SURF4). Same resolution chain, two
transports, for the reason each transport was chosen.

### D-SURF8 — A detail route inherits its parent surface
`/loads/:id` is the Loads surface; `/shop/inspections/:id` is the Annual Inspections surface. Stated
as a `parent` in the catalogue rather than as its own entry, because a permission page listing
"Load detail" beside "Loads" invites an org to deny one and not the other, which would be a bug the
UI made easy to write.

### D-SURF9 — A table read on the auth or bootstrap path ships one merge before its reader
`lint:migration-ordering` exempts a new table because "its readers are new code paths — during the
window a feature nobody is using yet" fails harmlessly. **That reasoning does not hold for this
plan's readers.** `/api/me` is fetched by every page load and `custom_access_token_hook` runs on
every token mint, so a reader deployed at ~3 minutes against a table created at ~12 would break
sign-in and bootstrap for the whole org for nine minutes — the exact outage
`docs/MIGRATION-DISCIPLINE.md` §the-deploy-window exists to prevent, arriving through the gate's
blind spot rather than past it.

So S3 and S4 each split in two: **the table merges first, the reader merges second.** The gate will
not ask for this; the plan does. (S5's SQL half is exempt from this rule — the hook body and `user_section_access` live in the
same migration and therefore apply in the same instant. It is the TypeScript readers of S3 and S4
that need the extra merge.)

---

## §3 The surface catalogue

Shape (illustrative — the real literal lands in S1):

```ts
/** The three questions a sidebar entry can ask today. Measured, not invented — see Q-SURF3. */
export type SurfaceGate =
  | { kind: "section"; section: AppSection; level: SectionAccess } // the editable kind
  | { kind: "staff" }   // any signed-in non-driver role  — Ask AI, the two hazmat surfaces
  | { kind: "admin" };  // the admin role only            — Users

export interface Surface {
  key: string;        // "maintenance.inspectors" — stable, storable, the override's primary key
  label: string;      // "Inspectors" — the sidebar name
  path: string;       // "/shop/inspectors" — the DECLARED route path, params and all
  gate: SurfaceGate;  // a surface can never exceed its section (D-SURF2)
  module?: ModuleKey; // AND-ed with the gate; today: hazmatguard ×2, dispatch ×2, messages ×1
  parent?: string;    // detail routes point at their list surface (D-SURF8)
}

/** Editable is DERIVED — a section gate is the only thing an org's matrix can move (Q-SURF3). */
export const isEditableSurface = (s: Surface): boolean => s.gate.kind === "section";
```

No `icon` (D-SURF3 — shared is built for React Native), no `exclusiveEndpoints` (D-SURF5 — the
endpoint names its own surface) and no stored `editable` (Q-SURF3 — a section gate already says it).
`path` is the declared path rather than a resolved URL because that is what `to.matched[0].path`
gives the router guard, which is how a surface is found without a per-route meta. `module` moves here
from `nav.ts`, which states it three times today.

Seeded from the measured join of `nav.ts` and the route snapshot: **37 nav entries + 7 detail
routes**, across 11 sections; every one of the 37 nav paths resolves to a real route record (checked
— there are zero orphans). The maintenance section, the owner's worked example:

| key | label | path | gate |
| --- | --- | --- | --- |
| `maintenance.repair-spend` | Repair spend | `/shop` | section maintenance:view |
| `maintenance.inspections` | Annual inspections | `/shop/inspections` | section maintenance:view |
| `maintenance.inspections.detail` | — | `/shop/inspections/:id` | parent: `maintenance.inspections` |
| `maintenance.inspectors` | Inspectors | `/shop/inspectors` | section maintenance:view |

Six items sit **outside** the section matrix — `Dashboard` and `Fuel Log` (no gate), `Ask AI`
(`isStaff`), `Placard calculator` and `Hazmat review` (`isStaff` + module), `Users` (`isAdmin`).
**Q-SURF3 is answered:** all six are catalogued with a `staff` or `admin` gate, which makes them
non-editable by derivation. They render in the preview so a reader sees the whole sidebar, and no
cell offers to change them.

⚠ `show: true` on Dashboard and Fuel Log means "no role gate", **not** "drivers see it". An earlier
draft of this plan said drivers were included and that is wrong: `router/index.ts:99` redirects
`role === "driver"` to `/use-the-app`, whose meta is `layout: "auth"`, and `App.vue` renders
`AppShell` — the only layout with a sidebar — in the `v-else` branch. **A driver never renders the
web sidebar at all.** Those two items are ungated for every *staff* role.

---

## §4 Execution protocol

Same ritual as `EDITABLE-PERMISSIONS-PLAN.md` and `RECRUITING-SYSTEM-PLAN.md` §4. In short:

1. Read this document and `EDITABLE-PERMISSIONS-PLAN.md` §2b/§2c top to bottom, then the `CLAUDE.md`
   of every package the step touches.
2. Establish reality: `git log --oneline -15`, `pnpm verify:live`. Never assume the deployed schema.
3. First step below not marked **DONE**; check its prerequisites; a missing one means run the
   fallback beside it, never guess.
4. One step per branch (`claude/<topic>`), PR to `main`, CI green, **verify `main` actually moved**.
5. Mark the step **— DONE `<date>` (migrations NNNN–NNNN)** in place with "What shipped" and
   "Verified by:" naming the gates run. This document is the memory between sessions.

Migration numbers are never pinned in advance. Every new table gets `org_id`, `enable row level
security`, and a PGlite matrix printing a `RESULT` line. Permission changes write an audit row —
they are the acts most worth being able to reconstruct.

⚠ **Two traps this programme already paid for, carried forward:**
- `lint:section-policies` reads `auth_role() in (...)` but **not** `auth_role() = any (array[...])`
  — write new policies with `in (...)` (Q-PERM11).
- Its waiver check greps the **raw** file, so a migration header that merely mentions the waiver
  marker silently waives its own migration and the gate reports green having read nothing.

---

## §4b Step dependencies — checked so no step blocks another

| step | needs | blocked by | may run in parallel with |
| --- | --- | --- | --- |
| S1 catalogue | ~~Q-SURF3~~ — **answered, unblocked** | — | S5, S7 |
| S2 router guard | S1 | S1 | S5, S7 |
| S3 per-role surfaces | S1, S2 | S2 | S5, S7 |
| S4 per-user surfaces | S3 | S3 | S5, S7 |
| S5 per-user sections | — | **nothing** | S1–S4, S7 |
| S6 the page | S3, S4 (S5 if it offers sections) | S4 | S7 |
| S7 audit the ungoverned gates | — | **nothing** | everything |

Two things this table is for. **S5 is not blocked by anything** — per-user *section* overrides touch
no catalogue and no surface, so if the screen half stalls, the "custom setup per user" half of the
owner's request can still ship. And **S7 blocks nothing but gates a claim**: S6's page may ship
before it, provided it says which surfaces are not yet governed rather than implying all of them are.

The only hard chain is S1 → S2 → S3 → S4 → S6, and every link in it is a real dependency: the guard
needs the catalogue to look surfaces up in, the per-role table needs surface keys to store, the
per-user table resolves over the per-role answer, and the page edits all of them.

## §5 Steps

⚠ **The order below is not the order this plan was first written in, and the swap is the point.**
The first draft opened with "backfill a `requiresView` meta onto the 28 routes", then introduced the
catalogue one step later and re-pointed those metas at it. That is 28 hand-written copies of a fact
the very next step makes derivable — D-SURF3's own failure, committed by the plan that declares it.
Building the catalogue **first** costs nothing (it is a pure refactor with byte-identical output) and
turns the gap fix from 28 edits into one guard that reads the catalogue, covering the seven detail
routes for free via `parent`.

### S1 · The catalogue, deriving the sidebar — no behaviour change — DONE 2026-09-02 (#478)
**What shipped:** `SURFACES` in `packages/shared/src/surfaces.ts` — 52 surfaces, 37 in the sidebar,
15 non-nav. `buildNavGroups` is a fold over it. Icons live web-side in `apps/web/src/lib/navIcons.ts`,
because shared is compiled for React Native and cannot import Vue (D-SURF3).
Introduce `SURFACES` in `packages/shared` (D-SURF3's shape, §3) and rewrite `buildNavGroups` to fold
over it instead of hand-listing 37 entries. The web-side `Record<surfaceKey, Icon>` map lands beside
`nav.ts`. **Nav output must be byte-identical for all nine roles** — that equality is the review, and
it is testable before the change because `buildNavGroups` is a pure function.

**Prerequisite:** ~~Q-SURF3 answered~~ — **met 2026-09-02.** The six non-matrix items carry a `staff`
or `admin` gate and are non-editable by derivation. **S1 is unblocked.**
**Gate:** `lint:surfaces` — every catalogued path is a real route in the snapshot, every catalogued
key has an icon, no surface's `level` exceeds what its `section` can grant.
**Verified by:** a `buildNavGroups` snapshot per role, captured **before** the change and unchanged
after — the harness `routeTable.test.ts` already established for the route-table split.

### S2 · The router guard reads the catalogue — the 28-route gap closes — DONE 2026-09-02 (#480)
**What shipped:** the guard resolves `to.matched[0].path` through the catalogue. **No section metas
remain in the route files.** The 28-route gap is closed and the seven detail routes inherit via
`parent`.
The guard resolves `to.matched[0].path` → surface → `section` + `level`, and calls the
`session.canView` / `session.can` that already exist. No FURTHER `requiresView` meta is written and
no route file is edited 28 times. The six existing `requiresManage` metas, the one
`requiresView` that Q-SURF5 added for `/settings`, and the one `requiresAuditAccess` are reconciled
with the catalogue and **removed where they merely restate it** — the `/settings` meta is the first
one to subsume, since the catalogue will say `settings:view` for that surface anyway.
`requiresAdmin` (9) stays as it is, being a role test rather than a section one.
`sectionGuard.test.ts` already exists and is extended rather than written.

**This step also fixes the shipped `/settings` defect** — the auditor bounce in §0 — because the
guard and the sidebar stop being able to disagree by construction.
**Done when:** typing `/transactions` as a role with `fuel: none` lands on the dashboard rather than
on a page that mounts and then fails; and an auditor can open Settings.
**Gate:** extend `check-capabilities.mjs` (it already parses `requiresManage` and fails one that does
not name a section) to fail any *authenticated, non-public* route absent from the catalogue without a
waiver line. **Verified by:** a guard test per section at both levels, plus one per detail route
asserting it inherits its parent.

### S3 · Per-role surface entitlements — DONE 2026-09-02 (#483 table, #486 reader; migration 0296)
**What shipped:** migration 0296 `org_role_surface_access` in one merge, then `/api/me` serving the
claim, `session.init()` loading it, nav and guard consulting it, and `requireSurface()` gating the
three writes exclusive to the Inspectors register — in the next. Two merges, per D-SURF9, which was
the right call for a reader with no fallback; S4 documents why the same rule was disapplied there.
Table `org_role_surface_access (org_id, role, surface_key, allowed, updated_at, updated_by)`, sparse
per D-SURF6, RLS-read by the org, written only through the audited API — 0291's arrangement, for
0291's reason. Served by `/api/me` (D-SURF4), loaded in `session.init()` so the guard reads it
synchronously (§0 verified the guard already awaits init). Exclusive endpoints gain
`requireSurface()` beside their existing `requireSection` (D-SURF5).

⚠ **Two merges, per D-SURF9:** the table and its RLS first, the `/api/me` reader and the middleware
second. `/api/me` is on every page load, so the nine-minute deploy window is not the harmless case
the new-table exemption was written for.
**Done when:** an org hides Repair spend and Inspectors from `technician`, and the sidebar, the
router and the register's write endpoints all agree — while the New Inspection drawer still loads its
inspector list, which is the §0 measurement turned into a test.

### S4 · Per-user surface overrides — DONE 2026-09-02 (#491; migration 0298)
`user_surface_access (org_id, user_id, surface_key, allowed)`, resolved over S3's answer per D-SURF6,
served the same way. ~~**Two merges, per D-SURF9.**~~ — **one merge**, see below.
**Done when:** `xxx@silvicominc.com` on the `technician` role sees only Annual Inspections, and no
other technician is affected.

**What shipped.** Migration 0298 plus the resolver and the write endpoint, in one PR.

- `surfaceClaimFor(admin, orgId, role, userId)` reads both layers concurrently and merges the
  member's answers OVER the role's. Nothing else moved: `/api/me`, `session.init()`, the nav and the
  guard already consume a resolved `SurfaceClaim` and never learn which layer produced it. That is
  the payoff of D-SURF4's decision to resolve server-side, and it is why S4 touched no web file.
- `PUT /api/surface-access/user`, admin-only and audited as `permissions.screen_changed_user`. It is
  **not** symmetric with the role-level `PUT` and the asymmetry is the design, not an oversight: at
  the role layer `allowed: true` is a RESET (a `true` there is inert, because the surface's own gate
  is checked first — D-SURF2) so the row is deleted, while here both booleans are real answers —
  `false` takes a screen from one member their role keeps, `true` gives one back to a member whose
  role has lost it, which is the row 0296's boolean column was added for. "Unchanged" therefore needs
  a third value and it is `allowed: null`, stored as the absence of a row.
- **The D-PERM7/D-PERM8 lock could not be a CHECK here**, and 0298's header says so at length rather
  than leaving a reader to find a gap: the table is keyed by `user_id` and a row does not know its
  member's role, which lives in `memberships` and can change after the row is written. The lock lives
  in the endpoint (an org-scoped `memberships` lookup, which doubles as the check that the target is
  a member of the CALLER's org) and in the resolver's `EDITABLE_ROLES` guard, which still stands
  first and answers `{}` before either table is read. The matrix asserts that SQL does **not** stop
  such a row, so the missing constraint reads as a decision with two named guards rather than a hole.
- What SQL *can* enforce, it does: `foreign key (org_id, user_id) references memberships` makes "an
  override belongs to a member of this org" a database fact, cascades on org deletion through the
  membership, and takes a departing member's overrides with them.

**The D-SURF9 deviation, deliberately.** The plan said two merges — table first, reader second —
because `/api/me` is on every page load and a reader deployed ~9 minutes ahead of its table would
break bootstrap. **S3b already removed that failure:** `surfaceClaimFor` returns no denials on any
query error and `app.ts` wraps the call in `try/catch`, so during the window the user layer simply
does not apply and the role layer answers exactly as it did the minute before. Pinned, not hoped —
`"returns the role's answers unchanged when the user table cannot be read"` was added in the same PR
that relies on it, beside its mirror for the role table. D-SURF9 still holds for a reader with no
such fallback.

**Verified by:** `pnpm test` (unit + all 22 matrices; the new `user-surface-access` matrix is 20
assertions and `rls` is 465 including this table's tenant-isolation and anon-lockout pair),
`pnpm typecheck`, `pnpm build`, `pnpm lint`, and the whole CI gate list extracted from
`ci.yml` — `lint:migrations`, `lint:rls`, `lint:migration-ordering`, `lint:surfaces`,
`lint:capabilities`, `lint:upserts`, `lint:boundaries`, `lint:comment-claims`, `lint:filesize`,
`lint:funcsize`, `lint:tests`, `lint:secrets`, `lint:codegen`, `lint:table-producers`,
`lint:table-writers`, `lint:chart-colors`, `lint:cli-streams`, `lint:light-dark`, `lint:token-schema`,
`lint:tokens-parity`, `lint:ui-adoption`, `lint:ui-contrast`, `--filter ./apps/web lint:tokens`.

**Mutation-tested, subject not test.** Twelve mutations of the resolver, the endpoint and the
migration; each failed a different assertion. Two of them changed what shipped rather than merely
confirming it, and both are the kind this programme keeps finding only this way:

- The user-layer fixture originally answered `[]` when no `user_id` filter was applied, so **dropping
  `.eq("user_id")` from the query failed the same assertion as reversing the merge order** — the
  "no other technician is affected" clause was proving nothing. The fixture now returns everything an
  unfiltered read would return, which is what Postgres does, and the leak fails its own assertion.
- The matrix's `org_id`-immutability assertion **passed with the trigger dropped**, because the
  membership foreign key refused the update instead: the subject was not a member of the destination
  org. It now moves a row between two orgs the person actually belongs to and checks the trigger's
  own error, leaving the trigger as the only thing that can refuse.

**Left for S6, deliberately.** There is no READ endpoint for per-user overrides. The write is what
S4's Done-when needs and what `lint:table-producers` requires; the page that has to display a
member's resolved access is S6, and it can add the read shaped the way its People tab wants rather
than inheriting a guess made here.

### S5 · Per-user section overrides — DONE 2026-09-02 (migration 0299)
`user_section_access (org_id, user_id, section, access)`, read by `custom_access_token_hook` as one
more sparse `jsonb_object_agg` merged **over** the role's answer, inside the existing
`if v_role not in ('admin','driver')` guard. Needs `grant select on public.user_section_access to
supabase_auth_admin`, as 0292 did for `org_section_access` — the hook is `security definer` but the
grant is the posture that file set and this one matches it.

⚠ The hook is the one function that turns a row into authority: D-PERM7/D-PERM8 are re-applied here
as 0292's header requires, and a user override may never produce a section the role could not have
been granted (D-SURF2's constraint expressed at the mint).

**S5 is independent of S1–S4** — it touches no catalogue and no surface — so it may ship in parallel
with them, and it is the half that answers "custom setup for each user" for *data* rather than for
screens. It is placed last only because the screen half is what the owner's example asked for.

**What shipped.** Migration 0299 — the table AND the hook change in one file — plus
`PUT /api/section-access/user`.

- **One file, and D-SURF9 does not bite.** That rule is about TypeScript readers deployed ~9 minutes
  ahead of their schema. `custom_access_token_hook` is SQL in the same migration as the table it
  reads: they apply in the same instant and there is no window in which one exists without the other.
- **The read path was already built.** `sections` flows from the claim through `claimsToContext`
  (`packages/shared/src/auth.ts`) into `stores/session.ts` and out to every consumer, so S5 changed
  no TypeScript on the read side at all. The merge is `v_sections || v_user_sections` — the right
  operand wins — inside the existing `if v_role not in ('admin','driver')` guard.
- ⚠ **`jsonb_object_agg` over an empty set returns NULL, not `{}`**, so `role || user` is NULL
  whenever either half is absent, and a NULL written into `{sections}` would ERASE the org's answer
  rather than leave it alone. Both one-sided cases are asserted separately, because the naive merge
  passes the two-sided one. This is the same three-valued trap 0292 paid for once in
  `auth_section_view`; a different shape, the same lesson.
- **`access: null` is the reset**, as with S4 and for a sharper reason: a person has no shipped
  default to compare against. Their fallback is whatever their ROLE resolves to, which an admin can
  change afterwards, so storing today's answer would freeze it and stop tracking the role.
- **The `admin` section IS a CHECK constraint here**, where 0298's `surface_key` deliberately is not.
  D-PERM7 is a security boundary and a bad row must not be able to become authority; a bad surface
  key is inert. The role lock still cannot be a CHECK, for 0298's reason, and lives in the endpoint
  and in the hook — the hook being the layer that matters, since it is the one standing between a row
  and a claim.
- The hook's own `and section <> 'admin'` is **unreachable while the CHECK stands**, which would make
  it a line nothing exercises. The matrix drops the constraint, writes the row the schema forbids,
  asserts the mint still refuses it, and puts the constraint back — modelling exactly the "restore, a
  support action, a future writer" case 0292's header says the guard is for.

**Verified by:** `pnpm test` (unit + all 24 matrices — the new `user-section-access` matrix is 26
assertions and `rls` is 467 including this table), `pnpm typecheck`, `pnpm build`, `pnpm lint`, and
the whole CI gate list extracted from `ci.yml`, plus the chained `lint:rls` and
`lint:migration-ordering`.

**Mutation-tested, subject not test.** Thirteen mutations of the hook, the table and the endpoint.
One of them found a real gap **in S4's tests, not S5's**: dropping the `user_id` filter from the
delete passed every assertion in both files, so a write that should clear one member's cell could
have cleared that section for the whole org — invisible on the screen of the person being edited.
The code was right in both; the tests could not see it, and both now assert the delete's filters.

**Left for S6.** No read endpoint for per-user rows, and no UI. A per-user section change lands on
the member's next token refresh — up to an hour, `jwt_expiry = 3600` — where a per-user SURFACE
change lands on the next page load. D-PERM6 and D-SURF4 make that difference real and S6's page must
not average the two.

### S6 · The permissions page becomes editable — DONE 2026-09-03 (#496; no migration)
`EDITABLE-PERMISSIONS-PLAN.md` P5, extended: a **Roles** tab (the 7 × 11 section matrix plus each
role's surfaces) and a **People** tab (search a member, see their resolved access with each cell
marked *default* / *org override* / *user override*, reset per row). Keep the live sidebar preview
the P0 page already builds from `buildNavGroups` — after S1 it previews surfaces too, for free,
because it calls the same function the sidebar does.

D-PERM6's staleness sentence appears on **section** saves (up to an hour) and **not** on **surface**
saves (next page load). The difference is real and the UI must not average it.
**Prerequisite:** S3 and S4 shipped. S5 too, if the People tab offers section overrides — if S5 slips,
the tab ships with surfaces only and says so, rather than showing a control that saves nothing.

**What shipped.** Two read endpoints, a two-tab page, and no schema at all — every table this page
writes already existed.

- **The reads that were left for this step, shaped the way the People tab needs them.**
  `GET /api/section-access/user/:userId` and `GET /api/surface-access/user/:userId`, admin-only,
  org-scoped, mirroring the existing `GET /`s: each answers with the overrides AND the matrix or
  catalogue they are read against, so the client reconstructs no defaults (D-PERM4, D-SURF3).
- **They answer with the LAYERS UNMERGED, which is the one thing this endpoint does that no other
  consumer wants.** Everything else resolves and forgets — the auth hook mints one value,
  `surfaceClaimFor` merges the person over the role — because a request only needs to know what the
  caller may do. A cell reading `View` without saying which layer produced it is a control an admin
  cannot use: "reset" and "set to view" look identical on it and behave differently afterwards.
- ⚠ **Neither read applies the D-PERM7/D-PERM8 lock, deliberately.** That rule says who may be
  CHANGED. An admin still has to see what an `admin` or a `driver` member reaches, or the page cannot
  explain why it offers them no controls. The writes refuse them exactly as before.
- `lookupMemberRole` (`modules/org/memberLookup.ts`) — the membership lookup the two new GETs and the
  two per-user PUTs all need. It was six identical lines in four places, and the lines are where the
  role lock reads its role and where an admin's request is confined to their own tenant; a fifth copy
  written slightly differently is a cross-tenant read nothing refuses.
- **The catalogue now carries `level` as well as `section`.** A page cannot draw a screen cell
  without it: Import inside `fuel: "view"` is not a choice an admin has (D-SURF2), and saying *why*
  is the difference between a disabled control and a broken one.
- **The page**: a **Roles** tab — the 7 × 11 matrix with each departing cell showing what it would
  revert to, reset per row, plus a screens × roles grid and a role preview — and a **People** tab —
  one member's sections and screens with every cell marked *Default* / *Role override* / *Person
  override*, and their resolved sidebar. `buildNavGroups` draws both previews, so the page cannot
  become a second opinion about the product's navigation.
- **The two staleness contracts are said separately and never averaged** (D-PERM6 vs D-SURF4): a
  section save says it lands within the hour, a screen save says it lands on the next page load, and
  `SettingsPermissionsPage.test.ts` asserts each toast carries its own sentence and not the other's.
- **The per-person controls have three values** — "Follow their role" is `null` on the wire and the
  absence of a row, not a write of today's answer, which is what keeps a person tracking a role an
  admin changes later.
- **The page states what it does not govern** (Q-SURF1's fallback, twice required by this plan) and
  names the six screens no org may deny (Q-SURF3) beneath the preview that renders them.

⚠ **The 7 × 11 matrix renders seven rows and eleven columns and not nine by twelve.** `admin` and
`driver` are not rows and `admin` is not a column, and they are explained in a sentence rather than
rendered as disabled controls: a greyed row invites "why can't I", and the answer is a ruling
(D-PERM7/D-PERM8), not a permission. It also keeps the page reading exactly what `GET /` sends —
`defaults` covers the editable roles only, so a ninth row would have had to reconstruct the matrix.

**Verified by:** `pnpm test` (unit + all 52 matrices, `rls` 467, `org-section-access` 92,
`user-section-access` 26, `user-surface-access` 20, `org-surface-access` 18 — all unchanged, this
step touches no SQL), `pnpm typecheck`, `pnpm build`, `pnpm lint` (0 errors), and the whole CI gate
list extracted from `ci.yml` — `lint:migrations`, `lint:rls`, `lint:migration-ordering`,
`lint:surfaces`, `lint:capabilities`, `lint:upserts`, `lint:boundaries`, `lint:comment-claims`,
`lint:filesize`, `lint:funcsize`, `lint:tests`, `lint:secrets`, `lint:codegen`,
`lint:table-producers`, `lint:table-writers`, `lint:chart-colors`, `lint:cli-streams`,
`lint:light-dark`, `lint:token-schema`, `lint:tokens-parity`, `lint:ui-adoption`, `lint:ui-contrast`,
`--filter ./apps/web lint:tokens`. **Both snapshots are untouched** — this step changes no route and
no sidebar entry, so `navEquivalence.test.ts.snap` and `routeTable.test.ts.snap` show an EMPTY diff,
which is the review it was supposed to be.

**Mutation-tested, subject not test.** Twenty mutations — seven of the section read, seven of the
surface read, thirteen of the page and its cell logic — each failing a different assertion. Three
changed what shipped rather than confirming it, and all three are the same class this programme keeps
finding only this way:

- **Both per-user fixtures answered the same key at both layers**, so merging the role layer INTO the
  person's passed every assertion in both files. Each fixture now has a key only the role layer
  answers, and the merge fails on it.
- **The reset-row test overrode a section whose shipped default was already `none`**, so a reset that
  wrote `none` instead of the shipped value was indistinguishable from a correct one. It now overrides
  `equipment`, whose default is `view`.
- **The `level` assertion named `fuel.import`**, which FUEL-C4 retired the next day. It reads the
  first manage-level screen out of the catalogue now: a screen retiring is not a reason for this test
  to fail, but a `level` that stopped travelling is.

### S7 · Audit the gates the page cannot reach — DONE 2026-09-03 (#498; no migration)
Q-SURF1: the ~24 hard-coded `requireRole` lists and the 65 endpoints with no authorization. Each
either derives from the matrix, gains a surface gate, or gets a comment saying why it is open.
Independent of S1–S6 and shippable at any point. Until it lands, the permissions page governs most
of the product rather than all of it, and **S6 must say which surfaces are not yet governed** instead
of implying completeness.

**What the audit actually found, measured by walking the built app rather than parsing it.** §0's
figures were a static parse and said so; one half held and the other was four times too large.

| | §0 said | measured 2026-09-03 |
| --- | --- | --- |
| routes in the API | ~312–321 call sites | **351** |
| no gate of any kind | 65 | **40** — of which **27** sit under mounts already pinned public or machine-authenticated (`/api/tms` alone is 17 agent-ingest routes) |
| genuinely unexamined | — | **13** |
| literal `requireRole` lists that are not `requireRole("admin")` | ~24 | **25**, of which **18 equalled a section's derived set** |

The gap is one thing a static parse cannot see: a gate applied through a local const —
`const canHire = requireRole(...)`, `const canView = requireSection(...)` — makes every route under
it look ungated. The plan was right to say "±10 and a shape, not a census", and right to say do not
re-derive it by grep: the truthful version builds the real express app and walks the real middleware
stacks, which is what `routeGates.test.ts` already did one grain coarser.

**What shipped.**

- **18 gates now derive.** `requireRole("admin", "fleet_manager", "dispatcher")` and friends became
  `requireSection(...)` at every call site whose literal list EQUALLED its section's derived set:
  `insights/reports` (settings), `org/audit` (settings — the Recall audit and Reports screens,
  which is where the section comes from rather than from the path), `org/jobs` (settings),
  `samsara/integration` (settings), `routing/plans` and `posted-prices/networks` (dispatch),
  `evidence/complianceExports` (safety). Behaviour is identical for a claim-less token, which is the
  property that made an 18-site rewrite reviewable; what changes is that an org that re-answers the
  matrix now moves the API with it (D-PERM3).
- **7 literal lists stay, each with its argument** in `ROLE_LIST_WAIVERS`: the two driver-app role
  tests, the credential and identity-merge acts granted by NAME (their routers already made the
  argument at length — S7 only made it checkable), and Ask AI, whose list equals `hazmat/view` by
  pure coincidence and is recorded below as Q-SURF7.
- **3 of the 13 unexamined routes are now gated** — `GET /api/fueling/stations`,
  `/geocode-suggest` and `/vehicle-location` at `dispatch: view`. ⚠ **This is a narrowing and it is
  said out loud**: they were `requireOrg` alone, so any signed-in member could read the org's station
  prices or spend its geocoder quota. Both callers are Fuel Planning and Truck Stops, catalogued
  `dispatch`, and since S2's guard no role without `dispatch: view` can open either screen — so
  nothing a person can reach today stops working.
- **10 stay open, each with its argument** in `OPEN_ROUTES`: `GET /api/me` (the identity every page
  bootstraps from — a role gate there would be a gate on finding out what your role is), the
  map-config/tile proxies (no tenant data; `requireAuth` protects a vendor quota, not a row),
  `GET /api/jobs/latest` (a progress ping for one known job kind in the caller's own org, polled by
  every section's screens), invite acceptance (the one act a person with no org yet must perform), a
  driver's own push-token revoke, and the four Q-FUI12 reads — which are left as Q-FUI12 rather than closed in passing, because that
  question has an owner and a recommendation and answering it here would be doing so silently.
- **Two fitness functions, so this cannot rot** (`routeGateLedger.test.ts`): COVERAGE walks the built
  app per ROUTE — including the one route declared straight on the app rather than inside a mounted
  router, `GET /api/me`, which a mount-reading walker would never have reported and which is the
  endpoint every page bootstraps from — and fails on one with no gate that the ledger has not
  accounted for; FORM reads the
  source and fails on a literal multi-role list that is not waived — because a set comparison cannot
  tell a derived answer from a coincidence, which is precisely the Ask AI case. Both ledgers are
  SHRINK-ONLY: an entry that stops applying fails the build, so a route that gains a gate must lose
  its entry in the same PR.
- `AUTH_ONLY_MOUNTS` moved out of `routeGates.test.ts` into `testing/routeLedger.ts` beside the two
  new maps. Three files answering "what is deliberately open" is the restatement this programme
  exists to remove.
- **S6's caveat came out**, as this plan said it would. The page no longer says the product is not
  fully governed; it names the short list of what is decided elsewhere and why.

**Verified by:** `pnpm test` (unit + all 52 matrices — this step touches no SQL and every matrix is
unchanged; the api suite is 2756 including the three new fitness assertions), `pnpm typecheck`,
`pnpm build`, `pnpm lint`, and the whole CI gate list extracted from `ci.yml` plus the chained
`lint:rls` and `lint:migration-ordering`.

**Mutation-tested, subject not test.** Seven mutations, each failing a different assertion: reverting
one converted gate to its literal list (FORM), deleting a ledger entry (COVERAGE's unaccounted
clause), removing the gate S7 added to `/stations` (COVERAGE plus the named-narrowing test), a waiver
that no longer applies (FORM's stale clause), a walker that ignores `router.use` gates (COVERAGE, and
this is the one that matters — without it every route under a router-level gate reads as ungated), a
walker that finds nothing (the >300 completeness guard), and turning off comment-stripping, which
resurrects `app.ts`'s prose mention of `requireRole("admin", "fleet_manager")` as a call site. That
last one is the third time in this programme a gate has read its own comments; it is why the stripper
exists rather than being tidiness.

### S8 · The page redrawn as a master–detail — DONE 2026-09-03 (no migration)
S6 shipped the page as two grids: 77 selects in a 7 × 11 table, then 196 checkboxes in a 28 × 7
grid, then a preview — ~1,100 px wide, sideways-scrolling under a laptop width, and bracketed by two
paragraph-length callouts. The owner's verdict on 2026-09-03: "overwhelming, not really user
friendly, and a nightmare for smaller screens". The data, the four writes, the two staleness
contracts and every assertion's intent are unchanged; what changed is the shape.

**What shipped.**

- **One role, or one person, at a time.** The Roles tab is a rail of the seven editable roles (a
  vertical `AppTabs` at `lg`, a scrolling strip below it) beside one column of answers for the one
  picked; the rail counts each role's org answers ("2 custom") so a changed role is visible before
  it is opened. The People tab opens with nobody chosen — the composable's comment said so and the
  page contradicted it — and the picker is the form combobox every other page uses, which is a
  search for free.
- **The controls are the product's, not a narrower `<select>`.** `AppSegmentedControl` is new in
  `@silvicom/ui`: a `role="radiogroup"` drawn as one strip, roving tabindex, arrows, and an
  `inherited` state that draws the chosen segment outlined — for a person's row that is FOLLOWING
  their role rather than holding its own value. Screens are `AppSwitch`. `AppTabs` gained
  `orientation="vertical"` (Up/Down, `aria-orientation`) rather than the rail being a seventh
  hand-rolled tablist.
- **Provenance and reset only where a row departs.** A Roles row is untagged at its shipped default
  and tagged *Changed* with a "Reset to View" link when the org answered; a People row always says
  *Default* / *Role* / *Personal* and offers "Follow role (View)" only on a personal row. "Reset
  role to defaults" now covers screens as well as sections, and "Follow role everywhere" is the
  per-person mirror — both one write per row, for the reason S6 gave.
- **A group no screen in which is reachable is named, not drawn.** A technician's page no longer
  lists Recruitment, Finance and Settings as fifteen rows of refusals; it says "Not listed: …" under
  the Screens card. A group with SOME unreachable screens keeps them, each reading "Needs Fuel ·
  Manage" (D-SURF2 at the row).
- **The preview is a sidebar** — one column, in the navigation surface, built twice by
  `buildNavGroups` (with the principal's answers and with the shipped matrix) so an item the org
  took away is struck through rather than silently absent.
- **The copy moved to where it applies.** Each card's header carries its own staleness sentence
  (D-PERM6 beside sections, D-SURF4 beside screens); the "outside this page" paragraph is a
  disclosure at the foot. `SettingsPermissionsPage.test.ts` now asserts each sentence inside its own
  card and absent from the other's, which is a stronger pin than "both appear somewhere on the page".

**Verified by:** `pnpm --filter @silvicom/web test` (123 files, 1158 tests) and
`pnpm --filter @silvicom/ui test` (the new `AppSegmentedControl.test.ts` pins the radio-group
keyboard contract and that an inherited segment is still a working choice), `pnpm typecheck`,
`pnpm build`, `pnpm lint`, the whole CI gate list extracted from `ci.yml`, and
`--filter @silvicom/web lint:tokens`. Impeccable's mechanical detector over every changed file: no
findings.

**Left for the next steps, named so they are not mistaken for done.** The rail's at-a-glance strip
(one mark per section, coloured by level) needs a `#tab` slot on `AppTabs` and is not built;
`/api/members` is still e-mail only and one `auth.admin.getUserById` per membership (five members
today, so a scale gap rather than a live one); Q-SURF6's "next navigation corrects it" is still not
said in the UI. And the audit that preceded this step found the finding recorded as Q-SURF8 below,
which no redesign can fix.

## §6 Open questions

~~**Q-SURF1 — the gates an org's permissions page cannot reach.** ~24 endpoints on hard-coded role
lists, 65 with nothing beyond `requireAuth`.~~
**ANSWERED 2026-09-03 by S7, and the measurement corrected the question.** 351 routes, 39 with no
gate of any kind, 27 of those under mounts already pinned public or machine-authenticated — so the
genuinely unexamined set was 12, not 65. The role-list half held: 25 literal lists, 18 of which
equalled a section's derived set and now call `requireSection`. Every remaining one is in
`apps/api/src/testing/routeLedger.ts` with its argument, and two fitness functions fail the build if
a new route or a new literal list appears unexamined. See S7's entry for the split.

**Q-SURF7 — Ask AI answers for five roles that are nobody's derived set.** Found while answering
Q-SURF1 and left open deliberately. `POST /api/insights/ask` is gated
`requireRole("admin", "fleet_manager", "auditor", "dispatcher", "safety_manager")`, which equals
`rolesThatCanView("hazmat")` **by coincidence** — the assistant has nothing to do with hazmat, and
that coincidence is the exact reason S7's FORM check reads source rather than comparing sets. The
screen itself is catalogued `staff` (Q-SURF3) and is therefore not an org's to deny, so today the
list is the only thing deciding who may ask. Candidates: (a) leave it — the assistant reads across
fuel, dispatch and safety, so the union of those readers is defensible and the list is that union
minus `accountant`, `recruiter` and `technician`; (b) gate it on a section the assistant's answers
actually come from, which would be a union nobody has written; (c) make Ask AI an editable surface by
giving it a section, which is a product decision about a tool with no data of its own. Owner:
product. Recommendation: **(a)**, with the list waived and named as S7 has done, until somebody wants
Ask AI to be per-role configurable — at which point (c) is the honest answer and it costs a catalogue
entry, not a mechanism.

**Q-SURF8 — The page shows eight default cells the database does not enforce, and cannot repair
them.** Found by the 2026-09-03 audit that preceded S8, and verified LIVE in `pg_policies` rather than
read from a plan. Eight applied policies keep a role list as their `auth_section_or_default(...)`
fallback that disagrees with `SECTION_ACCESS` — the nine of `EDITABLE-PERMISSIONS-PLAN.md` Q-PERM11
minus the explained `drivers` one. Three checked by hand: `hazmat_loads_manager_insert` /
`_update` fall back to `[admin, fleet_manager, dispatcher]` while hazmat `manage` includes
`safety_manager`; `dva_write` falls back to `[admin, fleet_manager]` while roster `manage` includes
`safety_manager`; `idle_settings_write` includes `safety_manager` while equipment `manage` does
not. So the page reads "HazmatGuard: Manage" for a safety manager the database refuses.

⚠ **And an admin cannot fix it from the page.** `PUT /api/section-access` DELETES the row when the
value equals the shipped default (D-PERM4, by design) — so choosing the value already displayed
writes nothing, and the mint keeps answering from the fallback list. The page's own vocabulary has
no word for "the matrix, but really". Candidates: (a) P6 — fix the eight policies so the fallback
equals the matrix, which is the honest answer and needs the Q-PERM10/Q-PERM11 rulings first; (b)
mark the eight cells on the page as "not yet enforced", which is a workaround that would live for
exactly as long as P6 is unshipped and would have to be maintained by hand. Owner: product, for the
rulings; then one migration. Recommendation: **(a), before any further work on this page** — the
redesign makes those cells more legible, not less, and a legible wrong answer is worse than an
illegible one.

**Q-SURF2 — `hazmat` is editable but governs no screen.** The section gates RLS (0293 wrapped five
policies) but both hazmat nav items use `isStaff && moduleEnabled(...)`, and their routes are
`requiresAuth` only. An org setting `hazmat: none` today keeps both menu items and both pages, and
only loses the writes. Candidates: (a) point the two items and routes at `hazmat:view`/`manage` —
correct, and a narrowing for any role that has the module but not the section; (b) drop `hazmat` from
the editable matrix. Recommendation: (a), inside S2, where the other 28 are being fixed anyway — and note it is a
NARROWING for any role holding the `hazmatguard` module but not the `hazmat` section, so it wants
saying out loud rather than slipping in with a refactor.

⚠ **Evidence found while answering Q-SURF3, and it is close to decisive.** The web ALREADY asks the
hazmat section question — just for the wrong half of the same feature. `AppShell.vue:37` gates the
pending-review COUNT on `session.canView("hazmat") && moduleEnabled(...)`, while `nav.ts:179/185`
gates the ITEM on `isStaff && moduleEnabled(...)`. So a role with `hazmat: "none"` sees "Hazmat
review" in the sidebar, permanently without its badge, and can open the queue. Two adjacent files
answering the same question differently is the drift this plan exists to end, and it is already here.

~~**Q-SURF3 — the six items outside the matrix.**~~
**ANSWERED 2026-09-02 — owner's ruling: catalogue all six, none of them editable.** They appear in
the permissions preview so a reader can see the whole sidebar, and no cell offers to change them.
Working through what that implies moved two things in §3, and neither departs from the ruling:

**1. The six do not share one gate, so the catalogue needs three kinds rather than one.** Measured:

| surface | path | gate today | route gate today |
| --- | --- | --- | --- |
| Dashboard | `/` | none | `requiresAuth` |
| Fuel Log | `/fuel-log` | none | `requiresAuth` |
| Ask AI | `/ask` | `isStaff` | `requiresAuth` |
| Placard calculator | `/hazmat/calculator` | `isStaff` + module `hazmatguard` | `requiresAuth` |
| Hazmat review | `/hazmat/review` | `isStaff` + module `hazmatguard` | `requiresAuth` |
| Users | `/settings/users` | `isAdmin` | `requiresAdmin` |

So `SurfaceGate` is a discriminated union — `section` / `staff` / `admin` — with `module` AND-ed on
top. `ModuleKey` already lives in `packages/shared/src/entitlements.ts`, so this adds no dependency,
and moving the module condition into the catalogue REMOVES a restatement: `nav.ts` states it three
times today.

**2. `editable` is DERIVED, not stored.** A surface is editable exactly when its gate is a section
gate, because a section is the only thing an org's matrix can move. Storing an `editable: false`
beside a gate that already says so would be a second home for one fact — the rule D-SURF3 states, and
the one this plan's own review caught it breaking once already. The ruling is honoured in substance
(all six are non-editable, and the page renders them as such); only the mechanism is derived rather
than written down twice.

**3. ⚠ `editable: false` does not mean ungated, and must not be read that way.** Five of the six have
no route gate at all. Two things make that less alarming than it looks, both measured rather than
assumed. The `staff` gate is currently EQUIVALENT to `requiresAuth`, because `isStaff` is
`role != null && role !== "driver"` and `router/index.ts:99` sends every driver to `/use-the-app`
before any route renders — no non-staff user can reach a web route at all. And the `module` half IS
enforced server-side by `requireModule` (`middleware/requireModule.ts`, applied at the hazmat and
dispatch routers), so an org without `hazmatguard` opening `/hazmat/calculator` by URL gets a page
that mounts and then 403s. That is the same class as the 28-route gap in §0 — a broken page rather
than a leak — and S2 closes it for these six along with the rest, because the guard reads their gate
out of the catalogue like any other surface's.

**4. The count is six TODAY, and Q-SURF2 is what could reduce it.** If Q-SURF2 is answered (a), the
Placard calculator and Hazmat review move from a `staff` gate to a `section` gate and become
editable, leaving four. That is a sequencing fact rather than a contradiction: this ruling describes
the surfaces that have no section, and Q-SURF2 decides whether two of them should acquire one.

~~**Q-SURF4 — user-override blast radius on the token.**~~
**ANSWERED 2026-09-02 — measured, and the cap is not needed.** The worst case is one person answered
for on every editable section, and `supabase/tests/user-section-access.test.mjs` mints exactly that
token: **219 bytes of JSON across 11 sections, ~292 bytes base64url in the JWT payload.** That is the
ceiling, not a sample — 11 is the whole editable vocabulary (D-PERM7 removes the twelfth), the values
are one of three short words, and the claim REPLACES the role's rather than adding to it, so a person
with overrides is not larger than the role plus the person. Against an 8 KB header limit it is
noise, and the fallback ("cap the claim and fail the write with a named error") is not built,
deliberately: a cap that can never be reached is a branch nothing tests. If `APP_SECTIONS` ever grows
by an order of magnitude, re-run that matrix — it prints the number on every run rather than
asserting a threshold nobody has agreed.

~~**Q-SURF5 — `/settings` is gated at `manage` while its sidebar entry asks `view`.**~~
**ANSWERED 2026-09-02 — option (a), owner's ruling; shipped.** The route dropped to `view`.
`SettingsPage.vue` needed no change: every card already carried its own `show`, `manageOrRead`
already existed for the read-only case, `Fleet readiness` already sat behind `session.can('settings')`
and the empty state was already there — which is itself the evidence about which half was wrong. An
auditor now sees the Audit log card and the four read-only report cards, and every link they see
resolves.

A `requiresView?: AppSection` meta was added beside `requiresManage` and resolved through
`session.canView`, because nothing could express "readable" before — that is why the mismatch had
nowhere to be written correctly. `lint:capabilities` now polices both metas on one rule.
⚠ **The other 27 routes were deliberately not backfilled**, and the meta's own comment says so: S1/S2
resolves a route to its section through the catalogue, so 27 hand-written metas now would be 27
copies of a fact that step makes derivable. **This meta is expected to be subsumed by S2's guard, not
extended.** `sectionGuard.test.ts` was written with the fix — nothing drove the guard before, which
is how the two halves disagreed unnoticed.

**Q-SURF6 — what does a denied surface do to a deep link that is already open?** A user viewing
`/shop/inspectors` when an admin revokes it keeps the mounted page until they navigate; the guard
only runs on navigation. Candidates: (a) accept it, the next navigation corrects it (the same
contract D-PERM6 already set for sections, and the API refuses writes meanwhile); (b) re-check on
window focus. Recommendation: **(a)**, stated in the UI, because (b) buys little for a permission
model whose data half is already a token-refresh behind.

---

## §7 What would make this a workaround, so it can be recognised

- **Hiding a menu item without gating its route.** That is the defect §0 measures 27 times over;
  building the permissions page on top of it would industrialise it.
- **A second home for "which section does this screen need".** It lives in the catalogue (D-SURF3).
  A copy in `nav.ts`, in a route meta literal, or in an API constant is a copy with a delay fuse.
- **Letting a surface grant across sections** (D-SURF2) — a page whose data the section refuses is
  either an empty page or a hole.
- **Putting surface entitlements in the JWT** because sections are there. Sections are there for a
  measured reason that does not apply to surfaces (D-SURF4), and following the pattern instead of the
  reason costs the immediacy for nothing.
- **Marking an endpoint exclusive to a surface without checking its callers** (D-SURF5). The
  inspector picker is the worked example of what that breaks, and it would break at the moment
  somebody is trying to record a federal inspection.
- **Shipping S6 before S3/S4/S5.** The exact mistake `EDITABLE-PERMISSIONS-PLAN.md` §4 names: a page
  that saves permissions nothing enforces.
- **Hand-writing the 28 route gates before the catalogue exists.** The first draft of this plan did
  exactly that, and §5 explains the swap; it is left recorded rather than quietly corrected, because
  a plan that hides its own near-miss teaches nothing.
