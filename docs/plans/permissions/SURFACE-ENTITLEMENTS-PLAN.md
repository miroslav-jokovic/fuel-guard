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
| web router | `apps/web/src/router/routes/*.ts` + `index.ts` guard | section | 69 routes carrying `meta`; **only 16 gated**. `requiresManage` (15) and `requiresAdmin` (5) exist; **there is no `requiresView` meta at all** |
| API | `requireSection` / `requireRole` middleware | section × level | 312 endpoints: **141** section-gated, **106** `requireRole`, **65** with nothing beyond `requireAuth` |
| database | RLS policies | section × table × command | **44** policies section-wrapped by 0293/0294/0295 |

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

Joining every route to its sidebar entry produces **27 routes whose nav entry knows a section and
whose route does not gate on it**. For each of these, hiding the menu item hides nothing: the URL
is typed, the page mounts, and only the API refuses the data — so the user sees a broken page rather
than a closed door.

```
/messages  /assignments  /loads                      dispatch:view
/drivers   /compliance                               roster:view
/accounting  /cpm  /cost-schedule                    accounting:view
/billing                                             billing:view
/shop  /shop/inspections  /shop/inspectors           maintenance:view
/vehicles  /trailers  /odometer                      equipment:view
/idling  /anomalies                                  safety:view
/truck-stops                                         dispatch:view
/fuel-planning                                       dispatch:manage
/transactions  /rejections  /fuel-cards
  /fuel-spend/exceptions  /ifta                      fuel:view
/recruitment  /recruitment/screening
  /recruitment/inquiries                             recruitment:view
```

A further seven detail routes have neither a gate nor a nav entry, and inherit nothing today:
`/loads/:id`, `/drivers/:id`, `/compliance/:id`, `/vehicles/:id`, `/fuel-cards/:id`,
`/recruitment/:id`, `/shop/inspections/:id`.

**This is fixable on its own and is worth shipping before anything in this plan** — see S1.

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

### D-SURF3 — One catalogue, three consumers, zero restatements
A single typed `SURFACES` registry in `packages/shared` is the source of truth. The sidebar, the
router metas and the API's surface middleware all **derive** from it. Today the same fact — "Cards
belongs to fuel:view" — is written once in `nav.ts` and nowhere else, which is why the 27-route gap
exists at all. A second home for that fact is the workaround this repo's rules name; a gate
(`lint:surfaces`) enforces the single home.

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
(`POST`/`PATCH`/`DELETE`) do belong to the register and are gated with it. Each catalogue entry
lists its exclusive endpoints explicitly; the default is the empty list, because claiming an endpoint
is exclusive when it is not takes a working page down.

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

---

## §3 The surface catalogue

Shape (illustrative — the real literal lands in S2):

```ts
export interface Surface {
  key: string;              // "maintenance.inspectors" — stable, storable
  label: string;            // "Inspectors" — the sidebar name
  path: string;             // "/shop/inspectors"
  section: AppSection;      // the DATA it needs; a surface can never exceed this
  level: SectionAccess;     // "view" | "manage" — the level within that section
  parent?: string;          // detail routes point at their list surface (D-SURF8)
  exclusiveEndpoints?: string[]; // D-SURF5; default [] — shared reads are NOT listed
}
```

Seeded from the measured join of `nav.ts` and `router/routes/*.ts`: **37 nav entries + 7 detail
routes**, across 11 sections. The maintenance section, which is the owner's worked example:

| key | label | path | section:level | exclusive endpoints |
| --- | --- | --- | --- | --- |
| `maintenance.repair-spend` | Repair spend | `/shop` | maintenance:view | — |
| `maintenance.inspections` | Annual inspections | `/shop/inspections` | maintenance:view | `POST/PATCH /api/maintenance/inspections*` |
| `maintenance.inspections.detail` | — | `/shop/inspections/:id` | (parent) | — |
| `maintenance.inspectors` | Inspectors | `/shop/inspectors` | maintenance:view | `POST/PATCH/DELETE /api/maintenance/inspectors` |

Six items sit **outside** the section matrix today and need a ruling before they can be catalogued —
`Dashboard` and `Fuel Log` (`show: true`, drivers included), `Ask AI` (`isStaff`), `Placard
calculator` and `Hazmat review` (`isStaff` + module), `Users` (`isAdmin`). Registered as **Q-SURF3**.

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

## §5 Steps

### S1 · Close the 27-route gap — `requiresView`, and every route names its section
No schema. Add a `requiresView?: AppSection` meta and the one guard line beside the existing
`requiresManage` check; backfill the 27 routes in §0 and give the 7 detail routes their parent's
gate. This makes **today's** section permissions real at the router, independent of everything below.

