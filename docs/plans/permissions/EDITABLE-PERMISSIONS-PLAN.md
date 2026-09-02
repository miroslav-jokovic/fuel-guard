# Editable permissions — the section matrix becomes data an admin owns

**Status: ACTIVE PLAN.** Decision-log document per the house convention; execution protocol is
RECRUITING-SYSTEM-PLAN §4 and it governs every step here. Decision IDs are `D-PERM*`. Written
2026-09-02 from a measurement of the authorization machinery at `origin/main` = e00625f, migrations
through 0285. Where this document and a `lint:*` gate disagree, the gate wins and this file has
rotted — fix the file.

**What the owner ruled on 2026-09-02** (verbatim intent, recorded so no session re-litigates it):

> "We don't have permissions page where we can set permissions for users, and control exactly what
> they can see on dashboard."

Offered three scopes — a read-only reference page, per-member deny-only narrowing, or a fully
editable per-org matrix — the owner chose **the fully editable matrix**, knowing it rewrites the
policies. That ruling is the premise of everything below. (→ D-PERM1)

---

## §0 Ground truth (measured 2026-09-02)

### What exists

- `SECTION_ACCESS` in `packages/shared/src/auth.ts:118` is a **compile-time literal**: 10 roles ×
  12 sections. `canManageSection` / `canViewSection` / `rolesThatManage` / `rolesThatCanView` read
  it and nothing else.
- **The database does not read that literal.** `0078_role_department_rls.sql` and its successors
  derived each policy from `rolesThatManage(section)` **by hand, per table, at authoring time** —
  auth.ts's own header says so. The mirror is human.
- `lint:section-policies` (D-SEP10) checks that role lists in migrations **above 0260** match the
  matrix. Everything below 0260 is grandfathered wholesale, on the stated grounds that
  re-deriving 260 migrations' final policy state by regex would be a guess.

### The blast radius, counted

| Surface | Sites | How they ask |
| --- | ---: | --- |
| RLS policies in the live schema | **110** `auth_role()` references, in **~89** role-list predicates | `auth_role() = ANY (ARRAY['admin','fleet_manager'])` |
| Migrations containing them | **59** | — |
| API route guards | **157** `requireRole(...)` calls | **144** spread `rolesThatManage/rolesThatCanView` |
| Web capability checks | **59** `session.can/canView` | via `canManageSection/canViewSection` |

The thirteen distinct role-list shapes in the schema:

```
 31  ['admin','fleet_manager']
 19  ['admin','fleet_manager','dispatcher']
  8  ['admin','fleet_manager','technician']
  8  ['admin','fleet_manager','safety_manager']
  5  ['admin','fleet_manager','safety_manager','recruiter']
  4  ['admin','fleet_manager','technician','auditor','accountant']
  3  ['admin','safety_manager']
  3  ['admin','safety_manager','recruiter']
  3  ['admin','fleet_manager','safety_manager','auditor','recruiter']
  2  ['admin','fleet_manager','safety_manager','auditor']
  1  ['admin','fleet_manager','driver']
  1  ['admin','fleet_manager','dispatcher','auditor']
  1  ['admin','auditor']
```

### The one measurement that decides the architecture

`auth_role()` (`0002`, redefined in `0213`) carries **no `set search_path`**, which is why Postgres
can inline it into every policy predicate. `set search_path` on a scalar helper measured a **128×
per-row penalty** in this repo and took the fuel-spend page down silently
(`docs/plans/fuel/…`; the memory note is "`set search_path` blocks SQL inlining").

Every policy in the product evaluates its predicate **per row**. So the resolution mechanism this
plan introduces cannot be a table join and cannot be a `security definer` function with a pinned
search path. That constraint is not a preference — it is the difference between this shipping and
this taking the product down. (→ D-PERM3)

---

## §1 Decisions

### D-PERM1 — The matrix becomes per-org data; roles stay fixed
An org edits **what a role may do**, not which roles exist. Ten roles × twelve sections is already
the vocabulary the whole product speaks; letting an org invent a role would mean inventing nav
groups, route metas and policy predicates for it, which is a different and much larger product.
An org that needs a different shape expresses it by editing an existing role's row.

`admin` is **not editable** and holds `manage` on every section permanently. Something has to be
able to restore a matrix that has been edited into a corner, and an admin who can revoke their own
`admin: manage` is an org locking itself out with no support path. (→ pinned by a test, §3 P2)

### D-PERM2 — The effective matrix is resolved at token-mint time and carried as a claim
The auth hook (`0006`) already injects `org_id` and `user_role`. It gains a third claim — a compact
`sections` object, `{"fuel":"m","roster":"v",…}` — resolved from the org's overrides layered over
the shipped defaults.

