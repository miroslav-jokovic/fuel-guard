# Handoff — S6 and S7 of the surface-entitlements programme (2026-09-02)

**S1 through S5 are shipped.** Every layer the owner asked for now exists in the database and is
enforced by the API, the router and RLS. **Nothing in the product lets an admin see or change any of
it** — the only way to write a permission today is a `PUT` with curl. That is S6, and it is the whole
of what remains for the owner's original request.

This file replaces `HANDOFF-S4-S5.md`, deleted because both of its steps landed.
`docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md` is the plan and the memory. **This file goes
stale; that one does not.** Read the plan top to bottom first — §0 is measured ground truth you must
not re-derive, §2's decisions are what the code is shaped by, and §5's DONE entries say what each
step actually left behind and what it deliberately left out.

---

## 1. Where the programme actually stands

`origin/main` was `32b211b` + this PR when this was written. **Check, do not trust** — see the
migration note below.

| step | state | what it left behind |
|---|---|---|
| **S1** | **DONE** (#478) | `SURFACES` in `packages/shared/src/surfaces.ts` — 52 surfaces, 37 in the sidebar, 15 non-nav. `buildNavGroups` is a fold over it. Icons live web-side in `apps/web/src/lib/navIcons.ts` (shared is compiled for React Native and cannot import Vue). |
| **S2** | **DONE** (#480) | The router guard resolves `to.matched[0].path` through the catalogue. **No section metas remain in the route files.** The 28-route gap is closed. |
| **S3** | **DONE** (#483, #486; 0296) | `org_role_surface_access`; `/api/me` serves the claim, `session.init()` loads it, nav + guard consult it, `requireSurface()` gates the three writes exclusive to the Inspectors register. |
| **S4** | **DONE** (#491; 0298) | `user_surface_access`, resolved OVER the role layer inside `surfaceClaimFor`. `PUT /api/surface-access/user`. **No web file changed** — the payoff of resolving server-side. |
| **S5** | **DONE** (0299) | `user_section_access` + the `custom_access_token_hook` change, one migration. `PUT /api/section-access/user`. The read path was already built: `sections` flows from the claim into `AuthContext` and the web store. |
| **S6** | **YOURS** | The permissions page. Everything above is reachable only by curl. |
| **S7** | **YOURS** (independent) | The ~24 hard-coded `requireRole` lists and the 65 endpoints with nothing beyond `requireAuth` (Q-SURF1). |

Open questions in the plan's §6: **Q-SURF1** (S7's own content), **Q-SURF2** (hazmat is editable but
governs no screen — still unanswered, and a one-line catalogue edit when it is), **Q-SURF6** (a
denied surface and an already-open deep link; recommendation (a), accept it). Q-SURF3, Q-SURF4 and
Q-SURF5 are answered and struck.

⚠ **Never pin a migration number in advance — take the next free one AT execution:**
`ls supabase/migrations | tail -1`. `HANDOFF-S4-S5.md` said "your next is 0297" and a parallel session
opened a PR claiming 0297 **eleven minutes later**. It is not a gate — `lint:migrations` sees a
collision only once both files have merged, by which time somebody has to renumber anyway.

---

## 2. The four things S6 must get right, each of which is already decided

**1. Two staleness contracts, and the UI must not average them.** A **section** change travels in the
JWT and lands on the member's next token refresh — up to an hour, `jwt_expiry = 3600` (D-PERM6). A
**surface** change is served by `/api/me` and lands on the next page load (D-SURF4). The difference
is measured and deliberate: RLS reads sections per row and `auth_section()` has to inline, while
nothing in RLS reads a surface. Say the right sentence on the right save.

**2. Three layers, and a cell must show WHICH one answered.** shipped default → org role override →
user override (D-SURF6). The plan's S6 entry asks for a **Roles** tab and a **People** tab, with each
cell marked *default* / *org override* / *user override* and resettable per row. "Reset" is a real
operation with its own wire value at the user layer: `allowed: null` for surfaces, `access: null` for
sections — see point 4.

**3. There is no READ endpoint for per-user rows yet, and that was left for you on purpose.** S4 and
S5 each shipped the write their Done-when needed and `lint:table-producers` requires. The read is
S6's to shape, because the People tab knows what it wants — one member's resolved access, probably,
rather than the whole org's overrides. `GET /api/surface-access` and `GET /api/section-access` are
the shape to mirror: **both halves in one response**, overrides AND the catalogue/matrix they are
read against, so the client never reconstructs the defaults (D-SURF3, D-PERM4).

**4. The two per-user writes are NOT symmetric with their role-level siblings, and both say why in
place.** At the role layer a "reset" is expressible as a value — `allowed: true` is inert for a
surface, and a section cell equal to the shipped default is a default — so the row is deleted. At the
user layer there is no default to compare against (a person's fallback is whatever their role
resolves to, which an admin can change afterwards), so "inherit" is `null` and is stored as the
absence of a row. Read `surfaceAccess.ts` and `sectionAccess.ts` before designing the controls; a
three-state cell is what the API takes.

---

## 3. S6 — the page

The plan's §5 S6 entry is the specification. Its prerequisites are all met. Two things to hold:

- **Keep the live sidebar preview** the P0 page already builds from `buildNavGroups`. After S1 it
  previews surfaces for free, because it calls the same function the sidebar does.
- **S6 must say which surfaces are not yet governed** rather than implying completeness, until S7
  lands. That is Q-SURF1's fallback and the plan states it twice.

⚠ Six surfaces are catalogued and **not editable by derivation** — Dashboard, Fuel Log, Ask AI,
Placard calculator, Hazmat review, Users. They carry a `staff` or `admin` gate rather than a section
gate, and `isEditableSurface` derives that (Q-SURF3, owner's ruling). They render in the preview so a
reader sees the whole sidebar; **no cell offers to change them**, and the API refuses if one tried.
`surfaceAccess.test.ts` pins that both ways.

## 4. S7 — the audit

Q-SURF1, unchanged and independent of everything: ~24 hard-coded multi-role `requireRole` lists that
derive from nothing, and 65 endpoints with no authorization beyond `requireAuth`. Each either derives
from the matrix, gains a surface gate, or gets a comment saying why it is open. **The 56
`requireRole("admin")` endpoints are correct as they stand** — D-PERM7 makes the `admin` section
ungrantable, so an admin-only gate is not an org's to reach. The §0 figures are a static parse of 312
of 321 call sites: treat them as ±10 and as a shape, not a census, and **do not re-derive them by
grep** — three parsers were tried and each was wrong differently.

---

## 5. Traps this programme has paid for — all still live

1. **`lint:table-producers` and `lint:table-writers` are not in the fast set**, and only ever fail in
   CI. **Run the whole gate list before pushing** — extract it, never remember it:
   `grep -oE "pnpm (--filter [^ ]+ )?lint:[a-z-]+|pnpm typecheck|pnpm test|pnpm build" .github/workflows/ci.yml | sort -u`
   plus `lint:rls` and `lint:migration-ordering`, which are chained rather than named.
   `lint:table-writers` also regenerates `supabase/schema.generated.sql` and diffs it — **commit the
   regenerated file** or the gate fails on your own output.
2. **A new table needs three registrations**, each its own gate: `scripts/table-modules.json`,
   `scripts/table-writers.json`, and a producer.
3. **`rls.test.mjs` has a generic sweep that seeds every RLS table with an org_id**, and a table it
   cannot seed is a FAILURE, not a skip. Its synthesiser reads **single-column foreign keys only**,
   so both 0298 and 0299 — whose `(org_id, user_id)` references `memberships` — needed a `handSeed`
   entry. If your table has a composite FK, expect this and add three lines rather than weakening the
   constraint to suit the harness.
4. **`lint:comment-claims` matches a quoted test title with a regex that does not cross lines.** A
   citation wrapped across two comment lines fails even when the test exists. Keep the quoted title
   on one line.
5. **`lint:section-policies` reads `auth_role() in (...)` but NOT `auth_role() = any (array[...])`.**
   Write policies with `in (...)` (Q-PERM11, still open).
6. **Its waiver check greps the RAW file**, so a migration header that merely *mentions* the waiver
   marker waives its own migration and the gate reports green having read nothing.
7. **`pnpm build` fails locally on every branch** unless `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   are exported: `set -a; . apps/web/.env; set +a` then build. CI supplies them as secrets.
8. **`pnpm lint` scans `.claude/worktrees/`** — a parallel session's checkout, gitignored and
   invisible to CI. Filter the path before believing a lint failure.
9. **A snapshot test is the review.** `apps/web/src/lib/navEquivalence.test.ts` holds 33 snapshots of
   `buildNavGroups`, and `router/__snapshots__/routeTable.test.ts.snap` holds the route table. S6 WILL
   touch the first if it changes the preview — if your change is not meant to alter the sidebar, that
   diff must be **empty**, not "updated".

### And the mutation-testing rule, which has now paid four times

**Mutate the SUBJECT, not the test, and check each mutation fails a DIFFERENT assertion.** If two
fail the same one, the others are not pulling their weight. What that has caught, each time by
mutation and only by mutation:

- an assertion passing because a missing query parameter made an insert error rather than the policy
  refuse it;
- a `requireSurface` scan counting a doc comment as a call site;
- **S4:** a fixture that answered `[]` for an unfiltered read, so dropping `.eq("user_id")` failed
  the same assertion as reversing the merge order — the "no other technician is affected" clause was
  proving nothing;
- **S4:** an `org_id`-immutability assertion that passed with the trigger dropped, because a
  composite foreign key refused the update instead — the subject was not a member of the destination
  org;
- **S5:** a `user_id` filter missing from a DELETE would have cleared a section for the whole org and
  passed every assertion in both per-user test files. Found by mutating S5, fixed in both.

---

## 6. Parallel sessions — check every time, not once

Another chat works the same checkout, sometimes in `.claude/worktrees/*` or a scratchpad worktree.
Four merges landed under this programme's feet in one afternoon. **Before every push and every
merge:**

```
git worktree list                      # is another session in this tree?
git branch --show-current              # am I still where I think I am?
git status --porcelain                 # is anything of mine uncommitted and at risk?
git fetch origin && git log --oneline origin/main -1
git log --oneline origin/main..HEAD    # does my branch carry ONLY my commits?
gh pr list --state open                # what is about to land?
```

Then the two that actually bite: **migration numbers**
(`git ls-tree -r --name-only origin/main supabase/migrations/ | tail -3`) and **file overlap**
(`gh pr view <theirs> --json files -q '.files[].path'`).

Leave the tree clean when you stop. `main` is often checked out in another worktree, so
`git checkout --detach origin/main` is the way to park it.

---

## 7. The resume ritual

1. Read `SURFACE-ENTITLEMENTS-PLAN.md` in full — especially §5's DONE entries, which say what each
   shipped step left OUT — then this file, then `EDITABLE-PERMISSIONS-PLAN.md` §2b/§2c, then the
   `CLAUDE.md` of every package you touch.
2. Establish reality: `git log --oneline -10`, `git worktree list`, `pnpm verify:live`.
3. Read `apps/api/src/modules/org/routes/surfaceAccess.ts` and `sectionAccess.ts` before designing
   S6's controls. The three-state per-user write is the thing a page can most easily get wrong.
4. One step per branch (`claude/<topic>`), PR to `main`, CI green, **verify `main` actually moved**.
5. Mark the step **— DONE `<date>` (#PR; migrations NNNN–NNNN)** in place in the plan with "What
   shipped" and "Verified by:" naming the gates run. When a §6 question is answered, strike it
   through in place with the answer and date.
6. Update this file's §1 table, or delete it once S6 and S7 are both done.