**Done when:** typing `/transactions` as a role with `fuel: none` lands on the dashboard, not on a
broken page. **Gate:** extend `lint:capabilities` — it already refuses a `requiresManage` that does
not name a section; it must also refuse a route with a sidebar entry whose section the route does not
gate on. **Verified by:** a router-guard unit test per section, and `nav.test.ts` extended to assert
nav gate and route gate agree for every catalogued path.

### S2 · The catalogue, deriving the sidebar — no behaviour change
Introduce `SURFACES` in `packages/shared`, rewrite `buildNavGroups` to fold over it instead of
hand-listing 37 entries, and re-point S1's route metas at it. Nav output must be **byte-identical**
for all nine roles — that equality is the review.
**Gate:** `lint:surfaces` — every catalogued path is a real route, every gated route is catalogued,
no surface's level exceeds its section. **Verified by:** a snapshot test of `buildNavGroups` per
role, taken before the change and unchanged after.

### S3 · Per-role surface entitlements
Table `org_role_surface_access (org_id, role, surface_key, allowed, updated_at, updated_by)`, sparse
per D-SURF6, RLS-read by the org, written only through the audited API. Served by `/api/me`
alongside the section claim (D-SURF4); the router guard and the nav read it. Exclusive endpoints
(D-SURF5) gain a `requireSurface()` middleware.
**Done when:** an org can hide Repair spend and Inspectors from `technician` and the technician's
sidebar, router and the register's write endpoints all agree — while the New Inspection drawer still
loads its inspector list.

### S4 · Per-user overrides, both kinds
`user_section_access (org_id, user_id, section, access)` — read by `custom_access_token_hook`, one
more sparse `jsonb_object_agg` merged **over** the role's answer inside the existing `if v_role not
in ('admin','driver')` guard. And `user_surface_access (org_id, user_id, surface_key, allowed)` —
served by `/api/me`. Both audited.
⚠ The hook is the one function that turns a row into authority: the D-PERM7/D-PERM8 locks are
re-applied here, as 0292's header requires, and a user override may never produce a section the role
could not have been granted.
**Done when:** `xxx@silvicominc.com` on the `technician` role sees only Annual Inspections, and no
other technician is affected.

### S5 · The permissions page becomes editable
`EDITABLE-PERMISSIONS-PLAN.md` P5, extended with what this plan adds: a **Roles** tab (the 7 × 11
section matrix plus each role's surfaces) and a **People** tab (search a member, see their resolved
access with each cell marked *default* / *org override* / *user override*, and reset per row). Keep
the live sidebar preview the P0 page already builds from `buildNavGroups` — it is the only honest
answer to "what will this person actually see", and it now has a per-user input to preview.
D-PERM6's sentence appears on section saves (up to an hour) and **not** on surface saves (next page
load) — the difference is real and the UI must not average it.

### S6 · Audit the gates the page cannot reach
Q-SURF1: the ~24 hard-coded `requireRole` lists and the 65 endpoints with no authorization. Each
either derives from the matrix, gains a surface gate, or gets a comment saying why it is open. Until
this ships, the permissions page controls most of the product, not all of it, and S5 must not imply
otherwise.

---

## §6 Open questions

**Q-SURF1 — the gates an org's permissions page cannot reach.** ~24 endpoints on hard-coded role
lists, 65 with nothing beyond `requireAuth`. Owner: engineering. Recommendation: fold into S6; do not
let S5 claim completeness before it. Fallback if S6 slips: S5's page states plainly which surfaces
are not yet governed.

**Q-SURF2 — `hazmat` is editable but governs no screen.** The section gates RLS (0293 wrapped five
policies) but both hazmat nav items use `isStaff && moduleEnabled(...)`, and their routes are
`requiresAuth` only. An org setting `hazmat: none` today keeps both menu items and both pages, and
only loses the writes. Candidates: (a) point the two items and routes at `hazmat:view`/`manage` —
correct, and a narrowing for any role that has the module but not the section; (b) drop `hazmat` from
the editable matrix. Recommendation: (a), inside S1, where the other 27 are being fixed anyway.

**Q-SURF3 — the six items outside the matrix.** Dashboard and Fuel Log are deliberately open to
drivers; Ask AI, Placard calculator and Hazmat review are any staff role; Users is admin-only. Are
these surfaces an org may deny, or product constants? Recommendation: catalogue all six with an
`editable: false` flag so they appear in the preview and cannot be edited — invisible items make a
permissions page look broken, and Q-SURF2 shows what happens when nav and matrix disagree quietly.

**Q-SURF4 — user-override blast radius on the token.** A per-user *section* override enters the JWT
(D-SURF7). Sparse keeps it small, but there is no measured bound yet. Owner: engineering, during S4.
Fallback: cap the claim and fail the write with a named error rather than mint a token that some
proxy silently truncates.

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
- **Shipping S5 before S3/S4.** The exact mistake `EDITABLE-PERMISSIONS-PLAN.md` §4 names: a page
  that saves permissions nothing enforces.
