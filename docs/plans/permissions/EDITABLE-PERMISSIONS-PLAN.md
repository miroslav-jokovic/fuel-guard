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

> Superseded in part by §2c below, written after batch 2 measured the inventory against the matrix
> instead of against the pattern. The per-section table here is still the right net; the split of what
> is inside it is in §2c.

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

- **B2 — fuel + safety. SHIPPED as 0294, and it was 13 policies rather than the 21 counted here.**
  See §2c: the inventory above counted by PATTERN (a role list on a table whose module maps to an
  editable section) and eight of those 21 turn out not to be section gates at all. The evidence
  quoted on merge: `rls` 461, `restricted-records` 50, the fourteen fuel/efs matrices, all unchanged;
  `org-section-access` 47 → 69. ⚠ The `safety` evidence-table note was correct and is discharged —
  0294's header shows `RETENTION_FORBIDDEN` governs which tables a retention PRUNE may name and is
  enforced by a guard test over `RETENTION_RULES`, a different mechanism at a different layer from
  RLS, and the new assertions prove a widened section opens `qualification_records`' INSERT and
  neither an UPDATE nor a DELETE.
- **B3 — recruitment, maintenance and the two section≠module tables. SHIPPED as 0295, 14 policies.**
  Recruitment 5 (including `psp_requests_section_read`), roster 1 (`seven_day_statements_write`),
  maintenance 8. One more exclusion found: `employer_inquiries_read` is a fifth D-PERM9 reader test
  (§391.23(k)(2), and 0223 says in words that it mirrors `canReadInvestigationHistory`). Evidence on
  merge: `rls` 461, `restricted-records` 50, `hire-applicant` 17, `employer-inquiries` 21,
  `annual-inspections` 42, `merge-driver-dqf` 21, all unchanged; `org-section-access` 69 → 92.
  **P4 is complete: every section gate an org can edit now asks the org.**
- **P5 — the editable page.** B2 and B3 have shipped, so it is unblocked — but read
  `SURFACE-ENTITLEMENTS-PLAN.md` first. The owner's 2026-09-02 follow-up asked for per-USER setup
  and per-SCREEN granularity, neither of which the section matrix can express, and that plan's §0
  measures why: 27 routes whose sidebar entry knows a section their route does not gate on, and one
  page (Annual Inspections) that legitimately reads the table another page owns. P5 as scoped here
  is the Roles half of that plan's S5.
- **P6 — the gate.** Q-PERM11 below is now part of its scope and should be read first: the gate is
  currently blind to one of the two spellings of a role list, and un-blinding it surfaces nine
  pre-existing disagreements between SQL and `SECTION_ACCESS` that have to be ruled on before it can
  be turned on.

## §2c What batch 2 measured, 2026-09-02 — the inventory was a pattern count, and patterns overcount

§2b sized the remaining work at 35 by matching `auth_role() = ANY (ARRAY[…])` on a table whose module
maps to an editable section. That is the right net to cast — it is what stopped the early "~90"
guess — but it catches two things that look identical in SQL and are not the same question:

1. a **section gate**, whose role list equals `rolesThatManage(section)` or `rolesThatCanView(section)`;
2. a **role check that happens to name roles**, whose list equals neither.

Re-deriving the 52 in-scope policies against the matrix itself, rather than against the pattern,
splits them cleanly. The comparison is arithmetic, not judgement: a list either equals a derived set
or it does not.

| | policies | |
| --- | ---: | --- |
| wrapped by 0293 (batch 1) | 17 | |
| wrapped by 0294 (batch 2) | 13 | fuel 9, safety 4 |
| wrapped by 0295 (batch 3) | 14 | recruitment 5, roster 1, maintenance 8 |
| never to be wrapped (D-PERM9) | 5 | the §382.401(a), §391.53(a)(1) and §391.23(k)(2) reader tests |
| blocked on a ruling (Q-PERM10) | 3 | the fuel policies that disagree with the matrix |
| | **52** | |

**44 of the 52 are wrapped, 5 never will be, and 3 wait on Q-PERM10.** P5 may proceed: the only
sections whose editable surface the database does not yet fully honour are named in Q-PERM10, and
they are three policies inside `fuel`, not a section.

### D-PERM9 — A regulatory reader test is not a section, and is never wrapped