**This is the same staleness `user_role` already has.** Changing a member's role today does not
take effect until their token refreshes; `SettingsUsersPage.vue:132` says so out loud ("You may
lose admin access after your next sign-in"). A permission change inherits exactly that contract,
and the UI must state it in the same words. It is not a new compromise, it is the existing one.

Rejected: joining `org_section_access` inside each policy. Correct instantly, and it puts a
subquery in ~89 per-row predicates — see §0's inlining measurement.

### D-PERM3 — SQL asks `auth_section(section) `, a plain inlinable `sql` function
```sql
create or replace function auth_section(p_section text)
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'sections' ->> p_section;
$$;
```
No `security definer`, no `set search_path`, no table access — deliberately identical in shape to
`auth_role()`, so it inlines the same way. The `nullif` guard is the one `0213` had to add to
`auth_role()` after it raised `22P02` on an empty setting; it is copied here rather than
rediscovered.

Two derived helpers, `auth_can_manage(section)` and `auth_can_view(section)`, keep policy bodies
readable.

**Backward compatibility is the whole safety story.** A token minted before this ships has no
`sections` claim, so `auth_section()` returns null. Policies are therefore written as
`auth_can_manage('equipment') or auth_role() = ANY (ARRAY[…])` during the transition, and the role
list is removed only in the step **after** every live token can be assumed to carry the claim. A
policy that drops the fallback early logs every existing session out of its own data.

### D-PERM4 — The shipped defaults are generated from `auth.ts`, never retyped
`SECTION_ACCESS` stays the source of truth for what a role means **out of the box**. A migration
seeds `role_section_defaults` from it, and `pnpm gen:rules`-style codegen keeps them equal, gated.
A second hand-maintained copy of the matrix in SQL is exactly the failure `docs/ARCHITECTURE.md`
and this repo's no-workarounds rule name; the copy must be derived or it is debt with a delay fuse.

### D-PERM5 — `lint:section-policies` is extended, not bypassed
Today it checks that a migration's role lists match the matrix. It gains a second rule: a policy on
a table whose module maps to a section must ask `auth_can_*`, not a bare role list, unless it
carries the existing waiver line. Without this the next feature adds policy #90 in the old shape
and the matrix stops being editable for that table alone — silently, which is the worst way.

---

## §2 Open questions — **these block P3 and must be answered by the owner**

- **Q1. How fast must a permission change take effect?** D-PERM2 buys its performance with
  staleness bounded by the access-token TTL (1h by default; a page reload does not refresh it).
  Candidates: (a) accept it and say so in the UI — matches how role changes already behave, zero
  extra machinery; (b) shorten the token TTL org-wide, which multiplies refresh traffic for
  everyone to serve a rare event; (c) revoke the affected users' sessions on save, which is
  correct-and-immediate but signs people out mid-task. **Recommendation: (a)**, with (c) offered as
  an explicit "sign them out now" checkbox on the save.
- **Q2. Does an org get to widen a role beyond its shipped default, or only narrow it?** The ruling
  said "fully editable", which reads as widening allowed. But widening `recruiter` to
  `equipment: manage` walks straight back into the leak `RECRUITER-ROLE-SCOPE.md` closed, and
  widening anything to `admin: manage` is a privilege-escalation path that does not exist today.
  **Recommendation: widening allowed EXCEPT into `admin`**, which stays admin-only and is the
  section that grants user management. Needs an explicit ruling because it is a security boundary.
- **Q3. Is `driver` editable?** It is `none` everywhere by design — drivers use the driver app and
  the web guard bounces them (`router/index.ts:97`). Granting a driver a web section would put
  them on a dashboard the guard refuses to render. **Recommendation: `driver` is not editable**,
  for the same structural reason `admin` is not.

---

## §3 Steps

Each step is one PR, in order, and each must work against the **previous** schema for the ~9-minute
deploy window (`docs/MIGRATION-DISCIPLINE.md` §the-deploy-window). A column and its first reader
ship in two merges — `lint:migration-ordering` enforces it and this plan has four such pairs.

- **P0 — The read-only page, shipped first.** Promote the collapsed matrix at
  `SettingsUsersPage.vue:151` to `/settings/permissions` with a nav entry, a route meta, and a
  per-member "what this person sees" view derived from `buildNavGroups`. No schema. It is the
  answer to "at least i dont see it" on its own, it is what the editable page is built on, and if
  P1–P6 stall it has still delivered.
- **P1 — Tables.** `role_section_defaults` (generated from `auth.ts`) and `org_section_access`
  (org_id, role, section, access). Both `enable row level security`; `org_section_access` readable
  by the org, writable by nobody through PostgREST — writes go through the API so they carry an
  audit row. New tables are exempt from the ordering gate. **No reader ships in this PR.**
- **P2 — Resolution, unread.** `auth_section` / `auth_can_manage` / `auth_can_view`, the auth-hook
  change that injects `sections`, and the codegen + gate that keep the defaults equal to `auth.ts`.
  Policies are untouched. After this merge every newly minted token carries the claim; nothing
  consults it yet. This is the deploy-window pair for P3.
- **P3 — The API and the web read the claim.** `AuthContext` gains `sections`; `requireSection()`
  replaces the 157 `requireRole(...rolesThatManage(x))` spreads; `session.can()` reads the claim
  with the compile-time matrix as the fallback for a claim-less token. Behaviour is identical
  until an override row exists, which is what makes this reviewable.
- **P4 — The policy rewrite, in module batches.** ~89 predicates become
  `auth_can_manage('x') or auth_role() = ANY (ARRAY[…])`. Batched by owning module so each PR's
  PGlite matrix covers one blast radius, not all of them. The `rls` matrix (459 assertions) is the
  net.
- **P5 — The editable page.** P0's table becomes editable per role × section, admin-only, with the
  staleness sentence from Q1, a diff-against-default indicator, and a "reset to default" per row.
  Every save writes an audit row.
- **P6 — Drop the fallbacks.** Only after a full token TTL has elapsed past P4's deployment. The
  `or auth_role() = ANY (…)` half comes out and `lint:section-policies` starts refusing new role
  lists (D-PERM5).

## §4 What would make this a workaround, so it can be recognised

- Shipping P5 before P3/P4 — a page that saves rows nothing enforces is a UI that lies about
  security, and it would take a real incident to discover.
- Hand-writing the SQL defaults instead of generating them (D-PERM4).
- Giving `auth_section()` a `set search_path` "for safety" (D-PERM3, §0).
- Letting the web decide access from the override table directly rather than from the claim the
  API and the database both read — a third source of truth for the same question.
