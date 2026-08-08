# Devin — commit and push, two branches

The working tree at `~/Projects/FuelGuard` holds **two unrelated bodies of work**. Do not squash them
together and do not merge the second one.

| Branch | What | Merge? |
| --- | --- | --- |
| `wip/driver-design-system-2` | Miki's hand-written driver + web design-system rework, in flight | **No — push only** |
| `feat/safety-dqf-hazmat-link` | Backend: migrations `0146`–`0148`, API, shared contracts, tests, plan docs | **Yes** |

**Do the WIP branch first.** Both sets of changes are unstaged in one tree, and the backend branch's
test run is only meaningful once the in-progress driver work is out of the way. Committing the driver
side first, then branching the backend fresh off `main`, is what makes `pnpm test` mean something.

Local `main` is behind `origin/main`. Pull first.

```bash
cd ~/Projects/FuelGuard
git switch main && git pull --ff-only
corepack enable
```

---

## 1. Branch one — preserve Miki's work, do not merge

Everything under `apps/driver`, `apps/web`, `packages/ui` and `docs/plans/drivers-app` (except
`FIELD-REPORTS.md`) is his hand-written rework, plus `pnpm-lock.yaml`, which moved with
`apps/driver/package.json`. It is unfinished by design. The job here is to get it off a single
laptop's disk, nothing more.

```bash
git switch -c wip/driver-design-system-2

# Do this BEFORE the add: apps/driver/modules/capture-native/android/.gradle/ is untracked build
# state that `git add apps/driver` would otherwise sweep in. The .gitignore edit stays in the working
# tree, carries over when you branch off main below, and is committed there (commit 5).
printf '\n# Gradle build state inside the local native capture module\napps/driver/modules/capture-native/android/.gradle/\n' >> .gitignore

git add apps/driver apps/web packages/ui pnpm-lock.yaml \
        docs/plans/drivers-app/DRIVER-APP-BUILD-STATUS.md \
        docs/plans/drivers-app/DRIVER-APP-PLAN.md \
        docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2.md \
        docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-AUDIT.md \
        docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-PHASE-2.md \
        docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-PHASE-3.md \
        docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-PHASE-4.md \
        docs/plans/drivers-app/NAVIGATION-PROGRAMME-PLAN.md

git commit -m "WIP: driver design system 2 (Miki's in-progress rework)"
git push -u origin wip/driver-design-system-2
```

**Do not merge this branch, do not open a PR for it, and do not run the gate against it.**
Check `git status --porcelain` before committing: no `.gradle` path should be staged.

Note in your report whether `pnpm typecheck` passes on this branch. Information only; a WIP branch is
allowed to be red.

---

## 2. Branch two — the backend work

Branch off `main`, not off the WIP branch. The driver files revert to their committed state, leaving a
tree that contains only the backend change:

```bash
git switch -c feat/safety-dqf-hazmat-link main
pnpm install --frozen-lockfile      # package.json and the lockfile just moved back
pnpm --filter @fuelguard/shared build:rn
```

Confirm the tree now holds only backend work:

```bash
git status --porcelain
```

Every line should be under `apps/api`, `packages/shared`, `supabase`, `docs/plans`, or `.gitignore`.
If anything under `apps/driver`, `apps/web` or `packages/ui` is still listed, stop: it did not make it
into the WIP commit.

Run the four behavioural matrices before committing:

```bash
pnpm test:rls
```

Expected, exactly: **rls 179 · hazmat_rls 16 · load-lifecycle 54 · duty-sessions 20.**
Any other number is a regression — stop and report it rather than adjusting a test.

### Commit 1 — DQ0, the documents table

```bash
git add supabase/migrations/0146_compliance_documents.sql \
        supabase/migrations/0147_retire_dead_compliance_tables.sql \
        packages/shared/src/complianceContract.ts \
        apps/api/src/services/compliance.ts \
        apps/api/src/routes/compliance.ts \
        apps/api/src/services/schemaCheck.ts

git commit -m "Add the compliance documents table and its signed upload path

There was no way to upload a driver document and nowhere to put one:
certifications.document_id and qualification_records.document_id were
unconstrained uuids pointing at a table that did not exist. Adds documents,
the private compliance-docs bucket, both foreign keys, and register plus
batch-signed-read endpoints modelled on the proven hazmat path.

Append-only by RLS: no UPDATE and no DELETE policy, because a safety file a
manager can quietly rewrite is not evidence under 390.32(d).

0147 retires compliance_items, master_documents and driver_endorsements —
three tables with no producer and no consumer."
```

### Commit 2 — DQ1, editable driver master data