`documents_restricted_testing`, `documents_restricted_investigation`,
`qualification_records_restricted_testing` and `qualification_records_restricted_investigation` carry
role lists and sit on safety-section tables, and they are not section gates. 0211's header says so in
words; the matrix says so in arithmetic — their lists are `[admin, safety_manager]` and
`[admin, safety_manager, recruiter]`, and safety derives `manage=[admin, fleet_manager,
safety_manager]`, `view=` those three plus `auditor`. Neither matches, because they mirror
`canReadTestingRecords()` and `canReadInvestigationHistory()` in `auth.ts` rather than
`SECTION_ACCESS`:

- **§382.401(a)** — drug and alcohol testing records live in "a secure location with controlled
  access". A custody rule that says nothing about hiring.
- **§391.53(a)(1)** — the investigation history goes to "those who are involved in the hiring
  decision", which is what puts the recruiter in one list and not the other.

Batch 3 found a fifth, on the same argument and a third regulation: `employer_inquiries_read` lists
`[admin, safety_manager, recruiter]`, which is no section's derived set, and 0223's header says it
mirrors `canReadInvestigationHistory` rather than restating it — because **§391.23(k)(2)** obliges the
carrier to "take all precautions reasonably necessary to protect the records from disclosure to any
person not directly involved in deciding whether to hire the driver."

Ruled: all five stay bare role checks for ever. Wrapping them would make a federal confidentiality
rule org-editable — an org granting `safety: manage` to its dispatchers would thereby hand them
drug-test results, or `recruitment: manage` a former employer's answer about somebody — and the
failure would be invisible until an audit or a lawsuit found it. **P5's editable page must not
present these as anything an org can reach**, and P6's gate needs an exemption for them by name.

The distinction that separates them from the two tables 0295 re-pointed with `TABLE_SECTIONS` is
arithmetic, not taste: a reader test's list equals NO section's derived set, while `psp_requests` and
`seven_day_statements` each equal exactly one — just not their module's. When a list matches a
section, wrapping it with that section changes no behaviour; when it matches none, wrapping it has to
invent an answer.

### ~~Q-PERM10~~ — Three fuel policies disagree with the matrix — **ANSWERED 2026-09-03 by P6 (0300), see D-PERM11/D-PERM12**

Not wrapped by 0294, and the reason is not taste:

| policy | list | fuel derives |
| --- | --- | --- |
| `fuel_discount_write` | `[admin, dispatcher, fleet_manager]` | `manage=[admin, fleet_manager]` |
| `route_fuel_settings_write` | `[admin, dispatcher, fleet_manager]` | `manage=[admin, fleet_manager]` |
| `ftxn_insert` | `[admin, driver, fleet_manager]` | `manage=[admin, fleet_manager]` |

A dispatcher holds `fuel: "view"`, so the first two grant a write the matrix says they do not have.
Under D-PERM4 the role list IS the shipped default, so wrapping a list the matrix contradicts would
freeze that contradiction as the default branch — the one thing D-PERM4 says the role list must never
become. `lint:section-policies` would also reject them, and its only escape is a FILE-scoped waiver
that would have switched the gate off for the other thirteen policies in the same migration.

Candidate answers, measured rather than guessed:

- **Both dispatcher lists are exactly `rolesThatManage('dispatch')`.** Route fuel planning and the
  discount table are arguably dispatch surfaces, and `TABLE_SECTIONS` exists precisely for a table
  whose module and section differ. Re-pointing them at `dispatch` makes both lists correct with no
  behaviour change at all, and is the cheapest answer that is not a fudge.
- **Or narrow them to fuel's manage set**, which is a real behaviour change: a dispatcher loses both
  writes. Note the API has already moved on — `apps/api/src/modules/fuel/routes/discountRules.ts`
  gates the discount write at `requireSection("admin")`, and no API path writes
  `route_fuel_settings` at all (it is read-only there, `routing/fuelPlanning.ts:171` and
  `routing/routes/stations.ts:21`). So the wider RLS list is a client-side path the product no
  longer uses, and narrowing it may cost nothing in practice.
- **`ftxn_insert`'s `driver` is a driver-app path, not a section grant**, and belongs in a
  driver-scoped predicate beside the section gate rather than inside its role list.

