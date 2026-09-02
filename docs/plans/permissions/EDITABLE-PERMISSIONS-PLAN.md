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

- `SECTION_ACCESS` in `packages/shared/src/auth.ts:118` is a **compile-time literal**: 9 roles ×
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

### D-PERM4 — The claim is a SPARSE DELTA, so the defaults never need a second home
**Revised 2026-09-02, before any of it was built.** The first draft of this decision had the auth
hook resolve a COMPLETE matrix, which meant the database needed to know the shipped defaults, which
meant a `role_section_defaults` table, which meant codegen and a drift gate to keep that table equal
to `auth.ts`. All of that machinery exists only to give the defaults a second home — and a second
home for a fact is the thing this repo's no-workarounds rule is about.

So the claim carries **only the overrides**. `{"safety":"v"}` means "safety is overridden to view";
a section that is absent is not "denied", it is "unchanged". Each consumer already holds the
defaults, in the form it already uses:

- **API and web** hold `SECTION_ACCESS` at compile time:
  `effective(role, s) = claim[s] ?? SECTION_ACCESS[role][s]`.
- **SQL** holds the default as the role list already written into the policy:

  ```sql
  case when auth_section('safety') is not null
       then auth_section('safety') = 'm'
       else auth_role() = ANY (ARRAY['admin','fleet_manager','safety_manager'])
  end
  ```

The role list is not a transitional fallback to be removed later — it **is** the default branch, and
it stays. That matters twice over: `lint:section-policies` (D-SEP10) already asserts those lists
equal `rolesThatManage(section)`, so the SQL defaults stay honest **for free, under a gate that
already exists**; and a token minted before any of this shipped carries no `sections` claim, takes
the default branch on every section, and behaves exactly as it does today. There is no window in
which old sessions lose access.

What this deletes from the plan: the `role_section_defaults` table, its seed, its generator, its
drift gate, and the entire P6 "drop the fallbacks" step — six pieces of machinery that existed to
solve a problem the sparse form does not have.

### D-PERM5 — `lint:section-policies` is extended, not bypassed
Today it checks that a migration's role lists match the matrix. It gains a second rule: a policy on
a table whose module maps to a section must ask `auth_can_*`, not a bare role list, unless it
carries the existing waiver line. Without this the next feature adds policy #90 in the old shape
and the matrix stops being editable for that table alone — silently, which is the worst way.

---

## §2 Owner rulings, 2026-09-02 — these were the open questions; they are answered

Recorded verbatim in intent so no session re-litigates them. All three were the recommendation
attached to the question, and all three are security boundaries rather than preferences.

### D-PERM6 — A permission change lands on the next token refresh, and the UI says so
Ruled: accept the staleness D-PERM2 buys, and state it at the point of saving. Rejected: shortening
the org's token TTL (it multiplies refresh traffic for every user, permanently, to serve a rare
event), and force-revoking sessions on save (it signs people out mid-task).

This is not a new contract. Changing a member's ROLE already behaves exactly this way, and
`SettingsUsersPage.vue:132` already warns about it. The save confirmation must therefore say the
same thing in the same register:

> Takes effect the next time each dispatcher's session refreshes — within an hour, or immediately
> if they sign out and back in.

⚠ The corollary a future step must not forget: **revoking** access is subject to the same delay. A
member whose section is taken away keeps it until their token turns over. Where that is not
acceptable for a specific act — removing somebody entirely, say — the existing member-removal path
is the instrument, not this page.

### D-PERM7 — An org may widen a role as well as narrow it, but never into `admin`
Ruled: "fully editable" means what it says — an org that needs its dispatchers to read Safety may
grant it. Two locks stand:

- **The `admin` SECTION is not grantable to any role.** It is the section that carries user
  management, so granting it is a privilege-escalation path that does not exist in the product
  today, and an editable matrix must not invent one. An org that wants a second administrator
  promotes a member to the `admin` ROLE on the Users page, which is audited and already exists.
- **The `admin` ROLE is not editable** and holds `manage` everywhere (D-PERM1). Something must be
  able to restore a matrix edited into a corner.

