# Devin — commit DQ2

Everything before this is already on `main` and deployed: the two branches, migrations `0146`–`0148`,
and F-H1 (`84ed95b`). `GET /api/version` reports `commit 84ed95b`, `schema.applied 0148`, `ok true`.

One outstanding item from the previous round, for the report only: `f191dbc` merged
`wip/driver-design-system-2` into `main` when the runbook said to leave it unmerged. Do not revert it;
Miki knows.

---

## The commit

DQ2 — the §391.51 driver qualification file. Twelve paths, one commit.

```bash
cd ~/Projects/FuelGuard
git switch main && git pull --ff-only
git status --porcelain
```

Expect exactly:

```
 M apps/api/src/services/compliance.ts
 M apps/web/src/composables/useCompliance.ts
 M apps/web/src/lib/nav.test.ts
 M apps/web/src/lib/nav.ts
 M apps/web/src/pages/CompliancePage.vue
 M apps/web/src/router/index.ts
 M docs/plans/safety-dqf/DQF-PLAN.md
 M packages/shared/src/complianceContract.ts
 M packages/shared/src/index.ts
?? apps/web/src/features/compliance/
?? packages/shared/src/dqFile.test.ts
?? packages/shared/src/dqFile.ts
```

If a stale `.git/index.lock` blocks you, delete it — one keeps reappearing from a concurrent git
process, and Cowork can only move files on this machine, not unlink them. Look in `_to_delete/`.

### Gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @fuelguard/shared build:rn

pnpm lint && pnpm lint:filesize && pnpm lint:funcsize && pnpm lint:migrations
pnpm lint:boundaries && pnpm lint:tokens-parity && pnpm --filter @fuelguard/web lint:tokens
pnpm typecheck
pnpm test
pnpm build
```

Expected matrix counts, unchanged — there is no migration in this commit:
**rls 179 · hazmat_rls 16 · load-lifecycle 54 · duty-sessions 20.**

Two things `pnpm test` covers that nothing else can. `packages/shared/src/dqFile.test.ts` is new — 30
assertions, its first real execution; the logic behind all 30 was verified by compiling the module and
asserting against plain node, but that is not the same as running the suite. And
`apps/web/src/lib/nav.test.ts` changed with the rename, so a stale expectation there will show up as a
failure rather than as a silently wrong sidebar.

If anything is red, report it; do not edit the assertions. Two of the 30 were wrong when first written
and the code was right — the same could be true again in the other direction.

### Commit and push

```bash
git add packages/shared/src/dqFile.ts packages/shared/src/dqFile.test.ts \
        packages/shared/src/complianceContract.ts packages/shared/src/index.ts \
        apps/api/src/services/compliance.ts \
        apps/web/src/composables/useCompliance.ts \
        apps/web/src/features/compliance/ \
        apps/web/src/pages/CompliancePage.vue \
        apps/web/src/lib/nav.ts apps/web/src/lib/nav.test.ts \
        apps/web/src/router/index.ts \
        docs/plans/safety-dqf/DQF-PLAN.md \
        docs/plans/DEVIN-COMMIT-2026-08-08.md

git commit -m "Add the electronic driver qualification file

391.51 as a checklist: eighteen items with their citations and retention
rules, the four 172.704(a) training types and the 383.93 endorsement when the
carrier runs HazmatGuard. Pure and unit-tested in shared, so the dashboard and
a future audit export read the same function.

buildDqFile takes today as a parameter rather than reading the clock, because
the question an auditor asks is what the file looked like on a date, which a
function that looks at the wall clock cannot answer.

Deliberately not the hazmat gate. qualificationGate decides whether a driver
may haul a placardable load now; this decides whether the file is complete for
an audit. They overlap on the CDL and the medical certificate and diverge
everywhere else, and they are allowed to disagree: training on its third
anniversary is due here and still a pass there.

The panel is a section in the existing drawer, not a page. Rows without a scan
get an Attach button that registers the document and PUTs the bytes straight
to Storage through the DQ0 signed-upload path, with the SHA-256 computed in
the browser first. A document id that points at nothing reports as no
document, because a failed upload leaves the row behind and a checklist that
trusted the id would promise a scan nobody can open.

Renames the sidebar item to Driver Qualification. Safety was the drafted name
but the section is already called Safety; the route stays /compliance."

git push origin main
```

No migration, so no Supabase workflow fires. Railway redeploys; confirm:

```bash
pnpm verify:live
```

`commit` must equal `git rev-parse HEAD`, `schema.applied` stays **0148**, `ok` **true**.

### Then eyeball it

The one thing no test covers is whether the upload actually works end to end against real Storage.
Open **Safety → Driver Qualification**, click a driver, and attach a PDF to any row. Expect the row to
switch from **Attach** to **View**, and the link to open the scan. If it fails, capture the browser
console and the network response for `POST /api/compliance/documents` and for the Storage PUT — those
two calls are the whole path.

---

## Clean the tree

```bash
rm -rf _to_delete
git status --porcelain
```

Scratch files Cowork moved aside rather than deleted: patch scripts, two compiled-module verification
directories, debug harnesses, and stale `index.lock` files. Nothing tracked.

---

## Report

1. Full `pnpm test` output, especially `dqFile.test.ts`, `nav.test.ts`, and the four matrix counts.
2. `pnpm verify:live` after the push.
3. What happened when you attached a PDF, including the failure detail if it did not work.
4. Confirm `_to_delete/` is gone.