Recommendation: take the first answer for the two dispatcher policies (a `TABLE_SECTIONS` entry plus
a wrapper, no behaviour change) and the third for `ftxn_insert`, as one PR after B3. It needs an
owner ruling because it is a permission decision, not a mechanical edit.

### ~~Q-PERM11~~ — `lint:section-policies` reads only one of the two spellings — **ANSWERED 2026-09-03 by P6 (0300), see D-PERM13**

Measured while writing 0294. `check-section-policies.mjs` detects a role list with
`/auth_role\(\)\s+in\s+\(/`. Postgres renders `auth_role() in (a,b)` and
`auth_role() = any (array[a,b])` identically in `pg_policy`, so the two are the same thing to the
database and an author picks between them on taste — but 0293 wrote all 31 of its lists in the
second spelling, and the gate printed `✓ section policies ok` having read none of them. The recipe's
step 2 credits this gate with checking the shipped defaults; for batch 1 that credit was not earned.

Batch 2 works around nothing: 0294 uses the `in (…)` spelling, and the gate demonstrably reads it —
mutating one fuel list to `[admin, dispatcher]` produces 17 violations naming 0294.

⚠ There is a second trap behind the first. The waiver check greps the RAW file, before comments are
stripped, so a migration header that merely *mentions* the waiver marker waives its own migration. An
earlier draft of 0294's header did exactly that and the gate went green having read nothing; the
published header says so in the same paragraph, so the next author meets it as a warning rather than
as a surprise.

The fix is a two-line change to the detector and it is ready — the patched script is not committed
because turning it on fails CI. Un-blinding it surfaces **nine pre-existing disagreements between an
already-applied policy and the matrix**, all of them predating 0293 and faithfully preserved by it:

| table | policy list | section derives |
| --- | --- | --- |
| `hazmat_loads` (×3), `hazmat_documents` | `[admin, dispatcher, fleet_manager]` | hazmat `manage` adds `safety_manager` |
| `hazmat_reviews` insert | `[admin, fleet_manager, safety_manager]` | hazmat `manage` adds `dispatcher` |
| `hazmat_reviews` select | `[admin, auditor, fleet_manager, safety_manager]` | hazmat `view` adds `dispatcher` |
| `drivers` | `[admin, fleet_manager, recruiter, safety_manager]` | roster `manage` has no `recruiter` |
| `driver_vehicle_assignments`, `driver_scores`, `driver_performance_weeks` | `[admin, fleet_manager]` | roster `manage` adds `safety_manager` |
| `idle_settings` | `[admin, fleet_manager, safety_manager]` | equipment `manage` has no `safety_manager` |

Only the `drivers` one is already explained — `auth.ts` says the recruiter's single roster write is
"granted by NAME in 0212's policy rather than by widening the section", which is a deliberate
exception and wants an exemption rather than a fix. The other eight are unexplained and each is a
permission ruling. This is P6's real content, and it is larger than "turn the gate on".


⚠ **Measured live 2026-09-03, and it is worse than a gate being off.** The eight unexplained rows
above are not a lint finding waiting to happen — they are what production enforces today. The
S6 page displays the matrix as each role's default, so for those cells it displays an answer the
database refuses; and because `PUT /api/section-access` deletes the row when the value equals the
shipped default (D-PERM4), an admin who selects the displayed value writes nothing and cannot
repair it. `SURFACE-ENTITLEMENTS-PLAN.md` Q-SURF8 has the three policies checked by hand. P6 is
therefore a correctness fix with a UI symptom, not a tidy-up, and the recommendation there is to
rule on Q-PERM10 and this question before any further work on the page.

### D-PERM10 — A named grant is not a section question, and a section override never widens it
`hazmat_reviews_insert` / `_select` list HAZMAT_REVIEW_ROLES (D6, separation of duties: dispatchers
create loads, they do not clear them), and the API's review route is `requireRole(...HAZMAT_REVIEW_ROLES)`
— it does not consult the section either. 0293 had wrapped both in `auth_section_or_default('hazmat',…)`,
which would have let an org that grants a dispatcher `hazmat: manage` widen who signs a review in SQL
while the API still refused. 0300 removes the wrapper and waives both by name. `drivers_write` keeps
its wrapper (an org that narrows `roster` narrows the recruiter too) and is waived by name for the
recruiter 0212 added. Same class as D-PERM9; the matrix pins that a dispatcher granted `hazmat: manage`
still cannot sign a review.