Widening is therefore allowed across eleven of the twelve sections. This *is* a real re-opening of
narrowings the product made deliberately — `recruiter` was cut off from `equipment` (D-ROS12) and
`dispatcher` from `recruitment` (§391.53(a)(1)) for stated reasons — so the editable page must show
those reasons where the org is about to overrule them: a cell that departs from its shipped default
is marked, and the sections carrying a regulatory argument carry it in a hover. An org may overrule
us; it may not do so without being told what it is overruling.

### D-PERM8 — The `driver` role is not editable
Ruled: locked at `none` everywhere. `router/index.ts:97` redirects `role === "driver"` to
`/use-the-app` before any section check runs, so a section granted to a driver would be a permission
that visibly does nothing — the worst kind, because it reads as a product that lies. Making it mean
something is a different project (putting drivers on the web dashboard), not a permissions feature.

Together with D-PERM7 the editable surface is exactly **7 roles × 11 sections** — `fleet_manager`,
`dispatcher`, `safety_manager`, `auditor`, `recruiter`, `accountant`, `technician`, across every
section except `admin`. (Nine roles ship; `admin` and `driver` are the two locks above.)

## §2b Position, measured 2026-09-02 at `origin/main` = de9a8eb (live: schema 0293)

**P0, P1, P2, P3 and P4 batch 1 are SHIPPED and DEPLOYED.** Merged as #463, #467, #465, #466, #469.
(#464 was closed unmerged — GitHub closes a stacked PR when its base branch is deleted rather than
retargeting it, and a closed PR cannot have its base changed. #467 is the same commit rebased.)

An org can record an override, the token carries it, the API and the web read it, and the database
honours it for **dispatch, hazmat, roster and equipment**. Nothing is editable in the UI yet, so no
override row exists in production and every one of these paths is currently taking its default
branch — which is why applying all of it changed no behaviour.

### The remaining P4 inventory, exact

Counted by the pattern that matters — a policy carrying `auth_role() = ANY (ARRAY[…])` whose table
maps to an EDITABLE section. **17 wrapped, 35 remaining.**

| section | policies | tables |
| --- | ---: | --- |
| `fuel` | 12 | `anomalies`, `declined_transactions`, `efs_transactions`, `fuel_cards`, `fuel_discount_rules`, `fuel_transactions`, `import_rows`, `imports`, `route_fuel_settings`, `station_geocode_learned` |
| `safety` | 9 | `certifications`, `documents`, `dq_exports`, `psp_requests`, `qualification_records` |
| `maintenance` | 8 | `maintenance_inspectors`, `maintenance_print_profiles`, `vehicle_inspection_items`, `vehicle_inspections` |
| `recruitment` | 6 | `driver_authorizations`, `driver_employment_history`, `employer_inquiries`, `seven_day_statements` |

⚠ **Do not count `auth_role()` mentions.** The applied schema has 109 of them and only 58 are section
role lists; the rest are `auth_role() <> 'driver'` guards and driver-scoping predicates, which are
not section questions and must NOT be wrapped — doing so would put an org-editable answer on "is
this caller the driver app". Six further role-list policies are excluded because their section is
uneditable (`org` → `admin`) or absent (`samsara`, `mcleod`, `messaging`, `driver-app`). An early
draft of this plan said "~90 remaining" for exactly this reason and was wrong.

### The recipe, established by #469 and to be repeated verbatim

1. Wrap each policy with the helper 0293 introduced:
   `auth_section_or_default('<section>', 'manage'|'view', auth_role() = any (array[…]))`.
   The level is `manage` for write policies and `view` for SELECT.
2. **Keep the role list.** It IS the shipped default (D-PERM4) and `lint:section-policies` checks it
   against `auth.ts`. It is not scaffolding and is never removed.
3. Leave every non-section conjunct outside the wrapper — `reviewer_id = auth_user_id()`,
   `driver_id = auth_driver_id()`, `org_id = auth_org_id()`. Those are not an org's to configure.
4. The migration needs a `-- cross-module-waiver:` line; batching is by SECTION and sections do not
   line up with modules.
5. Regenerate `supabase/schema.generated.sql`.
6. **The evidence is the existing matrices passing UNCHANGED** for a claim-less token. Run them and
   quote the numbers.
7. Add override assertions to `supabase/tests/org-section-access.test.mjs` (47 today): narrowing
   obeyed, widening obeyed, `view` ≠ `manage` both ways, sparseness, and the admin/driver locks.
8. Mutation-test before claiming: break the helper three ways and confirm assertions fail.

### Remaining batches

- **B2 — fuel (12) + safety (9) = 21.** Matrices: `rls` (461), `restricted-records` (50), the fuel
  matrices. ⚠ `safety` includes the §391.51 evidence tables, which are append-only and pinned in
  `RETENTION_FORBIDDEN`; wrapping a policy does not change that and must not appear to.
- **B3 — recruitment (6) + maintenance (8) = 14.** Matrices: `hire-applicant`,
  `employer-inquiries`, `rls`. ⚠ The two PSP gates are an INTERSECTION with
  `canReadInvestigationHistory` (§391.53(a)(1)) — a regulatory test that is NOT an org's to edit; it
  stays a role check beside the section gate, exactly as P3 left it in the API.
- **P5 — the editable page**, and not before B2 and B3. Shipping it earlier saves permissions the
  database does not honour, which §4 below names as the workaround to avoid.
- **P6 — the gate.**

## §3 Steps

Each step is one PR, in order, and each must work against the **previous** schema for the ~9-minute
deploy window (`docs/MIGRATION-DISCIPLINE.md` §the-deploy-window). A column and its first reader
ship in two merges — `lint:migration-ordering` enforces it and this plan has four such pairs.

- **P0 — The read-only page, shipped first.** Promote the collapsed matrix at
  `SettingsUsersPage.vue:151` to `/settings/permissions` with a nav entry, a route meta, and a
  per-member "what this person sees" view derived from `buildNavGroups`. No schema. It is the
  answer to "at least i dont see it" on its own, it is what the editable page is built on, and if
  P1–P6 stall it has still delivered.
- **P1 — One table.** `org_section_access` (org_id, role, section, access) with the D-PERM7/D-PERM8
  locks written as CHECK constraints, so the database states the rule rather than trusting the
  endpoint to remember it. `enable row level security`; readable by the org, writable by nobody
  through PostgREST — writes go through the API so they carry an audit row. New tables are exempt
  from the ordering gate. **No reader ships in this PR.**
- **P2 — Resolution, unread.** `auth_section()` and the auth-hook change that injects the sparse
  `sections` claim. Policies are untouched. After this merge every newly minted token carries the
  claim; nothing consults it yet. This is the deploy-window pair for P3.
- **P3 — The API and the web read the claim.** `AuthContext` gains `sections`; `requireSection()`
  replaces the 157 `requireRole(...rolesThatManage(x))` spreads; `session.can()` reads the claim
  with the compile-time matrix as the fallback for a claim-less token. Behaviour is identical
  until an override row exists, which is what makes this reviewable.
- **P4 — The policy rewrite, in module batches.** ~89 predicates gain the `case … else <existing
  role list> end` wrapper of D-PERM4. Batched by owning module so each PR's PGlite matrix covers one
  blast radius, not all of them. The `rls` matrix (459 assertions) is the net, and every batch must
  show it still passing unchanged for a claim-less token — that is the proof the default branch is
  the current behaviour.
- **P5 — The editable page.** P0's table becomes editable across the 7 × 11 surface D-PERM7/D-PERM8
  define, admin-only, with D-PERM6's sentence on the save, a marker on every cell that departs from
  its shipped default, the regulatory argument in a hover where one exists, and "reset to default"
  per row. Every save writes an audit row.
- **P6 — The gate.** `lint:section-policies` starts refusing a new policy on a sectioned table that
  asks a bare role list without the `auth_section()` branch (D-PERM5). No fallback is dropped —
  under D-PERM4 the role list is the permanent default branch, not scaffolding.

## §4 What would make this a workaround, so it can be recognised

- Shipping P5 before P3/P4 — a page that saves rows nothing enforces is a UI that lies about
  security, and it would take a real incident to discover.
- Giving the defaults a second home — a table, a generated CASE, a plpgsql literal — instead of
  reading them from the policy's own role list, which a gate already checks (D-PERM4).
- Giving `auth_section()` a `set search_path` "for safety" (D-PERM3, §0).
- Letting the web decide access from the override table directly rather than from the claim the
  API and the database both read — a third source of truth for the same question.
