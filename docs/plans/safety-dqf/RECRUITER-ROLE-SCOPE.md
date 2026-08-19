# Scoping a `recruiter` role

**Date:** 2026-08-19 · **Status:** R1–R5 BUILT 2026-08-19 (see §8). R6 done inline. Follows the `recruitment` section
(`packages/shared/src/auth.ts`, migrations `0208`/`0209`).

Every cost below was measured against the tree, not estimated. Where a claim comes from a file, the
file is named.

---

## 1. The mechanics are cheap, and cheaper than the `recruitment` section was

| Concern | Reality | Cost |
|---|---|---|
| Postgres `user_role` enum | Created in `0001` with 4 values; `0077` added `dispatcher` + `safety_manager` | **one migration, one line** |
| Enum used in the same transaction that adds it | Postgres forbids it. `0077`'s own header says so and splits ADD from USE across `0077`/`0078` | **follow the precedent: two migrations** |
| RLS policies | Compare `auth_role()` as **text**, never as the enum — verified across all 82 role-bearing policies | **the enum change touches no policy** |
| JWT | `custom_access_token_hook` (`0006`) injects `membership.role::text` **verbatim** | **no hook change** |
| API request validation | `roleSchema = z.enum(USER_ROLES)` (`apiContract.ts:9`), used by the invite and role-change routes | **no route change** |
| Invite picker | `USER_ROLES.filter((r) => r !== "driver")` (`SettingsUsersPage.vue:32`) | **appears by itself** |
| Permissions table | Renders `USER_ROLES` × `APP_SECTIONS` | **appears by itself** |
| Completeness | `USER_ROLE_LABELS` (`constants.ts:18`) and `SECTION_ACCESS` (`auth.ts:86`) are `Record<UserRole, …>` | **the compiler refuses to build until both are filled** — a feature |

**One-way door, and the only genuinely irreversible thing here:** Postgres has no
`ALTER TYPE … DROP VALUE`. Once `'recruiter'` is in the `user_role` enum it cannot be removed without
recreating the type and rewriting every column that uses it. Adding the value is therefore a decision
to keep it; the access it carries stays adjustable, the value itself does not.

**So the enum is not the question.** The question is what a recruiter can reach, and that is where
the actual work is.

---

## 2. The real problem: an applicant is a `drivers` row

`driver_employment_history.driver_id` references `drivers`, so a recruiter working an applicant is
creating and editing a `drivers` row. `POST /api/roster/drivers` gates on `rolesThatManage("fleet")`,
and `fleet: manage` is also **vehicles, trailers, terminals and every driver's full master data**.

That is the whole difficulty. A recruiter needs one narrow write against `drivers` and gets the fleet
if we take the obvious route. Four ways out, with what each actually costs:

**Option A — `recruiter: { fleet: "manage" }`.**
One line. Also grants vehicle, trailer and terminal writes through 17 existing policies. Cheapest and
it re-creates in miniature exactly the problem the `recruitment` section was just introduced to fix.
**Not recommended.**

**Option B — `recruiter: { fleet: "view" }`, plus widen the driver-create guard.**
`fleet: view` gives read-only across the roster (which a recruiter needs — they pick a driver, they
read the qualification file). Then `POST /api/roster/drivers` and the `PATCH` for identity fields
accept `rolesThatManage("recruitment")` **in addition to** `rolesThatManage("fleet")`, and `drivers`'
own write policy in `0098` gains `'recruiter'`.
Cost: two guard expressions, one migration, one matrix case. Recruiter can still *read* the vehicle
roster, which is odd but harmless.
**Recommended.** It is honest about what a recruiter does and it changes nothing for existing roles.

**Option C — split driver master data out of `fleet` into its own section.**
Architecturally the cleanest: `fleet` becomes equipment, a new section becomes people. Costs a
section, moves `routes/roster/drivers.ts`'s guards, and re-points the 17 `fleet`-manage policies that
concern drivers. Worth doing eventually; it is not this change.

**Option D — applicants are not `drivers` rows until hired.**
Probably the correct product answer in the long run, and by far the largest: a new table, a promotion
path, and every FK that points at `drivers` today. Out of scope, recorded so it is not re-invented.

---

## 3. The finding that will bite: `canReadRestricted` conflates two regulations

`packages/shared/src/auth.ts:147` — `canReadRestricted = admin || safety_manager` — gates six kinds
behind one flag, and those six come from **two different rules**:

- `previous_employer_inquiry` / `previous_employer_response` — **§391.53(a)(1)**, which limits the
  investigation history to *"those who are involved in the hiring decision"*.