```bash
git add packages/shared/src/rosterContract.ts \
        apps/api/src/routes/roster/drivers.ts \
        apps/api/src/routes/roster/drivers.test.ts \
        apps/api/src/services/samsaraDriverSync.ts \
        apps/api/src/services/samsaraDriverSync.test.ts

git commit -m "Make driver master data editable, and stop the sync overwriting it

The roster had list, create and invite and nothing else, so every column 0098
added was write-once — a mistyped CDL expiry was permanent. Adds GET /:id and
a strict PATCH /:id, with the three rules (identity edits claim the row from
telematics, name parts recompute full_name, terminating stamps the retention
clock) in a pure resolveDriverUpdate.

Deactivation is a status edit, not a second endpoint: auth_driver_id()
resolves only active drivers, so PATCH { status: 'terminated' } ends app
access through the policies themselves.

Also fixes the sync's UPDATE-on-match path, which wrote full_name and phone
over every matched row including identity_source = 'manual'. 0098 documented
enrich-never-clobber and only the deactivation pass honoured it, so an admin's
correction reverted on the next run with nothing logged."
```

### Commit 3 — H-C1, the hazmat link

```bash
git add supabase/migrations/0148_hazmat_load_link.sql \
        packages/shared/src/hazmatApi.ts \
        apps/api/src/services/hazmatLoads.ts \
        apps/api/src/routes/hazmat/index.ts \
        apps/api/src/services/dispatchLoads/detail.ts \
        apps/api/src/services/dispatchLoads/detail.test.ts

git commit -m "Link hazmat records to the dispatch loads they describe

loads and hazmat_loads were two parallel load entities with nothing between
them, which is the structural reason hazmat grew its own navigation section.
Adds a nullable hazmat_loads.load_id with a composite foreign key on
(load_id, org_id), so a service-role bug cannot link one carrier's hazmat
record to another carrier's load.

link_hazmat_load() moves the link forward along the supersede chain — a
cleared record is immutable and a correction is a new row, so a plain unique
index would have made every correction unlinkable — and refuses to take it
from any record outside that chain.

GET /api/dispatch/loads/:id now returns a hazmat_record block, which is what
LD6 was blocked on."
```

### Commit 4 — the matrices and the plan docs

```bash
git add supabase/tests/rls.test.mjs supabase/tests/load-lifecycle.test.mjs \
        docs/plans/safety-dqf/ docs/plans/hazmat-consolidation/ docs/plans/loads-detail/ \
        docs/plans/DEVIN-HANDOFF-2026-08-07-DEPLOY.md \
        docs/plans/DEVIN-COMMIT-2026-08-08.md \
        docs/plans/drivers-app/FIELD-REPORTS.md

git commit -m "Cover the new tables and the hazmat link in the matrices

rls 159 -> 179: the documents table, and certifications for the first time —
the rows holding drivers' medical cards and drug-test results had a
driver-scope policy this matrix had never executed. Plus four assertions that
terminating a driver ends app access while the record is retained.

load-lifecycle 42 -> 54: the hazmat link, its supersede-chain hand-off, and
the composite foreign key refusing a cross-tenant link."
```

### Commit 5 — the gitignore

The edit itself was made back in step 1, and followed you across the branch switch.

```bash
git add .gitignore
git commit -m "Ignore Gradle build state in the local capture module"
```

### Check nothing was left behind

```bash
git status --porcelain
```

Must print **nothing**. Anything listed belongs in one of the five commits above.

### The full gate

```bash
git push -u origin feat/safety-dqf-hazmat-link

pnpm lint && pnpm lint:filesize && pnpm lint:funcsize && pnpm lint:migrations
pnpm lint:boundaries && pnpm lint:tokens-parity && pnpm --filter @fuelguard/web lint:tokens
pnpm typecheck
pnpm test        # includes vitest, which has never run on any of this
pnpm build
```

`pnpm test` is the one that matters. Everything above was verified with typechecks, all seven lint
gates and all four matrices, but **vitest has never executed against these changes** — roughly thirty
new unit tests across the three commits. If it is red, report the failure; do not edit the assertions.

Green → merge:

```bash
git switch main && git merge --ff-only feat/safety-dqf-hazmat-link && git push origin main
```

---

## 3. Watch `0146`–`0148` land

Merging touches `supabase/migrations/**`, so **Apply Supabase migrations** fires automatically. Wait
for it, then:

```bash
pnpm verify:live
```

`schema.applied` must read **0148**, `schema.state` **current**, `ok` **true**, and `commit` must
equal `git rev-parse HEAD`. Anything else, stop and report.

`0147` drops three tables. It is deliberate and guarded — but if it errors, do not edit the migration
to get past it. Report the error.

---

## 4. Clean the tree

```bash
git switch main
rm -rf _to_delete
git status --porcelain
```

`_to_delete/` holds nine scratch files — two debug harnesses, a migration probe, and six patch
scripts. Cowork can move files on the Mac but not delete them, so they accumulate there. Nothing in it
is tracked and nothing in it is needed.

---

## 5. Report

1. `pnpm test:rls` counts before you committed, and full `pnpm test` output after.
2. Whether vitest passed on the three new commits, with the failure text if not.
3. `supabase migration list --linked` after the merge, and `pnpm verify:live`.
4. That `wip/driver-design-system-2` is pushed and unmerged, and whether typecheck passes on it.
5. Anything you had to leave uncommitted, and why.
