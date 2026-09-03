# Handoff — S4 and S5 of the surface-entitlements programme (2026-09-02)

**Scope of this handoff: S4 and S5 only.** S6 (the editable page) and S7 (the audit of gates the page
cannot reach) are a separate session with fresh context, on the owner's instruction — do not start
them here, and do not let S4/S5 grow into them.

`docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md` is the plan and the memory. **This file goes
stale; that one does not.** Read the plan top to bottom first — §0 is measured ground truth you must
not re-derive, and §2's decisions are what the code below is shaped by.

---

## 1. Where the programme actually stands

`origin/main` was `9493afa` when this was written. **Do not trust either number below without
checking** — see the migration note at the end of this section.

| step | state | what it left behind |
|---|---|---|
| **S1** | **DONE** (#478) | `SURFACES` in `packages/shared/src/surfaces.ts` — 52 surfaces, 37 in the sidebar, 15 non-nav. `buildNavGroups` is a fold over it. Icons live web-side in `apps/web/src/lib/navIcons.ts` (shared is compiled for React Native and cannot import Vue). |
| **S2** | **DONE** (#480) | The router guard resolves `to.matched[0].path` through the catalogue. **No section metas remain in the route files.** The 28-route gap is closed. |
| **S3a** | **DONE** (#483) | Migration 0296 `org_role_surface_access`. |
| **S3b** | **DONE** (#486) | `/api/me` serves the claim, `session.init()` loads it, nav + guard consult it, `requireSurface()` gates the three writes exclusive to the Inspectors register. |
| **S4** | **DONE** (#TBD) | Migration 0298 `user_surface_access`, the resolver merging it over the role layer, and an audited admin-only `PUT /api/surface-access/user`. ONE merge, not two — the D-SURF9 deviation and the test that licenses it are recorded in the plan. No web file changed. |
| **S5** | **YOURS** | Per-user section overrides. |
| S6, S7 | a later session | The editable page; the audit of the ~24 hard-coded `requireRole` lists. |

Open questions in the plan's §6: **Q-SURF1** (S7's content), **Q-SURF2** (hazmat governs no screen —
still unanswered, and it is a one-line catalogue edit when it is), **Q-SURF4** (token size, and S5 is
where it becomes real). Q-SURF3 and Q-SURF5 are answered and struck.

⚠ **Never pin a migration number in advance — take the next free one AT execution:**
`ls supabase/migrations | tail -1`. This handoff originally said "your next is 0297" and a parallel
session opened a PR claiming 0297 **eleven minutes later**. That is the convention
`RECRUITING-SYSTEM-PLAN.md` §4 already states ("the training plan's pinned numbers went stale by 145
within a month"), and it is not a gate — `lint:migrations` catches duplicates only once both have
merged, by which time one of them has to be renumbered anyway.

---

## 2. The two paragraphs that matter most

**Everything in this programme fails OPEN, and that is load-bearing rather than sloppy.** An
unreadable table, an unknown surface key, an unconfigured admin client — all resolve to "no denials".
It is safe *by construction* because a surface answer may only NARROW within a section (D-SURF2), so
the worst an empty answer can do is show the shipped catalogue. Keep it that way. The alternative
turns a transient database blip into every member of the org losing their sidebar, and the section
gate underneath — the actual security boundary — is untouched either way.

**Mutation-test everything, and mutate the SUBJECT rather than reading the test.** This programme has
now caught, by mutation and only by mutation: an assertion passing because a missing query parameter
made an insert error rather than the policy refuse it; a `requireSurface` scan counting a doc comment
as a call site; and a plan step that would have hand-written 28 copies of a fact the next step made
derivable. Each mutation should fail a *different* assertion — if two mutations fail the same one,
the others are not pulling their weight.

---

## 3. S4 — per-user surface overrides

### What it is

A third layer on the chain the plan's D-SURF6 defines:

```
the surface's own gate  →  org_role_surface_access  →  user_surface_access
```

Sparse at every layer. A row present is the answer; a row absent is "unchanged". `allowed: true` at
the user layer is the row that earns the boolean column 0296 added — an org denies a screen to
`technician` and then wants ONE technician to keep it.

**Done when:** a named member on the `technician` role sees only Annual Inspections, **and no other
technician is affected**. That second clause is the test that distinguishes S4 from S3.

### The table

`user_surface_access (org_id, user_id, surface_key, allowed, updated_at, updated_by)`, primary key
`(org_id, user_id, surface_key)`. Mirror 0296 exactly — read the file, do not reinvent:

- `enable row level security`; a SELECT policy scoped to `org_id = auth_org_id()`; **no write policy
  at all**, because changing what a person may reach must carry an audit row and the API is the only
  path that writes one.
- `forbid_org_change()` and `set_updated_at()` triggers.
- **No CHECK on `surface_key`** — 0296's header explains why at length: a bad key is inert because
  the resolver looks it up in the catalogue, and pinning 52 keys would mean a migration per new page.
- ⚠ **The role locks cannot be a CHECK here**, and that is the one real difference from 0296. This
  table is keyed by `user_id`, and the row does not know the user's role. D-PERM7/D-PERM8 must
  therefore be enforced in the API (reject a write against a member whose `memberships.role` is
  `admin` or `driver`) **and** in the resolver (`surfaceClaimFor` already returns `{}` for a
  non-editable role — keep that check ahead of the user-layer read). Say so in the migration header,
  because a reader comparing the two tables will notice the missing constraint and should find the
  reason rather than a gap.

### The code

| file | change |
|---|---|
| `apps/api/src/modules/org/routes/surfaceAccess.ts` | `surfaceClaimFor` reads the user rows and merges them **over** the role rows. The `EDITABLE_ROLES` guard at line 75 stays FIRST. |
| same file | a second `PUT` (or a `userId` field on the existing one) writing `user_surface_access`, audited as `permissions.screen_changed_user`, admin-only, validating the key against the catalogue via `surfaceAccessSetSchema`'s refinements. |
| `packages/shared/src/apiContract.ts` | a `userSurfaceAccessSetSchema` beside the existing one. |
| nothing else | `/api/me`, the session store, the nav and the guard already consume `SurfaceClaim` and do not care which layers produced it. **This is the payoff of resolving server-side.** |

### One decision to make deliberately, not by default

The plan says **"Two merges, per D-SURF9"** — table first, reader second — because `/api/me` is on
every page load and a reader deployed nine minutes before its table would break bootstrap.

**Re-read that reasoning against what S3b actually shipped.** `surfaceClaimFor` returns `{}` on any
query error, and `app.ts` wraps the whole call in `try/catch`. A missing table is a query error. So
during the nine-minute window the user layer simply does not apply, and then it does — no breakage,
because the fail-open already covers exactly the failure D-SURF9 exists to prevent.

**This is already proven, not a hope.** `surfaceAccess.test.ts` has the assertion by name — *"returns
no denials when the table cannot be read, rather than denying everything"* — driving `surfaceClaimFor`
against a recorder whose table returns an error, which is what a missing table is.

**Recommendation: ONE PR, and say this in the migration header** so the deviation from D-SURF9 is a
recorded decision rather than a forgotten rule. Extend that test to cover the user-layer read on the
same fixture, so the property that licenses the deviation is pinned by the PR that relies on it.

✅ **Taken, 2026-09-02.** One PR. 0298's header carries the deviation, and the property is pinned by
`"returns the role's answers unchanged when the user table cannot be read"` plus its mirror for the
role table — each fails a different mutation, which is how the pair was found to be necessary.

---

## 4. S5 — per-user section overrides

**S5 is independent of S1–S4.** It touches no catalogue and no surface. If S4 stalls, ship S5 anyway
— it is the half that answers "custom setup for each user" for *data*.

### What makes it small

`sections` flows from the JWT claim into `AuthContext` (`claimsToContext`, `packages/shared/src/auth.ts`)
and into the web store (`stores/session.ts:71`). **Every consumer already reads it.** So the whole of
S5's read path is one migration changing `custom_access_token_hook` — verified, not assumed.

### The migration

`user_section_access (org_id, user_id, section, access)` + the hook change, in the **same** file.
They apply in the same instant, so D-SURF9 does not bite here — that rule is about TypeScript readers
deployed ahead of their schema.

Inside the existing `if v_role not in ('admin','driver')` guard in 0292's hook body, add a second
sparse `jsonb_object_agg` and merge it over the org's with `||` (the right operand wins in jsonb).
Then:

- `grant select on public.user_section_access to supabase_auth_admin;` — 0292 did this for
  `org_section_access`. The hook is `security definer` so it does not strictly need it; matching the
  posture of the file you are editing is the point.
- ⚠ **Re-apply the locks.** 0292's header says it plainly: this function is the one that turns a row
  into authority, so if a row for `admin`/`driver` or for the `admin` section ever existed — a
  restore, a support action, a future writer — this is the last place that can decline to honour it,
  and the only one whose failure hands out access rather than storing something wrong. Keep
  `and section <> 'admin'` on the new read too.
- `section` **does** get a CHECK constraint here (unlike `surface_key`), because 0291's argument
  applies: D-PERM7 is a security boundary and the `admin` section must be unstorable. Copy 0291's
  literal list.

### The writer

`lint:table-producers` will fail on a table with no writing code. S5 needs a write endpoint —
`apps/api/src/modules/org/routes/sectionAccess.ts` is the file to extend, mirroring its existing
`PUT`. Nobody calls it until S6, which is the "feature nobody is using yet" case the deploy-window
exemption was actually written for, so it may ship in the same PR.

### Q-SURF4 becomes real here

A per-user section override enters the JWT. Sparse keeps it small but there is **no measured bound**.
Measure one: mint a token for a user with every editable section overridden and record the size.
Write the number into the plan's Q-SURF4. If it is uncomfortable, cap the claim and fail the WRITE
with a named error rather than mint a token some proxy silently truncates.

---

## 5. Traps this programme has already paid for

Every one of these cost time or a red CI run in the sessions that got here.

1. **`pnpm lint:table-producers` and `lint:table-writers` are not in the fast set.** Both fired only
   in CI. **Run the whole CI gate list before pushing** — extract it, do not remember it:
   `grep -oE "pnpm (--filter [^ ]+ )?lint:[a-z-]+|pnpm typecheck|pnpm test|pnpm build" .github/workflows/ci.yml | sort -u`
   ⚠ That command reads the workflow, so it only lists gates CI actually runs — which is the point,
   and is how the unrun `lint:comment-claims` was found. `lint:rls` is chained onto another script
   rather than named, so run it too.
2. **A new table needs three registrations**, and each is a separate gate: `scripts/table-modules.json`
   (module + layer — use `org` / `core`), `scripts/table-writers.json` (the writing file), and a
   producer (writing code, or a waiver naming the plan).
3. **`lint:section-policies` reads `auth_role() in (...)` but NOT `auth_role() = any (array[...])`.**
   Write policies with `in (...)`. This is Q-PERM11 in `EDITABLE-PERMISSIONS-PLAN.md` and it is still
   open — 0293's 31 role lists were never checked by it.
4. **Its waiver check greps the RAW file**, so a migration header that merely *mentions* the waiver
   marker waives its own migration and the gate reports green having read nothing. 0294's first draft
   did exactly that.
5. **`pnpm build` fails locally on every branch** unless `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   are exported — `vite.config.ts` reads `process.env`, which vite does not populate from `.env` at
   config time. `set -a; . apps/web/.env; set +a` then build. CI supplies them as secrets.
6. **`pnpm lint` scans `.claude/worktrees/`**, which is a parallel session's checkout. Errors there
   are not yours — the path is gitignored and invisible to CI. Filter before believing a lint failure.
7. **`lint:comment-claims` now runs in CI, as of this handoff's own PR.** It had been in
   `package.json` since the comment discipline was written and **nothing executed it** — found by
   running it by hand while writing this file, on a repo that was clean except for one comment added
   that same day. If you write "proves" / "pinned by" / "verified in" above a test reference, quote
   the real `it(...)` title; a bare filename fails.
8. **A snapshot test is the review.** `apps/web/src/lib/navEquivalence.test.ts` holds 33 snapshots of
   `buildNavGroups`. If your change is not meant to alter the sidebar, that file's diff must be
   **empty** — not "updated". Same for `apps/web/src/router/__snapshots__/routeTable.test.ts.snap`.

---

## 6. Parallel sessions — check every time, not once

Another chat works the same checkout, sometimes in `.claude/worktrees/*`. Four merges landed under
this programme's feet in one afternoon. **Before every push and every merge:**

```
git worktree list                      # is the other session in this tree?
git branch --show-current              # am I still where I think I am?
git status --porcelain                 # is anything of mine uncommitted and at risk?
git fetch origin && git log --oneline origin/main -1
git log --oneline origin/main..HEAD    # does my branch carry ONLY my commits?
gh pr list --state open                # what is about to land?
```

Then, before merging, the two that actually bite:

- **Migration numbers.** `git ls-tree -r --name-only origin/main supabase/migrations/ | tail -3`. If
  the other session has taken the number you were about to use, renumber. `lint:migrations` enforces
  uniqueness but only sees both files once both have merged, so the collision surfaces late and the
  loser renumbers anyway — this happened to this very handoff, see §1.
- **File overlap.** `gh pr view <theirs> --json files -q '.files[].path'` against your own list.

Leave the tree clean when you stop. `main` is often checked out in their worktree, so
`git checkout --detach origin/main` is the way to park it.

---

## 7. The resume ritual

1. Read `SURFACE-ENTITLEMENTS-PLAN.md` in full, then this file, then the `CLAUDE.md` of every package
   you touch (root, `apps/web`, `apps/api`, `supabase`).
2. Establish reality: `git log --oneline -10`, `git worktree list`, `pnpm verify:live`.
3. Read `supabase/migrations/0296_org_role_surface_access.sql` and
   `apps/api/src/modules/org/routes/surfaceAccess.ts` before writing anything — S4 is their sibling
   and should read like one.
4. One step per branch (`claude/<topic>`), PR to `main`, CI green, **verify `main` actually moved**.
5. When a step ships, mark it **— DONE `<date>` (migrations NNNN–NNNN)** in place in the plan with
   "What shipped" and "Verified by:" naming the gates run. When a §6 question is answered, strike it
   through in place with the answer and date.
6. Update this file's §1 table, or delete this file if S4 and S5 are both done and S6/S7 have their
   own handoff.