- `drug_test` / `alcohol_test` / `clearinghouse_full` / `clearinghouse_limited` — **§382.401(a)**,
  "a secure location with controlled access".

A recruiter is, by name, the person §391.53(a)(1) is describing. A recruiter who cannot read a
previous-employer response cannot do the job the regulation assigns them — and §391.23(a)(2) inquiry
tracking, which the Recruitment section already ships, is exactly that file.

So `recruiter` is the first role that needs **one half of the flag and not obviously the other**, and
it is what forces the split the flag has been deferring. Two sub-options:

- **Split it**: `canReadInvestigationHistory` (adds recruiter) and `canReadTestingRecords`
  (unchanged). Touches `auth.ts`, `filterRestrictedRows`'s two call sites in `routes/compliance.ts`,
  and `0205`'s two RESTRICTIVE policies — which would become four.
- **Do not split**: recruiter gets neither, and hiring paperwork stops at the inquiry *state* on
  `driver_employment_history` (which the Recruitment section already gives them) without the
  response document itself.

**This is a decision for you, not a default I should pick.** Not splitting ships sooner and leaves a
recruiter unable to read the response they chased; splitting is correct on the regulation and adds a
migration plus a matrix case. My reading is that splitting is right — the flag is one helper doing two
jobs and the seam is already visible — but it is a compliance-access judgement and it should be made
deliberately.

---

## 4. What a recruiter would get, proposed

```
recruiter: { fuel: "none", dispatch: "none", safety: "none", hazmat: "none",
             fleet: "view", recruitment: "manage", admin: "none" }
```

- **`recruitment: manage`** — the whole point.
- **`fleet: view`** — read the roster and the qualification file. `routes/compliance.ts` gates on
  `rolesThatCanView("fleet")`, so this is what lets a recruiter open a driver's §391.51 file at all.
- **`fuel`, `dispatch`, `hazmat`, `safety`, `admin`: none** — nothing in a recruiter's job touches a
  fuel card, a load, a placard or org settings.
- Plus the narrow driver-create/edit widening from Option B.

Note `nav.ts:76`'s `isStaff = role !== "driver"`, which gives a recruiter Dashboard + Ask AI. Correct
as-is; called out because it is the one grant that comes from *not* being a driver rather than from
the matrix.

---

## 5. Steps

**R1 · The enum — its own migration.** `alter type user_role add value if not exists 'recruiter';`
Nothing else in the file, for `0077`'s stated reason.
**Done when:** it applies, and `pnpm test`'s matrices still pass (they replay every migration).

**R2 · The vocabulary.** `USER_ROLES` + `USER_ROLE_LABELS` (`constants.ts`) and the `SECTION_ACCESS`
row (`auth.ts`). Both are `Record<UserRole, …>`, so the build fails until both are complete — no
checklist needed.
**Done when:** `pnpm typecheck` is green and `auth.test.ts` pins the row, including every `none`.