### D-PERM11 — A table belongs to the section whose PAGE edits it, not to its module's default
Three of the "disagreements" were correct lists under the wrong section: `idle_settings` is edited
from the Idling page (a safety surface) and its list is exactly rolesThatManage('safety');
`route_fuel_settings` and `fuel_discount_rules` are the fuel planner's inputs, edited from Fuel
Planning (a dispatch surface), and both lists are exactly rolesThatManage('dispatch') — the
coincidence Q-PERM10 had noticed. 0300 re-wraps each under the section its list derives from and the
gate's `TABLE_SECTIONS` names all three. No token's answer changed; an override now reaches each
policy through the section an admin would expect.

### D-PERM12 — A role a RESTRICTIVE policy already refuses is dead text in a permissive list
`ftxn_insert` listed `driver` beside the fuel managers. 0135 closed the driver's PostgREST fill-up
with a restrictive `fuel_tx_driver_insert` (`auth_role() <> 'driver'`), so the listed role had been
unreachable for 165 migrations. 0300 removes it and the policy becomes the fuel section's manage
question, the shape `ftxn_update` / `ftxn_delete` already took in 0294. The matrix pins the driver's
refusal so the closure cannot be undone here by accident. ⚠ The first draft of 0300 wrapped the
office half and kept `or auth_role() = 'driver'` beside it, believing the driver path live; the
matrix refused the driver and the restrictive policy was found by reading the refusal. A ruling that
had not been run would have shipped a comment describing a path that does not exist.

### D-PERM13 — The gate checks the LATEST definition of each policy, and waivers are per policy
Un-blinding the detector to `= any (array[...])` makes it read 0293, which cannot be edited. So
`check-section-policies.mjs` now (a) reads both spellings, (b) keeps the last `create policy` per
(table, policy) across migrations above the boundary and checks only those — a superseded definition
is dead text, and a policy created below the boundary and re-created above it comes into scope, which
is how 0004's and 0078's lists were brought in — and (c) honours `-- section-policy-waiver(<policy>):`
on its own line, so a header that merely mentions the marker waives nothing. Run against `main`
without 0300 it reports the nine the audit found; run against 0300 with one list mutated it reports
that one. `pnpm lint:rls` is now a CI step; it had never been in the workflow, which is how the section
half ran blind through seven migrations.

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
- **P6 — The gate. — DONE 2026-09-03 (migration 0300)** What shipped is larger than "turn the gate
  on", as §2c predicted: eleven policies re-created so every default branch equals its section's
  derived set or is waived by NAME (D-PERM10–D-PERM12), the gate un-blinded, made latest-wins and
  per-policy (D-PERM13), and `pnpm lint:rls` added to CI. Every ruling was read off three
  measurements — who writes the table through PostgREST, what the API gate derives from, and what a
  migration already explains — and the migration's header records them per policy.
  **Verified by:** `org-section-access` 116 (was 92; the 24 new assertions pin each ruling claim-less
  and under an override), `rls` 467, `load-lifecycle` 61, `restricted-records` 50,
  `equipment-section-split` 16, `user-section-access` 26 — all unchanged; `lint:rls` with its
  self-test; the schema snapshot regenerated (13 lines). **Mutation-tested, subject not test:** three
  mutations of 0300 (safety manager dropped from `dva_write`; `idle_settings` re-wrapped under
  equipment; the review policy re-wrapped in the section) each failed a different assertion, and one
  mutation of the gate script's detector was proven by running it against `main` without 0300.
  ⚠ Not in scope, said out loud: `lint:section-policies` still checks nothing below 0260 that no
  later migration re-creates. The eleven here are the ones the audit measured live; a pre-0260 list
  nobody has re-created is still grandfathered.

## §4 What would make this a workaround, so it can be recognised

- Shipping P5 before P3/P4 — a page that saves rows nothing enforces is a UI that lies about
  security, and it would take a real incident to discover.
- Giving the defaults a second home — a table, a generated CASE, a plpgsql literal — instead of
  reading them from the policy's own role list, which a gate already checks (D-PERM4).
- Giving `auth_section()` a `set search_path` "for safety" (D-PERM3, §0).
- Letting the web decide access from the override table directly rather than from the claim the
  API and the database both read — a third source of truth for the same question.