**R3 · The driver-create widening (Option B).** `routes/roster/drivers.ts`'s create + identity-patch
guards accept recruitment-manage as well as fleet-manage; a **second** migration (not R1's) adds
`'recruiter'` to `0098`'s `drivers` write policy.
**Done when:** a route test proves a recruiter may create a driver and may NOT write a vehicle, and a
matrix case proves the same through PostgREST.

**R4 · `driver_employment_history`.** Add `'recruiter'` to `0208`'s write policy and `0209`'s
restrictive read.
**Done when:** the `restricted-records` matrix proves a recruiter reads and writes it and a dispatcher
still cannot.

**R5 · The `canReadRestricted` decision (§3).** Only if you choose to split.
**Done when:** a recruiter reads a previous-employer response and NOT a drug test, proved in the
matrix and in `routes/compliance.ts`'s suite.

**R6 · Documentation.** The section-matrix comment in `auth.ts` gains the recruiter's reasoning, as
`recruitment`'s was written; `docs/01-ARCHITECTURE.md` §4 if it enumerates roles.

---

## 6. Estimate, and what I would do

R1–R4 is **two migrations and roughly six TypeScript files**, with the compiler and two existing
matrices doing most of the verification. It is smaller than the `recruitment` section was, because the
section is what created the place to put this.

R5 is the one that deserves a conversation before code.

**Do R1–R4 as one change; decide R5 separately.** And be sure a real recruiter is going to hold this
role before spending the enum value — a `fleet_manager` who mostly does hiring is an acceptable
answer today, and the enum value is the only part of this that cannot be taken back.

## 7. Open questions

- **Q1** — Is there an actual person who will hold this role, distinct from the fleet manager? If not,
  the honest answer is to keep the `recruitment` section and skip the role.
- **Q2** — Does a recruiter read previous-employer responses (§3)? This is R5.
- **Q3** — Should a recruiter be able to *terminate* a driver, or only create and edit? Termination
  stamps the §391.51(c) retention clock (`resolveDriverUpdate`), which reads as a fleet action rather
  than a hiring one. Proposal: create and edit, not terminate.


---

## 8. What was built, 2026-08-19

Decision taken: **R1–R4 plus R5** — the `canReadRestricted` split was approved rather than deferred.

| Step | Landed as |
|---|---|
| R1 | `0210_recruiter_role.sql` — the enum value, alone, per `0077`'s stated reason |
| R2 | `USER_ROLES` + `USER_ROLE_LABELS` (`constants.ts`), the `SECTION_ACCESS` row (`auth.ts`) |
| R5 | The split: `TESTING_RECORD_KINDS` / `INVESTIGATION_HISTORY_KINDS`, `canReadTestingRecords` / `canReadInvestigationHistory` / `canReadRestrictedKind` / `canReadAllRestricted`, and `0211_split_restricted_kinds.sql` turning 0205's two RESTRICTIVE policies into four |
| R3 | `canWriteDriver` on `routes/roster/drivers.ts` (the two manage-sets unioned on create + patch, nowhere else), mirrored by `drivers_write` in `0212_recruiter_grants.sql` |
| R4 | `driver_employment_history` write + restrictive read gain `'recruiter'` (`0212`) |
| R6 | The reasoning is in `auth.ts`'s matrix comment and in each migration header |

**`filterRestrictedRows` is now per ROW, not per caller.** That is the shape change the split forces:
a role's answer is no longer uniform across the restricted set, so every layer asks
`canReadRestrictedKind(kind, role)`. `routes/compliance.ts` and the web's requirement gating both
moved to it; `RequirementTable`'s second gate disappeared because the row already carries the
per-reader answer.

**Two places deliberately kept the OLD, whole-file entitlement, and both are named in code:**

- **The binder.** `dq_exports.include_restricted` is one boolean on a ledger row rendered later by a
  worker with no requester in hand, so a partial grant cannot be expressed in the artifact. A
  restricted binder stays `canReadAllRestricted` — admin + safety_manager. A recruiter reads
  investigation history in the app and does not export a restricted binder. Widening `dq_exports` to
  carry a per-kind grant was rejected as a schema change bought by nothing today.
- **App enrolment.** `POST /:id/invite` stays admin + fleet_manager. It hands out a login, which is
  not a hiring act. Pinned by a route test.

**Verification.** `pnpm typecheck`, `pnpm lint`, all ten gates, and `pnpm test` — the
`restricted-records` matrix grew 14 → 27 assertions, proving through PostgREST that a recruiter reads
a previous-employer response, reads **no** testing record, may create a driver, and may **not**
create a vehicle or trailer; and that admin, safety_manager, fleet_manager and dispatcher each ended
up exactly where they started.

**Q3 — ANSWERED and CLOSED 2026-08-19 (MJ): a recruiter may not terminate.** `0213` and
`canWriteDriverLifecycle`.

- **Gated on the FIELD, not the value.** `status` *and* `termination_date`, in either direction. A
  rule about the value `terminated` would have blocked terminating and still allowed a recruiter to
  resurrect a terminated driver — and would have left `termination_date` reachable on its own, which
  is the same §391.51(c) retention clock through a side door.
- **`canWriteDriverLifecycle` derives from the section matrix** (`canManageSection(role, "fleet")`),
  so it cannot drift from `fleet: manage`.
- **The API refuses first**, before the admin client is even constructed, so a rejected edit touches
  no database.
- **A TRIGGER, not a policy.** RLS cannot express "this column may not change": `USING` sees the OLD
  row, `WITH CHECK` the NEW one, and nothing compares them. This is not belt-and-braces — apps/web's
  older driver drawer writes `status` through PostgREST directly (`useUpdateDriver`), so the roster
  route is genuinely not the only door.

### A latent bug the trigger surfaced

`auth_role()` (0002) cast `request.jwt.claims` to jsonb **without** the empty-string guard its sibling
`auth_org_id()` has always had, so an empty setting raised `22P02` instead of returning null. Every
RLS policy calls that function, so the fragility was always present — it had simply never been
reached, because a policy is only evaluated for a role RLS applies to, and the paths that leave an
empty setting are owner/service paths that skip policies. A `BEFORE UPDATE` trigger runs for every
writer, so it called `auth_role()` where nothing had, and the `rls` matrix went red on an unrelated
`drivers` update.

Fixed in `0213` with `nullif`, matching the sibling, rather than worked around in the trigger — making
one caller defensive would have left the same trap for the next one.
